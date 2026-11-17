/**
 * 按住 Ctrl（⌘）点链接打开（docs/specs/workbench/markdown-editing.md 输出 53）。单击照旧：Tiptap 的 Link 自带点击处理（点在链接上
 * 就选中整条链接并吞掉点击），所以这个扩展的优先级要高过它（Link 是 1000），只在按着修饰键且点在链接上时接手，别的返回 false
 * 交给 Link。打开什么由宿主定（`MarkdownViewHost.openLink`）：作品里的文件在编辑器区打开，外部网址开新标签页。
 */

import {Extension} from "@tiptap/core";
import {Plugin, PluginKey} from "@tiptap/pm/state";

import type {MarkdownViewHost} from "./view-host";

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
                        if (host === null || event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
                        const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
                        if (anchor === null || !view.dom.contains(anchor)) return false;
                        // 地址取链接标记上的（渲染出的 `href` 可能被 Link 按安全规则改写）。
                        const first = view.state.doc.nodeAt(view.posAtDOM(anchor, 0));
                        const href = String(first?.marks.find((mark) => mark.type.name === "link")?.attrs.href ?? anchor.getAttribute("href") ?? "");
                        if (href === "") return false;
                        // 宿主此刻没有打开的能力（Lab 等）：不接手，单击的行为照旧。
                        if (host.openLink === undefined) return false;
                        event.preventDefault();
                        host.openLink(href);
                        return true;
                    },
                },
            }),
        ];
    },
});
