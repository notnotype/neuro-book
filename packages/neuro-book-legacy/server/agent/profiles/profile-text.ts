/**
 * 渲染 profile prompt 用的缩进友好模板字符串。
 */
export function profileText(strings: TemplateStringsArray, ...values: unknown[]): string {
    const rawParts = strings.raw.map((part) => decodeUnicodeEscapes(part).replace(/\r\n/g, "\n"));
    const firstPart = rawParts[0] ?? "";
    const lastIndex = rawParts.length - 1;
    rawParts[0] = firstPart.replace(/^\n/, "");
    rawParts[lastIndex] = (rawParts[lastIndex] ?? "").replace(/\n[ \t]*$/, "");

    const indent = minimumIndent(rawParts);
    return rawParts
        .map((part, index) => {
            const value = index < values.length ? String(values[index] ?? "") : "";
            return stripIndent(part, indent) + value;
        })
        .join("")
        .trim();
}

/**
 * 部分 profile 编译链路会把非 ASCII 模板文本写成 \uXXXX。
 * 这里仅恢复 unicode escape，不触碰正则和命令示例里的普通反斜杠。
 */
function decodeUnicodeEscapes(text: string): string {
    return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => {
        return String.fromCharCode(Number.parseInt(hex, 16));
    });
}

function minimumIndent(parts: readonly string[]): number {
    const indents = parts
        .flatMap((part) => part.split("\n"))
        .filter((line) => line.trim().length > 0)
        .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
    return indents.length > 0 ? Math.min(...indents) : 0;
}

function stripIndent(text: string, indent: number): string {
    if (indent <= 0) {
        return text;
    }
    return text
        .split("\n")
        .map((line) => line.startsWith(" ".repeat(indent)) ? line.slice(indent) : line)
        .join("\n");
}
