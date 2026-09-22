/**
 * 拖动会话与输入绑定之间的公共合同（纯类型，无 DOM / Vue）。
 *
 * `useSashGesture` 只负责输入与生命周期：命中哪条分隔线、指针捕获、rAF 节流、Escape / 失焦 / 卸载取消。
 * 「这次手势到底在改什么」交给会话实现——`GridGestureSession`（整棵树）与独立 `Splitter` 的单分支会话
 * 都实现同一个 `SashGestureSessionCore`，因此输入层只有一份。
 */
import type {GridAxis, GridBranchResize, GridExtent} from "./grid-types";
import type {SplitterGestureCancelReason} from "./splitter-gesture";

/** 一条分隔线的身份：所属分支、边界序号与其被调整的主轴。 */
export type GridSashRef = {
    readonly branchId: string;
    readonly index: number;
    readonly axis: GridAxis;
};

/** 分离线会话的稳定键（高亮 / 拖动集合 / 测试都用它）。 */
export function sashKey(sash: GridSashRef): string {
    return `${sash.branchId}:${sash.index}`;
}

/** 一次会话要产出的提交载荷。 */
export type SashGestureCommit<C = GridBranchResize> = {
    readonly sessionId: string;
    readonly contextKey: string;
    readonly source: "pointer" | "keyboard";
    readonly revision: number;
    readonly extent: GridExtent;
    readonly changes: readonly C[];
};

/** 会话核心：两种宿主实现同一份，输入层不关心它是整棵树还是单个分支。 */
export type SashGestureSessionCore<S, C = GridBranchResize> = {
    readonly sessionId: string;
    readonly sashes: readonly GridSashRef[];
    /** 本场手势的输入来源：指针或键盘。 */
    readonly source: "pointer" | "keyboard";
    /** 取消原因；null 表示还在进行中。 */
    readonly reason: SplitterGestureCancelReason | null;
    /** 当前是否已有真实变化。 */
    readonly changed: boolean;
    /** 最近一次求解的诊断（恢复空间不足、容量压缩等）。 */
    readonly issues: readonly string[];
    /** 指针位移（px；正 = 分隔条向右/向下移动）。返回 null 表示本帧没有变化。 */
    update(delta: {x: number; y: number}): S | null;
    /** 键盘 Home / End：把分隔条移到可行两端。 */
    jump(edge: "start" | "end"): S | null;
    /** 键盘/按钮式折叠切换：走同一收起策略。返回 null 表示没有可折叠的相邻面板。 */
    toggleCollapsed(): S | null;
    /** 正常结束：无真实变化返回 null。 */
    finish(): SashGestureCommit<C> | null;
    cancel(reason: SplitterGestureCancelReason): void;
};

/** 宿主在一次手势中要提供的两件事：建立会话、接纳提交。 */
export type SashGestureBinding<S, C = GridBranchResize> = {
    session: SashGestureSessionCore<S, C>;
    /** 会话产生预览（null = 回到宿主发布的事实几何）。 */
    onPreview(preview: S | null): void;
    /** 同步接纳提交；`{ok:false}` 时输入层回滚预览并给出诊断。 */
    onCommit(commit: SashGestureCommit<C>): {ok: true} | {ok: false; reason: string};
    /** 取消回执（可选）。 */
    onCancel?(info: {reason: SplitterGestureCancelReason; sashes: readonly GridSashRef[]}): void;
};

export type SashGestureHost<S, C = GridBranchResize> = {
    /** 按下（或键盘开始）时建立会话；null = 此刻不开始手势。 */
    begin(input: {source: "pointer" | "keyboard"; sashes: readonly GridSashRef[]}): SashGestureBinding<S, C> | null;
};
