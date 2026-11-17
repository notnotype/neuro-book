/**
 * 链接的编辑动作（docs/specs/workbench/markdown-editing.md 输出 52）：加链接、改链接的地址、去掉链接。
 *
 * 不用 Tiptap 的 `setLink`、`unsetLink`：它们只改选区盖住的那一段，选区在链接内部时把链接切成三段（改地址）或留下两段残链（去掉），
 * 光标折叠时什么也不做。这里自己算“碰到的整条链接”：一条链接是同一个文本块里连续的、带同一个链接标记的文字。
 */

import type {Editor} from "@tiptap/core";
import type {Mark, MarkType} from "@tiptap/pm/model";

/** 选区碰到的一条完整的链接。 */
export interface LinkRange {
    readonly from: number;
    readonly to: number;
    readonly mark: Mark;
    readonly href: string;
}

/** 会在页面里执行或带走数据的方案：不写成链接（Tiptap 的默认检查对 `setLink` 之外的写入不起作用，这里自己拦）。 */
const UNSAFE_SCHEME = /^\s*(?:javascript|vbscript|data):/iu;

export const isSafeHref = (href: string): boolean => href.trim() !== "" && !UNSAFE_SCHEME.test(href);

const linkType = (editor: Editor): MarkType | undefined => editor.schema.marks.link;

/** 一个文本块里的全部链接（连续的、同一个标记的文字合成一条）。 */
function linksIn(parentStart: number, parent: {forEach(f: (child: {isText: boolean; marks: readonly Mark[]; nodeSize: number}, offset: number) => void): void}, type: MarkType): LinkRange[] {
    const found: LinkRange[] = [];
    parent.forEach((child, offset) => {
        const mark = child.isText ? child.marks.find((candidate) => candidate.type === type) : undefined;
        if (mark === undefined) return;
        const from = parentStart + offset;
        const last = found.at(-1);
        if (last !== undefined && last.to === from && last.mark.eq(mark)) {
            found[found.length - 1] = {...last, to: from + child.nodeSize};
        } else {
            found.push({from, to: from + child.nodeSize, mark, href: String(mark.attrs.href ?? "")});
        }
    });
    return found;
}

/**
 * 选区碰到的链接，整条：选区非空时与链接有重叠的都算（只盖住一部分也算，两端相接不算），光标折叠时光标在链接里（同
 * `isActive("link")`：链接末尾的位置不算在里面，`inclusive: false`）。按文档里的先后。
 */
export function linksTouching(editor: Editor): LinkRange[] {
    const type = linkType(editor);
    if (type === undefined) return [];
    const {doc, selection} = editor.state;
    if (selection.empty) {
        const {$from} = selection;
        if (type.isInSet($from.marks()) === undefined) return [];
        return linksIn($from.start(), $from.parent, type).filter((range) => range.from <= $from.pos && $from.pos <= range.to);
    }
    const found: LinkRange[] = [];
    for (const {$from, $to} of selection.ranges) {
        doc.nodesBetween($from.pos, $to.pos, (node, position) => {
            if (!node.isTextblock) return true;
            for (const range of linksIn(position + 1, node, type)) {
                if (range.from < $to.pos && range.to > $from.pos && !found.some((known) => known.from === range.from)) found.push(range);
            }
            return false;
        });
    }
    return found.sort((a, b) => a.from - b.from);
}

/** 这几条链接的地址：都一样时是那个地址，不一样为 null（卡片不预填、不能确认），没有链接为 null。 */
export function sharedHref(ranges: readonly LinkRange[]): string | null {
    const first = ranges[0];
    return first !== undefined && ranges.every((range) => range.href === first.href) ? first.href : null;
}

/** 光标处能不能插入一段带链接的文字：可写、这个文本块允许链接标记（代码块不允许）。 */
function canInsertAtCursor(editor: Editor): boolean {
    const type = linkType(editor);
    if (type === undefined || !editor.isEditable) return false;
    const {$from} = editor.state.selection;
    return $from.parent.inlineContent && $from.parent.type.allowsMarkType(type);
}

/** 选区非空时能不能给选中的字加链接：碰到的文本块里至少有一个允许链接标记。 */
function canLinkSelection(editor: Editor): boolean {
    const type = linkType(editor);
    if (type === undefined || !editor.isEditable) return false;
    const {from, to} = editor.state.selection;
    let allowed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
        allowed ||= node.isTextblock && node.type.allowsMarkType(type);
        return !allowed;
    });
    return allowed;
}

/** 能不能做 `link`：碰到链接时改地址总是可以；否则按选区加链接、或在光标处插入一段链接。 */
export function canLink(editor: Editor): boolean {
    if (!editor.isEditable || linkType(editor) === undefined) return false;
    if (linksTouching(editor).length > 0) return true;
    return editor.state.selection.empty ? canInsertAtCursor(editor) : canLinkSelection(editor);
}

/**
 * 加链接或改链接：碰到链接时把碰到的每一条整条改成 `href`（保留链接标记上别的属性）；没碰到链接、选着字时给选中的字加链接；
 * 光标处没有链接时插入一段文字（`label`，缺省是地址本身）并让它成为链接。地址不安全（`javascript:` 等）或为空时返回 false。
 */
export function setLinkHref(editor: Editor, href: string, label?: string): boolean {
    const type = linkType(editor);
    const target = href.trim();
    if (type === undefined || !isSafeHref(target) || !canLink(editor)) return false;
    const touched = linksTouching(editor);
    const {state} = editor;
    const {tr} = state;
    if (touched.length > 0) {
        for (const range of touched) tr.addMark(range.from, range.to, type.create({...range.mark.attrs, href: target}));
    } else if (!state.selection.empty) {
        for (const {$from, $to} of state.selection.ranges) tr.addMark($from.pos, $to.pos, type.create({href: target}));
    } else {
        const text = label === undefined || label === "" ? target : label;
        const {from} = state.selection;
        // 事务把折叠的光标映射到插入的文字之后；链接标记不包含末尾（`inclusive: false`），接着打的字在链接外。
        tr.insert(from, state.schema.text(text, [type.create({href: target})]));
    }
    editor.view.dispatch(tr.scrollIntoView());
    return true;
}

/** 去掉碰到的整条链接，文字留着。 */
export function unsetLinks(editor: Editor): boolean {
    const type = linkType(editor);
    if (type === undefined || !editor.isEditable) return false;
    const touched = linksTouching(editor);
    if (touched.length === 0) return false;
    const {tr} = editor.state;
    for (const range of touched) tr.removeMark(range.from, range.to, type);
    editor.view.dispatch(tr.scrollIntoView());
    return true;
}
