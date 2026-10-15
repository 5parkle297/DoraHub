# 09 · 代码仓库结构与骨架

## 1. 目录结构

```
durahub/
├── package.json                # workspaces：server / web / shared
├── deploy/
│   ├── durahub.service         # systemd 单元（04 §7）
│   └── deploy.sh               # hub 上一键部署
├── packages/
│   ├── shared/                 # 协议类型 + 帧定义（server 与 web 共用）
│   │   ├── src/
│   │   │   ├── api.ts          # HTTP 请求/响应类型
│   │   │   └── frames.ts       # WS 帧 + exec-agent 帧类型（05/07）
│   │   └── tsconfig.json
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts        # 入口（04 §6）
│   │   │   ├── harness.ts      # Harness 装配（04 §2）
│   │   │   ├── http-api.ts     # REST 路由
│   │   │   ├── ws.ts           # WS 端点与扇出（04 §4）
│   │   │   ├── events.ts       # watchEvents 裁剪适配
│   │   │   ├── auth.ts         # token 中间件（funnel 模式）
│   │   │   ├── audit.ts        # 审计 JSONL
│   │   │   ├── static.ts       # 托管 web/dist
│   │   │   └── exec/
│   │   │       ├── registry.ts # ExecRegistry（07 §4）
│   │   │       └── remote-env.ts
│   │   └── tsconfig.json
│   ├── web/
│   │   ├── public/             # manifest、图标
│   │   │   └── sw.js           # 极简 service worker（06 §1）
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── ws.ts           # WS 单例 + 重连状态机（05 §3）
│   │   │   ├── api.ts          # fetch 封装（token 注入）
│   │   │   ├── state/
│   │   │   │   ├── conn.ts     # AppCtx
│   │   │   │   └── conv.ts     # ConvCtx + reducer（05 §2 对照表）
│   │   │   ├── pages/
│   │   │   │   ├── Conversations.tsx
│   │   │   │   └── Conversation.tsx
│   │   │   └── components/
│   │   │       ├── MessageBubble.tsx
│   │   │       ├── ToolCard.tsx        # 工具卡片（bash/read/edit 分型）
│   │   │       ├── DiffView.tsx        # 两栏 diff（06 §6）
│   │   │       ├── Inbox.tsx           # 排队/steer 消息区
│   │   │       ├── ConfirmationCard.tsx
│   │   │       └── Composer.tsx        # 输入区（steer 开关）
│   │   ├── index.html
│   │   ├── vite.config.ts       # proxy /api 与 /ws 到本地 server（开发）
│   │   └── tsconfig.json
│   └── exec-agent/              # M4
│       ├── src/
│       │   ├── index.ts         # 连接 hub、心跳、帧循环
│       │   ├── ops.ts           # exec/read/dir/write 实现（spawn/fs）
│       │   ├── whitelist.ts     # 路径白名单（07 §5）
│       │   └── shell.ts         # W-c 双模式 bash 探测（08 §3）
│       └── tsconfig.json
├── guard-rules.json             # 危险操作规则（04 §5）
└── docs/                        # 本设计文档夹的拷贝（随仓库走，实施中更新）
```

## 2. package.json 要点

```jsonc
{
  "name": "durahub",
  "private": true,
  "workspaces": ["packages/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "npm run dev -w packages/server",     // node --watch src/index.ts
    "dev:web": "npm run dev -w packages/web",    // vite
    "build": "npm run build -ws --if-present",
    "test": "npm test -ws --if-present"
  }
}
// packages/server/package.json 关键依赖（精确版本！ADR 纪律）：
//   "@earendil-works/pi-durable": "<M1 安装日的最新版，精确>",
//   "@earendil-works/pi-ai": "精确版本",
//   "@earendil-works/chord": "精确版本",
//   "ws": "^8.x"
// 不引：express/koa/fastify（02 §6 决策）、UI 组件库（06）
```

## 3. 骨架代码：先立起来就能跑的三个文件

### 3.1 `packages/server/src/index.ts`（M2 骨架）

```ts
import { createServer } from "node:http";
import { startHarness } from "./harness";
import { route } from "./http-api";
import { attachWs } from "./ws";
import { serveStatic } from "./static";

const PORT = 8787;

async function main() {
  const harness = await startHarness(process.env.DB_PATH ?? "/var/lib/durahub/agent.sqlite");
  const http = createServer((req, res) => route(harness, req, res)
    .catch(err => { res.writeHead(500, {"content-type":"application/json"});
                    res.end(JSON.stringify({error:{code:"internal",message:String(err)}})); }));
  attachWs(http, harness);                    // /ws upgrade
  serveStatic(http, "../../web/dist");        // PWA 静态托管
  http.listen(PORT, "127.0.0.1", () =>
    console.log(`durahub on http://127.0.0.1:${PORT} (behind tailscale serve)`));
  const shutdown = async () => { /* 通知 WS 客户端 bye → harness.close() → exit */ };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
main();
```

### 3.2 `packages/shared/src/frames.ts`（协议单一定义源）

```ts
// —— server → client ——
export type SrvFrame =
  | { t: "hello"; serverId: string; proto: 1 }
  | { t: "snapshot"; conv: string; entries: unknown[]; live: unknown; inbox: unknown[]; agent: unknown }
  | { t: "events"; conv: string; events: unknown[] }
  | { t: "conv_status"; conv: string; status: "running" | "idle" }
  | { t: "confirmation"; conv: string; confirm: { id: string; tool: string; args: unknown; askedAt: number } }
  | { t: "pong" };

// —— client → server ——
export type CliFrame =
  | { t: "attach"; conv: string }
  | { t: "detach"; conv: string }
  | { t: "ping" };

// —— hub ↔ exec-agent（07 §3）——
export type ExecCliFrame = ...;   // exec-agent → hub
export type ExecSrvFrame = ...;   // hub → exec-agent
```

### 3.3 `deploy/deploy.sh`

```bash
#!/usr/bin/env bash
# hub 上的部署脚本：git pull → build → 重启
set -euo pipefail
cd /opt/durahub
sudo -u durahub git pull --ff-only
sudo -u durahub npm ci
sudo -u durahub npm run build
sudo systemctl restart durahub
sleep 1
curl -s http://127.0.0.1:8787/api/health || { echo "HEALTH CHECK FAILED"; exit 1; }
journalctl -u durahub -n 20 --no-pager
```

## 4. 开发工作流（workpc 上的日常）

```
日常开发（不需要 VM）：workpc 上 npm run dev + dev:web（vite proxy 到本地 server，
  server 用本地 sqlite 文件 dev.sqlite —— pi-durable 本地就能全功能开发！）

联调（M2 起）：push → hub 部署 → 手机/workpc 浏览器对 https://hub.<tailnet>.ts.net 测试
调试 hub：journalctl -u durahub -f；代码改动走 deploy.sh
崩溃恢复测试：sudo systemctl kill -s SIGKILL durahub（触发 systemd 拉起）
```

**这个"本地全功能开发"性质是 pi-durable 给的最大工程便利**：所有功能先在 workpc 本地闭环，VM 只是部署目标——不存在"没网络就没法开发"的阶段。

## 5. 版本锁定纪律（ADR-003 重申）

- 所有 `@earendil-works/*` 依赖：**精确版本**（无 ^/~）
- 升级 = 独立 PR：读 changelog → 跑全部测试 → 05 §6 的 T-01~T-07 回归
- `package-lock.json` 提交；hub 上只用 `npm ci`
