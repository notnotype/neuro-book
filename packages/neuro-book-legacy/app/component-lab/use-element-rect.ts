import {onBeforeUnmount, ref, shallowRef, watch} from "vue";
import type {Ref} from "vue";
import type {HighlightRect} from "./highlight-box.types";

/**
 * 跟踪一个元素的视口矩形。
 *
 * HighlightBox 刻意不做测量，因此测量的责任落在这里：知道「该框谁」的是 Lab。
 *
 * 三个触发源缺一不可——元素自身改尺寸（ResizeObserver）、祖先滚动（capture 阶段的
 * scroll，因为预览区有嵌套滚动容器，事件不冒泡到 window）、窗口改尺寸。
 */
export function useElementRect(): {
    rect: Ref<HighlightRect | null>;
    track: (element: HTMLElement | null) => void;
    /**
     * 手动重测。ResizeObserver 只看得见目标**自身**的尺寸变化：改了假数据后
     * 目标被兄弟节点推走、尺寸却没变的情况它看不见，那时由使用方调这个。
     */
    measure: () => void;
} {
    const rect = ref<HighlightRect | null>(null);
    const target = shallowRef<HTMLElement | null>(null);
    let observer: ResizeObserver | null = null;

    function measure(): void {
        const element = target.value;
        if (element === null || !element.isConnected) {
            rect.value = null;
            return;
        }
        const box = element.getBoundingClientRect();
        rect.value = {top: box.top, left: box.left, width: box.width, height: box.height};
    }

    function attach(): void {
        if (typeof window === "undefined") {
            return;
        }
        window.addEventListener("scroll", measure, {capture: true, passive: true});
        window.addEventListener("resize", measure, {passive: true});
        observer = new ResizeObserver(measure);
    }

    function detach(): void {
        if (typeof window === "undefined") {
            return;
        }
        window.removeEventListener("scroll", measure, {capture: true});
        window.removeEventListener("resize", measure);
        observer?.disconnect();
        observer = null;
    }

    attach();

    watch(target, (element) => {
        observer?.disconnect();
        if (element !== null) {
            observer?.observe(element);
        }
        measure();
    });

    onBeforeUnmount(detach);

    return {
        rect,
        track: (element: HTMLElement | null) => {
            target.value = element;
        },
        measure,
    };
}
