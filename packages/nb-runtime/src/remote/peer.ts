/**
 * 一条链路上的帧会话：两个方向各自的请求 id 空间、ACK、结果、取消、订阅与链路关闭时的结算。
 * 节点与路由都用它，所以“请求在哪个阶段、断开时报什么”只在这里实现一次。
 */

import type {RuntimeClock} from "../lifecycle/lifecycle";

import {failureFor, parseFrame, wireMismatch} from "./protocol";
import type {Frame, Outcome, RejectFrame, ReleaseFrame, RequestFrame, SubscribeFrame} from "./protocol";
import type {RemoteLink} from "./transport";

/** 回复一个入站请求：先 `ack` 再执行，结果只回一次。 */
export interface Reply {
    ack(): void;
    result(outcome: Outcome): void;
}

/** 回复一个入站订阅：`accept` 或 `reject` 只调一次；接受后可多次 `event`，`end` 结束。 */
export interface SubscriptionChannel {
    accept(): void;
    reject(outcome: Extract<Outcome, {ok: false}>): void;
    event(payload: unknown): void;
    end(reason: string): void;
}

export interface PeerHandlers {
    onHello?(frame: Extract<Frame, {type: "hello"}>): void;
    /** 收到 wire 版本不同的 hello（不论其余字段的形状）；参数是应回给对端的拒绝帧。未提供时按无效帧处理。 */
    onWireMismatch?(reject: RejectFrame): void;
    onWelcome?(frame: Extract<Frame, {type: "welcome"}>): void;
    onReject?(frame: Extract<Frame, {type: "reject"}>): void;
    /** `signal` 在对端取消或链路关闭时触发。 */
    onRequest?(frame: RequestFrame, reply: Reply, signal: AbortSignal): void;
    /** `signal` 在对端退订或链路关闭时触发。 */
    onSubscribe?(frame: SubscribeFrame, channel: SubscriptionChannel, signal: AbortSignal): void;
    onRelease?(frame: ReleaseFrame): void;
    onInvalidFrame?(value: unknown): void;
    onClose?(): void;
}

export interface RequestOptions {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
    /** 对端 ACK 时调用；路由转发时用它把 ACK 传回调用方。 */
    readonly onAck?: () => void;
}

export interface SubscribeHandlers {
    readonly onEvent: (payload: unknown) => void;
    readonly onEnd: (reason: string) => void;
}

interface Pending {
    phase: "undispatched" | "dispatched";
    readonly effect: "read" | "write";
    readonly settle: (outcome: Outcome) => void;
    readonly onAck: (() => void) | undefined;
}

interface OutboundSubscription {
    accepted: boolean;
    readonly settle: (outcome: Outcome) => void;
    readonly handlers: SubscribeHandlers;
}

export class Peer {
    readonly #link: RemoteLink;
    readonly #handlers: PeerHandlers;
    readonly #clock: RuntimeClock;
    readonly #pending = new Map<string, Pending>();
    readonly #subscriptions = new Map<string, OutboundSubscription>();
    readonly #inbound = new Map<string, AbortController>();
    #ids = 0;
    #closed = false;

    constructor(link: RemoteLink, handlers: PeerHandlers, clock: RuntimeClock) {
        this.#link = link;
        this.#handlers = handlers;
        this.#clock = clock;
        link.onFrame((value) => this.#receive(value));
        link.onClose(() => this.#onClose());
    }

    get closed(): boolean {
        return this.#closed;
    }

    send(frame: Frame): void {
        if (!this.#closed) {
            this.#link.send(frame);
        }
    }

    /**
     * 发送带业务值（参数、结果、事件内容）的帧：无法编码时返回错误摘要而不抛出，由调用处按阶段结算，
     * 使插件传错值时得到结构化失败、等待表不留下永不结算的条目。
     */
    #sendValue(frame: Frame): string | null {
        try {
            this.send(frame);
            return null;
        } catch (error) {
            return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
    }

    close(): void {
        this.#link.close();
    }

    /** 发出请求并等待结果；超时、调用方取消与链路关闭都按请求阶段结算（protocol 的 failureFor）。 */
    request(frame: Omit<RequestFrame, "type" | "id">, options: RequestOptions = {}): Promise<Outcome> {
        if (this.#closed) {
            return Promise.resolve(failureFor("undispatched", frame.effect, "disconnected"));
        }
        if (options.signal?.aborted === true) {
            return Promise.resolve(failureFor("undispatched", frame.effect, "cancelled"));
        }
        const id = this.#nextId();
        const {promise, resolve} = Promise.withResolvers<Outcome>();
        let cancelTimer: () => void = () => undefined;
        const onAbort = (): void => this.#interrupt(id, "cancelled");
        const pending: Pending = {
            phase: "undispatched",
            effect: frame.effect,
            onAck: options.onAck,
            settle: (outcome) => {
                cancelTimer();
                options.signal?.removeEventListener("abort", onAbort);
                this.#pending.delete(id);
                resolve(outcome);
            },
        };
        this.#pending.set(id, pending);
        options.signal?.addEventListener("abort", onAbort, {once: true});
        if (options.timeoutMs !== undefined) {
            cancelTimer = this.#clock.schedule(() => this.#interrupt(id, "timeout"), options.timeoutMs);
        }
        const problem = this.#sendValue({type: "request", id, ...frame});
        if (problem !== null) {
            pending.settle({ok: false, code: "invalid-input", detail: `参数无法编码发送：${problem}`});
        }
        return promise;
    }

    /** 发出订阅；结果是建立与否。建立后事件经 `handlers.onEvent`，结束经 `handlers.onEnd`。 */
    subscribe(frame: Omit<SubscribeFrame, "type" | "id">, handlers: SubscribeHandlers): {readonly id: string; readonly outcome: Promise<Outcome>} {
        if (this.#closed) {
            return {id: "", outcome: Promise.resolve(failureFor("undispatched", "read", "disconnected"))};
        }
        const id = this.#nextId();
        const {promise, resolve} = Promise.withResolvers<Outcome>();
        this.#subscriptions.set(id, {accepted: false, settle: resolve, handlers});
        const problem = this.#sendValue({type: "subscribe", id, ...frame});
        if (problem !== null) {
            this.#subscriptions.delete(id);
            resolve({ok: false, code: "invalid-input", detail: `过滤参数无法编码发送：${problem}`});
        }
        return {id, outcome: promise};
    }

    /** 退订；对端会触发提供方的终止信号。之后到达的事件丢弃。 */
    unsubscribe(id: string): void {
        if (this.#subscriptions.delete(id)) {
            this.send({type: "unsubscribe", id});
        }
    }

    #nextId(): string {
        this.#ids += 1;
        return `r${String(this.#ids)}`;
    }

    #interrupt(id: string, cause: "cancelled" | "timeout"): void {
        const pending = this.#pending.get(id);
        if (pending === undefined) {
            return;
        }
        this.send({type: "cancel", id});
        pending.settle(failureFor(pending.phase, pending.effect, cause));
    }

    #receive(value: unknown): void {
        const mismatch = this.#handlers.onWireMismatch === undefined ? null : wireMismatch(value);
        if (mismatch !== null) {
            this.#handlers.onWireMismatch?.(mismatch);
            return;
        }
        const frame = parseFrame(value);
        if (frame === null) {
            this.#handlers.onInvalidFrame?.(value);
            return;
        }
        switch (frame.type) {
            case "hello":
                this.#handlers.onHello?.(frame);
                return;
            case "welcome":
                this.#handlers.onWelcome?.(frame);
                return;
            case "reject":
                this.#handlers.onReject?.(frame);
                return;
            case "ack": {
                const pending = this.#pending.get(frame.id);
                if (pending !== undefined && pending.phase === "undispatched") {
                    pending.phase = "dispatched";
                    pending.onAck?.();
                }
                return;
            }
            case "result": {
                this.#pending.get(frame.id)?.settle(frame.outcome);
                const subscription = this.#subscriptions.get(frame.id);
                if (subscription !== undefined && !subscription.accepted) {
                    if (frame.outcome.ok) {
                        subscription.accepted = true;
                    } else {
                        this.#subscriptions.delete(frame.id);
                    }
                    subscription.settle(frame.outcome);
                }
                return;
            }
            case "event": {
                const subscription = this.#subscriptions.get(frame.id);
                if (subscription?.accepted === true) {
                    subscription.handlers.onEvent(frame.payload);
                }
                return;
            }
            case "subscription-ended": {
                const subscription = this.#subscriptions.get(frame.id);
                if (subscription !== undefined) {
                    this.#subscriptions.delete(frame.id);
                    if (subscription.accepted) {
                        subscription.handlers.onEnd(frame.reason);
                    } else {
                        subscription.settle({ok: false, code: "unavailable", detail: frame.reason});
                    }
                }
                return;
            }
            case "request":
                this.#acceptRequest(frame);
                return;
            case "cancel":
            case "unsubscribe":
                this.#inbound.get(frame.id)?.abort();
                this.#inbound.delete(frame.id);
                return;
            case "subscribe":
                this.#acceptSubscription(frame);
                return;
            case "release":
                this.#handlers.onRelease?.(frame);
                return;
        }
    }

    #acceptRequest(frame: RequestFrame): void {
        const controller = new AbortController();
        this.#inbound.set(frame.id, controller);
        let settled = false;
        const reply: Reply = {
            ack: () => {
                if (!settled) {
                    this.send({type: "ack", id: frame.id});
                }
            },
            result: (outcome) => {
                if (settled) {
                    return;
                }
                settled = true;
                this.#inbound.delete(frame.id);
                const problem = this.#sendValue({type: "result", id: frame.id, outcome});
                if (problem !== null) {
                    this.send({type: "result", id: frame.id, outcome: {ok: false, code: "provider-error", detail: `结果无法编码发送：${problem}`}});
                }
            },
        };
        if (this.#handlers.onRequest === undefined) {
            reply.result({ok: false, code: "unavailable", detail: "本端不接受请求"});
            return;
        }
        this.#handlers.onRequest(frame, reply, controller.signal);
    }

    #acceptSubscription(frame: SubscribeFrame): void {
        const controller = new AbortController();
        this.#inbound.set(frame.id, controller);
        let state: "pending" | "accepted" | "ended" = "pending";
        const finish = (): void => {
            state = "ended";
            this.#inbound.delete(frame.id);
        };
        const channel: SubscriptionChannel = {
            accept: () => {
                if (state === "pending") {
                    state = "accepted";
                    this.send({type: "result", id: frame.id, outcome: {ok: true, value: null}});
                }
            },
            reject: (outcome) => {
                if (state === "pending") {
                    finish();
                    this.send({type: "result", id: frame.id, outcome});
                }
            },
            event: (payload) => {
                if (state === "accepted" && !controller.signal.aborted && this.#sendValue({type: "event", id: frame.id, payload}) !== null) {
                    // 事件内容无法编码：结束这条订阅，提供方经终止信号得知。
                    controller.abort();
                    this.send({type: "subscription-ended", id: frame.id, reason: "provider-error"});
                }
            },
            end: (reason) => {
                if (state !== "ended") {
                    finish();
                    this.send({type: "subscription-ended", id: frame.id, reason});
                }
            },
        };
        controller.signal.addEventListener("abort", finish, {once: true});
        if (this.#handlers.onSubscribe === undefined) {
            channel.reject({ok: false, code: "unavailable", detail: "本端不接受订阅"});
            return;
        }
        this.#handlers.onSubscribe(frame, channel, controller.signal);
    }

    #onClose(): void {
        if (this.#closed) {
            return;
        }
        this.#closed = true;
        for (const pending of [...this.#pending.values()]) {
            pending.settle(failureFor(pending.phase, pending.effect, "disconnected"));
        }
        for (const [id, subscription] of [...this.#subscriptions]) {
            this.#subscriptions.delete(id);
            if (subscription.accepted) {
                subscription.handlers.onEnd("disconnected");
            } else {
                subscription.settle(failureFor("undispatched", "read", "disconnected"));
            }
        }
        for (const controller of this.#inbound.values()) {
            controller.abort();
        }
        this.#inbound.clear();
        this.#handlers.onClose?.();
    }
}
