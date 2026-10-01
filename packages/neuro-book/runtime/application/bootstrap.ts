/**
 * runtime.application 内核：一次运行实例的创建、清单登记、门禁、接纳与停止。
 *
 * 启动结果是一个共享 Promise：重复启动请求指向同一实例时只观察同一结果，不再创建一套提供者。
 * 停止走 runtime.lifecycle 的根作用域关闭：结果区分完成与未完成，超时不映射为 closed。
 */

import {createRuntimeInstance, LifecycleStateError, summarizeFailure} from "../lifecycle/lifecycle";
import type {CloseRequest, CloseResult, OperationSpec, RuntimeInstance, Scope} from "../lifecycle/lifecycle";
import {createPluginHost} from "../plugins/plugins";
import type {ActivationResult, PluginHost} from "../plugins/plugins";
import {createServiceAssembly} from "../services/services";
import type {ServiceAssembly} from "../services/services";

import type {
    AdmissionResult,
    Application,
    ApplicationManifest,
    ApplicationStatus,
    GateOutcome,
    HostContext,
    StartupFailure,
    StartupGate,
    StartupResult,
    StopResult,
} from "./contracts";

function isRequired(gate: StartupGate): boolean {
    return gate.required !== false;
}

function activationDetail(result: Exclude<ActivationResult, {readonly status: "activated"}>): string {
    if (result.status === "failed") {
        return `${result.stage}/${result.reason}`;
    }
    if (result.status === "rejected") {
        return result.reason === "blocked" ? `blocked:${result.blocked.reason}` : `rejected:${result.reason}`;
    }
    return result.status;
}

/** 首次停止的关闭请求：宿主截止与调用方截止同时约束，任一触发即本次尝试结算为未完成。 */
function firstStopRequest(host: AbortSignal | undefined, request: CloseRequest | undefined): CloseRequest | undefined {
    if (host === undefined) {
        return request;
    }
    const own = request?.deadline;
    return {...request, deadline: own === undefined ? host : AbortSignal.any([host, own])};
}

export class ApplicationImpl implements Application {
    readonly identity;
    readonly root: Scope;
    readonly assembly: ServiceAssembly;
    readonly plugins: PluginHost;
    readonly startup: Promise<StartupResult>;
    readonly #host: HostContext;
    readonly #manifest: ApplicationManifest;
    readonly #instance: RuntimeInstance;
    readonly #gates: GateOutcome[] = [];
    readonly #failures: StartupFailure[] = [];
    #startup: StartupResult | null = null;
    #stop: Promise<StopResult> | null = null;
    #stopResult: StopResult | null = null;
    /** 已发过紧急输出的关闭结果：恢复加入在途尝试时拿到同一结果，不重复报告。 */
    #reportedClose: CloseResult | null = null;
    readonly #stopped = Promise.withResolvers<StopResult>();
    readonly stopped: Promise<StopResult> = this.#stopped.promise;
    readonly #closed = Promise.withResolvers<void>();
    readonly closed: Promise<void> = this.#closed.promise;

    constructor(host: HostContext, manifest: ApplicationManifest) {
        this.#host = host;
        this.#manifest = manifest;
        this.#instance = createRuntimeInstance(host.identity, {observer: manifest.observers?.lifecycle});
        this.identity = this.#instance.identity;
        this.root = this.#instance.root;
        this.assembly = createServiceAssembly(this.#instance, {keys: manifest.keys, observer: manifest.observers?.services});
        this.plugins = createPluginHost(this.#instance, this.assembly, {receivers: manifest.receivers, observer: manifest.observers?.plugins});
        if (host.stopSignal.aborted) {
            void this.stop();
        } else {
            host.stopSignal.addEventListener("abort", () => void this.stop(), {once: true});
        }
        this.startup = this.#start();
    }

    status(): ApplicationStatus {
        return {
            identity: this.identity,
            phase: this.root.phase,
            admission: this.root.phase === "available" ? "open" : "closed",
            startup: this.#startup,
            gates: [...this.#gates],
            failures: [...this.#failures],
            stop: this.#stopResult,
        };
    }

    async admit<T>(spec: OperationSpec<T>): Promise<AdmissionResult<T>> {
        const startup = await this.startup;
        if (startup.status !== "available") {
            // 启动失败与启动前被宿主停止是两种原因：后者按根作用域当前阶段报告。
            const reason = startup.status === "failed" ? "startup-failed" : this.root.phase === "closed" ? "closed" : "stopping";
            return {status: "rejected", reason};
        }
        try {
            return {status: "accepted", operation: this.root.accept(spec)};
        } catch (error) {
            if (error instanceof LifecycleStateError) {
                return {status: "rejected", reason: this.root.phase === "closed" ? "closed" : "stopping"};
            }
            throw error;
        }
    }

    stop(request?: CloseRequest): Promise<StopResult> {
        if (this.#stop === null) {
            this.#stop = this.#settleStop(this.root.close(firstStopRequest(this.#host.stopDeadline?.(), request)));
            this.#stopped.resolve(this.#stop);
        }
        return this.#stop;
    }

    recover(request?: CloseRequest): Promise<StopResult> {
        this.#stop = this.#settleStop(this.root.recover(request));
        return this.#stop;
    }

    #settleStop(closing: Promise<CloseResult>): Promise<StopResult> {
        return closing.then((result): StopResult => {
            const stop: StopResult = result.status === "closed" ? {status: "closed"} : {status: "incomplete", reason: result.reason, report: result};
            this.#stopResult = stop;
            if (stop.status === "closed") {
                this.#closed.resolve();
            }
            if (stop.status === "incomplete" && result !== this.#reportedClose) {
                this.#reportedClose = result;
                const report = stop.report;
                this.#emergency("stop", `关闭未完成：${stop.reason}`, `failedResources=${report.failedResources.length} pendingReleases=${report.pendingReleases.length} unclosedChildren=${report.unclosedChildren.length}`);
            }
            return stop;
        });
    }

    async #start(): Promise<StartupResult> {
        // 登记清单：本地能力与插件都只登记描述，不实例化。
        for (const capability of this.#manifest.capabilities ?? []) {
            const result = this.assembly.declare({
                id: capability.id,
                key: capability.key,
                location: this.identity.location,
                scope: this.root,
                dependencies: capability.dependencies,
                create: (context) => capability.create(context),
                release: capability.release === undefined ? undefined : (instance) => capability.release!(instance),
            });
            if (result.status === "rejected") {
                this.#fail({category: "manifest", required: true, source: capability.id, stage: "register", reason: `capability:${result.reason}`, error: null});
            }
        }
        const requiredPlugins = new Set(this.#manifest.requiredPlugins ?? []);
        const startupEntries: Array<{plugin: string; entry: string; required: boolean}> = [];
        const declaredPlugins = new Set<string>();
        for (const definition of this.#manifest.plugins) {
            const result = this.plugins.register(definition, {scope: this.root});
            declaredPlugins.add(definition.id);
            if (result.status === "rejected") {
                const referenced = requiredPlugins.has(definition.id) || this.#manifest.gates.some((gate) => gate.kind === "activate" && isRequired(gate) && gate.entry.plugin === definition.id);
                const reasons = result.rejections.map((rejection) => (rejection.entry === null ? rejection.reason : `${rejection.entry}:${rejection.reason}`)).join(",");
                this.#fail({category: "manifest", required: referenced, source: definition.id, stage: "register", reason: `plugin:${reasons}`, error: null});
                continue;
            }
            const required = requiredPlugins.has(definition.id);
            const selected = definition.entries.filter((entry) => entry.location === this.identity.location && (required || entry.activationEvents?.includes("onStartup")));
            for (const entry of selected) {
                startupEntries.push({plugin: definition.id, entry: entry.id, required});
            }
        }
        for (const plugin of requiredPlugins) {
            if (!declaredPlugins.has(plugin)) {
                this.#fail({category: "manifest", required: true, source: plugin, stage: "register", reason: "plugin:unknown-plugin", error: null});
            }
        }
        const activationFailures = await Promise.all(startupEntries.map(async ({plugin, entry, required}): Promise<StartupFailure | null> => {
            if (this.root.phase !== "creating") {
                return null;
            }
            const base = {category: "activation", required, source: `${plugin}/${entry}`, stage: "activate"} as const;
            try {
                const result = await this.plugins.activate({plugin, entry}, {signal: this.root.stopSignal});
                if ((result.status === "cancelled" || result.status === "stopped") && this.root.phase !== "creating") {
                    return null;
                }
                return result.status === "activated" ? null : {...base, reason: activationDetail(result), error: result.status === "failed" ? result.error : null};
            } catch (error) {
                return {...base, reason: "activate:threw", error: summarizeFailure(error)};
            }
        }));
        // Promise.all 保留选择顺序，完成先后不改变失败报告的顺序。
        for (const failure of activationFailures) {
            if (failure !== null) {
                this.#fail(failure);
            }
        }

        // 门禁顺序执行；宿主停止后余下门禁跳过。
        for (const gate of this.#manifest.gates) {
            if (this.root.phase !== "creating") {
                this.#gates.push({id: gate.id, required: isRequired(gate), status: "skipped"});
                continue;
            }
            const outcome = await this.#runGate(gate);
            this.#gates.push(outcome);
            if (outcome.status === "failed") {
                this.#fail({category: "gate", required: outcome.required, source: gate.id, stage: "gate", reason: outcome.reason, error: outcome.error});
            }
        }

        const gates = [...this.#gates];
        const failures = [...this.#failures];
        if (this.root.phase !== "creating") {
            const stop = await this.stop();
            this.#fail({category: "stopped", required: true, source: this.identity.instanceId, stage: "gate", reason: "宿主在启动完成前要求停止", error: null});
            return this.#settle({status: "stopped", instanceId: this.identity.instanceId, gates, failures: [...this.#failures], stop});
        }
        if (failures.some((failure) => failure.required)) {
            const summary = failures.filter((failure) => failure.required).map((failure) => `${failure.source}:${failure.reason}`).join("; ");
            this.#emergency("startup", "必需门禁失败，业务不接纳", summary);
            const stop = await this.stop();
            return this.#settle({status: "failed", instanceId: this.identity.instanceId, gates, failures, stop});
        }
        try {
            this.root.open();
        } catch (error) {
            if (!(error instanceof LifecycleStateError)) {
                throw error;
            }
            // 同步段内根作用域已被停止（宿主信号在最后一个门禁结算后到达）。
            const stop = await this.stop();
            return this.#settle({status: "stopped", instanceId: this.identity.instanceId, gates, failures, stop});
        }
        return this.#settle({status: "available", instanceId: this.identity.instanceId, gates, failures});
    }

    async #runGate(gate: StartupGate): Promise<GateOutcome> {
        const base = {id: gate.id, required: isRequired(gate)};
        const failed = (reason: string, error: unknown = null): GateOutcome => ({...base, status: "failed", reason, error: error === null ? null : summarizeFailure(error)});
        try {
            switch (gate.kind) {
                case "activate": {
                    const result = await this.plugins.activate(gate.entry, {signal: this.root.stopSignal});
                    if (result.status === "activated") {
                        return {...base, status: "passed"};
                    }
                    const detail = result.status === "rejected" && result.reason !== "blocked" ? result.reason : activationDetail(result);
                    return {...base, status: "failed", reason: `activate:${detail}`, error: result.status === "failed" ? result.error : null};
                }
                case "resolve": {
                    const consumerId = `application:gate:${gate.id}`;
                    const declared = this.assembly.declare({id: consumerId, location: this.identity.location, scope: this.root, dependencies: [{key: gate.key}]});
                    if (declared.status === "rejected") {
                        return failed(`resolve:${declared.reason}`);
                    }
                    const result = await this.assembly.access(consumerId).resolve(gate.key, {signal: this.root.stopSignal});
                    if (result.status === "resolved") {
                        return {...base, status: "passed"};
                    }
                    return {...base, status: "failed", reason: `resolve:${result.reason}`, error: result.error};
                }
                case "check": {
                    const consumerId = `application:gate:${gate.id}`;
                    const declared = this.assembly.declare({id: consumerId, location: this.identity.location, scope: this.root, dependencies: gate.dependencies ?? []});
                    if (declared.status === "rejected") {
                        return failed(`check:${declared.reason}`);
                    }
                    await gate.check({signal: this.root.stopSignal, root: this.root, services: this.assembly.access(consumerId)});
                    return {...base, status: "passed"};
                }
            }
        } catch (error) {
            return failed(`${gate.kind}:threw`, error);
        }
    }

    #fail(failure: StartupFailure): void {
        this.#failures.push(failure);
    }

    #settle(result: StartupResult): StartupResult {
        this.#startup = result;
        return result;
    }

    #emergency(stage: "startup" | "stop", reason: string, detail: string | null): void {
        try {
            this.#host.emergency({instanceId: this.identity.instanceId, stage, reason, detail});
        } catch {
            // 紧急输出是宿主兜底通道，它的异常不得改变机制状态。
        }
    }
}
