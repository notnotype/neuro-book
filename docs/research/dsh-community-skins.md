# DeepSeek Harness 社区皮肤的做法

- 日期：2026-11-05
- 问题：社区怎样给 DeepSeek Harness（DSH）换一整套皮肤（[w00041](../../.agents/works/w00041-themes-and-backgrounds/README.md)）：皮肤包含什么、怎样接进宿主、有哪些维护代价。
- 来源：[Awesome DSH Themes 的主题列表](https://github.com/Renakoni/awesome-dsh-themes/blob/main/THEMES.md)（132 个主题，按 Stars 排序）及各上游仓库，2026-11-05 读取。
- 证据等级：**自述**为上游 README 或文档原文；**文件树**为仓库文件大小与路径；**目视**为看主题列表或仓库里的预览图。没有安装运行任何皮肤。
- 状态：资料，不是设计依据。预览图只看到空会话页与个别截图，正在写的长对话是什么样没有看到。

## 1. 看了哪些

| 主题 | Stars | 是什么 |
|---|---|---|
| [深海女仆工坊 maid-atelier](https://github.com/Small-tailqwq/dsh-deep-whale) | 2,201 | 场景加两个角色，蕾丝与丝带装饰 |
| 同仓库的虎鲸链路 orca-link | 同仓库 | 全直角界面，重绘图标，状态角色 |
| [DSH-Transparent-UI-Plugin（Aqua）](https://github.com/WYH66666666/DSH-Transparent-UI-Plugin) | 407 | 磨砂玻璃，可铺视频或图片 |
| [Open Sea](https://github.com/d-dev0101/open-sea-skin) | 379 | 实时渲染的海面 |
| [滑动变祖](https://github.com/kingOfSoySauce/dsh-liang-skin) | 217 | 人物随滑块切换 |
| [dsh-catppuccin](https://github.com/NoNameLeGo/dsh-catppuccin) | 46 | 全界面换色，可选玻璃质感 |
| [达妮娅](https://github.com/Ewnscat-ya/dsh-client-ui-skin-denia) | 38 | 立绘、粒子、锁链边框 |

## 2. 一套皮肤包含什么

- **场景放在内容区，不是整窗底图**（自述）：maid-atelier 的背景与角色“整层挂在对话区内部”，随聊天区尺寸变化，位于聊天记录与输入器之下，“聊天态与着陆页按比例切换构图”。
- **角色与背景分层**（自述、目视）：maid-atelier 的角色是独立透明层，贴对话区左下、右下；达妮娅是左右立绘加 Q 版吉祥物。
- **按状态换内容**（自述）：orca-link 亮暗各一对空态、工作态场景，640 毫秒交叉淡化，左上角状态角色有十种状态；maid-atelier 为加载、思考、工具运行预留动画钩子；滑动变祖的人物跟随滑块档位。
- **控件形状**（自述）：orca-link 把按钮、输入框、卡片、菜单、弹窗、滚动条的圆角全部归零。
- **图标**（自述）：orca-link 运行时把官方图标重绘成只有水平线、垂直线、45 度折线与实心方块的图形，卸载时还原。
- **边角装饰**（文件树、目视）：maid-atelier 的素材有工作区徽记与丝带、侧栏角饰、设置窗口画框、输入框丝带，窗口四周一圈蕾丝。
- **品牌位**（自述、目视）：favicon、Web App 图标、标题栏品牌、空会话页的标题与台词（达妮娅、orca-link）。
- **失败页**（自述）：maid-atelier 给启动失败的错误页也加了装饰；皮肤自身没加载时保留原生页面。
- **明暗不只是反色**（自述、目视）：orca-link 亮色是白色机械舱、暗色是夜间书房；达妮娅亮暗对应角色的两种形态。
- **窄屏**（自述）：orca-link 在移动端隐藏大幅场景与舞台装饰；maid-atelier 支持窄屏重排。

## 3. 用户能调什么

- 皮肤各有自己的设置页（自述）：Open Sea 调波浪、日光、玻璃不透明度；达妮娅调亮暗各自的背景图；滑动变祖可开关遮罩与粒子，其中“背景遮罩”的说明是“仅柔化会话列人物，不覆盖文字或原生弹窗”。
- 多套皮肤不能同开（自述）：deep-whale 的 README 写明同时启用会让界面错乱，要装皮肤管理器做互斥。

## 4. 怎样接进宿主

- 皮肤是客户端插件，带 JS（自述、文件树）。Open Sea 写明 Harness 的客户端插件编进 Web bundle，“没有运行时安装 UI 插件的 API”，它的安装脚本要改宿主源码，加一个 `shell.background` 插槽。
- 宿主给的稳定接口（自述）：Open Sea 用了 `shell.background`、`sidebar.footer.action`、`settings.general.item` 三个插槽与 `ctx.theme.overrideTokens()`（可还原的颜色变量覆盖）；滑动变祖用了 `settings.section`。
- 其余靠覆盖宿主的 DOM 与 CSS（自述、文件树）：maid-atelier 的 `maid-atelier.module.css` 有 257,876 字节，orca-link 的有 163,795 字节，都带多个 TS 模块（`composer-scroll.ts`、`titlebar-brand.ts`、`mobile-drawer.ts` 等）。
- 素材随包分发，由皮肤自己的同源路由提供，不依赖远程地址（自述，maid-atelier、Open Sea）。
- 层叠的坑（自述）：Open Sea 记录给三列分别设 `z-index` 会把设置弹窗困在侧栏的层叠上下文里，所以把背景放在布局框架内部的 `z-index: -1`。

## 5. 维护代价

- deep-whale 仓库带专门的升级 Skill 与合同审计文档（文件树：`.agents/skills/dsh-skin-upgrade/references/contract-audit.md`，15,711 字节）；其 `AGENTS.md` 写明官方 DOM 结构变化时“按 slot 契约写选择器并留降级”，并记录过某选择器在新宿主已不存在。
- dsh-catppuccin 的 `docs/` 有多份随宿主版本写的适配审计（文件树：`desktop-0.2.0-adaptation-audit.md`、`issue-0.2.1-rc.5-adaptation-audit.md` 等）。
- Aqua 的 README 顶部声明作者没法及时跟上 DSH 的新 API，请用户自行修复或换别的（自述）。
- 同一皮肤对不同发行版不通用（自述）：deep-whale 要求 dsh-web 用户改装适配版，两者的“组件与样式契约不同，不能在同一 profile 中叠装”。

## 6. 版权

美术多有限制（自述）：deep-whale 代码 MIT、美术 CC BY-NC-SA 4.0；达妮娅写明为同人创作，角色属游戏厂商；Open Sea 另有第三方声明。这些素材都不能放进 NeuroBook。

## 7. 对照：NeuroBook 现有的主题

来自 [`packages/nb-ui/docs/authoring-themes.md`](../../packages/nb-ui/docs/authoring-themes.md)、[`theme/system.md`](../specs/theme/system.md)（源码与文档）：

- 主题是声明式的：CSS 变量取值、配色与静态资源，不能替换组件实现，不能带 JS。
- 文档写明主题与配色正交，“任意主题 × 任意配色都应该成立”。主题已能自带配色并给出缺省配色（`defaultColorway`）。
- 现有变量覆盖排版、密度、形状、装饰、动效、面与分隔的角色映射。没有场景、角色、边角装饰、图标集这些位置。
- 文档写“插件尚未开放”；[ADR 0022](../adr/0022-extensible-platform-and-plugin-trust.md) 已决定开放第三方可执行插件。两者的关系这里没有核实。
