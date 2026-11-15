/**
 * 全文查找要看的文字（docs/specs/agent/request-trace.md 输出 17、20）：一段存下的内容换成查看器显示的那几段文字。
 *
 * 和 nb-agent-ui 的 `contentPieces`（查看器展开一行时显示的）逐字相同：列表上的处数、详情查找条的总数与高亮的位置都按它算，
 * 两边不一致就会对不上。nb-agent-ui 的 `request-trace.contract.test.ts` 用真实记录核对两边的处数一致。图片不进查找（只有类型与大小）。
 */

/** 一段内容里要查的几段文字，按查看器显示的先后。 */
export function searchablePieces(value: unknown): string[] {
    if (value === null || typeof value !== "object") return typeof value === "string" ? [value] : [];
    const object = value as {content?: unknown; toolCalls?: unknown; kind?: unknown; text?: unknown; description?: unknown; parameters?: unknown};
    const pieces: string[] = [];
    const blocks = Array.isArray(object.content) ? object.content : typeof object.kind === "string" ? [object] : [];
    for (const block of blocks as {kind?: unknown; text?: unknown}[]) {
        if ((block.kind === "text" || block.kind === "thinking") && typeof block.text === "string") pieces.push(block.text);
    }
    if (Array.isArray(object.toolCalls)) for (const call of object.toolCalls as {tool?: unknown; args?: unknown}[]) pieces.push(`${typeof call.tool === "string" ? call.tool : ""} ${JSON.stringify(call.args ?? {}, null, 2)}`);
    if (typeof object.description === "string") pieces.push(object.description);
    if (object.parameters !== undefined) pieces.push(JSON.stringify(object.parameters, null, 2));
    return pieces;
}

/** 不分大小写的处数与每处的偏移（在 `pieces` 用换行连起来的文字里）。查找词为空时没有命中。 */
export function occurrences(pieces: readonly string[], needle: string): number[] {
    const target = needle.toLowerCase();
    if (target === "") return [];
    const haystack = pieces.join("\n").toLowerCase();
    const found: number[] = [];
    for (let at = haystack.indexOf(target); at >= 0; at = haystack.indexOf(target, at + target.length)) found.push(at);
    return found;
}
