import type {ReferenceLink} from "nbook/shared/reference-link";

export interface WorkspaceReferenceMenuValue {
    label: string;
    target: string;
    entryType?: string | null;
    icon?: string | null;
}

export type MarkdownCommandKind =
    | "paragraph"
    | "heading-1"
    | "heading-2"
    | "heading-3"
    | "bullet-list"
    | "ordered-list"
    | "blockquote"
    | "code-block"
    | "horizontal-rule"
    | "reference"
    | "image"
    | "link"
    | "comment";

/**
 * 通用 trigger 菜单项。
 */
export interface AgentTriggerMenuItem {
    id: string;
    label: string;
    description: string;
    iconClass: string;
    hint?: string;
    /**
     * true 表示菜单项仅占位展示，不能被选择或执行。
     */
    disabled?: boolean;
    /**
     * 选中后插入的 skill 节点。
     */
    skill?: {
        name: string;
    };
    /**
     * 选中后插入的普通文本。
     */
    insertText?: string;
    /**
     * 选中后插入的引用节点。
     */
    reference?: ReferenceLink;
    /**
     * 选中后插入的工作区引用节点。
     */
    workspaceReference?: WorkspaceReferenceMenuValue;
    /**
     * 选中后执行的 Markdown 编辑器命令。
     */
    markdownCommand?: MarkdownCommandKind;
    /**
     * 是否在插入文本后补一个空格。
     */
    trailingSpace?: boolean;
    /** 选中后先删除 trigger，再在原位置执行异步动作（例如图片快照）。 */
    action?: (context: {position: number}) => void | Promise<void>;
}

/**
 * 通用 trigger 菜单分组。
 */
export interface AgentTriggerMenuSection {
    id: string;
    title?: string;
    items: AgentTriggerMenuItem[];
}

/**
 * 输入器当前激活的 trigger。
 */
export interface AgentTriggerMenuContext {
    kind: "reference-root" | "chapter" | "volume" | "lorebook" | "thread" | "scene" | "skill" | "command";
    query: string;
    /** true 表示触发符前已经有普通内容，命令菜单可据此隐藏会改写 session 的动作。 */
    hasPlainTextBeforeTrigger?: boolean;
}

/**
 * 输入器消费的菜单状态。
 */
export interface AgentTriggerMenuState {
    title: string;
    prefix: string;
    sections: AgentTriggerMenuSection[];
}
