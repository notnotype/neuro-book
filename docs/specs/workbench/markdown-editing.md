---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workbench.markdown-editing
owners:
  - nbook.editor
  - nbook.markdown
---

# Markdown 编辑命令与菜单

## 目标与非目标

**目标**：写作者在 Markdown 富文本编辑器里用固定工具栏、选区浮动菜单、斜杠菜单、块按钮与块菜单、正文右键菜单完成常用编辑；每个编辑动作都是工作台命令，命令面板找得到，插件能往每种菜单里加菜单项。

**不承诺**：

- 插入链接、图片与引用文件（链接按钮在 `nbook.edit.link` 登记后才出现）；批注的添加与编辑；给插件的编辑器接口（读写选区、转交光标）。
- 下划线（方言没有）；增减缩进的按钮（列表里 Tab、Shift+Tab 照旧）。
- 源码编辑器与别的编辑器：它们不提供编辑动作，这些命令在它们活动时不可用。
- 用键盘走到块按钮：按钮不进 Tab 顺序，键盘经快捷键与命令面板。
- 右键菜单粘贴文件或图片（Ctrl+V 照旧）。
- 跨列表移动列表项的按钮（拖动的落点按 ProseMirror 的结果）。
- 多块选区上的块动作：副本、移动、删除只作用于选区起点所在的那一块。

## 术语与参与者

- **编辑动作**：控件能执行的一次编辑，例如加粗、换成标题 2。工作台经控件句柄的 `editing` 使用它（下面的“输入与前置条件”）。
- **块**：块按钮与块菜单作用的对象，见下面的块模型表。
- 参与者：`nbook.editor`（命令、公开键、菜单位置、设置）、`nbook.markdown` 的 Markdown 控件（画菜单、实现动作）、贡献菜单项的插件。

## 输入与前置条件

控件句柄（[`workbench.editor`](editor.md) 的控件合同）增加可选字段：

```ts
interface EditorEditing {
    run(action: string, args?: Readonly<Record<string, unknown>>): boolean;
    active(action: string): boolean;
    enabled(action: string): boolean;
    readonly hasSelection: Readonly<Ref<boolean>>;
}
```

命令表（都由 `nbook.editor` 登记，`effect: write`，Agent 不可调用，键位不写进声明，由 Markdown 控件在自己有焦点时处理）：

| 命令 | 参数 | `when`（都另要 `nbook.editor/writable`） | 快捷键 |
|---|---|---|---|
| `nbook.edit.bold`、`italic`、`strike`、`code` | 无 | `canFormat` | Ctrl+B、Ctrl+I、Ctrl+Shift+S、Ctrl+E |
| `nbook.edit.superscript`、`subscript` | 无 | `canFormat` | — |
| `nbook.edit.clear-format` | 无 | `canFormat` | — |
| `nbook.edit.text-color`、`highlight` | `{color: string \| null}` | `canFormat` | — |
| `nbook.edit.ruby` | `{text: string}` | `canFormat`、`hasSelection` | — |
| `nbook.edit.ruby-remove` | 无 | `canFormat`（选区或光标处没有注音时 `unavailable`） | — |
| `nbook.edit.paragraph`、`heading-1`、`heading-2`、`heading-3` | 无 | `canConvertBlock` | Ctrl+Alt+0–3 |
| `nbook.edit.bullet-list`、`ordered-list`、`task-list` | 无 | `canConvertBlock` | Ctrl+Shift+8、7、9 |
| `nbook.edit.quote`、`callout`、`code-block` | 无 | `canConvertBlock` | Ctrl+Shift+B、—、Ctrl+Alt+C |
| `nbook.edit.align` | `{value: "left" \| "center" \| "right" \| "justify"}` | `canConvertBlock` | — |
| `nbook.edit.bilingual` | `{text: string}` | `canConvertBlock` | — |
| `nbook.edit.divider`、`table` | 无 | `canConvertBlock` | — |
| `nbook.edit.block-up`、`block-down` | 无 | 无另外条件 | Alt+↑、Alt+↓ |
| `nbook.edit.block-duplicate`、`block-delete`、`block-unwrap` | 无 | 无另外条件 | — |

另有 `nbook.view.toggle-editor-toolbar`（无参数，勾选状态读 `toolbarVisible`，任何时候可用）切换设置 `nbook.editor/markdownToolbar`。

撤销、重做用已有的 `nbook.edit.undo`、`nbook.edit.redo`。带参数的命令不进命令面板。

公开键（布尔，`nbook.editor/` 下，未就绪为假，读活动控件）：`canFormat`、`canConvertBlock`、`hasSelection`、`toolbarVisible`，以及勾选状态 `formatBold`、`formatItalic`、`formatStrike`、`formatCode`、`formatSuperscript`、`formatSubscript`、`formatHeading1`、`formatHeading2`、`formatHeading3`、`formatBulletList`、`formatOrderedList`、`formatTaskList`、`formatQuote`、`formatCallout`、`formatCodeBlock`。

设置：`nbook.editor/markdownToolbar`（布尔，缺省开）、`nbook.editor/markdownToolbarPlacement`（`full`、`merged`、`bottom`，缺省 `full`），在设置窗口“编辑器”分区。

菜单位置（规则见 [`workbench.menus`](menus.md)；五个位置都有 `context: "resource"` 给出 `{address}`）：`editor.toolbar`（`icon`、`placement`）、`editor.selection`（`icon`）、`editor.slash`（`icon`）、`editor.block`（`icon`）、`editor.body-context`（`icon`）。

块模型：

| 指针下的内容 | 块 | 转换为 | 副本、移动、删除 |
|---|---|---|---|
| 段落、标题、空段落 | 这一块 | 全部 | 可用 |
| 代码块 | 这一块 | 全部（内容转为文字） | 可用 |
| 列表项与任务项（任何层级） | 这一项连同子项 | 正文、标题：提出列表再转换，列表从这里断开；列表类型：改整个列表；其余置灰 | 移动限于同一列表，到头时置灰 |
| 引用、提示块、对齐、批注块、双语 | 整个容器 | 只有“正文”（解开容器；提示块的标题留成开头一段），其余置灰 | 可用 |
| 表格、分割线、原样块、HTML 嵌入 | 整块 | 全部置灰 | 可用 |

## 输出与可观察行为

1. **工具栏的内容**：撤销、重做｜块类型｜粗体、斜体、删除线、行内代码｜文字颜色、高亮｜（链接）｜无序、有序、任务列表｜引用、提示块、代码块｜对齐、清除格式｜⋯（上标、下标、分割线、注音、双语）。贡献的 `inline` 项在内置按钮之后，`menu` 项进“⋯”。文字颜色与高亮是拆分按钮：左半边一点就上色，用上次选过的颜色（第一次是红色文字、黄色高亮），图标下的色条就是这个颜色；右半边的小箭头打开色板。在色板（包括“⋯”里的）选了颜色就记住，选“无”不改记住的颜色；刷新、重开应用后仍记得，选区菜单与工具栏共用一份。
2. **工具栏的位置**：只有 Markdown 编辑器有，不随正文滚动。设置 `nbook.editor/markdownToolbarPlacement` 决定位置：`full`（缺省）在面包屑下面通栏，按钮居中、和版心同一条中轴，下面一条贯通的分隔线；`merged` 并入面包屑那一行的右侧，放不下时比面包屑先收；`bottom` 是编辑区底部居中的浮条，滚到底时不挡最后一行。
3. **工具栏的宽度**：放不下时按钮从右往左收进“⋯”，贡献的项最先收；“⋯”始终在最右。任何宽度都不出现横向滚动。
4. **工具栏的显隐**：设置关掉或“视图”菜单取消勾选后，所有组的工具栏立即消失，正文上移；再打开时恢复。切到别的编辑器时不留着。
5. **按钮的状态**：按钮显示自己这一组控件的状态（勾选、可用），不随别的组变化。只读文档全部置灰，版面不变。点按钮不夺走正文的焦点，动作之后光标留在正文。
6. **选区浮动菜单**：内容是块类型｜粗体、斜体、删除线、行内代码｜（链接）、文字颜色、高亮｜注音、清除格式｜贡献的项。在选区上方出现（放不下时翻到下方），随滚动跟着选区。块类型是与工具栏相同的下拉（正文、标题 1–3，当前类型打勾），选了以后焦点回到正文；颜色是与工具栏相同的拆分按钮（输出 1）。选区里有注音（盖住一部分也算）时注音按钮显示按下。
7. **选区菜单的显隐**：以下全部满足才显示：选区非空；焦点在正文或菜单里（包括菜单自己打开的色板与块类型下拉；工具栏打开的不算，焦点进去时选区菜单收起，免得盖住它们）；指针已松开（拖选中不显示）；不在输入法组字；不在代码块、原样块；文档可写；选中之后没有打字；没有按 Esc。切标签回来恢复的选区不显示，要重新选。
8. **清除格式**：移除粗体、斜体、删除线、行内代码、文字颜色、高亮、上标、下标。批注、注音、链接与块类型不变。
9. **注音与双语的输入**：点了在选区下方开一张一行的卡片：字直接写在卡片里（输入框没有自己的框），右边是确定按钮；输入框里回车或点确定写回，Esc 取消，焦点离开时收起；把字清空再确定等于取消。焦点在卡片的按钮上时回车是那个按钮的动作；输入法组字时的回车与 Esc 归输入法。没有说明文字，输入框有可访问名称。卡片开着时原来的选区仍画成选中的样子，选区菜单不显示。注音另有：选区里已有注音时，确定按钮左边多一个“移除注音”（`nbook.edit.ruby-remove`，去掉选区碰到的整段注音）；碰到的注音只有一种读音时卡片预填它，碰到几段读音不同的注音时不预填（确定会把整个选区写成一个读音）。点正文里注音的小字（不带修饰键），选中这整段注音并打开卡片（只读文档不打开）；卡片开着时点另一段的小字，卡片换到那一段、重新预填。双语的卡片不预填，没有移除按钮。
10. **斜杠的触发**：`/` 在行首或空白之后打出时打开斜杠菜单；`、` 只在行首也算（中文输入法下这个键打出的字符）。代码块、原样块、表格单元格里不触发；组字时不触发。接着打的字是查询，Esc、删掉触发字符、光标离开时收起；Esc 收起后同一处不再打开。
11. **斜杠菜单的内容**：基本（正文、标题 1–3）、列表（无序、有序、任务）、块（引用、提示块、代码块、分割线、表格、双语对照），贡献的项在各组之后。每项只有图标与名称。
12. **筛选**：按名称，也按拼音首字母（`bt` 找到“标题 1”）。拼音库第一次打开时加载，加载完成前只按名称筛。筛不出项时菜单不显示，回车照常换行。
13. **选择**：上下键移动、回车或 Tab 选择。选择后 `/查询` 被删掉并执行动作；撤销一步回到 `/查询`。光标留在输入处，打开与关闭都不移动焦点。
14. **块按钮**：指针停在一块上，或光标在这一块且没有选中内容时，左侧出现 `+` 与手柄（指针优先）；打字时跟着光标，正文失焦时收起。按钮右缘离正文 14px，悬停底色圆角 4px，与这一块第一行垂直居中。所有层级的列表项按钮都在同一列。只读文档不出现。
15. **`+`**：在下方插入一个段落并打开斜杠菜单（点的时候按住 Alt 插在上方）。菜单放弃（Esc、失焦、光标离开）且这一块还只有触发字符时，这一块被删掉，文件字节不变；这一过程不留撤销步骤。
16. **拖动手柄**：拖动移动这一块，正文里有落点线；松手在正文外或按 Esc 取消，文档不变。取消之后从别处拖进来的内容不受影响。
17. **块菜单**：点手柄打开：转换为（子菜单，当前类型打勾）｜创建副本、复制｜上移、下移｜贡献的项｜删除。各项是否可用见块模型表。
18. **副本**：紧接在这一块之后，内容相同；写回时按新内容写出，不和原块共用原文。原块里的批注在副本里也在。
19. **移动**：移动后没有被编辑的块，写回的字节不变（方言的间隔规则照旧，见 [`workspace.markdown-dialect`](../workspace/markdown-dialect.md)）。macOS 上 Option+↑↓ 被这两个快捷键占用，不再跳段落。
20. **右键菜单**：正文里右键打开：剪切、复制、粘贴、粘贴为纯文本｜全选｜贡献的项。没有选区时剪切、复制置灰。只读文档只有复制、全选。这个菜单盖掉浏览器自带的右键菜单。
21. **右键的选区**：点在选区内时保留选区；点在选区外时光标移到点击处。右键点别的组时，那一组变成活动组，菜单作用于它。
22. **复制与剪切**：结果和 Ctrl+C、Ctrl+X 相同，粘贴回编辑器时列表与提示块的结构保留。块菜单的“复制”复制这一块。
23. **粘贴**：结果和 Ctrl+V 相同（文字与 HTML）。浏览器不给读剪贴板时给出通知，说明原因并建议用 Ctrl+V：接口不可用、权限被拒、剪贴板里没有文字（例如图片或文件）是三条不同的文字。
24. **命令面板**：不带参数的编辑命令在 Markdown 编辑器活动时可选，条件不满足时不列出；执行结果与点按钮相同。
25. **贡献的项**：显示与可用规则同 [`workbench.menus`](menus.md)；点了以后命令收到 `{address}`。
26. **注音是一个整体**：加上或去掉格式（粗体、斜体、删除线、行内代码、文字颜色、高亮、上标、下标、链接、批注、清除格式，以及设新注音、去掉注音）时，只盖住一段注音的一部分，就连整段注音一起改，不把注音切成两段；不管是从按钮、菜单、快捷键还是 `**…**` 这类输入规则来的，都一样，与原来的改动在同一个撤销步里。行内代码排斥注音：盖住注音的一部分时整段注音变成代码。拖选经过注音时注音的小字不画成选中，复制出来的文字也不带它。已知限制：在注音中间带着存下的格式打字、往注音中间粘贴带格式的文字，注音照旧被切开。

## 状态与转换

菜单状态都按控件实例算，没有持久化（工具栏显隐与颜色按钮记住的颜色除外）。

时序与寿命：

- 换文档、切标签：所有浮动菜单与块按钮收起，查询作废。
- 编辑组的布局变化让控件重挂：菜单状态清空，编辑器实例与撤销历史不变，重挂后各菜单照常工作。
- 编辑器插件停止：命令与菜单项撤回；打开着的菜单关闭。
- 命令经活动控件执行；点工具栏按钮时这一组先成为活动组（[`workbench.editor`](editor.md)），所以目标就是被点的组。

## 副作用与数据

动作的副作用就是编辑（进撤销历史，第 15 条的除外），写回规则见 [`workspace.markdown-dialect`](../workspace/markdown-dialect.md)。设置 `nbook.editor/markdownToolbar` 随设置保存。卡片开着时画出的选区不是编辑，不进撤销历史，不写进文件。

颜色按钮记住的颜色（输出 1）存在用户级、只在本机的记录 `markdown.colors`（`nbook.markdown` 拥有，第 1 版，`{text?: string, highlight?: string}`，值是 `#rrggbb`），不进作品目录。记录读不出或已损坏时按缺省颜色，这时选了颜色也不记（存储不覆盖读不出的记录）；保存失败或结果未知时只改这次运行里的显示，不重试也不提示（这是偏好，不是要用户处理的数据）；应用没装存储服务时只在这次运行里记住。

## 失败与恢复

| 情形 | 结果 |
|---|---|
| 命令执行时活动控件没有 `editing`，或动作此刻不可用 | `unavailable`，原因是文字值 |
| 右键粘贴读不到剪贴板 | 输出 23 的通知，文档不变 |
| 拼音库加载失败 | 记诊断，继续只按名称筛选 |
| 贡献的命令不在目录里 | 不显示（[`workbench.menus`](menus.md) 输出 1） |

## 边界与兼容

- 公开接口：命令 id、公开键、五个菜单位置、`EditorEditing`。字段只追加。
- 信任边界：菜单项只能引用命令；位置只给 `{address}`，不给选区内容。
- 命令表以外的 Tiptap 快捷键不是这份合同的一部分。

## 验收与 Smoke

1. Given 空白章节，When 打字、选中一段点选区菜单的粗体、在新行打 `/bt` 回车、拖动手柄把一块移到前面、右键复制再粘贴、保存，Then 文件里的 Markdown 与这些操作一致，没有动过的块字节不变。
2. Given 拆成两组的两份 Markdown，When 光标在左组的粗体里，Then 右组工具栏的粗体不是勾选状态；When 在右组右键或点按钮，Then 动作作用于右组。
3. Given 点了 `+` 又按 Esc，Then 文件字节不变、没有多余的撤销步骤。
4. Given 拖动手柄后按 Esc 取消，When 从别的页面拖一段文字进编辑器，Then 插入的是这段文字，旧块与选区不动。
5. Given 带批注的段落，When 全选后清除格式，Then 批注还在；When 创建副本，Then 两块都有批注，写回能读回。
6. Given 测试插件往五个位置各贡献一条，When 打开各菜单，Then 都排在内置项之后，点了收到 `{address}`；When 入口停止，Then 都不再显示。
7. Given 段落“前文注音后文”，“注音”两字带注音，When 用鼠标从两字中间拖到“后”之后，Then 选中的文字里没有注音的小字；When 按 Ctrl+B 并保存，Then 文件里是一个注音，粗体盖住整段注音与“后”。
8. Given 段落里一段带注音的文字，When 点注音的小字，Then 卡片预填原来的注音、正文里整段注音画成选中、选区菜单不显示；When 把卡片里的字清空再回车，Then 注音不变；When 再打开并点“移除注音”，Then 保存后文件里没有这个注音。
9. Given 第一次用，When 选中文字点工具栏文字颜色的左半边，Then 文字是红色；When 用箭头打开色板，Then 选区菜单不显示；When 选蓝色、刷新页面、在另一份文档里选中文字点左半边，Then 文字是蓝色。

Smoke：`e2e/markdown-editing.e2e.ts`。

## 实现合同

- 公开入口：`editor/shared/contracts.ts`（`EditorEditing`、`EDITING_ACTIONS`、`EditorMenus`、`editorMenusKey`、五个贡献点 id）；`@notnotype/nb-markdown/editor`（`markdownEditingActions`、块与斜杠的操作）；nb-ui 的 `AnchoredPopover`、`Toolbar` 的 `variant="flat"`。
- owner 与依赖方向：命令、公开键、菜单位置与设置归 `nbook.editor`；菜单界面在 `nbook.markdown` 的控件里，只引 `editor/shared/contracts.ts`；动作实现在 `nb-markdown`，不引宿主。
- 不变量：动作目录不引 Tiptap，插件入口静态引用它，首屏不含编辑内核；目录里的每个动作都有实现（`MarkdownControl.dom.test.ts`）。
- 不变量：菜单状态按控件实例算，不写 ProseMirror 插件视图、不在扩展配置里捕获组件 DOM：换 `EditorState` 时 `plugins` 数组换了，插件视图全部重建（`markdown-editing.e2e.ts` 的“切标签回来”“组件重挂”）。
- 不变量：内置菜单读自己控件的 `editing`，公开键只服务命令的 `when`、贡献项与命令面板，拆分后互不带偏（`markdown-editing.e2e.ts` 的“拆分后”）。
- 不变量：块菜单的动作从选区反推块，容器与原子块用节点选区（`block-actions.dom.test.ts`）；拖动结束自己清 `view.dragging`（`markdown-editing.e2e.ts` 的拖动用例）。
- 不变量：注音整体（输出 26）在注音语法自己的 ProseMirror 插件里补，按加标记、去标记的步认，不在各个命令上补：格式的入口有编辑动作、编辑内核自带的快捷键与输入规则，最后都落成这两种步（`nb-markdown/src/language/syntax/ruby/whole-ruby.ts`，`whole-ruby.dom.test.ts`）。
- 不变量：卡片开着时“原来的选区仍画着”用 ProseMirror 装饰画（`nb-markdown/src/editor/held-selection.ts`），不靠 DOM 选区：焦点进了输入框，浏览器就不画正文的选区。装饰随编辑映射，不进撤销历史；`MarkdownControl` 换文档、存下 `EditorState` 之前先清掉，免得切回来时还画着（`held-selection.dom.test.ts`；换文档的那一条在 `MarkdownControl.dom.test.ts` 的“换到别的文档再换回来”）。
- 不变量：选区菜单自己打开的一层（色板、块类型下拉）带 `data-markdown-menu-layer`，菜单按焦点在不在这一层里判断“焦点在菜单里”；工具栏打开的同一组件不带这个标记（`MarkdownColorButton`、`MarkdownBlockTypeMenu` 的 `inSelectionMenu`）。块类型下拉与颜色按钮由工具栏与选区菜单共用一份组件。
- 颜色记录 `markdown.colors` 由 `markdown/web/colors.ts` 定义，插件激活时按可选依赖取存储服务，取不到用只在内存里的一份；组件经注入取用。卡片里的输入框是 nb-ui `Input` 的 `variant="bare"`。

## 证据

- 批准依据：开发者 2026-10-20、2026-11-05 的决定，记在主工作区 master 的 `.agents/works/w00025-editor/tasks/t08-editing-menus/README.md` 决定 1–15；2026-11-10、2026-11-11 的决定（选区菜单、注音卡片、颜色拆分按钮），记在 `.agents/works/w00025-editor/tasks/t20-selection-menu-polish/README.md` 决定 1–5。
- 实现入口：[`editor/web/editing-commands.ts`](../../../packages/neuro-book/src/plugins/editor/web/editing-commands.ts)、[`editor/shared/editing.ts`](../../../packages/neuro-book/src/plugins/editor/shared/editing.ts)、[`markdown/web/components/menus/MarkdownMenus.vue`](../../../packages/neuro-book/src/plugins/markdown/web/components/menus/MarkdownMenus.vue)、[`nb-markdown/src/editor/editing-actions.ts`](../../../packages/nb-markdown/src/editor/editing-actions.ts)、[`nb-markdown/src/editor/block-actions.ts`](../../../packages/nb-markdown/src/editor/block-actions.ts)、[`nb-markdown/src/editor/held-selection.ts`](../../../packages/nb-markdown/src/editor/held-selection.ts)、[`nb-markdown/src/editor/ruby-text.ts`](../../../packages/nb-markdown/src/editor/ruby-text.ts)、[`markdown/web/colors.ts`](../../../packages/neuro-book/src/plugins/markdown/web/colors.ts)、[`markdown/web/components/menus/MarkdownColorButton.vue`](../../../packages/neuro-book/src/plugins/markdown/web/components/menus/MarkdownColorButton.vue)、[`markdown/web/components/menus/MarkdownBlockTypeMenu.vue`](../../../packages/neuro-book/src/plugins/markdown/web/components/menus/MarkdownBlockTypeMenu.vue)、[`markdown/web/components/menus/MarkdownTextPrompt.vue`](../../../packages/neuro-book/src/plugins/markdown/web/components/menus/MarkdownTextPrompt.vue)
- 合同测试：[`editing-commands.test.ts`](../../../packages/neuro-book/src/plugins/editor/web/editing-commands.test.ts)、[`editing-actions.dom.test.ts`](../../../packages/nb-markdown/src/editor/editing-actions.dom.test.ts)、[`whole-ruby.dom.test.ts`](../../../packages/nb-markdown/src/language/syntax/ruby/whole-ruby.dom.test.ts)（输出 26）、[`held-selection.dom.test.ts`](../../../packages/nb-markdown/src/editor/held-selection.dom.test.ts)、[`ruby-text.dom.test.ts`](../../../packages/nb-markdown/src/editor/ruby-text.dom.test.ts)（输出 9）、[`MarkdownTextPrompt.dom.test.ts`](../../../packages/neuro-book/src/plugins/markdown/web/components/menus/MarkdownTextPrompt.dom.test.ts)（输出 9）、[`block-actions.dom.test.ts`](../../../packages/nb-markdown/src/editor/block-actions.dom.test.ts)、[`slash-trigger.dom.test.ts`](../../../packages/nb-markdown/src/editor/slash-trigger.dom.test.ts)、[`clipboard.dom.test.ts`](../../../packages/neuro-book/src/plugins/markdown/web/components/menus/clipboard.dom.test.ts)
- Smoke：[`markdown-editing.e2e.ts`](../../../packages/neuro-book/e2e/markdown-editing.e2e.ts)
