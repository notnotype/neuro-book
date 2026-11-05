# t08 实施计划：编辑命令与菜单

## Context

- **为什么做**：Markdown 编辑器里的编辑动作只有 Tiptap 自带的快捷键和输入规则，不是工作台命令：命令面板找不到，菜单不能引用，插件加不进来；也没有工具栏、选区菜单、斜杠菜单、块按钮和正文右键菜单。现状与旧应用的对照见 [research.md](research.md)。
- **依据**：[Task README](README.md) 的决定 1–14（评审板三轮已定，不再讨论）；[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)、[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)、[`design-language.md`](../../../../../packages/nb-ui/docs/design-language.md#四排版) 的“界面不靠说明文字解释自己”。
- **工作方式**：worktree `.worktree/w00025-t08-editing-menus`，分支 `feat/w00025-t08-editing-menus`，从 master 拉（Work README：t04 之后的 Task 从 master 拉分支）。Spec 与 Task 记录在主工作区 master 改。主会话编码，每片自跑验证后单独提交；不 push。草稿 worktree 只作外观参照。

## 关键设计

### 1. 谁拥有命令与菜单：`nbook.markdown`，经一个连接拿到活动控件

编辑动作只对 Markdown 控件有意义，所以命令、公开状态与五个菜单位置都归 `nbook.markdown`，不进 `nbook.editor`。

**限制**：`nbook.editor` 依赖 `nbook.markdown`（内置编辑器的组件从 `markdownKey` 取），所以 Markdown 插件激活时不能依赖编辑器的服务；而“哪个控件是活动的”只有编辑器区知道（`EditorArea.activeHandle`）。不另做一份“最后聚焦的控件”：它和活动编辑组会分叉（切组但没聚焦时）。

**做法**：反向连接。

```ts
// markdown/shared/contracts.ts
export interface MarkdownService {
    readonly components: …;
    /** 编辑器插件激活时调一次，交出“此刻活动的控件句柄”；停止时释放。没有连接时编辑命令不可用。 */
    connectActiveControl(source: () => EditorControlHandle | null): () => void;
}

// editor/shared/contracts.ts，EditorControlHandle 增加（只有 Markdown 控件提供）
readonly editing?: MarkdownEditing;
```

`MarkdownEditing` 的形状定义在 `markdown/shared/contracts.ts`：`run(action, args)`（执行一个动作，返回是否生效）、`state: Readonly<Ref<MarkdownEditingState>>`（选中状态与可用性）。`editor/shared/contracts.ts` 只做类型引用，与现有方向（`MarkdownControl` 类型引用编辑器合同）相反的这一条也是类型层面的，运行时依赖方向不变；若类型循环不可接受，把 `MarkdownEditing` 放到 `editor/shared/contracts.ts`。

控件里点按钮也走同一条路：`commands.execute(id, args, {source: "user"})`，目标取活动控件。点按钮之前编辑器区已把这一组设为活动：`EditorGroup` 在左键 `pointerdown` 与 `focusin` 时调 `area.focusGroup`。

### 2. 编辑动作：`packages/nb-markdown/src/editor/editing-actions.ts`（新）

纯 Tiptap，不认识工作台。每个动作：`id`、`run(editor, args)`、`active(editor)`、`enabled(editor)`。

- 复用语言已有的命令：`setCallout`、`setMarkdownAlign`、`setMarkdownRuby`、`setMarkdownBilingual`，以及 StarterKit 的粗体、列表等。
- 语言里只有 mark、没有命令的（`markdownTextColor`、`markdownHighlight`、`markdownSuperscript`、`markdownSubscript`）用 Tiptap 的 `setMark`、`toggleMark`、`unsetMark`，不给语法模块加命令。
- `enabled` 用 `editor.can()`：光标在代码块、原样块里时格式动作不可用，按钮置灰。

对外从 `@notnotype/nb-markdown/editor` 导出；按 [`packages/nb-markdown`](../../../../../packages/nb-markdown) 的边界，这个文件不引 nbook。

### 3. 命令与公开状态：`markdown/web/editing/`（新）

- `commands.ts`：每个动作一条命令 `nbook.markdown.<动作>`，`category` 是“编辑”，`effect: "write"`，`when` 要求 `nbook.markdown.writable`，`expose: {agent: "never"}`（Agent 改正文走文件工具）。块类型按类型各一条（`heading-1`、`bullet-list` 等），命令面板不用手写参数；只有颜色、高亮、对齐、注音、双语带参数，不进命令面板。
- 键位不写进声明：Ctrl+B 等继续由 Tiptap 处理（决定 3），和编辑器命令的做法一样；按钮提示里的快捷键文字写在动作目录里。
- `state.ts`：`definePublicState("nbook.markdown", …)`，`active`、`writable`，以及每个可勾选动作一个布尔键（`bold`、`italic`…）。由 `connectActiveControl` 给出的句柄的 `editing.state` 算出，换组、换文档、选区变化都跟着变。
- 撤销、重做复用 `nbook.edit.undo`、`nbook.edit.redo`，不另建。

### 4. 五个菜单位置：`markdown/shared/menus.ts`（新）

| 位置 | 贡献点 | `context` | 另有字段 |
|---|---|---|---|
| 固定工具栏 | `markdown.toolbar` | `"resource"` → `{address}` | `icon`（必填） |
| 选区浮动菜单 | `markdown.selection` | 同上 | `icon` |
| 斜杠菜单 | `markdown.slash` | 同上 | `icon` |
| 块菜单 | `markdown.block` | 同上 | `icon` |
| 正文右键 | `markdown.context` | 同上 | `icon` |

- 用现有的 `menuLocation`、`arrangeMenu`、`MenuItemRegistry`，规则与其它位置相同。内置项由各菜单自己画，贡献的项按 `arrangeMenu` 排在内置项之后（决定 3）。
- 只给 `{address}`，选区文字与编辑接口是 t12 的事（决定 1）。
- 控件拿菜单项的方式与方言目录相同：`withHost` 经 provide 交下去（`markdownMenusKey`）。

### 5. 固定工具栏：`markdown/web/components/menus/MarkdownToolbar.vue`（新）

- 放在 `MarkdownControl` 的滚动容器之外（不随正文滚动），宽度等于版心，居中，平铺，下面一条 `--divider`（决定 2、7）。
- nb-ui：`Toolbar`、`IconButton`、`DropdownMenu`（块类型、对齐、“⋯”）、`Popover` + `ColorSwatches`（颜色、高亮）、`Tooltip`。
- 19 个按钮照决定 6。放不下时从右往左收进“⋯”：按钮宽度是固定值，`ResizeObserver` 量容器宽度后按算术决定留几个，不要隐藏的测量层。
- 按下不夺走编辑器焦点（`mousedown.prevent`，动作后 `focus`）。
- 显隐：设置 `nbook.markdown/toolbar`（缺省开），“视图”菜单一条勾选项 + 命令 `nbook.markdown.toggle-toolbar`，公开键 `toolbarVisible`（决定 2）。写法照 `editor/shared/settings.ts` 的 `breadcrumbsSetting`。
- 只读文档：按钮置灰，工具栏不消失，版面不跳。

### 6. 选区浮动菜单：`menus/MarkdownBubbleMenu.vue`（新）

- 用 `@tiptap/extension-bubble-menu`（决定 10 的内容）。它负责显隐与定位，内容是 Vue 组件，外框用 `.nb-ui-popover-surface`（设计语言“浮层外观只有一个登记处”）。
- 显隐（评审板 `r2-bubble`）：松开鼠标或键盘选完时出现；选区折叠、打字、按 Esc 时收起。代码块、原样块与只读文档不出现。输入法组字时不出现。
- 注音：点了开一个带单个输入框的 `Popover`，回车确定（见待确认 2）。

### 7. 斜杠菜单：`nb-markdown/src/editor/trigger.ts`（从 Prompt 抽出）+ `menus/MarkdownSlashMenu.vue`（新）

- **触发**：把 `prompt-editor-extensions.ts` 的 `createTriggerPlugin` 与 `readTrigger` 抽成共用模块，Composer 与正文共用一份；不用 `@tiptap/suggestion`，理由已写在该处注释（查询要能按原文重算）。斜杠只在行首或空格之后触发，代码块、原样块里不触发，组字时不触发。
- **面板**：`SuggestionMenu`，四组照决定 11，“插入”组等 t09（没有命令时不显示）；不写 Markdown 写法、无占位提示（决定 14）。键盘由宿主处理：上下、回车、Tab、Esc。
- **筛选**：按名称，也按拼音首字母（`bt` 找到“标题”）。用 `pinyin-pro`（MIT，3.29.5，gzip 约 144 KB），第一次打开斜杠菜单时动态加载，加载完成前只按名称筛选，不进首屏。
- **执行**：先删掉 `/查询`，再执行命令；同一个撤销步骤。

### 8. 块按钮与块菜单：`nb-markdown/src/editor/block-gutter.ts`（新）+ `menus/MarkdownBlockGutter.vue`（新）

- **不用 `@tiptap/extension-drag-handle`**：它在运行时 import `@tiptap/y-tiptap` 与 `@tiptap/extension-collaboration`（实测包源码），会把协作依赖带进来；我们没有协作，这些 peer 也不是可选的。ProseMirror 自己的 `view.dragging`（prosemirror-view 1.42.1）加上 StarterKit 默认开着的 dropcursor 就够。
- **块**：顶层块，列表按每一项算（决定、评审板 `r1-gutter`）。一个 ProseMirror 插件按指针位置算当前块，把范围交给 Vue。
- **外观**：`+` 与手柄，右缘离正文 14px，悬停底色圆角 4px（决定 9）；版心窄到没有页边时按钮压进留白。滚动时位置跟着块。
- **`+`**：在下方插入空块并打开斜杠菜单，按住 Alt 插在上方（决定 5）。
- **手柄**：点开块菜单（`ContextMenu`），拖动移动块（起拖门槛 4px，取消：Esc 或松手在正文外）。
- **块菜单**（决定 12）：转换为（子菜单，当前类型打勾）｜创建副本、复制｜上移、下移｜贡献的项｜删除。
  - 转换：把光标放进这一块，再执行工具栏同一条块类型命令，不写第二份转换逻辑。
  - 复制：写剪贴板，经 `view.serializeForClipboard`，和 Ctrl+C 同一个结果。
  - 上移、下移：另有快捷键 Alt+↑、Alt+↓（待确认 3），这是拖动之外的键盘路径。
- 这几个按钮不进 Tab 顺序（否则正文每一块都多两个停靠点），键盘经命令面板与快捷键。

### 9. 正文右键菜单：`menus/MarkdownContextMenu.vue`（新）

- `ContextMenu`；决定 13 的六项。没有选区时剪切、复制置灰。
- 剪切、复制用 `document.execCommand`（ProseMirror 自己的剪贴板处理照常生效）；粘贴经 `navigator.clipboard.read`，再走 `view.pasteHTML` 或 `view.pasteText`，和 Ctrl+V 同一条路径。权限被拒时：这一项执行失败，提示用 Ctrl+V（不静默）。
- 只读文档：只留复制、全选。
- 右键点在选区外时光标移到点击处；点在选区内时保留选区。
- `EditorGroup` 的 `pointerdown` 只认左键，右键点别的组时靠 `focusin` 切组；选项执行前菜单自己先调一次聚焦，保证目标就是被右击的组，并补一条拆分后右击另一组的 e2e。

### 10. 不随本 Task 改的

Monaco 控件；`text-marks` 等语法模块的合同；`Editor` 实例的生命周期：换文档时 `EditorState.create({plugins: editor.state.plugins})` 共用一组插件（`MarkdownControl.vue:158`），新插件的状态按文档各一份，视图级的东西（按钮位置、菜单开关）在换绑定时清掉。

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
| `docs/specs/workbench/markdown-editing.md`（新，按 `writing-specs`，登记注册表） | 命令表、公开键、工具栏、选区菜单、斜杠菜单、块按钮与块菜单、右键菜单的输出与验收 |
| `docs/specs/workbench/menus.md` | 位置表加五行；非目标里“编辑器正文右键”删掉 |
| `docs/specs/workbench/editor.md` | “不承诺”去掉正文右键、选区菜单、斜杠；控件合同加 `editing` |
| `docs/specs/workbench/commands.md` | 目录加一句指向新 Spec |
| `MarkdownControl.md` | “不支持”与句柄同步；新组件各写同名 `.md` |

## 切片

| 片 | 内容 | 提交边界 | 验证 |
|---|---|---|---|
| S0 | Spec | 上表 | `docs:check`、`governance:check` |
| S1 | 第 1–3 节 | 动作、命令、公开键、连接 | `test:affected --typecheck`；真实 Tiptap 的 dom 测试 |
| S2 | 第 4、5 节 | 位置、工具栏、显隐设置 | 同上；Lab 场景与截图（明暗） |
| S3 | 第 6 节 | 选区菜单 | 同上 |
| S4 | 第 7 节 | 触发抽出、斜杠菜单、拼音 | 同上；Composer 的 `prompt-editor-extensions.dom.test.ts` 不改即过 |
| S5 | 第 8 节 | 块按钮、拖动、块菜单 | 同上；真实浏览器拖动 |
| S6 | 第 9 节 | 右键菜单 | 同上 |
| S7 | 收口 | 测试插件贡献五个位置、e2e、Spec 证据 | `test:affected --typecheck`、相关 e2e；实现审查（Sonnet）后合入 |

## 验收映射

编号在 S0 写进 Spec 后回填到这里。

| 行为 | 测试 |
|---|---|
| 命令与公开键（执行、`when`、跟选区变化、换组） | `markdown/web/editing/*.dom.test.ts`（真实命令服务、真实 Tiptap） |
| 动作的 `active`、`enabled`，代码块里不可用 | `nb-markdown/src/editor/editing-actions.dom.test.ts` |
| 工具栏收进“⋯”、显隐、按钮不夺焦 | `MarkdownToolbar.dom.test.ts`；e2e |
| 选区菜单的显隐条件 | e2e（真实选区） |
| 斜杠触发、筛选（含拼音）、键盘、撤销一步还原 | dom 测试；e2e |
| 块移动、副本、删除、转换；列表项 | `block-gutter.dom.test.ts`；拖动走 e2e |
| 右键的可用性；粘贴走同一路径；权限被拒的提示 | e2e（Playwright 授权与不授权各一次） |
| 插件贡献进五个位置、随入口停止撤回 | e2e（测试插件 `test.menus`） |

## 验证

- 每片：`bun run test:affected --since master --typecheck`；改了共用的触发模块时另跑 nb-markdown 的 Prompt 测试。
- 端到端：新 `e2e/markdown-editing.e2e.ts`，真实浏览器走完“打字 → 选中 → 选区菜单加粗 → `/` 换标题 → 拖动手柄移动一块 → 右键复制粘贴 → 保存后读文件”，核对写回的 Markdown。
- UI 取证按“普通 UI 改动”一档，另加明暗两色与拆分后的窄版心（工具栏收进“⋯”、按钮压进留白）。
- 跑 e2e 前停掉多余服务，跑时不改源码。
- 留下未验证的：Safari 与 Firefox 的剪贴板差异（产品主要在 Chromium 上验收）。

## 不做与风险

- 不做：行内 AI 接口（t12）、批注（t13）、链接与图片的插入（t09）、下划线、缩进按钮。
- 风险：BubbleMenu 的显隐默认值可能和 `r2-bubble` 的条件不符（按住鼠标拖选时就出现）。S3 先核对，配置不了就去掉这个依赖，直接用 `@floating-ui/dom` 定位（目前只是间接依赖，要改成直接声明）。
- 风险：一个编辑器实例换文档时，插件的视图层状态可能残留到新文档。S1 补一条“换绑定后菜单都收起”的测试。
- 风险：拖动列表项跨列表时的落点行为要看 ProseMirror 的默认结果，不符合预期的先记下，不写特例。

## 新增依赖

`@tiptap/extension-bubble-menu`（MIT，随 Tiptap 版本）、`pinyin-pro`（MIT）。都装在 `nb-markdown` 或 `neuro-book`，按使用方放。

## 开发者已确认（2026-11-05，全部按推荐）

1. **链接按钮**：t09 搁置中，本 Task 不做链接的编辑，所以工具栏与选区菜单先不出现链接按钮（命令不存在时不显示，t09 登记命令后自动出现）。推荐这样，不放一个点不了的按钮。另一个做法是现在顺手做一个只填地址的小弹层，代价是抢了 t09 要定的事。
2. **注音与双语的输入**：一个带单个输入框的弹层，回车确定。推荐。
3. **上移、下移的快捷键 Alt+↑、Alt+↓**：评审板没问过；不加的话，移动块只能靠拖动，键盘用户没有路径。推荐加。
4. **`pinyin-pro`**：评审板第 2 轮说过要加第三方库；这里定成它，按需加载。推荐。
