/**
 * 主 MDX 一块的解析与白名单（docs/specs/canon/rendering.md 输入与前置条件、输出 1、2、4）。
 *
 * 只解析成语法树、不编译、不执行：表达式由 micromark 的 mdxjs 扩展交给 acorn 解析成 ESTree，这里按节点表逐个查。
 * 必须带 ESM 扩展，否则 `import` 会被当成普通文字放行（t29 依赖试验）。解析结果按源文缓存：同一块渲染很多次，
 * 源文不变时只解析一次。
 */

import type {Expression, Node as EsNode} from "estree";
import type {Root} from "mdast";
import {fromMarkdown} from "mdast-util-from-markdown";
import {gfmStrikethroughFromMarkdown} from "mdast-util-gfm-strikethrough";
import {gfmTableFromMarkdown} from "mdast-util-gfm-table";
import {mdxFromMarkdown} from "mdast-util-mdx";
import {cjkFriendlyExtension} from "micromark-extension-cjk-friendly";
import {gfmStrikethrough} from "micromark-extension-gfm-strikethrough";
import {gfmTable} from "micromark-extension-gfm-table";
import {mdxjs} from "micromark-extension-mdxjs";

import {formatPath, parsePath} from "../core/address";
import {RESERVED_ROOTS} from "../core/identifiers";

export type SyntaxCode = "mdx-invalid" | "forbidden-syntax" | "unknown-tag" | "no-field-expression" | "cross-block";

export interface SyntaxProblem {
    readonly code: SyntaxCode;
    readonly line: number;
    readonly column: number;
    readonly message: string;
}

/** 表达式里的一个字段引用：`entry` 为 null 表示本条目，否则是 `ref("…")` 给的条目 id。 */
export interface FieldReference {
    readonly entry: string | null;
    readonly path: string;
}

/** 块里的一处表达式（正文里的 `{…}` 或标签属性里的表达式），带源文里的起止偏移（含花括号）。 */
export interface ExpressionSite {
    readonly start: number;
    readonly end: number;
    /** 花括号里面的原文。 */
    readonly source: string;
    /** 只含注释的表达式没有树。 */
    readonly expression: Expression | null;
    /** 只有一个字段引用、没有别的运算（带值写法写成 `=` 形式）。 */
    readonly reference: FieldReference | null;
    readonly references: readonly FieldReference[];
}

export interface RefTag {
    readonly start: number;
    readonly end: number;
    readonly id: string;
}

export interface ParsedBlock {
    readonly tree: Root;
    readonly expressions: readonly ExpressionSite[];
    readonly refs: readonly RefTag[];
}

export type ParseResult = {readonly ok: true; readonly block: ParsedBlock} | {readonly ok: false; readonly problem: SyntaxProblem};

const BINARY = new Set(["==", "!=", "===", "!==", "<", "<=", ">", ">="]);
const LOGICAL = new Set(["&&", "||"]);
const TAGS: Readonly<Record<string, ReadonlySet<string>>> = {Ref: new Set(["id"]), Image: new Set(["src", "alt"])};

const cache = new Map<string, ParseResult>();
const CACHE_LIMIT = 10_000;

/** 解析一块；`namespaces` 为空时任何命名空间名都当作合法的根（本条目的命名空间在渲染时才知道，写入时由引擎校验字段）。 */
export function parseBlock(source: string): ParseResult {
    const cached = cache.get(source);
    if (cached !== undefined) return cached;
    const result = parseUncached(source);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(source, result);
    return result;
}

function parseUncached(source: string): ParseResult {
    let tree: Root;
    try {
        tree = fromMarkdown(source, {
            extensions: [mdxjs(), gfmTable(), gfmStrikethrough(), cjkFriendlyExtension()],
            mdastExtensions: [mdxFromMarkdown(), gfmTableFromMarkdown(), gfmStrikethroughFromMarkdown()],
        });
    } catch (error) {
        const place = (error as {place?: {line?: number; column?: number; start?: {line: number; column: number}}}).place;
        const line = place?.line ?? place?.start?.line ?? 1;
        const column = place?.column ?? place?.start?.column ?? 1;
        const message = error instanceof Error ? error.message : String(error);
        // 标签或表达式到块末尾还没闭合：块不是闭合的语法单元。
        const code: SyntaxCode = /end of file|closing tag/iu.test(message) ? "cross-block" : "mdx-invalid";
        return {ok: false, problem: {code, line, column, message}};
    }
    const expressions: ExpressionSite[] = [];
    const refs: RefTag[] = [];
    let problem: SyntaxProblem | null = null;
    const fail = (code: SyntaxCode, node: {position?: {start: {line: number; column: number}}}, message: string) => {
        problem ??= {code, line: node.position?.start.line ?? 1, column: node.position?.start.column ?? 1, message};
    };

    const visit = (node: Record<string, unknown> & {type: string; position?: {start: {line: number; column: number; offset?: number}; end: {offset?: number}}}) => {
        if (problem !== null) return;
        switch (node.type) {
            case "mdxjsEsm":
                fail("forbidden-syntax", node, "import and export are not allowed");
                return;
            case "mdxFlowExpression":
            case "mdxTextExpression": {
                const site = expressionSite(source, node, fail);
                if (site !== null) expressions.push(site);
                return;
            }
            case "mdxJsxFlowElement":
            case "mdxJsxTextElement": {
                const name = node.name as string | null;
                const allowed = name === null ? undefined : TAGS[name];
                if (allowed === undefined) {
                    fail("unknown-tag", node, `tag <${String(name)}> is not allowed`);
                    return;
                }
                if (Array.isArray(node.children) && node.children.length > 0) {
                    fail("unknown-tag", node, `<${name!}> takes no children`);
                    return;
                }
                for (const attribute of node.attributes as Array<Record<string, unknown> & {type: string; name?: string; value?: unknown}>) {
                    if (attribute.type !== "mdxJsxAttribute" || attribute.name === undefined || !allowed.has(attribute.name)) {
                        fail("unknown-tag", node, `attribute ${String(attribute.name)} is not allowed on <${name!}>`);
                        return;
                    }
                    const value = attribute.value as (Record<string, unknown> & {type: string; position?: never}) | string | null | undefined;
                    if (value !== null && typeof value === "object") {
                        if (name === "Ref") {
                            fail("unknown-tag", node, "Ref id must be a literal");
                            return;
                        }
                        const site = attributeSite(source, value, fail, node);
                        if (site !== null) expressions.push(site);
                    } else if (name === "Ref" && attribute.name === "id") {
                        const start = node.position?.start.offset ?? 0;
                        const end = node.position?.end.offset ?? start;
                        refs.push({start, end, id: String(value ?? "")});
                    }
                }
                return;
            }
            default:
                for (const child of (node.children as typeof node[] | undefined) ?? []) visit(child);
        }
    };
    visit(tree as unknown as Parameters<typeof visit>[0]);
    if (problem !== null) return {ok: false, problem};
    expressions.sort((a, b) => a.start - b.start);
    return {ok: true, block: {tree, expressions, refs}};
}

type Fail = (code: SyntaxCode, node: {position?: {start: {line: number; column: number}}}, message: string) => void;

function expressionSite(source: string, node: Record<string, unknown> & {position?: {start: {offset?: number}; end: {offset?: number}}}, fail: Fail): ExpressionSite | null {
    const start = node.position?.start.offset ?? 0;
    const end = node.position?.end.offset ?? start;
    return siteFrom(source, start, end, node.data as {estree?: {body: Array<{type: string; expression?: Expression}>}} | undefined, node as never, fail);
}

function attributeSite(source: string, value: Record<string, unknown>, fail: Fail, owner: {position?: {start: {line: number; column: number}}}): ExpressionSite | null {
    // 属性值表达式的节点没有自己的位置：在属性的原文里找到花括号的起止。
    const text = value.value as string;
    const estree = (value.data as {estree?: {body: Array<{type: string; expression?: Expression; start?: number}>}} | undefined)?.estree;
    const first = estree?.body[0] as {expression?: {start?: number}} | undefined;
    const inner = first?.expression?.start;
    let start = inner === undefined ? source.indexOf(`{${text}}`) : source.lastIndexOf("{", inner);
    if (start < 0) start = source.indexOf(`{${text}}`);
    return siteFrom(source, start, start + text.length + 2, value.data as never, owner as never, fail);
}

function siteFrom(source: string, start: number, end: number, data: {estree?: {body: Array<{type: string; expression?: Expression}>}} | undefined, node: {position?: {start: {line: number; column: number}}}, fail: Fail): ExpressionSite | null {
    const inner = source.slice(start + 1, end - 1);
    const body = data?.estree?.body ?? [];
    if (body.length === 0) return {start, end, source: inner, expression: null, reference: null, references: []};
    const statement = body[0]!;
    if (body.length !== 1 || statement.type !== "ExpressionStatement" || statement.expression === undefined) {
        fail("forbidden-syntax", node, "only a single expression is allowed");
        return null;
    }
    // 先看有没有字段引用：一个都没有的多半是正文里的花括号，提示转义比报“语法不允许”有用（输出 1）。
    if (!mentionsField(statement.expression)) {
        fail("no-field-expression", node, "expression references no field; escape braces in prose as \\{");
        return null;
    }
    const references: FieldReference[] = [];
    const problem = check(statement.expression, references);
    if (problem !== null) {
        fail("forbidden-syntax", node, problem);
        return null;
    }
    const reference = statement.expression.type === "MemberExpression" ? references[0]! : null;
    return {start, end, source: inner, expression: statement.expression, reference, references};
}

/** 按节点表查一个表达式（rendering.md 输入与前置条件的表），收集字段引用；不合规则返回说明。 */
function check(node: EsNode, references: FieldReference[]): string | null {
    switch (node.type) {
        case "MemberExpression": {
            const reference = memberReference(node);
            if (reference === null) return "not a field address";
            references.push(reference);
            return null;
        }
        case "Literal":
            return typeof node.value === "string" || typeof node.value === "number" || typeof node.value === "boolean" || node.value === null ? null : "literal kind not allowed";
        case "BinaryExpression":
            if (!BINARY.has(node.operator)) return `operator ${node.operator} not allowed`;
            return check(node.left as EsNode, references) ?? check(node.right, references);
        case "LogicalExpression":
            if (!LOGICAL.has(node.operator)) return `operator ${node.operator} not allowed`;
            return check(node.left, references) ?? check(node.right, references);
        case "UnaryExpression":
            if (node.operator === "!") return check(node.argument, references);
            if (node.operator === "-" && node.argument.type === "Literal" && typeof node.argument.value === "number") return null;
            return `operator ${node.operator} not allowed`;
        case "ConditionalExpression":
            return check(node.test, references) ?? check(node.consequent, references) ?? check(node.alternate, references);
        default:
            return `${node.type} not allowed`;
    }
}

/** 表达式里任何地方有没有一条成员访问链是字段引用（不管周围的语法合不合规则）。 */
function mentionsField(node: unknown): boolean {
    if (node === null || typeof node !== "object") return false;
    const record = node as {type?: string};
    if (record.type === "MemberExpression" && memberReference(node as EsNode) !== null) return true;
    for (const [key, value] of Object.entries(node)) {
        if (key === "loc" || key === "range") continue;
        if (Array.isArray(value) ? value.some(mentionsField) : mentionsField(value)) return true;
    }
    return false;
}

/** 成员访问链 → 字段引用；根是 `entry`、`text`、命名空间，或 `ref("条目 id")`。 */
export function memberReference(node: EsNode): FieldReference | null {
    const segments: Array<{kind: "key" | "id"; value: string}> = [];
    let current: EsNode = node;
    while (current.type === "MemberExpression") {
        const property = current.property;
        if (!current.computed && property.type === "Identifier") segments.unshift({kind: "key", value: property.name});
        else if (current.computed && property.type === "Literal" && typeof property.value === "string") segments.unshift({kind: "id", value: property.value});
        else if (current.computed && property.type === "Identifier") segments.unshift({kind: "id", value: property.name});
        else return null;
        current = current.object as EsNode;
    }
    let entry: string | null = null;
    let root: string;
    if (current.type === "CallExpression") {
        if (current.callee.type !== "Identifier" || current.callee.name !== "ref" || current.arguments.length !== 1) return null;
        const argument = current.arguments[0]!;
        if (argument.type !== "Literal" || typeof argument.value !== "string") return null;
        entry = argument.value;
        const first = segments.shift();
        if (first === undefined || first.kind !== "key") return null;
        root = first.value;
    } else if (current.type === "Identifier") {
        root = current.name;
        if (root === "ref" || (RESERVED_ROOTS.has(root) && root !== "entry" && root !== "text")) return null;
    } else return null;
    let path = root;
    for (const segment of segments) path += segment.kind === "key" ? `.${segment.value}` : `[${segment.value}]`;
    const parsed = parsePath(path);
    return parsed === null ? null : {entry, path: formatPath(parsed)};
}

/** 写入时检查一块（rendering.md 输出 1）；合格返回 null。 */
export function blockProblem(source: string): SyntaxProblem | null {
    const result = parseBlock(source);
    return result.ok ? null : result.problem;
}
