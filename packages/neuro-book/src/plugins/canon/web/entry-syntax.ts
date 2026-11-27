/**
 * 编辑器一侧的条目语法模块（docs/specs/canon/rendering.md 输出 17、21）：词法、原子与转义规则直接用内核的 `entryLexing`
 * （`@notnotype/nb-canon/grammar`），所以编辑器认出的活标签与落点与内核相同。
 *
 * 节点两种：
 * - 标签（`ENTRY_TAG_NODE`）：一个活的标签，属性 `source` 存它的原文，写回原样写出。取值、条目引用、图片、没登记的都是它，
 *   种类由画它的地方从原文读出。
 * - 条件（`ENTRY_IF_NODE`）：同一个行内容器里配好对的 `<If …>…</If>` 整段一个原子，作者在富文本里拆不坏它（`If` 只在一段之内，
 *   rendering 输出 1）。词法层仍是每个标签一个原子（与内核逐字一致），读完整篇以后在 `resolve` 里合成：属性存开标签、闭标签的
 *   原文与各支（起头的标签原文、这一支读出的行内 JSON）。写回时开标签、各支、闭标签拼起来；编解码器的读回校验经同一个 `resolve`，
 *   改过的块写出后读回同样的节点。套着的、没闭上的、跨行的条件不合成（各标签各一个节点）。
 *
 * w00055 t03 S1 的探针定下这个做法（Task 计划“编辑器一侧的条目语法”）。
 */

import {Node, mergeAttributes} from "@tiptap/core";
import type {JSONContent} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import type {InlineWriter, MarkdownSyntax} from "@notnotype/nb-markdown/language/types";
import {entryLexing, lexTags} from "@notnotype/nb-canon/grammar";

export const ENTRY_TAG_NODE = "canonEntryTag";
export const ENTRY_IF_NODE = "canonEntryIf";

/** 条件的一支：起头的标签原文（第一支是开标签，写在 `open` 里，这里为 null）与这一支读出的行内内容。 */
export interface EntryIfBranch {
    readonly head: string | null;
    readonly content: readonly JSONContent[];
}

const entryTagNode = Node.create({
    name: ENTRY_TAG_NODE,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes: () => ({source: {default: ""}}),
    parseHTML: () => [{tag: "span[data-canon-entry-tag]", getAttrs: (element) => ({source: element.getAttribute("data-source") ?? ""})}],
    renderHTML: ({node, HTMLAttributes}) => ["span", mergeAttributes(HTMLAttributes, {"data-canon-entry-tag": "", "data-source": node.attrs.source as string}), node.attrs.source as string],
});

/** 剪贴板里的条件带着整段属性，在富文本之内复制粘贴原样（属性是 JSON）。 */
const entryIfNode = Node.create({
    name: ENTRY_IF_NODE,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    addAttributes: () => ({open: {default: ""}, close: {default: ""}, branches: {default: []}}),
    parseHTML: () => [
        {
            tag: "span[data-canon-entry-if]",
            getAttrs: (element) => {
                try {
                    const attrs = JSON.parse(element.getAttribute("data-attrs") ?? "") as {open?: unknown; close?: unknown; branches?: unknown};
                    if (typeof attrs.open !== "string" || typeof attrs.close !== "string" || !Array.isArray(attrs.branches)) return false;
                    return {open: attrs.open, close: attrs.close, branches: attrs.branches};
                } catch {
                    // 别处贴来的同名元素，属性读不出：不当条件，交给别的读法。
                    return false;
                }
            },
        },
    ],
    renderHTML: ({node, HTMLAttributes}) => ["span", mergeAttributes(HTMLAttributes, {"data-canon-entry-if": "", "data-attrs": JSON.stringify(node.attrs)}), node.attrs.open as string],
});

const tagOf = (node: JSONContent) => (node.type === ENTRY_TAG_NODE ? lexTags(String(node.attrs?.source ?? ""))[0] : undefined);

/**
 * 把一支读出的 JSON 规整成 ProseMirror 建节点后的样子：同类的标记只留一个（读法给嵌套的同类强调时会挂几层，ProseMirror 建节点时
 * 去重），相邻、标记相同的文字节点合成一个（读法按词法单元出文字，转义的 `\-` 自成一段）。属性里的 JSON 不经 ProseMirror，
 * 不规整的话重写以后读回比不上。
 */
function normalizeInline(nodes: readonly JSONContent[]): JSONContent[] {
    const out: JSONContent[] = [];
    const markKey = (marks: JSONContent["marks"]): string => JSON.stringify([...(marks ?? [])].sort((a, b) => a.type.localeCompare(b.type)));
    for (const raw of nodes) {
        const node: JSONContent = raw.marks === undefined ? raw : {...raw, marks: [...new Map(raw.marks.map((mark) => [mark.type, mark])).values()]};
        const last = out[out.length - 1];
        if (node.type === "text" && last?.type === "text" && markKey(last.marks) === markKey(node.marks)) out[out.length - 1] = {...last, text: `${last.text ?? ""}${node.text ?? ""}`};
        else out.push(node);
    }
    return out;
}

/**
 * 去掉写法属性（`markdown`：行内代码用几个反引号、强调用哪个记号）：编解码器比较顶层节点时不比它们，属性里嵌套的 JSON 却是逐字比的，
 * 留着的话重写以后读回比不上。没改过的块照原文写回，不受影响；改过的块里的支按规范写法写。
 */
function withoutStyles(nodes: readonly JSONContent[]): JSONContent[] {
    const clean = <T extends {attrs?: Record<string, unknown>}>(item: T): T => {
        if (item.attrs === undefined || !("markdown" in item.attrs)) return item;
        const {markdown: _markdown, ...attrs} = item.attrs;
        return {...item, attrs};
    };
    return nodes.map((node) => {
        const cleaned = clean(node);
        return {...cleaned, ...(node.marks === undefined ? {} : {marks: node.marks.map(clean)}), ...(node.content === undefined ? {} : {content: withoutStyles(node.content)})};
    });
}

/** 一组行内节点里把配好对的条件合成一个节点；配不上的（没闭上、套着的）各标签原样留着。 */
function groupConditions(inline: readonly JSONContent[]): JSONContent[] {
    const out: JSONContent[] = [];
    for (let index = 0; index < inline.length; index += 1) {
        const node = inline[index] as JSONContent;
        const tag = tagOf(node);
        if (tag?.name !== "If" || tag.closing || tag.kind === "self") {
            out.push(node);
            continue;
        }
        const branches: Array<{head: string | null; content: JSONContent[]}> = [{head: null, content: []}];
        let close: number | null = null;
        for (let at = index + 1; at < inline.length; at += 1) {
            const inner = tagOf(inline[at] as JSONContent);
            if (inner?.name === "If" && inner.closing) {
                close = at;
                break;
            }
            // 套着的条件内核拒收（rendering 输出 1）：不合成。
            if (inner?.name === "If") break;
            if (inner?.name === "ElseIf" || inner?.name === "Else") branches.push({head: String((inline[at] as JSONContent).attrs?.source), content: []});
            else branches[branches.length - 1]!.content.push(inline[at] as JSONContent);
        }
        if (close === null) {
            out.push(node);
            continue;
        }
        // 条件整体落在加粗这类标记里时不把标记放在节点上：支里的文字本来就带着它，重写时写进各支里（意思不变）。
        out.push({
            type: ENTRY_IF_NODE,
            attrs: {open: node.attrs?.source, close: (inline[close] as JSONContent).attrs?.source, branches: branches.map((branch) => ({head: branch.head, content: normalizeInline(withoutStyles(branch.content))}))},
        });
        index = close;
    }
    return out;
}

/** 整篇读完以后，在每个行内容器（段落、标题、单元格里的段落）里合成条件。 */
function resolveConditions(blocks: ReadonlyArray<ReadonlyArray<JSONContent>>): void {
    const walk = (nodes: readonly JSONContent[]): void => {
        for (const node of nodes) {
            if (node.content === undefined) continue;
            if (node.content.some((child) => child.type === "text" || child.type === ENTRY_TAG_NODE)) node.content = groupConditions(node.content);
            else walk(node.content);
        }
    };
    for (const block of blocks) walk(block);
}

/** 一支写成行内文字：按一个段落的行内内容写；段落写不出两头的空白，先剥下来、写完原样接回（它们在标签中间，不在行首行尾）。 */
const writeBranch = (content: readonly JSONContent[], node: PMNode, context: Parameters<InlineWriter>[1], place: Parameters<InlineWriter>[2]["place"]): string => {
    const nodes = content.map((json) => ({...json}));
    let before = "";
    let after = "";
    const first = nodes[0];
    if (first?.type === "text" && typeof first.text === "string") {
        before = /^[ \t]*/u.exec(first.text)![0];
        first.text = first.text.slice(before.length);
    }
    const last = nodes[nodes.length - 1];
    if (last?.type === "text" && typeof last.text === "string") {
        after = /[ \t]*$/u.exec(last.text)![0];
        last.text = last.text.slice(0, last.text.length - after.length);
    }
    const kept = nodes.filter((json) => json.type !== "text" || json.text !== "");
    if (kept.length === 0) return before + after;
    const schema = node.type.schema;
    return before + context.inline(schema.nodes.paragraph!.create(null, kept.map((json) => schema.nodeFromJSON(json))), place) + after;
};

const writeIf: InlineWriter = (node, context, around) => {
    const branches = node.attrs.branches as readonly EntryIfBranch[];
    const written = branches.map((branch) => (branch.head ?? "") + writeBranch(branch.content, node, context, around.place));
    return `${node.attrs.open as string}${written.join("")}${node.attrs.close as string}`;
};

export const entrySyntax: MarkdownSyntax = {
    ...entryLexing,
    extensions: [entryTagNode, entryIfNode],
    readInline: {entryTag: (token) => [{type: ENTRY_TAG_NODE, attrs: {source: token.raw}}]},
    writeInline: {[ENTRY_TAG_NODE]: (node) => node.attrs.source as string, [ENTRY_IF_NODE]: writeIf},
    resolve: resolveConditions,
};

/**
 * 文档里的活标签原文，按先后：条件展开成开标签、各支起头的标签与支里的标签、闭标签。与内核 `parseEntryText` 的活标签同序
 * （`entry-syntax.test.ts` 的性质测试守着），值表按它对回节点。
 */
export function documentTags(doc: PMNode): string[] {
    const tags: string[] = [];
    const fromJSON = (nodes: readonly JSONContent[]): void => {
        for (const node of nodes) {
            if (node.type === ENTRY_TAG_NODE) tags.push(String(node.attrs?.source ?? ""));
            else if (node.type === ENTRY_IF_NODE) fromIf(node.attrs as {open: string; close: string; branches: readonly EntryIfBranch[]});
            else if (node.content !== undefined) fromJSON(node.content);
        }
    };
    const fromIf = (attrs: {readonly open: string; readonly close: string; readonly branches: readonly EntryIfBranch[]}): void => {
        tags.push(attrs.open);
        for (const branch of attrs.branches) {
            if (branch.head !== null) tags.push(branch.head);
            fromJSON(branch.content);
        }
        tags.push(attrs.close);
    };
    doc.descendants((node) => {
        if (node.type.name === ENTRY_TAG_NODE) tags.push(node.attrs.source as string);
        else if (node.type.name === ENTRY_IF_NODE) fromIf(node.attrs as {open: string; close: string; branches: readonly EntryIfBranch[]});
        return true;
    });
    return tags;
}

/** 文档里合成了的条件个数（进编辑时与内核的 `entryIf` 个数比，对不上就不在富文本里打开）。 */
export function conditionCount(doc: PMNode): number {
    let count = 0;
    doc.descendants((node) => {
        if (node.type.name === ENTRY_IF_NODE) count += 1;
        return true;
    });
    return count;
}
