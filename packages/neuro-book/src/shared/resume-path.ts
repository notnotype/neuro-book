/**
 * 启动时打开的路由（docs/specs/runtime/projects.md 的“启动时打开”）：桌面壳与 `nbook` 命令在启动类入口打开它，由 `nbook.projects`
 * 302 到上次的作品或书架。单独一个没有导入的文件：壳与命令行只要这个字符串，不因此依赖 `nbook/shared/projects` 背后的运行时包。
 *
 * 拼地址用 `new URL(RESUME_PATH, 服务端地址)`：服务端地址来自 `Bun.serve().url.href`，以斜杠结尾，字符串相加会成 `//api/…`，
 * 落到静态回退、静默打开书架。
 */
export const RESUME_PATH = "/api/nbook.projects/resume";
