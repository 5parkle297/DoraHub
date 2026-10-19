---
name: DoraHub
description: 跨设备持久化 Agent 平台——原稿格工作台
colors:
  paper-ground: "#f4f1e9"
  paper-raised: "#ffffff"
  paper-sunken: "#ecebe3"
  paper-hover: "#eceae0"
  hairline: "#d8d4c6"
  ink: "#1c1a17"
  ink-soft: "rgba(28, 26, 23, 0.35)"
  text-dim: "#645f53"
  text-faint: "#6d6959"
  vermilion: "#c2372c"
  vermilion-soft: "#f6e3df"
  vermilion-deep: "#a52a20"
  seal-green: "#2e7d4f"
  seal-green-soft: "#e2efe5"
  amber-note: "#b07d10"
  amber-soft: "#f5ecd3"
  indigo-annotation: "#2c5f7c"
  indigo-soft: "#e3ecf2"
typography:
  body:
    fontFamily: "IBM Plex Sans, Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.08em"
  code:
    fontFamily: "IBM Plex Mono, ui-monospace, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.55
  stamp-micro:
    fontFamily: "IBM Plex Mono, ui-monospace, Consolas, monospace"
    fontSize: "10px"
    fontWeight: 600
  input-mobile:
    fontFamily: "IBM Plex Sans, Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "16px"
    fontWeight: 400
  welcome-display:
    fontFamily: "IBM Plex Sans, Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "32px"
    fontWeight: 700
  brand-wordmark:
    fontFamily: "M PLUS Rounded 1c, IBM Plex Sans, Noto Sans SC, sans-serif"
    fontSize: "22px"
    fontWeight: 800
rounded:
  xl: "14px"
  md: "10px"
  sm: "6px"
  stamp: "3px"
  scrollbar: "2px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-ground}"
    rounded: "{rounded.frame}"
    padding: "6px 14px"
  button-primary-hover:
    backgroundColor: "{colors.vermilion}"
    textColor: "#ffffff"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-dim}"
    padding: "6px 10px"
  frame-user-message:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.frame}"
    padding: "12px 16px"
  frame-confirmation:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.frame}"
    padding: "12px 16px"
  chip-keyword:
    backgroundColor: "transparent"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.frame}"
    padding: "1px 7px"
---

# Design System: DoraHub

## Overview

**Creative North Star: "原稿格工作台"（The Manuscript-Frame Workbench）**

DoraHub 的界面是漫画原稿的工作台：页面底是带浅蓝格纹的原稿纸，每条消息、每次工具调用都是原稿上的一格。框承担全部状态语言——**框即语义**：实线墨框是人写的或待人拍板的东西（用户消息、确认卡、输入区）；虚线开框是还在进行的事（流式输出、运行中的工具、steer 态）；细线闭框是机器已完成的事（工具卡静态）；无框是 agent 的叙述；网点底是机器的产出（代码、diff、命令输出）。状态变化不是颜色闪烁，而是框缘的开与合——任务完成的瞬间，虚线闭合为实线，"这一格画完了"。

字体彻底反装饰：IBM Plex Sans/Mono 是工作马，中文回退 Noto Sans SC，高强度长时间盯屏不疲劳。装饰性字体、字重游戏、字距游戏一概不要。唯一允许的"笔触"是朱砂红——它只出现在需要人出手的地方（确认卡、删除、错误），像原稿上的批注红。

**Key Characteristics:**

- 框即语义：实线=定了，虚线=进行中，细线=机器完成，无框=叙述，网点底=机器输出
- 原稿纸底 + 微蓝格纹（浅色 3.5% 不透明度，深色减半）
- 贴纸感阴影：offset 硬边 + 极轻柔化，浮层像贴在原稿上的白纸
- 朱砂红配额制：只给"等人拍板"的状态，绝不作装饰
- 工作马字体纪律：mono 承担全部标签/时间戳/代码，sans 承担正文
- 圆角阶梯三档（14/10/6px）：大而柔、小而锐，框语义不变（v3.1 迭代）

## Colors

一句话：原稿纸的暖白世界，墨线定形，朱砂点睛，蓝绿做注。

### Primary

- **朱砂（Vermilion）**（#c2372c）：人工确认色。确认卡边框、错误、删除按钮 hover、主按钮 hover。它的出现意味着"需要人出手"。
- **朱砂淡底**（#f6e3df）：确认/错误相关的浅背景块。

### Secondary

- **靛蓝批注**（#2c5f7c）：机器在工作色——agent 标签、流式虚线框、运行中工具卡/侧栏行、运行徽章、光标。朱砂=人的责任，靛蓝=机器的活动，完美对称。
- **次墨**（#645f53）/ **淡墨**（#6d6959）：次要/占位文本，全部底色上对比度 ≥4.5:1。

### Named Rules

**The 框即语义 Rule.** 任何组件的边框样式必须如实反映其状态：solid=已定，dashed=进行中。不允许"好看"的边框——边框是状态语言，滥用即失语。

**The 朱砂配额 Rule.** 朱砂红只出现在需要人拍板或出错的场合，单屏占比 <5%。它不是品牌装饰色，是"责任色"。

## Typography

**Body Font:** IBM Plex Sans（回退 Noto Sans SC / PingFang SC / Microsoft YaHei）
**Label/Mono Font:** IBM Plex Mono（回退 ui-monospace / Consolas）

**Character:** 全部自托管（@fontsource），无外部字体请求。Plex 家族同源的 sans/mono 保证混排和谐；中文由 Noto Sans SC 数百分片按 unicode-range 懒加载。

**Brand（字标专用）**：M PLUS Rounded 1c 800——日系圆体，只用于 DoraHub 字标（logo lockup），呼应 UI 圆角阶梯与哆啦A梦的品牌联想；正文/标签一律不碰。

### Hierarchy

- **Body**（400，14.5px，1.7 行高）：消息正文、设置描述。
- **Emphasis**（600，14.5px）：会话名、按钮、菜单项。
- **Label**（Plex Mono 600，11px，letter-spacing 0.08em，大写）：消息角色标签（你/agent）、分组计数、时间戳。
- **Code**（Plex Mono 400，12.5px，1.55 行高）：代码块、命令、diff、工具输出。
- **Title**（700，20px）：页面标题/品牌。
- **手机输入**（16px 固定）：iOS 防缩放红线。

### Named Rules

**The 工作马 Rule.** 不引入任何装饰性字体。字重只有 400/600/650/700 四档，没有字重游戏。

## Layout

- 桌面两栏（≥769px）：左 300px 侧栏（原稿目次）+ 右主区。侧栏右缘 1.5px 墨线分隔。
- 手机驾驶舱（<769px）：单栏，会话页 header `[←] 标题 [⋯]`，管理功能收进菜单。
- 消息流 760px 居中，行距 16px；消息间距 16px，视觉分组靠框语法不靠空白。
- 间距 4 基（4/8/12/16/24/32）。
- viewport-fit=cover + safe-area-inset 适配刘海屏。

## Elevation & Depth

贴纸感：浮层是"贴在原稿上的白纸"，阴影带 offset 硬边 + 极轻柔化，深色模式换成纯黑影。

### Shadow Vocabulary

- **shadow-1**（`1px 1px 0 rgba(28,26,23,.08), 0 1px 3px rgba(28,26,23,.05)`）：消息格、侧栏激活项的微浮。
- **shadow-2**（`2px 4px 12px rgba(28,26,23,.09), 0 2px 6px rgba(28,26,23,.06)`）：composer、确认卡。
- **shadow-pop**（`3px 3px 0 rgba(28,26,23,.12), 0 12px 40px rgba(28,26,23,.18)`）：弹窗、下拉菜单。

### Named Rules

**The 贴纸 Rule.** 阴影 offset 方向恒为右下（光源左上）。浮起=贴纸，不追求"悬浮在空中"的玻璃感。

## Shapes

- 圆角阶梯：14/10/6px（大/中/小）+ 状态戳 3px + 滚动条 2px。
- 框线宽度两档：1px（细线闭框/hairline）与 1.5px（实线墨框/虚线开框）。
- 状态戳：3px 圆角小方戳，-3° 旋转，像盖章。

## Components

### 消息格（签名组件）

- **用户消息**：实线墨框（1.5px solid ink）+ 贴纸白底 + shadow-1，Plex Mono "你" 标签朱砂色。
- **Agent 叙述**：无框，直接上纸。
- **Agent 流式**：虚线开框（1.5px dashed 靛蓝），完成瞬间 `frame-close` 动画（dashed→transparent 0.22s）——签名动作"框缘闭合"。
- **思考过程**：细线闭框可折叠，Plex Mono 灰字。

### 工具卡

- 细线闭框（1px solid ink-soft）；运行中变虚线开框。
- 头部行：状态 icon + 工具名（朱砂 mono）+ 参数摘要（mono 灰）+ 时长。
- **状态戳**：done→「讫」绿、error→「误」红、blocked→「阻」红，右上角 -3° 旋转盖章。
- 展开区：网点底 + mono 输出 / diff 表（del 红底/add 绿底）。

### 确认卡

- 朱砂实线框（1.5px solid vermilion）+ 脉动动画——整屏唯一红色框，视线自然落点。
- 命令区：网点底 mono；操作按钮右对齐，主按钮墨底。

### Composer

- 实线墨框砚台；steer 态变虚线靛蓝框 + 蓝淡底——"这句话要插进运行中的格"。
- textarea 16px（iOS 红线），发送按钮墨底。

### 侧栏会话行

- 常态：无框目录条目，hover 微底色。
- 运行中：虚线开框 + 贴纸白底（格还在画）。
- 当前：实线墨框 + shadow-1（当前格）。
- 徽章：执行机（靛蓝 mono 淡底）、运行中（绿 mono 淡底 + 脉动）、关键词（hairline 描边 mono 小签）。

### 弹窗

- 1.5px 墨线框 + shadow-pop + 14px 圆角，全部 portal 到 body（backdrop-filter containing block 坑）。
- 设置四页签：底边 2px 指示线，激活页签朱砂色。

## Do's and Don'ts

### Do:

- **Do** 用边框样式表达状态（solid/dashed 是状态语言）。
- **Do** 每个工具卡完成时带状态戳（讫/误/阻）。
- **Do** 保持朱砂红的稀缺性——它是责任信号不是装饰。
- **Do** 中文环境用 Noto Sans SC 回退，mono 只给代码/标签/时间戳。
- **Do** 深色模式全部 token 自动跟随 prefers-color-scheme。

### Don't:

- **Don't** 引入 UI 组件库或装饰性字体（ADR-010 + 工作马纪律）。
- **Don't** 用暖纸+terracotta 旧世界（anti-reference）。
- **Don't** 给卡片加彩色左边条（side-tab 反模式，detect 已清零）。
- **Don't** 用 emoji/unicode 字符当图标（现有 icon 是文本符号，逐步替换为 SVG 中）。
- **Don't** 在手机上把输入框 font-size 降到 16px 以下。
