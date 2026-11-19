/**
 * 剧情侧几张表共用的两样（docs/specs/plot/author-ui.md 输出 4、6）：按容器宽度换版式，读取失败时写什么。
 */

import {onBeforeUnmount, onMounted, shallowRef} from "vue";
import type {Ref, ShallowRef} from "vue";

import type {CanonFailure} from "nbook/plugins/canon/shared/contracts";

import type {usePlotText} from "./text";

/** 容器宽度不足这么多像素时换成列表（输出 6）。按容器量：侧栏开着时编辑区比视口窄。 */
export const NARROW_WIDTH = 640;

/**
 * 量 `root` 的内容宽度；量不到（没有 ResizeObserver）时当作很宽。挂上时先同步读一次，窄屏的第一帧就是列表，不先画一帧表格；
 * 读到 0 是还没排版（例如 jsdom），不当真，等观察者。
 */
export function useContainerWidth(root: Ref<HTMLElement | null>): Readonly<ShallowRef<number>> {
    const width = shallowRef(Number.POSITIVE_INFINITY);
    let observer: ResizeObserver | null = null;
    onMounted(() => {
        if (root.value === null) return;
        if (root.value.clientWidth > 0) width.value = root.value.clientWidth;
        if (typeof ResizeObserver === "undefined") return;
        observer = new ResizeObserver((entries) => {
            width.value = entries[0]?.contentRect.width ?? width.value;
        });
        observer.observe(root.value);
    });
    onBeforeUnmount(() => observer?.disconnect());
    return width;
}

/** 读取失败的那一句（输出 4）：线读不到另有说法；找不到写明；服务给了文字说明（例如取数抛错的消息）就写它，否则写失败码。 */
export function failureText(failure: CanonFailure, text: ReturnType<typeof usePlotText>): string {
    if (failure.code === "line-not-found") return text("page.lineMissing");
    const reason = failure.code === "not-found" ? text("page.notFound") : typeof failure.detail === "string" && failure.detail !== "" ? failure.detail : failure.code;
    return text("page.failed", {reason});
}
