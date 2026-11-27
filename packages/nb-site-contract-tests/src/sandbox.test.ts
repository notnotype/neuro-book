/**
 * 底座自己（`src/testing/process.ts`）：
 * - 收口：测试进程被取消时，它起的服务不能留下来接着占端口与库锁；测试运行器自己接住信号时（`handleSignals: false`），
 *   底座不抢在它的收尾之前杀子进程。这两组各起一个按路径运行的入口（`testing/cancel-entry.ts`、`testing/signal-entry.ts`），
 *   服务由入口经它自己的沙箱起，再从外面发信号，超出单个用例 200 毫秒的预算。
 * - 起子进程：程序起不来时报出原因；子进程不读标准输入就退出时，测试进程不因写不进去而崩。这几条用本文件的沙箱，
 *   被测程序换成 `sh` 这类一下就退出的命令，不起服务。
 */

import {describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {isListening, useSiteSandbox} from "./testing/site";

const sandbox = useSiteSandbox("sandbox.test.ts");

const PACKAGE_DIR = join(import.meta.dir, "..");
/** 按路径运行，不导入：导入会把它的用例登记进本文件。 */
const CANCEL_ENTRY = join(import.meta.dir, "testing", "cancel-entry.ts");
/** 与 `cancel-entry.ts` 里的同名常量一致。 */
const READY_PREFIX = "CANCEL_ENTRY_READY ";
/** 按路径用 `bun` 运行。下面两个常量与它里面的同名常量一致。 */
const SIGNAL_ENTRY = join(import.meta.dir, "testing", "signal-entry.ts");
const SIGNAL_READY_PREFIX = "SIGNAL_ENTRY_READY ";
const SIGNAL_GOT_PREFIX = "SIGNAL_ENTRY_GOT ";

interface EntryReady {
    readonly pid: number;
    readonly url: string;
    readonly root: string;
}

/** 进程号还在不在（含已退出、还没被回收的）。 */
function processExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
    }
}

/**
 * 进程正被结束时，连接可能先建上又被内核重置（`ECONNRESET`）：那一刻说不清还在不在监听，算 `closing`，调用方再查一次。
 */
async function listeningState(port: number): Promise<"listening" | "closing" | "closed"> {
    try {
        return (await isListening(port)) ? "listening" : "closed";
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ECONNRESET") return "closing";
        throw error;
    }
}

describe("测试进程被取消", () => {
    it.each(["SIGTERM", "SIGINT"] as const)("测试进程收到 %s 时，底座起的服务随之结束，测试进程仍按这个信号结束", async (signal) => {
        // 继承本进程的环境：`NB_SITE_SERVER_COMMAND` 指向别的实现时，里面那个测试进程起的也是它。
        const runner = Bun.spawn([process.execPath, "test", CANCEL_ENTRY], {cwd: PACKAGE_DIR, env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe"});
        let lines = "";
        const decoder = new TextDecoder();
        const reading = (async () => {
            for await (const chunk of runner.stdout) lines += decoder.decode(chunk, {stream: true});
        })();
        const stderr = new Response(runner.stderr).text();
        let ready: EntryReady | undefined;
        try {
            ready = await waitUntil(
                "the cancel entry reports its serving child",
                () => {
                    const line = lines.split("\n").find((candidate) => candidate.startsWith(READY_PREFIX));
                    if (line !== undefined) return JSON.parse(line.slice(READY_PREFIX.length)) as EntryReady;
                    if (runner.exitCode !== null) throw new Error(`the cancel entry exited with ${String(runner.exitCode)} before its child was ready\nstdout:\n${lines}`);
                    return undefined;
                },
                {timeoutMs: 20_000},
            );
            expect(await isListening(Number(new URL(ready.url).port))).toBe(true);

            runner.kill(signal);
            await runner.exited;
            expect({exitCode: runner.exitCode, signalCode: runner.signalCode}).toEqual({exitCode: null, signalCode: signal});
            // 处理函数只发 SIGKILL、不等它退出；端口在服务进程结束时关闭。
            const {port} = new URL(ready.url);
            await waitUntil("the serving child stops listening", async () => (await listeningState(Number(port))) === "closed", {timeoutMs: 5_000});
        } finally {
            if (runner.exitCode === null && runner.signalCode === null) runner.kill("SIGKILL");
            await runner.exited;
            // 这条用例失败时服务可能还在：按记下的进程号收掉。
            if (ready !== undefined && processExists(ready.pid)) process.kill(ready.pid, "SIGKILL");
            // 里面那个测试进程被信号结束，它的 afterAll 没跑，临时根要这里删。
            if (ready !== undefined) await rm(ready.root, {recursive: true, force: true});
            await reading;
            await stderr;
        }
    }, 30_000);
});

describe("测试运行器自己接住信号（handleSignals: false）", () => {
    it("测试进程收到 SIGINT 时不动它起的服务；之后照常收口，服务按 SIGTERM 干净退出", async () => {
        const runner = Bun.spawn([process.execPath, SIGNAL_ENTRY], {cwd: PACKAGE_DIR, env: process.env, stdin: "pipe", stdout: "pipe", stderr: "pipe"});
        let lines = "";
        const decoder = new TextDecoder();
        const reading = (async () => {
            for await (const chunk of runner.stdout) lines += decoder.decode(chunk, {stream: true});
        })();
        const stderr = new Response(runner.stderr).text();
        let ready: EntryReady | undefined;
        try {
            ready = await waitUntil(
                "the signal entry reports its serving child",
                () => {
                    const line = lines.split("\n").find((candidate) => candidate.startsWith(SIGNAL_READY_PREFIX));
                    if (line !== undefined) return JSON.parse(line.slice(SIGNAL_READY_PREFIX.length)) as EntryReady;
                    if (runner.exitCode !== null) throw new Error(`the signal entry exited with ${String(runner.exitCode)} before its child was ready\nstdout:\n${lines}`);
                    return undefined;
                },
                {timeoutMs: 20_000},
            );
            const port = Number(new URL(ready.url).port);

            runner.kill("SIGINT");
            // 入口自己的处理函数先登记：读到这一行时，同一次信号的其它处理函数都已经跑过。
            await waitUntil("the signal entry got SIGINT", () => lines.includes(`${SIGNAL_GOT_PREFIX}SIGINT`), {timeoutMs: 5_000});
            expect(await isListening(port)).toBe(true);

            runner.stdin.write("close\n");
            await runner.stdin.flush();
            await runner.exited;
            expect({exitCode: runner.exitCode, stderr: await stderr}).toEqual({exitCode: 0, stderr: ""});
            expect(await isListening(port)).toBe(false);
        } finally {
            if (runner.exitCode === null && runner.signalCode === null) runner.kill("SIGKILL");
            await runner.exited;
            if (ready !== undefined && processExists(ready.pid)) process.kill(ready.pid, "SIGKILL");
            if (ready !== undefined) await rm(ready.root, {recursive: true, force: true});
            await reading;
            await stderr;
        }
    }, 30_000);
});

describe("起子进程", () => {
    const MISSING = "/nonexistent/nb-site-contract-tests-no-such-program";

    it("程序不存在：start、run、spawnWithOpenStdin 都以带原因（ENOENT）的错误失败", async () => {
        const reasons = await Promise.all([
            sandbox.start({command: [MISSING]}).then(() => "started", (error: unknown) => (error as Error).cause),
            sandbox.run("serve", {command: [MISSING]}).then(() => "ran", (error: unknown) => (error as Error).cause),
            sandbox.spawnWithOpenStdin("create-admin", {command: [MISSING]}).then(() => "spawned", (error: unknown) => (error as Error).cause),
        ]);
        expect(reasons.map((cause) => (cause as NodeJS.ErrnoException | undefined)?.code)).toEqual(["ENOENT", "ENOENT", "ENOENT"]);
    });

    // 一兆字节远大于管道的缓冲（Linux 缺省 64 KB）：命令不读就退出，没写进去的部分一定撞上已关的管道（EPIPE）。
    const LONG_INPUT = "x".repeat(1 << 20);

    it("命令不读标准输入就退出：run 照常回它的退出码，测试进程不因写不进去而崩", async () => {
        const result = await sandbox.run("serve", {command: ["sh", "-c", "exit 2"], stdin: LONG_INPUT});
        expect(result.exitCode).toBe(2);
    });

    it("标准输入开着的命令已经退出：write 以“不再读标准输入”的错误 reject，测试进程不崩", async () => {
        const child = await sandbox.spawnWithOpenStdin("serve", {command: ["sh", "-c", "exit 3"]});
        expect((await child.result()).exitCode).toBe(3);
        await expect(child.write(LONG_INPUT)).rejects.toThrow("no longer reads its standard input");
    });
});
