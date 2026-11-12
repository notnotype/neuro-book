/**
 * 批注的数据操作（docs/specs/workbench/markdown-editing.md 输出 28–35）：列出、找、改意见、去掉、跳转与标出。纯 Tiptap，不认识
 * 界面；浮层、页边与卡片在宿主的控件里。批注的格式见 docs/specs/workspace/markdown-dialect.md 输出 11，语法与编解码器在
 * `language/syntax/comment`。
 *
 * - **一条批注**：行内与分截批注是 `comment` 标记，同一条的各截带同一个 `key`（只在内存里，读入时按文件先后编号）；块批注是
 *   `commentBlock` 节点，没有 `key`。所以对外按“序号加指纹”找（`CommentRef`）：序号是按下面的先后排的第几条，指纹是意见与被批注的
 *   开头文字。控件拿不到“正文是不是被程序重载过”的可靠信号（重载与写回回填走同一条不进历史的事务），卡片显示之后文档可能已经
 *   变了，所以每个动作都在最新的文档里按指纹核对，对不上就不做。
 * - **先后**：起点靠前的在前（块批注的起点是块里第一个文字处，分截的批注按第一截），起点相同时终点靠前的在前，仍相同时块批注在
 *   前（外层），再相同时 `key` 里的数小的在前。不依赖标记集合里的顺序：改意见会重排标记，序号不能因此变。
 * - **只动目标那一条**：两条批注可以盖住同一段（`excludes: ""`），按标记类型 `removeMark`/`unsetMark` 会把它们一起去掉；这里只
 *   按标记实例动手，并把排在目标后面的批注标记按原先后加回，编辑器里标记集合的顺序不变。已知限制：写回文件时编解码器按它的规则
 *   排同一段上重叠批注的内外（读入时里层的编号靠前，写出时第一个标记当外层），保存并重新打开后这两条的先后可能互换（不改意见只打字
 *   也一样，是编解码器既有的行为）；批注靠意见加开头文字认，所以不会因此改错。
 */

import {Extension} from "@tiptap/core";
import type {Editor} from "@tiptap/core";
import type {Mark, Node as PMNode, NodeRange} from "@tiptap/pm/model";
import {Plugin, PluginKey, TextSelection} from "@tiptap/pm/state";
import type {EditorState} from "@tiptap/pm/state";
import {findWrapping} from "@tiptap/pm/transform";
import {Decoration, DecorationSet} from "@tiptap/pm/view";

interface Range {
    from: number;
    to: number;
}

export interface CommentInfo {
    /** 按文档先后排的序号，从 0 起；只在这一个文档状态里有效。 */
    readonly index: number;
    readonly body: string;
    /** 被批注的开头文字（至多 `QUOTE_LENGTH` 个字），与意见一起是指纹。 */
    readonly quote: string;
    readonly block: boolean;
    /** 光标放到“开头”时的位置：行内是第一截的起点，块批注是块里第一个文字处。 */
    readonly start: number;
    readonly end: number;
    /** 各截的范围；块批注是整个节点（含两端）。 */
    readonly segments: ReadonlyArray<Readonly<Range>>;
    /** 身份：标记的 `key`，块批注是 `b` 加位置。同一个事务里区分各条批注（卡片的 `v-for`），块批注的位置一变它就变，所以不能当跨事务稳定的 key（页边卡片的 key 见 `MarkdownCommentLayer`）。 */
    readonly identity: string;
    /** 同一条的各截的分组键（标记的 `key`；没有 `key` 的退回 `id` 加意见）；块批注为 null。 */
    readonly group: string | null;
}

/** 指纹：序号加上显示卡片那一刻的意见与开头文字。 */
export interface CommentRef {
    readonly index: number;
    readonly body: string;
    readonly quote: string;
}

const QUOTE_LENGTH = 40;

const isComment = (mark: Mark): boolean => mark.type.name === "comment";
const groupOf = (mark: Mark): string => (typeof mark.attrs.key === "string" && mark.attrs.key !== "" ? mark.attrs.key : `~${String(mark.attrs.id ?? "")}|${String(mark.attrs.body ?? "")}`);

/** `key` 是 `k` 加 base36 计数（`newCommentKey`）；按数比，字符串序里 `k10` 在 `k2` 之前。 */
function keyRank(group: string): number {
    const match = /^k([0-9a-z]+)$/u.exec(group);
    return match === null ? Number.MAX_SAFE_INTEGER : Number.parseInt(match[1] as string, 36);
}

/** 块里第一个与最后一个文本块的内容范围；没有文本块时取节点内部。 */
function textBounds(node: PMNode, pos: number): Range {
    let from = -1;
    let to = -1;
    node.descendants((child, offset) => {
        if (!child.isTextblock) return true;
        const at = pos + 1 + offset;
        if (from < 0) from = at + 1;
        to = at + 1 + child.content.size;
        return false;
    });
    return from < 0 ? {from: pos + 1, to: pos + node.nodeSize - 1} : {from, to};
}

interface Raw {
    readonly block: boolean;
    readonly group: string | null;
    readonly body: string;
    readonly segments: Range[];
    readonly start: number;
    end: number;
    readonly quote: string;
}

/** 文档里的全部批注，按先后排好并编号。每个事务现算：五万字、两百条批注约 0.1 毫秒，不值得缓存（缓存反而让序号对着旧文档）。 */
export function listComments(doc: PMNode): CommentInfo[] {
    const grouped = new Map<string, Raw>();
    const raws: Raw[] = [];
    doc.descendants((node, pos) => {
        if (node.type.name === "commentBlock") {
            const bounds = textBounds(node, pos);
            raws.push({
                block: true,
                group: null,
                body: String(node.attrs.body ?? ""),
                segments: [{from: pos, to: pos + node.nodeSize}],
                start: bounds.from,
                end: bounds.to,
                quote: doc.textBetween(pos + 1, pos + node.nodeSize - 1, " ", " ").slice(0, QUOTE_LENGTH),
            });
            return true;
        }
        if (!node.isText) return true;
        for (const mark of node.marks) {
            if (!isComment(mark)) continue;
            const group = groupOf(mark);
            const found = grouped.get(group);
            if (found === undefined) {
                const raw: Raw = {block: false, group, body: String(mark.attrs.body ?? ""), segments: [{from: pos, to: pos + node.nodeSize}], start: pos, end: pos + node.nodeSize, quote: ""};
                grouped.set(group, raw);
                raws.push(raw);
                continue;
            }
            const last = found.segments[found.segments.length - 1] as Range;
            // 同一条的相邻文本节点（别的格式把它切开）接成一截。
            if (last.to === pos) last.to = pos + node.nodeSize;
            else found.segments.push({from: pos, to: pos + node.nodeSize});
            found.end = pos + node.nodeSize;
        }
        return true;
    });
    const rank = (raw: Raw): number => (raw.group === null ? 0 : keyRank(raw.group));
    raws.sort((a, b) => a.start - b.start || a.end - b.end || Number(b.block) - Number(a.block) || rank(a) - rank(b));
    return raws.map((raw, index): CommentInfo => ({
        index,
        body: raw.body,
        quote: raw.block ? raw.quote : doc.textBetween((raw.segments[0] as Range).from, (raw.segments[0] as Range).to, " ", " ").slice(0, QUOTE_LENGTH),
        block: raw.block,
        start: raw.start,
        end: raw.end,
        segments: raw.segments,
        identity: raw.block ? `b${(raw.segments[0] as Range).from}` : (raw.group as string),
        group: raw.group,
    }));
}

/**
 * 光标处的批注（输出 30）：行内批注是光标落在文字上或紧挨着它的两端（只有一个字的批注也有光标位置），块批注是光标在块里任何一处。
 * 选区不空时没有。
 */
export function commentsAt(state: EditorState): CommentInfo[] {
    const {selection} = state;
    return selection.empty ? commentsAtPos(state.doc, selection.from) : [];
}

/** 某个位置上的批注（悬停，输出 30）：判断同 `commentsAt`，不看选区。重叠的几条按先后排。 */
export function commentsAtPos(doc: PMNode, pos: number): CommentInfo[] {
    return listComments(doc).filter((info) => info.segments.some((segment) => (info.block ? pos > segment.from && pos < segment.to : pos >= segment.from && pos <= segment.to)));
}

/**
 * 按指纹找：序号处的批注指纹对得上就是它；对不上时（前面多了或少了几条）在整份文档里找指纹相同的，只有唯一一条才算；
 * 意见或开头文字变了、或有几条指纹相同，都找不到。
 */
export function findComment(doc: PMNode, ref: CommentRef): CommentInfo | null {
    return matchComment(listComments(doc), ref);
}

/** `findComment` 的规则用在已经排好的一份列表上（页边按它决定哪张卡片展开，两条指纹相同的批注不能一起展开）。 */
export function matchComment(list: ReadonlyArray<CommentInfo>, ref: CommentRef): CommentInfo | null {
    const same = (info: CommentInfo): boolean => info.body === ref.body && info.quote === ref.quote;
    const at = list[ref.index];
    if (at !== undefined && same(at)) return at;
    const matches = list.filter(same);
    return matches.length === 1 ? (matches[0] as CommentInfo) : null;
}

export const refOf = (info: CommentInfo): CommentRef => ({index: info.index, body: info.body, quote: info.quote});

/** 目标那一条在 `from`–`to` 这一段文字上的标记，及排在它后面的批注标记（先后要保持）。 */
function inTextNodes(doc: PMNode, info: CommentInfo, visit: (range: Range, target: Mark, later: Mark[]) => void): void {
    for (const segment of info.segments) {
        doc.nodesBetween(segment.from, segment.to, (node, pos) => {
            if (!node.isText) return true;
            const comments = node.marks.filter(isComment);
            const at = comments.findIndex((mark) => groupOf(mark) === info.group);
            if (at < 0) return false;
            visit({from: Math.max(pos, segment.from), to: Math.min(pos + node.nodeSize, segment.to)}, comments[at] as Mark, comments.slice(at + 1));
            return false;
        });
    }
}

/** 改意见：这条批注的各截同一步（输出 35）。找不到返回 false；意见没变不动文档，返回 true。 */
export function setCommentBody(editor: Editor, ref: CommentRef, body: string): boolean {
    const {state} = editor;
    const info = findComment(state.doc, ref);
    if (info === null) return false;
    if (info.body === body) return true;
    const tr = state.tr;
    if (info.block) {
        const at = (info.segments[0] as Range).from;
        const node = state.doc.nodeAt(at);
        if (node === null) return false;
        tr.setNodeMarkup(at, undefined, {...node.attrs, body});
    } else {
        inTextNodes(state.doc, info, (range, target, later) => {
            // 先去掉目标与排在它后面的，再按原先后加回：新加的标记排在同类的最后，直接去掉再加会让目标换到后面。
            for (const mark of [target, ...later]) tr.removeMark(range.from, range.to, mark);
            tr.addMark(range.from, range.to, target.type.create({...target.attrs, body}));
            for (const mark of later) tr.addMark(range.from, range.to, mark);
        });
    }
    editor.view.dispatch(tr);
    return true;
}

/** 去掉这一条批注（输出 34）：标记（块批注是容器）去掉，文字留着。块批注里的内容放不回它所在的位置时不动，返回 false。 */
export function removeComment(editor: Editor, ref: CommentRef): boolean {
    const {state} = editor;
    const info = findComment(state.doc, ref);
    if (info === null) return false;
    const tr = state.tr;
    if (info.block) {
        const at = (info.segments[0] as Range).from;
        const node = state.doc.nodeAt(at);
        if (node === null) return false;
        const $at = state.doc.resolve(at);
        if (!$at.parent.canReplace($at.index(), $at.index() + 1, node.content)) return false;
        tr.replaceWith(at, at + node.nodeSize, node.content);
        // 整个容器换成它的内容，原来落在里面的光标会被映射到被替换范围的一端；容器的开标记没有了，里面的位置各减 1，后面的各减 2（输出 34：删后光标留在原处）。
        const {anchor, head} = state.selection;
        const end = at + node.nodeSize;
        const shift = (pos: number): number => (pos <= at ? pos : pos < end ? pos - 1 : pos - 2);
        if (state.selection instanceof TextSelection) tr.setSelection(TextSelection.create(tr.doc, shift(anchor), shift(head)));
    } else {
        inTextNodes(state.doc, info, (range, target) => {
            tr.removeMark(range.from, range.to, target);
        });
    }
    editor.view.dispatch(tr);
    return true;
}

/** 把这一块包进批注块要的范围与包装；位置上没有块、批注块放不进它的父级时为 null。 */
function wrapBlock(doc: PMNode, pos: number, body: string): {readonly range: NodeRange; readonly wrapping: NonNullable<ReturnType<typeof findWrapping>>} | null {
    // 位置可能是卡片显示之后文档变短之前记下的：`nodeAt` 对文档外的位置抛错。
    const node = pos > doc.content.size ? null : doc.nodeAt(pos);
    const type = doc.type.schema.nodes.commentBlock;
    if (node === null || !node.isBlock || type === undefined) return null;
    const range = doc.resolve(pos).blockRange(doc.resolve(pos + node.nodeSize));
    const wrapping = range === null ? null : findWrapping(range, type, {body, id: null});
    return range === null || wrapping === null ? null : {range, wrapping};
}

/**
 * 这一块能不能包进块批注（输出 28：块菜单给代码块、引用、表格、分割线等整块加批注）。按位置，不看选区：表格的节点选区会被表格插件
 * 换成单元格选区，靠选区做不稳。
 */
export const canCommentBlockAt = (doc: PMNode, pos: number): boolean => wrapBlock(doc, pos, "") !== null;

/** 把这一块整个包进一条块批注（输出 28）。包不进去或意见为空返回 false，文档不变。 */
export function addBlockComment(editor: Editor, pos: number, body: string): boolean {
    const found = body === "" ? null : wrapBlock(editor.state.doc, pos, body);
    if (found === null) return false;
    editor.view.dispatch(editor.state.tr.wrap(found.range, found.wrapping));
    return true;
}

/** 光标放到这条批注的开头并滚进视野（输出 31）；不聚焦，焦点归宿主管。 */
export function gotoComment(editor: Editor, ref: CommentRef): boolean {
    const {state} = editor;
    const info = findComment(state.doc, ref);
    if (info === null) return false;
    editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, info.start)).scrollIntoView());
    return true;
}

/** 正在显示卡片的那条批注在正文里的标出（输出 32）。 */
export const SHOWN_COMMENT_CLASS = "nb-comment-current";

type Shown = {readonly ranges: ReadonlyArray<{readonly from: number; readonly to: number; readonly block: boolean}>} | "clear";

const shownCommentKey = new PluginKey<DecorationSet>("markdownShownComment");

/**
 * 用装饰标出来，不改标记属性：装饰不进撤销历史、不写进文件，随编辑映射；换文档时编辑器状态整个重建，插件状态回到空
 * （宿主在存状态之前也清一次，同 `held-selection.ts`）。
 */
export const MarkdownShownComment = Extension.create({
    name: "markdownShownComment",
    addProseMirrorPlugins() {
        return [new Plugin<DecorationSet>({
            key: shownCommentKey,
            state: {
                init: () => DecorationSet.empty,
                apply(tr, shown) {
                    const next = tr.getMeta(shownCommentKey) as Shown | undefined;
                    if (next === "clear") return DecorationSet.empty;
                    if (next !== undefined) {
                        return DecorationSet.create(tr.doc, next.ranges.map(({from, to, block}) => (block ? Decoration.node(from, to, {class: SHOWN_COMMENT_CLASS}) : Decoration.inline(from, to, {class: SHOWN_COMMENT_CLASS}))));
                    }
                    return shown.map(tr.mapping, tr.doc);
                },
            },
            props: {decorations: (state) => shownCommentKey.getState(state)},
        })];
    },
});

/** 标出这一条；`null` 或找不到时撤掉。已经是空的时什么都不做。 */
export function markShownComment(editor: Editor, ref: CommentRef | null): boolean {
    const info = ref === null ? null : findComment(editor.state.doc, ref);
    if (info === null) {
        if (shownCommentKey.getState(editor.state) !== DecorationSet.empty) editor.view.dispatch(editor.state.tr.setMeta(shownCommentKey, "clear" satisfies Shown).setMeta("addToHistory", false));
        return false;
    }
    const ranges = info.segments.map((segment) => ({from: segment.from, to: segment.to, block: info.block}));
    editor.view.dispatch(editor.state.tr.setMeta(shownCommentKey, {ranges} satisfies Shown).setMeta("addToHistory", false));
    return true;
}
