/**
 * 拖动会话的 DOM 适配（docs/specs/ui/layout-drag.md）：把指针、键盘与窗口事件接到 `drag-gesture.ts` 的状态机上，读遮挡，
 * 持有指针捕获。这里不做判断，判断都在状态机；也不画东西，反馈由宿主读 `state` 与 `onEnd` 画。
 *
 * 根上常驻的只有按下、click 与（配了键盘时）keydown，别的监听按下才装、结束就拆，闲时窗口上没有这个会话的任何监听。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import {createDragGesture} from "../drag-gesture";
import type {DragCancelReason, DragEnd, DragGestureConfig, DragState, DragStops} from "../drag-gesture";
import type {GridDropPoint} from "../grid-drop";

export interface DragQuery<S, R> {
    readonly source: S;
    readonly point: GridDropPoint;
    /** 指针处最上层的业务元素：反馈元素不算，视口外为 null。 */
    readonly top: Element | null;
    /** 键盘停在的区域；指针拖动为 null。 */
    readonly region: R | null;
}

export interface DragKeyboardOptions<S, R> {
    /** 按下空格时焦点处的来源；焦点不在来源或它的把手上时为 null。 */
    sourceAt(target: Element): S | null;
    /** 拿起时取一次的落点区域，整场不变；为空不拿起。 */
    regions(source: S): ReadonlyArray<R>;
    /** 区域里能停的位置与方向键的轴。 */
    stops(region: R): DragStops;
    /** 起点：第几个区域的第几个位置，或来源自己的坐标（直接 Enter 不移动）。 */
    start(source: S, regions: ReadonlyArray<R>, origin: HTMLElement): {readonly region: number; readonly at: number | GridDropPoint};
    /** 拿起时的元素已被换掉时，同一个来源此刻的元素。 */
    refocus(source: S): HTMLElement | null;
}

export interface DragSessionOptions<S, D, R> {
    /** 手势的范围：来源只认这里面的，指针捕获由它持有。 */
    readonly root: HTMLElement;
    /** 按下处的来源；null 不起拖。 */
    sourceAt(target: Element): S | null;
    /** 过了门槛：宿主冻结它要的东西；返回 false 不起拖。 */
    activate?(source: S): boolean;
    /** 此刻的结构键；一场里它变了整场取消。缺省不比较。 */
    structure?(): string;
    /** 同步判定这一刻的落点，只读，不产生副作用。 */
    resolve(query: DragQuery<S, R>): D | null;
    /** 落点要做的动作的比较键；只显示、不提交的落点为 null。 */
    actionKey(drop: D): string | null;
    /** 放下且与最后显示过的动作相同。 */
    /** `keyboard`：这场是键盘拖动，放下后焦点回到来源。 */
    commit(drop: D, source: S, keyboard: boolean): void;
    /** 一场结束，`last` 是最后发布的状态。 */
    onEnd?(end: DragEnd, last: DragState<S, D>): void;
    /** 一场开始与结束（宿主写光标与禁选的标记）。 */
    onActiveChange?(active: boolean): void;
    /** 滚动时重新判定（缺省），或撤下落点直到指针再动。 */
    readonly scroll?: "reevaluate" | "withdraw";
    /** 边缘滚动的元素；缺省不滚。 */
    readonly autoScroll?: {readonly element: HTMLElement; readonly edgePx?: number; readonly maxStepPx?: number};
    /** 键盘拖动；缺省只有指针。 */
    readonly keyboard?: DragKeyboardOptions<S, R>;
    /** 起拖门槛。 */
    readonly config?: Partial<DragGestureConfig>;
}

export interface DragSession<S, D> {
    readonly state: Readonly<ShallowRef<DragState<S, D> | null>>;
    /** 内容变了而指针没动：撤下落点，直到指针再动。 */
    invalidate(): void;
    /** 宿主那边已经结束了这场：收场，不调 `onEnd`。 */
    abort(): void;
    dispose(): void;
}

const FEEDBACK_SELECTOR = "[data-drag-feedback]";

/** 指针处从上往下第一个不在反馈元素里的元素：菜单、对话框挡着时就是它们里面的元素，落点因此不接收。 */
function topElementAt(document: Document, point: GridDropPoint): Element | null {
    for (const element of document.elementsFromPoint(point.x, point.y)) {
        if (element.closest(FEEDBACK_SELECTOR) === null) return element;
    }
    return null;
}

export function createDragSession<S, D, R = never>(options: DragSessionOptions<S, D, R>): DragSession<S, D> {
    const {root, keyboard, autoScroll} = options;
    const document = root.ownerDocument;
    const view = document.defaultView as Window;
    const state = shallowRef<DragState<S, D> | null>(null);
    /** 拿起时的元素：键盘拖动结束后焦点还给它。 */
    let origin: HTMLElement | null = null;
    let capturedPointer: number | null = null;
    let detachPointer: (() => void) | null = null;
    let detachSession: (() => void) | null = null;

    const cancelBy = (reason: DragCancelReason) => (): void => gesture.cancel(reason);
    const onBlur = cancelBy("blur");

    function onPointerMove(event: PointerEvent): void {
        gesture.move(event.pointerId, {x: event.clientX, y: event.clientY}, event.buttons);
    }

    function onPointerUp(event: PointerEvent): void {
        gesture.release(event.pointerId, {x: event.clientX, y: event.clientY});
    }

    function onPointerCancel(event: PointerEvent): void {
        gesture.pointerCancel(event.pointerId);
    }

    function attachPointer(): void {
        view.addEventListener("pointermove", onPointerMove, true);
        view.addEventListener("pointerup", onPointerUp, true);
        view.addEventListener("pointercancel", onPointerCancel, true);
        detachPointer = () => {
            view.removeEventListener("pointermove", onPointerMove, true);
            view.removeEventListener("pointerup", onPointerUp, true);
            view.removeEventListener("pointercancel", onPointerCancel, true);
            detachPointer = null;
        };
    }

    function onSessionKey(event: KeyboardEvent): void {
        if (!gesture.key({key: event.key, shift: event.shiftKey})) return;
        event.preventDefault();
        event.stopPropagation();
    }

    /** 拿起用的那一下空格的 keyup 也拦下：按钮在空格抬起时激活，标签会被选中。 */
    function onSessionKeyUp(event: KeyboardEvent): void {
        if (!gesture.keyboard || event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
    }

    function onHidden(): void {
        if (document.visibilityState === "hidden") gesture.cancel("hidden");
    }

    /** 焦点进了根之外（命令面板、对话框）：用户已经转去操作那里，按键不能再归拖动。 */
    function onFocusIn(event: FocusEvent): void {
        if (event.target instanceof Node && !root.contains(event.target)) gesture.cancel("focus-left");
    }

    function onKeyboardPress(): void {
        if (gesture.keyboard) gesture.cancel("pressed-elsewhere");
    }

    /**
     * 只认根自己失去捕获：触摸按下时浏览器把指针隐式捕获给被按的元素，捕获换到根时，旧元素上的这个事件会冒泡上来。
     * 不能用 `hasPointerCapture` 判断：规范的顺序是先派发、后切换。
     */
    function onLostCapture(event: PointerEvent): void {
        if (event.target === root && event.pointerId === capturedPointer) gesture.cancel("capture-lost");
    }

    function onScroll(): void {
        gesture.scrolled();
    }

    function onResize(): void {
        gesture.resized();
    }

    function onTouchMove(event: TouchEvent): void {
        event.preventDefault();
    }

    function attachSession(): void {
        view.addEventListener("keydown", onSessionKey, true);
        view.addEventListener("keyup", onSessionKeyUp, true);
        view.addEventListener("pointerdown", onKeyboardPress, true);
        // 不加捕获：页面里的元素失焦也会经过窗口的捕获阶段，这里只要窗口自己失焦那一种。
        view.addEventListener("blur", onBlur);
        view.addEventListener("resize", onResize);
        document.addEventListener("visibilitychange", onHidden);
        document.addEventListener("focusin", onFocusIn, true);
        root.addEventListener("lostpointercapture", onLostCapture);
        root.addEventListener("scroll", onScroll, {capture: true, passive: true});
        root.addEventListener("touchmove", onTouchMove, {passive: false});
        detachSession = () => {
            view.removeEventListener("keydown", onSessionKey, true);
            view.removeEventListener("keyup", onSessionKeyUp, true);
            view.removeEventListener("pointerdown", onKeyboardPress, true);
            view.removeEventListener("blur", onBlur);
            view.removeEventListener("resize", onResize);
            document.removeEventListener("visibilitychange", onHidden);
            document.removeEventListener("focusin", onFocusIn, true);
            root.removeEventListener("lostpointercapture", onLostCapture);
            root.removeEventListener("scroll", onScroll, {capture: true});
            root.removeEventListener("touchmove", onTouchMove);
            detachSession = null;
        };
    }

    /**
     * 取捕获：指针已经不在（`NotFoundError`）或根已不在文档里（`InvalidStateError`）时调用抛错，由状态机按失去捕获取消；没有按键的
     * 鼠标不抛错，但取不到，所以两种都要看。
     */
    function capture(pointerId: number): boolean {
        try {
            root.setPointerCapture(pointerId);
        } catch (error) {
            if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "InvalidStateError")) return false;
            throw error;
        }
        return root.hasPointerCapture(pointerId);
    }

    const gesture = createDragGesture<S, D, R>({
        clock: {
            delay: (run, ms) => view.setTimeout(run, ms),
            cancelDelay: (handle) => view.clearTimeout(handle as number),
            requestFrame: (run) => view.requestAnimationFrame(run),
            cancelFrame: (handle) => view.cancelAnimationFrame(handle as number),
        },
        config: options.config,
        scroll: options.scroll,
        autoScroll: autoScroll === undefined ? undefined : {
            edgePx: autoScroll.edgePx,
            maxStepPx: autoScroll.maxStepPx,
            rect: () => autoScroll.element.getBoundingClientRect(),
            scrollBy: (step) => {
                const before = autoScroll.element.scrollTop;
                autoScroll.element.scrollTop = before + step;
                return autoScroll.element.scrollTop !== before;
            },
        },
        keyboard: keyboard === undefined ? undefined : {
            regions: (source) => keyboard.regions(source),
            stops: (region) => keyboard.stops(region),
            start: (source, regions) => keyboard.start(source, regions, origin as HTMLElement),
        },
        activate: options.activate,
        structure: options.structure,
        resolve: ({source, point, region}) => options.resolve({source, point, region, top: topElementAt(document, point)}),
        actionKey: (drop) => options.actionKey(drop),
        commit: (drop, source, viaKeyboard) => options.commit(drop, source, viaKeyboard),
        publish: (next) => {
            state.value = next;
        },
        ended: options.onEnd,
        activeChanged: options.onActiveChange,
        armed: attachPointer,
        disarmed: () => detachPointer?.(),
        grabbed: (pointerId) => {
            document.getSelection()?.removeAllRanges();
            if (pointerId !== null) {
                if (!capture(pointerId)) return false;
                capturedPointer = pointerId;
            }
            attachSession();
            return true;
        },
        released: () => {
            detachPointer?.();
            detachSession?.();
            if (capturedPointer !== null && root.hasPointerCapture(capturedPointer)) root.releasePointerCapture(capturedPointer);
            capturedPointer = null;
        },
        restoreFocus: (source) => {
            if (origin?.isConnected === true) origin.focus({preventScroll: true});
            else keyboard?.refocus(source)?.focus({preventScroll: true});
        },
    });

    function onPressedAnywhere(): void {
        gesture.pressed();
    }

    /** 冒泡阶段接收：内层先处理并停止传播的按下（分隔线的命中带）不起拖。 */
    function onPointerDown(event: PointerEvent): void {
        if (!gesture.idle || event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return;
        const source = options.sourceAt(event.target);
        if (source === null) return;
        gesture.press({pointerId: event.pointerId, pointerType: event.pointerType, point: {x: event.clientX, y: event.clientY}, source});
    }

    function onClick(event: MouseEvent): void {
        if (!gesture.takeClick(event.detail)) return;
        event.preventDefault();
        event.stopPropagation();
    }

    /** 捕获阶段：要先于标签带自己的按键处理。 */
    function onKeyDown(event: KeyboardEvent): void {
        if (keyboard === undefined || event.key !== " " || event.repeat || !gesture.idle || !(event.target instanceof HTMLElement)) return;
        const source = keyboard.sourceAt(event.target);
        if (source === null) return;
        origin = event.target;
        if (!gesture.startKeyboard(source)) return;
        event.preventDefault();
        event.stopPropagation();
    }

    root.addEventListener("pointerdown", onPressedAnywhere, true);
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("click", onClick, true);
    if (keyboard !== undefined) root.addEventListener("keydown", onKeyDown, true);

    return {
        state,
        invalidate: () => gesture.invalidate(),
        abort: () => gesture.abort(),
        dispose: () => {
            gesture.dispose();
            root.removeEventListener("pointerdown", onPressedAnywhere, true);
            root.removeEventListener("pointerdown", onPointerDown);
            root.removeEventListener("click", onClick, true);
            root.removeEventListener("keydown", onKeyDown, true);
        },
    };
}
