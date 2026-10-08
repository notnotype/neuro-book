/**
 * 每个内核实例一个远程节点：作为提供方，它查找本实例的远程提供项、核对版本与调用方、按调用方生成
 * 门面并执行；作为调用方，它把调用发到本实例或上游（客户端与项目实例的上游是服务端的路由，服务端
 * 节点的上游是本进程的路由）。同实例调用不经链路，但核对与门面规则相同。
 * 行为合同见 docs/specs/runtime/plugin-channel.md。
 */

import {systemClock} from "../lifecycle/lifecycle";
import type {RuntimeClock} from "../lifecycle/lifecycle";
import {perConsumer} from "../services/services";
import type {ConsumerIdentity, PerConsumerProvision} from "../services/services";

import {providerAccepts} from "./contract";
import type {RemoteClient, RemoteContract, RemoteImplementation, RemoteProviderLocation, RemoteSubscribeOptions, RemoteUse} from "./contract";
import {Peer} from "./peer";
import type {Reply, RequestOptions, SubscribeHandlers, SubscriptionChannel} from "./peer";
import {failureFor, REMOTE_FAILURE_CODES, reservedKeys, validationProblems, WIRE_PROTOCOL_VERSION} from "./protocol";
import type {
    BindRequest,
    CallerFrame,
    ChainLink,
    InstanceDescriptor,
    Outcome,
    ProjectBinding,
    ReleaseFrame,
    RemoteResult,
    RemoteTarget,
    RequestFrame,
    RequestPhase,
    SubscribeFrame,
} from "./protocol";
import type {RemoteLink} from "./transport";

/** 激活产出里的一项远程提供：合同与按调用方的实现工厂。用 `provideRemote` 构造。 */
declare const provisionContract: unique symbol;

/** 一项远程提供；类型参数只在编译期，供 `defineEntry` 核对合同。 */
export interface RemoteProvision<Contract extends RemoteContract = RemoteContract> {
    readonly contract: RemoteContract;
    readonly provision: PerConsumerProvision<RemoteImplementation<RemoteContract>>;
    readonly [provisionContract]?: Contract;
}

/**
 * 构造一项远程提供。实现的类型在这里按合同核对；交出去的提供项擦除成通用形状，因为激活产出里
 * 放的是不同合同的混合列表，节点只按合同的 schema 在运行期核对。
 */
export function provideRemote<Contract extends RemoteContract>(
    contract: Contract,
    facade: (consumer: ConsumerIdentity) => RemoteImplementation<Contract>,
    options: {readonly release?: (implementation: RemoteImplementation<Contract>, consumer: ConsumerIdentity) => void | Promise<void>} = {},
): RemoteProvision<Contract> {
    const provision = perConsumer(facade, options.release) as unknown as PerConsumerProvision<RemoteImplementation<RemoteContract>>;
    return {contract, provision};
}

export type ProviderLookup =
    | {
        readonly status: "found";
        readonly provision: RemoteProvision;
        readonly entry: {readonly plugin: string; readonly entry: string; readonly generation: number};
        /** 提供入口的这一代开始停止时触发。 */
        readonly stopSignal: AbortSignal;
    }
    /** 本实例没有已登记的插件在本运行位置的入口里声明这份合同：没装、已停用或已卸载。 */
    | {readonly status: "missing"}
    | {readonly status: "unavailable"; readonly reason: string; readonly cause?: "activation-cycle"};

/** 插件宿主实现：按合同 id 找本实例的提供入口，必要时按 onRemote 激活它。 */
export interface RemoteProviderSource {
    lookup(contractId: string, chain: ReadonlyArray<ChainLink>, signal: AbortSignal): Promise<ProviderLookup>;
}

/** 插件宿主为每次入口激活提供的调用方上下文。 */
export interface RemoteCallerContext {
    readonly consumer: ConsumerIdentity;
    /**
     * 本入口激活期间为“触发它的入站激活链 + 本入口”，激活结束后为空；随调用帧发出，用来发现激活
     * 等待环（runtime/plugin-channel.md 输出第 6 条）。
     */
    chain(): ReadonlyArray<ChainLink>;
    /** 本入口仍在激活中。 */
    activating(): boolean;
    /** 调用方入口的这一代开始停止时触发：在途调用取消、订阅结束。 */
    readonly signal: AbortSignal;
    /** 这一代结束时调用一次 `callback`；已结束则立即调用。 */
    onRelease(callback: () => void): void;
    /**
     * 每次调用与订阅前的准入核对：返回拒绝原因时为 `denied`，不发出请求。经代理的访问用它让先前取得的客户端在
     * 签发身份失效后同样被拒（runtime/plugin-channel.md 输出第 10 条）；入口自己的访问不需要。
     */
    admit?(): string | null;
}

/** 激活上下文里的 `context.remote`。 */
export interface RemoteAccess {
    use<Contract extends RemoteContract>(contract: Contract): RemoteUse<Contract>;
    instances(): Promise<RemoteResult<ReadonlyArray<InstanceDescriptor>>>;
}

/** 插件宿主依赖的节点接口。 */
export interface RemoteHostBinding {
    /** 本实例的描述；插件宿主据其角色核对激活产出的远程提供项是否放对了位置。 */
    readonly instance: InstanceDescriptor;
    attach(source: RemoteProviderSource): void;
    access(caller: RemoteCallerContext): RemoteAccess;
}

export interface RemoteDiagnostic {
    readonly sequence: number;
    readonly instanceId: string;
    readonly reason: string;
    readonly contract: string | null;
    readonly detail: string | null;
}

export interface RemoteNodeOptions {
    /** 客户端的 `project` 恒为 null：绑定由服务端在握手时决定。 */
    readonly instance: InstanceDescriptor;
    /** 客户端要绑定的项目（短名或 id）；第一次握手后改为按已绑定的 id 与代次重连。 */
    readonly bind?: {readonly project: string} | null;
    readonly clock?: RuntimeClock;
    /** 开发模式打开：同实例调用也按合同校验，并经结构化克隆，提前发现传了不可序列化的值。 */
    readonly validateLocalCalls?: boolean;
    /** 激活期间发出的远程调用的超时上限（毫秒），默认 10 秒；作者只能设得更短。 */
    readonly maxActivationCallMs?: number;
    readonly observer?: {diagnosticRecorded?(diagnostic: RemoteDiagnostic): void};
}

/**
 * 连接结果。失败的 `reason`：服务端拒绝握手时是拒绝帧的原因（`wire-version`、`stopping`、`duplicate-instance`、
 * `role`、`project-unavailable`、`project-gone`），握手完成前链路关闭为 `disconnected`，服务端已换进程为
 * `server-restarted`。
 */
export type RemoteConnectResult = {readonly ok: true} | {readonly ok: false; readonly reason: string; readonly message: string};

export interface RemoteNode extends RemoteHostBinding {
    /** 第一次握手得到的绑定；没有请求绑定或还没连上时为 null。 */
    readonly binding: ProjectBinding | null;
    /**
     * 连到上游（服务端路由）。连回同一服务端进程、同一项目代次时，仍有效的订阅会重建并收到 `onResync`。
     * 进入终态时全部远程订阅以终态原因结束，此后本节点不再连得上、远程调用为 `unavailable`，客户端要重新启动：
     * 服务端已换进程（welcome 的 `boot` 与第一次连接时不同）为 `server-restarted`；绑定的项目代次已结束（重连
     * 被以 `project-gone` 拒绝，或 welcome 的绑定与记下的不同，不接受改投）为 `project-gone`。
     */
    connect(link: RemoteLink): Promise<RemoteConnectResult>;
    diagnostics(): ReadonlyArray<RemoteDiagnostic>;
}

/** 路由与节点之间的出站接口：客户端与项目实例由连向服务端的链路实现，服务端节点由路由实现。 */
export interface Upstream {
    request(frame: Omit<RequestFrame, "type" | "id">, options: RequestOptions): Promise<Outcome>;
    subscribe(frame: Omit<SubscribeFrame, "type" | "id">, handlers: SubscribeHandlers): {readonly outcome: Promise<Outcome>; cancel(): void};
    release(frame: Omit<ReleaseFrame, "type">): void;
}

const DEFAULT_ACTIVATION_CALL_LIMIT_MS = 10_000;

interface FacadeGroup {
    readonly provision: RemoteProvision;
    readonly facades: Map<string, {readonly implementation: RemoteImplementation<RemoteContract>; readonly consumer: ConsumerIdentity}>;
}

interface ActiveSubscription {
    readonly frame: Omit<SubscribeFrame, "type" | "id">;
    readonly listener: (payload: unknown) => void;
    readonly options: RemoteSubscribeOptions;
    readonly payloadSchema: RemoteContract["events"][string]["payload"];
    cancel: () => void;
    ended: boolean;
}

function consumerKey(consumer: CallerFrame | ConsumerIdentity): string {
    return JSON.stringify([consumer.instanceId, consumer.client, consumer.plugin, consumer.entry, consumer.generation, consumer.via?.plugin ?? null, consumer.via?.entry ?? null, consumer.via?.generation ?? null]);
}

function toCallerFrame(consumer: ConsumerIdentity): CallerFrame {
    return {
        instanceId: consumer.instanceId,
        location: consumer.location,
        client: consumer.client,
        plugin: consumer.plugin,
        entry: consumer.entry,
        generation: consumer.generation,
        via: consumer.via === null ? null : {plugin: consumer.via.plugin, entry: consumer.via.entry, generation: consumer.via.generation},
    };
}

function toConsumer(frame: CallerFrame): ConsumerIdentity {
    return Object.freeze({...frame, via: frame.via === null ? null : Object.freeze({...frame.via})});
}

/** 能由提供方位置推出的缺省目标；推不出时为 null，调用方必须写 `.at(...)`。 */
function defaultTarget(provider: RemoteProviderLocation): RemoteTarget | null {
    return provider === "server" || provider === "project" ? provider : null;
}

function targetKey(target: RemoteTarget): string {
    return typeof target === "string" ? target : JSON.stringify(target);
}

/** 任一信号触发即触发；不支持 AbortSignal.any 的环境也能用。 */
function anySignal(signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal {
    const controller = new AbortController();
    for (const signal of signals) {
        if (signal === undefined) {
            continue;
        }
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), {once: true});
    }
    return controller.signal;
}

export class RemoteNodeImpl implements RemoteNode {
    #instance: InstanceDescriptor;
    readonly #clock: RuntimeClock;
    readonly #validateLocal: boolean;
    readonly #activationLimit: number;
    readonly #observer: RemoteNodeOptions["observer"];
    readonly #diagnostics: RemoteDiagnostic[] = [];
    /** `合同 id#提供入口#代次` → 门面组；提供入口这一代停止时整组释放。 */
    readonly #groups = new Map<string, FacadeGroup>();
    readonly #subscriptions = new Set<ActiveSubscription>();
    #source: RemoteProviderSource | null = null;
    #upstream: Upstream | null = null;
    #upstreamPeer: Peer | null = null;
    /** 第一次握手得到的服务端进程标识。 */
    #boot: string | null = null;
    /** 首次连接的绑定请求；拿到绑定后重连改带 id 与代次。 */
    readonly #bindRequest: {readonly project: string} | null;
    #binding: ProjectBinding | null = null;
    /** 终态的连接结果；进入后不再连接。 */
    #terminal: Extract<RemoteConnectResult, {ok: false}> | null = null;
    #sequence = 0;

    constructor(options: RemoteNodeOptions) {
        this.#instance = Object.freeze({...options.instance});
        this.#bindRequest = options.bind ?? null;
        this.#clock = options.clock ?? systemClock;
        this.#validateLocal = options.validateLocalCalls ?? false;
        this.#activationLimit = options.maxActivationCallMs ?? DEFAULT_ACTIVATION_CALL_LIMIT_MS;
        this.#observer = options.observer;
    }

    get clock(): RuntimeClock {
        return this.#clock;
    }

    /** 客户端绑定项目后，描述带上绑定的项目代次。 */
    get instance(): InstanceDescriptor {
        return this.#instance;
    }

    get binding(): ProjectBinding | null {
        return this.#binding;
    }

    #helloBind(): BindRequest {
        if (this.#binding !== null) {
            return {project: this.#binding.id, generation: this.#binding.generation};
        }
        return this.#bindRequest === null ? null : {project: this.#bindRequest.project};
    }

    attach(source: RemoteProviderSource): void {
        this.#source = source;
    }

    /** 服务端节点由路由提供上游。 */
    useUpstream(upstream: Upstream): void {
        this.#upstream = upstream;
    }

    diagnostics(): ReadonlyArray<RemoteDiagnostic> {
        return [...this.#diagnostics];
    }

    /** 路由经这里记诊断，与节点自己的诊断同一序列。 */
    recordDiagnostic(reason: string, contract: string | null, detail: string | null): void {
        this.#record(reason, contract, detail);
    }

    async connect(link: RemoteLink): Promise<RemoteConnectResult> {
        if (this.#terminal !== null) {
            link.close();
            return this.#terminal;
        }
        const {promise, resolve} = Promise.withResolvers<{readonly ok: true; readonly boot: string; readonly binding: ProjectBinding | null} | Extract<RemoteConnectResult, {ok: false}>>();
        const peer = new Peer(
            link,
            {
                onWelcome: (frame) => resolve({ok: true, boot: frame.boot, binding: frame.binding}),
                onReject: (frame) => {
                    resolve({ok: false, reason: frame.reason, message: frame.message});
                    peer.close();
                },
                onRequest: (frame, reply, signal) => void this.handleRequest(frame, reply, signal),
                onSubscribe: (frame, channel, signal) => void this.handleSubscribe(frame, channel, signal),
                onRelease: (frame) => this.handleRelease(frame),
                onInvalidFrame: () => this.#record("invalid-frame", null, null),
                onClose: () => resolve({ok: false, reason: "disconnected", message: "链路在握手完成前关闭"}),
            },
            this.#clock,
        );
        // 客户端的 instance.project 恒为 null：绑定由服务端决定，经 bind 请求。
        const instance = this.#instance.role === "client" ? {...this.#instance, project: null} : {...this.#instance};
        peer.send({type: "hello", wire: WIRE_PROTOCOL_VERSION, instance, bind: this.#helloBind(), boot: this.#boot});
        const result = await promise;
        if (!result.ok) {
            const terminal = result.reason === "server-restarted" ? SERVER_RESTARTED : result.reason === "project-gone" ? PROJECT_GONE : null;
            if (terminal !== null) {
                this.#enterTerminal(terminal);
                return terminal;
            }
            return result;
        }
        // 第二道防线：路由本应已按 hello 的 boot 拒绝。
        if (this.#boot !== null && result.boot !== this.#boot) {
            peer.close();
            this.#enterTerminal(SERVER_RESTARTED);
            return SERVER_RESTARTED;
        }
        const rebound = this.#checkBinding(result.binding);
        if (rebound !== null) {
            peer.close();
            if (rebound.reason === "project-gone") {
                this.#enterTerminal(rebound);
            }
            return rebound;
        }
        this.#boot = result.boot;
        const previous = this.#upstreamPeer;
        // 一个节点同时只有一条上游链路：旧链路若还开着（服务端已接管它），关闭它，其上的请求按断开结算。
        previous?.close();
        this.#upstreamPeer = peer;
        this.#upstream = {
            request: (frame, options) => peer.request(frame, options),
            subscribe: (frame, handlers) => {
                const started = peer.subscribe(frame, handlers);
                return {outcome: started.outcome, cancel: () => peer.unsubscribe(started.id)};
            },
            release: (frame) => peer.send({type: "release", ...frame}),
        };
        if (previous !== null) {
            this.#resubscribeAll();
        }
        return {ok: true};
    }

    /**
     * 核对 welcome 的绑定。第一次：请求了绑定就必须拿到，记下它，描述随之带上项目代次。之后：必须与记下的
     * 同一 id、同一代次，否则是改投新代次，按 `project-gone` 进入终态（第二道防线，路由本应已拒绝）。
     */
    #checkBinding(binding: ProjectBinding | null): Extract<RemoteConnectResult, {ok: false}> | null {
        if (this.#binding !== null) {
            return binding !== null && binding.id === this.#binding.id && binding.generation === this.#binding.generation ? null : PROJECT_GONE;
        }
        if (this.#bindRequest === null) {
            return binding === null ? null : {ok: false, reason: "role", message: "没有请求绑定，服务端却回复了绑定"};
        }
        if (binding === null) {
            return {ok: false, reason: "project-unavailable", message: "服务端没有回复绑定"};
        }
        this.#binding = binding;
        this.#instance = Object.freeze({...this.#instance, project: {id: binding.id, generation: binding.generation}});
        return null;
    }

    /** 服务端已换进程或绑定的项目代次已结束：远程订阅不重建，以终态原因结束；此后没有上游。 */
    #enterTerminal(result: Extract<RemoteConnectResult, {ok: false}>): void {
        this.#terminal = result;
        this.#upstream = null;
        this.#upstreamPeer?.close();
        this.#upstreamPeer = null;
        for (const subscription of [...this.#subscriptions]) {
            if (this.#isLocal(subscription.frame.target)) {
                continue;
            }
            this.#subscriptions.delete(subscription);
            if (!subscription.ended) {
                subscription.ended = true;
                subscription.options.onEnd?.(result.reason);
            }
        }
    }

    /** 没有上游时远程调用与订阅的结果。 */
    #offline(): {readonly ok: false; readonly code: "unavailable"; readonly detail: string} {
        return {ok: false, code: "unavailable", detail: this.#terminal === null ? "本实例没有连到服务端" : `${this.#terminal.message}`};
    }

    access(caller: RemoteCallerContext): RemoteAccess {
        const contacted = new Map<string, RemoteTarget>();
        const owned = new Set<ActiveSubscription>();
        let registered = false;
        const ensureRelease = (): void => {
            if (registered) {
                return;
            }
            registered = true;
            caller.onRelease(() => {
                for (const subscription of owned) {
                    this.#endLocalSubscription(subscription);
                }
                owned.clear();
                const frame = {$nbConsumer: toCallerFrame(caller.consumer)};
                for (const target of contacted.values()) {
                    if (this.#isLocal(target)) {
                        this.handleRelease({type: "release", target, ...frame});
                    } else {
                        this.#upstream?.release({target, ...frame});
                    }
                }
            });
        };
        return {
            use: <Contract extends RemoteContract>(contract: Contract): RemoteUse<Contract> => {
                const at = (target: RemoteTarget): RemoteClient<Contract> => {
                    const remember = (): void => {
                        ensureRelease();
                        contacted.set(targetKey(target), target);
                    };
                    return this.#client(contract, target, caller, remember, owned);
                };
                const fallback = defaultTarget(contract.provider);
                // 类型上 RemoteUse 按合同的提供方位置二选一；这里按同一判据构造，交出时只能断言。
                return (fallback === null ? {at} : Object.assign(at(fallback), {at})) as unknown as RemoteUse<Contract>;
            },
            instances: () => this.#instances(caller),
        };
    }

    #client<Contract extends RemoteContract>(
        contract: Contract,
        target: RemoteTarget,
        caller: RemoteCallerContext,
        remember: () => void,
        owned: Set<ActiveSubscription>,
    ): RemoteClient<Contract> {
        // 目标与合同的提供方位置不符：调用与订阅都在未派发阶段失败，不发出请求。
        const misplaced: Outcome | null = providerAccepts(contract.provider, target)
            ? null
            : {ok: false, code: "invalid-input", detail: `目标 ${targetKey(target)} 与合同 ${contract.id} 的提供方位置 ${contract.provider} 不符`};
        const client: Record<string, unknown> = {};
        for (const [name, method] of Object.entries(contract.methods)) {
            client[name] = async (input: unknown, options: {readonly signal?: AbortSignal; readonly timeout?: number} = {}): Promise<Outcome> => {
                if (misplaced !== null) {
                    return misplaced;
                }
                if (reservedKeys(input).length > 0) {
                    return {ok: false, code: "invalid-input", detail: `业务参数不得含 $nb 开头的键：${reservedKeys(input).join("、")}`};
                }
                const refusal = caller.admit?.() ?? null;
                if (refusal !== null) {
                    return {ok: false, code: "denied", detail: refusal};
                }
                remember();
                const frame: Omit<RequestFrame, "type" | "id"> = {
                    target,
                    contract: contract.id,
                    version: contract.version,
                    method: name,
                    effect: method.effect,
                    input,
                    $nbConsumer: toCallerFrame(caller.consumer),
                    $nbChain: [...caller.chain()],
                };
                const timeoutMs = caller.activating() ? Math.min(options.timeout ?? this.#activationLimit, this.#activationLimit) : options.timeout;
                const requestOptions: RequestOptions = {signal: anySignal([options.signal, caller.signal]), timeoutMs};
                const outcome = this.#isLocal(target)
                    ? await this.#localRequest(frame, requestOptions)
                    : this.#upstream === null
                      ? this.#offline()
                      : await this.#upstream.request(frame, requestOptions);
                return this.#checkOutcome(contract.id, method, outcome);
            };
        }
        const events: Record<string, unknown> = {};
        for (const [name, event] of Object.entries(contract.events)) {
            events[name] = {
                subscribe: async (filter: unknown, listener: (payload: unknown) => void, options: RemoteSubscribeOptions = {}): Promise<Outcome> => {
                    if (misplaced !== null) {
                        return misplaced;
                    }
                    if (reservedKeys(filter).length > 0) {
                        return {ok: false, code: "invalid-input", detail: `过滤参数不得含 $nb 开头的键：${reservedKeys(filter).join("、")}`};
                    }
                    const refusal = caller.admit?.() ?? null;
                    if (refusal !== null) {
                        return {ok: false, code: "denied", detail: refusal};
                    }
                    if (caller.signal.aborted) {
                        return {ok: false, code: "cancelled"};
                    }
                    remember();
                    const subscription: ActiveSubscription = {
                        frame: {target, contract: contract.id, version: contract.version, event: name, filter, $nbConsumer: toCallerFrame(caller.consumer), $nbChain: [...caller.chain()]},
                        listener,
                        options,
                        payloadSchema: event.payload,
                        cancel: () => undefined,
                        ended: false,
                    };
                    const outcome = await this.#startSubscription(subscription);
                    if (!outcome.ok) {
                        return outcome;
                    }
                    // 结束可能早于建立返回（例如首个事件的监听里停了提供方）：已结束的不再登记，否则它留在两张表里不会删掉。
                    if (!subscription.ended) {
                        owned.add(subscription);
                        this.#subscriptions.add(subscription);
                    }
                    return {
                        ok: true,
                        value: {
                            release: () => {
                                owned.delete(subscription);
                                this.#endLocalSubscription(subscription);
                            },
                        },
                    };
                },
            };
        }
        client.events = events;
        return client as RemoteClient<Contract>;
    }

    /** 调用方一侧再核对一次结果：成功值按合同的输出 schema，失败码必须是路由层的或合同声明过的。 */
    #checkOutcome(contractId: string, spec: RemoteContract["methods"][string], outcome: Outcome): Outcome {
        if (outcome.ok) {
            const problems = validationProblems(spec.output, outcome.value);
            if (problems !== null) {
                this.#record("output-invalid", contractId, problems);
                return {ok: false, code: "provider-error", detail: `返回值不符合合同：${problems}`};
            }
            return outcome;
        }
        if (!(REMOTE_FAILURE_CODES as ReadonlyArray<string>).includes(outcome.code) && !Object.keys(spec.errors ?? {}).includes(outcome.code)) {
            this.#record("undeclared-error", contractId, outcome.code);
            return {ok: false, code: "provider-error", detail: `收到合同未声明的失败码 ${outcome.code}`};
        }
        return outcome;
    }

    #isLocal(target: RemoteTarget): boolean {
        const self = this.instance;
        if (target === "server") {
            return self.role === "hub";
        }
        if (target === "project") {
            return self.role === "project";
        }
        if ("project" in target) {
            return self.role === "project" && self.project?.id === target.project;
        }
        return target.client === self.id;
    }

    /** 同实例调用：不经链路，但阶段、超时、取消与核对都和跨实例相同。 */
    async #localRequest(frame: Omit<RequestFrame, "type" | "id">, options: RequestOptions): Promise<Outcome> {
        let input = frame.input;
        if (this.#validateLocal) {
            try {
                input = structuredClone(frame.input);
            } catch (error) {
                return {ok: false, code: "invalid-input", detail: `参数不可序列化：${error instanceof Error ? error.message : String(error)}`};
            }
        }
        const controller = new AbortController();
        const {promise, resolve} = Promise.withResolvers<Outcome>();
        // 不经链路：ACK 与开始执行在同一个同步段里，中断时还没 ACK 的请求确定没有执行，不需要 sent 阶段。
        let phase: Extract<RequestPhase, "undispatched" | "acked"> = "undispatched";
        let settled = false;
        const settle = (outcome: Outcome): void => {
            if (!settled) {
                settled = true;
                cancelTimer();
                options.signal?.removeEventListener("abort", onAbort);
                resolve(outcome);
            }
        };
        const interrupt = (cause: "cancelled" | "timeout"): void => {
            controller.abort();
            settle(failureFor(phase, frame.effect, cause));
        };
        const onAbort = (): void => interrupt("cancelled");
        const cancelTimer = options.timeoutMs === undefined ? (): void => undefined : this.#clock.schedule(() => interrupt("timeout"), options.timeoutMs);
        if (options.signal?.aborted === true) {
            interrupt("cancelled");
            return promise;
        }
        options.signal?.addEventListener("abort", onAbort, {once: true});
        const reply: Reply = {
            ack: () => {
                phase = "acked";
            },
            result: (outcome) => {
                if (outcome.ok && this.#validateLocal) {
                    try {
                        settle({ok: true, value: structuredClone(outcome.value)});
                    } catch (error) {
                        settle({ok: false, code: "provider-error", detail: `返回值不可序列化：${error instanceof Error ? error.message : String(error)}`});
                    }
                    return;
                }
                settle(outcome);
            },
        };
        void this.handleRequest({type: "request", id: "local", ...frame, input}, reply, controller.signal);
        return promise;
    }

    /** 入站请求：核对 → ACK → 按调用方取门面 → 执行 → 核对结果。ACK 之前的失败都是确定的。 */
    async handleRequest(frame: RequestFrame, reply: Reply, signal: AbortSignal): Promise<void> {
        const fail = (code: Extract<Outcome, {ok: false}>["code"], detail?: string, cause?: "activation-cycle"): void =>
            reply.result({ok: false, code, ...(cause === undefined ? {} : {cause}), ...(detail === undefined ? {} : {detail})});
        if (reservedKeys(frame.input).length > 0) {
            fail("invalid-input", "业务参数不得含 $nb 开头的键");
            return;
        }
        const found = await this.#lookup(frame.contract, frame.$nbChain, signal);
        if (found.status === "missing") {
            fail("not-provided", `本实例没有提供 ${frame.contract}`);
            return;
        }
        if (found.status === "unavailable") {
            if (found.cause === "activation-cycle") {
                this.#record("activation-cycle", frame.contract, frame.$nbChain.map((link) => `${link.instanceId}:${link.plugin}/${link.entry}`).join(" → "));
            }
            fail("unavailable", found.reason, found.cause);
            return;
        }
        const contract = found.provision.contract;
        if (contract.version !== frame.version) {
            fail("version-changed", `合同 ${contract.id} 的版本为 ${String(contract.version)}，调用方期望 ${String(frame.version)}`);
            return;
        }
        if (!contract.callers.includes(frame.$nbConsumer.location)) {
            fail("denied", `合同 ${contract.id} 不允许 ${frame.$nbConsumer.location} 调用`);
            return;
        }
        const method = contract.methods[frame.method];
        if (method === undefined) {
            fail("invalid-input", `合同 ${contract.id} 没有方法 ${frame.method}`);
            return;
        }
        const inputProblems = validationProblems(method.input, frame.input);
        if (inputProblems !== null) {
            fail("invalid-input", inputProblems);
            return;
        }
        if (signal.aborted || found.stopSignal.aborted) {
            fail("unavailable", "提供入口正在停止");
            return;
        }
        const implementation = this.#facade(found, toConsumer(frame.$nbConsumer));
        if (implementation === null) {
            fail("provider-error", "提供方没有为调用方生成实现");
            return;
        }
        reply.ack();
        const run = implementation.methods[frame.method];
        let outcome: Awaited<ReturnType<NonNullable<typeof run>>>;
        try {
            if (run === undefined) {
                throw new Error(`实现缺少方法 ${frame.method}`);
            }
            outcome = await run(frame.input, {signal: anySignal([signal, found.stopSignal])});
        } catch (error) {
            this.#record("provider-threw", contract.id, error instanceof Error ? error.message : String(error));
            fail("provider-error", "提供方执行失败");
            return;
        }
        if (outcome.ok) {
            const problems = validationProblems(method.output, outcome.value);
            if (problems !== null) {
                this.#record("output-invalid", contract.id, problems);
                fail("provider-error", `返回值不符合合同：${problems}`);
                return;
            }
            reply.result({ok: true, value: outcome.value});
            return;
        }
        const declared = Object.keys(method.errors ?? {});
        if (!declared.includes(outcome.code)) {
            this.#record("undeclared-error", contract.id, outcome.code);
            fail("provider-error", `提供方返回了合同未声明的失败码 ${outcome.code}`);
            return;
        }
        reply.result({ok: false, code: outcome.code, ...(outcome.detail === undefined ? {} : {detail: outcome.detail})});
    }

    /** 入站订阅：与请求同样的核对；接受后调用提供方的 subscribe，提供入口停止时结束。 */
    async handleSubscribe(frame: SubscribeFrame, channel: SubscriptionChannel, signal: AbortSignal): Promise<void> {
        if (reservedKeys(frame.filter).length > 0) {
            channel.reject({ok: false, code: "invalid-input", detail: "过滤参数不得含 $nb 开头的键"});
            return;
        }
        const found = await this.#lookup(frame.contract, frame.$nbChain, signal);
        if (found.status !== "found") {
            channel.reject(found.status === "missing" ? {ok: false, code: "not-provided", detail: `本实例没有提供 ${frame.contract}`} : {ok: false, code: "unavailable", detail: found.reason});
            return;
        }
        const contract = found.provision.contract;
        const event = contract.events[frame.event];
        if (contract.version !== frame.version) {
            channel.reject({ok: false, code: "version-changed", detail: `合同 ${contract.id} 的版本为 ${String(contract.version)}`});
            return;
        }
        if (!contract.callers.includes(frame.$nbConsumer.location)) {
            channel.reject({ok: false, code: "denied", detail: `合同 ${contract.id} 不允许 ${frame.$nbConsumer.location} 订阅`});
            return;
        }
        if (event === undefined) {
            channel.reject({ok: false, code: "invalid-input", detail: `合同 ${contract.id} 没有事件 ${frame.event}`});
            return;
        }
        const filterProblems = validationProblems(event.filter, frame.filter);
        if (filterProblems !== null) {
            channel.reject({ok: false, code: "invalid-input", detail: filterProblems});
            return;
        }
        const handler = this.#facade(found, toConsumer(frame.$nbConsumer))?.events?.[frame.event];
        if (handler === undefined || signal.aborted || found.stopSignal.aborted) {
            channel.reject({ok: false, code: "unavailable", detail: "提供方没有实现这个事件或正在停止"});
            return;
        }
        const ended = anySignal([signal, found.stopSignal]);
        channel.accept();
        found.stopSignal.addEventListener("abort", () => channel.end("provider-stopped"), {once: true});
        const sink = {
            next: (payload: unknown): void => {
                if (ended.aborted) {
                    return;
                }
                const problems = validationProblems(event.payload, payload);
                if (problems !== null) {
                    this.#record("payload-invalid", contract.id, problems);
                    return;
                }
                channel.event(payload);
            },
        };
        try {
            await handler.subscribe(frame.filter, sink, {signal: ended});
        } catch (error) {
            this.#record("provider-threw", contract.id, error instanceof Error ? error.message : String(error));
            channel.end("provider-error");
        }
    }

    /** 调用方入口的这一代结束：释放本实例为它生成的全部门面。 */
    handleRelease(frame: ReleaseFrame): void {
        const key = consumerKey(frame.$nbConsumer);
        for (const group of this.#groups.values()) {
            const entry = group.facades.get(key);
            if (entry !== undefined) {
                group.facades.delete(key);
                void this.#releaseFacade(group, entry.implementation, entry.consumer);
            }
        }
    }

    async #lookup(contractId: string, chain: ReadonlyArray<ChainLink>, signal: AbortSignal): Promise<ProviderLookup> {
        if (this.#source === null) {
            return {status: "unavailable", reason: "本实例没有插件宿主"};
        }
        try {
            return await this.#source.lookup(contractId, chain, signal);
        } catch (error) {
            this.#record("lookup-threw", contractId, error instanceof Error ? error.message : String(error));
            return {status: "unavailable", reason: "查找提供入口失败"};
        }
    }

    #facade(found: Extract<ProviderLookup, {status: "found"}>, consumer: ConsumerIdentity): RemoteImplementation<RemoteContract> | null {
        const groupKey = `${found.provision.contract.id}#${found.entry.plugin}/${found.entry.entry}#${String(found.entry.generation)}`;
        let group = this.#groups.get(groupKey);
        if (group === undefined) {
            const created: FacadeGroup = {provision: found.provision, facades: new Map()};
            group = created;
            this.#groups.set(groupKey, created);
            found.stopSignal.addEventListener(
                "abort",
                () => {
                    this.#groups.delete(groupKey);
                    for (const entry of created.facades.values()) {
                        void this.#releaseFacade(created, entry.implementation, entry.consumer);
                    }
                    created.facades.clear();
                },
                {once: true},
            );
        }
        const key = consumerKey(consumer);
        const existing = group.facades.get(key);
        if (existing !== undefined) {
            return existing.implementation;
        }
        let implementation: RemoteImplementation<RemoteContract>;
        try {
            implementation = group.provision.provision.facade(consumer);
        } catch (error) {
            this.#record("facade-failed", found.provision.contract.id, error instanceof Error ? error.message : String(error));
            return null;
        }
        // 实现工厂必须同步返回对象，规则同 runtime.services 的按调用方门面；async 工厂产出的是 Promise。
        if (typeof implementation !== "object" || implementation === null || ("then" in implementation && typeof implementation.then === "function")) {
            this.#record("facade-invalid", found.provision.contract.id, "实现工厂必须同步返回对象");
            return null;
        }
        group.facades.set(key, {implementation, consumer});
        return implementation;
    }

    async #releaseFacade(group: FacadeGroup, implementation: RemoteImplementation<RemoteContract>, consumer: ConsumerIdentity): Promise<void> {
        try {
            await group.provision.provision.release?.(implementation, consumer);
        } catch (error) {
            this.#record("facade-release-failed", group.provision.contract.id, error instanceof Error ? error.message : String(error));
        }
    }

    async #startSubscription(subscription: ActiveSubscription): Promise<Outcome> {
        const handlers: SubscribeHandlers = {
            onEvent: (payload) => {
                if (subscription.ended) {
                    return;
                }
                const problems = validationProblems(subscription.payloadSchema, payload);
                if (problems !== null) {
                    this.#record("payload-invalid", subscription.frame.contract, problems);
                    return;
                }
                subscription.listener(payload);
            },
            onEnd: (reason) => {
                // 链路断开时等待重连重建（同一项目代次），其它原因直接结束。
                if (reason === "disconnected" && !this.#isLocal(subscription.frame.target)) {
                    return;
                }
                this.#subscriptions.delete(subscription);
                if (!subscription.ended) {
                    subscription.ended = true;
                    subscription.options.onEnd?.(reason);
                }
            },
        };
        if (this.#isLocal(subscription.frame.target)) {
            return this.#localSubscribe(subscription, handlers);
        }
        if (this.#upstream === null) {
            return this.#offline();
        }
        const started = this.#upstream.subscribe(subscription.frame, handlers);
        subscription.cancel = started.cancel;
        return started.outcome;
    }

    #localSubscribe(subscription: ActiveSubscription, handlers: SubscribeHandlers): Promise<Outcome> {
        const controller = new AbortController();
        const {promise, resolve} = Promise.withResolvers<Outcome>();
        let state: "pending" | "accepted" | "ended" = "pending";
        subscription.cancel = () => controller.abort();
        const channel: SubscriptionChannel = {
            accept: () => {
                if (state === "pending") {
                    state = "accepted";
                    resolve({ok: true, value: null});
                }
            },
            reject: (outcome) => {
                if (state === "pending") {
                    state = "ended";
                    resolve(outcome);
                }
            },
            event: (payload) => {
                if (state === "accepted" && !controller.signal.aborted) {
                    handlers.onEvent(this.#validateLocal ? structuredClone(payload) : payload);
                }
            },
            end: (reason) => {
                if (state === "accepted") {
                    state = "ended";
                    handlers.onEnd(reason);
                }
            },
        };
        void this.handleSubscribe({type: "subscribe", id: "local", ...subscription.frame}, channel, controller.signal);
        return promise;
    }

    #endLocalSubscription(subscription: ActiveSubscription): void {
        if (subscription.ended) {
            return;
        }
        subscription.ended = true;
        this.#subscriptions.delete(subscription);
        subscription.cancel();
    }

    /** 重连后：仍有效的订阅重新建立并调用 onResync；建立失败的结束并报原因。 */
    #resubscribeAll(): void {
        for (const subscription of [...this.#subscriptions]) {
            if (subscription.ended || this.#isLocal(subscription.frame.target)) {
                continue;
            }
            void this.#startSubscription(subscription).then((outcome) => {
                if (outcome.ok) {
                    subscription.options.onResync?.();
                    return;
                }
                this.#subscriptions.delete(subscription);
                if (!subscription.ended) {
                    subscription.ended = true;
                    subscription.options.onEnd?.(outcome.code);
                }
            });
        }
    }

    async #instances(caller: RemoteCallerContext): Promise<RemoteResult<ReadonlyArray<InstanceDescriptor>>> {
        if (this.#upstream === null) {
            return this.#offline();
        }
        const outcome = await this.#upstream.request(
            {target: "server", contract: INSTANCES_CONTRACT, version: 1, method: "list", effect: "read", input: {}, $nbConsumer: toCallerFrame(caller.consumer), $nbChain: []},
            {signal: caller.signal},
        );
        return outcome as RemoteResult<ReadonlyArray<InstanceDescriptor>>;
    }

    #record(reason: string, contract: string | null, detail: string | null): void {
        this.#sequence += 1;
        const diagnostic: RemoteDiagnostic = {sequence: this.#sequence, instanceId: this.instance.id, reason, contract, detail};
        this.#diagnostics.push(diagnostic);
        try {
            this.#observer?.diagnosticRecorded?.(diagnostic);
        } catch {
            // 观察者是诊断通道，它的异常不得改变节点状态。
        }
    }
}

const SERVER_RESTARTED: Extract<RemoteConnectResult, {ok: false}> = Object.freeze({ok: false, reason: "server-restarted", message: "服务端已换进程，本实例需要重新启动"});
const PROJECT_GONE: Extract<RemoteConnectResult, {ok: false}> = Object.freeze({ok: false, reason: "project-gone", message: "绑定的项目代次已结束，本实例需要重新启动"});

/** 内核自带的实例查询，由服务端路由直接回答。 */
export const INSTANCES_CONTRACT = "runtime/instances";

export function createRemoteNode(options: RemoteNodeOptions): RemoteNode {
    return new RemoteNodeImpl(options);
}

