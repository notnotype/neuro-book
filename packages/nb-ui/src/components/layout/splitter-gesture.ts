/**
 * Splitter 用户调整手势的边界跟踪。
 *
 * Reka 只发布布局事实（`layout`、手柄 `dragging`），没有「开始 / 更新 / 结束」边界，
 * 也不区分用户主动调整与兄弟空间补偿。本模块把这些差异算出来：
 *
 * - baseline 在用户开始调整时捕获，一次鼠标/指针操作或一次键盘连发只产生一次结束；
 * - `active` 是 sash 两侧被直接调整的面板，`compensated` 是尺寸被动变化、不在 active 中的兄弟面板
 *   （Reka 的相邻面板触界时会把空间推给更远的面板，那部分不是用户偏好）；
 * - 只有尺寸真的变了才产生提交，空操作按 `no-change` 取消；`gesture-start` 与 `gesture-end|cancel` 一一对应。
 *
 * 模块不重算拖动、不改写布局，也不引用 DOM 或 Vue：事实来自 Reka，交给宿主的只有身份与意图。
 */

/** 手势来源：指针拖动或键盘调整。 */
export type SplitterGestureSource = "pointer" | "keyboard";

/**
 * 手势未产生保存意图的原因。
 * `no-change` 是正常结束但没有尺寸变化，其余是手势被中途放弃。
 */
export type SplitterGestureCancelReason = "no-change" | "escape" | "pointercancel" | "blur" | "unmount" | "context-changed";

/** 一次用户调整手势的可观察状态。 */
export interface SplitterGestureState {
    source: SplitterGestureSource;
    /** 主动操作的 sash 稳定 id，形如 `outline~editor`；面板 id 由宿主声明或按序号派生 */
    sash: string;
    /** sash 两侧相对 baseline 实际改变尺寸的面板；触界未变化的候选不会冒充用户意图 */
    active: string[];
    /** 尺寸被动变化、且不在 sash 两侧的兄弟面板（空间补偿） */
    compensated: string[];
    /** 当前尺寸百分比，顺序与 `layout` 事件一致 */
    sizes: number[];
}

/** 手势被放弃时的信息，不携带保存意图。 */
export interface SplitterGestureCancellation {
    source: SplitterGestureSource;
    sash: string;
    reason: SplitterGestureCancelReason;
}

export interface SplitterGestureHandlers {
    onStart: (state: SplitterGestureState) => void;
    onUpdate: (state: SplitterGestureState) => void;
    onEnd: (state: SplitterGestureState) => void;
    onCancel: (info: SplitterGestureCancellation) => void;
}

export interface SplitterGestureTracker {
    /** 当前进行中的手势来源；无手势时为 null */
    readonly activeSource: SplitterGestureSource | null;
    /** 声明面板身份；身份变化会取消进行中的手势 */
    setPanelIds: (ids: readonly string[]) => void;
    /** 接收最新布局；进行中的手势由此得到更新边界 */
    setSizes: (sizes: readonly number[]) => void;
    /** 开始手势；`sashIndex` 是该 sash 左侧面板在面板顺序中的下标 */
    begin: (source: SplitterGestureSource, sashIndex: number) => void;
    /** 正常结束：有尺寸变化则提交一次，否则按 `no-change` 取消 */
    end: () => void;
    /** 放弃手势：不发提交 */
    cancel: (reason: SplitterGestureCancelReason) => void;
}

/** Reka 以 `PRECISION = 10` 的小数位发布 layout，比较沿用同一量级，避免浮点噪声被当成用户改变。 */
const SIZE_EPSILON = 1e-10;

interface ActiveGesture {
    source: SplitterGestureSource;
    sashIndex: number;
    baseline: number[];
}

export function createSplitterGestureTracker(handlers: SplitterGestureHandlers): SplitterGestureTracker {
    let panelIds: string[] = [];
    let sizes: number[] = [];
    let gesture: ActiveGesture | null = null;

    function panelIdAt(index: number): string {
        return panelIds[index] ?? `panel-${index}`;
    }

    function sashId(sashIndex: number): string {
        return `${panelIdAt(sashIndex)}~${panelIdAt(sashIndex + 1)}`;
    }

    function describe(current: ActiveGesture, values: readonly number[]): SplitterGestureState {
        const active: string[] = [];
        const compensated: string[] = [];
        const comparable = current.baseline.length === values.length;
        for (let index = 0; comparable && index < values.length; index += 1) {
            if (Math.abs(values[index]! - current.baseline[index]!) < SIZE_EPSILON) continue;
            if (index === current.sashIndex || index === current.sashIndex + 1) active.push(panelIdAt(index));
            else compensated.push(panelIdAt(index));
        }
        return {
            source: current.source,
            sash: sashId(current.sashIndex),
            active,
            compensated,
            sizes: [...values],
        };
    }

    function cancel(reason: SplitterGestureCancelReason): void {
        const current = gesture;
        if (!current) return;
        gesture = null;
        handlers.onCancel({source: current.source, sash: sashId(current.sashIndex), reason});
    }

    return {
        get activeSource() {
            return gesture?.source ?? null;
        },

        setPanelIds(ids) {
            const next = [...ids];
            if (next.length === panelIds.length && next.every((id, index) => id === panelIds[index])) return;
            // sash 与面板身份都按顺序派生，身份一变，进行中的手势就没有可提交的对象
            cancel("context-changed");
            panelIds = next;
        },

        setSizes(next) {
            sizes = [...next];
            if (!gesture) return;
            handlers.onUpdate(describe(gesture, sizes));
        },

        begin(source, sashIndex) {
            if (sashIndex < 0 || sashIndex + 1 >= panelIds.length) return;
            // 上一次手势没有正常收口（例如窗口失焦丢了 pointerup）时先取消，避免两次手势叠加成一次提交
            cancel("context-changed");
            gesture = {source, sashIndex, baseline: [...sizes]};
            handlers.onStart(describe(gesture, gesture.baseline));
        },

        end() {
            const current = gesture;
            if (!current) return;
            gesture = null;
            const unchanged = current.baseline.length === sizes.length
                && current.baseline.every((size, index) => Math.abs(size - sizes[index]!) < SIZE_EPSILON);
            if (unchanged) {
                // 用户碰了 sash 但布局没变：没有可保存的意图，用取消收口，保证 start 一定有配对的结束信号
                handlers.onCancel({source: current.source, sash: sashId(current.sashIndex), reason: "no-change"});
                return;
            }
            handlers.onEnd(describe(current, sizes));
        },

        cancel,
    };
}
