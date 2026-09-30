---
标签: [state:local]
别名: ["提示词编辑器", "输入框编辑器", "Prompt Editor"]
---

# PromptEditor

写给 Agent 的一段话的编辑器。Agent 输入框与历史消息的就地编辑共用它，`NovelPromptBar` 以后迁移过来。正文不做格式，但几类内容有专门的样子：引用、技能、命令显示为标签；图片与文件进上方的附件条，正文在插入处留 `#N` 标签；大段粘贴按大小折叠成粘贴块或转为文件附件。另有触发菜单与输入历史。

**文字是唯一真相**：编辑器对外只交出一段文字，所有特殊内容都按下文“文字写法”写在文字里；读进来的文字原样写回，一个字符都不变。服务端、草稿存储与消息视图认的是同一套写法。

它取代 `ReferencePlainTextEditor`。旧编辑器在新侧栏接入主页面前保持不动，届时迁移 `NovelPromptBar` 后删除。

## 文字写法

| 内容 | 写法 | 编辑器里的样子 |
|---|---|---|
| 引用 | `[名称](目标)`，目标是引用地址或工作区路径 | 引用标签，按目标类型取图标与色调 |
| 技能 | `$名称` 或 `${名称}` | 技能标签 |
| 选区引用 | `[[路径#L起-L止]]` | 选区标签 |
| 命令 | 正文开头的 `/名称`，名称须在 `commands` 里 | 命令标签，后面的参数是普通文字 |
| 图片 | `![image #N](附件目标)` | 正文里的图片标签 `#N`；附件条里的缩略图 |
| 文件附件 | `[file #N · 文件名](附件目标)` | 正文里的文件标签 `#N`；附件条里的卡片 |
| 粘贴块 | 独占几行：`<paste id="N">`、内容、`</paste>` | 折叠的粘贴块 |
| 粘贴块的位置标记 | `[paste #N]`，只在粘贴块放到开头时出现 | 粘贴标签 `#N` |

- 编号分两套，与 omp 一致：图片一套，文件附件与粘贴块共用另一套。每套在一次编辑里只增不减，删掉的号不再使用。读入的文字里没有编号的图片（旧草稿的 `![任意名称](目标)`）按出现顺序接着编号，文字本身不改。
- 附件目标是会话附件的路径。模型拿到的是路径，需要时用读文件工具去读；以后可以换成 omp 那种 `local://` 地址，写法不变。
- 标签只在读入文字、粘贴、菜单确认时出现。手打的写法保持为文字，下次读入时才显示为标签，写回的文字不受影响。

## 布局

外框里自上而下：附件条、正文区；候选菜单贴着外框画在外面。

- **外框**：圆角、描边、输入底色；获得焦点时描边换成焦点色。`bare` 时去掉描边、底色与圆角，由外层画框。
- **附件条**：正文里有图片或文件附件时出现，没有时不占高度。一行卡片，放不下时横向滚动。图片卡片是 48px 缩略图，文件卡片是图标、文件名与大小，大段粘贴转成的文件卡片显示前两行文字与行数。每张卡片角上标 `#N`，并带“移除”按钮。上传中的卡片显示转圈；失败的卡片用危险色描边，带“重试”与“移除”。
- **正文区**：随内容长高，夹在 `minHeight` 与 `maxHeight` 之间；超过上限后正文区内部滚动，外框与附件条不动。输入时光标始终保持可见。
- **粘贴块**：在正文里独占一段，与正文同宽。头部一行：图标、`#N`、“粘贴的文本 · 42 行”，以及“展开”“转为文字”“删除”三个按钮；下面用等宽字显示内容，收起时只显示前 3 行，展开后显示全文，超过正文区高度时随正文区一起滚动。
- **标签**：与正文同一行高的行内块，名称过长时截断，悬停提示给出全称。图片与文件标签只显示图标加 `#N`。
- **候选菜单**：与外框同宽，默认在外框上方（`menuPlacement: "below"` 时在下方）。自上而下：标题行（可选）、候选项（按组分段，组标题不可选）、底部一行按键提示。最多显示约 8 项，更多时菜单内部滚动。加载中显示转圈与“正在加载”，没有结果时显示宿主给的空结果文字或“没有匹配项”。
- **输入历史搜索**：与候选菜单同一位置、同一外观，顶部多一个搜索框。
- **390×844**：结构不变；附件条横向滚动，菜单仍与外框同宽，正文更早触到高度上限。

## 交互

### 输入与提交

- 每次编辑后发出 `change`，携带完整文字。宿主换了草稿版本时正文整体替换，这次替换不发 `change`。
- `enterSubmits` 为真（默认）时回车发出 `submit`，`mod` 为假；Shift+回车换行。`enterSubmits` 为假时回车换行，例如输入框的展开模式。Ctrl/⌘+回车在两种设置下都发出 `submit`，`mod` 为真。菜单打开时回车交给菜单；输入法组字过程中的回车交还输入法。内容为空时照常发出，是否受理由宿主决定。
- Escape：菜单打开时关闭菜单，直到触发字符后的文字再变化才重新打开；菜单没开时发出 `escape`。
- Shift+Tab 发出 `shift-tab`，不移动焦点。Tab 在菜单没开时保持浏览器默认的焦点移动。
- 点击正文区空白处：光标移到末尾并聚焦；点在已有文字上保留落点。

### 触发菜单

- `triggers` 里的字符位于正文开头、空白之后或 `(` 之后时开始一次查询，查询文字是它后面到光标为止、不含空白的部分；查询变化时用 `resolveMenu({trigger, query, atStart})` 重新取菜单，`atStart` 表示触发字符前只有空白。输入空白、光标移出这段文字、失去焦点都会关闭菜单。每次从关到开发出一次 `menu-open`，宿主可以据此开始加载数据。
- 上下方向键移动高亮，跳过禁用项，到头后回到另一端；回车或 Tab 确认；鼠标点击确认，点击不会让正文失去焦点。确认后触发字符和查询文字替换为该项的 `insertText`，能识别的写法变成标签，后面补一个空格。`continues` 为真的项不补空格，插入后仍构成触发时菜单按新的查询继续，用于逐级进入：例如 `@` 没有查询时列出类别，选“章节”插入 `@chapter://` 并列出章节；输入了文字则由宿主返回按类别分组的全局搜索结果。
- 菜单打开期间 `resolveMenu` 换成新函数时，按当前查询重新取菜单：宿主在数据到达后换一个新函数，菜单就从“正在加载”变成结果，不需要其他通知。

### 标签

- 光标一次跨过一整枚；标签紧挨光标时退格或 Delete 删除整枚；复制得到它的原文。
- 点击标签发出 `token-activate`，宿主决定打开引用、预览图片或文件；宿主不处理时没有反应。
- 删除图片或文件标签，附件条里对应的卡片一起消失；在附件条里移除卡片，正文里的标签一起消失。悬停或聚焦卡片时正文里对应的标签高亮，反过来也一样。

### 粘贴

- 普通粘贴只取纯文本，格式丢弃，能识别的写法变成标签。粘贴的文字按大小分三档，阈值来自 `pastePolicy`：
  - **小**（行数与字符数都不超过内联上限，默认 10 行、1000 字符）：原样插入。
  - **中**：在粘贴处成为粘贴块，编号取文件附件那一套。`blockPlacement` 为 `"start"` 时，粘贴块放到正文开头（已有的粘贴块之后），粘贴处留一枚粘贴标签。
  - **大**（行数或字符数达到附件下限，默认 100 行或 20000 字符）：`acceptFiles` 为真时转为文件附件，以 `paste-N.txt` 为名发出 `attachment-add`，粘贴处留文件标签；`acceptFiles` 为假时按“中”处理。内容里含 `</paste>` 的中等粘贴也按“大”处理，免得粘贴块提前结束。
- Ctrl/⌘+Shift+V 粘贴原文：不分档，不识别写法，全部作为普通文字插入。
- 剪贴板或拖入的文件：图片在 `acceptImages` 为真时、其他文件在 `acceptFiles` 为真时，在光标处或落点插入对应标签，各发一次 `attachment-add`；不接受的发出 `attachment-reject`，说明原因由宿主负责。只读时粘贴与拖入都被忽略。
- 粘贴块的“展开”只切换显示；“转为文字”把它换成同样内容的普通文字，此后可以编辑；“删除”连同位置标记一起删除。粘贴块本身的内容不能直接编辑。

### 附件

- 新加入的附件由编辑器生成 `localId`，状态按 `attachments` 里同一 `localId` 的项显示：上传中、失败（点“重试”发出 `attachment-retry`）、就绪。就绪后标签写回 `![image #N](目标)` 或 `[file #N · 文件名](目标)`，并发出一次 `change`；上传完成前附件不在文字里。
- 未就绪的附件因任何原因从正文消失时（退格、点“移除”、宿主换了草稿版本）发出一次 `attachment-remove`。
- 上传中的图片先用本地文件显示缩略图；就绪的图片缩略图来自 `resolveThumbnail`，取不到时显示占位图标。

### 输入历史

- `recall` 是宿主给的已发送内容，最新的在前。正文为空，或者正文仍是刚调出的那一条且未改动时，光标在第一行按上方向键调出更早的一条；光标在最后一行按下方向键调出较新的一条，越过最新一条时回到空正文。一旦编辑，就不再处于翻看状态。调出的内容整体替换正文并发出 `change`。
- Ctrl+R 打开输入历史搜索，焦点移到搜索框：输入文字过滤 `recall`，方向键选择，回车用选中的一条替换正文并把焦点移回正文，Escape 关闭搜索并把焦点移回正文，正文不变。

### 只读

不能编辑、不能粘贴或拖入、不开菜单、不能翻看输入历史；可以选中与复制；附件条与粘贴块的按钮隐藏，只剩“展开”；`aria-readonly` 为真。

### 可访问性

正文区是 `role="textbox"`、`aria-multiline="true"`，可访问名称取 `ariaLabel`，为空时取 `placeholder`。菜单打开时正文区带 `aria-expanded`、`aria-controls` 与 `aria-activedescendant`；菜单是 `role="listbox"`，每项是 `role="option"`，禁用项带 `aria-disabled`。附件卡片与粘贴块的按钮都有可访问名称，失败原因写在卡片的可访问描述里。

## 数据

```ts
type PromptEditorDraft = {
    text: string;
    /** 版本号变化时正文替换为 text；同一版本内 text 的变化被忽略，因为那是编辑器自己上报的回声。 */
    version: number;
};

type PromptEditorMenuContext = {
    trigger: string;
    /** 触发字符后到光标为止的文字，不含空白。 */
    query: string;
    /** 触发字符前只有空白，例如只在开头有效的命令。 */
    atStart: boolean;
};

type PromptEditorMenuItem = {
    /** 同一次结果内唯一。 */
    id: string;
    label: string;
    description?: string;
    iconClass?: string;
    /** 分组标题；相邻且同组的项只显示一次标题。 */
    group?: string;
    /** 禁用项显示但不能高亮与确认。 */
    disabled?: boolean;
    /** 确认后替换触发字符与查询文字的内容。 */
    insertText: string;
    /** 为真时不补空格，插入后仍构成触发则菜单继续。 */
    continues?: boolean;
};

type PromptEditorMenu = {
    title?: string;
    items: PromptEditorMenuItem[];
    /** 数据还没到；显示“正在加载”，已有的项照常显示。 */
    loading?: boolean;
    /** 没有结果时的说明；默认“没有匹配项”。 */
    emptyText?: string;
};

type PromptEditorAttachment =
    | {localId: string; state: "uploading"}
    | {localId: string; state: "failed"; error: string}
    | {localId: string; state: "ready"; target: string};

type PromptEditorPastePolicy = {
    /** 行数与字符数都不超过这两项时原样粘贴；默认 10、1000。 */
    inlineMaxLines: number;
    inlineMaxChars: number;
    /** 行数或字符数达到任一项时转为文件附件；默认 100、20000。 */
    attachMinLines: number;
    attachMinChars: number;
    /** 中等粘贴块放在粘贴处，还是放到正文开头、粘贴处只留位置标记；默认 "inline"。 */
    blockPlacement: "inline" | "start";
};

/** 被点击的标签。 */
type PromptEditorToken =
    | {kind: "reference"; label: string; target: string}
    | {kind: "skill"; name: string}
    | {kind: "selection"; path: string; startLine: number; endLine: number}
    | {kind: "command"; name: string}
    | {kind: "image"; number: number; target: string | null}
    | {kind: "file"; number: number; name: string; target: string | null}
    | {kind: "paste"; number: number};

interface PromptEditorProps {
    /** 必填，受控：只在版本号变化时读入。 */
    draft: PromptEditorDraft;
    /** 空正文时的提示，也是可访问名称的兜底；默认空字符串。 */
    placeholder?: string;
    /** 默认空字符串。 */
    ariaLabel?: string;
    /** 默认 false。 */
    readonly?: boolean;
    /** 回车发出 submit；默认 true。 */
    enterSubmits?: boolean;
    /** 触发字符，每项一个字符；默认没有。 */
    triggers?: readonly string[];
    /** 默认返回空菜单。必须是纯函数；数据变化时换一个新函数。 */
    resolveMenu?: (context: PromptEditorMenuContext) => PromptEditorMenu;
    /** 默认 "above"。 */
    menuPlacement?: "above" | "below";
    /** 正文开头显示为命令标签的命令名，不含 `/`；默认没有。 */
    commands?: readonly string[];
    /** 默认 false。 */
    acceptImages?: boolean;
    /** 允许文件附件，包括大段粘贴转成的文件；默认 false。 */
    acceptFiles?: boolean;
    /** 受控：本编辑器发出过、宿主仍在处理的附件；默认空数组。 */
    attachments?: readonly PromptEditorAttachment[];
    /** 就绪图片的缩略图地址；返回 null 时显示占位图标；默认总是 null。 */
    resolveThumbnail?: (target: string) => string | null;
    /** 默认见类型注释。 */
    pastePolicy?: Partial<PromptEditorPastePolicy>;
    /** 已发送内容，最新的在前；默认空数组。 */
    recall?: readonly string[];
    /** 正文区最小高度（px）；默认 36。 */
    minHeight?: number;
    /** 正文区最大高度（px）；默认 200。 */
    maxHeight?: number;
    /** 去掉外框，由外层画框；默认 false。 */
    bare?: boolean;
}

interface PromptEditorEmits {
    (e: "change", text: string): void;
    (e: "submit", payload: {mod: boolean}): void;
    (e: "escape"): void;
    (e: "shift-tab"): void;
    (e: "focus"): void;
    (e: "blur"): void;
    /** 菜单每次从关到开。 */
    (e: "menu-open", payload: {trigger: string}): void;
    (e: "token-activate", token: PromptEditorToken): void;
    /** localId 由编辑器生成，在同一页面内唯一；大段粘贴转成的文件是 text/plain。 */
    (e: "attachment-add", payload: {localId: string; kind: "image" | "file"; file: File}): void;
    (e: "attachment-retry", payload: {localId: string}): void;
    (e: "attachment-remove", payload: {localId: string}): void;
    (e: "attachment-reject", payload: {kind: "image" | "file"; count: number}): void;
}
```

对宿主的命令面（`expose`）：

```ts
interface PromptEditorExpose {
    /** 聚焦，光标落在开头或末尾；默认末尾。 */
    focus(at?: "start" | "end"): void;
    /** 在光标处插入文字，能识别的写法变成标签，发出 change；只读时不做任何事。例如附件面板“插入到输入框”。 */
    insertText(text: string): void;
}
```

没有 slot。未声明的 attribute 落到外框元素上。

## 状态

- **默认**：可编辑，随内容长高；没有附件时不显示附件条。
- **空**：正文首行显示 `placeholder`。
- **聚焦**：外框描边换成焦点色；`bare` 时不画，由外层表现。
- **只读**：见交互。底色换成只读底色，标签与卡片照常显示。
- **内容超出上限**：正文区内部滚动。
- **菜单打开**：候选项有高亮、禁用两种样式；另有加载中与没有结果两种状态。
- **附件上传中、失败、就绪**：见布局。
- 没有禁用、出错与空数据状态：加载原文、说明失败原因都由宿主在编辑器之外显示。

## 不支持

- 格式命令与 Markdown 结构，那是 `StructuredTextEditor` 的职责。
- 手打的写法即时变成标签。
- 粘贴块里直接编辑；要改先“转为文字”。
- 菜单跟随光标定位；菜单只贴着外框。
- 全屏编辑。展开模式由宿主调大 `minHeight`、`maxHeight` 并关掉 `enterSubmits` 实现。
- 上传、登记附件、校验文件类型与大小、持久化草稿与输入历史：都由宿主负责。

## 上游边界

编辑内核是 TipTap（ProseMirror）。本组件承诺上面写到的行为：文字写法的读入与写回、标签与粘贴块的整体性、按键约定、触发菜单、附件与事件、输入历史。撤销重做、输入法细节、选区与光标移动、拼写检查以及其他浏览器编辑行为来自上游，不作承诺，升级可能变化。

## 注意事项

- **草稿靠版本号替换**：宿主要清空或换掉正文时必须给新的版本号；只改 `text` 不改版本号不会生效。把 `change` 的结果写回 `draft.text` 不会打断输入。
- **菜单画在外框之外**：外框的祖先在菜单所在方向上不能裁剪（`overflow: hidden`）。放在滚动容器里时用 `menuPlacement: "below"`，菜单会撑出滚动内容而不是被裁掉。
- **`attachments` 要覆盖发出过的每个 `localId`**，直到它就绪或收到 `attachment-remove`；缺了的项按“上传中”显示。
- **未就绪的附件不在文字里**：宿主不能拿 `change` 的文字判断附件是否都已就绪，要看 `attachments`。
- **编号只在一次编辑里稳定**：重新读入文字时，没有编号的旧图片按顺序补号；删掉的号留下的空缺在下次读入时不会被填上，也不会被重排。
