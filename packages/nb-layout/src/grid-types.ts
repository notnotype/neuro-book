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

/** @experimental */
export type GridOrientation = "horizontal" | "vertical";

/**
 * 二维几何的一根轴；某根轴是主轴还是交叉轴由所在分支的 `orientation` 决定。
 * @experimental
 */
export type GridAxis = "width" | "height";

/**
 * 宽高两轴的一对数值：尺寸、尺寸意图与尺寸约束共用这一种表达。
 * @experimental
 */
export type GridExtent = {width: number; height: number};

/**
 * 主轴分配策略：`weight` 按意向比例分余量（历史行为），`fixed` 把 `size` 当**像素目标**优先保留。
 * 只影响沿父分支主轴的那一根轴；交叉轴始终由父分支共享空间给定。
 * @experimental
 */
export type GridSizing = "weight" | "fixed";

/**
 * 收起策略（运行时）：拖动越过 `collapseThreshold` 时吸附到 `collapsedSize`，反向越过后恢复。网格的节点展开回到意图
 * （Spec `ui/nested-grid` 输出 166），策略里没有恢复尺寸；独立 `Splitter` 没有意图，恢复尺寸见 `SplitterCollapseState`。
 *
 * 不写快照：它是宿主按领域记录给出的运行期约束，恢复时以当前记录为准。
 * @experimental
 */
export type SashCollapsePolicy = {
    /** 收起后的主轴占用（CSS px，允许 0）；必须小于展开最小尺寸。 */
    collapsedSize: number;
    /** 从展开最小尺寸继续向内的收起阈值（CSS px）。 */
    collapseThreshold: number;
    /** 从收起锚点向外的恢复阈值（CSS px）。 */
    expandThreshold: number;
    /**
     * false：只经拖动越过阈值收起与展开，分隔条上的 Enter 与显式切换跳过它、作用于另一侧（缺省 true）。用在被另一侧
     * 挤到底的余量叶上：分隔条的显式恢复仍属于原来那个可收起的面板。它决定的是会话挑哪一侧做显式切换；按索引直接调用
     * `solveSashCollapse` 的调用方已经选定了对象，求解器不再过滤。
     */
    toggleable?: boolean;
    /**
     * true：锁住收起状态（Spec `ui/nested-grid` 输出 168，缺省 false）。拖动不越过阈值收起它，也拉不开收着的它；分隔条上的
     * Enter 跳过它（同 `toggleable: false`）；`Grid.resizeBranches` 要翻它的标记时整批失败（`collapse-locked`）。只有宿主能翻：
     * `setCollapsed` 照常翻它，锁经 `setCollapsed` 的 `options.locked` 改，或建树、恢复时在策略里给。
     */
    locked?: boolean;
};

/** @experimental */
export type SashCollapseState = SashCollapsePolicy & {collapsed: boolean};

/**
 * `Grid.setCollapsed` 的选项。
 * @experimental
 */
export type GridCollapseOptions = {
    /** 同时改锁（Spec `ui/nested-grid` 输出 168）；不给时锁不变。 */
    readonly locked?: boolean;
};

/**
 * 独立 `Splitter` 面板的收起策略与状态：`Splitter` 的面板没有意图，尺寸就是宿主给的呈现像素，所以显式恢复（Enter、命令）
 * 要一个 `restoreSize`（CSS px）做目标，再按当前容量夹取。网格的节点不用它，展开回到意图。
 * @experimental
 */
export type SplitterCollapseState = SashCollapseState & {restoreSize: number};

/** @experimental */
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
    /**
     * 刚性：沿父分支主轴的最小与最大尺寸都是它的意图（先夹进声明的最小与最大），拖动的级联补偿不改它，最小尺寸之和放不下时它最后才让。
     * 只有保留像素（`sizing: "fixed"`）的节点会带；交叉轴不受影响。和 `sizing` 一样是运行期约束，不进快照。
     */
    rigid?: true;
    /** 收起策略与状态；缺省不可收起。 */
    collapse?: SashCollapseState;
};

/** @experimental */
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
    /**
     * 刚性：沿父分支主轴的最小与最大尺寸都是它的意图（先夹进声明的最小与最大），拖动的级联补偿不改它，最小尺寸之和放不下时它最后才让。
     * 只有保留像素（`sizing: "fixed"`）的节点会带；交叉轴不受影响。和 `sizing` 一样是运行期约束，不进快照。
     */
    rigid?: true;
    /** 收起策略与状态；缺省不可收起。 */
    collapse?: SashCollapseState;
    children: GridNode<T>[];
};

/** @experimental */
export type GridNode<T> = GridLeaf<T> | GridBranch<T>;

/**
 * 叶的建树输入：意图与约束可省略（缺省为 0 / 不限）；`sizing` 缺省 `weight`。
 * @experimental
 */
export type GridLeafInput<T> = {
    kind: "leaf";
    id: string;
    ref: T;
    size?: GridExtent;
    minimumSize?: GridExtent;
    maximumSize?: GridExtent;
    sizing?: GridSizing;
    /** 刚性（见 `GridLeaf.rigid`）；只对 `sizing: "fixed"` 起作用，按比例分的节点标了不起作用。 */
    rigid?: boolean;
    collapse?: SashCollapseState;
};

/**
 * 分支的建树输入：`size` 是外部分配意图，省略时由调用方之后用 `resize` 或快照恢复确定。
 * @experimental
 */
export type GridBranchInput<T> = {
    kind: "branch";
    id: string;
    orientation: GridOrientation;
    size?: GridExtent;
    minimumSize?: GridExtent;
    maximumSize?: GridExtent;
    sizing?: GridSizing;
    /** 刚性（见 `GridLeaf.rigid`）；只对 `sizing: "fixed"` 起作用，按比例分的节点标了不起作用。 */
    rigid?: boolean;
    collapse?: SashCollapseState;
    children: GridNodeInput<T>[];
};

/** @experimental */
export type GridNodeInput<T> = GridLeafInput<T> | GridBranchInput<T>;

/**
 * 新叶相对目标叶的位置；left/top 归 `before`、right/bottom 归 `after` 的宿主词汇映射留在交互层。
 * @experimental
 */
export type GridSplitSide = "before" | "after";

/**
 * 在一块叶旁边插入新叶的输入（`Grid.splitLeaf`）。
 *
 * 与目标的父分支同向时新叶并进父分支；否则新建分支，新分支继承目标叶的外部分配意图，两个子叶按 `ratio` 分掉目标在新轴上的意图。
 * 只开放比例、不开放 `size`：否则初始意图会出现两个 authority，测得的 px 还会被当成权重。
 * @experimental
 */
export type GridSplitInput<T> = {
    /**
     * 新分支的稳定 id；派生 id 会在重复拆分时冲突，身份由宿主保证。并入父分支时用不上，但照样要合法、不重复：
     * 成败不取决于树此刻的形状，宿主不用先看父分支。
     */
    branchId: string;
    /** 新叶与目标的排列方向：与目标的父分支同向时并入父分支，否则新建这个方向的分支。 */
    orientation: GridOrientation;
    side: GridSplitSide;
    /** 新叶输入；`size` 由 `ratio` 与目标叶当前意图决定。 */
    leaf: Omit<GridLeafInput<T>, "size">;
    /**
     * 新叶分得的份额，缺省 0.5。是数时必须有限且严格介于 0 与 1：新叶得底数乘 `ratio`，目标留下其余；底数是目标的意图，
     * 并入时目标的意图为 0 就取这一支的平均一份（这一支全是 0 时两块都是 0，与兄弟一起均分）。
     * `"even"`：并入时新叶取这一支的平均一份、目标不让，与兄弟平分；新建分支时等于 0.5。
     */
    ratio?: number | "even";
};

/**
 * 快照只保存稳定结构、宿主引用与尺寸意图：叶与分支的 `size` 都进快照，否则恢复时只能从子节点
 * 重猜列宽（内层叶高度不能当成外层列宽）。运行期约束不进快照——恢复以当前宿主约束为准。
 * @experimental
 */
export type GridSnapshotLeaf = {kind: "leaf"; id: string; ref: string; size: GridExtent};

/** @experimental */
export type GridSnapshotBranch = {
    kind: "branch";
    id: string;
    orientation: GridOrientation;
    size: GridExtent;
    children: GridSnapshotNode[];
};

/** @experimental */
export type GridSnapshotNode = GridSnapshotLeaf | GridSnapshotBranch;

/** @experimental */
export type GridSnapshot = {version: typeof GRID_SNAPSHOT_VERSION; root: GridSnapshotNode};

/**
 * 引用解析结果：`ref` 是宿主对象；约束与运行期策略由当前宿主给出，缺省时回落到当前树里同 id 的节点。
 * @experimental
 */
export type GridRefResolution<T> = {
    ref: T;
    minimumSize?: GridExtent;
    maximumSize?: GridExtent;
    /** 主轴分配策略（运行期）；缺省沿用当前树或 `weight`。 */
    sizing?: GridSizing;
    /** 刚性（运行期，见 `GridLeaf.rigid`）；缺省沿用当前树或不刚性。只对最后得到的 `sizing` 是 `fixed` 的叶起作用。 */
    rigid?: boolean;
    /** 收起策略与状态（运行期）；缺省沿用当前树或不可收起。 */
    collapse?: SashCollapseState;
};

/** @experimental */
export type GridRefResolver<T> = (ref: string) => GridRefResolution<T> | null;

/**
 * 把宿主引用编码成快照里的稳定字符串；非字符串引用必须显式提供。
 * @experimental
 */
export type GridRefEncoder<T> = (ref: T) => string;

/**
 * 失败里的参数值：只用字符串与数字，和 `ui/i18n` 的 `TextRef.params` 同型，宿主可以直接交给翻译端口。
 * @experimental
 */
export type GridParamValue = string | number;

/**
 * 诊断（Spec `ui/nested-grid` 输出 139）。`code` 给程序分支；`message` 是库内的英文，只给日志看，调用方不按它分支；
 * `params` 给宿主拼自己的界面文字，其中 `cause`、`axis`、`id` 三个名字在所有诊断里意思相同。码集合开放：新增码不算破坏，按码分支要有默认分支。
 * @experimental
 */
export interface GridIssue<C extends string = string> {
    readonly code: C;
    readonly message: string;
    readonly params?: Readonly<Record<string, GridParamValue>>;
}

/**
 * 失败（Spec `ui/nested-grid` 失败 5 到 7）：诊断加 `ok: false`。
 * @experimental
 */
export interface GridFailure<C extends string = string> extends GridIssue<C> {
    readonly ok: false;
}

/**
 * 求解与手势产生的诊断码（Spec 输出 139）；与失败码不相交。
 * @experimental
 */
export type GridIssueCode =
    | "over-constrained"
    | "unabsorbed-space"
    | "conflicting-bounds"
    | "no-collapse-policy"
    | "no-room-to-collapse"
    | "no-room-to-restore"
    | "swap-skipped";

/**
 * 只由组件与组合式函数发出、求解不会产生的诊断码。
 * @experimental
 */
export type GridHostIssueCode = "not-published" | "notify-failed";

/**
 * 结构操作的失败码（Spec `ui/nested-grid` 失败 5）。
 * @experimental
 */
export type GridFailureCode =
    | "not-found"
    | "wrong-node-kind"
    | "wrong-axis"
    | "not-finite"
    | "invalid-argument"
    | "limit-exceeded"
    | "duplicate-id"
    | "into-own-subtree"
    | "not-conserved"
    | "stale-baseline"
    | "not-collapsible"
    | "collapse-locked"
    | "wrong-sizing";

/**
 * 快照恢复的失败码（Spec `ui/nested-grid` 失败 7）。
 * @experimental
 */
export type GridRestoreFailureCode = "invalid-snapshot" | "unsupported-version" | "unresolved-root" | "duplicate-id" | "limit-exceeded";

/**
 * 提交手势的失败码（Spec `ui/nested-grid` 失败 6）：落账时结构操作的失败原样转交，另加提交自己的几种拒绝。
 * @experimental
 */
export type GridCommitFailureCode =
    | GridFailureCode
    | "not-ready"
    | "stale-context"
    | "stale-revision"
    | "stale-size"
    | "handler-missing"
    | "handler-threw";

/**
 * `useGridHost` 接一次提交的结果：码是库定义的这几种。宿主自己写 `onGestureCommit` 时返回 `{ok: true} | GridFailure`，
 * 可以用自己的码拒绝（码集合开放，Spec 失败 6），这个类型可以赋给它。
 * @experimental
 */
export type GridLayoutCommitResult = {readonly ok: true} | GridFailure<GridCommitFailureCode>;

/** @experimental */
export type GridResult = {ok: true} | GridFailure<GridFailureCode>;

/**
 * 一次分支调整：同一容器内该分支全部直接子节点的完整呈现基线与目标（px，各自守恒）。
 * @experimental
 */
export type GridBranchResize = {
    readonly branchId: string;
    readonly axis: GridAxis;
    readonly baseline: Readonly<Record<string, number>>;
    readonly target: Readonly<Record<string, number>>;
    /** 本场真正改变的收起状态：子节点 id → 是否收起；缺省表示没有收起变化。 */
    readonly collapsed?: Readonly<Record<string, boolean>>;
};

/**
 * 一次手势的批量原子结果：新尺寸意图按节点 id 发布，收起变化按节点 id 发布。
 * @experimental
 */
export type GridBranchesResizeResult =
    | {readonly ok: true; readonly intents: Record<string, GridExtent>; readonly collapsed: Record<string, boolean>}
    | GridFailure<GridFailureCode>;

/**
 * `Grid.setCollapsed` 的结果（Spec `ui/nested-grid` 输出 147、166、168）：`changed` 是收起标记或锁有没有变；`collapse` 是调用之后这个节点的
 * 收起策略，宿主要跨会话保存收起状态时从这里取 `collapsed`，策略本身不写快照。
 * @experimental
 */
export type GridCollapseResult =
    | {readonly ok: true; readonly changed: boolean; readonly collapse: SashCollapseState}
    | GridFailure<GridFailureCode>;

/**
 * `Grid.setSize` 的结果（Spec `ui/nested-grid` 输出 154）：`size` 是存下的意图（夹进节点自己的约束之后），宿主拿它存偏好；
 * `changed` 是意图有没有变；节点有收起策略时另带调用之后的 `collapse`，同 `GridCollapseResult`。
 * @experimental
 */
export type GridSetSizeResult =
    | {readonly ok: true; readonly changed: boolean; readonly size: number; readonly collapse?: SashCollapseState}
    | GridFailure<GridFailureCode>;

/**
 * 快照里没解析出的一条引用；今天只有一种原因。
 * @experimental
 */
export type GridDroppedRef = {ref: string; code: "unknown-ref"};

/** 恢复成功与失败都带的两项。 */
type GridRestoreReport = {
    /** 未解析出的引用：只过滤当前呈现，宿主必须保留原始记录（见 Spec「失败与恢复」）。 */
    dropped: GridDroppedRef[];
    /** 意图超出当前宿主约束的节点：呈现层会夹取，意图本身不改写。 */
    clamped: string[];
};

/** @experimental */
export type GridRestoreResult = ({ok: true} & GridRestoreReport) | (GridFailure<GridRestoreFailureCode> & GridRestoreReport);

/** @experimental */
export type GridConstraint = {minimumSize: GridExtent; maximumSize: GridExtent};

/** @experimental */
export type GridLayoutResult = {
    /** 每个节点在当前容器内的呈现尺寸。字典无原型，任意合法字符串 id 都可安全索引。 */
    sizes: Record<string, GridExtent>;
    /** 当前运行期约束的有效区间；与 `sizes` 同样按节点 id 索引。 */
    constraints: Record<string, GridConstraint>;
    /** 每个分支各条 sash 的实际尺寸，顺序对应相邻 children；窄容器可能按比例压缩。 */
    sashSizes: Record<string, number[]>;
    issues: GridIssue<GridIssueCode>[];
};

/**
 * 一条分隔线的主轴占用（CSS px）。`branchId` 与 `sashIndex` 是它在树里的位置（分支的第几条），结构一变就跟着变；
 * `sash.before`、`sash.after` 是挨着它的两个直接孩子的 id（叶或分支），和 `NestedGrid` 的 `sashDisabled` 认分隔线的办法一样：
 * 要“挨着某块叶的线”时按不变的那一侧判，不按序号。
 * @experimental
 */
export type GridSashResolver = (branchId: string, sashIndex: number, sash: {readonly before: string; readonly after: string}) => number;

/** @experimental */
export type GridOptions<T> = {
    /** 兄弟之间的 sash 占用；函数形式可表达宿主明确隐藏的特定 sash。 */
    sashSize?: number | GridSashResolver;
    /** 非字符串 ref 的稳定快照编码器；字符串 ref 缺省按自身编码。 */
    encodeRef?: GridRefEncoder<T>;
};

/** @experimental */
export const GRID_SNAPSHOT_VERSION = 2;
/** 旧版只记录单轴尺寸，无法把内部高度可靠地当成外部宽度，恢复时必须整体拒绝。 */
export const GRID_LEGACY_SNAPSHOT_VERSION = 1;
/** @experimental */
export const GRID_MAX_NODES = 256;
/** @experimental */
export const GRID_MAX_DEPTH = 16;
