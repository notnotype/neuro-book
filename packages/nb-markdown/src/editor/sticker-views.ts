/**
 * 编辑器里的表情（docs/specs/agent/stickers.md 输出 10–12、21）：节点视图用与展示器相同的 `buildSticker`；只有表情的文本块带上
 * 大图的类名、紧挨文字的表情带上间隙的类名，都由装饰给，判断与展示器是同一组函数（`isLargeStickerBlock`、`stickerGapClasses`）。
 *
 * 大小与间隙放在装饰里、不放进节点视图：节点视图只在它自己的节点变了时更新，同一段里别处打字时它不会重算。
 */

import {Extension} from "@tiptap/core";
import type {Node as PMNode} from "@tiptap/pm/model";
import {Plugin, PluginKey, TextSelection} from "@tiptap/pm/state";
import {Decoration, DecorationSet} from "@tiptap/pm/view";
import type {EditorView, NodeView} from "@tiptap/pm/view";

import {isLargeStickerBlock, LARGE_STICKER_CLASS, rawOf, STICKER_NODE, stickerGapClasses} from "../language/syntax/sticker";
import {buildSticker} from "../language/syntax/sticker/view";
import type {MarkdownViewHost} from "./view-host";

function stickerView(node: PMNode, view: EditorView, getPos: () => number | undefined, host: MarkdownViewHost | null): NodeView {
    const element = buildSticker(view.dom.ownerDocument, rawOf(node), host?.stickers ?? undefined, {
        report: (error) => host?.report?.("编辑器查不到表情，显示原文", error),
        // 单击打开大图（输出 46），点击时才读宿主的端口：换挂载不重建扩展。输入法组字时不打开。
        // 节点不可选、图在不可编辑的元素里，点它浏览器不移动光标：先把光标放到这个表情后面、聚焦正文，预览关上时焦点（由对话框
        // 还给打开前的元素）回到这里，接着打字落在表情后面。
        onActivate: (sticker) => {
            if (view.composing) return;
            const preview = host?.previewSticker;
            if (preview === undefined) return;
            const pos = getPos();
            if (pos !== undefined) {
                const after = Math.min(pos + node.nodeSize, view.state.doc.content.size);
                view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, after)));
            }
            view.focus();
            preview(sticker);
        },
    });
    element.dom.contentEditable = "false";
    return {
        dom: element.dom,
        // 原文变了（撤销、重载）就重建视图：一个视图只查一次表情。
        update: (next) => next.type === node.type && rawOf(next) === rawOf(node),
        selectNode: () => element.dom.classList.add("ProseMirror-selectednode"),
        deselectNode: () => element.dom.classList.remove("ProseMirror-selectednode"),
        ignoreMutation: () => true,
        destroy: () => element.destroy(),
    };
}

/** 范围里的文本块：只有表情的整块一个装饰，紧挨文字的表情各一个装饰。 */
function stickerDecorations(doc: PMNode, from = 0, to = doc.content.size): Decoration[] {
    const decorations: Decoration[] = [];
    doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return true;
        if (isLargeStickerBlock(node)) decorations.push(Decoration.node(pos, pos + node.nodeSize, {class: LARGE_STICKER_CLASS}));
        const gaps = stickerGapClasses(node);
        let index = 0;
        node.forEach((child, offset) => {
            if (child.type.name !== STICKER_NODE) return;
            const names = gaps[index] ?? "";
            index += 1;
            if (names !== "") decorations.push(Decoration.node(pos + 1 + offset, pos + 1 + offset + child.nodeSize, {class: names}));
        });
        return false;
    });
    return decorations;
}

const blocksKey = new PluginKey<DecorationSet>("markdownStickerBlocks");

export const MarkdownStickerViews = Extension.create<{host: MarkdownViewHost | null}>({
    name: "markdownStickerViews",
    addOptions() {
        return {host: null};
    },
    addProseMirrorPlugins() {
        const host = this.options.host;
        return [
            new Plugin({props: {nodeViews: {[STICKER_NODE]: (node, view, getPos) => stickerView(node, view, getPos, host)}}}),
            new Plugin<DecorationSet>({
                key: blocksKey,
                state: {
                    init: (_config, state) => DecorationSet.create(state.doc, stickerDecorations(state.doc)),
                    apply: (tr, previous) => {
                        if (!tr.docChanged) return previous;
                        // 只重算这次改到的文本块：映射旧的装饰，再把改动范围里的去掉、重新判断。
                        let set = previous.map(tr.mapping, tr.doc);
                        tr.mapping.maps.forEach((map, index) => map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                            const rest = tr.mapping.slice(index + 1);
                            const from = Math.max(0, Math.min(rest.map(newStart, -1), tr.doc.content.size));
                            const to = Math.max(from, Math.min(rest.map(newEnd, 1), tr.doc.content.size));
                            const $from = tr.doc.resolve(from);
                            const $to = tr.doc.resolve(to);
                            const start = $from.depth > 0 ? $from.before(Math.min($from.depth, 1)) : from;
                            const end = $to.depth > 0 ? $to.after(Math.min($to.depth, 1)) : to;
                            // `find` 也给只在边界上相接的装饰（前一块、后一块的），而 `nodesBetween` 不重算它们：只去掉落在范围里的。
                            const inside = set.find(start, end).filter((decoration) => decoration.from >= start && decoration.to <= end);
                            set = set.remove(inside).add(tr.doc, stickerDecorations(tr.doc, start, end));
                        }));
                        return set;
                    },
                },
                props: {decorations: (state) => blocksKey.getState(state)},
            }),
        ];
    },
});
