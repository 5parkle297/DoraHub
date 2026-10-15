# 01 · 需求

## 1. 用户故事

以下每条都对应一个可验收的场景（见 11 号文档 demo 剧本）。

### US-01 跨设备同会话
> 作为用户，我在工作电脑上和 agent 聊到一半，合上电脑出门。路上打开手机，能看到**同一个会话**的完整历史和最新状态，直接继续对话。不需要导出 md、不需要"交接文档"。

验收：workpc 发起会话问一个问题 → agent 回答 → phone 打开 PWA，看到相同历史 → 在 phone 上继续追问 → 回到 workpc 刷新，看到 phone 发的消息和回答。

### US-02 实时观察流式输出
> 作为用户，agent 在跑长任务（读代码、跑命令），我在任何设备上都能**实时**看到它正在输出什么、正在调用什么工具、每步工具的中间输出。

验收：发起一个会触发多轮工具调用的任务 → 在另一台设备的浏览器里看到消息逐字出现、工具调用的输出流式滚动。

### US-03 运行中 steer（转向）
> 任务跑偏了。我不等它跑完，直接插一句话："先别管样式，先跑通测试"。这句话进入当前运行，agent 在当前工具轮结束后看到它并改变方向。

验收：agent 在跑一个多轮任务 → 提交 steer 消息 → 界面上看到消息插入 → agent 行为改变。pi-durable 语义：`whenBusy: "steer"` 的提交放在当前工具轮之后、加入运行中的工作。

### US-04 崩溃恢复
> VM 重启 / hub 进程被 OOM 杀掉。重启后 agent 从断点继续：已完成的工具调用不重跑（非 safe 的不重放，safe 的幂等重跑），被中断的模型请求重发，排队中的消息还在队列里。

验收：发起任务 → 中途 `kill -9` hub 进程 → systemd 自动拉起 → 会话继续，模型被告知某工具调用"被中断"，继续推进到完成。

### US-05 远程确认（permission）
> agent 要执行危险操作（`bash rm -rf` 之类），hub 按策略拦截，推到客户端；我在手机上点"允许"或"拒绝"。我在外面也能放行紧急操作。

验收：配置 Guard 扩展拦截 `deploy` 工具 → 发起任务触发拦截 → 手机收到待确认条目 → 点允许 → 工具继续执行。

### US-06 工具执行路由（M4）
> 会话在 hub 上，但我明确要它操作的是**工作电脑上的代码目录**。agent 的 read/bash/edit 不在 VM 上跑，而是路由到 workpc 执行，结果回传。

验收：在 phone 上发起"统计 F:\work\repo 里的 TODO 数" → bash 实际在 workpc 上执行 → 结果回到会话。

### US-07 多会话管理
> 我可以同时开多个会话（不同项目/不同 cwd/不同模型），在客户端列表里切换查看。每个会话记自己的 agent 配置（模型、thinking、工具集、cwd、instructions）。

验收：创建两个会话（不同 cwd、不同模型）→ 列表页显示 → 分别提交任务互不阻塞。

### US-08 会话分叉（fork）
> 一个调查进行到某个点，我想试试另一条思路，但保留原线。fork 那个点，新会话看到父会话截至该点的历史，独立继续。

验收：在有历史的会话上选一条消息 fork → 新会话包含截至此的历史 → 两边独立对话。

## 2. 功能需求（按里程碑交付）

### M0 网络地基（无代码）
- FR-0.1 三台主力设备 + VM 组成 tailnet，MagicDNS 互通
- FR-0.2 hub 的 serve 暴露可达：`https://hub.<tailnet>.ts.net` 返回占位页
- FR-0.3 手机接入模式确定（模式 A：Tailscale app 常开 / 模式 B：Funnel，见 03）

### M1 pi-durable 跑通（VM 上，无前端）
- FR-1.1 hub 上 node 项目建立，pi-durable + SQLite 存储打开、root 会话创建
- FR-1.2 CLI 试玩：终端里 submit/steer/abort/watchEvents 全走一遍（官方示例改编）
- FR-1.3 接入用户现有 LLM 通道（zjl 中转 / OpenAI 兼容端点，见 V-02）
- FR-1.4 kill -9 崩溃恢复演练通过

### M2 hub 服务端
- FR-2.1 HTTP API：会话 CRUD、发送消息、steer、abort、模型切换
- FR-2.2 WebSocket `/ws`：事件流（watchEvents 转发）+ 客户端命令
- FR-2.3 systemd 服务 `durahub.service`，开机自启 + 崩溃自动重启
- FR-2.4 `tailscale serve` 挂载（只听 127.0.0.1）
- FR-2.5 基础审计日志（谁在什么时间连接/提交）

### M3 PWA 客户端（MVP 完成点）
- FR-3.1 会话列表页（活跃/空闲状态、running 标识）
- FR-3.2 会话页：历史消息、流式输出、工具调用卡片（折叠/展开中间输出）
- FR-3.3 输入框：普通发送（follow-up）/ steer 开关 / abort 按钮
- FR-3.4 待确认队列（US-05）的允许/拒绝
- FR-3.5 断线自动重连 + 全量刷新（viewState 快照语义：晚加入从当前视图开始）
- FR-3.6 手机可安装（manifest + service worker 基础壳）

### M4 远程执行（exec-agent）
- FR-4.1 exec-agent：跑在 workpc/laptop 上的轻量执行代理，注册到 hub
- FR-4.2 ExecutionEnv 适配：按会话的 `envId`（机器名）路由工具执行到对应 exec-agent
- FR-4.3 会话创建时可选目标机器；默认 hub 本地执行
- FR-4.4 exec-agent 断线时会话工具调用得到明确报错（而不是挂死）

### M5 加分项（按兴趣挑选，不承诺）
- headscale + derper 自托管控制面
- Funnel 模式 B 完善 + 应用 token 认证
- 旧 pi TUI JSONL 会话导入器
- watch() ops 协议 v2（带宽优化）
- Web Push 通知（iOS 16.4+）
- 子代理管理面板（watchEvents 的 subagent 事件展示）
- usage/cost 面板（pi.usage 文档）

## 3. 非功能需求

| 项 | 要求 |
|---|---|
| 单用户并发 | 同时 ≤5 个活跃会话、≤3 个客户端同时在线（hub 内存工作集可控，pi-durable 本身按需加载） |
| 端到端延迟 | 流式首 token 到客户端可见 ≤ 2s（tailnet 内）；steer 提交到生效 ≤ 1s |
| 崩溃恢复 | 丢失窗口 = progress 提交间隔（默认 100ms，可调 500ms 换存储写放大） |
| 安全基线 | serve 模式零公网暴露；Funnel 模式必开 token；hub 上 API key 只存 VM 的环境变量/root 权限文件 |
| 兼容性 | PWA 目标：手机 Chrome/Safari 最新版 + 桌面 Chrome/Edge/Firefox |
| 可移植 | hub 代码不依赖 VM 特有的东西，迁移 = 拷 sqlite + npm i + systemd unit |
| 成本 | 全链路 0 元（Tailscale 个人版 / 自有 VM / 已有 LLM key） |
