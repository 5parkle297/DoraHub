# DuraHub

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
| M4 | 🔶 代码就绪 | pi-env 集成（V-01：官方 RemoteExecutionEnv 替代自研 exec-agent）；待 Tailscale SSH 部署后验证 |
| M0/M5 | ⏳ | 网络层部署（需手动）/ 加分项 |

## 快速开始（workpc 本地开发）

```bash
npm ci
npm run build              # server(esbuild) + web(vite)

ZJL_BASE_URL=... ZJL_API_KEY=... \
DURAHUB_DB=./dev.sqlite DURAHUB_CWD=$PWD \
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

见 `deploy/`：`durahub.service`（systemd）+ `deploy.sh`（pull → build → restart → health check）。

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
packages/server  hub：harness 装配、Durahub 应用层、HTTP/WS、guard、exec registry
packages/web     PWA：React 18 + Vite，无 UI 库
deploy/          systemd + 部署脚本
scripts/         验收测试与试玩脚本
guard-rules.json 危险操作规则（bashDeny / alwaysAsk）
```
