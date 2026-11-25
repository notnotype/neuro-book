/**
 * 一次拖动会话的纯模型：冻结基线、多轴预览、正常结束与取消。
 *
 * 这里没有 DOM、Vue 与存储：调用方（`useSashGesture`）只负责把指针/键盘输入换算成主轴位移，
 * 把预览几何交给渲染层，并在结束时把 `GridGestureCommit` 交给宿主落账。
 *
 * 两条硬约束：
 * - **不逐帧发布意图**：每一帧都对冻结基线求解（兄弟间的分配接着上一帧，见 `sash-drag`），宿主只看到最终 `changes`；
 * - **一次手势只提交一次**：交汇处的两根轴收齐后才产出 changes，期间任何一轴结束都不重建另一轴的基线。
 */
import {axisOf, branchSashPanels, layoutOf, type GridSashResolver, type SashPanel} from "./grid-geometry";
import {reflowSashCollapse, sashEdgeDelta, sashLineOffset, solveSashDrag, withCollapseOverrides, type SashDragSnapState} from "./sash-drag";
import {cloneNode, findInTree} from "./grid-tree";
import {issueKey} from "./issue-gate";
import type {GridSashRef, SashGestureCancelReason, SashGestureSessionCore, SashGestureSource} from "./sash-gesture";
import type {GridAxis, GridBranch, GridBranchResize, GridExtent, GridIssue, GridIssueCode, GridLayoutResult, GridNode} from "./grid-types";

/**
 * 手势开始时冻结的外部事实：整场手势只对它求解，不重读活动树或产品策略。
 * @experimental
 */
export type GridGestureBaseline<T> = {
    /** 副作用上下文标识（工作面 / 布局键）：变化即取消。 */
    readonly contextKey: string;
    /** 外部版本号：树、约束或容器尺寸变化时宿主递增。 */
    readonly revision: number;
    readonly root: GridNode<T> | null;
    readonly extent: GridExtent;
    readonly layout: GridLayoutResult;
    readonly sashSize: number | GridSashResolver;
};

/** @experimental */
export type GridGestureSessionInput<T> = GridGestureBaseline<T> & {
    readonly sessionId: string;
    readonly source: SashGestureSource;
    readonly sashes: readonly GridSashRef[];
};

/**
 * 一个分支在此次手势中的变化；`baseline`/`target` 是该分支全部直接子节点的主轴 px。
 * @experimental
 */
export type GridBranchChange = GridBranchResize & {
    /** 求解时该分支的父预览盒。 */
    readonly extent: GridExtent;
    readonly active: readonly string[];
    readonly compensated: readonly string[];
    readonly collapsed: Readonly<Record<string, boolean>>;
};

/**
 * `NestedGrid` 的 `gesture-start` 载荷：一场手势开始，宿主据此记下它对应的上下文与版本。
 * @experimental
 */
export type GridGestureStart = {
    readonly sessionId: string;
    readonly contextKey: string;
    readonly source: SashGestureSource;
    readonly revision: number;
    readonly sashes: readonly GridSashRef[];
};

/**
 * `NestedGrid` 的 `gesture-cancel` 载荷：手势取消，预览已经撤回。
 * @experimental
 */
export type GridGestureCancellation = {
    readonly reason: SashGestureCancelReason;
    readonly sashes: readonly GridSashRef[];
};

/**
 * 一次手势的最终提交：宿主用它一次性落账（`resizeBranches` 或映射到自己的意图）。
 * @experimental
 */
export type GridGestureCommit = {
    readonly sessionId: string;
    readonly contextKey: string;
    readonly source: SashGestureSource;
    readonly revision: number;
    readonly extent: GridExtent;
    readonly changes: readonly GridBranchChange[];
};

/**
 * 手势过程中的几何预览：渲染层用它替代受控布局，宿主无需参与。
 * @experimental
 */
export type GridGesturePreview<T> = {
    readonly layout: GridLayoutResult;
    readonly tree: GridNode<T> | null;
    readonly changes: readonly GridBranchChange[];
    /** 这一帧拖动求解的全部诊断（快照，Spec `ui/nested-grid` 输出 140）；预览布局自己的诊断在 `layout.issues`。 */
    readonly issues: readonly GridIssue<GridIssueCode>[];
};

/** @experimental */
export interface GridGestureSession<T = unknown> extends SashGestureSessionCore<GridGesturePreview<T>, GridBranchChange> {
    readonly sessionId: string;
    readonly source: SashGestureSource;
    /** 主轴位移（正 = 分隔条向右/向下移动）。 */
    update(delta: {x: number; y: number}): GridGesturePreview<T> | null;
    /** 键盘 Home / End：把分隔条移到可行两端。 */
    jump(edge: "start" | "end"): GridGesturePreview<T> | null;
    /** 当前收起则展开、展开则收起（Enter 与区段按钮用）。 */
    toggleCollapsed(): GridGesturePreview<T> | null;
    /** 正常结束：无真实变化返回 null。 */
    finish(): GridGestureCommit | null;
}

type Owner = {
    readonly sash: GridSashRef;
    readonly panels: readonly SashPanel[];
    /** 按下时该分支直接子节点的主轴呈现 px（顺序与 panels 一致）。 */
    readonly baseline: readonly number[];
    /** 该分支直接子节点的 id（顺序与 panels 一致）。 */
    readonly childIds: readonly string[];
    /** 本帧解出的目标 px；null 表示还没解过，按按下基线呈现。 */
    sizes: readonly number[] | null;
    /** 本场手势真正改变的收起状态。 */
    collapsed: Readonly<Record<string, boolean>>;
    /** 主动 / 补偿字段（相对按下基线）。 */
    active: readonly string[];
    compensated: readonly string[];
    issues: readonly GridIssue<GridIssueCode>[];
    snapState: SashDragSnapState | null;
    /** 键盘 Home / End 这类非指针输入给出的绝对位移；null 表示跟随指针位移。 */
    deltaOverride: number | null;
};

function findBranch<T>(node: GridNode<T> | null, id: string): GridBranch<T> | null {
    const hit = node ? findInTree(id, node) : null;
    return hit?.node.kind === "branch" ? hit.node : null;
}

/**
 * 预览投影：把每个分支解出来的 px 目标写进一棵临时树再整体布局一次。
 *
 * 写入的是**预览意图**（等于本帧 px 目标，求和与按下时相同），因此 `layoutOf` 会原样再现解法结果；
 * 它只活在预览树里，绝不落账——宿主提交走 `resizeBranches` 的意图反解。
 * 分支副轴（例如外层横向分支里的竖直子分支）不受影响，所以同帧的多根轴不会互相污染。
 */
function projectGridGesture<T>(
    baseline: GridGestureBaseline<T>,
    solves: readonly {branchId: string; axis: GridAxis; sizesPx: readonly number[]; collapsed: Readonly<Record<string, boolean>>}[],
): {tree: GridNode<T> | null; layout: GridLayoutResult} {
    // 预览树结构冻结，意图与收起状态按本帧解出来的目标改写。
    const tree = baseline.root ? cloneNode(baseline.root) : null;
    for (const solve of solves) {
        const branch = findBranch(tree, solve.branchId);
        if (branch === null || branch.children.length !== solve.sizesPx.length) {
            continue;
        }
        const axis = axisOf(branch.orientation);
        branch.children.forEach((child, index) => {
            const collapse = solve.collapsed[child.id];
            if (collapse !== undefined && child.collapse) {
                child.collapse = {...child.collapse, collapsed: collapse};
            }
            // 收起面板保持展开意图（呈现由收起策略给出），其余写入本帧目标。
            if (collapse === true || child.collapse?.collapsed === true) {
                return;
            }
            child.size[axis] = solve.sizesPx[index]!;
        });
    }
    return {tree, layout: layoutOf(tree, baseline.extent, baseline.sashSize)};
}

/**
 * 建立一场手势会话。`sashes` 是本次按下命中的分隔线（同一棵树内最多一根 width 轴 + 一根 height 轴）。
 * @experimental
 */
export function createGridGestureSession<T>(input: GridGestureSessionInput<T>): GridGestureSession<T> {
    let delta = {x: 0, y: 0};
    let reason: SashGestureCancelReason | null = null;
    let changed = false;
    /** 下一次求解要执行的显式折叠：只对发起它的那根轴（`owner`），交叉处另一根轴照常按位移求解。 */
    let pending: {owner: Owner; index: number; collapsed: boolean} | null = null;
    const owners: Owner[] = [];
    for (const sash of input.sashes) {
        const branch = findBranch(input.root, sash.branchId);
        if (branch === null || branch.children.length < 2) {
            continue;
        }
        owners.push({
            sash,
            panels: branchSashPanels(branch, input.sashSize),
            baseline: branch.children.map((child) => Math.max(0, input.layout.sizes[child.id]?.[sash.axis] ?? 0)),
            childIds: branch.children.map((child) => child.id),
            sizes: null,
            collapsed: {},
            active: [],
            compensated: [],
            issues: [],
            snapState: null,
            deltaOverride: null,
        });
    }

    /** 求解本帧：要么推进拖动位移，要么执行一次显式折叠，然后把全部轴一起投影。 */
    function solve(): {preview: GridGesturePreview<T> | null} {
        const solves: {branchId: string; axis: GridAxis; sizesPx: readonly number[]; collapsed: Readonly<Record<string, boolean>>}[] = [];
        const issues: GridIssue<GridIssueCode>[] = [];
        let anyChange = false;
        const collapseAction = pending;
        pending = null;
        for (const owner of owners) {
            const current = owner.sizes ?? owner.baseline;
            let collapseIssues: readonly GridIssue<GridIssueCode>[] = [];
            if (collapseAction !== null && collapseAction.owner === owner) {
                const collapse = applyCollapse(owner, current, collapseAction);
                issues.push(...collapse.issues);
                if (collapse.applied) {
                    continue;
                }
                // 折叠没有真实变化（例如恢复空间不够）：照旧按位移求解，它的诊断和折叠的合在一起，不被拖动求解盖掉。
                collapseIssues = collapse.issues;
            }
            const result = solveSashDrag({
                panels: owner.panels,
                baselinePx: owner.baseline,
                sashIndex: owner.sash.index,
                deltaPx: owner.deltaOverride ?? (owner.sash.axis === "width" ? delta.x : delta.y),
                snapState: owner.snapState,
                scope: {id: owner.sash.branchId, axis: owner.sash.axis},
            });
            if (result === null) {
                continue;
            }
            owner.snapState = result.snapState;
            owner.sizes = result.sizesPx;
            owner.active = result.active;
            owner.compensated = result.compensated;
            owner.collapsed = {...result.collapsed};
            // 两处诊断合在一起，同键的只留折叠那一条：快照里同一个键最多一条（Spec 输出 140）。
            const collapseKeys = new Set(collapseIssues.map(issueKey));
            const dragIssues = result.issues.filter((issue) => !collapseKeys.has(issueKey(issue)));
            owner.issues = [...collapseIssues, ...dragIssues];
            issues.push(...dragIssues);
        }
        for (const owner of owners) {
            const sizes = owner.sizes ?? owner.baseline;
            if (owner.active.length > 0 || owner.compensated.length > 0 || Object.keys(owner.collapsed).length > 0) {
                anyChange = true;
            }
            solves.push({branchId: owner.sash.branchId, axis: owner.sash.axis, sizesPx: sizes, collapsed: owner.collapsed});
        }
        changed = anyChange;
        if (!anyChange) {
            return {preview: null};
        }
        const projected = projectGridGesture(input, solves);
        return {
            preview: {
                layout: projected.layout,
                tree: projected.tree,
                changes: owners.map((owner) => changeOf(owner, input)),
                issues,
            },
        };
    }

    /**
     * 键盘/命令式折叠：翻目标面板的标记、按意图重排这一支（`reflowSashCollapse`，结果同 `setCollapsed`）。
     * 有真实变化才改会话状态并返回 `applied: true`；没有变化时会话状态不动（前面的位移照常提交），只交回折叠的诊断。
     * 重排从意图出发，不接着本场前面拖出来的尺寸：前面的位移被这次切换整个替换。
     */
    function applyCollapse(owner: Owner, current: readonly number[], action: {index: number; collapsed: boolean}): {applied: boolean; issues: readonly GridIssue<GridIssueCode>[]} {
        if (action.index < 0 || action.index >= owner.panels.length) {
            return {applied: false, issues: []};
        }
        const result = reflowSashCollapse({
            // 兄弟范围必须看到本场已改动的收起状态，否则已收起的兄弟会带着展开范围参与重排。
            panels: withCollapseOverrides(owner.panels, owner.snapState?.collapsed),
            sizesPx: current,
            index: action.index,
            collapsed: action.collapsed,
        });
        if (result === null) {
            return {applied: false, issues: []};
        }
        if (Object.keys(result.collapsed).length === 0) {
            return {applied: false, issues: result.issues};
        }
        owner.sizes = result.sizesPx;
        owner.collapsed = {...owner.collapsed, ...result.collapsed};
        owner.active = Object.keys(result.collapsed);
        owner.compensated = [];
        owner.issues = result.issues;
        // 累积收起覆盖，边界锚点仍是按下基线；下一帧的分配从折叠后的尺寸接着走。
        owner.snapState = {collapsed: {...(owner.snapState?.collapsed ?? {}), ...result.collapsed}, sizesPx: result.sizesPx};
        return {applied: true, issues: result.issues};
    }

    /** 该轴上下一个可显式折叠的面板：优先分隔条前侧，其次后侧；`toggleable: false` 的只经拖动收起，锁住的（输出 168）只由宿主翻。 */
    function collapsibleIndex(owner: Owner): number | null {
        for (const index of [owner.sash.index, owner.sash.index + 1]) {
            const panel = owner.panels[index];
            if (panel?.collapse && panel.collapse.toggleable !== false && panel.collapse.locked !== true) {
                return index;
            }
        }
        return null;
    }

    /** 该轴相邻可折叠面板当前的收起状态；没有可折叠面板时返回 null。 */
    function collapseState(owner: Owner): {index: number; collapsed: boolean} | null {
        const index = collapsibleIndex(owner);
        if (index === null) {
            return null;
        }
        const panel = owner.panels[index]!;
        const id = owner.childIds[index]!;
        return {index, collapsed: owner.collapsed[id] ?? panel.collapse?.collapsed === true};
    }

    /** 对某个轴执行一次显式折叠；成功返回预览。 */
    function applyOn(owner: Owner, action: {index: number; collapsed: boolean}): GridGesturePreview<T> | null {
        pending = {owner, ...action};
        const preview = solve().preview;
        if (preview !== null) {
            return preview;
        }
        pending = null;
        return null;
    }

    return {
        sessionId: input.sessionId,
        source: input.source,
        sashes: owners.map((owner) => owner.sash),
        get reason() {
            return reason;
        },
        get changed() {
            return changed;
        },
        get issues() {
            return owners.flatMap((owner) => owner.issues);
        },

        update(next) {
            if (reason !== null) {
                return null;
            }
            delta = next;
            for (const owner of owners) {
                owner.deltaOverride = null;
            }
            return solve().preview;
        },

        jump(edge) {
            if (reason !== null) {
                return null;
            }
            let preview: GridGesturePreview<T> | null = null;
            for (const owner of owners) {
                const current = owner.sizes ?? owner.baseline;
                // 求解器只接受相对按下基线的绝对位移：线现在的位置 + 到可行端的相对位移。
                owner.deltaOverride = sashLineOffset({
                    baselinePx: owner.baseline,
                    sizesPx: current,
                    sashIndex: owner.sash.index,
                }) + sashEdgeDelta({
                    panels: owner.panels,
                    sizesPx: current,
                    sashIndex: owner.sash.index,
                    edge,
                });
                preview = solve().preview ?? preview;
            }
            return preview;
        },

        toggleCollapsed() {
            if (reason !== null) {
                return null;
            }
            for (const owner of owners) {
                const state = collapseState(owner);
                if (state === null) {
                    continue;
                }
                const preview = applyOn(owner, {index: state.index, collapsed: !state.collapsed});
                if (preview !== null) {
                    return preview;
                }
            }
            return null;
        },

        finish() {
            // 提交的就是最后发布的那份几何：不再用最后一次位移重解，否则显式折叠/恢复会被按 delta 收回。
            if (reason !== null || !changed) {
                return null;
            }
            return {
                sessionId: input.sessionId,
                contextKey: input.contextKey,
                source: input.source,
                revision: input.revision,
                extent: {...input.extent},
                changes: owners.map((owner) => changeOf(owner, input)),
            };
        },

        cancel(cancelReason) {
            reason = cancelReason;
            pending = null;
            for (const owner of owners) {
                owner.sizes = null;
                owner.collapsed = {};
                owner.active = [];
                owner.compensated = [];
                owner.snapState = null;
            }
            changed = false;
        },
    };

    function changeOf(owner: Owner, session: GridGestureSessionInput<T>): GridBranchChange {
        const sizes = owner.sizes ?? owner.baseline;
        const baseline: Record<string, number> = Object.create(null) as Record<string, number>;
        const target: Record<string, number> = Object.create(null) as Record<string, number>;
        owner.childIds.forEach((id, index) => {
            baseline[id] = owner.baseline[index]!;
            target[id] = sizes[index] ?? owner.baseline[index]!;
        });
        return {
            branchId: owner.sash.branchId,
            axis: owner.sash.axis,
            baseline,
            target,
            extent: {...session.extent},
            active: [...owner.active],
            compensated: [...owner.compensated],
            collapsed: {...owner.collapsed},
        };
    }
}
