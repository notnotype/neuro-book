/**
 * 实时布局的候选与预览（docs/specs/ui/workbench-layout.md“实时布局”）：候选稳定了才换预览，指针在已显示的空位里候选不变。纯函数，时间由调用方给，组件不进来。
 *
 * 候选用不透明的键比较：动作的内容由宿主决定。
 */

import type {GridDropPoint, GridDropRect} from "./grid-drop";

/** 候选连续这么久不变才换预览（提案第 3 节）。 */
export const LIVE_SETTLE_MS = 150;
/** 空位周围这么宽还算在空位里：指针贴着边缘时预览不来回跳。 */
export const LIVE_STICKY_PX = 8;

export interface LiveDropCandidate {
    readonly key: string;
    /** 不等稳定就换（标签条内要跟手）。 */
    readonly immediate: boolean;
    /** 放下会长出的新面板的矩形（终态）；没有新面板（并进已有面板、标签条）是 null，没有粘滞。 */
    readonly slot: GridDropRect | null;
}

export type LivePreview =
    /** 按这个候选摆。 */
    | {readonly kind: "candidate"; readonly key: string}
    /** 预览过又没有候选了：来源收起，留下的填满它的位置。 */
    | {readonly kind: "source-removed"}
    /** 还没预览过：就是已提交的布局。 */
    | {readonly kind: "none"};

export interface LiveDropState {
    readonly candidate: string | null;
    readonly changedAt: number;
    readonly preview: LivePreview;
    /** 已显示的空位。 */
    readonly slot: GridDropRect | null;
}

export const initialLiveDrop = (now: number): LiveDropState => ({candidate: null, changedAt: now, preview: {kind: "none"}, slot: null});

/** 这一帧的候选进来，得到这一帧的预览。 */
export function stepLiveDrop(state: LiveDropState, input: {readonly now: number; readonly candidate: LiveDropCandidate | null; readonly settleMs?: number}): LiveDropState {
    const key = input.candidate?.key ?? null;
    const changedAt = key === state.candidate ? state.changedAt : input.now;
    const base = {...state, candidate: key, changedAt};
    const shown = state.preview.kind === "candidate" ? state.preview.key : null;
    if (key === shown) return base;
    const wait = input.candidate?.immediate === true ? 0 : (input.settleMs ?? LIVE_SETTLE_MS);
    if (input.now - changedAt < wait) return base;
    if (input.candidate !== null) return {...base, preview: {kind: "candidate", key: input.candidate.key}, slot: input.candidate.slot};
    return state.preview.kind === "none" ? base : {...base, preview: {kind: "source-removed"}, slot: null};
}

/** 指针在已显示的空位里（含边距）：候选不变，松手放到这块。空位是稳定目标：长出来之后它底下的东西变了。 */
export function insideShownSlot(state: LiveDropState, point: GridDropPoint, stickyPx: number = LIVE_STICKY_PX): boolean {
    const {slot} = state;
    return slot !== null && point.x >= slot.left - stickyPx && point.x <= slot.right + stickyPx && point.y >= slot.top - stickyPx && point.y <= slot.bottom + stickyPx;
}
