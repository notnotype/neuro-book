/**
 * 可序列化拆分树（SerializableGrid 的领域无关原语）。
 *
 * 职责边界（见 `docs/proposals/workbench-view-host.md`「基础原语」一节）：
 * - 拥有：树操作（增删/移叶/换父）、两轴尺寸约束传播与夹取、序列化与恢复、**呈现**尺寸计算；
 * - 不拥有：拖拽手势与 sash 的产生（由 nb-ui `Splitter` 提供 handle 与手势事件）、持久化键、组件实例。
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
    GridBranchResizeResult,
    GridExtent,
    GridLayoutResult,
    GridLeaf,
    GridLeafInput,
    GridNode,
    GridNodeInput,
    GridOptions,
    GridRefEncoder,
    GridRefResolver,
    GridResizeResult,
    GridRestoreResult,
    GridResult,
    GridSizing,
    GridSnapshot,
    GridSplitInput,
} from "./grid-types";
import {GRID_MAX_DEPTH, GRID_MAX_NODES} from "./grid-types";
import {EPSILON, UNBOUNDED_EXTENT, ZERO_EXTENT, allocateAxis, axisOf, clampAxis, constraintsOf, extentOf, finite, layoutOf, normCollapse, normExtent, shareAxis, type GridSashResolver} from "./grid-geometry";
import {parseSnapshot, serializeTree} from "./grid-snapshot";

export * from "./grid-types";
/** 分支主轴与交叉轴的取轴规则只此一处；宿主按父分支方向取轴时用它，别自己写 if。 */
export {axisOf} from "./grid-geometry";

export type Grid<T> = {
    /** 当前布局树；结构变化后重新取。节点 `size` 是意图，不是呈现尺寸。 */
    root(): GridNode<T> | null;
    /** 只读查找：宿主读节点身份与意图用；改动仍走结构操作，直接改写节点会绕过守恒与规模判定。 */
    find(id: string): GridNode<T> | null;
    addLeaf(parentId: string, index: number, leaf: GridLeafInput<T>): GridResult;
    /**
     * 把一个叶原位拆成新分支：新分支继承目标叶的外部分配意图，目标叶与新叶按 `ratio` 分掉目标
     * 在新轴上的意图（新轴意图为 0 时两端取同一正权重，避免均分塌成 0）。失败不改树。
     */
    splitLeaf(targetId: string, split: GridSplitInput<T>): GridResult;
    removeLeaf(id: string): GridResult;
    moveLeaf(id: string, parentId: string, index: number): GridResult;
    /** 单节点增量入口；新消费者应优先使用 `resizeBranches` 提交完整手势目标。 */
    resize(id: string, axis: GridAxis, delta: number): GridResizeResult;
    /**
     * 单个分支的原子入口（单轴）：`baseline` 与 `target` 是同一当前容器中该分支全部直接子节点的呈现 px；
     * 基线必须符合当前树的呈现；目标必须守恒且符合当前约束。按未触界节点的比例反解意图，
     * 保留仍能呈现目标的兄弟意图；失败不改变树，no-op 不改快照。
     */
    resizeBranch(branchId: string, axis: GridAxis, baseline: Readonly<Record<string, number>>, target: Readonly<Record<string, number>>): GridBranchResizeResult;
    /**
     * 一次手势的批量原子入口（可含交汇处的多根轴）：全部变化在同一候选树上规划，
     * 任何一项不通过就整批不落账；通过后一次写回尺寸意图与收起状态。
     */
    resizeBranches(changes: readonly GridBranchResize[]): GridBranchesResizeResult;
    serialize(): GridSnapshot;
    restore(snapshot: unknown, resolveRef: GridRefResolver<T>): GridRestoreResult;
    /** 当前位置下的呈现尺寸；不改变意图，可由宿主在视口变化时反复调用。 */
    layout(container: GridExtent): GridLayoutResult;
};

export function createGrid<T extends string>(root: GridNodeInput<T> | null, options?: GridOptions<T>): Grid<T>;
export function createGrid<T>(root: GridNodeInput<T> | null, options: GridOptions<T> & {encodeRef: GridRefEncoder<T>}): Grid<T>;
export function createGrid<T>(root: GridNodeInput<T> | null, options: GridOptions<T> = {}): Grid<T> {
    const sashSize: number | GridSashResolver = typeof options.sashSize === "function"
        ? options.sashSize
        : Math.max(0, finite(options.sashSize ?? 0, 0));
    const encodeRef = options.encodeRef;
    let tree: GridNode<T> | null = root ? instantiate(root) : null;

    function instantiate(node: GridNodeInput<T>): GridNode<T> {
        const size = normExtent(node.size, ZERO_EXTENT);
        const minimumSize = normExtent(node.minimumSize, ZERO_EXTENT);
        const maximumSize = normExtent(node.maximumSize, UNBOUNDED_EXTENT);
        const sizing: GridSizing = node.sizing === "fixed" ? "fixed" : "weight";
        const collapse = normCollapse(node.collapse);
        if (node.kind === "leaf") {
            return {kind: "leaf", id: node.id, ref: node.ref, size, minimumSize, maximumSize, sizing, ...(collapse === undefined ? {} : {collapse})};
        }
        return {
            kind: "branch",
            id: node.id,
            orientation: node.orientation,
            size,
            minimumSize,
            maximumSize,
            sizing,
            ...(collapse === undefined ? {} : {collapse}),
            children: node.children.map(instantiate),
        };
    }

    function cloneNode(node: GridNode<T>): GridNode<T> {
        return node.kind === "leaf"
            ? {...node, size: {...node.size}, minimumSize: {...node.minimumSize}, maximumSize: {...node.maximumSize}}
            : {...node, size: {...node.size}, minimumSize: {...node.minimumSize}, maximumSize: {...node.maximumSize}, children: node.children.map(cloneNode)};
    }

    function find(id: string, node: GridNode<T> | null = tree, parent: GridBranch<T> | null = null): {node: GridNode<T>; parent: GridBranch<T> | null} | null {
        if (!node) {
            return null;
        }
        if (node.id === id) {
            return {node, parent};
        }
        if (node.kind === "branch") {
            for (const child of node.children) {
                const hit = find(id, child, node);
                if (hit) {
                    return hit;
                }
            }
        }
        return null;
    }


    /** 直接改变主动节点沿 axis 的意图，返回实际生效的增量（自身触界时小于请求值）。 */
    function shiftNode(node: GridNode<T>, axis: GridAxis, delta: number): number {
        const before = node.size[axis];
        const bounds = constraintsOf(node, axis, sashSize);
        node.size[axis] = clampAxis(before + delta, bounds.low, bounds.high);
        return node.size[axis] - before;
    }

    /** 同分支兄弟沿 axis 共同让出/吸收 `target`，返回实际生效的总增量（触界时小于请求值）。 */
    function shiftSiblings(parent: GridBranch<T>, sourceId: string, axis: GridAxis, target: number): number {
        const siblings = parent.children.filter((child) => child.id !== sourceId);
        if (siblings.length === 0 || target === 0) {
            return 0;
        }
        const before = siblings.reduce((sum, node) => sum + node.size[axis], 0);
        const assigned = shareAxis(siblings, axis, Math.max(0, before + target), sashSize);
        siblings.forEach((child, index) => {
            child.size[axis] = assigned[index]!;
        });
        return siblings.reduce((sum, node) => sum + node.size[axis], 0) - before;
    }

    /** 空分支塌陷 / 单子节点塌陷：用幸存者顶替分支自身，并继承外部分配以保持父分支总量。 */
    function collapse(parent: GridBranch<T>, survivor: GridNode<T> | null): void {
        const holder = find(parent.id);
        if (!holder?.parent) {
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

    /** 结构操作的规模守卫：与快照恢复同一份上限，避免造出无法保存/恢复的树。 */
    function treeScale(node: GridNode<T> | null): {nodes: number; depth: number} {
        if (!node) {
            return {nodes: 0, depth: 0};
        }
        if (node.kind === "leaf") {
            return {nodes: 1, depth: 1};
        }
        let nodes = 1;
        let depth = 1;
        for (const child of node.children) {
            const childScale = treeScale(child);
            nodes += childScale.nodes;
            depth = Math.max(depth, childScale.depth + 1);
        }
        return {nodes, depth};
    }

    function scaleIssue(nodes: number, depth: number): GridResult | null {
        if (nodes > GRID_MAX_NODES) {
            return {ok: false, reason: `节点数超出上限：${nodes} > ${GRID_MAX_NODES}`};
        }
        if (depth > GRID_MAX_DEPTH) {
            return {ok: false, reason: `嵌套深度超出上限：${depth} > ${GRID_MAX_DEPTH}`};
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

    function resize(id: string, axis: GridAxis, delta: number): GridResizeResult {
        const hit = find(id);
        if (!hit) {
            return {ok: false, reason: `未知节点 id：${id}`};
        }
        if (!hit.parent) {
            return {ok: false, reason: `根节点没有可调整的父分支：${id}`};
        }
        if (axisOf(hit.parent.orientation) !== axis) {
            return {ok: false, reason: `只能沿父分支主轴调整：${id} 的父分支是 ${hit.parent.orientation}`};
        }
        if (!Number.isFinite(delta)) {
            return {ok: false, reason: `调整量不是有限数：${String(delta)}`};
        }
        if (delta === 0) {
            return {ok: true, applied: 0};
        }
        const before = hit.node.size[axis];
        const applied = shiftNode(hit.node, axis, delta);
        // 兄弟触界只能让出可用空间：把没能被吸收的部分退回主动节点，父分支总量守恒。
        const absorbed = shiftSiblings(hit.parent, id, axis, -applied);
        const residual = -applied - absorbed;
        if (Math.abs(residual) > EPSILON) {
            shiftNode(hit.node, axis, residual);
        }
        return {ok: true, applied: hit.node.size[axis] - before};
    }

    /**
     * 单个分支的原子调整计划：先核对基线与目标，再把目标反解成新的尺寸意图。
     *
     * `fixed` 子节点直接以目标 px 为新意图；`weight` 子节点沿用免费水位反解（自由节点定标，
     * 触界节点保留仍与目标兼容的旧权重）。计划不修改任何节点，调用方在全部通过后才落账。
     */
    function planBranchResize(
        branch: GridBranch<T>,
        change: GridBranchResize,
    ): {ok: true; sizes: Record<string, number>; collapsed: Record<string, boolean>} | {ok: false; reason: string} {
        const branchId = branch.id;
        const axis = change.axis;
        if (axisOf(branch.orientation) !== axis) {
            return {ok: false, reason: `只能沿分支主轴调整：${branchId} 是 ${branch.orientation}`};
        }
        const children = branch.children;
        const childIds = new Set(children.map((child) => child.id));
        const baselineIds = Object.keys(change.baseline);
        const targetIds = Object.keys(change.target);
        if (baselineIds.length !== childIds.size || targetIds.length !== childIds.size
            || baselineIds.some((id) => !childIds.has(id)) || targetIds.some((id) => !childIds.has(id))) {
            return {ok: false, reason: `分支 ${branchId} 的手势尺寸必须覆盖全部直接子节点`};
        }
        let baselineTotal = 0;
        let targetTotal = 0;
        for (const child of children) {
            const before = change.baseline[child.id];
            const after = change.target[child.id];
            if (!Number.isFinite(before) || !Number.isFinite(after) || before! < 0 || after! < 0) {
                return {ok: false, reason: `分支 ${branchId} 的手势尺寸必须是有限非负数：${child.id}`};
            }
            baselineTotal += before!;
            targetTotal += after!;
        }
        if (Math.abs(targetTotal - baselineTotal) > EPSILON) {
            return {ok: false, reason: `分支 ${branchId} 的手势目标不守恒：${targetTotal} != ${baselineTotal}`};
        }

        // 基线与本场手势的收起状态无关：先按**按下时**的树核对，再应用这一场的收起变化。
        const presented = allocateAxis(branch, axis, baselineTotal, sashSize, []);
        if (children.some((child, index) => Math.abs(presented[index]! - change.baseline[child.id]!) > EPSILON)) {
            return {ok: false, reason: `分支 ${branchId} 的手势基线已失效`};
        }
        const collapsed: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
        for (const [id, value] of Object.entries(change.collapsed ?? {})) {
            const child = children.find((item) => item.id === id);
            if (!child || child.collapse === undefined) {
                return {ok: false, reason: `分支 ${branchId} 的面板不可收起或不存在：${id}`};
            }
            if (child.collapse.collapsed !== value) {
                child.collapse = {...child.collapse, collapsed: value};
                collapsed[id] = value;
            }
        }

        const sizes: Record<string, number> = Object.create(null) as Record<string, number>;
        if (children.every((child) => Math.abs(change.target[child.id]! - change.baseline[child.id]!) <= EPSILON)) {
            children.forEach((child) => {
                sizes[child.id] = child.size[axis];
            });
            return {ok: true, sizes, collapsed};
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
        const candidate: GridBranch<T> = {
            ...branch,
            children: children.map((child, index) => ({...child, size: {...child.size, [axis]: assigned[index]!}})),
        };
        const checked = allocateAxis(candidate, axis, targetTotal, sashSize, []);
        if (assigned.some((size) => !Number.isFinite(size))
            || children.some((child, index) => Math.abs(checked[index]! - change.target[child.id]!) > EPSILON)) {
            return {ok: false, reason: `分支 ${branchId} 的手势目标无法转换为有限尺寸意图`};
        }
        children.forEach((child, index) => {
            sizes[child.id] = assigned[index]!;
        });
        return {ok: true, sizes, collapsed};
    }

    /** 把一批计划写回活树（只在全部计划通过后调用）。 */
    function applyBranchResize(branchId: string, axis: GridAxis, sizes: Record<string, number>): void {
        const hit = find(branchId);
        if (!hit || hit.node.kind !== "branch") {
            return;
        }
        for (const child of hit.node.children) {
            const value = sizes[child.id];
            if (value !== undefined) {
                child.size[axis] = value;
            }
        }
    }

    /**
     * 一次手势的批量原子入口：在同一棵候选树上按加入顺序逐项规划，全部通过后一次写回。
     * 任一分支的收起状态在本场改变时，先应用到候选分支再规划（收起改变几何，也改变可分配范围）。
     */
    function resizeBranches(changes: readonly GridBranchResize[]): GridBranchesResizeResult {
        if (changes.length === 0) {
            return {ok: true, intents: {}, collapsed: {}};
        }
        const candidate = tree ? cloneNode(tree) : null;
        const candidateFind = (id: string, node: GridNode<T> | null = candidate, parent: GridBranch<T> | null = null): {node: GridNode<T>; parent: GridBranch<T> | null} | null => {
            if (!node) {
                return null;
            }
            if (node.id === id) {
                return {node, parent};
            }
            if (node.kind === "branch") {
                for (const child of node.children) {
                    const hit = candidateFind(id, child, node);
                    if (hit) {
                        return hit;
                    }
                }
            }
            return null;
        };
        const plans: {branchId: string; axis: GridAxis; sizes: Record<string, number>}[] = [];
        const collapseChanges: {branchId: string; id: string; value: boolean}[] = [];
        for (const change of changes) {
            const hit = candidateFind(change.branchId);
            if (!hit || hit.node.kind !== "branch") {
                return {ok: false, reason: `未知分支 id：${change.branchId}`};
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
            for (const [id, value] of Object.entries(planned.collapsed)) {
                collapseChanges.push({branchId: branch.id, id, value});
            }
            plans.push({branchId: branch.id, axis: change.axis, sizes: planned.sizes});
        }
        const intents: Record<string, GridExtent> = Object.create(null) as Record<string, GridExtent>;
        for (const plan of plans) {
            for (const [id, value] of Object.entries(plan.sizes)) {
                const base = intents[id] ?? candidateFind(id)?.node.size ?? ZERO_EXTENT;
                intents[id] = {...base, [plan.axis]: value};
            }
        }
        // 全部计划先在候选树上通过，然后一次写回活树（失败路径不会留下半批修改）。
        for (const plan of plans) {
            applyBranchResize(plan.branchId, plan.axis, plan.sizes);
        }
        const collapsed: Record<string, boolean> = Object.create(null) as Record<string, boolean>;
        for (const entry of collapseChanges) {
            const holder = find(entry.branchId);
            if (holder?.node.kind === "branch") {
                const target = holder.node.children.find((item) => item.id === entry.id);
                if (target?.collapse) {
                    target.collapse = {...target.collapse, collapsed: entry.value};
                }
            }
            collapsed[entry.id] = entry.value;
        }
        return {ok: true, intents, collapsed};
    }

    function resizeBranch(
        branchId: string,
        axis: GridAxis,
        baseline: Readonly<Record<string, number>>,
        target: Readonly<Record<string, number>>,
    ): GridBranchResizeResult {
        const hit = find(branchId);
        if (!hit || hit.node.kind !== "branch") {
            return {ok: false, reason: `未知分支 id：${branchId}`};
        }
        const planned = planBranchResize(hit.node, {branchId, axis, baseline, target});
        if (!planned.ok) {
            return planned;
        }
        applyBranchResize(branchId, axis, planned.sizes);
        return {ok: true, sizes: planned.sizes};
    }

    return {
        root() {
            return tree;
        },

        find: findNode,

        addLeaf(parentId, index, leaf) {
            const parent = find(parentId);
            if (!parent) {
                return {ok: false, reason: `未知父节点 id：${parentId}`};
            }
            if (parent.node.kind !== "branch") {
                return {ok: false, reason: `父节点不是分支：${parentId}`};
            }
            if (find(leaf.id)) {
                return {ok: false, reason: `节点 id 已存在：${leaf.id}`};
            }
            const scale = treeScale(tree);
            const guard = scaleIssue(scale.nodes + 1, Math.max(scale.depth, (depthOf(parentId) ?? 1) + 1));
            if (guard) {
                return guard;
            }
            const branch = parent.node;
            const main = axisOf(branch.orientation);
            const inserted = instantiate(leaf);
            const at = Math.min(Math.max(0, index), branch.children.length);
            branch.children.splice(at, 0, inserted);
            shiftSiblings(branch, leaf.id, main, -inserted.size[main]);
            return {ok: true};
        },

        splitLeaf(targetId, split) {
            const hit = find(targetId);
            if (!hit) {
                return {ok: false, reason: `未知节点 id：${targetId}`};
            }
            if (hit.node.kind !== "leaf") {
                return {ok: false, reason: `只支持拆分叶子节点：${targetId}`};
            }
            if (split.orientation !== "horizontal" && split.orientation !== "vertical") {
                return {ok: false, reason: `未知分支方向：${String(split.orientation)}`};
            }
            if (split.side !== "before" && split.side !== "after") {
                return {ok: false, reason: `未知插入侧：${String(split.side)}`};
            }
            if (split.branchId === split.leaf.id) {
                return {ok: false, reason: `新分支与新叶不能共用 id：${split.branchId}`};
            }
            for (const id of [split.branchId, split.leaf.id]) {
                if (find(id)) {
                    return {ok: false, reason: `节点 id 已存在：${id}`};
                }
            }
            const ratio = split.ratio ?? 0.5;
            if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
                return {ok: false, reason: `拆分比例必须有限且严格介于 0 与 1：${String(ratio)}`};
            }
            const scale = treeScale(tree);
            const guard = scaleIssue(scale.nodes + 2, Math.max(scale.depth, (depthOf(targetId) ?? 1) + 1));
            if (guard) {
                return guard;
            }

            const leaf = hit.node;
            const main = axisOf(split.orientation);
            // 目标在新轴没有分配时用 1 作统一单位：两端拿到同一量级的正权重，均分不塌成 0。
            const unit = leaf.size[main] > 0 ? leaf.size[main] : 1;
            const kept: GridLeaf<T> = {...leaf, size: {...leaf.size, [main]: unit * (1 - ratio)}};
            const created = instantiate({...split.leaf, size: extentOf(main, unit * ratio, 0)});
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
            if (!hit.parent) {
                tree = branch;
            } else {
                hit.parent.children.splice(hit.parent.children.findIndex((child) => child.id === targetId), 1, branch);
            }
            return {ok: true};
        },

        removeLeaf(id) {
            const hit = find(id);
            if (!hit) {
                return {ok: false, reason: `未知节点 id：${id}`};
            }
            if (hit.node.kind !== "leaf") {
                return {ok: false, reason: `只支持移除叶子节点：${id}`};
            }
            if (!hit.parent) {
                tree = null;
                return {ok: true};
            }
            const parent = hit.parent;
            const main = axisOf(parent.orientation);
            const removed = hit.node.size[main];
            parent.children = parent.children.filter((child) => child.id !== id);
            if (parent.children.length === 0) {
                collapse(parent, null);
            } else {
                shiftSiblings(parent, id, main, removed);
                if (parent.children.length === 1) {
                    collapse(parent, parent.children[0]!);
                }
            }
            return {ok: true};
        },

        moveLeaf(id, parentId, index) {
            const hit = find(id);
            if (!hit) {
                return {ok: false, reason: `未知节点 id：${id}`};
            }
            if (hit.node.kind !== "leaf") {
                return {ok: false, reason: `只支持移动叶子节点：${id}`};
            }
            if (id === parentId) {
                return {ok: false, reason: `不能移动到自身子树：${id} → ${parentId}`};
            }
            const target = find(parentId);
            if (!target) {
                return {ok: false, reason: `未知父节点 id：${parentId}`};
            }
            if (target.node.kind !== "branch") {
                return {ok: false, reason: `父节点不是分支：${parentId}`};
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

            const nextTree = tree ? cloneNode(tree) : null;
            const originalTree = tree;
            tree = nextTree;
            const stagedHit = find(id);
            const stagedTarget = find(parentId);
            if (!stagedHit?.parent || !stagedTarget || stagedTarget.node.kind !== "branch") {
                tree = originalTree;
                return {ok: false, reason: `目标父节点已不存在：${parentId}`};
            }
            const source = stagedHit.parent;
            const leaf = stagedHit.node as GridLeaf<T>;
            const sourceMain = axisOf(source.orientation);
            source.children = source.children.filter((child) => child.id !== id);
            shiftSiblings(source, id, sourceMain, leaf.size[sourceMain]);
            if (source.children.length === 0) {
                collapse(source, null);
            } else if (source.children.length === 1) {
                collapse(source, source.children[0]!);
            }
            const destination = find(parentId);
            if (!destination || destination.node.kind !== "branch") {
                tree = originalTree;
                return {ok: false, reason: `目标父节点已不存在：${parentId}`};
            }
            const main = axisOf(destination.node.orientation);
            const at = Math.min(Math.max(0, index), destination.node.children.length);
            destination.node.children.splice(at, 0, leaf);
            shiftSiblings(destination.node, leaf.id, main, -leaf.size[main]);
            return {ok: true};
        },

        resize,
        resizeBranch,
        resizeBranches,

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
    };
}
