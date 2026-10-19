# DoraHub Roadmap（超出当前会话scope的中长期项）

> 本文档只收"已经想清楚但不该现在做"的事。当前会话的任务永远以 docs/handoff-frontend.md 为准。
> 每项开工前：先回读本文档对应小节（避免重新发明），然后把它改写进 handoff 的当前任务再动手。

## 1. 多用户隔离（同事接入前的前置 milestone）

**背景（2026-10-19 用户拍板）**：近期形态 = 邀请制小团队共享同一个 hub（≤3 人，Tailscale 免费版上限）；每人自己注册 Tailscale 账号、自己管设备，被邀请进 tailnet；远期开源 self-hosted（类 Gitea，每团队一实例，docker compose 一键起）。**永不做多租户 SaaS。** 模型 key = BYOK（同事填自己的 provider+key，不共用站长的）。

### 后端任务（UI 稳定后做）

1. **身份中间件**：http-api 读 serve 注入的 `Tailscale-User-Login` 头 → request 注入 userId；本地 dev 无头时默认 admin
2. **ConvMetaDoc 加 owner 字段**：新建会话写 owner；列表/快照/WS attach 按 owner 过滤（v4 → v5 迁移：老数据 owner = admin）
3. **执行机归属校验**：执行机注册时记 owner；他人会话只能路由到 hub 或自己的执行机（默认策略：他人 = hub only）
4. **BYOK 渠道存储**：per-user channels（key 不进 git，sqlite 或独立 json）；/api/models 按请求者返回其可见渠道
5. **迁移并发限制**：transfer 同时只跑一个（信号量），防止打满小水管带宽
6. hub 加 1G swap 防 OOM（无 swap 现状 + systemd 拉起间隔会断会话）

### 运维任务（进人前必做，无代码）

7. **收紧 tailnet ACL**（默认 allow-all，同事能直接 SSH 你的电脑）：
   - 同事用户 → 只能访问 hub 的 443（serve）
   - hub → 可 SSH 执行机（出站连接）
   - 站长本人 → 全通；同事之间互不可见
8. 邀请流程文档化：同事自己注册 Tailscale → 站长管理台邀请 → 装客户端 → 打开 hub URL

### 前端（早就该做的口子，随多用户 milestone 一起）

9. header 容纳用户名/头像；设置弹窗加"我的模型渠道（BYOK）"页签

### 负载评估备忘（2026-10-19 实测 hub：2C/1.6G/40G，当前用量 <5%）

- 每活跃会话 ≈ 2-5MB 内存、<5% 单核（LLM 是 API 转发无本地推理）；SQLite 已开 WAL，10 人量级无压力
- 真瓶颈是带宽：文字流式 5-50KB/s 无感；工作区迁移（50MB/文件、200MB/总）是突发大头 → 任务 5 的并发限制就是为这个
- 3 人规模：性能完全不是问题，隔离（任务 1-4）才是进人前唯一硬前置

## 2. 开源发布（版本稳定后）

- self-hosted 定位：一台常开机器（云/家用/NAS）即可，docker compose 或 `curl | bash`（node + systemd + env 向导 + tailscale 检查）
- deploy/ 已有 systemd 单元和发版脚本做底子
- README 重大改动表持续维护（已立规矩）
- 发布前：脱敏检查（env 样例、key 泄漏扫描）、快速开始文档化、demo GIF

## 3. 现有 backlog（功能债，随缘）

- P1：usage/cost 面板、compaction 标记、fork 选点、会话配置编辑、会话页 degraded 兜底、虚拟列表、PWA 图标/Web Push
- P2：thinking 动效区分、图片消息展示、pi 导入 system 消息处理
- 手机接入：NovaScale 实测或 Funnel+token（用户说先不管手机）
