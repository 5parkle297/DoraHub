# 00 · 背景调研与决策记录

> 本文沉淀全部调研结论。事实清单的来源：pi-durable 官方博文（earendil.com/posts/pi-durable/）与 npm README（@earendil-works/pi-durable），抓取日期 **2026-10-16**；Paseo 官网/架构文档（github.com/getpaseo/paseo）；Tailscale 官方文档（tailscale.com/kb/1242 等）。均为一手来源全文阅读，非搜索摘要。

## 1. 痛点（为什么要做）

用户有三台常用设备：工作电脑（`workpc`，主力开发）、移动电脑（`laptop`）、手机（`phone`）。当前跨设备协作 agent 任务的方式是：在一台设备上让 pi 会话产出 md 总结 → 拷到另一台设备 → 让那边的 pi agent 阅读理解再继续。痛点：

1. **会话不连续**：上下文靠人工搬运，每次交接有信息损耗
2. **任务状态不可见**：离开工位后不知道 agent 跑到哪了
3. **无法远程干预**：agent 在工作电脑上跑长任务，人在外面只能干等
4. **崩溃即损失**：进程挂了，跑到一半的调查现场要靠人工恢复

目标形态：会话状态集中在常开的 VM 上，任何设备随时接入同一会话；运行中可插话转向；崩溃自动断点续跑；工具执行可路由到指定电脑。

## 2. pi-durable 是什么（已验证事实 ✅）

来源：官方博文 + npm README 全文。

### 2.1 定位

- 独立 npm 包：`@earendil-works/pi-durable`，依赖 `@earendil-works/pi-ai`（模型接入）和 `@earendil-works/chord`（文档状态）。安装命令：`npm install @earendil-works/pi-durable @earendil-works/pi-ai @earendil-works/chord`
- **它是库不是服务**：不带任何网络传输层。官方架构原话："One process owns a storage at a time, and other clients attach to that process"——多端访问 = 中心进程 + 客户端 attach，**socket 要自己搭**
- **实验性**：npm 页面明确 "Experimental. The API changes without notice between releases"
- 体量小：全部源码（不含测试）约 15,000 行，agent 可通读
- **它不接管 pi 编码代理（TUI）的会话**。pi TUI 的会话在 `~/.pi/agent/sessions/*.jsonl`，是另一套存储。本项目是"在 pi-durable 上自建一个 agent 平台"，不是"给 pi TUI 加云同步"

### 2.2 核心 API（本项目会用到的，全部出自 README）

```ts
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { createRegistry, Harness, watchEvents } from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const context = BACKGROUND_CONTEXT;
const models = createModels();
models.setProvider(openaiProvider()); // 读 OPENAI_API_KEY

const registry = createRegistry();
registry.install(CodingTools); // read / write / edit / bash

const env = ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? process.cwd() });
const harness = await Harness.open(
  await openNodeSqliteStorage("./agent.sqlite"),
  { models, registry, env },
  context,
);
const root = await harness.root(context, {
  agent: { model: { provider: "openai", modelId: "gpt-6.1-sol" }, cwd: "/work/repo" },
);
harness.resume(); // 启动任务调度器，续跑上次未完成的 run
```

**会话（Conversation）与提交（Submission）**：

- `harness.root(context, {agent})` — 根会话，重启后同一个
- `harness.createConversation({ownership}, context)` / `root.fork(entryId, {ownership}, context)` — 新会话 / 在任意点分叉
- `conversation.submit({ type: "input", content, requestId, whenBusy }, context)` — 提交输入，返回 Submission；`whenBusy: "steer"`（插进当前工具轮之后加入运行中的工作）/"follow-up"（默认，排队到本轮结束后）/ "reject"（忙则抛 ConversationBusy）
- `submission.wait(context)` — 等到 done / unanswered
- `submission.abort(context)` — 撤回排队中的提交
- `conversation.abort(context)` — 停止会话：撤回排队输入、abort 所有当前任务
- `conversation.configure({ model, thinkingLevel, extensions, tools, modelTools, instructions, cwd }, context)` — 按会话改 agent 配置（null 清回宿主默认）
- `conversation.compact(instructions?, context)` — 手动压缩；`conversation.reset(note?, context)` — 换新上下文，可选 handoff note，旧消息保留可搜
- `requestId` 幂等：崩溃后用同一 requestId 重新 submit，拿回原 submission 而不是提交两次

**多端观看（Multiplayer）——本项目的核心依赖**：

- `conversation.viewState(context)` → `{ value, subscribe }`：结构性只读视图，含 `value.entries`（当前 transcript）、`docs["pi.live"]`（流式中的生成、工具调用及输出）、`docs["pi.inbox"]`（排队消息）、`docs["pi.agent"]`、`docs["pi.usage"]`
- `conversation.watch(context)` → `watch.value` + `watch.start(async (value, ops) => send(ops))`：每次 commit 的**精确 Chord 操作**，官方原话 "small enough to send over a socket"。慢消费者最多积压 100 帧，之后合并为一帧全量视图。晚加入/重连的客户端从当前视图开始，**不重放历史**
- `watchEvents(harness, conversationId, context)`（实验性）→ `stream.snapshot` + `stream.start(events => ...)`：把 commit 转成编码代理风格事件（`message_start` / `message_update`（文本与 thinking 增量、工具参数增量）/ `tool_execution_start` …），一批 commit 一批事件；落后超过 100 批收到全新 snapshot。完整示例：仓库 `test/examples/19-json.ts`

**崩溃恢复**：

- 每步 run 都是 task，执行前存 checkpoint。新进程打开同一 storage → `harness.resume()` 从断点继续
- 工具声明 `replay: "safe"`（如只读搜索）才会在崩溃后重跑，否则模型收到 "interrupted" 错误
- codemode 脚本也能续跑：沙箱确定性执行（虚拟时钟/种子随机）+ 结果 journal，重启后重放已完成的调用、从断点继续

**执行环境（ExecutionEnv）——分布式执行的关键**：

- `env` 函数按会话 cwd 构建执行环境：`env: ({cwd}) => ...`。官方明确支持"harness 跑在一台机器、工具跑在另一台机器"
- 接口面小：`exec(argv数组, {onOutput, signal, timeout})`（无 shell 直 exec）、`openBinaryReader()`（字节范围读）、`openDirReader()`（分页列目录）、`cleanup()`、可选 `listFiles()`
- 自定义环境必须设 `id`："equal ids see the same files at the same paths"
- ⚠️ 待验证：博文提到 "pi-env's `RemoteExecutionEnv` and `LocalExecutionEnv`" 实现了 `listFiles()`——即 Pi monorepo 里可能已有 `@earendil-works/pi-env` 包。实施 M4 前先 `npm view @earendil-works/pi-env`，若已发布评估直接采用；未发布则按 07 号文档自研（接口面小，工作量可控）

**扩展机制**：`defineExtension({ name, sections, tools, hooks, wraps, tasks })`；`section("name", input => 文本)`（每次请求前重渲染，只有变更部分重发以保 prompt cache）；`hook(ToolTask, { beforeTool, afterTool })`、`hook(GenerationTask, { beforeRequest, afterResponse, onYield, afterTools })`；`defineDoc({kind, version, scope, history, fork, initial})` 定义持久化应用状态文档，与 transcript 同一原子提交

**settings**（每次使用时读取、永不存储，可用 getter 做成活的）：`progress: {partialIntervalMs: 100, outputIntervalMs: 100}`（流式提交频率，远程存储可调低如 500）、`toolExecution: "parallel"`、`compaction: {enabled, reserveTokens, keepRecentTokens, backgroundTokens}`、`contextRetentionMs`

**子代理**：无内建，但官方展示了用 tool + `api.commit()` + `tx.createConversation({ownership:{kind:"task",taskId}})` 十几行搭出；示例 `22-subagent-foreground.ts` / `23-subagent-background.ts`

## 3. Paseo 是什么（已验证 ✅，选型对照物）

来源：paseo.sh + github.com/getpaseo/paseo（README / docs/architecture.md / docs/glossary.md / docs/providers.md）。

- 开源（21k stars，单人全职维护，拒绝融资）、免费。客户端：macOS/Windows/Linux 桌面 + **iOS/Android 原生** + Web + CLI
- 架构：daemon 管理本机 agent 进程，客户端多 host 连接（`HostRuntimeController` 管理 saved host 连接；"connects to one or more daemons"）；README 明说 "Run many agents at once, each in its own worktree, **on one machine or several**"
- **Pi 是一级 provider**：走 `pi --mode rpc`，支持原生 `steer` RPC、`clear_queue`+abort、桥接 Pi 扩展 UI 弹窗、权限确认推到手机、可导入现有 pi JSONL 会话续聊（`Pi import discovery reads Pi's persisted JSONL session files`）
- 远程接入三通道：E2E 加密 relay（官方中继，零知识）/ 直连 TCP / 自建隧道（文档点名 Tailscale）
- **结构性欠缺（正是本项目差异化所在）**：无 durability（daemon 死则 agent 死，无任务级断点续跑/幂等重放）；无集中存储（会话留在各自机器，它是"多机遥控器"不是"云大脑"）

**结论：Paseo 是好产品，但它是"用"出来的技能，不是"造"出来的项目。本项目目标包含简历价值，故不采用（见 ADR-001）。它保留一个用途：如果自建烂尾，退回 Paseo 满足日常真实需求，五分钟装完。**

## 4. Tailscale 关键事实（已验证 ✅）

来源：tailscale.com 定价页 / kb/1242 (serve) / kb/1247 (funnel) / github.com/tailscale/tailscale / github.com/juanfont/headscale。

- 基于 WireGuard 的 overlay 网络；打洞成功则 P2P 直连，失败回退 DERP 中继
- **免费个人版**：6 用户、**设备数不限**、MagicDNS、subnet router、ACL（3 组）够用
- **`tailscale serve`**：把本机 `127.0.0.1` 上的 HTTP 服务以 `https://<机器名>.<tailnet>.ts.net` 暴露给 tailnet 内设备，**自动 provision TLS 证书**，支持 WebSocket。命令：`tailscale serve --bg localhost:8787`。这意味着 hub 服务**零公网暴露、零证书管理、零防火墙开洞**
- **`tailscale funnel`**：进一步暴露到公网（443/8443/10000 端口），固定域名。本项目手机接入的模式 B 用（见 03）
- **MagicDNS**：设备名即域名（`hub`、`workpc`…）
- **Tailscale SSH**：tailnet 内免密钥 SSH
- **tsnet**：把 tailnet 嵌进自己程序的库（userspace WireGuard，无需 root），进阶可选
- **headscale**：开源自托管控制服务器（Tailscale 有员工参与维护，定位 single tailnet 自托管）；derper 可自建中继。控制面完全自托管 = M5 加分项
- 客户端开源情况：`tailscaled` + CLI 全开源；Windows/macOS/iOS GUI 壳不开源但免费
- 国内现实：用户已有 v2ray 解决控制面（login.tailscale.com）可达性；数据面直连或 DERP 中继——中继在海外时慢，自建 derper 是解法（M5）

## 5. 决策记录（ADR）

### ADR-001：自建（Tailscale + pi-durable），不采用 Paseo
- **背景**：用户目标是"堆砌经验让简历好看"，而非纯实用
- **决策**：自建。Paseo 在简历上是一行用户技能（"使用 Paseo 管理多设备 agent"），自建是一个有架构、有难点、有取舍的完整项目
- **代价**：移动端体验不如原生 app；开发周期数周
- **兜底**：烂尾则退回 Paseo 满足日常需求

### ADR-002：hub 中心架构，不做 P2P 对等同步
- **理由**：pi-durable 的存储模型就是"单进程拥有 storage，其他客户端 attach"，官方架构即如此；P2P 会话同步（CRDT/向量时钟）是另一个数量级的难题，超出本项目范围
- **含义**：hub（VM）是唯一单点。接受它：VM 常开 + SQLite 落盘 + systemd 自动重启 + `harness.resume()`

### ADR-003：客户端形态 = PWA，不做原生 app / Electron
- **理由**：需求（会话列表、聊天、流式、steer、确认按钮）PWA 全覆盖；原生 = 两套代码 + 开发者账号 + 上架流程；升级路径（Capacitor 包壳）不锁死
- **代价**：iOS 推送需 iOS 16.4+ 且配置 Web Push（可选加分项）；无后台同步

### ADR-004：同步协议 v1 用 `watchEvents()` 事件流，不用 `watch()` ops
- **理由**：watchEvents 是编码代理风格事件（message_update 带文本增量），聊天 UI 直接能吃；有官方完整示例（19-json.ts）；实现简单。watch() 的 Chord ops 带宽最优但要求客户端跑 chord 库（浏览器兼容 ⚠️ 待验证），且需要自己维护 ops 应用逻辑
- **代价**：字节量更大。单用户场景可接受；`settings.progress` 可调低提交频率
- **v2 展望**：带宽成为瓶颈时切 watch() ops（协议设计留了版本字段）

### ADR-005：执行路由 = 自定义 ExecutionEnv（exec-agent 模式），不在每台机器跑完整 harness
- **理由**：保持"会话在云、手脚在端"——状态单点在 hub，workpc/laptop 只跑一个几百行的执行代理；pi-durable 的 env 接口面小（exec/读/列/清理），自研可控
- **前置动作**：M4 前先验证 `@earendil-works/pi-env` 是否已发布（可能已有现成 RemoteExecutionEnv）

### ADR-006：hub 部署在 CentOS VM（15.208.253.20）
- **理由**：常开、已纳入日常运维（SSH MCP）、有公网可达性（v2ray 已解决出口）
- **含义**：本项目的"云"就是这台 VM；若未来换云主机，只需迁移 SQLite 文件 + 装 tailscale

### ADR-007：认证模型 = tailnet 边界（主）+ 应用 token（Funnel 模式必开）
- **理由**：能进 tailnet 的设备就是合法客户端，不自建用户系统（省掉最无聊最易错的 30% 代码）；serve 模式下服务只听 127.0.0.1，攻击面收敛到 tailnet 成员
- **Funnel 模式**（手机不开 Tailscale 时）：公网可达，**必须**叠加应用层 token

### ADR-008：不迁移、不接管 pi TUI 旧会话（`~/.pi/agent/sessions/*.jsonl`）
- **理由**：两套存储模型不同，强行桥接（解析 JSONL 重放进 durable conversation）工作量大、收益边际
- **含义**：日常 pi TUI 用法不变；DuraHub 是新建的独立平台。旧会话导入器列为 M5 可选加分项（JSONL 格式有官方文档 session-format.md，技术可行）

## 6. 待验证项汇总（⚠️ 动手前先跑，结果回写本文档）

| 编号 | 事项 | 验证方法 | 影响的里程碑 | 状态 |
|---|---|---|---|---|
| V-01 | `@earendil-works/pi-env` 是否已发布（RemoteExecutionEnv） | `npm view @earendil-works/pi-env` | M4 | ✅ 已发布，1.2.0（2026-10-16，workpc 验证）。实施时读其 .d.ts 评估 RemoteExecutionEnv 是否直接可用 |
| V-02 | pi-ai 如何接自定义 OpenAI 兼容端点（用户现有 zjl 中转，跑 glm/grok 等模型） | 读 `node_modules/@earendil-works/pi-ai/README.md`（workpc 上装完 pi 后）+ 看 `openaiProvider()` 是否接受 baseURL/key 配置 | M1 | ✅ 已验证（2026-10-16，workpc，pi-ai 1.2.0）：`createProvider({id, baseUrl, auth:{apiKey:{resolve}}, models, api:{"openai-completions":{stream,streamSimple}}})` + `models.setProvider()`。**坑：model 定义必须带 `baseUrl` 字段（compat 自动检测在 model 层读它，缺失则 `model.baseUrl.includes` 崩）；model.cost 四字段（input/output/cacheRead/cacheWrite）必填，缺了 calculateCost 算出 NaN，chord 严格 JSON 提交时报 "non-finite number" 错**。详见 packages/server/src/zjl-provider.ts。可用模型：grok-4.7（日常默认）、k3；zjl 的 glm-5.3/flash 网关未开通（providers.md 结论），故 04 号文档里的默认模型从 glm 改为 grok-4.7 |
| V-03 | `@earendil-works/chord` 是否能在浏览器跑（决定 v2 协议） | `npm i @earendil-works/chord` 后在 vite 项目 import 试打包 | M5/v2 | ⚠️ 未验证 |
| V-04 | workpc 上 WSL2 与 Tailscale 的最佳组合（三方案见 08 §3） | 按 08 §3 逐个试，记录可用方案 | M4 | ⚠️ 未验证 |
| V-05 | `tailscale serve` 转发时是否带请求方身份头（如 `Tailscale-User-Login`） | hub serve 一个 echo 头的服务，从 phone curl 看 | M2（可选，仅影响审计日志） | ⚠️ 未验证 |
| V-06 | iOS/Android 上 Tailscale 与 v2ray 客户端的 VPN 槽位冲突情况（iOS 一次只能一个 VPN profile active） | 手机实测：开 Tailscale 时 v2ray 是否还能用（Android 部分客户端有非 VPN 代理模式） | M0（决定 phone 用模式 A 还是 B） | ⚠️ 未验证（需手机手动测试，见会话末待确认项） |
