/**
 * `shell` 命令里的资源地址（docs/specs/agent/builtin-tools.md 输出 19）：词法扫描找出直接写出的地址，按所在的引号上下文编码替换后的
 * 真实路径。只跟踪引号与反斜杠，不解析 shell 语法：heredoc、变量拼接、命令替换里的地址不保证替换。
 */

export type QuoteContext = "none" | "single" | "double";

export interface FoundAddress {
    /** 在命令里的范围（含转义字符的原文）。 */
    readonly start: number;
    readonly end: number;
    /** 去掉转义后的地址。 */
    readonly address: string;
    readonly quote: QuoteContext;
}

const SCHEME = /[a-z][a-z0-9+.-]*:\/\//uy;
/** 方案前一个字符是这些时不算地址的开头（`xproject://`）；`--file=project://a` 的 `=` 可以。 */
const WORD = /[A-Za-z0-9_-]/u;
const NONE_END = /[\s;|&<>()'"$`]/u;
/** `#` 在词首才是注释：命令开头、空白或操作符之后（`echo a;#x`）；`$#`、`a#b` 不是。 */
const WORD_START = /[\s;|&<>()]/u;
const DOUBLE_ESCAPABLE = new Set(["$", "`", "\"", "\\"]);

function addressAt(command: string, start: number, quote: QuoteContext): {readonly end: number; readonly address: string} {
    let address = "";
    let index = start;
    while (index < command.length) {
        const char = command[index] as string;
        if (quote === "single") {
            if (char === "'") break;
        } else if (quote === "double") {
            if (char === "\"" || char === "$" || char === "`") break;
            if (char === "\\" && DOUBLE_ESCAPABLE.has(command[index + 1] ?? "")) {
                address += command[index + 1] as string;
                index += 2;
                continue;
            }
        } else {
            if (NONE_END.test(char)) break;
            if (char === "\\" && index + 1 < command.length) {
                address += command[index + 1] as string;
                index += 2;
                continue;
            }
        }
        address += char;
        index += 1;
    }
    return {end: index, address};
}

/** 找出命令里形如地址的片段；是不是已登记的方案由调用方判断（`https://` 也会在这里出现）。 */
export function findAddresses(command: string): FoundAddress[] {
    const found: FoundAddress[] = [];
    let quote: QuoteContext = "none";
    let index = 0;
    while (index < command.length) {
        const char = command[index] as string;
        SCHEME.lastIndex = index;
        if ((char >= "a" && char <= "z") && SCHEME.test(command) && !WORD.test(command[index - 1] ?? " ")) {
            const {end, address} = addressAt(command, index, quote);
            found.push({start: index, end, address, quote});
            index = end;
            continue;
        }
        if (quote === "single") {
            if (char === "'") quote = "none";
            index += 1;
        } else if (quote === "double") {
            if (char === "\\") index += 2;
            else {
                if (char === "\"") quote = "none";
                index += 1;
            }
        } else if (char === "\\") {
            index += 2;
        } else if (char === "#" && WORD_START.test(command[index - 1] ?? " ")) {
            // 注释里的地址不换，也不能因为它是坏地址就拒绝这条命令。
            const newline = command.indexOf("\n", index);
            index = newline < 0 ? command.length : newline;
        } else {
            if (char === "'") quote = "single";
            else if (char === "\"") quote = "double";
            index += 1;
        }
    }
    return found;
}

/** 按引号上下文编码一个真实路径。 */
export function encodePath(path: string, quote: QuoteContext): string {
    switch (quote) {
        case "none":
            return `'${path.replaceAll("'", "'\\''")}'`;
        case "single":
            return path.replaceAll("'", "'\\''");
        case "double":
            return path.replace(/[$`"\\]/gu, "\\$&");
    }
}

/** 换掉 `replacements` 给出的片段（`null` 的原样留着）。 */
export function substitute(command: string, found: readonly FoundAddress[], replacements: ReadonlyArray<string | null>): string {
    let out = "";
    let cursor = 0;
    found.forEach((item, index) => {
        const replacement = replacements[index];
        if (replacement === null || replacement === undefined) return;
        out += command.slice(cursor, item.start) + encodePath(replacement, item.quote);
        cursor = item.end;
    });
    return out + command.slice(cursor);
}
