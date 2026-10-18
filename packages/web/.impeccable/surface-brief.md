# Surface brief: DoraHub Web App（全部界面）

## Scope & mode

DoraHub 全部 Web UI（桌面两栏 ≥769px / 手机驾驶舱 <769px / 设置弹窗 / 所有组件），Operate 模式：高强度长时间盯屏的工作工具，效率与状态可读性高于一切。本次为 redesign：视觉层全换，IA 骨架（双模式布局/菜单结构/四页签）不动。

## Audience / job / constraints

单用户（将来开源给同事）：跨设备接力 agent 任务——看流式输出、steer、放行确认卡、管会话。硬约束：无 UI 库、深色自动跟随、弹窗 portal、手机输入 ≥16px、无障碍基线、不用 Inter/Arial/系统默认做主字体；否决项：程序员黑、边框方盒无语义堆叠、暖纸+terracotta 旧世界。

## Direction contract

THESIS: 框即语义——漫画原稿格的框语法承担全部状态语言，字体回归工作马。拒绝的类别默认：无框圆角卡片+柔和阴影+_terracotta_（旧世界）与纯 Linear 白（canon）。

OWN-WORLD: 原稿纸底（微蓝格纹理）+ 纯白面板；墨线框六类语法：实线墨框=人写的/待人操作（用户消息、确认卡、composer）；虚线开框=进行中（流式 agent 格、运行中工具卡、steer 输入态）；细线闭框=机器已完成（工具卡）；无框=agent 叙述；网点底=机器输出区（代码/diff/工具输出）；旁白条=系统通知。IBM Plex Sans/Mono 自托管，中文回退系统栈。

STORY: 访客一眼读懂状态——虚线=还在跑，实线=定了，红框=要我拍板；完成瞬间框缘闭合（dashed→solid 200ms）。

FIRST VIEWPORT: 桌面两栏：左 300px 目次栏（会话行，运行中=虚线框行，激活=实线框行，hairline 分隔非卡片），右主区：header 墨线底缘+mono 标签；消息流 760px 居中——用户消息=实线框白面板左对齐带 mono USER 标签，agent 叙述无框上纸，工具卡细线闭框带状态戳，代码=网点底；底部 composer 2px 墨框（steer 态变虚线蓝框）。

FORM: 用户 steer 融合（PICK 漫画原稿格 × CANON 工作字体纪律），居于本人候选清单第 3 位。seed:8fe104ada2287a18

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment

开框→闭框：任务完成的一瞬，虚线缘闭合成实线——"这一格画完了"。

## Unresolved decisions

无（字体自托管方式已定 @fontsource，npm 不可达时改 woff2 直落 public/fonts）。
