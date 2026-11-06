/**
 * 求值与两种渲染（docs/specs/canon/rendering.md 输出 4–11、14）。
 *
 * 给 Agent 的带值写法在源文上按偏移量拼接：只把表达式（含花括号）换成注记、给 `<Ref>` 补上 `name`，注记以外的字
 * 与源文逐字相同，所以转义的 `\{` 与代码里的花括号原样保留（输出 8）。给作者的渲染返回语法树，表达式节点换成
 * 值、算出来的结果、占位等几种节点，由前端画。
 */

import type {Expression, Node as EsNode} from "estree";
import type {Root} from "mdast";

import type {ComponentRegistry} from "../components/registry";
import type {ChapterOrder} from "../core/position";
import type {ReadPosition} from "../core/schema";
import type {Engine, EntryView, IncompleteMark, Mode} from "../engine/types";
import {parseBlock, type ExpressionSite, type FieldReference, type SyntaxProblem} from "./syntax";

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

/** 给作者看的显示文字：数加千位分隔，未知写“未知”（输出 7）。 */
export function displayText(value: unknown): string {
    if (value === null || value === undefined) return "未知";
    if (typeof value === "number") return value.toLocaleString("en-US", {maximumFractionDigits: 4});
    if (typeof value === "boolean") return value ? "是" : "否";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map((item) => (item as {label?: string}).label ?? "").join("、");
    if (typeof value === "object" && "说明" in (value as object)) return String((value as {说明?: unknown}).说明 ?? "");
    return JSON.stringify(value);
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

/** 给作者的一块：语法树里的表达式节点换成 canon 节点，只含注释的表达式去掉（输出 7）。 */
export function renderBlockForAuthor(id: string, source: string, context: RenderContext): AuthorBlock {
    const parsed = parseBlock(source);
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

/** 给 Agent 的一块：带值写法（输出 8、9、14）。 */
/** 纯文字的一块（给写手的文字用，不回写）。`references` 是这一块引到的别的条目：调用方据此判断这段文字能不能给。 */
export interface PlainBlock {
    readonly id: string;
    readonly text: string;
    readonly references: readonly string[];
}

export function renderBlockPlain(id: string, source: string, context: RenderContext): PlainBlock {
    const parsed = parseBlock(source);
    if (!parsed.ok) return {id, text: source, references: []};
    const references = new Set<string>();
    const splices: {start: number; end: number; text: string}[] = [];
    for (const site of parsed.block.expressions) {
        for (const reference of site.references) if (reference.entry !== null) references.add(reference.entry);
        if (site.expression === null) {
            splices.push({start: site.start, end: site.end, text: ""});
            continue;
        }
        const result = site.reference !== null ? context.resolve(site.reference) : evaluate(site.expression, site.references, context.resolve);
        const unavailable = result.unavailable !== undefined && (result.value ?? null) === null;
        splices.push({start: site.start, end: site.end, text: unavailable ? `（${String(result.unavailable)}）` : displayText(result.value)});
    }
    for (const ref of parsed.block.refs) {
        references.add(ref.id);
        splices.push({start: ref.start, end: ref.end, text: context.entryName(ref.id) ?? "已删除的条目"});
    }
    splices.sort((a, b) => a.start - b.start);
    let text = "";
    let cursor = 0;
    for (const splice of splices) {
        text += source.slice(cursor, splice.start) + splice.text;
        cursor = splice.end;
    }
    return {id, text: text + source.slice(cursor), references: [...references]};
}

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
