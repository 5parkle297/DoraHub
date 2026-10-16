# 04 · hub 服务端设计

## 1. 模块划分

```
dorahub/
  src/server/
    index.ts          # 入口：装配一切、启动监听 127.0.0.1:8787
    harness.ts        # Harness 装配（storage/registry/models/env/settings）
    http-api.ts       # REST 路由（会话/消息/配置）
    ws.ts             # WS 端点：事件流分发 + 客户端命令
    events.ts         # watchEvents → 客户端事件的适配/裁剪层
    auth.ts           # 模式 B 的 token 中间件（serve 模式下恒通过）
    audit.ts          # 审计日志（append-only JSONL）
    exec/registry.ts  # M4：exec-agent 注册表（envId → 连接）
    exec/remote-env.ts# M4：RemoteExecutionEnv 实现
```

依赖：`ws`（WebSocket）、`@earendil-works/pi-durable`、`@earendil-works/pi-ai`。无 Web 框架。

## 2. harness.ts 装配（M1 的核心文件）

```ts
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, defineExtension, hook, section } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { buildEnv } from "./exec/registry";   // M4 前：恒返回 NodeExecutionEnv

const context = BACKGROUND_CONTEXT;

// —— 模型：OpenAI 兼容自定义端点（zjl 中转）。✅ V-02 已验证（2026-10-16）：
// createProvider({id:"zjl", baseUrl, auth, models, api:{"openai-completions":{stream,streamSimple}}})
// 实现见 packages/server/src/zjl-provider.ts（model 必须带 baseUrl 和完整 cost 四字段）
const models = createModels();
models.setProvider(zjlProvider({
  baseUrl: process.env.ZJL_BASE_URL!,
  apiKey: process.env.ZJL_API_KEY!,
}));

// —— 扩展注册
const registry = createRegistry();
registry.install(CodingTools);            // read/write/edit/bash（经 env 执行）
registry.install(GuardExtension);         // US-05 权限拦截（见 §5）

// —— env：M4 前恒为本地；M4 后按 envId 路由
const env = (input: { conversationId?: string; cwd?: string }) =>
  buildEnv(input);                        // → NodeExecutionEnv | RemoteExecutionEnv

// —— 每会话可覆盖的默认 agent
const defaultAgent = {
  model: { provider: "zjl", modelId: "grok-4.7" },  // V-02 已验证（2026-10-16）；zjl 网关未开通 glm
  cwd: "/root/dorahub-workspace",
};

export async function startHarness(dbPath: string) {
  const harness = await Harness.open(
    await openNodeSqliteStorage(dbPath),
    {
      models, registry, env,
      settings: {
        progress: { partialIntervalMs: 200, outputIntervalMs: 200 }, // 稍降频，省 WS 带宽
        toolExecution: "parallel",
        compaction: { enabled: true, reserveTokens: 16384 },
      },
    },
    context,
  );
  harness.resume();                       // 断点续跑
  return harness;
}
```

## 3. HTTP API v1（JSON，全部小写蛇形命名）

| 方法 & 路径 | 用途 | 请求/响应要点 |
|---|---|---|
| `GET /api/health` | 存活探针（systemd/脚本用） | `{ok:true, uptime, version}` |
| `GET /api/conversations` | 会话列表 | `[{id, name, status(running/idle), envId, model, updatedAt, lastPreview}]`。数据源：harness 会话枚举 + `pi.live` 状态（枚举 API 以实际版本为准 ⚠️ M1 时确认 `harness.listConversations` 或 scan 接口名） |
| `POST /api/conversations` | 创建 | `{name?, envId?, cwd?, model?}` → `{id}`；内部 `harness.createConversation({ownership:{kind:"ownerless"}}, ctx)` + `configure` |
| `GET /api/conversations/:id/snapshot` | 全量视图（重连/晚加入用） | viewState() 当前值裁剪：entries + live + inbox + agent + usage |
| `POST /api/conversations/:id/messages` | 发消息 | `{content, mode: "input"|"steer", requestId?}` → `{submissionId}`。内部：`submit({type:"input", content, whenBusy: mode==="steer"?"steer":undefined, requestId})` |
| `POST /api/conversations/:id/abort` | 停止 | `conversation.abort(ctx)` |
| `POST /api/conversations/:id/compact` | 手动压缩 | `{instructions?}` |
| `POST /api/conversations/:id/configure` | 改 agent | `{model?, cwd?, envId?, instructions?}` 透传 configure |
| `POST /api/conversations/:id/fork` | 分叉 | `{entryId}` → `{id}`（新会话） |
| `POST /api/confirmations/:confirmId` | 回答拦截 | `{approved: bool, note?}`（见 §5） |
| `GET /api/executors` | M4 | `[{envId, online, lastSeen}]` |

错误约定：非 2xx + `{error: {code, message}}`；`ConversationBusy` → `409`。

## 4. WebSocket 设计（/ws）

**一个客户端一条 WS**。连接后第一条服务端消息是 `hello`，随后客户端 `attach` 到 N 个会话（订阅模型），此后服务端按会话推事件。

### 服务端 → 客户端（事件帧）

```
{ "t": "hello",   "serverId": "...", "proto": 1 }
{ "t": "snapshot","conv": "<id>", "entries": [...], "live": {...}, "inbox": [...], "agent": {...} }   // attach 应答或重连补偿
{ "t": "events",  "conv": "<id>", "events": [ ...watchEvents 的事件数组... ] }                        // 增量
{ "t": "conv_status", "conv": "<id>", "status": "running"|"idle" }                                    // 列表页
{ "t": "confirmation", "conv": "<id>", "confirm": {...} }                                             // US-05
{ "t": "pong" }
```

事件内容直接转发 watchEvents 产物（message_start/message_update/tool_execution_start/tool_execution_end/compaction_* 等），**但经 events.ts 裁剪层**：去掉超大字段（如超长 partial 建议只传 delta——watchEvents 本身就是 delta 形态 ✅）、统一 entry 引用 id。

### 客户端 → 服务端（命令帧）

```
{ "t": "attach",    "conv": "<id>" }
{ "t": "detach",    "conv": "<id>" }
{ "t": "ping" }
```

（发消息等操作走 HTTP，不走 WS——REST 的幂等和错误语义更清晰；WS 只做只读流 + 轻命令。）

### 连接管理

- 服务端维护 `Map<convId, Set<wsClient>>`；watchEvents 每会话**只开一个**（`watchEvents(harness, convId, ctx)`），事件扇出到 attach 的客户端
- 客户端断开：从所有 Set 移除；某会话无订阅者时 dispose 该 watchEvents 流（省资源）
- 心跳：应用层 ping/pong 20s 间隔，40s 无 pong 断开
- 断线重连（客户端侧）：指数退避 1s→2s→…→30s；重连成功后对每个已 attach 会话重取 snapshot（服务端不重放历史 ✅ 官方语义）

## 5. GuardExtension：权限拦截（US-05）

pi-durable 的 hook 机制实现（API 出自 README ✅）：

```ts
const Guard = defineExtension({
  name: "dorahub-guard",
  hooks: [
    hook(ToolTask, {
      beforeTool: async (call, api, ctx) => {
        if (!DANGEROUS.match(call.name, call.arguments)) return undefined;   // 放行
        // memo：崩溃重启后不再重复询问（README 的 approval 模式）
        let decision = await api.memo<boolean>(`guard:${call.id}`, ctx);
        if (decision === undefined) {
          const confirmId = await pushConfirmationToClients(call);           // WS confirmation 帧
          decision = await waitForUserDecision(confirmId, 10 * 60_000);      // 超时=拒绝
          await api.memo(`guard:${call.id}`, decision, ctx);
        }
        return decision ? undefined : { block: "用户拒绝了该操作" };
      },
    }),
  ],
});
```

`DANGEROUS` 规则（v1 简单版）：bash 命令正则匹配 `rm -rf|git push --force|shutdown|mkfs|:(){` 等 + write/edit 目标在 cwd 之外 + 一切自定义 task 工具。规则外置成 `guard-rules.json`，可热改。

**pending confirmations 存内存队列 + 快照接口**：`GET /api/confirmations`（客户端重连后拉取漏掉的确认请求）。hub 重启即清空（memo 保证重启后重新询问，不误放行）。

## 6. 启动序列（index.ts 伪码）

```ts
const harness = await startHarness("/var/lib/dorahub/agent.sqlite");
const execRegistry = new ExecRegistry();            // M4
const server = http.createServer(router(harness, execRegistry));
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, sock, head) => { /* /ws → wss.handleUpgrade */ });
server.listen(8787, "127.0.0.1");                   // 永远只听本地，见 03
audit.log("boot", { version, pid: process.pid });
// 优雅退出：SIGTERM → hub 客户端发 bye → harness.close(context) → exit
```

## 7. systemd 单元

```ini
# /etc/systemd/system/dorahub.service
[Unit]
Description=DoraHub agent server
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=dorahub
EnvironmentFile=/etc/dorahub/env          # ZJL_BASE_URL / ZJL_API_KEY（0600 root）
WorkingDirectory=/opt/dorahub
ExecStart=/usr/bin/node dist/server/index.js
StateDirectory=dorahub                    # /var/lib/dorahub
Restart=always
RestartSec=3
# 崩溃恢复的关键就是这两行 + harness.resume()
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now dorahub
journalctl -u dorahub -f                   # 实时日志
```

## 8. 审计日志

`/var/lib/dorahub/audit.jsonl`（append-only，一行一 JSON）：`{ts, event: boot|connect|submit|steer|abort|confirmation|tool_blocked, conv, client, detail}`。工具级审计不需要单独做——pi-durable 的 transcript 本身就是全量审计（每个 tool call 的 intent 先落盘再执行 ✅）。

## 9. 安全清单

- [ ] server 只听 `127.0.0.1`（serve 转发是唯一入口）
- [ ] API key 走 EnvironmentFile，不进 git 不进代码
- [ ] SQLite 与 audit 属主 dorahub:0600
- [ ] 模式 B（funnel）开启时 token 中间件强制启用（auth.ts），否则 500 拒绝启动（fail-closed）
- [ ] WS 帧大小上限 1MiB；消息长度上限 64KiB
- [ ] systemd 加 `ProtectSystem=strict` + `ReadWritePaths=/var/lib/dorahub`（M5 收紧）
