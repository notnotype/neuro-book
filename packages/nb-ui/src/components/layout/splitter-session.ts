/**
 * 独立 `Splitter` 的单分支会话：与整棵 Grid 的会话实现同一份 `SashGestureSessionCore`，
 * 只是它的「树」就是这一组面板，几何由组件自己持有。
 *
 * 求解走同一批纯函数（`solveSashDrag` / `solveSashCollapse` / `sashEdgeDelta` / `sashLineOffset`）：
 * 绝对位移、收起阈值、记忆尺寸（只服务显式恢复）与补偿传播口径与 Grid 完全一致，这里不复制任何数值算法。
 */
import type {SashPanel} from "./grid-geometry";
import {sashEdgeDelta, sashLineOffset, solveSashCollapse, solveSashDrag, withCollapseOverrides, type SashDragResult, type SashDragSnapState} from "./sash-drag";
import type {GridAxis, GridExtent} from "./grid-types";
import type {SplitterGestureCancelReason, SplitterGestureSource, SplitterGestureState} from "./splitter-gesture";
import type {SashGestureSessionCore} from "./sash-gesture";

export type SplitterGestureChange = {
    readonly branchId: string;
    readonly axis: GridAxis;
    readonly baseline: Readonly<Record<string, number>>;
    readonly target: Readonly<Record<string, number>>;
    readonly collapsed: Readonly<Record<string, boolean>>;
};

export type SplitterSessionInput = {
    readonly sessionId: string;
    readonly contextKey: string;
    readonly source: SplitterGestureSource;
    readonly revision: number;
    /** 面板身份：`panels[i]` 属于 `ids[i]`；`sashes[0].branchId` 同值。 */
    readonly branchId: string;
    readonly axis: GridAxis;
    readonly ids: readonly string[];
    readonly panels: readonly SashPanel[];
    /** 按下（或键盘开始）时的完整呈现 px。 */
    readonly baselinePx: readonly number[];
    readonly sashIndex: number;
    readonly extent: GridExtent;
};

/**
 * 会话：一维、单条边界，几何直接由调用方持有。`state` 是最近一次真实预览（无变化时为 null），
 * 组件用它发 `gesture-update` / `gesture-end`。
 */
export type SplitterGestureSession = SashGestureSessionCore<SplitterGestureState, SplitterGestureChange> & {
    readonly state: SplitterGestureState | null;
};

export function createSplitterSession(input: SplitterSessionInput): SplitterGestureSession {
    const axis = input.axis;
    const ids = input.ids;
    let delta = {x: 0, y: 0};
    let snapState: SashDragSnapState | null = null;
    let sizes: readonly number[] = input.baselinePx;
    let collapsed: Readonly<Record<string, boolean>> = {};
    let active: readonly string[] = [];
    let compensated: readonly string[] = [];
    let issues: readonly string[] = [];
    let state: SplitterGestureState | null = null;
    let cancelReason: SplitterGestureCancelReason | null = null;

    /** 主动操作的 sash 稳定 id，形如 `outline~editor`。 */
    function sashId(): string {
        const before = ids[input.sashIndex] ?? `panel-${input.sashIndex}`;
        const after = ids[input.sashIndex + 1] ?? `panel-${input.sashIndex + 1}`;
        return `${before}~${after}`;
    }

    function applySolve(result: SashDragResult | null): SplitterGestureState | null {
        if (result === null) {
            return null;
        }
        sizes = result.sizesPx;
        collapsed = result.collapsed;
        active = result.active;
        compensated = result.compensated;
        issues = result.issues;
        snapState = result.snapState;
        if (active.length === 0 && compensated.length === 0 && Object.keys(collapsed).length === 0) {
            state = null;
            return null;
        }
        state = {
            source: input.source,
            sash: sashId(),
            active: [...active],
            compensated: [...compensated],
            sizesPx: [...sizes],
            collapsed: {...collapsed},
        };
        return state;
    }

    function drag(deltaPx: number): SplitterGestureState | null {
        return applySolve(solveSashDrag({
            panels: input.panels,
            baselinePx: input.baselinePx,
            sashIndex: input.sashIndex,
            deltaPx,
            snapState,
        }));
    }

    /** 该轴上下一个可折叠面板：优先分隔条前侧，其次后侧。 */
    function collapsibleIndex(): number | null {
        for (const index of [input.sashIndex, input.sashIndex + 1]) {
            if (input.panels[index]?.collapse) {
                return index;
            }
        }
        return null;
    }

    function collapseOn(index: number, next: boolean): SplitterGestureState | null {
        const result = solveSashCollapse({
            // 兄弟范围必须看到本场已改动的收起状态，否则已收起的兄弟会带着展开范围参与容量计算。
            panels: withCollapseOverrides(input.panels, snapState?.collapsed),
            sizesPx: sizes,
            sashIndex: input.sashIndex,
            index,
            collapsed: next,
        });
        if (result === null) {
            return null;
        }
        sizes = result.sizesPx;
        collapsed = {...collapsed, ...result.collapsed};
        active = Object.keys(result.collapsed);
        compensated = [];
        issues = result.issues;
        // 只累积收起覆盖：几何锚点始终是按下基线，显式恢复不会被下一次 delta 求解重算掉。
        snapState = {collapsed: {...(snapState?.collapsed ?? {}), ...result.collapsed}};
        if (Object.keys(result.collapsed).length === 0) {
            // 没有真实变化：保留上一次预览——no-op 不能把已经发布的几何降级成「无变化」。
            return null;
        }
        state = {
            source: input.source,
            sash: sashId(),
            active: [...active],
            compensated: [],
            sizesPx: [...sizes],
            collapsed: {...collapsed},
        };
        return state;
    }

    return {
        sessionId: input.sessionId,
        source: input.source,
        sashes: [{branchId: input.branchId, index: input.sashIndex, axis}],
        get reason() {
            return cancelReason;
        },
        get changed() {
            return state !== null;
        },
        get issues() {
            return issues;
        },
        get state() {
            return state;
        },

        update(next) {
            if (cancelReason !== null) {
                return null;
            }
            delta = next;
            return drag(axis === "width" ? delta.x : delta.y);
        },

        jump(edge) {
            if (cancelReason !== null) {
                return null;
            }
            const shift = sashEdgeDelta({
                panels: input.panels,
                sizesPx: sizes,
                sashIndex: input.sashIndex,
                edge,
            });
            // 求解器只接受相对按下基线的绝对位移：线现在的位置 + 到可行端的相对位移。
            const target = sashLineOffset({baselinePx: input.baselinePx, sizesPx: sizes, sashIndex: input.sashIndex}) + shift;
            return drag(target);
        },

        toggleCollapsed() {
            if (cancelReason !== null) {
                return null;
            }
            const index = collapsibleIndex();
            if (index === null) {
                return null;
            }
            const current = collapsed[ids[index]!] ?? input.panels[index]!.collapse?.collapsed === true;
            return collapseOn(index, !current);
        },

        finish() {
            // 提交的就是最后发布的那份几何：显式折叠/恢复之后不再用最后一次位移重解，重解会把它按 delta 收回。
            if (cancelReason !== null || state === null) {
                return null;
            }
            const baseline: Record<string, number> = Object.create(null) as Record<string, number>;
            const target: Record<string, number> = Object.create(null) as Record<string, number>;
            ids.forEach((id, index) => {
                baseline[id] = input.baselinePx[index] ?? 0;
                target[id] = sizes[index] ?? input.baselinePx[index] ?? 0;
            });
            return {
                sessionId: input.sessionId,
                contextKey: input.contextKey,
                source: input.source,
                revision: input.revision,
                extent: {...input.extent},
                changes: [{
                    branchId: input.branchId,
                    axis,
                    baseline,
                    target,
                    collapsed: {...collapsed},
                }],
            };
        },

        cancel(next) {
            cancelReason = next;
            sizes = input.baselinePx;
            collapsed = {};
            active = [];
            compensated = [];
            snapState = null;
            state = null;
        },
    };
}
