/**
 * 编辑器工作区文件图标映射工具。
 *
 * 遵循设计系统规范：
 * 1. 色彩全部使用已登记的主题语义变量（--accent-text, --status-warning, --status-success, --text-muted 等）；
 * 2. 避免使用未经映射的硬编码调色板（如 text-amber-500, text-emerald-600），保证各主题下对比度合规；
 * 3. 供 EditorTabItem 与 EditorBreadcrumbs 统一复用。
 */

export interface FileIconDescriptor {
    iconClass: string;
}

export function resolveFileIcon(pathOrFilename: string): string {
    if (!pathOrFilename) {
        return "i-lucide-file-text text-[var(--text-muted)]";
    }

    const filename = pathOrFilename.split("/").pop() || pathOrFilename;
    const ext = filename.split(".").pop()?.toLowerCase();

    switch (ext) {
        case "md":
            return "i-lucide-file-text text-[var(--accent-text)]";
        case "json":
            return "i-lucide-braces text-[var(--status-warning)]";
        case "html":
        case "htm":
            return "i-lucide-code-xml text-[var(--status-warning)]";
        case "env":
            return "i-lucide-key-round text-[var(--status-warning)]";
        case "ts":
        case "tsx":
            return "i-lucide-file-code-2 text-[var(--accent-text)]";
        case "js":
        case "jsx":
            return "i-lucide-file-code text-[var(--status-warning)]";
        case "vue":
            return "i-lucide-file-code text-[var(--status-success)]";
        default:
            return "i-lucide-file-text text-[var(--text-muted)]";
    }
}
