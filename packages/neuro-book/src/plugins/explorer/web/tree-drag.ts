/**
 * 树内拖动的手势（docs/specs/workbench/files-explorer.md 的“拖动”）：装在树的滚动元素上，一场指针拖动从按下到放下。
 * 门槛与取消规则照外壳的拖动会话（`plugins/workbench/web/views/drag-session.ts`）；源的冻结、落点判定与提交归控制器，
 * 本模块只把指针下的行与它在行里的位置交出去。
 *
 * - 激活门槛：鼠标与笔移动 6px；触摸按住 200ms 且不超过 6px（先动了就让给滚动）。没过门槛的按下照常是点击。
 * - 每次指针移动（一帧一次）按当下坐标交一次落点，控制器据此算出并显示动作；放下时按那一刻的坐标再交一次，控制器只提交
 *   与最后显示相同的动作。滚动或行变了而指针没动时撤下显示的落点：指针下已经不是用户看到的那一行，放下不写。
 * - Escape、`pointercancel`、失去指针捕获、窗口失焦、页面隐藏、销毁都取消且不写。结束时吞掉同一手势末尾的那次 click。
 *
 * 树里的按下不进外壳的拖动会话：外壳只认视图标题与标签上的拖动源标记。
 */

const DRAG_DISTANCE_PX = 6;
const TOUCH_DELAY_MS = 200;
const TOUCH_TOLERANCE_PX = 6;

/** 指针下的行：行 id 与指针相对行顶的比例（0 到 1）。 */
export interface TreeDragPoint {
    readonly id: string;
    readonly offset: number;
    readonly rect: DOMRect;
}

export interface TreeDragOptions {
    /** 树的滚动元素：行都在它里面。 */
    readonly root: HTMLElement;
    /** 过了门槛：控制器冻结源；返回 false 时不起拖（源不能拖、在编辑或有批量在途）。 */
    start(id: string): boolean;
    /** 指针下的行变了；`null` 是不在任何行上，或要撤下显示的落点。 */
    hover(point: TreeDragPoint | null): void;
    /** 放下：那一刻指针下的行。 */
    drop(point: TreeDragPoint | null): void;
    /** 手势被取消（Escape、指针取消、失焦等）。 */
    cancel(): void;
}

export interface TreeDrag {
    /** 撤下显示的落点（滚动、行变了），直到指针再动。 */
    invalidate(): void;
    /** 控制器那边已经结束了这场拖动（切换显示、源失效）：手势随之收场，不再回调。 */
    abort(): void;
    dispose(): void;
}

interface Pending {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly x: number;
    readonly y: number;
    readonly id: string;
    timer: ReturnType<typeof setTimeout> | null;
}

const ROW_SELECTOR = "[data-explorer-row]";
/** 行里的输入框与按钮自己处理指针。 */
const BLOCKING_SELECTOR = "input, textarea, button, [contenteditable='true'], [contenteditable='']";

export function createTreeDrag(options: TreeDragOptions): TreeDrag {
    const {root} = options;
    const document = root.ownerDocument;
    const view = document.defaultView!;
    let pending: Pending | null = null;
    let active: {readonly pointerId: number; x: number; y: number} | null = null;
    let frame = 0;
    /** 拖动刚结束：同一手势末尾的 click 要吞掉。被吞掉或下一次按下时清。 */
    let swallowClick = false;
    let detach: (() => void) | null = null;

    function pointAt(x: number, y: number): TreeDragPoint | null {
        const element = document.elementFromPoint(x, y)?.closest<HTMLElement>(ROW_SELECTOR);
        if (element === null || element === undefined || !root.contains(element)) return null;
        const rect = element.getBoundingClientRect();
        return {id: element.dataset.explorerRow as string, offset: rect.height > 0 ? (y - rect.top) / rect.height : 0.5, rect};
    }

    function publish(): void {
        frame = 0;
        if (active !== null) options.hover(pointAt(active.x, active.y));
    }

    function clearPending(): void {
        if (pending?.timer != null) clearTimeout(pending.timer);
        pending = null;
    }

    /** 收场：清帧、拆这场的监听、释放捕获。幂等。 */
    function end(): void {
        clearPending();
        if (frame !== 0) cancelAnimationFrame(frame);
        frame = 0;
        const current = active;
        active = null;
        detach?.();
        detach = null;
        delete root.dataset.explorerDragging;
        if (current === null) return;
        swallowClick = true;
        if (root.hasPointerCapture(current.pointerId)) root.releasePointerCapture(current.pointerId);
    }

    function cancel(): void {
        if (active === null) return;
        end();
        options.cancel();
    }

    function begin(from: Pending): void {
        clearPending();
        if (!options.start(from.id)) return;
        active = {pointerId: from.pointerId, x: from.x, y: from.y};
        root.dataset.explorerDragging = "";
        document.getSelection()?.removeAllRanges();
        // 捕获到树上：指针移出树与窗口后仍收得到移动与松手。
        root.setPointerCapture(from.pointerId);
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
        };
        const onHidden = (): void => {
            if (document.visibilityState === "hidden") cancel();
        };
        const onLost = (event: PointerEvent): void => {
            if (event.pointerId === active?.pointerId) cancel();
        };
        const onScroll = (): void => {
            if (active !== null) options.hover(null);
        };
        // 触摸拖动中不让页面滚动。
        const onTouchMove = (event: TouchEvent): void => event.preventDefault();
        view.addEventListener("keydown", onKey, true);
        view.addEventListener("blur", cancel);
        document.addEventListener("visibilitychange", onHidden);
        root.addEventListener("lostpointercapture", onLost);
        root.addEventListener("scroll", onScroll, {passive: true});
        root.addEventListener("touchmove", onTouchMove, {passive: false});
        detach = () => {
            view.removeEventListener("keydown", onKey, true);
            view.removeEventListener("blur", cancel);
            document.removeEventListener("visibilitychange", onHidden);
            root.removeEventListener("lostpointercapture", onLost);
            root.removeEventListener("scroll", onScroll);
            root.removeEventListener("touchmove", onTouchMove);
        };
        publish();
    }

    function onPointerDown(event: PointerEvent): void {
        swallowClick = false;
        if (pending !== null || active !== null || event.button !== 0 || !event.isPrimary) return;
        if (!(event.target instanceof Element) || event.target.closest(BLOCKING_SELECTOR) !== null) return;
        const row = event.target.closest<HTMLElement>(ROW_SELECTOR);
        if (row === null || !root.contains(row)) return;
        const next: Pending = {pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, id: row.dataset.explorerRow as string, timer: null};
        pending = next;
        if (event.pointerType === "touch") next.timer = setTimeout(() => begin(next), TOUCH_DELAY_MS);
    }

    function onPointerMove(event: PointerEvent): void {
        const from = pending;
        if (from !== null && event.pointerId === from.pointerId) {
            const moved = Math.hypot(event.clientX - from.x, event.clientY - from.y);
            if (from.pointerType === "touch") {
                if (moved > TOUCH_TOLERANCE_PX) clearPending();
            } else if (moved >= DRAG_DISTANCE_PX) {
                begin({...from, x: event.clientX, y: event.clientY});
            }
        }
        if (active !== null && event.pointerId === active.pointerId) {
            active.x = event.clientX;
            active.y = event.clientY;
            if (frame === 0) frame = requestAnimationFrame(publish);
        }
    }

    function onPointerUp(event: PointerEvent): void {
        if (pending !== null && event.pointerId === pending.pointerId) clearPending();
        const current = active;
        if (current === null || event.pointerId !== current.pointerId) return;
        const point = pointAt(event.clientX, event.clientY);
        end();
        options.drop(point);
    }

    function onPointerCancel(event: PointerEvent): void {
        if (pending !== null && event.pointerId === pending.pointerId) clearPending();
        if (active !== null && event.pointerId === active.pointerId) cancel();
    }

    function onClick(event: MouseEvent): void {
        if (!swallowClick || event.detail === 0) return;
        swallowClick = false;
        event.preventDefault();
        event.stopPropagation();
    }

    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("click", onClick, true);
    view.addEventListener("pointermove", onPointerMove, true);
    view.addEventListener("pointerup", onPointerUp, true);
    view.addEventListener("pointercancel", onPointerCancel, true);

    return {
        invalidate: () => {
            if (active === null) return;
            if (frame !== 0) cancelAnimationFrame(frame);
            frame = 0;
            options.hover(null);
        },
        abort: () => {
            end();
        },
        dispose: () => {
            cancel();
            clearPending();
            root.removeEventListener("pointerdown", onPointerDown);
            root.removeEventListener("click", onClick, true);
            view.removeEventListener("pointermove", onPointerMove, true);
            view.removeEventListener("pointerup", onPointerUp, true);
            view.removeEventListener("pointercancel", onPointerCancel, true);
        },
    };
}
