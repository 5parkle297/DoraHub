# DoraHub 前端交接文档（给下一个会话）

> 写于 2026-10-16。本文是"专门改前端"会话的唯一入口文档。先读本文，再按需读引用文件。
> 后端（hub server）**不要动**——它已部署在生产（https://hub.tail242752.ts.net）且验收通过。你的任务是让前端配得上这个后端。

## 0. 一句话背景

DuraHub→DoraHub：跨设备持久化 agent 平台。会话状态住云端 hub（阿里云 Ubuntu，pi-durable + SQLite），任何设备浏览器接入同一会话；流式输出、steer 插话、崩溃恢复、权限确认、多渠道模型切换。**M1-M3 里程碑已完成，M4 代码就绪待实机验证**。前端目前是"能用但丑"的毛坯房。

## 1. 必读文件（按顺序）

| 文件 | 内容 |
|---|---|
| `design/README.md` + `design/00-*.md` | 项目全貌、ADR 决策记录（前端相关：ADR-003 PWA 形态、ADR-004 事件流协议） |
| **`design/06-web-client.md`** | **前端设计规范**——注意里面很多规划没实现（diff 组件、增量 markdown、虚拟列表、degraded 轮询），那就是你的 backlog |
| `packages/shared/src/index.ts` | 协议单一定义源（HTTP 类型 + WS 帧） |
| `packages/web/src/` | 现有前端全部代码（见 §4） |
| `docs/deployment-log.md` | 部署实录（怎么发版到云端） |
| 本文档 | 现状 + 坑 + backlog |

## 2. 开发环境（workpc，Windows）

```bash
# 终端 1：server（127.0.0.1:8787）
# key 从 C:/Users/shiyu/.pi/agent/models.json 的 providers 里取（zjl / zhipu-glm-trial / zhipu-glm-coding-plan）
cd D:/hobby/pi-durable
ZJL_BASE_URL=https://zjl-oneapi.vul337.team:8443/v1 \
ZJL_API_KEY=<models.json 里 zjl.apiKey> \
ZHIPU_TRIAL_KEY=<zhipu-glm-trial.apiKey> \
ZHIPU_PLAN_KEY=<zhipu-glm-coding-plan.apiKey> \
DORAHUB_DB=./dev.sqlite DORAHUB_CWD=$PWD \
node packages/server/dist/index.js

# 终端 2：vite dev（:5173，proxy /api 和 /ws 到 8787）——改前端用这个，热更新
npm run dev:web
# 浏览器开 http://127.0.0.1:5173
```

- server 改动后要 `node packages/server/build.mjs` 重建 dist 再重启（esbuild）
- 前端构建：`npm run build -w packages/web` → 产物 `packages/web/dist/`，server 会托管它
- 类型检查：`cd packages/web && npx tsc -b --noCheck`；server：`cd packages/server && npx tsc --noEmit`
- 真实模型会花钱：测试用 glm-5.3-flash（智谱 trial 渠道）最便宜，但注意智谱直连**响应偏慢**（1-2 分钟，免费档限速，不是 bug）
- git：repo 在 `D:/hobby/pi-durable`，remote = github.com/5parkle297/DoraHub（main）。commit 用 `git -c user.name="shiyu" -c user.email="shiyu@local"`

## 3. 后端 API 与协议（已稳定，直接消费）

### HTTP（全部 JSON，snake-free 小写驼峰）

| 方法 路径 | 用途 | 备注 |
|---|---|---|
| GET `/api/health` | 探针 | |
| GET `/api/models` | 渠道目录 | `[{id,name,models:[{id,name,reasoning,thinkingLevels[]}]}]`，三渠道：zjl/trial/plan |
| GET `/api/conversations` | 会话列表 | `[{id,name,status,model,cwd,updatedAt,lastPreview}]`（model/cwd 目前恒 null，TODO） |
| POST `/api/conversations` | 创建 | body `{name?, cwd?, model?, envId?}`；model 格式 `"provider:modelId"`（如 `"trial:glm-5.3-flash"`） |
| GET `/api/conversations/:id/snapshot` | 全量快照 | 重连/晚加入用它重建（服务端不重放历史） |
| POST `/api/conversations/:id/messages` | 发消息 | body `{content, mode:"input"|"steer", requestId?}`；requestId 幂等 |
| POST `/api/conversations/:id/abort` | 中止 | |
| POST `/api/conversations/:id/configure` | 改配置 | body `{model?:{provider,modelId}, thinkingLevel?, cwd?, instructions?, name?, envId?}` |
| POST `/api/conversations/:id/fork` | 分叉 | body `{entryId?}` 缺省=最新 |
| GET `/api/confirmations` | 待确认列表 | |
| POST `/api/confirmations/:id` | 回答 | body `{approved:bool}` |
| GET `/api/executors` | 执行机 | M4：hub 本地 + 配置的远程机 |

### WebSocket `/ws`

- 连接后服务端发 `{t:"hello",serverId,proto:1}`；客户端发 `{t:"attach",conv}` 订阅，服务端回 `{t:"snapshot",conv,snapshot}`，之后推 `{t:"events",conv,events[]}`
- 其他服务端帧：`conv_status`（running/idle 广播给所有人）、`confirmation`/`confirm_resolved`、`pong`、`bye`、`error`
- 客户端帧：`attach`/`detach`/`ping`
- 心跳：server 20s ping / 40s 无 pong 踢；客户端指数退避重连（1s→30s），重连成功后**重拉 snapshot**（ws.ts 已实现）

### 事件流（events[] 里的事件类型 = pi-durable watchEvents 透传）

`snapshot / run_start / run_end / turn_start / turn_end / message_start / message_update / message_end / tool_execution_start / tool_execution_update / tool_execution_end / inbox_update / submission / entry_appended / agent_changed / usage_changed / auto_retry_start / auto_retry_end / deferred_poll / task_failed / compaction_start / compaction_end`

**⚠️ entry 数据结构（本会话踩过的大坑，.d.ts 之外的事实）**：

```
pi.user:        { model: [{ role:"user", content: "字符串", ... }], kind, id, ... }
pi.assistant:   { model: [{ role:"assistant", content: [blocks], stopReason, errorMessage?, ... }] }
                 blocks: {type:"text",text} | {type:"thinking",thinking} | {type:"toolCall",id,name,arguments}
pi.tool-result: { model: [{ role:"toolResult", toolCallId, toolName, content:[{type:"text",text}], isError, durationMs }], data:{diagnostics} }
pi.system:      工具声明等，UI 可忽略
```

- 内容在 **`model[0]`**，不是 `data` 字段！
- 渠道错误（401/限流）最终落成 `stopReason:"error"` + `errorMessage` 的 assistant entry → 前端红色警告条就是这么触发的
- message_update 的 changes：`text_delta/thinking_delta`（追加）、`toolcall_start/toolcall_delta`（参数流式累积）

## 4. 前端现状（packages/web/src/）

```
main.tsx              # 入口 + SW 注册
App.tsx               # connbar（连接状态条）+ 路由分发 + degraded 5s 轮询
route.ts              # 手写 hash 路由：#/conversations、#/conversations/:id
ws.ts                 # WS 单例类：状态机 connecting/syncing/live/degraded/error，重连，attach 重放
api.ts                # fetch 封装（token 注入预留，localStorage 'durahub.token'）
state/conn.tsx        # AppProvider（连接状态 context）
state/conv.ts         # ★ 核心 reducer：applySnapshot / applyEvents / pushEntry（entry 结构在这里）
pages/Conversations.tsx  # 列表页 + 新建弹窗 + running 徽章
pages/Conversation.tsx   # 会话页：快照→事件→渲染；确认卡；inbox 条；警告条；ModelPicker
components/
  MessageBubble.tsx   # 气泡 + thinking 折叠 + 工具卡挂载
  ToolCard.tsx        # bash/read/write/edit 分型标题 + 流式输出（没做 diff）
  Composer.tsx        # 输入区 + steer 开关 + 发送
  ConfirmationCard.tsx # 权限确认（允许/拒绝）
  Inbox.tsx           # 排队消息条
  ModelPicker.tsx     # 渠道→模型→思考强度三级 chips 弹窗（configure 即时生效）
style.css             # 手写深色主题（全部样式都在这一个文件）
```

状态管理无全局库：每会话一个 reducer（`state/conv.ts`），WS 单例订阅挂在页面组件里。**这个架构本身没问题，别推翻**（ADR：事件流就是状态机）。

React 18.3 + Vite 6 + TS，**无 UI 组件库**（当初的决策是"简历叙事是自建平台"，但你可以重新提案引入轻量方案——改 ADR-010 记录即可，见 design/00 的 ADR 格式）。

## 5. 已知问题 / 丑点清单（按用户视角排序）

### 视觉（用户原话："太丑了"）
- [ ] 整体没有设计语言：字体层级、间距、色彩不成体系；深色主题但对比度没调过
- [ ] 列表页很空：没有图标/时间分组/最后活动相对时间（"3 分钟前"）
- [ ] 会话页 header 信息密度低，model-tag 像调试信息

### 功能缺口（design/06 里规划了但没做）
- [ ] **markdown 渲染**：msg-text 现在是纯文本 `pre-wrap`！代码块/列表/链接全是原文。规划是"增量段落渲染"（每消息维护已完结段落+当前段落 buffer，防全量重解析）
- [ ] **edit 工具的 diff 视图**：ToolCard 只显示 JSON args 和输出。design 06 §6 要求两栏 diff（自己写或用库，讲清取舍）
- [ ] **usage/cost 面板**：usage_changed 事件已在 reducer 里，没展示（tokens/渠道统计）
- [ ] **compaction 提示**："历史已压缩"标记（compaction_start/end 事件）
- [ ] **fork 选点**：只能在最新 entry fork；规划是消息上选任意点分叉
- [ ] **虚拟列表**：entries 过千的性能（react-window 或自写）
- [ ] **会话配置编辑**：cwd / instructions 没有编辑 UI（configure API 已支持）
- [ ] **degraded 模式完善**：WS 断但 HTTP 可用时 5s 轮询只有列表页 tick，会话页没兜底
- [ ] thinking 展示太素：流式中没有"思考中"动效区分

### 交互/移动端
- [ ] 输入框自动增高（现在是 max-height 固定）
- [ ] 虚拟键盘弹出时 visualViewport 适配（design 06 §5）
- [ ] 长按/滑动手势（touch-action 处理）
- [ ] 桌面端宽屏布局（>768px 列表常驻左栏，design 06 §5 说的两栏）
- [ ] 图片消息展示（read 工具返回图片时——zjl grok-4.7 支持读图，input 含 image 的模型）

### PWA
- [ ] manifest 图标只有 SVG（iOS 添加主屏需要 PNG 192/512）
- [ ] Web Push（M5 项，iOS 16.4+）：渠道挂掉时手机推送红警告——用户明确表达过这个需求

## 6. 坑清单（本会话踩过的，别再踩）

1. **sw.js v2 缓存策略**：只缓存带 hash 的资产，导航/HTML 永不缓存。改前端后浏览器验证要**关 tab 重开**（同 URL 的 hash 导航不触发 reload）；开发时用 vite dev server 避开一切缓存问题
2. **entry 内容在 `model[0]`**，不在 `data`（§3 已详述）
3. **Windows curl 发中文会 GBK 乱码**（模型会收到乱码并吐槽）：测中文用浏览器或 python（`python -X utf8`）
4. **React 受控组件自动化测试**：直接设 `.value` 不触发 onChange，要用 native setter + dispatchEvent（browser-eval 里已有现成模式，见下）
5. browser-tools skill 的 `browser-nav.js --new` 可能复用已有同 URL tab 不刷新——要验证新版本加载时先 `curl -s <origin>/ | grep index-` 对比页面里 `[...document.scripts].map(s=>s.src)`；Chrome 调试端口 9222 的启动命令：`"C:/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:/Users/shiyu/.cache/browser-tools/profile" --no-first-run about:blank`（skill 的 browser-start.js 在 Windows 上有 mkdir -p bug）
6. server 静态托管路径：源码运行 vs dist 运行探测两个候选（index.ts 里 webDistCandidates），别只改一边
7. 智谱直连慢（1-2 分钟）是常态；zjl grok-4.7 快，日常测试用它

## 7. 验收基线（改完后这些必须仍然通过）

- **S1 双设备**：两个 tab 同会话，一边发消息另一边实时流式渲染，历史一致
- **S2 steer**：长任务中 steer 开关发消息 → inbox 显示排队 → 当前轮后生效
- **S3 确认**：发"用 bash 执行 git push origin main"（guard alwaysAsk 规则命中）→ 红边确认卡 → 拒绝后工具显示 ✗、agent 收到 block
- **S4 重连**：kill server → 红条 → 重启后 30s 内自动回绿 + snapshot 重建
- **渠道切换**：⚙ 切 trial:glm-5.3-flash → model-tag 更新 → 发消息由新渠道回复
- **渠道故障**：坏 key server 上发消息 → 红色警告条显示 401
- `node --experimental-strip-types scripts/ws-test.ts`（15 项，需 server 在 8787）

## 8. 发版到云端（改完满意后）

```bash
# workpc 上：
git add -A && git commit -m "..." && git push origin main
# hub 不能直连 GitHub（TLS 干扰），用打包直推：
cd D:/hobby/pi-durable
git archive --format=tar.gz -o dorahub-src.tar.gz HEAD
python -c "import paramiko..." # 或者直接用 scripts/hub.py 的模式 SFTP 上传
python scripts/hub.py "systemctl stop dorahub && rm -rf /opt/dorahub/* && tar -xzf /tmp/dorahub-src.tar.gz -C /opt/dorahub && chown -R dorahub:dorahub /opt/dorahub && cp /opt/dorahub/deploy/dorahub.service /etc/systemd/system/ && cd /opt/dorahub && sudo -u dorahub npm ci --no-audit --no-fund && sudo -u dorahub npm run build && systemctl start dorahub && sleep 4 && curl -s http://127.0.0.1:8787/api/health"
```

凭据在 `C:/Users/shiyu/.dorahub/hub.env`（root 密码，不入 git）。云端地址 https://hub.tail242752.ts.net 。**手机端验证记得关 tab 重开**（SW 更新）。

## 9. 给你的自由度

- 设计语言全权委托给你：可以引 tailwind/组件库/动效，但**记录 ADR-010** 说明取舍（原 ADR-003 说"不引 UI 库"是简历叙事考虑，如果你认为引入更合理就推翻它，写清理由）
- 可以加依赖，但 pi-* 生态包版本锁死不动（@earendil-works/* 全部精确版本，ADR 纪律）
- 后端 API 想加字段（如 conversations 列表返回 model/cwd）可以提，小改动可以做，大改（协议变更）先改 design/05
- 优化 reducer/组件结构随意，保持"事件流驱动 + snapshot 全量替换"语义
