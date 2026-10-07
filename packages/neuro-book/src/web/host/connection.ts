/**
 * 连接对象：窗口与服务端之间唯一的通信出口（runtime.browser-host 可分离的边界 1）：引导请求，与内核 RPC 端口上的
 * 远程服务链路。服务端地址由装配方给出，页面里是 `location.origin`；RPC 地址用同一个主机名与协议、引导给出的端口，
 * 使浏览器发出的 Origin 与页面一致。
 */

import type {RemoteLink} from "@notnotype/nb-runtime/remote";

import {BROWSER_BOOTSTRAP_PATH} from "nbook/shared/browser-bootstrap";
import type {BrowserBootstrap} from "nbook/shared/browser-bootstrap";
import {createSocketLink} from "nbook/shared/rpc-socket";

/**
 * 没有连上服务端：引导请求网络失败、非 2xx 或正文不是 JSON，或 RPC 端口的 WebSocket 没能打开。窗口据此显示
 * 带重试的连接失败页。
 */
export class ConnectionError extends Error {
    /** HTTP 状态码；网络失败为 null。 */
    readonly status: number | null;

    constructor(message: string, status: number | null, options?: ErrorOptions) {
        super(message, options);
        this.name = "ConnectionError";
        this.status = status;
    }
}

export type RpcEndpoint = BrowserBootstrap["rpc"];

export interface Connection {
    /** 取引导响应的原始 JSON；协议版本与结构由窗口判定。失败时抛 ConnectionError。 */
    bootstrap(): Promise<unknown>;
    /** 连接内核 RPC 端口，WebSocket 打开时完成；没能打开时抛 ConnectionError。之后的断开经链路的 `onClose` 通知。 */
    openRemote(endpoint: RpcEndpoint): Promise<RemoteLink>;
}

export function createConnection(baseUrl: string): Connection {
    const url = new URL(BROWSER_BOOTSTRAP_PATH, baseUrl);
    const base = new URL(baseUrl);
    return {
        openRemote(endpoint) {
            const {promise, resolve, reject} = Promise.withResolvers<RemoteLink>();
            let socket: WebSocket;
            try {
                const target = new URL(endpoint.path, base);
                target.protocol = base.protocol === "https:" ? "wss:" : "ws:";
                target.port = String(endpoint.port);
                socket = new WebSocket(target);
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
        },
        async bootstrap() {
            let response: Response;
            try {
                response = await fetch(url, {cache: "no-store", headers: {accept: "application/json"}});
            } catch (error) {
                throw new ConnectionError("无法连接服务端", null, {cause: error});
            }
            if (!response.ok) throw new ConnectionError(`服务端暂不可用（HTTP ${String(response.status)}${await errorCode(response)}）`, response.status);
            try {
                return (await response.json()) as unknown;
            } catch (error) {
                throw new ConnectionError("服务端返回的引导响应不是 JSON", response.status, {cause: error});
            }
        },
    };
}

/** 服务端错误响应 `{error: {code}}` 里的错误码，便于区分启动失败、关闭中与开发模式下的后端重启。 */
async function errorCode(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as {error?: {code?: unknown}};
        return typeof body.error?.code === "string" ? `，${body.error.code}` : "";
    } catch {
        // 错误正文不是 JSON（例如中间代理的 HTML 错误页）时只报状态码。
        return "";
    }
}
