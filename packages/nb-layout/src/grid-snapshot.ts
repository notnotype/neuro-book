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
    GridDroppedRef,
    GridFailure,
    GridRestoreFailureCode,
    GridRestoreResult,
    GridSizing,
    GridSnapshot,
    GridSnapshotNode,
    SashCollapseState,
} from "./grid-types";
import {GRID_LEGACY_SNAPSHOT_VERSION, GRID_MAX_DEPTH, GRID_MAX_NODES, GRID_SNAPSHOT_VERSION} from "./grid-types";
import {UNBOUNDED_EXTENT, ZERO_EXTENT, axisOf, normCollapse, normExtent, readExtent} from "./grid-geometry";
import {restoreFailure} from "./grid-failure";

type RuntimeRecord = {minimumSize: GridExtent; maximumSize: GridExtent; sizing?: GridSizing; rigid?: true; collapse?: SashCollapseState};

type ConstraintIndex = Map<string, RuntimeRecord>;

export function serializeTree<T>(root: GridNode<T> | null, encodeRef?: GridRefEncoder<T>): GridSnapshot {
    const toSnapshot = (node: GridNode<T>): GridSnapshotNode => {
        if (node.kind === "branch") {
            return {kind: "branch", id: node.id, orientation: node.orientation, size: {...node.size}, children: node.children.map(toSnapshot)};
        }
        const ref = encodeRef ? encodeRef(node.ref) : node.ref;
        if (typeof ref !== "string" || ref.length === 0) {
            throw new TypeError(`The ref of node ${node.id} is not a stable string; pass encodeRef for non-string refs`);
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
 * 当前树里各节点的运行期信息：快照不带约束、`sizing`、刚性与收起策略，恢复必须回落到**当前宿主**
 * （分支按 id、叶按 id；叶优先用解析器给出的当前值）。意图不在这里回填——来自快照，夹取只发生在呈现层。
 */
function currentConstraints<T>(current: GridNode<T> | null): {branches: ConstraintIndex; leaves: ConstraintIndex} {
    const branches: ConstraintIndex = new Map();
    const leaves: ConstraintIndex = new Map();
    const walk = (node: GridNode<T> | null): void => {
        if (!node) {
            return;
        }
        const record: RuntimeRecord = {
            minimumSize: {...node.minimumSize},
            maximumSize: {...node.maximumSize},
            sizing: node.sizing,
            ...(node.rigid === true ? {rigid: true} : {}),
            ...(node.collapse === undefined ? {} : {collapse: {...node.collapse}}),
        };
        if (node.kind === "leaf") {
            leaves.set(node.id, record);
            return;
        }
        branches.set(node.id, record);
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
    const dropped: GridDroppedRef[] = [];
    const clamped: string[] = [];
    const failed = (failure: GridFailure<GridRestoreFailureCode>): {result: GridRestoreResult; tree: null} => ({result: {...failure, dropped, clamped: []}, tree: null});
    if (!raw || typeof raw !== "object") {
        return failed(restoreFailure("invalid-snapshot", "The snapshot is not an object", {field: "envelope"}));
    }
    const envelope = raw as {version?: unknown; root?: unknown};
    if (envelope.version === GRID_LEGACY_SNAPSHOT_VERSION) {
        return failed(restoreFailure(
            "unsupported-version",
            `Snapshot version ${GRID_LEGACY_SNAPSHOT_VERSION} only records one axis per node and cannot be restored; keep the original and fall back to the default layout`,
            {version: String(GRID_LEGACY_SNAPSHOT_VERSION)},
        ));
    }
    if (envelope.version !== GRID_SNAPSHOT_VERSION) {
        return failed(restoreFailure(
            "unsupported-version",
            `Snapshot version ${String(envelope.version)} is not supported (current: ${GRID_SNAPSHOT_VERSION})`,
            {version: String(envelope.version)},
        ));
    }

    const constraints = currentConstraints(current);
    const seen = new Set<string>();
    let count = 0;
    let failure: GridFailure<GridRestoreFailureCode> | null = null;

    /** `parentAxis` 是父分支主轴（根为 null）：叶只有这根轴上的意图值需要按当前约束体检。 */
    const convert = (node: unknown, depth: number, parentAxis: GridAxis | null): GridNode<T> | null => {
        if (failure) {
            return null;
        }
        if (depth > GRID_MAX_DEPTH) {
            failure = restoreFailure("limit-exceeded", `The snapshot is nested deeper than ${GRID_MAX_DEPTH} levels (the root is level 1)`, {limit: "depth", max: GRID_MAX_DEPTH});
            return null;
        }
        if (!node || typeof node !== "object") {
            failure = restoreFailure("invalid-snapshot", "The snapshot contains a node that is not an object", {field: "node"});
            return null;
        }
        const candidate = node as {kind?: unknown; id?: unknown; orientation?: unknown; ref?: unknown; size?: unknown; children?: unknown};
        if (typeof candidate.id !== "string" || candidate.id.length === 0) {
            failure = restoreFailure("invalid-snapshot", "A snapshot node has no valid id", {field: "id"});
            return null;
        }
        if (seen.has(candidate.id)) {
            failure = restoreFailure("duplicate-id", `The snapshot repeats node id ${candidate.id}`, {id: candidate.id, with: "existing"});
            return null;
        }
        seen.add(candidate.id);
        count += 1;
        if (count > GRID_MAX_NODES) {
            failure = restoreFailure("limit-exceeded", `The snapshot has more than ${GRID_MAX_NODES} nodes`, {limit: "nodes", max: GRID_MAX_NODES});
            return null;
        }
        if (candidate.kind === "leaf") {
            if (typeof candidate.ref !== "string") {
                failure = restoreFailure("invalid-snapshot", `The ref of leaf ${candidate.id} is not a string`, {field: "ref", id: candidate.id});
                return null;
            }
            const size = readExtent(candidate.size);
            if (!size) {
                failure = restoreFailure("invalid-snapshot", `The size of leaf ${candidate.id} is invalid`, {field: "size", id: candidate.id});
                return null;
            }
            const resolved = resolveRef(candidate.ref);
            if (!resolved) {
                dropped.push({ref: candidate.ref, code: "unknown-ref"});
                return null;
            }
            const minimumSize = normExtent(resolved.minimumSize, constraints.leaves.get(candidate.id)?.minimumSize ?? ZERO_EXTENT);
            const maximumSize = normExtent(resolved.maximumSize, constraints.leaves.get(candidate.id)?.maximumSize ?? UNBOUNDED_EXTENT);
            const sizing = resolved.sizing ?? constraints.leaves.get(candidate.id)?.sizing ?? "weight";
            // 刚性的来源和 `sizing` 一样：解析结果优先（`false` 也算给了），其次当前树；只有保留像素的叶记它。
            const rigid = sizing === "fixed" && (resolved.rigid ?? constraints.leaves.get(candidate.id)?.rigid) === true;
            const collapse = normCollapse(resolved.collapse ?? constraints.leaves.get(candidate.id)?.collapse);
            if (parentAxis && (size[parentAxis] < minimumSize[parentAxis] || size[parentAxis] > maximumSize[parentAxis])) {
                clamped.push(candidate.id);
            }
            return {
                kind: "leaf",
                id: candidate.id,
                ref: resolved.ref,
                size,
                minimumSize,
                maximumSize,
                sizing,
                ...(rigid ? {rigid: true} : {}),
                ...(collapse === undefined ? {} : {collapse}),
            };
        }
        if (candidate.kind === "branch") {
            if (candidate.orientation !== "horizontal" && candidate.orientation !== "vertical") {
                failure = restoreFailure("invalid-snapshot", `The orientation of branch ${candidate.id} is invalid`, {field: "orientation", id: candidate.id});
                return null;
            }
            if (!Array.isArray(candidate.children)) {
                failure = restoreFailure("invalid-snapshot", `The children of branch ${candidate.id} are not an array`, {field: "children", id: candidate.id});
                return null;
            }
            const size = readExtent(candidate.size);
            if (!size) {
                failure = restoreFailure("invalid-snapshot", `The size of branch ${candidate.id} is invalid`, {field: "size", id: candidate.id});
                return null;
            }
            if (count + candidate.children.length > GRID_MAX_NODES) {
                failure = restoreFailure("limit-exceeded", `The snapshot has more than ${GRID_MAX_NODES} nodes`, {limit: "nodes", max: GRID_MAX_NODES});
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
                sizing: declared?.sizing ?? "weight",
                ...(declared?.rigid === true ? {rigid: true} : {}),
                ...(declared?.collapse === undefined ? {} : {collapse: {...declared.collapse}}),
                children,
            };
        }
        failure = restoreFailure("invalid-snapshot", `The kind of node ${candidate.id} is invalid`, {field: "kind", id: candidate.id});
        return null;
    };

    // 根算第 1 层，与结构操作的规模守卫同一个计法。
    const tree = convert(envelope.root, 1, null);
    if (failure) {
        return failed(failure);
    }
    if (!tree) {
        // 格式没问题，只是根叶的引用解析不了：`dropped` 里有它，宿主据此等引用回来，而不是当原件坏了（失败 3）。
        return failed(restoreFailure("unresolved-root", "The root of the snapshot could not be resolved"));
    }
    return {result: {ok: true, dropped, clamped}, tree};
}
