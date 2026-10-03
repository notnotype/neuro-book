import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";

export type WorkspacePathCopyMode =
    | "relative-path"
    | "absolute-path"
    | "relative-reference"
    | "absolute-reference";

/**
 * 构造工作区节点的复制文本。
 */
export function buildWorkspacePathCopyText(node: WorkspaceFileNode, mode: WorkspacePathCopyMode): string {
    if (mode === "relative-path") {
        return resolveWorkspaceRelativePath(node);
    }
    if (mode === "absolute-path") {
        return resolveWorkspaceAbsolutePath(node);
    }
    if (mode === "relative-reference") {
        return buildWorkspaceMarkdownReference(node, resolveWorkspaceRelativePath(node));
    }
    return buildWorkspaceMarkdownReference(node, resolveWorkspaceAbsolutePath(node));
}

/**
 * 返回相对 Workspace Root 的路径。目录与内容目录节点保留尾随 `/`。
 */
export function resolveWorkspaceRelativePath(node: WorkspaceFileNode): string {
    const normalizedPath = node.path.replace(/\\/g, "/").replace(/^workspace\//, "").replace(/^\.\//, "");
    const trimmedPath = normalizedPath.replace(/\/$/, "");
    if (trimmedPath.toLowerCase().endsWith("/index.md")) {
        return `${trimmedPath.slice(0, -"/index.md".length)}/`;
    }
    if (node.isDirectory) {
        return `${trimmedPath}/`;
    }
    return trimmedPath;
}

/**
 * 返回文件系统绝对路径。目录保留系统分隔符尾缀。
 */
export function resolveWorkspaceAbsolutePath(node: WorkspaceFileNode): string {
    if (!node.isDirectory) {
        return node.absolutePath;
    }
    if (node.absolutePath.endsWith("/") || node.absolutePath.endsWith("\\")) {
        return node.absolutePath;
    }
    const separator = node.absolutePath.includes("\\") ? "\\" : "/";
    return `${node.absolutePath}${separator}`;
}

/**
 * 构造 Markdown inline link 引用。
 */
export function buildWorkspaceMarkdownReference(node: WorkspaceFileNode, targetPath: string): string {
    return `[${escapeMarkdownLabel(node.title || basename(node.path))}](${targetPath})`;
}

/**
 * 返回路径 basename，目录路径会先去掉尾随 `/`。
 */
function basename(filePath: string): string {
    const normalizedPath = filePath.replace(/\\/g, "/").replace(/\/$/, "");
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}

/**
 * 转义 Markdown link label 中会破坏语法的字符。
 */
function escapeMarkdownLabel(label: string): string {
    return label.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}
