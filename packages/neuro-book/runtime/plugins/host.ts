/**
 * runtime.plugins 的实现：描述目录、按入口 single-flight 的激活、受控贡献事务与撤回、
 * 与 runtime.services 的提供项协作、稳定失败与显式恢复。
 *
 * 代次作用域保持 plugin:<id>/<entry>#<n> 身份，持有必需依赖借用与入口收口资源；工作子作用域
 * 承载 context.scope 资源、显式解析借用、服务租约、激活产出与贡献。工作作用域的受管操作在
 * 停止时等待服务实例首次释放结算，防止提供方先清理自己的资源；租约保留失败供显式恢复。
 * 发布资源依赖激活产出，贡献先撤回。代次确认工作与服务全部关闭后记录 closed，最后结束
 * 必需依赖借用，使依赖者的全部资源释放先于提供者。
 */

import {LifecycleStateError, summarizeFailure} from "../lifecycle/lifecycle";
import type {CloseResult, FailureError, ReleaseDependency, RuntimeInstance, RuntimeLocation, Scope} from "../lifecycle/lifecycle";
import type {EntryId, ServiceAssembly, ServiceCreateContext, ServiceKey} from "../services/services";

import {PluginStateError} from "./contracts";
import type {
    ActivationContext,
    ActivationFailed,
    ActivationFailureReason,
    ActivationOutput,
    ProvidedService,
    ActivationResult,
    ActivationStage,
    ContributionHandle,
    ContributionReceiver,
    ContributionState,
    EntryDescription,
    EntryRef,
    EntryBlocked,
    EntryState,
    EntryStatus,
    PluginCatalog,
    PluginDefinition,
    PluginDiagnostic,
    PluginDiagnosticStage,
    PluginEntryDefinition,
    PluginHost,
    PluginHostOptions,
    PluginObserver,
    RecoverEntryResult,
    RegisterPluginResult,
    RevokeReason,
} from "./contracts";
import {validateDefinition} from "./registration";
import {deriveBlocked, entryIdentity} from "./blocked";

const CANCELLED: unique symbol = Symbol("cancelled");

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

function contributionIdentity(capability: string, id: string): string {
    return `${capability}:${id}`;
}

class HandleImpl implements ContributionHandle {
    readonly capability: string;
    readonly id: string;
    readonly plugin: string;
    readonly entry: string;
    readonly generation: number;
    readonly declaration: unknown;
    readonly receiver: ContributionReceiver;
    readonly #implementation: unknown;
    published = false;
    /** 发布后撤回或从未发布即失败/停止时的原因；null 表示仍在事务中或已发布。 */
    withdrawn: RevokeReason | null = null;
    prepared: unknown = undefined;

    constructor(input: {
        readonly receiver: ContributionReceiver;
        readonly capability: string;
        readonly id: string;
        readonly plugin: string;
        readonly entry: string;
        readonly generation: number;
        readonly declaration: unknown;
        readonly implementation: unknown;
    }) {
        this.receiver = input.receiver;
        this.capability = input.capability;
        this.id = input.id;
        this.plugin = input.plugin;
        this.entry = input.entry;
        this.generation = input.generation;
        this.declaration = input.declaration;
        this.#implementation = input.implementation;
    }

    implementation(): unknown {
        if (!this.published) {
            throw new PluginStateError({
                plugin: this.plugin,
                entry: this.entry,
                generation: this.generation,
                reason: this.withdrawn === null ? "贡献尚未发布" : `贡献已撤回（${this.withdrawn}）`,
                detail: `${this.capability}:${this.id}`,
            });
        }
        return this.#implementation;
    }
}

interface ProvidedRecord {
    readonly key: ServiceKey<unknown>;
    readonly instance: unknown;
    readonly release: ((instance: unknown) => void | Promise<void>) | undefined;
    /** 已交付给 runtime.services 的服务作用域：由它释放实例，激活产出的释放跳过。 */
    adopted: boolean;
    released: boolean;
}

type AttemptOutcome = {readonly status: "activated"} | {readonly status: "failed"; readonly failure: ActivationFailed} | {readonly status: "stopped"};

interface Attempt {
    readonly generation: number;
    readonly scope: Scope;
    readonly work: Scope;
    readonly services: Set<Scope>;
    readonly outcome: Promise<AttemptOutcome>;
    settled: AttemptOutcome | null;
    handles: ReadonlyArray<HandleImpl>;
    provided: ReadonlyMap<ServiceKey<unknown>, ProvidedRecord>;
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
    readonly providerIds: ReadonlyMap<ServiceKey<unknown>, EntryId>;
    readonly contributions: ReadonlyArray<{readonly receiver: ContributionReceiver; readonly capability: string; readonly id: string; readonly declaration: unknown}>;
    current: Attempt | null;
}

interface PluginRecord {
    readonly id: string;
    readonly scope: Scope;
    readonly entries: ReadonlyMap<string, EntryRecord>;
}

export class PluginHostImpl implements PluginHost {
    readonly instanceId: string;
    readonly location: RuntimeLocation;
    readonly #assembly: ServiceAssembly;
    readonly #receivers: ReadonlyMap<string, ContributionReceiver>;
    readonly #observer: PluginObserver | undefined;
    readonly #plugins = new Map<string, PluginRecord>();
    /** 本位置目录：`capability:id` → 入口。 */
    readonly #contributions = new Map<string, EntryRecord>();
    /** 代次跨登记单调递增：重新启用得到新代次，旧代次身份不复用。 */
    readonly #generations = new Map<string, number>();
    readonly #diagnostics: PluginDiagnostic[] = [];
    #registrations = 0;
    #sequence = 0;

    constructor(instance: RuntimeInstance, assembly: ServiceAssembly, options: PluginHostOptions) {
        this.instanceId = instance.identity.instanceId;
        this.location = instance.identity.location;
        this.#assembly = assembly;
        const receivers = new Map<string, ContributionReceiver>();
        for (const receiver of options.receivers) {
            if (receivers.has(receiver.capability)) {
                throw new TypeError(`能力 ${receiver.capability} 登记了两个接收者`);
            }
            receivers.set(receiver.capability, receiver);
        }
        this.#receivers = receivers;
        this.#observer = options.observer;
    }

    register(definition: PluginDefinition, options: {readonly scope: Scope}): RegisterPluginResult {
        const rejections = validateDefinition(definition, {
            location: this.location,
            receivers: this.#receivers,
            hasKey: (key) => this.#assembly.hasKey(key),
            contributionTaken: (capability, id) => {
                const owner = this.#contributions.get(contributionIdentity(capability, id));
                return owner !== undefined && owner.scope.phase !== "closed";
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
        const entries = new Map<string, EntryRecord>();
        const registered: string[] = [];
        for (const entry of definition.entries) {
            const activatable = entry.location === this.location;
            const consumerId = `plugin:${definition.id}/${entry.id}@${this.#registrations}`;
            const providerIds = new Map<ServiceKey<unknown>, EntryId>();
            const record: EntryRecord = {
                plugin: definition.id,
                definition: entry,
                scope: options.scope,
                activatable,
                consumerId,
                providerIds,
                contributions: (entry.contributions ?? []).map((contribution) => ({
                    receiver: this.#receivers.get(contribution.capability)!,
                    capability: contribution.capability,
                    id: contribution.id,
                    declaration: contribution.declaration,
                })),
                current: null,
            };
            entries.set(entry.id, record);
            if (!activatable) {
                continue;
            }
            registered.push(entry.id);
            const dependencies = entry.dependencies ?? [];
            this.#declare(this.#assembly.declare({id: consumerId, location: this.location, scope: options.scope, dependencies}));
            for (const key of entry.provides ?? []) {
                const providerId = `${consumerId}:${key.name}`;
                providerIds.set(key, providerId);
                this.#declare(this.#assembly.declare({
                    id: providerId,
                    key,
                    location: this.location,
                    scope: options.scope,
                    dependencies,
                    create: (context) => this.#provide(record, key, context),
                    release: (instance) => this.#releaseProvided(record, key, instance),
                }));
            }
            for (const contribution of record.contributions) {
                this.#contributions.set(contributionIdentity(contribution.capability, contribution.id), record);
            }
        }
        this.#plugins.set(definition.id, {id: definition.id, scope: options.scope, entries});
        return {status: "accepted", plugin: definition.id, entries: registered};
    }

    catalog(): PluginCatalog {
        const blocked = this.#blocked();
        const plugins = [...this.#plugins.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((plugin) => {
            const entries = [...plugin.entries.values()].map((record) => this.#describe(record, blocked));
            const local = entries.filter((entry) => entry.location === this.location);
            const unavailable = local.filter((entry) => entry.state.status === "blocked" || entry.state.status === "failed").length;
            const summary = unavailable === 0 ? "available" : unavailable === local.length ? "blocked" : "partial";
            return {id: plugin.id, scopeId: plugin.scope.id, entries, summary} as const;
        });
        return {plugins};
    }

    entryState(ref: EntryRef): EntryState | null {
        const record = this.#entry(ref);
        return record === null ? null : this.#stateOf(record);
    }

    contribution<Declaration, Implementation>(capability: string, id: string): ContributionState<Declaration, Implementation> | null {
        const record = this.#contributions.get(contributionIdentity(capability, id));
        if (record === undefined) {
            return null;
        }
        const contribution = record.contributions.find((candidate) => candidate.capability === capability && candidate.id === id)!;
        return this.#contributionState(record, contribution) as ContributionState<Declaration, Implementation>;
    }

    async activate(ref: EntryRef, options: {readonly signal?: AbortSignal} = {}): Promise<ActivationResult> {
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
        const attempt = this.#attemptFor(record);
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
    #attemptFor(record: EntryRecord): Attempt | null {
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
        const attempt: Attempt = {generation, scope, work, services: new Set(), outcome: promise, settled: null, handles: [], provided: new Map(), releasedOutputs: new Set(), closeout: null, closeoutResult: null};
        record.current = attempt;
        this.#record("activate", "activation-started", {plugin: record.plugin, entry: record.definition.id, generation});
        const stopping = Promise.withResolvers<void>();
        scope.stopSignal.addEventListener("abort", () => {
            this.#record("close", "close-started", {plugin: record.plugin, entry: record.definition.id, generation});
            stopping.resolve();
        }, {once: true});
        work.accept({label: "provided-services-close-barrier", run: async () => {
            await stopping.promise;
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
        const access = this.#assembly.access(record.consumerId, scope);
        const required = new Map<ServiceKey<unknown>, unknown>();
        for (const dependency of record.definition.dependencies ?? []) {
            if (dependency.required === false) {
                continue;
            }
            const result = await access.resolve(dependency.key, {signal: scope.stopSignal});
            if (!isAlive(scope)) {
                return stopped();
            }
            if (result.status === "resolved") {
                required.set(dependency.key, result.instance);
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
            services: {
                require: <T>(key: ServiceKey<T>): T => {
                    if (!required.has(key)) {
                        throw new TypeError(`${key.name} 不是入口 ${plugin}/${entry} 已解析的必需依赖`);
                    }
                    return required.get(key) as T;
                },
                resolve: (key, options) => this.#assembly.access(record.consumerId, attempt.work).resolve(key, options),
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

        // 3. 产出核对：声明过的提供项与贡献都必须有实现；不接受占位。
        const output = acquired.handle.value;
        const provided = new Map<ServiceKey<unknown>, ProvidedRecord>();
        const declaredKeys = record.definition.provides ?? [];
        for (const service of output.services ?? []) {
            if (!declaredKeys.includes(service.key)) {
                attempt.provided = provided;
                return fail("output", "undeclared-service", {key: service.key.name});
            }
            provided.set(service.key, {key: service.key, instance: service.instance, release: service.release?.bind(service), adopted: false, released: false});
        }
        attempt.provided = provided;
        for (const key of declaredKeys) {
            if (!provided.has(key)) {
                return fail("output", "missing-service", {key: key.name});
            }
        }
        const handles: HandleImpl[] = [];
        for (const contribution of record.contributions) {
            const implementation = output.contributions?.[contribution.capability]?.[contribution.id];
            if (implementation === undefined) {
                return fail("output", "missing-implementation", {capability: contribution.capability, contribution: contribution.id});
            }
            handles.push(new HandleImpl({...contribution, plugin, entry, generation, implementation}));
        }
        attempt.handles = handles;

        // 4/5. 受控事务：按声明顺序 prepare，全部成功后按序 commit；任一失败逆序撤回全部暂存项。
        const prepared: HandleImpl[] = [];
        for (const handle of handles) {
            try {
                handle.prepared = await handle.receiver.prepare?.(handle);
            } catch (error) {
                await this.#revoke(prepared, "activation-failed");
                return fail("prepare", "receiver-prepare-failed", {capability: handle.capability, contribution: handle.id, error: summarizeFailure(error)});
            }
            prepared.push(handle);
            if (!isAlive(scope)) {
                await this.#revoke(prepared, "activation-stopped");
                return stopped();
            }
        }
        for (const handle of prepared) {
            try {
                await handle.receiver.commit?.(handle, handle.prepared);
            } catch (error) {
                await this.#revoke(prepared, "activation-failed");
                return fail("commit", "receiver-commit-failed", {capability: handle.capability, contribution: handle.id, error: summarizeFailure(error)});
            }
            if (!isAlive(scope)) {
                await this.#revoke(prepared, "activation-stopped");
                return stopped();
            }
        }

        // 6. 发布：同步段内核对阶段并登记发布资源，其释放即撤回；随后打开作用域接纳业务。
        if (scope.phase !== "creating") {
            await this.#revoke(prepared, "activation-stopped");
            return stopped();
        }
        const publication = attempt.work.register<ReadonlyArray<HandleImpl>>({
            kind: "contribution-publication",
            label: `${plugin}/${entry}#${generation}`,
            value: prepared,
            dependsOn: [acquired.handle],
            release: (items) => this.#revoke(items, "scope-closed"),
        });
        if (publication.status !== "registered") {
            return stopped();
        }
        for (const handle of prepared) {
            handle.published = true;
        }
        scope.open();
        this.#record("publish", "published", {plugin, entry, generation});
        return {status: "activated"};
    }

    /** 逆序撤回；接收者的异常只记诊断，不改变机制状态。 */
    async #revoke(handles: ReadonlyArray<HandleImpl>, reason: RevokeReason): Promise<void> {
        for (let index = handles.length - 1; index >= 0; index -= 1) {
            const handle = handles[index]!;
            if (handle.withdrawn !== null) {
                continue;
            }
            handle.published = false;
            handle.withdrawn = reason;
            try {
                await handle.receiver.revoke?.(handle, handle.prepared, reason);
            } catch (error) {
                this.#record("revoke", "receiver-revoke-threw", {
                    plugin: handle.plugin,
                    entry: handle.entry,
                    generation: handle.generation,
                    capability: handle.capability,
                    contribution: handle.id,
                    error: summarizeFailure(error),
                });
            }
        }
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
            const record = attempt.provided.get(service.key);
            const matching = record?.instance === service.instance ? record : undefined;
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
        const provided = attempt.provided.get(key)!;
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
        const provided = record.current?.provided.get(key);
        if (provided !== undefined && provided.instance === instance && !provided.released) {
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

    #contributionState(record: EntryRecord, contribution: EntryRecord["contributions"][number]): ContributionState {
        const base = {
            capability: contribution.capability,
            id: contribution.id,
            plugin: record.plugin,
            entry: record.definition.id,
            location: record.definition.location,
            declaration: contribution.declaration,
        };
        const attempt = record.current;
        if (attempt === null) {
            return {...base, status: "declared", reason: isAlive(record.scope) ? "not-activated" : "scope-closed"};
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
        const handle = attempt.handles.find((candidate) => candidate.capability === contribution.capability && candidate.id === contribution.id)!;
        if (handle.published && attempt.scope.phase === "available") {
            return {...base, status: "available", generation, implementation: handle.implementation()};
        }
        // 已发布过的贡献只会因停止或关闭撤回；失败撤回发生在发布前，已由 failed 分支覆盖。
        return {...base, status: "revoked", generation, reason: handle.withdrawn === "activation-stopped" ? "activation-stopped" : "scope-closed"};
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
            contributions: record.contributions.map((contribution) => this.#contributionState(record, contribution)),
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

