/**
 * 嵌套 grid 的快照：序列化与恢复解析。
 *
 * 序列化只写稳定结构、宿主引用与尺寸意图（叶与分支都有 `size`——分支的外部列宽不能由子节点重猜）；
 * 运行期约束（min/max）与呈现尺寸都不进快照，恢复一律以当前宿主约束为准。
 *
 * 解析在**进入子树前**做规模判定：节点数、深度与是否为数组先看 `children.length` 再递归，
 * 超限快照直接整体拒绝，不遍历任意大的数组。整体通过后才由调用方一次发布（不留半棵树）。
 */
import type {
    GridAxis,
    GridExtent,
    GridNode,
    GridOrientation,
    GridRefEncoder,
    GridRefResolver,
    GridRestoreResult,
    GridSnapshot,
    GridSnapshotNode,
} from "./grid-types";
import {GRID_LEGACY_SNAPSHOT_VERSION, GRID_MAX_DEPTH, GRID_MAX_NODES, GRID_SNAPSHOT_VERSION} from "./grid-types";
import {UNBOUNDED_EXTENT, ZERO_EXTENT, axisOf, normExtent, readExtent} from "./grid-geometry";

type ConstraintIndex = Map<string, {minimumSize: GridExtent; maximumSize: GridExtent}>;

export function serializeTree<T>(root: GridNode<T> | null, encodeRef?: GridRefEncoder<T>): GridSnapshot {
    const toSnapshot = (node: GridNode<T>): GridSnapshotNode => {
        if (node.kind === "branch") {
            return {kind: "branch", id: node.id, orientation: node.orientation, size: {...node.size}, children: node.children.map(toSnapshot)};
        }
        const ref = encodeRef ? encodeRef(node.ref) : node.ref;
        if (typeof ref !== "string" || ref.length === 0) {
            throw new TypeError(`节点 ${node.id} 的 ref 不是稳定字符串；非字符串引用必须提供 encodeRef`);
        }
        return {kind: "leaf", id: node.id, ref, size: {...node.size}};
    };
    return {
        version: GRID_SNAPSHOT_VERSION,
        root: root
            ? toSnapshot(root)
            : {kind: "branch", id: "root", orientation: "horizontal", size: {...ZERO_EXTENT}, children: []},
    };
}

/**
 * 当前树里各节点的约束：快照不带运行期约束，恢复必须回落到**当前宿主**（分支按 id、叶按 id；
 * 叶优先用解析器给出的当前约束）。意图不在这里回填——意图来自快照，夹取只发生在呈现层。
 */
function currentConstraints<T>(current: GridNode<T> | null): {branches: ConstraintIndex; leaves: ConstraintIndex} {
    const branches: ConstraintIndex = new Map();
    const leaves: ConstraintIndex = new Map();
    const walk = (node: GridNode<T> | null): void => {
        if (!node) {
            return;
        }
        const bounds = {minimumSize: {...node.minimumSize}, maximumSize: {...node.maximumSize}};
        if (node.kind === "leaf") {
            leaves.set(node.id, bounds);
            return;
        }
        branches.set(node.id, bounds);
        node.children.forEach(walk);
    };
    walk(current);
    return {branches, leaves};
}

export function parseSnapshot<T>(
    raw: unknown,
    resolveRef: GridRefResolver<T>,
    current: GridNode<T> | null,
): {result: GridRestoreResult; tree: GridNode<T> | null} {
    const dropped: {ref: string; reason: string}[] = [];
    const clamped: string[] = [];
    const failed = (reason: string): {result: GridRestoreResult; tree: null} => ({result: {ok: false, dropped, clamped: [], reason}, tree: null});
    if (!raw || typeof raw !== "object") {
        return failed("快照不是对象");
    }
    const envelope = raw as {version?: unknown; root?: unknown};
    if (envelope.version === GRID_LEGACY_SNAPSHOT_VERSION) {
        return failed(`布局快照版本 ${GRID_LEGACY_SNAPSHOT_VERSION} 只记录单轴尺寸，无法可靠推导宽高；请由宿主保留原件并回退默认布局`);
    }
    if (envelope.version !== GRID_SNAPSHOT_VERSION) {
        return failed(`布局快照版本 ${String(envelope.version)} 不受支持（当前 ${GRID_SNAPSHOT_VERSION}）`);
    }

    const constraints = currentConstraints(current);
    const seen = new Set<string>();
    let count = 0;
    let failure = "";

    /** `parentAxis` 是父分支主轴（根为 null）：叶只有这根轴上的意图值需要按当前约束体检。 */
    const convert = (node: unknown, depth: number, parentAxis: GridAxis | null): GridNode<T> | null => {
        if (failure) {
            return null;
        }
        if (depth > GRID_MAX_DEPTH) {
            failure = `布局快照深度超过 ${GRID_MAX_DEPTH}`;
            return null;
        }
        if (!node || typeof node !== "object") {
            failure = "布局快照包含非法节点";
            return null;
        }
        const candidate = node as {kind?: unknown; id?: unknown; orientation?: unknown; ref?: unknown; size?: unknown; children?: unknown};
        if (typeof candidate.id !== "string" || candidate.id.length === 0) {
            failure = "布局快照节点缺少合法 id";
            return null;
        }
        if (seen.has(candidate.id)) {
            failure = `布局快照存在重复节点 id：${candidate.id}`;
            return null;
        }
        seen.add(candidate.id);
        count += 1;
        if (count > GRID_MAX_NODES) {
            failure = `布局快照节点数超过 ${GRID_MAX_NODES}`;
            return null;
        }
        if (candidate.kind === "leaf") {
            if (typeof candidate.ref !== "string") {
                failure = `布局快照叶子的 ref 不是字符串：${candidate.id}`;
                return null;
            }
            const size = readExtent(candidate.size);
            if (!size) {
                failure = `布局快照叶子的尺寸非法：${candidate.id}`;
                return null;
            }
            const resolved = resolveRef(candidate.ref);
            if (!resolved) {
                dropped.push({ref: candidate.ref, reason: "未知 ref"});
                return null;
            }
            const minimumSize = normExtent(resolved.minimumSize, constraints.leaves.get(candidate.id)?.minimumSize ?? ZERO_EXTENT);
            const maximumSize = normExtent(resolved.maximumSize, constraints.leaves.get(candidate.id)?.maximumSize ?? UNBOUNDED_EXTENT);
            if (parentAxis && (size[parentAxis] < minimumSize[parentAxis] || size[parentAxis] > maximumSize[parentAxis])) {
                clamped.push(candidate.id);
            }
            return {kind: "leaf", id: candidate.id, ref: resolved.ref, size, minimumSize, maximumSize};
        }
        if (candidate.kind === "branch") {
            if (candidate.orientation !== "horizontal" && candidate.orientation !== "vertical") {
                failure = `布局快照分支方向非法：${candidate.id}`;
                return null;
            }
            if (!Array.isArray(candidate.children)) {
                failure = `布局快照分支的 children 不是数组：${candidate.id}`;
                return null;
            }
            const size = readExtent(candidate.size);
            if (!size) {
                failure = `布局快照分支尺寸非法：${candidate.id}`;
                return null;
            }
            if (count + candidate.children.length > GRID_MAX_NODES) {
                failure = `布局快照节点数超过 ${GRID_MAX_NODES}`;
                return null;
            }
            const declared = constraints.branches.get(candidate.id);
            const orientation = candidate.orientation as GridOrientation;
            const children = candidate.children
                .map((child) => convert(child, depth + 1, axisOf(orientation)))
                .filter((child): child is GridNode<T> => Boolean(child));
            if (failure) {
                return null;
            }
            return {
                kind: "branch",
                id: candidate.id,
                orientation,
                size,
                minimumSize: declared?.minimumSize ?? {...ZERO_EXTENT},
                maximumSize: declared?.maximumSize ?? {...UNBOUNDED_EXTENT},
                children,
            };
        }
        failure = `布局快照节点 kind 非法：${candidate.id}`;
        return null;
    };

    const tree = convert(envelope.root, 0, null);
    if (failure) {
        return failed(failure);
    }
    if (!tree) {
        return failed("布局快照的根节点无法恢复");
    }
    return {result: {ok: true, dropped, clamped}, tree};
}
