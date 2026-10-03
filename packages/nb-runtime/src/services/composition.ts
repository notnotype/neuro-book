/**
 * runtime.services 的实现：声明登记、静态检查、按提供者 single-flight 的初始化、借用式解析、
 * 运行时等待环检测、稳定失败与显式恢复。
 *
 * 装配只在内存里维护声明、初始化尝试与诊断；实例与借用全部交给 runtime.lifecycle 登记：
 * 每次初始化尝试在提供者 owner 作用域下新建一个服务作用域作为代次，实例是该作用域的资源，
 * 消费者以借用取得实例，关闭顺序与收口由 lifecycle 推进。
 *
 * 等待边：在某个服务作用域（或其后代）内发起的解析，归属为该提供者本次初始化的运行时等待边。
 * 声明依赖构成的环在静态检查里拒绝；经其它入口的访问在初始化期间形成的等待环，在被等待方
 * 反向可达等待方时当场发现，阻断本次解析而不是挂起。
 */

import {LifecycleStateError, summarizeFailure} from "../lifecycle/lifecycle";
import type {ReleaseDependency, ResourceHandle, RuntimeInstance, RuntimeLocation, Scope, ScopeId} from "../lifecycle/lifecycle";

import {checkAssembly} from "./assembly";
import type {EntryNode} from "./assembly";
import type {
    AssemblyDiagnostic,
    AssemblyObserver,
    AssemblyReport,
    ConsumerDeclaration,
    DeclarationRejection,
    DeclareResult,
    DiagnosticStage,
    EntryId,
    FailureError,
    ProviderDeclaration,
    ProviderState,
    RecoverResult,
    ResolveOptions,
    ResolveResult,
    ServiceAccess,
    ServiceAssembly,
    ServiceAssemblyOptions,
    ServiceBinding,
    ServiceCreateContext,
    ServiceKey,
    Unavailable,
    UnavailableReason,
} from "./contracts";

interface Dependency {
    readonly key: ServiceKey<unknown>;
    readonly required: boolean;
}

type AttemptOutcome =
    | {readonly status: "available"; readonly handle: ResourceHandle<unknown>}
    | {readonly status: "failed"; readonly failure: Unavailable}
    | {readonly status: "stopped"};

interface Attempt {
    /** 服务作用域：本次尝试的代次身份，实例与 create 期间的子资源都在这里。 */
    readonly scope: Scope;
    readonly outcome: Promise<AttemptOutcome>;
    settled: AttemptOutcome | null;
    /** 运行时等待边：本尝试正在等待哪些提供者的初始化。 */
    readonly waitingOn: Set<ProviderEntry>;
}

interface ProviderEntry {
    readonly kind: "provider";
    readonly id: EntryId;
    readonly key: ServiceKey<unknown>;
    readonly scope: Scope;
    readonly dependencies: ReadonlyArray<Dependency>;
    readonly create: (context: ServiceCreateContext) => unknown;
    readonly release: ((instance: unknown) => void | Promise<void>) | undefined;
    attempts: number;
    current: Attempt | null;
}

interface ConsumerEntry {
    readonly kind: "consumer";
    readonly id: EntryId;
    readonly scope: Scope;
    /** 入口专属子作用域：解析取得的借用默认登记在这里，随声明作用域一起关闭。 */
    readonly entryScope: Scope;
    readonly dependencies: ReadonlyArray<Dependency>;
}

type Entry = ProviderEntry | ConsumerEntry;

type InitializationFailure = "dependency-cycle" | "dependency-unavailable" | "initialization-failed";

const CANCELLED: unique symbol = Symbol("cancelled");

function isAlive(scope: Scope): boolean {
    return scope.phase === "creating" || scope.phase === "available";
}

function isStrictDescendant(scope: Scope, ancestor: Scope): boolean {
    for (let current = scope.parent; current !== null; current = current.parent) {
        if (current === ancestor) {
            return true;
        }
    }
    return false;
}

/** 等待共享结果；信号触发只结束本次等待，不影响共享 Promise 与其他等待者。 */
function awaitOrCancel<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof CANCELLED> {
    if (signal === undefined) {
        return promise;
    }
    if (signal.aborted) {
        return Promise.resolve(CANCELLED);
    }
    const {promise: raced, resolve} = Promise.withResolvers<T | typeof CANCELLED>();
    const onAbort = (): void => resolve(CANCELLED);
    signal.addEventListener("abort", onAbort, {once: true});
    void promise.then((value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
    });
    return raced;
}

export class ServiceAssemblyImpl implements ServiceAssembly {
    readonly instanceId: string;
    readonly location: RuntimeLocation;
    readonly #keys: ReadonlySet<ServiceKey<unknown>>;
    readonly #observer: AssemblyObserver | undefined;
    readonly #entries = new Map<EntryId, Entry>();
    /** 服务作用域 → 提供者；把某个访问作用域内发起的等待归属到正在初始化的提供者。 */
    readonly #attemptScopes = new Map<ScopeId, ProviderEntry>();
    readonly #diagnostics: AssemblyDiagnostic[] = [];
    #sequence = 0;

    constructor(instance: RuntimeInstance, options: ServiceAssemblyOptions) {
        this.instanceId = instance.identity.instanceId;
        this.location = instance.identity.location;
        this.#keys = new Set(options.keys);
        this.#observer = options.observer;
    }

    hasKey(key: ServiceKey<unknown>): boolean {
        return this.#keys.has(key);
    }

    declare<T>(declaration: ProviderDeclaration<T>): DeclareResult;
    declare(declaration: ConsumerDeclaration): DeclareResult;
    declare(declaration: ProviderDeclaration<unknown> | ConsumerDeclaration): DeclareResult {
        const provider = "key" in declaration ? declaration : null;
        const rejection = this.#validate(declaration, provider);
        if (rejection !== null) {
            this.#record("declare", rejection, {entryId: declaration.id, key: provider?.key.name ?? null, scopeId: declaration.scope.id});
            return {status: "rejected", id: declaration.id, reason: rejection};
        }
        const dependencies = (declaration.dependencies ?? []).map((dependency) => ({
            key: dependency.key,
            required: dependency.required ?? true,
        }));
        if (provider !== null) {
            this.#entries.set(provider.id, {
                kind: "provider",
                id: provider.id,
                key: provider.key,
                scope: provider.scope,
                dependencies,
                create: provider.create,
                release: provider.release,
                attempts: 0,
                current: null,
            });
        } else {
            const entryScope = declaration.scope.createChild(`consumer:${declaration.id}`);
            entryScope.open();
            this.#entries.set(declaration.id, {kind: "consumer", id: declaration.id, scope: declaration.scope, entryScope, dependencies});
        }
        return {status: "accepted", id: declaration.id};
    }

    report(): AssemblyReport {
        const nodes: EntryNode[] = [];
        for (const entry of this.#entries.values()) {
            if (!isAlive(entry.scope) || (entry.kind === "consumer" && !isAlive(entry.entryScope))) {
                continue;
            }
            nodes.push({
                id: entry.id,
                kind: entry.kind,
                key: entry.kind === "provider" ? entry.key : null,
                scope: entry.scope,
                dependencies: entry.dependencies,
            });
        }
        return checkAssembly(nodes);
    }

    providerState(providerId: EntryId): ProviderState | null {
        const entry = this.#entries.get(providerId);
        if (entry === undefined || entry.kind !== "provider") {
            return null;
        }
        return this.#stateOf(entry);
    }

    access(entryId: EntryId, scope?: Scope): ServiceAccess {
        const entry = this.#entries.get(entryId);
        if (entry === undefined) {
            throw new TypeError(`入口 ${entryId} 未登记`);
        }
        if (scope === undefined) {
            if (entry.kind === "provider") {
                throw new TypeError(`提供者 ${entryId} 的依赖访问必须给出服务作用域或其子作用域`);
            }
            return this.#accessFor(entry, entry.entryScope);
        }
        if (!isStrictDescendant(scope, entry.scope)) {
            throw new TypeError(`访问作用域 ${scope.id} 必须是入口 ${entryId} 声明作用域 ${entry.scope.id} 的严格后代`);
        }
        return this.#accessFor(entry, scope);
    }

    async recover(providerId: EntryId): Promise<RecoverResult> {
        const entry = this.#entries.get(providerId);
        if (entry === undefined || entry.kind !== "provider") {
            throw new TypeError(`提供者 ${providerId} 未登记`);
        }
        const attempt = entry.current;
        if (attempt === null || attempt.settled === null || attempt.settled.status !== "failed") {
            return {status: "not-failed", providerId, state: this.#stateOf(entry)};
        }
        // 失败尝试的服务作用域已发起关闭；在途尝试直接等待其结算，已结算未完成则重试一次，不循环。
        const closeout = attempt.scope.phase === "closed" ? attempt.scope.snapshot().lastClose : await attempt.scope.recover();
        if (closeout === null || closeout.status !== "closed") {
            this.#record("recover", "closeout-incomplete", {entryId: providerId, key: entry.key.name, scopeId: attempt.scope.id});
            return {status: "closeout-incomplete", providerId, serviceScopeId: attempt.scope.id};
        }
        this.#attemptScopes.delete(attempt.scope.id);
        entry.current = null;
        this.#record("recover", "reset", {entryId: providerId, key: entry.key.name, scopeId: attempt.scope.id});
        return {status: "reset", providerId};
    }

    diagnostics(): ReadonlyArray<AssemblyDiagnostic> {
        return [...this.#diagnostics];
    }

    #validate(declaration: ProviderDeclaration<unknown> | ConsumerDeclaration, provider: ProviderDeclaration<unknown> | null): DeclarationRejection | null {
        if (this.#entries.has(declaration.id)) {
            return "duplicate-id";
        }
        const keys = (declaration.dependencies ?? []).map((dependency) => dependency.key);
        if (provider !== null) {
            keys.push(provider.key);
        }
        if (keys.some((key) => !this.#keys.has(key))) {
            return "unknown-key";
        }
        if (declaration.location !== this.location) {
            return "location-mismatch";
        }
        if (declaration.scope.instanceId !== this.instanceId) {
            return "foreign-scope";
        }
        if (!isAlive(declaration.scope)) {
            return "scope-not-alive";
        }
        return null;
    }

    #stateOf(entry: ProviderEntry): ProviderState {
        if (!isAlive(entry.scope)) {
            return "stopped";
        }
        const attempt = entry.current;
        if (attempt === null) {
            return "unresolved";
        }
        if (attempt.settled === null) {
            return "initializing";
        }
        if (attempt.settled.status === "available") {
            return attempt.scope.phase === "available" ? "available" : "stopped";
        }
        return attempt.settled.status;
    }

    #accessFor(entry: Entry, scope: Scope): ServiceAccess {
        return {
            entryId: entry.id,
            scope,
            resolve: <T>(key: ServiceKey<T>, options: ResolveOptions = {}) =>
                this.#resolve(entry, scope, key, options) as Promise<ResolveResult<T>>,
        };
    }

    /** 访问作用域位于某个正在初始化的服务作用域内，则这次等待归属该提供者的尝试。 */
    #waitingAttempt(scope: Scope): {readonly provider: ProviderEntry; readonly attempt: Attempt} | null {
        for (let current: Scope | null = scope; current !== null; current = current.parent) {
            const provider = this.#attemptScopes.get(current.id);
            const attempt = provider?.current ?? null;
            if (provider !== undefined && attempt !== null && attempt.settled === null) {
                return {provider, attempt};
            }
        }
        return null;
    }

    /** `from` 是否（传递地）正在等待 `target`；返回从 `from` 的下一跳到 `target` 的路径。 */
    #waitPath(from: ProviderEntry, target: ProviderEntry, seen: Set<ProviderEntry>): EntryId[] | null {
        if (from.current === null || seen.has(from)) {
            return null;
        }
        seen.add(from);
        for (const next of from.current.waitingOn) {
            if (next === target) {
                return [next.id];
            }
            const path = this.#waitPath(next, target, seen);
            if (path !== null) {
                return [next.id, ...path];
            }
        }
        return null;
    }

    async #resolve(entry: Entry, scope: Scope, key: ServiceKey<unknown>, options: ResolveOptions): Promise<ResolveResult<unknown>> {
        const unavailable = (reason: UnavailableReason, extra: Partial<Unavailable> = {}): Unavailable => ({
            status: "unavailable",
            key: key.name,
            reason,
            providerId: null,
            error: null,
            path: [],
            ...extra,
        });
        if (!isAlive(scope)) {
            return unavailable("consumer-stopped");
        }
        if (!entry.dependencies.some((dependency) => dependency.key === key)) {
            return unavailable("undeclared-dependency");
        }
        const report = this.report().entries.find((candidate) => candidate.id === entry.id);
        if (report === undefined) {
            return unavailable("consumer-stopped");
        }
        // 键自身的问题优先于入口整体被拒：调用方先看到这条依赖为什么不可用。
        const verdict = report.dependencies.find((candidate) => candidate.key === key.name)!;
        switch (verdict.status) {
            case "missing":
                return unavailable("missing-provider");
            case "unreachable":
                return unavailable("scope-lifetime", {path: verdict.providerIds});
            case "conflict":
                return unavailable("conflict", {path: verdict.providerIds});
            case "provider-rejected":
                return unavailable("provider-rejected", {providerId: verdict.providerId, path: [verdict.providerId]});
            case "satisfied":
                break;
        }
        if (report.verdict === "rejected") {
            return unavailable("entry-rejected", {providerId: verdict.providerId, path: [entry.id]});
        }
        const provider = this.#entries.get(verdict.providerId);
        if (provider === undefined || provider.kind !== "provider") {
            // 不变量：静态检查只从当前登记表选提供者。
            throw new Error(`静态检查选定的提供者 ${verdict.providerId} 不存在`);
        }

        const waiting = this.#waitingAttempt(scope);
        if (waiting !== null) {
            const cycle = this.#waitPath(provider, waiting.provider, new Set());
            if (cycle !== null) {
                const path = [waiting.provider.id, provider.id, ...cycle.slice(0, -1)];
                this.#record("resolve", "dependency-cycle", {entryId: waiting.provider.id, key: key.name, scopeId: scope.id});
                return unavailable("dependency-cycle", {providerId: provider.id, path});
            }
            // 等待边必须在触发目标初始化之前登记：目标的 create 可能同步再进入本方法。
            waiting.attempt.waitingOn.add(provider);
        }
        try {
            const attempt = this.#attemptFor(provider);
            if (attempt === null) {
                return unavailable("provider-stopped", {providerId: provider.id});
            }
            const outcome = await awaitOrCancel(attempt.outcome, options.signal);
            if (outcome === CANCELLED) {
                return unavailable("cancelled", {providerId: provider.id});
            }
            if (outcome.status === "failed") {
                return outcome.failure;
            }
            if (outcome.status === "stopped" || attempt.scope.phase !== "available") {
                return unavailable("provider-stopped", {providerId: provider.id});
            }
            return this.#bind(scope, provider, attempt, outcome.handle) ?? unavailable("consumer-stopped", {providerId: provider.id});
        } finally {
            waiting?.attempt.waitingOn.delete(provider);
        }
    }

    /** 借用实例到访问作用域；访问作用域已不再存活时返回 null。 */
    #bind(scope: Scope, provider: ProviderEntry, attempt: Attempt, handle: ResourceHandle<unknown>): ResolveResult<unknown> | null {
        let borrowed;
        try {
            borrowed = scope.borrow(handle);
        } catch (error) {
            if (error instanceof LifecycleStateError) {
                return null;
            }
            throw error;
        }
        if (borrowed.status !== "borrowed") {
            return {status: "unavailable", key: provider.key.name, reason: "provider-stopped", providerId: provider.id, error: null, path: []};
        }
        const borrow = borrowed.handle;
        const binding: ServiceBinding = {
            key: provider.key.name,
            providerId: provider.id,
            serviceScopeId: attempt.scope.id,
            resourceId: handle.id,
            dependency: borrow as ReleaseDependency,
            get stale(): boolean {
                return attempt.scope.phase !== "available" || handle.status !== "registered";
            },
            release: () => borrow.release(),
        };
        return {status: "resolved", instance: handle.value, binding};
    }

    /** 取当前尝试（在途、成功、稳定失败或已停止都复用）；没有尝试且 owner 存活时新建一次。 */
    #attemptFor(provider: ProviderEntry): Attempt | null {
        if (provider.current !== null) {
            return provider.current;
        }
        if (!isAlive(provider.scope)) {
            return null;
        }
        provider.attempts += 1;
        const scope = provider.scope.createChild(`service:${provider.key.name}#${provider.attempts}`);
        const {promise, resolve} = Promise.withResolvers<AttemptOutcome>();
        const attempt: Attempt = {scope, outcome: promise, settled: null, waitingOn: new Set()};
        provider.current = attempt;
        this.#attemptScopes.set(scope.id, provider);
        void this.#runAttempt(provider, attempt).then((outcome) => {
            attempt.settled = outcome;
            resolve(outcome);
        });
        return attempt;
    }

    async #runAttempt(provider: ProviderEntry, attempt: Attempt): Promise<AttemptOutcome> {
        const scope = attempt.scope;
        const keyName = provider.key.name;
        const fail = (reason: InitializationFailure, error: FailureError | null, path: ReadonlyArray<EntryId>): AttemptOutcome => {
            const failure: Unavailable = {status: "unavailable", key: keyName, reason, providerId: provider.id, error, path: [provider.id, ...path]};
            this.#record("initialize", reason, {entryId: provider.id, key: keyName, scopeId: scope.id, error});
            void scope.close();
            return {status: "failed", failure};
        };

        // 只预解析必需依赖：可选依赖由 create 按需 `services.resolve`，不因声明而初始化。
        const dependencies: ReleaseDependency[] = [];
        const required = new Map<ServiceKey<unknown>, unknown>();
        for (const dependency of provider.dependencies) {
            if (!dependency.required) {
                continue;
            }
            const result = await this.#resolve(provider, scope, dependency.key, {});
            if (!isAlive(scope)) {
                return {status: "stopped"};
            }
            if (result.status === "resolved") {
                dependencies.push(result.binding.dependency);
                required.set(dependency.key, result.instance);
                continue;
            }
            const path = result.path.length > 0 ? result.path : result.providerId === null ? [] : [result.providerId];
            return fail(result.reason === "dependency-cycle" ? "dependency-cycle" : "dependency-unavailable", result.error, path);
        }

        const context: ServiceCreateContext = {
            scope,
            services: {
                ...this.#accessFor(provider, scope),
                require: <T>(key: ServiceKey<T>): T => {
                    if (!required.has(key)) {
                        throw new TypeError(`${key.name} 不是提供者 ${provider.id} 已解析的必需依赖`);
                    }
                    return required.get(key) as T;
                },
            },
            signal: scope.stopSignal,
        };
        let acquired;
        try {
            acquired = await scope.acquire({
                kind: "service",
                label: keyName,
                acquire: () => provider.create(context),
                release: (instance) => provider.release?.(instance),
                dependsOn: dependencies,
            });
        } catch (error) {
            if (error instanceof LifecycleStateError) {
                return {status: "stopped"};
            }
            throw error;
        }
        switch (acquired.status) {
            case "acquired":
                scope.open();
                return {status: "available", handle: acquired.handle};
            case "late":
            case "cancelled":
                this.#record("initialize", "provider-stopped", {entryId: provider.id, key: keyName, scopeId: scope.id});
                return {status: "stopped"};
            case "failed":
                return fail("initialization-failed", summarizeFailure(acquired.error), []);
        }
    }

    #record(
        stage: DiagnosticStage,
        reason: string,
        detail: {readonly entryId: EntryId | null; readonly key: string | null; readonly scopeId: ScopeId | null; readonly error?: FailureError | null},
    ): void {
        this.#sequence += 1;
        const diagnostic: AssemblyDiagnostic = {
            sequence: this.#sequence,
            instanceId: this.instanceId,
            location: this.location,
            scopeId: detail.scopeId,
            key: detail.key,
            entryId: detail.entryId,
            stage,
            reason,
            error: detail.error ?? null,
        };
        this.#diagnostics.push(diagnostic);
        try {
            this.#observer?.diagnosticRecorded?.(diagnostic);
        } catch {
            // 观察者是诊断通道，它的异常不得改变装配状态。
        }
    }
}
