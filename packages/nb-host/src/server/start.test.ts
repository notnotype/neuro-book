/**
 * 服务端进程的启动与停止（docs/specs/runtime/server-host.md）：同进程起真实的 `startHostServer`（真实 Bun 监听、真实内核、
 * 真实认领），应用是测试里的 `acme`。覆盖宿主插件核对、扩展钩子的时序、启动失败时等待中的请求、`Host` 与 `Origin` 核对
 * （验收 17：HTTP 写请求与 RPC 升级用同一份来源判定）。进程级的停止来源（信号、标准输入、未处理异常）经产品装配由应用的
 * `src/server/server.test.ts` 用真实子进程覆盖。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {connect} from "node:net";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {Hono} from "hono";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition, PluginPlatform} from "@notnotype/nb-runtime/plugins";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {HTTP_ROUTES_POINT, rethrowRouteError} from "../shared/http-contracts";
import type {HttpRouteEnv} from "../shared/http-contracts";
import {ACME_CLAIM} from "../testing/acme";
import {upgradeStatus} from "../testing/rpc-client";
import {claimStateRoot, queryInstance} from "./claim";
import type {StateRootClaim} from "./claim";
import {loopbackOrigins} from "./loopback";
import {ServerAssemblyError, startHostServer} from "./start";
import type {HostPluginContext, HostServer, HostServerExtension, HostServerOptions} from "./start";

const PLATFORM: PluginPlatform = {engine: "acme", reservedPublishers: ["acme"]};
type AcmeFields = typeof ACME_CLAIM.fields;

let tmp = "";
let sequence = 0;
const running = new Set<HostServer>();

beforeAll(async () => {
    tmp = await createTestTmpRoot("nb-host", "host-server");
});
afterEach(async () => {
    for (const server of running) {
        server.requestStop("test-cleanup");
        await server.stopped;
    }
    running.clear();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 挂一条 `http.routes`：`POST /x` 与 `GET /x` 都回方法名。 */
function echoPlugin(): PluginDefinition {
    const id = "acme.echo";
    return {
        id,
        entries: [defineEntry({
            id: "server",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}],
            contributions: [{capability: HTTP_ROUTES_POINT, id, declaration: {}}],
            activate: () => ({contributions: {[HTTP_ROUTES_POINT]: {[id]: new Hono<{Bindings: HttpRouteEnv}>().onError(rethrowRouteError).all("/x", (c) => c.text(c.req.method))}}}),
        })],
    };
}

/** 激活等 `hold` 结束后失败。 */
function failingPlugin(hold: Promise<void>): PluginDefinition {
    return {id: "acme.fail", entries: [defineEntry({id: "server", location: "server", dependencies: [{key: diagnosticsKey}], activate: async () => {
        await hold;
        throw new Error("injected activation failure");
    }})]};
}

/** 激活等 `hold` 结束后成功。 */
function slowPlugin(hold: Promise<void>): PluginDefinition {
    return {id: "acme.slow", entries: [defineEntry({id: "server", location: "server", dependencies: [{key: diagnosticsKey}], activate: async () => {
        await hold;
        return {};
    }})]};
}

const hostOnly = (context: HostPluginContext): PluginDefinition[] => [context.hostPlugins.diagnostics, context.hostPlugins.http];

async function claimed(): Promise<{readonly root: string; readonly claim: StateRootClaim<AcmeFields>}> {
    sequence += 1;
    const root = join(tmp, `state-${String(sequence)}`);
    const result = await claimStateRoot({stateRoot: root, kind: "fixture", profile: ACME_CLAIM, report: () => undefined});
    if (!result.ok) throw new Error(result.reason);
    return {root, claim: result.claim};
}

async function start(overrides: Partial<HostServerOptions<AcmeFields>> = {}) {
    const {root, claim} = await claimed();
    const fatal: string[] = [];
    const options: HostServerOptions<AcmeFields> = {
        product: {name: "Acme"},
        platform: PLATFORM,
        listen: {host: "127.0.0.1", port: 0, rpcPort: 0, shiftPorts: false, allowedOrigins: []},
        logDirectory: join(root, "logs"),
        claim,
        http: {id: "acme.http", staticRoot: null},
        plugins: hostOnly,
        readyInfo: () => ({modules: {count: 1}}),
        process: new EventEmitter(),
        signals: [],
        stopInput: null,
        writeFatal: (line) => void fatal.push(line),
        ...overrides,
    };
    const server = startHostServer(options);
    running.add(server);
    return {server, root, fatal};
}

/** 手写一次 HTTP 请求读状态码：`fetch` 改不了 `Host` 头。 */
function rawStatus(port: number, host: string): Promise<number> {
    const {promise, resolve, reject} = Promise.withResolvers<number>();
    const socket = connect(port, "127.0.0.1");
    let head = "";
    socket.on("connect", () => socket.write(`GET /api/runtime/health HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
    socket.on("data", (chunk: Buffer) => {
        head += chunk.toString("latin1");
        const status = /^HTTP\/1\.1 (\d{3})/u.exec(head);
        if (status !== null) {
            resolve(Number(status[1]));
            socket.destroy();
        }
    });
    socket.on("error", reject);
    return promise;
}

describe("宿主插件核对", () => {
    it("应用包装过的宿主插件（新对象、同一批入口）照常启动；就绪后认领发布应用字段", async () => {
        const {server, root} = await start({plugins: (context) => [{...context.hostPlugins.diagnostics, version: "1.0.0"}, {...context.hostPlugins.http, version: "1.0.0"}]});
        await server.ready;
        expect(await queryInstance(root, ACME_CLAIM)).toMatchObject({state: "running", instance: {status: "ready", url: server.url, rpcUrl: server.rpcUrl, modules: {count: 1}}});
    });

    for (const [name, plugins] of [
        ["漏掉 HTTP 插件", (context: HostPluginContext) => [context.hostPlugins.diagnostics]],
        ["换掉 HTTP 插件的入口", (context: HostPluginContext) => [context.hostPlugins.diagnostics, {...context.hostPlugins.http, entries: context.hostPlugins.http.entries.map((entry) => ({...entry}))}]],
    ] as const) {
        it(`${name}：装配失败，写致命诊断、放下认领，没有运行实例`, async () => {
            const {root, claim} = await claimed();
            const fatal: string[] = [];
            expect(() => startHostServer({
                product: {name: "Acme"}, platform: PLATFORM, listen: {host: "127.0.0.1", port: 0, rpcPort: 0, shiftPorts: false, allowedOrigins: []},
                logDirectory: join(root, "logs"), claim, http: {id: "acme.http", staticRoot: null}, plugins, readyInfo: () => ({modules: {count: 0}}),
                process: new EventEmitter(), signals: [], stopInput: null, writeFatal: (line) => void fatal.push(line),
            })).toThrow(ServerAssemblyError);
            expect(fatal.join("")).toContain("runtime.startup.failed");
            await waitUntil("认领已放下", async () => (await queryInstance(root, ACME_CLAIM)).state === "none");
        });
    }

    it("应用给的宿主接口建不起来（两个接口路径相同）：装配失败，写致命诊断、放下认领，RPC 端口已关", async () => {
        const {root, claim} = await claimed();
        const fatal: string[] = [];
        let rpcUrl = "";
        const route = {method: "GET", path: "/acme", handle: () => new Response("ok")} as const;
        expect(() => startHostServer({
            product: {name: "Acme"}, platform: PLATFORM, listen: {host: "127.0.0.1", port: 0, rpcPort: 0, shiftPorts: false, allowedOrigins: []},
            logDirectory: join(root, "logs"), claim, http: {id: "acme.http", staticRoot: null, hostRoutes: () => [route, route]}, plugins: hostOnly, readyInfo: () => ({modules: {count: 0}}),
            process: new EventEmitter(), signals: [], stopInput: null, writeFatal: (line) => void fatal.push(line), onRpcListening: (url) => void (rpcUrl = url),
        })).toThrow(ServerAssemblyError);
        expect(fatal.join("")).toContain("runtime.startup.failed");
        await waitUntil("认领已放下", async () => (await queryInstance(root, ACME_CLAIM)).state === "none");
        expect(rpcUrl).not.toBe("");
        await expect(upgradeStatus(Number(new URL(rpcUrl).port))).rejects.toThrow();
    });

    it("监听地址不在回环上：任何监听之前就装配失败，认领已放下", async () => {
        const {root, claim} = await claimed();
        const fatal: string[] = [];
        expect(() => startHostServer({
            product: {name: "Acme"}, platform: PLATFORM, listen: {host: "0.0.0.0", port: 0, rpcPort: 0, shiftPorts: false, allowedOrigins: []},
            logDirectory: join(root, "logs"), claim, http: {id: "acme.http", staticRoot: null}, plugins: hostOnly, readyInfo: () => ({modules: {count: 0}}),
            process: new EventEmitter(), signals: [], stopInput: null, writeFatal: (line) => void fatal.push(line),
        })).toThrow(ServerAssemblyError);
        await waitUntil("认领已放下", async () => (await queryInstance(root, ACME_CLAIM)).state === "none");
    });
});

describe("扩展钩子的时序", () => {
    it("attach 在运行实例建立后、返回之前；ready 在认领发布之后；停止时 stopping 先于排空，problems 在停止结算后读", async () => {
        const events: string[] = [];
        const {root, claim} = await claimed();
        const watched: StateRootClaim<AcmeFields> = {...claim, publish: (ready) => {
            events.push("publish");
            claim.publish(ready);
        }, stopping: () => {
            events.push("claim.stopping");
            claim.stopping();
        }, release: () => claim.release(), stateRoot: claim.stateRoot, kind: claim.kind};
        const extension: HostServerExtension = {
            attach: (context) => void events.push(`attach:${context.instanceId}`),
            ready: () => void events.push("ready"),
            stopping: () => void events.push("stopping"),
            problems: () => {
                events.push("problems");
                return [];
            },
        };
        const {server} = await start({claim: watched, extensions: [extension], logDirectory: join(root, "logs")});
        expect(events).toEqual(["attach:server"]);
        await server.ready;
        expect(events).toEqual(["attach:server", "publish", "ready"]);
        server.requestStop("test");
        expect((await server.stopped).exitCode).toBe(0);
        expect(events).toEqual(["attach:server", "publish", "ready", "claim.stopping", "stopping", "problems"]);
    });

    it("启动中请求停止：ready 不调用", async () => {
        const hold = Promise.withResolvers<void>();
        let readied = false;
        const {server} = await start({plugins: (context) => [...hostOnly(context), slowPlugin(hold.promise)], extensions: [{ready: () => void (readied = true)}]});
        server.requestStop("test");
        hold.resolve();
        await server.ready.catch(() => undefined);
        await server.stopped;
        expect(readied).toBe(false);
    });

    it("stopping 失败与 problems 非空：停止不完整，以 1 退出", async () => {
        const failing = await start({extensions: [{stopping: () => Promise.reject(new Error("injected stopping failure"))}]});
        await failing.server.ready;
        failing.server.requestStop("test");
        const outcome = await failing.server.stopped;
        expect(outcome.exitCode).toBe(1);
        expect(outcome.failures.map(String)).toContain("Error: 停止步骤失败：排空");
        const problems = await start({extensions: [{problems: () => ["acme 的收尾没完成"]}]});
        await problems.server.ready;
        problems.server.requestStop("test");
        const second = await problems.server.stopped;
        expect(second.exitCode).toBe(1);
        expect(second.failures.map(String)).toContain("Error: 停止步骤失败：acme 的收尾没完成");
    });
});

describe("启动失败", () => {
    it("等待就绪的请求得到 503 startup-failed（文字带产品名），以 1 退出", async () => {
        const hold = Promise.withResolvers<void>();
        const listening = Promise.withResolvers<string>();
        const {server, fatal} = await start({plugins: (context) => [...hostOnly(context), failingPlugin(hold.promise)], onListening: listening.resolve});
        server.ready.catch(() => undefined);
        const waiting = fetch(`${await listening.promise}api/runtime/health`);
        await waitUntil("请求进入等待就绪", () => server.activeRequests === 1);
        hold.resolve();
        const response = await waiting;
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({error: {code: "startup-failed", message: "Acme 启动失败。"}});
        expect((await server.stopped).exitCode).toBe(1);
        expect(fatal.join("")).toContain("runtime.startup.causes");
    });

    it("应用给的认领字段不合档案：按启动失败处理，等待中的请求得到 503，写致命诊断，以 1 退出，认领放下", async () => {
        const hold = Promise.withResolvers<void>();
        const listening = Promise.withResolvers<string>();
        // 类型挡不住的不合：档案要整数。
        const {server, fatal, root} = await start({plugins: (context) => [...hostOnly(context), slowPlugin(hold.promise)], readyInfo: () => ({modules: {count: 1.5}}), onListening: listening.resolve});
        const rejected = server.ready.then(() => null, (error: unknown) => error);
        const waiting = fetch(`${await listening.promise}api/runtime/health`);
        await waitUntil("请求进入等待就绪", () => server.activeRequests === 1);
        hold.resolve();
        expect(await rejected).toMatchObject({name: "ServerStartupError", status: "failed"});
        expect((await waiting).status).toBe(503);
        expect(fatal.join("")).toContain("runtime.startup.failed");
        expect((await server.stopped).exitCode).toBe(1);
        expect(await queryInstance(root, ACME_CLAIM)).toMatchObject({state: "none"});
    });
});

describe("Host 与 Origin（验收 17）", () => {
    it("Host 不是回环名得 421；写请求带不允许的来源得 403，本页来源放行；读请求任何来源都放行；RPC 升级用同一份来源判定", async () => {
        const {server} = await start({plugins: (context) => [...hostOnly(context), echoPlugin()]});
        await server.ready;
        const url = server.url as string;
        const port = Number(new URL(url).port);
        expect(await rawStatus(port, `evil.example:${String(port)}`)).toBe(421);
        expect(await rawStatus(port, `127.0.0.1:${String(port)}`)).toBe(200);
        const page = loopbackOrigins(url)[1] as string;
        const post = (origin?: string) => fetch(`${url}api/acme.echo/x`, {method: "POST", body: "x", headers: origin === undefined ? {} : {origin}});
        expect((await post("http://evil.example")).status).toBe(403);
        expect((await post("null")).status).toBe(403);
        expect(await (await post(page)).text()).toBe("POST");
        expect(await (await post()).text()).toBe("POST");
        expect(await (await fetch(`${url}api/acme.echo/x`, {headers: {origin: "http://evil.example"}})).text()).toBe("GET");
        const rpcPort = Number(new URL(server.rpcUrl).port);
        expect(await upgradeStatus(rpcPort, {origin: "http://evil.example"})).toBe(403);
        expect(await upgradeStatus(rpcPort, {origin: page})).toBe(101);
    });
});
