# 10 · 里程碑分解

> 原则：每个里程碑结束都有**可演示的东西**；M1-M3 完成即 MVP（简历可写）；M4/M5 是增量加分。工时按"一人、业余时间、有 AI agent 协助"估算。

## M0 · 网络地基（0.5-1 天）

| # | 任务 | 产出 |
|---|---|---|
| 0.1 | 四台设备装 Tailscale、登录同账号、MagicDNS 命名（hub/workpc/laptop/phone） | `tailscale status` 全绿 |
| 0.2 | hub 上 serve 占位服务（03 §2 命令） | 手机浏览器打开 https://hub.<tailnet>.ts.net 见目录页 |
| 0.3 | V-06 手机共存性验证（Tailscale vs v2ray） | 结论回写 00，定模式 A/B |
| 0.4 | （顺手）hub 开 Tailscale SSH，workpc 免密 ssh 通 | 应急通道可用 |

**里程碑验收**：03 §7 清单全勾。到此网络层毕业，后面所有里程碑默认跑在它上面。

## M1 · pi-durable 跑通（1-2 天，全在 hub 或本地终端）

| # | 任务 | 产出 |
|---|---|---|
| 1.1 | workpc 本地建仓（09 结构，仅 server 包） | `npm i` 干净装完（版本锁定） |
| 1.2 | V-02：pi-ai 自定义端点接 zjl 中转 | 一个最小脚本：Harness + MemoryStorage + 一次 submit 得到模型回答 |
| 1.3 | 换 SQLite storage，root 会话 + 两个额外会话 + fork | `agent.sqlite` 可查（sqlite3 CLI 看表结构，**这也是理解 pi-durable 存储的第一手材料**） |
| 1.4 | 终端 TUI 试玩脚本（node --watch）：submit / steer / abort / watchEvents 打印 | 肉眼确认：流式事件、steer 插队、inbox 排队 |
| 1.5 | 崩溃演练：跑长任务 → Ctrl+C / kill -9 → 重启脚本 resume() | 11-S4 剧本的命令行版通过 |

**关键学习动作**：通读 pi-durable 的 `test/examples/`（30+ 官方示例，特别是 19-json.ts、22/23-subagent、06-crash-recovery 类）——README 明确欢迎 agent 这样学。**把 19-json.ts 的事件流逐类打印**，它就是 05 协议的原始素材。

## M2 · hub 服务端（1 周业余）

| # | 任务 | 对应设计 |
|---|---|---|
| 2.1 | http-api.ts 全部路由 + shared/api.ts 类型 | 04 §3 |
| 2.2 | ws.ts：attach/detach/扇出/背压（snapshot 降级） | 04 §4、05 §2 |
| 2.3 | events.ts 裁剪层 | 04 §4 |
| 2.4 | GuardExtension + confirmations API + WS 帧 | 04 §5 |
| 2.5 | systemd + deploy.sh + serve 挂载 | 04 §7、09 §3.3 |
| 2.6 | 测试 T-01~T-08（05 §6，node:test + ws 客户端模拟） | 全绿 |

**里程碑验收**：curl 能建会话发消息拿 submissionId；两个 wscat 终端 attach 同一会话看到相同流；`systemctl kill -s SIGKILL` 后 5 秒内恢复且 WS 客户端自动重连成功。

## M3 · PWA 客户端 = MVP 完成（1.5-2 周业余）

| # | 任务 | 对应设计 |
|---|---|---|
| 3.1 | Vite+React 壳：路由、conn 状态机、WS 单例 | 06 §2-4 |
| 3.2 | 列表页 + 新建会话 | 06 §2 |
| 3.3 | 会话页：快照 → 事件 reducer → 消息流渲染 | 05 §2、06 §2 |
| 3.4 | 工具卡片三型（bash/read/edit+diff）+ 流式输出 | 06 §2 |
| 3.5 | Composer：普通/steer 开关/abort | 06 §2 |
| 3.6 | 确认卡片（震动+置顶） | 06 §2 |
| 3.7 | 断线重连 UX + degraded 轮询兜底 | 06 §4 |
| 3.8 | PWA manifest + sw + 手机安装 | 06 §1 |

**里程碑验收 = 11 号文档 S1/S2/S3/S4 四个剧本全部通过**。**简历此刻可写**。

## M4 · 远程执行（1-1.5 周业余）

| # | 任务 | 对应设计 |
|---|---|---|
| 4.0 | V-01：npm view @earendil-works/pi-env；读 pi-durable 的 env .d.ts 补全接口 | 07 §1 |
| 4.1 | exec-agent：连接/心跳/白名单/双模式 shell | 07 §3-5、08 §3 |
| 4.2 | ExecRegistry + RemoteExecutionEnv | 07 §4 |
| 4.3 | buildEnv 接线 + 会话 envId 文档 + 创建会话时选机 | 07 §4 |
| 4.4 | serve --tcp 暴露 8790 | 07 §6 |
| 4.5 | 验收清单（07 §7） | 全勾 |

**里程碑验收**：11-S5 剧本通过（手机遥控 workpc 执行）。

## M5 · 加分项自助餐（每项独立，按兴趣选）

| 项 | 价值 | 估时 |
|---|---|---|
| headscale + derper 自托管 | 网络/分布式叙事最厚 | 2-3 天 |
| 旧 pi JSONL 会话导入器 | pi 深度理解叙事 | 1-2 天 |
| watch() ops 协议 v2 | 带宽优化 + chord 学习 | 2-3 天 |
| Web Push（iOS 16.4+） | 移动端完整性 | 1 天 |
| usage 面板（pi.usage） | 产品完成度 | 0.5 天 |
| 子代理面板（subagent 事件） | 展示 watchEvents 深度 | 1 天 |
| Docker 化 hub | 部署工程叙事 | 0.5 天 |
| ACL 收紧（tag:hub/tag:exec） | 安全叙事 | 0.5 天 |

## 时间线汇总（乐观估计，业余节奏）

```
M0        M1        M2            M3(MVP)        M4
├── 1d ───┴─ 1.5d ──┴──── 1w ─────┴──── 2w ──────┴── 1.5w ──►
          ↑                                   ↑
     pi-durable 手感                    简历可写点
```

## 节奏纪律

1. **每个里程碑收尾时**：git tag（`m0`、`m1`…）+ 录一段 30-60 秒演示视频存 `docs/demos/`（11 号剧本当脚本）——简历素材随手积累
2. 卡住超过半天：把卡点写进 12 号文档 FAQ 区再求助/换思路，不在一个坑里过夜
3. 设计文档是活的：实施中发现的偏差**当天回写**对应文档（这正是它存在的意义）
