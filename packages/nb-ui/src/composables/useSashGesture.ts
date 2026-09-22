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
import {collectSashHits, type SashHitTarget, type SashPoint, type SashPointerKind} from "../components/layout/sash-hit-area";
import {acquireSashCursor, sashCursorFor, SASH_HOVER_DELAY_MS, sashHitKey, type SashCursorOwner} from "../components/layout/sash-feedback";
import {sashKey, type GridSashRef, type SashGestureBinding, type SashGestureHost} from "../components/layout/sash-gesture";
import type {SplitterGestureCancelReason} from "../components/layout/splitter-gesture";

export type SashRegistration = {
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
    /** 手势诊断（恢复空间不足、提交被拒绝、宿主合同错误）。 */
    readonly issues: readonly string[];
    /** separator 的键盘输入；`key` 是 `branchId:index`。 */
    keydown(event: KeyboardEvent, key: string): void;
    keyup(event: KeyboardEvent): void;
    /** 焦点离开 separator：结束键盘手势。 */
    blur(): void;
    /** 外部事实（树 / 约束 / 容器 / 上下文）变化：进行中的手势不结算。 */
    invalidate(): void;
    dispose(): void;
};

export type SashGestureOptions<S, C> = {
    /** 键盘与指针共用同一个宿主适配器；返回 null 表示此刻不能开始手势。 */
    host: () => SashGestureHost<S, C> | null;
    /** scope 根：指针监听、捕获与命中协调都挂在这里。 */
    root: Ref<HTMLElement | null>;
    /** 禁用（宿主声明不可调整）时不开始新手势。 */
    disabled?: () => boolean;
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
    const issues = ref<readonly string[]>([]);
    const dragging = ref(false);

    let binding: SashGestureBinding<S, C> | null = null;
    let pointerId: number | null = null;
    let startPoint = {x: 0, y: 0};
    let frame = 0;
    let pendingDelta = {x: 0, y: 0};
    /** 键盘会话模式：Enter 与方向键互不混用（见 `keyboardSession`）。 */
    let keyboardMode: "none" | "enter" | "adjust" = "none";
    let disposed = false;
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

    function setHovered(keys: readonly string[]): void {
        if (sameKeys(hovered.value, keys)) {
            return;
        }
        hovered.value = new Set(keys);
    }

    function setRevealed(keys: readonly string[]): void {
        if (sameKeys(revealed.value, keys)) {
            return;
        }
        revealed.value = new Set(keys);
    }

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
        hoverTimer = window.setTimeout(() => {
            hoverTimer = 0;
            setRevealed([...hovered.value]);
        }, SASH_HOVER_DELAY_MS);
    }

    /** 离开命中集合、被别的按下手势打断、禁用或卸载：取消计时、淡出并放掉光标。 */
    function resetHover(): void {
        if (hoverTimer !== 0) {
            window.clearTimeout(hoverTimer);
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

    function pushIssues(messages: readonly string[]): void {
        if (messages.length === 0) {
            return;
        }
        issues.value = [...issues.value, ...messages].slice(-8);
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
        active.value = new Set(started.session.sashes.map((sash) => sashKey(sash)));
        dragging.value = true;
        return true;
    }

    /** 结束手势：有变化就提交，宿主拒绝时回滚并诊断。 */
    function finish(): void {
        const current = binding;
        if (current === null) {
            return;
        }
        const source = current.session.source;
        const commit = current.session.finish();
        binding = null;
        dragging.value = false;
        pointerId = null;
        keyboardMode = "none";
        keyboardDelta = {x: 0, y: 0};
        if (commit === null) {
            // 没有真实变化：走同一取消口径（`no-change`），宿主据此知道「这次按下没有提交」。
            current.session.cancel("no-change");
            current.onPreview(null);
            current.onCancel?.({reason: "no-change", sashes: current.session.sashes});
            active.value = new Set();
            if (source === "pointer") {
                refreshHoverAfterGesture();
            }
            return;
        }
        let accepted: {ok: true} | {ok: false; reason: string};
        try {
            accepted = current.onCommit(commit);
        } catch (error) {
            accepted = {ok: false, reason: `提交处理器抛出异常：${String(error)}`};
        }
        if (!accepted.ok) {
            current.onPreview(null);
            pushIssues([`本次调整没有落账：${accepted.reason}`]);
        }
        active.value = new Set();
        if (source === "pointer") {
            refreshHoverAfterGesture();
        }
    }

    function cancel(reason: SplitterGestureCancelReason): void {
        const current = binding;
        if (current === null) {
            return;
        }
        const source = current.session.source;
        binding = null;
        dragging.value = false;
        pointerId = null;
        keyboardMode = "none";
        keyboardDelta = {x: 0, y: 0};
        current.session.cancel(reason);
        current.onPreview(null);
        current.onCancel?.({reason, sashes: current.session.sashes});
        active.value = new Set();
        if (source !== "pointer" || reason === "unmount" || reason === "context-changed" || disposed) {
            resetHover();
            return;
        }
        refreshHoverAfterGesture();
    }

    function flush(): void {
        frame = 0;
        const current = binding;
        if (current === null) {
            return;
        }
        const preview = current.session.update(pendingDelta);
        current.onPreview(preview);
        pushIssues(current.session.issues);
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
        pendingDelta = {x: 0, y: 0};
        /**
         * 拖动期间自己持有全亮与光标：不等停留计时，也不因指针离开线盒而消失。
         * `resetHover` 不在这里调用——它会把刚点亮的线一起清掉。
         */
        if (hoverTimer !== 0) {
            window.clearTimeout(hoverTimer);
            hoverTimer = 0;
        }
        setHovered(winner.hits.map(sashHitKey));
        setRevealed(winner.hits.map(sashHitKey));
        updateCursor(winner.hits);
    }

    function onPointerMove(event: PointerEvent): void {
        if (disposed) {
            return;
        }
        lastPoint = {x: event.clientX, y: event.clientY};
        lastKind = pointerKindOf(event);
        if (binding !== null && pointerId === event.pointerId) {
            pendingDelta = {x: event.clientX - startPoint.x, y: event.clientY - startPoint.y};
            if (frame === 0) {
                frame = requestAnimationFrame(flush);
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
        if (frame !== 0) {
            cancelAnimationFrame(frame);
            frame = 0;
            flush();
        }
        options.root.value?.releasePointerCapture?.(event.pointerId);
        finish();
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

    function onWindowBlur(): void {
        if (binding !== null && binding.session.reason === null) {
            cancel("blur");
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
            return;
        }
        // Home / End 与方向键一样属于调整键：都进入（或复用）同一场**方向**会话。
        const isJump = event.key === "Home" || event.key === "End";
        if (!isJump && keyboardStep(event, registration.axis) === null) {
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
            return;
        }
        const axisStep = keyboardStep(event, registration.axis)!;
        keyboardDelta = {
            x: registration.axis === "width" ? keyboardDelta.x + axisStep : keyboardDelta.x,
            y: registration.axis === "height" ? keyboardDelta.y + axisStep : keyboardDelta.y,
        };
        const preview = current.session.update(keyboardDelta);
        current.onPreview(preview);
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
        window.addEventListener("blur", onWindowBlur);
        document.addEventListener("keydown", onKeydownCapture, true);
        scopeEntries.set(root, entry);
    }

    function detach(): void {
        releaseCursor();
        if (hoverTimer !== 0) {
            window.clearTimeout(hoverTimer);
            hoverTimer = 0;
        }
        const root = options.root.value;
        if (root !== null) {
            root.removeEventListener("pointerdown", onPointerDown, {capture: true});
            root.removeEventListener("pointermove", onPointerMove);
            root.removeEventListener("pointerup", onPointerUp);
            root.removeEventListener("pointercancel", onPointerCancel);
            root.removeEventListener("lostpointercapture", onLostCapture);
            root.removeEventListener("pointerleave", onPointerLeave);
            root.removeEventListener("dragstart", onForeignDragStart, {capture: true});
            scopeEntries.delete(root);
        }
        window.removeEventListener("blur", onWindowBlur);
        document.removeEventListener("keydown", onKeydownCapture, true);
        if (frame !== 0) {
            cancelAnimationFrame(frame);
            frame = 0;
        }
    }

    // 根元素由渲染决定：出现即挂监听，换元素先摘旧的（重挂不留下重复监听）。
    watch(options.root, (element) => {
        detach();
        if (element !== null && !disposed) {
            attach();
        }
    }, {immediate: true});

    onBeforeUnmount(() => {
        if (binding !== null) {
            cancel("unmount");
        }
        disposed = true;
        resetHover();
        detach();
    });

    return {
        registerSash(target) {
            registrations.set(`${target.branchId}:${target.sashIndex}`, target);
        },
        unregisterSash(branchId, sashIndex, element) {
            const key = `${branchId}:${sashIndex}`;
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
        get issues() {
            return issues.value;
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
        dispose() {
            if (binding !== null) {
                cancel("unmount");
            }
            disposed = true;
            resetHover();
            detach();
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
