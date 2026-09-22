/**
 * 插件 grid 的持久化宿主：把 nb-ui 布局原语接到工作台 Storage 消费上下文上。
 *
 * 职责（合同见 `docs/specs/ui/nested-grid.md`、`docs/specs/storage/persistence.md`，原语用法见
 * `packages/nb-ui/src/components/layout/grid.md`、`Splitter.md`）：
 *
 * - **恢复**：读取分类经 `projectStorageState` 投影成产品状态。`missing`/`deleted` 保持调用方的产品
 *   默认树且不写记录；`value` 经原语整体校验后**一次发布**；`legacy-value`/`unsupported-version`/
 *   `corrupt` 与结构非法一律回落默认布局、保留原件、禁止普通保存，并给出可区分诊断。
 *   未知引用只过滤**呈现**，原件仍是保存的合成底本。
 * - **手势**：一次用户手势只提交一次（px 批量，`GridRenderer` 的 `gesture-end` payload 原样传入）：
 *   先在内存里整批原子落账（`resizeBranches`），再把**主动改变**的节点合成进原件；任何一项不通过就
 *   整批不落账、也不写盘。程序布局、挂载、测量与视口重算只走 `setContainer`，不产生保存。
 * - **直接字段提交**：`commitFields` 是外壳的纯几何投影使用的路径（不经过手势）；它复用
 *   下面同一套提交与失败收口，但要求**整次提交**——任一字段在原件里没有落点就不保存，
 *   也不新造节点。
 * - **订阅**：只更新已确认基线（记录 + credential），不重挂当前呈现；拖动期间外来确认不打断手势。
 * - **冲突与失败**：冲突后重读、只重放本次主动字段、再条件提交一次；二次冲突或明确拒绝保留当前显示
 *   与未确认意图，停止自动重试并暴露 `retry()` / `abandon()`。超时/断线这类**结果未确认**的失败既不
 *   报告"已保存"也不报告"未写入"，重读核对后按核对结果收口（Spec「失败与恢复」）。
 * - **生命周期**：`release()` 先停止接纳新提交，再等待在途请求收口；上下文失效后旧引用不复活，
 *   不再向失效句柄补写。
 *
 * 本模块是纯模块：不 import Vue/Pinia，不读文件，不自己开 session，也不释放句柄——句柄与工作面
 * 选择由工作台 Storage 上下文（`storage-context.ts`）拥有。
 */
import {
    GRID_LEGACY_SNAPSHOT_VERSION,
    GRID_SNAPSHOT_VERSION,
    axisOf,
    createGrid,
    type Grid,
    type GridAxis,
    type GridBranch,
    type GridExtent,
    type GridGestureCommit,
    type GridLayoutResult,
    type GridNode,
    type GridRefResolver,
    type GridRestoreResult,
    type GridSnapshot,
    type GridSnapshotNode,
} from "@notnotype/nb-ui/layout";
import {isStorageAdapterError} from "nbook/app/utils/storage/value-transport";
import type {WorkbenchStorageOwnerHandle} from "nbook/app/utils/workbench/storage-context";
import type {
    StorageCredential,
    StorageLimits,
    StorageLocality,
    StorageReadResult,
    StorageScope,
} from "nbook/shared/storage/contract";
import {defineStorageState, isSafeStorageIdentifier, type DefinedStorageState} from "nbook/shared/storage/definition";
import {projectStorageState, type StorageProjectedState} from "nbook/shared/storage/projection";

/** 记录的登记版本与快照版本是同一份合同：宿主只写 v2，v1 与更高版本一律作为读取分类处理。 */
export const GRID_LAYOUT_SCHEMA_VERSION = GRID_SNAPSHOT_VERSION;

/**
 * 持久化的布局记录：`version`/`root` 是宿主理解的字段，其余字段由合成原样保留。
 *
 * 类型上的 `root: GridSnapshotNode` 描述的是 v2 记录（本宿主只会写出 v2）；校验函数刻意放宽，
 * 因为 v1 与未知高版本必须以**读取分类**报告并保留原件，不能在适配器边界变成读写异常。
 */
export type GridLayoutRecord = {
    readonly version: number;
    readonly root: GridSnapshotNode;
    readonly [field: string]: unknown;
};

export type GridLayoutStateOptions = {
    readonly owner: string;
    readonly key: string;
    readonly scope: StorageScope;
    readonly locality?: StorageLocality;
    /** `single` 单例记录；`identified` 要求宿主给出稳定资源标识，直通 `defineStorageState`。 */
    readonly records: "single" | "identified";
    /** 无记录时登记的产品默认布局；与调用方的默认树描述同一份布局，读取缺失不写它。 */
    readonly defaultLayout: GridSnapshot;
    readonly limits?: Partial<StorageLimits>;
};

/**
 * 建立 grid 布局状态的登记定义（插件与主工作台共用同一格式）。
 *
 * `schemaVersion` 固定为快照版本：记录版本就是"旧客户端读到不支持格式时禁止覆盖"的判据。
 * 这里不预置 `migrate`——v1 缺两轴信息只能整体拒绝，真要有可迁移格式时再显式提供。
 */
export function defineGridLayoutState(options: GridLayoutStateOptions): DefinedStorageState<GridLayoutRecord> {
    return defineStorageState<GridLayoutRecord>({
        owner: options.owner,
        key: options.key,
        scope: options.scope,
        records: options.records,
        schemaVersion: GRID_LAYOUT_SCHEMA_VERSION,
        defaultValue: {version: options.defaultLayout.version, root: options.defaultLayout.root},
        validate: isGridLayoutRecord,
        ...(options.locality === undefined ? {} : {locality: options.locality}),
        ...(options.limits === undefined ? {} : {limits: options.limits}),
    });
}

/** 记录形状：只确认宿主理解的字段存在；未知字段与未知版本必须放行（见类型注释）。 */
function isGridLayoutRecord(value: unknown): value is GridLayoutRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const candidate = value as {readonly version?: unknown; readonly root?: unknown};
    return typeof candidate.version === "number"
        && Number.isSafeInteger(candidate.version)
        && candidate.version >= 1
        && typeof candidate.root === "object"
        && candidate.root !== null
        && !Array.isArray(candidate.root);
}

/** 一次主动修改的字段：节点 id + 轴 + 新的**意图**值（不是呈现 px）。 */
export type GridLayoutField = {readonly id: string; readonly axis: GridAxis; readonly value: number};

/**
 * 主动字段的形状校验：返回拒绝诊断，`null` 表示可以进入提交路径。
 *
 * 非法轴、非有限/负值、重复的 (id, axis) 与空 id 都在入口拒绝，不静默丢字段——调用方拿到的是
 * "这次调用没有被接纳"，而不是一次内容不完整的保存。
 */
function fieldsProblem(fields: readonly GridLayoutField[]): string | null {
    const seen: Record<string, true> = {};
    for (const field of fields) {
        if (typeof field.id !== "string" || field.id.length === 0) {
            return "主动字段缺少节点 id";
        }
        if (field.axis !== "width" && field.axis !== "height") {
            return `主动字段的轴不是 width/height：${String(field.axis)}`;
        }
        if (!Number.isFinite(field.value) || field.value < 0) {
            return `主动字段的值不是有限非负数：${field.id}.${field.axis}=${String(field.value)}`;
        }
        const key = `${field.id}\u0000${field.axis}`;
        if (seen[key] === true) {
            return `主动字段重复：${field.id}.${field.axis}`;
        }
        seen[key] = true;
    }
    return null;
}

export type GridLayoutFieldSkip = {
    readonly field: GridLayoutField;
    /** `unknown-node`：原件树里没有这个节点；`invalid-value`：值不是有限非负数。 */
    readonly reason: "unknown-node" | "invalid-value";
};

export type GridLayoutComposition = {
    readonly value: GridLayoutRecord;
    /** 真正写入且与原件不同的字段。 */
    readonly applied: readonly GridLayoutField[];
    /** 没有落点的字段；不静默丢失，由调用方报告。 */
    readonly skipped: readonly GridLayoutFieldSkip[];
};

/**
 * 把已知修改合成到读取时保留的原始记录上。
 *
 * 结构、`ref`、未知字段与未知引用节点全部取原件（含未知节点在分支里的原始位置）；只有 `fields`
 * 指到的节点会被改写 `size`，因此"过滤后的渲染树"永远不是保存内容（Spec「失败与恢复」的合成要求）。
 */
export function composeGridLayoutRecord(base: GridLayoutRecord, fields: readonly GridLayoutField[]): GridLayoutComposition {
    const byId = new Map<string, GridLayoutField[]>();
    for (const field of fields) {
        const bucket = byId.get(field.id);
        if (bucket === undefined) {
            byId.set(field.id, [field]);
        } else {
            bucket.push(field);
        }
    }
    const applied: GridLayoutField[] = [];
    const placed = new Set<GridLayoutField>();
    const invalid = new Set<GridLayoutField>();
    const root = composeNode(base.root, byId, applied, placed, invalid);
    const skipped: GridLayoutFieldSkip[] = [];
    for (const field of fields) {
        if (placed.has(field)) {
            continue;
        }
        skipped.push({field, reason: invalid.has(field) ? "invalid-value" : "unknown-node"});
    }
    return {value: {...base, root}, applied, skipped};
}

function composeNode(
    node: GridSnapshotNode,
    byId: ReadonlyMap<string, readonly GridLayoutField[]>,
    applied: GridLayoutField[],
    placed: Set<GridLayoutField>,
    invalid: Set<GridLayoutField>,
): GridSnapshotNode {
    const pending = byId.get(node.id);
    let size = node.size;
    if (pending !== undefined) {
        let next = size;
        for (const field of pending) {
            if (!Number.isFinite(field.value) || field.value < 0) {
                invalid.add(field);
                continue;
            }
            // 落点存在：值没变也算已处理，不能报成"没有落点"。
            placed.add(field);
            if (next[field.axis] === field.value) {
                continue;
            }
            next = {...next, [field.axis]: field.value};
            applied.push(field);
        }
        size = next;
    }
    if (node.kind === "leaf") {
        return {...node, size};
    }
    return {...node, size, children: node.children.map((child) => composeNode(child, byId, applied, placed, invalid))};
}

/** 禁止普通保存的结构化原因；都保留原件，只是不能再写。 */
export type GridLayoutBlockReason =
    | "legacy-value"
    | "unsupported-version"
    | "corrupt"
    | "invalid-record"
    | "unavailable";

export type GridLayoutPhase = "loading" | "ready" | "invalidated" | "released";

export type GridLayoutIssueKind =
    | "record"
    | "dropped-ref"
    | "clamped"
    | "subscription"
    | "gesture"
    | "save";

export type GridLayoutIssue = {readonly kind: GridLayoutIssueKind; readonly message: string};

export type GridLayoutPendingIntent = {
    readonly fields: readonly GridLayoutField[];
    readonly diagnosis: string;
    /** 上下文可用且记录可写时才可显式重试。 */
    readonly retryable: boolean;
    /** 自动重试是否已经用掉：`true` 表示该意图不会再有自动重试，只能显式 `retry()` / `abandon()`。 */
    readonly autoReplayed: boolean;
};

export type GridLayoutHostState = {
    readonly phase: GridLayoutPhase;
    /** 读取分类的产品投影（`projectStorageState`）；`confirmed` 才是可直接当作已保存事实的状态。 */
    readonly projection: StorageProjectedState<GridLayoutRecord> | null;
    /** `phase` 为 ready 且记录可写时为 true；阻断原因见 `blocked`。 */
    readonly writable: boolean;
    /** 写入侧的结构化阻断原因；投影为 `confirmed` 但仍被阻断时（结构非法）只有这里能表达。 */
    readonly blocked: GridLayoutBlockReason | null;
    /** 当前已确认记录的凭据；阻断时保持 null，避免向原件补写。 */
    readonly credential: StorageCredential | null;
    /**
     * 外部版本：树、约束或容器尺寸变化时递增。宿主把它传给 `GridRenderer` 的 `revision`，
     * 并在接纳手势提交前复核——进行中的手势不沿旧基线写新上下文。
     */
    readonly revision: number;
    readonly pending: GridLayoutPendingIntent | null;
    readonly issues: readonly GridLayoutIssue[];
};

export type GridLayoutCommitResult =
    | {readonly status: "saved"; readonly credential: StorageCredential; readonly fields: readonly GridLayoutField[]}
    /** 没有需要保存的字段（no-op 手势、字段与原件相同、主动字段全部没有落点）；诊断说明是哪种。 */
    | {readonly status: "unchanged"; readonly diagnosis: string}
    /** 保存失败或结果未确认：当前显示与未确认意图都保留，出口见 `retry()` / `abandon()`。 */
    | {readonly status: "unsaved"; readonly diagnosis: string; readonly fields: readonly GridLayoutField[]}
    /** 调用没有被接纳（形状不符、基线失效、未测量、已释放或失效）。 */
    | {readonly status: "rejected"; readonly diagnosis: string};

export type GridLayoutRestoreResult = {
    readonly status: "published" | "blocked";
    readonly dropped: readonly {readonly ref: string; readonly reason: string}[];
    readonly clamped: readonly string[];
    readonly diagnosis: string | null;
};

/**
 * 一次手势提交的接纳回执：几何先在内存里整批原子落账（`resizeBranches`），异步保存另走原队列。
 *
 * `GridRenderer` 的 `onGestureCommit` 必须**同步**回答，所以宿主不在这里等 I/O：`{ok:false}` 表示这次
 * 调整连内存几何都没被接受（宿主未就绪、外部版本或根盒已变、形状不符、约束不通过），渲染层据此
 * 就地回滚预览；`{ok:true}` 的 `saved` 是随后把主动字段合成进原件的分类结果
 * （`saved`/`unchanged`/`unsaved`），未确认意图仍留在 `state.pending`，出口是 `retry()` / `abandon()`。
 */
export type GridGestureAcceptance =
    | {
        readonly ok: true;
        /** 这一批变化发布的收起状态（运行期状态，不进布局记录）。 */
        readonly collapsed: Readonly<Record<string, boolean>>;
        readonly saved: Promise<GridLayoutCommitResult>;
      }
    | {readonly ok: false; readonly reason: string};

export type GridLayoutHostOptions<T> = {
    /** 调用方的当前布局树：产品默认布局与运行期约束都在这里，宿主只发布与调整它。 */
    readonly grid: Grid<T>;
    /** 工作台借用的 owner 句柄；宿主不释放它，只借用 `read`/`save`/`subscribe`。 */
    readonly handle: WorkbenchStorageOwnerHandle;
    readonly definition: DefinedStorageState<GridLayoutRecord>;
    /** 稳定恢复地址：`identified` 记录必须给出；两个 grid 用不同 resource 才不会共用记录。 */
    readonly resource?: string;
    /** 把快照里的稳定 ref 还原为宿主对象与当前约束。 */
    readonly resolveRef: GridRefResolver<T>;
};

export type GridLayoutHost<T> = {
    readonly grid: Grid<T>;
    readonly state: GridLayoutHostState;
    /** 读取记录、一次发布、建立订阅；一次调用保证"已读取并已订阅"，没拿到分类或订阅没建立时可再调用重试。 */
    open(): Promise<GridLayoutHostState>;
    /** 渲染器测量结果：只重算呈现，不改意图、不保存；尺寸真的变了会递增 `state.revision`。 */
    setContainer(container: GridExtent): GridLayoutResult;
    /** 最近一次测量下的呈现；未测量时为 null。 */
    layout(): GridLayoutResult | null;
    /**
     * 接纳一次手势提交（`GridRenderer` 的 `gesture-end` payload 原样传入）：先复核外部版本与根盒，
     * 再整批原子落账（`resizeBranches`）并只把**主动改变**的节点合成进原件。取消的手势没有提交，
     * 因此这里不需要配对的开始/取消入口。
     */
    gestureCommit(commit: GridGestureCommit): GridGestureAcceptance;
    /**
     * 直接提交主动字段（不经过手势）：入口校验形状，任一落点缺失就整次不保存。
     *
     * 外壳的纯几何投影用这条路径——投影只回答"哪个叶、哪根轴、落点 px"，树的落点由记录原件决定；
     * 通用 grid 消费者走 `gestureCommit`，两条路径共用同一套提交与失败收口。
     */
    commitFields(fields: readonly GridLayoutField[]): Promise<GridLayoutCommitResult>;
    /** 显式重试未确认意图：重读后只重放本次主动字段，再条件提交一次。 */
    retry(): Promise<GridLayoutCommitResult>;
    /** 放弃未确认意图：采用当前已确认值，不删除或清空其它记录。 */
    abandon(): void;
    /** 从未确认基线重新发布（未知引用重新出现后的显式恢复）；不写盘。 */
    restoreFromBaseline(): GridLayoutRestoreResult;
    /** 先停止接纳新提交，再等待在途请求收口；不释放工作台拥有的句柄。 */
    release(): Promise<void>;
};

/**
 * 宿主视为永久失效的失败：`owner-handle.ts` 的终止码（该模块私有的 `TERMINAL_STORAGE_CODES`）再加
 * `STORAGE_SCHEMA_MISMATCH`——适配器在 `isTerminalFailure` 里同样把它当终止并关掉订阅。
 *
 * 这里只用于收敛"还能不能重试"，不代替适配器自己的失效判定；适配器若新增终止码，宿主要同步跟随。
 */
const TERMINAL_STORAGE_CODES: Record<string, true> = {
    STORAGE_CONTEXT_INVALID: true,
    STORAGE_CLIENT_CREDENTIAL_INVALID: true,
    STORAGE_CREDENTIAL_STALE: true,
    STORAGE_HANDLE_CLOSED: true,
    STORAGE_SERVICE_CLOSED: true,
    STORAGE_SCHEMA_MISMATCH: true,
};

const CONFLICT_CODE = "STORAGE_REVISION_CONFLICT";
const MAX_ISSUES = 32;

/**
 * 手势根盒与当前测量的容差（CSS px）：渲染器与宿主各自量同一个盒子，子像素圆整不算变化，
 * 真正的窗口尺寸变化仍会落在容差之外。
 */
const EXTENT_TOLERANCE = 1;

type FailureReading = {
    readonly terminal: boolean;
    readonly conflict: boolean;
    /** 提交事实：`true` 已提交、`false` 明确拒绝、`null` 未确认（超时/断线）。 */
    readonly committed: boolean | null;
    readonly diagnosis: string;
};

export function createGridLayoutHost<T>(options: GridLayoutHostOptions<T>): GridLayoutHost<T> {
    const {grid, handle, definition, resolveRef} = options;
    const resource = options.resource;
    if (handle.owner !== definition.owner) {
        throw new TypeError(`grid 布局宿主的句柄绑定 owner ${handle.owner}，不能访问 ${definition.owner} 的记录`);
    }
    if (definition.schemaVersion !== GRID_LAYOUT_SCHEMA_VERSION) {
        throw new TypeError(`grid 布局宿主只接受 schemaVersion ${String(GRID_LAYOUT_SCHEMA_VERSION)} 的定义：${definition.address}`);
    }
    if (definition.records === "identified" && resource === undefined) {
        throw new TypeError("identified 记录必须给出稳定资源标识：同一插件的两个 grid 用不同 resource 才不会共用记录");
    }
    if (definition.records === "single" && resource !== undefined) {
        throw new TypeError("single 记录不接受资源标识");
    }
    if (resource !== undefined && !isSafeStorageIdentifier(resource)) {
        throw new TypeError(`布局资源标识不是安全逻辑标识（服务端同样拒绝）：${resource}`);
    }

    const address = resource === undefined ? {} : {resource};
    let phase: GridLayoutPhase = "loading";
    let projection: StorageProjectedState<GridLayoutRecord> | null = null;
    let writable = false;
    let blocked: GridLayoutBlockReason | null = null;
    let credential: StorageCredential | null = null;
    let baselineRecord: GridLayoutRecord | null = null;
    let pendingFields: Map<string, GridLayoutField> | null = null;
    let pendingDiagnosis = "";
    let pendingAutoReplayed = false;
    /** 未确认意图是否要求"每个字段都有落点"：严格意图只来自 `commitFields`，重试时保持严格。 */
    let pendingRequireAll = false;
    let container: GridExtent | null = null;
    let revision = 0;
    let issues: GridLayoutIssue[] = [];
    let subscription: {close(): Promise<void>} | null = null;
    let accepting = true;
    let openPromise: Promise<GridLayoutHostState> | null = null;
    let releasePromise: Promise<void> | null = null;
    const inFlight = new Set<Promise<unknown>>();

    const pushIssue = (kind: GridLayoutIssueKind, message: string): void => {
        issues.push({kind, message});
        if (issues.length > MAX_ISSUES) {
            issues = issues.slice(issues.length - MAX_ISSUES);
        }
    };

    /** 在途请求登记：`release()` 据此等待收口。 */
    const track = <R>(operation: Promise<R>): Promise<R> => {
        inFlight.add(operation);
        void operation.then(() => inFlight.delete(operation), () => inFlight.delete(operation));
        return operation;
    };

    const stateSnapshot = (): GridLayoutHostState => {
        const pending = pendingFields === null ? null : Object.freeze({
            fields: Object.freeze([...pendingFields.values()]),
            diagnosis: pendingDiagnosis,
            retryable: phase === "ready" && accepting && writable && credential !== null,
            autoReplayed: pendingAutoReplayed,
        });
        return Object.freeze({
            phase,
            projection,
            writable: phase === "ready" && writable,
            blocked,
            credential,
            revision,
            pending,
            issues: Object.freeze([...issues]),
        });
    };

    const block = (reason: GridLayoutBlockReason, diagnosis: string): void => {
        writable = false;
        blocked = reason;
        credential = null;
        baselineRecord = null;
        pushIssue("record", diagnosis);
    };

    const acceptBaseline = (record: GridLayoutRecord | null, nextCredential: StorageCredential): void => {
        baselineRecord = record;
        credential = nextCredential;
        writable = true;
        blocked = null;
    };

    /** 记录版本判定：版本不是 2 时不能进原语，必须与损坏分类区分开。 */
    const recordVersionProblem = (record: GridLayoutRecord): GridLayoutBlockReason | null => {
        if (record.version === GRID_LEGACY_SNAPSHOT_VERSION) {
            return "legacy-value";
        }
        return record.version === GRID_LAYOUT_SCHEMA_VERSION ? null : "unsupported-version";
    };

    const restoreInto = (record: GridLayoutRecord): GridRestoreResult => grid.restore(record, resolveRef);

    /**
     * 结构校验探针：订阅更新不能重挂当前呈现（Spec「布局投影与保存反馈」），这条路径只用一次性网格
     * 取原语的 `ok`/`reason`，结果树随即丢弃。探针不做序列化，编码器不会被调用。
     */
    const probeRecord = (record: GridLayoutRecord): GridRestoreResult => {
        const probe = createGrid<unknown>(null, {encodeRef: (ref) => String(ref)});
        return probe.restore(record, resolveRef);
    };

    const reportRestore = (result: GridRestoreResult): void => {
        for (const dropped of result.dropped) {
            pushIssue("dropped-ref", `布局记录里的引用「${dropped.ref}」当前不可解析（${dropped.reason}）：只过滤呈现，原件保留`);
        }
        if (result.clamped.length > 0) {
            pushIssue("clamped", `布局记录的尺寸意图超出当前约束，呈现将夹取：${result.clamped.join("、")}`);
        }
    };

    /**
     * 读取分类 → 呈现与基线；`publish` 只在首次读取时为 true，订阅更新不重挂呈现。
     *
     * 分类到产品状态一律经 `projectStorageState`，宿主不再造第二套状态口径；写入侧的阻断原因单独记在
     * `blocked`，因为"结构非法的当前值"在投影里仍是 `confirmed`。
     */
    const applyRead = (snapshot: StorageReadResult<GridLayoutRecord>, publish: boolean): void => {
        projection = projectStorageState(definition, snapshot);
        switch (snapshot.kind) {
            case "value": {
                const record = snapshot.value;
                const versionProblem = recordVersionProblem(record);
                if (versionProblem === "legacy-value") {
                    block(versionProblem, `布局记录载荷版本 ${String(GRID_LEGACY_SNAPSHOT_VERSION)} 只记录单轴尺寸，无法可靠推导宽高：保留原件并禁止普通保存`);
                    break;
                }
                if (versionProblem === "unsupported-version") {
                    block(versionProblem, `布局记录载荷版本 ${String(record.version)} 高于当前支持的 ${String(GRID_LAYOUT_SCHEMA_VERSION)}：保留原件并禁止普通保存`);
                    break;
                }
                if (publish) {
                    const result = restoreInto(record);
                    reportRestore(result);
                    if (!result.ok) {
                        block("invalid-record", `布局记录结构非法，已回落产品默认布局：${result.reason ?? "未知结构"}`);
                        break;
                    }
                    revision += 1;
                    acceptBaseline(record, snapshot.credential);
                    break;
                }
                const probed = probeRecord(record);
                if (!probed.ok) {
                    block("invalid-record", `外部确认的布局记录结构非法，已停止普通保存：${probed.reason ?? "未知结构"}`);
                    break;
                }
                acceptBaseline(record, snapshot.credential);
                break;
            }
            case "missing":
            case "deleted":
                acceptBaseline(null, snapshot.credential);
                break;
            case "legacy-value":
                block("legacy-value", `布局记录仍是旧 schemaVersion ${String(snapshot.schemaVersion)}，需要显式迁移：原记录保留，普通保存被禁止`);
                break;
            case "unsupported-version":
                block("unsupported-version", `布局记录版本不受支持（封装 ${String(snapshot.wrapperVersion)}，schema ${String(snapshot.schemaVersion)}）：原记录保留，普通保存被禁止`);
                break;
            case "corrupt":
                block("corrupt", `布局记录损坏：${snapshot.diagnosis}；原记录保留，普通保存被禁止`);
                break;
        }
    };

    const classifyFailure = (error: unknown): FailureReading => {
        if (isContextUnavailable(error)) {
            return {
                terminal: true,
                conflict: false,
                committed: false,
                diagnosis: `Storage 句柄已失效，不再接受布局提交：${error instanceof Error ? error.message : String(error)}`,
            };
        }
        if (isStorageAdapterError(error)) {
            return {
                terminal: error.status === 401 || error.status === 403
                    || (error.code !== null && TERMINAL_STORAGE_CODES[error.code] === true),
                conflict: error.code === CONFLICT_CODE,
                committed: error.committed,
                diagnosis: error.message,
            };
        }
        // 未知错误没有提交事实：按未确认处理，交给重读核对，不谎报任何一种结果。
        return {terminal: false, conflict: false, committed: null, diagnosis: error instanceof Error ? error.message : String(error)};
    };

    const stopSubscription = (): void => {
        const closing = subscription;
        subscription = null;
        if (closing === null) {
            return;
        }
        track(closing.close().catch((error: unknown) => {
            const diagnosis = error instanceof Error ? error.message : String(error);
            pushIssue("subscription", `关闭 Storage 订阅失败：${diagnosis}`);
        }));
    };

    const invalidate = (diagnosis: string): void => {
        if (phase === "released" || phase === "invalidated") {
            return;
        }
        phase = "invalidated";
        accepting = false;
        writable = false;
        credential = null;
        stopSubscription();
        pushIssue("record", diagnosis);
    };

    const keepPending = (fields: readonly GridLayoutField[], diagnosis: string, autoReplayed: boolean, requireAll: boolean): void => {
        if (phase === "released") {
            return;
        }
        const merged = pendingFields ?? new Map<string, GridLayoutField>();
        for (const field of fields) {
            merged.set(`${field.id}\u0000${field.axis}`, field);
        }
        pendingFields = merged;
        pendingDiagnosis = diagnosis;
        pendingAutoReplayed = autoReplayed;
        // 严格意图（`commitFields`）在重试时保持严格：绝不把一次整次提交退化成部分保存。
        pendingRequireAll = requireAll;
    };

    const clearPending = (): void => {
        pendingFields = null;
        pendingDiagnosis = "";
        pendingAutoReplayed = false;
        pendingRequireAll = false;
    };

    const pendingList = (): readonly GridLayoutField[] => (pendingFields === null ? [] : [...pendingFields.values()]);

    const reportSkips = (skipped: readonly GridLayoutFieldSkip[]): void => {
        for (const skip of skipped) {
            pushIssue("save", skip.reason === "unknown-node"
                ? `主动字段没有落点：原件树里没有节点 ${skip.field.id}，本次不写入该字段`
                : `主动字段值非法，未写入：${skip.field.id}.${skip.field.axis}`);
        }
    };

    const unsaved = (diagnosis: string, fields: readonly GridLayoutField[]): GridLayoutCommitResult => {
        pushIssue("save", diagnosis);
        return {status: "unsaved", diagnosis, fields};
    };

    /** 条件提交；`autoReplay` 只在本次意图的首次提交时为 true（冲突后只自动重放一次）。 */
    const submit = async (
        expected: StorageCredential,
        value: GridLayoutRecord,
        applied: readonly GridLayoutField[],
        fields: readonly GridLayoutField[],
        autoReplay: boolean,
        requireAll: boolean,
    ): Promise<GridLayoutCommitResult> => {
        try {
            const next = await track(handle.save(definition, {expected, value, ...address}));
            baselineRecord = value;
            credential = next;
            writable = true;
            blocked = null;
            clearPending();
            return {status: "saved", credential: next, fields: applied};
        } catch (error) {
            const failure = classifyFailure(error);
            if (failure.terminal) {
                invalidate(failure.diagnosis);
                keepPending(fields, failure.diagnosis, false, requireAll);
                return unsaved(failure.diagnosis, pendingList());
            }
            if (failure.conflict && autoReplay) {
                return await rereadAfterFailure(fields, "replay", "条件冲突后重读", requireAll);
            }
            if (failure.committed === null) {
                return await rereadAfterFailure(fields, "reconcile", `保存结果未确认（${failure.diagnosis}）`, requireAll);
            }
            keepPending(fields, failure.diagnosis, true, requireAll);
            return unsaved(failure.diagnosis, pendingList());
        }
    };

    /**
     * 冲突重放、显式重试与未确认核对共用的重读路径。
     *
     * - `replay`：冲突后或显式重试时重读，只重放本次主动字段，再条件提交**一次**；
     * - `reconcile`：结果未确认时重读核对是否已经落地，不自动再提交，也不谎报已保存/未写入；
     * - `requireAll`：整次提交语义——重读后的原件里任一字段没有落点就不保存（不退化成部分保存）。
     */
    const rereadAfterFailure = async (
        fields: readonly GridLayoutField[],
        mode: "replay" | "reconcile",
        diagnosis: string,
        requireAll: boolean,
    ): Promise<GridLayoutCommitResult> => {
        let snapshot: StorageReadResult<GridLayoutRecord>;
        try {
            snapshot = await track(handle.read(definition, address));
        } catch (error) {
            const failure = classifyFailure(error);
            if (failure.terminal) {
                invalidate(failure.diagnosis);
            }
            const unresolved = `${diagnosis}；重读核对失败：${failure.diagnosis}`;
            keepPending(fields, unresolved, true, requireAll);
            return unsaved(unresolved, pendingList());
        }
        applyRead(snapshot, false);
        if (!writable || credential === null) {
            const unresolved = `${diagnosis}；重读发现记录不可用（${blocked ?? "unavailable"}），未确认调整不再自动重放`;
            keepPending(fields, unresolved, true, requireAll);
            return unsaved(unresolved, pendingList());
        }
        // 记录缺失（首次保存从未成功）与 `commit` 同一口径：默认布局就是合成底本，
        // 否则"失败后重试"在从未落过盘的 Project 上永远无法收口。
        const composed = composeGridLayoutRecord(baselineRecord ?? definition.defaultValue, fields);
        reportSkips(composed.skipped);
        if (requireAll && composed.skipped.length > 0) {
            const unresolved = `${diagnosis}；重读后主动字段仍没有落点（${composed.skipped.map((skip) => `${skip.field.id}.${skip.field.axis}`).join("、")}），整次未写盘`;
            keepPending(fields, unresolved, true, true);
            return unsaved(unresolved, pendingList());
        }
        if (composed.applied.length === 0) {
            if (composed.skipped.length > 0) {
                // 主动字段在重读后的记录里没有落点：既没有落盘，也没有"当前值已满足意图"这回事。
                const unresolved = `${diagnosis}；重读后主动字段没有落点（记录里已没有对应节点），未确认调整保留`;
                keepPending(fields, unresolved, true, requireAll);
                return unsaved(unresolved, pendingList());
            }
            // 每个字段都落点且值已相同：视为目标已达成，不伪造某次历史请求的回执（Spec「输出与可观察行为」）。
            clearPending();
            return {status: "saved", credential, fields: []};
        }
        if (mode === "reconcile") {
            const unresolved = `${diagnosis}；重读核对显示记录尚未包含本次意图，等待显式重试或放弃`;
            keepPending(fields, unresolved, true, requireAll);
            return unsaved(unresolved, pendingList());
        }
        return await submit(credential, composed.value, composed.applied, fields, false, requireAll);
    };

    const commit = async (fields: readonly GridLayoutField[]): Promise<GridLayoutCommitResult> => {
        if (phase === "released" || phase === "invalidated" || !accepting) {
            return {status: "rejected", diagnosis: "布局宿主已释放或失效，不能接受新提交"};
        }
        if (phase !== "ready") {
            return {status: "rejected", diagnosis: "布局宿主尚未完成读取，不能提交"};
        }
        if (!writable || credential === null) {
            const diagnosis = `布局记录不可普通保存（${blocked ?? "unavailable"}）：当前调整只留在本窗口`;
            keepPending(fields, diagnosis, false, false);
            return unsaved(diagnosis, pendingList());
        }
        const composed = composeGridLayoutRecord(baselineRecord ?? definition.defaultValue, fields);
        reportSkips(composed.skipped);
        if (composed.applied.length === 0) {
            // 结果分类仍是 unchanged（记录没有变化、也没有声称已保存），诊断区分"没有落点"与"值相同"。
            return {
                status: "unchanged",
                diagnosis: composed.skipped.length > 0
                    ? "本次手势的主动字段在原件里没有落点（记录里没有对应节点），未写盘"
                    : "本次手势没有产生与原件不同的字段，未写盘",
            };
        }
        return await submit(credential, composed.value, composed.applied, fields, true, false);
    };

    /**
     * 直接提交主动字段（外壳的纯几何投影只交落点 px，不再经由百分比手势）。
     *
     * 与手势路径共用同一套私有机制（条件提交、冲突后只重放本次字段一次、结果未确认核对、
     * 未确认意图与 `retry()`/`abandon()`），差别只有两条：
     * - **入口形状校验**：非法轴、非有限/负值、重复 (id, axis) 与空 id 整次拒绝；
     * - **整次语义**：任一字段在原件（含冲突重读后的原件）里没有落点就整次不保存，
     *   绝不先部分保存再报成功；未知落点也不会新造节点。
     */
    const commitFields = async (fields: readonly GridLayoutField[]): Promise<GridLayoutCommitResult> => {
        const problem = fieldsProblem(fields);
        if (problem !== null) {
            pushIssue("save", problem);
            return {status: "rejected", diagnosis: problem};
        }
        if (fields.length === 0) {
            return {status: "unchanged", diagnosis: "本次调用没有要保存的字段"};
        }
        if (phase === "released" || phase === "invalidated" || !accepting) {
            return {status: "rejected", diagnosis: "布局宿主已释放或失效，不能接受新提交"};
        }
        if (phase !== "ready") {
            return {status: "rejected", diagnosis: "布局宿主尚未完成读取，不能提交"};
        }
        if (!writable || credential === null) {
            const diagnosis = `布局记录不可普通保存（${blocked ?? "unavailable"}）：当前调整只留在本窗口`;
            keepPending(fields, diagnosis, false, true);
            return unsaved(diagnosis, pendingList());
        }
        const composed = composeGridLayoutRecord(baselineRecord ?? definition.defaultValue, fields);
        reportSkips(composed.skipped);
        if (composed.skipped.length > 0) {
            const diagnosis = `主动字段在原件里没有落点（${composed.skipped.map((skip) => `${skip.field.id}.${skip.field.axis}`).join("、")}），整次未写盘`;
            keepPending(fields, diagnosis, true, true);
            return unsaved(diagnosis, pendingList());
        }
        if (composed.applied.length === 0) {
            return {status: "unchanged", diagnosis: "本次调用没有产生与原件不同的字段，未写盘"};
        }
        return await submit(credential, composed.value, composed.applied, fields, true, true);
    };

    const runOpen = async (): Promise<GridLayoutHostState> => {
        // 释放/失效后不接受任何新动作：连读取也不发起（`open()` 直接返回当前状态快照）。
        if (!accepting || phase === "released" || phase === "invalidated") {
            return stateSnapshot();
        }
        try {
            const snapshot = await track(handle.read(definition, address));
            if (!accepting) {
                return stateSnapshot();
            }
            applyRead(snapshot, true);
        } catch (error) {
            const failure = classifyFailure(error);
            if (failure.terminal) {
                invalidate(failure.diagnosis);
                return stateSnapshot();
            }
            block("unavailable", `读取布局记录失败，当前呈现保持产品默认布局：${failure.diagnosis}`);
        }
        // 读取期间可能已被释放或失效（两者都会关闭接纳）：那时不再建立订阅。
        if (!accepting) {
            return stateSnapshot();
        }
        if (subscription === null) {
            try {
                const opened = await track(handle.subscribe(definition, {
                    ...address,
                    onUpdate: (snapshot) => {
                        if (!accepting) {
                            return;
                        }
                        // 外来确认只更新已确认基线：不重挂呈现，也不清除未确认意图。
                        applyRead(snapshot, false);
                    },
                    onError: (error) => {
                        if (!accepting) {
                            return;
                        }
                        const failure = classifyFailure(error);
                        if (failure.terminal) {
                            invalidate(failure.diagnosis);
                            return;
                        }
                        pushIssue("subscription", `Storage 订阅故障：${failure.diagnosis}`);
                    },
                }));
                if (!accepting) {
                    stopSubscription();
                    return stateSnapshot();
                }
                subscription = opened;
                applyRead(opened.snapshot, false);
            } catch (error) {
                const failure = classifyFailure(error);
                if (failure.terminal) {
                    invalidate(failure.diagnosis);
                    return stateSnapshot();
                }
                pushIssue("subscription", `建立 Storage 订阅失败：${failure.diagnosis}`);
            }
        }
        if (phase === "loading") {
            phase = "ready";
        }
        return stateSnapshot();
    };

    const findBranch = (branchId: string): GridBranch<T> | null => {
        let found: GridBranch<T> | null = null;
        const walk = (node: GridNode<T> | null): void => {
            if (found !== null || node === null || node.kind === "leaf") {
                return;
            }
            if (node.id === branchId) {
                found = node;
                return;
            }
            for (const child of node.children) {
                walk(child);
            }
        };
        walk(grid.root());
        return found;
    };

    return {
        grid,

        get state() {
            return stateSnapshot();
        },

        open() {
            // 释放/失效后不接受任何新动作：直接返回当前状态快照，不发读取。
            if (!accepting || phase === "released" || phase === "invalidated") {
                return Promise.resolve(stateSnapshot());
            }
            // 一次调用保证"已读取并已订阅"：没拿到分类（后端暂不可达）或订阅没建立时保留重试入口。
            openPromise ??= runOpen().then((state) => {
                if (phase === "ready" && (projection === null || subscription === null)) {
                    openPromise = null;
                }
                return state;
            });
            return openPromise;
        },

        setContainer(next) {
            const width = Math.max(0, Number.isFinite(next.width) ? next.width : 0);
            const height = Math.max(0, Number.isFinite(next.height) ? next.height : 0);
            // 尺寸真的变了才递增外部版本：进行中的手势据此被判为旧基线，不沿旧根盒写新上下文。
            if (container === null || container.width !== width || container.height !== height) {
                revision += 1;
            }
            container = {width, height};
            return grid.layout(container);
        },

        layout() {
            return container === null ? null : grid.layout(container);
        },

        gestureCommit(payload) {
            if (phase === "released" || phase === "invalidated" || !accepting) {
                return {ok: false, reason: "布局宿主已释放或失效，不能接受新手势"};
            }
            if (phase !== "ready") {
                return {ok: false, reason: "布局宿主尚未完成读取，不能接受手势"};
            }
            if (container === null) {
                return {ok: false, reason: "容器尚未测量：先调用 setContainer 再提交手势"};
            }
            if (payload.revision !== revision) {
                return {ok: false, reason: "外部布局版本已变化，手势基线已失效"};
            }
            if (Math.abs(payload.extent.width - container.width) > EXTENT_TOLERANCE
                || Math.abs(payload.extent.height - container.height) > EXTENT_TOLERANCE) {
                return {ok: false, reason: "手势的根盒与当前容器不一致，手势基线已失效"};
            }
            for (const change of payload.changes) {
                const branch = findBranch(change.branchId);
                if (branch === null) {
                    return {ok: false, reason: `未知分支 id：${change.branchId}`};
                }
                if (axisOf(branch.orientation) !== change.axis) {
                    return {ok: false, reason: `手势的轴不是分支 ${change.branchId} 的主轴：${change.axis}`};
                }
                const children: Record<string, true> = {};
                for (const child of branch.children) {
                    children[child.id] = true;
                }
                for (const id of change.active) {
                    if (children[id] !== true) {
                        return {ok: false, reason: `主动改变的节点不属于分支 ${change.branchId}：${id}`};
                    }
                }
            }
            if (payload.changes.length === 0) {
                return {ok: true, collapsed: {}, saved: Promise.resolve({status: "unchanged", diagnosis: "本次手势没有产生变化，未写盘"})};
            }
            // 整批在同一棵候选树上规划：任何一项不通过就整批不落账，失败路径不会留下半批修改。
            const resized = grid.resizeBranches(payload.changes);
            if (!resized.ok) {
                const reason = `手势目标未通过当前布局约束，整批未提交：${resized.reason}`;
                pushIssue("gesture", reason);
                return {ok: false, reason};
            }
            revision += 1;
            const fields: GridLayoutField[] = [];
            for (const change of payload.changes) {
                for (const id of change.active) {
                    const value = resized.intents[id]?.[change.axis];
                    if (value === undefined) {
                        const reason = `主动节点没有结算出新的尺寸意图：${id}`;
                        pushIssue("gesture", reason);
                        return {ok: false, reason};
                    }
                    if (!fields.some((field) => field.id === id && field.axis === change.axis)) {
                        fields.push({id, axis: change.axis, value});
                    }
                }
            }
            if (fields.length === 0) {
                return {
                    ok: true,
                    collapsed: resized.collapsed,
                    saved: Promise.resolve({status: "unchanged", diagnosis: "手势没有主动改变的节点，未写盘"}),
                };
            }
            return {ok: true, collapsed: resized.collapsed, saved: commit(fields)};
        },

        commitFields,

        async retry() {
            if (phase === "released" || phase === "invalidated" || !accepting) {
                return {status: "rejected", diagnosis: "布局宿主已释放或失效，不能重试"};
            }
            if (pendingFields === null) {
                return {status: "unchanged", diagnosis: "没有未确认的本地意图"};
            }
            if (!writable) {
                return {status: "rejected", diagnosis: `布局记录不可普通保存（${blocked ?? "unavailable"}）：只能放弃未确认调整`};
            }
            return await rereadAfterFailure(pendingList(), "replay", "显式重试", pendingRequireAll);
        },

        abandon() {
            if (pendingFields === null) {
                return;
            }
            clearPending();
            const result = restoreInto(baselineRecord ?? definition.defaultValue);
            reportRestore(result);
            if (!result.ok) {
                pushIssue("record", `放弃未确认调整时无法恢复已确认布局：${result.reason ?? "未知结构"}`);
            }
            revision += 1;
        },

        restoreFromBaseline() {
            if (pendingFields !== null) {
                return {status: "blocked", dropped: [], clamped: [], diagnosis: "有未确认的本地意图：先 retry 或 abandon 再恢复已确认布局"};
            }
            if (baselineRecord === null) {
                return {status: "blocked", dropped: [], clamped: [], diagnosis: "没有可用的已确认记录：当前呈现保持产品默认布局"};
            }
            const result = restoreInto(baselineRecord);
            reportRestore(result);
            if (!result.ok) {
                return {status: "blocked", dropped: [], clamped: [], diagnosis: `已确认记录结构非法，未发布：${result.reason ?? "未知结构"}`};
            }
            revision += 1;
            return {
                status: "published",
                dropped: result.dropped.map((item) => ({ref: item.ref, reason: item.reason})),
                clamped: [...result.clamped],
                diagnosis: null,
            };
        },

        release() {
            releasePromise ??= (async () => {
                phase = "released";
                accepting = false;
                clearPending();
                const closing = subscription;
                subscription = null;
                const accepted = [...inFlight];
                const errors: unknown[] = [];
                if (closing !== null) {
                    try {
                        await closing.close();
                    } catch (error) {
                        errors.push(error);
                    }
                }
                const settled = await Promise.allSettled(accepted);
                for (const result of settled) {
                    if (result.status === "rejected") {
                        errors.push(result.reason);
                    }
                }
                if (errors.length > 0) {
                    throw new AggregateError(errors, "释放 grid 布局宿主失败");
                }
            })();
            return releasePromise;
        },
    };
}

/** t40 facade 在上下文失效时抛出的错误形状（见 `storage-context.ts` 的 `unavailableFailure`）。 */
function isContextUnavailable(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("storageContextUnavailable" in error)) {
        return false;
    }
    const value = error.storageContextUnavailable;
    return typeof value === "object" && value !== null && "status" in value && value.status === "unavailable";
}
