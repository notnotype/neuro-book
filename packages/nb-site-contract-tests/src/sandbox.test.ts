/**
 * 底座自己的收口（`src/testing/site.ts` 的文件头）：测试进程被取消时，它起的服务不能留下来接着占端口与库锁。
 *
 * 这一条要起一个真的 `bun test` 进程、由它经沙箱起服务，再从外面取消它，超出单个用例 200 毫秒的预算；它不经沙箱起服务，
 * 所以本文件不调用 `useSiteSandbox`。
 */

import {describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {isListening} from "./testing/site";

const PACKAGE_DIR = join(import.meta.dir, "..");
/** 按路径运行，不导入：导入会把它的用例登记进本文件。 */
const CANCEL_ENTRY = join(import.meta.dir, "testing", "cancel-entry.ts");
/** 与 `cancel-entry.ts` 里的同名常量一致。 */
const READY_PREFIX = "CANCEL_ENTRY_READY ";

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
