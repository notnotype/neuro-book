/**
 * 主文字一块的解析、写入检查与渲染前的分析（docs/specs/canon/rendering.md 输入与前置条件、输出 1、4、17、18、19）。读法与检查本身在
 * `../grammar`（编辑器用同一份）；这里按源文缓存解析结果，并把每个标签的意思（地址、式子、条件的各支）先算好，三种渲染共用。
 *
 * 只有存下来的块进缓存：同一块渲染很多次，源文不变时只解析一次。预览的源文字每次都不一样，用 `analyzeDraft`，不留结果。
 */

import {
    BUILTIN_TAGS,
    canonicalEntryText,
    checkEntryText,
    normalizeEntrySource,
    parseAddress,
    parseEntryText,
    parseExpression,
    positionOf,
    tagText,
    type CheckProblem,
    type EntryIfToken,
    type EntryTag,
    type FieldReference,
    type GrammarCode,
    type ParsedEntryText,
    type ParsedExpression,
} from "../grammar/index";
import {childLists} from "../grammar/parse";

export type {FieldReference};
export type SyntaxCode = GrammarCode | "block-too-large";

export interface SyntaxProblem {
    readonly code: SyntaxCode;
    readonly line: number;
    readonly column: number;
    readonly message: string;
}

/** 一个标签的意思：取值、计算值、条件的头、条目引用、图片，或没登记的标签。字面的标签也算（纯文字的静态收集要看它们）。 */
export type TagMeaning =
    | {readonly kind: "value"; readonly of: FieldReference}
    | {readonly kind: "computed"; readonly expr: ParsedExpression; readonly source: string}
    | {readonly kind: "test"; readonly test: ParsedExpression}
    | {readonly kind: "ref"; readonly id: string}
    | {readonly kind: "image"; readonly src: string | null; readonly of: FieldReference | null; readonly alt: string}
    | {readonly kind: "unregistered"}
    | {readonly kind: "other"};

/** 一个条件：开标签、各支起头的标签（`If`、`ElseIf`、`Else`）与闭标签的序号，各支内容在原文里的起止。 */
export interface Condition {
    readonly open: number;
    readonly close: number;
    readonly branches: ReadonlyArray<{readonly head: number; readonly from: number; readonly to: number}>;
}

export interface BlockAnalysis {
    readonly source: string;
    readonly parsed: ParsedEntryText;
    /** 渲染时让整块出错的问题（不可免的第一个）；没登记的标签不算，渲染时照“需要插件”给。 */
    readonly error: SyntaxProblem | null;
    /** 不带登记表的写入检查的全部问题（按偏移排），写入时的检查直接用。 */
    readonly problems: readonly CheckProblem[];
    /** 与 `parsed.tags` 一一对应。 */
    readonly meanings: readonly TagMeaning[];
    readonly conditions: readonly Condition[];
    /** 嵌套深到读不出结构：`parsed` 是空的，`error` 是不可免的问题。 */
    readonly unread?: true;
}

function syntaxProblem(source: string, problem: CheckProblem): SyntaxProblem {
    const {line, column} = positionOf(source, problem.offset);
    return {code: problem.code, line, column, message: problem.message};
}

/** 规范写法的一个标签（输出 18、19：没登记的标签按它与条目里已有的比）。 */
export const canonicalTag = (tag: EntryTag): string => tagText(tag.name, tag.attributes.map((attribute) => [attribute.name, attribute.value] as const), tag.kind === "close" ? "close" : tag.kind === "open" ? "open" : "self");

const attribute = (tag: EntryTag, name: string): string | undefined => tag.attributes.find((candidate) => candidate.name === name)?.value;

function meaningOf(tag: EntryTag): TagMeaning {
    if (tag.kind === "malformed" || tag.kind === "close") return {kind: "other"};
    switch (tag.name) {
        case "V": {
            const of = attribute(tag, "of");
            if (of !== undefined) {
                const address = parseAddress(of);
                const entry = attribute(tag, "entry");
                return address.ok ? {kind: "value", of: {entry: entry ?? null, path: address.path}} : {kind: "other"};
            }
            const expr = attribute(tag, "expr");
            const parsed = expr === undefined ? null : parseExpression(expr);
            return parsed !== null && parsed.ok ? {kind: "computed", expr: parsed.expression, source: (expr as string).trim()} : {kind: "other"};
        }
        case "If":
        case "ElseIf": {
            const test = attribute(tag, "test");
            const parsed = test === undefined ? null : parseExpression(test);
            return parsed !== null && parsed.ok ? {kind: "test", test: parsed.expression} : {kind: "other"};
        }
        case "Ref": {
            const id = attribute(tag, "id");
            return id === undefined ? {kind: "other"} : {kind: "ref", id};
        }
        case "Image": {
            const of = attribute(tag, "of");
            const address = of === undefined ? null : parseAddress(of);
            return {kind: "image", src: attribute(tag, "src") ?? null, of: address !== null && address.ok ? {entry: null, path: address.path} : null, alt: attribute(tag, "alt") ?? ""};
        }
        default:
            return BUILTIN_TAGS.has(tag.name) ? {kind: "other"} : {kind: "unregistered"};
    }
}

function conditionsOf(parsed: ParsedEntryText): Condition[] {
    const found: Condition[] = [];
    const visit = (tokens: readonly unknown[]): void => {
        for (const token of tokens as Array<{type: string}>) {
            if (token.type === "entryIf") {
                const entryIf = token as unknown as EntryIfToken;
                const heads = entryIf.branches.map((branch) => branch.head);
                const tags = parsed.tags;
                found.push({
                    open: entryIf.open,
                    close: entryIf.close,
                    branches: heads.map((head, index) => ({head, from: (tags[head] as EntryTag).end, to: (tags[heads[index + 1] ?? entryIf.close] as EntryTag).start})),
                });
                for (const branch of entryIf.branches) visit(branch.tokens);
                continue;
            }
            for (const child of childLists(token as never)) visit(child);
        }
    };
    visit(parsed.tokens);
    return found.sort((left, right) => (parsed.tags[left.open] as EntryTag).start - (parsed.tags[right.open] as EntryTag).start);
}

/**
 * 嵌套深到分词时栈溢出的源文（几万层引用这类，只会来自粘贴）：读不出结构，整块按出错给，写入时拒收。不让 `RangeError` 从写入与渲染里
 * 抛出去：调用方会收到一个说不清原因的内部错误。
 */
const TOO_DEEP = {code: "unsupported-markdown", line: 1, column: 1, message: "Nested too deeply to read; split it or flatten the quotes and lists"} as const satisfies SyntaxProblem;

function readable(source: string): ParsedEntryText | null {
    try {
        return parseEntryText(source);
    } catch (error) {
        if (error instanceof RangeError) return null;
        throw error;
    }
}

/**
 * 一块主文字最多这么多个字符（UTF-16 码元，rendering.md 输出 1；开发者 2026-11-26 定）。作者界面整篇编辑时把整篇写进一块，所以它也是
 * 作者改过的条目整篇的上限，与预览一次肯渲染的长度相同。marked 在嵌套强调、引用套列表这类写法上大致按长度的平方变慢（实测 1 万字
 * 最坏约 1 到 2 秒、2 万字约 6 秒；正常文字 2 万字约 50 毫秒），写入在单写者队列里做，长度有了上界，刻意构造的最坏输入也只占住
 * 队列几十秒。只管写入：超过的不解析、直接拒收；渲染不看它，存下来的旧数据照常渲染。嵌套深到读不出结构的由 `TOO_DEEP` 兜底。
 */
export const MAX_BLOCK_LENGTH = 50_000;

const TOO_LARGE = {code: "block-too-large", line: 1, column: 1, message: `a block of entry text may have at most ${String(MAX_BLOCK_LENGTH)} characters; split it into several blocks`} as const satisfies SyntaxProblem;

const unread = (source: string, error: SyntaxProblem): BlockAnalysis => ({source, parsed: parseEntryText(""), error, problems: [], unread: true, meanings: [], conditions: []});

function analyzeUncached(source: string): BlockAnalysis {
    const parsed = readable(source);
    if (parsed === null) return unread(source, TOO_DEEP);
    const problems = checkEntryText(parsed);
    const first = problems.find((problem) => problem.excusable !== true);
    return {source, parsed, error: first === undefined ? null : syntaxProblem(source, first), problems, meanings: parsed.tags.map(meaningOf), conditions: conditionsOf(parsed)};
}

// 键只有源文：分析的结果现在只取决于源文。插件登记标签以后（t04）`error` 与 `meanings` 也取决于登记表，那时键要带上登记表的摘要，
// 或者把依赖登记表的部分移出缓存。
const cache = new Map<string, BlockAnalysis>();
const CACHE_LIMIT = 10_000;

/** 分析一块存下来的源文（带缓存）。 */
export function analyzeBlock(source: string): BlockAnalysis {
    const cached = cache.get(source);
    if (cached !== undefined) return cached;
    const result = analyzeUncached(source);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(source, result);
    return result;
}

/**
 * 分析一段没存下来的源文字（按给的源文字渲染，输出 16）：结果不进缓存。缓存是给存下来的块用的，它们的原文稳定；预览的源文字作者每停顿
 * 一次就换一份。缓存里正好有（与某个存下来的块相同）就用。
 */
export function analyzeDraft(source: string): BlockAnalysis {
    return cache.get(source) ?? analyzeUncached(source);
}

/** 写入检查的选项。`existing` 判断一个没登记的标签（规范写法）是否已在这个条目当前的主文字里：在的放行（输出 19）。 */
export interface BlockCheckOptions {
    readonly registered?: ReadonlySet<string>;
    readonly existing?: (canonical: string) => boolean;
}

/** 没登记的标签按基线放行（输出 19）：只放自闭合的、与基线里规范写法相同的；带内容的写法即使插件在也不合法。 */
const excused = (tag: EntryTag, options: BlockCheckOptions): boolean => tag.kind === "self" && options.existing?.(canonicalTag(tag)) === true;

/** 写入时检查一块（输出 1、19；源文已规范化）；合格返回 null。 */
export function blockProblem(source: string, options: BlockCheckOptions = {}): SyntaxProblem | null {
    if (source.length > MAX_BLOCK_LENGTH) return TOO_LARGE;
    const analysis = analyzeBlock(source);
    if (analysis.unread === true) return analysis.error;
    const parsed = analysis.parsed;
    const problems = options.registered === undefined ? analysis.problems : checkEntryText(parsed, {registered: options.registered});
    for (const problem of problems) {
        if (problem.excusable === true && problem.tag !== undefined && excused(parsed.tags[problem.tag] as EntryTag, options)) continue;
        return syntaxProblem(source, problem);
    }
    return null;
}

/** 一块源文里活的、自闭合的、没登记的标签的规范写法（给 `existing` 的基线）。 */
export function unregisteredTags(source: string): string[] {
    const analysis = analyzeBlock(source);
    return analysis.parsed.tags.filter((tag, index) => tag.place === "live" && tag.kind === "self" && analysis.meanings[index]?.kind === "unregistered").map(canonicalTag);
}

/**
 * 写入之前的规范化（输出 1、18）：去 BOM、换行规范成 LF、活的标签写成规范写法。对规范的源文不变，可以重复做。分析经缓存：源文
 * 本来就是规范写法时（多数情况），接着的写入检查用的是同一份解析。太长或读不出结构的原样交给写入检查拒收（太长的不解析）。
 */
export function normalizeBlockSource(text: string): string {
    const normalized = normalizeEntrySource(text);
    if (normalized.length > MAX_BLOCK_LENGTH) return normalized;
    const analysis = analyzeBlock(normalized);
    return analysis.unread === true ? normalized : canonicalEntryText(analysis.parsed);
}
