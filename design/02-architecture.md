# 02 · 总体架构

## 1. 架构图

```
                    Tailscale tailnet（WireGuard overlay，MagicDNS）
═══════════════════════════════════════════════════════════════════════
 p     p                        │
 h     h                        │ tailscale serve            (模式B: funnel)
 o     o              ┌─────────▼──────────┐               ┌───────────┐
 n     n              │  hub (CentOS VM)   │               │ Funnel 入口│
 e     e              │ ┌────────────────┐ │               │ (公网TLS,  │
                       │ │ durahub server │ │               │  需app token)│
 (PWA)  (PWA)  ──────►│ │  Node.js       │ │◄── 模式B ─────└───────────┘
        ▲             │ │                │ │
        │             │ │ HTTP API       │ │
  workpc/laptop       │ │ WS /ws         │ │
  上的浏览器也是       │ │ harness(API)   │ │
  同一个 PWA          │ │  │             │ │
                       │ └───┬────────────┘ │
                       │     │              │
                       │ ┌───▼────────────┐ │
                       │ │ pi-durable     │ │
                       │ │ Harness        │ │
                       │ │  ├─ registry   │ │  CodingTools(read/write/edit/bash)
                       │ │  ├─ models     │ │  ──► zjl 中转 (OpenAI 兼容) ──► glm/grok/...
                       │ │  └─ settings   │ │
                       │ │  SQLite 落盘    │ │  /var/lib/durahub/agent.sqlite
                       │ └───┬────────────┘ │
                       │     │ env({cwd, envId})          ┌──────────────┐
                       │     │                            │  systemd     │
                       │ ┌───▼────────────┐               │  durahub.    │
                       │ │ LocalEnv(默认)  │ ← M4 前所有   │  service     │
                       │ │ RemoteEnv(M4) ─┼──────────────►│  自动重启    │
                       │ └────────────────┘ │             └──────────────┘
                       └─────────┬──────────┘
                                 │ tailnet 内 TCP（自定义小协议）
                    ┌────────────┴────────────┐
                    ▼                         ▼
             ┌─────────────┐          ┌─────────────┐
             │   workpc    │          │   laptop    │
             │ exec-agent  │          │ exec-agent  │
             │ (read/bash/ │          │ (可选，M4)   │
             │  edit/write)│          └─────────────┘
             └─────────────┘
```

## 2. 组件职责

| 组件 | 位置 | 职责 | 不做什么 |
|---|---|---|---|
| **durahub server** | hub VM | 唯一状态拥有者。持有 Harness 实例；暴露 HTTP API + WS；管理客户端连接；审计日志 | 不直接执行工具（除 LocalEnv 默认模式）；不做 UI |
| **Harness (pi-durable)** | hub VM 进程内 | 会话/任务/提交的 durable 状态机；模型调用；compaction；多客户端 attach 语义 | 不感知网络（我们在外面套 WS） |
| **PWA** | phone / workpc / laptop 浏览器 | 聊天 UI、流式渲染、steer/abort/确认、断线重连 | 不持有任何权威状态；刷新即从 viewState 快照重建 |
| **exec-agent**（M4） | workpc / laptop | 暴露 exec/读/列/写 的执行端点，注册到 hub；把工具执行落到本机文件系统和 shell | 不接触会话/模型/存储；无状态 |
| **Tailscale 层** | 全部设备 | 组网、身份边界、serve 的 TLS 终结、MagicDNS | 不承载应用逻辑 |

## 3. 关键数据流

### 3.1 一次消息的完整旅程（US-01+US-02）

```
[PWA] 用户输入 → POST /api/conversations/:id/messages {content, mode:"input"|"steer"}
  → [server] conversation.submit({type:"input", content, requestId: uuid, whenBusy})
  → pi-durable: pi.user entry 落盘 → 调度 pi.generation task → 模型 API（zjl 中转）
  → 模型流式返回 → pi-durable 每 100ms commit 部分输出（pi.live 文档）
  → [server] watchEvents 流订阅到事件批 → 按 conversationId 路由 → WS 推给所有
    attach 该会话的客户端
  → [PWA] message_update 增量渲染；tool_execution_start/output 卡片流式滚动
  → 模型出 tool calls → pi.tool tasks → env() 构建 LocalEnv/RemoteEnv → 执行
  → 结果 commit → 下一轮 generation → … → 最终答案 → submission settled
  → [PWA] 输入框解锁，状态回到 idle
```

### 3.2 崩溃恢复（US-04）

```
hub 进程 OOM 被 kill -9
  → systemd Restart=always 5s 内拉起
  → Harness.open(同一 sqlite) → harness.resume()
  → 扫描未完成 tasks：
      · 被中断的 generation → 重发模型请求（transcript 里的 partial 标记 aborted）
      · 被中断的 tool call → replay:"safe" 的重跑；否则模型收到 interrupted 错误
      · inbox 里排队消息保持排队
  → 已连接客户端 WS 断开 → PWA 自动重连 → 重新 getSnapshot → 界面恢复
```

### 3.3 工具执行路由（US-06，M4）

```
会话配置 envId:"workpc" → conversation.agent().cwd 解析为 workpc 上的路径
  → 模型发出 bash tool call → pi-durable 调 env({cwd, envId})
  → [server] envId 存在注册表 → RemoteExecutionEnv(workpc)
      ├─ exec(["bash","-c",cmd]) → tailnet TCP → workpc exec-agent → 子进程
      ├─ onOutput 流式回传（stdout/stderr 分流）→ 回填 tool output（100ms 批量 commit）
      └─ 断线 → 抛错 → 工具错误结果："executor workpc offline"
```

## 4. 端口与地址规划

| 服务 | 监听 | 暴露方式 |
|---|---|---|
| durahub server | `127.0.0.1:8787`（HTTP+WS 同端口） | `tailscale serve --bg localhost:8787` → `https://hub.<tailnet>.ts.net` |
| exec-agent（workpc/laptop） | `127.0.0.1:8788`，由本机 tailscale 冒充暴露 或直连 `100.x.y.z:8788`（见 07 的取舍） | 仅 tailnet 内 hub 可达 |
| SQLite | 无网络 | `/var/lib/durahub/agent.sqlite`（root 属主，0600） |
| （模式 B）funnel | 上述 serve 再 `tailscale funnel 443 on` | `https://hub.<tailnet>.ts.net` 公网可达 + 应用 token |

## 5. 故障模型与降级

| 故障 | 行为 | 恢复 |
|---|---|---|
| hub 进程崩 | systemd 拉起 + resume() | 自动，丢失 ≤ progress 间隔 |
| VM 宕机 | 全平台不可用 | VM 重启后自动恢复；单点风险已接受（ADR-002） |
| 模型 API 断 | pi-durable retry（settings.retry.maxRetries）→ unanswered | 客户端显示错误，用户重试 |
| workpc 关机 | M4 后：该 envId 会话工具报错 | 不影响 hub 本地会话；workpc 开机后 exec-agent 自动重连注册 |
| tailnet 打洞失败回退 DERP | 变慢（海外中继） | M5 自建 derper 可解 |
| 手机没开 Tailscale | 模式 A 不可用 | 切模式 B（funnel + token）或接受不可用 |

## 6. 技术栈定版

| 层 | 选型 | 理由 |
|---|---|---|
| 服务端运行时 | Node.js ≥ 22（VM 上） | pi-durable 主路径；node:sqlite 或 better-sqlite3 由 pi-durable 内部决定（用它的 openNodeSqliteStorage 即可，不自己引 sqlite 库） |
| 服务端框架 | 无框架，node:http + ws 库 | 依赖最少；接口就十来个路由，框架是负资产 |
| 模型接入 | pi-ai + 自定义 OpenAI 兼容 provider（zjl 中转） | 复用用户现有通道；V-02 验证配置面 |
| 前端 | Vite + React 18 + TypeScript，**不引 UI 组件库**（手写 + 少量 CSS） | 简历叙事是自建平台，不是调 antd；消息流/工具卡片是自定义渲染重点 |
| 状态管理 | 前端不引 redux 等全局库：WS 事件驱动的局部状态 + 每会话一个 reducer | 事件流就是状态机，引库反而拧巴 |
| exec-agent（M4） | Node.js，与 server 共享协议包 | 同构复用 |
| 部署 | systemd unit + git pull + `npm ci && npm run build`（无 Docker，M5 可选） | VM 上最简可观测 |
