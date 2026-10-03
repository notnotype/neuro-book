/**
 * 构造前端本地状态使用的 Agent Session scope key。
 *
 * 该值只用于草稿、置顶和最近会话的 localStorage 分区，不进入 HTTP 或 Session
 * metadata。Project 使用单段 root；user-assets Studio 与未选择 Project 都属于
 * Workspace Root session scope。
 */
export function agentSessionScopeKey(workspaceKind: "novel" | "user-assets", projectRoot: string): string {
    return workspaceKind === "novel" && projectRoot
        ? `project:${projectRoot}`
        : "workspace-root";
}
