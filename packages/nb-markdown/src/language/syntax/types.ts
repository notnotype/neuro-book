/**
 * 语法模块的形状（docs/specs/workspace/markdown-dialect.md）：每种语法一个模块，读、写与它要登记的名单只写在这个模块里。
 * 编解码器（`../codec/`）只认识这里的接口，不认识具体语法。
 */

import type {AnyExtension, JSONContent} from "@tiptap/core";
import type {Mark, Node as PMNode} from "@tiptap/pm/model";
import type {Token, Tokens} from "marked";

import type {MarkdownLexing} from "../../marked/lexing";
import type {OpenTag} from "./tags";

/** 读入时交给读法的上下文。 */
export interface ReadContext {
    /** 行内单元 → 行内节点（文字、标记、行内节点）。 */
    inline(tokens: ReadonlyArray<Token>): JSONContent[];
    /** 容器里的块单元 → 块节点。容器里的空行不产出空段落（方言 Spec 的“块”定义）。 */
    blocks(tokens: ReadonlyArray<Token>): JSONContent[];
    /** 给一组行内节点加一个标记（文字与行内节点都加，已有的同名同属性标记不重复）。 */
    mark(type: string, content: JSONContent[], attrs?: Record<string, unknown>): JSONContent[];
    /**
     * 一个原样节点（块或行内），内容是这个单元在原文里的字节：调度器经偏移表从原文切出，所以 CRLF 等不会因为父块重新写出而变。
     * 单元必须属于正在读的这一块，并且按出现的先后调用（调度器沿原文向后查找它）。
     */
    raw(token: Token, inline: boolean): JSONContent;
    /**
     * 用读这一篇的同一个词法器给一段文字分词，整篇的引用定义可用：读法要把单元的一部分另作内容时用（提示块去掉第一行后的内容）。
     */
    lexBlocks(src: string): Token[];
    lexInline(src: string): Token[];
}

/**
 * 整篇读完之后的处理：各块读法产出的 JSON（按文件顺序，每块一组），可以就地改。跨块的分组（分截批注合成一条）在这里做；
 * 写回校验只读一个窗口时也会调用，窗口外的部分看不到。
 */
export type ReadResolver = (blocks: ReadonlyArray<ReadonlyArray<JSONContent>>) => void;

/** 一种词法单元的读法：返回 null 表示不认领，交给下一个读法。 */
export type TokenReader = (token: Token, context: ReadContext) => JSONContent[] | null;

/** 写出的选项：降级阶梯（方言 Spec 输出 3）每一级换一组。 */
export interface WriteOptions {
    /** `keep` 按节点记下的写法写；`canonical` 一律用规范写法（跟随的写法读不回时）。 */
    readonly styles: "keep" | "canonical";
    /** `minimal` 只转义会被读成语法的字符；`full` 转义全部 ASCII 标点（再由写出器逐个撤回）。 */
    readonly escape: "minimal" | "full";
    /** 强调与删除线写成 `<strong>`、`<em>`、`<del>`。 */
    readonly htmlEmphasis: boolean;
    /**
     * 列表的符号轮换几次（`-`、`*`、`+` 轮换，有序列表在 `.` 与 `)` 之间轮换）：相邻的同类列表要读成几个列表时，每个比前一个
     * 多换一次。0 是不换。
     */
    readonly alternate: number;
}

/** 行内内容所在的位置：表格单元格里换行写 `<br>`、`|` 要转义；标题里不能有换行。 */
export interface InlinePlace {
    readonly table?: boolean;
    readonly heading?: boolean;
}

/** 写出时交给写法的上下文。写出的文字一律用 `\n` 换行，编解码器最后换成原文的换行符。 */
export interface WriteContext {
    readonly options: WriteOptions;
    /** 一个文本块（段落、标题、单元格）的行内内容。 */
    inline(node: PMNode, place?: InlinePlace): string;
    /** 一个块；写不出时抛 `Unrepresentable`。`alternate` 给容器里相邻的同类列表换符号用，不传时沿用当前的。 */
    block(node: PMNode, alternate?: number): string;
    /** 节点或标记记下的写法；`styles` 为 `canonical` 时一律为 null。 */
    style<T>(target: PMNode | Mark): T | null;
    /** 全篇的引用定义：标签（小写）→ 地址。`[注]` 只有在有同名定义时才会被读成链接；引用式链接要定义的地址就是它的地址。 */
    readonly definitions: ReadonlyMap<string, string>;
    /** 语法模块对整篇做的写前准备（`MarkdownSyntax.prepareWrite` 的结果），按模块名取；没有为 undefined。 */
    prepared<T>(syntax: string): T | undefined;
    /**
     * 一段纯文字按当前的转义级别写出（不在行首、行尾；`full` 级时带哨兵，参与降级后的逐个试撤）。图片说明这类不经行内写法的
     * 文字用它。
     */
    escape(text: string, place?: InlinePlace): string;
    /** 语言里各模块的原子转义规则（`MarkdownLexing.atomEscape`）合起来；没有时为 null 或不给。 */
    readonly atomEscape?: ((text: string, index: number) => boolean) | null;
}

/** 编解码器给写前准备的工具。 */
export interface WriteTools {
    /**
     * 一个文本块里各个标记开标签的位置，与写出时的安排一致。`canonical` 为真时按规范写法（降级后标记的开闭可能不同：只差写法
     * 的相邻同类标记合成一个）。
     */
    openings(parent: PMNode, canonical: boolean): ReadonlyArray<{readonly mark: Mark; readonly offset: number}>;
    /** 用这门语言的词法器给一段原文分词（新的词法器，没有预置的定义）。 */
    lex(source: string): Token[];
}

/** `MarkdownSyntax.contextDependents` 看到的一项。 */
export interface ContextBlock {
    readonly nodes: ReadonlyArray<PMNode>;
    /** 写原文时是这块现在的原文；重新写出时为 null。 */
    readonly raw: string | null;
}

/** 引用定义的标签按 Markdown 的规则归一：去掉两端空白、中间的空白合成一个、不分大小写（与 `marked` 的定义表一致）。 */
export const normalizeLabel = (label: string): string => label.trim().replace(/\s+/gu, " ").toLowerCase();

/** 不能与行内代码同在的标记组：行内代码自己与注音（`core/` 的 `MarkdownCode`、`ruby/`）。按组写，注音缺席时 schema 照常建。 */
export const CODE_EXCLUSIVE = "markdownCodeExclusive";

/** 写不出：写法遇到 GFM 表达不了的结构（多段单元格、没有表头的表格、合并单元格）时抛出。 */
export class Unrepresentable extends Error {}

/** 一种块节点的写法。 */
export type BlockWriter = (node: PMNode, context: WriteContext) => string;

/** 一种行内节点的写法（硬换行、图片、原样片段……）。`around` 给出前后的节点与位置：换行的写法要看它在段首、段末还是紧跟另一个换行。 */
export type InlineWriter = (node: PMNode, context: WriteContext, around: {readonly previous: PMNode | null; readonly next: PMNode | null; readonly place: InlinePlace}) => string;

/**
 * 一次开标签到闭标签（一个标记可能因为嵌套被拆成几次）：这一次的纯文字（链接据它判断能不能写成自动链接，行内代码据它定
 * 反引号），所在的文本块与开标签在块内容里的位置（文字按字、行内节点各算一个；分截批注据此判断是不是整条批注的第一截）。
 */
export interface MarkRun {
    readonly text: string;
    readonly parent: PMNode;
    readonly offset: number;
}

/** 一种标记的写法。 */
export interface MarkWriter {
    open(mark: Mark, context: WriteContext, run: MarkRun): string;
    close(mark: Mark, context: WriteContext, run: MarkRun): string;
    /** 标记里的文字原样写、不转义：行内代码，写成自动链接的链接（`<https://…>`、裸网址）。 */
    verbatim?(mark: Mark, context: WriteContext, run: MarkRun): boolean;
    /** 开闭符号能被侧翼规则吃掉的强调类标记：标记两端的空白移到标记外面写。 */
    readonly emphasis?: boolean;
    /**
     * 只盖文字的标记（注音的正文只能是纯文字）：行内节点（换行、图片、原样片段）身上的它写不出来，写出与读回校验都不管；
     * 标记在行内节点处断开。
     */
    readonly textOnly?: boolean;
}

/**
 * 一种语法。`marked` 一侧的部分（名字、分词规则、块级与行内标签、原子与转义规则）是 `MarkdownLexing`（`./marked`），不带编辑器的
 * 词法用同一份；这里加 schema、读法与写法。
 */
export interface MarkdownSyntax extends MarkdownLexing {
    /** schema、命令、键位与节点视图（Tiptap 扩展）。扩展自带的 `markdownTokenizer` 不会被登记，分词规则只来自 `marked`。 */
    readonly extensions: ReadonlyArray<AnyExtension>;
    /** 块层的词法单元类型 → 读法。同一类型有多个模块认领时，先列出的模块先试。 */
    readonly read?: Readonly<Record<string, TokenReader>>;
    /** 行内的词法单元类型 → 读法（`text`、`html` 这类类型名在块层与行内都会出现，所以分两张表）。 */
    readonly readInline?: Readonly<Record<string, TokenReader>>;
    /**
     * 读入时推导出来、写不回去的属性（节点类型 → 属性名）：读回校验不比较它们，写回被接受后按读回的值回填。例如正文单元格的
     * `align`：GFM 只有列级对齐，读入时每个单元格取所在列的对齐。
     */
    readonly derivedAttrs?: Readonly<Record<string, ReadonlyArray<string>>>;
    /** 标记看不出来、也写不出来的行内节点（硬换行）：写出与读回校验都不管它身上的标记。 */
    readonly marklessInline?: ReadonlyArray<string>;
    /**
     * 挨着写出后读回会合成一个的行内节点（节点类型 → 存原文的属性）：读回校验把标记相同的相邻几个当作属性值连起来的一个。
     * 例如原样片段 `<kbd>` 与 `</kbd>` 之间的字删光后挨着写出，读回是一个 `<kbd></kbd>`。
     */
    readonly joinedInline?: Readonly<Record<string, string>>;
    /**
     * 只在内存里用的身份属性（标记类型 → 属性名），每次读入都重新生成，例如批注的 `key`。重载时按出现顺序从两头把新读入的
     * 对齐回编辑器里的，没变的内容才认得出没变（`codec.reload`）。
     */
    readonly identityAttrs?: Readonly<Record<string, string>>;
    /**
     * 由跨块的上下文决定、读回一个窗口时对不上的属性（节点或标记类型 → 属性名）：读回校验不比较它们。例如分截批注的 `body`
     * 只写在第一截，窗口里的后几截读回来没有意见。
     */
    readonly contextAttrs?: Readonly<Record<string, ReadonlyArray<string>>>;
    /** 整篇读完之后的处理（见 `ReadResolver`）。 */
    readonly resolve?: ReadResolver;
    /**
     * 写出前对整篇做的准备（例如分截批注哪一截是第一截、要分配的 `id`），写法经 `WriteContext.prepared` 取。`blocks` 是这次
     * 写出的各项（写原文的带着原文），准备时可以参考原文里已经写着的东西。
     */
    readonly prepareWrite?: (doc: PMNode, blocks: ReadonlyArray<ContextBlock>, tools: WriteTools) => unknown;
    /**
     * 没被编辑的块里，哪些因为上下文变了要重新写出：`blocks` 是这次写出的全部项（`raw` 为 null 的是要重新写出的），返回要改为
     * 重新写出的项的下标。例如分截批注带意见的那一截所在的块被删掉，剩下的截的原文里都没有意见（输出 11）。编解码器反复调用，
     * 直到不再有新的。
     */
    readonly contextDependents?: (blocks: ReadonlyArray<ContextBlock>, prepared: unknown) => Iterable<number>;
    /**
     * 读回一个窗口后、逐块比较都通过时的整窗核对：`editor` 与 `read` 是窗口里编辑器的块与读回的块（一一对应）。返回第一个
     * 对不上的块的下标，都对得上为 -1。逐块比较不看的跨块属性（批注的分组与意见）在这里核对。
     */
    readonly verifyWindow?: (editor: ReadonlyArray<PMNode>, read: ReadonlyArray<PMNode>, prepared: unknown) => number;
    /** 写法：块节点类型、行内节点类型、标记类型 → 写法。 */
    readonly writeBlock?: Readonly<Record<string, BlockWriter>>;
    readonly writeInline?: Readonly<Record<string, InlineWriter>>;
    readonly writeMark?: Readonly<Record<string, MarkWriter>>;
}

export type {Token, Tokens};
