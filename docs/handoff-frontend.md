# DoraHub 交接文档 v2（给下一个前端/全栈会话）

> 写于 2026-10-17 深夜，全面重写（v1 的过时内容已清理）。本文是唯一入口文档：先读完本文再动手。
> **历史成果速览**：M0-M4 全部完成并上线——设计系统 v2（暖纸浅色）、自动会话命名、三执行机远程执行（workpc/laptop/hub）、跨机工作区迁移、pi CLI 会话管理中心（导入/删除/搬运）、`/model` 式模型选择器。线上 https://hub.tail242752.ts.net 。
> **本文档结构**：§1 怎么跑起来 → §2 系统现状全景 → §3 API/协议速查（含大坑）→ §4 代码地图 → §5 backlog（按优先级）→ §6 坑清单 → §7 验收基线 → §8 发版流程 → §9 自由度与规划建议。

## 1. 开发环境（workpc，Windows）

```bash
# 终端 1：server（127.0.0.1:8787）
cd D:/hobby/pi-durable
bash dev-server.sh    # key/executors 环境变量都在里面了（读 ~/.pi/agent/models.json 配好）
# 前置：先 node packages/server/build.mjs 重建 dist

# 终端 2：前端热更新
npm run dev:web       # vite dev :5173，proxy /api /ws → 8787
```

- ⚠️ **本地 dev 的 SSH 到 workpc/laptop 会失败**（dev key 未放进 administrators_authorized_keys）。修法：管理员 PowerShell 跑
  `Add-Content -Path C:\ProgramData\ssh\administrators_authorized_keys -Value "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICQj3ChrURhmPuPK9AdS+/Gage8szI0aqQdTed0VQQ9c dev-dorahub"`
  （公钥在 `.dev-ssh/id_ed25519.pub`，私钥已 gitignore）。不修也行：**执行机相关功能直接在云端测**（云端 key 全通）。
- 类型检查：web `cd packages/web && npx tsc -b --noCheck`；server `cd packages/server && npx tsc --noEmit`
- 测试模型：trial/glm-5.3-flash 免费但慢（1-2 分钟是限速不是 bug）；zjl/grok-4.7 快
- git：`git -c user.name="shiyu" -c user.email="shiyu@local"` commit；remote = github.com/5parkle297/DoraHub（main）
- 回归：`node --experimental-strip-types scripts/ws-test.ts`（15 项，需 server 在 8787）

## 2. 系统现状全景（2026-10-17）

### 用户视角的功能清单（全部已上线）

| 功能 | 状态 | 备注 |
|---|---|---|
| 会话列表：自动命名/描述/关键词 | ✅ | AutoNamer 服务端异步生成，conv_meta 帧实时推送 |
| 按项目分组 + 相对时间 + 执行机徽章 | ✅ | 列表 API 带 model/cwd/envId |
| 免命名新建（选执行机 + 项目路径） | ✅ | 离线机器灰化可选 |
| 会话软删除（卡片 ✕） | ✅ | ConvMetaDoc.hidden，数据保留 |
| `/model` 式模型选择器 | ✅ | 平铺 provider/model + 搜索 + 思考强度，10 个模型与 pi 完全对齐 |
| 执行机切换 + 工作区迁移向导 | ✅ | harvest→中转搬运(50MB/文件,200MB总量)→校准提示预填 composer |
| pi 会话管理中心 | ✅ | 扫描(1条SSH命令+5min缓存)/元数据生成/导入对话/删除/搬运 |
| markdown 渲染 / edit diff / 自动增高 | ✅ | 自写轻量实现（ADR-010） |
| 双设备同步 / steer / 确认卡 / 重连 | ✅ | S1-S4 验收基线 |
| 移动端弹窗（portal 修复）/ 键盘适配 | ✅ | backdrop-filter containing block 大坑见 §6 |

### 执行机（M4，全部实测通过）

| envId | 机器 | 用户 | cwd | shell | 状态 |
|---|---|---|---|---|---|
| hub | 阿里云 VM | - | /opt/dorahub | - | 在线 |
| workpc | cyq（管理台改名 workpc 待办） | shiyu | D:/hobby | D:/EESoftware/Git/usr/bin/bash.exe | 在线 |
| laptop | sh1gure | shigure | F:/group | D:/Software/Git/usr/bin/bash.exe | 按开机 |

链路：hub 出站 SSH（原生 OpenSSH，**Tailscale SSH 不支持 Windows**）→ pi-env daemon 自动部署 → RemoteExecutionEnv（shellPath 钉 Git Bash + shellEnv 注入 PATH）。
密钥：`/etc/dorahub/id_ed25519`（hub），公钥在两台 Windows 的 `C:\ProgramData\ssh\administrators_authorized_keys`（管理员组用户不读 ~/.ssh）。

### 数据与缓存

| 数据 | 位置 | 治理 |
|---|---|---|
| durable 会话 | hub `/var/lib/dorahub/agent.sqlite` | pi-durable 管理，只增不删 |
| pi 会话元数据 | `/var/lib/dorahub/pi-session-meta.json` | 原子写/90天过期/500条上限 |
| 审计日志 | `/var/lib/dorahub/audit.jsonl` | 5MB 轮转（.1） |
| 执行机探测缓存 | hub 内存（30s 节流，60s 新鲜窗口） | /api/executors 秒回 |
| pi 会话列表缓存 | hub 内存（5 分钟） | meta 实时回填不受缓存影响 |

## 3. API / 协议速查

### HTTP（在 §3 基础上新增的部分；旧的见 git 历史 v1）

| 方法 路径 | 用途 |
|---|---|
| DELETE `/api/conversations/:id` | 软删除（hidden） |
| POST `/api/conversations/:id/transfer` | 工作区跨机迁移 `{targetEnvId, targetCwd}` → `{report, notice}` |
| GET `/api/executors` | 三台执行机 + 缓存在线状态（秒回，后台刷新） |
| GET `/api/pi-sessions?env=` | 扫描某机 pi 会话（含生成元数据 title/description/keywords） |
| POST `/api/pi-sessions/import` | pi 会话 → durable 会话 `{sourceEnvId, dir, file}` → `{convId}` |
| POST `/api/pi-sessions/delete` | 删源机 .jsonl |
| POST `/api/pi-sessions/transfer` | pi 会话跨机搬运 `{sourceEnvId,file,dir,targetEnvId,targetCwd}` |

列表返回：`{id,name,status,model,cwd,updatedAt,lastPreview,description,keywords,envId}`（不再是恒 null）。

### WS 帧（新增）

- `conv_meta`：`{conv,name,description,keywords,envId}` —— 自动命名/改名/切机实时推送

### entry 结构大坑（不变，必读）

内容在 **`model[0]`** 不在 `data`；pi.user 的 content 是字符串，pi.assistant 是 blocks 数组（text/thinking/toolCall）；渠道错误 = stopReason:"error" + errorMessage。

**新增坑**：自定义 doc（dorahub.meta）**不在 `viewState().docs`**（只有 pi.* builtin），读用 `harness.documentState(token, conv.id, context)`，conversationId 必须传 Conversation handle 的 id。

## 4. 代码地图（packages/）

```
shared/src/index.ts        # 协议单一定义源（HTTP 类型 + WS 帧 + ExecutorInfo）
server/src/
  index.ts                 # 装配：harness+guard+executors+channels → HTTP+WS+静态托管
  dorahub.ts               # ★ 应用层：会话注册表/事件扇出/确认队列/迁移编排/pi导入入口
  harness.ts channels.ts   # harness 装配 / 多渠道注册（zjl+trial+plan 共10模型）
  conv-meta.ts             # ConvMetaDoc v4（name/desc/keywords/envId/hidden/sourcePiKey）
  auto-namer.ts            # 会话自动命名（首条消息后异步生成，节流+手动名保护）
  workspace-harvest.ts     # 从会话历史挖 read/write/edit 文件清单
  transfer.ts              # 工作区跨机搬运 + 校准提示生成
  pi-sessions.ts           # pi 会话扫描（1条SSH复合命令+缓存）/元数据/删除/搬运
  pi-import.ts             # pi jsonl → durable entries 导入器（appendEntry 逐个 await！）
  exec/registry.ts         # 执行机注册表：SSH连接/probe(5s超时)/buildForEnv(cwd=null→home)
  guard.ts audit.ts ws.ts http-api.ts
web/src/
  pages/Conversations.tsx  # 列表页：分组卡片/新建向导/软删除 + PiSessionsSection
  pages/Conversation.tsx   # 会话页：header(env标签+model标签+⚙⏹⑂)/确认卡/inbox/警告条
  components/
    PiSessions.tsx         # pi 会话区：扫描列表/导入/删除/搬运向导（metaReady 轮询刷新）
    EnvSwitcher.tsx        # 执行机切换+迁移向导（transferring/done/error 相位）
    ModelPicker.tsx        # /model 式平铺列表+搜索+思考强度
    Modal.tsx              # ★ 共享弹窗（createPortal 到 body——backdrop-filter 坑的解药）
    Markdown.tsx           # 自写增量渲染（流式只重解析尾段）
    MessageBubble/ToolCard/Composer/Inbox/ConfirmationCard
  state/conv.ts            # ★ reducer：applySnapshot/applyEvents/pushEntry
  style.css                # 设计 token（暖纸浅色默认+自动深色）+ 全部样式
```

架构纪律（ADR-004/010）：**事件流驱动 reducer、snapshot 全量替换、无全局状态库、不引 UI 组件库**。可以优化结构，别推翻语义。

## 5. Backlog（按优先级，含规划建议）

### P0 用户明确等着的
- [ ] **宽屏两栏**：>768px 列表常驻左栏（design/06 §5 原计划，一直没做；现在列表页功能多了更需要）
- [ ] **UI 收敛**（用户原话"越来越臃肿"）：设置页（执行机管理/渠道状态收进去）、会话页 header 菜单合并
- [ ] 手机接入：NovaScale（iOS 内置 libtailscale 的第三方客户端）实测 + V-06 回写；或 Funnel+token 方案（ADR-007 要求开 token，api.ts 的 localStorage 'durahub.token' 已预留，缺登录 UI + 401 全局处理）

### P1 功能缺口（design/06 规划未做）
- [ ] usage/cost 面板（usage_changed 已在 reducer）
- [ ] compaction 提示标记
- [ ] fork 选点（消息上任意点分叉，现只能最新处）
- [ ] 会话配置编辑（cwd/instructions 的 UI，configure API 已支持）
- [ ] 会话页 degraded 兜底（WS 断时 5s 轮询只有列表页有）
- [ ] 虚拟列表（entries 过千性能）
- [ ] PWA：PNG 图标（iOS 主屏）、Web Push（M5：渠道挂了手机推送）

### P2 打磨
- [ ] thinking 流式时的"思考中"动效区分
- [ ] 图片消息展示（read 工具返回图片时）
- [ ] pi 导入的 system 消息处理（当前跳过 preamble，扩展消息如 <system_warning> 类原样导入）

## 6. 坑清单（血泪，别再踩）

1. **弹窗必须走 Modal.tsx（createPortal）**：conv-header 有 backdrop-filter，CSS 规范下它是 fixed 后代的 containing block——不 portal 的弹窗会被钉在 header 的 50px 高度里溢出屏幕（实测 top:-175px）
2. entry 内容在 `model[0]`；自定义 doc 用 documentState 读（§3）
3. **JS 模板字符串里 `\xNN` 会被解释成真控制字节**：发给 daemon 的命令含 NUL 直接被拒（"nul byte found"）；要传文本 `\xNN` 给远端 bash 必须写 `\\xNN`。且注意：源文件含真控制字节会被 git 当二进制（diff 全废）
4. **daemon 文件操作不走 shell**：readTextFile/writeFile 是独立通道（无 32K 命令行限制）；shell exec 的结果要用 `onOutput` 回调收（ShellExecResult 无 output 字段）
5. RemoteExecutionEnv 的 cwd 必须是**目标机上真实存在的路径**（`~`/`/tmp` 都不行，Windows 上用 daemon info.home——`buildForEnv(envId, null)` 已封装）
6. Windows 命令行 32K 限制：大文件搬运必须走 daemon 文件 API
7. 管理员组用户的 SSH 公钥在 `C:\ProgramData\ssh\administrators_authorized_keys`（不读 ~/.ssh/authorized_keys）
8. laptop 实际用户目录是 `C:\Users\shigu`（不是 shigure）；SSH 默认 shell 是 cmd.exe（ls/head 不可用），pi-env exec 走 Git Bash
9. **ConversationInit 里 appendEntry 必须逐个 await**（"commit settled before pending Tx operations"）
10. pi 会话目录编码：`--D--hobby--` ← 去首分隔符、`/\:` 全换 `-`（encodeDir/decodeDir 已有）
11. sw.js 缓存：改前端后浏览器**关 tab 重开**才换 bundle；开发用 vite dev 避开
12. Windows curl 中文 GBK 乱码（用 python -X utf8）；`nul` 保留名垃圾文件会在 add -A 时炸 git（已 gitignore，仍要留意）
13. browser-eval 的 `location.reload()` 会毁掉当前 eval 上下文；React 受控组件要用 native setter + dispatchEvent
14. **发版脚本引号地狱**：`python scripts/hub.py "长命令"` 里嵌 python3 -c 会炸——分步执行或写临时脚本上传
15. node -e / bash -c 里写中文代码补丁会 GBK 炸——补丁脚本写 .cjs 文件（UTF-8）再执行
16. 智谱直连慢（1-2 分钟）是限速常态；zjl grok-4.7 快

## 7. 验收基线（改完必须仍然全过）

- S1 双设备同会话实时流式；S2 steer 排队生效；S3 确认卡拒绝→工具 blocked；S4 kill server→30s 内重连恢复
- S5 新建免命名→自动标题实时出现→列表按项目分组带关键词
- S6 模型切换（⚙ 选 trial/glm-5.3-flash → header 更新 → 新渠道回复）
- S7 执行机：新建选 workpc → bash hostname 返回 cyq；跨机迁移带文件
- S8 pi 会话：扫描出带摘要的列表 → 导入 → agent 记得原上下文
- `ws-test.ts` 15 项全过
- 手机关 tab 重开验证 SW 更新

## 8. 发版到云端

```bash
cd D:/hobby/pi-durable
rm -f nul && git add -A && git -c user.name="shiyu" -c user.email="shiyu@local" commit -m "..." && git push origin main
git archive --format=tar.gz -o dorahub-src.tar.gz HEAD
# SFTP 上传（paramiko 模式，凭据 ~/.dorahub/hub.env）
python -X utf8 -c "..."   # 见 git 历史或 scripts/hub.py 的连接模式
python scripts/hub.py "systemctl stop dorahub && rm -rf /opt/dorahub/* && tar -xzf /tmp/dorahub-src.tar.gz -C /opt/dorahub && chown -R dorahub:dorahub /opt/dorahub && cp /opt/dorahub/deploy/dorahub.service /etc/systemd/system/ && cd /opt/dorahub && sudo -u dorahub npm ci --no-audit --no-fund 2>&1 | tail -1 && sudo -u dorahub npm run build 2>&1 | tail -1 && systemctl daemon-reload && systemctl start dorahub && sleep 4 && curl -s http://127.0.0.1:8787/api/health"
rm dorahub-src.tar.gz
```

**npm run build 一步不能省**（web/dist 不入 git）。hub 不能直连 GitHub（TLS 干扰），走打包直推。

## 9. 自由度与规划建议

- 设计语言全权委托（ADR-010 已立：暖纸浅色 + token 体系 + 不引 UI 库）；用户审美否决项：不要程序员黑、不要边框方盒堆叠
- 后端可小改（conv-meta/新端点级别）；协议大改先改 design/05
- pi-* 生态包版本锁死（@earendil-works/* 精确版本）
- **UI 臃肿度已到临界**（用户点名）：动手前先想信息架构——建议方向：设置页收纳管理功能、会话页 header 收敛、宽屏两栏让列表常驻。做之前给用户看方案再实施
- 用户偏好：先分析需求再动手、量化验证（不是"我觉得好了"）、诚实报告边界与限制

## 附：待用户手动的三件事（历史遗留）

1. ~~手机装 Tailscale~~ → 改为：手机装 NovaScale（中国区可搜到，内置 libtailscale）测试；或外区账号装官方版
2. 管理台把 cyq 改名 workpc（改后 hub 的 DORAHUB_EXEC_WORKPC_HOST 也要同步改，known_hosts 的 pi-env-workpc 别名不用动）
3. （可选）workpc 管理员 PowerShell 加 dev key 公钥，让本地 dev 也能 SSH 执行机（§1）
