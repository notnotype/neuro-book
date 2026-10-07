/**
 * 内核 RPC 端口：远程服务专用的 WebSocket 监听，与 HTTP 端口分离（docs/specs/runtime/server-host.md 的
 * “内核 RPC 端口”）。
 *
 * 升级前先过门（等运行实例就绪，启动失败与停止中为 503），再核对 `Origin`：顺序不能反，HTTP 端口为 0 时
 * 允许的来源要等 `nbook.http` 监听后才知道。没有 `Origin` 头的升级放行：浏览器发起的 WebSocket 握手总会带，
 * 网页无法省略，不带的只有本机的非浏览器客户端。监听与路由归宿主：插件全部关闭后才由装配方停止。
 */

import type {RemoteRouter} from "@notnotype/nb-runtime/remote";

import {createSocketLink, RPC_MAX_MESSAGE_BYTES, RPC_PATH} from "nbook/shared/rpc-socket";
import type {SocketLink} from "nbook/shared/rpc-socket";

/** 门的结果；拒绝时 `code` 进 503 响应的错误码（`startup-failed`、`stopping`）。 */
export type RpcGateResult = {readonly ok: true} | {readonly ok: false; readonly code: string};

export interface RpcListenerOptions {
    readonly host: string;
    readonly port: number;
    readonly router: RemoteRouter;
    /** 升级前的门：等运行实例就绪。 */
    readonly admit: () => Promise<RpcGateResult>;
    /** 带 `Origin` 头的升级是否放行；过门之后才调用。 */
    readonly allowOrigin: (origin: string) => boolean;
    /** 处理升级请求时的意外错误；监听本身照常。 */
    readonly reportError: (error: unknown) => void;
}

export interface RpcListener {
    /** `ws://<地址>:<端口>/` */
    readonly url: string;
    readonly port: number;
    /** 停止监听并断开剩余连接；幂等。 */
    stop(): void;
}

/** 服务端用 WebSocket ping 发现失联客户端：空闲这么久且不回应即断开。 */
const IDLE_TIMEOUT_SECONDS = 120;

interface SocketData {
    link: SocketLink | null;
}

function rejection(status: number, code: string, message: string): Response {
    return Response.json({error: {code, message}}, {status});
}

/** 开始监听；端口被占用等监听失败时同步抛错。 */
export function startRpcListener(options: RpcListenerOptions): RpcListener {
    const server = Bun.serve({
        hostname: options.host,
        port: options.port,
        fetch: async (request, bun) => {
            if (new URL(request.url).pathname !== RPC_PATH) {
                return rejection(404, "not-found", "RPC 端口只接受路径 / 上的 WebSocket 升级。");
            }
            if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
                return rejection(426, "upgrade-required", "RPC 端口只接受 WebSocket 升级。");
            }
            const gate = await options.admit();
            if (!gate.ok) {
                return rejection(503, gate.code, "NeuroBook 暂不接受 RPC 连接。");
            }
            const origin = request.headers.get("origin");
            if (origin !== null && !options.allowOrigin(origin)) {
                return rejection(403, "origin-not-allowed", "页面来源不在允许的范围内。");
            }
            if (bun.upgrade(request, {data: {link: null}})) {
                return undefined;
            }
            return rejection(400, "upgrade-failed", "WebSocket 升级失败。");
        },
        websocket: {
            data: {} as SocketData,
            maxPayloadLength: RPC_MAX_MESSAGE_BYTES,
            idleTimeout: IDLE_TIMEOUT_SECONDS,
            sendPings: true,
            perMessageDeflate: false,
            open: (socket) => {
                const link = createSocketLink({send: (text) => void socket.send(text), close: () => socket.close()});
                socket.data.link = link;
                options.router.accept(link);
            },
            message: (socket, message) => socket.data.link?.receive(message),
            close: (socket) => socket.data.link?.closed(),
        },
        error: (error) => {
            options.reportError(error);
            return rejection(500, "internal-error", "处理 RPC 升级时出错。");
        },
    });
    const url = new URL(server.url);
    url.protocol = "ws:";
    let stopped = false;
    return {
        url: url.href,
        port: server.port ?? options.port,
        stop: () => {
            if (stopped) return;
            stopped = true;
            void server.stop(true);
        },
    };
}
