/**
 * 点链接（docs/specs/workbench/markdown-editing.md 输出 53）：单击选中整条链接，按住 Ctrl（⌘）点才打开。
 *
 * - **单击选中整条链接**在这里做，不用 Tiptap 的 Link 自带的点击选中（`enableClickSelection`）：它在点击处理时读的是点击之前的
 *   选区，点到一条链接选中的是之前光标所在的那条（真实浏览器里实测：光标在甲链接里再点乙链接，选中的是甲）。这里按被点的
 *   `<a>` 取这条链接在文档里的范围。
 * - **Ctrl（⌘）点打开**：打开什么由宿主定（`MarkdownViewHost.openLink`）：作品里的文件在编辑器区打开，外部网址开新标签页。宿主
 *   此刻没有打开的能力（Lab 等）时不接手，当作单击。
 * - 优先级高过 Link 自带的点击插件（1000），所以先到这里；Shift、Alt 加点（扩展选区）与不在链接上的点击返回 false，交给编辑器。
 */

import {Extension, getMarkRange} from "@tiptap/core";
import {Plugin, PluginKey, TextSelection} from "@tiptap/pm/state";
import type {EditorView} from "@tiptap/pm/view";

import type {MarkdownViewHost} from "./view-host";

/** 选中被点的这条链接的整个范围；点的不是编辑器里一条带链接标记的文字（例如图标小块）、或只读时不处理。 */
function selectLink(view: EditorView, anchor: Element): boolean {
    const type = view.state.schema.marks.link;
    if (!view.editable || type === undefined) return false;
    const range = getMarkRange(view.state.doc.resolve(view.posAtDOM(anchor, 0)), type);
    if (range === undefined) return false;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)));
    return true;
}

export const MarkdownLinkOpener = Extension.create<{host: MarkdownViewHost | null}>({
    name: "markdownLinkOpener",
    priority: 1100,

    addOptions() {
        return {host: null};
    },

    addProseMirrorPlugins() {
        const {host} = this.options;
        return [
            new Plugin({
                key: new PluginKey("markdownLinkOpener"),
                props: {
                    handleClick(view, _pos, event) {
                        if (event.button !== 0) return false;
                        const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
                        if (anchor === null || !view.dom.contains(anchor)) return false;
                        if ((event.ctrlKey || event.metaKey) && host?.openLink !== undefined) {
                            // 地址取链接标记上的（渲染出的 `href` 可能被 Link 按安全规则改写）。
                            const first = view.state.doc.nodeAt(view.posAtDOM(anchor, 0));
                            const href = String(first?.marks.find((mark) => mark.type.name === "link")?.attrs.href ?? anchor.getAttribute("href") ?? "");
                            if (href === "") return false;
                            event.preventDefault();
                            host.openLink(href);
                            return true;
                        }
                        if (event.shiftKey || event.altKey) return false;
                        return selectLink(view, anchor);
                    },
                },
            }),
        ];
    },
});
