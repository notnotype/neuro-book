/**
 * 服务端实例上的路由：客户端与项目实例都只连到这里。路由登记每条链路的实例描述，按目标把请求、
 * 订阅与释放转给对应实例（或本进程的服务端节点），并把 ACK、结果与事件原路送回。
 *
 * 路由只核对实例级身份：帧上调用方的实例 id 必须是这条链路握手时登记的实例，同一实例内的插件与
 * 入口身份由该实例的内核填写（第一版完全信任，见 ADR 0022）。项目由宿主管理：客户端的绑定经
 * `bindProject` 取得，`{project}` 目标能否到达经 `projectAccess` 询问，路由自己不持有租约。
 *
 * 握手规则（wire 版本先于一切、同一实例重连接管旧链路、绑定、协议违规关闭链路）见
 * docs/specs/runtime/plugin-channel.md 的“WebSocket 传输与握手”。
 */

import {Peer} from "./peer";
import type {Reply, SubscriptionChannel} from "./peer";
import {failureFor} from "./protocol";
import type {BindRequest, CallerFrame, HelloFrame, InstanceDescriptor, Outcome, ProjectBinding, ReleaseFrame, RemoteTarget, RequestFrame, SubscribeFrame} from "./protocol";
import {INSTANCES_CONTRACT, RemoteNodeImpl} from "./node";
import type {RemoteNode, Upstream} from "./node";
import type {RemoteLink} from "./transport";

export interface RemoteAcceptOptions {
    /**
     * 这条链路上的实例应有的描述（宿主自己起的项目子进程）；hello 的描述与它不完全一致时以 `role` 拒绝。
     * 带 `expect` 的链路由宿主创建，不受停止接纳影响：正在创建的项目子实例也要能完成握手再收口。
     */
    readonly expect?: InstanceDescriptor;
}

export interface RemoteRouter {
    /** 接受一条新链路；对端须先发 hello，被拒或违反协议时关闭链路。路由已关闭时立即关闭它。 */
    accept(link: RemoteLink, options?: RemoteAcceptOptions): void;
    /** 当前在线的实例（含服务端自己）。 */
    instances(): ReadonlyArray<InstanceDescriptor>;
    /**
     * 停止接纳：之后的 hello 以 `stopping` 拒绝（带 `expect` 的链路除外），客户端成员的新请求与新订阅为
     * `unavailable`。项目成员照常：项目子实例停止时还要经远程服务收口。幂等，不可撤销。
     */
    stopAdmission(): void;
    /** 等路由已接纳的在途请求（发给服务端插件的、转发给其它实例的）全部结算；`signal` 先触发则返回 `deadline`。 */
    drain(signal: AbortSignal): Promise<"drained" | "deadline">;
    /** 关闭全部成员链路，其上的请求与订阅按断开结算；同时停止接纳。幂等。 */
    close(): void;
}

/** 宿主为一个客户端取得项目绑定的结果。 */
export type ProjectBindResult =
    | {
        readonly ok: true;
        readonly binding: ProjectBinding;
        /** 这一代结束（租约失效）时触发：路由随即关闭绑定它的客户端链路。 */
        readonly revoked: AbortSignal;
        /** 客户端链路关闭时调用一次，释放为它取得的租约。 */
        release(): void;
    }
    | {readonly ok: false; readonly reason: "project-unavailable" | "project-gone"; readonly message: string};

export interface RemoteRouterOptions {
    /**
     * 客户端的绑定：首次按引用打开项目并取得租约，重连只取原代次。不提供时带 `bind` 的 hello 一律
     * `project-unavailable`。
     */
    readonly bindProject?: (request: Exclude<BindRequest, null>, client: InstanceDescriptor) => Promise<ProjectBindResult>;
    /**
     * `{project}` 目标能否到达这个项目的这一代：由宿主的项目管理按调用方身份决定（租约或无租约访问规则，
     * 见 runtime/projects.md）。不提供时一律 `denied`。
     */
    readonly projectAccess?: (caller: CallerFrame, project: string, generation: number) => "allowed" | "denied";
    /** 服务端这一次进程的标识，随 welcome 发给客户端；缺省随机生成。同一进程里的路由只建一个。 */
    readonly boot?: string;
}

interface Member {
    /** 客户端的描述带上绑定的项目代次，`project` 目标与 `{project}` 访问都按它解析。 */
    readonly descriptor: InstanceDescriptor;
    readonly peer: Peer;
    /** 绑定的项目：链路关闭时释放它的租约。 */
    readonly binding: Extract<ProjectBindResult, {ok: true}> | null;
}

type Destination =
    | {readonly kind: "hub"}
    | {readonly kind: "member"; readonly member: Member}
    | {readonly kind: "gone"; readonly detail: string}
    | {readonly kind: "denied"; readonly detail: string};

/**
 * 重连时判断是不是同一个实例，只是换了一条链路：种类、角色、客户端身份相同，且绑定一致。客户端的绑定由
 * 服务端决定，hello 的 `instance.project` 恒为 null，所以比的是 `bind`：已登记的成员没有绑定时 `bind` 为
 * null，有绑定时 `bind` 必须带同一个 id 与代次。项目实例的描述自带项目代次，照原样比较。
 */
function sameInstance(existing: InstanceDescriptor, hello: HelloFrame): boolean {
    const {instance, bind} = hello;
    if (existing.kind !== instance.kind || existing.role !== instance.role || existing.client !== instance.client) {
        return false;
    }
    if (existing.role !== "client") {
        return existing.project?.id === instance.project?.id && existing.project?.generation === instance.project?.generation;
    }
    if (existing.project === null) {
        return bind === null;
    }
    return bind !== null && "generation" in bind && bind.project === existing.project.id && bind.generation === existing.project.generation;
}

function sameDescriptor(left: InstanceDescriptor, right: InstanceDescriptor): boolean {
    return (
        left.id === right.id &&
        left.kind === right.kind &&
        left.role === right.role &&
        left.client === right.client &&
        left.project?.id === right.project?.id &&
        left.project?.generation === right.project?.generation
    );
}

class RemoteRouterImpl implements RemoteRouter {
    readonly #hub: RemoteNodeImpl;
    readonly #members = new Map<string, Member>();
    readonly #options: RemoteRouterOptions;
    readonly #boot: string;
    #admitting = true;
    #closed = false;
    /** 握手中（等宿主的绑定结果）还没登记成成员的链路；路由关闭时一并关闭。 */
    readonly #handshaking = new Set<Peer>();
    /** 已接纳、尚未结算的请求数；排空等它归零。订阅是长期的，不计入。 */
    #inFlight = 0;
    readonly #idle = new Set<() => void>();

    constructor(hub: RemoteNodeImpl, options: RemoteRouterOptions) {
        if (hub.instance.role !== "hub") {
            throw new TypeError(`路由只能挂在 role 为 hub 的节点上，收到 ${hub.instance.role}`);
        }
        this.#hub = hub;
        this.#options = options;
        this.#boot = options.boot ?? crypto.randomUUID();
        const upstream: Upstream = {
            request: (frame, options) => {
                const destination = this.#resolve(hub.instance, frame.target, frame.$nbConsumer);
                if (destination.kind !== "member") {
                    return Promise.resolve(this.#refusal(frame.effect, destination));
                }
                return this.#track(destination.member.peer.request(frame, options));
            },
            subscribe: (frame, handlers) => {
                const destination = this.#resolve(hub.instance, frame.target, frame.$nbConsumer);
                if (destination.kind !== "member") {
                    return {outcome: Promise.resolve(this.#refusal("read", destination)), cancel: () => undefined};
                }
                const started = destination.member.peer.subscribe(frame, handlers);
                return {outcome: started.outcome, cancel: () => destination.member.peer.unsubscribe(started.id)};
            },
            release: (frame) => {
                const destination = this.#resolve(hub.instance, frame.target, null);
                if (destination.kind === "member") {
                    destination.member.peer.send({type: "release", ...frame});
                }
            },
        };
        hub.useUpstream(upstream);
    }

    /** hello 的同步判定：服务端已换进程、停止中、角色、`expect` 与重名。通过返回 null。 */
    #screen(frame: HelloFrame, expect: InstanceDescriptor | undefined): {readonly reason: string; readonly message: string} | null {
        const {instance, bind} = frame;
        if (frame.boot !== null && frame.boot !== this.#boot) {
            return {reason: "server-restarted", message: "服务端已换进程"};
        }
        if (!this.#admitting && expect === undefined) {
            return {reason: "stopping", message: "服务端正在停止"};
        }
        if (instance.role === "hub" || instance.id === this.#hub.instance.id) {
            return {reason: "role", message: "只有一个服务端实例运行路由"};
        }
        if (expect !== undefined && (!sameDescriptor(expect, instance) || bind !== null)) {
            return {reason: "role", message: `这条链路只接受实例 ${expect.id}`};
        }
        if (instance.role === "client" ? instance.project !== null : bind !== null) {
            return {reason: "role", message: "项目绑定由服务端决定：客户端的 instance.project 必须为 null，只有客户端可以带 bind"};
        }
        const existing = this.#members.get(instance.id);
        if (existing !== undefined && !sameInstance(existing.descriptor, frame)) {
            return {reason: "duplicate-instance", message: `实例 ${instance.id} 已在线`};
        }
        return null;
    }

    async #bind(frame: HelloFrame, request: Exclude<BindRequest, null>): Promise<ProjectBindResult> {
        if (this.#options.bindProject === undefined) {
            return {ok: false, reason: "project-unavailable", message: "服务端不管理项目"};
        }
        try {
            return await this.#options.bindProject(request, frame.instance);
        } catch (error) {
            this.#hub.recordDiagnostic("bind-threw", null, error instanceof Error ? error.message : String(error));
            return {ok: false, reason: "project-unavailable", message: "服务端打开项目时出错"};
        }
    }

    /**
     * 登记成员。同一实例重连：服务端可能还没察觉旧连接断开（半开连接）。先登记新链路、再关闭旧链路，
     * 旧链路上的请求与订阅按断开结算、旧租约随之释放；新租约已经取得，使用者计数不会中途落到 0。
     */
    #register(descriptor: InstanceDescriptor, peer: Peer, binding: Member["binding"]): Member {
        const existing = this.#members.get(descriptor.id);
        const member: Member = {descriptor, peer, binding};
        this.#members.set(descriptor.id, member);
        existing?.peer.close();
        return member;
    }

    instances(): ReadonlyArray<InstanceDescriptor> {
        return [this.#hub.instance, ...[...this.#members.values()].map((member) => member.descriptor)];
    }

    stopAdmission(): void {
        this.#admitting = false;
    }

    async drain(signal: AbortSignal): Promise<"drained" | "deadline"> {
        if (this.#inFlight === 0) {
            return "drained";
        }
        if (signal.aborted) {
            return "deadline";
        }
        const {promise, resolve} = Promise.withResolvers<"drained" | "deadline">();
        const onIdle = (): void => resolve("drained");
        const onDeadline = (): void => resolve("deadline");
        this.#idle.add(onIdle);
        signal.addEventListener("abort", onDeadline, {once: true});
        try {
            return await promise;
        } finally {
            this.#idle.delete(onIdle);
            signal.removeEventListener("abort", onDeadline);
        }
    }

    close(): void {
        this.#admitting = false;
        this.#closed = true;
        for (const peer of [...this.#handshaking]) {
            peer.close();
        }
        for (const member of [...this.#members.values()]) {
            member.peer.close();
        }
    }

    /** 计入在途直到 `settled` 结算；请求的两条路（成员发来的、服务端插件发往成员的）都经这里。 */
    #track<T>(settled: Promise<T>): Promise<T> {
        this.#inFlight += 1;
        const done = (): void => {
            this.#inFlight -= 1;
            if (this.#inFlight === 0) {
                for (const resolve of [...this.#idle]) {
                    resolve();
                }
            }
        };
        void settled.then(done, done);
        return settled;
    }

    accept(link: RemoteLink, options: RemoteAcceptOptions = {}): void {
        if (this.#closed) {
            link.close();
            return;
        }
        let member: Member | null = null;
        let greeted = false;
        const violation = (detail: string): void => {
            this.#hub.recordDiagnostic("protocol-violation", null, `${member?.descriptor.id ?? "未握手的链路"}：${detail}`);
            peer.close();
        };
        const refuse = (reason: string, message: string): void => {
            peer.send({type: "reject", reason, message});
            peer.close();
        };
        const peer: Peer = new Peer(
            link,
            {
                onWireMismatch: (reject) => {
                    peer.send(reject);
                    peer.close();
                },
                onHello: (frame) => {
                    if (greeted) {
                        violation("握手完成后再次发送 hello");
                        return;
                    }
                    greeted = true;
                    const refusal = this.#screen(frame, options.expect);
                    if (refusal !== null) {
                        refuse(refusal.reason, refusal.message);
                        return;
                    }
                    if (frame.bind === null) {
                        member = this.#register(frame.instance, peer, null);
                        peer.send({type: "welcome", wire: frame.wire, boot: this.#boot, binding: null});
                        return;
                    }
                    this.#handshaking.add(peer);
                    void this.#bind(frame, frame.bind).then((outcome) => {
                        this.#handshaking.delete(peer);
                        if (outcome.ok && peer.closed) {
                            // 等绑定期间链路已关闭：一拿到租约就释放。
                            outcome.release();
                            return;
                        }
                        if (!outcome.ok) {
                            refuse(outcome.reason, outcome.message);
                            return;
                        }
                        // 等待期间同一 id 的另一条链路可能已登记，按登记后的状态再判一次。
                        const existing = this.#members.get(frame.instance.id);
                        if (existing !== undefined && !sameInstance(existing.descriptor, frame)) {
                            outcome.release();
                            refuse("duplicate-instance", `实例 ${frame.instance.id} 已在线`);
                            return;
                        }
                        const descriptor = {...frame.instance, project: {id: outcome.binding.id, generation: outcome.binding.generation}};
                        member = this.#register(descriptor, peer, outcome);
                        outcome.revoked.addEventListener("abort", () => peer.close(), {once: true});
                        if (outcome.revoked.aborted) {
                            peer.close();
                            return;
                        }
                        peer.send({type: "welcome", wire: frame.wire, boot: this.#boot, binding: outcome.binding});
                    });
                },
                onRequest: (frame, reply, signal) => {
                    if (member === null) {
                        violation("握手完成前发送请求");
                        return;
                    }
                    this.#routeRequest(member, frame, reply, signal);
                },
                onSubscribe: (frame, channel, signal) => {
                    if (member === null) {
                        violation("握手完成前发送订阅");
                        return;
                    }
                    this.#routeSubscribe(member, frame, channel, signal);
                },
                onRelease: (frame) => {
                    if (member === null) {
                        violation("握手完成前发送释放");
                        return;
                    }
                    if (frame.$nbConsumer.instanceId === member.descriptor.id) {
                        this.#routeRelease(member.descriptor, frame);
                    }
                },
                onInvalidFrame: () => violation("收到无法解析的帧"),
                onClose: () => {
                    this.#handshaking.delete(peer);
                    if (member === null) {
                        return;
                    }
                    if (this.#members.get(member.descriptor.id) === member) {
                        this.#members.delete(member.descriptor.id);
                    }
                    member.binding?.release();
                },
            },
            this.#hub.clock,
        );
    }

    /**
     * 目标解析：`project` 按调用方握手时绑定的项目代次，代次不符视为目标已不在；`{project}` 到达正在运行
     * 的那一代，能否访问问宿主。释放帧不带调用方（`caller` 为 null）：撤回使用关系总是放行。
     */
    #resolve(from: InstanceDescriptor, target: RemoteTarget, caller: CallerFrame | null): Destination {
        if (target === "server") {
            return {kind: "hub"};
        }
        if (target === "project") {
            const binding = from.project;
            if (binding === null) {
                return {kind: "gone", detail: "调用方没有绑定项目"};
            }
            const project = [...this.#members.values()].find((member) => member.descriptor.role === "project" && member.descriptor.project?.id === binding.id);
            if (project === undefined || project.descriptor.project?.generation !== binding.generation) {
                return {kind: "gone", detail: `项目 ${binding.id} 的代次 ${String(binding.generation)} 已不在`};
            }
            return {kind: "member", member: project};
        }
        if ("project" in target) {
            for (const member of this.#members.values()) {
                const binding = member.descriptor.project;
                if (member.descriptor.role !== "project" || binding === null || binding.id !== target.project) {
                    continue;
                }
                if (caller !== null && (this.#options.projectAccess?.(caller, binding.id, binding.generation) ?? "denied") !== "allowed") {
                    return {kind: "denied", detail: `调用方不能访问项目 ${binding.id} 的代次 ${String(binding.generation)}`};
                }
                return {kind: "member", member};
            }
            return {kind: "gone", detail: `项目 ${target.project} 没在运行`};
        }
        if (target.client === this.#hub.instance.id) {
            return {kind: "hub"};
        }
        const client = this.#members.get(target.client);
        return client === undefined ? {kind: "gone", detail: `实例 ${target.client} 不在线`} : {kind: "member", member: client};
    }

    #refusal(effect: "read" | "write", destination: Extract<Destination, {kind: "gone" | "denied"}> | {readonly kind: "hub"}): Extract<Outcome, {ok: false}> {
        switch (destination.kind) {
            case "denied":
                return {ok: false, code: "denied", detail: destination.detail};
            case "gone":
                return {...failureFor("undispatched", effect, "target-gone"), detail: destination.detail};
            case "hub":
                return {...failureFor("undispatched", effect, "target-gone"), detail: "服务端自己的目标不经路由转发"};
        }
    }

    /** 停止接纳后客户端的新请求与新订阅得到的结果；项目成员不受影响。 */
    #stopping(from: Member): Extract<Outcome, {ok: false}> | null {
        return !this.#admitting && from.descriptor.role === "client" ? {ok: false, code: "unavailable", detail: "服务端正在停止"} : null;
    }

    #routeRequest(from: Member, frame: RequestFrame, reply: Reply, signal: AbortSignal): void {
        if (frame.$nbConsumer.instanceId !== from.descriptor.id) {
            reply.result({ok: false, code: "denied", detail: "调用方实例与链路登记的实例不符"});
            return;
        }
        const stopping = this.#stopping(from);
        if (stopping !== null) {
            reply.result(stopping);
            return;
        }
        const destination = this.#resolve(from.descriptor, frame.target, frame.$nbConsumer);
        if (destination.kind === "gone" || destination.kind === "denied") {
            reply.result(this.#refusal(frame.effect, destination));
            return;
        }
        if (destination.kind === "hub") {
            if (frame.contract === INSTANCES_CONTRACT) {
                reply.ack();
                reply.result({ok: true, value: this.instances()});
                return;
            }
            void this.#track(this.#hub.handleRequest(frame, reply, signal));
            return;
        }
        const {type: _type, id: _id, ...forwarded} = frame;
        void this.#track(destination.member.peer.request(forwarded, {signal, onAck: () => reply.ack()})).then((outcome) => reply.result(outcome));
    }

    #routeSubscribe(from: Member, frame: SubscribeFrame, channel: SubscriptionChannel, signal: AbortSignal): void {
        if (frame.$nbConsumer.instanceId !== from.descriptor.id) {
            channel.reject({ok: false, code: "denied", detail: "订阅方实例与链路登记的实例不符"});
            return;
        }
        const stopping = this.#stopping(from);
        if (stopping !== null) {
            channel.reject(stopping);
            return;
        }
        const destination = this.#resolve(from.descriptor, frame.target, frame.$nbConsumer);
        if (destination.kind === "gone" || destination.kind === "denied") {
            channel.reject(this.#refusal("read", destination));
            return;
        }
        if (destination.kind === "hub") {
            void this.#hub.handleSubscribe(frame, channel, signal);
            return;
        }
        const {type: _type, id: _id, ...forwarded} = frame;
        const target = destination.member.peer;
        const started = target.subscribe(forwarded, {onEvent: (payload) => channel.event(payload), onEnd: (reason) => channel.end(reason === "disconnected" ? "target-gone" : reason)});
        signal.addEventListener("abort", () => target.unsubscribe(started.id), {once: true});
        void started.outcome.then((outcome) => {
            if (outcome.ok) {
                channel.accept();
            } else {
                channel.reject(outcome);
            }
        });
    }

    #routeRelease(from: InstanceDescriptor, frame: ReleaseFrame): void {
        const destination = this.#resolve(from, frame.target, null);
        if (destination.kind === "hub") {
            this.#hub.handleRelease(frame);
        } else if (destination.kind === "member") {
            destination.member.peer.send(frame);
        }
    }
}

/** 在服务端节点上建立路由；服务端节点此后经它到达其它实例。 */
export function createRemoteRouter(hub: RemoteNode, options: RemoteRouterOptions = {}): RemoteRouter {
    if (!(hub instanceof RemoteNodeImpl)) {
        throw new TypeError("路由需要 createRemoteNode 创建的节点");
    }
    return new RemoteRouterImpl(hub, options);
}
