/**
 * 服务端实例上的路由：客户端与项目实例都只连到这里。路由登记每条链路的实例描述，按目标把请求、
 * 订阅与释放转给对应实例（或本进程的服务端节点），并把 ACK、结果与事件原路送回。
 *
 * 路由只核对实例级身份：帧上调用方的实例 id 必须是这条链路握手时登记的实例，同一实例内的插件与
 * 入口身份由该实例的内核填写（第一版完全信任，见 ADR 0022）。`{project}` 目标另核对租约，租约由
 * 宿主的项目管理持有（`createChildInstances`），路由只经 `holdsProjectLease` 询问。
 *
 * 握手规则（wire 版本先于一切、同一实例重连接管旧链路、协议违规关闭链路）见
 * docs/specs/runtime/plugin-channel.md 的“WebSocket 传输与握手”。
 */

import {Peer} from "./peer";
import type {Reply, SubscriptionChannel} from "./peer";
import {failureFor} from "./protocol";
import type {CallerFrame, InstanceDescriptor, Outcome, ReleaseFrame, RemoteTarget, RequestFrame, SubscribeFrame} from "./protocol";
import {INSTANCES_CONTRACT, RemoteNodeImpl} from "./node";
import type {RemoteNode, Upstream} from "./node";
import type {RemoteLink} from "./transport";

export interface RemoteRouter {
    /** 接受一条新链路；对端须先发 hello，被拒或违反协议时关闭链路。 */
    accept(link: RemoteLink): void;
    /** 当前在线的实例（含服务端自己）。 */
    instances(): ReadonlyArray<InstanceDescriptor>;
}

export interface RemoteRouterOptions {
    /**
     * `{project}` 目标的租约核对：调用方是否持有该项目这一代次的租约。调用方与租约持有者怎样对应由宿主的
     * 项目管理决定；不提供时没有调用方持有租约，`{project}` 请求与订阅一律 `denied`。
     */
    readonly holdsProjectLease?: (caller: CallerFrame, project: string, generation: number) => boolean;
    /** 服务端这一次进程的标识，随 welcome 发给客户端；缺省随机生成。同一进程里的路由只建一个。 */
    readonly boot?: string;
}

interface Member {
    readonly descriptor: InstanceDescriptor;
    readonly peer: Peer;
}

type Destination =
    | {readonly kind: "hub"}
    | {readonly kind: "member"; readonly member: Member}
    | {readonly kind: "gone"; readonly detail: string}
    | {readonly kind: "denied"; readonly detail: string};

/** 重连时判断是不是同一个实例：描述的每一项都要一致，只是换了一条链路。 */
function sameInstance(left: InstanceDescriptor, right: InstanceDescriptor): boolean {
    return (
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
                return destination.member.peer.request(frame, options);
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

    instances(): ReadonlyArray<InstanceDescriptor> {
        return [this.#hub.instance, ...[...this.#members.values()].map((member) => member.descriptor)];
    }

    accept(link: RemoteLink): void {
        let member: Member | null = null;
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
                    if (member !== null) {
                        violation("握手完成后再次发送 hello");
                        return;
                    }
                    const {instance} = frame;
                    if (instance.role === "hub" || instance.id === this.#hub.instance.id) {
                        refuse("role", "只有一个服务端实例运行路由");
                        return;
                    }
                    const existing = this.#members.get(instance.id);
                    if (existing !== undefined && !sameInstance(existing.descriptor, instance)) {
                        refuse("duplicate-instance", `实例 ${instance.id} 已在线`);
                        return;
                    }
                    // 同一实例重连：服务端可能还没察觉旧连接断开（半开连接）。关闭旧链路，其上的请求与订阅按断开结算。
                    existing?.peer.close();
                    member = {descriptor: instance, peer};
                    this.#members.set(instance.id, member);
                    peer.send({type: "welcome", wire: frame.wire, boot: this.#boot});
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
                    if (member !== null && this.#members.get(member.descriptor.id) === member) {
                        this.#members.delete(member.descriptor.id);
                    }
                },
            },
            this.#hub.clock,
        );
    }

    /**
     * 目标解析：`project` 按调用方握手时绑定的项目代次，代次不符视为目标已不在；`{project}` 要求调用方
     * 持有正在运行的那一代的租约。释放帧不带调用方（`caller` 为 null）：撤回使用关系总是放行。
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
                if (caller !== null && !(this.#options.holdsProjectLease?.(caller, binding.id, binding.generation) ?? false)) {
                    return {kind: "denied", detail: `调用方没有持有项目 ${binding.id} 代次 ${String(binding.generation)} 的租约`};
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

    #routeRequest(from: Member, frame: RequestFrame, reply: Reply, signal: AbortSignal): void {
        if (frame.$nbConsumer.instanceId !== from.descriptor.id) {
            reply.result({ok: false, code: "denied", detail: "调用方实例与链路登记的实例不符"});
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
            void this.#hub.handleRequest(frame, reply, signal);
            return;
        }
        const {type: _type, id: _id, ...forwarded} = frame;
        void destination.member.peer.request(forwarded, {signal, onAck: () => reply.ack()}).then((outcome) => reply.result(outcome));
    }

    #routeSubscribe(from: Member, frame: SubscribeFrame, channel: SubscriptionChannel, signal: AbortSignal): void {
        if (frame.$nbConsumer.instanceId !== from.descriptor.id) {
            channel.reject({ok: false, code: "denied", detail: "订阅方实例与链路登记的实例不符"});
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
