/**
 * runtime.lifecycle 的实现：作用域阶段机、登记表、借用、在途工作与关闭尝试。
 *
 * 所有跨作用域的私有访问都发生在 ScopeImpl 内部（父子、owner 与借用者都是 ScopeImpl），
 * 句柄类只持有内部条目的引用，不把可变集合交给调用方。
 */

import {computeReleasePlan} from "./close-plan";
import type {ReleasePlanNode} from "./close-plan";
import {LifecycleStateError} from "./contracts";
import type {
    AcquireResult,
    AcquireSpec,
    AcquisitionId,
    BorrowHandle,
    BorrowId,
    BorrowResult,
    CloseRequest,
    CloseResult,
    FailureError,
    FailureStage,
    InFlightOperationReport,
    LifecycleFailure,
    LifecycleObserver,
    OperationCancelReason,
    OperationHandle,
    OperationId,
    OperationOutcome,
    OperationSpec,
    OperationTermination,
    PendingAcquisitionReport,
    RegisterResult,
    ReleaseDependency,
    ReleaseResource,
    ResourceHandle,
    ResourceId,
    ResourceSpec,
    ResourceStatus,
    RuntimeInstanceIdentity,
    Scope,
    ScopeId,
    ScopePhase,
    ScopeSnapshot,
} from "./contracts";

export interface InstanceContext {
    readonly identity: RuntimeInstanceIdentity;
    readonly observer: LifecycleObserver | undefined;
    nextSequence(): number;
}

export function createInstanceContext(
    identity: RuntimeInstanceIdentity,
    observer: LifecycleObserver | undefined,
): InstanceContext {
    let sequence = 0;
    return {
        identity,
        observer,
        nextSequence: () => {
            sequence += 1;
            return sequence;
        },
    };
}

type NodeId = ResourceId | BorrowId;

/** 失败摘要：只保留 name/message，不携带 cause、资源值或凭据。 */
export function summarizeFailure(error: unknown): FailureError {
    if (error instanceof Error) {
        return {name: error.name, message: error.message};
    }
    if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        "message" in error &&
        typeof error.name === "string" &&
        typeof error.message === "string"
    ) {
        return {name: error.name, message: error.message};
    }
    return {name: "NonError", message: String(error)};
}

function isAbortError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function abortReason(message: string): DOMException {
    return new DOMException(message, "AbortError");
}

/** 借用 id 与资源 id 共用一个节点 id 空间；前缀由本文件生成，所以按前缀判别是可靠的。 */
function isBorrowId(id: NodeId): id is BorrowId {
    return id.startsWith("borrow-");
}

class ResourceEntry<T> {
    readonly owner: ScopeImpl;
    readonly id: ResourceId;
    readonly kind: string;
    readonly label: string;
    readonly late: boolean;
    readonly value: T;
    readonly dependsOn: ReadonlyArray<NodeId>;
    /** 释放闭包在此捕获 value，使 T 只出现在协变位置，条目集合才能以 unknown 统一存放。 */
    readonly runRelease: () => void | Promise<void>;
    readonly handle: ResourceHandleImpl<T>;
    readonly borrows = new Set<BorrowEntry<unknown>>();
    status: ResourceStatus = "registered";

    constructor(input: {
        readonly owner: ScopeImpl;
        readonly id: ResourceId;
        readonly kind: string;
        readonly label: string;
        readonly late: boolean;
        readonly value: T;
        readonly dependsOn: ReadonlyArray<NodeId>;
        readonly release: ReleaseResource<T>;
    }) {
        this.owner = input.owner;
        this.id = input.id;
        this.kind = input.kind;
        this.label = input.label;
        this.late = input.late;
        this.value = input.value;
        this.dependsOn = input.dependsOn;
        this.runRelease = () => input.release(input.value);
        this.handle = new ResourceHandleImpl(this);
    }
}

class ResourceHandleImpl<T> implements ResourceHandle<T> {
    readonly #entry: ResourceEntry<T>;

    constructor(entry: ResourceEntry<T>) {
        this.#entry = entry;
    }

    static unwrap<T>(handle: ResourceHandle<T>): ResourceEntry<T> | undefined;
    static unwrap(handle: object): ResourceEntry<unknown> | undefined;
    static unwrap(handle: object): ResourceEntry<unknown> | undefined {
        if (!(handle instanceof ResourceHandleImpl)) {
            return undefined;
        }
        // 句柄只由同类型参数的 entry 构造，所以泛型重载可以把 T 原样交回调用方。
        return handle.#entry;
    }

    get id(): ResourceId {
        return this.#entry.id;
    }

    get instanceId(): string {
        return this.#entry.owner.instanceId;
    }

    get ownerScopeId(): ScopeId {
        return this.#entry.owner.id;
    }

    get kind(): string {
        return this.#entry.kind;
    }

    get label(): string {
        return this.#entry.label;
    }

    get late(): boolean {
        return this.#entry.late;
    }

    get status(): ResourceStatus {
        return this.#entry.status;
    }

    get value(): T {
        return this.#entry.value;
    }
}

class BorrowEntry<T> {
    readonly borrower: ScopeImpl;
    readonly resource: ResourceEntry<T>;
    readonly id: BorrowId;
    readonly handle: BorrowHandleImpl<T>;
    readonly #onReleased: () => void;
    released = false;

    constructor(borrower: ScopeImpl, resource: ResourceEntry<T>, id: BorrowId, onReleased: () => void) {
        this.borrower = borrower;
        this.resource = resource;
        this.id = id;
        this.#onReleased = onReleased;
        this.handle = new BorrowHandleImpl(this);
    }

    release(): void {
        if (this.released) {
            return;
        }
        this.released = true;
        this.resource.borrows.delete(this);
        this.#onReleased();
    }
}

class BorrowHandleImpl<T> implements BorrowHandle<T> {
    readonly #entry: BorrowEntry<T>;

    constructor(entry: BorrowEntry<T>) {
        this.#entry = entry;
    }

    static unwrap(handle: object): BorrowEntry<unknown> | undefined {
        if (!(handle instanceof BorrowHandleImpl)) {
            return undefined;
        }
        return handle.#entry;
    }

    get id(): BorrowId {
        return this.#entry.id;
    }

    get resourceId(): ResourceId {
        return this.#entry.resource.id;
    }

    get ownerScopeId(): ScopeId {
        return this.#entry.resource.owner.id;
    }

    get borrowerScopeId(): ScopeId {
        return this.#entry.borrower.id;
    }

    get value(): T {
        return this.#entry.resource.value;
    }

    get released(): boolean {
        return this.#entry.released;
    }

    get ownerStopSignal(): AbortSignal {
        return this.#entry.resource.owner.stopSignal;
    }

    release(): void {
        this.#entry.release();
    }
}

class OperationHandleImpl<T> implements OperationHandle<T> {
    readonly id: OperationId;
    readonly label: string;
    readonly outcome: Promise<OperationOutcome<T>>;
    readonly termination: Promise<OperationTermination>;
    readonly #controller = new AbortController();
    readonly #outcomeResolvers = Promise.withResolvers<OperationOutcome<T>>();
    readonly #terminationResolvers = Promise.withResolvers<OperationTermination>();
    #waiterSettled = false;
    #terminated = false;

    constructor(id: OperationId, spec: OperationSpec<T>, stopSignal: AbortSignal, onTerminated: () => void) {
        this.id = id;
        this.label = spec.label;
        this.outcome = this.#outcomeResolvers.promise;
        this.termination = this.#terminationResolvers.promise;

        const onStop = (): void => this.#cancel("scope-stopping");
        stopSignal.addEventListener("abort", onStop, {once: true});
        if (stopSignal.aborted) {
            onStop();
        }
        const finish = (termination: OperationTermination, outcome: OperationOutcome<T>): void => {
            stopSignal.removeEventListener("abort", onStop);
            this.#terminated = true;
            this.#terminationResolvers.resolve(termination);
            // 取消竞态中执行方成功：等待方已拿到 cancelled，这里不改写；执行结果仍以 termination 为准。
            this.#settleOutcome(outcome);
            onTerminated();
        };
        new Promise<T>((resolve) => resolve(spec.run({signal: this.#controller.signal}))).then(
            (value) => finish({status: "completed"}, {status: "completed", value}),
            (error: unknown) => finish({status: "failed", error}, {status: "failed", error}),
        );
    }

    get terminated(): boolean {
        return this.#terminated;
    }

    get waiterSettled(): boolean {
        return this.#waiterSettled;
    }

    cancel(): void {
        this.#cancel("cancel-requested");
    }

    #cancel(reason: OperationCancelReason): void {
        if (this.#terminated || this.#waiterSettled) {
            return;
        }
        this.#settleOutcome({status: "cancelled", reason});
        this.#controller.abort(abortReason(reason === "scope-stopping" ? "作用域正在停止" : "操作已被取消"));
    }

    #settleOutcome(outcome: OperationOutcome<T>): void {
        if (this.#waiterSettled) {
            return;
        }
        this.#waiterSettled = true;
        this.#outcomeResolvers.resolve(outcome);
    }
}

interface PendingAcquisition {
    readonly id: AcquisitionId;
    readonly kind: string;
    readonly label: string;
    readonly required: boolean;
}

interface InFlightOperation {
    readonly id: OperationId;
    readonly label: string;
    readonly waiterSettled: () => boolean;
}

interface CloseAttempt {
    readonly number: number;
    readonly promise: Promise<CloseResult>;
    readonly failures: LifecycleFailure[];
    settled: boolean;
}
type AttemptExecution = "sync" | "queued";

const DEADLINE: unique symbol = Symbol("deadline");

interface DeadlineGate {
    readonly expired: boolean;
    race<T>(promise: Promise<T>): Promise<T | typeof DEADLINE>;
    dispose(): void;
}

function createDeadlineGate(deadline: AbortSignal | undefined): DeadlineGate {
    if (deadline === undefined) {
        return {expired: false, race: (promise) => promise, dispose: () => undefined};
    }
    const expiredResolvers = Promise.withResolvers<typeof DEADLINE>();
    let expired = false;
    const onAbort = (): void => {
        expired = true;
        expiredResolvers.resolve(DEADLINE);
    };
    deadline.addEventListener("abort", onAbort, {once: true});
    if (deadline.aborted) {
        onAbort();
    }
    return {
        get expired() {
            return expired;
        },
        race: (promise) => Promise.race([promise, expiredResolvers.promise]),
        dispose: () => deadline.removeEventListener("abort", onAbort),
    };
}

export class ScopeImpl implements Scope {
    readonly id: ScopeId;
    readonly label: string;
    readonly #context: InstanceContext;
    readonly #parent: ScopeImpl | null;
    readonly #stopController = new AbortController();
    readonly #children = new Set<ScopeImpl>();
    readonly #resources = new Map<ResourceId, ResourceEntry<unknown>>();
    readonly #pendingAcquisitions = new Map<AcquisitionId, PendingAcquisition>();
    readonly #operations = new Map<OperationId, InFlightOperation>();
    readonly #borrows = new Map<BorrowId, BorrowEntry<unknown>>();
    readonly #failures: LifecycleFailure[] = [];
    #phase: ScopePhase = "creating";
    #requiredAcquisitionFailed = false;
    #attemptCount = 0;
    #latestAttempt: CloseAttempt | null = null;
    #lastClose: CloseResult | null = null;
    /** 任何登记表变化都结算一次这个 deferred，关闭尝试靠它等待而不轮询。 */
    #changed = Promise.withResolvers<void>();

    constructor(context: InstanceContext, parent: ScopeImpl | null, label: string) {
        this.#context = context;
        this.#parent = parent;
        this.label = label;
        this.id = `scope-${context.nextSequence()}` as ScopeId;
    }

    get instanceId(): string {
        return this.#context.identity.instanceId;
    }

    get parentId(): ScopeId | null {
        return this.#parent?.id ?? null;
    }

    get parent(): Scope | null {
        return this.#parent;
    }

    get phase(): ScopePhase {
        return this.#phase;
    }

    get stopSignal(): AbortSignal {
        return this.#stopController.signal;
    }

    createChild(label: string): Scope {
        this.#assertAlive("创建子作用域");
        const child = new ScopeImpl(this.#context, this, label);
        this.#children.add(child);
        return child;
    }

    open(): void {
        if (this.#phase !== "creating") {
            throw this.#stateError("进入可用");
        }
        const pendingRequired = [...this.#pendingAcquisitions.values()].filter((acquisition) => acquisition.required);
        if (pendingRequired.length > 0) {
            throw this.#stateError("进入可用", `仍有 ${pendingRequired.length} 个必需获取待返回`);
        }
        if (this.#requiredAcquisitionFailed) {
            throw this.#stateError("进入可用", "必需获取已失败，只能关闭收口");
        }
        this.#setPhase("available");
    }

    register<T>(spec: ResourceSpec<T>): RegisterResult<T> {
        if (this.#phase === "closed") {
            throw this.#stateError("登记资源");
        }
        const dependsOn = this.#resolveDependencies(spec.dependsOn);
        const entry = this.#addResource({
            kind: spec.kind,
            label: spec.label,
            value: spec.value,
            release: spec.release,
            dependsOn,
        });
        if (entry.late) {
            this.#notifyChanged();
            return {status: "late", resourceId: entry.id};
        }
        return {status: "registered", handle: entry.handle};
    }

    acquire<T>(spec: AcquireSpec<T>): Promise<AcquireResult<T>> {
        if (this.#phase === "stopping" || this.#phase === "closed") {
            throw this.#stateError("发起受管获取");
        }
        const dependsOn = this.#resolveDependencies(spec.dependsOn);
        const required = spec.required ?? true;
        const id = `acquisition-${this.#context.nextSequence()}` as AcquisitionId;
        this.#pendingAcquisitions.set(id, {id, kind: spec.kind, label: spec.label, required});
        const signal = this.stopSignal;
        return new Promise<T>((resolve) => resolve(spec.acquire({signal}))).then(
            (value): AcquireResult<T> => {
                this.#pendingAcquisitions.delete(id);
                const entry = this.#addResource({
                    kind: spec.kind,
                    label: spec.label,
                    value,
                    release: spec.release,
                    dependsOn,
                });
                this.#notifyChanged();
                return entry.late ? {status: "late", resourceId: entry.id} : {status: "acquired", handle: entry.handle};
            },
            (error: unknown): AcquireResult<T> => {
                this.#pendingAcquisitions.delete(id);
                // 只有作用域自己发出的停止才算取消；获取方自行 abort 仍是失败并留痕。
                const cancelled = signal.aborted && isAbortError(error);
                if (!cancelled) {
                    this.#recordFailure("acquire", null, null, error);
                    if (required && this.#phase === "creating") {
                        this.#requiredAcquisitionFailed = true;
                    }
                }
                this.#notifyChanged();
                return cancelled ? {status: "cancelled", required, error} : {status: "failed", required, error};
            },
        );
    }

    borrow<T>(handle: ResourceHandle<T>): BorrowResult<T> {
        this.#assertAlive("借用资源");
        const entry = ResourceHandleImpl.unwrap(handle);
        if (entry === undefined || entry.owner.#context !== this.#context) {
            throw new TypeError("只能借用同一运行实例内由本机制签发的资源句柄");
        }
        if (entry.owner === this) {
            throw new TypeError(`作用域 ${this.id} 不能借用自己拥有的资源 ${entry.id}`);
        }
        if (entry.owner.#isDescendantOf(this)) {
            throw new TypeError(`作用域 ${this.id} 不能借用后代作用域 ${entry.owner.id} 的资源：长寿命作用域不得持有短寿命资源`);
        }
        if (entry.owner.#phase === "closed") {
            return {status: "unavailable", reason: "owner-closed"};
        }
        if (entry.owner.#phase === "stopping") {
            return {status: "unavailable", reason: "owner-stopping"};
        }
        const id = `borrow-${this.#context.nextSequence()}` as BorrowId;
        const owner = entry.owner;
        const borrow = new BorrowEntry(this, entry, id, () => {
            owner.#notifyChanged();
            this.#notifyChanged();
        });
        this.#borrows.set(id, borrow);
        entry.borrows.add(borrow);
        return {status: "borrowed", handle: borrow.handle};
    }

    accept<T>(spec: OperationSpec<T>): OperationHandle<T> {
        if (this.#phase !== "available") {
            throw this.#stateError("接纳操作");
        }
        const id = `operation-${this.#context.nextSequence()}` as OperationId;
        const operation = new OperationHandleImpl(id, spec, this.stopSignal, () => {
            this.#operations.delete(id);
            this.#notifyChanged();
        });
        this.#operations.set(id, {id, label: spec.label, waiterSettled: () => operation.waiterSettled});
        return operation;
    }

    close(request: CloseRequest = {}): Promise<CloseResult> {
        if (this.#phase === "closed") {
            return Promise.resolve(this.#finalResult());
        }
        if (this.#phase === "stopping") {
            return this.#currentAttempt().promise;
        }
        this.#setPhase("stopping");
        this.#stopController.abort(abortReason(`作用域 ${this.id} 正在停止`));
        return this.#startAttempt(request.deadline, "sync");
    }

    recover(request: CloseRequest = {}): Promise<CloseResult> {
        if (this.#phase === "closed") {
            return Promise.resolve(this.#finalResult());
        }
        if (this.#phase !== "stopping") {
            throw this.#stateError("恢复关闭", "只有停止中的作用域才有可恢复的关闭尝试");
        }
        const attempt = this.#currentAttempt();
        if (!attempt.settled) {
            return attempt.promise;
        }
        return this.#startAttempt(request.deadline, "sync");
    }

    snapshot(): ScopeSnapshot {
        return {
            instanceId: this.instanceId,
            scopeId: this.id,
            parentId: this.parentId,
            label: this.label,
            phase: this.#phase,
            children: [...this.#children].map((child) => child.id),
            resources: [...this.#resources.values()].map((entry) => ({
                id: entry.id,
                kind: entry.kind,
                label: entry.label,
                late: entry.late,
                status: entry.status,
                dependsOn: [...entry.dependsOn],
                borrowerScopeIds: [...entry.borrows].map((borrow) => borrow.borrower.id),
            })),
            pendingAcquisitions: this.#pendingAcquisitionReports(),
            inFlightOperations: this.#inFlightOperationReports(),
            borrows: [...this.#borrows.values()].map((borrow) => ({
                id: borrow.id,
                resourceId: borrow.resource.id,
                ownerScopeId: borrow.resource.owner.id,
                released: borrow.released,
            })),
            failures: [...this.#failures],
            closeAttempts: this.#attemptCount,
            lastClose: this.#lastClose,
        };
    }

    #assertAlive(action: string): void {
        if (this.#phase !== "creating" && this.#phase !== "available") {
            throw this.#stateError(action);
        }
    }

    #stateError(action: string, detail?: string): LifecycleStateError {
        return new LifecycleStateError({
            instanceId: this.instanceId,
            scopeId: this.id,
            phase: this.#phase,
            action,
            detail,
        });
    }

    #isDescendantOf(ancestor: ScopeImpl): boolean {
        for (let current = this.#parent; current !== null; current = current.#parent) {
            if (current === ancestor) {
                return true;
            }
        }
        return false;
    }

    #setPhase(to: ScopePhase): void {
        const from = this.#phase;
        this.#phase = to;
        const change = {
            sequence: this.#context.nextSequence(),
            instanceId: this.instanceId,
            scopeId: this.id,
            from,
            to,
        };
        this.#emit((observer) => observer.phaseChanged?.(change));
    }

    #emit(callback: (observer: LifecycleObserver) => void): void {
        const observer = this.#context.observer;
        if (observer === undefined) {
            return;
        }
        try {
            callback(observer);
        } catch {
            // 观察者是诊断通道，它的异常不得改变机制状态或中断收口。
        }
    }

    #recordFailure(stage: FailureStage, resourceId: ResourceId | null, attempt: CloseAttempt | null, error: unknown): void {
        const failure: LifecycleFailure = {
            sequence: this.#context.nextSequence(),
            instanceId: this.instanceId,
            scopeId: this.id,
            phase: this.#phase,
            stage,
            attempt: attempt?.number ?? null,
            resourceId,
            error: summarizeFailure(error),
        };
        this.#failures.push(failure);
        attempt?.failures.push(failure);
        this.#emit((observer) => observer.failureRecorded?.(failure));
    }

    #notifyChanged(): void {
        const current = this.#changed;
        this.#changed = Promise.withResolvers<void>();
        current.resolve();
    }

    #resolveDependencies(dependencies: ReadonlyArray<ReleaseDependency> | undefined): ReadonlyArray<NodeId> {
        if (dependencies === undefined) {
            return [];
        }
        const ids: NodeId[] = [];
        for (const dependency of dependencies) {
            const resource = ResourceHandleImpl.unwrap(dependency);
            if (resource !== undefined) {
                if (resource.owner !== this) {
                    throw new TypeError(`资源 ${resource.id} 不属于作用域 ${this.id}；跨作用域依赖必须先借用，再以借用句柄声明`);
                }
                ids.push(resource.id);
                continue;
            }
            const borrow = BorrowHandleImpl.unwrap(dependency);
            if (borrow !== undefined) {
                if (borrow.borrower !== this) {
                    throw new TypeError(`借用 ${borrow.id} 不属于作用域 ${this.id}`);
                }
                ids.push(borrow.id);
                continue;
            }
            throw new TypeError("依赖必须是本机制签发的资源句柄或借用句柄");
        }
        return ids;
    }

    #addResource<T>(input: {
        readonly kind: string;
        readonly label: string;
        readonly value: T;
        readonly release: ReleaseResource<T>;
        readonly dependsOn: ReadonlyArray<NodeId>;
    }): ResourceEntry<T> {
        const entry = new ResourceEntry<T>({
            owner: this,
            id: `resource-${this.#context.nextSequence()}` as ResourceId,
            kind: input.kind,
            label: input.label,
            // stopping 期间的登记是迟到资源：登记只为收口，不再对外发布。
            late: this.#phase === "stopping",
            value: input.value,
            dependsOn: input.dependsOn,
            release: input.release,
        });
        this.#resources.set(entry.id, entry);
        return entry;
    }

    #pendingAcquisitionReports(): PendingAcquisitionReport[] {
        return [...this.#pendingAcquisitions.values()].map((acquisition) => ({...acquisition}));
    }

    #inFlightOperationReports(): InFlightOperationReport[] {
        return [...this.#operations.values()].map((operation) => ({
            id: operation.id,
            label: operation.label,
            waiterSettled: operation.waiterSettled(),
        }));
    }

    #currentAttempt(): CloseAttempt {
        const attempt = this.#latestAttempt;
        if (attempt === null) {
            // 不变量：进入 stopping 的唯一路径是 close()，它总会先登记一次尝试。
            throw new Error(`作用域 ${this.id} 处于停止中却没有关闭尝试`);
        }
        return attempt;
    }

    #finalResult(): CloseResult {
        const result = this.#lastClose;
        if (result === null || result.status !== "closed") {
            // 不变量：phase 只在 #settle 写入 closed 结果之后才变成 closed。
            throw new Error(`作用域 ${this.id} 已关闭却没有关闭完成结果`);
        }
        return result;
    }

    #attemptInProgress(): boolean {
        return this.#latestAttempt !== null && !this.#latestAttempt.settled;
    }

    /** 借用者仍可能自行释放借用：存活，或正处于一次在途关闭尝试。 */
    #isActiveBorrower(): boolean {
        return this.#phase === "creating" || this.#phase === "available" || this.#attemptInProgress();
    }

    #startAttempt(deadline: AbortSignal | undefined, execution: AttemptExecution): Promise<CloseResult> {
        this.#attemptCount += 1;
        const resolvers = Promise.withResolvers<CloseResult>();
        const attempt: CloseAttempt = {
            number: this.#attemptCount,
            promise: resolvers.promise,
            failures: [],
            settled: false,
        };
        this.#latestAttempt = attempt;
        // 新尝试让本作用域重新成为活跃借用者，通知 owner 与父作用域重新评估。
        this.#notifyRelated();
        // 先同步登记整棵子树，再安排子作用域执行，避免提供方在借用者登记前开始释放。
        this.#advanceChildren(deadline);
        const run = (): void => {
            void this.#runAttempt(attempt, deadline).then(resolvers.resolve, resolvers.reject);
        };
        if (execution === "queued") {
            queueMicrotask(run);
        } else {
            // 保留原有调用方时序：当前作用域在 close()/recover() 返回前就开始释放规划。
            run();
        }
        return attempt.promise;
    }

    async #runAttempt(attempt: CloseAttempt, deadline: AbortSignal | undefined): Promise<CloseResult> {
        const gate = createDeadlineGate(deadline);
        const attempted = new Set<NodeId>();
        try {
            // 子作用域已在启动尝试的同步段登记；这里等待其收口与本作用域的在途工作。
            while (!gate.expired && !this.#readyToRelease()) {
                if ((await gate.race(this.#changed.promise)) === DEADLINE) {
                    break;
                }
            }
            // 按波次释放：每轮重新规划，直到没有可发起、可等待与在途的节点。
            while (!gate.expired) {
                const plan = computeReleasePlan(this.#planNodes(attempted));
                for (const id of plan.releasable) {
                    this.#launchRelease(id, attempt, attempted);
                }
                if (plan.releasable.length > 0) {
                    continue;
                }
                if (plan.waiting.length === 0 && plan.inFlight.length === 0) {
                    break;
                }
                if ((await gate.race(this.#changed.promise)) === DEADLINE) {
                    break;
                }
            }
            return this.#settle(attempt, attempted, gate.expired);
        } finally {
            gate.dispose();
        }
    }

    #advanceChildren(deadline: AbortSignal | undefined): void {
        for (const child of this.#children) {
            if (child.#phase === "creating" || child.#phase === "available") {
                child.#closeFromCascade(deadline);
            } else if (child.#phase === "stopping" && !child.#attemptInProgress()) {
                // 父作用域的显式关闭/恢复是子作用域的显式恢复；本次尝试只级联一次，不循环重试。
                child.#recoverFromCascade(deadline);
            }
        }
    }

    #closeFromCascade(deadline: AbortSignal | undefined): void {
        this.#setPhase("stopping");
        this.#stopController.abort(abortReason(`作用域 ${this.id} 正在停止`));
        void this.#startAttempt(deadline, "queued");
    }

    #recoverFromCascade(deadline: AbortSignal | undefined): void {
        void this.#startAttempt(deadline, "queued");
    }

    #childBlocksRelease(child: ScopeImpl): boolean {
        if (child.#phase === "closed") {
            return false;
        }
        return child.#phase !== "stopping" || child.#attemptInProgress();
    }

    #readyToRelease(): boolean {
        if (this.#pendingAcquisitions.size > 0 || this.#operations.size > 0) {
            return false;
        }
        for (const child of this.#children) {
            if (this.#childBlocksRelease(child)) {
                return false;
            }
        }
        return true;
    }

    #planNodes(attempted: ReadonlySet<NodeId>): ReleasePlanNode<NodeId, ScopeId>[] {
        const nodes: ReleasePlanNode<NodeId, ScopeId>[] = [];
        for (const entry of this.#resources.values()) {
            nodes.push({
                id: entry.id,
                status: entry.status,
                dependsOn: entry.dependsOn,
                attempted: attempted.has(entry.id),
                borrowers: [...entry.borrows].map((borrow) => ({
                    scopeId: borrow.borrower.id,
                    active: borrow.borrower.#isActiveBorrower(),
                })),
            });
        }
        for (const borrow of this.#borrows.values()) {
            nodes.push({
                id: borrow.id,
                status: borrow.released ? "released" : "registered",
                dependsOn: [],
                attempted: attempted.has(borrow.id),
                borrowers: [],
            });
        }
        return nodes;
    }

    #launchRelease(id: NodeId, attempt: CloseAttempt, attempted: Set<NodeId>): void {
        attempted.add(id);
        if (isBorrowId(id)) {
            this.#borrows.get(id)?.release();
            return;
        }
        const entry = this.#resources.get(id);
        if (entry === undefined) {
            return;
        }
        entry.status = "releasing";
        new Promise<void>((resolve) => resolve(entry.runRelease()))
            .then(
                () => {
                    entry.status = "released";
                },
                (error: unknown) => {
                    entry.status = "release-failed";
                    this.#recordFailure("release", entry.id, attempt, error);
                },
            )
            .then(() => this.#notifyChanged());
    }

    #settle(attempt: CloseAttempt, attempted: ReadonlySet<NodeId>, expired: boolean): CloseResult {
        const resources = [...this.#resources.values()];
        const borrows = [...this.#borrows.values()];
        const unclosedChildren = [...this.#children].map((child) => child.id);
        const allReleased =
            resources.every((entry) => entry.status === "released") && borrows.every((borrow) => borrow.released);
        const gateOpen =
            this.#pendingAcquisitions.size === 0 &&
            this.#operations.size === 0 &&
            unclosedChildren.length === 0 &&
            allReleased;

        let result: CloseResult;
        if (gateOpen) {
            result = {status: "closed", scopeId: this.id, attempt: attempt.number};
            this.#setPhase("closed");
            if (this.#parent !== null) {
                this.#parent.#children.delete(this);
            }
        } else {
            if (expired) {
                const error = new Error("关闭截止信号已触发，本次关闭未完成");
                error.name = "DeadlineExceeded";
                this.#recordFailure("close", null, attempt, error);
            }
            const failedResources = resources.filter((entry) => entry.status === "release-failed").map((entry) => entry.id);
            const plan = computeReleasePlan(this.#planNodes(attempted));
            result = {
                status: "incomplete",
                scopeId: this.id,
                attempt: attempt.number,
                reason: expired ? "deadline" : failedResources.length > 0 ? "release-failed" : "blocked",
                failedResources,
                pendingReleases: resources.filter((entry) => entry.status === "releasing").map((entry) => entry.id),
                blockedReleases: plan.blocked.map((node) => ({
                    target: node.id,
                    blockedBy: [...node.blockedBy],
                    blockedByBorrowers: [...node.blockedByBorrowers],
                })),
                borrowedResources: resources
                    .filter((entry) => entry.borrows.size > 0)
                    .map((entry) => ({
                        resourceId: entry.id,
                        borrowerScopeIds: [...entry.borrows].map((borrow) => borrow.borrower.id),
                    })),
                unreleasedBorrows: borrows.filter((borrow) => !borrow.released).map((borrow) => borrow.id),
                pendingAcquisitions: this.#pendingAcquisitionReports(),
                inFlightOperations: this.#inFlightOperationReports(),
                unclosedChildren,
                failures: [...attempt.failures],
            };
        }
        this.#lastClose = result;
        attempt.settled = true;
        this.#notifyChanged();
        this.#notifyRelated();
        return result;
    }

    /** 本作用域的活跃状态变化会影响父作用域的门禁与被借用资源 owner 的规划。 */
    #notifyRelated(): void {
        if (this.#parent !== null) {
            this.#parent.#notifyChanged();
        }
        for (const borrow of this.#borrows.values()) {
            if (!borrow.released) {
                borrow.resource.owner.#notifyChanged();
            }
        }
    }
}
