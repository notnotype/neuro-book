/**
 * 全文查找要看的文字（docs/specs/agent/request-trace.md 输出 17、20）：一段存下的内容换成查看器显示的那几段文字。
 *
 * 和 nb-agent-ui 的 `contentPieces`（查看器展开一行时显示的）逐字相同：列表上的处数、详情查找条的总数与高亮的位置都按它算，
 * 两边不一致就会对不上。nb-agent-ui 的 `request-trace.contract.test.ts` 用真实记录核对两边的处数一致。图片不进查找（只有类型与大小）。
 * 每段各自查（`findMatches`），不把几段连起来查。
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

/** 一处命中在原文里的起止（UTF-16 下标，`end` 不含）。 */
export interface TextMatch {
    readonly start: number;
    readonly end: number;
}

/**
 * 不分大小写地找出 `needle` 在一段文字里的每一处（从前往后、不重叠），交回原文里的起止。查找词为空时没有命中。
 * 一段一段地找、不跨段：查看器按段高亮，跨段的命中在那边没处标。nb-agent-ui 的 `highlightSegments` 用同样的规则，两边的处数才对得上。
 */
export function findMatches(text: string, needle: string): TextMatch[] {
    const target = foldCase(needle).folded;
    if (target === "") return [];
    const {folded, starts, ends} = foldCase(text);
    const found: TextMatch[] = [];
    for (let at = folded.indexOf(target); at >= 0; at = folded.indexOf(target, at + target.length)) {
        found.push(starts === null || ends === null ? {start: at, end: at + target.length} : {start: starts[at]!, end: ends[at + target.length - 1]!});
    }
    return found;
}

/**
 * 转成小写，用来不分大小写地比较。少数字符变成小写后变长（例如 `İ` 变成 `i` 加一个附加点），折叠后的下标就不再是原文的下标：
 * 这时逐个字符折叠，记下折叠后的每一位来自原文的哪个字符（`starts` 是它的起点，`ends` 是它的终点）；长度不变时两者为 null，下标相同。
 */
function foldCase(text: string): {readonly folded: string; readonly starts: number[] | null; readonly ends: number[] | null} {
    const lower = text.toLowerCase();
    if (lower.length === text.length) return {folded: lower, starts: null, ends: null};
    let folded = "";
    const starts: number[] = [];
    const ends: number[] = [];
    for (let index = 0; index < text.length;) {
        const width = text.codePointAt(index)! > 0xffff ? 2 : 1;
        const piece = text.slice(index, index + width).toLowerCase();
        for (let offset = 0; offset < piece.length; offset += 1) {
            starts.push(index);
            ends.push(index + width);
        }
        folded += piece;
        index += width;
    }
    return {folded, starts, ends};
}
