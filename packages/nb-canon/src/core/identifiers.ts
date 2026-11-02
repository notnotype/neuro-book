/**
 * 名字的合法性：字段 id、元素 id、块 id 要能直接写进 MDX 的成员访问（`panel.魔力`、`[t3]`），所以必须是 JS 的
 * IdentifierName；命名空间还要能作为表达式的根，所以必须是 Identifier（不能是保留字），也不能占用内核的保留名
 * （docs/specs/canon/components.md 输入与前置条件，rendering.md 输出 2）。
 */

const IDENTIFIER_NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u;

const JS_RESERVED = new Set([
    "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export",
    "extends", "false", "finally", "for", "function", "if", "implements", "import", "in", "instanceof", "interface", "let", "new", "null",
    "package", "private", "protected", "public", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "var",
    "void", "while", "with", "yield", "undefined", "NaN", "Infinity",
]);

/** 内核占用的根名字：命名空间不能用。只增不减（rendering.md 输出 2）。 */
export const RESERVED_ROOTS: ReadonlySet<string> = new Set(["entry", "text", "ref"]);

/** 每个命名空间的保留控制字段（components.md 术语）。 */
export const ENABLE_FIELD = "启用";

export function isIdentifierName(name: string): boolean {
    return IDENTIFIER_NAME.test(name);
}

export function isNamespaceName(name: string): boolean {
    return isIdentifierName(name) && !JS_RESERVED.has(name) && !RESERVED_ROOTS.has(name);
}
