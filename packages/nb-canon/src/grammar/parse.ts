/**
 * 条目主文字的读法（docs/specs/canon/rendering.md 输出 1、17、21；ADR 0064 决策 2）：标签先由 `tags.ts` 在原文上认出，作为原子交给
 * nb-markdown 的词法（`@notnotype/nb-markdown/marked`，与章节编辑器同一份 Markdown 配置），遮罩着分词；每个标签落在哪由
 * `lexAtoms` 交回，这里据此给每个标签一个去处。编辑器的条目语法模块用同一个 `entryLexing`，所以两边认出的标签与落点相同。
 *
 * `If` 的配对在分完词以后做：分词规则把每个完整的标签都认成一个叶子单元，这里在同一层的兄弟单元里配对 `If`、`ElseIf`、`Else`
 * 与 `</If>`。转义的与代码里的闭标签不成单元，不会被当成配对；被强调、链接切开的分支落在别的层，配不上（w00055 t02 omp 设计审查第 3 条）。
 */

import {atomAt, coreLexing, createLexing, isAtomIdentity, lexAtoms, type AtomPlacement, type MarkdownLexing} from "@notnotype/nb-markdown/marked";
import type {MarkedExtension, Token} from "marked";

import {atomSpanOf, lexTags, type LexedTag} from "./tags";

/**
 * 一个标签的去处：
 * - `live`：正文里，按它的意思解释；
 * - `code`、`escaped`：行内代码、代码块里，或前面有转义：字面，照原文显示；
 * - `prose`：写坏的标签落在正文里（是不是错由写入检查按名字判断）；
 * - `link`、`image`：链接地址、链接标题、引用定义、图片说明里（`tag-not-live`）；
 * - `opaque`：原样 HTML、脚注、数学这类白名单以外的单元里（那个单元本身拒收）；
 * - `lost`：Markdown 的规则把它丢了（表格里多出来的单元格），或落点不止一种、说不清（失败关闭）。
 */
export type TagPlace = "live" | "code" | "escaped" | "prose" | "link" | "image" | "opaque" | "lost";

export interface EntryTag extends LexedTag {
    readonly place: TagPlace;
}

export type GrammarCode = "too-many-tags" | "cross-block" | "tag-malformed" | "tag-not-live" | "unsupported-markdown" | "unknown-tag" | "forbidden-syntax" | "no-field-expression";

/** 一处问题：码、在原文里的偏移（行列由 `positionOf` 算）、说明；关于某个标签的带它的序号。 */
export interface GrammarProblem {
    readonly code: GrammarCode;
    readonly offset: number;
    readonly message: string;
    readonly tag?: number;
}

/** 分词规则给每个完整的标签的单元；`tag` 是标签的序号（`parseEntryText` 在分完词以后填）。 */
export interface EntryTagToken {
    readonly type: "entryTag";
    readonly raw: string;
    /** 标签在原文里的起点。 */
    readonly from: number;
    tag: number;
}

/** 配好对的条件：`tokens` 是从开标签到闭标签的兄弟单元（含这几个标签自己），`branches` 是按分支标签切开的各支。 */
export interface EntryIfToken {
    readonly type: "entryIf";
    readonly raw: string;
    readonly tokens: Token[];
    /** 开标签与闭标签的序号。 */
    readonly open: number;
    readonly close: number;
    /** 各支：起头的标签（`If`、`ElseIf` 或 `Else`）的序号与这一支的单元。 */
    readonly branches: ReadonlyArray<{readonly head: number; readonly tokens: readonly Token[]}>;
}

export interface ParsedEntryText {
    readonly source: string;
    /** 词法单元；配好对的条件换成了 `entryIf`。没分词（标签太多）时为空。 */
    readonly tokens: readonly Token[];
    readonly tags: readonly EntryTag[];
    /** 结构上的问题（标签太多、条件配不上、落点不对）；名字与属性由 `check.ts` 判断。按偏移排。 */
    readonly problems: readonly GrammarProblem[];
}

const FILLER = String.fromCharCode(0xf8fe);

/** `atoms` 与解析各要一次词法：同一份原文连着用两次，留最近一次的结果。 */
let lastLexed: {readonly source: string; readonly tags: LexedTag[]} | null = null;
function tagsOf(source: string): LexedTag[] {
    if (lastLexed?.source !== source) lastLexed = {source, tags: lexTags(source)};
    return lastLexed.tags;
}

/** 认领遮罩后的完整标签：`<`、占位的身份字、填充字、`>`。写坏的标签没有收尾的 `>`，照文字。 */
const entryTagExtension: MarkedExtension = {
    extensions: [
        {
            name: "entryTag",
            level: "inline",
            start(src: string) {
                for (let at = src.indexOf("<"); at >= 0; at = src.indexOf("<", at + 1)) if (isAtomIdentity(src[at + 1])) return at;
                return undefined;
            },
            tokenizer(src: string) {
                if (src[0] !== "<" || !isAtomIdentity(src[1])) return undefined;
                const atom = atomAt(this.lexer, src[1] as string);
                // 原文里的私用区字自己是一个原子，原文是那一个字；标签的原子以名字（或闭标签的 `/`）开头。
                if (atom === undefined || !/^[A-Z/]/u.test(atom.source)) return undefined;
                let end = 2;
                while (src[end] === FILLER) end += 1;
                if (src[end] !== ">" || end - 1 !== atom.to - atom.from) return undefined;
                const token: EntryTagToken = {type: "entryTag", raw: src.slice(0, end + 1), from: atom.from - 1, tag: -1};
                return token;
            },
        },
    ],
};

/**
 * 条目标签在 `marked` 一侧的部分：原子、分词规则与写回时的转义（`<` 紧跟大写字母或 `/` 加大写字母时前面加反斜杠：编辑器写出的
 * “评级 <A 级”是 `评级 \<A 级`，读回不变）。编辑器的条目语法模块在它上面加 schema、读法与写法。
 */
export const entryLexing: MarkdownLexing = {
    name: "canon-entry",
    marked: [entryTagExtension],
    atoms: (source) => tagsOf(source).map(atomSpanOf),
    atomEscape: (text, index) => text[index] === "<" && /^\/?[A-Z]/u.test(text.slice(index + 1, index + 3)),
};

const lexing = createLexing([entryLexing, coreLexing]);

/** 写成 `\<`：`<` 前面有奇数个反斜杠。 */
function escapedAt(source: string, start: number): boolean {
    let count = 0;
    for (let index = start - 1; index >= 0 && source[index] === "\\"; index -= 1) count += 1;
    return count % 2 === 1;
}

const CODE = new Set(["code", "codespan"]);
const TEXT = new Set(["text", "escape"]);
const LINK = new Set(["link", "def"]);

function placeOf(tag: LexedTag, placements: readonly AtomPlacement[], source: string): TagPlace {
    const places = new Set<TagPlace>();
    for (const placement of placements) {
        const type = placement.token.type;
        if (type === "entryTag") places.add(placement.ancestors.some((token) => token.type === "image") ? "image" : "live");
        else if (CODE.has(type)) places.add("code");
        else if (TEXT.has(type)) places.add(escapedAt(source, tag.start) ? "escaped" : tag.kind === "malformed" ? "prose" : "lost");
        else if (LINK.has(type)) places.add("link");
        else if (type === "image") places.add("image");
        else places.add("opaque");
    }
    if (places.size === 0) return "lost";
    if (places.size === 1) return [...places][0] as TagPlace;
    // 一个标签只能有一个去处；引用式链接的地址在定义与用到它的链接里各出现一次，都是链接。既是活的又落在别处的，`marked` 17 里
    // 构造不出来，留着是失败关闭：以后的版本若把同一段文字既分词又留在别的字段里，宁可拒收也不读错。
    if (places.has("live") || places.has("lost")) return "lost";
    for (const place of ["image", "link", "opaque", "code", "escaped", "prose"] as const) if (places.has(place)) return place;
    return "lost";
}

/** 一个单元下面的各层单元列表：`tokens`、列表的 `items`、表格单元格的 `tokens`、条件各支的 `tokens`。 */
export function childLists(token: Token): Token[][] {
    const lists: Token[][] = [];
    for (const value of Object.values(token as unknown as Record<string, unknown>)) {
        if (!Array.isArray(value)) continue;
        for (const item of value as unknown[]) {
            if (Array.isArray(item)) {
                for (const cell of item as Array<{tokens?: Token[]}>) if (Array.isArray(cell?.tokens)) lists.push(cell.tokens);
            } else if (item !== null && typeof item === "object" && !("type" in item) && Array.isArray((item as {tokens?: unknown}).tokens)) {
                lists.push((item as {tokens: Token[]}).tokens);
            }
        }
        if ((value as unknown[]).some((item) => item !== null && typeof item === "object" && "type" in (item as object))) lists.push(value as Token[]);
    }
    return lists;
}

/**
 * 在每一层的兄弟单元里配对条件，配好的换成 `entryIf`（就地改列表）。`inside` 表示这一层在某个条件的一支里面：那里出现的 `If` 是套着的，
 * 出现的分支标签与闭标签是被强调、链接切开的。图片说明里的不配（那里的标签都不是活的）。
 */
function groupConditions(list: Token[], tags: readonly EntryTag[], problems: GrammarProblem[], inside: boolean): void {
    const tagOf = (token: Token): EntryTag | null => (token.type === "entryTag" ? (tags[(token as unknown as EntryTagToken).tag] ?? null) : null);
    const isOpen = (tag: EntryTag | null) => tag !== null && tag.name === "If" && tag.kind === "open";
    const isClose = (tag: EntryTag | null) => tag !== null && tag.name === "If" && tag.kind === "close";
    const isBranch = (tag: EntryTag | null) => tag !== null && (tag.name === "ElseIf" || tag.name === "Else") && tag.kind === "self";
    const result: Token[] = [];
    for (let index = 0; index < list.length; index += 1) {
        const token = list[index] as Token;
        const tag = tagOf(token);
        if (isOpen(tag)) {
            const open = tag as EntryTag;
            if (inside) problems.push({code: "cross-block", offset: open.start, message: "If cannot be nested in another If", tag: open.index});
            let depth = 0;
            let closeAt = -1;
            for (let next = index; next < list.length; next += 1) {
                const inner = tagOf(list[next] as Token);
                if (isOpen(inner)) depth += 1;
                else if (isClose(inner)) depth -= 1;
                if (depth === 0) {
                    closeAt = next;
                    break;
                }
            }
            if (closeAt < 0) {
                problems.push({code: "cross-block", offset: open.start, message: "If is not closed in the same paragraph, or emphasis or a link cuts it", tag: open.index});
                result.push(token);
                continue;
            }
            const run = list.slice(index, closeAt + 1);
            const branches: Array<{head: number; tokens: Token[]}> = [{head: open.index, tokens: []}];
            let seenElse = false;
            let level = 0;
            for (const member of run.slice(1, -1)) {
                const inner = tagOf(member);
                if (isOpen(inner)) level += 1;
                if (level === 0 && isBranch(inner)) {
                    const branch = inner as EntryTag;
                    if (seenElse) problems.push({code: "tag-malformed", offset: branch.start, message: `<${branch.name}> after <Else> in the same If`, tag: branch.index});
                    seenElse ||= branch.name === "Else";
                    branches.push({head: branch.index, tokens: []});
                } else (branches[branches.length - 1] as {tokens: Token[]}).tokens.push(member);
                if (isClose(inner)) level -= 1;
            }
            // 各支往下分组（含各单元里面的层）：套着的条件照样配对并报 cross-block。`tokens` 留着没分组的原样，读各支以 `branches` 为准。
            for (const branch of branches) groupConditions(branch.tokens, tags, problems, true);
            const entryIf: EntryIfToken = {type: "entryIf", raw: run.map((member) => member.raw).join(""), tokens: run, open: open.index, close: (tagOf(run[run.length - 1] as Token) as EntryTag).index, branches};
            result.push(entryIf as unknown as Token);
            index = closeAt;
            continue;
        }
        if (isClose(tag) || isBranch(tag)) {
            const marker = tag as EntryTag;
            problems.push(
                inside
                    ? {code: "cross-block", offset: marker.start, message: `<${marker.closing ? "/" : ""}${marker.name}> is cut off from its If by emphasis or a link`, tag: marker.index}
                    : {code: "tag-malformed", offset: marker.start, message: `<${marker.closing ? "/" : ""}${marker.name}> without an open <If>`, tag: marker.index},
            );
        }
        if (token.type !== "image") for (const child of childLists(token)) groupConditions(child, tags, problems, inside);
        result.push(token);
    }
    list.splice(0, list.length, ...result);
}

/** 读一块主文字（已规范化：没有 BOM、换行是 LF）。只读结构，名字与属性由 `check.ts` 判断。 */
export function parseEntryText(source: string): ParsedEntryText {
    const lexed = tagsOf(source);
    const result = lexAtoms(lexing, source);
    if (!result.ok) {
        const tags = lexed.map((tag) => ({...tag, place: "lost" as const}));
        return {source, tokens: [], tags, problems: [{code: "too-many-tags", offset: 0, message: `${String(result.count)} tags and private-use characters; split the block`}]};
    }
    const byFrom = new Map(lexed.map((tag) => [tag.start + 1, tag]));
    const places = new Map<number, TagPlace>();
    for (const atom of result.atoms) {
        const tag = byFrom.get(atom.from);
        if (tag === undefined) continue;
        const placements = result.placements[atom.index] ?? [];
        places.set(tag.index, placeOf(tag, placements, source));
        for (const placement of placements) if (placement.token.type === "entryTag") (placement.token as unknown as EntryTagToken).tag = tag.index;
    }
    const tags: EntryTag[] = lexed.map((tag) => ({...tag, place: places.get(tag.index) ?? "lost"}));
    const problems: GrammarProblem[] = [];
    for (const tag of tags) {
        if (tag.place === "link" || tag.place === "image") problems.push({code: "tag-not-live", offset: tag.start, message: `<${tag.name}> inside a link address, title or image description is not read; move it into the text`, tag: tag.index});
        if (tag.place === "lost") problems.push({code: "tag-not-live", offset: tag.start, message: `<${tag.name}> lands where Markdown drops or misreads it (for example an extra table cell)`, tag: tag.index});
    }
    const tokens = [...result.tokens];
    groupConditions(tokens, tags, problems, false);
    return {source, tokens, tags, problems: problems.sort((left, right) => left.offset - right.offset)};
}
