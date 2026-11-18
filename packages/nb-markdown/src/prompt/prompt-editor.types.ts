/** 宿主给的草稿：版本号变化时正文替换为 text；同一版本内 text 的变化是编辑器自己上报的回声。 */
export type PromptEditorDraft = {
    text: string;
    version: number;
};

export type PromptEditorMenuContext = {
    trigger: string;
    /** 触发字符后到光标为止的文字，不含空白。 */
    query: string;
    /** 触发字符位于正文最开头，例如只在开头有效的命令。 */
    atStart: boolean;
};

export type PromptEditorMenuItem = {
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
    /** 行尾的状态图标（例如 Skill 未初始化）；同一个菜单有一项带它时每行都留出这一列。 */
    status?: {label: string; iconClass?: string; busy?: boolean; tone?: "neutral" | "warning" | "danger"};
    /** 一张小图（例如表情），画在图标的位置。 */
    imageUrl?: string;
    /** 为假时确认后不补空格（表情：中文里紧挨着写）；缺省真。 */
    appendSpace?: boolean;
};

export type PromptEditorMenu = {
    title?: string;
    items: PromptEditorMenuItem[];
    /** 数据还没到；显示“正在加载”，已有的项照常显示。 */
    loading?: boolean;
    /** 没有结果时的说明；默认“没有匹配项”。 */
    emptyText?: string;
    /** 为真时没有项（也不在加载）就不显示菜单，回车与 Tab 照常交给正文（表情补全）。 */
    hideWhenEmpty?: boolean;
};

export type PromptEditorAttachment =
    | {localId: string; state: "uploading"}
    | {localId: string; state: "failed"; error: string}
    | {localId: string; state: "ready"; target: string};

export type PromptEditorPastePolicy = {
    /** 行数与字符数都不超过这两项时原样粘贴。 */
    inlineMaxLines: number;
    inlineMaxChars: number;
    /** 行数或字符数达到任一项时转为文件附件。 */
    attachMinLines: number;
    attachMinChars: number;
    /** 中等粘贴块放在粘贴处，还是放到正文开头、粘贴处只留位置标记。 */
    blockPlacement: "inline" | "start";
};

/** 被点击的标签。 */
export type PromptEditorToken =
    | {kind: "reference"; label: string; target: string}
    | {kind: "skill"; name: string}
    | {kind: "selection"; path: string; startLine: number | null; endLine: number | null}
    | {kind: "command"; name: string}
    | {kind: "image"; number: number; target: string | null}
    | {kind: "file"; number: number; name: string; target: string | null}
    | {kind: "paste"; number: number};

export type PromptEditorAttachmentKind = "image" | "file";

export interface PromptEditorExpose {
    /** 聚焦，光标落在开头或末尾；默认末尾。 */
    focus(at?: "start" | "end"): void;
    /** 在光标处插入文字，能识别的写法变成标签，发出 change；只读时不做任何事。 */
    insertText(text: string): void;
    /** 在光标处加入文件，与粘贴文件相同；只读时不做任何事。 */
    insertFiles(files: readonly File[]): void;
    /**
     * 聚焦、光标移到末尾，插入触发字符打开它的菜单（例如输入框的 `+` 按钮插 `@`）；前一个字不是空白或标点时先补一个
     * 空格，否则触发不成立。只读时不做任何事。
     */
    openTrigger(char: string): void;
}

/** 附件条里的一张卡片。 */
export type PromptAttachmentCard = {
    /** 列表内唯一。 */
    id: string;
    /** 与正文标签联动的键，同号的标签与卡片共用。 */
    hoverKey: string;
    kind: PromptEditorAttachmentKind;
    number: number;
    name: string;
    state: "uploading" | "failed" | "ready";
    /** state 为 failed 时的原因。 */
    error?: string;
    /** 图片缩略图地址；缺省或 null 时显示占位图标。 */
    thumbnail?: string | null;
    /** 文件大小（字节）；未知时不显示。 */
    size?: number | null;
    /** 大段粘贴转成的文件：前两行与总行数。 */
    excerpt?: {preview: string; lines: number} | null;
};
