# t08 实施计划：编辑命令与菜单

## Context

- **为什么做**：Markdown 编辑器里的编辑动作只有 Tiptap 自带的快捷键和输入规则，不是工作台命令：命令面板找不到，菜单不能引用，插件加不进来；也没有工具栏、选区菜单、斜杠菜单、块按钮和正文右键菜单。现状与旧应用的对照见 [research.md](research.md)。
- **依据**：[Task README](README.md) 的决定 1–14（评审板三轮已定，不再讨论）；[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)、[`design-language.md`](../../../../../packages/nb-ui/docs/design-language.md#四排版) 的“界面不靠说明文字解释自己”。
- **工作方式**：worktree `.worktree/w00025-t08-editing-menus`，分支 `feat/w00025-t08-editing-menus`，从 master 拉（Work README：t04 之后的 Task 从 master 拉分支）。Spec 与 Task 记录在主工作区 master 改。主会话编码，每片自跑验证后单独提交；不 push。草稿 worktree 只作外观参照。

## 关键设计

设计审查（[报告](evidences/design-review.txt)、[逐条处理](evidences/design-review-disposition.txt)）后改过：命令与位置改归 `nbook.editor`，不用 BubbleMenu，块模型与剪贴板写定。

### 1. 谁拥有：`nbook.editor`，控件能力放在句柄上

`nbook.editor` 已经有活动组到活动控件的机制（`EditorArea.activeHandle`）、菜单位置（`editor.title`、`editor.tab-context`）、设置分区、公开键，也已依赖命令、公开状态与设置。编辑动作作为控件能力放进句柄：

```ts
// editor/shared/contracts.ts
export interface EditorControlHandle {
    …
    /** 控件提供的编辑动作（只有 Markdown 控件提供）；公开键与 `nbook.edit.*` 命令经它工作。 */
    readonly editing?: EditorEditing;
}
export interface EditorEditing {
    run(action: EditingActionId, args?: Readonly<Record<string, unknown>>): CommandResult<unknown>;
    active(action: EditingActionId): boolean;
    enabled(action: EditingActionId): boolean;
    readonly hasSelection: Readonly<Ref<boolean>>;
}
```

`editor/shared/editing.ts`（新，不引 Tiptap）：动作目录的元数据（id、标题、图标、键位写法、分组、是否可勾选、分类）。入口与命令声明只引它，首屏不含 Tiptap（`markdown/web/plugin.ts` 头注释的约定）。

Markdown 控件的菜单从 `editor/shared/contracts.ts` 的注入键（`editorMenusKey`）取：编辑器区 provide，内容是菜单项登记表、命令服务与设置。

### 2. 编辑动作实现：`packages/nb-markdown/src/editor/editing-actions.ts`（新）

纯 Tiptap，不认识工作台。每个动作 `run(editor, args)`、`active(editor)`、`enabled(editor)`，按 `editor/shared/editing.ts` 的 id 对应（id 表由 `nb-markdown` 导出字符串字面量，`editor/shared` 类型核对）。

- 复用语言已有的命令：`setCallout`、`setMarkdownAlign`、`setMarkdownRuby`、`setMarkdownBilingual`，以及 StarterKit 的粗体、列表等。语言里只有 mark 没有命令的（`markdownTextColor`、`markdownHighlight`、`markdownSuperscript`、`markdownSubscript`）用 `setMark`、`toggleMark`、`unsetMark`。
- **清除格式**只移除粗体、斜体、删除线、行内代码、文字颜色、高亮、上标、下标；保留批注、注音、链接，不动块类型。批注是审阅数据，不是格式。
- `enabled` 用 `editor.can()`，按需计算：控件在选区或文档变化时加一个版本号，读的人依赖版本号，没人读就不算。

### 3. 命令与公开键：`editor/web/editing-commands.ts`、`editor/web/state.ts`

- 命令 `nbook.edit.<动作>`（`edit` 是现有的域，和 `nbook.edit.undo` 同域）。`effect: "write"`，`expose: {agent: "never"}`（Agent 改正文走文件工具）。块类型各一条（`nbook.edit.heading-1`、`nbook.edit.bullet-list`）；颜色、高亮、对齐、注音、双语带参数，不进命令面板。
- `when` 引用粗粒度键（限定名）：`nbook.editor/writable`，以及按分类的 `nbook.editor/canFormat`、`nbook.editor/canConvertBlock`；剪切、复制要 `nbook.editor/hasSelection`。`run` 条件失效时返回 `{ok: false, code: "unavailable", reason}`。
- 勾选状态每个可勾选动作一个键，键名 camelCase：`formatBold`、`formatItalic`…（决定 3）。
- 键位不写进声明：Ctrl+B 等留在 Tiptap，目录里的键位写法只用来显示（平台写法用 `formatKeybinding`），测试用真实 Tiptap 按键对照，两份不会走样。
- 撤销、重做复用现有命令。`nbook.edit.link` 留给 t09（决定 15）。

### 4. 五个菜单位置：`editor/shared/contracts.ts`

| 位置 | 贡献点 | `context` | 另有字段 |
|---|---|---|---|
| 固定工具栏 | `editor.toolbar` | `"resource"` → `{address}` | `icon`（`inline` 时必填）、`placement` |
| 选区浮动菜单 | `editor.selection` | 同上 | `icon` |
| 斜杠菜单 | `editor.slash` | 同上 | `icon` |
| 块菜单 | `editor.block` | 同上 | `icon` |
| 正文右键 | `editor.body-context` | 同上 | `icon` |

用现有的 `menuLocation`、`arrangeMenu`、`MenuItemRegistry`。内置项由各菜单自己画，按“命令在目录里”过滤（t09 登记 `nbook.edit.link` 后链接按钮自动出现）；贡献的项排在内置项之后（决定 3）。只给 `{address}`，选区文字与编辑接口是 t12 的事（决定 1）。

### 5. nb-ui 的两处改动

- `Toolbar` 加 `variant: "panel" | "flat"`，缺省 `panel`；`flat` 没有底色、边框与内边距。现在没有产品调用方，同名 `.md` 与 Lab 场景同步。
- 新增 `popup/AnchoredPopover.vue`：`open`、`anchor`（元素或虚拟锚点，同 `SuggestionMenu`）、`side`，外框是 `.nb-ui-popover-surface`，不抢焦点、按下不夺焦、不处理点外面。定位用 reka 的 `PopoverContent :reference`，和 `SuggestionMenu` 同一套。先写同名 `.md`，登记 Lab。

### 6. 控件里的状态：`markdown/web/components/menus/`（新）

**一个编辑器实例跨文档与重挂**：`load`、`enter` 每次换 `EditorState` 都换 `plugins` 数组，prosemirror-view 按数组身份销毁并重建全部插件视图；组件重挂时 `editor.unmount()` 也销毁视图。所以这里不写插件视图，不在扩展配置里捕获组件 DOM 或回调：菜单状态由控件组件监听 `scroller` 的指针与键盘事件、`editor.on(...)` 得出，组件卸载或换绑定时清空。

内置菜单读**自己控件**的 `editing`，不读公开键：拆分后非活动组的工具栏不被活动组带偏。公开键只服务命令的 `when`、贡献项与命令面板。

### 7. 固定工具栏：`menus/MarkdownToolbar.vue`

- 放在滚动容器之外，宽度等于版心，居中，`Toolbar variant="flat"`，下面一条 `--divider`（决定 2、7）。
- `IconButton`、`DropdownMenu`（块类型、对齐、“⋯”）、`Popover` + `ColorSwatches`（颜色、高亮）、`Tooltip`。
- 18 个按钮（决定 6 去掉链接，决定 15）。放不下时从右往左收进“⋯”；`ResizeObserver` 量容器宽度，按钮宽度固定，算术决定留几个，不要隐藏的测量层。贡献的 `inline` 项排在最后，最先被收。
- 按下不夺焦（`mousedown.prevent`，动作后聚焦）。
- 显隐：设置 `nbook.editor/markdownToolbar`（缺省开），“视图”菜单一条勾选项，命令 `nbook.view.toggle-editor-toolbar`，公开键 `toolbarVisible`（决定 2），写法照 `editor/shared/settings.ts` 的 `breadcrumbsSetting`。
- 只读：按钮置灰，版面不跳。

### 8. 选区浮动菜单：`menus/MarkdownSelectionMenu.vue`

不用 `@tiptap/extension-bubble-menu`：默认显隐与 `r2-bubble` 不符（拖选中就出现），松开鼠标不产生事务；元素在配置时固定，遇到重挂会失效；还会多出第二套定位。

- 用 `AnchoredPopover`，虚拟锚点读选区矩形（`view.coordsAtPos`）。
- 显示条件全部满足：选区非空；编辑器有焦点或焦点在菜单内；指针已松开；不在组字；不在代码块、原样块；可写；选区之后没打字；没按 Esc。换绑定后恢复的选区不算“刚选的”，不弹出。
- 决定 10 的内容。注音：点了开带单个输入框的 `Popover`（决定 15）。

### 9. 斜杠菜单：`nb-markdown/src/trigger/`（从 Prompt 抽出）+ `menus/MarkdownSlashMenu.vue`

- **触发模块**：“一个插件按光标前文字重算触发与查询、可被 dismiss”抽成与 Prompt、Markdown 都无关的模块；触发字符、前缀字符、可触发的 parent 判断、原子字符都是选项。`prompt-editor-extensions.ts` 保留原名再导出，Composer 的测试不改即过。组字判断留在各宿主。
- **Markdown 的规则**：`/` 在行首或空白之后；另外 `、` 只在行首也算（中文输入法下 `/` 键输出 `、`，行首打 `、` 不会是正文）。代码块、原样块、表格单元格不触发，组字时不触发。筛不出项时不显示，回车照常换行。
- **面板**：`SuggestionMenu`，三组（基本、列表、块）照决定 11，“插入”组等 t09；不写 Markdown 写法、无占位提示（决定 14）。键盘：上下、回车、Tab、Esc。
- **筛选**：名称与拼音首字母。`pinyin-pro`（MIT，`^3.28.1`，旧应用已在用，不多出版本，gzip 约 144 KB），第一次打开时动态加载，加载完成前只按名称筛。
- **执行**：`closeHistory(tr)` 后在同一事务删掉 `/查询`，再执行命令，撤销一步回到 `/查询`。

### 10. 块按钮与块菜单：`nb-markdown/src/editor/block-range.ts`（新）+ `menus/MarkdownBlockGutter.vue`

不用 `@tiptap/extension-drag-handle`：它运行时 import `@tiptap/y-tiptap` 与 `@tiptap/extension-collaboration`（已查包源码），会带进协作依赖。

**块模型**（进 Spec）：

| 指针下的内容 | 手柄对象 | 转换为 | 创建副本、上移下移、删除 |
|---|---|---|---|
| 段落、标题 | 这一块 | 全部 | 可用 |
| 代码块 | 这一块 | 全部（内容转为文字） | 可用 |
| 列表项（含任务项，任何层级） | 这一项连同子项；按钮与其它块同一列 | 正文、标题：提出列表再转换，列表从这里断开；列表类型：改整个列表；其余置灰 | 在同一列表内移动，到头时置灰 |
| 引用、提示块、对齐、批注块、双语 | 整个容器 | 只有“正文”（解开容器），其余置灰 | 可用 |
| 表格、分割线、原样块、HTML 嵌入 | 整块 | 全部置灰 | 可用 |
| 空段落 | 这一块 | 全部 | 可用 |

折叠的提示块照容器处理，折叠状态不变。只读文档不出现块按钮。

- **外观**：`+` 与手柄，右缘离正文 14px，悬停底色圆角 4px（决定 9）；版心窄到没有页边时压进留白。位置由 `scroller` 的 `pointermove` 用 `view.posAtCoords` 算，`block-range.ts` 给出对象范围。
- **`+`**（决定 5）：在下方（Alt 时上方）插入新段落，里面放字面 `/`，由触发模块打开菜单；这两步不进撤销历史。菜单因 Esc、失焦、光标离开而关闭，且这一块仍只有 `/` 时，删掉这一块，文件字节不变。
- **拖动**：手柄 `draggable`，用浏览器原生的起拖门槛与 StarterKit 默认开着的 dropcursor。`dragstart` 先设 `NodeSelection`，再设 `view.dragging = {slice, move: true}`；`dragend` 里清掉 `view.dragging`（ProseMirror 只在 `view.dom` 上清，手柄在外面，不清的话之后外部拖入会把旧块当成要移动的内容并删掉选区）。Esc 由浏览器取消。
- **块菜单**（决定 12）：转换为｜创建副本、复制｜上移、下移｜贡献的项｜删除。
  - 上移、下移：同一事务 `delete` + `insert`，节点实例不变，编解码器按身份识别未编辑的块。快捷键 Alt+↑、Alt+↓ 在 Tiptap 的 keymap 里（决定 15），只在编辑器有焦点时生效；macOS 上会盖掉 Option+↑↓ 的段落跳转，写进 Spec。
  - 创建副本：`schema.nodeFromJSON(node.toJSON())` 新建节点，不和原块共用原文来源；测试核对带批注的块。
  - 复制：把选区设到这一块，走第 11 节同一条复制路径。
- 按钮不进 Tab 顺序（否则正文每一块多两个停靠点），键盘经快捷键与命令面板。

### 11. 正文右键菜单：`menus/MarkdownContextMenu.vue`

- `ContextMenu`，决定 13 的六项。只读文档只留复制、全选。
- `contextmenu` 事件里：点在选区外时把光标移到点击处（`posAtCoords`），点在选区内时保留。`EditorGroup` 的 `pointerdown` 只认左键，这里先调 `area.focusGroup` 对应的聚焦，保证目标是被右击的组。
- **复制、剪切**：`view.focus()` 后 `document.execCommand("copy" | "cut")`。这样走 ProseMirror 的 copy、cut 处理器，就是 Ctrl+C、Ctrl+X 的路径，非安全上下文也可用，块菜单共用一个函数。S6 先在真实浏览器核实 `data-pm-slice` 还在。
- **粘贴**：`navigator.clipboard?.read`，走 `view.pasteHTML`、`view.pasteText`。API 不存在、权限被拒、剪贴板没有文字（例如图片或文件）各给一条提示，建议用 Ctrl+V；不静默。粘贴为纯文本用 `readText` + `pasteText`。

### 12. 不随本 Task 改的

Monaco 控件；语法模块的合同；`Editor` 实例的生命周期。

## 旧应用的可观察行为：做还是不做

| 旧应用 | 处理 |
|---|---|
| 选区菜单的块类型下拉 | 不做（决定 10） |
| 粗体、斜体、删除线、行内代码；颜色、高亮；上标、下标 | 做：选区菜单放决定 10 的那些，上下标在工具栏“⋯”里 |
| 下划线 | 不做（新方言没有） |
| 增减缩进 | 不做按钮；列表里 Tab、Shift+Tab 照旧 |
| 对齐 | 在工具栏，不在选区菜单 |
| 加批注 | t13 |
| 注音、双语 | 注音在选区菜单与工具栏“⋯”，双语在斜杠菜单与工具栏“⋯” |
| 图片、链接、引用文件的插入 | t09（见待确认 1） |
| 斜杠命令 | 做，内容见决定 11 |
| 右键：保存、撤销、重做、插入 | 不做（决定 13） |
| 右键：剪切、复制、粘贴 | 做，另加粘贴为纯文本、全选 |

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/markdown-editing.md`（新，按 `writing-specs`，登记注册表） | 命令表、公开键、工具栏、选区菜单、斜杠菜单、块模型与块菜单、右键菜单的输出与验收 |
| `docs/specs/workbench/menus.md` | 位置表加五行；非目标里“编辑器正文右键”删掉 |
| `docs/specs/workbench/editor.md` | “不承诺”去掉正文右键、选区菜单、斜杠；控件合同加 `editing`；命令表与设置表指向新 Spec |
| `docs/specs/workbench/commands.md` | 目录加一句指向新 Spec |
| `MarkdownControl.md`、`Toolbar.md`、`AnchoredPopover.md` 与新组件的同名 `.md` | 同步；新组件先写 `.md` |

## 切片

| 片 | 内容 | 提交边界 | 验证 |
|---|---|---|---|
| S0 | Spec | 上表 | `docs:check`、`governance:check` |
| S1 | 第 1–4 节 | 目录、动作、命令、公开键、位置；触发一条“全部命令被接受”的测试 | `test:affected --typecheck`；真实 Tiptap 的 dom 测试 |
| S2 | 第 5 节、第 6–7 节 | nb-ui 两处、工具栏、显隐；建“同一实例卸载再挂上”的测试夹具 | 同上；Lab（明暗），nb-ui 改动按四组合加 390px |
| S3 | 第 8 节 | 选区菜单 | 同上 |
| S4 | 第 9 节 | 触发模块抽出、斜杠菜单、拼音 | 同上；Composer 的测试不改即过 |
| S5 | 第 10 节 | 块按钮、拖动、块菜单 | 同上；真实浏览器拖动与取消 |
| S6 | 第 11 节 | 右键菜单 | 同上 |
| S7 | 收口 | 测试插件贡献五个位置、e2e、入口 chunk 检查、Spec 证据 | `test:affected --typecheck`、相关 e2e；实现审查（Sonnet）后合入 |

## 验收映射

行为按下表映射，Spec 的输出编号见 [`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md)；实际交付与本表的差异见 [Task README](README.md)。

| 行为 | 测试 |
|---|---|
| 全部 `nbook.edit.*` 声明被接受；执行、`when`、`unavailable` 与原因 | `editor/web/editing-commands.dom.test.ts`（真实命令服务、真实 Tiptap） |
| 动作的 `active`、`enabled`；键位写法与真实按键一致；代码块里不可用 | `nb-markdown/src/editor/editing-actions.dom.test.ts` |
| 清除格式保留批注、注音 | 同上 |
| 工具栏收进“⋯”、显隐、不夺焦；只读置灰且版面不跳 | `MarkdownToolbar.dom.test.ts`；e2e |
| 拆分后非活动组的工具栏显示自己的状态 | e2e |
| 同一实例重挂、A↔B 切标签后菜单可用，恢复的选区不弹出菜单 | `MarkdownControl.dom.test.ts` 的新夹具 |
| 选区菜单的显隐条件（拖选中不出现、松手出现、打字、Esc、组字） | e2e（真实选区；组字用 CDP `Input.imeSetComposition`，同 `markdown-input.e2e.ts`） |
| 斜杠触发（行首、空白后、`、`，代码块与表格不触发）、筛选（含拼音）、键盘、撤销一步还原、筛不出项 | dom 测试；e2e |
| `+` 放弃后文件字节不变 | e2e |
| 块模型表每一行；副本不共用来源；移动后未编辑的块字节不变 | `block-range.dom.test.ts`；写回用真实编解码器 |
| 拖动移动；取消后外部拖入不插入旧块 | e2e |
| 右键：复制后粘贴保留结构；选区内外；另一组；粘贴的三种失败提示 | e2e |
| 插件贡献进五个位置、随入口停止撤回；工具栏 `placement` | e2e（测试插件 `test.menus`） |
| 入口 chunk 不含 Tiptap | 收口时查构建产物，结果写进 Task |

## 验证

- 每片：`bun run test:affected --since master --typecheck`；改了共用的触发模块时另跑 nb-markdown 的 Prompt 测试。
- 端到端：新 `e2e/markdown-editing.e2e.ts`，真实浏览器走完“打字 → 选中 → 选区菜单加粗 → `/` 换标题 → 拖动手柄移动一块 → 右键复制粘贴 → 保存后读文件”，核对写回的 Markdown。
- UI 取证按“普通 UI 改动”一档，另加明暗两色与拆分后的窄版心（工具栏收进“⋯”、按钮压进留白）。
- 跑 e2e 前停掉多余服务，跑时不改源码。
- 留下未验证的：Safari 与 Firefox 的剪贴板差异（产品主要在 Chromium 上验收）。

## 不做与风险

- 不做：行内 AI 接口（t12）、批注（t13）、链接与图片的插入（t09）、下划线、缩进按钮。
- 风险：`execCommand` 已废弃。浏览器真移除时换成异步剪贴板 API，只改一个函数。
- 风险：`、` 行首触发是产品行为，开发者没看过，记待追认；不想要时删一个字符配置。
- 风险：拖动列表项跨列表时的落点行为要看 ProseMirror 的默认结果，不符合预期的先记下，不写特例。

## 新增依赖

`pinyin-pro`（MIT，`^3.28.1`），装在 `neuro-book`。不再加 `@tiptap/extension-bubble-menu`。

## 开发者已确认（2026-11-05，全部按推荐）

1. **链接按钮**：t09 搁置中，本 Task 不做链接的编辑，所以工具栏与选区菜单先不出现链接按钮（命令不存在时不显示，t09 登记命令后自动出现）。推荐这样，不放一个点不了的按钮。另一个做法是现在顺手做一个只填地址的小弹层，代价是抢了 t09 要定的事。
2. **注音与双语的输入**：一个带单个输入框的弹层，回车确定。推荐。
3. **上移、下移的快捷键 Alt+↑、Alt+↓**：评审板没问过；不加的话，移动块只能靠拖动，键盘用户没有路径。推荐加。
4. **`pinyin-pro`**：评审板第 2 轮说过要加第三方库；这里定成它，按需加载。推荐。
