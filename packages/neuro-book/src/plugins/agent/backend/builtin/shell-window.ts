/**
 * `shell` 交给模型的输出窗口（docs/specs/agent/builtin-tools.md 的术语）的尺寸与小件：前台命令边跑边收（`shell.ts`），后台命令结束后从
 * 输出文件读（`shell-background.ts`），两边按同一套规则截。
 */

export const WINDOW_BYTES = 50 * 1024;
export const WINDOW_LINES = 2_000;
export const PART_BYTES = 20 * 1024;
export const PART_LINES = 500;
export const LINE_BYTES = 768;
/** 全文与后台命令输出文件的上限。 */
export const OUTPUT_LIMIT = 64 * 1024 * 1024;

/** 没有尾部换行的最后一段也算一行。 */
export function lineCount(text: string): number {
    if (text === "") return 0;
    let lines = text.endsWith("\n") ? 0 : 1;
    for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) lines += 1;
    return lines;
}

export function capLines(text: string): string {
    return text.split("\n").map((line) => {
        const size = Buffer.byteLength(line, "utf8");
        // 按字节切可能切开多字节字符，解码时多出来的替换字符去掉。
        return size <= LINE_BYTES ? line : `${Buffer.from(line, "utf8").subarray(0, LINE_BYTES).toString("utf8").replace(/�+$/u, "")} …[本行共 ${String(size)} 字节，已截断]`;
    }).join("\n");
}

/** 已经截下的开头与结尾拼成窗口：开头去掉最后一行、结尾去掉第一行（可能是半行），各至多 `PART_LINES` 行。 */
export function headAndTail(head: string, tail: string, totalBytes: number): string {
    const headLines = head.split("\n");
    if (headLines.length > 1) headLines.pop();
    const tailLines = tail.split("\n");
    if (tailLines.length > 1) tailLines.shift();
    const notice = `…[中间省略，共 ${String(totalBytes)} 字节]…`;
    return capLines([...headLines.slice(0, PART_LINES), notice, ...tailLines.slice(-PART_LINES)].join("\n"));
}
