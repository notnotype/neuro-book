/**
 * 快照文字的截断、转义与计量（docs/specs/agent/page-agent.md 输出 3、12）。
 */

/** 按字符（码点）截断，不切开代理对；截掉了就补一个省略号。 */
export function truncate(text: string, limit: number): string {
    if (text.length <= limit) return text;
    const points = Array.from(text);
    return points.length <= limit ? text : `${points.slice(0, limit).join("")}…`;
}

/**
 * JSON.stringify 已转义引号、反斜杠与 U+0000 到 U+001F，也会转义孤立的代理项；
 * 它不转义的双向控制字符与行、段分隔符在这里补上：这些字符能让读快照的模型或人看到与实际顺序不同的文字。
 */
const UNESCAPED_BY_JSON = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029\u007F-\u009F]/gu;

/** 先截断再转义（输出 3），写成带引号的 JSON 字符串。 */
export function quote(text: string, limit: number): string {
    return JSON.stringify(truncate(text, limit)).replace(UNESCAPED_BY_JSON, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** UTF-8 字节数，不分配缓冲区。 */
export function utf8Length(text: string): number {
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
            const next = text.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                bytes += 4;
                index += 1;
            } else bytes += 3;
        } else bytes += 3;
    }
    return bytes;
}

/**
 * 估算的 token 数：ASCII 约 4 个字符一个，其余字符（汉字等）一个算一个。偏保守，宁可少给一些行，
 * 不让快照超出调用方给的预算。
 */
export function estimateTokens(text: string): number {
    let ascii = 0;
    let other = 0;
    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code < 0x80) ascii += 1;
        else if (code < 0xdc00 || code > 0xdfff) other += 1;
    }
    return Math.ceil(ascii / 4) + other;
}
