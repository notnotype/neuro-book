/**
 * 一组语法模块组装成的“Markdown 语言”（docs/specs/workspace/markdown-dialect.md）：自己的 `Marked` 实例、读法表与方言名单。
 * 按语法模块的列表建一次，全应用共用；它不碰 schema，按 schema 的部分在 `codec/`。
 *
 * 不用全局的 `marked`：`@tiptap/markdown` 每建一个编辑器就把全部分词规则 `use()` 进全局实例一次，开得越多重复得越多。
 */

import type {AnyExtension} from "@tiptap/core";
import type {Lexer, Marked, Token} from "marked";

import {createLexing} from "../marked/lexing";
import type {GluedRules} from "./codec/source";
import {createRawSyntax} from "./syntax/raw";
import {openTagAt} from "./syntax/tags";
import type {BlockWriter, InlineWriter, MarkdownSyntax, MarkWriter, ReadResolver, TokenReader} from "./syntax/types";

export interface MarkdownLanguage {
    readonly marked: Marked;
    /** 新的词法器：读入、写回校验与写前准备都用它（行内分词期间记下正在分的文字，见 `syntax/tags.ts` 的 `lexingInline`）。 */
    lexer(): Lexer;
    /** 读法对一部分文字另分词（`marked/lexing.ts` 的 `Lexing.blockTokens`、`inlineTokens`：照样遮罩原子）。 */
    blockTokens(lexer: Lexer, src: string): Token[];
    inlineTokens(lexer: Lexer, src: string): Token[];
    /** 全部语法模块的扩展，按模块顺序；编辑器与测试都用它建 schema。 */
    readonly extensions: ReadonlyArray<AnyExtension>;
    /** 块层与行内的词法单元类型 → 读法（按模块顺序，先试先赢）。 */
    readonly readers: ReadonlyMap<string, ReadonlyArray<TokenReader>>;
    readonly inlineReaders: ReadonlyMap<string, ReadonlyArray<TokenReader>>;
    /** 节点与标记类型 → 写法（每种类型只能有一个模块给写法）。 */
    readonly blockWriters: ReadonlyMap<string, BlockWriter>;
    readonly inlineWriters: ReadonlyMap<string, InlineWriter>;
    readonly markWriters: ReadonlyMap<string, MarkWriter>;
    /** 读入时推导出来的属性（读回校验不比较）。 */
    readonly derivedAttrs: ReadonlyMap<string, ReadonlySet<string>>;
    /** 由跨块上下文决定的属性（读回校验不比较）。 */
    readonly contextAttrs: ReadonlyMap<string, ReadonlySet<string>>;
    /** 读回校验不比较的属性：上面两张表的并集（节点或标记类型 → 属性名）。 */
    readonly uncomparedAttrs: ReadonlyMap<string, ReadonlySet<string>>;
    /** 整篇读完之后的处理，按模块顺序。 */
    readonly resolvers: ReadonlyArray<ReadResolver>;
    /** 写前准备：模块名 → 准备函数。 */
    readonly prepareWrite: ReadonlyMap<string, NonNullable<MarkdownSyntax["prepareWrite"]>>;
    /** 没被编辑的块因上下文变了要重新写出的判断：模块名 → 判断。 */
    readonly contextDependents: ReadonlyMap<string, NonNullable<MarkdownSyntax["contextDependents"]>>;
    /** 读回窗口的整窗核对：模块名 → 核对。 */
    readonly verifyWindow: ReadonlyMap<string, NonNullable<MarkdownSyntax["verifyWindow"]>>;
    /** 身上的标记不写出、不比较的行内节点类型。 */
    readonly marklessInline: ReadonlySet<string>;
    /** 只盖文字的标记类型（`MarkWriter.textOnly`）。 */
    readonly textOnlyMarks: ReadonlySet<string>;
    /** 挨着时读回合成一个的行内节点类型 → 存原文的属性（`MarkdownSyntax.joinedInline`）。 */
    readonly joinedInline: ReadonlyMap<string, string>;
    /** 只在内存里用的身份属性：标记类型 → 属性名（`MarkdownSyntax.identityAttrs`）。 */
    readonly identityAttrs: ReadonlyMap<string, string>;
    /** 块级方言标签名与宽容写法的规则（行尾的开标签认不认，由各模块的分词规则判断）。 */
    readonly blockTags: ReadonlyArray<string>;
    /** 行内方言标签名（各模块的 `inlineTags`）。 */
    readonly inlineTags: ReadonlyArray<string>;
    readonly glued: GluedRules;
    /** 读入时拆不拆开头的 frontmatter（`createMarkdownLanguage` 的选项，缺省拆）。 */
    readonly frontmatter: boolean;
    /** 各模块的原子转义规则合起来（`MarkdownLexing.atomEscape`）；没有时为 null。 */
    readonly atomEscape: ((text: string, index: number) => boolean) | null;
}

/** 组装语言的选项。 */
export interface MarkdownLanguageOptions {
    /**
     * 读入时把开头的 `---…---` 当 frontmatter 拆出（缺省是）。条目的主文字不是文件，关掉它：开头的 `---` 照 Markdown 读，与不带编辑器
     * 的词法（世界引擎内核）读法相同。
     */
    readonly frontmatter?: boolean;
}

/**
 * 组装。原样语法（`syntax/raw`）由这里追加在最后：它要知道全部方言标签，才不会抢走它们。分词的顺序与原子见
 * `marked/lexing.ts` 的 `createLexing`。
 */
export function createMarkdownLanguage(syntaxes: ReadonlyArray<MarkdownSyntax>, options: MarkdownLanguageOptions = {}): MarkdownLanguage {
    const blockOpens = new Map(syntaxes.flatMap((syntax) => Object.entries(syntax.blockOpens ?? {})));
    // 分词（含原样语法的分词规则与原子）由不带编辑器的词法组装；这里的原样语法模块只提供读法与写法。
    const lexing = createLexing(syntaxes);
    const {blockTags, inlineTags} = lexing;
    const raw = createRawSyntax({blockTags, inlineTags});
    const all = [...syntaxes, raw];
    const table = (pick: (syntax: MarkdownSyntax) => Readonly<Record<string, TokenReader>> | undefined): Map<string, TokenReader[]> => {
        const readers = new Map<string, TokenReader[]>();
        for (const syntax of all) {
            for (const [type, reader] of Object.entries(pick(syntax) ?? {})) readers.set(type, [...(readers.get(type) ?? []), reader]);
        }
        return readers;
    };
    const writers = <W>(pick: (syntax: MarkdownSyntax) => Readonly<Record<string, W>> | undefined): Map<string, W> => {
        const map = new Map<string, W>();
        for (const syntax of all) {
            for (const [type, writer] of Object.entries(pick(syntax) ?? {})) {
                if (map.has(type)) throw new Error(`${type} 的写法登记了两次（${syntax.name}）`);
                map.set(type, writer);
            }
        }
        return map;
    };
    const attrTable = (pick: (syntax: MarkdownSyntax) => Readonly<Record<string, ReadonlyArray<string>>> | undefined): Map<string, Set<string>> => {
        const map = new Map<string, Set<string>>();
        for (const syntax of all) for (const [type, names] of Object.entries(pick(syntax) ?? {})) map.set(type, new Set([...(map.get(type) ?? []), ...names]));
        return map;
    };
    const derivedAttrs = attrTable((syntax) => syntax.derivedAttrs);
    const contextAttrs = attrTable((syntax) => syntax.contextAttrs);
    const uncomparedAttrs = new Map(derivedAttrs);
    for (const [type, names] of contextAttrs) uncomparedAttrs.set(type, new Set([...(uncomparedAttrs.get(type) ?? []), ...names]));
    const byName = <T>(pick: (syntax: MarkdownSyntax) => T | undefined): Map<string, T> =>
        new Map(all.flatMap((syntax) => {
            const value = pick(syntax);
            return value === undefined ? [] : [[syntax.name, value] as [string, T]];
        }));
    return {
        marked: lexing.marked,
        lexer: () => lexing.lexer(),
        blockTokens: (lexer, src) => lexing.blockTokens(lexer, src),
        inlineTokens: (lexer, src) => lexing.inlineTokens(lexer, src),
        extensions: all.flatMap((syntax) => syntax.extensions),
        readers: table((syntax) => syntax.read),
        inlineReaders: table((syntax) => syntax.readInline),
        blockWriters: writers((syntax) => syntax.writeBlock),
        inlineWriters: writers((syntax) => syntax.writeInline),
        markWriters: writers((syntax) => syntax.writeMark),
        marklessInline: new Set(all.flatMap((syntax) => syntax.marklessInline ?? [])),
        textOnlyMarks: new Set(all.flatMap((syntax) => Object.entries(syntax.writeMark ?? {}).filter(([, writer]) => writer.textOnly === true).map(([type]) => type))),
        joinedInline: new Map(all.flatMap((syntax) => Object.entries(syntax.joinedInline ?? {}))),
        identityAttrs: new Map(all.flatMap((syntax) => Object.entries(syntax.identityAttrs ?? {}))),
        derivedAttrs,
        contextAttrs,
        uncomparedAttrs,
        resolvers: all.flatMap((syntax) => (syntax.resolve === undefined ? [] : [syntax.resolve])),
        prepareWrite: byName((syntax) => syntax.prepareWrite),
        contextDependents: byName((syntax) => syntax.contextDependents),
        verifyWindow: byName((syntax) => syntax.verifyWindow),
        blockTags,
        inlineTags,
        frontmatter: options.frontmatter !== false,
        atomEscape: lexing.atomEscape,
        glued: {
            tags: blockTags,
            accepts: (name, source) => {
                const open = openTagAt(source, [name]);
                return open !== null && open.length === source.length && blockOpens.get(name)?.(open) === true;
            },
        },
    };
}
