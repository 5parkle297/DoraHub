# 05 · 同步协议 v1

> 形态：HTTP（命令）+ WebSocket（事件流）。协议版本字段 `proto: 1`，帧格式见 04 §4。本文定义帧的**语义细节**、客户端状态机和测试用例。

## 1. 设计原则

1. **权威状态只在 hub**。客户端是投影：attach 时拉 snapshot，之后只应用增量事件。客户端永不本地决策。
2. **事件即日志**。watchEvents 的事件批（一批 commit 一批事件）原样透传给前端 reducer，前端渲染状态 = reducer 应用结果。这让"断线重连"和"晚加入"统一成同一个动作：重拉 snapshot。
3. **命令走 HTTP**（幂等用 requestId），**流走 WS**。职责分离，排查问题容易（一条 curl 重放 vs 抓 WS）。

## 2. 事件类型对照表（watchEvents → 前端处理）

watchEvents 的产物（实验性 API，M1 时以 `test/examples/19-json.ts` 实测为准 ⚠️）：初始化给 `snapshot`（entries/run/生成中/tools/compactions/inbox/agent/usage），之后一批 commit 一批事件，含 `message_start`、`message_update`（text/thinking 的 delta、tool-call 参数 delta、输出 trim/append）、`tool_execution_start`、`tool_execution_end`、`compaction_start/end` 等。

前端 reducer 对应处理：

| 事件 | reducer 动作 | UI 呈现 |
|---|---|---|
| message_start | 新建消息槽 `{id, role, parts:[]}` | 气泡出现（打字光标） |
| message_update (text delta) | 追加到 parts | 逐字渲染（markdown 增量解析） |
| message_update (thinking delta) | 追加 thinking 区块 | 可折叠的"思考中"区 |
| message_update (tool-call args delta) | 累积参数 JSON | 工具卡片"准备参数"态 |
| tool_execution_start | tool 卡片 → running，流式 output 区打开 | 命令/路径 + 滚动输出 |
| tool_execution_end | 卡片 → done/error，记录耗时 | 折叠按钮（默认收起长输出） |
| compaction_start/end | 顶部出现"历史已压缩"标记 | 无侵入提示 |
| snapshot（重连时） | 整个会话状态重建 | 全量刷新 |

**背压策略**（对齐 pi-durable 官方语义 ✅）：客户端掉队 >100 批时，服务端发 `snapshot` 帧替代增量——前端收到 snapshot 帧时**丢弃本地状态全量替换**，不做合并。

## 3. 客户端状态机

```
            ┌─────────┐  attach ok   ┌──────────┐
  connect → │ syncing │ ───────────► │ live     │◄──┐
            └────┬────┘              └─┬───┬────┘   │ snapshot
                 │ snapshot fail        │   │ events │ (掉队>100批)
                 ▼                     │   ▼        │
            ┌─────────┐  ws close     │ ┌──────────┐│
            │ error   │ ◄─────────────┼─│ degraded ││ (无WS: HTTP仍可用)
            └─────────┘               │ └──────────┘│
                                      │◄────────────┘
              degraded/live 下任意时刻 ws 断开 → 指数退避重连 → syncing
```

- `live`：全功能
- `degraded`：WS 断但 HTTP 可用（罕见，比如 serve 出问题）——可以发消息，看不到流式，提交后轮询 snapshot 兜底（5s 间隔）
- `syncing`：重连成功后并发拉所有已 attach 会话的 snapshot

## 4. 会话列表的更新

列表页数据 = `GET /api/conversations` 的快照 + WS `conv_status` 增量。为避免为每个会话都开 watchEvents（资源浪费），server 对"无订阅者的会话"只维护 running/idle 状态（submit/abort 时置位 + settled 时回 idle，从 harness 的 submission 生命周期判断），不推细粒度事件。

## 5. steer 的完整时序（US-03 关键路径）

```
PWA           server                pi-durable
 │ POST /messages {mode:"steer"}    │
 │────────────►│ submit(whenBusy:"steer")
 │             │──────────────────►│ 消息入 inbox，标记 steer
 │             │◄───{submissionId} │（当前工具轮结束后进入运行）
 │◄────────────│                   │
 │ [UI: 消息以"排队/转向中"样式出现在 inbox 区]
 │             │ events: inbox 更新 + 随后 pi.user 落位
 │◄────────────│───────────────────│
 │             │   ...agent 下一轮看到它，行为改变...
```

注意 pi-durable 语义（README ✅）：steer 放在**当前工具轮之后**加入运行中工作；若会话空闲则等同普通 input。空闲时 steer 不会报错（自然降级），前端不区分处理。

## 6. 测试用例（M2/M3 的验收测试，写成 node:test）

| # | 用例 | 断言 |
|---|---|---|
| T-01 | 两个 WS 客户端 attach 同一会话，一端 HTTP 发消息 | 两端都收到相同事件序列；最终 snapshot 一致 |
| T-02 | 客户端 A 断线，期间 10 条事件发生，A 重连 | A 收到 snapshot 帧且状态与 B 一致 |
| T-03 | 慢客户端（每帧 sleep 500ms）持续 200 事件 | 服务端在某点发 snapshot 替代积压（背压语义生效），不 OOM |
| T-04 | steer 提交到 running 会话 | 200 + inbox 出现 + 后续 pi.user 落位 |
| T-05 | 同 requestId 重发 | 返回同一 submissionId（幂等 ✅） |
| T-06 | abort running 会话 | WS 收到状态变化；conversation idle；queued 提交被 withdraw |
| T-07 | hub 进程 SIGKILL 后 systemd 拉起 | WS 客户端重连成功 + snapshot 恢复 + 未完成任务继续（联动 11-S4） |
| T-08 | token 中间件（模拟 funnel 模式） | 无 token 401；错 token 401；对 token 200 |

## 7. 带宽账（为什么 v1 够用）

单用户场景，每会话事件流 = 文本 delta（几十 B/批）+ 工具输出（默认 100ms 批量 commit，进度类输出每批 ≤1KiB 量级）。tailnet 内（哪怕 DERP 中继）百 Kbps 级别绰绰有余。v2（watch() ops + 浏览器端 chord）留给多用户/移动网络弱网场景，M5 再议（ADR-004）。
