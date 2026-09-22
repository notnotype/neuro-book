import {computed, getCurrentInstance, onBeforeUnmount, ref} from "vue";

/**
 * 悬浮 macOS 胶囊滚动条与智能双向渐隐感知 composable。
 *
 * 职责：
 * 1. 滚动条几何计算：根据 Viewport 的 scrollHeight / clientHeight 计算 thumb 的高度与位移；
 * 2. 挂载即时感知：在 DOM 挂载与 ResizeObserver 尺寸变化时立即计算，无需等待用户滚动即可显现滚动条与底部虚化；
 * 3. 鼠标拖拽：监听 mousedown / mousemove / mouseup 实现原生手感的 1:1 拖拽滚动；
 * 4. 双向渐隐感知：感知顶底端到达状态，自适应提供 `.nb-ui-popover-scroll-fade-*` 渐隐类名。
 */

export interface FloatingScrollbarOptions {
    /** 轨道上下内边距，默认 12px (上下各 6px) */
    trackPadding?: number;
    /** 滑块最小高度，默认 24px */
    minThumbHeight?: number;
}

export function useFloatingScrollbar(options: FloatingScrollbarOptions = {}) {
    const trackPadding = options.trackPadding ?? 12;
    const minThumbHeight = options.minThumbHeight ?? 24;

    const viewportEl = ref<HTMLElement | null>(null);
    const scrollThumbTop = ref(trackPadding / 2);
    const scrollThumbHeight = ref(40);
    const isScrollable = ref(false);
    const isDragging = ref(false);
    const isScrolledFromTop = ref(false);
    const isScrolledToBottom = ref(false);

    let startY = 0;
    let startScrollTop = 0;
    let resizeObserver: ResizeObserver | null = null;

    function syncScrollbar(el: HTMLElement): void {
        const {scrollTop, scrollHeight, clientHeight} = el;
        isScrollable.value = scrollHeight > clientHeight + 2;
        isScrolledFromTop.value = scrollTop > 3;
        isScrolledToBottom.value = scrollTop + clientHeight >= scrollHeight - 4;
        if (!isScrollable.value) return;

        const trackHeight = clientHeight - trackPadding;
        const ratio = clientHeight / scrollHeight;
        const thumbH = Math.max(minThumbHeight, trackHeight * ratio);
        scrollThumbHeight.value = thumbH;

        const maxScroll = scrollHeight - clientHeight;
        const maxTop = trackHeight - thumbH;
        scrollThumbTop.value = maxScroll > 0
            ? (scrollTop / maxScroll) * maxTop + (trackPadding / 2)
            : trackPadding / 2;
    }

    function setViewportRef(el: unknown): void {
        const domEl = (el && typeof el === "object" && "$el" in el ? (el as { $el: HTMLElement }).$el : el) as HTMLElement | null;
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
        viewportEl.value = domEl;
        if (domEl) {
            syncScrollbar(domEl);
            if (typeof requestAnimationFrame !== "undefined") {
                requestAnimationFrame(() => {
                    if (viewportEl.value) syncScrollbar(viewportEl.value);
                });
            }
            if (typeof ResizeObserver !== "undefined") {
                resizeObserver = new ResizeObserver(() => {
                    syncScrollbar(domEl);
                });
                resizeObserver.observe(domEl);
            }
        }
    }

    function handleViewportScroll(e: Event): void {
        const el = e.target as HTMLElement;
        if (el) {
            viewportEl.value = el;
            syncScrollbar(el);
        }
    }

    function handleThumbMouseDown(e: MouseEvent): void {
        e.preventDefault();
        e.stopPropagation();
        isDragging.value = true;
        startY = e.clientY;
        startScrollTop = viewportEl.value ? viewportEl.value.scrollTop : 0;

        window.addEventListener("mousemove", handleThumbMouseMove);
        window.addEventListener("mouseup", handleThumbMouseUp);
    }

    function handleThumbMouseMove(e: MouseEvent): void {
        if (!isDragging.value || !viewportEl.value) return;
        const el = viewportEl.value;
        const deltaY = e.clientY - startY;
        const trackHeight = el.clientHeight - trackPadding;
        const maxTop = trackHeight - scrollThumbHeight.value;
        const maxScroll = el.scrollHeight - el.clientHeight;

        if (maxTop > 0) {
            const scrollDelta = (deltaY / maxTop) * maxScroll;
            el.scrollTop = startScrollTop + scrollDelta;
        }
    }

    function handleThumbMouseUp(): void {
        isDragging.value = false;
        window.removeEventListener("mousemove", handleThumbMouseMove);
        window.removeEventListener("mouseup", handleThumbMouseUp);
    }

    if (getCurrentInstance()) {
        onBeforeUnmount(() => {
            if (resizeObserver) {
                resizeObserver.disconnect();
                resizeObserver = null;
            }
            window.removeEventListener("mousemove", handleThumbMouseMove);
            window.removeEventListener("mouseup", handleThumbMouseUp);
        });
    }

    const scrollFadeClass = computed(() => {
        if (!isScrollable.value) return "";
        const top = isScrolledFromTop.value;
        const bottom = !isScrolledToBottom.value;
        if (top && bottom) return "nb-ui-popover-scroll-fade-both";
        if (top) return "nb-ui-popover-scroll-fade-top";
        if (bottom) return "nb-ui-popover-scroll-fade-bottom";
        return "";
    });

    return {
        viewportEl,
        scrollThumbTop,
        scrollThumbHeight,
        isScrollable,
        isDragging,
        isScrolledFromTop,
        isScrolledToBottom,
        scrollFadeClass,
        setViewportRef,
        syncScrollbar,
        handleViewportScroll,
        handleThumbMouseDown,
    };
}
