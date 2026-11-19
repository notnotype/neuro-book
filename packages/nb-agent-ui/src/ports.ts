/**
 * 宿主注入的渲染组件要满足的形状：提示词编辑器、已发送文字的静态显示、Markdown 显示。本包不引用宿主源码，这里按结构
 * 写出本包实际用到的属性、事件与外露方法，宿主的组件与它结构兼容即可。真实的组件在 nb-markdown，那边有
 * 一份类型断言对照它的 `.vue` 源组件（`packages/nb-markdown/src/prompt/agent-ports.typecheck.ts`）。
 *
 * 属性写成组件 `$props` 的形状，事件写成 `onX` 处理函数，这样“端口属性能赋给组件的 `$props`”就同时核对了属性、事件名
 * 与参数。文字写法（标签、附件、粘贴块怎样写进文字）见 docs/specs/ui/prompt-editor.md。
 */

/** 显示语言的标签；是字符串，加语言不改类型（docs/specs/ui/i18n.md）。 */
export type PromptLocale = string;

/** 宿主给的草稿：版本号变化时正文替换为 text；同一版本内 text 的变化是编辑器自己上报的回声。 */
export type PromptDraft = {
    text: string;
    version: number;
};

export type PromptMenuContext = {
    trigger: string;
    /** 触发字符后到光标为止的文字，不含空白。 */
    query: string;
    /** 触发字符位于正文最开头。 */
    atStart: boolean;
};

export type PromptMenuItem = {
    /** 同一次结果内唯一。 */
    id: string;
    label: string;
    description?: string;
    iconClass?: string;
    /** 分组标题；相邻且同组的项只显示一次标题。 */
    group?: string;
    /** 显示但不能选。 */
    disabled?: boolean;
    /** 确认后替换触发字符与查询文字的内容，按输入框的文字写法识别成标签。 */
    insertText: string;
    /** 为真时插入后菜单按新的查询继续，用于逐级进入。 */
    continues?: boolean;
    /** 行尾的状态图标（例如 Skill 未初始化）；同一个菜单有一项带它时每行都留出这一列。 */
    status?: {label: string; iconClass?: string; busy?: boolean; tone?: "neutral" | "warning" | "danger"};
    /** 一张小图（例如表情），画在图标的位置。 */
    imageUrl?: string;
    /** 为假时确认后不补空格（表情：中文里紧挨着写）；缺省真。 */
    appendSpace?: boolean;
};

export type PromptMenu = {
    title?: string;
    items: PromptMenuItem[];
    /** 数据还没到；显示“正在加载”。数据到达后宿主换一个新的菜单函数。 */
    loading?: boolean;
    /** 没有结果时的说明。 */
    emptyText?: string;
    /** 为真时没有项（也不在加载）就不显示菜单，回车照常发送。 */
    hideWhenEmpty?: boolean;
};

/**
 * 输入框里一个附件的上传状态，按编辑器给的 `localId` 对应。就绪后带附件目标，编辑器据此把标签写回文字；
 * 编辑器发出过的每个 `localId` 都要在这里，直到它就绪或被移除。
 */
export type PromptAttachment =
    | {localId: string; state: "uploading"}
    | {localId: string; state: "failed"; error: string}
    | {localId: string; state: "ready"; target: string};

export type PromptAttachmentKind = "image" | "file";

export type PromptPastePolicy = {
    inlineMaxLines: number;
    inlineMaxChars: number;
    attachMinLines: number;
    attachMinChars: number;
    blockPlacement: "inline" | "start";
};

/** 被点击的标签。 */
export type PromptToken =
    | {kind: "reference"; label: string; target: string}
    | {kind: "skill"; name: string}
    | {kind: "selection"; path: string; startLine: number | null; endLine: number | null}
    | {kind: "command"; name: string}
    | {kind: "image"; number: number; target: string | null}
    | {kind: "file"; number: number; name: string; target: string | null}
    | {kind: "paste"; number: number};

export type PromptEditorPortProps = {
    draft: PromptDraft;
    locale: PromptLocale;
    placeholder?: string;
    ariaLabel?: string;
    readonly?: boolean;
    enterSubmits?: boolean;
    triggers?: readonly string[];
    resolveMenu?: (context: PromptMenuContext) => PromptMenu;
    commands?: readonly string[];
    acceptImages?: boolean;
    acceptFiles?: boolean;
    attachments?: readonly PromptAttachment[];
    resolveThumbnail?: (target: string) => string | null;
    pastePolicy?: Partial<PromptPastePolicy>;
    recall?: readonly string[];
    fill?: boolean;
    bare?: boolean;
    onChange?: (text: string) => void;
    onSubmit?: (payload: {mod: boolean}) => void;
    onEscape?: () => void;
    onShiftTab?: () => void;
    onMenuOpen?: (payload: {trigger: string}) => void;
    onMenuSelect?: (payload: {trigger: string; id: string}) => void;
    onTokenActivate?: (token: PromptToken) => void;
    onAttachmentAdd?: (payload: {localId: string; kind: PromptAttachmentKind; file: File}) => void;
    onAttachmentRetry?: (payload: {localId: string}) => void;
    onAttachmentRemove?: (payload: {localId: string}) => void;
    onAttachmentReject?: (payload: {kind: PromptAttachmentKind; count: number}) => void;
};

export interface PromptEditorPortExpose {
    /** 聚焦：光标移到开头、末尾，或 `"keep"` 留在原处（弹层关上时把焦点还回来）。 */
    focus(at?: "start" | "end" | "keep"): void;
    insertText(text: string): void;
    insertFiles(files: readonly File[]): void;
    /** 聚焦到末尾并插入触发字符，打开它的菜单；前一个字不是空白或标点时先补空格（nb-markdown 的 PromptEditor）。 */
    openTrigger(char: string): void;
}

export type PromptTextViewPortProps = {
    text: string;
    locale: PromptLocale;
    commands?: readonly string[];
    resolveThumbnail?: (target: string) => string | null;
    onTokenActivate?: (token: PromptToken) => void;
    /** 点开表情的大图（docs/specs/agent/stickers.md 输出 46）。 */
    onStickerActivate?: (sticker: StickerPreviewRequest) => void;
};

/**
 * 被点开大图的表情：写法原文、图的地址、名字、包的显示名与宽高。形状与 nb-markdown 的 `StickerPreview` 相同，本包不依赖
 * nb-markdown，所以在这里按结构再写一份；两边对不上时 nb-markdown 的 `agent-ports.typecheck.ts` 报错。
 */
export type StickerPreviewRequest = {
    readonly raw: string;
    readonly url: string;
    readonly name: string;
    readonly packTitle?: string;
    readonly width: number;
    readonly height: number;
};

/** Markdown 里被点击的东西。 */
export type MarkdownActivation =
    | {kind: "reference"; target: string}
    | {kind: "link"; href: string}
    | {kind: "image"; address: string}
    | {kind: "sticker"; sticker: StickerPreviewRequest};

/** 图片地址到可显示地址的换算；返回的 `release` 在不再显示时调用。 */
export type MarkdownAssetResolver = (src: string, signal: AbortSignal) => Promise<{url: string; release(): void} | null>;

/**
 * 根元素要接受透传的 `style`：对话视图在上面写 `color` 与 `--markdown-font-size`，用来把思考、提醒显示成淡色小字。
 * 本包的缺省实现靠继承拿到这两样。
 */
export type MarkdownDisplayPortProps = {
    text: string;
    locale: PromptLocale;
    streaming?: boolean;
    resolveAsset?: MarkdownAssetResolver;
    onActivate?: (activation: MarkdownActivation) => void;
};

/**
 * Markdown 文字折叠时露出的那一行纯文字（思考、提醒）。宿主按自己的方言取，例如用自己的解析器取第一段的纯文字；
 * 不注入时用核心的 `markdownPreviewLine`。要求是纯函数、只返回一行。
 */
export type MarkdownPreviewPort = (text: string) => string;

/**
 * 一条用户消息“只有表情”时不画气泡（docs/specs/ui/agent-conversation-view.md 的“消息”）：宿主按自己的文字写法判断，收这条消息的
 * 各个文字块。附件、正文被省略、就地编辑时视图自己按画气泡处理，不问它。不注入时都画气泡。要求是纯函数；可以读响应式状态（宿主的
 * 表情目录晚到时重算）。
 */
export type PromptBarenessPort = (texts: readonly string[]) => boolean;
