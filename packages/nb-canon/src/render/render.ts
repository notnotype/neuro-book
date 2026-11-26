/**
 * 求值与三种渲染（docs/specs/canon/rendering.md 输出 4 到 9、15、16）。
 *
 * - 给作者：源文加值表（输出 7）。值表每项对应一个活的标签，按起点排，带标签名与起点；前端用同一份文法读源文，按名字与起点对上。
 * - 给 Agent：带值写法（输出 8、9），只给活的标签加装饰，别的字与源文逐字相同（`grammar` 的 `decorateEntryText`）。
 * - 纯文字（输出 15）：按源文拼接，取值换成值的文字、条件留生效的那一支；`reads`、`mentions` 先按全部标签静态地收（字面的也算），
 *   再并上求值时从值里得到的引用，代码里、转义的标签也吞不掉依赖。
 */

import type {ComponentRegistry} from "../components/registry";
import {parsePath} from "../core/address";
import {displayText} from "../core/display";

export {displayText};
import type {ChapterOrder} from "../core/position";
import type {ReadPosition} from "../core/schema";
import type {Engine, EntryView, IncompleteMark, Mode} from "../engine/types";
import {agentJson, decorateEntryText, evaluate as evaluateExpression, type Decoration, type EntryTag, type FieldReference, type ParsedExpression} from "../grammar/index";
import {analyzeBlock, type BlockAnalysis, type Condition, type SyntaxProblem, type TagMeaning} from "./syntax";

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

/** 三值逻辑的求值（输出 5）。 */
export function evaluate(expression: ParsedExpression, resolve: Resolve): Evaluated {
    return evaluateExpression<IncompleteMark>(expression, resolve);
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

export interface RenderContext {
    readonly resolve: Resolve;
    /** 条目引用在这个位置的名字；删除或不存在时为 null。 */
    readonly entryName: (id: string) => string | null;
}

const DELETED_NAME = "已删除的条目";

/** 值表的一项（输出 7）：`tag` 与 `start` 是标签名与它在源文里的起点。 */
export type AuthorValue =
    | {
          readonly tag: "V";
          readonly start: number;
          /** `of` 的地址与条目；`expr` 的是式子原文。 */
          readonly path?: string;
          readonly entry?: string | null;
          readonly expr?: string;
          readonly label?: string;
          readonly raw: unknown;
          readonly display: string;
          readonly unknown?: true;
          readonly incomplete?: IncompleteMark;
          readonly unavailable?: string;
          /** 值是条目引用时：被引的条目与它当时的名字。 */
          readonly ref?: {readonly id: string; readonly name: string; readonly deleted: boolean};
          /** 值是图片时。 */
          readonly image?: {readonly path: string; readonly caption: string};
      }
    | {readonly tag: "If" | "ElseIf"; readonly start: number; readonly result: boolean | null; readonly incomplete?: IncompleteMark; readonly unavailable?: string; /** 在 `If` 上：生效的那一支（0 是 `If` 自己，按支的先后数，`Else` 是最后一支）；判断未知或没有一支生效时为 null。 */ readonly taken?: number | null}
    | {readonly tag: "Ref"; readonly start: number; readonly id: string; readonly name: string; readonly deleted: boolean}
    | {readonly tag: "Image"; readonly start: number; readonly path: string | null; readonly caption: string}
    | {readonly tag: string; readonly start: number; readonly needsPlugin: true};

export type AuthorBlock = {readonly id: string; readonly source: string; readonly values: readonly AuthorValue[]} | {readonly id: string; readonly error: SyntaxProblem; readonly text: string};
export type AgentBlock = {readonly id: string; readonly text: string; readonly error?: SyntaxProblem};

const truthy = (value: unknown): boolean | null => (value === null || value === undefined ? null : Boolean(value));

/** 一个条件的各个判断与生效的支：判断都求值；第一个真的生效，在它之前有未知的就都不生效（同未知的值）。 */
function decide(analysis: BlockAnalysis, condition: Condition, resolve: Resolve): {readonly results: ReadonlyMap<number, Evaluated & {readonly result: boolean | null}>; readonly taken: number | null} {
    const results = new Map<number, Evaluated & {readonly result: boolean | null}>();
    let taken: number | null = null;
    let decided = false;
    condition.branches.forEach((branch, index) => {
        const meaning = analysis.meanings[branch.head] as TagMeaning;
        if (meaning.kind !== "test") {
            // `Else`：前面都是假时生效。
            if (!decided) taken = index;
            decided = true;
            return;
        }
        const evaluated = evaluate(meaning.test, resolve);
        const result = truthy(evaluated.value);
        results.set(branch.head, {...evaluated, result});
        if (decided) return;
        if (result === null) decided = true;
        else if (result) {
            taken = index;
            decided = true;
        }
    });
    return {results, taken};
}

function valueItem(tag: EntryTag, meaning: Extract<TagMeaning, {kind: "value" | "computed"}>, {resolve, entryName}: RenderContext): AuthorValue {
    const resolved = meaning.kind === "value" ? resolve(meaning.of) : evaluate(meaning.expr, resolve);
    const value = resolved.unavailable !== undefined && meaning.kind === "value" ? null : (resolved.value ?? null);
    const where = meaning.kind === "value" ? {path: meaning.of.path, entry: meaning.of.entry} : {expr: meaning.source};
    const label = meaning.kind === "value" ? (resolved as Resolved).label : undefined;
    const referred = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as {ref?: unknown}).ref : undefined;
    const image = value !== null && typeof value === "object" && !Array.isArray(value) && "图片" in (value as object) ? (value as {图片: string; 说明?: string}) : null;
    let display = displayText(value);
    let ref: {id: string; name: string; deleted: boolean} | undefined;
    if (typeof referred === "string") {
        const name = entryName(referred);
        ref = {id: referred, name: name ?? DELETED_NAME, deleted: name === null};
        display = ref.name;
    }
    return {
        tag: "V",
        start: tag.start,
        ...where,
        ...(label === undefined ? {} : {label}),
        raw: value,
        display,
        ...(value === null ? {unknown: true as const} : {}),
        ...(resolved.incomplete === undefined ? {} : {incomplete: resolved.incomplete}),
        ...(resolved.unavailable === undefined ? {} : {unavailable: resolved.unavailable}),
        ...(ref === undefined ? {} : {ref}),
        ...(image === null ? {} : {image: {path: image.图片, caption: image.说明 ?? ""}}),
    };
}

/**
 * 给作者的一块（输出 7）：源文加值表。`analyze` 缺省是带缓存的分析；渲染没存下来的源文字时换成不进缓存的（`analyzeDraft`）。
 */
export function renderBlockForAuthor(id: string, source: string, context: RenderContext, analyze: (source: string) => BlockAnalysis = analyzeBlock): AuthorBlock {
    const analysis = analyze(source);
    if (analysis.error !== null) return {id, error: analysis.error, text: source};
    const values: AuthorValue[] = [];
    const decided = new Map(analysis.conditions.map((condition) => [condition.open, decide(analysis, condition, context.resolve)]));
    const resultOf = (head: number) => [...decided.values()].find((entry) => entry.results.has(head))?.results.get(head);
    analysis.parsed.tags.forEach((tag, index) => {
        if (tag.place !== "live") return;
        const meaning = analysis.meanings[index] as TagMeaning;
        switch (meaning.kind) {
            case "value":
            case "computed":
                values.push(valueItem(tag, meaning, context));
                return;
            case "test": {
                const result = resultOf(index);
                const condition = decided.get(index);
                values.push({
                    tag: tag.name as "If" | "ElseIf",
                    start: tag.start,
                    result: result?.result ?? null,
                    ...(result?.incomplete === undefined ? {} : {incomplete: result.incomplete}),
                    ...(result?.unavailable === undefined ? {} : {unavailable: result.unavailable}),
                    ...(condition === undefined ? {} : {taken: condition.taken}),
                });
                return;
            }
            case "ref": {
                const name = context.entryName(meaning.id);
                values.push({tag: "Ref", start: tag.start, id: meaning.id, name: name ?? DELETED_NAME, deleted: name === null});
                return;
            }
            case "image": {
                let path = meaning.src;
                if (meaning.of !== null) {
                    const resolved = context.resolve(meaning.of);
                    const value = resolved.value as {图片?: unknown} | null;
                    path = value !== null && typeof value === "object" && typeof value.图片 === "string" ? value.图片 : null;
                }
                values.push({tag: "Image", start: tag.start, path, caption: meaning.alt});
                return;
            }
            case "unregistered":
                values.push({tag: tag.name, start: tag.start, needsPlugin: true});
                return;
            default:
                return;
        }
    });
    return {id, source, values};
}

/** 一个取值的装饰（输出 8、9）：值写成 JSON，显示名、不完整、读不到写成属性。 */
function valueDecoration(meaning: Extract<TagMeaning, {kind: "value" | "computed"}>, resolve: Resolve): Decoration {
    const resolved = meaning.kind === "value" ? resolve(meaning.of) : evaluate(meaning.expr, resolve);
    const attributes: Array<readonly [string, string]> = [];
    if (meaning.kind === "value") {
        const {label, field} = resolved as Resolved;
        if (label !== undefined && field !== undefined && label !== field && !meaning.of.path.includes("[")) attributes.push(["label", label]);
    }
    if (resolved.incomplete !== undefined) attributes.push(["incomplete", `${resolved.incomplete.change} ${resolved.incomplete.reason}`]);
    if (resolved.unavailable !== undefined) attributes.push(["unavailable", resolved.unavailable]);
    const value = resolved.unavailable !== undefined && meaning.kind === "value" ? null : (resolved.value ?? null);
    return {attributes, content: agentJson(value)};
}

/** 给 Agent 的一块：带值写法（输出 8、9、14）。 */
export function renderBlockForAgent(id: string, source: string, context: RenderContext): AgentBlock {
    const analysis = analyzeBlock(source);
    if (analysis.error !== null) return {id, text: source, error: analysis.error};
    const results = new Map<number, boolean | null>();
    for (const condition of analysis.conditions) for (const [head, result] of decide(analysis, condition, context.resolve).results) results.set(head, result.result);
    const text = decorateEntryText(analysis.parsed, (tag) => {
        const meaning = analysis.meanings[tag.index] as TagMeaning;
        switch (meaning.kind) {
            case "value":
            case "computed":
                return valueDecoration(meaning, context.resolve);
            case "test":
                return {attributes: [["value", JSON.stringify(results.get(tag.index) ?? null)]]};
            case "ref":
                return {attributes: [["name", context.entryName(meaning.id) ?? DELETED_NAME]]};
            case "image": {
                if (meaning.of === null) return null;
                const value = context.resolve(meaning.of).value as {图片?: unknown} | null;
                return value !== null && typeof value === "object" && typeof value.图片 === "string" ? {attributes: [["path", value.图片]]} : null;
            }
            default:
                return null;
        }
    });
    return {id, text};
}

/** 纯文字的一块哪里写不干净（rendering.md 输出 15）：调用方据此决定这段文字能不能给。 */
export type PlainProblem = "syntax" | "raw-value" | "quoted-block" | "unavailable" | "unknown-tag";

/**
 * 纯文字的一块（给不回写的读者，例如写手的简报；rendering.md 输出 15）。`reads` 与 `mentions` 是调用方判断“这段文字能不能给”
 * 的依据：前者是读了谁的数据（明写了条目的引用，含本条目自己；路径里以引用为键的行键；不写条目的本条目字段不算），后者是文字里写了
 * 谁的名字。本条目自己的数据给不给由调用方决定。
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

/** 按全部标签静态地收集读了谁、写了谁的名字（输出 15）：活的与字面的都算，条件的判断与各支都算。 */
function collectStatic(analysis: BlockAnalysis, context: PlainContext, reads: Set<string>, mentions: Set<string>, problems: Set<PlainProblem>): void {
    const read = (reference: FieldReference) => {
        if (reference.entry !== null) reads.add(reference.entry);
        // 按条目选出的一行（`att.态度[e1].称呼`）读的是关于那个条目的数据，本条目自己的字段也一样。
        const path = parsePath(reference.path);
        if (path?.root === "namespace" && path.element !== undefined && context.isEntry(path.element)) reads.add(path.element);
        if (path?.root === "text") problems.add("quoted-block");
    };
    analysis.parsed.tags.forEach((tag, index) => {
        const meaning = analysis.meanings[index] as TagMeaning;
        if (meaning.kind === "value") read(meaning.of);
        else if (meaning.kind === "computed") meaning.expr.references.forEach(read);
        else if (meaning.kind === "test") meaning.test.references.forEach(read);
        else if (meaning.kind === "ref") mentions.add(meaning.id);
        else if (meaning.kind === "image" && meaning.of !== null) read(meaning.of);
        // 字面的标签照原文写会把条目 id 与写法给读者；写坏的内置标签读不全它的属性（输出 15）。
        if (tag.place === "code" || tag.place === "escaped") problems.add("syntax");
        if (tag.kind === "malformed" && (tag.attributeLike || tag.closing) && ["V", "If", "ElseIf", "Else", "Ref", "Image"].includes(tag.name)) problems.add("syntax");
        if (tag.place === "live" && meaning.kind === "unregistered") problems.add("unknown-tag");
    });
}

export function renderBlockPlain(id: string, source: string, context: PlainContext): PlainBlock {
    const analysis = analyzeBlock(source);
    if (analysis.error !== null) return {id, text: source, reads: [], mentions: [], problems: ["syntax"]};
    const reads = new Set<string>();
    const mentions = new Set<string>();
    const problems = new Set<PlainProblem>();
    collectStatic(analysis, context, reads, mentions, problems);
    const splices: Array<{start: number; end: number; text: string}> = [];
    // 条件：只留生效的那一支；判断未知时整个条件写“未知”，没有一支生效时不写。被去掉的范围里的标签不写文字。
    const removed: Array<{start: number; end: number}> = [];
    for (const condition of analysis.conditions) {
        const open = analysis.parsed.tags[condition.open] as EntryTag;
        const close = analysis.parsed.tags[condition.close] as EntryTag;
        const {taken} = decide(analysis, condition, context.resolve);
        const branch = taken === null ? undefined : condition.branches[taken];
        if (branch === undefined) {
            const unknown = condition.branches.some((candidate) => {
                const meaning = analysis.meanings[candidate.head] as TagMeaning;
                return meaning.kind === "test" && truthy(evaluate(meaning.test, context.resolve).value) === null;
            });
            splices.push({start: open.start, end: close.end, text: unknown ? displayText(null) : ""});
            removed.push({start: open.start, end: close.end});
            continue;
        }
        splices.push({start: open.start, end: branch.from, text: ""}, {start: branch.to, end: close.end, text: ""});
        removed.push({start: open.start, end: branch.from}, {start: branch.to, end: close.end});
    }
    const inRemoved = (tag: EntryTag) => removed.some((range) => tag.start >= range.start && tag.end <= range.end);
    analysis.parsed.tags.forEach((tag, index) => {
        if (tag.place !== "live" || inRemoved(tag)) return;
        const meaning = analysis.meanings[index] as TagMeaning;
        let text: string | null = null;
        switch (meaning.kind) {
            case "value":
            case "computed": {
                // 引另一块原文：那是条目文字的源文（含条目 id 与标签），这一处不写文字。
                const quotes = meaning.kind === "value" ? meaning.of.path.startsWith("text[") : meaning.expr.references.some((reference) => reference.path.startsWith("text["));
                const result = meaning.kind === "value" ? context.resolve(meaning.of) : evaluate(meaning.expr, context.resolve);
                if (quotes) text = "";
                else if (result.unavailable !== undefined && (result.value ?? null) === null) {
                    problems.add("unavailable");
                    text = "";
                } else text = plainValue(result.value, context, mentions, problems);
                break;
            }
            case "ref":
                text = context.entryName(meaning.id) ?? DELETED_NAME;
                break;
            case "image":
                text = meaning.alt;
                break;
            case "unregistered":
                text = "";
                break;
            default:
                return;
        }
        splices.push({start: tag.start, end: tag.end, text});
    });
    splices.sort((left, right) => left.start - right.start || left.end - right.end);
    let text = "";
    let cursor = 0;
    for (const splice of splices) {
        if (splice.start < cursor) continue;
        text += source.slice(cursor, splice.start) + splice.text;
        cursor = splice.end;
    }
    return {id, text: text + source.slice(cursor), reads: [...reads], mentions: [...mentions], problems: [...problems]};
}
