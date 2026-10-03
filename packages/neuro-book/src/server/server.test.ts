/**
 * runtime.server-host 的真实子进程验收：启动、启动失败、各停止来源、排空、关闭步骤隔离与退出码。
 * 子进程与产品入口走同一启动函数，测试插件只经清单注入；状态根放在测试临时根下。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startServer} from "./start";
import {productServerPlugins} from "./plugins";
import {createTestPlugin} from "./testing/test-plugins";

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
    // 启动失败的用例不读地址；不让这条拒绝变成未处理的 Promise 拒绝。
    listening.promise.catch(() => undefined);
    let stderr = "";
    void (async () => {
        let stdout = "";
        for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
            stdout += chunk;
            const match = /Listening on (\S+)/u.exec(stdout);
            if (match) listening.resolve(match[1] as string);
        }
        listening.reject(new Error(`子进程未开始监听；stderr：${stderr}`));
    })();
    void (async () => {
        for await (const chunk of child.stderr.pipeThrough(new TextDecoderStream())) stderr += chunk;
    })();
    const exit = child.exited.then(() => ({code: child.exitCode, signal: child.signalCode}));
    return {
        stateRoot,
        url: listening.promise,
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
            const long = fetch(`${url}api/test.slow/wait?ms=1500`).then(async (response) => ({status: response.status, text: await response.text()}));
            await Bun.sleep(200);
            if (stop === "SIGTERM") server.signal("SIGTERM");
            else server.stdin("stop\n");
            await Bun.sleep(200);
            const rejected = await fetch(`${url}api/runtime/health`);
            expect(rejected.status).toBe(503);
            expect(await rejected.json()).toMatchObject({error: {code: "stopping"}});
            expect(await long).toEqual({status: 200, text: "done"});
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
    it("在途请求超过排空上限：继续关闭其余插件，以 1 退出", async () => {
        let expire: (() => void) | null = null;
        const hold = Promise.withResolvers<void>();
        const events = new EventTarget();
        const processEvents = {
            on: (event: string, listener: (...args: unknown[]) => void) => events.addEventListener(event, () => listener()),
            off: () => undefined,
        };
        const fatalLines: string[] = [];
        const server = startServer({
            config: {host: "127.0.0.1", port: 0, stateRoot: join(tmpRoot, "in-process"), logDirectory: join(tmpRoot, "in-process", "logs"), stopStdin: false},
            plugins: (context) => [...productServerPlugins(context), createTestPlugin("test.slow", hold.promise)],
            process: processEvents,
            clock: {schedule: (task) => {
                expire = task;
                return () => undefined;
            }},
            writeFatal: (line) => fatalLines.push(line),
        });
        await server.ready;
        const held = fetch(`${server.url}api/test.slow/hold`).catch((error: unknown) => error);
        await Bun.sleep(100);
        server.requestStop("test:stop");
        await Bun.sleep(50);
        expect(expire).not.toBeNull();
        expire!();
        const outcome = await server.stopped;
        expect(outcome.exitCode).toBe(1);
        expect(outcome.result.status).toBe("closed");
        expect(fatalLines.join("")).toContain("runtime.stop.incomplete");
        hold.resolve();
        await held;
    }, 20_000);
});
