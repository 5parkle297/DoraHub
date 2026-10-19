# DoraHub 交接文档 v3（给下一个 UI 重设计会话）

> 写于 2026-10-18。v3 会话已完成：**UI 重设计（原稿格工作台）已上线**。本文档转为常规交接；§0 保留方法论记录。
> v2 的环境/API/坑清单仍有效，本文已合并 10-18 的变更；与 v2 冲突处以本文为准。
> **历史成果速览**：M0-M4 全部上线——暖纸浅色设计系统、自动命名、三执行机远程执行（hub/workpc/laptop）、跨机迁移、pi 会话管理中心、/model 选择器、**桌面两栏 + 手机驾驶舱双模式（10-18）**。线上 https://hub.tail242752.ts.net 。
> **本文档结构**：§0 本次任务（必读）→ §1 怎么跑 → §2 现状 → §3 API → §4 代码地图 → §5 设计现状与约束 → §6 坑清单 → §7 验收 → §8 发版 → §9 自由度。

## 0. 本次任务：Impeccable 驱动的 UI 重设计（✅ 已完成 2026-10-18）

**结果**：新视觉世界「原稿格工作台」——框即语义（实线=人写/待拍板、虚线=进行中、细线=机器完成、无框=叙述、网点底=机器输出、朱砂=等人出手）× 工作马字体（IBM Plex Sans/Mono + Noto Sans SC 自托管）。用户 steer 决定：漫画框语法 × 类别标准的字体纪律。产物：PRODUCT.md / DESIGN.md / surface brief（均在 packages/web/）。

**原任务描述**：方法论来自 [pbakaus/impeccable](https://github.com/pbakaus/impeccable)。

### Impeccable 是什么、已装在哪

- 一个设计 skill（24 命令 + 59 条确定性 detector 规则 + 浏览器实时迭代），专治“AI 味 UI”
- 仓库已 clone 到 `D:/hobby/impeccable`（浅 clone，main）
- **skill 已注册到 pi**：`~/.pi/agent/settings.json` 的 `skills` 数组指向 `D:/hobby/impeccable/.pi/skills/impeccable`（新会话里直接可 `/impeccable ...` 或按 skill 描述自动路由）
- **engine 二进制已就位**：`~/.impeccable/bin/0.1.15/impeccable.exe`（v4.6.0，Windows x64；是 GitHub release 下载的，源码在 repo 的 crates/ 但不用本地编译）
- 实测可用：`impeccable.cmd context --target packages/web/src` 正常输出；`detect --json packages/web/src/style.css` 已拽出 3 个 side-tab anti-pattern
- 调用方式（Git Bash）：`/d/hobby/impeccable/.pi/skills/impeccable/scripts/impeccable.cmd <verb>`，或 skill 内的相对路径调用（skill 的 SKILL.md 有完整说明）
- **网络注意**：GitHub 直连不稳（时好时坏），engine 已缓存本地不用再下载；若 impeccable 要拉远端资源卡住，检查代理 `http://127.0.0.1:10808`

### 推荐工作流（按 Impeccable 自己的规矩来，别跳步）

1. **`impeccable context`**（每会话一次，skill Setup 第一步）
2. **`/impeccable init`**：项目还没有 PRODUCT.md（context 已确认 NO_PRODUCT_MD）。init 会探索 repo + 向用户问几个产品真相问题（最多三轮）→ 写 PRODUCT.md。**注意：init 只记录产品事实，不读不写视觉方向**；它问用户时如实转达，别替用户编
3. **`/impeccable document` 或 new-work 决策**：现有暖纸设计系统是“incumbent”。本次是**重设计（redesign）不是修复（refinement）**——按 skill 语义：保留产品真相/内容/功能/约束，旧视觉只作为 evidence 和 anti-reference，在 new-work 里选新世界，然后重写 DESIGN.md
4. 设计新世界时记住本项目的硬约束（见 §5）
5. 实现：只动 `packages/web/src`（组件结构/className 可重构，语义别推翻，见 §4 架构纪律）
6. **`detect` 收尾**：改完跑 `impeccable detect --json <改动的文件>`，清零 slop 类 finding
7. 验收（§7）→ 发版（§8）

### 用户已定的边界（别再问）

- 信息架构 10-18 版已定型（桌面两栏/手机驾驶舱），**本次重设计视觉层，不动 IA 骨架**
- 不引 UI 组件库（ADR-010）；自写轻量 markdown/diff 渲染是特色（ADR-010），保留
- 后端协议大改不做；小端点可以加
- 改完发版云端（§8），用户自己验收

### 产品真相（2026-10-19 用户拍板，PRODUCT.md / init 问题可直接引用）

- **用户与阶段**：当前 single-player；近期 = 邀请制小团队共享同一个 hub 实例（≤3 人，Tailscale 免费版上限）；远期 = 开源 self-hosted 应用（类 Gitea，每团队一台实例，docker compose 一键起）。**永不做多租户 SaaS**
- **身份**：每人自己注册 Tailscale 账号、自己管自己设备，被邀请进 tailnet；hub 靠 serve 注入的 `Tailscale-User-Login` 头识别用户（无注册流、无密码）
- **隔离**：会话按 owner 隔离（只能看到自己的云端会话）；执行机是资源边界——他人会话默认只能跑 hub，不能用你的 workpc/laptop；想加自己的机器当执行机自愿注册
- **模型 key = BYOK**：同事在设置里填自己的 provider + key，不用你的 key，你也不替任何人付钱
- **前端注意**：UI 重设计要给“未来身份”留口子（header 能容纳用户名/头像，设置弹窗留"模型渠道/账号"分组可放 BYOK 表单），但**本次不做登录页、不做用户切换**
- **后置 milestone（不在本次范围，完整方案见 docs/roadmap.md §1）**：多用户隔离（同事接入前的前置）——身份中间件/owner/过滤/执行机边界/BYOK/ACL 收紧等，全部 UI 稳定后由后端会话做。前端本次只需：布局不焊死 single-player（header 能容纳用户名，设置能加"我的渠道"页签）

## 1. 开发环境（workpc，Windows）

```bash
# 终端 1：server（127.0.0.1:8787）
cd D:/hobby/pi-durable
bash dev-server.sh    # key/executors 环境变量都在里面了（读 ~/.pi/agent/models.json 配好）
# 前置：先 node packages/server/build.mjs 重建 dist

# 终端 2：前端热更新
npm run dev:web       # vite dev :5173，proxy /api /ws → 8787
```

- ✅ **本地 dev 的 SSH 到执行机已全通（10-18 修好）**：workpc/laptop 的 administrators_authorized_keys 已加 dev key，known_hosts 用 pi-env-* 别名。三台执行机本地全功能可测（含 pi 扫描/迁移/S7 远程执行）
- ⚠️ workpc 的 Tailscale 机器名已从 cyq 改为 **workpc**（dev-server.sh 与 hub 的 /etc/dorahub/env 均已同步；workpc 会话里 `bash hostname` 返回 cyq 是 Windows 计算机名，正常）
- 类型检查：web `cd packages/web && npx tsc -b --noCheck`；server `cd packages/server && npx tsc --noEmit`
- 测试模型：trial/glm-5.3-flash 免费但慢（1-2 分钟是限速不是 bug）；zjl/grok-4.7 快
- git：`git -c user.name="shiyu" -c user.email="shiyu@local"` commit（**message 一律中文**，用户定的规矩）；remote = github.com/5parkle297/DoraHub（main）；GitHub 直连不稳，推不上去等几分钟重试
- 回归：`node --experimental-strip-types scripts/ws-test.ts`（15 项，需 server 在 8787）
- **vite dev 调试前先注销 SW**：生产域同源 SW 会拦截 localhost:5173 模块请求，出“改了不生效”假象（10-18 实踩）。console：`navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()))` 后刷新

## 2. 系统现状全景（2026-10-18）

### 用户视角的功能清单（全部已上线；10-18 增补双模式布局）

| 功能 | 状态 | 备注 |
|---|---|---|
| **桌面两栏（≥769px）** | ✅ 10-18 | 侧栏常驻列表+当前高亮，右侧会话/空态引导；useIsWide matchMedia 实时响应 |
| **手机驾驶舱（<769px）** | ✅ 10-18 | 无管理功能；会话页 header `[←] 标题 ● [⋯]`，切模型/中止/分叉进菜单 |
| **设置弹窗（桌面 ⚙）** | ✅ 10-18 | 四页签：执行机/渠道与模型/pi 会话/关于 |
| 会话列表：自动命名/描述/关键词/分组/执行机徽章 | ✅ | conv_meta 帧实时推送 |
| 免命名新建（选执行机+项目路径）/ 软删除 | ✅ | |
| `/model` 选择器（模型标签点击直达） | ✅ | 10-18 起桌面从 header 标签直达；手机在 ⋯ 菜单 |
| 执行机切换 + 工作区迁移向导 | ✅ | harvest→中转→校准提示 |
| pi 会话管理中心（扫描/导入/删除/搬运） | ✅ | 10-18 起收进设置弹窗 |
| markdown / edit diff / 双设备同步 / steer / 确认卡 / 重连 | ✅ | S1-S4 |

### 执行机（M4，全部实测通过）

| envId | 机器 | 用户 | cwd | shell | 状态 |
|---|---|---|---|---|---|
| hub | 阿里云 VM | - | /opt/dorahub | - | 在线 |
| workpc | workpc（Tailscale 已改名，原 cyq） | shiyu | D:/hobby | D:/EESoftware/Git/usr/bin/bash.exe | 在线 |
| laptop | laptop（机器名 sh1gure） | shigure | F:/group | D:/Software/Git/usr/bin/bash.exe | 按开机 |

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

### HTTP（当前全量；v1 时代的旧端点见 git 历史）

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
  App.tsx                 # ★ 双模式骨架：wide→两栏(SidebarHeader+Sidebar+主区/空态)，手机→单栏；useIsWide
  route.ts                # hash 路由 + useIsWide（matchMedia 769px，实时响应）
  components/
    Sidebar.tsx           # ★ 会话列表（桌面侧栏/手机整页同体）：分组/实时推送/新建事件桥(dorahub:new-conv)
    ConvCard.tsx          # 会话卡片：active 高亮/运行徽章/关键词/软删除
    CreateModal.tsx       # 新建向导：选执行机+最近 cwd+手输
    SettingsModal.tsx     # ★ 设置四页签（桌面 ⚙）：执行机/渠道与模型/pi 会话/关于
    PiSessions.tsx        # pi 会话区（仅设置弹窗内）：扫描/导入/删除/搬运
    EnvSwitcher.tsx       # 执行机切换+迁移向导（transferring/done/error 相位）
    ModelPicker.tsx       # /model 式平铺列表+搜索+思考强度（支持受控 forceOpen/onClose）
    Modal.tsx             # ★ 共享弹窗（createPortal 到 body——backdrop-filter 坑的解药）
    Markdown.tsx          # 自写增量渲染（流式只重解析尾段）
    MessageBubble/ToolCard/Composer/Inbox/ConfirmationCard
  pages/Conversation.tsx  # 会话页：header 双形态(wide: 标题+env+model+⏹+⋯ / 手机: ←+标题+⋯)、ConvMenu portal 下拉
  state/conv.ts           # ★ reducer：applySnapshot/applyEvents/pushEntry
  style.css               # 设计 token（暖纸浅色默认+自动深色）+ 全部样式（重设计的主战场）
```

架构纪律（ADR-004/010）：**事件流驱动 reducer、snapshot 全量替换、无全局状态库、不引 UI 组件库**。可以优化结构，别推翻语义。

## 5. 设计现状与约束（UI 重设计必读）

### 现有视觉系统（incumbent，重设计的 anti-reference）

- 暖纸浅色（类 claude.ai ivory）+ 自动深色跟随系统 + terracotta 橙 accent；参照系 claude.ai / Linear / Things 3
- 全部在 `packages/web/src/style.css`（~750 行）：token 段（--bg/--accent/--sp-*/--r-*/--shadow-*）+ 各组件样式
- 已知问题（impeccable detect 实拽）：3 处 side-tab 左边框（tool-card/confirm-card 区）是最典型 AI 味；用户 10-16 也点名过“臃肿”

### 硬约束（重设计不能碰的）

1. **IA 骨架不动**：桌面两栏/手机驾驶舱/设置四页签/⋯菜单是 10-18 定型的信息架构，只换皮不改结构（用户已拍板）
2. **不引 UI 组件库**（ADR-010）；markdown/diff 渲染自写是特色，保留
3. 弹窗必须 portal（backdrop-filter containing block 坑，见 §6 #1）
4. 手机输入框 font-size ≥16px（iOS 防缩放）；viewport-fit=cover + safe-area
5. 深色模式必须继续自动跟随（prefers-color-scheme，无手动切换开关）
6. 无障碍基线：对比度、focus-ring、按钮可键盘触达
7. 字体不许用 Inter/Arial/系统默认做主字体（impeccable 反模式，中文环境注意字体栈的中文回退）

### 交给重设计会话的自由度

- 配色/字体/圆角/阴影/间距节奏/组件形态全可换（token 体系保留结构可换值）
- 消息流排版可重设计（现在全宽 760px 居中，claude.ai 式）
- 动效可加（animate 命令），但手机低端机性能要注意
- 用户审美否决项：不要程序员黑、不要边框方盒堆叠；新世界不限于暖纸系

### backlog（已迁移）

功能债与中长期项全部移至 docs/roadmap.md，本文不再维护双份。

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
17. **vite dev 会被同源 SW 劫持**（10-18 实踩）：生产站注册的 SW 拦截 localhost:5173 模块请求，HMR 全部失灵像“改了不生效”。dev 前 console 注销 SW（见 §1）
18. **CDP 手机仿真**：`Browser.setWindowBounds` 在 Windows 不改 viewport（假象）；必须 `Emulation.setDeviceMetricsOverride` + 干净导航。且 CDP 返回结构是 `result.result.value` 三层
19. hub.py 连接用公网 IP（hub.env 的 DORAHUB_HUB_PUBLIC_IP），不是私网 IP 也不是 Tailscale 域名
20. GitHub 直连时好时坏：git push / release 下载失败先等几分钟重试；release 走代理 `curl -x http://127.0.0.1:10808` 可下
21. **vite dev 多实例残留**：上个会话遗留的 vite 占着 5173，新 vite 漂移到 5174+，旧实例吐旧代码造成"改了不生效"假象；dev 前查 `netstat -ano | grep 517` 清场
22. **vite dev 的 CSS 是 style 标签注入 + HMR 追加不替换**：多次热更新后 computed style 可能钉在旧值；验证样式结论一律用 `vite preview`（生产 build）
23. **路由是 `#/conversations/:id`**（不是 `#/c/:id`）；手动注入 class 验证 React 渲染树外的样式时 computed bg 会误报 transparent

## 7. 验收基线（重设计改完必须仍然全过）

- S1 双设备同会话实时流式；S2 steer 排队生效；S3 确认卡拒绝→工具 blocked；S4 kill server→30s 内重连恢复
- S5 新建免命名→自动标题实时出现→列表按项目分组带关键词
- S6 模型切换（桌面点 header 模型标签 / 手机 ⋯ 菜单 → 选 trial/glm-5.3-flash → header 更新 → 新渠道回复）
- S7 执行机：新建选 workpc → bash hostname 返回 cyq；跨机迁移带文件
- S8 pi 会话：设置弹窗 pi 页签 → 扫描出带摘要列表 → 导入 → agent 记得原上下文
- S9 **双模式布局**：≥769px 两栏（侧栏高亮跟随路由）；<769px 手机单栏（无设置入口、菜单收敛）
- S10 **impeccable detect 清零**：`impeccable detect --json` 对改动的 CSS/组件无 slop 类 finding；深浅色两套都截图自检
- `ws-test.ts` 15 项全过；tsc 双包零错
- 浏览器实测（CDP :9222 已验证可用）：桌面 + 390px 手机仿真都要过
- 手机关 tab 重开验证 SW 更新（sw.js 的 CACHE 版本号记得 bump）

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

- **视觉全权委托**：本次是 redesign，旧暖纸系统是 anti-reference，新世界不设预设方向；硬约束见 §5（IA 不动/无 UI 库/深色自动/否决项：程序员黑、边框方盒堆叠）
- 后端可小改（conv-meta/新端点级别）；协议大改先改 design/05
- pi-* 生态包版本锁死（@earendil-works/* 精确版本）
- impeccable 仓库在 D:/hobby/impeccable 是**上游工具不是本项目代码**，别把它的文件搬进 repo；engine 升级走它的 git pull + 重跑 context
- 用户偏好：先分析需求再动手、量化验证（不是"我觉得好了"）、诚实报告边界与限制；大改动前给用户看方案

## 附：用户手动事项状态（10-18 全部闭环）

1. ~~手机装 Tailscale/NovaScale~~ → 搁置（用户说先不管手机）
2. ~~管理台把 cyq 改名 workpc~~ → ✅ 已改（hub env 与 dev 配置已同步，探测在线）
3. ~~workpc/laptop 加 dev SSH 公钥~~ → ✅ 已加（本地 dev 三机全功能，S7 已验证）
