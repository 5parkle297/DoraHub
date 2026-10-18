# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

当前为个人工具：shiyu 一人，三台设备（workpc 主力开发 / laptop / phone PWA 驾驶舱模式）跨设备接力 agent 任务。

已确认的未来路线：版本稳定后开源为开箱即用的自托管应用，第一波预期用户是他的同事（已在等）。部署形态未定：单服务器多用户（负载待评估）或他人自建服务器 + 一整套 CLI 部署命令。设计需同时照顾"熟手驾驶舱"与"陌生用户第一眼能懂"。

## Product Purpose

跨设备持久化 Agent 平台：agent 会话状态住常开的云 VM（pi-durable + SQLite），任何设备用浏览器接入同一个会话——完整历史、实时流式输出、运行中 steer、远程放行/拒绝、崩溃自动断点续跑、工具执行路由到用户自己的电脑。替代"导出 md 总结→人工搬运→另一台机器重新理解"的跨设备协作方式。

## Positioning

会话不跟着设备走。对比通用 chat 网页版：DoraHub 的会话是持久驻留的服务端实体，设备只是接入窗口；工具执行不在云沙箱而在用户自己的电脑上（SSH 路由到注册的执行机）；pi 生态原生（pi-durable 会话语义、自写 markdown/diff 渲染、无 UI 组件库）。

## Operating Context

- 接入设备：workpc（Windows + Git Bash）、laptop、phone（PWA，手机驾驶舱模式 <769px）
- hub：阿里云 VM，systemd 常驻，Tailscale 私有组网，线上 https://hub.tail242752.ts.net
- 执行机三台：hub / workpc / laptop，会话各自指定执行机与 cwd，支持跨机工作区迁移
- 中文为主的用户环境；消息流主体是代码、命令输出、edit diff、确认卡
- 与 pi CLI 会话互通：扫描 / 元数据生成 / 导入 / 删除 / 跨机搬运

## Capabilities and Constraints

已上线功能：多会话管理（自动命名/描述/关键词/项目分组/执行机徽章）、免命名新建、软删除、/model 模型选择器（三渠道十模型）、执行机切换与迁移向导、pi 会话管理中心、自写 markdown 流式渲染、edit diff、双设备实时同步、运行中 steer、远程确认卡、断线重连。

用户拍板的硬约束：

- 信息架构 2026-10-18 定型：桌面两栏（≥769px）/ 手机驾驶舱（<769px）/ 设置四页签——重设计只换视觉层，不动 IA 骨架
- 不引 UI 组件库（ADR-010）；markdown/diff 渲染自写是特色，保留
- 深色模式自动跟随系统（prefers-color-scheme），无手动切换
- 主字体不用 Inter/Arial/系统默认
- 弹窗必须 portal；手机输入 font-size ≥16px；无障碍基线（对比度/focus-ring/键盘可达）
- 后端协议大改不做；小端点可以加

## Brand Commitments

名字 DoraHub 来自哆啦A梦（Doraemon），首个会话讨论确定，不改名。用户确认：哆啦A梦的元素理念与本项目机制相近，是品牌联想的来源。具体视觉转译留给设计阶段，不在此预设。

## Evidence on Hand

- design/00-12 完整设计决策记录（背景调研、需求、架构、协议、里程碑、风险）
- docs/handoff-frontend.md v3：现状全景、坑清单、验收基线 S1-S10
- 线上可运行实例：https://hub.tail242752.ts.net
- 现有暖纸浅色视觉系统：仅作为重设计的 anti-reference 与 evidence，不构成品牌资产
- 无用户数据、评价、案例等市场证据——开源宣传物料属未来工作，不得虚构

## Product Principles

1. 设备是窗口，会话是家：任何设备接入同一现场，永不需要交接文档
2. 现场感优先：流式输出、工具调用、确认请求实时可见，人随时能插话（steer）或叫停
3. 值得信任的持久：崩溃不是损失而是暂停，断点续跑是产品承诺
4. 工具在用户的电脑上跑：执行路由操作真实工作区，不是云沙箱玩具
5. 自托管者的门面：将来开源给同事与陌生人，第一眼的质量就是项目信用

## Accessibility & Inclusion

无障碍基线已列入验收：对比度、focus-ring、按钮键盘可达；中文环境字体栈必须有可靠中文回退；深色模式自动跟随系统。
