# DoraHub 词汇表（CONTEXT）

> 对齐参考项目 Sig 的 CONTEXT.md 实践（分析报告 §4.5）：统一产品词汇，代码/文档/UI 不各说各话。
> 写代码、写文档、写 UI 文案时用左列词；出现新概念先来这里登记再使用。

## 产品层

| 词汇 | 定义 | 不这么说 |
|---|---|---|
| **会话**（conversation / conv） | 用户心智里的「一个 agent 现场」：一台执行机一个 cwd 里的一段持久对话。跨机迁移后仍是同一个 | ~~对话~~（泛指聊天行为时可用）、~~thread/事项~~（Sig 概念，不引入） |
| **执行机**（executor / env） | 用户的一台电脑（hub/workpc/laptop），会话的工具调用路由到它 | ~~机器~~（口语可以）、~~connector~~（Sig 概念） |
| **工作区**（cwd） | 会话的工作目录，执行机上的真实路径 | ~~项目文件夹~~（UI 文案可用，文档统一「工作区」） |
| **确认卡**（confirmation） | agent 请求放行危险操作的卡片，等待/批准/拒绝，10 分钟超时 fail-closed | ~~guard 卡~~（guard 是机制名，卡片叫确认卡） |
| **收尾汇报卡**（run report） | 每轮 run 结束时确定性生成的总结卡（tone/结论/统计/耗时） | ~~总结卡~~（泛）、~~三段式~~（Sig 术语） |
| **等你处理**（needs you / attention） | 服务端派生态：有未处理确认卡。聚合入口在 header「◆ 等你 N」 | ~~待办~~、~~pending~~ |
| **卡死**（stalled） | 服务端派生态：running 且 15 分钟无事件 | ~~死锁~~、~~挂了~~ |
| **未读**（unread） | 会话有没看过的 assistant 动静（有人 attach 时不标） | — |
| **失联**（offline env） | 执行机断线：amber 语义，是「暂时不在」不是「失败」 | ~~断连/掉线报错~~（红=失败的语义留给真失败） |

## 设备与形态

| 词汇 | 定义 |
|---|---|
| **桌面**（wide，≥769px） | 两栏：侧栏（列表三区+pi 会话区）+ 会话页 |
| **手机/驾驶舱**（narrow，<769px） | 单栏。克制原则：无设置入口；显式例外 =「等你」聚合（只读）、「＋」新建（驾驶动作） |
| **接入设备** | 任何打开 hub 的浏览器窗口（PWA）。设备是窗口，会话是家 |

## 数据与机制

| 词汇 | 定义 |
|---|---|
| **pi 会话** | 终端里 pi CLI 产生的历史会话（.jsonl），可扫描/导入/搬运。导入后与原生会话无差别 |
| **迁移**（transfer） | 工作区跨执行机搬运：harvest → 中转 → 校准提示 |
| **分叉**（fork） | 从某 entry 岔出新会话（带 parent 历史） |
| **steer** | 运行中插话，排队到当前工具轮之后生效 |
| **幽灵流**（ghost stream） | 无人 attach 时的事件跟踪流（保 status/unread/收尾卡不失真） |
| **快照**（snapshot） | attach 时的全量状态对账基准 |
| **渠道路由** | /api/executors/:env/browse 类端点背后，「hub 出站 SSH → pi-env daemon」链路 |

## 状态机（服务端派生，永不手动设置）

```
会话列表三态：◆ 等你处理（pendingConfirms>0） / ▶ 运行中（status=running） / 项目分组（其余）
标志位：unread（有没看的动静）/ stalled（15min 无事件）/ offline env（执行机失联）
连接条：live / connecting / syncing / degraded（HTTP 轮询兜底）/ error
```
