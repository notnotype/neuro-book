/**
 * 块按钮与块菜单作用的对象（docs/specs/workbench/markdown-editing.md 的块模型）与对它的操作。按光标所在的位置判断：菜单先把选区
 * 放进那一块，再执行和工具栏同一条路径的命令，不写第二份。
 */

import {Extension} from "@tiptap/core";
import type {Editor} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import {NodeSelection, Selection, TextSelection} from "@tiptap/pm/state";
import type {EditorState, Transaction} from "@tiptap/pm/state";
import {liftTarget} from "@tiptap/pm/transform";

export type BlockKind = "text" | "code" | "list-item" | "container" | "whole";

export interface BlockTarget {
    readonly kind: BlockKind;
    /** 块开始前的位置。 */
    readonly pos: number;
    readonly end: number;
    readonly node: PMNode;
}

const LIST_ITEMS: ReadonlySet<string> = new Set(["listItem", "taskItem"]);

function kindOfTop(node: PMNode): BlockKind {
    if (node.type.name === "codeBlock") return "code";
    if (node.isTextblock) return "text";
    // 表格的子节点也是块，但表格整块算；原样块与 HTML 嵌入是原子。
    if (node.isAtom || node.isLeaf || node.type.spec.tableRole !== undefined) return "whole";
    return "container";
}

/** `position` 所在的块；文档之外为 null。列表按最里面的一项算，其余按顶层块算。 */
export function blockAt(doc: PMNode, position: number): BlockTarget | null {
    const clamped = Math.max(0, Math.min(position, doc.content.size));
    const $pos = doc.resolve(clamped);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
        const node = $pos.node(depth);
        if (LIST_ITEMS.has(node.type.name)) return {kind: "list-item", pos: $pos.before(depth), end: $pos.after(depth), node};
    }
    if ($pos.depth === 0) {
        // 落在顶层块之间：原子块与点在块边界上的情况。
        const node = $pos.nodeAfter ?? $pos.nodeBefore;
        if (node === null) return null;
        const pos = $pos.nodeAfter === null ? clamped - node.nodeSize : clamped;
        return {kind: kindOfTop(node), pos, end: pos + node.nodeSize, node};
    }
    const node = $pos.node(1);
    return {kind: kindOfTop(node), pos: $pos.before(1), end: $pos.after(1), node};
}

/** 选区所在的块：节点选区按节点开始的位置，文字选区按起点。 */
export function selectedBlock(state: EditorState): BlockTarget | null {
    const {selection, doc} = state;
    if (selection instanceof NodeSelection) {
        const target = blockAt(doc, selection.from + 1);
        if (target !== null && target.pos === selection.from) return target;
        return {kind: kindOfTop(selection.node), pos: selection.from, end: selection.to, node: selection.node};
    }
    return blockAt(doc, selection.from);
}

/** 把选区放进这一块：有文字的放到第一段开头，原子块用节点选区。 */
export function selectBlock(editor: Editor, target: BlockTarget): void {
    const {state, view} = editor;
    const selection = target.kind === "whole"
        ? NodeSelection.create(state.doc, target.pos)
        : Selection.findFrom(state.doc.resolve(target.pos + 1), 1, true) ?? Selection.near(state.doc.resolve(target.pos));
    view.dispatch(state.tr.setSelection(selection));
}

/** 整块选中：拖动与“复制”用。 */
export function selectWholeBlock(editor: Editor, target: BlockTarget): void {
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, target.pos)));
}

function sibling(doc: PMNode, target: BlockTarget, direction: -1 | 1): {readonly pos: number; readonly node: PMNode} | null {
    const $pos = doc.resolve(target.pos);
    const index = $pos.index();
    const parent = $pos.parent;
    const next = index + direction;
    if (next < 0 || next >= parent.childCount) return null;
    const node = parent.child(next);
    return {pos: direction === -1 ? target.pos - node.nodeSize : target.end, node};
}

export function canMoveBlock(state: EditorState, direction: -1 | 1): boolean {
    const target = selectedBlock(state);
    return target !== null && sibling(state.doc, target, direction) !== null;
}

/** 和相邻的块换位置。同一事务里 delete 加 insert，节点实例不变：编解码器按身份认出没编辑的块（Spec 输出 19）。 */
export function moveBlock(editor: Editor, direction: -1 | 1): boolean {
    const {state, view} = editor;
    const target = selectedBlock(state);
    if (target === null) return false;
    const other = sibling(state.doc, target, direction);
    if (other === null) return false;
    const offset = state.selection.from - target.pos;
    const tr = state.tr.delete(target.pos, target.end);
    const insertAt = direction === -1 ? other.pos : other.pos + other.node.nodeSize - target.node.nodeSize;
    tr.insert(insertAt, target.node);
    restoreSelection(tr, insertAt, offset, state.selection instanceof NodeSelection);
    view.dispatch(tr.scrollIntoView());
    return true;
}

function restoreSelection(tr: Transaction, blockPos: number, offset: number, node: boolean): void {
    tr.setSelection(node ? NodeSelection.create(tr.doc, blockPos) : TextSelection.near(tr.doc.resolve(blockPos + offset)));
}

/** 紧接在后面放一份。新建节点，不和原块共用原文来源（Spec 输出 18）。 */
export function duplicateBlock(editor: Editor): boolean {
    const {state, view} = editor;
    const target = selectedBlock(state);
    if (target === null) return false;
    const copy = state.schema.nodeFromJSON(target.node.toJSON());
    view.dispatch(state.tr.insert(target.end, copy).scrollIntoView());
    return true;
}

export function deleteBlock(editor: Editor): boolean {
    const {state, view} = editor;
    const target = selectedBlock(state);
    if (target === null) return false;
    // `deleteRange`：删掉列表唯一的一项时连列表一起删；文档只剩这一块时留一个空段落。
    view.dispatch(state.tr.deleteRange(target.pos, target.end).scrollIntoView());
    return true;
}

/** 解开：列表项提出列表（列表从这里断开），容器块解开成里面的块。 */
export function unwrapBlock(editor: Editor): boolean {
    const {state, view} = editor;
    const target = selectedBlock(state);
    if (target === null) return false;
    if (target.kind === "list-item") {
        const item = target.node.type.name;
        let changed = false;
        for (let round = 0; round < 16 && editor.isActive(item); round += 1) {
            if (!editor.commands.liftListItem(item)) break;
            changed = true;
        }
        return changed;
    }
    if (target.kind !== "container") return false;
    const range = state.doc.resolve(target.pos + 1).blockRange(state.doc.resolve(target.end - 1));
    const lift = range === null ? null : liftTarget(range);
    if (range === null || lift === null || lift === undefined) return false;
    view.dispatch(state.tr.lift(range, lift));
    return true;
}

/** 块菜单“转换为”的可用项（Spec 的块模型表）。 */
export function canConvertTo(state: EditorState, action: string): boolean {
    const target = selectedBlock(state);
    if (target === null) return false;
    switch (target.kind) {
        case "text":
        case "code":
            return true;
        case "list-item":
            return ["paragraph", "heading-1", "heading-2", "heading-3", "bullet-list", "ordered-list", "task-list"].includes(action);
        case "container":
            return action === "paragraph";
        case "whole":
            return false;
    }
}

/**
 * `+`：在这一块的下方或上方放一个只有 `/` 的段落（列表里是新的一项），由斜杠的触发打开菜单。不进撤销历史：放弃时删掉，
 * 文件字节不变、也不留撤销步骤（Spec 输出 15）。返回新块的位置。
 */
export function insertSlashBlock(editor: Editor, target: BlockTarget, side: "before" | "after"): number {
    const {state, view} = editor;
    const paragraph = state.schema.nodes.paragraph!.create(null, state.schema.text("/"));
    const node = target.kind === "list-item" ? target.node.type.createAndFill(target.node.type.name === "taskItem" ? {checked: false} : null, paragraph) ?? paragraph : paragraph;
    const pos = side === "before" ? target.pos : target.end;
    const tr = state.tr.insert(pos, node);
    // 光标放在 `/` 后面：列表项的段落多一层。
    const caret = pos + (node === paragraph ? 2 : 3);
    tr.setSelection(TextSelection.create(tr.doc, caret)).setMeta("addToHistory", false);
    view.dispatch(tr);
    return pos;
}

/** 放弃 `+`：这一块还只有 `/` 时删掉它。 */
export function removeSlashBlock(editor: Editor, pos: number): void {
    const {state, view} = editor;
    const node = state.doc.nodeAt(pos);
    if (node === null || node.textContent !== "/") return;
    view.dispatch(state.tr.deleteRange(pos, pos + node.nodeSize).setMeta("addToHistory", false));
}

/** 移动块的快捷键（Spec 的命令表）。macOS 上占用 Option+↑↓ 的段落跳转，Spec 写明了。 */
export const MarkdownBlockKeymap = Extension.create({
    name: "markdownBlockKeymap",
    addKeyboardShortcuts() {
        return {
            "Alt-ArrowUp": () => moveBlock(this.editor, -1),
            "Alt-ArrowDown": () => moveBlock(this.editor, 1),
        };
    },
});
