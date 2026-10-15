# DuraHub — 跨设备持久化 Agent 平台 · 设计文档

> **一句话**：会话状态住在云 VM 上（pi-durable + SQLite），网络由 Tailscale 私有组网承载，任何设备（工作电脑 / 移动电脑 / 手机）用浏览器接入同一个 agent 会话；运行中可 steer（转向），进程崩了从断点续跑，工具执行可以路由到指定电脑上执行。

## 这份文档是什么

这是一次**跨设备交接**的产物：由移动电脑上的 pi 会话调研并撰写，供**工作电脑上的 pi agent** 作为唯一上下文来源来实施本项目。读完本文档夹后，实施者应当可以在不重新调研的情况下直接开始 M0 里程碑。

讽刺的是，这次手工交接（移动电脑导出 md → 工作电脑的 agent 阅读理解）正是本项目要消灭的痛点。做完 M3 后，这种交接就变成"换个设备打开同一个网页"。

## 阅读顺序

| 序号 | 文件 | 内容 | 什么时候读 |
|---|---|---|---|
| 00 | `00-background-and-decisions.md` | 背景调研、已验证事实清单、全部选型决策（ADR） | **最先，必读** |
| 01 | `01-requirements.md` | 用户故事、功能需求、验收标准 | 必读 |
| 02 | `02-architecture.md` | 总体架构、组件、数据流、端口规划 | 必读 |
| 03 | `03-network-tailscale.md` | 网络层设计（tailnet / serve / 手机接入模式） | M0 前必读 |
| 04 | `04-server-host.md` | hub 服务端详细设计 + 启动序列代码骨架 | M2 前必读 |
| 05 | `05-sync-protocol.md` | WebSocket 同步协议 v1 | M2/M3 前必读 |
| 06 | `06-web-client.md` | PWA 客户端设计 | M3 前必读 |
| 07 | `07-execution-env.md` | 远程执行环境设计（exec-agent + RemoteExecutionEnv） | M4 前必读 |
| 08 | `08-environment-setup.md` | 四台机器的环境准备手册（含完整命令） | M0/M1 时对照执行 |
| 09 | `09-project-structure.md` | 代码仓库结构 + 各模块骨架代码 | 建仓时 |
| 10 | `10-milestones.md` | 里程碑 M0–M5 分解、每步验收标准 | 全程 |
| 11 | `11-demo-scenarios.md` | 5 个演示剧本（简历 demo / 拍视频用） | M3 后 |
| 12 | `12-risks-faq.md` | 风险清单、待验证项汇总、FAQ | 遇到问题时 |

## 给实施者（工作电脑上的 pi agent）的三条规则

1. **事实与验证分离**：文档中标 ✅ 的是已验证事实（附来源），标 ⚠️ 的是待验证项。**动手前先对待验证项跑验证命令，把结果回写进文档**（改对应文件，注明日期和结论）。
2. **决策不可静默更改**：所有架构决策记录在 00 号文件的 ADR 段。要推翻某条决策，先在 ADR 追加新条目（ADR-00N），写明推翻理由，再动代码。
3. **版本锁定**：`@earendil-works/pi-durable` 是实验性包，官方声明 API 会在版本间无通知变更。`package.json` 必须锁**精确版本**（不用 `^`/`~`），任何升级视为一次独立任务，先读 changelog。

## 项目命名

仓库建议名 **`durahub`**（durable + hub）。备选：`pi-fleet`、`tailagent`。以下文档统一用 DuraHub 指代本项目。

## 设备与角色速查

| 设备 | 文档中的名字 | 角色 |
|---|---|---|
| CentOS VM（15.208.253.20，经 SSH MCP 可达） | `hub` | 跑 pi-durable host + SQLite + WebSocket，唯一状态拥有者 |
| 工作电脑（Windows，主力开发机，项目在这做） | `workpc` | 开发机 + 浏览器客户端 + 执行代理（agent 的 bash 在这跑） |
| 个人移动电脑（Windows，本设计文档的诞生地） | `laptop` | 浏览器客户端 + 可选执行代理 |
| 手机 | `phone` | PWA 客户端（Tailscale app 常开） |
