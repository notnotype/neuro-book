# t74 实现审查报告

审查范围：`56cf41fb..HEAD` 的全部提交；只读检查提交日志、完整 diff、Spec、实现与测试。结论按影响排序。`C1` 为阻断，`C2` 为重要，`C3` 为建议。

## 问题

### C1：跨插件运行时导入违反架构门禁，相关测试必然失败

- 严重程度：阻断
- 类别：架构 / 测试门禁
- 文件：`packages/neuro-book/src/plugins/editor/web/plugin.ts:19-21`
- 现象：编辑器浏览器插件在产品代码中从 `nbook/plugins/workbench/shared/items` 运行时导入 `WORKBENCH_STATUSBAR_ITEMS_POINT`。仓库架构合同只允许跨插件运行时导入对方的 `shared/contracts.ts`；`shared/items.ts` 不在允许路径内。`bun test packages/neuro-book/src/architecture.test.ts` 实际失败，唯一 t74 相关违规为：`plugins/editor/web/plugin.ts → nbook/plugins/workbench/shared/items`。
- 原因：条目贡献点常量新增在 Workbench 的 `shared/items.ts`，但没有作为公开运行时合同放入 `shared/contracts.ts`；编辑器插件直接跨包深导入实现外的共享模块。
- 核实方式及结果：运行 `bun test packages/neuro-book/src/architecture.test.ts`；结果为 `2 pass, 1 fail`，失败断言明确列出上述导入。`packages/neuro-book/src/plugins/editor/web/status-items.ts:8` 的 `import type` 不触发该规则，但 `plugin.ts:20` 是值导入并触发。
- 建议改法：把两个条目贡献点常量（及编辑器需要的纯公开声明类型，如确实需要）移入或从 `packages/neuro-book/src/plugins/workbench/shared/contracts.ts` 导出，编辑器插件只从该合同入口导入；工作台内部的校验器仍可留在 `shared/items.ts`，但不要让其它插件运行时依赖它。

### C2：应用菜单的撤销/重做没有遵守“原生输入框优先”合同

- 严重程度：阻断
- 类别：命令语义 / 键盘焦点 / 数据编辑
- 文件：`packages/neuro-book/src/plugins/editor/web/commands.ts:55-67`、`packages/neuro-book/src/plugins/workbench/web/titlebar/menu-model.ts:56-87`、`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShell.vue:133-135,317-322`
- 现象：活动编辑器可写、但焦点已经在原生 `input`/`textarea`/`contenteditable` 时，应用“编辑”菜单中的撤销或重做仍被画成可用；点击菜单项最终调用 canonical `nbook.edit.undo` / `nbook.edit.redo`，作用于活动编辑器，而不是保留给原生输入框。违反 `docs/specs/ui/workbench-shell.md` 输出 29：“焦点在原生输入框时菜单不代替它撤销”。
- 原因：canonical 命令的 `when` 只有 `active` 与 `writable`，这是命令面板仍可选的既有合同；标题栏能力模型只调用 `commands.isEnabled()`，菜单选择也只按命令 id/参数执行，没有保存菜单打开前的焦点或提供菜单专用的原生编辑上下文策略。不能简单把 `focused` 加进 canonical `when`，否则会破坏命令面板夺焦后仍可执行的合同。
- 核实方式及结果：沿代码路径静态核实：`menu-model.ts:59-60` 直接把 `CommandService.isEnabled` 作为菜单可用性，`WorkbenchShell.vue:133-135` 直接执行命令，`commands.ts:66-67` 的条件不含焦点。现有 `packages/neuro-book/e2e/workbench-titlebar.e2e.ts:87-114` 只验证编辑器正文撤销与菜单关闭后的 F10/Escape，没有原生输入框场景；受只读审查限制未运行 e2e。
- 建议改法：保留 canonical 命令的 `when`，为应用菜单保存打开前的焦点并在撤销/重做时按原生编辑上下文路由，或给菜单执行路径增加明确的焦点策略，使原生编辑控件保留自身撤销/重做；补充 input、textarea、contenteditable 的真实浏览器回归场景。

### C2：菜单打开时按 Escape 不能把焦点还回菜单打开前的位置

- 严重程度：重要
- 类别：键盘焦点 / 菜单生命周期
- 文件：`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchTitleBar.vue:119-165,177-188`、`packages/nb-ui/src/components/controls/Menubar.vue:115-126`、`packages/nb-ui/src/components/controls/Dropdown.vue:160-181`
- 现象：从编辑器按 F10 后打开完整菜单，或在紧凑档打开 Dropdown，菜单内容位于 `MenubarPortal`/`DropdownMenuPortal` 的标题栏外部。Escape 的事件目标在 portal 内容内，不会冒泡到标题栏 `<header @keydown="onRootKeydown">`；nb-ui 原语只把焦点恢复到菜单触发器，不是 F10/菜单打开前的编辑器元素。输出 31 要求 Escape 关闭菜单并把焦点回到打开前的位置，因此该路径焦点落点错误。
- 原因：`returnFocus` 只在 `WorkbenchTitleBar` 的全局 F10/Alt 处理器里记录，恢复逻辑却只挂在标题栏根节点；portal 菜单没有把“关闭完成”与这份焦点记忆连接起来。
- 核实方式及结果：静态核对 portal 的 DOM 边界与事件路径：`Menubar.vue:115`、`Dropdown.vue:160` 均把内容传送到 portal，`WorkbenchTitleBar.vue:157` 只有根节点键盘监听。现有 DOM 测试只覆盖“菜单关闭后、菜单本身未打开时按 Escape”（`WorkbenchTitleBar.dom.test.ts:48-59`），e2e 也未断言 F10 打开菜单后直接 Escape 的焦点；受限制未运行 e2e。
- 建议改法：在 Menubar/Dropdown 提供真实关闭完成钩子或透传 `onCloseAutoFocus`，由标题栏在菜单打开前保存焦点、在 Escape/外点关闭完成后恢复；恢复前检查元素仍连接，已卸载时选择稳定 fallback。

### C2：条目“更多”菜单无法按 Spec 换行展示完整文本

- 严重程度：重要
- 类别：可用性 / 浮层文本布局
- 文件：`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchItemStrip.vue:77-82,121-125`、`packages/nb-ui/src/components/controls/Dropdown.vue:117-137`、`packages/nb-ui/src/components/controls/MenuNodes.vue:82-88`
- 现象：状态栏或标题栏条目被收进“更多”后，长文本仍按单行菜单项渲染，并受 `truncate` 处理，不能满足“在‘更多’里换行显示全文”。纯文字条目虽把标题拼进 label，长标题同样不能完整显示。
- 原因：`WorkbenchItemStrip` 只提供 `DropdownItem.label`，没有提供可换行的 item slot/class；Dropdown 的默认 item 基础类包含 `whitespace-nowrap`，MenuNodes 的文本 span 包含 `truncate`，组件没有宽度上限与换行样式。
- 核实方式及结果：静态核对 `moreItems` 到 Dropdown/MenuNodes 的完整渲染路径；`bun test` 中的 `item-strip.test.ts` 只测纯函数溢出预算，没有 DOM 文本布局断言。未运行 e2e（按限制）。
- 建议改法：为“更多”菜单提供专用 item 渲染/样式：菜单有有限最大宽度，文本节点使用 `white-space: normal`、允许换行并移除 `truncate`；保留命令条目的 tooltip/读屏全文。

### C2：条目宽度探针与实际按钮不等价，边界宽度会错收或裁切

- 严重程度：重要
- 类别：响应式布局 / 宽度测量
- 文件：`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchItemStrip.vue:39-60,98-130,150-186`、`packages/nb-ui/src/components/controls/Button.vue:56-70`
- 现象：溢出决策使用隐藏测量层的 `<span>`，但实际可点击条目和“更多”按钮是 nb-ui `Button`。实际 Button 具有 `font-medium`、透明边框及 Button 自身的尺寸/盒模型；探针只有 span 的文本与条目 CSS。内容较多或宽度正好接近阈值时，探针会低估实际按钮宽度，`overflow: hidden` 随后裁掉可见项。反过来，`remeasure()` 给每一个条目宽度都加 `GAP`，`layoutStrip()` 又按每一项求和；实际 flex 行只有相邻项目之间的 `n-1` 个 gap，因此“全部放得下”的边界还会被多保留一个 gap，导致本可显示的项目过早进入“更多”。
- 原因：测量层不是实际 Button 的 clone/同源 DOM；间距被编码进每项宽度而不是按实际显示集合统一计算，且 Button 与 probe 的边框、字重未纳入同一测量。
- 核实方式及结果：静态比较 `WorkbenchItemStrip.vue:99-110` 与 `:129-130`，以及 `Button.vue:60` 的 `font-medium border`；再核对 `GAP=4` 在 `:44-46` 对每个探针都增加、`layoutStrip.ts:31-32` 对所有宽度求和。现有 item-strip 单测只给定人工宽度测试算法，未覆盖真实 DOM 盒宽；未运行 e2e。
- 建议改法：用与显示路径一致的实际 Button/文本元素作为探针，或直接测量已渲染的可见项与“更多”按钮；把 gap 按最终项目数计算，保证“全部实际放得下时全部显示”，并增加接近阈值的 DOM 回归场景。

### C2：F10 后的 Escape 处理范围过宽，会从非菜单控件抢回焦点

- 严重程度：重要
- 类别：键盘焦点 / 可访问性
- 文件：`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchTitleBar.vue:157-165`
- 现象：`returnFocus` 一旦由 F10/Alt 设置，标题栏中任何子控件（搜索按钮、项目按钮、布局按钮或条目按钮）触发 Escape，且当前没有打开菜单时，`onRootKeydown` 都会把焦点跳回 F10 前的元素。代码只排除了 `aria-expanded="true"`，没有确认事件目标是菜单入口。
- 原因：恢复条件以“标题栏内有 returnFocus 且无菜单”为准，而不是以“事件目标是菜单入口且该次菜单会话仍然有效”为准；选择菜单项、点击其它标题栏控件后也没有清理会话。
- 核实方式及结果：静态核对 header 上的 `@keydown` 会接收所有子控件冒泡事件，且 `target` 只在 `:161` 读取 `aria-expanded`。现有 DOM 测试仅在菜单入口本身派发 Escape，未覆盖 F10 后转到搜索/布局按钮再按 Escape。
- 建议改法：记录菜单会话的触发器与当前打开状态，只允许对应入口在菜单关闭后的 Escape 恢复；切换到其它标题栏控件、菜单选择完成或元素失效时清空/更新会话。

### C3：每次编辑器输入都会对全文重新统计字数，长文输入有额外 O(n) 开销

- 严重程度：建议
- 类别：性能 / 响应式计算
- 文件：`packages/neuro-book/src/plugins/editor/web/components/MonacoControl.vue:183-189`、`packages/neuro-book/src/plugins/editor/web/status-items.ts:63-65`、`packages/neuro-book/src/shared/word-count.ts:14-23`
- 现象：Monaco 每次 `onDidChangeModelContent` 都立即提交正文；状态条字数条目随后对整个当前正文执行 `replace`、CJK 替换和 `matchAll`。长文每个字符输入都会重复扫描全文，可能使输入延迟随正文长度增长。
- 原因：没有按变更区间增量更新，也没有把字数统计与输入渲染解耦或合并到可控的调度边界；`countWords` 是明确的全文算法。
- 核实方式及结果：静态追踪 input → `commit` → 响应式 text → `editorStatusItems[WORD_COUNT_ITEM].text()`；代码路径已确认，未作真实性能基准（限制不允许启动产品或 e2e）。
- 建议改法：先以真实长文输入基准确认阈值，再按编辑器变更区间维护计数，或在不影响状态栏最终一致性的前提下合并更新；不要通过减少状态更新掩盖正文提交语义。

## 验证记录

- 已读取 `git log --oneline 56cf41fb..HEAD` 与完整 `git diff 56cf41fb..HEAD`；审查范围为 63 个文件、净增 2949 行、净减 85 行。
- `bun test packages/neuro-book/src/plugins/workbench/web/titlebar/menu-model.test.ts packages/neuro-book/src/plugins/workbench/web/items/registry.test.ts packages/neuro-book/src/plugins/workbench/web/items/item-strip.test.ts packages/neuro-book/src/plugins/editor/status-items.test.ts`：`20 pass, 0 fail, 88 expect() calls`。
- `bun test packages/neuro-book/src/architecture.test.ts`：`2 pass, 1 fail`；失败就是 C1 所述 t74 跨插件运行时导入。
- `bun test` 全量：在 3600 秒命令上限时仍未通过并超时。除 C1 外，同次输出还包含现有测试运行环境/其它包问题，例如 `vi.doMock is not a function`、`it.runIf is not a function`、`Cannot find module '@notnotype/neuro-book-manager/test-support'`、Playwright 直接被 Bun Test 收集等；这些没有作为 t74 实现问题计入。
- `bun run typecheck`：仓库根 `package.json` 没有 `typecheck` script，命令返回 `error: Script not found "typecheck"`。
- `npx vitest run` 针对 t74 相关测试：未进入有效测试执行。Bun 测试文件因 `Cannot find package 'bun:test'` 失败，Vue DOM 测试因缺少 `@vitejs/plugin-vue` 解析失败；没有把这些环境/配置失败误报为实现行为通过或失败。

## 统计

| 级别 | 数量 |
|---|---:|
| 阻断 | 2 |
| 重要 | 4 |
| 建议 | 1 |
| 合计 | 7 |
