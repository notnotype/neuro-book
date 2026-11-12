/**
 * 远程服务链路的退避重连（runtime.browser-host 的“断线与重连”）：同进程起真实的宿主服务端（`startHostServer` 与测试应用
 * `acme` 的认领档案）、真实 WebSocket 与内核节点；应用的 `refreshEndpoint` 用替身，交回此刻在跑的服务端的 RPC 端点。
 * 退避用手动时钟，每一步等到这次重连的结果出来再推进时钟。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {PluginPlatform} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {claimStateRoot} from "../server/claim";
import {startHostServer} from "../server/start";
import type {HostServer} from "../server/start";
import {RPC_PATH} from "../shared/socket";
import {ACME_CLAIM} from "../testing/acme";
import {createRemoteSession} from "./remote-session";
import type {EndpointRefresh, RemoteSession, RemoteSessionState} from "./remote-session";
import {openRpcSocket} from "./rpc-socket";
import type {RpcEndpoint} from "./rpc-socket";

const PLATFORM: PluginPlatform = {engine: "acme", reservedPublishers: ["acme"]};

let tmp = "";
let sequence = 0;
const running = new Set<HostServer>();
const sessions = new Set<RemoteSession>();

beforeAll(async () => {
    tmp = await createTestTmpRoot("nb-host", "remote-session");
});
afterEach(async () => {
    for (const session of sessions) session.close();
    sessions.clear();
    for (const server of running) {
        server.requestStop("test-cleanup");
        await server.stopped;
    }
    running.clear();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 起一个只带宿主插件的服务端，等它可用；RPC 端口每次随机。 */
async function serve(): Promise<HostServer> {
    sequence += 1;
    const root = join(tmp, `state-${String(sequence)}`);
    const claimed = await claimStateRoot({stateRoot: root, kind: "fixture", profile: ACME_CLAIM, report: () => undefined});
    if (!claimed.ok) throw new Error(claimed.reason);
    const server = startHostServer({
        product: {name: "Acme"},
        platform: PLATFORM,
        listen: {host: "127.0.0.1", port: 0, rpcPort: 0, shiftPorts: false, allowedOrigins: []},
        logDirectory: join(root, "logs"),
        claim: claimed.claim,
        http: {id: "acme.http", staticRoot: null},
        plugins: (context) => [context.hostPlugins.diagnostics, context.hostPlugins.http],
        readyInfo: () => ({modules: {count: 0}}),
        process: new EventEmitter(),
        signals: [],
        stopInput: null,
        writeFatal: () => undefined,
    });
    running.add(server);
    await server.ready;
    return server;
}

async function stop(server: HostServer): Promise<void> {
    server.requestStop("test:restart");
    await server.stopped;
    running.delete(server);
}

function endpointOf(server: HostServer): RpcEndpoint {
    return {port: Number(new URL(server.rpcUrl).port), path: RPC_PATH};
}

/** 一个窗口的链路：节点、手动时钟与观察到的状态、失败原因；`refresh` 是应用的 `refreshEndpoint` 替身。 */
function windowSession(refresh: (signal: AbortSignal) => Promise<EndpointRefresh>) {
    const clock = new ManualClock();
    const states: Array<{readonly state: RemoteSessionState; readonly reason: string | null}> = [];
    const failures: string[] = [];
    const node = createRemoteNode({instance: {id: `browser-${String(sequence)}`, kind: "browser", role: "client", project: null, client: "profile-1"}, clock});
    const session = createRemoteSession({
        openRemote: (endpoint) => openRpcSocket("http://127.0.0.1/", endpoint),
        refreshEndpoint: refresh,
        node,
        clock,
        onState: (state, reason) => states.push({state, reason}),
        onRetryFailed: (reason) => failures.push(reason),
    });
    sessions.add(session);
    return {clock, states, failures, session};
}

describe("远程服务链路的退避重连", () => {
    it("断线后按 0.5、1、2 秒退避，每次先重取端点；连上换了进程的服务端时转为 server-restarted 并停止重连", async () => {
        const first = await serve();
        let current: HostServer | null = first;
        let refreshes = 0;
        const view = windowSession(async () => {
            refreshes += 1;
            return current === null ? {retry: "服务端不在"} : endpointOf(current);
        });
        expect(await view.session.start(endpointOf(first))).toEqual({ok: true});

        current = null;
        await stop(first);
        await waitUntil("链路断开后转为离线", () => view.states.at(-1)?.state === "offline");

        // 服务端不在：每次重连都在重取端点时交回 retry，原因交给 onRetryFailed，下一次的等待翻倍。
        for (const [index, delay] of [500, 1000, 2000].entries()) {
            view.clock.advance(delay - 1);
            expect(refreshes).toBe(index);
            view.clock.advance(1);
            await waitUntil(`第 ${String(index + 1)} 次重连失败`, () => view.failures.length === index + 1);
        }
        expect(view.failures).toEqual(["服务端不在", "服务端不在", "服务端不在"]);

        // 新进程的 RPC 端口与旧的不同：连得上说明用的是这一次重取的端点。
        const second = await serve();
        expect(endpointOf(second).port).not.toBe(endpointOf(first).port);
        current = second;
        view.clock.advance(4000);
        await waitUntil("连回新的服务端进程，识别为服务端已重启", () => view.states.at(-1)?.state === "server-restarted");
        expect(view.states.map((entry) => entry.state)).toEqual(["offline", "server-restarted"]);

        view.clock.advance(60_000);
        expect(refreshes).toBe(4);
    }, 20_000);

    it("应用判定不兼容：转为 incompatible，原因是应用给的，之后不再重连", async () => {
        const server = await serve();
        let refreshes = 0;
        const view = windowSession(async () => {
            refreshes += 1;
            return {incompatible: "服务端的引导协议版本已不是 1"};
        });
        expect(await view.session.start(endpointOf(server))).toEqual({ok: true});
        await stop(server);
        await waitUntil("链路断开后转为离线", () => view.states.at(-1)?.state === "offline");

        view.clock.advance(500);
        await waitUntil("转为 incompatible", () => view.states.at(-1)?.state === "incompatible");
        expect(view.states.at(-1)).toEqual({state: "incompatible", reason: "服务端的引导协议版本已不是 1"});
        view.clock.advance(60_000);
        expect(refreshes).toBe(1);
        expect(view.failures).toEqual([]);
    });

    it("close() 中止在途的重取端点：signal 中止，之后交回的结果被丢弃，不再记失败、不再重连", async () => {
        const server = await serve();
        const signals: AbortSignal[] = [];
        const view = windowSession((signal) => {
            signals.push(signal);
            const {promise, resolve} = Promise.withResolvers<EndpointRefresh>();
            signal.addEventListener("abort", () => resolve({retry: "已中止"}));
            return promise;
        });
        expect(await view.session.start(endpointOf(server))).toEqual({ok: true});
        await stop(server);
        await waitUntil("链路断开后转为离线", () => view.states.at(-1)?.state === "offline");

        view.clock.advance(500);
        const signal = await waitUntil("开始重取端点", () => signals[0]);
        expect(signal.aborted).toBe(false);
        view.session.close();
        expect(signal.aborted).toBe(true);

        view.clock.advance(60_000);
        // 中止后的结果在微任务里交回；等一轮宏任务让它走完，再看有没有记失败或排下一次。
        await new Promise((resolve) => setImmediate(resolve));
        expect(signals).toHaveLength(1);
        expect(view.failures).toEqual([]);
        expect(view.states.map((entry) => entry.state)).toEqual(["offline"]);
    });

    it("重取端点违约抛错：按一次失败记下原因、照常退避；关闭之后才抛的不再记", async () => {
        const server = await serve();
        const aborted: Array<Promise<EndpointRefresh>> = [];
        let mode: "throw" | "throw-on-abort" = "throw";
        const view = windowSession(async (signal) => {
            if (mode === "throw") throw new Error("应用的实现出错");
            const {promise, reject} = Promise.withResolvers<EndpointRefresh>();
            signal.addEventListener("abort", () => reject(new Error("中止时抛错")));
            aborted.push(promise);
            return promise;
        });
        expect(await view.session.start(endpointOf(server))).toEqual({ok: true});
        await stop(server);
        await waitUntil("链路断开后转为离线", () => view.states.at(-1)?.state === "offline");

        view.clock.advance(500);
        await waitUntil("第 1 次重连失败", () => view.failures.length === 1);
        expect(view.failures).toEqual(["重连出错：应用的实现出错"]);

        mode = "throw-on-abort";
        view.clock.advance(1000);
        await waitUntil("开始第 2 次重取端点", () => aborted.length === 1);
        view.session.close();
        await aborted[0]!.catch(() => undefined);
        // 抛错之后的处理都在微任务里；等一轮宏任务让它走完，再看有没有记失败或排下一次。
        await new Promise((resolve) => setImmediate(resolve));
        view.clock.advance(60_000);
        expect(view.failures).toEqual(["重连出错：应用的实现出错"]);
        expect(aborted).toHaveLength(1);
    });

    it("一直连不上：前五次分别等 0.5、1、2、4、8 秒，之后每次等 10 秒", async () => {
        const server = await serve();
        let refreshes = 0;
        const view = windowSession(async () => {
            refreshes += 1;
            return {retry: "服务端不在"};
        });
        expect(await view.session.start(endpointOf(server))).toEqual({ok: true});
        await stop(server);
        await waitUntil("链路断开后转为离线", () => view.states.at(-1)?.state === "offline");

        for (const [index, delay] of [500, 1000, 2000, 4000, 8000, 10_000, 10_000].entries()) {
            view.clock.advance(delay - 1);
            expect(refreshes).toBe(index);
            view.clock.advance(1);
            await waitUntil(`第 ${String(index + 1)} 次重连失败`, () => view.failures.length === index + 1);
        }
    });
});
