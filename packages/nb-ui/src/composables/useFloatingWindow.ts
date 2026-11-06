/**
 * 浮动窗口（`FloatingWindow`）的定位、拖动与缩放。打开时按容器居中；拖动时窗口至少留一角在容器里，顶上总能再抓住；
 * 缩放有六个手柄（右、下两条边加四个角），鼠标在松开时提交尺寸，方向键按 10px（Shift 1px）调整。
 *
 * 拖动区域有几处（面板留白、标题栏、内容里标了 `data-dialog-drag` 的元素），按下处由 `startDrag` 判定，指针捕获在面板上。
 *
 * 容器：传送目标不是 body 时（例如组件 Lab 的画布）按目标的大小算，否则按浏览器窗口。尺寸按渲染后的实际大小夹紧，
 * 所以宽度可以写成 CSS 字符串。
 */

import {computed, onBeforeUnmount, ref, shallowRef, watch} from "vue";
import type {CSSProperties} from "vue";
import {useElementSize, useWindowSize} from "@vueuse/core";

import type {NbUiTextKey} from "../locales";

/** 缩放方向：正号表示拖动时右/下边界跟随指针，负号表示左/上边界跟随指针。 */
export type FloatingWindowResizeDirection = {
    width: 0 | 1 | -1;
    height: 0 | 1 | -1;
};

export type FloatingWindowResizeHandle = {
    id: string;
    /** 读屏名称在 nb-ui 目录里的键；显示时由组件经翻译端口取。 */
    labelKey: NbUiTextKey;
    orientation?: "vertical" | "horizontal";
    direction: FloatingWindowResizeDirection;
    class: string;
};

/** 角落要能任意拖，所以四个角都在；负方向（左/上）拖动时同时改写窗口的 x / y。 */
export const FLOATING_WINDOW_RESIZE_HANDLES: ReadonlyArray<FloatingWindowResizeHandle> = [
    {id: "right", labelKey: "floatingWindow.resizeWidth", orientation: "vertical", direction: {width: 1, height: 0}, class: "inset-y-0 right-0 w-2 cursor-ew-resize"},
    {id: "bottom", labelKey: "floatingWindow.resizeHeight", orientation: "horizontal", direction: {width: 0, height: 1}, class: "inset-x-0 bottom-0 h-2 cursor-ns-resize"},
    {id: "bottom-right", labelKey: "floatingWindow.resize", direction: {width: 1, height: 1}, class: "bottom-0 right-0 h-3 w-3 cursor-nwse-resize"},
    {id: "bottom-left", labelKey: "floatingWindow.resize", direction: {width: -1, height: 1}, class: "bottom-0 left-0 h-3 w-3 cursor-nesw-resize"},
    {id: "top-right", labelKey: "floatingWindow.resize", direction: {width: 1, height: -1}, class: "top-0 right-0 h-3 w-3 cursor-nesw-resize"},
    {id: "top-left", labelKey: "floatingWindow.resize", direction: {width: -1, height: -1}, class: "top-0 left-0 h-3 w-3 cursor-nwse-resize"},
];

/** 按下后移动超过这么多 CSS 像素才算拖动窗口；不到这一步松开就是一次普通的点击。 */
const DRAG_THRESHOLD = 3;
/** 容器变小、窗口被推回时离边的距离。 */
const PUSH_MARGIN = 8;

export interface FloatingWindowOptions {
    readonly open: () => boolean;
    /** 传送目标选择器；false 表示不传送（定位按 offsetParent）。 */
    readonly target: () => string | false;
    readonly resizable: () => boolean;
    readonly busy: () => boolean;
    readonly minWidth: () => number;
    readonly minHeight: () => number;
    /** 宿主声明的数字尺寸（px）；量不到实际尺寸时（刚挂上还没布局）按它。 */
    readonly declared: () => {readonly width: number | null; readonly height: number | null};
    /** 面板：带 `data-dialog-surface` 的元素，拖动时指针捕获在它上面。 */
    readonly windowRef: {readonly value: HTMLElement | null};
    readonly onResize: (dimension: "width" | "height", value: number) => void;
}

export function useFloatingWindow(options: FloatingWindowOptions) {
    const positioned = ref(false);
    /** 缩放拖动中的尺寸（px）；松开时提交，之后由宿主经 width / height 给回来。 */
    const draftWidth = ref<number | null>(null);
    const draftHeight = ref<number | null>(null);
    const x = ref(24);
    const y = ref(24);
    /** 这次打开后用户拖过或缩放过：没有时窗口跟着容器保持居中，有时位置归用户。 */
    let placedByUser = false;
    let resizeCleanup: (() => void) | null = null;
    let dragCleanup: (() => void) | null = null;

    const {width: viewportWidth, height: viewportHeight} = useWindowSize();
    const portalElement = shallowRef<HTMLElement | null>(null);
    const portalSize = ref({width: 0, height: 0});
    const {width: observedWidth, height: observedHeight} = useElementSize(portalElement);
    watch([observedWidth, observedHeight], ([width, height]) => {
        if (width > 0) portalSize.value = {width, height};
    });

    // 打开时才查：宿主的目标元素要等整棵树插进文档才在。
    function resolvePortal(): void {
        const target = options.target();
        const element = target === false || target === "body" ? null : document.querySelector<HTMLElement>(target);
        portalElement.value = element;
        portalSize.value = element === null ? {width: 0, height: 0} : {width: element.clientWidth, height: element.clientHeight};
    }

    const containerSize = computed(() => {
        const element = options.windowRef.value;
        if (options.target() === false && element !== null) {
            const parent = element.offsetParent;
            if (parent instanceof HTMLElement && parent !== document.body && parent.clientWidth > 0) return {width: parent.clientWidth, height: parent.clientHeight};
        }
        if (portalElement.value !== null && portalSize.value.width > 0) return portalSize.value;
        return {width: viewportWidth.value, height: viewportHeight.value};
    });

    /** 渲染后的实际尺寸（不含缩放中的草稿），夹紧与缩放起点都按它；量不到时按声明的尺寸，再不行按最小尺寸。 */
    function measured(): {width: number; height: number} {
        const element = options.windowRef.value;
        const declared = options.declared();
        const width = element !== null && element.offsetWidth > 0 ? element.offsetWidth : declared.width ?? options.minWidth();
        const height = element !== null && element.offsetHeight > 0 ? element.offsetHeight : declared.height ?? options.minHeight();
        return {width, height};
    }

    /** 拖动边界：窗口至少保留一角在容器内，标题栏始终可再次抓取。 */
    const clampedX = computed(() => {
        const width = draftWidth.value ?? measured().width;
        const minX = 16 - width + 72;
        const maxX = Math.max(containerSize.value.width - 72, minX);
        return Math.min(Math.max(x.value, minX), maxX);
    });
    const clampedY = computed(() => {
        const maxY = Math.max(containerSize.value.height - 48, 8);
        return Math.min(Math.max(y.value, 8), maxY);
    });

    const style = computed<CSSProperties>(() => ({
        position: "fixed",
        left: `${String(clampedX.value)}px`,
        top: `${String(clampedY.value)}px`,
        // 没量到位置前先藏起来：第一帧不在左上角闪一下。
        visibility: positioned.value ? undefined : "hidden",
        ...(draftWidth.value === null ? {} : {width: `${String(draftWidth.value)}px`}),
        ...(draftHeight.value === null ? {} : {height: `${String(draftHeight.value)}px`}),
    }));

    /** 渲染时（如有 transform 缩放）指针位移要换算回 CSS 像素。 */
    function scaleOf(element: HTMLElement): {x: number; y: number} {
        const rect = element.getBoundingClientRect();
        return {
            x: element.offsetWidth > 0 && rect.width > 0 ? rect.width / element.offsetWidth : 1,
            y: element.offsetHeight > 0 && rect.height > 0 ? rect.height / element.offsetHeight : 1,
        };
    }

    /**
     * 按下处能不能起拖：面板自己，或没有滚动的正文（`data-dialog-body`）自己，也就是没有内容的留白；或者面板里标了
     * `data-dialog-drag` 的元素，其中的按钮、输入控件、链接、`role="button"` 与 `[data-interactive]` 除外。正文为焦点光环
     * 留的那一圈压在面板的内边距上，不算正文就只剩外沿几个像素能拖；正文会滚动时不算：叠加式滚动条（macOS）不占位置，
     * 量不出按的是不是滚动条。按下处属于嵌套在里面的另一个窗口时不算：事件冒泡上来，由那个窗口自己处理。
     */
    function inDragRegion(element: HTMLElement, target: Element): boolean {
        if (target.closest("[data-dialog-surface]") !== element) return false;
        if (target === element) return true;
        if (target.hasAttribute("data-dialog-body")) return target.scrollHeight <= target.clientHeight && target.scrollWidth <= target.clientWidth;
        const control = target.closest("button, input, textarea, a, select, [role='button'], [data-interactive]");
        if (control !== null && element.contains(control)) return false;
        const region = target.closest("[data-dialog-drag]");
        return region !== null && element.contains(region);
    }

    /**
     * 挂在面板的 pointerdown 上；不在拖动区域里的按下原样放过。按下时不拦默认动作、不捕获指针：输入框照常失焦提交，
     * 区域里没认出来的可点元素照常收到 click。移动超过 `DRAG_THRESHOLD` 才算拖动，这时才捕获指针、清掉选区并拦住选字。
     */
    function startDrag(event: PointerEvent): void {
        if (event.button !== 0 || options.busy()) return;
        const element = options.windowRef.value;
        if (element === null || !(event.target instanceof Element) || !inDragRegion(element, event.target)) return;
        dragCleanup?.();
        const pointerId = event.pointerId;
        const startClientX = event.clientX;
        const startClientY = event.clientY;
        const startLeft = clampedX.value;
        const startTop = clampedY.value;
        const scale = scaleOf(element);
        let dragging = false;
        const preventSelect = (selectEvent: Event): void => selectEvent.preventDefault();
        const move = (moveEvent: PointerEvent): void => {
            if (moveEvent.pointerId !== pointerId) return;
            const dx = moveEvent.clientX - startClientX;
            const dy = moveEvent.clientY - startClientY;
            if (!dragging) {
                if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                dragging = true;
                placedByUser = true;
                element.setPointerCapture?.(pointerId);
                window.getSelection()?.removeAllRanges();
                document.addEventListener("selectstart", preventSelect);
            }
            x.value = startLeft + dx / scale.x;
            y.value = startTop + dy / scale.y;
        };
        const finish = (endEvent: PointerEvent): void => {
            if (endEvent.pointerId === pointerId) cleanup();
        };
        const cleanup = (): void => {
            if (dragging && element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", finish);
            window.removeEventListener("pointercancel", finish);
            document.removeEventListener("selectstart", preventSelect);
            dragCleanup = null;
        };
        // 还没捕获时指针可能移出面板，移动与松开在 window 上收；捕获之后事件仍冒泡到 window。
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
        dragCleanup = cleanup;
    }

    function startResize(direction: FloatingWindowResizeDirection, event: PointerEvent): void {
        if (!options.resizable() || options.busy()) return;
        const element = options.windowRef.value;
        if (element === null) return;
        placedByUser = true;
        resizeCleanup?.();
        const handle = event.currentTarget as HTMLElement;
        const startX = event.clientX;
        const startY = event.clientY;
        const start = measured();
        const startLeft = clampedX.value;
        const startTop = clampedY.value;
        const scale = scaleOf(element);
        event.preventDefault();
        handle.setPointerCapture?.(event.pointerId);
        // 负方向手柄（左/上）拖动时，窗口的 x / y 跟着边界走：先算新尺寸，再由尺寸反推位置，触到最小尺寸时位置不再漂移。
        const move = (moveEvent: PointerEvent): void => {
            if (direction.width !== 0) {
                const next = Math.max(options.minWidth(), Math.round(start.width + ((moveEvent.clientX - startX) / scale.x) * direction.width));
                draftWidth.value = next;
                if (direction.width < 0) x.value = startLeft + (start.width - next);
            }
            if (direction.height !== 0) {
                const next = Math.max(options.minHeight(), Math.round(start.height + ((moveEvent.clientY - startY) / scale.y) * direction.height));
                draftHeight.value = next;
                if (direction.height < 0) y.value = startTop + (start.height - next);
            }
        };
        const finish = (commit: boolean): void => {
            try {
                handle.releasePointerCapture?.(event.pointerId);
            } catch {
                // 已经释放过了
            }
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", onPointerUp);
            handle.removeEventListener("pointercancel", onPointerCancel);
            if (commit) {
                if (draftWidth.value !== null && draftWidth.value !== start.width) options.onResize("width", draftWidth.value);
                if (draftHeight.value !== null && draftHeight.value !== start.height) options.onResize("height", draftHeight.value);
            }
            draftWidth.value = null;
            draftHeight.value = null;
            resizeCleanup = null;
        };
        const onPointerUp = (): void => finish(true);
        const onPointerCancel = (): void => finish(false);
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", onPointerUp);
        handle.addEventListener("pointercancel", onPointerCancel);
        resizeCleanup = () => finish(false);
    }

    /** 方向键沿用“光标移动方向”：在负方向手柄上按向左键，左边界继续向左，也就是变大。 */
    function resizeByKey(direction: FloatingWindowResizeDirection, event: KeyboardEvent): void {
        if (!options.resizable() || options.busy()) return;
        const step = event.shiftKey ? 1 : 10;
        const horizontal = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
        const vertical = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
        const wantsWidth = direction.width !== 0 && horizontal !== 0;
        const wantsHeight = direction.height !== 0 && vertical !== 0;
        if (!wantsWidth && !wantsHeight) return;
        event.preventDefault();
        placedByUser = true;
        const current = measured();
        if (wantsWidth) {
            const next = Math.max(options.minWidth(), current.width + horizontal * direction.width);
            if (next !== current.width) options.onResize("width", next);
        }
        if (wantsHeight) {
            const next = Math.max(options.minHeight(), current.height + vertical * direction.height);
            if (next !== current.height) options.onResize("height", next);
        }
    }

    // 打开时居中：量一次实际尺寸，按容器居中；量不到就用 64px 顶距。看的是面板元素而不只是“打开”：传送到 body 时
    // reka 的 Teleport 自己挂载后才渲染内容，第一次就打开的窗口面板比“打开”晚一拍出现。渲染之后才运行，量的是挂好的面板。
    watch(() => (options.open() ? options.windowRef.value : null), (element) => {
        if (element === null) {
            positioned.value = false;
            return;
        }
        resolvePortal();
        placedByUser = false;
        center();
        positioned.value = true;
    }, {immediate: true, flush: "post"});

    function center(): void {
        const size = measured();
        const container = containerSize.value;
        x.value = Math.max(12, Math.round((container.width - size.width) / 2));
        y.value = size.height > 0 ? Math.max(24, Math.round((container.height - size.height) / 2)) : 64;
    }

    /** 把一条轴上的位置推到窗口完整可见；放不下时贴着起始边，顶上与左边总能抓住。 */
    function pushedIn(position: number, size: number, container: number): number {
        return Math.max(PUSH_MARGIN, Math.min(position, container - size - PUSH_MARGIN));
    }

    // 容器变了（通常是浏览器窗口）。放大时拖过的窗口不动，也不回到推走之前的位置；窗口的宽高由 CSS 按容器收窄，
    // 所以渲染之后才量。拖动时的“至少留一角”只管拖动，这里不沿用，否则缩窄后关闭按钮可能在容器外。
    watch(containerSize, (container, previous) => {
        if (!options.open() || !positioned.value) return;
        if (!placedByUser) {
            center();
            return;
        }
        const size = measured();
        if (container.width < previous.width) x.value = pushedIn(clampedX.value, size.width, container.width);
        if (container.height < previous.height) y.value = pushedIn(clampedY.value, size.height, container.height);
    }, {flush: "post"});

    onBeforeUnmount(() => {
        resizeCleanup?.();
        dragCleanup?.();
    });

    return {style, startDrag, startResize, resizeByKey, measured, positioned: () => positioned.value};
}
