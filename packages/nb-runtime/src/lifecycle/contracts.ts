/**
 * runtime.lifecycle 的公开合同：类型与唯一会抛出的错误类。
 *
 * 实现见 `./scope`；调用方只通过 `./lifecycle` 取得这些符号。
 * 除 `LifecycleStateError` 外，本文件不含运行时代码。
 */

declare const brand: unique symbol;
type Branded<Tag extends string> = string & {readonly [brand]: Tag};

/** 作用域身份；同一运行实例内唯一。 */
export type ScopeId = Branded<"ScopeId">;
/** 资源身份；同一运行实例内唯一，借用与依赖都以它为精确目标。 */
export type ResourceId = Branded<"ResourceId">;
/** 受管获取身份；获取结算（登记、失败或取消）后不再出现在任何查询里。 */
export type AcquisitionId = Branded<"AcquisitionId">;
/** 在途操作身份。 */
export type OperationId = Branded<"OperationId">;
/** 借用身份；借用是借用者作用域内的一条使用关系，不是资源。 */
export type BorrowId = Branded<"BorrowId">;

export type RuntimeLocation = "browser" | "server" | "desktop" | "worker";

export interface RuntimeInstanceIdentity {
    readonly location: RuntimeLocation;
    /** 一次启动的身份；刷新、重启或再次启动必须换新值。 */
    readonly instanceId: string;
}

/** 作用域四阶段。“关闭未完成”是 stopping 阶段的收口结果，不是第五种阶段。 */
export type ScopePhase = "creating" | "available" | "stopping" | "closed";

/** 资源状态；`release-failed` 的资源保留 owner 与失败记录，等待显式恢复。 */
export type ResourceStatus = "registered" | "releasing" | "released" | "release-failed";

/** 失败记录里的错误摘要；只保留 name/message，不携带资源值、凭据或文件内容。 */
export interface FailureError {
    readonly name: string;
    readonly message: string;
}

export type FailureStage = "acquire" | "release" | "close";

export interface LifecycleFailure {
    /** 运行实例内单调递增，用于排序失败与阶段变化。 */
    readonly sequence: number;
    readonly instanceId: string;
    readonly scopeId: ScopeId;
    /** 记录失败时作用域所处阶段。 */
    readonly phase: ScopePhase;
    readonly stage: FailureStage;
    /** 释放失败与截止失败归属的关闭尝试序号；获取失败为 null。 */
    readonly attempt: number | null;
    readonly resourceId: ResourceId | null;
    readonly error: FailureError;
}

export type ReleaseResource<T> = (value: T) => void | Promise<void>;

/**
 * 释放顺序依赖：本作用域自己的资源句柄，或本作用域自己持有的借用句柄。
 * 跨作用域依赖必须先 `borrow()`，再把借用句柄作为依赖；这使 owner 能看到活跃借用者。
 */
export type ReleaseDependency = ResourceHandle<unknown> | BorrowHandle<unknown>;

/** 已取得资源的同步登记描述。 */
export interface ResourceSpec<T> {
    readonly kind: string;
    readonly label: string;
    readonly value: T;
    readonly release: ReleaseResource<T>;
    /** 本资源消费的提供者；消费者先释放，提供者后释放。 */
    readonly dependsOn?: ReadonlyArray<ReleaseDependency>;
}

/** owner 持有的资源句柄；`status` 随释放推进实时变化。 */
export interface ResourceHandle<T> {
    readonly id: ResourceId;
    readonly instanceId: string;
    readonly ownerScopeId: ScopeId;
    readonly kind: string;
    readonly label: string;
    /** 在 owner 停止后才登记的迟到资源：只会被收口，不可被借用。 */
    readonly late: boolean;
    readonly status: ResourceStatus;
    readonly value: T;
}

export type RegisterResult<T> =
    | {readonly status: "registered"; readonly handle: ResourceHandle<T>}
    | {readonly status: "late"; readonly resourceId: ResourceId};

/** 受管异步获取描述：获取开始前即计入关闭门禁，取得同时登记。 */
export interface AcquireSpec<T> {
    readonly kind: string;
    readonly label: string;
    /** 默认 true。必需获取失败后作用域不能进入可用；可选获取失败只留下记录。 */
    readonly required?: boolean;
    readonly acquire: (context: {readonly signal: AbortSignal}) => T | Promise<T>;
    readonly release: ReleaseResource<T>;
    readonly dependsOn?: ReadonlyArray<ReleaseDependency>;
}

export type AcquireResult<T> =
    | {readonly status: "acquired"; readonly handle: ResourceHandle<T>}
    | {readonly status: "late"; readonly resourceId: ResourceId}
    | {readonly status: "failed"; readonly required: boolean; readonly error: unknown}
    | {readonly status: "cancelled"; readonly required: boolean; readonly error: unknown};

/** 借用者持有的使用关系；`release()` 只结束使用关系，不关闭资源。 */
export interface BorrowHandle<T> {
    readonly id: BorrowId;
    readonly resourceId: ResourceId;
    readonly ownerScopeId: ScopeId;
    readonly borrowerScopeId: ScopeId;
    readonly value: T;
    readonly released: boolean;
    /** owner 进入停止中即触发；借用者据此尽早结束使用，机制本身不强制回收。 */
    readonly ownerStopSignal: AbortSignal;
    release(): void;
}

export type BorrowResult<T> =
    | {readonly status: "borrowed"; readonly handle: BorrowHandle<T>}
    | {readonly status: "unavailable"; readonly reason: "owner-stopping" | "owner-closed"};

export interface OperationSpec<T> {
    readonly label: string;
    readonly run: (context: {readonly signal: AbortSignal}) => T | Promise<T>;
}

export type OperationCancelReason = "cancel-requested" | "scope-stopping";

/** 等待方视角：取消后立即得到 cancelled，不再等待执行方。 */
export type OperationOutcome<T> =
    | {readonly status: "completed"; readonly value: T}
    | {readonly status: "failed"; readonly error: unknown}
    | {readonly status: "cancelled"; readonly reason: OperationCancelReason};

/** 执行方视角：只在 run 实际结束后结算；取消竞态中成功仍记 completed。 */
export type OperationTermination =
    | {readonly status: "completed"}
    | {readonly status: "failed"; readonly error: unknown};

export interface OperationHandle<T> {
    readonly id: OperationId;
    readonly label: string;
    readonly outcome: Promise<OperationOutcome<T>>;
    readonly termination: Promise<OperationTermination>;
    readonly terminated: boolean;
    cancel(): void;
}

export interface CloseRequest {
    /** 触发后本次尝试立即结算为未完成；已在跑的释放继续跑，不被撤销也不重入。 */
    readonly deadline?: AbortSignal;
}

export type CloseIncompleteReason = "release-failed" | "deadline" | "blocked";

export interface CloseCompleted {
    readonly status: "closed";
    readonly scopeId: ScopeId;
    readonly attempt: number;
}

export interface BlockedRelease {
    readonly target: ResourceId | BorrowId;
    /** 释放失败或自身被阻塞的消费者。 */
    readonly blockedBy: ReadonlyArray<ResourceId | BorrowId>;
    /** 已停止且没有在途关闭尝试、却仍持有借用的借用者作用域。 */
    readonly blockedByBorrowers: ReadonlyArray<ScopeId>;
}

export interface BorrowedResourceReport {
    readonly resourceId: ResourceId;
    readonly borrowerScopeIds: ReadonlyArray<ScopeId>;
}

export interface PendingAcquisitionReport {
    readonly id: AcquisitionId;
    readonly kind: string;
    readonly label: string;
    readonly required: boolean;
}

export interface InFlightOperationReport {
    readonly id: OperationId;
    readonly label: string;
    /** 等待方已得到 cancelled，但执行方尚未终止。 */
    readonly waiterSettled: boolean;
}

export interface CloseIncomplete {
    readonly status: "incomplete";
    readonly scopeId: ScopeId;
    readonly attempt: number;
    readonly reason: CloseIncompleteReason;
    readonly failedResources: ReadonlyArray<ResourceId>;
    /** 释放仍在进行中的资源；下一次尝试先等待它们结算，不重入。 */
    readonly pendingReleases: ReadonlyArray<ResourceId>;
    readonly blockedReleases: ReadonlyArray<BlockedRelease>;
    readonly borrowedResources: ReadonlyArray<BorrowedResourceReport>;
    readonly unreleasedBorrows: ReadonlyArray<BorrowId>;
    readonly pendingAcquisitions: ReadonlyArray<PendingAcquisitionReport>;
    readonly inFlightOperations: ReadonlyArray<InFlightOperationReport>;
    readonly unclosedChildren: ReadonlyArray<ScopeId>;
    /** 本次尝试期间记录的失败；全部历史见 `ScopeSnapshot.failures`。 */
    readonly failures: ReadonlyArray<LifecycleFailure>;
}

export type CloseResult = CloseCompleted | CloseIncomplete;

export interface ResourceSnapshot {
    readonly id: ResourceId;
    readonly kind: string;
    readonly label: string;
    readonly late: boolean;
    readonly status: ResourceStatus;
    readonly dependsOn: ReadonlyArray<ResourceId | BorrowId>;
    readonly borrowerScopeIds: ReadonlyArray<ScopeId>;
}

export interface BorrowSnapshot {
    readonly id: BorrowId;
    readonly resourceId: ResourceId;
    readonly ownerScopeId: ScopeId;
    readonly released: boolean;
}

/** 只读快照：全部数组都是调用时刻的副本，不暴露可变内部集合，也不含资源值。 */
export interface ScopeSnapshot {
    readonly instanceId: string;
    readonly scopeId: ScopeId;
    readonly parentId: ScopeId | null;
    readonly label: string;
    readonly phase: ScopePhase;
    readonly children: ReadonlyArray<ScopeId>;
    readonly resources: ReadonlyArray<ResourceSnapshot>;
    readonly pendingAcquisitions: ReadonlyArray<PendingAcquisitionReport>;
    readonly inFlightOperations: ReadonlyArray<InFlightOperationReport>;
    readonly borrows: ReadonlyArray<BorrowSnapshot>;
    readonly failures: ReadonlyArray<LifecycleFailure>;
    readonly closeAttempts: number;
    readonly lastClose: CloseResult | null;
}

export interface PhaseChange {
    readonly sequence: number;
    readonly instanceId: string;
    readonly scopeId: ScopeId;
    readonly from: ScopePhase;
    readonly to: ScopePhase;
}

/** 诊断观察者；回调抛出的异常被吞掉，不得改变机制状态或中断收口。 */
export interface LifecycleObserver {
    phaseChanged?(change: PhaseChange): void;
    failureRecorded?(failure: LifecycleFailure): void;
}

export interface Scope {
    readonly id: ScopeId;
    readonly instanceId: string;
    readonly parentId: ScopeId | null;
    /** 父作用域引用；根作用域为 null。寿命比较（祖先即更长寿命）沿此链进行。 */
    readonly parent: Scope | null;
    readonly label: string;
    readonly phase: ScopePhase;
    /** 进入 stopping 即 abort；受管获取与在途操作都收到它。 */
    readonly stopSignal: AbortSignal;
    /** creating/available 可建；子作用域从 creating 开始。其它阶段抛 LifecycleStateError。 */
    createChild(label: string): Scope;
    /** creating → available；仍有必需获取待返回或必需获取已失败时抛 LifecycleStateError。 */
    open(): void;
    /** 同步登记已取得的资源；stopping 时登记为迟到资源只收口不发布；closed 抛 LifecycleStateError。 */
    register<T>(spec: ResourceSpec<T>): RegisterResult<T>;
    /** 受管获取；stopping/closed 同步抛 LifecycleStateError，其余失败以结果联合返回。 */
    acquire<T>(spec: AcquireSpec<T>): Promise<AcquireResult<T>>;
    /** 借用另一作用域的资源；跨实例、自有或后代资源抛 TypeError。 */
    borrow<T>(handle: ResourceHandle<T>): BorrowResult<T>;
    /** 只有 available 接纳业务操作。 */
    accept<T>(spec: OperationSpec<T>): OperationHandle<T>;
    /** 幂等：stopping/closed 时返回同一次结果，不另起清理。 */
    close(request?: CloseRequest): Promise<CloseResult>;
    /** 显式恢复：另起一次关闭尝试，只重试失败资源；在途尝试未结算时返回它而不重入。 */
    recover(request?: CloseRequest): Promise<CloseResult>;
    snapshot(): ScopeSnapshot;
}

export interface RuntimeInstance {
    readonly identity: RuntimeInstanceIdentity;
    /** 初始 creating；宿主登记必需资源后 `open()`。 */
    readonly root: Scope;
}

export interface RuntimeInstanceOptions {
    readonly observer?: LifecycleObserver;
}

/** 作用域阶段不允许所请求动作时抛出；这是本机制唯一主动抛出的错误类。 */
export class LifecycleStateError extends Error {
    readonly instanceId: string;
    readonly scopeId: ScopeId;
    readonly phase: ScopePhase;
    readonly action: string;

    constructor(input: {
        readonly instanceId: string;
        readonly scopeId: ScopeId;
        readonly phase: ScopePhase;
        readonly action: string;
        readonly detail?: string;
    }) {
        const detail = input.detail === undefined ? "" : `：${input.detail}`;
        super(`作用域 ${input.scopeId}（${input.phase}）不能${input.action}${detail}`);
        this.name = "LifecycleStateError";
        this.instanceId = input.instanceId;
        this.scopeId = input.scopeId;
        this.phase = input.phase;
        this.action = input.action;
    }
}
