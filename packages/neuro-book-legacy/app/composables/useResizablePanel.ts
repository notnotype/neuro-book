import {computed, onScopeDispose, ref, toValue, type MaybeRefOrGetter, type Ref} from "vue";
import {useDraggable} from "@vueuse/core";

export type ResizablePanelEdge = "left" | "right" | "top" | "bottom";

type UseResizablePanelOptions = {
    /** 当前面板尺寸，由宿主组件或 store 提供。 */
    size: MaybeRefOrGetter<number>;
    /** 面板允许的最小尺寸。 */
    minSize: MaybeRefOrGetter<number>;
    /** 面板允许的最大尺寸。 */
    maxSize: MaybeRefOrGetter<number>;
    /** 拖拽手柄所在边，决定尺寸跟随指针变化的方向。 */
    edge: MaybeRefOrGetter<ResizablePanelEdge>;
    /** 是否允许拖拽；为空时默认允许。 */
    enabled?: MaybeRefOrGetter<boolean>;
    /** 是否在拖拽过程中同步回外部状态；需要父布局实时跟随时才开启。 */
    syncDuringResize?: MaybeRefOrGetter<boolean>;
    /** 拖拽中的尺寸变化回调；为空时只更新本地预览尺寸。 */
    onResize?: (value: number) => void;
    /** 拖拽结束回调，适合提交到 store / 持久化状态。 */
    onResizeEnd?: (value: number) => void;
};

/**
 * 将面板尺寸限制在允许范围内。
 */
export function clampResizablePanelSize(value: number, minSize: number, maxSize: number): number {
    const normalizedMin = Math.max(0, minSize);
    const normalizedMax = Math.max(normalizedMin, maxSize);
    return Math.max(normalizedMin, Math.min(value, normalizedMax));
}

/**
 * 统一处理边缘拖拽调整面板尺寸。
 */
export function useResizablePanel(handleRef: Ref<HTMLElement | null>, options: UseResizablePanelOptions) {
    const startSize = ref(0);
    const startPointer = ref(0);
    const previewSize = ref<number | null>(null);
    const pendingSize = ref<number | null>(null);
    const lastEmittedSize = ref<number | null>(null);
    const resizeFrame = ref<number | null>(null);
    const axis = edgeAxis(toValue(options.edge));

    const currentSize = computed(() => {
        return clampResizablePanelSize(toValue(options.size), toValue(options.minSize), toValue(options.maxSize));
    });
    const displaySize = computed(() => previewSize.value ?? currentSize.value);

    const panelStyle = computed(() => axis === "x"
        ? {width: `${displaySize.value}px`}
        : {height: `${displaySize.value}px`});

    /**
     * 在动画帧内合并多次 pointermove，避免每个鼠标事件都触发响应式更新。
     */
    const flushPendingResize = (): void => {
        resizeFrame.value = null;
        const nextSize = pendingSize.value;
        if (nextSize === null) {
            return;
        }

        pendingSize.value = null;
        if (previewSize.value !== null && Math.abs(nextSize - previewSize.value) < 1) {
            return;
        }

        previewSize.value = nextSize;
        if (toValue(options.syncDuringResize) && (lastEmittedSize.value === null || Math.abs(nextSize - lastEmittedSize.value) >= 1)) {
            options.onResize?.(nextSize);
            lastEmittedSize.value = nextSize;
        }
    };

    /**
     * 安排下一帧应用尺寸，限制拖拽期间的更新频率。
     */
    const scheduleResize = (nextSize: number): void => {
        pendingSize.value = nextSize;
        if (resizeFrame.value !== null || !import.meta.client) {
            if (!import.meta.client) {
                flushPendingResize();
            }
            return;
        }

        resizeFrame.value = window.requestAnimationFrame(flushPendingResize);
    };

    /**
     * 拖拽结束时提交最终尺寸，并清理临时预览状态。
     */
    const commitResizeEnd = (): void => {
        if (resizeFrame.value !== null) {
            window.cancelAnimationFrame(resizeFrame.value);
            flushPendingResize();
        }

        const finalSize = previewSize.value ?? currentSize.value;
        if (!toValue(options.syncDuringResize)) {
            options.onResize?.(finalSize);
        }
        options.onResizeEnd?.(finalSize);
        previewSize.value = null;
        pendingSize.value = null;
        lastEmittedSize.value = null;
    };

    const {isDragging} = useDraggable(handleRef, {
        axis,
        preventDefault: true,
        stopPropagation: true,
        disabled: computed(() => options.enabled !== undefined && !toValue(options.enabled)),
        onStart: (_position, event) => {
            startSize.value = currentSize.value;
            previewSize.value = currentSize.value;
            pendingSize.value = null;
            lastEmittedSize.value = currentSize.value;
            startPointer.value = pointerPosition(event, axis);
        },
        onMove: (_position, event) => {
            const nextPointer = pointerPosition(event, axis);
            const nextSize = startSize.value + (nextPointer - startPointer.value) * edgeDirection(toValue(options.edge));
            scheduleResize(clampResizablePanelSize(nextSize, toValue(options.minSize), toValue(options.maxSize)));
        },
        onEnd: () => {
            commitResizeEnd();
        },
    });

    onScopeDispose(() => {
        if (resizeFrame.value !== null && import.meta.client) {
            window.cancelAnimationFrame(resizeFrame.value);
        }
    });

    return {
        isResizing: isDragging,
        panelStyle,
    };
}

/**
 * 根据边缘方向判断拖拽轴。
 */
function edgeAxis(edge: ResizablePanelEdge): "x" | "y" {
    return edge === "left" || edge === "right" ? "x" : "y";
}

/**
 * 右边/下边拖远会变大；左边/上边拖远会变小。
 */
function edgeDirection(edge: ResizablePanelEdge): 1 | -1 {
    return edge === "right" || edge === "bottom" ? 1 : -1;
}

/**
 * 读取当前拖拽轴上的指针坐标。
 */
function pointerPosition(event: PointerEvent, axis: "x" | "y"): number {
    return axis === "x" ? event.clientX : event.clientY;
}
