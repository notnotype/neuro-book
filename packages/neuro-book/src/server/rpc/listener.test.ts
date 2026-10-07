/**
 * 内核 RPC 端口的升级规则：真实 Bun 监听、真实内核路由；状态码用手写的 HTTP 升级请求读取（浏览器与 Bun 的
 * WebSocket 客户端都看不到被拒升级的状态码），握手用 Bun 的 WebSocket 客户端。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {createRemoteNode, createRemoteRouter, WIRE_PROTOCOL_VERSION} from "@notnotype/nb-runtime/remote";

import {helloFrame, openRawRpcSocket, upgradeStatus} from "nbook/server/testing/rpc-client";
import {RPC_MAX_MESSAGE_BYTES} from "nbook/shared/rpc-socket";

import {loopbackOrigins, startRpcListener} from "./listener";
import type {RpcGateResult, RpcListener} from "./listener";

const PAGE_ORIGIN = "http://127.0.0.1:3000";

const listeners: RpcListener[] = [];

afterEach(() => {
    for (const listener of listeners.splice(0)) listener.stop();
});

function listen(admit: () => Promise<RpcGateResult> = () => Promise.resolve({ok: true})): RpcListener {
    const router = createRemoteRouter(createRemoteNode({instance: {id: "server", kind: "server", role: "hub", project: null, client: null}}));
    const listener = startRpcListener({
        host: "127.0.0.1",
        port: 0,
        router,
        admit,
        allowOrigin: (origin) => origin === PAGE_ORIGIN,
        reportError: (error) => {
            throw error;
        },
    });
    listeners.push(listener);
    return listener;
}

const browser = {id: "browser-1", kind: "browser", role: "client" as const, project: null, client: "profile-1"};

describe("内核 RPC 端口的升级（Spec server-host 场景 12）", () => {
    it("Origin：允许的来源与不带 Origin 的升级放行，其它来源 403", async () => {
        const {port} = listen();
        expect(await upgradeStatus(port, {origin: PAGE_ORIGIN})).toBe(101);
        expect(await upgradeStatus(port)).toBe(101);
        expect(await upgradeStatus(port, {origin: "http://evil.example"})).toBe(403);
        expect(await upgradeStatus(port, {origin: "http://127.0.0.1:3001"})).toBe(403);
    });

    it("只有 / 上的升级：其它路径 404，不带升级头 426", async () => {
        const {port} = listen();
        expect(await upgradeStatus(port, {path: "/rpc", origin: PAGE_ORIGIN})).toBe(404);
        expect(await upgradeStatus(port, {upgrade: false})).toBe(426);
    });

    it("就绪前的升级在门口等待，放行后升级；门拒绝时 503 带原因", async () => {
        const gate = Promise.withResolvers<RpcGateResult>();
        const arrived = Promise.withResolvers<void>();
        const {port} = listen(() => {
            arrived.resolve();
            return gate.promise;
        });
        let settled = false;
        const waiting = upgradeStatus(port, {origin: PAGE_ORIGIN}).finally(() => {
            settled = true;
        });
        await arrived.promise;
        expect(settled).toBe(false);
        gate.resolve({ok: true});
        expect(await waiting).toBe(101);

        const refused = listen(() => Promise.resolve({ok: false, code: "startup-failed"}));
        const response = await fetch(`http://127.0.0.1:${String(refused.port)}/`, {headers: {Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13"}});
        expect(await upgradeStatus(refused.port)).toBe(503);
        expect(await response.json()).toMatchObject({error: {code: "startup-failed"}});
    });

    it("升级后链路交给路由：hello 得到 welcome；单条消息超过上限即断开", async () => {
        const listener = listen();
        expect(listener.url).toBe(`ws://127.0.0.1:${String(listener.port)}/`);
        const client = openRawRpcSocket(listener.url, PAGE_ORIGIN);
        await client.opened;
        client.send(helloFrame(browser));
        expect(await client.next((frame) => frame.type === "welcome")).toMatchObject({wire: WIRE_PROTOCOL_VERSION, boot: expect.any(String)});

        // Bun 直接断开超长消息的连接（1006），不是路由按协议违规正常关闭（1000）。
        client.send("x".repeat(RPC_MAX_MESSAGE_BYTES + 1));
        expect(await client.closed).not.toBe(1000);
    });

    it("停止后不再接受连接", async () => {
        const listener = listen();
        const client = openRawRpcSocket(listener.url, PAGE_ORIGIN);
        await client.opened;
        listener.stop();
        await client.closed;
        const refused = await upgradeStatus(listener.port).then(() => "accepted", () => "refused");
        expect(refused).toBe("refused");
    });
});

describe("允许的来源", () => {
    it("HTTP 端口在三个回环别名上的来源；默认端口不写端口号", () => {
        expect(loopbackOrigins("http://127.0.0.1:3000/")).toEqual(["http://127.0.0.1:3000", "http://localhost:3000", "http://[::1]:3000"]);
        expect(loopbackOrigins("http://localhost/")).toEqual(["http://127.0.0.1", "http://localhost", "http://[::1]"]);
    });
});
