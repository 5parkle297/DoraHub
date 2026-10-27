# DoraHub 交接文档 v8（给下一个会话：参考项目对齐分析）

> 写于 2026-10-26（v8）。v7 会话完成：手机同步问题四连修（双扇出/attach 竞态/pi 导入 envId/模型渠道映射）+ thinkingLevel 丢失修复（46d840d，均上线）。
> 历史版本（v2-v7 全文）见 git 历史。
> **历史成果速览**：M0-M4 上线——三执行机远程执行、跨机迁移、pi 会话管理中心、/model 选择器、桌面两栏+手机驾驶舱双模式、视觉系统 v3「原稿格工作台」、P0-1/P0-2、10-26 手机同步四修（b472d22+cebeedd+46d840d）。线上 https://hub.tail242752.ts.net（sw v12）。
> **本文档结构**：§0 本次任务（必读）→ §1 怎么跑 → §2 现状 → §3 API → §4 代码地图 → §5 设计约束 → §6 坑清单（33 条）→ §7 验收 → §8 发版 → §9 自由度。中长期项在 docs/roadmap.md。

## 0. 本次任务：参考项目对齐分析（产品需求回归）

**背景（用户 2026-10-26 拍板，重要程度高）**：用户以产品经理视角复盘，认为本项目“按技术里程碑堆功能，没从功能需求/用户旅程倒推过”——方向感模糊。下一个会话用户会**提供一个做得不错的 pi-durable 项目**作为参考。

**本次会话的任务**：
1. 用户开局提供参考项目（路径/仓库/链接）
2. **详细分析参考项目**：用户旅程（核心场景怎么走通）、信息架构、功能清单与优先级、交互细节、可取之处与不适用之处
3. 对照 DoraHub 现状（§2 功能清单）做差距分析：哪些我们有但没有对齐用户心智、哪些我们缺、哪些我们不缺且有特色
4. 产出对齐方案（分优先级）后**先给用户看再动手**——这是产品会话不是纯技术会话，需求优先
5. 实施时遵守 §5 硬约束（视觉系统 v3 不推翻、IA 大结构不砸）与架构纪律（ADR-004/010）

**分析参考项目时必问自己的产品问题**（避免又变成技术视角盘点）：
- 它的用户第一分钟体验是什么？（打开→能用，中间几步？）
- 它的“会话”概念对用户意味着什么？（用户眼里这是什么产品？）
- 它怎么处理“多设备/跨机”这个我们最核心的卖点？
- 它哪些功能用户离了会骂娘（P0），哪些是锦上添花（P2）？
- 它的错误态/空态/加载态怎么设计？（我们最近修的三次 bug 全在“导入后不可用”这种链路上）

**历史包袱提醒**：我们 10-26 修的四连 bug 全是“pi 会话导入后不可用”链路（envId→渠道名→思考档位）——这是“导入”作为核心功能的脆弱性信号，分析参考项目时重点看它怎么做“导入/恢复”这个场景。

### 本次任务边界

- 分析和方案先行，用户拍板后再动代码；大改动拆阶段
- 视觉系统 v3.2 不动，IA 骨架不动（只换皮不改结构）
- 参考项目对齐 ≠ 全盘照搬：DoraHub 的差异化（多执行机远程执行、pi 会话管理、自托管）要保留，对齐的是“需求理解”和“用户体验基线”

### 产品真相（2026-10-19 拍板，仍然有效）

- **用户与阶段**：当前 single-player；近期 = 邀请制小团队（≤3 人，Tailscale 上限）；远期 = 开源 self-hosted（类 Gitea，每团队一台实例）。**永不做多租户 SaaS**
- **身份**：每人自己管 Tailscale 设备，hub 靠 serve 注入的 `Tailscale-User-Login` 头识别（未来）
- **隔离**：会话按 owner 隔离；执行机是资源边界；模型 key = BYOK
- **前端注意**：给“未来身份”留口子（header 容纳用户名，设置可加“我的渠道”页签），但本次不做登录页
- 后置 milestone：多用户隔离方案见 docs/roadmap.md §1

### ✅ 历史已修（保留索引，详情见 git 历史）

- **手机同步四连修（2026-10-26）**：b472d22（双扇出/attach 竞态/EventGate 闸门）+ cebeedd（pi 导入渠道映射 no_model）+ 46d840d（thinkingLevel 丢失致智谱 1210 model_error）——详见 §6 #28-33 与 git 历史。存量 conv 294/1053 已手工修复
- **P0-1（be929eb）**：空壳会话治理（新建两步确认+成功关弹窗+空会话不进列表+conv_meta 补拉 upsert）；pi 扫描按机分组
- **P0-2 #1（5c34ba2）**：pi 会话入侧栏常驻（自动扫描+时间窗 3天/3-7天每机每档 3 条+更多弹窗全量）；设置改三页签
- **P0-2 #2（77e0779）**：设备标识色三机三色（hub 墨灰/workpc 靖蓝/laptop 琥珀；envId 哈希分配+CSS 变量架构；AA 全过）
- **P0-2 #3（260e5e7）**：扫描行级进度（⟳ 预计耗时 EWMA / ✓ 真实数量+耗时 / ✕ 连接失败不静默；超预估 2 倍提示可能离线）
- 另修：PiFullModal prop 重命名连带 bug（scan 未定义致白屏，tsc --noCheck 查不出——**发版前必须真开页面看**）；全完成+有失败时进度区误隐藏；失败误阻断 meta 轮询

### 下会话开场 prompt（复制即用）

```
读 D:/hobby/pi-durable/docs/handoff-frontend.md（v8），唯一入口文档。
本次任务在 §0：参考项目对齐分析。参考项目在这里：
（在这里贴参考项目的路径/仓库/链接）

按 §0 的产品问题清单详细分析参考项目，对照 §2 的功能清单和“产品视角自省”
做差距分析，产出分优先级的对齐方案——先给我看方案再动手。
这是产品需求回归会话，不是重设计会话：视觉系统 v3.2 不动，
IA 骨架不动；方案拍板后实施过 §7 验收再按 §8 发版。
```

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

## 2. 系统现状全景（2026-10-26）

### 用户视角的功能清单（全部已上线）

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
| pi 会话管理中心（扫描/导入/删除/搬运） | ✅ | 10-19 起在侧栏常驻（时间窗内）+「更多」弹窗全量（按执行机分组）；**10-26 起导入链路四 bug 全修（envId/渠道映射/thinkingLevel/双扇出）** |
| markdown / edit diff / 双设备同步 / steer / 确认卡 / 重连 | ✅ | S1-S4 |

### 产品视角自省（v8 新增，下会话必读）

**用户 2026-10-26 的复盘原话（大意）**：“从一个产品经理的角度来说，我们搞得不是很清楚具体的功能需求。”下会话对齐参考项目时，以下自省清单是出发点：

1. **功能是按技术里程碑堆的，不是按用户旅程铺的**：M0-M4 都是技术目标（“多机远程执行”“跨机迁移”），从未从“用户打开产品想干什么”倒推。结果：功能都有，但组合起来的体验碎
2. **核心用户旅程从未被定义过**：我们甚至说不清“用户第一分钟体验”是什么——打开→看到什么→第一步干什么→得到什么价值，这条线没有文档定义过
3. **导入链路的脆弱性是症状**：10-26 一天修了四个导入相关 bug（envId/渠道名/thinkingLevel/双扇出）——导入是“迁移已有会话”这个高频场景的入口，它却连续炸了四天，说明质量关口和场景测试都缺位
4. **手机端是二等公民**：驾驶舱模式“设计如此无管理功能”，但用户实际在手机上就是要干活（最近三个 bug 全是手机上报的）——移动优先还是桌面优先，从未拍板
5. **没有需求文档**：PRODUCT.md 是产品真相（商业模式层），roadmap.md 是技术计划，中间缺“功能需求层”——每个功能为谁、解决什么、验收标准是什么

**下会话分析参考项目时，对照这份自省找答案：它怎么回答了这些问题。**

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
25. **本项目 tsc 有两类检查**：官方验收是 `cd packages/web && npx tsc -b --noCheck`（零错）+ `cd packages/server && npx tsc --noEmit`（零错）。**不要用 `tsc --noEmit -p .` 直查 web**——Composer/route/state 有 5 个预存错误（2026-10-19 核实 HEAD 就有），-b --noCheck 才是项目认可口径。**且 --noCheck 不查未定义引用**（10-19 踩：prop 重命名漏改致 ReferenceError 白屏，tsc 过了但页面白）——发版前必须真开页面看一眼
26. **vite preview 也会被 SW 劫持**：preview 端口（4173）上打开过页面后，该 origin 注册了生产 sw.js，后续请求被旧 SW 拦截造成"build 了但页面没更新"假象（同 #17 的 dev 版）。CDP 测 preview 前先 `navigator.serviceWorker.getRegistrations()` 清掉；或换端口
27. **CDP Fetch.enable 拦截可做真实网络注入测试**（新版 CDP 已删 Network.setRequestInterception）：`Fetch.enable + patterns` + `Fetch.continueRequest`（延迟放行）/ `Fetch.failRequest`（模拟断连）——扫描进度/重连等时序逻辑的实测利器，10-19 #3 验证全靠它
28. **ws.on("message") 注册两次会把每帧记两遍**（10-26 踩）：验证脚本里等待两个阶段各注册一次 handler，frames 数组每帧 x2，误判“双扇出未修”。写 WS 测试脚本时 handler 只注册一次，或先定义后复用
29. **ws 层帧处理是并发的，不是队列**（10-26 实锤）：`ws.on("message", async ...)` 多帧同时到达时 handler 并发执行——同一会话的 attach/detach 会交错，Dorahub 里的流管理必须串行化（opChains per-conv promise 链，b472d22）。间歇性竞态（2/5 复现）必须连续跑 ≥10 次才能确认修好
30. **服务端数据是“真相”，前端渲染是“表象”**（10-26 方法论）：排查同步问题先查 `/api/conversations/:id/snapshot` 的 entries 是否真重复——服务端干净则是传输/渲染层问题（这次双扇出）；服务端就重复才是提交层问题。别被表象带偏方向
31. **浏览器 E2E 测试里 evaluateOnNewDocument 劫持 WebSocket 会半失败**（10-26 踩）：extends 子类覆盖 constructor 后 addEventListener 的 message 事件可能不触发（收到 undefined 帧），观测 WS 帧用 CDP `Network.webSocketFrameSent/Received` 才可靠（e2e-final.mjs 的做法）
32. **puppeteer emulateMediaType("dark") 已废弃**：用 `page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }])`，深色截图用这个
33. **测试脚本里的 `wait()` 若接收的是数组快照（filter/map 结果），后续新增帧不会出现**（10-26 踩）：wait 轮询的必须是原始可变数组引用，或每次轮询重新 filter。场景3 误报“零投递”就是这么来的

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
