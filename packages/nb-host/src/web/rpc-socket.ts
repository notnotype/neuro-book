/**
 * 浏览器连内核 RPC 端口（docs/specs/runtime/browser-host.md）：地址用页面的主机名与协议、服务端给出的端口与路径，这样浏览器
 * 发出的 Origin 与页面一致，服务端的来源核对才认得它。
 */

import type {RemoteLink} from "@notnotype/nb-runtime/remote";

import {createSocketLink} from "../shared/socket";
import {ConnectionError} from "./connection-error";

/** 内核 RPC 端口；由服务端告诉浏览器（应用的引导接口）。 */
export interface RpcEndpoint {
    readonly port: number;
    readonly path: string;
}

/** RPC 端口的 WebSocket 地址：`http` 换 `ws`、`https` 换 `wss`，主机名不变、换成端点的端口与路径。 */
export function rpcSocketUrl(baseUrl: string, endpoint: RpcEndpoint): URL {
    const base = new URL(baseUrl);
    const target = new URL(endpoint.path, base);
    target.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    target.port = String(endpoint.port);
    return target;
}

/** 打开 RPC 端口的 WebSocket，打开时完成；没能打开时以 `ConnectionError` 拒绝。之后的断开经链路的 `onClose` 通知。 */
export function openRpcSocket(baseUrl: string, endpoint: RpcEndpoint): Promise<RemoteLink> {
    const {promise, resolve, reject} = Promise.withResolvers<RemoteLink>();
    let socket: WebSocket;
    try {
        socket = new WebSocket(rpcSocketUrl(baseUrl, endpoint));
    } catch (error) {
        // 地址拼不出来或浏览器拒绝建立连接（例如混合内容）：与连不上同样处理，窗口给出可重试的连接失败。
        return Promise.reject(new ConnectionError("无法连接服务端的 RPC 端口", null, {cause: error}));
    }
    const link = createSocketLink({send: (text) => socket.send(text), close: () => socket.close()});
    let opened = false;
    socket.addEventListener("open", () => {
        opened = true;
        resolve(link);
    });
    socket.addEventListener("message", (event) => link.receive(event.data));
    // 打开前出错也会随后收到 close；拒绝与链路关闭都放在 close 里，只处理一次。
    socket.addEventListener("close", () => {
        if (!opened) reject(new ConnectionError("无法连接服务端的 RPC 端口", null));
        link.closed();
    });
    return promise;
}
