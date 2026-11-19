/**
 * 表情的样子（docs/specs/agent/stickers.md 输出 10、12）：展示器的静态视图、编辑器的节点视图与 `PromptTextView` 都用 `buildSticker`，
 * 生成的元素结构与类名相同。普通 DOM，不用 Vue。
 *
 * 先显示写法的原文（带 `is-loading`），宿主端口交回表情后换成图（带 `has-image`）；认不出、端口失败或图读不出来时留原文。没有
 * 端口时一直是原文。
 *
 * 查到图时根元素带 `data-sticker-pack`（表情包 id），按贴纸显示的样式按它选中（`display/sticker-display.ts`，输出 47）；回到原文时去掉。
 */

import {parseSticker} from "../../../stickers";
import type {StickerPreview, StickerResolver} from "../../../stickers";

export interface StickerElement {
    readonly dom: HTMLElement;
    /** 取消还没完成的查询、释放查到的表情；块被替换或卸载时调用一次。 */
    destroy(): void;
}

export interface StickerOptions {
    /** 查询失败的出口（记诊断）；没有时丢掉。 */
    readonly report?: ((error: unknown) => void) | undefined;
    /**
     * 点开大图（输出 46）：只认图上不带修饰键的左键单击（双击的第二下不算），表情在链接里时不触发（只走链接）。
     * 没有时表情不能点。
     */
    readonly onActivate?: ((sticker: StickerPreview) => void) | undefined;
    /** 给了就能用键盘打开：图上加按钮语义、可聚焦，回车与空格触发；值是可访问名称。编辑器里的节点不可聚焦，不给。 */
    readonly focusLabel?: ((name: string) => string) | undefined;
}

/** 这次点击算不算“点开”：左键、不带修饰键、不是双击的第二下、不在链接里。 */
function isPlainClick(event: MouseEvent, target: HTMLElement): boolean {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.detail > 1) return false;
    return target.closest("a[href]") === null;
}

export function buildSticker(document: Document, raw: string, resolve: StickerResolver | undefined, options: StickerOptions = {}): StickerElement {
    const dom = document.createElement("span");
    dom.className = "nb-sticker";
    dom.dataset.sticker = raw;
    dom.title = raw;
    dom.textContent = raw;
    const ref = parseSticker(raw);
    if (resolve === undefined || ref === null) return {dom, destroy: () => undefined};
    dom.classList.add("is-loading");
    const controller = new AbortController();
    let release: (() => void) | null = null;
    const showText = (): void => {
        dom.classList.remove("is-loading", "has-image", "is-previewable");
        delete dom.dataset.stickerPack;
        dom.removeAttribute("role");
        dom.removeAttribute("tabindex");
        dom.removeAttribute("aria-label");
        dom.replaceChildren(raw);
    };
    resolve(ref, controller.signal).then((found) => {
        if (controller.signal.aborted) {
            found?.release();
            return;
        }
        if (found === null) {
            showText();
            return;
        }
        release = () => found.release();
        const image = document.createElement("img");
        image.className = "nb-sticker__image";
        image.alt = raw;
        image.draggable = false;
        image.width = found.width;
        image.height = found.height;
        image.decoding = "async";
        image.addEventListener("load", () => dom.classList.remove("is-loading"), {once: true});
        image.addEventListener("error", showText, {once: true});
        image.src = found.url;
        dom.classList.add("has-image");
        if (found.pack !== undefined) dom.dataset.stickerPack = found.pack;
        const onActivate = options.onActivate;
        if (onActivate !== undefined) {
            const preview: StickerPreview = {raw, url: found.url, name: ref.name, width: found.width, height: found.height, ...(found.packTitle === undefined ? {} : {packTitle: found.packTitle})};
            dom.classList.add("is-previewable");
            image.addEventListener("click", (event) => {
                if (!isPlainClick(event, dom)) return;
                onActivate(preview);
            });
            if (options.focusLabel !== undefined) {
                dom.setAttribute("role", "button");
                dom.tabIndex = 0;
                dom.setAttribute("aria-label", options.focusLabel(ref.name));
                dom.addEventListener("keydown", (event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    if (!dom.classList.contains("is-previewable")) return;
                    event.preventDefault();
                    onActivate(preview);
                });
            }
        }
        dom.replaceChildren(image);
    }, (error: unknown) => {
        if (controller.signal.aborted) return;
        options.report?.(error);
        showText();
    });
    return {
        dom,
        destroy: () => {
            controller.abort();
            release?.();
            release = null;
        },
    };
}
