/**
 * 批注（docs/specs/workspace/markdown-dialect.md 输出 11）：行内 `<comment body="意见">正文</comment>`、块（开闭标签各自独占
 * 一行）与分截（每段一截行内批注，同一个 `id`，`body` 只在第一截）。旧写法 `<inline-comment>` 能读，写回成 `<comment>`。
 *
 * 编辑器里的表示：行内与分截都是 `comment` 标记，块是 `commentBlock` 节点。一条批注的各截是同一个标记（属性相同），
 * 所以标记带一个只在内存里的 `key` 区分“意见相同但不是同一条”的批注；它不写进文件，读入时按分组新分配。
 *
 * - 读：每个开标签是一截。整篇读完后按输出 11 的归属规则分组（`resolve`）：带 `body` 的截开一条新批注，没有 `body` 的截归
 *   文件顺序上它之前最近的、同 `id` 的那条，之前没有时归之后第一条，都没有时自成一条（意见为空）。同组的截拿到同样的
 *   `body` 与 `key`。
 * - 写：一条批注在写出时是几段（`prepareWrite` 用编解码器给的写出安排数）：多于一段时每段写同一个 `id`
 *   （没有就分配这个文件里没用过的最小的 `c` 加数字），`body` 只写在第一段。
 * - 上下文：带意见的那一截所在的块被删掉、或者一条批注新跨了块时，没被编辑的块的原文可能缺 `id` 或意见，按
 *   `contextDependents` 重新写出。`id`、`body`、`key` 由跨块的分组决定，读回一个窗口时对不上，读回校验不比较它们。
 */

import {Mark, mergeAttributes, Node} from "@tiptap/core";
import type {CommandProps} from "@tiptap/core";
import type {JSONContent} from "@tiptap/core";
import {Fragment, Slice} from "@tiptap/pm/model";
import {Mark as PMMark} from "@tiptap/pm/model";
import type {Node as PMNode} from "@tiptap/pm/model";
import {Plugin, PluginKey} from "@tiptap/pm/state";
import type {EditorState, Transaction} from "@tiptap/pm/state";
import {findWrapping, ReplaceStep} from "@tiptap/pm/transform";
import type {MarkedExtension, Token, Tokens} from "marked";

import {escapeAttribute} from "../../../markdown-dialect";

import {children} from "../core/write";
import {blockTagExtension, closeInline, openTagAt, openTagIndex} from "../tags";
import type {BlockTagToken} from "../tags";
import type {BlockWriter, ContextBlock, MarkdownSyntax, MarkWriter, ReadResolver, TokenReader, WriteContext, WriteTools} from "../types";

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        comment: {
            setComment: (body: string, id?: string | null) => ReturnType;
            unsetComment: () => ReturnType;
            /**
             * 给选区加一条批注（输出 11 的“新建”）：选区正好是连续的几个完整块（不止一个）时写成块批注；只在一段里时是行内
             * 批注；其余（跨段、起止在段中间）是分截批注，写回时分配 `id`。选区为空时不做。节点选区（块菜单选中的整块）包进块批注。
             */
            addComment: (body: string) => ReturnType;
        };
        commentBlock: {
            setCommentBlock: (body: string, id?: string | null) => ReturnType;
            unsetCommentBlock: () => ReturnType;
        };
    }
}

let keys = 0;
/** 新的 `key`：只在这个页面里唯一即可，不写进文件。 */
export const newCommentKey = (): string => `k${(keys += 1).toString(36)}`;

const isCommentMark = (mark: PMMark): boolean => mark.type.name === "comment";
/** 不用 `Mark.isInSet`：它找不到时返回的不是 `undefined`，类型声明与实际对不上。 */
const hasMark = (set: ReadonlyArray<PMMark>, mark: PMMark): boolean => set.some((other) => other.eq(mark));

/** 文档里用过的批注 `id`（行内与块）。 */
function usedIds(doc: PMNode): Set<string> {
    const used = new Set<string>();
    doc.descendants((node) => {
        if (node.type.name === "commentBlock" && typeof node.attrs.id === "string") used.add(node.attrs.id);
        for (const mark of node.marks) if (mark.type.name === "comment" && typeof mark.attrs.id === "string") used.add(mark.attrs.id);
    });
    return used;
}

/** 没用过的最小的 `c` 加数字。 */
function freeId(used: ReadonlySet<string>): string {
    let next = 1;
    while (used.has(`c${next}`)) next += 1;
    return `c${next}`;
}

/**
 * 粘贴进来的批注是新的批注：每条换一个新的 `key`（不与文件里意见相同的批注混成一条）；`id` 与文件里已有的相同时换一个没用过
 * 的（输出 11）。同一次粘贴里同一条批注的几截仍是同一条。
 */
function pastedComments(slice: Slice, doc: PMNode): Slice {
    const used = usedIds(doc);
    const renamed = new Map<string, {key: string; id: string | null}>();
    const remap = (fragment: Fragment): Fragment => {
        const children: PMNode[] = [];
        fragment.forEach((node) => {
            const marks = node.marks.map((mark) => {
                if (mark.type.name !== "comment") return mark;
                const group = groupOf(mark);
                let next = renamed.get(group);
                if (next === undefined) {
                    const id = typeof mark.attrs.id === "string" && mark.attrs.id !== "" ? mark.attrs.id : null;
                    next = {key: newCommentKey(), id: id !== null && used.has(id) ? freeId(used) : id};
                    if (next.id !== null) used.add(next.id);
                    renamed.set(group, next);
                }
                return mark.type.create({...mark.attrs, ...next});
            });
            children.push(node.isText ? node.mark(marks) : node.copy(remap(node.content)).mark(marks));
        });
        return Fragment.from(children);
    };
    return new Slice(remap(slice.content), slice.openStart, slice.openEnd);
}

/** 刚换进来的文字的末尾：光标还停在这里时，接着打的字也算在这些批注里（输出 36）。 */
interface Continuation {
    readonly marks: ReadonlyArray<PMMark>;
    readonly end: number;
}

const inheritKey = new PluginKey<Continuation | null>("nb-comment-inherit");

/**
 * 替换批注文字时批注不丢（docs/specs/workbench/markdown-editing.md 输出 36）：被替换掉的字全在同一条（或几条重叠的）批注里时，
 * 换进来的字补上这些批注标记。批注标记是 `inclusive: false`，选中整句打字时 ProseMirror 按“光标处的标记”给新字的标记，
 * 末尾那一端的批注不带过来，整句替换就把批注丢了（意见也没了）。
 *
 * 在 `appendTransaction` 里按替换步认，不在输入的入口上补：打字、输入法组字、粘贴、程序替换选区（例如行内 AI 改写）最后都落成
 * 这样的一步，补在一处；补的标记与替换在同一个撤销步里（ProseMirror 把追加的事务并进原事务）。只认“同一个文本块里、被换掉的
 * 每一段文字都带这条批注、换进来的是一段行内文字”的替换：整块的替换（外部重载、整块粘贴）、跨出批注的选区、纯删除都不补。
 * 换进来的字自己带着别的批注时（从别处复制的批注）不替它继承。
 *
 * 续写：选中整句再一个字一个字打新的句子时，第一个字替换了选区，补上批注之后光标在批注末尾，下一个字按非包含的规则又落到批注外，
 * 整句话只有第一个字在批注里。所以补过之后记下“刚换进来的文字的末尾”（`Continuation`，插件状态），光标没有离开时紧接着
 * 在这里插入的行内文字也补上；光标被挪走（点击、方向键）、文档在别处改了（含撤销）就不再续。
 */
function inheritComments(transactions: ReadonlyArray<Transaction>, before: EditorState, state: EditorState): Transaction | null {
    let appended: Transaction | null = null;
    let continuation: Continuation | null = null;
    const previous = inheritKey.getState(before) ?? null;
    transactions.forEach((tr, trIndex) => {
        if (!tr.docChanged) return;
        tr.steps.forEach((step, index) => {
            if (!(step instanceof ReplaceStep) || step.slice.size === 0) return;
            const {from, to, slice} = step;
            const inserted: PMNode[] = [];
            slice.content.forEach((node) => inserted.push(node));
            if (!inserted.every((node) => node.isText)) return;
            const old = tr.docs[index] as PMNode;
            let marks: PMMark[];
            if (from < to) {
                // 替换：被换掉的每一段文字都带着的批注标记。
                if (!old.resolve(from).sameParent(old.resolve(to)) || !old.resolve(from).parent.inlineContent) return;
                const perText: PMMark[][] = [];
                old.nodesBetween(from, to, (node) => {
                    if (node.isText) perText.push(node.marks.filter(isCommentMark));
                    return !node.isText;
                });
                marks = (perText[0] ?? []).filter((mark) => perText.every((here) => hasMark(here, mark)));
            } else if (previous !== null && transactions.length === 1 && tr.steps.length === 1 && from === previous.end) {
                // 续写：紧接着刚换进来的文字打字。
                marks = [...previous.marks];
            } else {
                return;
            }
            if (marks.length === 0 || inserted.some((node) => node.marks.some((mark) => isCommentMark(mark) && !hasMark(marks, mark)))) return;
            // 换进来的这一段在最终文档里的位置：映射过这一步之后的所有步。不用 `Mapping.appendMapping` 拼：它把切片底下的全部映射都追加进来，
            // 不管切片的范围。
            const mapLater = (pos: number, assoc: -1 | 1): number => transactions.slice(trIndex + 1).reduce((mapped, next) => next.mapping.map(mapped, assoc), tr.mapping.slice(index + 1).map(pos, assoc));
            const start = mapLater(from, 1);
            const end = mapLater(from + slice.size, -1);
            if (start >= end) return;
            appended ??= state.tr;
            for (const mark of marks) appended.addMark(start, end, mark);
            continuation = {marks, end};
        });
    });
    return appended === null ? null : (appended as Transaction).setMeta(inheritKey, continuation);
}

export const Comment = Mark.create({
    name: "comment",
    // 最外层：批注常跨着其它格式，在外面时被拆开的次数最少。
    priority: 1100,
    inclusive: false,
    // 两条批注可以盖住同一段文字（`key` 不同就是两个标记）。
    excludes: "",
    addAttributes() {
        return {
            id: {default: null, parseHTML: (element: HTMLElement) => element.getAttribute("id"), renderHTML: (attributes: {id?: string | null}) => (attributes.id ? {id: attributes.id} : {})},
            body: {default: "", parseHTML: (element: HTMLElement) => element.getAttribute("body") ?? "", renderHTML: (attributes: {body?: string}) => ({body: attributes.body ?? ""})},
            // 不写进文件；画到 DOM 上，编辑器自己复制出来的 HTML 才带着它，粘贴时按它分辨意见相同的不同批注（`pastedComments`）。
            key: {
                default: null,
                parseHTML: (element: HTMLElement) => element.getAttribute("data-comment-key"),
                renderHTML: (attributes: {key?: string | null}) => (attributes.key ? {"data-comment-key": attributes.key} : {}),
            },
        };
    },
    parseHTML() {
        return [{tag: "comment"}, {tag: "inline-comment"}];
    },
    renderHTML({HTMLAttributes}) {
        return ["comment", mergeAttributes(HTMLAttributes), 0];
    },
    addCommands() {
        return {
            addComment: (body: string) => ({state, tr, dispatch}: CommandProps) => {
                const {from, to, $from, $to} = state.selection;
                // 选区里没有文字（空选区、只选了换行）不加：硬换行身上的批注写不出来。
                if (from === to || state.doc.textBetween(from, to, "", "").trim() === "") return false;
                if ($from.parent !== $to.parent && $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size) {
                    const range = $from.blockRange($to);
                    const block = state.schema.nodes.commentBlock;
                    const wrapping = range === null || block === undefined ? null : findWrapping(range, block, {body, id: null});
                    if (range !== null && wrapping !== null) {
                        dispatch?.(tr.wrap(range, wrapping));
                        return true;
                    }
                }
                // 跨段时的 `id` 由写回分配（写前准备知道文件里已经写着哪些 `id`，编辑器里看不到上一次写回分配的）。
                dispatch?.(tr.addMark(from, to, this.type.create({body, id: null, key: newCommentKey()})));
                return true;
            },
            setComment: (body: string, id: string | null = null) => ({commands}) => commands.setMark(this.name, {id, body, key: newCommentKey()}),
            unsetComment: () => ({commands}) => commands.unsetMark(this.name),
        };
    },
    addProseMirrorPlugins() {
        return [
            new Plugin({key: new PluginKey("nb-comment-paste"), props: {transformPasted: (slice, view) => pastedComments(slice, view.state.doc)}}),
            new Plugin<Continuation | null>({
                key: inheritKey,
                state: {
                    init: () => null,
                    // 追加的事务带着新的“续”；选区被挪走或文档被改了（含撤销）就不再续。
                    apply: (tr, value) => (tr.getMeta(inheritKey) as Continuation | null | undefined) ?? (value !== null && !tr.docChanged && !tr.selectionSet ? value : null),
                },
                appendTransaction: (transactions, before, after) => inheritComments(transactions, before, after),
            }),
        ];
    },
});

export const CommentBlock = Node.create({
    name: "commentBlock",
    group: "block",
    content: "block+",
    defining: true,
    priority: 890,
    addAttributes() {
        return {id: {default: null}, body: {default: ""}};
    },
    parseHTML() {
        return [{
            tag: "div[data-comment-body]",
            getAttrs: (dom) => ({id: (dom as HTMLElement).getAttribute("data-comment-id"), body: (dom as HTMLElement).getAttribute("data-comment-body") ?? ""}),
        }];
    },
    renderHTML({node, HTMLAttributes}) {
        return ["div", mergeAttributes(HTMLAttributes, {class: "nb-comment-block", "data-comment-body": String(node.attrs.body ?? ""), ...(node.attrs.id ? {"data-comment-id": String(node.attrs.id)} : {})}), 0];
    },
    addCommands() {
        return {
            setCommentBlock: (body: string, id: string | null = null) => ({commands}) => commands.wrapIn(this.name, {id, body}),
            unsetCommentBlock: () => ({commands}) => commands.lift(this.name),
        };
    },
});

const NAMES = ["comment", "inline-comment"];

interface CommentToken extends Tokens.Generic {
    readonly id: string | null;
    /** 没有 `body` 属性（分截的后几截）为 null。 */
    readonly body: string | null;
    readonly tokens: Token[];
}

const tokenizer: MarkedExtension = {
    extensions: [
        {
            name: "commentInline",
            level: "inline",
            start: (src: string) => openTagIndex(src, NAMES),
            tokenizer(src: string): CommentToken | undefined {
                const open = openTagAt(src, NAMES);
                if (open === null) return undefined;
                const close = closeInline(src, open.name, open.length);
                // 里面是空的、或只有换行与空白时不认领：硬换行身上的批注写不出来，读成原样片段保住原文与意见。只有空格的照常认领
                // （空格是文字）。
                const inner = close === null ? "" : src.slice(open.length, close.start);
                if (close === null || inner === "" || (/^(?:\s|<br\s*\/?>)*$/iu.test(inner) && /[\r\n]|<br/iu.test(inner))) return undefined;
                return {
                    type: "commentInline",
                    raw: src.slice(0, close.end),
                    id: emptyToNull(open.attributes.get("id")),
                    body: open.attributes.get("body") ?? null,
                    tokens: this.lexer.inlineTokens(src.slice(open.length, close.start)),
                };
            },
        },
        blockTagExtension("commentBlock", "comment", () => true),
    ],
};

function emptyToNull(value: string | undefined): string | null {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
}

/** 一截在读入时的属性：同一截的各个节点共用这一个对象，分组时就地改。 */
interface Segment {
    id: string | null;
    body: string | null;
    key: string | null;
}

const readInline: Readonly<Record<string, TokenReader>> = {
    commentInline: (token, context) => {
        const value = token as CommentToken;
        const segment: Segment = {id: value.id, body: value.body, key: null};
        return context.mark("comment", context.inline(value.tokens), segment as unknown as Record<string, unknown>);
    },
};

const read: Readonly<Record<string, TokenReader>> = {
    commentBlock: (token, context) => {
        const value = token as unknown as BlockTagToken;
        return [{type: "commentBlock", attrs: {id: emptyToNull(value.open.attributes.get("id")), body: value.open.attributes.get("body") ?? ""}, content: context.blocks(value.tokens)}];
    },
};

/** 按文件顺序收集各截（同一截的节点共用一个属性对象，按对象去重）。 */
function segmentsOf(blocks: ReadonlyArray<ReadonlyArray<JSONContent>>): Segment[] {
    const seen = new Set<object>();
    const segments: Segment[] = [];
    const visit = (node: JSONContent): void => {
        for (const mark of node.marks ?? []) {
            if (mark.type !== "comment" || mark.attrs === undefined || seen.has(mark.attrs)) continue;
            seen.add(mark.attrs);
            segments.push(mark.attrs as unknown as Segment);
        }
        for (const child of node.content ?? []) visit(child);
    };
    for (const block of blocks) for (const node of block) visit(node);
    return segments;
}

/** 分组（输出 11 的归属规则），见文件头。 */
const resolve: ReadResolver = (blocks) => {
    const latest = new Map<string, Segment>();
    const waiting = new Map<string, Segment[]>();
    const join = (segment: Segment, head: Segment): void => {
        segment.body = head.body;
        segment.key = head.key;
    };
    for (const segment of segmentsOf(blocks)) {
        if (segment.body !== null) {
            segment.key = newCommentKey();
            if (segment.id !== null) {
                latest.set(segment.id, segment);
                for (const earlier of waiting.get(segment.id) ?? []) join(earlier, segment);
                waiting.delete(segment.id);
            }
            continue;
        }
        const head = segment.id === null ? undefined : latest.get(segment.id);
        if (head !== undefined) join(segment, head);
        else if (segment.id !== null) waiting.set(segment.id, [...(waiting.get(segment.id) ?? []), segment]);
        else join(segment, {id: null, body: "", key: newCommentKey()});
    }
    // 只有没有意见的截：同一个 `id` 的合成一条，意见为空。
    for (const group of waiting.values()) {
        const head: Segment = {id: null, body: "", key: newCommentKey()};
        for (const segment of group) join(segment, head);
    }
};

/** 一条批注（属性相同的标记）的身份。 */
const groupOf = (mark: PMMark): string => JSON.stringify([mark.attrs.id ?? null, mark.attrs.body ?? "", mark.attrs.key ?? null]);

/** 写出时一条批注的安排：用的 `id`（不需要为 null）、第一段在哪里、按原写法与规范写法安排各写成几段里多的那个。 */
interface Plan {
    readonly id: string | null;
    readonly first: {readonly parent: PMNode; readonly offset: number};
    readonly runs: number;
}

/** 一截在原文里的开标签；块批注的开标签也在里面（`block` 为真）。 */
interface RawTag {
    readonly block: boolean;
    readonly id: string | null;
    readonly body: string | null;
}

/** 各文本块里批注开标签的位置（按原写法的安排），由编解码器算出（`WriteTools.openings`）。 */
type Openings = ReadonlyMap<PMNode, ReadonlyArray<{readonly mark: PMMark; readonly offset: number}>>;

interface Prepared {
    readonly plans: ReadonlyMap<string, Plan>;
    readonly openings: Openings;
    /**
     * 全篇每条批注都只有一截、也都没有 `id`：一条批注只在一块里，别处的改动牵连不到它，不用排全篇的截（`contextDependents`
     * 直接没有），也不用给原文分词找沿用的 `id`。
     */
    readonly local: boolean;
    /** 写原文的各块里批注开标签（按出现的先后），按原文缓存。 */
    readonly rawTags: (raw: string) => ReadonlyArray<RawTag>;
}

/**
 * 一段原文里的批注开标签，按出现的先后：用词法器分词后取批注单元，行内代码、代码块与原样内容里的 `<comment>` 不算。
 */
function tagsOf(tokens: ReadonlyArray<Token>): RawTag[] {
    const tags: RawTag[] = [];
    const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        if (typeof value !== "object" || value === null) return;
        const token = value as Token & {open?: {attributes: ReadonlyMap<string, string>}};
        if (token.type === "commentInline") {
            const comment = token as unknown as CommentToken;
            tags.push({block: false, id: comment.id, body: comment.body});
        } else if (token.type === "commentBlock" && token.open !== undefined) {
            tags.push({block: true, id: emptyToNull(token.open.attributes.get("id")), body: token.open.attributes.get("body") ?? null});
        }
        // 子单元在 `tokens`、`items`（列表）、`header` 与 `rows`（表格）里。
        for (const key of ["tokens", "items", "header", "rows"]) if (key in token) visit((token as unknown as Record<string, unknown>)[key]);
    };
    visit(tokens);
    return tags;
}

/** 原文里的批注开标签，按原文缓存（见 `prepareWrite`）。 */
const rawTagCache = new Map<string, ReadonlyArray<RawTag>>();

/** 文本块里有没有批注（没有的不用排开闭，省下大部分工夫）。 */
function hasComment(node: PMNode): boolean {
    let marked = false;
    node.forEach((child) => {
        marked ||= child.marks.some((mark) => mark.type.name === "comment");
    });
    return marked;
}

/**
 * 写前准备：每条批注的段数、第一段在哪里、用的 `id`。段数按原写法与规范写法两种安排取多的（降级后只差写法的相邻同类标记
 * 合成一个，批注的开闭可能多出一段，多出的那段也要有 `id`）。第一段是批注在文件顺序上最早出现的地方，两种安排相同。
 *
 * 没有 `id` 的分截批注要分配一个：各截原文里已经写着同一个 `id`（上一次写回分配的，编辑器里还没有）并且没被别的批注占用时
 * 沿用它，否则取这个文件里没用过的最小的 `c` 加数字。沿用上一次的，别处新出现一条分截批注时，已经写好的这条不会被挤到下一个
 * 数字而整条重写。
 */
function prepareWrite(doc: PMNode, blocks: ReadonlyArray<ContextBlock>, tools: WriteTools): Prepared {
    const used = new Set<string>();
    const found: Array<{group: string; mark: PMMark; parent: PMNode; offset: number}> = [];
    const canonicalCounts = new Map<string, number>();
    const openings = new Map<PMNode, ReadonlyArray<{readonly mark: PMMark; readonly offset: number}>>();
    doc.descendants((node) => {
        if (node.type.name === "commentBlock" && typeof node.attrs.id === "string") used.add(node.attrs.id);
        if (!node.isTextblock) return true;
        if (!hasComment(node)) return false;
        const comments = tools.openings(node, false).filter(({mark}) => mark.type.name === "comment");
        openings.set(node, comments);
        for (const {mark, offset} of comments) {
            if (typeof mark.attrs.id === "string") used.add(mark.attrs.id);
            found.push({group: groupOf(mark), mark, parent: node, offset});
        }
        for (const {mark} of tools.openings(node, true)) {
            if (mark.type.name === "comment") canonicalCounts.set(groupOf(mark), (canonicalCounts.get(groupOf(mark)) ?? 0) + 1);
        }
        return false;
    });
    const rawTags = (raw: string): ReadonlyArray<RawTag> => {
        let tags = rawTagCache.get(raw);
        if (tags === undefined) {
            // 原文里根本没有这个词时不用分词（标签名不分大小写）。
            tags = /comment/iu.test(raw) ? tagsOf(tools.lex(raw)) : [];
            // 只为不让缓存无限长：没编辑的块的原文每次写回都一样，命中缓存就不用再分词。
            if (rawTagCache.size >= 4000) rawTagCache.clear();
            rawTagCache.set(raw, tags);
        }
        return tags;
    };
    const counts = new Map<string, number>();
    for (const {group} of found) counts.set(group, (counts.get(group) ?? 0) + 1);
    const ownId = (mark: PMMark): string | null => (typeof mark.attrs.id === "string" && mark.attrs.id !== "" ? mark.attrs.id : null);
    const local = used.size === 0 && found.every(({mark}) => ownId(mark) === null) && [...counts.values()].every((count) => count === 1) && [...canonicalCounts.values()].every((count) => count <= 1);
    if (local) return {plans: new Map(found.map(({group, parent, offset}) => [group, {id: null, first: {parent, offset}, runs: 1}])), openings, rawTags, local};
    // 原文里沿用的 `id`：一条没有 `id` 的分截批注，各截都在原文里、写着同一个 `id`。
    const reserved = new Map<string, string>();
    for (const [group, runs] of rawRuns(blocks, openings, rawTags).groups) {
        const first = runs[0]?.tag?.id ?? null;
        if (first === null || used.has(first) || [...reserved.values()].includes(first)) continue;
        if (runs.every((run) => run.tag?.id === first)) reserved.set(group, first);
    }
    const plans = new Map<string, Plan>();
    let next = 1;
    const freshId = (): string => {
        while (used.has(`c${next}`) || [...reserved.values()].includes(`c${next}`)) next += 1;
        used.add(`c${next}`);
        return `c${next}`;
    };
    for (const {group, mark, parent, offset} of found) {
        if (plans.has(group)) continue;
        const runs = Math.max(counts.get(group) as number, canonicalCounts.get(group) ?? 0);
        let id = ownId(mark);
        if (id === null && runs > 1) {
            id = reserved.get(group) ?? freshId();
            used.add(id);
        }
        plans.set(group, {id, first: {parent, offset}, runs});
    }
    separateSharedIds(found, plans, freshId);
    return {plans, openings, rawTags, local};
}

/**
 * 几条批注共用一个 `id`（文件在外部改过，输出 11 的“残缺的分截”）时，挪动之后按计划写出的截读回可能归错：没有意见的截归到
 * 它前面最近的那条同 `id` 批注。按计划把全篇的截都排一遍、按读入的规则分组，归错的批注里除了最先出现的那条，各换一个新的
 * `id`。换掉的那条在原文里的截仍写着旧 `id`，`contextDependents` 会让它们重新写出。
 */
function separateSharedIds(found: ReadonlyArray<{readonly group: string; readonly mark: PMMark; readonly parent: PMNode; readonly offset: number}>, plans: Map<string, Plan>, freshId: () => string): void {
    const owners = new Map<string, Set<string>>();
    for (const [group, plan] of plans) if (plan.id !== null) owners.set(plan.id, (owners.get(plan.id) ?? new Set()).add(group));
    if (![...owners.values()].some((groups) => groups.size > 1)) return;
    const prepared: Prepared = {plans, openings: new Map(), rawTags: () => [], local: false};
    const {heads} = simulate(found.map(({mark, parent, offset}) => tagOf(mark, prepared, {parent, offset})));
    const readAs = new Map<string, Set<number>>();
    const members = new Map<number, Set<string>>();
    found.forEach(({group}, index) => {
        const head = heads[index] as number;
        readAs.set(group, (readAs.get(group) ?? new Set()).add(head));
        members.set(head, (members.get(head) ?? new Set()).add(group));
    });
    const misread = (group: string): boolean => {
        const read = readAs.get(group) ?? new Set<number>();
        return read.size !== 1 || (members.get([...read][0] as number)?.size ?? 0) !== 1;
    };
    // `plans` 按首截在文件里的先后插入，所以每个 `id` 下先遇到的就是最先出现的那条。
    const kept = new Set<string>();
    for (const [group, plan] of plans) {
        if (plan.id === null || (owners.get(plan.id)?.size ?? 0) < 2 || !misread(group)) continue;
        if (!kept.has(plan.id)) kept.add(plan.id);
        else plans.set(group, {...plan, id: freshId()});
    }
}

/** 一段批注的开标签上写什么。 */
function tagOf(mark: PMMark, prepared: Prepared | undefined, run: {readonly parent: PMNode; readonly offset: number}): {readonly id: string | null; readonly body: string | null} {
    const body = String(mark.attrs.body ?? "");
    const plan = prepared?.plans.get(groupOf(mark));
    if (plan === undefined) return {id: typeof mark.attrs.id === "string" && mark.attrs.id !== "" ? mark.attrs.id : null, body: body === "" ? null : body};
    const first = plan.first.parent === run.parent && plan.first.offset === run.offset;
    // 带 `id` 的批注第一截总写 `body`（含空意见）：没有 `body` 的截会归到前面同 `id` 的那条，空意见的首截不写就和别的批注合成一条。
    return {id: plan.id, body: first && (body !== "" || plan.id !== null) ? body : null};
}

const openTag = (tag: {readonly id: string | null; readonly body: string | null}): string =>
    `<comment${tag.id === null ? "" : ` id="${escapeAttribute(tag.id)}"`}${tag.body === null ? "" : ` body="${escapeAttribute(tag.body)}"`}>`;

const writeMark: Readonly<Record<string, MarkWriter>> = {
    comment: {
        open: (mark, context, run) => openTag(tagOf(mark, context.prepared<Prepared>("comment"), run)),
        close: () => "</comment>",
    },
};

const writeBlock: Readonly<Record<string, BlockWriter>> = {
    commentBlock: (node, context: WriteContext) => {
        const open = openTag({id: typeof node.attrs.id === "string" && node.attrs.id !== "" ? node.attrs.id : null, body: node.attrs.body === "" ? null : String(node.attrs.body)});
        const body = children(node, context);
        return body.length === 0 ? `${open}\n</comment>` : `${open}\n${body.join("\n\n")}\n</comment>`;
    },
};

/** 一段批注开标签：它的分组、标记与位置（块批注的开标签为 null）。 */
interface Opening {
    readonly group: string;
    readonly mark: PMMark;
    readonly parent: PMNode;
    readonly offset: number;
}

/** 一块里按出现先后的批注开标签。 */
function openingsOf(nodes: ReadonlyArray<PMNode>, openings: Openings): Array<Opening | null> {
    const found: Array<Opening | null> = [];
    const visit = (node: PMNode): void => {
        if (node.type.name === "commentBlock") found.push(null);
        if (node.isTextblock) {
            for (const {mark, offset} of openings.get(node) ?? []) found.push({group: groupOf(mark), mark, parent: node, offset});
            return;
        }
        node.forEach(visit);
    };
    nodes.forEach(visit);
    return found;
}

/** 一截：所在的项、它的开标签、在原文里的开标签（重新写出的项里为 null）。 */
interface WrittenSegment {
    readonly block: number;
    readonly opening: Opening;
    readonly tag: RawTag | null;
}

/**
 * 全篇的批注截（按文件顺序），与原文里开标签的个数与节点对不上的项（判断不了，放进 `unknown`）。原文里的开标签按原写法的安排
 * 逐个对位。
 */
function writtenSegments(blocks: ReadonlyArray<ContextBlock>, openings: Openings, rawTags: (raw: string) => ReadonlyArray<RawTag>): {readonly segments: ReadonlyArray<WrittenSegment>; readonly unknown: ReadonlySet<number>} {
    const segments: WrittenSegment[] = [];
    const unknown = new Set<number>();
    blocks.forEach((block, index) => {
        const found = openingsOf(block.nodes, openings);
        if (found.length === 0) return;
        const tags = block.raw === null ? null : rawTags(block.raw);
        if (tags !== null && tags.length !== found.length) {
            unknown.add(index);
            return;
        }
        found.forEach((opening, at) => {
            if (opening !== null) segments.push({block: index, opening, tag: tags === null ? null : (tags[at] as RawTag)});
        });
    });
    return {segments, unknown};
}

/** 各条批注的各截（`prepareWrite` 沿用 `id` 时用）。 */
function rawRuns(blocks: ReadonlyArray<ContextBlock>, openings: Openings, rawTags: (raw: string) => ReadonlyArray<RawTag>): {readonly groups: ReadonlyMap<string, ReadonlyArray<WrittenSegment>>} {
    const groups = new Map<string, WrittenSegment[]>();
    for (const segment of writtenSegments(blocks, openings, rawTags).segments) {
        const list = groups.get(segment.opening.group);
        if (list === undefined) groups.set(segment.opening.group, [segment]);
        else list.push(segment);
    }
    return {groups};
}

/**
 * 按读入的归属规则（`resolve`）给一串开标签分组：返回每一截归到的那条（用那条首截的下标表示）与那条的意见。
 */
function simulate(tags: ReadonlyArray<{readonly id: string | null; readonly body: string | null}>): {readonly heads: number[]; readonly bodies: Map<number, string>} {
    const heads: number[] = [];
    const bodies = new Map<number, string>();
    const latest = new Map<string, number>();
    const waiting = new Map<string, number[]>();
    tags.forEach((tag, index) => {
        if (tag.body !== null) {
            heads[index] = index;
            bodies.set(index, tag.body);
            if (tag.id !== null) {
                latest.set(tag.id, index);
                for (const earlier of waiting.get(tag.id) ?? []) heads[earlier] = index;
                waiting.delete(tag.id);
            }
            return;
        }
        const head = tag.id === null ? undefined : latest.get(tag.id);
        if (head !== undefined) heads[index] = head;
        else if (tag.id !== null) waiting.set(tag.id, [...(waiting.get(tag.id) ?? []), index]);
        else {
            heads[index] = index;
            bodies.set(index, "");
        }
    });
    for (const group of waiting.values()) {
        for (const index of group) heads[index] = group[0] as number;
        bodies.set(group[0] as number, "");
    }
    return {heads, bodies};
}

/**
 * 没被编辑的块里哪些要重新写出（输出 11）。把全篇的批注开标签按这次会写出的样子排成一串：写原文的截取原文里的开标签，重新
 * 写出的截取 `tagOf` 的安排，再按读入的归属规则（`simulate`）分组。一条批注的各截读回来仍是这一条、没有混进别的批注、意见
 * 相同时，原文保留；否则（带意见的那一截没了、两截都带意见、挪动后没有意见的截归到了别的批注……）这条批注与读回时和它混在
 * 一起的批注所涉及的块都重新写出。编解码器会反复调用，直到不再有新的。
 *
 * 原文里开标签的个数与节点对不上的块（判断不了）直接重新写出。
 */
function contextDependents(blocks: ReadonlyArray<ContextBlock>, prepared: unknown): Set<number> {
    const typed = prepared as Prepared;
    if (typed.local) return new Set();
    const {segments, unknown} = writtenSegments(blocks, typed.openings, typed.rawTags);
    const dependents = new Set(unknown);
    const tags = segments.map((segment) => segment.tag ?? tagOf(segment.opening.mark, typed, segment.opening));
    const {heads, bodies} = simulate(tags);
    // 每条批注读回时归到的那条（首截下标）；每条读回的批注收了哪几条批注的截。
    const readAs = new Map<string, Set<number>>();
    const members = new Map<number, Set<string>>();
    segments.forEach((segment, index) => {
        const head = heads[index] as number;
        readAs.set(segment.opening.group, (readAs.get(segment.opening.group) ?? new Set()).add(head));
        members.set(head, (members.get(head) ?? new Set()).add(segment.opening.group));
    });
    const broken = new Set<string>();
    for (const [group, read] of readAs) {
        const head = [...read][0] as number;
        const body = (JSON.parse(group) as [unknown, string])[1];
        if (read.size !== 1 || (members.get(head)?.size ?? 0) !== 1 || bodies.get(head) !== body) {
            for (const other of read) for (const member of members.get(other) ?? []) broken.add(member);
        }
    }
    for (const segment of segments) if (broken.has(segment.opening.group) && blocks[segment.block]?.raw !== null) dependents.add(segment.block);
    return dependents;
}

/**
 * 读回窗口的整窗核对（逐块比较不看批注的 `id`、`body`、`key`）：编辑器里的每条批注与读回的每条批注按覆盖的字一一对应
 * （一条没被拆成两条、两条没被合成一条）；读回带着意见的，意见相同。返回第一个对不上的块。
 */
function verifyWindow(editor: ReadonlyArray<PMNode>, read: ReadonlyArray<PMNode>): number {
    // 每条批注覆盖的位置（窗口里文字按字、行内节点各算一个，硬换行不算：它身上的标记看不出来），与它所在的第一个块。
    const cover = (nodes: ReadonlyArray<PMNode>, groupKey: (mark: PMMark) => string): Map<string, {positions: number[]; block: number; mark: PMMark}> => {
        const groups = new Map<string, {positions: number[]; block: number; mark: PMMark}>();
        let position = 0;
        // 挨着的、标记相同的同类行内节点算一个位置：挨着的原样片段读回合成一个（`MarkdownSyntax.joinedInline`）。
        let previous: PMNode | null = null;
        nodes.forEach((top, block) => {
            top.descendants((node) => {
                if (!node.isInline) {
                    previous = null;
                    return true;
                }
                if (node.type.name === "hardBreak") return false;
                const merged = !node.isText && previous !== null && previous.type === node.type && PMMark.sameSet(previous.marks, node.marks);
                previous = node.isText ? null : node;
                if (merged) return false;
                const size = node.isText ? (node.text as string).length : 1;
                for (const mark of node.marks) {
                    if (mark.type.name !== "comment") continue;
                    const key = groupKey(mark);
                    const group = groups.get(key) ?? {positions: [], block, mark};
                    for (let at = 0; at < size; at += 1) group.positions.push(position + at);
                    groups.set(key, group);
                }
                position += size;
                return false;
            });
        });
        return groups;
    };
    const mine = cover(editor, groupOf);
    // 两条批注可以盖住同样的字：同样位置的读回批注一一取用。
    const theirs = new Map<string, Array<{positions: number[]; block: number; mark: PMMark}>>();
    for (const group of cover(read, (mark) => String(mark.attrs.key)).values()) theirs.set(group.positions.join(","), [...(theirs.get(group.positions.join(",")) ?? []), group]);
    let matched = 0;
    for (const [group, {positions, block, mark}] of mine) {
        // 同样的位置有几条时先找意见相同的，再找读回没有意见的（意见写在窗口外的另一截上）。
        const candidates = theirs.get(positions.join(",")) ?? [];
        const body0 = String(mark.attrs.body ?? "");
        let pick = candidates.findIndex((candidate) => String(candidate.mark.attrs.body ?? "") === body0);
        if (pick < 0) pick = candidates.findIndex((candidate) => String(candidate.mark.attrs.body ?? "") === "");
        const other = pick < 0 ? undefined : candidates.splice(pick, 1)[0];
        if (other === undefined) return block;
        matched += 1;
        // 意见可能写在窗口外的另一截上（窗口里读回为空）：读回带着意见时才比较。
        const body = String(other.mark.attrs.body ?? "");
        if (body !== "" && body !== String(mark.attrs.body ?? "")) return block;
    }
    const remaining = [...theirs.values()].reduce((sum, list) => sum + list.length, 0);
    return remaining === 0 && matched === mine.size ? -1 : 0;
}

export const commentSyntax: MarkdownSyntax = {
    name: "comment",
    extensions: [Comment, CommentBlock],
    marked: [tokenizer],
    read,
    readInline,
    resolve,
    writeMark,
    writeBlock,
    prepareWrite,
    contextDependents,
    verifyWindow,
    contextAttrs: {comment: ["id", "body", "key"]},
    identityAttrs: {comment: "key"},
    blockOpens: {comment: () => true},
    inlineTags: NAMES,
};
