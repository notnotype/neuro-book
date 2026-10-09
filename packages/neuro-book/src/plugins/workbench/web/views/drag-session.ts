/**
 * 拖放会话（docs/specs/ui/workbench-shell.md 外壳三输出 19–23）：装在外壳根上，一场指针或键盘拖动从拿起到放下。
 * 拖动源与落点由组件写的 DOM 标记声明（`drop-dom.ts`），判定是纯函数 `resolveDrop`，提交经调用方给的 `commit`
 * （布局 store 的 `applyView`）。本模块只管手势、帧与生命周期。
 *
 * - 指针的激活门槛：鼠标与笔移动 6px；触摸按住 200ms 且不超过 6px（先动了就让给滚动）。没过门槛的按下照常是点击。
 * - 键盘：焦点在拖动源本身（或源里标了 `data-drag-handle` 的把手）上按空格拿起；Tab / Shift+Tab 在可见的落点区域间
 *   循环，方向键沿区域的轴逐个位置移动，Enter 放下，Escape 取消。每个位置是区域里的一个坐标，命中与判定与指针同一份。
 *   拖动中这些键归会话：在窗口捕获阶段拦下，标签带的方向键、收起开关与选择都收不到；指针拖动同样拦下它们（只有
 *   Escape 有动作），按着鼠标按方向键不会切换标签。放下或取消后焦点回到源。
 * - 冻结：拿起时冻结拖动源与布局代次（`layoutKeyOf`）、生成这场拖动建自建容器用的 id。之后布局代次变了，整场取消。
 * - 每次指针移动（一帧一次）或每次按键用当下坐标同步求一次命中与判定，发布预览；放下时用那一刻的坐标再判一次，与
 *   最后发布过的提交动作逐字段相同才提交（`isSameDropAction`），用户没看到过的动作不写。
 * - Escape、`pointercancel`、窗口失焦、页面隐藏、焦点移到外壳之外（命令面板、对话框打开）、会话销毁都取消且不提交。
 *   指针拖动结束时释放指针捕获，并吞掉同一手势末尾的那一次指针 click（松手在源自己身上时，标签会被选中、收起开关会
 *   被切换）；键盘触发的 click（`detail` 为 0）不吞。
 *
 * 由旧应用 `useWorkbenchDrag.ts` 与 `useWorkbenchDrop.ts`（已人工验证）改写；手势不再经拖动库（取舍见 t67 计划）。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {GridDropPoint} from "@notnotype/nb-ui/layout";

import type {ViewIntent} from "./intents";
import {isSameDropAction, layoutKeyOf, resolveDrop} from "./drop";
import type {DropDecision, DropRects, DropSource} from "./drop";
import {containerHostIn, dragSourceAt, dropHitAt, entryIn, keyboardRegions, keyboardStops, readContentRects, readDropRect, readSwitcherRects, sectionIn} from "./drop-dom";
import {customContainerId} from "./placement";
import type {ViewCatalog} from "./placement";
import type {Presentation} from "./presentation";

const DRAG_DISTANCE_PX = 6;
const TOUCH_DELAY_MS = 200;
const TOUCH_TOLERANCE_PX = 6;

export interface DragSessionOptions {
    /** 外壳根：拖动源与落点只认这里面的。 */
    readonly root: HTMLElement;
    presentation(): Presentation;
    catalog(): ViewCatalog;
    /** 布局可写时为真；否则不起拖。 */
    enabled(): boolean;
    /** 提交一次已显示过的动作。 */
    commit(intent: ViewIntent): void;
}

/** 进行中的拖动：拖影与落点反馈只读它。 */
export interface DragState {
    readonly source: DropSource;
    /** 拖影所在的视口坐标：指针拖动是指针，键盘拖动是当前位置。 */
    readonly point: GridDropPoint;
    /** 这一次的判定；没有命中任何落点为 null。 */
    readonly decision: DropDecision | null;
    readonly keyboard: boolean;
}

export interface DragSession {
    readonly state: Readonly<ShallowRef<DragState | null>>;
    dispose(): void;
}

interface Pending {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly start: GridDropPoint;
    readonly element: HTMLElement;
    readonly source: DropSource;
    timer: ReturnType<typeof setTimeout> | null;
}

/** 键盘拖动的位置：第几个区域的第几个位置。区域列表在拿起时取一次，布局代次不变它就不变。 */
interface KeyboardCursor {
    readonly regions: ReadonlyArray<HTMLElement>;
    region: number;
    stop: number;
}

interface Active {
    /** 指针拖动的指针；键盘拖动为 null。 */
    readonly pointerId: number | null;
    readonly keyboard: KeyboardCursor | null;
    readonly source: DropSource;
    /** 拿起时的源元素：结束后焦点回到它（或重渲染后同一个源的新元素）。 */
    readonly origin: HTMLElement;
    readonly newContainerId: string;
    point: GridDropPoint;
    /** 最后一次发布过的提交动作；放下只认它。 */
    shown: DropDecision | null;
}

/** 拖动源 → 冻结的 `DropSource`；不可移动的视图、过期的标记不起拖（不出现“拿起了却落不下去”）。 */
function freezeSource(presentation: Presentation, catalog: ViewCatalog, viewId: string | null, containerId: string | null): DropSource | null {
    const layoutKey = layoutKeyOf(presentation);
    if (viewId !== null) {
        if (catalog.get(viewId)?.movable === false) return null;
        for (const container of presentation.containers.values()) {
            if (container.views.some((view) => view.id === viewId)) return {kind: "view", viewId, containerId: container.id, part: container.part, layoutKey};
        }
        return null;
    }
    const container = containerId === null ? undefined : presentation.containers.get(containerId);
    if (container === undefined) return null;
    return {kind: "container", containerId: container.id, part: container.part, viewIds: [...container.members], layoutKey};
}

const distance = (a: GridDropPoint, b: GridDropPoint): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 方向键在轴上的步进：沿轴的前进与后退，其它方向键不动但同样归会话。 */
function stepOf(key: string, axis: "horizontal" | "vertical" | null): number {
    if (axis === "horizontal") return key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
    if (axis === "vertical") return key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
    return 0;
}

const SESSION_KEYS = new Set([" ", "Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

export function createDragSession(options: DragSessionOptions): DragSession {
    const {root} = options;
    const document = root.ownerDocument;
    const view = document.defaultView!;
    const state = shallowRef<DragState | null>(null);
    let pending: Pending | null = null;
    let active: Active | null = null;
    let frame = 0;
    /** 指针拖动刚结束：同一手势末尾的指针 click 要吞掉。被吞掉或下一次按下时清。 */
    let swallowClick = false;
    let detachSession: (() => void) | null = null;

    function partOf(containerId: string) {
        return options.presentation().containers.get(containerId)?.part ?? null;
    }

    /** 求一次判定，不发布：放下时要在同一份状态上再判一次，那次不能改掉“最后显示过的动作”。 */
    function evaluate(current: Active): DropDecision | null | "cancelled" {
        const presentation = options.presentation();
        if (layoutKeyOf(presentation) !== current.source.layoutKey) return "cancelled";
        const hit = dropHitAt(root, current.point, partOf);
        if (hit === null) return null;
        const sourceHost = containerHostIn(root, current.source.containerId);
        const rects: DropRects = {
            sourceContent: sourceHost === null ? null : readContentRects(sourceHost),
            ...(hit.target.kind === "switcher" ? {switcher: readSwitcherRects(hit.element, hit.target.part)}
                : hit.target.kind === "empty" ? {empty: readDropRect(hit.element)}
                    : {content: readContentRects(hit.element)}),
        };
        return resolveDrop({
            source: current.source,
            target: hit.target,
            point: current.point,
            rects,
            presentation,
            catalog: options.catalog(),
            layoutKey: current.source.layoutKey,
            newContainerId: current.newContainerId,
        });
    }

    function publish(): void {
        frame = 0;
        const current = active;
        if (current === null) return;
        const decision = evaluate(current);
        if (decision === "cancelled") {
            end();
            return;
        }
        current.shown = decision?.kind === "commit" ? decision : null;
        state.value = {source: current.source, point: current.point, decision, keyboard: current.keyboard !== null};
    }

    function schedule(): void {
        if (active !== null && frame === 0) frame = requestAnimationFrame(publish);
    }

    function clearPending(): void {
        if (pending?.timer !== null && pending?.timer !== undefined) clearTimeout(pending.timer);
        pending = null;
    }

    /**
     * 键盘拖动结束后把焦点还给源：源元素还在就是它；提交后它可能随重渲染换成了新元素（标签迁到别的标签带、视图进了
     * 别的容器），就按同一个源的标记找新元素（视图标题找里面的把手）。
     */
    function returnFocus(current: Active): void {
        if (current.origin.isConnected) {
            current.origin.focus({preventScroll: true});
            return;
        }
        const selector = current.source.kind === "view" ? `[data-drag-view="${CSS.escape(current.source.viewId)}"]` : `[data-drag-container="${CSS.escape(current.source.containerId)}"]`;
        const next = root.querySelector<HTMLElement>(selector);
        (next?.querySelector<HTMLElement>("[data-drag-handle]") ?? next)?.focus({preventScroll: true});
    }

    /** 收场：清帧、拆这场的监听、清状态；键盘拖动按 `focus` 立即把焦点还给源。幂等。 */
    function end(focus = true): void {
        clearPending();
        if (frame !== 0) cancelAnimationFrame(frame);
        frame = 0;
        detachSession?.();
        detachSession = null;
        const current = active;
        active = null;
        state.value = null;
        delete document.documentElement.dataset.workbenchDragging;
        if (current === null) return;
        if (current.pointerId !== null) {
            // Escape 取消时指针可能还按着：捕获不释放，之后的松手、移动仍归源。
            if (current.origin.isConnected && current.origin.hasPointerCapture(current.pointerId)) current.origin.releasePointerCapture(current.pointerId);
            swallowClick = true;
        } else if (focus) {
            returnFocus(current);
        }
    }

    /**
     * 放下：用此刻的坐标再判一次，与最后显示过的提交动作相同才提交。键盘拖动的焦点在提交之后的下一帧还：提交引起的
     * 重渲染在那之前完成，旧的源元素这时已经换掉，按标记找到的才是留下来的那个。
     */
    function drop(): void {
        const current = active;
        if (current === null) return;
        const final = evaluate(current);
        const shown = current.shown;
        end(false);
        if (final !== null && final !== "cancelled" && final.kind === "commit" && isSameDropAction(shown, final)) options.commit(final.intent);
        if (current.keyboard !== null) requestAnimationFrame(() => returnFocus(current));
    }

    /** 键盘拖动移到第 `region` 个区域的第 `stop` 个位置（夹在范围内），立即发布。 */
    function moveKeyboard(current: Active, cursor: KeyboardCursor, region: number, stop: number): void {
        const element = cursor.regions[region];
        if (element === undefined) return;
        const stops = keyboardStops(element).points;
        if (stops.length === 0) return;
        cursor.region = region;
        cursor.stop = Math.max(0, Math.min(stop, stops.length - 1));
        current.point = stops[cursor.stop]!;
        publish();
    }

    function onSessionKey(event: KeyboardEvent): void {
        const current = active;
        if (current === null || !SESSION_KEYS.has(event.key)) return;
        const cursor = current.keyboard;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
            end();
            return;
        }
        if (cursor === null || (event.repeat && event.key === " ")) return;
        if (event.key === "Enter") {
            drop();
        } else if (event.key === "Tab") {
            const count = cursor.regions.length;
            moveKeyboard(current, cursor, (cursor.region + (event.shiftKey ? count - 1 : 1)) % count, 0);
        } else {
            const element = cursor.regions[cursor.region];
            const step = element === undefined ? 0 : stepOf(event.key, keyboardStops(element).axis);
            if (step !== 0) moveKeyboard(current, cursor, cursor.region, cursor.stop + step);
        }
    }

    /** 开始一场拖动：装上这场的监听并发布第一次判定。 */
    function begin(next: Active): void {
        active = next;
        // 拖动中的光标与禁选在全局样式里按这个标记生效；已经选中的文字清掉，免得拖动看起来在扩选。
        document.documentElement.dataset.workbenchDragging = "";
        document.getSelection()?.removeAllRanges();
        const cancel = (): void => end();
        const onHidden = (): void => {
            if (document.visibilityState === "hidden") end();
        };
        const onKeyUp = (event: KeyboardEvent): void => {
            // 拿起用的那一下空格的 keyup 也拦下：按钮在空格抬起时激活，标签会被选中。
            if (active !== null && active.keyboard !== null && event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        const onPointerDown = (): void => {
            if (active !== null && active.keyboard !== null) end();
        };
        // 焦点进了外壳之外（命令面板、对话框）：用户已经转去操作那里，按键不能再归拖动；焦点留在那边，不还给源。
        const onFocusIn = (event: FocusEvent): void => {
            if (event.target instanceof Node && !root.contains(event.target)) end(false);
        };
        view.addEventListener("keydown", onSessionKey, true);
        view.addEventListener("keyup", onKeyUp, true);
        view.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("focusin", onFocusIn, true);
        // 不加捕获：子元素失焦也会冒到这里，只要窗口自己失焦那一种。
        view.addEventListener("blur", cancel);
        document.addEventListener("visibilitychange", onHidden);
        view.addEventListener("scroll", schedule, {capture: true, passive: true});
        view.addEventListener("resize", schedule);
        detachSession = () => {
            view.removeEventListener("keydown", onSessionKey, true);
            view.removeEventListener("keyup", onKeyUp, true);
            view.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("focusin", onFocusIn, true);
            view.removeEventListener("blur", cancel);
            document.removeEventListener("visibilitychange", onHidden);
            view.removeEventListener("scroll", schedule, {capture: true});
            view.removeEventListener("resize", schedule);
        };
        if (next.keyboard === null) {
            publish();
            return;
        }
        // 从源自己的原位开始，直接 Enter 是无操作：容器源是它在条目带上的条目的前缘，视图源是它自己分节里的位置。
        // 都找不到（源条目不可见）时停在源的中心，不落到区域的第一个位置（那是一次真实的移动）。
        const cursor = next.keyboard;
        const stops = keyboardStops(cursor.regions[cursor.region]!).points;
        const home = cursor.regions[cursor.region]!;
        const own = (next.source.kind === "view" ? sectionIn(home, next.source.viewId) : entryIn(home, next.source.containerId)) ?? next.origin;
        const box = own.getBoundingClientRect();
        const at = stops.findIndex((point) => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom);
        if (at !== -1) {
            moveKeyboard(next, cursor, cursor.region, at);
            return;
        }
        cursor.stop = -1;
        next.point = {x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2};
        publish();
    }

    function activatePointer(): void {
        const from = pending;
        if (from === null) return;
        clearPending();
        // 捕获到源上：指针移出窗口后仍收得到移动与松手。门槛期间松手或取消都会清掉 pending，到这里指针仍按着；
        // 源在门槛期间被卸下时不捕获，松手与取消照样由窗口监听收到。
        if (from.element.isConnected) from.element.setPointerCapture(from.pointerId);
        begin({pointerId: from.pointerId, keyboard: null, source: from.source, origin: from.element, newContainerId: customContainerId(crypto.randomUUID()), point: from.start, shown: null});
    }

    function onPointerDown(event: PointerEvent): void {
        swallowClick = false;
        if (pending !== null || active !== null || event.button !== 0 || !event.isPrimary || !options.enabled()) return;
        const found = dragSourceAt(root, event.target);
        if (found === null) return;
        const source = freezeSource(options.presentation(), options.catalog(), found.viewId, found.containerId);
        if (source === null) return;
        pending = {pointerId: event.pointerId, pointerType: event.pointerType, start: {x: event.clientX, y: event.clientY}, element: found.element, source, timer: null};
        if (event.pointerType === "touch") pending.timer = setTimeout(activatePointer, TOUCH_DELAY_MS);
    }

    function onPointerMove(event: PointerEvent): void {
        const point = {x: event.clientX, y: event.clientY};
        if (pending !== null && event.pointerId === pending.pointerId) {
            const moved = distance(point, pending.start);
            if (pending.pointerType === "touch") {
                if (moved > TOUCH_TOLERANCE_PX) clearPending();
            } else if (moved >= DRAG_DISTANCE_PX) {
                activatePointer();
            }
        }
        if (active !== null && event.pointerId === active.pointerId) {
            active.point = point;
            schedule();
        }
    }

    function onPointerUp(event: PointerEvent): void {
        if (pending !== null && event.pointerId === pending.pointerId) clearPending();
        if (active === null || event.pointerId !== active.pointerId) return;
        if (frame !== 0) cancelAnimationFrame(frame);
        frame = 0;
        active.point = {x: event.clientX, y: event.clientY};
        drop();
    }

    function onPointerCancel(event: PointerEvent): void {
        if (pending !== null && event.pointerId === pending.pointerId) clearPending();
        if (active !== null && event.pointerId === active.pointerId) end();
    }

    function onClick(event: MouseEvent): void {
        if (!swallowClick || event.detail === 0) return;
        swallowClick = false;
        event.preventDefault();
        event.stopPropagation();
    }

    /** 空格拿起：焦点要在拖动源本身或它的把手上；源里别的控件（收起开关）保留自己的空格。 */
    function onKeyDown(event: KeyboardEvent): void {
        if (event.key !== " " || event.repeat || pending !== null || active !== null || !options.enabled()) return;
        const found = dragSourceAt(root, event.target);
        if (found === null || !(event.target === found.element || (event.target instanceof HTMLElement && event.target.hasAttribute("data-drag-handle")))) return;
        const source = freezeSource(options.presentation(), options.catalog(), found.viewId, found.containerId);
        if (source === null) return;
        const regions = keyboardRegions(root, partOf);
        // 起点区域：容器源是它在 Switcher 上的条目所在的条目带，视图源是它所在的内容区；找不到就从第一个区域开始。
        const home = source.kind === "container"
            ? root.querySelector(`[data-switcher-entry="${CSS.escape(source.containerId)}"]`)?.closest("[data-switcher-band]")
            : containerHostIn(root, source.containerId);
        if (regions.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        const region = Math.max(0, regions.findIndex((element) => element === home));
        begin({pointerId: null, keyboard: {regions, region, stop: 0}, source, origin: event.target as HTMLElement, newContainerId: customContainerId(crypto.randomUUID()), point: {x: 0, y: 0}, shown: null});
    }

    root.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("click", onClick, true);
    root.addEventListener("keydown", onKeyDown, true);
    view.addEventListener("pointermove", onPointerMove, true);
    view.addEventListener("pointerup", onPointerUp, true);
    view.addEventListener("pointercancel", onPointerCancel, true);

    return {
        state,
        dispose() {
            end();
            root.removeEventListener("pointerdown", onPointerDown, true);
            root.removeEventListener("click", onClick, true);
            root.removeEventListener("keydown", onKeyDown, true);
            view.removeEventListener("pointermove", onPointerMove, true);
            view.removeEventListener("pointerup", onPointerUp, true);
            view.removeEventListener("pointercancel", onPointerCancel, true);
        },
    };
}
