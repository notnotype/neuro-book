---
schema: nbook.task/v2
taskId: t74-workbench-titlebar
---

# 外壳四：标题栏与状态栏

## 目标与范围

开发者 2026-10-10 要求完善 web 主页面的外壳，把旧应用的标题栏迁过来，迁移中可以排错、优化与调整样式。现在的标题栏只有“NeuroBook”和项目短名两段文字；状态栏只有项目名与“显示面板”，也没有让插件放条目的接口。外壳 Spec 把这些明确留到外壳一到三之后：标题栏的菜单、搜索、窗口控制，以及状态栏与标题栏条目的贡献点。

实施计划见 [plan.md](plan.md)。拟定范围：

- **标题栏**：迁移旧应用 `DesktopTitleBarShell` 一组零件（`packages/neuro-book-legacy/app/components/desktop-title-bar/`），按新应用的命令重新接线：
  - 品牌；
  - 菜单：文件、编辑、视图、帮助，每项是一条命令；
  - 居中命令搜索：点开命令面板；
  - 项目切换：与 t75 书架共用作品列表；
  - 布局按钮：侧栏、面板、右栏。
  - 桌面窗口控制等有了桌面宿主再做。
- **贡献点**：状态栏条目、标题栏操作。第一批使用者从编辑器区与资源管理器里选，例如光标位置、未保存数量；只显示真实数据。
- 每个迁移的组件带同名 `.md` 与 Lab 场景。

行为合同：[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)（新增“外壳四”）、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)。

## 计划须回答的问题（t73 计划审查，2026-10-10）

omp 审查（报告在 [t73 证据](../t73-lab-nb-ui-and-storage/evidences/design-review.txt)）对本 Task 的范围提出的条目，写计划时逐条回答：

- **P07 菜单映射**：旧标题栏 15 个菜单 id 逐个对到新命令。每项写明是现成命令、需要参数适配的命令、浏览器里不画，还是留待以后。
  - 例子：`file.open` 不能直接别名到要求 `{address, mode}` 的 `nbook.editor.open`；
  - 剪贴板、退出、缩放这类桌面动作，在浏览器里不画成假入口。
  - 菜单由“能力模型”生成：每项带 canonical 命令、可见条件、禁用原因、参数工厂（F04）。先写纯模型测试，再迁 Vue 零件。
- **P08 贡献点合同**：先在外壳 Spec 定义 `workbench.titlebar-items` 与 `workbench.statusbar-items`，内容包括：
  - 声明、实现、排序、槽位，`when` 与公开状态；
  - 同 id 冲突、插件停止时撤回、窄屏按优先级折叠（F05）；
  - 外壳不直接读领域状态，条目数据由 owner 经公开状态提供。
- **P09 验收**：要验收以下几项：
  - 标题栏 36px、状态栏 22px，菜单从完整到紧凑的切换阈值；
  - 无项目时的呈现，以及编辑焦点在编辑器、原生输入或别处时的禁用原因；
  - 菜单的键盘与焦点行为；
  - 未实现的项不渲染。

## 前置

[t73](../t73-lab-nb-ui-and-storage/README.md)。

## 当前状态

- 2026-10-10 建立，未开工；t73 计划审查对本 Task 的三条意见见上。
- 2026-10-10 计划起草（[plan.md](plan.md)），逐条回答 P07–P09、F04、F05；交 omp 计划审查。
- 2026-10-10 omp 计划审查（一个会话）：13 条（阻断 1、重要 11、建议 1）与补充功能 3 条，全部成立，报告 [evidences/plan-review.txt](evidences/plan-review.txt)。计划按审查修订，处理表在 plan.md 的“计划审查的处理”。主要变化：
  - 菜单作用于活动编辑器，不按焦点区分（P1）；
  - 宿主增加“重新载入”和“新标签打开”两个端口（P2）；
  - nb-ui 菜单的叶子项接入 reka 的导航集合，菜单项增加 `description`，单独成为 S1（P3、P7）；
  - Part 的可见性定义与公开键（P6）；条目的公开键与溢出预算（P8、P11）；宽度三档，任何宽度都保留菜单入口（P10）；
  - 跳到行不接（P9）；光标位置只在源码编辑器显示，另加字数条目（P12）；快捷键按平台格式化（P13）。
  - 产品取舍登记在 [待开发者确认](../../pending-confirmations.md)。
- 2026-10-10 S0 完成（Spec，新增条目都标“planned”）：
  - `ui/workbench-shell.md`：新增“外壳四”输出 28–35（标题栏结构、应用菜单的能力模型与条目表、宽度三档、菜单键盘与焦点、Part 可见与 `set-part-hidden`、三个可见性公开键、条目贡献点、溢出、状态栏布局），验收 32–39；非目标改为只剩桌面窗口控制。
  - `workbench/commands.md`：`set-part-hidden`、应用命令 `nbook.app.reload` 与 `nbook.help.documentation`、快捷键的显示、旧桌面 15 个 id 的去向；验收 17、18。
  - `workbench/editor.md`：两个公开键、三个状态栏条目（输出 26–28，字数算法与光标坐标）；验收 12–14。
  - `runtime/browser-host.md`：`windowNavigationKey` 的 `reloadDocument`、`openExternal`。
- 2026-10-10 S1 完成（nb-ui 菜单）：
  - `MenuNodes` 可以接收所在根的 reka 菜单项原语；Dropdown、Menubar 的一级菜单改用 reka 的菜单项，上下键、Home、End、首字母、跳过禁用项、Enter 选择由 reka 负责（之前叶子是普通按钮，reka 的漫游找不到它们，Dropdown 的 `data-highlighted` 样式也从未生效）。手工级联面板与右键菜单仍是普通按钮，键盘照旧。
  - 菜单项的 `title`（Dropdown 原有、Menubar 与右键菜单新增）渲染为原生提示与 `aria-description`，禁用项也带上（计划里叫 `description`，沿用 Dropdown 已有的 `title` 字段，不另加名字）。
  - Menubar：`variant` 加 `flat`；`modelValue` 统一为当前打开的组 id（原先只在选中条目时发出、值却是条目的 value，文档登记为已知偏差，现在修掉）；去掉阻止关闭后还焦点的处理（没有记录原因，文档本来就写焦点由 reka 管）。reka 把 `MenubarRoot` 这个事件的类型声明成 `boolean`，实际是字符串，处理函数按 unknown 收窄。
  - 实测：用左右键换组后按 Escape，reka 把焦点还给最初打开菜单的组标题，符合外壳 Spec 输出 31 的“回到打开菜单之前的位置”，已写进 `Menubar.md`。
  - 验证：nb-ui 与 neuro-book typecheck；nb-ui Vitest 515 例（另 5 例是已知的 Node 26 环境失败）；`lab-nb-ui.e2e.ts` 7 例（新增菜单栏与下拉菜单的键盘与禁用原因两例）、`lab-scenes.e2e.ts`；变异 3 个全杀（Dropdown、Menubar 不传 reka 菜单项，不转发菜单开合）。
  - 顺带修正 t75 S1 测试的字面量类型（`SpineShelf.dom.test.ts`，写测试前跑的类型检查没覆盖到）。
- 2026-10-10 S2 完成（宿主端口与命令）：
  - `WindowNavigation` 增加 `reloadDocument`、`openExternal`；浏览器窗口的选项从单个 `navigateDocument` 改为整个 `navigation`。`openExternal` 不用 `noopener` 特性（带上时 `window.open` 总返回 null、分不出是否被拦截），打开后再切断 `opener`。
  - 新命令 `nbook.app.reload`、`nbook.help.documentation`（`app-commands.ts`，文档站 `https://notnotype.github.io/neuro-book/`）与 `nbook.view.set-part-hidden`（`part-commands.ts`，省略 `part` 时经选择）。
  - 布局 store 的 `setPartHidden(part, false)` 在同一次提交里清掉隐藏与拖到零；新增 `partVisible`；外壳里活动栏打开侧栏的路径改为只调它（原来分两次提交）。公开键 `sidebarVisible`、`auxiliaryBarVisible`、`activityBarVisible`。
  - `formatKeybinding`（`keymap.ts`）：macOS 写 `⇧⌘P`，其它写 `Ctrl+Shift+P`；命令面板改用它。
  - 验证：typecheck；工作台命令与状态 Bun 60 例（新增 `part-commands.test.ts`、`keymap.test.ts` 一例）；`workbench-shell`、`projects`、`workbench-views` e2e 34 例；变异 2 个全杀。
- 2026-10-10 S3 完成（菜单能力模型）：`titlebar/menu-model.ts` 的 `buildMenus` 与产品定义 `TITLEBAR_MENUS`。菜单以“节”表达分隔线，空节不画；同一命令带不同参数的条目由定义给自己的标题（侧栏、右栏、活动栏、面板），外壳 Spec 输出 29 补了这一句。`menu-model.test.ts` 5 例（真实命令注册表与上下文键）；变异 2 个全杀。
- 2026-10-10 S4 完成（条目贡献点与溢出）：
  - 声明与校验 `shared/items.ts`（两个贡献点共用 `itemValidator`，标题栏只接受右侧；同 id 的两条由内核一起拒绝）；实现合同 `ItemImplementation`（`web/contracts.ts`）。
  - `items/registry.ts` 的 `ItemRegistry`：`when` 经公开状态服务 `publicStateKey` 读（工作台新增这个依赖）；句柄失去 `published` 的那一刻就不再显示、不再调用实现；实现抛错原位显示为出错且不可点，同一句柄只记一次诊断。工作台入口登记两个贡献点、各一个注册表（S5 接进外壳）。
  - `items/item-strip.ts` 的 `layoutStrip`：放不下时先给“更多”留位，再按优先级依次放，第一个放不下的和它之后的都收起。实现时把外壳 Spec 输出 34 的写法改严格了：原写“放不下时留位再继续放”有歧义，现在写明“优先级高的总在优先级低的之前显示”。
  - 组件 `WorkbenchItemStrip`（同名 `.md`、Lab 三个场景）：有命令的是 ghost 按钮、没有的是 `role="status"` 文字；隐藏测量层量宽度；收起的进 nb-ui 下拉“更多”。
  - 验证：typecheck；`items/` Bun 11 例（注册表 5 例用真实内核）；`WorkbenchItemStrip.dom.test.ts` 3 例；web 与工作台、命令 Bun 246 例；Lab 截图（手机宽度只留优先级最高的三项，其余进“更多”）；变异 4 个全杀（“不给更多留位”第一次存活，补了能区分的用例）。
  - 我自己长开的开发服务没吃进新组件文件，Lab 打不开新组件；重启后正常。
- 2026-10-10 S5 完成（标题栏与外壳接线）：
  - 组件 `WorkbenchTitleBar`（同名 `.md`、Lab 三个场景、组件测试 3 例）：品牌、应用菜单（完整时 nb-ui `Menubar` flat，紧凑时“菜单”按钮按组分节）、居中搜索（带按平台写的快捷键）、项目切换、三个布局按钮、条目区；三档宽度按标题栏边框盒的实测宽度；Alt 单独松开或 F10 聚焦菜单入口，菜单关着时 Escape 还焦点。
  - `titlebar/titlebar-source.ts` 的 `createShellChrome`：菜单、搜索快捷键、两侧条目与条目执行，命令增减经 `onDidChange` 推进版本号。工作台插件建它、经首页交给外壳；外壳的标题栏换成新组件（没有它时保留原来的品牌与项目名），状态栏接上左右两侧的条目条。
  - 修 nb-ui `Menubar` 的两个真实缺陷（真实 Chrome 复现）：一个菜单关闭后还在退场动画里时，它的外部点击与焦点移出处理仍会关掉整条菜单栏，于是“关掉一组后立刻打开另一组”打不开（指针按在别的组标题上；或新开的一组条目全禁用、焦点落进菜单内容）。改为已关闭的组不再因外部点击或焦点移出关闭菜单栏，按在组标题上也不算外部点击；`lab-nb-ui.e2e.ts` 补了回归。
  - e2e `workbench-titlebar.e2e.ts` 5 例（生产构建，外壳 Spec 验收 32–37）：高度与菜单内容、从菜单撤销（点击与 F10 两条路径）与 Escape 还焦点、宽度边界 959/960 与 599/600 与 390、区域显隐三条路径一致、重新载入的离开确认（取消与确认）与在新标签打开文档（文档站地址被拦到本地回应）。
  - 验证：两个包 typecheck；nb-ui Vitest 515 例（另 5 例为已知环境失败）；工作台与 Lab Vitest 53 例；`workbench-titlebar`、`lab-nb-ui`、`lab-scenes`、`workbench-shell` e2e 全过。
- 2026-10-10 S6 完成（编辑器的状态栏条目）：
  - 共享的 `countWords`（`src/shared/word-count.ts`，3 例）：汉字、假名、谚文每字计 1，拉丁字母与数字连成一个词（可夹撇号、连字符），frontmatter 不计；t75 的书架统计用它。
  - 编辑器区新增 `openDocuments`（按文档去重）；控件句柄新增可选的 `position`，只有源码编辑器实现（选区活动端）。公开键 `hasUnsavedDocuments`、`hasCursorPosition`。
  - 三个状态栏条目（`status-items.ts`）：未保存数（点击全部保存；提示列出至多 5 个文件，正在保存与保存失败另写，失败时为错误状态）、活动文档字数、光标位置。
  - 验证：typecheck；`status-items.test.ts` 4 例（真实 Files 场地；保存失败用只读目录造出）；编辑器与宿主 Bun 104 例；`editor-area.e2e.ts` 全部（新增条目一例：字数、未保存与点击保存、Monaco 行列随光标、切回 Markdown 不显示行列）；变异 3 个全杀。
- 2026-10-10 S7 收口：
  - Spec：外壳 Spec、命令 Spec、编辑器 Spec 与浏览器宿主 Spec 里外壳四相关的“planned”去掉，证据补上外壳四的实现入口、合同测试与 Smoke。
  - 全量 `bun run test:e2e`：148 例通过、1 例失败。失败的是 `files-explorer.e2e.ts` 的“只用键盘”：用例用 `getByRole("menuitem").first()` 找右键菜单的第一项，标题栏的菜单组标题现在也是 menuitem 且排在前面。改为只在打开的菜单里找，这个文件 11 例全过。
  - omp 实现审查按新的分工启动，不阻塞：报告回来后在空闲时处理，修正单独提交。
  - 状态：实现完成，实现审查待处理。
- 2026-10-10 omp 实现审查（非阻塞，[报告](evidences/implementation-review.md)）：阻断 2、重要 4、建议 1。处理：
  - C1 跨插件运行时导入 `workbench/shared/items`（`architecture.test` 失败）：已修（提交 `66c1068f`，条目与首页贡献点的常量经 `shared/contracts.ts` 再导出）。
  - C2 应用菜单的撤销、重做在焦点在原生输入框时仍作用于活动编辑器：待修，按 Spec 输出 29 在菜单打开前记下焦点，原生输入框时禁用并说明。
  - C3 菜单从 portal 内按 Escape 焦点只回到触发器、不回到 F10 前的位置：待修，经 nb-ui 菜单的关闭完成钩子恢复。
  - C4 “更多”里的长文本不换行（Dropdown 的 `whitespace-nowrap`、MenuNodes 的 `truncate`）：待修。
  - C5 条目宽度探针与真实 Button 不等价、gap 多算一个：待修，改用与显示同源的测量或按实际项数算 gap。
  - C6 F10 后标题栏任何子控件的 Escape 都会抢回焦点：待修，只对菜单入口的会话恢复。
  - C7 每次输入全文重算字数（建议）：先用真实长文测基准再决定，记入后续。
  - 审查环境的说明：报告里 `bun run typecheck` 在仓库根没有脚本、Vitest 缺插件，是审查 worktree 的运行方式问题，不是实现问题。
- 2026-10-10 审查 C2、C3、C6 已修（标题栏的菜单会话：打开前的焦点与是否原生输入框一起记下；原生输入框时撤销、重做禁用并说明；菜单关闭后焦点回到入口那一刻交回打开前的位置；只有菜单入口上的 Escape 还焦点）。验证：`menu-model.test.ts` 新增 1 例、`WorkbenchTitleBar.dom.test.ts` 新增 2 例、变异 4 个全杀、`workbench-titlebar.e2e.ts` 补浮层内 Escape 与挪到搜索按钮后 Escape 两段（5/5 通过）。C4、C5 待修，C7 记入后续。
- 2026-10-10 审查 C4、C5 已修：`layoutStrip` 的间距按实际摆出来的项数算（“更多”也算一项），测量层改用与显示同一种元素（有命令的是 `Button`）；nb-ui `Dropdown` 新增 `wrap`（菜单最宽 320px、条目换行）与 `MenuNodes` 的 `wrap`，“更多”用它。验证：`item-strip.test.ts` 新增 2 例、变异 2 个全杀；新增 `e2e/lab-item-strip.e2e.ts`（在 Lab 场景上把容器撑到测量层算出的宽度：全放下、差一像素收起且高优先级先摆、摆出来的都在容器内不重叠；“更多”里长文字 `white-space: normal` 且换行）2/2 通过；nb-ui Dropdown 测试 7/7。C7 记入后续。
