/**
 * 展示器里需要专门样子的节点（docs/specs/ui/markdown-display.md 输出 2、5、8）：提示块、可渲染 HTML、图片与表情。外观与编辑器的节点
 * 视图由同一套函数画（`buildCallout`、`renderHtmlEmbedElement`、`MarkdownImage`、`buildSticker`），交互接到展示器自己：折叠只记在这次显示里，
 * 点图片、表情经 `activate` 交给宿主。别的节点（包括外来方言的）按 schema 的 `renderHTML` 显示。
 */

import type {Node as PMNode} from "@tiptap/pm/model";
import {h, render} from "vue";
import type {AppContext} from "vue";

import type {ChipEnv} from "../chip/chip";
import {buildCallout} from "../language/syntax/callout";
import {renderHtmlEmbedElement} from "../language/syntax/html-embed";
import {rawOf, STICKER_NODE} from "../language/syntax/sticker";
import {buildSticker} from "../language/syntax/sticker/view";
import type {MarkdownTextApi} from "../host/text";
import type {MarkdownText} from "../locale";
import type {StickerPreview, StickerResolver} from "../stickers";
import MarkdownImage from "./MarkdownImage.vue";
import type {ResolveAsset} from "./MarkdownImage.vue";

export type DisplayActivation =
    | {readonly kind: "reference"; readonly target: string}
    | {readonly kind: "link"; readonly href: string}
    | {readonly kind: "image"; readonly address: string}
    /** 点了表情的图（docs/specs/agent/stickers.md 输出 46）；表情在链接里时只发 `link`。 */
    | {readonly kind: "sticker"; readonly sticker: StickerPreview};

export interface StaticViewHost {
    readonly document: Document;
    /** 展示器的上下文（`markdownViewContext`）：图片挂在它上面，读得到展示器所用的翻译端口。 */
    readonly context: AppContext;
    /** 普通 DOM 的文字（引用小块的悬停提示、HTML 卡片的按钮）；与 `context` 里的是同一个端口。 */
    readonly text: MarkdownTextApi;
    readonly resolveAsset: ResolveAsset | undefined;
    /** 表情目录；没有时表情显示原文。 */
    readonly resolveSticker: StickerResolver | undefined;
    /** 链接的小块：宿主的目标分类与文件图标。 */
    readonly chips: ChipEnv;
    /** 图片不显示时的说明（`MarkdownImage` 的 `missing`）；没有时用它的缺省文字。 */
    readonly imageMissing: MarkdownText | undefined;
    activate(activation: DisplayActivation): void;
    /** 记一条诊断：某一块画不出来，按文字显示了。 */
    report(message: string, error: unknown): void;
}

export interface StaticView {
    readonly dom: HTMLElement;
    /** 子块放在这里（渲染器递归填入）。 */
    readonly contentDOM?: HTMLElement;
    /** 释放监听、沙箱与图片；块被替换或展示器卸载时调用一次。 */
    destroy?(): void;
}

export type StaticViewFactory = (node: PMNode, host: StaticViewHost) => StaticView;

export const STATIC_VIEWS: Readonly<Record<string, StaticViewFactory>> = {
    callout: (node, host) => {
        let folded = node.attrs.fold === "-";
        const element = buildCallout(host.document, () => {
            folded = !folded;
            element.render(node, folded);
        });
        element.render(node, folded);
        return {dom: element.dom, contentDOM: element.content};
    },
    htmlEmbed: (node, host) => {
        const wrapper = host.document.createElement("div");
        wrapper.className = "nb-html-embed";
        let rendered = false;
        let teardown: (() => void) | null = null;
        const draw = (): void => {
            teardown?.();
            teardown = renderHtmlEmbedElement(wrapper, String(node.attrs.html ?? ""), rendered, {resolveLabels: () => ({render: host.text.t("htmlEmbed.render"), viewSource: host.text.t("htmlEmbed.viewSource"), caption: host.text.t("htmlEmbed.caption")})}, () => {
                rendered = !rendered;
                draw();
            });
        };
        draw();
        return {dom: wrapper, destroy: () => teardown?.()};
    },
    image: (node, host) => {
        const dom = host.document.createElement("span");
        dom.className = "nb-markdown-image-node";
        const src = String(node.attrs.src ?? "");
        const image = h(MarkdownImage, {src, alt: String(node.attrs.alt ?? ""), title: (node.attrs.title as string | null) ?? null, resolveAsset: host.resolveAsset, missing: host.imageMissing, onActivate: () => host.activate({kind: "image", address: src})});
        // 没有父组件，inject 只看 vnode 的上下文：不带上的话图片拿不到展示器的翻译端口。
        image.appContext = host.context;
        render(image, dom);
        return {dom, destroy: () => render(null, dom)};
    },
    [STICKER_NODE]: (node, host) => buildSticker(host.document, rawOf(node), host.resolveSticker, {
        report: (error) => host.report("展示器查不到表情，显示原文", error),
        onActivate: (sticker) => host.activate({kind: "sticker", sticker}),
        focusLabel: (name) => host.text.t("sticker.preview", {name}),
    }),
};
