import {computed, nextTick, ref, watch, type Ref} from "vue";
import {useEventListener, useResizeObserver} from "@vueuse/core";

export type FloatingPanelDirection = "auto" | "down" | "up";

interface UseFloatingPanelLayoutOptions {
    open: Ref<boolean>;
    anchorRef: Ref<HTMLElement | null>;
    panelRef: Ref<HTMLElement | null>;
    direction: Ref<FloatingPanelDirection>;
    maxHeight?: number;
    minHeight?: number;
    viewportGap?: number;
    matchAnchorWidth?: boolean;
}

/**
 * 统一计算浮层的展开方向、宽度与最大高度。
 * 适用于需要和锚点同宽，并支持 up/down/auto 的下拉层。
 */
export function useFloatingPanelLayout(options: UseFloatingPanelLayoutOptions) {
    const maxHeight = options.maxHeight ?? 192;
    const minHeight = options.minHeight ?? 96;
    const viewportGap = options.viewportGap ?? 12;
    const matchAnchorWidth = options.matchAnchorWidth ?? true;

    const resolvedDirection = ref<"down" | "up">("down");
    const panelWidth = ref<number | null>(null);
    const panelMaxHeight = ref(maxHeight);

    /**
     * 查找会裁剪下拉层的最近祖先，Dialog 滚动容器内的 select 需要按它的边界计算空间。
     */
    function clippingBounds(anchorElement: HTMLElement): {top: number; bottom: number} {
        let top = viewportGap;
        let bottom = window.innerHeight - viewportGap;
        let element = anchorElement.parentElement;
        while (element && element !== document.body && element !== document.documentElement) {
            const style = window.getComputedStyle(element);
            const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
            if (/(auto|scroll|hidden|clip)/u.test(overflow)) {
                const rect = element.getBoundingClientRect();
                top = Math.max(top, rect.top + viewportGap);
                bottom = Math.min(bottom, rect.bottom - viewportGap);
            }
            element = element.parentElement;
        }
        return {
            top,
            bottom: Math.max(bottom, top),
        };
    }

    /**
     * 根据可用空间限制下拉高度，空间不足时宁愿变矮也不让容器裁掉。
     */
    function resolvePanelMaxHeight(availableSpace: number): number {
        if (availableSpace <= 0) {
            return minHeight;
        }
        if (availableSpace < minHeight) {
            return Math.floor(availableSpace);
        }
        return Math.max(Math.min(availableSpace, maxHeight), minHeight);
    }

    /**
     * 根据锚点与视口空间刷新浮层布局。
     */
    const updateLayout = (): void => {
        const anchorElement = options.anchorRef.value;
        const panelElement = options.panelRef.value;

        if (!import.meta.client || !anchorElement) {
            resolvedDirection.value = options.direction.value === "up" ? "up" : "down";
            panelWidth.value = null;
            panelMaxHeight.value = maxHeight;
            return;
        }

        if (matchAnchorWidth) {
            panelWidth.value = Math.round(anchorElement.getBoundingClientRect().width);
        }

        if (options.direction.value === "down" || options.direction.value === "up") {
            resolvedDirection.value = options.direction.value;
            panelMaxHeight.value = maxHeight;
            return;
        }

        const anchorRect = anchorElement.getBoundingClientRect();
        const contentHeight = Math.min(panelElement?.scrollHeight || maxHeight, maxHeight);
        const bounds = clippingBounds(anchorElement);
        const bottomSpace = Math.max(bounds.bottom - anchorRect.bottom, 0);
        const topSpace = Math.max(anchorRect.top - bounds.top, 0);

        if (bottomSpace >= contentHeight) {
            resolvedDirection.value = "down";
        } else if (topSpace >= contentHeight) {
            resolvedDirection.value = "up";
        } else {
            resolvedDirection.value = topSpace > bottomSpace ? "up" : "down";
        }

        const availableSpace = resolvedDirection.value === "down" ? bottomSpace : topSpace;
        panelMaxHeight.value = resolvePanelMaxHeight(availableSpace);
    };

    watch(
        [options.open, options.direction],
        async ([open]) => {
            if (!open) {
                return;
            }
            await nextTick();
            updateLayout();
        },
        {flush: "post"},
    );

    useResizeObserver(options.anchorRef, () => {
        if (options.open.value) {
            updateLayout();
        }
    });

    useResizeObserver(options.panelRef, () => {
        if (options.open.value) {
            updateLayout();
        }
    });

    if (import.meta.client) {
        useEventListener(window, "resize", () => {
            if (options.open.value) {
                updateLayout();
            }
        });

        useEventListener(window, "scroll", () => {
            if (options.open.value) {
                updateLayout();
            }
        }, {capture: true, passive: true});
    }

    const panelStyle = computed(() => ({
        maxHeight: `${String(panelMaxHeight.value)}px`,
        width: panelWidth.value === null ? undefined : `${String(panelWidth.value)}px`,
    }));

    return {
        resolvedDirection,
        panelStyle,
        updateLayout,
    };
}
