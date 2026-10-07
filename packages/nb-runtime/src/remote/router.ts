/**
 * 服务端实例上的路由：客户端与项目实例都只连到这里。路由登记每条链路的实例描述，按目标把请求、
 * 订阅与释放转给对应实例（或本进程的服务端节点），并把 ACK、结果与事件原路送回。
 *
 * 路由只核对实例级身份：帧上调用方的实例 id 必须是这条链路握手时登记的实例，同一实例内的插件与
 * 入口身份由该实例的内核填写（第一版完全信任，见 ADR 0022）。
 */

import {Peer} from "./peer";
import type {Reply, SubscriptionChannel} from "./peer";
import {checkHello, failureFor} from "./protocol";
import type {InstanceDescriptor, Outcome, ReleaseFrame, RemoteTarget, RequestFrame, SubscribeFrame} from "./protocol";
import {INSTANCES_CONTRACT, RemoteNodeImpl} from "./node";
import type {RemoteNode, Upstream} from "./node";
import type {RemoteLink} from "./transport";

export interface RemoteRouter {
    /** 接受一条新链路；对端须先发 hello，wire 版本不兼容或实例 id 重复时拒绝并关闭。 */
    accept(link: RemoteLink): void;
    /** 当前在线的实例（含服务端自己）。 */
    instances(): ReadonlyArray<InstanceDescriptor>;
}

interface Member {
    readonly descriptor: InstanceDescriptor;
    readonly peer: Peer;
}

type Destination = {readonly kind: "hub"} | {readonly kind: "member"; readonly member: Member} | {readonly kind: "gone"; readonly detail: string};

class RemoteRouterImpl implements RemoteRouter {
    readonly #hub: RemoteNodeImpl;
    readonly #members = new Map<string, Member>();

    constructor(hub: RemoteNodeImpl) {
        if (hub.instance.role !== "hub") {
            throw new TypeError(`路由只能挂在 role 为 hub 的节点上，收到 ${hub.instance.role}`);
        }
        this.#hub = hub;
        const upstream: Upstream = {
            request: (frame, options) => {
                const destination = this.#resolve(hub.instance, frame.target);
                if (destination.kind !== "member") {
                    return Promise.resolve(this.#gone(frame.effect, destination));
                }
                return destination.member.peer.request(frame, options);
            },
            subscribe: (frame, handlers) => {
                const destination = this.#resolve(hub.instance, frame.target);
                if (destination.kind !== "member") {
                    return {outcome: Promise.resolve(this.#gone("read", destination)), cancel: () => undefined};
                }
                const started = destination.member.peer.subscribe(frame, handlers);
                return {outcome: started.outcome, cancel: () => destination.member.peer.unsubscribe(started.id)};
            },
            release: (frame) => {
                const destination = this.#resolve(hub.instance, frame.target);
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
        const peer: Peer = new Peer(
            link,
            {
                onHello: (frame) => {
                    if (member !== null) {
                        return;
                    }
                    const checked = checkHello(frame);
                    if (!checked.ok) {
                        peer.send({type: "reject", reason: checked.reason, message: checked.message});
                        peer.close();
                        return;
                    }
                    if (frame.instance.id === this.#hub.instance.id || this.#members.has(frame.instance.id)) {
                        peer.send({type: "reject", reason: "duplicate-instance", message: `实例 ${frame.instance.id} 已在线`});
                        peer.close();
                        return;
                    }
                    if (frame.instance.role === "hub") {
                        peer.send({type: "reject", reason: "role", message: "只有一个服务端实例运行路由"});
                        peer.close();
                        return;
                    }
                    member = {descriptor: frame.instance, peer};
                    this.#members.set(frame.instance.id, member);
                    peer.send({type: "welcome", wire: frame.wire});
                },
                onRequest: (frame, reply, signal) => {
                    if (member === null) {
                        reply.result({ok: false, code: "denied", detail: "握手完成前不接受请求"});
                        return;
                    }
                    this.#routeRequest(member, frame, reply, signal);
                },
                onSubscribe: (frame, channel, signal) => {
                    if (member === null) {
                        channel.reject({ok: false, code: "denied", detail: "握手完成前不接受订阅"});
                        return;
                    }
                    this.#routeSubscribe(member, frame, channel, signal);
                },
                onRelease: (frame) => {
                    if (member !== null && frame.$nbConsumer.instanceId === member.descriptor.id) {
                        this.#routeRelease(member.descriptor, frame);
                    }
                },
                onClose: () => {
                    if (member !== null && this.#members.get(member.descriptor.id) === member) {
                        this.#members.delete(member.descriptor.id);
                    }
                },
            },
            this.#hub.clock,
        );
    }

    /** 目标解析：`project` 按调用方握手时绑定的项目代次；代次不符视为目标已不在。 */
    #resolve(from: InstanceDescriptor, target: RemoteTarget): Destination {
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
            const project = [...this.#members.values()].find((member) => member.descriptor.role === "project" && member.descriptor.project?.id === target.project);
            return project === undefined ? {kind: "gone", detail: `项目 ${target.project} 没在运行`} : {kind: "member", member: project};
        }
        if (target.client === this.#hub.instance.id) {
            return {kind: "hub"};
        }
        const client = this.#members.get(target.client);
        return client === undefined ? {kind: "gone", detail: `实例 ${target.client} 不在线`} : {kind: "member", member: client};
    }

    #gone(effect: "read" | "write", destination: Destination): Outcome {
        return {...failureFor("undispatched", effect, "target-gone"), detail: destination.kind === "gone" ? destination.detail : undefined};
    }

    #routeRequest(from: Member, frame: RequestFrame, reply: Reply, signal: AbortSignal): void {
        if (frame.$nbConsumer.instanceId !== from.descriptor.id) {
            reply.result({ok: false, code: "denied", detail: "调用方实例与链路登记的实例不符"});
            return;
        }
        const destination = this.#resolve(from.descriptor, frame.target);
        if (destination.kind === "gone") {
            reply.result(this.#gone(frame.effect, destination));
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
        const destination = this.#resolve(from.descriptor, frame.target);
        if (destination.kind === "gone") {
            channel.reject({ok: false, code: "target-gone", detail: destination.kind === "gone" ? destination.detail : undefined});
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
        const destination = this.#resolve(from, frame.target);
        if (destination.kind === "hub") {
            this.#hub.handleRelease(frame);
        } else if (destination.kind === "member") {
            destination.member.peer.send(frame);
        }
    }
}

/** 在服务端节点上建立路由；服务端节点此后经它到达其它实例。 */
export function createRemoteRouter(hub: RemoteNode): RemoteRouter {
    if (!(hub instanceof RemoteNodeImpl)) {
        throw new TypeError("路由需要 createRemoteNode 创建的节点");
    }
    return new RemoteRouterImpl(hub);
}
