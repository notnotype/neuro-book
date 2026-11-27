/**
 * 配置校验（`config.ts`）与发网页（`web.ts`）共用的路径规则。放在两者之外：配置层被每个命令加载，不该为一个纯函数
 * 带上发网页的模块。两边用同一条规则，校验收下的 `index.html`，单页回退就一定发得出。
 */

import {relative, sep} from "node:path";

/** `real` 是否在 `root` 里面（两者都是真实路径，已解开符号链接；`root` 本身也算）。只比路径，不碰文件系统。 */
export function isInsideDir(root: string, real: string): boolean {
    const inside = relative(root, real);
    return inside !== ".." && !inside.startsWith(`..${sep}`);
}

/**
 * 文件系统报的错是不是“没有这个东西”：不存在（含链接指向不存在之处），或路径中间有一段不是目录。别的错误
 * （没有权限、链接成环、I/O 错误）是有却读不出。
 */
export function isNotFoundError(error: unknown): boolean {
    const code = (error as {code?: unknown} | undefined)?.code;
    return code === "ENOENT" || code === "ENOTDIR";
}
