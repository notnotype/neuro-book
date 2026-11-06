/**
 * 独立 `Splitter` 对外的手势词汇表。
 *
 * 数值一律是**主轴 CSS px**：`sizesPx` 与 `panels` 同序、合计等于面板空间（不含 sash）。
 * 百分比往返与面板 id → 百分比换算在本次改造中全部退役——几何只有一份 px 口径。
 */
export type SplitterGestureSource = "pointer" | "keyboard";
export type SplitterGestureCancelReason = "no-change" | "escape" | "pointercancel" | "blur" | "unmount" | "context-changed";

/** 一次用户调整手势的可观察状态。 */
export interface SplitterGestureState {
    source: SplitterGestureSource;
    /** 主动操作的 sash 稳定 id，形如 `outline~editor`；面板 id 由宿主声明或按序号派生。 */
    sash: string;
    /** sash 两侧相对基线真正改变尺寸的面板；触界未变化的候选不会冒充用户意图。 */
    active: string[];
    /** 尺寸被动变化、且不在 sash 两侧的兄弟面板（空间补偿）。 */
    compensated: string[];
    /** 当前全部面板的主轴 px，顺序与 `panels` 一致。 */
    sizesPx: number[];
    /** 本场手势造成的收起状态（只含与记录不同的项）。 */
    collapsed: Record<string, boolean>;
}

export interface SplitterGestureCancellation {
    source: SplitterGestureSource;
    sash: string;
    reason: SplitterGestureCancelReason;
}
