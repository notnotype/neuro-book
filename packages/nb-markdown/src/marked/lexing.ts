/**
 * 不带编辑器的词法：一组语法模块在 `marked` 一侧的部分（分词规则、原子、转义规则）组装成的词法器。编辑器的语言
 * （`language/language.ts`）与世界引擎内核读条目的主文字都经这里组装，所以两边的分词顺序、配置与原子的处理只有一份。
 *
 * 原子（docs/specs/workspace/markdown-syntaxes.md 的“可选的原子”）：语法模块在原文上认出的一段段文字（条目的标签）。分词之前
 * 每段换成等长的占位，分完把占位逐字换回全部词法单元。等长保住偏移与行列；占位里没有 Markdown 的记号，所以表格的 `|`、
 * 列表与引用去前缀、行首的 HTML 块都不会切开或改读原子（w00055 t02 独立设计的实验：不遮罩时表格里的 `<If test="a || b">`
 * 被按 `|` 切开、后面的内容被丢掉）。
 */

import {Marked} from "marked";
import type {Lexer, MarkedExtension, Token, TokensList} from "marked";

import {lexingInline, type OpenTag} from "../language/syntax/tags";
import {createRawMarked} from "./raw";

/** 一个原子在原文里的范围（UTF-16 码元，`to` 不含）。语法模块给的范围之间不能重叠。 */
export interface AtomSpan {
    readonly from: number;
    readonly to: number;
}

/** 分词期间按占位查回的原子。 */
export interface Atom extends AtomSpan {
    /** 在这次分词的全部原子里的序号，按在原文里的先后。 */
    readonly index: number;
    /** 原文。 */
    readonly source: string;
}

/** 语法模块在 `marked` 一侧的部分；编辑器的 `MarkdownSyntax` 在它上面加 schema、读法与写法。 */
export interface MarkdownLexing {
    readonly name: string;
    /** `marked` 的扩展，按模块顺序先试（见 `createLexing`）。 */
    readonly marked?: ReadonlyArray<MarkedExtension>;
    /** 块级方言标签名 → 开标签能否作块级形态的判断（宽容写法）。 */
    readonly blockOpens?: Readonly<Record<string, (open: OpenTag) => boolean>>;
    /** 行内方言标签名（原样语法不抢它们）。 */
    readonly inlineTags?: ReadonlyArray<string>;
    /**
     * 原子：在原文上从左到右认出的、互不重叠的范围。分词期间范围里的字换成占位，模块自己的分词规则用 `atomAt` 查回原文。
     * 原子的第一个与最后一个字若是 Markdown 的标点（例如标签的 `<`、`>`），范围不含它们更好：留在原文里，旁边强调的左右侧判断
     * 照旧（占位是私用区的字，不算标点）。
     */
    readonly atoms?: (source: string) => ReadonlyArray<AtomSpan>;
    /** 写回文字时，`text` 里 `index` 处起的写法会被本模块认成原子的开头：前面加反斜杠。 */
    readonly atomEscape?: (text: string, index: number) => boolean;
}

/** 组装好的词法。 */
export interface Lexing {
    readonly marked: Marked;
    /** 新的词法器：一次 `lex()` 一份原子表，别的词法器（包括一次分词进行中另起的）各有各的。 */
    lexer(): Lexer;
    readonly blockTags: ReadonlyArray<string>;
    readonly inlineTags: ReadonlyArray<string>;
    /** 各模块的转义规则合起来；没有模块给时为 null。 */
    readonly atomEscape: ((text: string, index: number) => boolean) | null;
    /**
     * 在 `lex()` 之外给一段文字分块（连同排队的行内分词）或分行内：读法要对一部分文字另分词时用（编解码器的 `lexBlocks`、
     * `lexInline`）。这段文字照样遮罩、分完还原；直接调词法器的 `blockTokens`、`inlineTokens` 不遮罩（那时这次分词的原子表已清）。
     */
    blockTokens(lexer: Lexer, src: string): Token[];
    inlineTokens(lexer: Lexer, src: string): Token[];
}

/** 占位的身份字从私用区起、按原子序号递增；之后用一个固定的填充字补齐长度。原文里的私用区字也作为原子换掉，不会与占位相混。 */
const IDENTITY_BASE = 0xe000;
/** 一次分词最多这么多个原子（私用区共 6400 个字，身份字用 U+E000 到 U+F76F，填充字是 U+F8FE）。超出时不遮罩、照原文分词。 */
export const ATOM_CAPACITY = 6000;
const FILLER = "\uf8fe";
const PRIVATE_USE = /[\ue000-\uf8ff]/gu;
const PLACEHOLDER = /[\ue000-\uf76f]\uf8fe*/gu;

const tables = new WeakMap<object, ReadonlyMap<string, Atom>>();

/** 分词期间按占位的身份字查回原子：模块的分词规则在 `this.lexer` 上调用。不在遮罩的分词里、或不是身份字时返回 undefined。 */
export function atomAt(lexer: object, identity: string): Atom | undefined {
    return tables.get(lexer)?.get(identity);
}

/** 原文里 `index` 处是不是占位的身份字。 */
export const isAtomIdentity = (char: string | undefined): boolean => char !== undefined && char >= "\ue000" && char <= "\uf76f";

type Masked =
    | {readonly kind: "none"}
    | {readonly kind: "over-capacity"; readonly count: number}
    | {readonly kind: "masked"; readonly text: string; readonly table: ReadonlyMap<string, Atom>};

/**
 * 把原子换成占位。模块给的范围重叠或跨行时抛出（模块的缺陷，宁可读不出来也不读错：跨行的范围被填成一行，块的结构就变了）；
 * 没有原子、原子多于上限时不遮罩，调用方照原文分词。
 */
function mask(source: string, modules: ReadonlyArray<NonNullable<MarkdownLexing["atoms"]>>): Masked {
    const spans: AtomSpan[] = modules.flatMap((atoms) => [...atoms(source)]).sort((left, right) => left.from - right.from);
    for (let index = 0; index < spans.length; index += 1) {
        const span = spans[index] as AtomSpan;
        if (index > 0 && span.from < (spans[index - 1] as AtomSpan).to) throw new Error(`atom spans overlap at ${String(span.from)}`);
        if (span.to <= span.from || /[\r\n]/u.test(source.slice(span.from, span.to))) throw new Error(`atom span at ${String(span.from)} is empty or crosses a line`);
    }
    // 原文里的私用区字：不在模块给的范围里的，各自作为一个原子。
    const all: AtomSpan[] = [];
    let cursor = 0;
    const takePrivateUse = (until: number): void => {
        PRIVATE_USE.lastIndex = cursor;
        for (let matched = PRIVATE_USE.exec(source); matched !== null && matched.index < until; matched = PRIVATE_USE.exec(source)) all.push({from: matched.index, to: matched.index + 1});
    };
    for (const span of spans) {
        takePrivateUse(span.from);
        all.push(span);
        cursor = span.to;
    }
    takePrivateUse(source.length);
    if (all.length === 0) return {kind: "none"};
    if (all.length > ATOM_CAPACITY) return {kind: "over-capacity", count: all.length};
    const table = new Map<string, Atom>();
    const parts: string[] = [];
    let at = 0;
    all.forEach((span, index) => {
        const identity = String.fromCharCode(IDENTITY_BASE + index);
        table.set(identity, {index, from: span.from, to: span.to, source: source.slice(span.from, span.to)});
        parts.push(source.slice(at, span.from), identity, FILLER.repeat(span.to - span.from - 1));
        at = span.to;
    });
    parts.push(source.slice(at));
    const text = parts.join("");
    if (text.length !== source.length) throw new Error("masked text length differs from source");
    return {kind: "masked", text, table};
}

/** 把词法单元里的占位逐字换回原文（各层的 `raw`、`text`、链接的地址与标题、引用定义表）。 */
function unmask(tokens: readonly Token[], table: ReadonlyMap<string, Atom>, links?: object): void {
    const restore = (text: string): string => (text.search(PLACEHOLDER) < 0 ? text : text.replace(PLACEHOLDER, (run) => table.get(run[0] as string)?.source ?? run));
    const seen = new WeakSet<object>();
    const walk = (value: unknown): unknown => {
        if (typeof value === "string") return restore(value);
        if (value === null || typeof value !== "object" || seen.has(value)) return value;
        seen.add(value);
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index += 1) value[index] = walk(value[index]);
            return value;
        }
        const record = value as Record<string, unknown>;
        for (const key of Object.keys(record)) record[key] = walk(record[key]);
        return value;
    };
    walk(tokens);
    if (links !== undefined) walk(links);
}

/** 一个原子落在哪：带着它的字段（`raw`、`text`、`href`、`title`…）、这个字段所在的词法单元，与外面各层的词法单元（由外到内）。 */
export interface AtomPlacement {
    readonly token: Token;
    readonly field: string;
    readonly ancestors: readonly Token[];
}

/** `lexAtoms` 的结果：遮罩了的分词（没有原子时也算），或原子多于上限、没有遮罩。 */
export type LexedAtoms =
    | {readonly ok: true; readonly tokens: TokensList; readonly atoms: readonly Atom[]; readonly placements: ReadonlyArray<ReadonlyArray<AtomPlacement>>}
    | {readonly ok: false; readonly reason: "over-capacity"; readonly count: number};

/**
 * 在遮罩着的词法单元上找每个原子落在哪（还原之前做：还原以后原子只剩原文，分不出是哪一个）。外层单元的 `raw`、`text` 是里层内容的
 * 重复，所以有里层单元的对象只看别的字段（链接的地址与标题这类），没有里层单元的看全部字符串字段。表格的单元格不是词法单元，算在表格名下。
 * 一个原子在同一个单元的同一个字段里只记一次；一处也没有记的原子是被 Markdown 的规则丢掉了（例如表格里多出来的单元格）。
 */
function placementsOf(tokens: TokensList, table: ReadonlyMap<string, Atom>): AtomPlacement[][] {
    const placements: AtomPlacement[][] = Array.from({length: table.size}, () => []);
    const recorded = new Map<Token, Set<string>>();
    const record = (text: string, token: Token, field: string, ancestors: readonly Token[]): void => {
        for (const char of text) {
            if (!isAtomIdentity(char)) continue;
            const atom = table.get(char);
            if (atom === undefined) continue;
            const key = `${String(atom.index)}:${field}`;
            const seen = recorded.get(token) ?? new Set<string>();
            if (seen.has(key)) continue;
            seen.add(key);
            recorded.set(token, seen);
            (placements[atom.index] as AtomPlacement[]).push({token, field, ancestors});
        }
    };
    const hasChildren = (value: Record<string, unknown>): boolean =>
        Object.values(value).some((field) => Array.isArray(field) && field.some((item) => item !== null && typeof item === "object"));
    const visit = (value: Record<string, unknown>, owner: Token | null, ancestors: readonly Token[]): void => {
        const isToken = typeof value.type === "string";
        const token = isToken ? (value as unknown as Token) : owner;
        const outer = isToken && owner !== null ? [...ancestors, owner] : ancestors;
        const nested = hasChildren(value);
        for (const [field, item] of Object.entries(value)) {
            if (typeof item === "string") {
                if (token !== null && !(nested && (field === "raw" || field === "text"))) record(item, token, field, outer);
            } else if (Array.isArray(item)) {
                for (const child of item) if (child !== null && typeof child === "object") visit(child as Record<string, unknown>, token, outer);
            } else if (item !== null && typeof item === "object") visit(item as Record<string, unknown>, token, outer);
        }
    };
    for (const token of tokens) visit(token as unknown as Record<string, unknown>, null, []);
    return placements;
}

/** 正在 `lexAtoms` 里的词法器 → 收结果的地方。 */
const sinks = new WeakMap<object, (result: LexedAtoms) => void>();

/**
 * 分词，并交回每个原子落在哪（docs/specs/workspace/markdown-syntaxes.md 的“可选的原子”）：模块据此判断一个原子是在正文里被自己的
 * 分词规则认领，还是落在代码、链接地址、图片说明这类地方。词法单元与 `lexing.lexer().lex(source)` 的相同。
 */
export function lexAtoms(lexing: Lexing, source: string): LexedAtoms {
    const lexer = lexing.lexer();
    let result: LexedAtoms | undefined;
    sinks.set(lexer, (lexed) => {
        result = lexed;
    });
    try {
        lexer.lex(source);
    } finally {
        sinks.delete(lexer);
    }
    if (result === undefined) throw new Error("lexAtoms: the lexer did not report");
    return result;
}

/**
 * 组装。原样语法的分词规则由这里追加：它要知道全部方言标签，才不会抢走它们。`marked` 的扩展后登记的先试，所以原样语法最先
 * 登记（最后试），各模块按列表倒序登记（列表里靠前的先试）。
 */
export function createLexing(modules: ReadonlyArray<MarkdownLexing>): Lexing {
    const blockTags = modules.flatMap((module) => Object.keys(module.blockOpens ?? {}));
    const inlineTags = modules.flatMap((module) => module.inlineTags ?? []);
    const marked = new Marked({gfm: true});
    marked.use(createRawMarked({blockTags, inlineTags}));
    for (const module of [...modules].reverse()) for (const extension of module.marked ?? []) marked.use(extension);
    const atoms = modules.flatMap((module) => (module.atoms === undefined ? [] : [module.atoms]));
    const escapes = modules.flatMap((module) => (module.atomEscape === undefined ? [] : [module.atomEscape]));
    const Base = marked.Lexer;
    class TrackingLexer extends Base {
        override lex(src: string): TokensList {
            const sink = sinks.get(this);
            const masked: Masked = atoms.length === 0 ? {kind: "none"} : mask(src, atoms);
            if (masked.kind !== "masked") {
                const tokens = super.lex(src);
                sink?.(masked.kind === "none" ? {ok: true, tokens, atoms: [], placements: []} : {ok: false, reason: "over-capacity", count: masked.count});
                return tokens;
            }
            tables.set(this, masked.table);
            try {
                const tokens = super.lex(masked.text);
                const placements = sink === undefined ? null : placementsOf(tokens, masked.table);
                unmask(tokens, masked.table, tokens.links);
                if (sink !== undefined && placements !== null) sink({ok: true, tokens, atoms: [...masked.table.values()].sort((left, right) => left.index - right.index), placements});
                return tokens;
            } finally {
                tables.delete(this);
            }
        }

        // `marked` 的行内分词规则在一段里的每个位置都会被调用；记下正在分的那段文字，`tags.ts` 才能按段记忆位置（见那里的说明）。
        override inlineTokens(src: string, tokens: Token[] = []): Token[] {
            return lexingInline(src, () => super.inlineTokens(src, tokens));
        }
    }
    // 一段文字另分词：遮罩、分、还原；外层若正在遮罩分词（表还在），分完换回外层的表。
    const fragment = (lexer: Lexer, src: string, run: (text: string) => Token[]): Token[] => {
        const masked: Masked = atoms.length === 0 ? {kind: "none"} : mask(src, atoms);
        if (masked.kind !== "masked") return run(src);
        const outer = tables.get(lexer);
        tables.set(lexer, masked.table);
        try {
            const tokens = run(masked.text);
            unmask(tokens, masked.table, lexer.tokens.links);
            return tokens;
        } finally {
            if (outer === undefined) tables.delete(lexer);
            else tables.set(lexer, outer);
        }
    };
    return {
        marked,
        lexer: () => new TrackingLexer(marked.defaults),
        blockTags,
        inlineTags,
        atomEscape: escapes.length === 0 ? null : (text, index) => escapes.some((escape) => escape(text, index)),
        blockTokens: (lexer, src) =>
            fragment(lexer, src, (text) => {
                const tokens = lexer.blockTokens(text, []);
                for (const next of lexer.inlineQueue.splice(0)) lexer.inlineTokens(next.src, next.tokens);
                return tokens;
            }),
        inlineTokens: (lexer, src) => fragment(lexer, src, (text) => lexer.inlineTokens(text, [])),
    };
}
