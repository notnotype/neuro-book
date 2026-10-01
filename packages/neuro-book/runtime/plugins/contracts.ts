/**
 * runtime.plugins 的公开合同：插件定义、贡献接收者、目录、激活结果与诊断。
 *
 * 只有类型和唯一会抛出的错误类；行为合同见 docs/specs/runtime/plugins.md。
 */

import type {FailureError, RuntimeLocation, Scope, ScopeId} from "../lifecycle/lifecycle";
import type {EntryId, ResolveOptions, ResolveResult, ServiceDependency, ServiceKey} from "../services/services";

export type {FailureError} from "../lifecycle/lifecycle";

/** 插件入口的稳定身份：插件 id + 入口 id。 */
export interface EntryRef {
    readonly plugin: string;
    readonly entry: string;
}

/** 向某类能力提交的静态声明；描述与执行实现分离，登记阶段不携带实现。 */
export interface ContributionDeclaration<Declaration = unknown> {
    /** 接收者能力 id；宿主必须登记了同名接收者。 */
    readonly capability: string;
    /** 同一能力内、同一运行位置上唯一。 */
    readonly id: string;
    readonly declaration: Declaration;
}

/** 已进入目录的贡献描述。 */
export interface ContributionDescriptor<Declaration = unknown> extends ContributionDeclaration<Declaration> {
    readonly plugin: string;
    readonly entry: string;
    readonly location: RuntimeLocation;
}

/** 入口激活期间可用的上下文。 */
export interface ActivationContext {
    readonly plugin: string;
    readonly entry: string;
    readonly generation: number;
    /**
     * 本代次的入口工作作用域：激活期间创建的连接、订阅、句柄登记到这里，
     * 随激活失败整体收口，成功后与本代次同寿命；身份以激活结果的 scopeId 为准。
     */
    readonly scope: Scope;
    /** 激活作用域的停止信号；入口 owner 停止时触发，迟到的成功不会发布。 */
    readonly signal: AbortSignal;
    readonly services: {
        /** 必需依赖已在激活前解析完成；未声明或可选的键抛 TypeError。 */
        require<T>(key: ServiceKey<T>): T;
        /** 只允许解析入口声明过的键；借用登记到 context.scope，可用于该作用域资源的 dependsOn。 */
        resolve<T>(key: ServiceKey<T>, options?: ResolveOptions): Promise<ResolveResult<T>>;
    };
}

/** 激活产出的一项对外提供服务；用 `provide(key, instance, release?)` 构造。 */
export interface ProvidedService {
    readonly key: ServiceKey<unknown>;
    readonly instance: unknown;
    release?(instance: unknown): void | Promise<void>;
}

/** 入口激活的产出：每个声明的贡献与提供项都必须给出实现，缺失即激活失败，不接受占位。 */
export interface ActivationOutput {
    /** capability → contribution id → 实现。 */
    readonly contributions?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    readonly services?: ReadonlyArray<ProvidedService>;
}

export type ActivationEvent = "onStartup";

export interface PluginEntryDefinition {
    /** 插件内唯一。 */
    readonly id: string;
    readonly location: RuntimeLocation;
    readonly activationEvents?: ReadonlyArray<ActivationEvent>;
    readonly dependencies?: ReadonlyArray<ServiceDependency>;
    /** 描述登记阶段即向 runtime.services 声明的提供项；实例化归激活。 */
    readonly provides?: ReadonlyArray<ServiceKey<unknown>>;
    readonly contributions?: ReadonlyArray<ContributionDeclaration>;
    /** 只在激活时调用；登记、目录查询与状态查询都不调用它。 */
    activate(context: ActivationContext): ActivationOutput | Promise<ActivationOutput>;
}

/** 随产品发布的静态描述；不是已激活实例。 */
export interface PluginDefinition {
    readonly id: string;
    readonly entries: ReadonlyArray<PluginEntryDefinition>;
}

/**
 * 接收者持有的贡献句柄。业务调用必须在调用时经 `implementation()` 取实现：事务提交并发布前、
 * 失败撤回后、正常关闭后它都抛 PluginStateError；接收者不得在 prepare 阶段缓存实现绕过门禁。
 */
export interface ContributionHandle<Declaration = unknown, Implementation = unknown> {
    readonly capability: string;
    readonly id: string;
    readonly plugin: string;
    readonly entry: string;
    readonly generation: number;
    readonly declaration: Declaration;
    /** 事务提交并发布后为 true；撤回后为 false 且不再变回。 */
    readonly published: boolean;
    implementation(): Implementation;
}

export type RevokeReason = "activation-failed" | "activation-stopped" | "scope-closed";

/**
 * 贡献接收者：某类能力的 owner。校验在登记阶段，准备与提交在激活事务内，撤回在失败回滚
 * 与正常关闭时；prepare/commit 抛出即事务失败，revoke 的异常只记诊断，不改变机制状态。
 */
export interface ContributionReceiver<Declaration = unknown, Implementation = unknown, Prepared = unknown> {
    readonly capability: string;
    /** 登记阶段校验描述；返回拒绝原因或 null。不得产生副作用。 */
    validate?(descriptor: ContributionDescriptor<Declaration>): string | null;
    /** 激活事务：准备本次暂存项并返回它；此时 `handle.implementation()` 仍不可用。 */
    prepare?(handle: ContributionHandle<Declaration, Implementation>): Prepared | Promise<Prepared>;
    /** 全部接收者准备成功后按声明顺序提交。 */
    commit?(handle: ContributionHandle<Declaration, Implementation>, prepared: Prepared): void | Promise<void>;
    /** 撤回本次暂存或已发布项；按声明逆序调用，必须幂等。 */
    revoke?(handle: ContributionHandle<Declaration, Implementation>, prepared: Prepared, reason: RevokeReason): void | Promise<void>;
}

export type RegistrationRejectionReason =
    | "empty-id"
    | "no-entries"
    | "duplicate-plugin"
    | "duplicate-entry"
    | "duplicate-service"
    | "unknown-receiver"
    | "duplicate-contribution"
    | "invalid-declaration"
    | "unknown-service-key"
    | "foreign-service-id"
    | "reserved-service-name"
    | "self-dependency"
    | "foreign-scope"
    | "scope-not-alive";

export interface RegistrationRejection {
    readonly reason: RegistrationRejectionReason;
    readonly entry: string | null;
    readonly capability: string | null;
    readonly contribution: string | null;
    readonly detail: string | null;
}

export type RegisterPluginResult =
    | {readonly status: "accepted"; readonly plugin: string; readonly entries: ReadonlyArray<string>}
    /** 整个定义被拒绝：不登记任何入口，不留下部分声明。 */
    | {readonly status: "rejected"; readonly plugin: string; readonly rejections: ReadonlyArray<RegistrationRejection>};

export type ActivationStage = "dependencies" | "activate" | "output" | "prepare" | "commit";

export type ActivationFailureReason =
    | "dependency-unavailable"
    | "activation-threw"
    | "missing-implementation"
    | "missing-service"
    | "undeclared-service"
    | "receiver-prepare-failed"
    | "receiver-commit-failed";

export interface ActivationFailed {
    readonly status: "failed";
    readonly plugin: string;
    readonly entry: string;
    readonly generation: number;
    readonly stage: ActivationStage;
    readonly reason: ActivationFailureReason;
    readonly capability: string | null;
    readonly contribution: string | null;
    /** 依赖失败时的服务键名。 */
    readonly key: string | null;
    readonly error: FailureError | null;
    /** 依赖失败链上的 runtime.services 入口。 */
    readonly path: ReadonlyArray<EntryId>;
}

export type ActivationRejection = "unknown-entry" | "location-mismatch" | "scope-closed" | "blocked";

export type ActivationResult =
    | {readonly status: "activated"; readonly plugin: string; readonly entry: string; readonly generation: number; readonly scopeId: ScopeId}
    | ActivationFailed
    /** 激活期间 owner 停止：迟到的成功不发布，本次暂存项已撤回。 */
    | {readonly status: "stopped"; readonly plugin: string; readonly entry: string; readonly generation: number}
    /** 只结束本等待方；共享激活继续。 */
    | {readonly status: "cancelled"; readonly plugin: string; readonly entry: string}
    | {readonly status: "rejected"; readonly plugin: string; readonly entry: string; readonly reason: Exclude<ActivationRejection, "blocked">}
    | {readonly status: "rejected"; readonly plugin: string; readonly entry: string; readonly reason: "blocked"; readonly blocked: EntryBlocked};

export type EntryBlockedReason = "missing-service" | "location-mismatch" | "provider-blocked" | "provider-failed" | "dependency-cycle";

export interface EntryBlocked {
    readonly reason: EntryBlockedReason;
    readonly key: string;
    /** 插件/入口身份；环路径包含首尾相同的入口。 */
    readonly path: ReadonlyArray<string>;
}

export type EntryStatus = "foreign-location" | "registered" | "blocked" | "activating" | "available" | "failed" | "stopping" | "closed";

export interface EntryState {
    readonly plugin: string;
    readonly entry: string;
    readonly location: RuntimeLocation;
    readonly status: EntryStatus;
    /** 当前代次；从未激活为 null。 */
    readonly generation: number | null;
    readonly scopeId: ScopeId | null;
    readonly failure: ActivationFailed | null;
    readonly blocked: EntryBlocked | null;
    /** 本代次激活作用域的收口结果；未开始收口为 null。 */
    readonly closeout: "pending" | "closed" | "incomplete" | null;
}

export type ContributionState<Declaration = unknown, Implementation = unknown> = {
    readonly capability: string;
    readonly id: string;
    readonly plugin: string;
    readonly entry: string;
    readonly location: RuntimeLocation;
    readonly declaration: Declaration;
} & (
    | {readonly status: "declared"; readonly reason: "not-activated" | "scope-closed"}
    | {readonly status: "activating"; readonly generation: number}
    | {readonly status: "available"; readonly generation: number; readonly implementation: Implementation}
    | {readonly status: "activation-failed"; readonly generation: number; readonly failure: ActivationFailed}
    | {readonly status: "revoked"; readonly generation: number; readonly reason: "activation-stopped" | "scope-closed"}
);

export interface EntryDescription {
    readonly plugin: string;
    readonly entry: string;
    readonly location: RuntimeLocation;
    readonly dependencies: ReadonlyArray<{readonly key: string; readonly required: boolean}>;
    /** 对外提供的服务键名。 */
    readonly provides: ReadonlyArray<string>;
    readonly contributions: ReadonlyArray<ContributionState>;
    readonly state: EntryState;
}

export interface PluginDescription {
    readonly id: string;
    readonly scopeId: ScopeId;
    readonly summary: "available" | "partial" | "blocked";
    readonly entries: ReadonlyArray<EntryDescription>;
}

/** 纯查询：不创建资源、不触发激活或业务副作用。 */
export interface PluginCatalog {
    readonly plugins: ReadonlyArray<PluginDescription>;
}

export type RecoverEntryResult =
    | {readonly status: "reset"; readonly plugin: string; readonly entry: string; readonly generation: number}
    | {readonly status: "not-failed"; readonly plugin: string; readonly entry: string; readonly state: EntryStatus}
    /** 上次激活作用域或其服务作用域收口仍未完成；本次已重试一次收口，不自动循环。 */
    | {readonly status: "closeout-incomplete"; readonly plugin: string; readonly entry: string; readonly scopeId: ScopeId}
    | {readonly status: "rejected"; readonly plugin: string; readonly entry: string; readonly reason: "unknown-entry" | "scope-closed"};

export type PluginDiagnosticStage = "register" | "activate" | "publish" | "revoke" | "recover" | "close";

/** 插件诊断：只含身份、阶段与原因摘要，不含实现、声明附加字段或凭据。 */
export interface PluginDiagnostic {
    readonly sequence: number;
    readonly instanceId: string;
    readonly location: RuntimeLocation;
    readonly plugin: string | null;
    readonly entry: string | null;
    readonly generation: number | null;
    readonly stage: PluginDiagnosticStage;
    readonly reason: string;
    readonly capability: string | null;
    readonly contribution: string | null;
    readonly error: FailureError | null;
}

export interface PluginObserver {
    diagnosticRecorded?(diagnostic: PluginDiagnostic): void;
}

export interface PluginHost {
    readonly instanceId: string;
    readonly location: RuntimeLocation;
    /**
     * 登记描述：校验身份、接收者、服务键与作用域，并向 runtime.services 声明本位置入口的依赖与
     * 提供项。不创建运行资源、不调用 activate。同一插件在其登记作用域关闭前不能重复登记。
     */
    register(definition: PluginDefinition, options: {readonly scope: Scope}): RegisterPluginResult;
    catalog(): PluginCatalog;
    /** 未登记的入口返回 null。 */
    entryState(ref: EntryRef): EntryState | null;
    /** 本位置目录里的贡献；未登记返回 null。查询不触发激活。 */
    contribution<Declaration = unknown, Implementation = unknown>(capability: string, id: string): ContributionState<Declaration, Implementation> | null;
    /** 触发或加入该入口在其登记作用域上的激活；`signal` 只结束本等待方。 */
    activate(ref: EntryRef, options?: {readonly signal?: AbortSignal}): Promise<ActivationResult>;
    /** 显式恢复稳定失败的入口：上次收口完成才重置；不自动重新激活。 */
    recover(ref: EntryRef): Promise<RecoverEntryResult>;
    diagnostics(): ReadonlyArray<PluginDiagnostic>;
}

export interface PluginHostOptions {
    readonly receivers: ReadonlyArray<ContributionReceiver>;
    readonly observer?: PluginObserver;
}

/** 贡献未发布或已撤回时取实现、以及向 runtime.services 交付未激活成功的实例时抛出。 */
export class PluginStateError extends Error {
    readonly plugin: string;
    readonly entry: string;
    readonly generation: number | null;
    readonly reason: string;

    constructor(input: {readonly plugin: string; readonly entry: string; readonly generation: number | null; readonly reason: string; readonly detail?: string}) {
        const detail = input.detail === undefined ? "" : `：${input.detail}`;
        super(`插件入口 ${input.plugin}/${input.entry}${input.generation === null ? "" : `#${input.generation}`} ${input.reason}${detail}`);
        this.name = "PluginStateError";
        this.plugin = input.plugin;
        this.entry = input.entry;
        this.generation = input.generation;
        this.reason = input.reason;
    }
}
