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
    GridSnapshot,
} from "./grid-types";
import {EPSILON, UNBOUNDED_EXTENT, ZERO_EXTENT, allocateAxis, axisOf, clampAxis, constraintsOf, finite, layoutOf, normExtent, shareAxis, type GridSashResolver} from "./grid-geometry";
import {parseSnapshot, serializeTree} from "./grid-snapshot";

export * from "./grid-types";
/** 分支主轴与交叉轴的取轴规则只此一处；宿主按父分支方向取轴时用它，别自己写 if。 */
export {axisOf} from "./grid-geometry";

export type Grid<T> = {
    /** 当前布局树；结构变化后重新取。节点 `size` 是意图，不是呈现尺寸。 */
    root(): GridNode<T> | null;
    addLeaf(parentId: string, index: number, leaf: GridLeafInput<T>): GridResult;
    removeLeaf(id: string): GridResult;
    moveLeaf(id: string, parentId: string, index: number): GridResult;
    /** 单节点增量入口；新消费者应优先使用 `resizeBranch` 提交完整手势目标。 */
    resize(id: string, axis: GridAxis, delta: number): GridResizeResult;
    /**
     * 一次手势的原子入口。`baseline` 与 `target` 是同一当前容器中该分支全部直接子节点的呈现 px；
     * 基线必须符合当前树的呈现；目标必须守恒且符合当前约束。按未触界节点的比例反解意图，
     * 保留仍能呈现目标的兄弟意图；失败不改变树，no-op 不改快照。
     */
    resizeBranch(branchId: string, axis: GridAxis, baseline: Readonly<Record<string, number>>, target: Readonly<Record<string, number>>): GridBranchResizeResult;
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
        if (node.kind === "leaf") {
            return {kind: "leaf", id: node.id, ref: node.ref, size, minimumSize, maximumSize};
        }
        return {kind: "branch", id: node.id, orientation: node.orientation, size, minimumSize, maximumSize, children: node.children.map(instantiate)};
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
        const branch = hit.node;
        if (axisOf(branch.orientation) !== axis) {
            return {ok: false, reason: `只能沿分支主轴调整：${branchId} 是 ${branch.orientation}`};
        }
        const childIds = new Set(branch.children.map((child) => child.id));
        if (Object.keys(baseline).length !== childIds.size || Object.keys(target).length !== childIds.size
            || Object.keys(baseline).some((id) => !childIds.has(id)) || Object.keys(target).some((id) => !childIds.has(id))) {
            return {ok: false, reason: `分支 ${branchId} 的手势尺寸必须覆盖全部直接子节点`};
        }
        const beforeTotal = branch.children.reduce((sum, child) => sum + child.size[axis], 0);
        let baselineTotal = 0;
        let targetTotal = 0;
        for (const child of branch.children) {
            const before = baseline[child.id];
            const after = target[child.id];
            if (!Number.isFinite(before) || !Number.isFinite(after) || before! < 0 || after! < 0) {
                return {ok: false, reason: `分支 ${branchId} 的手势尺寸必须是有限非负数：${child.id}`};
            }
            baselineTotal += before!;
            targetTotal += after!;
        }
        if (Math.abs(targetTotal - baselineTotal) > EPSILON) {
            return {ok: false, reason: `分支 ${branchId} 的手势目标不守恒：${targetTotal} != ${baselineTotal}`};
        }

        const presented = allocateAxis(branch, axis, baselineTotal, sashSize, []);
        if (branch.children.some((child, index) => Math.abs(presented[index]! - baseline[child.id]!) > EPSILON)) {
            return {ok: false, reason: `分支 ${branchId} 的手势基线已失效`};
        }
        const sizes: Record<string, number> = Object.create(null) as Record<string, number>;
        if (branch.children.every((child) => Math.abs(target[child.id]! - baseline[child.id]!) <= EPSILON)) {
            branch.children.forEach((child) => { sizes[child.id] = child.size[axis]; });
            return {ok: true, sizes};
        }
        const bounds = branch.children.map((child) => constraintsOf(child, axis, sashSize));
        if (branch.children.some((child, index) => target[child.id]! < bounds[index]!.low - EPSILON || target[child.id]! > bounds[index]!.high + EPSILON)) {
            return {ok: false, reason: `分支 ${branchId} 的手势目标超出当前约束`};
        }

        // 触界节点的呈现不能反推出水位。只用未触界且有权重的节点确定单位，
        // 没有这样的节点时选原意图总量的单位，再保留仍与目标兼容的旧权重。
        const freeIndex = branch.children.findIndex((child, index) => child.size[axis] > 0
            && baseline[child.id]! > bounds[index]!.low + EPSILON && baseline[child.id]! < bounds[index]!.high - EPSILON);
        const free = branch.children[freeIndex];
        const intentPerPixel = free ? free.size[axis] / baseline[free.id]!
            : baselineTotal > EPSILON && beforeTotal > EPSILON ? beforeTotal / baselineTotal : 1;
        const assigned = branch.children.map((child, index) => {
            const oldProjection = clampAxis(child.size[axis] / intentPerPixel, bounds[index]!.low, bounds[index]!.high);
            return Math.abs(oldProjection - target[child.id]!) <= EPSILON ? child.size[axis] : target[child.id]! * intentPerPixel;
        });
        const candidate = {...branch, children: branch.children.map((child, index) => ({...child, size: {...child.size, [axis]: assigned[index]!}}))};
        const checked = allocateAxis(candidate, axis, targetTotal, sashSize, []);
        if (assigned.some((size) => !Number.isFinite(size))
            || branch.children.some((child, index) => Math.abs(checked[index]! - target[child.id]!) > EPSILON)) {
            return {ok: false, reason: `分支 ${branchId} 的手势目标无法转换为有限尺寸意图`};
        }
        branch.children.forEach((child, index) => {
            child.size[axis] = assigned[index]!;
            sizes[child.id] = assigned[index]!;
        });
        return {ok: true, sizes};
    }

    return {
        root() {
            return tree;
        },

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
            const branch = parent.node;
            const main = axisOf(branch.orientation);
            const inserted = instantiate(leaf);
            const at = Math.min(Math.max(0, index), branch.children.length);
            branch.children.splice(at, 0, inserted);
            shiftSiblings(branch, leaf.id, main, -inserted.size[main]);
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
