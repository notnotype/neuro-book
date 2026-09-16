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
 * - **手势**：一次用户手势只提交一次，只把 `gesture-end.active` 的字段合成进原件；程序布局、
 *   挂载、测量与视口重算只走 `setContainer`，不产生保存。取消与失败手势不提交新意图。
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
    type GridLayoutResult,
    type GridNode,
    type GridRefResolver,
    type GridRestoreResult,
    type GridSnapshot,
    type GridSnapshotNode,
} from "@notnotype/nb-ui/components";
import {workbenchBranchGesture} from "nbook/app/components/workbench/workbench-branch-layout";
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
    readonly pending: GridLayoutPendingIntent | null;
    readonly gesture: boolean;
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

export type GridLayoutAck = {readonly ok: true} | {readonly ok: false; readonly diagnosis: string};

export type GridLayoutRestoreResult = {
    readonly status: "published" | "blocked";
    readonly dropped: readonly {readonly ref: string; readonly reason: string}[];
    readonly clamped: readonly string[];
    readonly diagnosis: string | null;
};

/** 手势开始：宿主捕获基线（对应 `Splitter` 的 `gesture-start`）。 */
export type GridGestureStart = {
    /** 该 Splitter 对应的分支 id；面板顺序必须与该分支的直接子节点顺序一致。 */
    readonly branchId: string;
    /** 手势开始时的完整面板百分比（合计 100）。 */
    readonly sizes: readonly number[];
};

/** 手势结束：只提交一次（对应 `Splitter` 的 `gesture-end`）。 */
export type GridGestureEnd = {
    readonly branchId: string;
    /** 主动改变尺寸的直接子节点 id（`SplitterGestureState.active`）。 */
    readonly active: readonly string[];
    /** 手势结束时的完整面板百分比（`SplitterGestureState.sizes`，合计 100）。 */
    readonly sizes: readonly number[];
};

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
    /** 渲染器测量结果：只重算呈现，不改意图、不保存；容器变化会取消进行中的手势。 */
    setContainer(container: GridExtent): GridLayoutResult;
    /** 最近一次测量下的呈现；未测量时为 null。 */
    layout(): GridLayoutResult | null;
    gestureStart(gesture: GridGestureStart): GridLayoutAck;
    gestureEnd(gesture: GridGestureEnd): Promise<GridLayoutCommitResult>;
    /** 取消：丢弃当前手势基线，不产生保存意图。 */
    gestureCancel(): void;
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

type GestureCapture<T> = {
    readonly branchId: string;
    readonly axis: GridAxis;
    readonly children: readonly GridNode<T>[];
    readonly layout: GridLayoutResult;
    readonly container: GridExtent;
    readonly revision: number;
};

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
    let container: GridExtent | null = null;
    let gesture: GestureCapture<T> | null = null;
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
            pending,
            gesture: gesture !== null,
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
                    gesture = null;
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
        gesture = null;
        writable = false;
        credential = null;
        stopSubscription();
        pushIssue("record", diagnosis);
    };

    const keepPending = (fields: readonly GridLayoutField[], diagnosis: string, autoReplayed: boolean): void => {
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
    };

    const clearPending = (): void => {
        pendingFields = null;
        pendingDiagnosis = "";
        pendingAutoReplayed = false;
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
                keepPending(fields, failure.diagnosis, false);
                return unsaved(failure.diagnosis, pendingList());
            }
            if (failure.conflict && autoReplay) {
                return await rereadAfterFailure(fields, "replay", "条件冲突后重读");
            }
            if (failure.committed === null) {
                return await rereadAfterFailure(fields, "reconcile", `保存结果未确认（${failure.diagnosis}）`);
            }
            keepPending(fields, failure.diagnosis, true);
            return unsaved(failure.diagnosis, pendingList());
        }
    };

    /**
     * 冲突重放、显式重试与未确认核对共用的重读路径。
     *
     * - `replay`：冲突后或显式重试时重读，只重放本次主动字段，再条件提交**一次**；
     * - `reconcile`：结果未确认时重读核对是否已经落地，不自动再提交，也不谎报已保存/未写入。
     */
    const rereadAfterFailure = async (
        fields: readonly GridLayoutField[],
        mode: "replay" | "reconcile",
        diagnosis: string,
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
            keepPending(fields, unresolved, true);
            return unsaved(unresolved, pendingList());
        }
        applyRead(snapshot, false);
        if (!writable || credential === null || baselineRecord === null) {
            const unresolved = `${diagnosis}；重读发现记录不可用（${blocked ?? "unavailable"}），未确认调整不再自动重放`;
            keepPending(fields, unresolved, true);
            return unsaved(unresolved, pendingList());
        }
        const composed = composeGridLayoutRecord(baselineRecord, fields);
        reportSkips(composed.skipped);
        if (composed.applied.length === 0) {
            if (composed.skipped.length > 0) {
                // 主动字段在重读后的记录里没有落点：既没有落盘，也没有"当前值已满足意图"这回事。
                const unresolved = `${diagnosis}；重读后主动字段没有落点（记录里已没有对应节点），未确认调整保留`;
                keepPending(fields, unresolved, true);
                return unsaved(unresolved, pendingList());
            }
            // 每个字段都落点且值已相同：视为目标已达成，不伪造某次历史请求的回执（Spec「输出与可观察行为」）。
            clearPending();
            return {status: "saved", credential, fields: []};
        }
        if (mode === "reconcile") {
            const unresolved = `${diagnosis}；重读核对显示记录尚未包含本次意图，等待显式重试或放弃`;
            keepPending(fields, unresolved, true);
            return unsaved(unresolved, pendingList());
        }
        return await submit(credential, composed.value, composed.applied, fields, false);
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
            keepPending(fields, diagnosis, false);
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
        return await submit(credential, composed.value, composed.applied, fields, true);
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
            if (gesture !== null && (container === null || container.width !== width || container.height !== height)) {
                gesture = null;
                pushIssue("gesture", "容器尺寸变化已取消进行中的手势");
            }
            container = {width, height};
            return grid.layout(container);
        },

        layout() {
            return container === null ? null : grid.layout(container);
        },

        gestureStart(start) {
            if (phase !== "ready") {
                return {ok: false, diagnosis: "布局宿主尚未完成读取，不能开始手势"};
            }
            if (container === null) {
                return {ok: false, diagnosis: "容器尚未测量：先调用 setContainer 再开始手势"};
            }
            const layout = grid.layout(container);
            const branch = findBranch(start.branchId);
            if (branch === null) {
                return {ok: false, diagnosis: `未知分支 id：${start.branchId}`};
            }
            const axis = axisOf(branch.orientation);
            // 百分比 → px 与 100% 校验复用产品唯一口径（`WorkbenchBranch` 消费的同一个 helper）。
            if (workbenchBranchGesture(branch.children, layout, axis, start.sizes) === null) {
                return {ok: false, diagnosis: "手势尺寸不是与子节点同序、合计 100 的有限非负百分比"};
            }
            gesture = {
                branchId: start.branchId,
                axis,
                children: branch.children,
                layout,
                container: {width: container.width, height: container.height},
                revision,
            };
            return {ok: true};
        },

        async gestureEnd(end) {
            const captured = gesture;
            gesture = null;
            if (captured === null) {
                return {status: "rejected", diagnosis: "没有进行中的手势：取消或失败的手势不产生保存意图"};
            }
            if (phase !== "ready" || !accepting) {
                return {status: "rejected", diagnosis: "布局宿主已释放或失效，手势不再提交"};
            }
            if (end.branchId !== captured.branchId) {
                return {status: "rejected", diagnosis: `手势分支不匹配：本次手势属于 ${captured.branchId}`};
            }
            if (container === null || revision !== captured.revision
                || container.width !== captured.container.width || container.height !== captured.container.height) {
                return {status: "rejected", diagnosis: "容器或布局已变化，手势基线已失效"};
            }
            const conversion = workbenchBranchGesture(captured.children, captured.layout, captured.axis, end.sizes);
            if (conversion === null) {
                return {status: "rejected", diagnosis: "手势尺寸不是与子节点同序、合计 100 的有限非负百分比"};
            }
            const children: Record<string, true> = {};
            for (const child of captured.children) {
                children[child.id] = true;
            }
            const active: string[] = [];
            for (const id of end.active) {
                if (children[id] !== true) {
                    return {status: "rejected", diagnosis: `主动改变的节点不属于分支 ${captured.branchId}：${id}`};
                }
                if (!active.includes(id)) {
                    active.push(id);
                }
            }
            if (active.length === 0) {
                return {status: "unchanged", diagnosis: "手势没有主动改变的面板，未写盘"};
            }
            const resized = grid.resizeBranch(captured.branchId, captured.axis, conversion.baseline, conversion.target);
            if (!resized.ok) {
                return {status: "rejected", diagnosis: `手势目标未通过当前布局约束，未提交：${resized.reason}`};
            }
            revision += 1;
            const fields: GridLayoutField[] = [];
            for (const id of active) {
                const value = resized.sizes[id];
                if (value === undefined) {
                    return {status: "rejected", diagnosis: `主动节点没有结算出新的尺寸意图：${id}`};
                }
                fields.push({id, axis: captured.axis, value});
            }
            return await commit(fields);
        },

        gestureCancel() {
            if (gesture !== null) {
                gesture = null;
                pushIssue("gesture", "手势已取消，不产生保存意图");
            }
        },

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
            return await rereadAfterFailure(pendingList(), "replay", "显式重试");
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
            gesture = null;
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
            gesture = null;
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
                gesture = null;
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
