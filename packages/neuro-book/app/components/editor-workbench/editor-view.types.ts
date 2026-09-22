import type {VNode} from "vue";
import type {MenubarMenuData} from "@notnotype/nb-ui/components";
import type {EditorToolbarAction} from "./EditorToolbar.vue";

/** 运行期文档身份；同路径重开或切换工作面会失效，不进入恢复快照。 */
export type EditorDocumentTarget = Readonly<{
    workspaceKey: string;
    generation: number;
    documentId: string;
    path: string;
}>;
export type EditorDocumentSnapshot = Readonly<{
    target: EditorDocumentTarget;
    content: string;
    /** 权威缓冲的单调修订；输入回执按它判定基线，视图只在修订推进时回灌。 */
    contentRevision: number;
    languageId: string;
    readonly: boolean;
}>;
/** 输入提交请求：token 标识产生输入的实例，baseRevision 是它确认过的那一版正文。 */
export type EditorChangeRequest = Readonly<{
    target: EditorDocumentTarget;
    token: string;
    baseRevision: number;
    content: string;
}>;
/**
 * 输入回执。只有 accepted 才推进实例的确认快照；conflict 表示基线已过期、
 * 候选内容必须留在产生它的实例里等用户裁决；stale 只用于身份已撤销的迟到回调。
 */
export type EditorChangeResult =
    | {status: "accepted"; snapshot: EditorDocumentSnapshot}
    | {status: "conflict"; snapshot: EditorDocumentSnapshot}
    | {status: "stale"};
/** 结算结果：settled 表示待结算输入已进入权威缓冲，conflict 表示仍有未被接受的候选。 */
export type EditorFlushResult = "settled" | "conflict";
export type EditorResource = Readonly<{path: string; languageId: string; editable: boolean}>;
export type EditorAction = Readonly<{
    id: string;
    label: string;
    iconClass?: string;
    disabled: boolean;
    checked?: boolean;
}>;
/**
 * 行号导航能力：只有真实支持行定位的句柄才声明它。Markdown / mock 句柄可以没有，
 * 命令层的 `editor-line-navigation` 上下文键就是按它求值的。
 */
export type EditorLineNavigation = Readonly<{
    /** 未就绪或已释放返回 null。 */
    getLineCount: () => number | null;
    /** 行号从 1 起；越界拒绝而不 clamp，失败不移动光标。 */
    revealLine: (line: number) => {ok: true; value: {line: number}} | {ok: false; reason: string};
}>;
export type EditorViewHandle = {
    flushPendingChange(): EditorFlushResult;
    focus(): void;
    undo?: () => void;
    redo?: () => void;
    runAction?: (id: string) => void;
    /**
     * 修订冲突的裁决入口，只有真实持有候选的实例实现。
     * adopt-current 丢弃候选并接受权威正文；keep-view 用最新修订重提候选，再冲突继续保留。
     */
    resolveConflict?: (choice: EditorConflictChoice) => EditorFlushResult;
    navigation?: EditorLineNavigation;
};
export type EditorConflictChoice = "adopt-current" | "keep-view";
/** 宿主收到的一次性裁决请求：token 定位实例，choice 是用户选择。 */
export type EditorConflictResolution = Readonly<{token: string; choice: EditorConflictChoice}>;
export type EditorViewProps = Readonly<{document: EditorDocumentSnapshot; visible: boolean; viewInstanceId: string}>;
export type EditorViewEvents = {
    /** 有返回值的提交：视图据回执决定是否推进自己的确认快照，不靠乐观改写。 */
    change(target: EditorDocumentTarget, baseRevision: number, content: string): EditorChangeResult;
    save(target: EditorDocumentTarget): void;
    focus(target: EditorDocumentTarget, focused: boolean): void;
    actions(target: EditorDocumentTarget, actions: readonly EditorAction[]): void;
};
export type EditorContribution = Readonly<{
    id: string;
    titleKey: string;
    iconClass: string;
    supports(resource: EditorResource): boolean;
    render(props: EditorViewProps, events: EditorViewEvents, bindHandle: (handle: EditorViewHandle | null) => void): VNode;
}>;

/** 源码内核的文本操作，不包含富文本格式或文件读写。 */
export type TextEditorHandle = {
    update(text: string): void;
    focus(): void;
    getValue(): string;
    /** 内核只负责把待上报输入交出去；结果由 wrapper 按 commitChange 的回执汇总（见 EditorViewHandle）。 */
    flushPendingChange(): void;
    undo(): void;
    redo(): void;
    insertText(text: string): void;
    replaceSelection(text: string): void;
    appendText(text: string): void;
    scrollToTop(): void;
    navigation?: EditorLineNavigation;
};

/** 命令宿主需要的活动编辑器绑定：目标只用来做身份比对，句柄用来执行动作。 */
export type CommandEditorBinding = Readonly<{
    target: EditorDocumentTarget;
    handle: EditorViewHandle;
    readonly: boolean;
}>;

export type EditorTabPresentation = Readonly<{
    path: string;
    title: string;
    pinned: boolean;
    preview: boolean;
    dirty: boolean;
    iconClass: string;
    statusText?: string;
    description?: string;
}>;
export type EditorTabDropPosition = "before" | "after";
export type EditorSplitDirection = "left" | "right" | "top" | "bottom";

/**
 * 一个编辑组的渲染模型：内容（标签与活动标签）加上该组自己的外壳状态。
 * 组身份就是布局树上的叶 id——外壳不再有 primary/secondary 这类隐式双组词汇。
 */
export interface EditorGroupState {
    id: string;
    tabs: EditorTabPresentation[];
    activePath: string;
    menus?: MenubarMenuData[];
    toolbarActions?: EditorToolbarAction[];
    busy?: boolean;
    diagnosis?: string | null;
    breadcrumbsSymbols?: readonly {id: string; label: string; iconClass?: string}[];
}

export function matchesEditorDocument(a: EditorDocumentTarget | null, b: EditorDocumentTarget | null): boolean {
    return a !== null && b !== null && a.workspaceKey === b.workspaceKey
        && a.generation === b.generation && a.documentId === b.documentId && a.path === b.path;
}
