/**
 * 内置工具在 NeuroBook 一侧共用的小件（docs/specs/agent/builtin-tools.md）。
 */

/** `shell` 的工作目录，也是 `grep`、`glob` 的缺省搜索根：有主项目时是项目，没有时是会话的工作区。 */
export const workingAddress = (project: string | undefined): string => (project === undefined ? "session://" : "project://");
