# DoraHub 交接文档 v5（给下一个会话：P0-2 用户口述问题清单）

> 写于 2026-10-19（v5）。v4 会话已完成：**P0-1 laptop 体验修复已上线**（详见 §0 修复记录）。本文档转为常规交接，§0 永远是“当前会话任务”。
> 历史版本（v2-v4 全文）见 git 历史。
> **历史成果速览**：M0-M4 上线——三执行机远程执行、跨机迁移、pi 会话管理中心、/model 选择器、桌面两栏+手机驾驶舱双模式、视觉系统 v3「原稿格工作台」、P0-1 修复（空壳会话治理+pi 扫描分组）。线上 https://hub.tail242752.ts.net 。
> **本文档结构**：§0 本次任务（必读）→ §1 怎么跑 → §2 现状 → §3 API → §4 代码地图 → §5 设计约束 → §6 坑清单（24 条）→ §7 验收 → §8 发版 → §9 自由度。中长期项在 docs/roadmap.md。

## 0. 本次任务：P0-2 用户口述问题清单（逐条诊断修复）

### ✅ P0-1【已修复上线，2026-10-19 be929eb】（保留诊断与修法，防同类问题复发）

**问题 A（误触连建空会话）修去：**
1. CreateModal 改两步确认：点"最近项目"只选中填入（高亮 .on），统一走底部"创建会话"按钮；输入框 Enter 同路径。**实测：3 连击误触 0 创建**
2. **创建成功后关闭弹窗**——这是原代码的真凶级 bug：wide 模式下 Sidebar 常驻不 unmount，create 成功后弹窗不关，用户误以为没点上再点 = 4 秒连建 3 个的形态
3. 侧栏/桌面 WelcomePane 过滤空会话（无 name 且无 lastPreview = 从未发过消息）
4. **conv_meta 帧 upsert 补拉**：原代码只 map 不 upsert，新会话发首条消息自动命名后推帧，但不在列表里的会话（被过滤的空壳/快照后新建的）永远进不了列表——预存缺口，被过滤改动放大后修复（submit 不推帧、conv_meta 要等慢模型命名完才推，两者叠加的窗口期靠补拉全量兑冲）

**问题 B（pi 扫描混组）修去：**
1. PiSessions 按执行机分组（组头：🖥 机器名 + N 个 pi 会话；组内 mtime 倒序）。实测 laptop 15 条/workpc 30 条分组清晰
2. 空态文案改"各台执行机上都没有 pi 会话"（不再假设"两台电脑"）
3. shared 包新增 PiSessionInfo 类型（api.ts 内联类型缺 title/description/keywords/metaReady 四字段——预存类型不一致顺带修）
4. 旧行内 env 徽章（.pi-env）已删（分组头取代）；CSS .pi-group 新增

**残留数据**：线上空壳 177/210/217/224 已全部软删（2026-10-19，含 handoff 未点名的 177）。本地 dev 库空壳已清。

**验收实录**（全部通过）：ws-test 15/15；tsc 双包零错；impeccable detect `[]`；手机 390px 弹窗 358px 无溢出输入框 16px；新会话发消息→自动命名→侧栏实时出现（conv_meta 补拉链路）。

### P0-2【逐条进行中】用户口述问题清单

用户 10-19 说“今天体验发现不少问题”。已处理：

**✅ #1（已上线 5c34ba2）pi 会话入口太深 + 全量扫描等待成本高**：用户拍板 IA 变更——pi 入口从 设置→pi页签→点展开 三层挪到**左侧栏常驻**：
- 打开页面即后台自动扫描（无需点击，扫描中不阻塞，失败静默）
- 侧栏只留时间窗内的：**3 天内 / 3-7 天前，每机每档最多 3 条**（防单机刷屏）
- 每条带 ⤵ 快速导入（两击确认防触屏误触）；导入后变 ▶ 打开
- **更多 →** 全量管理弹窗（按机器分组，导入/删除/搬运）
- 设置弹窗改三页签（pi 页签移除）——注意 10-18 定的“四页签” IA 被此变更覆盖
- 手机列表页底部同体（驾驶舱语义不变）
- 实测：自动扫描 12 条入窗（两档x两机x封顶3）、导入 357 条 entries 无损、自动命名链路通、390px 无溢出弹窗 358px

**待用户继续列**：剩余问题逐条给（哪个页面/什么操作/期望 vs 实际）。

### 本次任务边界

- 这是修 bug/体验会话，不是重设计会话：视觉系统 v3.2（蓝色版）保持不动，修问题不得推翻 DESIGN.md 世界观；确需动样式时遵循现有 token
- 修完必须过 §7 验收基线（特别是 S5 自动命名、S9 双模式、S10 detect 清零）
- 后端可以小改（如空会话过滤需要列表 API 配合），协议大改不做

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
| **设置弹窗（桌面 ⚙）** | ✅ 10-18 | 三页签：执行机/渠道与模型/关于（pi 会话 10-19 移侧栏） |
| **侧栏 pi 会话区** | ✅ 10-19 | 自动扫描+时间窗（3天内/3-7天，每机每档3条）+ 更多弹窗全量管理 |
| 会话列表：自动命名/描述/关键词/分组/执行机徽章 | ✅ | conv_meta 帧实时推送；**10-19 起空会话（未发消息）不进列表** |
| 免命名新建（选执行机+项目路径）/ 软删除 | ✅ | **10-19 起两步确认（选中填入→创建按钮），成功后弹窗自动关** |
| `/model` 选择器（模型标签点击直达） | ✅ | 10-18 起桌面从 header 标签直达；手机在 ⋯ 菜单 |
| 执行机切换 + 工作区迁移向导 | ✅ | harvest→中转→校准提示 |
| pi 会话管理中心（扫描/导入/删除/搬运） | ✅ | 10-19 起在侧栏常驻（时间窗内）+「更多」弹窗全量（按执行机分组） |
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
    SettingsModal.tsx     # ★ 设置三页签（桌面 ⚙）：执行机/渠道与模型/关于
    PiSessions.tsx        # ★ pi 会话：侧栏常驻区（自动扫描+时间窗）+ 全量管理弹窗（导入/删除/搬运）
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

## 5. 设计现状与约束（修 bug 会话必读：视觉系统 v3 是正式系统，不是草稿）

### 现有视觉系统（v3「原稿格工作台」，2026-10-18 重设计会话产物）

- **世界观**：漫画原稿格的框语法 × 工作马字体。框即语义六类：实线=人写/待拍板、虚线=进行中、细线=机器完成、无框=叙述、网点底=机器输出、朱砂=等人出手
- **字体**：IBM Plex Sans/Mono + Noto Sans SC 全自托管（@fontsource，已入 package.json）
- **颜色**：v3.2 蓝色版——结构线与交互色转靓蓝（用户反馈"看不到蓝色"后升格）；对比度 WCAG AA 全底色达标（faint 2.40→4.88）
- **权威文档**：packages/web/DESIGN.md（token 体系全量）+ PRODUCT.md（产品真相）+ .impeccable/（surface brief）；改样式先读 DESIGN.md，不得推翻世界观，只能在其 token 体系内修
- **签名动作**：流式完成瞬间框缘闭合（dashed→solid 0.22s）、工具卡状态戳（讫/误/阻）——别碰

### 硬约束（任何修改都不能碰的）

1. **IA 骨架不动**：桌面两栏/手机驾驶舱/侧栏 pi 会话区/设置三页签/⋯菜单是已定型的信息架构（10-18 定型、10-19 P0-2#1 把 pi 会话从设置移入侧栏），只换皮不改结构（用户已拍板）
2. **不引 UI 组件库**（ADR-010）；markdown/diff 渲染自写是特色，保留
3. 弹窗必须 portal（backdrop-filter containing block 坑，见 §6 #1）
4. 手机输入框 font-size ≥16px（iOS 防缩放）；viewport-fit=cover + safe-area
5. 深色模式必须继续自动跟随（prefers-color-scheme，无手动切换开关）
6. 无障碍基线：对比度、focus-ring、按钮可键盘触达
7. 字体不许用 Inter/Arial/系统默认做主字体（impeccable 反模式，中文环境注意字体栈的中文回退）

### 修 bug 时的自由度

- 新增交互/状态展示可用现有 token 体系内的任何样式；确需新 token 时先补进 DESIGN.md 再用
- 涉及产品语义的改动（如空会话自动清理的时机）先问用户再定案
- 用户审美否决项依旧：不要程序员黑、不要边框方盒堆叠

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
24. **CDP 手机仿真后 browser-eval 连的 target 不共享 override**：scripts/mobile-emu.mjs 用独立 puppeteer 会话做 Emulation.setDeviceMetricsOverride，browser-eval（另一个 CDP 连接）里 innerWidth 仍是桌面值。手机模式的 DOM/几何断言必须在同一个 puppeteer 会话里 evaluate（mobile-emu.mjs 就是这么写的）；还原桌面跑 `node scripts/mobile-emu.mjs 1264`
25. **本项目 tsc 有两类检查**：官方验收是 `cd packages/web && npx tsc -b --noCheck`（零错）+ `cd packages/server && npx tsc --noEmit`（零错）。**不要用 `tsc --noEmit -p .` 直查 web**——Composer/route/state 有 5 个预存错误（2026-10-19 核实 HEAD 就有），-b --noCheck 才是项目认可口径

## 7. 验收基线（重设计改完必须仍然全过）

- S1 双设备同会话实时流式；S2 steer 排队生效；S3 确认卡拒绝→工具 blocked；S4 kill server→30s 内重连恢复
- S5 新建免命名→自动标题实时出现→列表按项目分组带关键词
- S6 模型切换（桌面点 header 模型标签 / 手机 ⋯ 菜单 → 选 trial/glm-5.3-flash → header 更新 → 新渠道回复）
- S7 执行机：新建选 workpc → bash hostname 返回 cyq；跨机迁移带文件
- S8 pi 会话：侧栏 pi 区自动扫描 → 时间窗列表 → 导入（侧栏⤵ 或更多弹窗）→ agent 记得原上下文
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
