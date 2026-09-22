/**
 * 一次拖动会话的纯模型：冻结基线、多轴预览、正常结束与取消。
 *
 * 这里没有 DOM、Vue 与存储：调用方（`useSashGesture`）只负责把指针/键盘输入换算成主轴位移，
 * 把预览几何交给渲染层，并在结束时把 `GridGestureCommit` 交给宿主落账。
 *
 * 两条硬约束：
 * - **不逐帧发布意图**：每一帧都从冻结基线重新求解，宿主只看到最终 `changes`；
 * - **一次手势只提交一次**：交汇处的两根轴收齐后才产出 changes，期间任何一轴结束都不重建另一轴的基线。
 */
import {axisOf, branchSashPanels, layoutOf, type GridSashResolver, type SashPanel} from "./grid-geometry";
import {sashEdgeDelta, sashLineOffset, solveSashCollapse, solveSashDrag, withCollapseOverrides, type SashDragSnapState} from "./sash-drag";
import type {GridSashRef, SashGestureSessionCore} from "./sash-gesture";
import type {GridAxis, GridBranch, GridBranchResize, GridExtent, GridLayoutResult, GridNode} from "./grid-types";
import type {SplitterGestureCancelReason} from "./splitter-gesture";

/** 手势开始时冻结的外部事实：整场手势只对它求解，不重读活动树或产品策略。 */
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

export type GridGestureSessionInput<T> = GridGestureBaseline<T> & {
    readonly sessionId: string;
    readonly source: "pointer" | "keyboard";
    readonly sashes: readonly GridSashRef[];
};

/** 一个分支在此次手势中的变化；`baseline`/`target` 是该分支全部直接子节点的主轴 px。 */
export type GridBranchChange = GridBranchResize & {
    /** 求解时该分支的父预览盒。 */
    readonly extent: GridExtent;
    readonly active: readonly string[];
    readonly compensated: readonly string[];
    readonly collapsed: Readonly<Record<string, boolean>>;
};

/** 一次手势的最终提交：宿主用它一次性落账（`resizeBranches` 或映射到自己的意图）。 */
export type GridGestureCommit = {
    readonly sessionId: string;
    readonly contextKey: string;
    readonly source: "pointer" | "keyboard";
    readonly revision: number;
    readonly extent: GridExtent;
    readonly changes: readonly GridBranchChange[];
};

/** 手势过程中的几何预览：渲染层用它替代受控布局，宿主无需参与。 */
export type GridGesturePreview<T> = {
    readonly layout: GridLayoutResult;
    readonly tree: GridNode<T> | null;
    readonly changes: readonly GridBranchChange[];
    readonly issues: readonly string[];
};

export interface GridGestureSession<T = unknown> extends SashGestureSessionCore<GridGesturePreview<T>, GridBranchChange> {
    readonly sessionId: string;
    readonly source: "pointer" | "keyboard";
    /** 主轴位移（正 = 分隔条向右/向下移动）。 */
    update(delta: {x: number; y: number}): GridGesturePreview<T> | null;
    /** 键盘 Home / End：把分隔条移到可行两端。 */
    jump(edge: "start" | "end"): GridGesturePreview<T> | null;
    /** 显式折叠/恢复：与拖动共用同一收起策略与容量判定。 */
    setCollapsed(collapsed: boolean): GridGesturePreview<T> | null;
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
    issues: readonly string[];
    snapState: SashDragSnapState | null;
    /** 键盘 Home / End 这类非指针输入给出的绝对位移；null 表示跟随指针位移。 */
    deltaOverride: number | null;
};

function findBranch<T>(node: GridNode<T> | null, id: string): GridBranch<T> | null {
    if (!node) {
        return null;
    }
    if (node.kind === "branch") {
        if (node.id === id) {
            return node;
        }
        for (const child of node.children) {
            const hit = findBranch(child, id);
            if (hit !== null) {
                return hit;
            }
        }
    }
    return null;
}

/** 建一棵可写的预览树：结构冻结，意图与收起状态按本帧解出来的目标改写。 */
function cloneTree<T>(node: GridNode<T> | null): GridNode<T> | null {
    if (!node) {
        return null;
    }
    if (node.kind === "leaf") {
        return {...node, size: {...node.size}, minimumSize: {...node.minimumSize}, maximumSize: {...node.maximumSize}};
    }
    return {
        ...node,
        size: {...node.size},
        minimumSize: {...node.minimumSize},
        maximumSize: {...node.maximumSize},
        children: node.children.map((child) => cloneTree(child)!),
    };
}

/**
 * 预览投影：把每个分支解出来的 px 目标写进一棵临时树再整体布局一次。
 *
 * 写入的是**预览意图**（等于本帧 px 目标，求和与按下时相同），因此 `layoutOf` 会原样再现解法结果；
 * 它只活在预览树里，绝不落账——宿主提交走 `resizeBranches` 的意图反解。
 * 分支副轴（例如外层横向分支里的竖直子分支）不受影响，所以同帧的多根轴不会互相污染。
 */
export function projectGridGesture<T>(
    baseline: GridGestureBaseline<T>,
    solves: readonly {branchId: string; axis: GridAxis; sizesPx: readonly number[]; collapsed: Readonly<Record<string, boolean>>}[],
): {tree: GridNode<T> | null; layout: GridLayoutResult} {
    const tree = cloneTree(baseline.root);
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
 */
export function createGridGestureSession<T>(input: GridGestureSessionInput<T>): GridGestureSession<T> {
    let delta = {x: 0, y: 0};
    let reason: SplitterGestureCancelReason | null = null;
    let changed = false;
    let pending: {index: number; collapsed: boolean} | null = null;
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
        const issues: string[] = [];
        let anyChange = false;
        const collapseAction = pending;
        pending = null;
        for (const owner of owners) {
            const current = owner.sizes ?? owner.baseline;
            if (collapseAction !== null) {
                const applied = applyCollapse(owner, current, collapseAction);
                if (applied) {
                    continue;
                }
            }
            const result = solveSashDrag({
                panels: owner.panels,
                baselinePx: owner.baseline,
                sashIndex: owner.sash.index,
                deltaPx: owner.deltaOverride ?? (owner.sash.axis === "width" ? delta.x : delta.y),
                snapState: owner.snapState,
            });
            if (result === null) {
                continue;
            }
            owner.snapState = result.snapState;
            owner.sizes = result.sizesPx;
            owner.active = result.active;
            owner.compensated = result.compensated;
            owner.collapsed = {...result.collapsed};
            owner.issues = result.issues;
            issues.push(...result.issues);
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

    /** 键盘/命令式折叠：在指定轴的两个相邻面板里找一个可折叠的，成功返回 true。 */
    function applyCollapse(owner: Owner, current: readonly number[], action: {index: number; collapsed: boolean}): boolean {
        if (action.index < 0 || action.index >= owner.panels.length) {
            return false;
        }
        const result = solveSashCollapse({
            // 兄弟范围必须看到本场已改动的收起状态，否则已收起的兄弟会带着展开范围参与容量计算。
            panels: withCollapseOverrides(owner.panels, owner.snapState?.collapsed),
            sizesPx: current,
            sashIndex: owner.sash.index,
            index: action.index,
            collapsed: action.collapsed,
        });
        if (result === null) {
            return false;
        }
        owner.sizes = result.sizesPx;
        owner.collapsed = {...owner.collapsed, ...result.collapsed};
        owner.active = Object.keys(result.collapsed);
        owner.compensated = [];
        owner.issues = result.issues;
        if (Object.keys(result.collapsed).length === 0) {
            return false;
        }
        // 只累积收起覆盖：几何锚点始终是按下基线，显式恢复不会被下一次 delta 求解重算掉。
        owner.snapState = {collapsed: {...(owner.snapState?.collapsed ?? {}), ...result.collapsed}};
        return true;
    }

    /** 该轴上下一个可折叠面板：优先分隔条前侧，其次后侧。 */
    function collapsibleIndex(owner: Owner): number | null {
        for (const index of [owner.sash.index, owner.sash.index + 1]) {
            const panel = owner.panels[index];
            if (panel?.collapse) {
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
        pending = action;
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

        setCollapsed(collapsed) {
            if (reason !== null) {
                return null;
            }
            for (const owner of owners) {
                const index = collapsibleIndex(owner);
                if (index === null) {
                    continue;
                }
                const preview = applyOn(owner, {index, collapsed});
                if (preview !== null) {
                    return preview;
                }
            }
            return null;
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
