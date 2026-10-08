/**
 * runtime.plugins 的公开合同：插件定义、贡献接收者、目录、激活结果与诊断。
 *
 * 只有类型和唯一会抛出的错误类；行为合同见 docs/specs/runtime/plugins.md。
 */

import type {FailureError, RuntimeLocation, Scope, ScopeId} from "../lifecycle/lifecycle";
import type {RemoteAccess, RemoteContract, RemoteHostBinding, RemoteProvision, RemoteUse} from "../remote/remote";
import type {ConsumerIdentity, EntryId, ResolveOptions, ResolveResult, ServiceDependency, ServiceKey} from "../services/services";

export type {FailureError} from "../lifecycle/lifecycle";

/** 插件入口的稳定身份：插件 id + 入口 id。 */
export interface EntryRef {
    readonly plugin: string;
    readonly entry: string;
}

/** 向某个贡献点提交的静态声明；描述与执行实现分离，登记阶段不携带实现。 */
export interface ContributionDeclaration<Declaration = unknown> {
    /** 贡献点 id。 */
    readonly capability: string;
    /** 同一贡献点内的稳定身份。 */
    readonly id: string;
    readonly declaration: Declaration;
}

/** 已进入目录的贡献描述；顶层声明的 entry 为 null。 */
export interface ContributionDescriptor<Declaration = unknown> extends ContributionDeclaration<Declaration> {
    readonly plugin: string;
    readonly entry: string | null;
    readonly location: RuntimeLocation;
}

/** 此刻校验为已接受的贡献声明（runtime.plugins 输出第 23 条）：按存活登记推导，不缓存、不产生诊断。 */
export interface ContributionDeclarations {
    /** 该贡献点上这个 id 的已接受声明；没有、被拒或待定为 null。 */
    get<Declaration = unknown>(capability: string, id: string): ContributionDescriptor<Declaration> | null;
    /** 该贡献点的全部已接受声明，按贡献 id 的码元顺序。 */
    list<Declaration = unknown>(capability: string): ReadonlyArray<ContributionDescriptor<Declaration>>;
}

/** 由拥有者插件定义的贡献点。 */
export interface ContributionPointDefinition<Declaration = unknown> {
    /** 在全部存活登记中唯一，例如 "workbench.view"。 */
    readonly id: string;
    /** required：贡献写在入口下并给出实现；none：只有顶层声明。 */
    readonly implementation: "required" | "none";
    /**
     * 纯函数，只看这一条声明本身，返回拒绝原因或 null；查不到别的贡献，所以一条声明的接受与否不随别处的登记变化
     * （runtime.plugins 输出第 23 条）。
     */
    validate?(descriptor: ContributionDescriptor<Declaration>): string | null;
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
    /**
     * 跨实例调用与订阅远程服务（docs/specs/runtime/plugin-channel.md）。宿主没有配置远程节点时，
     * 调用一律得到 `unavailable`。
     */
    readonly remote: PluginRemoteAccess;
    /** 此刻已接受的贡献声明（runtime.plugins 输出第 23 条），与贡献点校验函数拿到的是同一个查询。 */
    readonly declarations: ContributionDeclarations;
    readonly services: {
        /** 必需依赖已在激活前解析完成；未声明或可选的键抛 TypeError。 */
        require<T>(key: ServiceKey<T>): T;
        /** 只允许解析入口声明过的键；借用登记到 context.scope，可用于该作用域资源的 dependsOn。 */
        resolve<T>(key: ServiceKey<T>, options?: ResolveOptions): Promise<ResolveResult<T>>;
    };
}

declare const providedType: unique symbol;

/**
 * 激活产出的一项对外提供服务；用 `provide(key, instance, release?)` 构造。类型参数只在编译期，供 `defineEntry`
 * 核对服务类型。
 */
export interface ProvidedService<T = unknown> {
    readonly key: ServiceKey<unknown>;
    readonly instance: unknown;
    release?(instance: unknown): void | Promise<void>;
    readonly [providedType]?: T;
}

/** 入口激活的产出：当前有效的入口贡献与所有提供项必须给出实现，接收者与 receives 完全一致。 */
export interface ActivationOutput {
    /** contribution point id → contribution id → implementation。 */
    readonly contributions?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    readonly services?: ReadonlyArray<ProvidedService>;
    /** 本入口声明的贡献点接收者；键必须与 `receives` 完全一致。 */
    readonly receivers?: Readonly<Record<string, ContributionReceiver>>;
    /** 本入口的远程提供项（`provideRemote`）；合同必须与 `remoteProvides` 完全一致（按 id 核对）。 */
    readonly remote?: ReadonlyArray<RemoteProvision>;
}

/**
 * `onStartup`，或 `<前缀>:<参数>`。前缀归声明它的插件（`activationEventPrefixes`），只有拥有者能触发；
 * 内核保留前缀 `onRemote`（远程服务首次被调用时激活提供它的入口）。见 runtime.plugins 输出第 21 条。
 */
export type ActivationEvent = string;

export interface PluginEntryDefinition {
    /** 插件内唯一。 */
    readonly id: string;
    readonly location: RuntimeLocation;
    readonly activationEvents?: ReadonlyArray<ActivationEvent>;
    readonly dependencies?: ReadonlyArray<ServiceDependency>;
    /** 描述登记阶段即向 runtime.services 声明的提供项；实例化归激活。 */
    readonly provides?: ReadonlyArray<ServiceKey<unknown>>;
    /** 本入口接收的、由本插件定义的贡献点。 */
    readonly receives?: ReadonlyArray<string>;
    /** 本入口提供的远程服务合同；首次远程调用时按需激活本入口（onRemote）。 */
    readonly remoteProvides?: ReadonlyArray<RemoteContract>;
    /**
     * 本入口可代表调用方调用的远程服务合同（经 `context.remote.on`，runtime.plugins 输出第 20 条）；
     * 只对代理允许清单里的插件生效。
     */
    readonly remoteDelegates?: ReadonlyArray<RemoteContract>;
    /** 入口激活后向贡献点提交的声明。 */
    readonly contributions?: ReadonlyArray<ContributionDeclaration>;
    /** 只在激活时调用；登记、目录查询与状态查询都不调用它。 */
    activate(context: ActivationContext): ActivationOutput | Promise<ActivationOutput>;
}

/** 激活上下文里的 `remote`：本入口以自己的身份访问远程服务，代理入口另可以调用方的身份访问。 */
export interface PluginRemoteAccess extends RemoteAccess {
    /**
     * 跨实例委托（runtime/plugin-channel.md 输出第 10 条）：在本入口交出的按调用方门面里，以收到的调用方身份
     * 发出远程调用与订阅，提供方看到原调用方、`via` 为本入口。合同必须在 `remoteDelegates` 里，插件必须在
     * 宿主的代理允许清单内，`consumer` 必须是装配签发给本入口门面、且签发它的门面还没释放的身份；不满足时
     * 调用与订阅得到 `denied`。经它建立的远程门面与订阅在签发它的门面释放（释放函数结束之后）时结束。
     */
    on(consumer: ConsumerIdentity): DelegatedRemoteAccess;
}

export interface DelegatedRemoteAccess {
    use<Contract extends RemoteContract>(contract: Contract): RemoteUse<Contract>;
}

/**
 * 插件描述：插件包一级的身份、版本与有入口的运行位置，写在插件目录的 `plugin.ts`。宿主按它装配各运行位置的
 * 入口、核对两端的插件集合；内核登记的是各运行位置的插件定义，不读它。插件清单文件实现后
 * （docs/specs/runtime/plugin-manifest.md）由清单生成。
 */
export interface PluginDescriptor {
    readonly id: string;
    /** semver。 */
    readonly version: string;
    readonly locations: ReadonlyArray<RuntimeLocation>;
}

/** 随产品发布的静态描述；不是已激活实例。 */
export interface PluginDefinition {
    readonly id: string;
    /** 本插件拥有的激活事件前缀，例如 `onCommand`；只有拥有者能触发 `<前缀>:<参数>`。 */
    readonly activationEventPrefixes?: ReadonlyArray<string>;
    readonly contributionPoints?: ReadonlyArray<ContributionPointDefinition>;
    /** 只有声明、没有入口实现的贡献。 */
    readonly contributions?: ReadonlyArray<ContributionDeclaration>;
    readonly entries: ReadonlyArray<PluginEntryDefinition>;
}

/**
 * 接收者持有的贡献句柄。业务调用必须在调用时经 implementation() 取实现：事务提交并发布前、
 * 任一侧停止或撤回后它都抛 PluginStateError；接收者不得缓存实现绕过门禁。顶层声明始终没有实现。
 */
export interface ContributionHandle<Declaration = unknown, Implementation = unknown> {
    readonly capability: string;
    readonly id: string;
    readonly plugin: string;
    /** 顶层声明没有入口，因此为 null。 */
    readonly entry: string | null;
    readonly generation: number;
    /** entry：入口实现；plugin：顶层声明。 */
    readonly kind: "entry" | "plugin";
    readonly declaration: Declaration;
    /** 整批交付与贡献方发布后为 true；prepare 期间、任一侧停止或撤回后为 false。 */
    readonly published: boolean;
    implementation(): Implementation;
}

export type RevokeReason = "activation-failed" | "activation-stopped" | "scope-closed" | "receiver-closed" | "delivery-failed";

/**
 * 贡献接收者：由拥有者入口在激活产出中提供（runtime.plugins 输出第 24 条）。prepare 预占或否决，抛出即事务失败；
 * published 时生效；revoke 的异常只记诊断，不改变机制状态，同一接收者连接上的回调串行。
 */
export interface ContributionReceiver<Declaration = unknown, Implementation = unknown, Prepared = unknown> {
    /** 激活或补交事务的暂存项：预占资源或否决这一项；此时 implementation 不可用。 */
    prepare?(handle: ContributionHandle<Declaration, Implementation>): Prepared | Promise<Prepared>;
    /** 撤回本次暂存或已发布项：还没 published 的只释放预占；按声明逆序调用，必须幂等。 */
    revoke?(handle: ContributionHandle<Declaration, Implementation>, prepared: Prepared, reason: RevokeReason): void | Promise<void>;
    /**
     * 这一项已发布：贡献方的激活事务发布、或补交完成且贡献方已发布之后，每条已交付项调用一次，此后
     * `implementation()` 可用。接收者在这里让贡献生效（挂路由、登记命令）；prepare 之后贡献方的激活还可能失败
     * 撤回，所以不在 prepare 里生效。抛错只记诊断。
     */
    published?(handle: ContributionHandle<Declaration, Implementation>, prepared: Prepared): void;
}

export type RegistrationRejectionReason =
    | "empty-id"
    | "no-entries"
    | "duplicate-plugin"
    | "duplicate-entry"
    | "duplicate-service"
    | "unknown-contribution-point"
    | "duplicate-receiver"
    | "duplicate-contribution-point"
    | "foreign-service-id"
    | "reserved-service-name"
    | "self-dependency"
    | "foreign-scope"
    | "scope-not-alive"
    | "invalid-activation-prefix"
    | "reserved-activation-prefix";

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

export type ActivationStage = "dependencies" | "activate" | "output" | "prepare";

export type ActivationFailureReason =
    | "dependency-unavailable"
    | "activation-threw"
    | "missing-implementation"
    | "missing-service"
    | "undeclared-service"
    | "missing-receiver"
    | "undeclared-receiver"
    | "missing-remote"
    | "undeclared-remote"
    | "remote-location-mismatch"
    | "receiver-prepare-failed";

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

export type ContributionValidation =
    | {readonly status: "accepted"}
    | {readonly status: "pending"; readonly reason: "unknown-point"}
    | {
        readonly status: "rejected";
        readonly reason: "invalid-declaration" | "implementation-required" | "implementation-not-accepted" | "duplicate-contribution";
        readonly detail: string | null;
    };

export type ContributionDelivery =
    | {readonly status: "waiting-receiver"}
    | {readonly status: "delivered"; readonly receiver: EntryRef & {readonly generation: number}}
    | {readonly status: "delivery-failed"; readonly receiver: EntryRef & {readonly generation: number}; readonly error: FailureError | null};

export type ContributionState<Declaration = unknown, Implementation = unknown> = {
    readonly capability: string;
    readonly id: string;
    readonly plugin: string;
    readonly entry: string | null;
    readonly location: RuntimeLocation;
    readonly kind: "entry" | "plugin";
    readonly declaration: Declaration;
    readonly validation: ContributionValidation;
    readonly delivery: ContributionDelivery;
} & (
    | {readonly status: "declared"; readonly reason: "not-activated" | "scope-closed"}
    | {readonly status: "activating"; readonly generation: number}
    | {readonly status: "available"; readonly generation: number; readonly implementation: Implementation}
    | {readonly status: "activation-failed"; readonly generation: number; readonly failure: ActivationFailed}
    | {readonly status: "revoked"; readonly generation: number; readonly reason: "activation-stopped" | "scope-closed"}
);

export interface ContributionPointDescription {
    readonly id: string;
    readonly implementation: "required" | "none";
}

export interface EntryDescription {
    readonly plugin: string;
    readonly entry: string;
    readonly location: RuntimeLocation;
    readonly dependencies: ReadonlyArray<{readonly key: string; readonly required: boolean}>;
    /** 对外提供的服务键名。 */
    readonly provides: ReadonlyArray<string>;
    readonly receives: ReadonlyArray<string>;
    readonly contributions: ReadonlyArray<ContributionState>;
    readonly state: EntryState;
}

export interface PluginDescription {
    readonly id: string;
    readonly scopeId: ScopeId;
    readonly summary: "available" | "partial" | "blocked";
    readonly contributionPoints: ReadonlyArray<ContributionPointDescription>;
    readonly contributions: ReadonlyArray<ContributionState>;
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

export type TriggerActivationResult =
    | {readonly status: "triggered"; readonly event: ActivationEvent; readonly results: ReadonlyArray<ActivationResult>}
    /**
     * invalid-event：不是 `<前缀>:<参数>`；reserved-prefix：内核保留的前缀；not-prefix-owner：发起者不是
     * 前缀的存活拥有者；prefix-conflict：两个以上存活插件声明了同一前缀，两者都不生效。
     */
    | {readonly status: "rejected"; readonly event: ActivationEvent; readonly reason: "invalid-event" | "reserved-prefix" | "not-prefix-owner" | "prefix-conflict"};

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
     * 登记描述：校验身份、贡献点结构、服务键与作用域，并向 runtime.services 声明本位置入口的依赖与
     * 提供项。不创建运行资源、不调用 activate。同一插件在其登记作用域关闭前不能重复登记。
     */
    register(definition: PluginDefinition, options: {readonly scope: Scope}): RegisterPluginResult;
    catalog(): PluginCatalog;
    /** 未登记的入口返回 null。 */
    entryState(ref: EntryRef): EntryState | null;
    /** 本位置目录里的贡献；返回稳定排序后的全部声明，未登记返回空数组，查询不触发激活。 */
    contribution<Declaration = unknown, Implementation = unknown>(capability: string, id: string): ReadonlyArray<ContributionState<Declaration, Implementation>>;
    /** 触发或加入该入口在其登记作用域上的激活；signal 只结束本等待方。 */
    activate(ref: EntryRef, options?: {readonly signal?: AbortSignal}): Promise<ActivationResult>;
    /** 显式恢复稳定失败的入口：上次收口完成才重置；不自动重新激活。 */
    recover(ref: EntryRef): Promise<RecoverEntryResult>;
    /**
     * 拥有者触发自己前缀下的激活事件：激活本位置声明了该事件的全部入口，逐个返回激活结果（复用
     * `activate` 的合并语义）。`requester` 是发起触发的插件 id，必须是前缀唯一的存活拥有者。
     */
    triggerActivationEvent(event: ActivationEvent, options: {readonly requester: string; readonly signal?: AbortSignal}): Promise<TriggerActivationResult>;
    diagnostics(): ReadonlyArray<PluginDiagnostic>;
}

export interface PluginHostOptions {
    readonly observer?: PluginObserver;
    /** 代理允许清单：返回 true 的插件才能委托解析；不给时一律不允许。第一版只给内置插件。 */
    readonly delegation?: (pluginId: string) => boolean;
    /** 本实例的远程节点；宿主据此提供 `context.remote`，并作为远程提供项的来源接入节点。 */
    readonly remote?: RemoteHostBinding;
}

/** 贡献未发布或已撤回时取实现、以及向 runtime.services 交付未激活成功的实例时抛出。 */
export class PluginStateError extends Error {
    readonly plugin: string;
    readonly entry: string;
    readonly generation: number | null;
    readonly reason: string;

    constructor(input: {readonly plugin: string; readonly entry: string | null; readonly generation: number | null; readonly reason: string; readonly detail?: string}) {
        const detail = input.detail === undefined ? "" : `：${input.detail}`;
        super(`插件入口 ${input.plugin}/${input.entry ?? "<plugin>"}${input.generation === null ? "" : `#${input.generation}`} ${input.reason}${detail}`);
        this.name = "PluginStateError";
        this.plugin = input.plugin;
        this.entry = input.entry ?? "<plugin>";
        this.generation = input.generation;
        this.reason = input.reason;
    }
}
