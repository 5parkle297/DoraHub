# 06 · PWA 客户端设计

## 1. 技术形态

- **Vite + React 18 + TypeScript**，构建产物纯静态文件
- 部署：build 出的 `dist/` 由 hub 的 server 直接静态托管（`GET /` 返回 index.html）——**一个进程服务 API + UI**，serve 一次挂载全搞定
- PWA：`manifest.webmanifest`（名称 DoraHub、图标、`display: standalone`、theme color）+ 极简 service worker（只做 App Shell 缓存；**不缓存 API/WS**，状态永远来自 hub）
- 手机"安装"：浏览器 → 添加到主屏幕 → 全屏无地址栏，即"app 体验"

## 2. 页面结构与路由

```
/                       → 会话列表（Redirect 到 /conversations）
/conversations          → 列表页
/conversations/:id      → 会话页（核心页面）
/settings               → 连接设置（hub 地址、token、主题）
```

### 列表页
- 数据：`GET /api/conversations` + WS `conv_status` 增量
- 每项：名称/ID 短码、running 徽章（呼吸动画）、模型、目标机（envId）、最后一条消息预览、updatedAt
- 操作：新建（弹层：名称/envId(M4)/模型/cwd）、进入、归档（v1 可后置）

### 会话页（信息架构，移动优先）

```
┌────────────────────────────────┐
│ ◀ 会话名        [模型▾] [⋯]     │  ⋯菜单: compact / fork / abort / 配置
├────────────────────────────────┤
│  [系统提示条: 已压缩历史 (若有)]   │
│                                │
│  消息流（滚动区，虚拟化）          │
│  ├ user 气泡                    │
│  ├ assistant 气泡（markdown）    │
│  │   └ thinking 折叠块          │
│  ├ tool 卡片：                  │
│  │  ┌ bash ──────── 2.3s [▾] ┐ │
│  │  │ $ npm test              │ │
│  │  │ …输出流式滚动…            │ │
│  │  └─────────────────────────┘ │
│  ├ [steer 消息: 斜体+插图标]     │
│  └ [待确认卡片: 允许/拒绝]        │
│                                │
│  [inbox 排队区（有排队时显示）]    │
├────────────────────────────────┤
│ [▶ steer 开关]  输入框…  [发送]  │
└────────────────────────────────┘
```

- **steer 开关**：默认关（普通发送=follow-up 排队）；打开时发送即 steer，输入框边框变色提示
- **工具卡片**是自定义渲染重点：bash 卡片等宽字体、read 卡片显示文件名+行数、edit 卡片显示 diff（自己写个 ~100 行的两栏 diff 组件，简历细节）
- **待确认卡片**（US-05）：红色边框置顶 + 震动（navigator.vibrate，Android）
- **流式渲染**：markdown 用 marked/tokenizer 但**增量段落**渲染（每消息维护已完结段落+当前段落 buffer），避免每 delta 全量重解析

## 3. 状态管理（无全局库）

```
AppCtx: { connState, hubUrl, token }           // localStorage 持久化 hubUrl/token
ConvCtx(per route): { status, view, dispatch } // view = reducer(初始snapshot, 事件流)
  view = { entries[], live{partial, tools[]}, inbox[], agent, usage }
```

WS 单例挂在 App 层，`attach/detach` 随路由切换。事件按 convId 分发到对应 ConvCtx。

## 4. 断线重连 UX

- 顶部细条：`live`(绿) / `syncing`(黄,转圈) / `degraded`(橙) / `error`(红+重试按钮)
- 重连成功后自动滚到消息流底部（若用户没在向上翻阅——距底 >200px 则保持位置并显示"↓ 新消息"气泡）

## 5. 移动端适配要点

- 输入框 `font-size ≥ 16px`（iOS 防聚焦自动放大）
- 安全区：`viewport-fit=cover` + `env(safe-area-inset-*)`（刘海屏）
- `touch-action` 处理长按/滑动；虚拟键盘弹出时滚动区自适应（`visualViewport` 监听）
- 桌面端同一套代码：宽度 >768px 时会话页变两栏（列表常驻左栏）

## 6. 面试可讲的实现细节（刻意保留在方案里）

| 细节 | 讲什么 |
|---|---|
| 增量 markdown 渲染 | 流式 UI 的性能：段落级 buffer + 防抖 rAF |
| 工具卡片 diff 视图 | 自己写 Myers diff 简化版，或者用 diff 库但要讲清为什么 |
| WS 背压处理 | snapshot 帧丢弃本地状态的协议约定（05 §2） |
| PWA 缓存策略 | 为什么 API 不缓存（权威状态单点原则） |
| 虚拟列表 | entries 过千时的渲染策略（react-window 或自写） |
