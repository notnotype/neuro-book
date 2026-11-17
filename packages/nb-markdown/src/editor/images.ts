/**
 * 插入图片（docs/specs/workbench/markdown-editing.md 输出 54、55）：编辑动作 `image` 与粘贴、以后 w00046 的拖入共用的
 * `insertImages`。图片是行内节点：
 *
 * - 光标在“不在表格里的空段落”、又有几张图时，几张图各占一段（第一张用这个空段落）；
 * - 其余位置（有字的段落、标题、列表项、表格单元格）依次插在光标处，图之间不加字符。表格单元格只能有一段，劈开段落会写出
 *   不可写的文档；
 * - 光标所在的块不允许图片（代码块、原样块）时不接手，返回 false。
 */

import type {Editor} from "@tiptap/core";
import {Fragment} from "@tiptap/pm/model";
import type {Node as PMNode, NodeType} from "@tiptap/pm/model";
import {TextSelection} from "@tiptap/pm/state";

/** `src` 是写进正文的地址（调用方按当前文件算好、编码好），`alt` 是说明。 */
export interface ImageToInsert {
    readonly src: string;
    readonly alt?: string;
}

const imageType = (editor: Editor): NodeType | undefined => editor.schema.nodes.image;

/** 选区在一个文本块里、这个文本块的这个位置能放图片。 */
export function canInsertImages(editor: Editor): boolean {
    const type = imageType(editor);
    if (type === undefined || !editor.isEditable) return false;
    const {$from, $to} = editor.state.selection;
    if (!$from.sameParent($to)) return false;
    return $from.parent.inlineContent && $from.parent.canReplaceWith($from.index(), $to.index(), type);
}

const imageNode = (type: NodeType, image: ImageToInsert): PMNode => type.create({src: image.src, alt: image.alt ?? ""});

/** 在表格里（单元格只放一段）。 */
function inTable(editor: Editor): boolean {
    const {$from} = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type.spec.tableRole !== undefined) return true;
    return false;
}

/** 把图片插在光标处（规则见文件头）；成功后光标在最后一张图的后面。没有图、不能放返回 false。 */
export function insertImages(editor: Editor, images: readonly ImageToInsert[]): boolean {
    const type = imageType(editor);
    if (type === undefined || images.length === 0 || !canInsertImages(editor)) return false;
    const {state} = editor;
    const {$from, from, to, empty} = state.selection;
    const {tr} = state;
    if (empty && images.length > 1 && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0 && !inTable(editor)) {
        const paragraph = state.schema.nodes.paragraph as NodeType;
        const paragraphs = images.map((image) => paragraph.create(null, imageNode(type, image)));
        const start = $from.before();
        tr.replaceWith(start, $from.after(), paragraphs);
        const end = start + paragraphs.reduce((sum, node) => sum + node.nodeSize, 0) - 1;
        tr.setSelection(TextSelection.create(tr.doc, end));
    } else {
        const nodes = images.map((image) => imageNode(type, image));
        tr.replaceWith(from, to, Fragment.from(nodes));
        tr.setSelection(TextSelection.create(tr.doc, from + nodes.reduce((sum, node) => sum + node.nodeSize, 0)));
    }
    editor.view.dispatch(tr.scrollIntoView());
    return true;
}
