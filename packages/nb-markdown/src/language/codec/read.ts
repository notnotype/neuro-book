/**
 * 读入（docs/specs/workspace/markdown-dialect.md 输出 1、2、9）：原文 → 编辑器的文档，并记下每个顶层节点来自哪一块原文。
 *
 * 不用 `@tiptap/markdown` 的 `MarkdownManager`：它的调度在私有方法里，引用定义只能整篇一起解析、实体会被解码两次、行内 HTML
 * 依赖 DOM。这里整篇只分词一次（引用定义表来自同一个词法器），逐个顶层单元交给语法模块的读法，读出的节点逐块校验。
 *
 * 读入永不失败：读不出、不合 schema 的块读成原样块，原文字节照留。
 */

import {Fragment, Mark} from "@tiptap/pm/model";
import type {Node as PMNode, Schema} from "@tiptap/pm/model";
import type {JSONContent} from "@tiptap/core";
import type {Lexer, Token} from "marked";

import type {MarkdownLanguage} from "../language";
import type {ReadContext} from "../syntax/types";
import {normalize, segment, splitFrontmatter} from "./source";
import type {Normalized} from "./source";

/**
 * 一块原文：写回时节点还挂着它、同一块的节点都还在且按原顺序相邻，这一块就写原文。没被编辑过的块一直用读入时的这个对象；
 * 重新写出的块在写回被接受后换一个新对象（`SourceMap.record`）。
 */
export interface SourceUnit {
    /** 这一块的原文字节（不含结尾的换行）。 */
    readonly raw: string;
    /** 这一块读出了几个顶层节点（一个列表可能拆成任务列表与普通列表）。 */
    readonly size: number;
}

/** 一个顶层节点的来源：所属的块与它是这一块的第几个节点。 */
export interface Origin {
    readonly unit: SourceUnit;
    readonly part: number;
}

/** 一个间隔：原文字节与它在编辑器里表示成几个空段落。 */
export interface Gap {
    readonly raw: string;
    readonly empties: number;
}

/** 间隔登记里的开头与结尾（“文件开头 → 第一块”“最后一块 → 文件末尾”）。 */
export const START: object = Object.freeze({start: true});
export const END: object = Object.freeze({end: true});

/**
 * 一份文档的原文对照，随写回累积（方言 Spec 输出 2 的“更早的原文仍然记着”）：
 * - `origins`：顶层节点对象 → 它出现过的来源，新的在前。没被编辑的节点也可能换来源（一块原文读成几个节点，编辑了其中一个，
 *   其余的随之重新写出），旧的来源留着：撤销恢复同一块的其它旧节点时，它们仍能凑成那一块原文。`WeakMap`，不阻止回收。
 * - `gaps`：前一块 → 后一块 → 空段落数 → 间隔。按一对来源与其间的空段落数登记，历史上出现过的都留着：撤销恢复旧节点、
 *   删掉后来插入的空段落后，旧的间隔还查得到。
 */
export interface SourceMap {
    /**
     * 读入时开头的 BOM，没有为空串。写回时拼在最前面；frontmatter 不在这里，在文档的 `frontmatter` 属性上（`frontmatterOf`），
     * 跟着编辑与撤销走。
     */
    readonly bom: string;
    /** 原文里用得多的换行符：重新写出的块与间隔用它。 */
    readonly eol: Eol;
    readonly origins: WeakMap<PMNode, ReadonlyArray<Origin>>;
    /**
     * 登记过来源的顶层节点，按内容分桶（`twinKey`）：真实的撤销按步骤重建出内容相同的新节点对象，按对象找不到来源时，借用内容
     * 完全相同（含写法属性）的那个节点的来源（`originsOf`）。
     */
    readonly twins: Map<string, PMNode[]>;
    readonly gaps: WeakMap<object, Map<object, Map<number, Gap>>>;
    /** 读入时正文里没有任何块（空文件、只有空行）：正文原文；否则为 null。 */
    readonly emptyBody: string | null;
    /** 读入时文件末尾有没有换行：重新生成结尾的间隔时保持。 */
    readonly finalNewline: boolean;
}

export interface ReadResult {
    readonly doc: PMNode;
    readonly map: SourceMap;
    /** 对不上任何词法单元的原文段数（诊断用）。 */
    readonly skipped: number;
    /** 读不出或不合 schema、换成原样块的块：原因（诊断用；语料测试断言它为空）。 */
    readonly problems: ReadonlyArray<string>;
}

const twinKey = (node: PMNode): string => `${node.type.name}\u0000${String(node.nodeSize)}\u0000${node.textContent}`;

/** 登记一个顶层节点的来源（同时记进按内容的表）。 */
export function setOrigins(map: SourceMap, node: PMNode, origins: ReadonlyArray<Origin>): void {
    map.origins.set(node, origins);
    const key = twinKey(node);
    const bucket = map.twins.get(key);
    if (bucket === undefined) map.twins.set(key, [node]);
    else if (!bucket.includes(node)) bucket.push(node);
}

/**
 * 顶层节点的来源：先按对象找；找不到时找一个登记过的、内容完全相同（`eq`，含写法属性）的节点，借用它的来源并记到这个节点上。
 * 撤销回到某一块以前的样子时，那一块因此写回它那时的字节（方言 Spec 输出 2）。
 */
export function originsOf(map: SourceMap, node: PMNode): ReadonlyArray<Origin> | undefined {
    const known = map.origins.get(node);
    if (known !== undefined) return known;
    const twin = map.twins.get(twinKey(node))?.find((other) => other !== node && other.eq(node));
    const origins = twin === undefined ? undefined : map.origins.get(twin);
    if (origins !== undefined) map.origins.set(node, origins);
    return origins;
}

/** 登记一个间隔。 */
export function recordGap(map: SourceMap, before: object, after: object, gap: Gap): void {
    const inner = map.gaps.get(before) ?? new Map<object, Map<number, Gap>>();
    const byEmpties = inner.get(after) ?? new Map<number, Gap>();
    byEmpties.set(gap.empties, gap);
    inner.set(after, byEmpties);
    map.gaps.set(before, inner);
}

/** 换行数：`\r\n` 算一个，单独的 `\r` 也算一个（与规范化一样，见 `source.ts`）。 */
const newlines = (gap: string): number => {
    let count = 0;
    for (let index = 0; index < gap.length; index += 1) {
        const char = gap.charCodeAt(index);
        if (char === 10 || (char === 13 && gap.charCodeAt(index + 1) !== 10)) count += 1;
    }
    return count;
};

/** 方言 Spec 的“块”：两块之间 `k` 个空段落对应 `k + 1` 个空行（`k + 2` 个换行）；开头 `k` 个换行对应 `k` 个空段落。 */
export const emptiesBetween = (gap: string): number => Math.max(0, newlines(gap) - 2);
export const emptiesLeading = (gap: string): number => newlines(gap);
/** 最后一块之后：`k` 个空行对应 `k` 个空段落，最后一个换行是文件末尾的换行。 */
export const emptiesTrailing = (gap: string): number => Math.max(0, newlines(gap) - 1);

/** 换行符：`\n`、`\r\n` 或单独的 `\r`（老的 Mac 文本）。 */
export type Eol = "\n" | "\r\n" | "\r";

/** 整篇（连同 frontmatter）用得最多的换行符：正文没有换行时，新写的内容跟 frontmatter 一致。 */
function dominantEol(body: string): Eol {
    let crlf = 0;
    let lf = 0;
    let cr = 0;
    for (let index = 0; index < body.length; index += 1) {
        const char = body.charCodeAt(index);
        if (char === 10) lf += 1;
        else if (char === 13 && body.charCodeAt(index + 1) === 10) {
            crlf += 1;
            index += 1;
        } else if (char === 13) cr += 1;
    }
    if (crlf > lf && crlf >= cr) return "\r\n";
    return cr > lf ? "\r" : "\n";
}

/** 读法产出的 JSON → 节点。标记按施加的先后用 `addToSet` 合成，所以互斥的标记（行内代码排斥其它标记）按 schema 的规则取舍。 */
/**
 * 读法给的标记从里到外排（`context.mark` 先加里层）。互斥的标记（颜色套颜色、上标套下标）里层优先：外层的同类标记不盖掉里层，
 * 这一截只有里层的（`<span red>a<span blue>b</span>c</span>` 的 b 是蓝色）。按 `addToSet` 的先后决定会让外层盖掉里层。
 */
function marksOf(schema: Schema, json: JSONContent): ReadonlyArray<Mark> {
    let set: ReadonlyArray<Mark> = Mark.none;
    for (const value of json.marks ?? []) {
        const mark = schema.mark(value.type, value.attrs);
        if (set.some((existing) => !existing.eq(mark) && (existing.type.excludes(mark.type) || mark.type.excludes(existing.type)))) continue;
        set = mark.addToSet(set as Mark[]);
    }
    return set;
}

function toNode(schema: Schema, json: JSONContent): PMNode {
    const marks = marksOf(schema, json);
    if (json.type === "text") return schema.text(json.text ?? "", marks as Mark[]);
    const type = schema.nodes[json.type ?? ""];
    if (type === undefined) throw new RangeError(`未知的节点类型 ${json.type ?? ""}`);
    const content = (json.content ?? []).filter((child) => child.type !== "text" || (child.text ?? "") !== "").map((child) => toNode(schema, child));
    // 容器的最小合法填充：内容缺了必需的节点（例如任务项开头必须是段落，原文里第一块是标题，或者容器是空的），由 schema 补上；
    // 补不上才算不合 schema（这一块读成原样块）。容器里的空段落在写出时会去掉，比较时也不算（方言 Spec 的“块”）。
    if (!type.validContent(Fragment.from(content))) {
        const filled = type.createAndFill(json.attrs ?? null, content, marks as Mark[]);
        if (filled !== null) return filled;
    }
    return type.create(json.attrs ?? null, content, marks as Mark[]);
}

/** 给一段块内容分词，并处理它排队的行内分词（`lex` 结束时才做的那一步）。 */
function lexBlocks(lexer: Lexer, src: string): Token[] {
    const tokens = lexer.blockTokens(src, []);
    const queue = lexer.inlineQueue.splice(0);
    for (const next of queue) lexer.inlineTokens(next.src, next.tokens);
    return tokens;
}

/**
 * 读一块成 JSON：调度语法模块的读法。`raw` 节点的原文按单元在规范化文字里的位置从原文切出：沿块里的位置向后找，找不到
 * （例如引用里的子块去掉了行首的 `>`）时退回单元自己的文字，这时原文里的 CR 不会保留。
 */
function readBlock(language: MarkdownLanguage, lexer: Lexer, normalized: Normalized, source: string, block: {readonly from: number; readonly to: number}, token: Token): JSONContent[] {
    let cursor = block.from;
    const sourceOf = (value: string): string => {
        const at = normalized.text.indexOf(value, cursor);
        if (at < 0 || at + value.length > block.to) return value;
        cursor = at + value.length;
        return source.slice(normalized.toSource[at] as number, normalized.toSource[at + value.length] as number);
    };
    const context: ReadContext = {
        inline: (tokens) => tokens.flatMap((child) => readToken(child, true)),
        blocks: (tokens) => tokens.flatMap((child) => (child.type === "space" ? [] : readToken(child, false))),
        mark: (type, content, attrs) => content.map((node) => ({...node, marks: [...(node.marks ?? []), {type, attrs}]})),
        raw: (child, inline) => ({type: inline ? "rawInline" : "rawBlock", attrs: {raw: sourceOf(inline ? child.raw : child.raw.replace(/\n+$/u, ""))}}),
        lexBlocks: (src) => lexBlocks(lexer, src),
        lexInline: (src) => lexer.inlineTokens(src, []),
    };
    function readToken(child: Token, inline: boolean): JSONContent[] {
        for (const reader of (inline ? language.inlineReaders : language.readers).get(child.type) ?? []) {
            const result = reader(child, context);
            if (result !== null) return result;
        }
        // 没有读法认领：保住原文。
        return [context.raw(child, inline)];
    }
    return readToken(token, false);
}

/** JSON → 节点并校验；不合 schema 时抛出。 */
function build(schema: Schema, json: ReadonlyArray<JSONContent>): PMNode[] {
    return json.map((value) => {
        const node = toNode(schema, value);
        node.check();
        return node;
    });
}

/**
 * 读入整篇。`schema` 必须是编辑器自己的 schema（Tiptap 每个编辑器各建一份；不同 schema 的节点不能放进同一个文档）。
 */
export function readMarkdown(language: MarkdownLanguage, schema: Schema, source: string): ReadResult {
    const {bom, frontmatter, body} = splitFrontmatter(source);
    // 不读 frontmatter 的语言（条目的主文字）：开头的 `---…---` 留在正文里照 Markdown 读。
    if (!language.frontmatter) return readBody(language, schema, {bom, frontmatter: null}, (frontmatter ?? "") + body, null);
    return readBody(language, schema, {bom, frontmatter}, body, null);
}

/** 文档的 frontmatter 原文（BOM 之后、正文之前的 `---` 块），没有时为 null。 */
export function frontmatterOf(doc: PMNode): string | null {
    const value: unknown = doc.attrs.frontmatter;
    return typeof value === "string" ? value : null;
}

/** 正文之前的部分：BOM 与 frontmatter 的原文（没有为 null）。 */
export interface BodyHead {
    readonly bom: string;
    readonly frontmatter: string | null;
}

/** 引用定义表：标签（小写）→ 地址与标题。 */
export type Definitions = Readonly<Record<string, {readonly href: string; readonly title: string | null}>>;

/**
 * 读一段正文（`body` 里没有 frontmatter，它在 `head` 里）。`definitions` 不为 null 时预置进词法器：写回校验只读一个窗口，
 * 引用定义可能在窗口外面。
 */
export function readBody(language: MarkdownLanguage, schema: Schema, head: BodyHead, body: string, definitions: Definitions | null): ReadResult {
    const normalized = normalize(body, language.glued);
    const lexer = language.lexer();
    if (definitions !== null) Object.assign(lexer.tokens.links, definitions);
    const tokens = lexer.lex(normalized.text);
    const {blocks, gaps, skipped} = segment(normalized, body, tokens);
    const map: SourceMap = {bom: head.bom, eol: dominantEol((head.frontmatter ?? "") + body), origins: new WeakMap(), twins: new Map(), gaps: new WeakMap(), emptyBody: blocks.length === 0 ? body : null, finalNewline: /\n$|\r$/u.test(body)};
    const nodes: PMNode[] = [];
    const empty = (): PMNode => schema.nodes.paragraph!.create();
    const problems: string[] = [];
    // 读入不失败（输出 9）：读不出或不合 schema 的块读成原样块，原因留给诊断。读法自己的缺陷也走这里，由语料测试的 `problems` 断言发现。
    const fail = (block: {readonly unit: Token | null}, error: unknown): null => {
        problems.push(`${block.unit?.type ?? "?"}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    };
    const json = blocks.map((block) => {
        if (block.unit === null) return null;
        try {
            return readBlock(language, lexer, normalized, body, block, block.unit);
        } catch (error) {
            return fail(block, error);
        }
    });
    for (const resolve of language.resolvers) resolve(json.filter((value): value is JSONContent[] => value !== null));
    let previous: object = START;
    blocks.forEach((block, index) => {
        const gap = gaps[index] as string;
        const empties = index === 0 ? emptiesLeading(gap) : emptiesBetween(gap);
        for (let count = 0; count < empties; count += 1) nodes.push(empty());
        let read: PMNode[] = [];
        const value = json[index];
        if (value !== null && value !== undefined) {
            try {
                read = build(schema, value);
                // 原文不是空白、读出来却只有一个空段落（例如只有空标签 `<comment body="意见"></comment>`）：空段落是间隔，写回会把
                // 这块原文连同意见删掉，改读成原样块。
                if (read.length === 1 && read[0]?.type.name === "paragraph" && read[0].childCount === 0 && block.raw.trim() !== "") read = [];
            } catch (error) {
                fail(block, error);
            }
        }
        if (read.length === 0) read = [schema.nodes.rawBlock!.create({raw: block.raw})];
        const unit: SourceUnit = {raw: block.raw, size: read.length};
        recordGap(map, previous, unit, {raw: gap, empties});
        previous = unit;
        read.forEach((node, part) => setOrigins(map, node, [{unit, part}]));
        nodes.push(...read);
    });
    const trailing = gaps[blocks.length] as string;
    if (blocks.length > 0) {
        const empties = emptiesTrailing(trailing);
        recordGap(map, previous, END, {raw: trailing, empties});
        for (let count = 0; count < empties; count += 1) nodes.push(empty());
    }
    if (nodes.length === 0) nodes.push(empty());
    return {doc: schema.nodes.doc!.create(head.frontmatter === null ? null : {frontmatter: head.frontmatter}, nodes), map, skipped, problems};
}
