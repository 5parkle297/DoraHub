# DoraHub

跨设备持久化 Agent 平台：会话状态住在云 VM 上（pi-durable + SQLite），网络由 Tailscale 私有组网承载，任何设备用浏览器接入同一个 agent 会话。

```
phone(PWA) ─┐                       ┌─ Tailscale SSH ─► workpc exec（M4）
workpc(PWA) ─┼─► tailnet ─► hub VM ─┤
laptop(PWA) ─┘   serve/TLS   pi-durable + SQLite
```

## 状态

| 里程碑 | 状态 | 内容 |
|---|---|---|
| M1 | ✅ | pi-durable 跑通（zjl provider / grok-4.7），CLI 试玩，SIGKILL 崩溃恢复演练 |
| M2 | ✅ | hub 服务端：HTTP API + WS 事件扇出 + guard 确认流 + systemd 单元；15/15 集成测试 |
| M3 | ✅ | PWA：双设备同会话实时同步（S1）、steer（S2）、手机放行/拒绝（S3）、断线重连（S4 UI 侧） |
| M4 | ✅ | 执行机远程执行上线：hub 出站 SSH → workpc/laptop（Git Bash + PATH 注入），跨机工作区迁移，`/api/executors` 缓存探测 |
| M5 | ⏳ | 加分项：usage 面板、compaction 标记、fork 选点、PWA 推送等（见 handoff §5） |

## 重大改动记录（按会话分界）

| 日期 | 会话 | 重大改动 |
|---|---|---|
| 10-17 | pi 会话管理中心 | 会话软删除；跨机工作区迁移（harvest→中转搬运→校准提示）；pi CLI 会话扫描/元数据生成/导入 durable/删除/跨机搬运；/api/executors 秒回（缓存+后台探测）；执行机离线灰化 |
| 10-18 | 桌面两栏 + UI 收敛 | 桌面 ≥769px 侧栏常驻两栏布局（当前会话高亮、空态引导）；手机驾驶舱模式（无管理功能）；设置弹窗四页签（执行机/渠道模型/pi 会话/关于）；会话页 header 收敛（模型标签直达切换、⋯ 菜单）；pi 会话区从列表页移入设置；Tailscale 改名 cyq→workpc + dev SSH 全通（本地 dev 三机全功能） |
| 10-18 | 交接：UI 重设计准备 | 引入 impeccable（D:/hobby/impeccable，skill 已注册 pi、engine 已装）作为下一会话的 UI 重设计方法论；handoff v3 |
| 10-18 | UI 重设计完成 | 视觉系统 v3「原稿格工作台」上线（框即语义 × IBM Plex/Noto 自托管字体，impeccable 全流程：PRODUCT/DESIGN.md + detect 清零）；后经 v3.1/v3.2 用户 steer 升格蓝色 + 新 logo；产品真相拍板（邀请制小团队/BYOK/self-hosted 定位，多用户方案移 docs/roadmap.md） |
| 10-19 | 交接：laptop 体验修复 | P0-1 诊断完成：空壳会话为 CreateModal 误触连创（audit 实证 4 秒 3 个）；pi 扫描无 bug 但呈现混组不分机器；handoff v4 锁死修复方向，待下会话执行 |

## 快速开始（workpc 本地开发）

```bash
npm ci
npm run build              # server(esbuild) + web(vite)

ZJL_BASE_URL=... ZJL_API_KEY=... \
DORAHUB_DB=./dev.sqlite DORAHUB_CWD=$PWD \
node packages/server/dist/index.js

# 浏览器打开 http://127.0.0.1:8787
```

开发模式（热更新）：

```bash
npm run dev        # server: node --watch
npm run dev:web    # web: vite (proxy /api /ws -> 8787)
```

测试：

```bash
# 前置：server 在 8787 跑
node scripts/ws-test.ts        # M2 验收（15 项）
node scripts/guard-test.mjs    # S3 确认流
node scripts/play.ts           # M1 CLI 试玩（submit/steer/abort/fork/watchEvents）
node scripts/crash-test.ts     # M1 崩溃恢复演练（phase1 SIGKILL / phase2 resume）
```

## 部署（hub VM）

见 `deploy/`：`dorahub.service`（systemd）+ `deploy.sh`（pull → build → restart → health check）。

hub 只听 `127.0.0.1:8787`，唯一入口 `tailscale serve`（零公网暴露、自动 TLS）。

## 架构决策（ADR 摘要）

详见 `design/00-background-and-decisions.md`。

- **ADR-001** 自建而非 Paseo（简历价值）
- **ADR-002** hub 中心架构（pi-durable 存储模型的官方形态）
- **ADR-004** 同步协议 v1 = watchEvents 事件流（编码代理风格事件直接喂前端 reducer）
- **ADR-005** 执行路由 = pi-env（V-01 验证后官方方案替代自研）
- 版本锁定：所有 `@earendil-works/*` 精确版本，升级是独立任务

## 目录

```
design/          设计文档（00-12，项目的 single source of truth）
packages/shared  协议类型（HTTP + WS 帧）
packages/server  hub：harness 装配、Dorahub 应用层、HTTP/WS、guard、exec registry
packages/web     PWA：React 18 + Vite，无 UI 库
deploy/          systemd + 部署脚本
scripts/         验收测试与试玩脚本
guard-rules.json 危险操作规则（bashDeny / alwaysAsk）
```
