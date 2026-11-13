/**
 * 浏览器连 RPC 端口的 WebSocket：真实 `Bun.serve` 的 WebSocket 服务端与 Bun 的 WebSocket 客户端（与浏览器同一套事件）；
 * 地址拼接是纯函数，直接核对。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {WIRE_PROTOCOL_VERSION} from "@notnotype/nb-runtime/remote";
import type {Frame} from "@notnotype/nb-runtime/remote";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import type {Server, ServerWebSocket} from "bun";

import {ConnectionError} from "./connection-error";
import {openRpcSocket, rpcSocketUrl} from "./rpc-socket";

const servers: Server<undefined>[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

interface EchoServer {
    readonly port: number;
    /** 服务端收到的每条文本。 */
    readonly received: string[];
    /** 已打开的服务端套接字。 */
    readonly sockets: ServerWebSocket<undefined>[];
}

/** 只在 `/rpc` 接受升级的服务端；`refuse` 时拒绝一切升级（握手没完成，客户端在打开之前就收到关闭）。 */
function serve(options: {readonly refuse?: boolean} = {}): EchoServer {
    const received: string[] = [];
    const sockets: ServerWebSocket<undefined>[] = [];
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request, target) {
            if (options.refuse !== true && new URL(request.url).pathname === "/rpc" && target.upgrade(request)) return undefined;
            return new Response("forbidden", {status: 403});
        },
        websocket: {
            open: (socket) => {
                sockets.push(socket);
            },
            message: (_socket, message) => {
                received.push(String(message));
            },
        },
    });
    servers.push(server);
    return {port: server.port!, received, sockets};
}

const hello: Frame = {
    type: "hello",
    wire: WIRE_PROTOCOL_VERSION,
    instance: {id: "browser-1", kind: "browser", role: "client", project: null, client: null},
    bind: null,
    boot: null,
};

describe("rpcSocketUrl", () => {
    it("http 换 ws、https 换 wss；主机名不变，端口与路径换成端点的", () => {
        expect(rpcSocketUrl("http://127.0.0.1:4000/", {port: 4100, path: "/"}).href).toBe("ws://127.0.0.1:4100/");
        expect(rpcSocketUrl("https://localhost:8443/app/", {port: 9000, path: "/rpc"}).href).toBe("wss://localhost:9000/rpc");
        expect(rpcSocketUrl("http://[::1]:4000", {port: 4100, path: "/"}).href).toBe("ws://[::1]:4100/");
    });
});

describe("openRpcSocket", () => {
    it("打开后完成：发出的帧按 JSON 到达服务端，服务端发来的帧交给链路的 onFrame", async () => {
        const server = serve();
        const link = await openRpcSocket("http://127.0.0.1/", {port: server.port, path: "/rpc"});
        const frames: unknown[] = [];
        link.onFrame((value) => frames.push(value));
        link.send(hello);
        const text = await waitUntil("服务端收到帧", () => server.received[0]);
        expect(JSON.parse(text)).toEqual(hello);
        server.sockets[0]!.send(JSON.stringify({type: "ping"}));
        await waitUntil("链路收到服务端的帧", () => frames.length > 0);
        expect(frames).toEqual([{type: "ping"}]);
        link.close();
    });

    it("端口上没有监听：以 ConnectionError 拒绝，status 为 null", async () => {
        const server = serve();
        const port = server.port;
        await servers.pop()!.stop(true);
        const opening = openRpcSocket("http://127.0.0.1/", {port, path: "/rpc"});
        await expect(opening).rejects.toBeInstanceOf(ConnectionError);
        await expect(opening).rejects.toMatchObject({status: null});
    });

    it("服务端拒绝升级、在打开之前就关闭：以 ConnectionError 拒绝", async () => {
        const server = serve({refuse: true});
        await expect(openRpcSocket("http://127.0.0.1/", {port: server.port, path: "/rpc"})).rejects.toBeInstanceOf(ConnectionError);
    });

    it("页面地址拼不出 WebSocket 地址：以 ConnectionError 拒绝，原因放在 cause", async () => {
        const opening = openRpcSocket("不是地址", {port: 4100, path: "/"});
        await expect(opening).rejects.toBeInstanceOf(ConnectionError);
        await expect(opening).rejects.toMatchObject({cause: expect.any(TypeError)});
    });

    it("打开之后服务端关闭：链路的 onClose 调用一次", async () => {
        const server = serve();
        const link = await openRpcSocket("http://127.0.0.1/", {port: server.port, path: "/rpc"});
        let closes = 0;
        const {promise, resolve} = Promise.withResolvers<void>();
        link.onClose(() => {
            closes += 1;
            resolve();
        });
        server.sockets[0]!.close();
        await promise;
        expect(closes).toBe(1);
    });
});
