/**
 * 表情的样子（docs/specs/agent/stickers.md 输出 10、12）：展示器的静态视图与编辑器的节点视图都用 `buildSticker`，生成的元素结构与
 * 类名相同。普通 DOM，不用 Vue。
 *
 * 先显示写法的原文（带 `is-loading`），宿主端口交回表情后换成图；认不出、端口失败或图读不出来时留原文。没有端口时一直是原文。
 */

import {parseSticker} from "../../../stickers";
import type {StickerResolver} from "../../../stickers";

export interface StickerElement {
    readonly dom: HTMLElement;
    /** 取消还没完成的查询、释放查到的表情；块被替换或卸载时调用一次。 */
    destroy(): void;
}

export function buildSticker(document: Document, raw: string, resolve: StickerResolver | undefined, report?: (error: unknown) => void): StickerElement {
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
        dom.classList.remove("is-loading");
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
        dom.replaceChildren(image);
    }, (error: unknown) => {
        if (controller.signal.aborted) return;
        report?.(error);
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
