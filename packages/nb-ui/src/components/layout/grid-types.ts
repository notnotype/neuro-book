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

/**
 * 主轴分配策略：`weight` 按意向比例分余量（历史行为），`fixed` 把 `size` 当**像素目标**优先保留。
 * 只影响沿父分支主轴的那一根轴；交叉轴始终由父分支共享空间给定。
 */
export type GridSizing = "weight" | "fixed";

/**
 * 收起策略（运行时）：拖动越过 `collapseThreshold` 时吸附到 `collapsedSize`，
 * 反向越过后恢复到记忆的 `restoreSize`。`collapsed` 是当前状态。
 *
 * 不写快照：它是宿主按领域记录给出的运行期约束，恢复时以当前记录为准。
 */
export type SashCollapsePolicy = {
    /** 收起后的主轴占用（CSS px，允许 0）；必须小于展开最小尺寸。 */
    collapsedSize: number;
    /** 记忆的展开主轴尺寸（CSS px）；恢复时以它为目标，再按当前容量夹取。 */
    restoreSize: number;
    /** 从展开最小尺寸继续向内的收起阈值（CSS px）。 */
    collapseThreshold: number;
    /** 从收起锚点向外的恢复阈值（CSS px）。 */
    expandThreshold: number;
};

export type SashCollapseState = SashCollapsePolicy & {collapsed: boolean};

export type GridLeaf<T> = {
    kind: "leaf";
    id: string;
    ref: T;
    /** 尺寸意图：只有沿父分支主轴的分量有意义。 */
    size: GridExtent;
    minimumSize: GridExtent;
    maximumSize: GridExtent;
    /** 主轴分配策略；缺省 `weight`。 */
    sizing: GridSizing;
    /** 收起策略与状态；缺省不可收起。 */
    collapse?: SashCollapseState;
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
    /** 主轴分配策略；缺省 `weight`。 */
    sizing: GridSizing;
    /** 收起策略与状态；缺省不可收起。 */
    collapse?: SashCollapseState;
    children: GridNode<T>[];
};

export type GridNode<T> = GridLeaf<T> | GridBranch<T>;

/** 叶的建树输入：意图与约束可省略（缺省为 0 / 不限）；`sizing` 缺省 `weight`。 */
export type GridLeafInput<T> = {
    kind: "leaf";
    id: string;
    ref: T;
    size?: GridExtent;
    minimumSize?: GridExtent;
    maximumSize?: GridExtent;
    sizing?: GridSizing;
    collapse?: SashCollapseState;
};

/** 分支的建树输入：`size` 是外部分配意图，省略时由调用方之后用 `resize` 或快照恢复确定。 */
export type GridBranchInput<T> = {
    kind: "branch";
    id: string;
    orientation: GridOrientation;
    size?: GridExtent;
    minimumSize?: GridExtent;
    maximumSize?: GridExtent;
    sizing?: GridSizing;
    collapse?: SashCollapseState;
    children: GridNodeInput<T>[];
};

export type GridNodeInput<T> = GridLeafInput<T> | GridBranchInput<T>;

/** 新叶相对目标叶的位置；left/top 归 `before`、right/bottom 归 `after` 的宿主词汇映射留在交互层。 */
export type GridSplitSide = "before" | "after";

/**
 * 把一个叶拆成新分支的输入。
 *
 * 新分支继承目标叶的外部分配意图，两个子叶按 `ratio` 分掉目标在新轴上的意图——
 * 只开放比例、不开放 `size`：否则初始意图会出现两个 authority，测得的 px 还会被当成权重。
 */
export type GridSplitInput<T> = {
    /** 新分支的稳定 id；派生 id 会在重复拆分时冲突，身份由宿主保证。 */
    branchId: string;
    /** 新分支的分配方向，不必与目标叶原父分支同向。 */
    orientation: GridOrientation;
    side: GridSplitSide;
    /** 新叶输入；`size` 由 `ratio` 与目标叶当前意图决定。 */
    leaf: Omit<GridLeafInput<T>, "size">;
    /** 新叶分得的意图比例；缺省 0.5，必须有限且严格介于 0 与 1。 */
    ratio?: number;
};

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

/** 引用解析结果：`ref` 是宿主对象；约束与运行期策略由当前宿主给出，缺省时回落到当前树里同 id 的节点。 */
export type GridRefResolution<T> = {
    ref: T;
    minimumSize?: GridExtent;
    maximumSize?: GridExtent;
    /** 主轴分配策略（运行期）；缺省沿用当前树或 `weight`。 */
    sizing?: GridSizing;
    /** 收起策略与状态（运行期）；缺省沿用当前树或不可收起。 */
    collapse?: SashCollapseState;
};

export type GridRefResolver<T> = (ref: string) => GridRefResolution<T> | null;

/** 把宿主引用编码成快照里的稳定字符串；非字符串引用必须显式提供。 */
export type GridRefEncoder<T> = (ref: T) => string;

export type GridResult = {ok: true} | {ok: false; reason: string};

/** 单节点调整的实际增量。 */
export type GridResizeResult = {ok: true; applied: number} | {ok: false; reason: string};

/** 一次分支调整：同一容器内该分支全部直接子节点的完整呈现基线与目标（px，各自守恒）。 */
export type GridBranchResize = {
    readonly branchId: string;
    readonly axis: GridAxis;
    readonly baseline: Readonly<Record<string, number>>;
    readonly target: Readonly<Record<string, number>>;
    /** 本场真正改变的收起状态：子节点 id → 是否收起；缺省表示没有收起变化。 */
    readonly collapsed?: Readonly<Record<string, boolean>>;
};

/** 原子分支调整发布的完整意图；键为该分支的直接子节点 id。 */
export type GridBranchResizeResult = {ok: true; sizes: Record<string, number>} | {ok: false; reason: string};

/** 一次手势的批量原子结果：新尺寸意图按节点 id 发布，收起变化按节点 id 发布。 */
export type GridBranchesResizeResult =
    | {readonly ok: true; readonly intents: Record<string, GridExtent>; readonly collapsed: Record<string, boolean>}
    | {readonly ok: false; readonly reason: string};

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
