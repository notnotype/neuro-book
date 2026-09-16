<script setup lang="ts">
import {
    SplitterGroup,
    SplitterPanel,
    SplitterResizeHandle,
} from "reka-ui";
import {computed, nextTick, onBeforeUnmount, useId, watch, type ComponentPublicInstance} from "vue";
import {
    createSplitterGestureTracker,
    type SplitterGestureCancellation,
    type SplitterGestureCancelReason,
    type SplitterGestureState,
} from "./splitter-gesture";

export interface SplitterPanelConfig {
    id?: string;
    defaultSize?: number;
    minSize?: number;
    maxSize?: number;
    collapsible?: boolean;
    collapsedSize?: number;
}

const props = withDefaults(defineProps<{
    direction?: "horizontal" | "vertical";
    autoSaveId?: string;
    disabled?: boolean;
    panels?: SplitterPanelConfig[];
    sashSizes?: readonly number[];
}>(), {
    direction: "horizontal",
    autoSaveId: undefined,
    disabled: false,
    panels: () => [],
    sashSizes: () => [],
});

const emit = defineEmits<{
    (e: "layout", sizes: number[]): void;
    (e: "gesture-start", state: SplitterGestureState): void;
    (e: "gesture-update", state: SplitterGestureState): void;
    (e: "gesture-end", state: SplitterGestureState): void;
    (e: "gesture-cancel", info: SplitterGestureCancellation): void;
}>();

/** Reka 实际响应的调整键；Enter 通过 Panel 公开 API 折叠/恢复，Tab / F6 不开始手势 */
const ADJUST_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Enter", "Home"]);
const DEFAULT_SASH_SIZE = 1;

/** 手势身份由宿主声明；DOM 身份增加组件命名空间，避免同页或嵌套实例产生重复 id */
const panelIds = computed(() => props.panels.map((panel, index) => panel.id ?? `panel-${index}`));
const instanceId = useId();
const domPanelIds = computed(() => panelIds.value.map((id) => `${instanceId}-${id}`));
const panelIdsKey = computed(() => JSON.stringify(panelIds.value));
const panelConstraintsKey = computed(() => JSON.stringify(props.panels.map((panel) => [
    panel.defaultSize,
    panel.minSize,
    panel.maxSize,
    panel.collapsible,
    panel.collapsedSize,
])));

const sashSizes = computed(() => {
    const boundaryCount = Math.max(0, props.panels.length - 1);
    if (props.sashSizes.length > boundaryCount) {
        console.warn(`[nb-ui/Splitter] sashSizes has ${props.sashSizes.length} entries for ${boundaryCount} boundaries; extra entries are ignored.`);
    }
    return Array.from({length: boundaryCount}, (_, index) => {
        const size = props.sashSizes[index] ?? DEFAULT_SASH_SIZE;
        if (Number.isFinite(size) && size >= 0) return size;
        console.warn(`[nb-ui/Splitter] sashSizes[${index}] must be a finite non-negative number; using ${DEFAULT_SASH_SIZE}px.`);
        return DEFAULT_SASH_SIZE;
    });
});
const sashSizesKey = computed(() => JSON.stringify(sashSizes.value));

type SplitterPanelHandle = Pick<InstanceType<typeof SplitterPanel>, "collapse" | "expand">;

const panelHandles = new Map<number, SplitterPanelHandle>();
let detachGlobalListeners: (() => void) | null = null;

function isPanelHandle(value: Element | ComponentPublicInstance | null): value is (Element | ComponentPublicInstance) & SplitterPanelHandle {
    return value !== null && "collapse" in value && typeof value.collapse === "function"
        && "expand" in value && typeof value.expand === "function";
}

function setPanelHandle(index: number, value: Element | ComponentPublicInstance | null): void {
    if (isPanelHandle(value)) {
        panelHandles.set(index, value);
    } else {
        panelHandles.delete(index);
    }
}

function sashStyle(index: number): Record<string, string> {
    const size = `${sashSizes.value[index] ?? DEFAULT_SASH_SIZE}px`;
    return props.direction === "vertical"
        ? {height: size, minHeight: size, flexBasis: size}
        : {width: size, minWidth: size, flexBasis: size};
}

const tracker = createSplitterGestureTracker({
    onStart: (state) => {
        attachGlobalListeners();
        emit("gesture-start", state);
    },
    onUpdate: (state) => emit("gesture-update", state),
    onEnd: (state) => {
        detachGlobalListeners?.();
        emit("gesture-end", state);
    },
    onCancel: (info) => {
        detachGlobalListeners?.();
        emit("gesture-cancel", info);
    },
});

/**
 * Reka 使用模块级 mouse/touch 状态机；取消本组件手势后必须补发上游认识的 mouseup，
 * 否则无按键移动仍会改布局，且后续 Splitter 实例无法开始拖动。
 */
function cancelPointerGesture(reason: SplitterGestureCancelReason): void {
    if (tracker.activeSource !== "pointer") return;
    tracker.cancel(reason);
    window.dispatchEvent(new MouseEvent("mouseup"));
}

function attachGlobalListeners(): void {
    if (detachGlobalListeners) return;
    const onEscapeKeydown = (event: KeyboardEvent): void => {
        if (event.key !== "Escape") return;
        if (tracker.activeSource === "pointer") {
            tracker.cancel("escape");
            window.dispatchEvent(new MouseEvent("mouseup"));
        } else {
            tracker.cancel("escape");
        }
    };
    const onWindowBlur = (): void => {
        if (tracker.activeSource === "keyboard") tracker.end();
        else cancelPointerGesture("blur");
    };
    const onPointerCancel = (): void => cancelPointerGesture("pointercancel");
    const onTouchCancel = (): void => tracker.cancel("pointercancel");
    document.addEventListener("keydown", onEscapeKeydown, true);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("pointercancel", onPointerCancel);
    // 捕获阶段先取消提交，冒泡阶段仍交给 Reka 自己的 touchcancel 处理上游拖动态。
    window.addEventListener("touchcancel", onTouchCancel, true);
    detachGlobalListeners = () => {
        document.removeEventListener("keydown", onEscapeKeydown, true);
        window.removeEventListener("blur", onWindowBlur);
        window.removeEventListener("pointercancel", onPointerCancel);
        window.removeEventListener("touchcancel", onTouchCancel, true);
        detachGlobalListeners = null;
    };
}

function onLayout(sizes: number[]): void {
    emit("layout", sizes);
    tracker.setSizes(sizes);
}

function onHandleDragging(index: number, dragging: boolean): void {
    if (props.disabled) return;
    if (dragging) tracker.begin("pointer", index);
    else tracker.end();
}

function onHandleKeydown(index: number, event: KeyboardEvent): void {
    if (!ADJUST_KEYS.has(event.key)) return;
    // Reka 的 Enter 路径不发布 layout；所有不由本组件执行的 Enter 都必须在这里截断。
    if (event.key === "Enter") event.preventDefault();
    if (props.disabled || sashSizes.value[index] === 0) return;
    if (tracker.activeSource === "keyboard") return;
    if (tracker.activeSource === "pointer") cancelPointerGesture("context-changed");
    tracker.begin("keyboard", index);

    if (event.key !== "Enter") return;
    const panelElement = document.getElementById(domPanelIds.value[index]!);
    const handle = panelHandles.get(index);
    if (!panelElement || !handle) return;
    if (panelElement.dataset.state === "collapsed") handle.expand();
    else handle.collapse();
    void nextTick();
}

function onHandleKeyup(event: KeyboardEvent): void {
    if (!ADJUST_KEYS.has(event.key)) return;
    if (tracker.activeSource === "keyboard") tracker.end();
}

function onHandleBlur(): void {
    if (tracker.activeSource === "keyboard") tracker.end();
}

tracker.setPanelIds(panelIds.value);
watch(panelIdsKey, () => {
    if (tracker.activeSource === "pointer") cancelPointerGesture("context-changed");
    tracker.setPanelIds(panelIds.value);
});
watch(panelConstraintsKey, () => {
    if (tracker.activeSource === "pointer") cancelPointerGesture("context-changed");
    else tracker.cancel("context-changed");
});
watch(sashSizesKey, () => {
    if (tracker.activeSource === "pointer") cancelPointerGesture("context-changed");
    else tracker.cancel("context-changed");
});
watch(() => props.direction, () => {
    if (tracker.activeSource === "pointer") cancelPointerGesture("context-changed");
    else tracker.cancel("context-changed");
});
watch(() => props.disabled, () => {
    if (tracker.activeSource === "pointer") cancelPointerGesture("context-changed");
    else tracker.cancel("context-changed");
});

onBeforeUnmount(() => {
    if (tracker.activeSource === "pointer") cancelPointerGesture("unmount");
    else tracker.cancel("unmount");
    detachGlobalListeners?.();
});
</script>

<template>
    <SplitterGroup
        :direction="props.direction"
        :auto-save-id="props.autoSaveId"
        class="flex h-full w-full overflow-hidden"
        :class="props.direction === 'vertical' ? 'flex-col' : 'flex-row'"
        @layout="onLayout"
    >
        <template v-if="props.panels.length > 0">
            <template v-for="(panel, index) in props.panels" :key="panel.id || index">
                <SplitterPanel
                    :id="domPanelIds[index]"
                    :default-size="panel.defaultSize"
                    :min-size="panel.minSize"
                    :max-size="panel.maxSize"
                    :collapsible="panel.collapsible"
                    :collapsed-size="panel.collapsedSize"
                    :ref="(handle) => setPanelHandle(index, handle)"
                    class="overflow-auto relative"
                >
                    <slot :name="`panel-${panel.id || index}`" :panel="panel" :index="index" />
                </SplitterPanel>

                <!-- 分割拖拽手柄 -->
                <SplitterResizeHandle
                    v-if="index < props.panels.length - 1"
                    :disabled="props.disabled || sashSizes[index] === 0"
                    :tabindex="sashSizes[index] === 0 ? -1 : 0"
                    :style="sashStyle(index)"
                    class="group relative flex shrink-0 items-center justify-center bg-[var(--divider)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[var(--accent-main)] focus-visible:outline-none focus-visible:bg-[var(--accent-main)] data-[state=drag]:bg-[var(--accent-main)] disabled:cursor-not-allowed select-none"
                    :class="[
                        props.direction === 'vertical'
                            ? 'w-full cursor-row-resize after:absolute after:left-0 after:right-0 after:top-1/2 after:h-2.5 after:-translate-y-1/2'
                            : 'h-full cursor-col-resize after:absolute after:top-0 after:bottom-0 after:left-1/2 after:w-2.5 after:-translate-x-1/2',
                        sashSizes[index] === 0 ? 'pointer-events-none after:pointer-events-none' : '',
                    ]"
                    @dragging="(dragging) => onHandleDragging(index, dragging)"
                    @keydown="(event: KeyboardEvent) => onHandleKeydown(index, event)"
                    @keyup="onHandleKeyup"
                    @blur="onHandleBlur"
                >
                    <div
                        class="opacity-0 group-hover:opacity-100 group-data-[state=drag]:opacity-100 transition-opacity [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] rounded-full bg-[var(--accent-main)] shadow-[0_0_6px_color-mix(in_srgb,var(--accent-main)_50%,transparent)]"
                        :class="props.direction === 'vertical' ? 'h-1 w-6' : 'w-1 h-6'"
                    />
                </SplitterResizeHandle>
            </template>
        </template>
        <template v-else>
            <slot />
        </template>
    </SplitterGroup>
</template>
