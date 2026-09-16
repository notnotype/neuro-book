/**
 * 嵌套 grid 原语的公共类型与常量。
 *
 * 领域无关原语：不出现指针事件、`localStorage`、Vue 导入，也不认识主工作台的 Part 名。
 * 几何模型见 `grid-geometry.ts`，快照见 `grid-snapshot.ts`，树操作入口见 `grid.ts`。
 *
 * 两轴口径（`docs/specs/ui/nested-grid.md`）：
 * - **意图**（`size`）：节点在**父分支主轴**上的用户分配值；叶与分支一视同仁，分支的这份值就是它的
 *   *外部分配*（这一列在父容器里占多宽）。交叉轴分量不是用户意图，由父分支共享空间在布局时算出。
 * - **约束**（`minimumSize` / `maximumSize`）：两轴都用宽高表达。叶的约束由宿主声明；分支除按子节点
 *   推导外还可由宿主**额外声明**（例如分支暂时没有叶时仍要固定占位）。约束是运行期的，不进快照。
 * - **呈现**：`layout(container)` 的输出，可由视口重算，永远不写回意图。
 */
export type GridOrientation = "horizontal" | "vertical";

/** 二维几何的一根轴；某根轴是主轴还是交叉轴由所在分支的 `orientation` 决定。 */
export type GridAxis = "width" | "height";

/** 宽高两轴的一对数值：尺寸、尺寸意图与尺寸约束共用这一种表达。 */
export type GridExtent = {width: number; height: number};

export type GridLeaf<T> = {
    kind: "leaf";
    id: string;
    ref: T;
    /** 尺寸意图：只有沿父分支主轴的分量有意义。 */
    size: GridExtent;
    minimumSize: GridExtent;
    maximumSize: GridExtent;
};

export type GridBranch<T> = {
    kind: "branch";
    id: string;
    orientation: GridOrientation;
    /** 尺寸意图：沿父分支主轴的分量是这一列（行）的外部分配。 */
    size: GridExtent;
    /** 宿主声明的自身约束，与子节点推导值相交；缺省为「不额外限制」。 */
    minimumSize: GridExtent;
    maximumSize: GridExtent;
    children: GridNode<T>[];
};

export type GridNode<T> = GridLeaf<T> | GridBranch<T>;

/** 叶的建树输入：意图与约束可省略（缺省为 0 / 不限）。 */
export type GridLeafInput<T> = {
    kind: "leaf";
    id: string;
    ref: T;
    size?: GridExtent;
    minimumSize?: GridExtent;
    maximumSize?: GridExtent;
};

/** 分支的建树输入：`size` 是外部分配意图，省略时由调用方之后用 `resize` 或快照恢复确定。 */
export type GridBranchInput<T> = {
    kind: "branch";
    id: string;
    orientation: GridOrientation;
    size?: GridExtent;
    minimumSize?: GridExtent;
    maximumSize?: GridExtent;
    children: GridNodeInput<T>[];
};

export type GridNodeInput<T> = GridLeafInput<T> | GridBranchInput<T>;

/**
 * 快照只保存稳定结构、宿主引用与尺寸意图：叶与分支的 `size` 都进快照，否则恢复时只能从子节点
 * 重猜列宽（内层叶高度不能当成外层列宽）。运行期约束不进快照——恢复以当前宿主约束为准。
 */
export type GridSnapshotLeaf = {kind: "leaf"; id: string; ref: string; size: GridExtent};

export type GridSnapshotBranch = {
    kind: "branch";
    id: string;
    orientation: GridOrientation;
    size: GridExtent;
    children: GridSnapshotNode[];
};

export type GridSnapshotNode = GridSnapshotLeaf | GridSnapshotBranch;

export type GridSnapshot = {version: typeof GRID_SNAPSHOT_VERSION; root: GridSnapshotNode};

/** 引用解析结果：`ref` 是宿主对象；约束由当前宿主给出，缺省时回落到当前树里同 id 的节点。 */
export type GridRefResolution<T> = {
    ref: T;
    minimumSize?: GridExtent;
    maximumSize?: GridExtent;
};

export type GridRefResolver<T> = (ref: string) => GridRefResolution<T> | null;

/** 把宿主引用编码成快照里的稳定字符串；非字符串引用必须显式提供。 */
export type GridRefEncoder<T> = (ref: T) => string;

export type GridResult = {ok: true} | {ok: false; reason: string};

/** 单节点调整的实际增量。 */
export type GridResizeResult = {ok: true; applied: number} | {ok: false; reason: string};

/** 原子分支调整发布的完整意图；键为该分支的直接子节点 id。 */
export type GridBranchResizeResult = {ok: true; sizes: Record<string, number>} | {ok: false; reason: string};

export type GridRestoreResult = {
    ok: boolean;
    /** 未解析出的引用：只过滤当前呈现，宿主必须保留原始记录（见 Spec「失败与恢复」）。 */
    dropped: {ref: string; reason: string}[];
    /** 意图超出当前宿主约束的节点：呈现层会夹取，意图本身不改写。 */
    clamped: string[];
    reason?: string;
};

export type GridConstraint = {minimumSize: GridExtent; maximumSize: GridExtent};

export type GridLayoutResult = {
    /** 每个节点在当前容器内的呈现尺寸。字典无原型，任意合法字符串 id 都可安全索引。 */
    sizes: Record<string, GridExtent>;
    /** 当前运行期约束的有效区间；与 `sizes` 同样按节点 id 索引。 */
    constraints: Record<string, GridConstraint>;
    /** 每个分支各条 sash 的实际尺寸，顺序对应相邻 children；窄容器可能按比例压缩。 */
    sashSizes: Record<string, number[]>;
    issues: string[];
};

export type GridOptions<T> = {
    /** 兄弟之间的 sash 占用；函数形式可表达宿主明确隐藏的特定 sash。 */
    sashSize?: number | ((branchId: string, sashIndex: number) => number);
    /** 非字符串 ref 的稳定快照编码器；字符串 ref 缺省按自身编码。 */
    encodeRef?: GridRefEncoder<T>;
};

export const GRID_SNAPSHOT_VERSION = 2;
/** 旧版只记录单轴尺寸，无法把内部高度可靠地当成外部宽度，恢复时必须整体拒绝。 */
export const GRID_LEGACY_SNAPSHOT_VERSION = 1;
export const GRID_MAX_NODES = 256;
export const GRID_MAX_DEPTH = 16;
