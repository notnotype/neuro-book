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

import type {HttpAdmission} from "nbook/plugins/http/server/admission";
import type {HttpRouteEnv} from "nbook/plugins/http/server/contracts";

import {ServerAssemblyError, startServer} from "./start";
import {productServerPlugins} from "./plugins";
import {createTestPlugin, routePlugin} from "./testing/test-plugins";

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
    const control = Promise.withResolvers<string>();
    // 多数用例不读这两个地址（启动失败的用例两个都不读）；不让拒绝变成未处理的 Promise 拒绝。
    listening.promise.catch(() => undefined);
    control.promise.catch(() => undefined);
    let stderr = "";
    void (async () => {
        let stdout = "";
        for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
            stdout += chunk;
            const url = /Listening on (\S+)/u.exec(stdout);
            if (url) listening.resolve(url[1] as string);
            const release = /Test control on (\S+)/u.exec(stdout);
            if (release) control.resolve(release[1] as string);
        }
        listening.reject(new Error(`子进程未开始监听；stderr：${stderr}`));
        control.reject(new Error("子进程没有打印放手通道"));
    })();
    void (async () => {
        for await (const chunk of child.stderr.pipeThrough(new TextDecoderStream())) stderr += chunk;
    })();
    const exit = child.exited.then(() => ({code: child.exitCode, signal: child.signalCode}));
    return {
        stateRoot,
        url: listening.promise,
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
    it("启动后 health 返回 200，诊断先于 http 激活；标准输入 stop 后依赖逆序关闭并以 0 退出", async () => {
        const server = spawnServer();
        const url = await server.url;
        const health = await fetch(`${url}api/runtime/health`);
        expect(health.status).toBe(200);
        expect(await health.json()).toEqual({status: "ok"});
        server.stdin("stop\n");
        expect(await server.exit).toEqual({code: 0, signal: null});
        const log = await readLog(server.stateRoot);
        expect(pluginOrder(log, "publish")).toEqual(["nbook.diagnostics", "nbook.http"]);
        expect(pluginOrder(log, "close")).toEqual(["nbook.http"]);
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
            expect(pluginOrder(await readLog(server.stateRoot), "close").sort()).toEqual(["nbook.http", "test.slow"]);
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
        expect(pluginOrder(await readLog(server.stateRoot), "close").sort()).toEqual(["nbook.http", "test.throw-later"]);
    }, 20_000);

    it("未处理的 Promise 拒绝：记录致命诊断后有序停止，以 1 退出", async () => {
        const server = spawnServer({plugins: ["test.throw-later"]});
        const url = await server.url;
        expect(await (await fetch(`${url}api/test.throw-later/reject`)).text()).toBe("scheduled");
        expect(await server.exit).toEqual({code: 1, signal: null});
        expect(server.stderr()).toContain("process.unhandled-rejection");
        expect(pluginOrder(await readLog(server.stateRoot), "close").sort()).toEqual(["nbook.http", "test.throw-later"]);
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
    const config = (name: string) => ({host: "127.0.0.1", port: 0, stateRoot: join(tmpRoot, name), logDirectory: join(tmpRoot, name, "logs"), webRoot: null, stopStdin: false});

    it("两个插件同时提交 http.routes：各自挂在自己的前缀下", async () => {
        const ping = (reply: string) => () => new Hono<{Bindings: HttpRouteEnv}>().get("/ping", (c) => c.text(reply));
        const server = startServer({
            config: config("two-routes"),
            plugins: (context) => [...productServerPlugins(context), routePlugin("test.ping-a", ping("a")), routePlugin("test.ping-b", ping("b"))],
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
            plugins: (context) => [...productServerPlugins(context), createTestPlugin("test.slow", hold.promise)],
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
                return [...productServerPlugins(context), createTestPlugin("test.fail-activate", hold.promise)];
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

    it("插件装配失败：同步写出致命诊断并抛 ServerAssemblyError", () => {
        const fatalLines: string[] = [];
        const failure = new Error("工厂抛错");
        expect(() => startServer({
            config: config("assembly"),
            plugins: () => {
                throw failure;
            },
            process: new EventEmitter(),
            writeFatal: (line) => fatalLines.push(line),
        })).toThrow(ServerAssemblyError);
        expect(fatalLines).toHaveLength(1);
        expect(fatalLines[0]).toContain("runtime.startup.failed");
        expect(fatalLines[0]).toContain("工厂抛错");
    });
});
