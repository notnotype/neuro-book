/**
 * runtime.server-host 的真实子进程验收：启动、启动失败、各停止来源、排空、关闭步骤隔离与退出码。
 * 子进程与产品入口走同一启动函数，测试插件只经清单注入；状态根放在测试临时根下。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {mkdir, readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {Hono} from "hono";

import type {HttpAdmission} from "nbook/plugins/http/backend/admission";
import type {HttpRouteEnv} from "nbook/plugins/http/shared/contracts";
import {remoteProbeContract} from "nbook/shared/testing/remote-probe-contract";

import {PROJECT_LIMIT_DEFAULTS} from "./config";
import {ServerAssemblyError, startServer} from "./start";
import {manifestServerPlugins} from "./plugins";
import {helloFrame, openRawRpcSocket, upgradeStatus} from "./testing/rpc-client";
import {createRemoteProbePlugin, createTestPlugin, newRemoteProbeState, routePlugin} from "./testing/test-plugins";

const FIXTURE = join(import.meta.dir, "testing", "fixture-entry.ts");
const MAIN = join(import.meta.dir, "main.ts");

let tmpRoot = "";
let sequence = 0;

beforeAll(async () => {
    tmpRoot = await createTestTmpRoot("neuro-book-server", "server-host");
});

afterAll(async () => {
    if (tmpRoot !== "") await rm(tmpRoot, {recursive: true, force: true});
});

type Exit = {readonly code: number | null; readonly signal: string | null};

interface Spawned {
    readonly stateRoot: string;
    readonly url: Promise<string>;
    readonly rpcUrl: Promise<string>;
    /** `test.slow` 的放手通道地址（见 `testing/test-plugins.ts`）。 */
    readonly control: Promise<string>;
    readonly exit: Promise<Exit>;
    readonly stderr: () => string;
    stdin(text: string): void;
    signal(name: NodeJS.Signals): void;
}

function spawnServer(options: {readonly plugins?: string[]; readonly entry?: string; readonly env?: Record<string, string>} = {}): Spawned {
    sequence += 1;
    const stateRoot = join(tmpRoot, `state-${String(sequence)}`);
    const child = Bun.spawn(["bun", options.entry ?? FIXTURE, "--stop-stdin"], {
        env: {...process.env, NBOOK_STATE_ROOT: stateRoot, NBOOK_PORT: "0", NBOOK_TEST_PLUGINS: (options.plugins ?? []).join(","), ...options.env},
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
    });
    const listening = Promise.withResolvers<string>();
    const rpcListening = Promise.withResolvers<string>();
    const control = Promise.withResolvers<string>();
    // 多数用例不读这几个地址（启动失败的用例都不读）；不让拒绝变成未处理的 Promise 拒绝。
    listening.promise.catch(() => undefined);
    rpcListening.promise.catch(() => undefined);
    control.promise.catch(() => undefined);
    let stderr = "";
    void (async () => {
        let stdout = "";
        for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
            stdout += chunk;
            const url = /Listening on (\S+)/u.exec(stdout);
            if (url) listening.resolve(url[1] as string);
            const rpcUrl = /RPC listening on (\S+)/u.exec(stdout);
            if (rpcUrl) rpcListening.resolve(rpcUrl[1] as string);
            const release = /Test control on (\S+)/u.exec(stdout);
            if (release) control.resolve(release[1] as string);
        }
        listening.reject(new Error(`子进程未开始监听；stderr：${stderr}`));
        rpcListening.reject(new Error(`子进程未开始监听 RPC 端口；stderr：${stderr}`));
        control.reject(new Error("子进程没有打印放手通道"));
    })();
    void (async () => {
        for await (const chunk of child.stderr.pipeThrough(new TextDecoderStream())) stderr += chunk;
    })();
    const exit = child.exited.then(() => ({code: child.exitCode, signal: child.signalCode}));
    return {
        stateRoot,
        url: listening.promise,
        rpcUrl: rpcListening.promise,
        control: control.promise,
        exit,
        stderr: () => stderr,
        stdin: (text) => {
            child.stdin.write(text);
            child.stdin.flush();
        },
        signal: (name) => child.kill(name),
    };
}

type LogLine = {event: string; level: string; data?: {plugin?: string; stage?: string; reason?: string}};

async function readLog(stateRoot: string): Promise<LogLine[]> {
    const text = await readFile(join(stateRoot, "logs", "server-current.jsonl"), "utf8");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as LogLine);
}

/** 停止请求经信号或标准输入异步送达；查 health 直到 503，确认子进程已进入排空。 */
function untilStopping(url: string): Promise<Response> {
    return waitUntil("子进程进入排空，health 返回 503", async () => {
        const response = await fetch(`${url}api/runtime/health`);
        if (response.status === 503) return response;
        await response.body?.cancel();
        return null;
    });
}

/**
 * 日志里插件发布与关闭完成的顺序。诊断插件自己的“关闭完成”发生在它的出口关闭之后，写不进自己的
 * 日志文件；它最后关闭由进程以 0 退出（关闭结果为 closed）与其余插件都先于它关闭共同说明。
 */
function pluginOrder(lines: LogLine[], stage: "publish" | "close"): string[] {
    const reason = stage === "publish" ? "published" : "closed";
    return lines
        .filter((line) => line.event === "plugins.diagnostic" && line.data?.stage === stage && line.data.reason === reason)
        .map((line) => line.data?.plugin as string);
}

describe("后端宿主（真实子进程）", () => {
    it("启动后 health 返回 200、RPC 端口接受升级，诊断先于其余插件激活；标准输入 stop 后依赖逆序关闭并以 0 退出，RPC 端口随之关闭", async () => {
        const server = spawnServer();
        const url = await server.url;
        const health = await fetch(`${url}api/runtime/health`);
        expect(health.status).toBe(200);
        expect(await health.json()).toEqual({status: "ok"});
        const rpcPort = Number(new URL(await server.rpcUrl).port);
        expect(await upgradeStatus(rpcPort, {origin: url.replace(/\/$/u, "")})).toBe(101);
        server.stdin("stop\n");
        expect(await server.exit).toEqual({code: 0, signal: null});
        expect(await upgradeStatus(rpcPort).then(() => "accepted", () => "refused")).toBe("refused");
        const log = await readLog(server.stateRoot);
        // http、命令系统、Storage 与项目管理界面都只依赖诊断（项目管理界面另依赖宿主能力），它们之间没有先后。
        const published = pluginOrder(log, "publish");
        expect(published[0]).toBe("nbook.diagnostics");
        expect(published.slice(1).sort()).toEqual(["nbook.commands", "nbook.http", "nbook.projects", "nbook.storage"]);
        expect(pluginOrder(log, "close").sort()).toEqual(["nbook.commands", "nbook.http", "nbook.projects", "nbook.storage"]);
    }, 20_000);

    for (const stop of ["SIGTERM", "stdin"] as const) {
        it(`${stop} 停止：在途长请求完成，新请求得到 503，以 0 退出`, async () => {
            const server = spawnServer({plugins: ["test.slow"]});
            const url = await server.url;
            // 响应头已到：长请求已被接纳、正文还在等测试放手。
            const long = await fetch(`${url}api/test.slow/hold`);
            expect(long.status).toBe(200);
            let longDone = false;
            const longText = long.text().finally(() => {
                longDone = true;
            });
            if (stop === "SIGTERM") server.signal("SIGTERM");
            else server.stdin("stop\n");
            const rejected = await untilStopping(url);
            expect(await rejected.json()).toMatchObject({error: {code: "stopping"}});
            expect(longDone).toBe(false);
            await fetch(await server.control);
            expect(await longText).toBe("started\nreleased");
            expect(await server.exit).toEqual({code: 0, signal: null});
            expect(pluginOrder(await readLog(server.stateRoot), "close").sort()).toEqual(["nbook.commands", "nbook.http", "nbook.projects", "nbook.storage", "test.slow"]);
        }, 20_000);
    }

    it("必需插件激活失败：写出致命诊断，以 1 退出", async () => {
        const server = spawnServer({plugins: ["test.fail-activate"]});
        expect(await server.exit).toEqual({code: 1, signal: null});
        expect(server.stderr()).toContain("runtime.startup.failed");
        expect(server.stderr()).toContain("test.fail-activate");
    }, 20_000);

    it("一个插件关闭失败：其余插件仍关闭，以 1 退出", async () => {
        const server = spawnServer({plugins: ["test.fail-close"]});
        await server.url;
        server.stdin("stop\n");
        expect(await server.exit).toEqual({code: 1, signal: null});
        expect(server.stderr()).toContain("runtime.stop.incomplete");
        const closed = pluginOrder(await readLog(server.stateRoot), "close");
        expect(closed).toContain("nbook.http");
        expect(closed).not.toContain("test.fail-close");
    }, 20_000);

    it("未捕获异常：记录致命诊断后有序停止，以 1 退出", async () => {
        const server = spawnServer({plugins: ["test.throw-later"]});
        const url = await server.url;
        expect(await (await fetch(`${url}api/test.throw-later/throw`)).text()).toBe("scheduled");
        expect(await server.exit).toEqual({code: 1, signal: null});
        expect(server.stderr()).toContain("process.uncaught-exception");
        expect(pluginOrder(await readLog(server.stateRoot), "close").sort()).toEqual(["nbook.commands", "nbook.http", "nbook.projects", "nbook.storage", "test.throw-later"]);
    }, 20_000);

    it("未处理的 Promise 拒绝：记录致命诊断后有序停止，以 1 退出", async () => {
        const server = spawnServer({plugins: ["test.throw-later"]});
        const url = await server.url;
        expect(await (await fetch(`${url}api/test.throw-later/reject`)).text()).toBe("scheduled");
        expect(await server.exit).toEqual({code: 1, signal: null});
        expect(server.stderr()).toContain("process.unhandled-rejection");
        expect(pluginOrder(await readLog(server.stateRoot), "close").sort()).toEqual(["nbook.commands", "nbook.http", "nbook.projects", "nbook.storage", "test.throw-later"]);
    }, 20_000);

    it("标准输入关闭（父进程不在）也触发有序停止", async () => {
        sequence += 1;
        const stateRoot = join(tmpRoot, `state-${String(sequence)}`);
        const child = Bun.spawn(["bun", FIXTURE, "--stop-stdin"], {
            env: {...process.env, NBOOK_STATE_ROOT: stateRoot, NBOOK_PORT: "0", NBOOK_TEST_PLUGINS: ""},
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
        let out = "";
        while (!out.includes("Listening on")) {
            const chunk = await reader.read();
            if (chunk.done) break;
            out += chunk.value;
        }
        await child.stdin.end();
        await child.exited;
        expect(child.exitCode).toBe(0);
    }, 20_000);

    it("产品入口拒绝在非回环地址上监听，以 1 退出", async () => {
        const server = spawnServer({entry: MAIN, env: {NBOOK_HOST: "0.0.0.0"}});
        expect(await server.exit).toEqual({code: 1, signal: null});
        expect(server.stderr()).toContain("non-loopback-host");
    }, 20_000);
});

describe("后端宿主（同进程）", () => {
    const config = (name: string) => ({host: "127.0.0.1", port: 0, stateRoot: join(tmpRoot, name), logDirectory: join(tmpRoot, name, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, allowedOrigins: [], projects: PROJECT_LIMIT_DEFAULTS});

    it("两个插件同时提交 http.routes：各自挂在自己的前缀下", async () => {
        const ping = (reply: string) => () => new Hono<{Bindings: HttpRouteEnv}>().get("/ping", (c) => c.text(reply));
        const server = startServer({
            config: config("two-routes"),
            plugins: (context) => [...manifestServerPlugins(context), routePlugin("test.ping-a", ping("a")), routePlugin("test.ping-b", ping("b"))],
            process: new EventEmitter(),
            writeFatal: () => undefined,
        });
        await server.ready;
        expect(await (await fetch(`${server.url}api/test.ping-a/ping`)).text()).toBe("a");
        expect(await (await fetch(`${server.url}api/test.ping-b/ping`)).text()).toBe("b");
        server.requestStop("test:done");
        expect((await server.stopped).exitCode).toBe(0);
    });

    it("在途请求超过排空上限：继续关闭其余插件，以 1 退出", async () => {
        const scheduled = Promise.withResolvers<() => void>();
        const hold = Promise.withResolvers<void>();
        const fatalLines: string[] = [];
        const server = startServer({
            config: config("drain-timeout"),
            plugins: (context) => [...manifestServerPlugins(context), createTestPlugin("test.slow", hold.promise)],
            process: new EventEmitter(),
            clock: {schedule: (task) => {
                scheduled.resolve(task);
                return () => undefined;
            }},
            writeFatal: (line) => fatalLines.push(line),
        });
        await server.ready;
        const held = await fetch(`${server.url}api/test.slow/hold`);
        expect(held.status).toBe(200);
        const heldBody = held.text().then(() => "completed", () => "cut");
        server.requestStop("test:stop");
        (await scheduled.promise)();
        const outcome = await server.stopped;
        expect(outcome.exitCode).toBe(1);
        expect(outcome.result.status).toBe("closed");
        expect(fatalLines.join("")).toContain("runtime.stop.incomplete");
        // 超时后监听被强制关闭，长请求的正文没有发完。
        hold.resolve();
        expect(await heldBody).toBe("cut");
    }, 20_000);

    it("启动失败：等待就绪的请求得到 503 startup-failed，以 1 退出", async () => {
        const hold = Promise.withResolvers<void>();
        const listening = Promise.withResolvers<string>();
        const captured: {admission?: HttpAdmission} = {};
        const server = startServer({
            config: config("startup-failed"),
            plugins: (context) => {
                captured.admission = context.admission;
                return [...manifestServerPlugins(context), createTestPlugin("test.fail-activate", hold.promise)];
            },
            process: new EventEmitter(),
            onListening: listening.resolve,
            writeFatal: () => undefined,
        });
        server.ready.catch(() => undefined);
        const waiting = fetch(`${await listening.promise}api/runtime/health`);
        await waitUntil("请求进入等待就绪", () => captured.admission?.active === 1);
        hold.resolve();
        const response = await waiting;
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({error: {code: "startup-failed"}});
        expect((await server.stopped).exitCode).toBe(1);
    }, 20_000);

    it("未处理异常经宿主汇合为一次停止，以 1 退出；停止结算后挂接的进程监听全部移除", async () => {
        const events = new EventEmitter();
        const fatalLines: string[] = [];
        const server = startServer({config: config("fatal"), process: events, writeFatal: (line) => fatalLines.push(line)});
        await server.ready;
        expect(events.eventNames().sort()).toEqual(["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"]);
        events.emit("unhandledRejection", new Error("注入的未处理拒绝"));
        events.emit("uncaughtException", new Error("停止中又一个异常"));
        const outcome = await server.stopped;
        expect(outcome.exitCode).toBe(1);
        expect(outcome.result.status).toBe("closed");
        expect(fatalLines.join("")).toContain("process.unhandled-rejection");
        expect(events.eventNames()).toEqual([]);
    }, 20_000);

    it("前端构建目录缺少 index.html：http 入口激活失败，以 1 退出", async () => {
        const webRoot = join(tmpRoot, "web-without-index");
        await mkdir(webRoot, {recursive: true});
        const fatalLines: string[] = [];
        const server = startServer({config: {...config("no-index"), webRoot}, process: new EventEmitter(), writeFatal: (line) => fatalLines.push(line)});
        server.ready.catch(() => undefined);
        expect((await server.stopped).exitCode).toBe(1);
        expect(fatalLines.join("")).toContain("runtime.startup.failed");
        // 具体原因（而不只是失败的入口）要出现在致命通道里，否则运维看不出该修什么。
        expect(fatalLines.join("")).toContain("缺少 index.html");
    }, 20_000);

    it("插件装配失败：同步写出致命诊断并抛 ServerAssemblyError，已开的 RPC 监听随之关闭", async () => {
        const fatalLines: string[] = [];
        const failure = new Error("工厂抛错");
        const probePort = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response()});
        const rpcPort = probePort.port!;
        await probePort.stop(true);
        expect(() => startServer({
            config: {...config("assembly"), rpcPort},
            plugins: () => {
                throw failure;
            },
            process: new EventEmitter(),
            writeFatal: (line) => fatalLines.push(line),
        })).toThrow(ServerAssemblyError);
        expect(fatalLines).toHaveLength(1);
        expect(fatalLines[0]).toContain("runtime.startup.failed");
        expect(fatalLines[0]).toContain("工厂抛错");
        expect(await upgradeStatus(rpcPort).then(() => "accepted", () => "refused")).toBe("refused");
    });
});

describe("后端宿主的 RPC 端口（同进程，Spec server-host 场景 12、13）", () => {
    const config = (name: string) => ({host: "127.0.0.1", port: 0, stateRoot: join(tmpRoot, name), logDirectory: join(tmpRoot, name, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, allowedOrigins: [], projects: PROJECT_LIMIT_DEFAULTS});
    const tui = {id: "tui-1", kind: "tui", role: "client" as const, project: null, client: null};
    const holdRequest = (id: string, name: string): unknown => ({
        type: "request",
        id,
        target: "server",
        contract: remoteProbeContract.id,
        version: remoteProbeContract.version,
        method: "hold",
        effect: "write",
        input: {name},
        $nbConsumer: {instanceId: tui.id, location: "tui", client: null, plugin: null, entry: null, generation: null, via: null},
        $nbChain: [],
    });

    it("允许的来源：HTTP 端口在三个回环别名上的来源与 NBOOK_ALLOWED_ORIGINS 放行，其它来源 403", async () => {
        const server = startServer({config: {...config("rpc-origins"), allowedOrigins: ["http://127.0.0.1:5999"]}, process: new EventEmitter(), writeFatal: () => undefined});
        await server.ready;
        const rpcPort = Number(new URL(server.rpcUrl).port);
        const httpPort = new URL(server.url!).port;
        // 比较前按 URL 规范化：主机名大小写不同的同一来源照样放行。
        for (const origin of [`http://127.0.0.1:${httpPort}`, `http://localhost:${httpPort}`, `http://[::1]:${httpPort}`, `http://LOCALHOST:${httpPort}`, "http://127.0.0.1:5999"]) {
            expect(await upgradeStatus(rpcPort, {origin}), origin).toBe(101);
        }
        for (const origin of ["http://127.0.0.1:5998", `https://127.0.0.1:${httpPort}`, "http://evil.example", "null"]) {
            expect(await upgradeStatus(rpcPort, {origin}), origin).toBe(403);
        }
        server.requestStop("test:done");
        expect((await server.stopped).exitCode).toBe(0);
    }, 20_000);

    it("远程请求在途时停止：新升级得到 503，请求完成后插件才关闭；停止后 RPC 端口不再接受连接，以 0 退出", async () => {
        const probe = newRemoteProbeState();
        const server = startServer({config: config("rpc-stop"), plugins: (context) => [...manifestServerPlugins(context), createRemoteProbePlugin(probe)], process: new EventEmitter(), writeFatal: () => undefined});
        await server.ready;
        const rpcPort = Number(new URL(server.rpcUrl).port);
        const client = openRawRpcSocket(server.rpcUrl);
        await client.opened;
        client.send(helloFrame(tui));
        await client.next((frame) => frame.type === "welcome");
        client.send(holdRequest("r1", "long"));
        await client.next((frame) => frame.type === "ack" && frame.id === "r1");

        server.requestStop("test:stop");
        await waitUntil("RPC 端口停止接纳新升级", async () => (await upgradeStatus(rpcPort)) === 503);
        // 路由先停止接纳、再排空：已连接的客户端经原链路发来的新请求被拒，不会在排空期间被派发执行。
        client.send(holdRequest("r2", "late"));
        expect(await client.next((frame) => frame.type === "result" && frame.id === "r2")).toMatchObject({outcome: {ok: false, code: "unavailable", detail: "服务端正在停止"}});
        expect(probe.holds.has("late")).toBe(false);
        expect(probe.closed).toBe(false);
        probe.holds.get("long")!.release("finished");

        expect(await client.next((frame) => frame.type === "result" && frame.id === "r1")).toMatchObject({outcome: {ok: true, value: "finished"}});
        const outcome = await server.stopped;
        expect(probe.closed).toBe(true);
        expect(outcome.exitCode).toBe(0);
        await client.closed;
        expect(await upgradeStatus(rpcPort).then(() => "accepted", () => "refused")).toBe("refused");
    }, 20_000);

    it("RPC 排空超过上限：继续关闭插件，以 1 退出，失败记为 RPC 排空未完成", async () => {
        const probe = newRemoteProbeState();
        const timers = new Set<() => void>();
        const server = startServer({
            config: config("rpc-drain-timeout"),
            plugins: (context) => [...manifestServerPlugins(context), createRemoteProbePlugin(probe)],
            process: new EventEmitter(),
            clock: {schedule: (task) => {
                timers.add(task);
                return () => timers.delete(task);
            }},
            writeFatal: () => undefined,
        });
        await server.ready;
        const client = openRawRpcSocket(server.rpcUrl);
        await client.opened;
        client.send(helloFrame(tui));
        await client.next((frame) => frame.type === "welcome");
        client.send(holdRequest("r1", "never"));
        await client.next((frame) => frame.type === "ack");

        server.requestStop("test:stop");
        // HTTP 没有在途请求，它的排空立刻完成并撤销计时；剩下的是 RPC 排空的截止计时。
        const [deadline] = await waitUntil("只剩 RPC 排空的截止计时", () => (timers.size === 1 ? [...timers] : null));
        deadline!();

        const outcome = await server.stopped;
        expect(outcome.exitCode).toBe(1);
        expect(probe.closed).toBe(true);
        const drainFailure = (outcome.failures[0] as Error).cause as AggregateError;
        expect(drainFailure.errors.map((error: Error) => error.message)).toEqual(["RPC 排空未完成"]);
        // 截止后不再等那个请求：插件关闭、RPC 链路断开，客户端只能按断开结算它。
        await client.closed;
        expect(probe.holds.get("never")).toMatchObject({aborted: true, released: false});
    }, 20_000);

    it("启动失败：等待就绪的 RPC 升级得到 503 startup-failed，以 1 退出", async () => {
        const hold = Promise.withResolvers<void>();
        const captured: {admission?: HttpAdmission} = {};
        const server = startServer({
            config: config("rpc-startup-failed"),
            plugins: (context) => {
                captured.admission = context.admission;
                return [...manifestServerPlugins(context), createTestPlugin("test.fail-activate", hold.promise)];
            },
            process: new EventEmitter(),
            writeFatal: () => undefined,
        });
        server.ready.catch(() => undefined);
        const waiting = upgradeStatus(Number(new URL(server.rpcUrl).port));
        await waitUntil("升级进入等待就绪", () => captured.admission?.active === 1);
        hold.resolve();
        expect(await waiting).toBe(503);
        expect((await server.stopped).exitCode).toBe(1);
    }, 20_000);

    it("RPC 端口被占用：写出致命诊断并抛 ServerAssemblyError，不建立运行实例", () => {
        const occupant = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("occupied")});
        const fatalLines: string[] = [];
        try {
            expect(() => startServer({config: {...config("rpc-in-use"), rpcPort: occupant.port!}, process: new EventEmitter(), writeFatal: (line) => fatalLines.push(line)})).toThrow(ServerAssemblyError);
        } finally {
            void occupant.stop(true);
        }
        expect(fatalLines).toHaveLength(1);
        expect(fatalLines[0]).toContain("runtime.startup.failed");
        expect(fatalLines[0]).toContain("RPC");
    });
});
