/**
 * 可序列化拆分树（SerializableGrid 的领域无关原语）。
 *
 * 职责边界（见 `docs/proposals/workbench-view-host.md`「基础原语」一节）：
 * - 拥有：树操作（增删/移叶/换父）、两轴尺寸约束传播与夹取、序列化与恢复、**呈现**尺寸计算；
 * - 不拥有：拖拽手势与 sash 的产生（由 `Splitter`（`./vue`）提供 handle 与手势事件）、持久化键、组件实例。
 *
 * 因此本文件**不得**出现指针事件、`localStorage`、Vue 导入，也不得存放组件或 descriptor。
 *
 * 两个量必须分开（`docs/specs/ui/nested-grid.md` 的「状态与转换」）：
 * - **意图**：节点在父分支主轴上的用户分配值，由调整入口更新，进快照、由宿主持久化；
 * - **呈现**：`layout(container)` 的输出，随容器尺寸重算，永远不写回意图——视口夹取不得变成新的偏好。
 *
 * 几何规则见 `grid-geometry.ts`，快照格式见 `grid-snapshot.ts`。
 */
import type {
    GridAxis,
    GridBranch,
    GridBranchResize,
    GridBranchesResizeResult,
    GridCollapseOptions,
    GridCollapseResult,
    GridExtent,
    GridFailure,
    GridFailureCode,
    GridLayoutResult,
    GridLeaf,
    GridLeafInput,
    GridNode,
    GridNodeInput,
    GridOptions,
    GridRefEncoder,
    GridRefResolver,
    GridRestoreResult,
    GridResult,
    GridSetSizeResult,
    GridSizing,
    GridSnapshot,
    GridSplitInput,
    SashCollapseState,
} from "./grid-types";
import {GRID_MAX_DEPTH, GRID_MAX_NODES} from "./grid-types";
import {EPSILON, UNBOUNDED_EXTENT, ZERO_EXTENT, allocateAxis, axisOf, clampAxis, constraintOnAxis, constraintsOf, extentOf, finite, layoutOf, normCollapse, normExtent, type GridSashResolver} from "./grid-geometry";
import {gridFailure} from "./grid-failure";
import {parseSnapshot, serializeTree} from "./grid-snapshot";
import {cloneNode, copyTree, findInTree, type GridHit} from "./grid-tree";

export * from "./grid-types";
/** 分支主轴与交叉轴的取轴规则只此一处；宿主按父分支方向取轴时用它，别自己写 if。 */
export {axisOf} from "./grid-geometry";

/** 手势里一侧尺寸的问题：先判非有限数，再判负数（Spec `ui/nested-grid` 失败 5）。 */
function sizeProblem(side: "baseline" | "target", value: number | undefined): {kind: "not-finite" | "negative"; side: "baseline" | "target"} | null {
    if (value === undefined || !Number.isFinite(value)) {
        return {kind: "not-finite", side};
    }
    return value < 0 ? {kind: "negative", side} : null;
}

/** @experimental */
export type Grid<T> = {
    /** 当前布局树；结构变化后重新取。节点 `size` 是意图，不是呈现尺寸。 */
    root(): GridNode<T> | null;
    /** 只读查找：宿主读节点身份与意图用；改动仍走结构操作，直接改写节点会绕过守恒与规模判定。 */
    find(id: string): GridNode<T> | null;
    addLeaf(parentId: string, index: number, leaf: GridLeafInput<T>): GridResult;
    /**
     * 在一块叶旁边插入新叶（Spec 输出 160 到 162）。方向与目标的父分支相同时并进这个父分支、挨着目标，不新建分支；
     * 目标是根叶或方向不同时原位拆成新分支：新分支继承目标叶的外部分配意图，目标叶与新叶按 `ratio` 分掉目标
     * 在新轴上的意图（新轴意图为 0 时两端取同一正权重，避免均分塌成 0）。保留像素的目标拒绝拆分。失败不改树。
     */
    splitLeaf(targetId: string, split: GridSplitInput<T>): GridResult;
    removeLeaf(id: string): GridResult;
    moveLeaf(id: string, parentId: string, index: number): GridResult;
    /**
     * 一次手势的批量原子入口（可含交汇处的多根轴）：全部变化在同一候选树上规划，
     * 任何一项不通过就整批不落账；通过后一次写回尺寸意图与收起状态。
     */
    resizeBranches(changes: readonly GridBranchResize[]): GridBranchesResizeResult;
    /**
     * 收起或展开一块面板（Spec 输出 147、166）：只翻它的收起标记，尺寸意图不动，下一次 `layout()` 按分配规则重排，
     * 和宿主改了自己的记录、重新建树相同；展开回到意图。分隔条上的 Enter 能翻时结果相同（输出 20）。锁住的照常翻，
     * `options.locked` 同时改锁，不给时锁不变（输出 168）。
     * 改的是活树：用 `useGridHost` 时经它的 `setCollapsed`，直接调的宿主之后要自己 `invalidate()`。
     */
    setCollapsed(id: string, collapsed: boolean, options?: GridCollapseOptions): GridCollapseResult;
    /**
     * 把一块保留像素的节点（叶或分支）沿父分支主轴的意图设成 `px`（Spec 输出 154）：夹进它自己展开时的约束，兄弟不动，不读布局。
     * 收起中的节点也一样只改意图，展开时回到它（输出 166）；标了刚性的同样能设，它的范围跟着新意图走（输出 169）。改的是活树，规则同 `setCollapsed`。
     */
    setSize(id: string, px: number): GridSetSizeResult;
    serialize(): GridSnapshot;
    /**
     * 原地恢复：校验通过才换树，解析结果没给的约束、`sizing`、刚性与收起策略回落到当前树里同 id 的节点（Spec 输出 165）。
     * 从存档建一份新网格用 `restoreGrid`：它不看结果就拿不到网格。
     */
    restore(snapshot: unknown, resolveRef: GridRefResolver<T>): GridRestoreResult;
    /** 当前位置下的呈现尺寸；不改变意图，可由宿主在视口变化时反复调用。 */
    layout(container: GridExtent): GridLayoutResult;
    /**
     * 复制一份独立的网格（Spec 输出 164）：树、意图、约束、`sizing`、刚性、收起策略与状态，连同建网格时的选项（`sashSize`、`encodeRef`）。
     * 两份互不影响；`ref` 是同一个宿主对象，不复制。用在“先在副本上照做一遍、看结果与布局，再决定做不做”。
     */
    clone(): Grid<T>;
};

/**
 * `restoreGrid` 的结果：成功时带新网格，失败时是恢复失败的形状（同 `GridRestoreResult` 的失败）、没有 `grid`；两种都带 `dropped` 与 `clamped`。
 * 写在这里而不在 `grid-types.ts`：它要引用 `Grid`。
 * @experimental
 */
export type GridRestoredGrid<T> =
    | (Extract<GridRestoreResult, {ok: true}> & {readonly grid: Grid<T>})
    | Extract<GridRestoreResult, {ok: false}>;

/** 把建树输入规范成节点：缺的意图与约束补缺省值，输入对象不被网格持有。 */
function instantiate<T>(node: GridNodeInput<T>): GridNode<T> {
    const size = normExtent(node.size, ZERO_EXTENT);
    const minimumSize = normExtent(node.minimumSize, ZERO_EXTENT);
    const maximumSize = normExtent(node.maximumSize, UNBOUNDED_EXTENT);
    const sizing: GridSizing = node.sizing === "fixed" ? "fixed" : "weight";
    // 只有保留像素的节点记刚性：按比例分的标了不起作用，不进节点。
    const rigid = sizing === "fixed" && node.rigid === true ? {rigid: true as const} : {};
    const collapse = normCollapse(node.collapse);
    if (node.kind === "leaf") {
        return {kind: "leaf", id: node.id, ref: node.ref, size, minimumSize, maximumSize, sizing, ...rigid, ...(collapse === undefined ? {} : {collapse})};
    }
    return {
        kind: "branch",
        id: node.id,
        orientation: node.orientation,
        size,
        minimumSize,
        maximumSize,
        sizing,
        ...rigid,
        ...(collapse === undefined ? {} : {collapse}),
        children: node.children.map((child) => instantiate(child)),
    };
}

/** @experimental */
export function createGrid<T extends string>(root: GridNodeInput<T> | null, options?: GridOptions<T>): Grid<T>;
/** @experimental */
export function createGrid<T>(root: GridNodeInput<T> | null, options: GridOptions<T> & {encodeRef: GridRefEncoder<T>}): Grid<T>;
export function createGrid<T>(root: GridNodeInput<T> | null, options: GridOptions<T> = {}): Grid<T> {
    return buildGrid(root ? instantiate(root) : null, options);
}

/**
 * 从快照建一份新网格（Spec 输出 165）：结果不成功就没有 `grid`，宿主不看结果拿不到网格。
 * 约束、`sizing`、刚性与收起策略只来自 `resolveRef`（新网格没有当前树可回落）；要回落到当前树的，用原地的 `grid.restore`。
 * @experimental
 */
export function restoreGrid<T extends string>(snapshot: unknown, resolveRef: GridRefResolver<T>, options?: GridOptions<T>): GridRestoredGrid<T>;
/** @experimental */
export function restoreGrid<T>(snapshot: unknown, resolveRef: GridRefResolver<T>, options: GridOptions<T> & {encodeRef: GridRefEncoder<T>}): GridRestoredGrid<T>;
export function restoreGrid<T>(snapshot: unknown, resolveRef: GridRefResolver<T>, options: GridOptions<T> = {}): GridRestoredGrid<T> {
    const grid = buildGrid<T>(null, options);
    const result = grid.restore(snapshot, resolveRef);
    return result.ok ? {...result, grid} : result;
}

/**
 * 网格的本体：`initial` 已经是规范过的节点，网格从此独占它。选项在这里浅拷一份留给 `clone`：以后给 `GridOptions` 加的项副本自动带上，
 * 调用方建完网格再改自己那个选项对象，原网格与副本都不受影响（原网格的 `sashSize`、`encodeRef` 本来就在下面取定了）。
 */
function buildGrid<T>(initial: GridNode<T> | null, given: GridOptions<T>): Grid<T> {
    const options: GridOptions<T> = {...given};
    const sashSize: number | GridSashResolver = typeof options.sashSize === "function"
        ? options.sashSize
        : Math.max(0, finite(options.sashSize ?? 0, 0));
    const encodeRef = options.encodeRef;
    let tree: GridNode<T> | null = initial;

    function find(id: string, node: GridNode<T> | null = tree, parent: GridBranch<T> | null = null): GridHit<T> | null {
        return node ? findInTree(id, node, parent) : null;
    }

    /**
     * 按比例分的节点进一个分支时取的份额（Spec 输出 153）：兄弟的意图不动，新来的拿“平均一份”，布局时自然按比例重分。
     * 候选含收起中的兄弟（它的意图就是展开后的份额）；候选的意图全是 0 时取 0，和它们一起均分；没有候选才取 1。
     */
    function meanWeightShare(branch: GridBranch<T>, axis: GridAxis): number {
        const candidates = branch.children.filter((child) => child.sizing !== "fixed");
        if (candidates.length === 0) {
            return 1;
        }
        const positive = candidates.map((child) => child.size[axis]).filter((value) => value > 0);
        return positive.length === 0 ? 0 : positive.reduce((sum, value) => sum + value, 0) / positive.length;
    }

    /**
     * 空分支塌陷 / 单子节点塌陷：用幸存者顶替分支自身，并继承外部分配以保持父分支总量。
     * 例外是根（Spec 输出 163）：根总是占满容器，幸存者保留像素或带收起策略时，换成根之后它的像素意图与收起策略都没了着落，
     * 所以根分支留着、只剩这一个孩子。中间分支照旧展平（已知限制见 grid.md）。
     */
    function collapse(parent: GridBranch<T>, survivor: GridNode<T> | null): void {
        const holder = find(parent.id);
        if (!holder?.parent) {
            if (survivor && (survivor.sizing === "fixed" || survivor.collapse !== undefined)) {
                return;
            }
            tree = survivor;
            return;
        }
        const at = holder.parent.children.findIndex((child) => child.id === parent.id);
        if (survivor) {
            survivor.size = {...parent.size};
            holder.parent.children.splice(at, 1, survivor);
        } else {
            holder.parent.children.splice(at, 1);
        }
    }

    /** 整棵树的节点数，给规模守卫用。 */
    function countNodes(node: GridNode<T> | null): number {
        if (!node) {
            return 0;
        }
        return node.kind === "leaf" ? 1 : node.children.reduce((sum, child) => sum + countNodes(child), 1);
    }

    /**
     * 结构操作的规模守卫：与快照恢复同一份上限（根算第 1 层），避免造出无法保存、恢复的树。
     * `depth` 只是这次操作新造出来的那一处的层数，不取整棵树的最大深度：`createGrid` 不查规模，
     * 建进来的树已经超深时，浅处的增删移动照常成功，深处照旧被拒。节点数按整棵树加这次新增的个数。
     */
    function scaleIssue(nodes: number, depth: number): GridResult | null {
        if (nodes > GRID_MAX_NODES) {
            return gridFailure("limit-exceeded", `Too many nodes: ${nodes} > ${GRID_MAX_NODES}`, {limit: "nodes", max: GRID_MAX_NODES});
        }
        if (depth > GRID_MAX_DEPTH) {
            return gridFailure("limit-exceeded", `Nesting too deep: ${depth} > ${GRID_MAX_DEPTH}`, {limit: "depth", max: GRID_MAX_DEPTH});
        }
        return null;
    }

    function depthOf(id: string, node: GridNode<T> | null = tree, depth = 1): number | null {
        if (!node) {
            return null;
        }
        if (node.id === id) {
            return depth;
        }
        if (node.kind === "branch") {
            for (const child of node.children) {
                const found = depthOf(id, child, depth + 1);
                if (found !== null) {
                    return found;
                }
            }
        }
        return null;
    }

    /** 对外只读入口：节点引用在结构变化后失效，宿主只应读身份与意图。 */
    function findNode(id: string): GridNode<T> | null {
        return find(id)?.node ?? null;
    }

    /**
     * 单个分支的原子调整计划：先核对基线与目标，再把目标反解成新的尺寸意图。
     *
     * 现有意图（翻过本场的收起标记之后）已经布局出目标时一个也不改（R1，Spec 输出 167）；否则反解：
     * `fixed` 子节点直接以目标 px 为新意图；`weight` 子节点沿用免费水位反解（自由节点定标，
     * 触界节点保留仍与目标兼容的旧权重），之后还有收起着的按比例分的孩子时按同一倍数缩放回原来的和（R2，同一条输出）。
     * 尺寸意图只出现在返回值里，由调用方在全部通过后落账；
     * 唯一的例外是 `change.collapsed` 的收起状态，直接写在 `branch` 的孩子上（后面的反解要看到收起之后的范围），
     * 所以 `resizeBranches` 传的是候选树里的副本。
     */
    function planBranchResize(
        branch: GridBranch<T>,
        change: GridBranchResize,
    ): {ok: true; sizes: Record<string, number>; collapsed: Record<string, boolean>} | GridFailure<GridFailureCode> {
        const branchId = branch.id;
        const axis = change.axis;
        if (axisOf(branch.orientation) !== axis) {
            return gridFailure("wrong-axis", `Branch ${branchId} can only be resized along its main axis (${branch.orientation})`, {
                id: branchId,
                orientation: branch.orientation,
            });
        }
        const children = branch.children;
        const childIds = new Set(children.map((child) => child.id));
        const baselineIds = Object.keys(change.baseline);
        const targetIds = Object.keys(change.target);
        if (baselineIds.length !== childIds.size || targetIds.length !== childIds.size
            || baselineIds.some((id) => !childIds.has(id)) || targetIds.some((id) => !childIds.has(id))) {
            return gridFailure("invalid-argument", `The gesture sizes of branch ${branchId} must cover every direct child`, {field: "sizes-cover", id: branchId});
        }
        let baselineTotal = 0;
        let targetTotal = 0;
        for (const child of children) {
            const before = change.baseline[child.id];
            const after = change.target[child.id];
            // 同一个子节点两侧都不合法时报基线那一侧（Spec 失败 5）。
            const invalid = sizeProblem("baseline", before) ?? sizeProblem("target", after);
            if (invalid !== null) {
                return invalid.kind === "not-finite"
                    ? gridFailure("not-finite", `The ${invalid.side} size of ${child.id} in branch ${branchId} is not finite`, {field: "size", side: invalid.side, id: child.id})
                    : gridFailure("invalid-argument", `The ${invalid.side} size of ${child.id} in branch ${branchId} is negative`, {
                        field: "size-negative",
                        side: invalid.side,
                        id: child.id,
                    });
            }
            baselineTotal += before!;
            targetTotal += after!;
        }
        if (Math.abs(targetTotal - baselineTotal) > EPSILON) {
            return gridFailure("not-conserved", `The gesture target of branch ${branchId} is not conserved: ${targetTotal} != ${baselineTotal}`, {
                id: branchId,
                target: targetTotal,
                baseline: baselineTotal,
            });
        }

        // 基线与本场手势的收起状态无关：先按**按下时**的树核对，再应用这一场的收起变化。
        const presented = allocateAxis(branch, axis, baselineTotal, sashSize, []);
        if (children.some((child, index) => Math.abs(presented[index]! - change.baseline[child.id]!) > EPSILON)) {
            return gridFailure("stale-baseline", `The gesture baseline of branch ${branchId} is stale`, {id: branchId});
        }
        const collapsed: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
        for (const [id, value] of Object.entries(change.collapsed ?? {})) {
            const child = children.find((item) => item.id === id);
            if (!child) {
                return gridFailure("not-found", `Branch ${branchId} has no child ${id} to collapse`, {id});
            }
            if (child.collapse === undefined) {
                return gridFailure("not-collapsible", `${id} in branch ${branchId} has no collapse policy`, {id, branch: branchId});
            }
            if (child.collapse.collapsed !== value) {
                // 锁住的只有宿主能翻（输出 168）：手势要翻它时整批不落账。没真要翻（标记已经是目标）的照常通过。
                if (child.collapse.locked === true) {
                    return gridFailure("collapse-locked", `${id} in branch ${branchId} is locked; only the host can collapse or expand it`, {id, branch: branchId});
                }
                child.collapse = {...child.collapse, collapsed: value};
                collapsed[id] = value;
            }
        }

        const sizes: Record<string, number> = Object.create(null) as Record<string, number>;
        const keepIntents = (): {ok: true; sizes: Record<string, number>; collapsed: Record<string, boolean>} => {
            children.forEach((child) => {
                sizes[child.id] = child.size[axis];
            });
            return {ok: true, sizes, collapsed};
        };
        // R1：显式收起与展开的目标就是翻标记后按意图分配出来的（`reflowSashCollapse`），这里用同一份分配复核，只翻标记、不改意图，
        // 窄窗口里被压缩的保留像素兄弟不会被写成压缩值。
        const intended = allocateAxis(branch, axis, targetTotal, sashSize, []);
        if (children.every((child, index) => Math.abs(intended[index]! - change.target[child.id]!) <= EPSILON)) {
            return keepIntents();
        }
        // 目标等于基线却不是 R1：本场翻了标记、又拖回按下时的样子。没有真实位移，意图照旧不动。
        if (children.every((child) => Math.abs(change.target[child.id]! - change.baseline[child.id]!) <= EPSILON)) {
            return keepIntents();
        }

        const bounds = children.map((child) => constraintsOf(child, axis, sashSize));
        const weighted = children.filter((child, index) => {
            const value = bounds[index]!;
            return child.sizing !== "fixed" && value.high - value.low > EPSILON;
        });
        const weightBaseline = weighted.reduce((sum, child) => sum + change.baseline[child.id]!, 0);
        const weightIntent = weighted.reduce((sum, child) => sum + child.size[axis], 0);
        // 触界节点的呈现不能反推出水位。只用未触界且有权重的节点确定单位，
        // 没有这样的节点时选原意图总量的单位，再保留仍与目标兼容的旧权重。
        const free = weighted.find((child) => child.size[axis] > 0
            && change.baseline[child.id]! > bounds[children.indexOf(child)]!.low + EPSILON
            && change.baseline[child.id]! < bounds[children.indexOf(child)]!.high - EPSILON);
        const intentPerPixel = free
            ? free.size[axis] / change.baseline[free.id]!
            : weightBaseline > EPSILON && weightIntent > EPSILON ? weightIntent / weightBaseline : 1;
        const assigned = children.map((child, index) => {
            const value = bounds[index]!;
            if (value.high - value.low <= EPSILON) {
                // 刚性（含收起）：呈现由范围决定，意图保持展开值——收起绝不能把 0 写进尺寸记录。
                return child.size[axis];
            }
            if (child.sizing === "fixed") {
                return clampAxis(change.target[child.id]!, value.low, value.high);
            }
            const oldProjection = clampAxis(child.size[axis] / intentPerPixel, value.low, value.high);
            return Math.abs(oldProjection - change.target[child.id]!) <= EPSILON ? child.size[axis] : change.target[child.id]! * intentPerPixel;
        });
        // R2：收起着的按比例分的孩子的份额是它的意图对展开着的那些的比。反解把展开着的那些换了单位（例如收起让出的空间被兄弟吸收），
        // 不缩回原来的和，它展开时就拿不回收起前的份额。只在展开着的按比例分的孩子之间同比例缩放，分配结果不变，下面的复核照样通过。
        if (children.some((child) => child.sizing !== "fixed" && child.collapse?.collapsed === true)) {
            const before = weighted.reduce((sum, child) => sum + child.size[axis], 0);
            const after = weighted.reduce((sum, child) => sum + assigned[children.indexOf(child)]!, 0);
            if (before > EPSILON && after > EPSILON) {
                const factor = before / after;
                for (const child of weighted) {
                    const index = children.indexOf(child);
                    assigned[index] = assigned[index]! * factor;
                }
            }
        }
        const candidate: GridBranch<T> = {
            ...branch,
            children: children.map((child, index) => ({...child, size: {...child.size, [axis]: assigned[index]!}})),
        };
        const checked = allocateAxis(candidate, axis, targetTotal, sashSize, []);
        if (assigned.some((size) => !Number.isFinite(size))
            || children.some((child, index) => Math.abs(checked[index]! - change.target[child.id]!) > EPSILON)) {
            return gridFailure("not-finite", `The gesture target of branch ${branchId} cannot be turned into finite size intents`, {field: "intent", id: branchId});
        }
        children.forEach((child, index) => {
            sizes[child.id] = assigned[index]!;
        });
        return {ok: true, sizes, collapsed};
    }

    /**
     * 一次手势的批量原子入口：在同一棵候选树上按加入顺序逐项规划，全部通过后候选树整棵换成活树。
     * 任一分支的收起状态在本场改变时，先应用到候选分支再规划（收起改变几何，也改变可分配范围）。
     * 换树之后旧的节点引用失效（`moveLeaf` 同样换树）；宿主靠 `revision` 重读 `root()`，不跨提交持有节点。
     */
    function resizeBranches(changes: readonly GridBranchResize[]): GridBranchesResizeResult {
        if (changes.length === 0) {
            return {ok: true, intents: {}, collapsed: {}};
        }
        const candidate = tree ? cloneNode(tree) : null;
        const plans: {axis: GridAxis; sizes: Record<string, number>}[] = [];
        const collapsed: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
        for (const change of changes) {
            const hit = find(change.branchId, candidate);
            if (!hit) {
                return gridFailure("not-found", `Unknown branch id: ${change.branchId}`, {id: change.branchId});
            }
            if (hit.node.kind !== "branch") {
                return gridFailure("wrong-node-kind", `${change.branchId} is not a branch`, {id: change.branchId, expected: "branch"});
            }
            const branch = hit.node;
            const planned = planBranchResize(branch, change);
            if (!planned.ok) {
                return planned;
            }
            branch.children.forEach((child) => {
                const value = planned.sizes[child.id];
                if (value !== undefined) {
                    child.size[change.axis] = value;
                }
            });
            Object.assign(collapsed, planned.collapsed);
            plans.push({axis: change.axis, sizes: planned.sizes});
        }
        const intents: Record<string, GridExtent> = Object.create(null) as Record<string, GridExtent>;
        for (const plan of plans) {
            for (const [id, value] of Object.entries(plan.sizes)) {
                const base = intents[id] ?? find(id, candidate)?.node.size ?? ZERO_EXTENT;
                intents[id] = {...base, [plan.axis]: value};
            }
        }
        // 全部计划都在候选树上通过之后才换树（失败路径不会留下半批修改）。
        tree = candidate;
        return {ok: true, intents, collapsed};
    }

    function setCollapsed(id: string, collapsed: boolean, options: GridCollapseOptions = {}): GridCollapseResult {
        const hit = find(id);
        if (!hit) {
            return gridFailure("not-found", `Unknown node id: ${id}`, {id});
        }
        if (!hit.parent) {
            return gridFailure("invalid-argument", `The root has no parent branch to collapse in: ${id}`, {field: "root", id});
        }
        const node = hit.node;
        if (node.collapse === undefined) {
            return gridFailure("not-collapsible", `${id} in branch ${hit.parent.id} has no collapse policy`, {id, branch: hit.parent.id});
        }
        const locked = options.locked ?? node.collapse.locked === true;
        if (node.collapse.collapsed === collapsed && (node.collapse.locked === true) === locked) {
            return {ok: true, changed: false, collapse: {...node.collapse}};
        }
        // 只翻标记、不动意图：下一次布局按分配规则重排（输出 147），按比例分的兄弟吸收，保留像素的不变，总量自然守恒；展开回到意图（输出 166）。
        // 锁只存 `locked: true`，解锁时去掉这个键，和 `normCollapse` 归一的形状一致。
        const next: SashCollapseState = {...node.collapse, collapsed};
        if (locked) {
            next.locked = true;
        } else {
            delete next.locked;
        }
        node.collapse = next;
        return {ok: true, changed: true, collapse: {...node.collapse}};
    }

    function setSize(id: string, px: number): GridSetSizeResult {
        const hit = find(id);
        if (!hit) {
            return gridFailure("not-found", `Unknown node id: ${id}`, {id});
        }
        if (!hit.parent) {
            return gridFailure("invalid-argument", `The root has no parent branch to size along: ${id}`, {field: "root", id});
        }
        const node = hit.node;
        if (node.sizing !== "fixed") {
            return gridFailure("wrong-sizing", `${id} is not fixed-size; its size is a share among its siblings`, {id, expected: "fixed"});
        }
        if (!Number.isFinite(px)) {
            return gridFailure("not-finite", `The size is not finite: ${String(px)}`, {field: "px", id});
        }
        if (px < 0) {
            return gridFailure("invalid-argument", `The size must not be negative: ${String(px)}`, {field: "px-negative", id});
        }
        const axis = axisOf(hit.parent.orientation);
        // 夹进它自己的范围，同 `resizeBranches` 写保留像素的意图；按展开时的声明范围夹：收起时的刚性范围会把它夹成 `collapsedSize`，
        // 标了刚性的范围就是它现在的意图，夹进去就改不了厚度。
        const bounds = constraintOnAxis(node, axis, sashSize);
        const size = clampAxis(px, bounds.low, bounds.high);
        const changed = node.size[axis] !== size;
        if (changed) {
            node.size[axis] = size;
        }
        return {ok: true, changed, size, ...(node.collapse === undefined ? {} : {collapse: {...node.collapse}})};
    }

    return {
        root() {
            return tree;
        },

        find: findNode,

        addLeaf(parentId, index, leaf) {
            const parent = find(parentId);
            if (!parent) {
                return gridFailure("not-found", `Unknown parent id: ${parentId}`, {id: parentId});
            }
            if (parent.node.kind !== "branch") {
                return gridFailure("wrong-node-kind", `The parent ${parentId} is not a branch`, {id: parentId, expected: "branch"});
            }
            if (find(leaf.id)) {
                return gridFailure("duplicate-id", `Node id already exists: ${leaf.id}`, {id: leaf.id, with: "existing"});
            }
            const guard = scaleIssue(countNodes(tree) + 1, (depthOf(parentId) ?? 1) + 1);
            if (guard) {
                return guard;
            }
            const branch = parent.node;
            const main = axisOf(branch.orientation);
            const inserted = instantiate(leaf);
            if (inserted.sizing !== "fixed" && !(inserted.size[main] > 0)) {
                inserted.size[main] = meanWeightShare(branch, main);
            }
            const at = Math.min(Math.max(0, index), branch.children.length);
            // 兄弟的意图不动（Spec 输出 153）：保留像素的照旧呈现，按比例分的份额在布局时重分。
            branch.children.splice(at, 0, inserted);
            return {ok: true};
        },

        splitLeaf(targetId, split) {
            const hit = find(targetId);
            if (!hit) {
                return gridFailure("not-found", `Unknown node id: ${targetId}`, {id: targetId});
            }
            if (hit.node.kind !== "leaf") {
                return gridFailure("wrong-node-kind", `Only leaves can be split: ${targetId}`, {id: targetId, expected: "leaf"});
            }
            // 保留像素的意图是像素，新叶与目标都分不到有意义的份额（Spec 输出 162）。
            if (hit.node.sizing === "fixed") {
                return gridFailure("wrong-sizing", `${targetId} is fixed-size; only a leaf whose size is a share can be split`, {id: targetId, expected: "weight"});
            }
            if (split.orientation !== "horizontal" && split.orientation !== "vertical") {
                return gridFailure("invalid-argument", `Unknown branch orientation: ${String(split.orientation)}`, {field: "orientation", value: String(split.orientation)});
            }
            if (split.side !== "before" && split.side !== "after") {
                return gridFailure("invalid-argument", `Unknown insertion side: ${String(split.side)}`, {field: "side", value: String(split.side)});
            }
            if (split.branchId === split.leaf.id) {
                return gridFailure("duplicate-id", `The new branch and the new leaf cannot share an id: ${split.branchId}`, {id: split.branchId, with: "new-leaf"});
            }
            for (const id of [split.branchId, split.leaf.id]) {
                if (find(id)) {
                    return gridFailure("duplicate-id", `Node id already exists: ${id}`, {id, with: "existing"});
                }
            }
            const ratio = split.ratio ?? 0.5;
            // 运行期可能收到别的字符串：不是 "even" 的一律按数校验，字符串在这里报 not-finite。
            if (ratio !== "even" && !Number.isFinite(ratio)) {
                return gridFailure("not-finite", `The split ratio is neither a finite number nor "even": ${String(ratio)}`, {field: "ratio", value: String(ratio)});
            }
            if (ratio !== "even" && (ratio <= 0 || ratio >= 1)) {
                return gridFailure("invalid-argument", `The split ratio must be strictly between 0 and 1: ${String(ratio)}`, {field: "ratio-range", value: String(ratio)});
            }
            const leaf = hit.node;
            const parent = hit.parent;
            // 同向并入（Spec 输出 160）：只加一个节点、深度不变；否则新建分支，加两个节点、目标下沉一层。
            const merging = parent !== null && parent.orientation === split.orientation;
            const targetDepth = depthOf(targetId) ?? 1;
            const guard = merging
                ? scaleIssue(countNodes(tree) + 1, targetDepth)
                : scaleIssue(countNodes(tree) + 2, targetDepth + 1);
            if (guard) {
                return guard;
            }

            const main = axisOf(split.orientation);
            const at = parent ? parent.children.findIndex((child) => child.id === targetId) : -1;
            if (merging) {
                // 兄弟的意图都不动（输出 153）。"even" 时新叶取这一支的平均一份（插入之前算，含目标），目标不让；
                // 是数时按 ratio 分掉目标的意图，目标为 0（此刻呈现为 0）时以平均一份作底数。这一支全是 0 时底数也是 0，
                // 两块与兄弟一起均分，ratio 不生效：不能沿用新建分支的“为 0 取 1”，那样兄弟会被压成 0。
                const created = instantiate({...split.leaf, size: extentOf(main, 0, 0)});
                let kept: GridLeaf<T> = leaf;
                if (ratio === "even") {
                    created.size[main] = meanWeightShare(parent, main);
                } else {
                    const base = leaf.size[main] > 0 ? leaf.size[main] : meanWeightShare(parent, main);
                    kept = {...leaf, size: {...leaf.size, [main]: base * (1 - ratio)}};
                    created.size[main] = base * ratio;
                }
                parent.children.splice(at, 1, ...(split.side === "before" ? [created, kept] : [kept, created]));
                return {ok: true};
            }

            const share = ratio === "even" ? 0.5 : ratio;
            // 目标在新轴没有分配时用 1 作统一单位：两端拿到同一量级的正权重，均分不塌成 0。
            const unit = leaf.size[main] > 0 ? leaf.size[main] : 1;
            const kept: GridLeaf<T> = {...leaf, size: {...leaf.size, [main]: unit * (1 - share)}};
            const created = instantiate({...split.leaf, size: extentOf(main, unit * share, 0)});
            const branch: GridBranch<T> = {
                kind: "branch",
                id: split.branchId,
                orientation: split.orientation,
                // 外部分配整份继承：沿原父分支主轴的分量不变，兄弟空间守恒不必再动。
                size: {...leaf.size},
                minimumSize: {...ZERO_EXTENT},
                maximumSize: {...UNBOUNDED_EXTENT},
                sizing: "weight",
                children: split.side === "before" ? [created, kept] : [kept, created],
            };
            if (!parent) {
                tree = branch;
            } else {
                parent.children.splice(at, 1, branch);
            }
            return {ok: true};
        },

        removeLeaf(id) {
            const hit = find(id);
            if (!hit) {
                return gridFailure("not-found", `Unknown node id: ${id}`, {id});
            }
            if (hit.node.kind !== "leaf") {
                return gridFailure("wrong-node-kind", `Only leaves can be removed: ${id}`, {id, expected: "leaf"});
            }
            if (!hit.parent) {
                tree = null;
                return {ok: true};
            }
            const parent = hit.parent;
            // 兄弟的意图不动（Spec 输出 153）；只剩一个孩子时照旧展平（已知限制见 grid.md），根的例外见 `collapse`。
            parent.children = parent.children.filter((child) => child.id !== id);
            if (parent.children.length === 0) {
                collapse(parent, null);
            } else if (parent.children.length === 1) {
                collapse(parent, parent.children[0]!);
            }
            return {ok: true};
        },

        moveLeaf(id, parentId, index) {
            const hit = find(id);
            if (!hit) {
                return gridFailure("not-found", `Unknown node id: ${id}`, {id});
            }
            if (hit.node.kind !== "leaf") {
                return gridFailure("wrong-node-kind", `Only leaves can be moved: ${id}`, {id, expected: "leaf"});
            }
            if (id === parentId) {
                return gridFailure("into-own-subtree", `Cannot move a node into itself: ${id} -> ${parentId}`, {id, parent: parentId});
            }
            const target = find(parentId);
            if (!target) {
                return gridFailure("not-found", `Unknown parent id: ${parentId}`, {id: parentId});
            }
            if (target.node.kind !== "branch") {
                return gridFailure("wrong-node-kind", `The parent ${parentId} is not a branch`, {id: parentId, expected: "branch"});
            }

            // 同一分支内只改顺序，不能走移除/塌陷路径；目标身份和树必须在失败前保持不变。
            if (hit.parent === target.node) {
                const from = target.node.children.findIndex((child) => child.id === id);
                const requested = Math.min(Math.max(0, index), target.node.children.length);
                const to = Math.min(requested > from ? requested - 1 : requested, target.node.children.length - 1);
                if (from === to) {
                    return {ok: true};
                }
                target.node.children.splice(from, 1);
                target.node.children.splice(to, 0, hit.node);
                return {ok: true};
            }
            // 保留像素的意图只对父分支主轴有意义，交叉轴照约定是 0：换方向后宽度没有来处。不悄悄改成按比例分，那样来回移动回不去。
            if (hit.node.sizing === "fixed" && hit.parent && axisOf(hit.parent.orientation) !== axisOf(target.node.orientation)) {
                return gridFailure("invalid-argument", `A fixed-size node cannot move into a branch of the other orientation: ${id} -> ${parentId}`, {
                    field: "fixed-cross-axis",
                    id,
                });
            }

            // 节点数不变，深度按移进目标之后的叶算，公式同 addLeaf；按移动前的树判，来源塌陷后其实变浅的移动也会被拒（已知的保守，见 grid.md）。
            const guard = scaleIssue(countNodes(tree), (depthOf(parentId) ?? 1) + 1);
            if (guard) {
                return guard;
            }

            // 到这里已经没有失败路径，直接在活树上改，不需要回滚。
            // 塌陷的只有来源分支，目标分支不会因此消失，被提上去的兄弟也还是原对象，所以 `target.node` 在塌陷之后仍有效。
            // 来源是叶且目标是另一个分支，所以来源一定有父分支：只有一片根叶的树里没有分支，前面已经按 not-found 返回。
            const source = hit.parent!;
            const leaf = hit.node as GridLeaf<T>;
            const destination = target.node;
            // 来源与目标的兄弟意图都不动（Spec 输出 153）。
            source.children = source.children.filter((child) => child.id !== id);
            if (source.children.length === 0) {
                collapse(source, null);
            } else if (source.children.length === 1) {
                collapse(source, source.children[0]!);
            }
            if (leaf.sizing !== "fixed") {
                // 按比例分的意图是来源分支里的相对份额，到了别的分支没有意义：按新叶重取目标分支的平均。
                const main = axisOf(destination.orientation);
                leaf.size = {...leaf.size, [main]: meanWeightShare(destination, main)};
            }
            const at = Math.min(Math.max(0, index), destination.children.length);
            destination.children.splice(at, 0, leaf);
            return {ok: true};
        },

        resizeBranches,
        setCollapsed,
        setSize,

        serialize() {
            return serializeTree(tree, encodeRef);
        },

        restore(snapshot, resolveRef: GridRefResolver<T>) {
            const parsed = parseSnapshot(snapshot, resolveRef, tree);
            if (!parsed.result.ok || !parsed.tree) {
                return parsed.result;
            }
            // 校验全部通过后一次发布：失败路径不会留下半棵树。
            tree = parsed.tree;
            return parsed.result;
        },

        layout(container) {
            return layoutOf(tree, container, sashSize);
        },

        clone() {
            return buildGrid(tree ? copyTree(tree) : null, options);
        },
    };
}
