import {Extension, Node, type AnyExtension, type Editor} from "@tiptap/core";
import {Placeholder} from "@tiptap/extension-placeholder";
import {Fragment, type Node as PMNode, type Schema} from "@tiptap/pm/model";
import {GapCursor} from "@tiptap/pm/gapcursor";
import {isHistoryTransaction} from "@tiptap/pm/history";
import {Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction} from "@tiptap/pm/state";
import type {EditorView} from "@tiptap/pm/view";
import {StarterKit} from "@tiptap/starter-kit";
import {VueNodeViewRenderer} from "@tiptap/vue-3";
import type {Component} from "vue";

import {createTriggerPlugin, DISMISS_TRIGGER} from "../trigger/trigger-plugin";
import type {TriggerState} from "../trigger/trigger-plugin";
import type {PromptEditorAttachment, PromptEditorToken} from "./prompt-editor.types";
import {
    PROMPT_ATOM_CHAR,
    PROMPT_PASTE_BLOCK_NODE,
    PROMPT_PENDING_NODE,
    PROMPT_TOKEN_NODE,
    fileTokenAttrs,
    fencedLines,
    findCompletedWriting,
    findPromptTrigger,
    imageTokenAttrs,
    serializePasteBlock,
    type PromptNodeJSON,
    type PromptPasteBlockAttrs,
    type PromptPendingAttrs,
    type PromptTokenAttrs,
} from "./prompt-text";

/**
 * 节点视图读取的编辑器状态。由 PromptEditor 经扩展选项传给节点视图（节点视图的 `extension` prop），
 * 读到的值是响应式的，宿主的附件状态变化时节点视图随之重绘。
 */
export interface PromptNodeContext {
    readonly readonly: boolean;
    /** 悬停联动的键，见 `prompt-text.ts` 的 `numberKey`。 */
    readonly highlighted: string | null;
    attachmentState(localId: string): PromptEditorAttachment | null;
    activate(token: PromptEditorToken): void;
    hover(key: string | null): void;
    /** 粘贴块的编辑框里按 Ctrl/⌘+回车。 */
    submit(): void;
}

export interface PromptExtensionOptions {
    context: PromptNodeContext;
    placeholder: () => string;
    triggers: () => readonly string[];
    /** 正文开头显示为命令标签的命令名。 */
    commands: () => readonly string[];
    readonly: () => boolean;
    /** 已就绪附件的目标；重做带回待上传节点时据此再次转为标签。 */
    resolvedTarget: (localId: string) => string | null;
    /** 测试里用纯 DOM 渲染，不挂 Vue 节点视图。 */
    nodeViews?: {token: Component; pasteBlock: Component} | null;
}

export interface PromptTriggerActive {
    trigger: string;
    query: string;
    /** 触发字符的位置。 */
    from: number;
    /** 光标位置，确认菜单项时替换 [from, to)。 */
    to: number;
    atStart: boolean;
}

export type PromptTriggerState = TriggerState<PromptTriggerActive>;

export const promptTriggerKey = new PluginKey<PromptTriggerState>("promptTrigger");

/** 关闭当前触发菜单的事务标记。 */
export {DISMISS_TRIGGER};

export function createPromptExtensions(options: PromptExtensionOptions): AnyExtension[] {
    const views = options.nodeViews ?? null;
    return [
        StarterKit.configure({
            blockquote: false,
            bold: false,
            bulletList: false,
            code: false,
            codeBlock: false,
            document: false,
            hardBreak: false,
            heading: false,
            horizontalRule: false,
            italic: false,
            link: false,
            listItem: false,
            listKeymap: false,
            orderedList: false,
            strike: false,
            // 以粘贴块结尾的文字会被补出一个空行，写回就多一个换行。
            trailingNode: false,
            underline: false,
        }),
        PromptDocument,
        Placeholder.configure({
            placeholder: () => options.placeholder(),
            emptyEditorClass: "is-editor-empty",
        }),
        PromptToken.configure({context: options.context, view: views?.token ?? null}),
        PendingAttachment.configure({context: options.context, view: views?.token ?? null}),
        PasteBlock.configure({context: options.context, view: views?.pasteBlock ?? null}),
        Extension.create({
            name: "promptPlugins",
            addProseMirrorPlugins() {
                return [
                    createTriggerPlugin(promptTriggerKey, (state) => (options.readonly() ? null : readTrigger(state, options.triggers()))),
                    createConsistencyPlugin(options.resolvedTarget),
                    createCompletionPlugin(options.commands),
                ];
            },
        }),
    ];
}

const PromptDocument = Node.create({
    name: "doc",
    topNode: true,
    // 段落写在前面：需要补节点时 ProseMirror 取第一个可用的类型。
    content: "(paragraph | pasteBlock)+",
});

interface AtomOptions {
    context: PromptNodeContext;
    view: Component | null;
}

const PromptToken = Node.create<AtomOptions>({
    name: PROMPT_TOKEN_NODE,
    group: "inline",
    inline: true,
    atom: true,
    // 不可选中：点击交给节点视图发 token-activate，退格与方向键按一整个处理。
    selectable: false,
    draggable: false,
    addOptions() {
        return {context: EMPTY_CONTEXT, view: null};
    },
    addAttributes() {
        return {
            kind: {default: "reference", rendered: false},
            raw: {default: "", rendered: false},
            number: {default: null, rendered: false},
            label: {default: "", rendered: false},
            target: {default: "", rendered: false},
        };
    },
    parseHTML() {
        return [];
    },
    renderHTML({node}) {
        return ["span", {"data-prompt-token": String(node.attrs.kind)}, String(node.attrs.raw)];
    },
    renderText({node}) {
        return String(node.attrs.raw);
    },
    addNodeView() {
        return this.options.view ? VueNodeViewRenderer(this.options.view as never) : null;
    },
});

const PendingAttachment = Node.create<AtomOptions>({
    name: PROMPT_PENDING_NODE,
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    draggable: false,
    addOptions() {
        return {context: EMPTY_CONTEXT, view: null};
    },
    addAttributes() {
        return {
            localId: {default: "", rendered: false},
            kind: {default: "image", rendered: false},
            name: {default: "", rendered: false},
            number: {default: 0, rendered: false},
        };
    },
    parseHTML() {
        return [];
    },
    renderHTML({node}) {
        return ["span", {"data-prompt-pending": String(node.attrs.localId)}];
    },
    // 上传完成前附件不在文字里。
    renderText() {
        return "";
    },
    addNodeView() {
        return this.options.view ? VueNodeViewRenderer(this.options.view as never) : null;
    },
});

const PasteBlock = Node.create<AtomOptions>({
    name: PROMPT_PASTE_BLOCK_NODE,
    group: "block",
    atom: true,
    // 不可选中：行首退格走 joinBackward 的“前一个是原子就删掉”，整块删除。
    selectable: false,
    draggable: false,
    addOptions() {
        return {context: EMPTY_CONTEXT, view: null};
    },
    addAttributes() {
        return {
            number: {default: 0, rendered: false},
            content: {default: "", rendered: false},
        };
    },
    parseHTML() {
        return [];
    },
    renderHTML({node}) {
        return ["pre", {"data-prompt-paste": String(node.attrs.number)}, String(node.attrs.content)];
    },
    renderText({node}) {
        return serializePasteBlock(node.attrs as PromptPasteBlockAttrs);
    },
    addNodeView() {
        return this.options.view ? VueNodeViewRenderer(this.options.view as never) : null;
    },
});

const EMPTY_CONTEXT: PromptNodeContext = {
    readonly: false,
    highlighted: null,
    attachmentState: () => null,
    activate: () => undefined,
    hover: () => undefined,
    submit: () => undefined,
};

/** 行内原子节点在触发匹配里读成占位字符；写回原文时用 renderText。 */
export function atomLeafText(leaf: PMNode): string {
    if (leaf.type.name === PROMPT_TOKEN_NODE) {
        return String(leaf.attrs.raw);
    }
    return "";
}

function readTrigger(state: EditorState, triggers: readonly string[]): PromptTriggerActive | null {
    const {selection} = state;
    if (!selection.empty || !(selection instanceof TextSelection)) {
        return null;
    }
    const $from = selection.$from;
    if ($from.parent.type.name !== "paragraph") {
        return null;
    }
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, PROMPT_ATOM_CHAR);
    const match = findPromptTrigger(before, triggers);
    if (!match) {
        return null;
    }
    return {
        trigger: match.trigger,
        query: match.query,
        from: $from.start() + match.offset,
        to: $from.pos,
        atStart: $from.index(0) === 0 && match.offset === 0,
    };
}

/**
 * 每次改动后维持两条不变量：
 * - 粘贴块与它的位置标记成对：改动前成对的编号，改动后只剩一边时把另一边也删掉；
 * - 已就绪附件的待上传节点（重做带回来的）再次转为图片或文件标签。
 * 追加的事务与原事务同属一个撤销步骤。
 */
function createConsistencyPlugin(resolvedTarget: (localId: string) => string | null): Plugin {
    return new Plugin({
        appendTransaction(transactions, oldState, newState) {
            if (!transactions.some((tr) => tr.docChanged)) {
                return null;
            }
            const tr = newState.tr;
            const before = collectPasteParts(oldState.doc);
            const after = collectPasteParts(newState.doc);
            const doomed: Array<{pos: number; size: number}> = [];
            for (const number of before.blocks.keys()) {
                if (!before.markers.has(number)) {
                    continue;
                }
                const blocks = after.blocks.get(number) ?? [];
                const markers = after.markers.get(number) ?? [];
                if (blocks.length === 0 && markers.length > 0) {
                    doomed.push(...markers);
                }
                else if (markers.length === 0 && blocks.length > 0) {
                    doomed.push(...blocks);
                }
            }
            newState.doc.descendants((node, pos) => {
                if (node.type.name !== PROMPT_PENDING_NODE) {
                    return;
                }
                const target = resolvedTarget(String(node.attrs.localId));
                if (target !== null) {
                    const from = tr.mapping.map(pos);
                    tr.replaceWith(from, from + node.nodeSize, readyTokenNode(newState.schema, node.attrs as PromptPendingAttrs, target));
                }
            });
            for (const item of doomed.sort((left, right) => right.pos - left.pos)) {
                const from = tr.mapping.map(item.pos);
                tr.delete(from, from + item.size);
            }
            if (!tr.docChanged) {
                return null;
            }
            ensureDocNotEmpty(tr);
            return tr;
        },
    });
}

const completionKey = new PluginKey("promptCompletion");

/**
 * 手打的写法写完时变成标签（文字不变，只是显示）：只看单步输入的文字，例如打完 `$reviewer` 后的空格或逗号、
 * 引用写法收尾的 `)`。粘贴、菜单确认、“转为文字”都不是单步输入文字，不受影响；追加的事务与输入同属一个撤销步骤。
 */
function createCompletionPlugin(commands: () => readonly string[]): Plugin {
    return new Plugin({
        key: completionKey,
        appendTransaction(transactions, _oldState, newState) {
            const tr = transactions[0];
            if (transactions.length !== 1 || !tr || tr.steps.length !== 1 || tr.getMeta(completionKey) || tr.getMeta("addToHistory") === false || isHistoryTransaction(tr)) {
                return null;
            }
            const ranges: Array<[number, number]> = [];
            tr.steps[0]!.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                ranges.push([newStart, newEnd]);
            });
            const [from, to] = ranges[0] ?? [0, 0];
            const $from = newState.doc.resolve(from);
            const $to = newState.doc.resolve(to);
            if (ranges.length !== 1 || to <= from || $from.parent !== $to.parent || $from.parent.type.name !== "paragraph"
                || newState.doc.textBetween(from, to, undefined, PROMPT_ATOM_CHAR).includes(PROMPT_ATOM_CHAR)) {
                return null;
            }
            const paragraph = $from.parent;
            // 围栏代码块里打字不变成小块：按正文开头到这一行的各行判断这一行在不在块里。
            const lines: string[] = [];
            for (let index = 0; index <= $from.index(0); index += 1) lines.push(newState.doc.child(index).textContent);
            if (fencedLines(lines).at(-1) === true) return null;
            const line = paragraph.textBetween(0, paragraph.content.size, undefined, PROMPT_ATOM_CHAR);
            const found = findCompletedWriting(line, $from.parentOffset, $to.parentOffset, {commands: commands(), firstLine: $from.index(0) === 0});
            if (!found) {
                return null;
            }
            const start = $from.start();
            return newState.tr
                .replaceWith(start + found.start, start + found.end, newState.schema.nodes[PROMPT_TOKEN_NODE]!.create(found.attrs))
                .setMeta(completionKey, true);
        },
    });
}

/**
 * 光标所在视觉行的行首或行尾。行首是标签时浏览器自带的 Home 会停在标签后面，所以按坐标自己找：
 * 取光标那一行的竖直中线，在正文左右边缘各取一点换回文档位置，再夹在当前段落里。
 */
export function lineEdge(view: EditorView, side: "start" | "end"): number | null {
    const {$head} = view.state.selection;
    if ($head.parent.type.name !== "paragraph") {
        return null;
    }
    const caret = view.coordsAtPos($head.pos);
    const box = view.dom.getBoundingClientRect();
    const hit = view.posAtCoords({left: side === "start" ? box.left + 1 : box.right - 1, top: (caret.top + caret.bottom) / 2});
    const pos = hit?.pos ?? (side === "start" ? $head.start() : $head.end());
    return Math.min($head.end(), Math.max($head.start(), pos));
}

function collectPasteParts(doc: PMNode): {blocks: Map<number, Array<{pos: number; size: number}>>; markers: Map<number, Array<{pos: number; size: number}>>} {
    const blocks = new Map<number, Array<{pos: number; size: number}>>();
    const markers = new Map<number, Array<{pos: number; size: number}>>();
    doc.descendants((node, pos) => {
        const target = node.type.name === PROMPT_PASTE_BLOCK_NODE
            ? blocks
            : node.type.name === PROMPT_TOKEN_NODE && node.attrs.kind === "paste" ? markers : null;
        if (target) {
            const number = Number(node.attrs.number);
            target.set(number, [...target.get(number) ?? [], {pos, size: node.nodeSize}]);
        }
    });
    return {blocks, markers};
}

function ensureDocNotEmpty(tr: Transaction): void {
    if (tr.doc.childCount === 0) {
        tr.insert(0, tr.doc.type.schema.nodes.paragraph!.create());
    }
}

export function readyTokenNode(schema: Schema, pending: PromptPendingAttrs, target: string): PMNode {
    const attrs: PromptTokenAttrs = pending.kind === "image"
        ? imageTokenAttrs(pending.number, target)
        : fileTokenAttrs(pending.number, pending.name, target);
    return schema.nodes[PROMPT_TOKEN_NODE]!.create(attrs);
}

/**
 * 用一组块替换 [from, to)：块是 parsePromptInsertion 的结果，段落一行一个。
 * 第一段与插入点左边的原文合并，最后一段与右边的原文合并；首尾是粘贴块时，左边没有原文就不留空行，
 * 右边总留一个段落给光标。光标落在插入内容之后。
 */
export function replaceWithBlocks(tr: Transaction, from: number, to: number, blocks: readonly PromptNodeJSON[]): Transaction {
    const schema = tr.doc.type.schema;
    const paragraph = schema.nodes.paragraph!;
    const nodes = blocks.map((block) => schema.nodeFromJSON(block));
    if (from !== to) {
        tr.delete(from, to);
    }
    if (nodes.length === 0) {
        return tr;
    }
    const $pos = tr.doc.resolve(from);
    const inParagraph = $pos.parent.type === paragraph;
    const left = inParagraph ? $pos.parent.content.cut(0, $pos.parentOffset) : Fragment.empty;
    const right = inParagraph ? $pos.parent.content.cut($pos.parentOffset) : Fragment.empty;
    const items = [...nodes];
    const out: PMNode[] = [];
    const first = items[0]!;
    if (first.type === paragraph) {
        items[0] = paragraph.create(null, left.append(first.content));
    }
    else if (left.size > 0) {
        out.push(paragraph.create(null, left));
    }
    const lastIndex = items.length - 1;
    const last = items[lastIndex]!;
    let cursorOffset = 0;
    if (last.type === paragraph) {
        cursorOffset = last.content.size;
        items[lastIndex] = paragraph.create(null, last.content.append(right));
    }
    else {
        items.push(paragraph.create(null, right));
    }
    out.push(...items);
    const start = inParagraph ? $pos.before() : from;
    if (inParagraph) {
        tr.replaceWith(start, $pos.after(), out);
    }
    else {
        tr.insert(start, out);
    }
    const lastStart = start + out.slice(0, -1).reduce((size, node) => size + node.nodeSize, 0);
    tr.setSelection(TextSelection.create(tr.doc, lastStart + 1 + cursorOffset));
    return tr.scrollIntoView();
}

/**
 * “放到开头”的粘贴块插入位置：正文开头的粘贴块之后；第一行以命令开头时在命令那一行之后。
 */
export function startBlockPosition(doc: PMNode): number {
    let pos = 0;
    let index = 0;
    const first = doc.firstChild;
    if (first?.type.name === "paragraph" && first.firstChild?.type.name === PROMPT_TOKEN_NODE && first.firstChild.attrs.kind === "command") {
        pos += first.nodeSize;
        index += 1;
    }
    while (index < doc.childCount && doc.child(index).type.name === PROMPT_PASTE_BLOCK_NODE) {
        pos += doc.child(index).nodeSize;
        index += 1;
    }
    return pos;
}

/**
 * 退格与 Delete 紧挨行内标签时删除整枚；Mod-、Alt-退格同样先删标签，不交给浏览器按词删除。
 * 返回是否处理了。
 */
export function deleteAdjacentAtom(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, direction: -1 | 1): boolean {
    const {selection} = state;
    if (!selection.empty || !(selection instanceof TextSelection)) {
        return false;
    }
    const $pos = selection.$from;
    const node = direction < 0 ? $pos.nodeBefore : $pos.nodeAfter;
    // 文字节点也算叶子（isAtom 为真），只认行内原子节点。
    if (!node || node.isText || !node.isInline) {
        return false;
    }
    if (dispatch) {
        const from = direction < 0 ? $pos.pos - node.nodeSize : $pos.pos;
        dispatch(state.tr.delete(from, from + node.nodeSize).scrollIntoView());
    }
    return true;
}

/** 光标所在位置插入一个空段落：在粘贴块旁的间隙处换行用。 */
export function insertParagraphAtGap(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined): boolean {
    const {$from} = state.selection;
    if ($from.parent.type.name === "paragraph") {
        return false;
    }
    if (dispatch) {
        const tr = state.tr.insert($from.pos, state.schema.nodes.paragraph!.create());
        tr.setSelection(TextSelection.create(tr.doc, $from.pos + 1));
        dispatch(tr.scrollIntoView());
    }
    return true;
}

/**
 * 正文开头或末尾的光标。那一端是粘贴块时放间隙光标：ProseMirror 的 Selection.atEnd 找不到文字位置会退成全选，
 * 接着输入就会替换整篇正文。
 */
export function edgeSelection(doc: PMNode, side: "start" | "end"): Selection {
    const edge = side === "start" ? doc.firstChild : doc.lastChild;
    if (edge?.type.name === "paragraph") {
        return side === "start" ? TextSelection.create(doc, 1) : TextSelection.create(doc, doc.content.size - 1);
    }
    return new GapCursor(doc.resolve(side === "start" ? 0 : doc.content.size));
}

/** 从粘贴块的编辑框回到正文时的光标：块前面那一行的行尾或后面那一行的行首；那边不是段落时放间隙光标。 */
export function selectionBesideBlock(doc: PMNode, blockPos: number, side: "before" | "after"): Selection {
    const edge = side === "before" ? blockPos : blockPos + (doc.nodeAt(blockPos)?.nodeSize ?? 0);
    const $edge = doc.resolve(edge);
    const neighbour = side === "before" ? $edge.nodeBefore : $edge.nodeAfter;
    if (neighbour?.type.name === "paragraph") {
        return TextSelection.create(doc, side === "before" ? edge - 1 : edge + 1);
    }
    return new GapCursor($edge);
}

/** 正文为空：只有一个空段落。此时全选没有东西可选，Chrome 却会把空段落的占位换行画成一小块选中底色。 */
export function isEmptyPrompt(doc: PMNode): boolean {
    return doc.childCount === 1 && doc.firstChild!.type.name === "paragraph" && doc.firstChild!.content.size === 0;
}

/** 文档里所有待上传节点的 localId。 */
export function pendingLocalIds(doc: PMNode): Set<string> {
    const ids = new Set<string>();
    doc.descendants((node) => {
        if (node.type.name === PROMPT_PENDING_NODE) {
            ids.add(String(node.attrs.localId));
        }
    });
    return ids;
}

export function readTriggerState(editor: Editor): PromptTriggerState | null {
    return promptTriggerKey.getState(editor.state) ?? null;
}
