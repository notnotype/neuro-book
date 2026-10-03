import type {ComputedRef, InjectionKey, Ref} from "vue";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import type {WorkspaceFilesViewMode} from "nbook/shared/storage/workbench-files";

export type WorkspaceTreeNode = WorkspaceFileNode & {
    children: WorkspaceTreeNode[];
};

export type WorkspaceFileDropPosition = "before" | "inside" | "after" | "root";

export type WorkspaceFileDropVisualKind =
    | "before-line"
    | "after-line"
    | "inside-start"
    | "inside-node"
    | "root-line";

export type WorkspaceFileClipboardIntent =
    | {kind: "copy" | "cut"; sources: string[]}
    | {kind: "paste"; destination: string}
    | {kind: "clear"};

export interface WorkspaceFileSelectionEvent {
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
}

export interface WorkspaceFileDropState {
    targetPath: string | null;
    position: WorkspaceFileDropPosition | null;
    visualKind: WorkspaceFileDropVisualKind | null;
}

export interface WorkspaceFileMovePayload {
    sourcePath: string;
    sourcePaths?: string[];
    targetPath: string | null;
    position: WorkspaceFileDropPosition;
    visualKind: WorkspaceFileDropVisualKind;
}

export interface WorkspaceFileTreeIndexMaps {
    nodeByPath: Map<string, WorkspaceTreeNode>;
    parentByPath: Map<string, string | null>;
}

export interface WorkspaceFileTreeContextValue {
    selectedPaths: ComputedRef<string[]>;
    selectedPath: ComputedRef<string>;
    mode: ComputedRef<WorkspaceFilesViewMode>;
    expandedPathSet: ComputedRef<Set<string>>;
    forcedExpandedPathSet: ComputedRef<Set<string>>;
    dropState: Ref<WorkspaceFileDropState>;
    draggedPath: Ref<string | null>;
    selectNode: (node: WorkspaceFileNode, event?: WorkspaceFileSelectionEvent, preview?: boolean) => void;
    previewNode: (node: WorkspaceFileNode) => void;
    toggleSelection: (node: WorkspaceFileNode) => void;
    openNode: (node: WorkspaceFileNode) => void;
    toggleExpanded: (node: WorkspaceFileNode) => void;
    startDrag: (node: WorkspaceFileNode, event: DragEvent) => void;
    updateDropState: (node: WorkspaceFileNode, event: DragEvent) => void;
    updateTailDropState: (node: WorkspaceFileNode, event: DragEvent) => void;
    commitDrop: (event: DragEvent) => void;
    clearDragState: () => void;
    emitNodeContextMenu: (node: WorkspaceFileNode, event: MouseEvent) => void;
    emitClipboardIntent: (intent: WorkspaceFileClipboardIntent) => void;
}

interface WorkspaceNodeDropContext {
    isExpandedBranch: boolean;
    isLastRoot: boolean;
    prependFolderPath: string | null;
    outsideAfterPath: string | null;
    tailAfterPath: string | null;
}

export const workspaceFileTreeContextKey: InjectionKey<WorkspaceFileTreeContextValue> = Symbol("workspace-file-tree-context");
export const LOREBOOK_ENTRY_TYPES = new Set(["location", "character", "item", "rule", "note"]);
export const CONTENT_NODE_ROOTS = new Set(["manuscript", "lorebook"]);

/**
 * 同一真实树的呈现投影；目录仍以自身路径作为资源身份，正文由真实 index.md 承载。
 * 内容模式的根 index.md 由独立根入口使用原始 nodes 提供打开目标。
 */
export function projectWorkspaceFileNodes(nodes: readonly WorkspaceFileNode[], mode: WorkspaceFilesViewMode): WorkspaceFileNode[] {
    const startedAt = performance.now();
    try {
        if (mode === "ordinary") {
            return nodes.map(node => ({...node, title: basename(node.path)}));
        }

        const indexByPath = new Map<string, WorkspaceFileNode>();
        for (const node of nodes) {
            if (!node.isDirectory && isWorkspaceContentIndexPath(node.path)) {
                indexByPath.set(node.path, node);
            }
        }

        const projected: WorkspaceFileNode[] = [];
        for (const node of nodes) {
            if (!node.isDirectory && isWorkspaceContentIndexPath(node.path)) {
                continue;
            }

            const name = basename(node.path);
            const index = node.isDirectory ? indexByPath.get(`${normalizeWorkspacePath(node.path)}/index.md`) : undefined;
            const source = index ?? node;
            const title = (index || (!node.isDirectory && /\.md$/i.test(name))) && !source.frontmatterError
                ? source.title.trim()
                : "";
            projected.push({
                ...node,
                ...(node.isDirectory ? {contentNode: Boolean(index), hasIndex: Boolean(index)} : {}),
                title: title || name,
            });
        }
        return projected;
    } finally {
        performance.measure("files.tree.project", {start: startedAt, end: performance.now()});
    }
}

/**
 * 将投影后的扁平文件列表转成可递归渲染的树。
 */
export function buildWorkspaceFileTree(nodes: WorkspaceFileNode[]): WorkspaceTreeNode[] {
    const startedAt = performance.now();
    try {
        const nodeMap = new Map<string, WorkspaceTreeNode>();
        const roots: WorkspaceTreeNode[] = [];

        for (const node of nodes) {
            nodeMap.set(normalizeWorkspacePath(node.path), {...node, children: []});
        }

        for (const node of nodeMap.values()) {
            const parentPath = resolveParentPath(node.path);
            const parent = parentPath ? nodeMap.get(parentPath) : null;
            if (parent) {
                parent.children.push(node);
                continue;
            }
            roots.push(node);
        }

        return sortWorkspaceNodes(roots);
    } finally {
        performance.measure("files.tree.build", {start: startedAt, end: performance.now()});
    }
}

/**
 * 构建树索引，供拖拽合法性判断使用。
 */
export function buildWorkspaceFileTreeIndexMaps(nodes: WorkspaceTreeNode[]): WorkspaceFileTreeIndexMaps {
    const nodeByPath = new Map<string, WorkspaceTreeNode>();
    const parentByPath = new Map<string, string | null>();

    const visit = (items: WorkspaceTreeNode[], parentPath: string | null): void => {
        for (const item of items) {
            nodeByPath.set(item.path, item);
            parentByPath.set(item.path, parentPath);
            visit(item.children, item.path);
        }
    };

    visit(nodes, null);
    return {nodeByPath, parentByPath};
}

/**
 * 判断当前文件节点是否应按 lorebook entry 展示。
 */
export function isWorkspaceLorebookEntry(node: WorkspaceFileNode | null): boolean {
    return Boolean(
        node?.contentNode
        && node.editable
        && isWorkspaceLorebookScopePath(node.path)
        && node.path.toLowerCase().endsWith(".md")
        && basename(node.path).toLowerCase() === "index.md"
        && node.entryType
        && LOREBOOK_ENTRY_TYPES.has(node.entryType),
    );
}

/**
 * 判断路径是否位于启用目录节点语义的内容根目录内。
 */
export function isWorkspaceContentScopePath(filePath: string): boolean {
    const segments = normalizeWorkspacePath(filePath).split("/").filter(Boolean);
    if (segments[0] === "." || segments[0] === "workspace") {
        segments.shift();
    }
    return Boolean(segments[0] && CONTENT_NODE_ROOTS.has(segments[0]));
}

/**
 * 判断节点是否是 index.md 文件。
 */
export function isWorkspaceContentIndexNode(node: WorkspaceFileNode): boolean {
    return Boolean(!node.isDirectory && isWorkspaceContentIndexPath(node.path));
}

function isWorkspaceContentIndexPath(filePath: string): boolean {
    return basename(filePath).toLowerCase() === "index.md";
}

/**
 * 判断目录节点是否由 index.md 承载内容。
 */
export function isWorkspaceContentDirectoryNode(node: WorkspaceFileNode): boolean {
    return Boolean(node.isDirectory && node.contentNode);
}

/**
 * 返回树行代表的真实编辑路径。
 */
export function resolveWorkspaceNodeRepresentedPath(node: WorkspaceFileNode): string {
    if (isWorkspaceContentDirectoryNode(node)) {
        return `${normalizeWorkspacePath(node.path)}/index.md`;
    }
    return node.path;
}

export function flattenVisibleWorkspaceNodes(nodes: WorkspaceTreeNode[], expandedPaths: ReadonlySet<string>): WorkspaceTreeNode[] {
    const visible: WorkspaceTreeNode[] = [];
    const visit = (items: WorkspaceTreeNode[]): void => {
        for (const item of items) {
            visible.push(item);
            if (item.isDirectory && item.children.length > 0 && expandedPaths.has(item.path)) visit(item.children);
        }
    };
    visit(nodes);
    return visible;
}

/**
 * 判断路径是否位于 lorebook 内容根内。
 */
export function isWorkspaceLorebookScopePath(filePath: string): boolean {
    const segments = normalizeWorkspacePath(filePath).split("/").filter(Boolean);
    return segments[0] === "lorebook";
}

/**
 * 清理展开路径，仅保留当前仍为目录且有子节点的路径。
 */
export function sanitizeExpandedPaths(nodes: WorkspaceTreeNode[], expandedPaths: string[]): string[] {
    const validPathSet = new Set(collectExpandablePaths(nodes));
    return expandedPaths.filter((path) => validPathSet.has(path));
}

/**
 * 收集有子节点的目录路径。
 */
export function collectExpandablePaths(nodes: WorkspaceTreeNode[]): string[] {
    const paths: string[] = [];
    const visit = (items: WorkspaceTreeNode[]): void => {
        for (const item of items) {
            if (item.isDirectory && item.children.length > 0) {
                paths.push(item.path);
                visit(item.children);
            }
        }
    };
    visit(nodes);
    return paths;
}

/**
 * 收集命中节点的祖先目录，用于搜索时强制展开。
 */
export function collectAncestorPaths(nodes: WorkspaceFileNode[]): string[] {
    const pathSet = new Set<string>();
    for (const node of nodes) {
        let parentPath = resolveParentPath(node.path);
        while (parentPath) {
            pathSet.add(parentPath.endsWith("/") ? parentPath : `${parentPath}/`);
            parentPath = resolveParentPath(parentPath);
        }
    }
    return [...pathSet];
}

/** Keep only outermost paths so a selected directory never operates twice on its children. */
export function outermostWorkspacePaths(paths: readonly string[]): string[] {
    const chosen = new Set(paths.map(normalizeWorkspacePath));
    const seen = new Set<string>();
    const outermost: string[] = [];
    for (const path of paths) {
        const normalized = normalizeWorkspacePath(path);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        let parent = resolveParentPath(normalized);
        while (parent && !chosen.has(parent)) parent = resolveParentPath(parent);
        if (!parent) outermost.push(path);
    }
    return outermost;
}

/**
 * 解析拖拽后的目标路径。
 */
export function resolveMovedPath(sourcePath: string, targetDir: string): string {
    const sourceName = basename(sourcePath);
    return targetDir ? `${targetDir.replace(/\/$/, "")}/${sourceName}` : sourceName;
}

/**
 * 判断是否允许移动到目标目录。
 */
export function canMovePath(sourceNode: WorkspaceFileNode, targetDir: string, existingPaths: Set<string>): boolean {
    const normalizedSourcePath = normalizeWorkspacePath(sourceNode.path);
    const normalizedTargetDir = normalizeWorkspacePath(targetDir);
    const nextPath = normalizeWorkspacePath(resolveMovedPath(sourceNode.path, targetDir));

    if (nextPath === normalizedSourcePath || existingPaths.has(nextPath)) {
        return false;
    }
    if (!sourceNode.isDirectory) {
        return true;
    }

    return normalizedTargetDir !== normalizedSourcePath
        && !normalizedTargetDir.startsWith(`${normalizedSourcePath}/`);
}

/**
 * 判断当前拖拽是否允许落在指定节点。
 */
export function canDropOnWorkspaceNode(
    sourcePath: string,
    targetPath: string,
    parentByPath: Map<string, string | null>,
): boolean {
    if (sourcePath === targetPath) {
        return false;
    }
    let currentPath = parentByPath.get(targetPath) ?? null;
    while (currentPath) {
        if (currentPath === sourcePath) {
            return false;
        }
        currentPath = parentByPath.get(currentPath) ?? null;
    }
    return true;
}

/**
 * 构建当前可见树的拖拽上下文。
 */
export function buildWorkspaceNodeDropContextMap(
    nodes: WorkspaceTreeNode[],
    expandedPathSet: ReadonlySet<string>,
): Map<string, WorkspaceNodeDropContext> {
    const contextMap = new Map<string, WorkspaceNodeDropContext>();
    const visiblePaths: string[] = [];
    const visibleIndexByPath = new Map<string, number>();
    const prependFolderPathByNodePath = new Map<string, string>();
    const outsideAfterPathByNodePath = new Map<string, string>();

    const visit = (items: WorkspaceTreeNode[], depth: number): string | null => {
        let lastVisiblePath: string | null = null;

        for (const [index, item] of items.entries()) {
            const isExpandedBranch = item.isDirectory && item.children.length > 0 && expandedPathSet.has(item.path);
            visibleIndexByPath.set(item.path, visiblePaths.length);
            visiblePaths.push(item.path);
            contextMap.set(item.path, {
                isExpandedBranch,
                isLastRoot: depth === 0 && index === items.length - 1,
                prependFolderPath: null,
                outsideAfterPath: null,
                tailAfterPath: null,
            });

            lastVisiblePath = item.path;
            if (!isExpandedBranch) {
                continue;
            }

            const firstChild = item.children[0];
            if (firstChild) {
                prependFolderPathByNodePath.set(firstChild.path, item.path);
            }

            const childLastVisiblePath = visit(item.children, depth + 1);
            lastVisiblePath = childLastVisiblePath ?? item.path;
            const itemContext = contextMap.get(item.path);
            if (itemContext) {
                itemContext.tailAfterPath = lastVisiblePath;
            }
            if (!outsideAfterPathByNodePath.has(lastVisiblePath)) {
                outsideAfterPathByNodePath.set(lastVisiblePath, lastVisiblePath);
            }
        }

        return lastVisiblePath;
    };

    visit(nodes, 0);

    for (const [nodePath, folderPath] of prependFolderPathByNodePath) {
        const context = contextMap.get(nodePath);
        if (context) {
            context.prependFolderPath = folderPath;
        }
    }

    for (const [nodePath, afterPath] of outsideAfterPathByNodePath) {
        const context = contextMap.get(nodePath);
        if (!context) {
            continue;
        }

        const visibleIndex = visibleIndexByPath.get(nodePath);
        if (visibleIndex === undefined) {
            continue;
        }

        const nextPath = visiblePaths[visibleIndex + 1];
        const nextContext = nextPath ? contextMap.get(nextPath) : null;
        if (!nextContext || nextContext.outsideAfterPath) {
            continue;
        }
        nextContext.outsideAfterPath = afterPath;
    }

    return contextMap;
}

/**
 * 解析行内拖拽落点。
 */
export function resolveWorkspaceNodeDropPosition(
    node: WorkspaceFileNode,
    event: DragEvent,
    dropContext: WorkspaceNodeDropContext | null,
): WorkspaceFileDropState {
    const targetElement = event.currentTarget as HTMLElement;
    const rect = targetElement.getBoundingClientRect();
    const y = event.clientY - rect.top;

    if (node.isDirectory) {
        const isUpperZone = y < rect.height * 0.28;
        const isLowerZone = y > rect.height * 0.72;

        if (isUpperZone) {
            return {
                targetPath: node.path,
                position: "before",
                visualKind: "before-line",
            };
        }

        if (isLowerZone) {
            return {
                targetPath: node.path,
                position: "after",
                visualKind: "after-line",
            };
        }

        return {
            targetPath: node.path,
            position: "inside",
            visualKind: "inside-node",
        };
    }

    const isUpperHalf = y < rect.height * 0.5;

    if (isUpperHalf && dropContext?.prependFolderPath) {
        return {
            targetPath: dropContext.prependFolderPath,
            position: "inside",
            visualKind: "inside-start",
        };
    }
    if (isUpperHalf && dropContext?.outsideAfterPath) {
        return {
            targetPath: dropContext.outsideAfterPath,
            position: "after",
            visualKind: "after-line",
        };
    }
    if (isUpperHalf) {
        return {
            targetPath: node.path,
            position: "before",
            visualKind: "before-line",
        };
    }
    if (dropContext?.isLastRoot) {
        return {
            targetPath: null,
            position: "root",
            visualKind: "root-line",
        };
    }
    return {
        targetPath: node.path,
        position: "after",
        visualKind: "after-line",
    };
}

/**
 * 解析子树尾部落点。
 */
export function resolveWorkspaceTailDrop(
    node: WorkspaceFileNode,
    dropContext: WorkspaceNodeDropContext | null,
): WorkspaceFileDropState {
    return {
        targetPath: dropContext?.tailAfterPath ?? node.path,
        position: "after",
        visualKind: "after-line",
    };
}

/**
 * 返回文件或目录图标。
 */
export function getWorkspaceFileIcon(node: WorkspaceFileNode, expanded: boolean): string {
    if (node.isDirectory) {
        return expanded ? "i-lucide-folder-open" : "i-lucide-folder";
    }
    if (node.path.toLowerCase().endsWith(".md")) {
        return "i-lucide-file-text";
    }
    if (node.editable) {
        return "i-lucide-file";
    }
    return "i-lucide-file-question";
}

/**
 * 标准化路径，去掉结尾斜杠。
 */
export function normalizeWorkspacePath(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/");
    return normalizedPath.endsWith("/") ? normalizedPath.slice(0, -1) : normalizedPath;
}

/**
 * 解析父级路径，目录父级仍保留结尾斜杠以匹配节点。
 */
export function resolveParentPath(filePath: string): string | null {
    const normalizedPath = normalizeWorkspacePath(filePath);
    if (!normalizedPath.includes("/")) {
        return null;
    }
    return normalizedPath.slice(0, normalizedPath.lastIndexOf("/"));
}

function sortWorkspaceNodes(items: WorkspaceTreeNode[]): WorkspaceTreeNode[] {
    items.sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
            return left.isDirectory ? -1 : 1;
        }
        return left.path.localeCompare(right.path, "zh-Hans-CN");
    });
    for (const item of items) {
        sortWorkspaceNodes(item.children);
    }
    return items;
}

function basename(filePath: string): string {
    const normalizedPath = normalizeWorkspacePath(filePath);
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}
