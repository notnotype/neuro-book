/**
 * 内核 RPC 端口的 WebSocket 链路：服务端（Bun 的 ServerWebSocket）与浏览器（WebSocket）共用的适配。
 *
 * 两侧的套接字 API 不同，这里只要求“发一条文本、关闭”两个动作，收到的消息与关闭事件由各自宿主转进来；
 * 帧经内核的 JSON 编解码（docs/specs/runtime/plugin-channel.md 的“WebSocket 传输与握手”）。
 * 本文件不引用任何一侧的实现，也不碰 DOM、Bun 与 Node API。
 */

import {decodeJsonFrame, encodeJsonFrame} from "@notnotype/nb-runtime/remote";
import type {Frame, RemoteLink} from "@notnotype/nb-runtime/remote";

/** RPC 端口上唯一接受升级的路径。 */
export const RPC_PATH = "/";

/** 单条消息上限：二进制与大块内容经 HTTP 资源地址传递，不走 RPC。 */
export const RPC_MAX_MESSAGE_BYTES = 1024 * 1024;

/** 套接字的最小发送面。`send` 在套接字已关闭时可以丢弃消息，关闭由宿主转进来的关闭事件通知。 */
export interface TextSocket {
    send(text: string): void;
    close(): void;
}

/** 链路加上宿主转入消息与关闭事件的两个入口。 */
export interface SocketLink extends RemoteLink {
    /** 套接字收到一条消息；文本按 JSON 解码，其它（二进制）原样交给帧解析判为无效帧。 */
    receive(message: unknown): void;
    /** 套接字已关闭（任一端关闭或连接断开）；只生效一次。 */
    closed(): void;
}

export function createSocketLink(socket: TextSocket): SocketLink {
    const frameListeners = new Set<(value: unknown) => void>();
    const closeListeners = new Set<() => void>();
    let closing = false;
    let closed = false;
    return {
        send(frame: Frame): void {
            // 先编码：值不能如实表示时同步抛错（RemoteLink.send 的合同），哪怕链路已在关闭。
            const text = encodeJsonFrame(frame);
            if (!closing && !closed) {
                socket.send(text);
            }
        },
        onFrame(listener) {
            frameListeners.add(listener);
            return () => frameListeners.delete(listener);
        },
        onClose(listener) {
            if (closed) {
                queueMicrotask(listener);
                return () => undefined;
            }
            closeListeners.add(listener);
            return () => closeListeners.delete(listener);
        },
        close(): void {
            if (closing || closed) {
                return;
            }
            closing = true;
            socket.close();
        },
        receive(message: unknown): void {
            if (closed) {
                return;
            }
            const value = typeof message === "string" ? decodeJsonFrame(message) : message;
            for (const listener of [...frameListeners]) {
                listener(value);
            }
        },
        closed(): void {
            if (closed) {
                return;
            }
            closed = true;
            for (const listener of [...closeListeners]) {
                listener();
            }
            closeListeners.clear();
            frameListeners.clear();
        },
    };
}
