/**
 * 宿主合同测试连内核 RPC 端口用的客户端：手写的 HTTP 升级请求（读被拒升级的状态码，WebSocket 客户端看不到它），
 * 与直接收发帧的 Bun WebSocket（发节点自己不会发的帧、观察服务端回的每一帧）。只由测试引用。
 */

import {connect} from "node:net";

import {WIRE_PROTOCOL_VERSION} from "@notnotype/nb-runtime/remote";
import type {BindRequest, InstanceDescriptor} from "@notnotype/nb-runtime/remote";

/** 手写一次升级请求，返回响应的状态码；连接被拒时拒绝。 */
export function upgradeStatus(port: number, options: {readonly path?: string; readonly origin?: string; readonly upgrade?: boolean} = {}): Promise<number> {
    const {promise, resolve, reject} = Promise.withResolvers<number>();
    const socket = connect(port, "127.0.0.1");
    const lines = [`GET ${options.path ?? "/"} HTTP/1.1`, `Host: 127.0.0.1:${String(port)}`];
    if (options.upgrade !== false) lines.push("Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version: 13");
    if (options.origin !== undefined) lines.push(`Origin: ${options.origin}`);
    let head = "";
    socket.on("data", (chunk: Buffer) => {
        head += chunk.toString("latin1");
        const end = head.indexOf("\r\n");
        if (end >= 0) {
            resolve(Number(head.slice(0, end).split(" ")[1]));
            socket.destroy();
        }
    });
    socket.on("error", reject);
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    return promise;
}

export interface RawRpcSocket {
    readonly socket: WebSocket;
    readonly opened: Promise<void>;
    /** 关闭码。 */
    readonly closed: Promise<number>;
    send(frame: unknown): void;
    /** 等第一个满足条件的帧（含已经收到的）。 */
    next(match: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
}

export function openRawRpcSocket(url: string, origin?: string): RawRpcSocket {
    const socket = new WebSocket(url, origin === undefined ? undefined : {headers: {Origin: origin}});
    const frames: Array<Record<string, unknown>> = [];
    const waiters = new Set<{readonly match: (frame: Record<string, unknown>) => boolean; readonly resolve: (frame: Record<string, unknown>) => void}>();
    const opened = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<number>();
    socket.addEventListener("open", () => opened.resolve());
    socket.addEventListener("close", (event) => closed.resolve(event.code));
    socket.addEventListener("message", (event) => {
        const frame = JSON.parse(String(event.data)) as Record<string, unknown>;
        frames.push(frame);
        for (const waiter of [...waiters]) {
            if (waiter.match(frame)) {
                waiters.delete(waiter);
                waiter.resolve(frame);
            }
        }
    });
    return {
        socket,
        opened: opened.promise,
        closed: closed.promise,
        send: (frame) => socket.send(typeof frame === "string" ? frame : JSON.stringify(frame)),
        next: (match) => {
            const found = frames.find(match);
            if (found !== undefined) return Promise.resolve(found);
            const {promise, resolve} = Promise.withResolvers<Record<string, unknown>>();
            waiters.add({match, resolve});
            return promise;
        },
    };
}

/** 以给定实例描述握手的 hello 帧；缺省不绑定项目，也没有上次的服务端进程标识。 */
export function helloFrame(instance: InstanceDescriptor, options: {readonly bind?: BindRequest; readonly boot?: string | null} = {}): unknown {
    return {type: "hello", wire: WIRE_PROTOCOL_VERSION, instance, bind: options.bind ?? null, boot: options.boot ?? null};
}
