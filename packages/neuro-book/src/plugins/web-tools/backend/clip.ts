/**
 * 按 UTF-16 码元截断而不切开代理对（docs/specs/web/tools.md 输出 2、6、7、12 的“字”按码元计）。切开的半个代理对写成 UTF-8 时
 * 变成替换字符，交给模型服务时还可能被拒收，所以所有截断与断行都经这里。
 */

/** `end` 落在一对代理的中间时往前退一位，非 BMP 字符整个留到后面。 */
export function safeEnd(text: string, end: number): number {
    if (end <= 0 || end >= text.length) return end;
    const before = text.charCodeAt(end - 1);
    return before >= 0xd800 && before <= 0xdbff ? end - 1 : end;
}

/** 截到至多 `max` 个码元。 */
export const clip = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, safeEnd(text, max)));
