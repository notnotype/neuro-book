/**
 * 工作区图片 URL 工具：把 markdown 里的项目相对路径（如 assets/illustrations/xxx.png）
 * 转成后端 raw serve API 的 URL，供 TipTap 与 marked 两个渲染端共用。
 */

/** 判断 src 是否是需要重写的工作区相对路径（排除外链、data:、blob:、站内绝对路径）。 */
export function isRelativeWorkspaceImageSrc(src: string): boolean {
    const trimmed = src.trim();
    if (!trimmed) {
        return false;
    }
    return !/^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(trimmed);
}

/**
 * 构造 raw serve URL。projectPath 缺省表示 user-assets 工作区。
 * filePath 里的 ./ 前缀会被剥掉（编辑器常见写法 ![](./assets/x.png)）。
 */
export function workspaceImageUrl(filePath: string, projectPath?: string | null): string {
    const normalized = filePath.trim().replace(/^\.\//u, "");
    const params = new URLSearchParams({path: normalized});
    if (projectPath) {
        params.set("projectPath", projectPath);
    } else {
        params.set("workspaceKind", "user-assets");
    }
    return `/api/workspace-files/raw?${params.toString()}`;
}

/**
 * 生成"相对路径 → raw URL"的重写函数；非相对路径原样返回。
 */
export function createWorkspaceImageResolver(projectPath?: string | null): (src: string) => string {
    return (src: string) => isRelativeWorkspaceImageSrc(src) ? workspaceImageUrl(src, projectPath) : src;
}
