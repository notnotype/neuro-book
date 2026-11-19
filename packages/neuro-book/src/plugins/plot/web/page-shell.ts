/**
 * 剧情侧几张表共用的两样（docs/specs/plot/author-ui.md 输出 4、6）：按容器宽度换版式，读取失败时写什么。
 */

import {onBeforeUnmount, onMounted, shallowRef} from "vue";
import type {Ref, ShallowRef} from "vue";

import type {CanonFailure} from "nbook/plugins/canon/shared/contracts";

import type {usePlotText} from "./text";

/** 容器宽度不足这么多像素时换成列表（输出 6）。按容器量：侧栏开着时编辑区比视口窄。 */
export const NARROW_WIDTH = 640;

/** 量 `root` 的内容宽度；量不到（没有 ResizeObserver）时当作很宽。 */
export function useContainerWidth(root: Ref<HTMLElement | null>): Readonly<ShallowRef<number>> {
    const width = shallowRef(Number.POSITIVE_INFINITY);
    let observer: ResizeObserver | null = null;
    onMounted(() => {
        if (root.value === null || typeof ResizeObserver === "undefined") return;
        observer = new ResizeObserver((entries) => {
            width.value = entries[0]?.contentRect.width ?? width.value;
        });
        observer.observe(root.value);
    });
    onBeforeUnmount(() => observer?.disconnect());
    return width;
}

/** 读取失败的那一句（输出 4）：线读不到另有说法，别的写服务给的码。 */
export function failureText(failure: CanonFailure, text: ReturnType<typeof usePlotText>): string {
    if (failure.code === "line-not-found") return text("page.lineMissing");
    return text("page.failed", {reason: failure.code});
}
