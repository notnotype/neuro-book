type SourceToken = {
    kind: "identifier" | "string" | "punctuation";
    value: string;
};

/**
 * 从 TypeScript/TSX Profile 源码中提取模块 specifier。
 *
 * 该扫描器只理解 import/export 所需的词法子集，因此不会引入完整 TypeScript
 * 编译器；它保留 esbuild 会擦掉的 `import type`，并跳过行注释与块注释。
 */
export function profileSourceModuleSpecifiers(source: string): string[] {
    const tokens = tokenize(source);
    const specifiers: string[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token?.kind !== "identifier" || (token.value !== "import" && token.value !== "export")) {
            continue;
        }
        const immediate = tokens[index + 1];
        if (token.value === "import" && immediate?.kind === "punctuation" && immediate.value === ".") {
            continue;
        }
        if (token.value === "import" && immediate?.kind === "string") {
            specifiers.push(immediate.value);
            continue;
        }
        if (token.value === "import" && immediate?.kind === "punctuation" && immediate.value === "(") {
            const dynamicSpecifier = tokens[index + 2];
            if (dynamicSpecifier?.kind === "string") {
                specifiers.push(dynamicSpecifier.value);
            }
            continue;
        }
        for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
            const current = tokens[cursor];
            if (!current || current.kind === "punctuation" && current.value === ";") {
                break;
            }
            if (current.kind === "identifier" && (current.value === "import" || current.value === "export")) {
                break;
            }
            if (current.kind === "identifier" && current.value === "from") {
                const fromSpecifier = tokens[cursor + 1];
                if (fromSpecifier?.kind === "string") {
                    specifiers.push(fromSpecifier.value);
                }
                break;
            }
            if (token.value === "import" && current.kind === "identifier" && current.value === "require") {
                const requireSpecifier = tokens[cursor + 2];
                if (tokens[cursor + 1]?.value === "(" && requireSpecifier?.kind === "string") {
                    specifiers.push(requireSpecifier.value);
                }
                break;
            }
        }
    }
    return [...new Set(specifiers)];
}

/** 把源码收敛为 import/export 分析所需 token，同时跳过注释和模板正文。 */
function tokenize(source: string): SourceToken[] {
    const tokens: SourceToken[] = [];
    let index = 0;
    while (index < source.length) {
        const char = source[index]!;
        const next = source[index + 1];
        if (/\s/u.test(char)) {
            index += 1;
            continue;
        }
        if (char === "/" && next === "/") {
            index = skipLineComment(source, index + 2);
            continue;
        }
        if (char === "/" && next === "*") {
            index = skipBlockComment(source, index + 2);
            continue;
        }
        if (char === "\"" || char === "'") {
            const stringToken = readString(source, index, char);
            tokens.push({kind: "string", value: stringToken.value});
            index = stringToken.nextIndex;
            continue;
        }
        if (char === "`") {
            index = skipTemplate(source, index + 1);
            continue;
        }
        if (/[A-Za-z_$]/u.test(char)) {
            const start = index;
            index += 1;
            while (index < source.length && /[A-Za-z0-9_$]/u.test(source[index]!)) {
                index += 1;
            }
            tokens.push({kind: "identifier", value: source.slice(start, index)});
            continue;
        }
        tokens.push({kind: "punctuation", value: char});
        index += 1;
    }
    return tokens;
}

/** 读取普通字符串；module specifier 的反斜杠 escape 按其字符值恢复。 */
function readString(source: string, start: number, quote: "\"" | "'"): {value: string; nextIndex: number} {
    let value = "";
    let index = start + 1;
    while (index < source.length) {
        const char = source[index]!;
        if (char === quote) {
            return {value, nextIndex: index + 1};
        }
        if (char === "\\" && index + 1 < source.length) {
            value += source[index + 1]!;
            index += 2;
            continue;
        }
        value += char;
        index += 1;
    }
    return {value, nextIndex: index};
}

/** 跳过行注释并返回下一行起点。 */
function skipLineComment(source: string, index: number): number {
    const newline = source.indexOf("\n", index);
    return newline < 0 ? source.length : newline + 1;
}

/** 跳过块注释；未闭合时直接消费到 EOF，由后续编译器报告语法错误。 */
function skipBlockComment(source: string, index: number): number {
    const end = source.indexOf("*/", index);
    return end < 0 ? source.length : end + 2;
}

/** 跳过模板字符串正文；Profile import specifier 不允许使用动态模板。 */
function skipTemplate(source: string, index: number): number {
    while (index < source.length) {
        const char = source[index]!;
        if (char === "\\") {
            index += 2;
            continue;
        }
        if (char === "`") {
            return index + 1;
        }
        index += 1;
    }
    return index;
}
