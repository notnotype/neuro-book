/**
 * 可序列化拆分树（SerializableGrid 的领域无关原语）。
 *
 * 职责边界（见 `docs/proposals/workbench-view-host.md`「基础原语」一节）：
 * - 拥有：树操作（增删/移叶/换父）、尺寸约束传播与夹取、序列化与恢复、逻辑尺寸计算；
 * - 不拥有：拖拽手势与 sash 的产生（由 nb-ui `Splitter` 提供 handle、由既有 resize 边界提交）、
 *   持久化键、组件实例。
 *
 * 因此本文件**不得**出现指针事件、`localStorage`、Vue 导入，也不得存放组件或 descriptor。
 */
export type GridOrientation = "horizontal" | "vertical";

export type GridLeaf<T> = {
    kind: "leaf";
    id: string;
    ref: T;
    minimumSize: number;
    maximumSize: number;
    size: number;
};

export type GridBranch<T> = {
    kind: "branch";
    id: string;
    orientation: GridOrientation;
    children: GridNode<T>[];
};

export type GridNode<T> = GridLeaf<T> | GridBranch<T>;

/** 快照把 ref 具体化为字符串：只存宿主认识的引用与尺寸，不存任何组件/描述符。 */
export type GridSnapshot = {version: typeof GRID_SNAPSHOT_VERSION; root: GridNode<string>};

export type GridResult = {ok: true} | {ok: false; reason: string};

export type GridRestoreResult = {
    ok: boolean;
    dropped: {ref: string; reason: string}[];
    clamped: string[];
    reason?: string;
};

export type GridLayoutResult = {sizes: Record<string, number>; issues: string[]};

export const GRID_SNAPSHOT_VERSION = 1;

/** 统一结果构造，避免调用方处理未捕获异常。 */
function fail(reason: string): GridResult {
    return {ok: false, reason};
}

function cloneNode<T>(node: GridNode<T>): GridNode<T> {
    return node.kind === "leaf"
        ? {...node}
        : {...node, children: node.children.map(cloneNode)};
}

function isBranch<T>(node: GridNode<T> | null | undefined): node is GridBranch<T> {
    return Boolean(node) && node!.kind === "branch";
}

/** 分支不持有自身尺寸：其尺寸按子节点求和（提案的 GridBranch 无 size 字段）。 */
function nodeSize<T>(node: GridNode<T>): number {
    return node.kind === "leaf" ? node.size : node.children.reduce((sum, child) => sum + nodeSize(child), 0);
}

function nodeMin<T>(node: GridNode<T>): number {
    return node.kind === "leaf" ? Math.max(0, node.minimumSize) : node.children.reduce((sum, child) => sum + nodeMin(child), 0);
}

function nodeMax<T>(node: GridNode<T>): number {
    return node.kind === "leaf"
        ? Math.max(Math.max(0, node.minimumSize), node.maximumSize)
        : node.children.reduce((sum, child) => sum + nodeMax(child), 0);
}

export type Grid<T> = {
    /** 只读快照，用于渲染与诊断；结构变化后调用方重新取。 */
    root(): GridNode<T> | null;
    addLeaf(parentId: string, index: number, leaf: GridLeaf<T>): GridResult;
    removeLeaf(id: string): GridResult;
    moveLeaf(id: string, parentId: string, index: number): GridResult;
    resize(id: string, delta: number): GridResult;
    serialize(): GridSnapshot;
    restore(snapshot: unknown, resolveRef: (ref: string) => T | null): GridRestoreResult;
    layout(): GridLayoutResult;
};

export function createGrid<T>(root: GridNode<T> | null): Grid<T> {
    let tree = root ? cloneNode(root) : null;

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

    function contains(branch: GridNode<T>, id: string): boolean {
        if (branch.id === id) {
            return true;
        }
        return branch.kind === "branch" && branch.children.some((child) => contains(child, id));
    }

    /** 夹取单个叶子的尺寸；返回是否发生过夹取。 */
    function clampLeaf(leaf: GridLeaf<T>): boolean {
        const low = Math.max(0, leaf.minimumSize);
        const high = Math.max(low, leaf.maximumSize);
        const next = Math.min(high, Math.max(low, leaf.size));
        if (next === leaf.size) {
            return false;
        }
        leaf.size = next;
        return true;
    }

    /** 自底向上夹取整棵树：叶子越界先夹，分支总和越界再按比例缩放。 */
    function clampTree(node: GridNode<T>) {
        const clamped: string[] = [];
        if (node.kind === "leaf") {
            if (clampLeaf(node)) {
                clamped.push(node.id);
            }
            return clamped;
        }
        for (const child of node.children) {
            clamped.push(...clampTree(child));
        }
        if (node.children.length > 0) {
            const total = node.children.reduce((sum, child) => sum + nodeSize(child), 0);
            const min = node.children.reduce((sum, child) => sum + nodeMin(child), 0);
            const max = node.children.reduce((sum, child) => sum + nodeMax(child), 0);
            const target = Math.min(Math.max(total, min), max);
            if (target !== total && total > 0) {
                const ratio = target / total;
                for (const child of node.children) {
                    if (child.kind === "leaf") {
                        child.size = child.size * ratio;
                    }
                }
                clamped.push(...node.children.map((child) => child.id));
            }
        }
        return clamped;
    }

    /** 兄弟按现有尺寸比例吸收 `delta`（正数=从兄弟拿来，负数=还给兄弟）；总和不变。 */
    function absorbFromSiblings(branch: GridBranch<T>, sourceId: string, delta: number) {
        const siblings = branch.children.filter((child) => child.id !== sourceId);
        const total = siblings.reduce((sum, child) => sum + nodeSize(child), 0);
        if (siblings.length === 0 || total <= 0) {
            return;
        }
        const targetTotal = total - delta;
        const ratio = targetTotal / total;
        for (const sibling of siblings) {
            if (sibling.kind !== "leaf") {
                continue;
            }
            const low = Math.max(0, sibling.minimumSize);
            const high = Math.max(low, sibling.maximumSize);
            sibling.size = Math.min(high, Math.max(low, sibling.size * ratio));
        }
    }

    function structure(id: string): GridResult {
        return find(id) ? {ok: true} : fail(`未知节点 id：${id}`);
    }

    return {
        root() {
            return tree;
        },

        addLeaf(parentId, index, leaf) {
            const parent = find(parentId);
            if (!parent) {
                return fail(`未知父节点 id：${parentId}`);
            }
            if (!isBranch(parent.node)) {
                return fail(`父节点不是分支：${parentId}`);
            }
            if (find(leaf.id)) {
                return fail(`节点 id 已存在：${leaf.id}`);
            }
            const at = Math.min(Math.max(0, index), parent.node.children.length);
            parent.node.children.splice(at, 0, cloneNode(leaf));
            absorbFromSiblings(parent.node, leaf.id, leaf.size);
            clampTree(tree!);
            return {ok: true};
        },

        removeLeaf(id) {
            const hit = find(id);
            if (!hit) {
                return fail(`未知节点 id：${id}`);
            }
            if (!hit.parent) {
                tree = null;
                return {ok: true};
            }
            if (hit.node.kind === "branch") {
                return fail(`只支持移除叶子节点：${id}`);
            }
            const parent = hit.parent;
            const removedSize = hit.node.size;
            parent.children = parent.children.filter((child) => child.id !== id);
            absorbFromSiblings(parent, id, -removedSize);
            // 空分支塌陷：分支只剩一个子节点时，用该子节点顶替分支自身
            if (parent.children.length === 0) {
                const grand = find(parent.id);
                if (grand?.parent) {
                    grand.parent.children = grand.parent.children.filter((child) => child.id !== parent.id);
                } else {
                    tree = null;
                }
            } else if (parent.children.length === 1) {
                const survivor = parent.children[0]!;
                const grand = find(parent.id);
                if (grand?.parent) {
                    const at = grand.parent.children.findIndex((child) => child.id === parent.id);
                    grand.parent.children.splice(at, 1, survivor);
                } else {
                    tree = survivor;
                }
            }
            if (tree) {
                clampTree(tree);
            }
            return {ok: true};
        },

        moveLeaf(id, parentId, index) {
            const hit = find(id);
            if (!hit) {
                return fail(`未知节点 id：${id}`);
            }
            if (hit.node.kind !== "leaf") {
                return fail(`只支持移动叶子节点：${id}`);
            }
            if (contains(hit.node, parentId) || id === parentId) {
                return fail(`不能移动到自身子树：${id} → ${parentId}`);
            }
            const target = find(parentId);
            if (!target) {
                return fail(`未知父节点 id：${parentId}`);
            }
            if (!isBranch(target.node)) {
                return fail(`父节点不是分支：${parentId}`);
            }
            const leaf: GridLeaf<T> = {...hit.node};
            const parent = hit.parent;
            if (parent) {
                parent.children = parent.children.filter((child) => child.id !== id);
                // 移出后同样要让兄弟吸收；移入时再按比例归还，总和守恒
                absorbFromSiblings(parent, id, -hit.node.size);
                if (parent.children.length === 1) {
                    const survivor = parent.children[0]!;
                    const grand = find(parent.id);
                    if (grand?.parent) {
                        const at = grand.parent.children.findIndex((child) => child.id === parent.id);
                        grand.parent.children.splice(at, 1, survivor);
                    } else {
                        tree = survivor;
                    }
                } else if (parent.children.length === 0) {
                    const grand = find(parent.id);
                    if (grand?.parent) {
                        grand.parent.children = grand.parent.children.filter((child) => child.id !== parent.id);
                    } else {
                        tree = null;
                    }
                }
            }
            const destination = find(parentId);
            if (!isBranch(destination?.node)) {
                return fail(`目标父节点已不存在：${parentId}`);
            }
            // 重挂后把叶子尺寸分摊给目标兄弟，保持目标分支总和不变
            absorbFromSiblings(destination.node, leaf.id, leaf.size);
            const at = Math.min(Math.max(0, index), destination.node.children.length);
            destination.node.children.splice(at, 0, leaf);
            if (tree) {
                clampTree(tree);
            }
            return {ok: true};
        },

        resize(id, delta) {
            const hit = find(id);
            if (!hit) {
                return fail(`未知节点 id：${id}`);
            }
            if (hit.node.kind !== "leaf") {
                return fail(`只支持调整叶子节点：${id}`);
            }
            const leaf = hit.node;
            const before = leaf.size;
            leaf.size = before + delta;
            const clampedLeaf = clampLeaf(leaf);
            const applied = leaf.size - before;
            if (hit.parent) {
                absorbFromSiblings(hit.parent, leaf.id, applied);
            }
            if (tree) {
                clampTree(tree);
            }
            return {ok: true};
        },

        serialize() {
            const toSnapshot = (node: GridNode<T>): GridNode<string> => node.kind === "leaf"
                ? {kind: "leaf", id: node.id, ref: String(node.ref), minimumSize: node.minimumSize, maximumSize: node.maximumSize, size: node.size}
                : {kind: "branch", id: node.id, orientation: node.orientation, children: node.children.map(toSnapshot)};
            return {
                version: GRID_SNAPSHOT_VERSION,
                root: (tree ? toSnapshot(tree) : {kind: "branch", id: "root", orientation: "horizontal", children: []}),
            };
        },

        restore(snapshot, resolveRef) {
            const dropped: {ref: string; reason: string}[] = [];
            if (!snapshot || typeof snapshot !== "object") {
                return {ok: false, dropped, clamped: [], reason: "快照不是对象"};
            }
            const raw = snapshot as {version?: unknown; root?: unknown};
            if (raw.version !== GRID_SNAPSHOT_VERSION) {
                return {ok: false, dropped, clamped: [], reason: `布局快照版本 ${String(raw.version)} 不受支持（当前 ${String(GRID_SNAPSHOT_VERSION)}）`};
            }
            const seen = new Set<string>();
            let duplicated = "";
            const convert = (node: unknown): GridNode<T> | null => {
                if (!node || typeof node !== "object") {
                    return null;
                }
                const candidate = node as GridNode<string>;
                if (candidate.kind === "leaf") {
                    if (typeof candidate.ref !== "string") {
                        dropped.push({ref: String(candidate.ref), reason: "ref 不是字符串"});
                        return null;
                    }
                    if (seen.has(candidate.ref)) {
                        duplicated = candidate.ref;
                        return null;
                    }
                    seen.add(candidate.ref);
                    const resolved = resolveRef(candidate.ref);
                    if (resolved === null) {
                        dropped.push({ref: candidate.ref, reason: "未知 ref"});
                        return null;
                    }
                    return {...candidate, ref: resolved};
                }
                if (candidate.kind === "branch") {
                    const children = (candidate.children ?? [])
                        .map(convert)
                        .filter((child): child is GridNode<T> => Boolean(child));
                    return {...candidate, children};
                }
                return null;
            };
            const converted = convert(raw.root);
            if (duplicated) {
                return {ok: false, dropped, clamped: [], reason: `快照中存在重复 ref：${duplicated}`};
            }
            tree = converted;
            const clamped: string[] = tree ? clampTree(tree) : [];
            return {ok: true, dropped, clamped};
        },

        layout() {
            const sizes: Record<string, number> = {};
            const issues: string[] = [];
            const walk = (node: GridNode<T>, parentTotal: number | null) => {
                sizes[node.id] = nodeSize(node);
                if (node.kind === "branch") {
                    const total = node.children.reduce((sum, child) => sum + nodeSize(child), 0);
                    for (const child of node.children) {
                        walk(child, total);
                    }
                } else if (parentTotal !== null && node.size < Math.max(0, node.minimumSize) - 0.001) {
                    issues.push("叶子 " + node.id + " 小于最小尺寸");
                }
            };
            if (tree) {
                walk(tree, null);
            }
            return {sizes, issues};
        },
    };
}
