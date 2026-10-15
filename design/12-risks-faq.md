# 12 · 风险、FAQ 与实施纪律

## 1. 风险登记簿

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R-01 | pi-durable API 版本间破坏性变更 | 高（官方明示 experimental） | 中 | 版本精确锁定（ADR 纪律）；升级独立 PR；依赖收敛在 harness.ts/events.ts 两个文件 |
| R-02 | pi-durable 某能力与文档不符（枚举 API 名、write 侧 env 接口等） | 中 | 中 | **.d.ts 是唯一事实源**原则；发现差异当天回写设计文档的 ⚠️ 条目 |
| R-03 | 手机上 Tailscale 与 v2ray 冲突（V-06） | 中 | 低 | 模式 B（funnel+token）兜底，03 §3 决策树 |
| R-04 | DERP 海外中继慢（打洞失败时） | 中 | 低-中 | 单用户流量小可容忍；M5 自建 derper 根治 |
| R-05 | hub VM 单点（ADR-002 已接受） | 低 | 高（全停） | VM 常开 + systemd + SQLite 落盘；VM 本身是既有稳定资产 |
| R-06 | exec-agent 在 Windows 的 bash 兼容性坑（路径/权限/进程树 kill） | 中 | 中 | W-c 双模式（08 §3）；M4 验收清单含白名单与 kill 分支 |
| R-07 | 烂尾风险（项目动力） | 中 | 高 | 里程碑全部有可演示物；M3 即简历可写点；Paseo 兜底日常需求（ADR-001） |
| R-08 | LLM 中转（zjl）变更/限流 | 低 | 中 | pi-ai 层可换 provider；会话数据不依赖具体模型 |
| R-09 | workpc 公司环境网络限制装 Tailscale | 低（用户已确认无公司内网约束） | 中 | 已排除；若未来环境变化，exec-agent 走 laptop 或仅 hub 本地执行 |

## 2. 实施纪律（给工作电脑上的 pi agent）

1. **文档先行**：动每个里程碑前重读对应设计文档；**发现文档与实际不符时，先改文档再改代码**（文档是这个项目的 single source of truth，因为它承担跨设备交接职责）
2. **.d.ts 优先于 README**：pi-durable 实验性，任何 API 拿不准，去 `node_modules/@earendil-works/pi-durable/**/*.d.ts` 查，不信记忆
3. **每个里程碑收尾**：git tag + 演示录屏（10 号纪律）+ 设计文档 ⚠️ 项清理
4. **验证项回写格式**：`V-0x：结论（日期）。证据：命令/输出摘要。影响：xxx 文档第 x 节已同步修改`
5. 卡点半天以上 → 记入本文 FAQ → 换任务并行，勿恋战

## 3. FAQ（实施中滚动追加）

### Q1：pi TUI 里的旧会话能不能搬进来？
v1 不做（ADR-008）。两套存储不同：pi TUI 是 append-only JSONL（`~/.pi/agent/sessions/`），pi-durable 是 SQLite + 任务/文档模型。M5 有导入器加分项，技术上可行（session-format.md 有官方格式文档），但先跑通主线。

### Q2：为什么不用 Docker 跑 hub？
MVP 阶段 systemd 最简、可观测性最好（journalctl）。pi-durable 的崩溃恢复需要进程干净退出配合 systemd 拉起，systemd 单元三行搞定（Restart=always）。Docker 化列 M5。

### Q3：多个模型的 API key 怎么管？
全走 zjl 中转 = 一个 key 一个 baseURL（V-02 定稿后写死在 /etc/durahub/env）。将来接直连 Anthropic/OpenAI 时，pi-ai 的 models.setProvider 每 provider 一行，key 同样走环境变量。

### Q4：watchEvents 是实验性的，会不会坑？
事件形态在 05 协议里被裁剪层（events.ts）隔离了一层——就算上游事件结构变了，改动集中在 events.ts 一个文件。这是给 R-01 的结构性缓冲。

### Q5：能不能让 hub 上的 agent 定时干活（比如每天跑一次日报）？
pi-durable 的 task 支持"timers that survive restarts"（官方 ✅）。自定义一个 defineTask + 定时器即可，挂在某个会话的 ownership 上。列 M5 后的自由发挥区——这是框架展示威力的好例子。

### Q6：带宽/流量担心？
单用户 tailnet 流量极小（05 §7 账）。手机流量场景：流式输出文本 + 工具输出，一小时重度使用 < 10MB 量级。

### Q7：这套东西和 Paseo 的本质区别一句话？
**Paseo 是"多机遥控器"（agent 留在各机器、客户端去看）；DuraHub 是"云大脑 + 分布式手脚"（会话状态单点在云、执行按需路由到端）**。前者的 daemon 死了 agent 就死；后者崩溃断点续跑。这是简历叙事的核心对比，面试必被问，按这句话答。

## 4. 自由发挥区（M5 之后）

- 定时任务体系（Q5）+ 日报 agent
- 会话内嵌网页预览（agent 生成的 HTML 直接在 PWA 里 iframe 预览）
- 多用户（家人/同学共享）：tailnet 邀请 + per-user 会话命名空间
- 语音输入（Web Speech API，纯前端，半小时就能加上）
- 和 pi TUI 的桥：durahub 会话里加一个工具直接调本机 pi CLI 处理子任务
