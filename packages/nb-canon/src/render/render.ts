/**
 * 求值与三种渲染（docs/specs/canon/rendering.md 输出 4–11、14、15）。
 *
 * 给 Agent 的带值写法在源文上按偏移量拼接：只把表达式（含花括号）换成注记、给 `<Ref>` 补上 `name`，注记以外的字
 * 与源文逐字相同，所以转义的 `\{` 与代码里的花括号原样保留（输出 8）。给作者的渲染返回语法树，表达式节点换成
 * 值、算出来的结果、占位等几种节点，由前端画。纯文字的渲染同样按偏移量拼接，另外交出“读了谁、写了谁的名字、
 * 哪里写不干净”，由调用方决定给不给（输出 15）。
 */

import type {Expression, Node as EsNode} from "estree";
import type {Root} from "mdast";

import type {ComponentRegistry} from "../components/registry";
import {parsePath} from "../core/address";
import {displayText} from "../core/display";

export {displayText};
import type {ChapterOrder} from "../core/position";
import type {ReadPosition} from "../core/schema";
import type {Engine, EntryView, IncompleteMark, Mode} from "../engine/types";
import {parseBlock, type ExpressionSite, type FieldReference, type ParseResult, type SyntaxProblem} from "./syntax";

export interface Resolved {
    readonly value: unknown;
    readonly incomplete?: IncompleteMark;
    /** 读不到时的原因（输出 6）。 */
    readonly unavailable?: string;
    readonly label?: string;
    readonly field?: string;
}

export type Resolve = (reference: FieldReference) => Resolved;

/** 求值结果：值为 null 表示未知；`incomplete`、`unavailable` 是依赖里有不完整、读不到的字段。 */
export interface Evaluated {
    readonly value: unknown;
    readonly incomplete: IncompleteMark | undefined;
    readonly unavailable: string | undefined;
}

/**
 * 按读取位置从引擎取值；同一次渲染里每个条目只读一次。`hideUpcoming` 时不看“之后才启用的命名空间”（带视图令牌的渲染：
 * 那是上限之后的事，canon.project 输出 24）。
 */
export function resolverFor(engine: Engine, registry: ComponentRegistry, order: ChapterOrder, self: string, position: ReadPosition, mode: Mode, hideUpcoming = false): Resolve {
    const views = new Map<string, EntryView | null | "chapter-not-found">();
    const viewOf = (id: string) => {
        if (!views.has(id)) {
            const view = engine.entry(id, position, mode);
            views.set(id, hideUpcoming && view !== null && view !== "chapter-not-found" ? {...view, upcoming: []} : view);
        }
        return views.get(id)!;
    };
    return (reference) => {
        const view = viewOf(reference.entry ?? self);
        if (view === null || view === "chapter-not-found") return {value: null, unavailable: "条目不存在"};
        if (view.deleted) return {value: null, unavailable: "已删除"};
        if (!view.appeared && reference.entry !== null) return {value: null, unavailable: "尚未出场"};
        const path = reference.path;
        if (path.startsWith("entry.")) return {value: structuredClone(view[path.slice(6) as "name" | "aliases" | "summary"])};
        if (path.startsWith("text[")) {
            const block = view.text.find((candidate) => `text[${candidate.id}]` === path);
            return block === undefined ? {value: null, unavailable: "没有这一块"} : {value: block.source};
        }
        const dot = path.indexOf(".");
        const namespace = path.slice(0, dot);
        const rest = path.slice(dot + 1);
        const fieldId = rest.split("[")[0]!;
        const nsView = view.namespaces[namespace];
        if (nsView === undefined) {
            const upcoming = view.upcoming.find((candidate) => candidate.namespace === namespace);
            if (upcoming !== undefined && upcoming.from.kind === "chapter") {
                const label = registry.byNamespace(namespace)?.label ?? namespace;
                const index = order.index(upcoming.from.chapter);
                return {value: null, unavailable: `${label}第 ${String((index ?? 0) + 1)} 章起生效`};
            }
            return {value: null, unavailable: "未启用"};
        }
        // 类型不在：字段是什么都不知道，只能占位（components.md 输出 12）。版本对不上时值照常给（输出 11）。
        if (nsView.readOnly === "component-unknown") return {value: null, unavailable: "类型不可用"};
        const field = nsView.fields[fieldId];
        if (field === undefined) return {value: null, unavailable: "没有这个字段"};
        const label = field.label ?? fieldId;
        const base = {...(field.incomplete === undefined ? {} : {incomplete: field.incomplete}), label, field: fieldId};
        const element = /\[([^\]]+)\](?:\.(.+))?$/u.exec(rest);
        if (element === null) return {value: structuredClone(field.value), ...base};
        const item = Array.isArray(field.value) ? (field.value as Array<Record<string, unknown>>).find((candidate) => candidate.id === element[1]) : undefined;
        if (item === undefined) return {value: null, unavailable: "没有这一项", ...base};
        return {value: structuredClone(element[2] === undefined ? item : (item[element[2]] ?? null)), ...base};
    };
}

/** 三值逻辑的求值（输出 5）。 */
export function evaluate(expression: Expression, references: readonly FieldReference[], resolve: Resolve): Evaluated {
    let incomplete: IncompleteMark | undefined;
    let unavailable: string | undefined;
    let index = 0;
    const UNKNOWN = null;
    const visit = (node: EsNode): unknown => {
        switch (node.type) {
            case "MemberExpression": {
                const resolved = resolve(references[index++]!);
                incomplete ??= resolved.incomplete;
                unavailable ??= resolved.unavailable;
                return resolved.unavailable === undefined ? (resolved.value ?? UNKNOWN) : UNKNOWN;
            }
            case "Literal":
                return node.value;
            case "UnaryExpression": {
                const value = visit(node.argument);
                if (node.operator === "-") return -(value as number);
                return value === UNKNOWN ? UNKNOWN : !value;
            }
            case "BinaryExpression": {
                const left = visit(node.left as EsNode);
                const right = visit(node.right);
                if (left === UNKNOWN || right === UNKNOWN) return UNKNOWN;
                switch (node.operator) {
                    case "==":
                    case "===":
                        return left === right;
                    case "!=":
                    case "!==":
                        return left !== right;
                    default: {
                        const comparable = (typeof left === "number" && typeof right === "number") || (typeof left === "string" && typeof right === "string");
                        if (!comparable) return UNKNOWN;
                        const a = left as number;
                        const b = right as number;
                        return node.operator === "<" ? a < b : node.operator === "<=" ? a <= b : node.operator === ">" ? a > b : a >= b;
                    }
                }
            }
            case "LogicalExpression": {
                const left = visit(node.left);
                const right = visit(node.right);
                if (node.operator === "&&") {
                    if (left !== UNKNOWN && !left) return left;
                    if (left === UNKNOWN) return right !== UNKNOWN && !right ? right : UNKNOWN;
                    return right;
                }
                if (left !== UNKNOWN && left) return left;
                if (left === UNKNOWN) return right !== UNKNOWN && right ? right : UNKNOWN;
                return right;
            }
            case "ConditionalExpression": {
                const test = visit(node.test);
                // 两支都要求值，保证字段引用的顺序与收集时一致；判断未知时整个条件未知，不当成假。
                const consequent = visit(node.consequent);
                const alternate = visit(node.alternate);
                if (test === UNKNOWN) return UNKNOWN;
                return test ? consequent : alternate;
            }
            default:
                return UNKNOWN;
        }
    };
    const value = visit(expression);
    return {value: value ?? null, incomplete, unavailable};
}


export type AuthorNode =
    | {readonly type: "canonValue"; readonly path: string; readonly entry: string | null; readonly label?: string; readonly raw: unknown; readonly display: string; readonly unknown?: true; readonly incomplete?: IncompleteMark}
    | {readonly type: "canonComputed"; readonly source: string; readonly raw: unknown; readonly display: string; readonly incomplete?: IncompleteMark}
    | {readonly type: "canonPlaceholder"; readonly reason: string}
    | {readonly type: "canonRef"; readonly id: string; readonly name: string; readonly deleted: boolean}
    | {readonly type: "canonImage"; readonly path: string | null; readonly caption: string};

export type AuthorBlock = {readonly id: string; readonly tree: Root} | {readonly id: string; readonly error: SyntaxProblem; readonly text: string};
export type AgentBlock = {readonly id: string; readonly text: string; readonly error?: SyntaxProblem};

export interface RenderContext {
    readonly resolve: Resolve;
    /** 条目引用在这个位置的名字；删除或不存在时为 null。 */
    readonly entryName: (id: string) => string | null;
}

/**
 * 给作者的一块：语法树里的表达式节点换成 canon 节点，只含注释的表达式去掉（输出 7）。`parse` 缺省是带缓存的解析；渲染没存
 * 下来的源文字时换成不进缓存的（`parseDraft`）。
 */
export function renderBlockForAuthor(id: string, source: string, context: RenderContext, parse: (source: string) => ParseResult = parseBlock): AuthorBlock {
    const parsed = parse(source);
    if (!parsed.ok) return {id, error: parsed.problem, text: source};
    const sites = new Map(parsed.block.expressions.map((site) => [site.start, site]));
    const tree = structuredClone(parsed.block.tree);
    const replace = (node: Record<string, unknown> & {type: string; children?: unknown[]; position?: {start: {offset?: number}}}): unknown => {
        if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
            const site = sites.get(node.position?.start.offset ?? -1);
            return site === undefined || site.expression === null ? null : authorNode(site, context);
        }
        if ((node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") && node.name === "Ref") {
            const refId = String((node.attributes as Array<{name: string; value: unknown}>).find((attribute) => attribute.name === "id")?.value ?? "");
            const name = context.entryName(refId);
            return {type: "canonRef", id: refId, name: name ?? "已删除的条目", deleted: name === null};
        }
        if ((node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") && node.name === "Image") {
            const attributes = node.attributes as Array<{name: string; value: unknown}>;
            const src = attributes.find((attribute) => attribute.name === "src")?.value;
            const alt = attributes.find((attribute) => attribute.name === "alt")?.value;
            let path: string | null = typeof src === "string" ? src : null;
            if (src !== null && typeof src === "object") {
                const site = parsed.block.expressions.find((candidate) => candidate.source === (src as {value: string}).value);
                const result = site?.expression === null || site === undefined ? null : evaluate(site.expression, site.references, context.resolve).value;
                path = typeof result === "string" ? result : null;
            }
            return {type: "canonImage", path, caption: typeof alt === "string" ? alt : ""};
        }
        if (Array.isArray(node.children)) node.children = node.children.map((child) => replace(child as never)).filter((child) => child !== null);
        return node;
    };
    return {id, tree: replace(tree as never) as Root};
}

function authorNode(site: ExpressionSite, {resolve, entryName}: RenderContext): AuthorNode {
    if (site.reference !== null) {
        const resolved = resolve(site.reference);
        if (resolved.unavailable !== undefined) return {type: "canonPlaceholder", reason: resolved.unavailable};
        // 引用字段的值是 `{ref: 条目 id}`：显示当时的名字，id 不出现在显示文字里（输出 7）。
        const referred = resolved.value !== null && typeof resolved.value === "object" && !Array.isArray(resolved.value) ? (resolved.value as {ref?: unknown}).ref : undefined;
        if (typeof referred === "string") {
            const name = entryName(referred);
            return {type: "canonRef", id: referred, name: name ?? "已删除的条目", deleted: name === null};
        }
        if (resolved.value !== null && typeof resolved.value === "object" && !Array.isArray(resolved.value) && "图片" in (resolved.value as object)) {
            const image = resolved.value as {图片: string; 说明?: string};
            return {type: "canonImage", path: image.图片, caption: image.说明 ?? ""};
        }
        return {
            type: "canonValue",
            path: site.reference.path,
            entry: site.reference.entry,
            ...(resolved.label === undefined ? {} : {label: resolved.label}),
            raw: resolved.value,
            display: displayText(resolved.value),
            ...(resolved.value === null ? {unknown: true as const} : {}),
            ...(resolved.incomplete === undefined ? {} : {incomplete: resolved.incomplete}),
        };
    }
    const result = evaluate(site.expression!, site.references, resolve);
    if (result.unavailable !== undefined && result.value === null) return {type: "canonPlaceholder", reason: result.unavailable};
    return {type: "canonComputed", source: site.source.trim(), raw: result.value, display: displayText(result.value), ...(result.incomplete === undefined ? {} : {incomplete: result.incomplete})};
}

/** 纯文字的一块哪里写不干净（rendering.md 输出 15）：调用方据此决定这段文字能不能给。 */
export type PlainProblem = "syntax" | "raw-value" | "quoted-block" | "unavailable";

/**
 * 纯文字的一块（给不回写的读者，例如写手的简报；rendering.md 输出 15）。`reads` 与 `mentions` 是调用方判断“这段文字能不能给”
 * 的依据：前者是表达式读了谁的数据（写了 `ref(...)` 的条目，含本条目自己；路径里以引用为键的行键；不写 `ref` 的本条目字段不算），
 * 后者是文字里写了谁的名字（含写到本条目自己的 `<Ref>`）。本条目自己的数据给不给由调用方决定。
 */
export interface PlainBlock {
    readonly id: string;
    readonly text: string;
    readonly reads: readonly string[];
    readonly mentions: readonly string[];
    readonly problems: readonly PlainProblem[];
}

/** 纯文字渲染多要一样：判断一个 id 是不是条目（以引用为键的列表的行键、行的 id）。 */
export interface PlainContext extends RenderContext {
    readonly isEntry: (id: string) => boolean;
}

const DELETED_NAME = "已删除的条目";

/**
 * 一个值的纯文字写法。只有字符串、数、真假、引用、图片、字符串列表、带 id 的列表有写法；别的（例如取出的单个列表行）
 * 记 `raw-value`，文字留空：调用方见到问题就不该给这一块，留空免得把 JSON 写出去。
 */
function plainValue(value: unknown, context: PlainContext, mentions: Set<string>, problems: Set<PlainProblem>): string {
    if (value === null || value === undefined || typeof value !== "object") return displayText(value);
    const name = (id: string) => {
        mentions.add(id);
        return context.entryName(id) ?? DELETED_NAME;
    };
    if (Array.isArray(value)) {
        if (value.every((item) => typeof item === "string")) return value.join("、");
        const rows = value.map((item) => {
            const row = item as {id?: unknown; label?: unknown} | null;
            if (row === null || typeof row !== "object" || typeof row.id !== "string") return null;
            // 以引用为键的行：内核读取时补的 label 是被引条目的本名，名字一律经回调写（调用方可能要改写它）。
            if (context.isEntry(row.id)) return name(row.id);
            return typeof row.label === "string" ? row.label : null;
        });
        if (rows.some((row) => row === null)) {
            problems.add("raw-value");
            return "";
        }
        return rows.join("、");
    }
    const ref = (value as {ref?: unknown}).ref;
    if (typeof ref === "string") return name(ref);
    if ("图片" in value) return String((value as {说明?: unknown}).说明 ?? "");
    problems.add("raw-value");
    return "";
}

export function renderBlockPlain(id: string, source: string, context: PlainContext): PlainBlock {
    const parsed = parseBlock(source);
    if (!parsed.ok) return {id, text: source, reads: [], mentions: [], problems: ["syntax"]};
    const reads = new Set<string>();
    const mentions = new Set<string>();
    const problems = new Set<PlainProblem>();
    const read = (reference: FieldReference) => {
        if (reference.entry !== null) reads.add(reference.entry);
        // 按条目选出的一行（`att.态度["e1"].称呼`）读的是关于那个条目的数据，本条目自己的字段也一样。
        const path = parsePath(reference.path);
        if (path?.root === "namespace" && path.element !== undefined && context.isEntry(path.element)) reads.add(path.element);
        if (path?.root === "text") problems.add("quoted-block");
    };
    const splices: {start: number; end: number; text: string}[] = [];
    // 图片标签整个换成说明；标签属性里的表达式照记读取，但不再拼进文字。
    for (const image of parsed.block.images) {
        if (image.altExpression) problems.add("raw-value");
        splices.push({start: image.start, end: image.end, text: image.alt ?? ""});
    }
    const inImage = (site: ExpressionSite) => parsed.block.images.some((image) => site.start >= image.start && site.end <= image.end);
    for (const site of parsed.block.expressions) {
        for (const reference of site.references) read(reference);
        if (inImage(site)) continue;
        // 引另一块原文：那是 MDX 源文（含条目 id 与表达式），这一处不写文字。
        if (site.expression === null || site.references.some((reference) => reference.path.startsWith("text["))) {
            splices.push({start: site.start, end: site.end, text: ""});
            continue;
        }
        const result = site.reference !== null ? context.resolve(site.reference) : evaluate(site.expression, site.references, context.resolve);
        if (result.unavailable !== undefined && (result.value ?? null) === null) {
            problems.add("unavailable");
            splices.push({start: site.start, end: site.end, text: ""});
            continue;
        }
        splices.push({start: site.start, end: site.end, text: plainValue(result.value, context, mentions, problems)});
    }
    for (const ref of parsed.block.refs) {
        mentions.add(ref.id);
        splices.push({start: ref.start, end: ref.end, text: context.entryName(ref.id) ?? DELETED_NAME});
    }
    splices.sort((a, b) => a.start - b.start);
    let text = "";
    let cursor = 0;
    for (const splice of splices) {
        text += source.slice(cursor, splice.start) + splice.text;
        cursor = splice.end;
    }
    return {id, text: text + source.slice(cursor), reads: [...reads], mentions: [...mentions], problems: [...problems]};
}

/** 给 Agent 的一块：带值写法（输出 8、9、14）。 */
export function renderBlockForAgent(id: string, source: string, context: RenderContext): AgentBlock {
    const parsed = parseBlock(source);
    if (!parsed.ok) return {id, text: source, error: parsed.problem};
    type Splice = {start: number; end: number; text: string};
    const splices: Splice[] = [];
    for (const site of parsed.block.expressions) {
        if (site.expression === null) continue;
        splices.push({start: site.start, end: site.end, text: annotation(site, context.resolve)});
    }
    for (const ref of parsed.block.refs) {
        const name = context.entryName(ref.id) ?? "已删除的条目";
        splices.push({start: ref.start, end: ref.end, text: `<Ref id=${JSON.stringify(ref.id)} name=${JSON.stringify(name)} />`});
    }
    splices.sort((a, b) => a.start - b.start);
    let text = "";
    let cursor = 0;
    for (const splice of splices) {
        text += source.slice(cursor, splice.start) + splice.text;
        cursor = splice.end;
    }
    return {id, text: text + source.slice(cursor)};
}

/** 表达式原文以行注释结尾时，注记的 `=` 或 `->` 要另起一行，否则落进注释、交回时扫不出来。 */
const lineCommentBreak = (source: string): string => (/\/\/[^\n]*$/u.test(source) ? "\n" : "");

/** 一个表达式的注记：`{地址 = JSON}` 或 `{表达式原文 -> JSON}`，装饰在 ` # ` 之后（输出 8、9、10）。 */
export function annotation(site: ExpressionSite, resolve: Resolve): string {
    const source = site.source.trim();
    const decorations: string[] = [];
    if (site.reference !== null) {
        const resolved = resolve(site.reference);
        if (resolved.label !== undefined && resolved.field !== undefined && resolved.label !== resolved.field && !site.reference.path.includes("[")) decorations.push(`显示名：${resolved.label}`);
        if (resolved.incomplete !== undefined) decorations.push(`不完整：${resolved.incomplete.change} ${resolved.incomplete.reason}`);
        if (resolved.unavailable !== undefined) decorations.push(`不可用：${resolved.unavailable}`);
        const value = resolved.unavailable === undefined ? resolved.value : null;
        return `{${source}${lineCommentBreak(source)} = ${JSON.stringify(value ?? null)}${decorations.length === 0 ? "" : ` # ${decorations.join("；")}`}}`;
    }
    const result = evaluate(site.expression!, site.references, resolve);
    if (result.incomplete !== undefined) decorations.push(`不完整：${result.incomplete.change} ${result.incomplete.reason}`);
    if (result.unavailable !== undefined) decorations.push(`不可用：${result.unavailable}`);
    return `{${source}${lineCommentBreak(source)} -> ${JSON.stringify(result.value ?? null)}${decorations.length === 0 ? "" : ` # ${decorations.join("；")}`}}`;
}
