---
schema: nbook.spec/v1
kind: behavior
status: planned
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

设置：`nbook.editor/markdownToolbar`（布尔，缺省开），在设置窗口“编辑器”分区。

菜单位置（规则见 [`workbench.menus`](menus.md)；五个位置都有 `context: "resource"` 给出 `{address}`）：`editor.toolbar`（`icon`、`placement`）、`editor.selection`（`icon`）、`editor.slash`（`icon`）、`editor.block`（`icon`）、`editor.body-context`（`icon`）。

块模型：

| 指针下的内容 | 块 | 转换为 | 副本、移动、删除 |
|---|---|---|---|
| 段落、标题、空段落 | 这一块 | 全部 | 可用 |
| 代码块 | 这一块 | 全部（内容转为文字） | 可用 |
| 列表项与任务项（任何层级） | 这一项连同子项 | 正文、标题：提出列表再转换，列表从这里断开；列表类型：改整个列表；其余置灰 | 移动限于同一列表，到头时置灰 |
| 引用、提示块、对齐、批注块、双语 | 整个容器 | 只有“正文”（解开容器），其余置灰 | 可用 |
| 表格、分割线、原样块、HTML 嵌入 | 整块 | 全部置灰 | 可用 |

## 输出与可观察行为

1. **工具栏的内容**：撤销、重做｜块类型｜粗体、斜体、删除线、行内代码｜文字颜色、高亮｜（链接）｜无序、有序、任务列表｜引用、提示块、代码块｜对齐、清除格式｜⋯（上标、下标、分割线、注音、双语）。贡献的 `inline` 项在内置按钮之后，`menu` 项进“⋯”。
2. **工具栏的位置**：只有 Markdown 编辑器有；在标签栏与面包屑之下、正文之上，不随正文滚动；与版心同宽居中，没有底色，按钮从正文左边缘起排，下面一条分隔线。
3. **工具栏的宽度**：版心变窄时按钮从右往左收进“⋯”，贡献的项最先收；“⋯”始终在最右。任何宽度都不出现横向滚动。
4. **工具栏的显隐**：设置关掉或“视图”菜单取消勾选后，所有组的工具栏立即消失，正文上移；再打开时恢复。
5. **按钮的状态**：按钮显示自己这一组控件的状态（勾选、可用），不随别的组变化。只读文档全部置灰，版面不变。点按钮不夺走正文的焦点，动作之后光标留在正文。
6. **选区浮动菜单**：内容是粗体、斜体、删除线、行内代码｜（链接）、文字颜色、高亮｜注音、清除格式｜贡献的项。在选区上方出现（放不下时翻到下方），随滚动跟着选区。
7. **选区菜单的显隐**：以下全部满足才显示：选区非空；焦点在正文或菜单里；指针已松开（拖选中不显示）；不在输入法组字；不在代码块、原样块；文档可写；选中之后没有打字；没有按 Esc。切标签回来恢复的选区不显示，要重新选。
8. **清除格式**：移除粗体、斜体、删除线、行内代码、文字颜色、高亮、上标、下标。批注、注音、链接与块类型不变。
9. **注音与双语的输入**：点了开一个带单个输入框的弹层，回车确定，Esc 取消；没有说明文字，输入框有可访问名称。
10. **斜杠的触发**：`/` 在行首或空白之后打出时打开斜杠菜单；`、` 只在行首也算（中文输入法下这个键打出的字符）。代码块、原样块、表格单元格里不触发；组字时不触发。接着打的字是查询，Esc、删掉触发字符、光标离开时收起；Esc 收起后同一处不再打开。
11. **斜杠菜单的内容**：基本（正文、标题 1–3）、列表（无序、有序、任务）、块（引用、提示块、代码块、分割线、表格、双语对照），贡献的项在各组之后。每项只有图标与名称。
12. **筛选**：按名称，也按拼音首字母（`bt` 找到“标题 1”）。拼音库第一次打开时加载，加载完成前只按名称筛。筛不出项时菜单不显示，回车照常换行。
13. **选择**：上下键移动、回车或 Tab 选择。选择后 `/查询` 被删掉并执行动作；撤销一步回到 `/查询`。光标留在输入处，打开与关闭都不移动焦点。
14. **块按钮**：指针停在一块上时，左侧出现 `+` 与手柄，右缘离正文 14px，悬停底色圆角 4px，与这一块第一行垂直居中。所有层级的列表项按钮都在同一列。只读文档不出现。
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

## 状态与转换

菜单状态都按控件实例算，没有持久化（工具栏显隐除外）。

时序与寿命：

- 换文档、切标签：所有浮动菜单与块按钮收起，查询作废。
- 编辑组的布局变化让控件重挂：菜单状态清空，编辑器实例与撤销历史不变，重挂后各菜单照常工作。
- 编辑器插件停止：命令与菜单项撤回；打开着的菜单关闭。
- 命令经活动控件执行；点工具栏按钮时这一组先成为活动组（[`workbench.editor`](editor.md)），所以目标就是被点的组。

## 副作用与数据

动作的副作用就是编辑（进撤销历史，第 15 条的除外），写回规则见 [`workspace.markdown-dialect`](../workspace/markdown-dialect.md)。设置 `nbook.editor/markdownToolbar` 随设置保存。

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

Smoke：`e2e/markdown-editing.e2e.ts`。

## 证据

- 批准依据：开发者 2026-10-20、2026-11-05 的决定，记在主工作区 master 的 `.agents/works/w00025-editor/tasks/t08-editing-menus/README.md` 决定 1–15。
