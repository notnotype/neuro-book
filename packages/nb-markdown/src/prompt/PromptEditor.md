---
标签: [state:local, state:inject]
别名: ["写给 Agent 的编辑组件", "Composer 编辑组件", "Prompt Editor"]
---

# PromptEditor

写给 Agent 的一段话的编辑组件：Agent 输入框与历史消息的就地编辑共用它。正文不做格式，引用、技能、命令显示为小块；图片与文件进上方的附件条，正文在插入处留 `#N` 小块；大段粘贴按大小折叠成粘贴块或转为文件附件；另有触发菜单与输入历史。**文字是唯一真相**：对外只交出一段文字，读进来的文字原样写回。

行为合同（文字写法、各按键、菜单、粘贴分档、附件、输入历史、只读、可访问性）是 [ui.prompt-editor](../../../../docs/specs/ui/prompt-editor.md)，这里只写组件的属性、样子与宿主要注意的事。由旧应用调好的版本移植（分支 `archive/legacy-ui-tuning`，`865c9f593`），外观不变；输入框的外壳（模型切换、发送按钮、排队的消息）不在这里。

从 `@notnotype/nb-markdown/prompt` 导出；neuro-book 经 `nbook.markdown` 的服务 `markdownKey` 交出包了宿主的同一个组件。正文里引用小块的目标分类与文件图标来自祖先提供的宿主（`provideMarkdownHost`，见 `../host`），没有提供时只认外部链接。`@` 菜单的宿主用 `promptReferenceText(名称, 地址, 目标分类)` 拼 `insertText`：文件名里的 `%`、`#`、`?` 按宿主的 `encodeFile` 编码；neuro-book 的作品文件写以 `/` 开头的作品根地址。

## 布局

外框里自上而下：附件条、正文区；候选菜单贴着外框画在外面。

- **外框**：圆角、描边、输入底色；获得焦点时描边换成焦点色。`bare` 时去掉描边、底色与圆角，由外层画框。
- **附件条**：正文里有图片或文件附件时出现，没有时不占高度。一行卡片，放不下时横向滚动。图片卡片是 48px 缩略图，文件卡片是图标、文件名与大小，大段粘贴转成的文件卡片显示前两行文字与行数。每张卡片角上标 `#N`，并带“移除”按钮。上传中的卡片显示转圈；失败的卡片用危险色描边，带“重试”与“移除”。
- **正文区**：随内容长高，夹在 `minHeight` 与 `maxHeight` 之间；超过上限后正文区内部滚动，外框与附件条不动。输入时光标始终保持可见。`fill` 为真时外框取父元素的高度，正文区占满附件条以外的部分，内容更长时在内部滚动，`maxHeight` 不起作用；父元素没有确定的高度时仍随内容长高。
- **粘贴块**：在正文里独占一段，与正文同宽。头部一行：图标、`#N`、“粘贴的文本 · 42 行”，以及“展开”“转为文字”“删除”三个按钮；下面用等宽字显示内容，收起时只显示前 3 行，展开后显示全文并可以就地编辑，超过正文区高度时随正文区一起滚动。
- **小块**：[`InlineChip`](../chip/InlineChip.md)，与正文同一行高，名称过长时截断，悬停提示给出全称。图片与文件小块只显示图标加 `#N`。
- **候选菜单**：nb-ui 的 `SuggestionMenu`，锚在外框上、与外框同宽，默认在外框上方（`menuPlacement: "below"` 时在下方），固定方向、不跟随光标；可用高度不够时收矮。自上而下：标题行（可选）、候选项（按组分段，组标题不可选；项的说明显示在右侧）。项超过 8 个时截在第 9 项中间、内部滚动。加载中已有项照常显示，底部一行转圈与“正在加载”；没有结果时显示宿主给的空结果文字或“没有匹配项”。没有按键提示。
- **输入历史搜索**：与候选菜单同一位置、同一外观，顶部多一个搜索框与“输入历史”标题。搜索框的聚焦、方向键、回车、Escape 与 `combobox`、`aria-controls`、`aria-activedescendant` 由本组件持有；焦点离开搜索框、又不在菜单里时关闭（菜单传送到了 `body`，判断时用 `SuggestionMenu.contains`）。
- **390×844**：结构不变；附件条横向滚动，菜单仍与外框同宽，正文更早触到高度上限。

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
    /** 触发字符位于正文最开头，例如只在开头有效的命令。 */
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

/** 被点击的小块。 */
type PromptEditorToken =
    | {kind: "reference"; label: string; target: string}
    | {kind: "skill"; name: string}
    | {kind: "selection"; path: string; startLine: number | null; endLine: number | null}
    | {kind: "command"; name: string}
    | {kind: "image"; number: number; target: string | null}
    | {kind: "file"; number: number; name: string; target: string | null}
    | {kind: "paste"; number: number};

interface PromptEditorProps {
    /** 必填，受控：只在版本号变化时读入。 */
    draft: PromptEditorDraft;
    /** 占用 Shift+Tab、发出 `shift-tab`。不占用时它还是反向移动焦点。 */
    captureShiftTab?: boolean;
    /** 界面语言：只在上面没有注入翻译端口时起作用，决定按钮、提示与说明的文字；换了随即换文字，正文不变。缺省 zh-CN。 */
    locale?: MarkdownLocale;
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
    /** 正文开头显示为命令小块的命令名，不含 `/`；默认没有。 */
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
    /** 正文区最大高度（px）；默认 200。`fill` 为真时不起作用。 */
    maxHeight?: number;
    /** 撑满父元素给的高度，例如展开后的输入框区域、Lab 里拖成固定高度的画布；默认 false。 */
    fill?: boolean;
    /** 去掉外框，由外层画框；默认 false。 */
    bare?: boolean;
}

interface PromptEditorEmits {
    (e: "change", text: string): void;
    (e: "submit", payload: {mod: boolean}): void;
    (e: "escape"): void;
    /** `captureShiftTab` 为真时才发出；补全菜单开着时不发，也不移动焦点。 */
    (e: "shift-tab"): void;
    /** 焦点进出正文区；在正文与粘贴块的编辑框之间移动不算。 */
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
    /** 在光标处插入文字，能识别的写法变成小块，发出 change；只读时不做任何事。 */
    insertText(text: string): void;
    /** 在光标处加入文件，与粘贴文件相同：按 acceptImages、acceptFiles 接受或发出 attachment-reject；只读时不做任何事。例如输入框的“添加附件”按钮。 */
    insertFiles(files: readonly File[]): void;
    /**
     * 聚焦、光标移到末尾，插入触发字符并打开它的菜单，例如输入框的 `+` 按钮插 `@`。触发字符只在开头、空白、`(` 或中文标点之后
     * 才算，所以前一个字不是这些时先补一个空格（`介绍一下` 变成 `介绍一下 @`）。只读时不做任何事。
     */
    openTrigger(char: string): void;
}
```

没有 slot。未声明的 attribute 落到外框元素上。

## 状态

- **默认**：可编辑，随内容长高；没有附件时不显示附件条。
- **空**：正文首行显示 `placeholder`。
- **聚焦**：外框描边换成焦点色；`bare` 时不画，由外层表现。
- **只读**：见交互。底色换成只读底色，小块与卡片照常显示。
- **内容超出上限**：正文区内部滚动。
- **菜单打开**：候选项有高亮、禁用两种样式；另有加载中与没有结果两种状态。
- **附件上传中、失败、就绪**：见布局。
- 没有禁用、出错与空数据状态：加载原文、说明失败原因都由宿主在编辑器之外显示。

## 注意事项

- **草稿靠版本号替换**：宿主要清空或换掉正文时必须给新的版本号；只改 `text` 不改版本号不会生效。把 `change` 的结果写回 `draft.text` 不会打断输入。
- **菜单画在外框之外**：外框的祖先在菜单所在方向上不能裁剪（`overflow: hidden`）。放在滚动容器里时用 `menuPlacement: "below"`，菜单会撑出滚动内容而不是被裁掉。
- **`attachments` 要覆盖发出过的每个 `localId`**，直到它就绪或收到 `attachment-remove`；缺了的项按“上传中”显示。
- **未就绪的附件不在文字里**：宿主不能拿 `change` 的文字判断附件是否都已就绪，要看 `attachments`。
- **界面文字**：界面文字读宿主注入的翻译端口（nb-ui 的 `TEXT_PORT_KEY`，宿主要登记本包的目录 `@notnotype/nb-markdown/locales`），语言以端口为准；上面没有注入时按 `locale`（缺省 zh-CN）建缺省端口，提供给子组件与嵌套的 nb-ui 控件（[README](../../README.md#界面文字)）。节点视图（小块、粘贴块）经编辑内核拿到同一个端口。
- **编号只在一次编辑里稳定**：重新读入文字时，没有编号的旧图片按顺序补号；删掉的号留下的空缺在下次读入时不会被填上，也不会被重排。

## 不支持

见 [ui.prompt-editor](../../../../docs/specs/ui/prompt-editor.md) 的“目标与非目标”。全屏编辑由宿主调大 `minHeight`、`maxHeight`（或给区域高度并打开 `fill`）并关掉 `enterSubmits` 实现。

## 组成

- [`PromptAttachmentStrip`](PromptAttachmentStrip.md)：附件条。
- nb-ui 的 `SuggestionMenu`：候选菜单与输入历史搜索；正文区的 `aria-activedescendant` 用 nb-ui 导出的 `suggestionOptionId`。
- [`PromptTokenView`](PromptTokenView.md)、[`PromptPasteBlockView`](PromptPasteBlockView.md)：小块与粘贴块的节点视图；粘贴块的外框是 [`PromptPasteFrame`](PromptPasteFrame.md)，与 [`PromptTextView`](PromptTextView.md) 共用。
- 文字写法在 `prompt-text.ts`，编辑内核的扩展在 `prompt-editor-extensions.ts`，附件簿记在 `prompt-attachments.ts`，界面文字在本包的目录（`../locales`）。
