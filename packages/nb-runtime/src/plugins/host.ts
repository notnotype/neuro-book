/**
 * runtime.plugins 的实现：描述目录、按入口 single-flight 的激活、贡献接上与交付账本、
 * 与 runtime.services 的提供项协作、稳定失败与显式恢复。
 *
 * 代次作用域保持 plugin:<id>/<entry>#<n> 身份，持有必需依赖借用与入口收口资源；工作子作用域
 * 承载 context.scope 资源、显式解析借用、服务租约、激活产出与贡献。工作作用域的受管操作在
 * 停止时等待服务实例首次释放结算，防止提供方先清理自己的资源；租约保留失败供显式恢复。
 * 发布资源依赖激活产出，贡献先撤回。代次确认工作与服务全部关闭后记录 closed，最后结束
 * 必需依赖借用，使依赖者的全部资源释放先于提供者。
 *
 * 贡献点只由拥有者插件定义。接收者存在于拥有者入口的激活产出中；贡献不进入 services
 * 依赖图，拥有者缺席时贡献保持等待接收者。所有接收者回调经过同一连接的串行锁。
 */

import {LifecycleStateError, summarizeFailure} from "../lifecycle/lifecycle";
import type {CloseResult, FailureError, ReleaseDependency, RuntimeInstance, RuntimeLocation, Scope} from "../lifecycle/lifecycle";
import type {ChainLink, ProviderDescription, ProviderLookup, RemoteAccess, RemoteHostBinding, RemoteProvision} from "../remote/remote";
import type {ConsumerIdentity, EntryId, ServiceAssembly, ServiceCreateContext, ServiceKey} from "../services/services";

import {PluginStateError} from "./contracts";
import type {
    ActivationContext,
    ActivationEvent,
    ActivationFailed,
    ActivationFailureReason,
    ActivationOutput,
    ContributionDeclaration,
    ContributionDeclarations,
    ContributionDescriptor,
    ContributionDelivery,
    ContributionHandle,
    ContributionPointDefinition,
    ContributionReceiver,
    ContributionState,
    DelegatedRemoteAccess,
    ContributionValidation,
    ProvidedService,
    ActivationResult,
    ActivationStage,
    EntryDescription,
    EntryRef,
    EntryBlocked,
    EntryState,
    EntryStatus,
    PluginCatalog,
    PluginDefinition,
    TriggerActivationResult,
    PluginDiagnostic,
    PluginDiagnosticStage,
    PluginEntryDefinition,
    PluginHost,
    PluginHostOptions,
    PluginObserver,
    PluginRemoteAccess,
    RecoverEntryResult,
    RegisterPluginResult,
    RevokeReason,
} from "./contracts";
import {KERNEL_ACTIVATION_PREFIXES, parseActivationEvent, validateDefinition} from "./registration";
import {deriveBlocked, entryIdentity} from "./blocked";

const CANCELLED: unique symbol = Symbol("cancelled");

type DeliveryMode = "activation" | "backfill";
type AttemptOutcome = {readonly status: "activated"} | {readonly status: "failed"; readonly failure: ActivationFailed} | {readonly status: "stopped"};

type DeliveryFailure = {
    readonly handle: HandleImpl;
    readonly error: FailureError;
};

type DeliveryAttemptResult =
    | {readonly status: "ok"}
    | {readonly status: "failed"; readonly failure: DeliveryFailure}
    | {readonly status: "stopped"};

function isAlive(scope: Scope): boolean {
    return scope.phase === "creating" || scope.phase === "available";
}

/** 等待共享结果；`signal` 只结束本等待方。 */
function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof CANCELLED> {
    if (signal === undefined) {
        return promise;
    }
    if (signal.aborted) {
        return Promise.resolve(CANCELLED);
    }
    const {promise: waiting, resolve} = Promise.withResolvers<T | typeof CANCELLED>();
    const onAbort = (): void => resolve(CANCELLED);
    signal.addEventListener("abort", onAbort, {once: true});
    void promise.then(resolve, () => resolve(CANCELLED)).finally(() => signal.removeEventListener("abort", onAbort));
    return waiting;
}

class HandleImpl implements ContributionHandle {
    readonly capability: string;
    readonly id: string;
    readonly plugin: string;
    readonly entry: string | null;
    readonly generation: number;
    readonly kind: "entry" | "plugin";
    readonly declaration: unknown;
    readonly #implementation: unknown;
    readonly #source: HandleImpl | undefined;
    readonly #isAlive: () => boolean;
    #published = false;
    /** 发布后撤回或从未发布即失败/停止时的原因；null 表示仍在事务中或已发布。 */
    withdrawn: RevokeReason | null = null;

    constructor(input: {
        readonly capability: string;
        readonly id: string;
        readonly plugin: string;
        readonly entry: string | null;
        readonly generation: number;
        readonly kind: "entry" | "plugin";
        readonly declaration: unknown;
        readonly implementation: unknown;
        readonly source?: HandleImpl;
        readonly isAlive?: () => boolean;
    }) {
        this.capability = input.capability;
        this.id = input.id;
        this.plugin = input.plugin;
        this.entry = input.entry;
        this.generation = input.generation;
        this.kind = input.kind;
        this.declaration = input.declaration;
        this.#implementation = input.implementation;
        this.#source = input.source;
        this.#isAlive = input.isAlive ?? (() => true);
    }

    get published(): boolean {
        return this.#published && this.#isAlive() && (this.#source?.published ?? true);
    }

    set published(value: boolean) {
        this.#published = value;
    }

    implementation(): unknown {
        if (this.kind === "plugin") {
            throw new PluginStateError({
                plugin: this.plugin,
                entry: null,
                generation: null,
                reason: "顶层声明没有实现",
                detail: `${this.capability}:${this.id}`,
            });
        }
        if (!this.published) {
            throw new PluginStateError({
                plugin: this.plugin,
                entry: this.entry,
                generation: this.generation,
                reason: this.withdrawn === null ? "贡献尚未发布" : `贡献已撤回（${this.withdrawn}）`,
                detail: `${this.capability}:${this.id}`,
            });
        }
        return this.#source === undefined ? this.#implementation : this.#source.implementation();
    }
}

interface ProvidedRecord {
    /** 记录来自激活产出里的哪一项：清理按产出项对账，同一实例在别的产出项里出现不算。 */
    readonly output: ProvidedService;
    readonly key: ServiceKey<unknown>;
    readonly instance: unknown;
    readonly release: ((instance: unknown) => void | Promise<void>) | undefined;
    /** 已交付给 runtime.services 的服务作用域：由它释放实例，激活产出的释放跳过。 */
    adopted: boolean;
    released: boolean;
}

interface Attempt {
    readonly generation: number;
    /** 触发这次激活的远程请求的激活链；不是远程请求触发的为空。 */
    readonly triggerChain: ReadonlyArray<ChainLink>;
    readonly scope: Scope;
    readonly work: Scope;
    readonly services: Set<Scope>;
    readonly outcome: Promise<AttemptOutcome>;
    settled: AttemptOutcome | null;
    handles: ReadonlyArray<HandleImpl>;
    readonly handlesByContribution: Map<ContributionRecord, HandleImpl>;
    readonly deliveries: Set<DeliveryRecord>;
    readonly connections: ReceiverConnection[];
    /** 服务 id → 本代次交出的提供项。 */
    provided: ReadonlyMap<string, ProvidedRecord>;
    /** 本代次交出的远程提供项：合同 id → 提供项。 */
    remote: ReadonlyMap<string, RemoteProvision>;
    readonly releasedOutputs: Set<ProvidedService>;
    /** 失败时发起的收口；停止与正常关闭由 lifecycle 级联推进，不在这里记录。 */
    closeout: Promise<CloseResult> | null;
    closeoutResult: CloseResult | null;
}

interface EntryRecord {
    readonly plugin: string;
    readonly definition: PluginEntryDefinition;
    readonly scope: Scope;
    readonly activatable: boolean;
    readonly consumerId: EntryId;
    /** 服务 id → 本入口在装配里的提供者 id。 */
    readonly providerIds: ReadonlyMap<string, EntryId>;
    readonly contributions: ReadonlyArray<ContributionRecord>;
    current: Attempt | null;
}

interface PluginRecord {
    readonly id: string;
    readonly scope: Scope;
    /** 本插件拥有的激活事件前缀。 */
    readonly prefixes: ReadonlyArray<string>;
    readonly points: ReadonlyMap<string, ContributionPointDefinition>;
    readonly entries: ReadonlyMap<string, EntryRecord>;
    contributions: ReadonlyArray<ContributionRecord>;
}

interface ContributionRecord {
    readonly key: string;
    readonly plugin: PluginRecord;
    entry: EntryRecord | null;
    readonly definition: ContributionDeclaration;
    readonly kind: "entry" | "plugin";
    readonly location: RuntimeLocation;
    readonly deliveries: DeliveryRecord[];
}

interface ReceiverConnection {
    readonly id: string;
    readonly point: string;
    readonly owner: EntryRecord;
    readonly attempt: Attempt;
    readonly receiver: ContributionReceiver;
    readonly deliveries: Map<string, DeliveryRecord>;
    tail: Promise<void>;
    closed: boolean;
    closeout: Promise<void> | null;
}

interface DeliveryPlan {
    readonly connection: ReceiverConnection;
    readonly contribution: ContributionRecord;
    readonly handle: HandleImpl;
    readonly sourceAttempt: Attempt | null;
}

interface DeliveryRecord {
    readonly key: string;
    readonly contribution: ContributionRecord;
    readonly handle: HandleImpl;
    readonly connection: ReceiverConnection;
    readonly sourceAttempt: Attempt | null;
    prepared: unknown;
    preparedSuccessfully: boolean;
    state: "preparing" | "delivered" | "failed" | "revoked";
    revoked: boolean;
    /** 已调用过接收者的 `published`：每条交付只通知一次。 */
    notified: boolean;
    error: FailureError | null;
}

export class PluginHostImpl implements PluginHost {
    readonly instanceId: string;
    readonly location: RuntimeLocation;
    readonly #client: string | null;
    readonly #assembly: ServiceAssembly;
    readonly #observer: PluginObserver | undefined;
    readonly #delegation: ((pluginId: string) => boolean) | null;
    readonly #remote: RemoteHostBinding | null;
    readonly #plugins = new Map<string, PluginRecord>();
    /** 贡献目录：贡献点 id + 贡献 id → 全部当前登记，重复判定不区分运行位置。 */
    readonly #contributions = new Map<string, ContributionRecord[]>();
    /** 激活上下文里的声明查询（runtime.plugins 输出第 23 条）；校验函数拿不到它，所以推导不会递归。 */
    readonly #declarations: ContributionDeclarations = {
        get: <Declaration>(capability: string, id: string): ContributionDescriptor<Declaration> | null => {
            const live = this.#liveContributions(capability, id);
            const only = live.length === 1 ? live[0] : undefined;
            return only !== undefined && this.#validation(only).status === "accepted" ? (this.#descriptorOf(only) as ContributionDescriptor<Declaration>) : null;
        },
        list: <Declaration>(capability: string): ReadonlyArray<ContributionDescriptor<Declaration>> => {
            const accepted: ContributionDescriptor<Declaration>[] = [];
            for (const records of this.#contributions.values()) {
                for (const record of records) {
                    if (record.definition.capability === capability && this.#isLive(record) && this.#validation(record).status === "accepted") {
                        accepted.push(this.#descriptorOf(record) as ContributionDescriptor<Declaration>);
                    }
                }
            }
            return accepted.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
        },
    };
    readonly #connections = new Map<string, ReceiverConnection>();
    /** 代次跨登记单调递增：重新启用得到新代次，旧代次身份不复用。 */
    readonly #generations = new Map<string, number>();
    readonly #diagnostics: PluginDiagnostic[] = [];
    #registrations = 0;
    #sequence = 0;
    #contributionSequence = 0;
    #connectionSequence = 0;

    constructor(instance: RuntimeInstance, assembly: ServiceAssembly, options: PluginHostOptions) {
        this.instanceId = instance.identity.instanceId;
        this.location = instance.identity.location;
        this.#client = instance.identity.client ?? null;
        this.#assembly = assembly;
        this.#observer = options.observer;
        this.#delegation = options.delegation ?? null;
        this.#remote = options.remote ?? null;
        this.#remote?.attach({
            lookup: (contractId, chain, signal) => this.#lookupRemote(contractId, chain, signal),
            describe: (contractId) => this.#describeRemote(contractId),
        });
    }

    register(definition: PluginDefinition, options: {readonly scope: Scope}): RegisterPluginResult {
        const rejections = validateDefinition(definition, {
            location: this.location,
            contributionPointTaken: (id) => {
                for (const plugin of this.#plugins.values()) {
                    if (plugin.scope.phase !== "closed" && plugin.points.has(id)) return true;
                }
                return false;
            },
        });
        const existing = this.#plugins.get(definition.id);
        if (existing !== undefined && existing.scope.phase !== "closed") {
            rejections.push({reason: "duplicate-plugin", entry: null, capability: null, contribution: null, detail: null});
        }
        if (options.scope.instanceId !== this.instanceId) {
            rejections.push({reason: "foreign-scope", entry: null, capability: null, contribution: null, detail: null});
        } else if (!isAlive(options.scope)) {
            rejections.push({reason: "scope-not-alive", entry: null, capability: null, contribution: null, detail: null});
        }
        if (rejections.length > 0) {
            for (const item of rejections) {
                this.#record("register", item.reason, {plugin: definition.id, entry: item.entry, capability: item.capability, contribution: item.contribution});
            }
            return {status: "rejected", plugin: definition.id, rejections};
        }

        this.#registrations += 1;
        const points = new Map<string, ContributionPointDefinition>();
        for (const point of definition.contributionPoints ?? []) {
            points.set(point.id, point);
        }
        const entries = new Map<string, EntryRecord>();
        const allContributions: ContributionRecord[] = [];
        const pluginRecord: PluginRecord = {
            id: definition.id,
            scope: options.scope,
            prefixes: definition.activationEventPrefixes ?? [],
            points,
            entries,
            contributions: allContributions,
        };
        const registered: string[] = [];

        for (const entry of definition.entries) {
            const activatable = entry.location === this.location;
            const consumerId = `plugin:${definition.id}/${entry.id}@${this.#registrations}`;
            const providerIds = new Map<string, EntryId>();
            const contributions = (entry.contributions ?? []).map((declaration) => {
                const record = this.#createContribution(pluginRecord, declaration, "entry", entry.location);
                allContributions.push(record);
                return record;
            });
            const record: EntryRecord = {
                plugin: definition.id,
                definition: entry,
                scope: options.scope,
                activatable,
                consumerId,
                providerIds,
                contributions,
                current: null,
            };
            for (const contribution of contributions) {
                contribution.entry = record;
            }
            entries.set(entry.id, record);
            if (!activatable) {
                continue;
            }
            registered.push(entry.id);
            const dependencies = entry.dependencies ?? [];
            const identity = {plugin: definition.id, entry: entry.id};
            this.#declare(this.#assembly.declare({id: consumerId, identity, location: this.location, scope: options.scope, dependencies}));
            for (const key of entry.provides ?? []) {
                const providerId = `${consumerId}:${key.name}`;
                providerIds.set(key.name, providerId);
                this.#declare(this.#assembly.declare({
                    id: providerId,
                    identity,
                    key,
                    location: this.location,
                    scope: options.scope,
                    dependencies,
                    create: (context) => this.#provide(record, key, context),
                    release: (instance) => this.#releaseProvided(record, key, instance),
                }));
            }
        }

        const topLevel = (definition.contributions ?? []).map((declaration) => {
            const record = this.#createContribution(pluginRecord, declaration, "plugin", this.location);
            allContributions.push(record);
            return record;
        });
        pluginRecord.contributions = allContributions;
        this.#plugins.set(definition.id, pluginRecord);
        for (const contribution of allContributions) {
            const identity = this.#contributionIdentity(contribution.definition.capability, contribution.definition.id);
            const records = this.#contributions.get(identity) ?? [];
            records.push(contribution);
            this.#contributions.set(identity, records);
        }
        if (topLevel.length > 0) {
            options.scope.register({
                kind: "top-level-contributions",
                label: definition.id,
                value: topLevel,
                release: (records) => this.#revokeTopLevel(records),
            });
        }
        this.#diagnoseActivationEvents(pluginRecord, definition);
        return {status: "accepted", plugin: definition.id, entries: registered};
    }

    catalog(): PluginCatalog {
        const blocked = this.#blocked();
        const plugins = [...this.#plugins.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((plugin) => {
            const entries = [...plugin.entries.values()].map((record) => this.#describe(record, blocked));
            const local = entries.filter((entry) => entry.location === this.location);
            const unavailable = local.filter((entry) => entry.state.status === "blocked" || entry.state.status === "failed").length;
            const summary = unavailable === 0 ? "available" : unavailable === local.length ? "blocked" : "partial";
            return {
                id: plugin.id,
                scopeId: plugin.scope.id,
                summary,
                contributionPoints: [...plugin.points.values()].map((point) => ({id: point.id, implementation: point.implementation})),
                contributions: plugin.contributions.filter((contribution) => contribution.kind === "plugin").map((contribution) => this.#contributionState(contribution)),
                entries,
            } as const;
        });
        return {plugins};
    }

    entryState(ref: EntryRef): EntryState | null {
        const record = this.#entry(ref);
        return record === null ? null : this.#stateOf(record);
    }

    contribution<Declaration, Implementation>(capability: string, id: string): ReadonlyArray<ContributionState<Declaration, Implementation>> {
        const records = (this.#contributions.get(this.#contributionIdentity(capability, id)) ?? [])
            .filter((record) => this.#plugins.get(record.plugin.id) === record.plugin)
            .sort((a, b) => {
                const left = `${a.plugin.id}/${a.entry?.definition.id ?? ""}/${a.kind}`;
                const right = `${b.plugin.id}/${b.entry?.definition.id ?? ""}/${b.kind}`;
                return left < right ? -1 : left > right ? 1 : 0;
            });
        return records.map((record) => this.#contributionState(record) as ContributionState<Declaration, Implementation>);
    }

    activate(ref: EntryRef, options: {readonly signal?: AbortSignal} = {}): Promise<ActivationResult> {
        return this.#activate(ref, options);
    }

    async #activate(ref: EntryRef, options: {readonly signal?: AbortSignal; readonly chain?: ReadonlyArray<ChainLink>}): Promise<ActivationResult> {
        const record = this.#entry(ref);
        if (record === null) {
            return {status: "rejected", plugin: ref.plugin, entry: ref.entry, reason: "unknown-entry"};
        }
        if (!record.activatable) {
            return {status: "rejected", plugin: ref.plugin, entry: ref.entry, reason: "location-mismatch"};
        }
        const blocked = record.current === null && isAlive(record.scope) ? this.#blocked().get(`${ref.plugin}/${ref.entry}`) : null;
        if (blocked != null) {
            this.#record("activate", "blocked", {plugin: ref.plugin, entry: ref.entry});
            return {status: "rejected", plugin: ref.plugin, entry: ref.entry, reason: "blocked", blocked};
        }
        const attempt = this.#attemptFor(record, options.chain);
        if (attempt === null) {
            return {status: "rejected", plugin: ref.plugin, entry: ref.entry, reason: "scope-closed"};
        }
        // 已结算且实例已离开可用（停止、关闭，或失败后 owner 已关闭）的代次不接受新触发，也不复活。
        if (attempt.settled !== null && this.#instanceClosed(record, attempt)) {
            return {status: "rejected", plugin: ref.plugin, entry: ref.entry, reason: "scope-closed"};
        }
        const outcome = await waitWithSignal(attempt.outcome, options.signal);
        if (outcome === CANCELLED) {
            return {status: "cancelled", plugin: ref.plugin, entry: ref.entry};
        }
        return this.#resultOf(record, attempt, outcome);
    }

    async triggerActivationEvent(
        event: ActivationEvent,
        options: {readonly requester: string; readonly signal?: AbortSignal},
    ): Promise<TriggerActivationResult> {
        const parsed = parseActivationEvent(event);
        if (parsed === null) {
            return {status: "rejected", event, reason: "invalid-event"};
        }
        if (KERNEL_ACTIVATION_PREFIXES.includes(parsed.prefix)) {
            return {status: "rejected", event, reason: "reserved-prefix"};
        }
        const owners = this.#prefixOwners(parsed.prefix);
        if (owners.length > 1) {
            this.#record("activate", "activation-prefix-conflict", {plugin: options.requester, capability: "activationEvents", contribution: event});
            return {status: "rejected", event, reason: "prefix-conflict"};
        }
        if (owners[0]?.id !== options.requester) {
            return {status: "rejected", event, reason: "not-prefix-owner"};
        }
        return {status: "triggered", event, results: await this.#activateByEvent(event, options.signal)};
    }

    /** 激活本位置声明了 `event` 的全部存活入口；内核保留前缀（onRemote）也经这里，不做拥有者核对。 */
    async #activateByEvent(event: ActivationEvent, signal: AbortSignal | undefined): Promise<ReadonlyArray<ActivationResult>> {
        const targets: EntryRef[] = [];
        for (const plugin of this.#plugins.values()) {
            if (!isAlive(plugin.scope)) {
                continue;
            }
            for (const entry of plugin.entries.values()) {
                if (entry.activatable && (entry.definition.activationEvents ?? []).includes(event)) {
                    targets.push({plugin: plugin.id, entry: entry.definition.id});
                }
            }
        }
        return Promise.all(targets.map((ref) => this.activate(ref, {signal})));
    }

    /**
     * 远程提供项的合同要求的提供方位置与本实例的拓扑角色不符（服务端实例的角色是 `hub`，对应 `server`）。
     * 没有远程节点的实例没有远程提供项可用，也就不核对。
     */
    #misplacedRemote(item: RemoteProvision): boolean {
        if (this.#remote === null || item.contract.provider === "any") {
            return false;
        }
        const role = this.#remote.instance.role;
        return item.contract.provider !== (role === "hub" ? "server" : role);
    }

    /** 激活上下文的 `remote`：调用方身份是这次激活；这一代结束时通知节点释放为它生成的门面。 */
    #remoteAccess(attempt: Attempt, record: EntryRecord, plugin: string, entry: string): PluginRemoteAccess {
        if (this.#remote === null) {
            const unavailable = refusedRemote("unavailable", "本实例没有配置远程节点");
            return {...unavailable, on: () => unavailable};
        }
        const remote = this.#remote;
        const consumer: ConsumerIdentity = Object.freeze({instanceId: this.instanceId, location: this.location, client: this.#client, plugin, entry, generation: attempt.generation, via: null});
        const self: ChainLink = {instanceId: this.instanceId, plugin, entry};
        const chain = (): ReadonlyArray<ChainLink> => (attempt.settled === null ? [...attempt.triggerChain, self] : []);
        const activating = (): boolean => attempt.settled === null;
        const own = remote.access({
            consumer,
            chain,
            activating,
            signal: attempt.scope.stopSignal,
            onRelease: (callback) => this.#onAttemptRelease(attempt, `${plugin}/${entry}`, callback),
        });
        // 同一个签发身份只建一次访问：它在节点里记下联系过的目标与订阅，释放时一并通知。缓存只复用访问对象，
        // 准入在 `on` 与之后每次调用、订阅时都重新核对：签发它的门面释放之后，重新取得与先前取得的客户端同样被拒。
        const delegated = new WeakMap<ConsumerIdentity, RemoteAccess>();
        const denial = (message: string): string => {
            this.#record("activate", "delegation-denied", {plugin, entry, generation: attempt.generation});
            return message;
        };
        const on = (issued: ConsumerIdentity): DelegatedRemoteAccess => {
            if (this.#delegation?.(plugin) !== true) {
                return refusedRemote("denied", denial(`插件 ${plugin} 不在代理允许清单内`));
            }
            const issue = this.#assembly.issuedTo(record.consumerId, issued);
            if (issue.status === "denied") {
                return refusedRemote("denied", denial(issue.message));
            }
            let access = delegated.get(issued);
            if (access === undefined) {
                const released = new AbortController();
                access = remote.access({
                    consumer: Object.freeze({...issued, via: Object.freeze({plugin, entry, generation: attempt.generation})}),
                    chain,
                    activating,
                    admit: () => {
                        const current = this.#assembly.issuedTo(record.consumerId, issued);
                        return current.status === "denied" ? denial(current.message) : null;
                    },
                    // 不用代理入口这一代的停止信号：运行实例停止时它与全部子作用域的停止信号同步触发，早于按依赖顺序
                    // 释放门面，而代理门面的释放函数运行期间经代理的调用必须仍可用（runtime/plugin-channel.md 输出第 10 条）。
                    signal: anySignal([issue.signal, released.signal]),
                    // 原调用方的门面释放（签发记录收口）与代理入口这一代结束，先到的一个通知节点释放。
                    onRelease: (callback) => {
                        const once = (): void => {
                            if (!released.signal.aborted) {
                                released.abort();
                                callback();
                            }
                        };
                        issue.attach(once);
                        this.#onAttemptRelease(attempt, `${plugin}/${entry} → ${issued.plugin ?? "host"}`, once);
                    },
                });
                delegated.set(issued, access);
            }
            const target = access;
            const declared = record.definition.remoteDelegates ?? [];
            return {
                use: (contract) => {
                    if (!declared.some((item) => item.id === contract.id)) {
                        return refusedRemote("denied", denial(`入口 ${plugin}/${entry} 没有声明可代理 ${contract.id}`)).use(contract);
                    }
                    return target.use(contract);
                },
            };
        };
        return {...own, on};
    }

    /** 这一代结束时调用 `callback`；已结束则立即调用。 */
    #onAttemptRelease(attempt: Attempt, label: string, callback: () => void): void {
        try {
            attempt.work.register({kind: "remote-consumer", label, value: callback, release: (release) => release()});
        } catch (error) {
            if (!(error instanceof LifecycleStateError)) {
                throw error;
            }
            callback();
        }
    }

    /**
     * 远程调用到达时找本位置提供该合同的入口；未激活就按需激活（onRemote）。多个存活入口声明同一合同时
     * 不挑选，返回不可用。
     */
    async #lookupRemote(contractId: string, chain: ReadonlyArray<ChainLink>, signal: AbortSignal): Promise<ProviderLookup> {
        const candidates = this.#remoteProviders(contractId, isAlive);
        const [record] = candidates;
        if (record === undefined) {
            // 声明它的插件正在停止（热重载或实例停止）只是此刻不可用；停用、卸载之后才是没有提供方。
            return this.#remoteProviders(contractId, (scope) => scope.phase === "stopping").length > 0
                ? {status: "unavailable", reason: `提供 ${contractId} 的插件正在停止`}
                : {status: "missing"};
        }
        if (candidates.length > 1) {
            this.#record("activate", "remote-provider-conflict", {plugin: null, capability: "remoteProvides", contribution: contractId});
            return {status: "unavailable", reason: `多个入口提供 ${contractId}`};
        }
        // 提供入口仍在激活中且在请求的激活链上：它正在（间接）等待这个请求，再等它就是等待环。链上的入口
        // 若已结算（例如它激活期间发出调用但没有等待结果），就不需要等它，照常复用或激活。
        const activating = record.current !== null && record.current.settled === null;
        if (activating && chain.some((link) => link.instanceId === this.instanceId && link.plugin === record.plugin && link.entry === record.definition.id)) {
            this.#record("activate", "activation-cycle", {plugin: record.plugin, entry: record.definition.id, capability: "remoteProvides", contribution: contractId});
            return {status: "unavailable", reason: `激活等待环：${record.plugin}/${record.definition.id} 正在激活并等待这个请求`, cause: "activation-cycle"};
        }
        const result = await this.#activate({plugin: record.plugin, entry: record.definition.id}, {signal, chain});
        if (result.status !== "activated") {
            const reason = result.status === "failed" ? `${result.stage}/${result.reason}` : result.status === "rejected" ? `rejected:${result.reason}` : result.status;
            return {status: "unavailable", reason: `提供入口 ${record.plugin}/${record.definition.id} 不可用：${reason}`};
        }
        const attempt = record.current;
        const provision = attempt?.generation === result.generation ? attempt.remote.get(contractId) : undefined;
        if (attempt === null || provision === undefined) {
            return {status: "unavailable", reason: `提供入口 ${record.plugin}/${record.definition.id} 已换代`};
        }
        return {status: "found", provision, entry: {plugin: record.plugin, entry: record.definition.id, generation: attempt.generation}, stopSignal: attempt.scope.stopSignal};
    }

    /**
     * 提供方查询：候选与 `#lookupRemote` 相同（存活插件优先，没有时看正在停止的插件），但只读静态声明与入口状态，
     * 不激活、不记诊断。
     */
    #describeRemote(contractId: string): ProviderDescription {
        const alive = this.#remoteProviders(contractId, isAlive);
        if (alive.length > 1) {
            return {status: "unavailable", reason: `多个入口提供 ${contractId}`};
        }
        const [record] = alive.length > 0 ? alive : this.#remoteProviders(contractId, (scope) => scope.phase === "stopping");
        const contract = record?.definition.remoteProvides?.find((item) => item.id === contractId);
        if (record === undefined || contract === undefined) {
            return {status: "missing"};
        }
        if (alive.length === 0) {
            return {status: "found", contract, state: "stopping"};
        }
        const {status} = this.#stateOf(record);
        // 候选都是本位置的入口，不会是 foreign-location；类型上仍要排除它。
        return status === "foreign-location" ? {status: "missing"} : {status: "found", contract, state: status};
    }

    /** 本位置在 `remoteProvides` 里声明了这份合同的入口，只看登记作用域满足 `phase` 的插件。 */
    #remoteProviders(contractId: string, phase: (scope: Scope) => boolean): EntryRecord[] {
        const found: EntryRecord[] = [];
        for (const plugin of this.#plugins.values()) {
            if (!phase(plugin.scope)) {
                continue;
            }
            for (const record of plugin.entries.values()) {
                if (record.activatable && (record.definition.remoteProvides ?? []).some((contract) => contract.id === contractId)) {
                    found.push(record);
                }
            }
        }
        return found;
    }

    #prefixOwners(prefix: string): PluginRecord[] {
        return [...this.#plugins.values()].filter((plugin) => isAlive(plugin.scope) && plugin.prefixes.includes(prefix));
    }

    /**
     * 登记时标出本位置入口里格式不对、或此刻没有存活拥有者的事件：只记诊断，不拒绝插件；拥有者之后
     * 登记时事件照常生效（触发时才核对拥有者）。激活事件的诊断以 `capability: "activationEvents"`、
     * `contribution: <事件>` 标出事件。
     */
    #diagnoseActivationEvents(plugin: PluginRecord, definition: PluginDefinition): void {
        for (const entry of definition.entries) {
            if (entry.location !== this.location) {
                continue;
            }
            for (const event of entry.activationEvents ?? []) {
                if (event === "onStartup") {
                    continue;
                }
                const parsed = parseActivationEvent(event);
                if (parsed === null) {
                    this.#record("register", "invalid-activation-event", {plugin: plugin.id, entry: entry.id, capability: "activationEvents", contribution: event});
                } else if (!KERNEL_ACTIVATION_PREFIXES.includes(parsed.prefix) && this.#prefixOwners(parsed.prefix).length === 0) {
                    this.#record("register", "unknown-activation-event", {plugin: plugin.id, entry: entry.id, capability: "activationEvents", contribution: event});
                }
            }
        }
    }

    async recover(ref: EntryRef): Promise<RecoverEntryResult> {
        const record = this.#entry(ref);
        if (record === null) {
            return {status: "rejected", plugin: ref.plugin, entry: ref.entry, reason: "unknown-entry"};
        }
        const attempt = record.current;
        if (attempt === null || attempt.settled === null || attempt.settled.status !== "failed") {
            return {status: "not-failed", plugin: ref.plugin, entry: ref.entry, state: this.#stateOf(record).status};
        }
        if (!isAlive(record.scope)) {
            return {status: "rejected", plugin: ref.plugin, entry: ref.entry, reason: "scope-closed"};
        }
        // 在途收口直接等待；已结算但未完成则重试一次，不自动循环。
        let closeout = await attempt.closeout!;
        if (closeout.status === "incomplete") {
            closeout = await attempt.scope.recover();
            attempt.closeoutResult = closeout;
            if (closeout.status === "incomplete") {
                this.#record("recover", "closeout-incomplete", {plugin: ref.plugin, entry: ref.entry, generation: attempt.generation});
                return {status: "closeout-incomplete", plugin: ref.plugin, entry: ref.entry, scopeId: attempt.scope.id};
            }
        }
        if (record.current !== attempt) {
            // 等待期间已被另一次 recover 重置。
            return {status: "not-failed", plugin: ref.plugin, entry: ref.entry, state: this.#stateOf(record).status};
        }
        for (const providerId of record.providerIds.values()) {
            const result = await this.#assembly.recover(providerId);
            if (result.status === "closeout-incomplete") {
                this.#record("recover", "service-closeout-incomplete", {plugin: ref.plugin, entry: ref.entry, generation: attempt.generation});
                return {status: "closeout-incomplete", plugin: ref.plugin, entry: ref.entry, scopeId: result.serviceScopeId};
            }
        }
        record.current = null;
        this.#record("recover", "reset", {plugin: ref.plugin, entry: ref.entry, generation: attempt.generation});
        return {status: "reset", plugin: ref.plugin, entry: ref.entry, generation: attempt.generation};
    }

    diagnostics(): ReadonlyArray<PluginDiagnostic> {
        return [...this.#diagnostics];
    }

    #contributionIdentity(capability: string, id: string): string {
        return `${capability.length}:${capability}${id}`;
    }

    #createContribution(plugin: PluginRecord, definition: ContributionDeclaration, kind: "entry" | "plugin", location: RuntimeLocation): ContributionRecord {
        return {
            key: String(++this.#contributionSequence),
            plugin,
            entry: null,
            definition,
            kind,
            location,
            deliveries: [],
        };
    }

    #pointOwner(id: string): PluginRecord | null {
        for (const plugin of this.#plugins.values()) {
            if (isAlive(plugin.scope) && plugin.points.has(id)) {
                return plugin;
            }
        }
        return null;
    }

    #pointFor(contribution: ContributionRecord): ContributionPointDefinition | null {
        return this.#pointOwner(contribution.definition.capability)?.points.get(contribution.definition.capability) ?? null;
    }

    #liveContributions(capability: string, id: string): ReadonlyArray<ContributionRecord> {
        return (this.#contributions.get(this.#contributionIdentity(capability, id)) ?? []).filter((record) => this.#isLive(record));
    }

    #isLive(record: ContributionRecord): boolean {
        return this.#plugins.get(record.plugin.id) === record.plugin && isAlive(record.plugin.scope);
    }

    #descriptorOf(contribution: ContributionRecord): ContributionDescriptor {
        return {
            ...contribution.definition,
            plugin: contribution.plugin.id,
            entry: contribution.entry?.definition.id ?? null,
            location: contribution.location,
        };
    }

    /** 按此刻的存活登记推导一条贡献的校验结果；只看这一条声明与同 id 是否重复，不缓存。 */
    #validation(contribution: ContributionRecord): ContributionValidation {
        const point = this.#pointFor(contribution);
        if (point === null) {
            return {status: "pending", reason: "unknown-point"};
        }
        if (this.#liveContributions(contribution.definition.capability, contribution.definition.id).length > 1) {
            return {status: "rejected", reason: "duplicate-contribution", detail: null};
        }
        if (point.implementation === "required" && contribution.kind === "plugin") {
            return {status: "rejected", reason: "implementation-required", detail: null};
        }
        if (point.implementation === "none" && contribution.kind === "entry") {
            return {status: "rejected", reason: "implementation-not-accepted", detail: null};
        }
        if (point.validate !== undefined) {
            try {
                const detail = point.validate(this.#descriptorOf(contribution));
                if (detail !== null) {
                    return {status: "rejected", reason: "invalid-declaration", detail};
                }
            } catch (error) {
                return {status: "rejected", reason: "invalid-declaration", detail: summarizeFailure(error).message};
            }
        }
        return {status: "accepted"};
    }

    #isEffective(contribution: ContributionRecord): boolean {
        const validation = this.#validation(contribution);
        return validation.status === "accepted" || validation.status === "pending";
    }

    #declare(result: {readonly status: "accepted" | "rejected"; readonly id: EntryId}): void {
        if (result.status === "rejected") {
            // 不变量：登记前已按同一登记表与作用域预检，services 不应再拒绝。
            throw new Error(`runtime.services 拒绝了已预检的声明 ${result.id}`);
        }
    }

    #instanceClosed(record: EntryRecord, attempt: Attempt): boolean {
        switch (attempt.settled?.status) {
            case "activated":
                return attempt.scope.phase !== "available";
            case "stopped":
                return true;
            case "failed":
                return !isAlive(record.scope);
            default:
                return false;
        }
    }

    #entry(ref: EntryRef): EntryRecord | null {
        return this.#plugins.get(ref.plugin)?.entries.get(ref.entry) ?? null;
    }

    /** 取当前尝试（在途、成功、稳定失败或已停止都复用）；没有尝试且登记作用域存活时新建一次。 */
    #attemptFor(record: EntryRecord, triggerChain: ReadonlyArray<ChainLink> = []): Attempt | null {
        if (record.current !== null) {
            return record.current;
        }
        if (!isAlive(record.scope)) {
            return null;
        }
        const generationKey = `${record.plugin}/${record.definition.id}`;
        const generation = (this.#generations.get(generationKey) ?? 0) + 1;
        this.#generations.set(generationKey, generation);
        const scope = record.scope.createChild(`plugin:${generationKey}#${generation}`);
        const work = scope.createChild("entry-work");
        work.open();
        const {promise, resolve} = Promise.withResolvers<AttemptOutcome>();
        const attempt: Attempt = {
            generation,
            triggerChain,
            scope,
            work,
            services: new Set(),
            outcome: promise,
            settled: null,
            handles: [],
            handlesByContribution: new Map(),
            deliveries: new Set(),
            connections: [],
            provided: new Map(),
            remote: new Map(),
            releasedOutputs: new Set(),
            closeout: null,
            closeoutResult: null,
        };
        record.current = attempt;
        this.#record("activate", "activation-started", {plugin: record.plugin, entry: record.definition.id, generation});
        const stopping = Promise.withResolvers<void>();
        scope.stopSignal.addEventListener("abort", () => {
            this.#record("close", "close-started", {plugin: record.plugin, entry: record.definition.id, generation});
            stopping.resolve();
        }, {once: true});
        work.accept({label: `${record.plugin}/${record.definition.id}`, run: async () => {
            await stopping.promise;
            await attempt.outcome;
            await Promise.all([...attempt.services].map((service) => service.close()));
        }});
        void this.#run(record, attempt).then((outcome) => {
            attempt.settled = outcome;
            resolve(outcome);
        });
        return attempt;
    }

    async #run(record: EntryRecord, attempt: Attempt): Promise<AttemptOutcome> {
        const {scope, generation} = attempt;
        const plugin = record.plugin;
        const entry = record.definition.id;
        const dependencies: ReleaseDependency[] = [];
        let closeoutRegistered = false;
        const registerCloseout = (): void => {
            if (closeoutRegistered || scope.phase === "closed") {
                return;
            }
            closeoutRegistered = true;
            scope.register({
                kind: "plugin-closeout",
                label: `${plugin}/${entry}`,
                value: attempt,
                dependsOn: dependencies,
                release: (current) => {
                    if (current.work.phase !== "closed" || [...current.services].some((service) => service.phase !== "closed")) {
                        throw new PluginStateError({plugin, entry, generation, reason: "入口资源收口未完成"});
                    }
                    this.#record("close", "closed", {plugin, entry, generation});
                },
            });
        };
        const fail = (
            stage: ActivationStage,
            reason: ActivationFailureReason,
            detail: {readonly capability?: string; readonly contribution?: string; readonly key?: string; readonly error?: FailureError | null; readonly path?: ReadonlyArray<EntryId>} = {},
        ): AttemptOutcome => {
            const failure: ActivationFailed = {
                status: "failed",
                plugin,
                entry,
                generation,
                stage,
                reason,
                capability: detail.capability ?? null,
                contribution: detail.contribution ?? null,
                key: detail.key ?? null,
                error: detail.error ?? null,
                path: detail.path ?? [],
            };
            this.#record("activate", reason, {plugin, entry, generation, capability: failure.capability, contribution: failure.contribution, error: failure.error});
            registerCloseout();
            attempt.closeout = scope.close().then((result) => {
                attempt.closeoutResult = result;
                return result;
            });
            return {status: "failed", failure};
        };
        const stopped = (): AttemptOutcome => {
            this.#record("activate", "activation-stopped", {plugin, entry, generation});
            registerCloseout();
            return {status: "stopped"};
        };

        // 1. 只预解析必需依赖；可选依赖由 activate 按需 resolve，不因声明而初始化。
        const access = this.#assembly.access(record.consumerId, scope, {generation});
        const required = new Map<string, unknown>();
        for (const dependency of record.definition.dependencies ?? []) {
            if (dependency.required === false) {
                continue;
            }
            const result = await access.resolve(dependency.key, {signal: scope.stopSignal});
            if (!isAlive(scope)) {
                return stopped();
            }
            if (result.status === "resolved") {
                required.set(dependency.key.name, result.instance);
                dependencies.push(result.binding.dependency);
                continue;
            }
            const path = result.path.length > 0 ? result.path : result.providerId === null ? [] : [result.providerId];
            return fail("dependencies", "dependency-unavailable", {key: dependency.key.name, error: result.error, path});
        }

        registerCloseout();
        // 2. 受管获取：激活作用域停止即 abort；迟到的产出登记为迟到资源，只收口不发布。
        const context: ActivationContext = {
            plugin,
            entry,
            generation,
            scope: attempt.work,
            signal: scope.stopSignal,
            remote: this.#remoteAccess(attempt, record, plugin, entry),
            declarations: this.#declarations,
            services: {
                require: <T>(key: ServiceKey<T>): T => {
                    if (!required.has(key.name)) {
                        throw new TypeError(`${key.name} 不是入口 ${plugin}/${entry} 已解析的必需依赖`);
                    }
                    return required.get(key.name) as T;
                },
                resolve: (key, options) => this.#assembly.access(record.consumerId, attempt.work, {generation}).resolve(key, options),
            },
        };
        let acquired;
        try {
            acquired = await attempt.work.acquire<ActivationOutput>({
                kind: "plugin-activation",
                label: `${plugin}/${entry}`,
                acquire: () => record.definition.activate(context),
                release: (output) => this.#releaseOutput(attempt, output),
            });
        } catch (error) {
            if (error instanceof LifecycleStateError) {
                return stopped();
            }
            throw error;
        }
        if (acquired.status === "failed") {
            return fail("activate", "activation-threw", {error: summarizeFailure(acquired.error)});
        }
        if (acquired.status !== "acquired") {
            return stopped();
        }

        // 3. 产出核对：提供项与 accepted/pending 入口贡献必须有实现，接收者必须与 receives 一致。
        const output = acquired.handle.value;
        const provided = new Map<string, ProvidedRecord>();
        const declaredKeys = (record.definition.provides ?? []).map((key) => key.name);
        for (const service of output.services ?? []) {
            // 同一个服务 id 只能产出一次：再出现一次与未声明同样处理，不让后一项覆盖前一项。
            if (!declaredKeys.includes(service.key.name) || provided.has(service.key.name)) {
                attempt.provided = provided;
                return fail("output", "undeclared-service", {key: service.key.name});
            }
            provided.set(service.key.name, {output: service, key: service.key, instance: service.instance, release: service.release?.bind(service), adopted: false, released: false});
        }
        attempt.provided = provided;
        for (const key of declaredKeys) {
            if (!provided.has(key)) {
                return fail("output", "missing-service", {key});
            }
        }
        const remoteDeclared = (record.definition.remoteProvides ?? []).map((contract) => contract.id);
        const remote = new Map<string, RemoteProvision>();
        for (const item of output.remote ?? []) {
            if (!remoteDeclared.includes(item.contract.id) || remote.has(item.contract.id)) {
                return fail("output", "undeclared-remote", {key: item.contract.id});
            }
            if (this.#misplacedRemote(item)) {
                return fail("output", "remote-location-mismatch", {key: item.contract.id});
            }
            remote.set(item.contract.id, item);
        }
        for (const id of remoteDeclared) {
            if (!remote.has(id)) {
                return fail("output", "missing-remote", {key: id});
            }
        }
        attempt.remote = remote;

        const handles: HandleImpl[] = [];
        for (const contribution of record.contributions) {
            const validation = this.#validation(contribution);
            if (validation.status === "rejected") {
                continue;
            }
            const implementation = output.contributions?.[contribution.definition.capability]?.[contribution.definition.id];
            if (implementation === undefined) {
                return fail("output", "missing-implementation", {capability: contribution.definition.capability, contribution: contribution.definition.id});
            }
            const handle = new HandleImpl({
                capability: contribution.definition.capability,
                id: contribution.definition.id,
                plugin,
                entry,
                generation,
                kind: "entry",
                declaration: contribution.definition.declaration,
                implementation,
                isAlive: () => isAlive(scope),
            });
            handles.push(handle);
            attempt.handlesByContribution.set(contribution, handle);
        }
        attempt.handles = handles;

        const receivers = output.receivers ?? {};
        const declaredReceivers = record.definition.receives ?? [];
        for (const point of declaredReceivers) {
            const receiver = receivers[point];
            if (receiver === undefined) {
                return fail("output", "missing-receiver", {capability: point});
            }
        }
        for (const point of Object.keys(receivers)) {
            if (!declaredReceivers.includes(point)) {
                return fail("output", "undeclared-receiver", {capability: point});
            }
        }

        // 4. 先接上再补交：按贡献方代次整批交付，单批失败只记账，不改变两侧激活结果。
        const connections = attempt.connections;
        for (const point of declaredReceivers) {
            const connection = this.#connectReceiver(record, attempt, point, receivers[point]!, acquired.handle);
            if (connection === null || !isAlive(scope)) {
                await this.#withdrawAttempt(attempt, "activation-stopped");
                return stopped();
            }
            connections.push(connection);
        }
        await this.#backfillReceivers(connections);

        // 5. 受控事务：整批 prepare，失败逆序撤回；循环纳入发布前新接上的接收者。接收者在第 6 步发布后经 published 生效。
        for (;;) {
            if (!isAlive(scope)) {
                await this.#withdrawAttempt(attempt, "activation-stopped");
                return stopped();
            }
            const plans = this.#deliveryPlans(attempt);
            if (plans.length === 0) {
                break;
            }
            const delivery = await this.#deliverPlans(plans, "activation", attempt);
            if (delivery.status === "stopped") {
                await this.#withdrawAttempt(attempt, "activation-stopped");
                return stopped();
            }
            if (delivery.status === "failed") {
                await this.#withdrawAttempt(attempt, "activation-failed");
                return fail("prepare", "receiver-prepare-failed", {
                    capability: delivery.failure.handle.capability,
                    contribution: delivery.failure.handle.id,
                    error: delivery.failure.error,
                });
            }
        }

        // 6. 发布：同步段内核对阶段并登记发布资源，其释放即撤回；随后打开作用域接纳业务。
        if (scope.phase !== "creating") {
            await this.#withdrawAttempt(attempt, "activation-stopped");
            return stopped();
        }
        const publication = attempt.work.register<ReadonlyArray<HandleImpl>>({
            kind: "contribution-publication",
            label: `${plugin}/${entry}#${generation}`,
            value: handles,
            dependsOn: [acquired.handle],
            release: (items) => this.#withdrawAttempt(attempt, "scope-closed", items),
        });
        if (publication.status !== "registered") {
            await this.#withdrawAttempt(attempt, "activation-stopped");
            return stopped();
        }
        for (const handle of handles) {
            handle.published = true;
        }
        scope.open();
        this.#record("publish", "published", {plugin, entry, generation});
        const published = [...attempt.handlesByContribution.keys()].flatMap((contribution) => contribution.deliveries.filter((delivery) => delivery.sourceAttempt === attempt));
        if (published.length > 0) {
            // 通知也在接收者的串行锁里：别的贡献方这时可能正挂在同一接收者的 prepare 里。等锁期间撤回的项由
            // #notifyPublished 跳过。
            const connections = lockOrder(published.map((delivery) => delivery.connection));
            await this.#withReceiverLocks(connections, async () => {
                for (const delivery of published) {
                    this.#notifyPublished(delivery);
                }
            });
        }
        return {status: "activated"};
    }

    #connectReceiver(record: EntryRecord, attempt: Attempt, point: string, receiver: ContributionReceiver, activationOutput: ReleaseDependency): ReceiverConnection | null {
        const id = `${record.plugin}/${record.definition.id}#${attempt.generation}:${point}:${++this.#connectionSequence}`;
        const connection: ReceiverConnection = {
            id,
            point,
            owner: record,
            attempt,
            receiver,
            deliveries: new Map(),
            tail: Promise.resolve(),
            closed: false,
            closeout: null,
        };
        // 接收者资源依赖激活产出，保证断开先于产出释放。
        const result = attempt.work.register<ReceiverConnection>({
            kind: "contribution-receiver",
            label: point,
            value: connection,
            dependsOn: [activationOutput],
            release: (current) => this.#disconnectReceiver(current),
        });
        if (result.status !== "registered") {
            connection.closed = true;
            return null;
        }
        // 补交前登记连接，使并发激活中的贡献方在下一轮发现它。
        this.#connections.set(id, connection);
        this.#record("publish", "receiver-connected", {plugin: record.plugin, entry: record.definition.id, generation: attempt.generation, capability: point});
        return connection;
    }


    async #backfillReceivers(connections: ReadonlyArray<ReceiverConnection>): Promise<void> {
        const groups = new Map<Attempt | ContributionRecord, {readonly attempt: Attempt | null; readonly plans: DeliveryPlan[]}>();
        for (const plugin of this.#plugins.values()) {
            for (const contribution of plugin.contributions) {
                if (contribution.location !== this.location || !this.#isSourceAvailable(contribution)) {
                    continue;
                }
                for (const connection of connections) {
                    if (connection.point !== contribution.definition.capability) {
                        continue;
                    }
                    const plan = this.#planForContribution(connection, contribution);
                    if (plan === null) {
                        continue;
                    }
                    const key = plan.sourceAttempt ?? contribution;
                    const group = groups.get(key) ?? {attempt: plan.sourceAttempt, plans: []};
                    group.plans.push(plan);
                    groups.set(key, group);
                }
            }
        }
        for (const group of groups.values()) {
            const result = await this.#deliverPlans(group.plans, "backfill", group.attempt);
            if (result.status === "failed") {
                this.#record("publish", "backfill-failed", {
                    plugin: result.failure.handle.plugin,
                    entry: result.failure.handle.entry,
                    generation: result.failure.handle.generation,
                    capability: result.failure.handle.capability,
                    contribution: result.failure.handle.id,
                    error: result.failure.error,
                });
            }
        }
    }


    #isSourceAvailable(contribution: ContributionRecord): boolean {
        if (!this.#isEffective(contribution)) {
            return false;
        }
        if (contribution.kind === "plugin") {
            return isAlive(contribution.plugin.scope);
        }
        const attempt = contribution.entry?.current;
        const handle = attempt?.handlesByContribution.get(contribution);
        return attempt?.scope.phase === "available" && handle?.published === true;
    }

    #planForContribution(connection: ReceiverConnection, contribution: ContributionRecord): DeliveryPlan | null {
        const sourceAttempt = contribution.entry?.current ?? null;
        let handle: HandleImpl;
        if (contribution.kind === "plugin") {
            handle = new HandleImpl({
                capability: contribution.definition.capability,
                id: contribution.definition.id,
                plugin: contribution.plugin.id,
                entry: null,
                generation: 0,
                kind: "plugin",
                declaration: contribution.definition.declaration,
                implementation: undefined,
                isAlive: () => isAlive(contribution.plugin.scope),
            });
            handle.published = true;
        } else {
            const current = sourceAttempt?.handlesByContribution.get(contribution);
            if (current === undefined) {
                return null;
            }
            handle = current;
        }
        const key = this.#deliveryKey(contribution, handle.generation);
        if (connection.deliveries.has(key)) {
            return null;
        }
        return {connection, contribution, handle, sourceAttempt};
    }

    #deliveryPlans(attempt: Attempt): DeliveryPlan[] {
        const plans: DeliveryPlan[] = [];
        for (const contribution of attempt.handlesByContribution.keys()) {
            if (!this.#isEffective(contribution)) {
                continue;
            }
            for (const connection of this.#connections.values()) {
                if (!this.#receiverAlive(connection) || connection.point !== contribution.definition.capability) {
                    continue;
                }
                const plan = this.#planForContribution(connection, contribution);
                if (plan !== null) {
                    plans.push(plan);
                }
            }
        }
        return plans;
    }

    #deliveryKey(contribution: ContributionRecord, generation: number): string {
        return `${contribution.key}@${generation}`;
    }

    async #deliverPlans(plans: ReadonlyArray<DeliveryPlan>, mode: DeliveryMode, sourceAttempt: Attempt | null): Promise<DeliveryAttemptResult> {
        const connections = lockOrder(plans.map((plan) => plan.connection));
        return this.#withReceiverLocks(connections, async () => {
            const sourceAlive = (): boolean => sourceAttempt === null
                ? plans.every((plan) => isAlive(plan.contribution.plugin.scope))
                : isAlive(sourceAttempt.scope);
            if (!sourceAlive()) {
                return {status: "stopped"};
            }
            const deliveries: DeliveryRecord[] = [];
            for (const plan of plans) {
                const key = this.#deliveryKey(plan.contribution, plan.handle.generation);
                if (!this.#receiverAlive(plan.connection) || plan.connection.deliveries.has(key) || !this.#isEffective(plan.contribution)) {
                    continue;
                }
                const handle = new HandleImpl({
                    capability: plan.handle.capability,
                    id: plan.handle.id,
                    plugin: plan.handle.plugin,
                    entry: plan.handle.entry,
                    generation: plan.handle.generation,
                    kind: plan.handle.kind,
                    declaration: plan.handle.declaration,
                    implementation: undefined,
                    source: plan.handle,
                    isAlive: () => this.#receiverAlive(plan.connection),
                });
                const delivery: DeliveryRecord = {
                    key,
                    contribution: plan.contribution,
                    handle,
                    connection: plan.connection,
                    sourceAttempt: plan.sourceAttempt,
                    prepared: undefined,
                    preparedSuccessfully: false,
                    state: "preparing",
                    revoked: false,
                    notified: false,
                    error: null,
                };
                plan.connection.deliveries.set(key, delivery);
                plan.contribution.deliveries.push(delivery);
                sourceAttempt?.deliveries.add(delivery);
                deliveries.push(delivery);
            }
            const fail = async (handle: HandleImpl, error: unknown): Promise<DeliveryAttemptResult> => {
                const failure = summarizeFailure(error);
                for (const delivery of deliveries) {
                    delivery.state = "failed";
                    delivery.error = failure;
                }
                await this.#revokeDeliveriesLocked(deliveries, mode === "activation" ? "activation-failed" : "delivery-failed", true);
                this.#record("publish", "delivery-failed", {
                    plugin: handle.plugin, entry: handle.entry, generation: handle.generation,
                    capability: handle.capability, contribution: handle.id, error: failure,
                });
                return {status: "failed", failure: {handle, error: failure}};
            };
            const stop = async (): Promise<DeliveryAttemptResult> => {
                await this.#revokeDeliveriesLocked(deliveries, mode === "activation" ? "activation-stopped" : "scope-closed", false);
                return {status: "stopped"};
            };
            for (const delivery of deliveries) {
                if (!this.#receiverAlive(delivery.connection)) {
                    continue;
                }
                try {
                    delivery.prepared = await delivery.connection.receiver.prepare?.(delivery.handle);
                    delivery.preparedSuccessfully = true;
                } catch (error) {
                    if (!this.#receiverAlive(delivery.connection)) {
                        this.#record("publish", "delivery-failed", {
                            plugin: delivery.handle.plugin, entry: delivery.handle.entry, generation: delivery.handle.generation,
                            capability: delivery.handle.capability, contribution: delivery.handle.id, error: summarizeFailure(error),
                        });
                        continue;
                    }
                    return fail(delivery.handle, error);
                }
                if (!sourceAlive()) {
                    return stop();
                }
            }
            await this.#revokeDeliveriesLocked(deliveries.filter((delivery) => !this.#receiverAlive(delivery.connection)), "receiver-closed", false);
            for (const delivery of deliveries) {
                if (delivery.preparedSuccessfully && !delivery.revoked && this.#receiverAlive(delivery.connection)) {
                    delivery.state = "delivered";
                    delivery.handle.published = true;
                    // 补交给已发布的贡献方时现在就可用；激活事务里的要等贡献方发布（第 6 步）再通知。
                    this.#notifyPublished(delivery);
                }
            }
            return {status: "ok"};
        });
    }

    #notifyPublished(delivery: DeliveryRecord): void {
        if (delivery.connection.receiver.published === undefined || delivery.notified || delivery.revoked || delivery.state !== "delivered" || !delivery.handle.published) {
            return;
        }
        delivery.notified = true;
        try {
            delivery.connection.receiver.published?.(delivery.handle, delivery.prepared);
        } catch (error) {
            this.#record("publish", "receiver-published-threw", {
                plugin: delivery.handle.plugin,
                entry: delivery.handle.entry,
                generation: delivery.handle.generation,
                capability: delivery.handle.capability,
                contribution: delivery.handle.id,
                error: summarizeFailure(error),
            });
        }
    }

    async #withReceiverLocks<T>(connections: ReadonlyArray<ReceiverConnection>, work: () => Promise<T>): Promise<T> {
        const releases: Array<() => void> = [];
        for (const connection of connections) {
            const previous = connection.tail;
            const {promise, resolve} = Promise.withResolvers<void>();
            connection.tail = previous.then(() => promise);
            await previous;
            releases.push(resolve);
        }
        try {
            return await work();
        } finally {
            for (let index = releases.length - 1; index >= 0; index -= 1) {
                releases[index]!();
            }
        }
    }

    /** 逆序撤回；接收者的异常只记诊断，不改变机制状态。 */
    async #revokeDeliveriesLocked(deliveries: ReadonlyArray<DeliveryRecord>, reason: RevokeReason, failed: boolean): Promise<void> {
        for (let index = deliveries.length - 1; index >= 0; index -= 1) {
            const delivery = deliveries[index]!;
            // prepare 抛错的项未完成暂存，不交给接收者撤回。
            if (delivery.revoked || !delivery.preparedSuccessfully) {
                continue;
            }
            delivery.revoked = true;
            delivery.handle.published = false;
            delivery.handle.withdrawn = reason;
            delivery.state = failed ? "failed" : "revoked";
            try {
                await delivery.connection.receiver.revoke?.(delivery.handle, delivery.prepared, reason);
            } catch (error) {
                this.#record("revoke", "receiver-revoke-threw", {
                    plugin: delivery.handle.plugin,
                    entry: delivery.handle.entry,
                    generation: delivery.handle.generation,
                    capability: delivery.handle.capability,
                    contribution: delivery.handle.id,
                    error: summarizeFailure(error),
                });
            }
        }
    }

    #receiverAlive(connection: ReceiverConnection): boolean {
        return !connection.closed && isAlive(connection.owner.scope) && isAlive(connection.attempt.scope);
    }

    #disconnectReceiver(connection: ReceiverConnection): Promise<void> {
        if (connection.closeout !== null) {
            return connection.closeout;
        }
        connection.closed = true;
        connection.closeout = this.#withReceiverLocks([connection], async () => {
            await this.#revokeDeliveriesLocked([...connection.deliveries.values()], "receiver-closed", false);
            this.#connections.delete(connection.id);
            this.#record("revoke", "receiver-closed", {
                plugin: connection.owner.plugin,
                entry: connection.owner.definition.id,
                generation: connection.attempt.generation,
                capability: connection.point,
            });
        });
        return connection.closeout;
    }

    async #withdrawAttempt(attempt: Attempt, reason: RevokeReason, handles: ReadonlyArray<HandleImpl> = attempt.handles): Promise<void> {
        const deliveries = [...attempt.deliveries];
        const connections = lockOrder(deliveries.map((delivery) => delivery.connection));
        await this.#withReceiverLocks(connections, async () => {
            await this.#revokeDeliveriesLocked(deliveries, reason, false);
        });
        for (let index = handles.length - 1; index >= 0; index -= 1) {
            const handle = handles[index]!;
            handle.published = false;
            handle.withdrawn = reason;
        }
    }

    async #revokeTopLevel(records: ReadonlyArray<ContributionRecord>): Promise<void> {
        const deliveries = records.flatMap((record) => record.deliveries);
        const connections = lockOrder(deliveries.map((delivery) => delivery.connection));
        await this.#withReceiverLocks(connections, async () => {
            await this.#revokeDeliveriesLocked(deliveries, "scope-closed", false);
        });
    }

    /**
     * 激活产出的释放：只释放未交付给 runtime.services 的提供项实例；已交付的由服务作用域释放。
     * 释放成功后才标记已释放：失败的释放让资源留在 release-failed，显式恢复会重试它，而不是静默跳过。
     */
    async #releaseOutput(attempt: Attempt, output: ActivationOutput): Promise<void> {
        // 清理依据实际产出而不是校验到的前缀；未声明与迟到实例也必须释放，成功项在恢复时跳过。
        const services = output.services ?? [];
        for (let index = services.length - 1; index >= 0; index -= 1) {
            const service = services[index]!;
            const record = attempt.provided.get(service.key.name);
            const matching = record?.output === service ? record : undefined;
            if (matching?.adopted || matching?.released || attempt.releasedOutputs.has(service)) {
                continue;
            }
            await service.release?.(service.instance);
            attempt.releasedOutputs.add(service);
            if (matching !== undefined) {
                matching.released = true;
            }
        }
    }

    /** runtime.services 提供者的 create：触发或加入激活，成功后交付实例并把服务作用域租约挂到本代次。 */
    async #provide(record: EntryRecord, key: ServiceKey<unknown>, context: ServiceCreateContext): Promise<unknown> {
        const identity = {plugin: record.plugin, entry: record.definition.id};
        const blocked = record.current === null ? this.#blocked().get(entryIdentity(identity)) : null;
        if (blocked != null) {
            this.#record("activate", "blocked", identity);
            throw new PluginStateError({...identity, generation: null, reason: "入口受阻", detail: blocked.reason});
        }
        const attempt = this.#attemptFor(record);
        if (attempt === null) {
            throw new PluginStateError({...identity, generation: null, reason: "登记作用域已关闭，不再激活"});
        }
        const outcome = await waitWithSignal(attempt.outcome, context.signal);
        if (outcome === CANCELLED) {
            throw new PluginStateError({...identity, generation: attempt.generation, reason: "服务作用域在激活完成前停止"});
        }
        if (outcome.status !== "activated") {
            const detail = outcome.status === "failed" ? `${outcome.failure.stage}/${outcome.failure.reason}` : "激活已停止";
            throw new PluginStateError({...identity, generation: attempt.generation, reason: "激活未成功", detail});
        }
        const provided = attempt.provided.get(key.name)!;
        if (provided.adopted) {
            throw new PluginStateError({...identity, generation: attempt.generation, reason: "实例已交付给上一次服务代次", detail: key.name});
        }
        if (attempt.scope.phase !== "available") {
            throw new PluginStateError({...identity, generation: attempt.generation, reason: "激活作用域不再可用", detail: key.name});
        }
        provided.adopted = true;
        attempt.services.add(context.scope);
        let closingAttempted = false;
        attempt.work.register<Scope>({
            kind: "provided-service",
            label: key.name,
            value: context.scope,
            release: async (serviceScope) => {
                const result = await (closingAttempted && serviceScope.phase === "stopping" ? serviceScope.recover() : serviceScope.close());
                closingAttempted = true;
                if (result.status !== "closed") {
                    throw new PluginStateError({...identity, generation: attempt.generation, reason: "服务作用域收口未完成", detail: result.reason});
                }
            },
        });
        return provided.instance;
    }

    /** 同一提供项的释放不会并发（lifecycle 不重入在途释放）；成功后才标记，失败留给显式恢复重试。 */
    async #releaseProvided(record: EntryRecord, key: ServiceKey<unknown>, instance: unknown): Promise<void> {
        const attempt = record.current;
        const provided = attempt?.provided.get(key.name);
        if (attempt !== null && provided !== undefined && provided.instance === instance && !provided.released) {
            // services 接管实例后可先于 entry-work 收口，撤回必须仍能使用接收者产出。
            await Promise.all(attempt.connections.map((connection) => this.#disconnectReceiver(connection)));
            await provided.release?.(instance);
            provided.released = true;
        }
    }

    #resultOf(record: EntryRecord, attempt: Attempt, outcome: AttemptOutcome): ActivationResult {
        const plugin = record.plugin;
        const entry = record.definition.id;
        switch (outcome.status) {
            case "activated":
                return {status: "activated", plugin, entry, generation: attempt.generation, scopeId: attempt.scope.id};
            case "failed":
                return outcome.failure;
            case "stopped":
                return {status: "stopped", plugin, entry, generation: attempt.generation};
        }
    }

    #stateOf(record: EntryRecord, blocked: EntryBlocked | null = this.#blocked().get(`${record.plugin}/${record.definition.id}`) ?? null): EntryState {
        const base = {plugin: record.plugin, entry: record.definition.id, location: record.definition.location, blocked: null};
        if (!record.activatable) {
            return {...base, status: "foreign-location", generation: null, scopeId: null, failure: null, closeout: null};
        }
        const attempt = record.current;
        if (attempt === null) {
            const status: EntryStatus = isAlive(record.scope) ? blocked === null ? "registered" : "blocked" : record.scope.phase === "stopping" ? "stopping" : "closed";
            return {...base, status, blocked: status === "blocked" ? blocked : null, generation: null, scopeId: null, failure: null, closeout: null};
        }
        const failure = attempt.settled?.status === "failed" ? attempt.settled.failure : null;
        const phase = attempt.scope.phase;
        let status: EntryStatus;
        if (attempt.settled === null) {
            status = "activating";
        } else if (attempt.settled.status === "failed" && isAlive(record.scope)) {
            status = "failed";
        } else if (attempt.settled.status === "activated" && phase === "available") {
            status = "available";
        } else {
            status = phase === "closed" ? "closed" : "stopping";
        }
        let closeout: EntryState["closeout"];
        if (attempt.closeout !== null) {
            closeout = attempt.closeoutResult === null ? "pending" : attempt.closeoutResult.status;
        } else {
            closeout = phase === "closed" ? "closed" : phase === "stopping" ? "pending" : null;
        }
        return {...base, status, generation: attempt.generation, scopeId: attempt.scope.id, failure, closeout};
    }

    #deliveryState(contribution: ContributionRecord): ContributionDelivery {
        if (!isAlive(contribution.plugin.scope)) {
            return {status: "waiting-receiver"};
        }
        const sourceAttempt = contribution.entry?.current ?? null;
        for (let index = contribution.deliveries.length - 1; index >= 0; index -= 1) {
            const delivery = contribution.deliveries[index]!;
            if (!this.#receiverAlive(delivery.connection) || delivery.sourceAttempt !== sourceAttempt) {
                continue;
            }
            const receiver = {plugin: delivery.connection.owner.plugin, entry: delivery.connection.owner.definition.id, generation: delivery.connection.attempt.generation};
            if (delivery.state === "failed") {
                return {status: "delivery-failed", receiver, error: delivery.error};
            }
            if (delivery.state === "delivered" && !delivery.revoked) {
                return {status: "delivered", receiver};
            }
        }
        return {status: "waiting-receiver"};
    }

    #contributionState(contribution: ContributionRecord): ContributionState {
        const validation = this.#validation(contribution);
        const base = {
            capability: contribution.definition.capability,
            id: contribution.definition.id,
            plugin: contribution.plugin.id,
            entry: contribution.entry?.definition.id ?? null,
            location: contribution.location,
            kind: contribution.kind,
            declaration: contribution.definition.declaration,
            validation,
            delivery: this.#deliveryState(contribution),
        };
        if (contribution.kind === "plugin" || validation.status === "rejected") {
            return {...base, status: "declared", reason: isAlive(contribution.plugin.scope) ? "not-activated" : "scope-closed"};
        }
        const attempt = contribution.entry?.current;
        if (attempt === null || attempt === undefined) {
            return {...base, status: "declared", reason: isAlive(contribution.plugin.scope) ? "not-activated" : "scope-closed"};
        }
        const generation = attempt.generation;
        if (attempt.settled === null) {
            return {...base, status: "activating", generation};
        }
        if (attempt.settled.status === "failed") {
            return {...base, status: "activation-failed", generation, failure: attempt.settled.failure};
        }
        if (attempt.settled.status === "stopped") {
            return {...base, status: "declared", reason: "scope-closed"};
        }
        const handle = attempt.handlesByContribution.get(contribution);
        if (handle?.published && attempt.scope.phase === "available") {
            return {...base, status: "available", generation, implementation: handle.implementation()};
        }
        // 已发布过的贡献只会因停止或关闭撤回；失败撤回发生在发布前，已由 failed 分支覆盖。
        return {...base, status: "revoked", generation, reason: handle?.withdrawn === "activation-stopped" ? "activation-stopped" : "scope-closed"};
    }

    #blocked(): ReadonlyMap<string, EntryBlocked | null> {
        const entries = [];
        const pluginProviders = new Set<string>();
        for (const plugin of this.#plugins.values()) {
            if (!isAlive(plugin.scope)) {
                continue;
            }
            for (const record of plugin.entries.values()) {
                for (const id of record.providerIds.values()) {
                    pluginProviders.add(id);
                }
                entries.push({
                    plugin: record.plugin,
                    entry: record.definition.id,
                    location: record.definition.location,
                    provides: record.definition.provides ?? [],
                    dependencies: record.definition.dependencies ?? [],
                    status: this.#stateOf(record, null).status,
                });
            }
        }
        const localServices = new Set<string>();
        for (const entry of this.#assembly.report().entries) {
            if (entry.kind === "provider" && entry.key !== null && !pluginProviders.has(entry.id)) {
                localServices.add(entry.key);
            }
        }
        return deriveBlocked(entries, this.location, localServices);
    }

    #describe(record: EntryRecord, blocked: ReadonlyMap<string, EntryBlocked | null>): EntryDescription {
        return {
            plugin: record.plugin,
            entry: record.definition.id,
            location: record.definition.location,
            dependencies: (record.definition.dependencies ?? []).map((dependency) => ({key: dependency.key.name, required: dependency.required ?? true})),
            provides: (record.definition.provides ?? []).map((key) => key.name),
            receives: [...(record.definition.receives ?? [])],
            contributions: record.contributions.map((contribution) => this.#contributionState(contribution)),
            state: this.#stateOf(record, blocked.get(`${record.plugin}/${record.definition.id}`) ?? null),
        };
    }

    #record(
        stage: PluginDiagnosticStage,
        reason: string,
        detail: {
            readonly plugin: string | null;
            readonly entry?: string | null;
            readonly generation?: number | null;
            readonly capability?: string | null;
            readonly contribution?: string | null;
            readonly error?: FailureError | null;
        },
    ): void {
        this.#sequence += 1;
        const diagnostic: PluginDiagnostic = {
            sequence: this.#sequence,
            instanceId: this.instanceId,
            location: this.location,
            plugin: detail.plugin,
            entry: detail.entry ?? null,
            generation: detail.generation ?? null,
            stage,
            reason,
            capability: detail.capability ?? null,
            contribution: detail.contribution ?? null,
            error: detail.error ?? null,
        };
        this.#diagnostics.push(diagnostic);
        try {
            this.#observer?.diagnosticRecorded?.(diagnostic);
        } catch {
            // 观察者是诊断通道，它的异常不得改变机制状态。
        }
    }
}

/** 一次要锁多个接收者连接时去重并按 id 排序，各批按同一顺序加锁，避免互相等待。 */
function lockOrder(connections: ReadonlyArray<ReceiverConnection>): ReceiverConnection[] {
    return [...new Set(connections)].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 一律以同一失败码结算的远程访问：没有远程节点（`unavailable`），或代理核对不过（`denied`）；不抛错。 */
function refusedRemote(code: "unavailable" | "denied", detail: string): RemoteAccess {
    const failure = (): Promise<{readonly ok: false; readonly code: "unavailable" | "denied"; readonly detail: string}> => Promise.resolve({ok: false, code, detail});
    const events = new Proxy({}, {get: () => ({subscribe: failure})});
    const client: object = new Proxy(
        {},
        {get: (_target, property) => (property === "then" ? undefined : property === "events" ? events : property === "at" ? () => client : failure)},
    );
    return {use: () => client as never, lookup: failure, instances: failure};
}

/** 任一信号触发即触发。 */
function anySignal(signals: ReadonlyArray<AbortSignal>): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), {once: true});
    }
    return controller.signal;
}
