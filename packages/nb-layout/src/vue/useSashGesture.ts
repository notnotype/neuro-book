/**
 * 分隔线手势的输入绑定层：命中谁、谁被捕获、什么时候节流、什么时候取消，以及悬停的显现与光标。
 *
 * 它不决定「这次手势改什么」——那是会话（`SashGestureSessionCore`）的事：整棵 Grid 树与独立
 * `Splitter` 各自实现同一份会话合同，输入层只有这一份。这里也**不写存储**：提交交给宿主的
 * `onCommit` 同步接纳，拒绝时回滚预览并给出诊断。
 *
 * 嵌套 scope（叶槽里再放一个 Grid）由**由内向外**的同一份仲裁决定赢家：最内层没有命中或被禁用时
 * 外层才有机会。悬停高亮、光标与按下开拖都读这一步，三者不会各算一套。
 *
 * 显现分两段：命中即给光标，停留 `SASH_HOVER_DELAY_MS` 后才淡入线；按下/键盘立即全亮。
 * 按下期间只认本 scope 已经开始的 active：别的按下手势（拖 View、选文本）与原生 `dragstart`
 * 都不许抢光标或启动显现。
 */
import {onBeforeUnmount, ref, shallowRef, watch, type Ref} from "vue";
import {collectSashHits, type SashHitTarget, type SashPoint, type SashPointerKind} from "../sash-hit-area";
import {acquireSashCursor, sashCursorFor, SASH_HOVER_DELAY_MS, sashHitKey, type SashCursorOwner} from "./sash-feedback";
import {commitFailure} from "../grid-failure";
import {createIssueGate} from "../issue-gate";
import type {GridFailure, GridIssue, GridIssueCode} from "../grid-types";
import {sashKey, type GridSashRef, type SashGestureBinding, type SashGestureCancelReason, type SashGestureHost} from "../sash-gesture";

type SashRegistration = {
    readonly branchId: string;
    readonly sashIndex: number;
    readonly axis: "width" | "height";
    readonly element: HTMLElement;
};

export type SashGestureScope = {
    /** 注册/注销一条分隔线；DOM 元素身份变化（重挂）时以最后一次注册为准。 */
    registerSash(target: SashRegistration): void;
    unregisterSash(branchId: string, sashIndex: number, element?: HTMLElement): void;
    /** 当前悬停的分隔线键（`branchId:index`）：命中即真，与显现无关。 */
    readonly hovered: ReadonlySet<string>;
    /** 已满足停留时长、应当显示装饰线的键；`active` 与键盘焦点另由渲染层立即点亮。 */
    readonly revealed: ReadonlySet<string>;
    /** 当前正在手势中的分隔线键。 */
    readonly active: ReadonlySet<string>;
    readonly dragging: boolean;
    /** separator 的键盘输入；`key` 是 `branchId:index`。 */
    keydown(event: KeyboardEvent, key: string): void;
    keyup(event: KeyboardEvent): void;
    /** 焦点离开 separator：结束键盘手势。 */
    blur(): void;
    /** 外部事实（树 / 约束 / 容器 / 上下文）变化：进行中的手势不结算。 */
    invalidate(): void;
};

type SashGestureOptions<S, C> = {
    /** 键盘与指针共用同一个宿主适配器；返回 null 表示此刻不能开始手势。 */
    host: () => SashGestureHost<S, C> | null;
    /** scope 根：指针监听、捕获与命中协调都挂在这里。 */
    root: Ref<HTMLElement | null>;
    /** 禁用（宿主声明不可调整）时不开始新手势。 */
    disabled?: () => boolean;
    /**
     * 手势的诊断与被拒的提交（Spec `ui/nested-grid` 输出 139、140）：每批同步交出，被拒的提交是失败本身（带 `ok: false`）。
     * 松手、取消与卸载时它抛出，手势已经收尾；拖动途中某一帧里抛出，手势照常进行，这一批的键已经记下、这一场不再发。异常都照常冒出去。
     */
    onIssues?: (batch: readonly (GridIssue<GridIssueCode> | GridFailure)[]) => void;
};

/**
 * 同一文档里所有 scope 的登记表：命中判定与「谁来开手势」都按它由内向外仲裁。
 * 根元素换掉即注销，因此重挂不会留下重复监听或幽灵命中。
 */
type SashScopeEntry = {
    readonly hitsAt: (point: SashPoint, kind: SashPointerKind) => readonly SashHitTarget[];
    /** 禁用或已销毁的 scope 不参与仲裁：它命中也不点灯、不开手势。 */
    readonly blocked: () => boolean;
};

const scopeEntries = new WeakMap<HTMLElement, SashScopeEntry>();

/**
 * 由内向外找**第一个有效命中**的 scope：最内层没有命中或被禁用时外层才有机会。
 * 悬停、显现与按下共用这一步——「谁亮」和「谁能开拖」因此不会是两套判定。
 */
function winningScope(event: PointerEvent, kind: SashPointerKind): {entry: SashScopeEntry; hits: readonly SashHitTarget[]} | null {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const target of path) {
        if (!(target instanceof HTMLElement)) {
            continue;
        }
        const entry = scopeEntries.get(target);
        if (entry === undefined || entry.blocked()) {
            continue;
        }
        const hits = entry.hitsAt({x: event.clientX, y: event.clientY}, kind);
        if (hits.length > 0) {
            return {entry, hits};
        }
    }
    return null;
}

/**
 * 根在屏幕上的盒比布局盒，每轴一个；量不到（没有布局、尺寸为零）时按 1。
 *
 * 只换算缩放：祖先带旋转或斜切时 client rect 是外接框，比例与方向都不对，这种宿主不支持。`offsetWidth` 取整到整数 px，
 * 没缩放的根也会量出约 `0.5 / 宽` 的偏差，所以两者差不到 1px 时按没缩放算，普通页面的位移逐像素不变。
 */
function scaleOf(root: HTMLElement): {x: number; y: number} {
    const rect = root.getBoundingClientRect();
    const ratio = (shown: number, laid: number): number => (Number.isFinite(shown) && shown > 0 && laid > 0 && Math.abs(shown - laid) >= 1 ? shown / laid : 1);
    return {x: ratio(rect.width, root.offsetWidth), y: ratio(rect.height, root.offsetHeight)};
}

/** 集合比较：两个 key 集合内容相同即视为没变，避免下游重复重建。 */
function sameKeys(left: ReadonlySet<string>, right: readonly string[]): boolean {
    return left.size === right.length && right.every((key) => left.has(key));
}

const ADJUST_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter"]);

export function useSashGesture<S, C>(options: SashGestureOptions<S, C>): SashGestureScope {
    const registrations = new Map<string, SashRegistration>();
    const hovered = shallowRef<ReadonlySet<string>>(new Set());
    const revealed = shallowRef<ReadonlySet<string>>(new Set());
    const active = shallowRef<ReadonlySet<string>>(new Set());
    const dragging = ref(false);

    let binding: SashGestureBinding<S, C> | null = null;
    let pointerId: number | null = null;
    let startPoint = {x: 0, y: 0};
    /**
     * 按下时冻结的根的缩放比：屏幕上的盒（client rect）比布局盒。祖先带 `transform: scale()` 时指针位移是屏幕 px，按它换回布局 px
     * （docs/specs/ui/nested-grid.md“副作用与数据”）；不乘设备像素比，client 坐标本来就是 CSS px。
     */
    let pointerScale = {x: 1, y: 1};
    let frame = 0;
    let pendingDelta = {x: 0, y: 0};
    /** 键盘会话模式：Enter 与方向键互不混用（见 `keyboardSession`）。 */
    let keyboardMode: "none" | "enter" | "adjust" = "none";
    let disposed = false;
    /**
     * 挂上时的根元素与它所在的窗口、文档：摘监听、清计时器都用这一份，不读 `options.root.value`（换元素、置空之后它已经是新的或 null）。
     * 窗口取根元素的 `ownerDocument`（同 `drag-session.ts`），根在嵌入的文档里时监听挂在那个文档上。
     */
    let attached: {readonly root: HTMLElement; readonly view: Window; readonly document: Document} | null = null;
    const view = (): Window => attached?.view ?? window;
    let keyboardDelta = {x: 0, y: 0};
    /** 显现计时：同一批连续命中不重置，离开命中集合才取消。 */
    let hoverTimer = 0;
    let cursor: SashCursorOwner | null = null;
    /** 最近一次指针位置与类型：手势结束后按它重新判定悬停，而不是沿用拖动期间的状态。 */
    let lastPoint: SashPoint = {x: 0, y: 0};
    let lastKind: SashPointerKind = "fine";
    const entry: SashScopeEntry = {
        hitsAt: (point, kind) => collectSashHits(point, hitTargets(), kind),
        blocked: () => disposed || options.disabled?.() === true,
    };

    /** 已注册的分隔线在 DOM 上的可命中目标。 */
    function hitTargets(): SashHitTarget[] {
        const targets: SashHitTarget[] = [];
        let order = 0;
        for (const registration of registrations.values()) {
            const element = registration.element;
            if (!element.isConnected) {
                continue;
            }
            const rect = element.getBoundingClientRect();
            const disabled = element.getAttribute("aria-disabled") === "true" || element.hasAttribute("data-sash-inert");
            targets.push({
                branchId: registration.branchId,
                sashIndex: registration.sashIndex,
                axis: registration.axis,
                rect: {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom},
                // 同一 scope 内层实例先注册；DOM 顺序即稳定顺序。
                depth: Number(element.dataset.sashDepth ?? 0),
                order: order++,
                enabled: !disabled && rect.width + rect.height > 0,
            });
        }
        return targets;
    }

    function pointerKindOf(event: PointerEvent): SashPointerKind {
        return event.pointerType === "touch" ? "coarse" : "fine";
    }

    /** 集合没变就不写：悬停每次移动都会重算一遍，写同样的内容也会让读它的组件重渲染。 */
    function setKeys(target: Ref<ReadonlySet<string>>, keys: readonly string[]): void {
        if (sameKeys(target.value, keys)) {
            return;
        }
        target.value = new Set(keys);
    }

    const setHovered = (keys: readonly string[]): void => setKeys(hovered, keys);
    const setRevealed = (keys: readonly string[]): void => setKeys(revealed, keys);

    /** 命中即给光标；光标不等待显现计时。 */
    function updateCursor(hits: readonly SashHitTarget[]): void {
        const root = options.root.value;
        const next = sashCursorFor(hits);
        if (root === null || next === null) {
            releaseCursor();
            return;
        }
        cursor ??= acquireSashCursor(root.ownerDocument);
        cursor.set(next);
    }

    function releaseCursor(): void {
        cursor?.release();
        cursor = null;
    }

    /** 命中停留到时长后显现；已经显现的集合里再加入新命中的线时不重新计时。 */
    function applyHover(hits: readonly SashHitTarget[]): void {
        const keys = hits.map(sashHitKey);
        setHovered(keys);
        updateCursor(hits);
        if (keys.some((key) => revealed.value.has(key))) {
            setRevealed(keys);
            return;
        }
        if (hoverTimer !== 0) {
            return;
        }
        hoverTimer = view().setTimeout(() => {
            hoverTimer = 0;
            setRevealed([...hovered.value]);
        }, SASH_HOVER_DELAY_MS);
    }

    /** 离开命中集合、被别的按下手势打断、禁用或卸载：取消计时、淡出并放掉光标。 */
    function resetHover(): void {
        if (hoverTimer !== 0) {
            view().clearTimeout(hoverTimer);
            hoverTimer = 0;
        }
        setHovered([]);
        setRevealed([]);
        releaseCursor();
    }

    /** 手势结束后按最后坐标重新判定：仍在线盒上就保持显现，离开就淡出。 */
    function refreshHoverAfterGesture(): void {
        if (disposed || options.disabled?.() === true) {
            resetHover();
            return;
        }
        const hits = collectSashHits(lastPoint, hitTargets(), lastKind);
        if (hits.length === 0) {
            resetHover();
            return;
        }
        applyHover(hits);
    }

    /** 一场手势里同一个键只发一次（Spec 输出 140）；新手势在 `begin` 成功之后换一个。 */
    let gate = createIssueGate();

    /** 手势里求解的诊断：会话每帧给的是全部（快照），这里只交这一场没发过的。 */
    function notifyGesture(batch: readonly GridIssue<GridIssueCode>[]): void {
        const fresh = gate.take(batch);
        if (fresh.length > 0) {
            options.onIssues?.(fresh);
        }
    }

    function begin(input: {source: "pointer" | "keyboard"; sashes: readonly GridSashRef[]}): boolean {
        if (disposed || binding !== null || options.disabled?.() === true) {
            return false;
        }
        const started = options.host()?.begin(input) ?? null;
        if (started === null) {
            return false;
        }
        binding = started;
        // 在开始成功之后换：键盘会话进行中按下指针被拒时，不清掉进行中那场已经发过的键。
        gate = createIssueGate();
        active.value = new Set(started.session.sashes.map((sash) => sashKey(sash.branchId, sash.index)));
        dragging.value = true;
        return true;
    }

    /**
     * 手势的状态收尾：会话、拖动标记、高亮、悬停与光标。`finish`、`cancel` 都先做完它才调宿主的回调，
     * 所以宿主的回调抛出时手势已经结束（Spec `ui/nested-grid` 输出 140）。
     */
    function settle(source: "pointer" | "keyboard", hover: "refresh" | "reset"): void {
        binding = null;
        dragging.value = false;
        pointerId = null;
        keyboardMode = "none";
        keyboardDelta = {x: 0, y: 0};
        active.value = new Set();
        if (hover === "reset") {
            resetHover();
        } else if (source === "pointer") {
            refreshHoverAfterGesture();
        }
    }

    /** 结束手势：有变化就提交，宿主拒绝时回滚并诊断。 */
    function finish(): void {
        const current = binding;
        if (current === null) {
            return;
        }
        const source = current.session.source;
        const commit = current.session.finish();
        if (commit === null) {
            // 没有真实变化：走同一取消口径（`no-change`），宿主据此知道「这次按下没有提交」。
            current.session.cancel("no-change");
            settle(source, "refresh");
            current.onPreview(null);
            current.onCancel?.({reason: "no-change", sashes: current.session.sashes});
            return;
        }
        settle(source, "refresh");
        let accepted: {readonly ok: true} | GridFailure;
        try {
            accepted = current.onCommit(commit);
        } catch (error) {
            accepted = commitFailure("handler-threw", `The commit handler threw: ${String(error)}`);
        }
        if (!accepted.ok) {
            current.onPreview(null);
            options.onIssues?.([accepted]);
        }
    }

    /**
     * 取消后悬停怎么收：只有指针手势因为指针自己的事（Esc、系统取消、没有变化）取消时，指针还在原处，按最后坐标重新悬停；
     * 其余都清空。失焦不按最后坐标重新悬停：那会把刚放掉的页面级光标又拿回来（Spec `ui/nested-grid` 输出 16）；卸载与上下文变化后坐标已不可信。
     */
    function hoverAfterCancel(source: "pointer" | "keyboard", reason: SashGestureCancelReason): "refresh" | "reset" {
        if (source !== "pointer" || disposed) return "reset";
        return reason === "unmount" || reason === "context-changed" || reason === "blur" ? "reset" : "refresh";
    }

    function cancel(reason: SashGestureCancelReason): void {
        const current = binding;
        if (current === null) {
            return;
        }
        const source = current.session.source;
        current.session.cancel(reason);
        settle(source, hoverAfterCancel(source, reason));
        current.onPreview(null);
        current.onCancel?.({reason, sashes: current.session.sashes});
    }

    function flush(): void {
        frame = 0;
        const current = binding;
        if (current === null) {
            return;
        }
        const preview = current.session.update(pendingDelta);
        current.onPreview(preview);
        notifyGesture(current.session.issues);
    }

    function onPointerDown(event: PointerEvent): void {
        if (disposed) {
            return;
        }
        lastPoint = {x: event.clientX, y: event.clientY};
        lastKind = pointerKindOf(event);
        // 任何别的按下（拖 View、选文本、右键）都不许沿用悬停高亮与光标。
        if (options.disabled?.() === true || event.button !== 0 || !event.isPrimary) {
            resetHover();
            return;
        }
        const winner = winningScope(event, lastKind);
        const root = options.root.value;
        if (root === null || winner === null || winner.entry !== entry) {
            resetHover();
            return;
        }
        if (!begin({source: "pointer", sashes: winner.hits.map((hit) => ({branchId: hit.branchId, index: hit.sashIndex, axis: hit.axis}))})) {
            resetHover();
            return;
        }
        // 本次由本 scope 拿下手势：内层以外的监听者（含 dnd-kit 拖动源）都收不到这次按下。
        event.stopPropagation();
        event.stopImmediatePropagation();
        event.preventDefault();
        if (root.isConnected) {
            root.setPointerCapture?.(event.pointerId);
        }
        pointerId = event.pointerId;
        startPoint = {x: event.clientX, y: event.clientY};
        pointerScale = scaleOf(root);
        pendingDelta = {x: 0, y: 0};
        /**
         * 拖动期间自己持有全亮与光标：不等停留计时，也不因指针离开线盒而消失。
         * `resetHover` 不在这里调用——它会把刚点亮的线一起清掉。
         */
        if (hoverTimer !== 0) {
            view().clearTimeout(hoverTimer);
            hoverTimer = 0;
        }
        const keys = winner.hits.map(sashHitKey);
        setHovered(keys);
        setRevealed(keys);
        updateCursor(winner.hits);
    }

    function onPointerMove(event: PointerEvent): void {
        if (disposed) {
            return;
        }
        lastPoint = {x: event.clientX, y: event.clientY};
        lastKind = pointerKindOf(event);
        if (binding !== null && pointerId === event.pointerId) {
            pendingDelta = {x: (event.clientX - startPoint.x) / pointerScale.x, y: (event.clientY - startPoint.y) / pointerScale.y};
            if (frame === 0) {
                frame = view().requestAnimationFrame(flush);
            }
            return;
        }
        if (binding !== null) {
            return;
        }
        // 非 active 的悬停只认「没有按键按下」的移动：别的拖动经过热区不得点灯或改光标。
        if (event.buttons !== 0) {
            resetHover();
            return;
        }
        const winner = winningScope(event, lastKind);
        if (winner === null || winner.entry !== entry) {
            resetHover();
            return;
        }
        applyHover(winner.hits);
    }

    function onPointerUp(event: PointerEvent): void {
        if (binding === null || pointerId !== event.pointerId) {
            return;
        }
        try {
            if (frame !== 0) {
                view().cancelAnimationFrame(frame);
                frame = 0;
                flush();
            }
        } finally {
            // 最后一帧里宿主的回调抛出时照样松手收尾，不留一场卡住的手势。
            options.root.value?.releasePointerCapture?.(event.pointerId);
            finish();
        }
    }

    function onPointerLeave(): void {
        if (binding === null) {
            resetHover();
        }
    }

    /** 原生拖动（编辑器标签、文件）开始：本次按下与悬停无关，立刻退出反馈状态。 */
    function onForeignDragStart(): void {
        if (binding === null) {
            resetHover();
        }
    }

    function onPointerCancel(event: PointerEvent): void {
        if (pointerId === event.pointerId) {
            cancel("pointercancel");
        }
    }

    /** 非正常释放（浏览器抢走捕获）：视为取消，不结算。 */
    function onLostCapture(event: PointerEvent): void {
        if (binding !== null && event.pointerId === pointerId && dragging.value) {
            cancel("pointercancel");
        }
    }

    /**
     * 窗口失焦：进行中的手势取消；只是悬停时也清掉光标与停留计时（Spec `ui/nested-grid` 输出 16）。不清的话切回来时
     * 整页还是分隔线光标，线也会在失焦期间到点显现。
     */
    function onWindowBlur(): void {
        if (binding !== null && binding.session.reason === null) {
            cancel("blur");
        } else if (binding === null) {
            resetHover();
        }
    }

    function onKeydownCapture(event: KeyboardEvent): void {
        if (event.key === "Escape" && binding !== null) {
            cancel("escape");
        }
    }

    function keydown(event: KeyboardEvent, key: string): void {
        if (disposed || !ADJUST_KEYS.has(event.key)) {
            return;
        }
        const registration = registrations.get(key);
        if (registration === undefined || options.disabled?.() === true) {
            return;
        }
        // 单条线不可交互（0px 接缝、收起为零的分支里长度为零的线）时不在 Tab 顺序里，但焦点可能早就在它上面：和指针命中读同一个标记。
        if (registration.element.getAttribute("aria-disabled") === "true") {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            if (keyboardMode === "enter") {
                // 自动重复的 Enter 不重复求解：一场 Enter 会话只翻一次收起状态。
                return;
            }
            const session = keyboardSession(registration, "enter");
            if (session === null) {
                return;
            }
            const preview = session.session.toggleCollapsed();
            if (preview !== null) {
                session.onPreview(preview);
            }
            // 不管有没有预览都交：Enter 恢复空间不够时没有预览，诊断照样要发。
            notifyGesture(session.session.issues);
            return;
        }
        // Home / End 与方向键一样属于调整键：都进入（或复用）同一场**方向**会话。
        const isJump = event.key === "Home" || event.key === "End";
        const axisStep = isJump ? null : keyboardStep(event, registration.axis);
        if (!isJump && axisStep === null) {
            return;
        }
        event.preventDefault();
        const current = keyboardSession(registration, "adjust");
        if (current === null) {
            return;
        }
        if (isJump) {
            const preview = current.session.jump(event.key === "Home" ? "start" : "end");
            if (preview !== null) {
                current.onPreview(preview);
            }
            notifyGesture(current.session.issues);
            return;
        }
        // 不是跳转键时，上面已经排除了 `axisStep === null`。
        const step = axisStep!;
        keyboardDelta = {
            x: registration.axis === "width" ? keyboardDelta.x + step : keyboardDelta.x,
            y: registration.axis === "height" ? keyboardDelta.y + step : keyboardDelta.y,
        };
        const preview = current.session.update(keyboardDelta);
        current.onPreview(preview);
        notifyGesture(current.session.issues);
    }

    /**
     * 键盘首帧：用当前焦点对应的分隔线开一场键盘会话，位移从 0 起算。
     *
     * 两种键盘键各自持有**独立**会话，且都不与指针会话共用：
     * - 已有一场指针拖动时键盘一律不介入（绝对位移求解不能被键盘喂进拖动中的几何）；
     * - Enter 会话期间忽略方向/Home/End，反之亦然；模式不符时返回 null 而不是复用别人的会话。
     */
    function keyboardSession(registration: SashRegistration, mode: "enter" | "adjust"): SashGestureBinding<S, C> | null {
        if (binding !== null) {
            return binding.session.source === "keyboard" && keyboardMode === mode ? binding : null;
        }
        const started = begin({source: "keyboard", sashes: [{branchId: registration.branchId, index: registration.sashIndex, axis: registration.axis}]});
        if (!started) {
            return null;
        }
        keyboardMode = mode;
        keyboardDelta = {x: 0, y: 0};
        return binding;
    }

    function keyup(event: KeyboardEvent): void {
        if (!ADJUST_KEYS.has(event.key) || binding === null || binding.session.source !== "keyboard") {
            return;
        }
        // Enter 抬起提交 Enter 会话；方向/Home/End 抬起提交方向会话。模式不符时不结算别人的会话。
        if (event.key === "Enter" ? keyboardMode !== "enter" : keyboardMode !== "adjust") {
            return;
        }
        finish();
    }

    function attach(): void {
        const root = options.root.value;
        if (root === null || disposed) {
            return;
        }
        const document = root.ownerDocument;
        const owner = document.defaultView ?? window;
        attached = {root, view: owner, document};
        /**
         * 按下必须走**捕获阶段**：命中带内的像素可能同时落在别的拖动源上（容器标签、View 标题……
         * dnd-kit 的 PointerSensor 是泡在源元素上监听的）。scope 根是这些源的祖先，捕获阶段先跑，
         * `stopPropagation()` 之后传感器根本收不到这次 pointerdown——命中集合与「谁能开拖」因此同源。
         */
        root.addEventListener("pointerdown", onPointerDown, {capture: true});
        root.addEventListener("pointermove", onPointerMove);
        root.addEventListener("pointerup", onPointerUp);
        root.addEventListener("pointercancel", onPointerCancel);
        root.addEventListener("lostpointercapture", onLostCapture);
        root.addEventListener("pointerleave", onPointerLeave);
        root.addEventListener("dragstart", onForeignDragStart, {capture: true});
        owner.addEventListener("blur", onWindowBlur);
        document.addEventListener("keydown", onKeydownCapture, true);
        scopeEntries.set(root, entry);
    }

    function detach(): void {
        releaseCursor();
        if (hoverTimer !== 0) {
            view().clearTimeout(hoverTimer);
            hoverTimer = 0;
        }
        if (frame !== 0) {
            view().cancelAnimationFrame(frame);
            frame = 0;
        }
        if (attached === null) {
            return;
        }
        const {root, view: owner, document} = attached;
        root.removeEventListener("pointerdown", onPointerDown, {capture: true});
        root.removeEventListener("pointermove", onPointerMove);
        root.removeEventListener("pointerup", onPointerUp);
        root.removeEventListener("pointercancel", onPointerCancel);
        root.removeEventListener("lostpointercapture", onLostCapture);
        root.removeEventListener("pointerleave", onPointerLeave);
        root.removeEventListener("dragstart", onForeignDragStart, {capture: true});
        scopeEntries.delete(root);
        owner.removeEventListener("blur", onWindowBlur);
        document.removeEventListener("keydown", onKeydownCapture, true);
        attached = null;
    }

    // 根元素由渲染决定：出现即挂监听，换元素先摘挂上时记下的旧元素（重挂不留下重复监听）。
    watch(options.root, (element) => {
        detach();
        if (element !== null && !disposed) {
            attach();
        }
    }, {immediate: true});

    /** 卸载：宿主的取消回调抛出时，监听照样摘掉、光标令牌照样释放（不然整页的分隔线光标失效到刷新）。 */
    function teardown(): void {
        try {
            if (binding !== null) {
                cancel("unmount");
            }
        } finally {
            disposed = true;
            resetHover();
            detach();
        }
    }

    // 先收尾手势再让组件通知宿主：Vue 按注册顺序调用 beforeUnmount，所以调用方要在自己的 `onBeforeUnmount`（例如 NestedGrid 发 `extent: null` 的那条）之前调用
    // `useSashGesture`。这样宿主的监听在通知里抛出时，手势也已经结束、窗口上的监听已经摘掉。
    onBeforeUnmount(teardown);

    return {
        registerSash(target) {
            registrations.set(sashKey(target.branchId, target.sashIndex), target);
        },
        unregisterSash(branchId, sashIndex, element) {
            const key = sashKey(branchId, sashIndex);
            const current = registrations.get(key);
            // 重挂期间旧元素先卸载：只有它仍是当前登记项时才删除，避免删掉新宿主的目标。
            if (current !== undefined && (element === undefined || current.element === element)) {
                registrations.delete(key);
            }
        },
        get hovered() {
            return hovered.value;
        },
        get revealed() {
            return revealed.value;
        },
        get active() {
            return active.value;
        },
        get dragging() {
            return dragging.value;
        },
        keydown,
        keyup,
        blur() {
            if (binding !== null && binding.session.source === "keyboard") {
                finish();
            }
        },
        invalidate() {
            if (binding !== null) {
                cancel("context-changed");
            }
            resetHover();
        },
    };
}

/** 键盘方向键的单步位移：主轴方向匹配的那一对才有效，Shift 走 1px。 */
function keyboardStep(event: KeyboardEvent, axis: "width" | "height"): number | null {
    const step = event.shiftKey ? 1 : 10;
    if (axis === "width") {
        if (event.key === "ArrowLeft") {
            return -step;
        }
        if (event.key === "ArrowRight") {
            return step;
        }
        return null;
    }
    if (event.key === "ArrowUp") {
        return -step;
    }
    if (event.key === "ArrowDown") {
        return step;
    }
    return null;
}
