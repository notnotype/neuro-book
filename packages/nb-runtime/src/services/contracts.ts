/**
 * runtime.services 的公开合同：服务键、声明、装配报告、解析结果与诊断。
 *
 * 只有类型；没有可执行副作用。行为合同见 docs/specs/runtime/services.md。
 */

import type {FailureError, ReleaseDependency, ResourceId, RuntimeLocation, Scope, ScopeId} from "../lifecycle/lifecycle";

export type {FailureError} from "../lifecycle/lifecycle";

declare const serviceType: unique symbol;

/**
 * 类型化服务键：稳定标识一项能力合同。键以对象身份比较，不以 name 比较；
 * `name` 只用于诊断。用 `defineServiceKey<T>(name)` 创建。
 */
export interface ServiceKey<T> {
    readonly name: string;
    readonly [serviceType]?: T;
}

/** 装配内入口（提供者或消费者）的稳定身份，由声明方给定，同一装配内唯一。 */
export type EntryId = string;

export interface ServiceDependency {
    readonly key: ServiceKey<unknown>;
    /** 默认 true。必需依赖缺失或失败会拒绝本入口及其必需消费者闭包；可选缺失只让该能力不可用。 */
    readonly required?: boolean;
}

export interface ResolveOptions {
    /** 只结束本次等待；不取消共享初始化，不影响其他等待者。 */
    readonly signal?: AbortSignal;
}

/**
 * 某入口在某作用域内的依赖访问。解析取得的借用登记在 `scope` 上：`scope` 关闭时借用自动结束，
 * 提供者 owner 关闭时会等待它。
 */
export interface ServiceAccess {
    readonly entryId: EntryId;
    readonly scope: Scope;
    /** 只允许解析入口声明过的键；结果联合，不抛。 */
    resolve<T>(key: ServiceKey<T>, options?: ResolveOptions): Promise<ResolveResult<T>>;
}

export interface ServiceCreateContext {
    /**
     * 本次初始化专属的服务作用域（提供者 owner 作用域的子作用域）：`create` 期间登记到这里的资源
     * 随初始化失败整体收口；成功后与实例同寿命。实例释放所依赖的东西在 `release(instance)` 内
     * 按序关闭，不要单独登记。
     */
    readonly scope: Scope;
    /**
     * 必需依赖已在 `create` 调用前解析完成，`require` 直接取实例；可选依赖不因声明而初始化，
     * 由 `resolve` 按需取得，结果登记为服务作用域上的借用。
     */
    readonly services: ServiceAccess & {require<T>(key: ServiceKey<T>): T};
    /** 服务作用域的停止信号；提供者 owner 停止时触发。 */
    readonly signal: AbortSignal;
}

export interface ProviderDeclaration<T> {
    readonly id: EntryId;
    readonly key: ServiceKey<T>;
    readonly location: RuntimeLocation;
    /** 实例 owner 作用域；只有该作用域及其后代上的入口能解析到本提供者。 */
    readonly scope: Scope;
    readonly dependencies?: ReadonlyArray<ServiceDependency>;
    /** 首次解析时才调用；登记、报告与状态查询都不调用它。 */
    readonly create: (context: ServiceCreateContext) => T | Promise<T>;
    readonly release?: (instance: T) => void | Promise<void>;
}

export interface ConsumerDeclaration {
    readonly id: EntryId;
    readonly location: RuntimeLocation;
    /** 消费者所在作用域；只能解析该作用域或其祖先上的提供者。 */
    readonly scope: Scope;
    readonly dependencies: ReadonlyArray<ServiceDependency>;
}

export type DeclarationRejection = "duplicate-id" | "unknown-key" | "location-mismatch" | "foreign-scope" | "scope-not-alive";

export type DeclareResult =
    | {readonly status: "accepted"; readonly id: EntryId}
    | {readonly status: "rejected"; readonly id: EntryId; readonly reason: DeclarationRejection};

/** 静态依赖检查对一条依赖边的判定。 */
export type DependencyVerdict =
    | {readonly status: "satisfied"; readonly key: string; readonly required: boolean; readonly providerId: EntryId}
    | {readonly status: "missing"; readonly key: string; readonly required: boolean}
    /** 提供者存在，但只声明在更短寿命的作用域上；不隐式解析。 */
    | {readonly status: "unreachable"; readonly key: string; readonly required: boolean; readonly providerIds: ReadonlyArray<EntryId>}
    | {readonly status: "conflict"; readonly key: string; readonly required: boolean; readonly providerIds: ReadonlyArray<EntryId>}
    | {readonly status: "provider-rejected"; readonly key: string; readonly required: boolean; readonly providerId: EntryId};

export type EntryProblem =
    | {readonly kind: "conflict"; readonly key: string; readonly providerIds: ReadonlyArray<EntryId>}
    | {readonly kind: "cycle"; readonly path: ReadonlyArray<EntryId>}
    | {readonly kind: "missing-required"; readonly key: string}
    | {readonly kind: "rejected-dependency"; readonly key: string; readonly providerId: EntryId};

export interface EntryReport {
    readonly id: EntryId;
    readonly kind: "provider" | "consumer";
    /** 提供者的服务键名；消费者为 null。 */
    readonly key: string | null;
    readonly scopeId: ScopeId;
    readonly dependencies: ReadonlyArray<DependencyVerdict>;
    readonly problems: ReadonlyArray<EntryProblem>;
    /** 无问题即 usable；可选依赖缺失不构成问题。 */
    readonly verdict: "usable" | "rejected";
}

/** 纯查询结果：不实例化、不触发副作用；只含当前存活作用域上已接受的声明。 */
export interface AssemblyReport {
    readonly entries: ReadonlyArray<EntryReport>;
}

/** 一次成功解析指向的精确代次。 */
export interface ServiceBinding {
    readonly key: string;
    readonly providerId: EntryId;
    /** 承载实例的服务作用域；每次初始化尝试新建，是代次身份。 */
    readonly serviceScopeId: ScopeId;
    readonly resourceId: ResourceId;
    /** 借用句柄：消费者把依赖该服务的资源登记到访问作用域时用它声明 `dependsOn`。 */
    readonly dependency: ReleaseDependency;
    /** 代次已离开可用（提供者停止、收口或换代）即 true；旧绑定不自动改投新代次。 */
    readonly stale: boolean;
    /** 提前结束本次借用；幂等。访问作用域关闭时自动结束。 */
    release(): void;
}

export type UnavailableReason =
    | "entry-rejected"
    | "undeclared-dependency"
    | "missing-provider"
    | "scope-lifetime"
    | "conflict"
    | "provider-rejected"
    | "dependency-cycle"
    | "dependency-unavailable"
    | "initialization-failed"
    | "provider-stopped"
    | "consumer-stopped"
    | "cancelled";

export interface Unavailable {
    readonly status: "unavailable";
    readonly key: string;
    readonly reason: UnavailableReason;
    readonly providerId: EntryId | null;
    /** 初始化异常摘要；只含 name/message。 */
    readonly error: FailureError | null;
    /** 依赖环或依赖失败链上的入口。 */
    readonly path: ReadonlyArray<EntryId>;
}

export type ResolveResult<T> = {readonly status: "resolved"; readonly instance: T; readonly binding: ServiceBinding} | Unavailable;

export type ProviderState = "unresolved" | "initializing" | "available" | "failed" | "stopped";

export type RecoverResult =
    | {readonly status: "reset"; readonly providerId: EntryId}
    | {readonly status: "not-failed"; readonly providerId: EntryId; readonly state: ProviderState}
    /** 上次服务作用域收口仍未完成（释放失败或被阻塞）；本次已重试一次收口，不自动循环。 */
    | {readonly status: "closeout-incomplete"; readonly providerId: EntryId; readonly serviceScopeId: ScopeId};

export type DiagnosticStage = "declare" | "initialize" | "resolve" | "recover";

/** 装配诊断：只含位置、作用域、服务键、阶段与原因，不含实例值、声明附加字段或凭据。 */
export interface AssemblyDiagnostic {
    readonly sequence: number;
    readonly instanceId: string;
    readonly location: RuntimeLocation;
    readonly scopeId: ScopeId | null;
    readonly key: string | null;
    readonly entryId: EntryId | null;
    readonly stage: DiagnosticStage;
    readonly reason: string;
    readonly error: FailureError | null;
}

export interface AssemblyObserver {
    diagnosticRecorded?(diagnostic: AssemblyDiagnostic): void;
}

export interface ServiceAssembly {
    readonly instanceId: string;
    readonly location: RuntimeLocation;
    /** 键是否在受信登记表中；纯查询，供上层在登记前预检声明。 */
    hasKey(key: ServiceKey<unknown>): boolean;
    /** 登记声明；被拒绝的声明不进入依赖图，只留诊断。登记不实例化任何服务。 */
    declare<T>(declaration: ProviderDeclaration<T>): DeclareResult;
    declare(declaration: ConsumerDeclaration): DeclareResult;
    report(): AssemblyReport;
    /** 未接受或已不存在的入口返回 null。 */
    providerState(providerId: EntryId): ProviderState | null;
    /**
     * 取得某入口的依赖访问。消费者缺省用其专属子作用域；提供者必须给出 `scope`（create 上下文的
     * 服务作用域或其子作用域）。给出的 `scope` 必须是入口声明作用域的严格后代（例如操作级作用域），
     * 否则抛 TypeError：这阻止把实例捕获进更长寿命的作用域。
     */
    access(entryId: EntryId, scope?: Scope): ServiceAccess;
    /** 显式恢复稳定失败的提供者：上次服务作用域收口完成才重置为未解析；不自动重新初始化。 */
    recover(providerId: EntryId): Promise<RecoverResult>;
    diagnostics(): ReadonlyArray<AssemblyDiagnostic>;
}

export interface ServiceAssemblyOptions {
    /** 受信服务键登记表；声明只能引用这里的键。 */
    readonly keys: ReadonlyArray<ServiceKey<unknown>>;
    readonly observer?: AssemblyObserver;
}
