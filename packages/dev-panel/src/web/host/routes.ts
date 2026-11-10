/**
 * 面板内各页的地址。零件把去 Work、Task、产物、文档页的入口渲染成真实的 `<a href>`（能在新标签页打开、能复制地址），
 * 普通左键点击时由页面用同一地址 `router.push`；地址只在这里拼，零件与页面不各写一份。路由表见 `router.ts`。
 */
import type {SearchRecordMatch} from "./types.js";

export const workHref = (workId: string) => `/work/${workId}`;
export const taskHref = (workId: string, taskId: string) => `/work/${workId}/task/${taskId}`;
/** Work 级产物的 Task 段写 `-`，与读接口一致。 */
export const artifactHref = (workId: string, taskId: string | null, artifactId: string) => `/artifact/${workId}/${taskId ?? "-"}/${artifactId}`;
export const docHref = (checkoutKey: string, path: string) => `/docs?checkout=${encodeURIComponent(checkoutKey)}&path=${encodeURIComponent(path)}`;
/** 编辑页只编辑主工作区里的文件。 */
export const editHref = (path: string) => `/edit?path=${encodeURIComponent(path)}`;
export const newHref = (workId: string | null = null) => (workId ? `/new?workId=${encodeURIComponent(workId)}` : "/new");

/**
 * 页面实例的身份：路由名加路径参数，不含查询参数（t15）。外壳给 `RouterView` 里的页面按它加 key：Work、Task、产物页换了参数就重建，
 * 上一个页面的提示、重试与在途的回包不会落到新页面上；`?pane=`、`?path=` 这类查询参数由页面自己处理，变了不重建。
 */
export function pageKey(route: {name?: string | symbol | null; params: Record<string, string | string[] | undefined>}): string {
    const params = Object.keys(route.params).sort().map((key) => [key, route.params[key] ?? null]);
    return `${String(route.name ?? "")}:${JSON.stringify(params)}`;
}

/** 搜索里记录的匹配去哪一页；会话没有单独的页，去会话列表。 */
export function searchRecordHref(match: SearchRecordMatch): string {
    if (match.kind === "work" && match.workId) return workHref(match.workId);
    if (match.kind === "task" && match.workId && match.taskId) return taskHref(match.workId, match.taskId);
    if (match.kind === "artifact" && match.workId && match.artifactId) return artifactHref(match.workId, match.taskId ?? null, match.artifactId);
    return "/live/sessions";
}

/** 会话页上的这个会话（会话页把会话键换成它所在的 pane，t22）。 */
export function sessionHref(sessionKey: string): string {
    return `/live/sessions?session=${encodeURIComponent(sessionKey)}`;
}

/** 普通左键点击（不带修饰键）才在本页内跳转；中键与 Ctrl、⌘、Shift、Alt 加点击交给浏览器（新标签页、新窗口、下载）。 */
export function isPlainClick(event: MouseEvent): boolean {
    return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
