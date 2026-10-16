# 07 · 远程执行环境（M4）

> 目标：会话在 hub，工具（read/bash/edit/write）的**实际执行**在 workpc/laptop。

## 0. ✅ V-01 已验证：直接采用 @earendil-works/pi-env（2026-10-16，workpc）

`npm view @earendil-works/pi-env` 确认已发布 1.2.0，读其 README/.d.ts 后结论：**不自研 exec-agent，直接采用官方方案**（ADR-005 预留的路径）。

- `RemoteExecutionEnv`：现成实现，接口与 `NodeExecutionEnv` 完全一致（含可选 `listFiles`）
- 拓扑：hub 通过 **SSH** 启动远端 daemon（Rust 二进制，包内自带全平台：`bin/pi-env-windows-x64.exe` 等）；`connectSsh(target)` 自动检测远端系统→部署 daemon（SHA-256 校验）→返回 Connection
- Windows 支持：字符串命令走 Git Bash；argv 直接 exec；检测/部署走 PowerShell——**原 08 §3 的 W-a/W-b/W-c 三方案之争被官方实现解决**（相当于 W-b）
- 安全：ssh BatchMode + 独立 known_hosts（固定别名）+ 无转发；daemon 部署带哈希验证
- 懒连接：`sshConnection(target)` 返回懒 Connection，首次操作才连——失败是那次操作的错误，下次重试（正好匹配"workpc 关机时会话工具报错、开机自动恢复"的验收要求）

**与原设计的差异**（回写决策）：

| 项 | 原设计（自研 exec-agent） | 实际（pi-env） |
|---|---|---|
| 连接方向 | exec-agent 出站连 hub | hub 出站 SSH 连 exec 端 |
| 前提 | workpc 只需出站 | workpc 需可入站 SSH（Tailscale SSH 满足，零配置） |
| 协议 | 自定义 JSONL TCP | pi-env daemon 帧 stdin/stdout over SSH |
| 白名单 | 自研路径白名单 | 信任边界 = Tailscale SSH 身份 + 独立用户 |
| 工作量 | 1-2 周 | 集成半天 + 安全收紧 |

剩余自研部分：hub 侧 `buildEnv()` 按 envId 路由 + 会话创建时选机 + `/api/executors`（探测可达性）。原 §2-6 的自研 exec-agent 设计保留在本文末尾作对比叙事（面试素材）。

## 1. 集成架构（实际方案）

```
hub 进程内                                       workpc（Windows）
┌─────────────────────┐    Tailscale SSH        ┌──────────────────────┐
│ buildEnv({envId})   │◄───────────────────────►│ sshd (Tailscale SSH) │
│  ├ envId=hub        │  自动部署+启动 daemon     │  └ pi-env.exe        │
│  │  → NodeExecutionEnv                      │    （Git Bash exec）  │
│  └ envId=workpc     │                         └──────────────────────┘
│    → RemoteExecutionEnv
│       connection: sshConnection("workpc")
│       id: "pi-env:workpc"
└─────────────────────┘
```

- `sshConnection(target)` 懒连接：workpc 关机时首次工具调用报错，开机后下次调用自动重试成功
- 会话的 `envId` 存 `dorahub.meta` doc（fork: asOf 继承）；`cwd` 是**目标机上的路径**（hub 不解析）
- hub 侧缓存 `Map<envId, Connection>`；`GET /api/executors` 用轻量探测返回可达性

## 2. hub 侧实现要点

```ts
// packages/server/src/exec/registry.ts
const connections = new Map<string, Connection>();

export function buildEnv(target: EnvTarget): ExecutionEnv {
  const envId = readEnvId(target); // dorahub.meta doc（需要 DocumentReader）
  if (envId && envId !== "hub") {
    const conn = connections.get(envId) ?? sshConnection(configFor(envId));
    return new RemoteExecutionEnv({ connection: conn, id: `pi-env:${envId}`, cwd: target.cwd ?? defaultCwd });
  }
  return new NodeExecutionEnv({ cwd: target.cwd ?? DEFAULT_CWD });
}
```

EnvTarget 自带 `read: DocumentReader`（1.2.0 新增），可在 env() 里读会话的 dorahub.meta doc 拿 envId——不需要全局旁路状态。

## 3. executors 配置

`/etc/dorahub/env`（hub）追加：

```
DORAHUB_EXEC_WORKPC_HOST=workpc            # Tailscale MagicDNS 名
DORAHUB_EXEC_WORKPC_USER=shiyu             # SSH 用户
DORAHUB_EXEC_WORKPC_CWD=F:\work            # 默认 cwd
```

workpc 需开 Tailscale SSH（`tailscale up --ssh` 时代的 Windows 客户端在 GUI 里勾选）；daemon 部署全自动。

## 4. 验收（US-06，更新版）

- [ ] hub 配置 workpc 为 executor（Tailscale SSH 可达）
- [ ] 创建会话选 envId=workpc → 发"统计 F:\work
epo 里 TODO 数" → bash 在 workpc 执行，输出流式回传
- [ ] 任务中途关 workpc → 工具调用收到明确错误（executor offline），模型能处理并告知用户
- [ ] workpc 开机后无需任何操作，下一会话自动恢复
- [ ] 并发：两个会话同时路由到 workpc 互不干扰

---

## 附：原自研 exec-agent 设计（备而不用，保留作对比叙事）

## 附.1 pi-durable ExecutionEnv 接口

自定义环境必须实现（供 CodingTools 的 read/write/edit/bash 调用）：

```ts
interface ExecutionEnv {
  id: string;   // 关键！官方语义："equal ids see the same files at the same paths"
                // edit/write 用 id+path 做同文件序列化。每个 envId(机器) 一个稳定 id
  exec(argv: string[], opts: { onOutput(text, ctx, {stream}): void; signal: AbortSignal; timeout?: number }): Promise<{exitCode: number}>;
  openBinaryReader(path): Promise<{ read(offset, length): Promise<Uint8Array>; close(): Promise<void> }>;
  openDirReader(path): Promise<{ read(): Promise<{entries: DirEntry[], done: boolean}>; close(): Promise<void> }>;
  cleanup(): Promise<void>;
  listFiles?(dir, opts): Promise<{files: string[], truncated: boolean}>;  // 可选，加速用
  // write 侧：官方 CodingTools 的 write 需要 env 提供写能力——具体方法面 M4 时
  // 以 node_modules 里 pi-durable 的 .d.ts 为准（write/edit 走"读-改-写"管线）
}
```

⚠️ 实现前通读 `node_modules/@earendil-works/pi-durable/env/node` 的 TypeScript 定义，以 .d.ts 为唯一事实源（README 未列全 write 侧接口）。**这是本模块唯一的文档缺口，M4 第一件事就是补上这一步。**

## 2. 架构

```
hub 进程内                                       workpc（Windows）
┌─────────────────────┐    tailnet TCP      ┌──────────────────────┐
│ RemoteExecutionEnv  │◄───────────────────►│ exec-agent           │
│  (per envId)        │   自定义行协议(JSONL) │  Node.js 常驻进程     │
│   ├ exec() ─────────┼──► {cmd:"exec"...}  │   ├ spawn 子进程      │
│   ├ openBinaryReader┼──► {cmd:"read"...}  │   ├ 文件读/写/列      │
│   └ id:"workpc"     │   ◄─ 流式输出回传     │   └ 白名单/路径校验   │
└─────────────────────┘                     └──────────────────────┘
```

- **连接方向**：exec-agent **主动连 hub**（出站），注册自己（`{envId:"workpc", token}`）。这样 workpc 在 NAT/防火墙后也无需任何入站配置——和 Paseo relay 同样的"出站友好"设计，也是面试可讲的点
- hub 侧 `ExecRegistry`：`Map<envId, Conn>` + 心跳 + 断线摘除
- **协议**：JSONL over TCP（每行一帧），帧 ≤16MiB（文件读取分块），挂 TLS 与否：tailnet 内已加密（WireGuard），**v1 明文 JSONL 即可**（简化；tailnet 边界外不可达——ADR-007）

## 3. 帧协议 v1

```
exec-agent → hub：
  {"t":"hello","envId":"workpc","proto":1,"token":"...","platform":"win32"}
  {"t":"exec_output","callId":"c1","stream":"stdout","data":"base64..."}
  {"t":"exec_exit","callId":"c1","code":0}
  {"t":"read_chunk","callId":"c2","offset":0,"data":"base64...","eof":false}
  {"t":"dir_page","callId":"c3","entries":[...],"done":true}
  {"t":"write_ack","callId":"c4","bytes":123}
  {"t":"ping"}

hub → exec-agent：
  {"t":"exec","callId":"c1","argv":["bash","-c","npm test"],"cwd":"...","timeoutSec":120}
  {"t":"exec_abort","callId":"c1"}
  {"t":"read","callId":"c2","path":"...","offset":0,"length":65536}
  {"t":"dir","callId":"c3","path":"..."}
  {"t":"write","callId":"c4","path":"...","data":"base64...","mode":"overwrite|create"}
  {"t":"list","callId":"c5","path":"...","exclude":[...],"maxEntries":50000}
  {"t":"pong"}
```

设计要点：
- **argv 数组而非 shell 字符串**（对齐 pi-durable env 接口 ✅，注入安全）
- 输出 base64 分块 ≤64KiB，`onOutput` 逐块回调
- `exec_abort` → exec-agent `child.kill()`（Windows 上 `taskkill /T /F`，注意进程树）
- Windows 上 bash 工具：exec-agent 用 `bash -c`（WSL/Git Bash，见 08 §3）或直接 cmd —— 跟随 pi 的习惯用 bash 语义，exec-agent 启动时探测可用的 bash

## 4. RemoteExecutionEnv 关键实现点

```ts
class RemoteExecutionEnv implements ExecutionEnv {
  id: string;                          // "workpc"
  constructor(private reg: ExecRegistry, private envId: string) {}
  private nextCallId = 0;
  private pending = new Map<string, {resolve, reject, outputs: ((chunk, stream)=>void)[]}>();

  async exec(argv, { onOutput, signal, timeout }) {
    const callId = `e${this.nextCallId++}`;
    const conn = this.reg.get(this.envId);        // 不在线 → throw "executor workpc offline"
    // 注册 pending、发送 exec 帧、onOutput 流式转发、等待 exec_exit
    // signal.aborted → 发 exec_abort；timeout → 同样
    return { exitCode };
  }
  // openBinaryReader/openDirReader/write 同模式：请求-分块回传
  // cleanup() → 丢弃 pending（连接属 registry，不在这里关）
}
```

**env() 的接线**（04 §2 的 buildEnv）：

```ts
export function buildEnv({ conversationId, cwd }: { conversationId?: string; cwd?: string }) {
  // 会话文档里存了 envId（dorahub 自定义 doc，fork:"asOf"——分叉继承当时的目标机）
  const envId = conversationId ? agentDocs.get(conversationId)?.envId : undefined;
  if (envId && envId !== "hub") return new RemoteExecutionEnv(registry, envId);
  return new NodeExecutionEnv({ cwd: cwd ?? DEFAULT_CWD });
}
```

**路径语义**：会话的 `cwd` 字符串是**目标机器上的路径**（如 `F:\work\repo`），hub 不解析、原样传给 env——这正是 `id` 语义（同 id 的 env 才对同路径有一致视图 ✅）。

## 5. exec-agent 安全（简历安全叙事点）

exec-agent 是每台电脑上的**远程代码执行端点**，必须收紧：

1. **注册 token**：hub 生成的 per-machine token，装 agent 时配置（无 token 的 hello 直接断）
2. **路径白名单**：exec-agent 配置文件声明可访问的根目录列表（如 `F:\work`），所有 read/write/dir/exec 的 cwd 与 path 必须落在白名单内（规范化后前缀匹配，防 `..` 逃逸）
3. **exec 命令黑名单**（可选层）：与 hub 的 GuardExtension 呼应，双保险
4. **无会话语义**：exec-agent 完全无状态（callId 帧即可），不存任何东西，断电重启无损
5. Windows 上以低权限用户跑 + `icacls` 收紧工作目录

## 6. 网络打通方案（workpc 是 Windows）

exec-agent 只需**出站**连 `hub:8790`（hub 侧监听端口，见下）：

| 方案 | hub 侧 | 说明 |
|---|---|---|
| A. tailscale 直连 | `tailscaled` 监听 `0.0.0.0:8790`（仅 tailnet IP 可达） | 最直白；MagicDNS `hub:8790` |
| B. serve TCP 转发 | `tailscale serve --tcp=8790 localhost:8790` | 与 8787 同模式，统一走 serve |

选 B（统一暴露模型，hub 上防火墙规则最少）。`tailscale serve --tcp` 转发 TCP ✅（官方文档）。

## 7. 验收（US-06）

- [ ] workpc exec-agent 启动 → hub `/api/executors` 显示 online
- [ ] phone 上创建会话选 envId=workpc → 发"统计 F:\work\repo 里 TODO 数" → bash 在 workpc 执行，输出流式回传，结果正确
- [ ] 任务中途关 workpc 的 exec-agent → 工具调用收到 "executor offline" 错误，模型能处理并告知用户
- [ ] 路径白名单：请求 cwd 在白名单外 → exec-agent 拒绝帧
- [ ] 并发：两个会话同时路由到 workpc 执行互不干扰（callId 隔离）
