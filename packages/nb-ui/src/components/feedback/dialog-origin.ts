/**
 * `Dialog` 与 `FloatingWindow` 的“从触发点展开”：找出是谁触发了打开，算出入场时面该从哪个方向偏过来。
 * 取点与算位移是纯逻辑；`useDialogOrigin` 把它们接到打开与挂载的时序上；动画本身在 DialogSurface.vue（同名 .md）。
 *
 * 取点的两条路径互补：鼠标或触摸点按钮时，按下的坐标最准（按钮可能随点击卸载，焦点也可能已经移走）；
 * 键盘在按钮上按 Enter 或空格时没有指针事件，只能看焦点所在的元素。两条都没有（全局快捷键、命令面板、
 * 程序打开、恢复）就没有来处，面原地缩放淡入。
 */
import {computed, shallowRef, watch} from "vue";
import type {ComputedRef} from "vue";

export type DialogOrigin = {readonly x: number; readonly y: number};
export type DialogOffset = {readonly x: number; readonly y: number};

/** 按下之后多久内打开的对话框算这次按下触发的；再晚就是别的事（比如定时器、异步请求回来）打开的。 */
export const ORIGIN_POINTER_WINDOW_MS = 600;
/** 入场起点的中心离触发点还差多少：起点的中心几乎就在触发点上，面看得出是从那里长出来的（开发者 2026-11-06 试过 18% 加 64px 上限，太小）。 */
export const ORIGIN_OFFSET_RATIO = 0.85;
/** 有来处时的起始缩放；没有来处用 DialogSurface 里的 0.96。 */
export const ORIGIN_FROM_SCALE = 0.3;

/** 焦点落在这些元素上时，键盘触发的打开从它们的中心展开。 */
const TRIGGER_SELECTOR = "button, [role=\"button\"], [role^=\"menuitem\"], a";

let lastPress: {x: number; y: number; at: number} | null = null;
let tracking = false;

/**
 * 装一次 `document` 的捕获阶段 `pointerdown` 监听，记下最近一次按下。捕获阶段是为了不被内容里的
 * `stopPropagation` 挡住；监听要在第一次打开之前就装好，所以由每个对话框在建立时调用。没有 `document`（服务端渲染）时什么都不做。
 */
export function trackDialogOrigin(): void {
    if (tracking || typeof document === "undefined") return;
    tracking = true;
    document.addEventListener("pointerdown", (event) => {
        lastPress = {x: event.clientX, y: event.clientY, at: performance.now()};
    }, true);
}

/**
 * 此刻的触发点：`ORIGIN_POINTER_WINDOW_MS` 内有按下就用按下的坐标；否则焦点所在的按钮、链接或菜单项的中心；都没有是 `null`。
 * 要在 `open` 变成 true 的那一刻取：之后 reka 会把焦点移进面板。
 */
export function captureDialogOrigin(now: number = performance.now()): DialogOrigin | null {
    trackDialogOrigin();
    // 一次按下只算一次打开：同一次点击里紧接着打开的第二个对话框（比如第一个的确认框）不是这个按钮打开的。
    const press = lastPress;
    lastPress = null;
    if (press !== null && now - press.at <= ORIGIN_POINTER_WINDOW_MS) return {x: press.x, y: press.y};
    if (typeof document === "undefined") return null;
    const active = document.activeElement;
    if (!(active instanceof Element) || !active.matches(TRIGGER_SELECTOR)) return null;
    const rect = active.getBoundingClientRect();
    // 量不出尺寸说明它不在画面上（display: none 或已脱离文档），中心没有意义。
    if (rect.width === 0 && rect.height === 0) return null;
    return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
}

/** 面的矩形（视口坐标）和触发点算出入场起点相对终点的位移：从面中心指向触发点。 */
export function dialogOriginOffset(panelRect: {left: number; top: number; width: number; height: number}, origin: DialogOrigin | null): DialogOffset {
    if (origin === null) return {x: 0, y: 0};
    // `+ 0` 把 -0 变成 0，免得测试与调试输出里出现 "-0px"
    return {x: (origin.x - (panelRect.left + panelRect.width / 2)) * ORIGIN_OFFSET_RATIO + 0, y: (origin.y - (panelRect.top + panelRect.height / 2)) * ORIGIN_OFFSET_RATIO + 0};
}

export type DialogOriginOptions = {
    /** 受控的打开态。 */
    readonly open: () => boolean;
    /** 面板元素；挂载前是 null。 */
    readonly panel: () => HTMLElement | null;
    /** 面板的位置已经定下来：量矩形要等它，否则量到的是挪动之前的位置（浮动窗口打开时先量尺寸再居中）。缺省总是就绪。 */
    readonly ready?: () => boolean;
};

/**
 * 把触发点接到面板的入场动画上，返回要合进面板 `style` 的 CSS 变量（`--nb-dialog-from-x/y/scale` 与入场、退场的时长和曲线）。
 *
 * 时序：触发点在 `open` 变 true 的那次更新里取（`pre` 刷新，早于 reka 把焦点移进面板）；位移在面板挂好、位置定下来的
 * `post` 刷新里量一次，随后的那次渲染把变量写上。这几步都在同一个微任务队列里，先于浏览器的第一帧绘制，看不到跳动。
 * 量的时候入场动画才刚开始，缩放围绕面板中心，所以矩形的中心就是终点的中心；位移只在这里量一次，关闭沿用同一组变量，
 * 窗口被拖动后也不重量（收回时起点是窗口现在的位置，终点差出拖动的距离，飞行中看不出来）。
 */
export function useDialogOrigin(options: DialogOriginOptions): {style: ComputedRef<Record<string, string>>} {
    trackDialogOrigin();
    const origin = shallowRef<DialogOrigin | null>(null);
    const offset = shallowRef<DialogOffset | null>(null);

    watch(options.open, (open) => {
        if (!open) return;
        origin.value = captureDialogOrigin();
        offset.value = null;
    }, {immediate: true});

    watch(() => (options.open() && (options.ready?.() ?? true) ? options.panel() : null), (element) => {
        if (element === null || origin.value === null || offset.value !== null) return;
        offset.value = dialogOriginOffset(element.getBoundingClientRect(), origin.value);
    }, {flush: "post", immediate: true});

    const style = computed((): Record<string, string> => {
        if (offset.value === null) return {};
        return {
            "--nb-dialog-from-x": `${String(offset.value.x)}px`,
            "--nb-dialog-from-y": `${String(offset.value.y)}px`,
            "--nb-dialog-from-scale": String(ORIGIN_FROM_SCALE),
            "--nb-dialog-enter-duration": "var(--motion-dialog)",
            "--nb-dialog-enter-ease": "var(--ease-layout)",
            "--nb-dialog-leave-duration": "var(--motion-dialog-leave)",
            "--nb-dialog-leave-ease": "var(--ease-dialog-leave)",
        };
    });
    return {style};
}
