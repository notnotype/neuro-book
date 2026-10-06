/**
 * 编辑器命令需要的编辑器类型：文档身份、行号导航与句柄。
 *
 * 属于编辑器域；新应用的编辑器插件（第 5 步）就绪前只有 Lab 命令场景的样板编辑器用到，届时随四条编辑器命令
 * 一起迁到编辑器插件。
 */

/** 一份文档在某个编辑器实例里的身份：四个字段都相同才是同一份文档的同一代。 */
export type EditorDocumentTarget = Readonly<{
    workspaceKey: string;
    generation: number;
    documentId: string;
    path: string;
}>;

export interface EditorLineNavigation {
    /** 返回 null 表示编辑器还没就绪。 */
    getLineCount(): number | null;
    revealLine(line: number): {ok: true; value: {line: number}} | {ok: false; reason: string};
}

/** 命令作用的编辑器句柄。方法缺失表示这个编辑器不支持该动作，命令据此给出 `unavailable`，不当作成功。 */
export interface CommandEditorHandle {
    focus?(): void;
    undo?(): void;
    redo?(): void;
    /** 把还没交给宿主的输入立即交出；没有缓冲的编辑器是空操作。 */
    flushPendingChange(): void;
    navigation?: EditorLineNavigation;
}

/** 当前活动编辑器：持有编辑器的一方写入，命令执行时现读，不在登记时捕获。 */
export type CommandEditorBinding = Readonly<{
    target: EditorDocumentTarget;
    handle: CommandEditorHandle;
    readonly: boolean;
}>;

export function matchesEditorDocument(left: EditorDocumentTarget | null, right: EditorDocumentTarget | null): boolean {
    return left !== null && right !== null && left.workspaceKey === right.workspaceKey && left.generation === right.generation
        && left.documentId === right.documentId && left.path === right.path;
}
