/**
 * 桌面壳的流程（docs/specs/runtime/desktop-shell.md 输出 1 到 5、16 到 19、21、23）：真实的桌面锁与真实服务端（源码的产品入口）；
 * 停止卡住、重启中、停在启动中这几种情形用经产品认领档案认领的脚本入口（`testing/scripted-server.ts`）。窗口端口是替身：
 * `commitClose` 之后下一轮事件循环送 `closed`，页面的回答由测试送。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {existsSync} from "node:fs";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {queryNeuroBook} from "../server/instance";
import {PRODUCT_VERSION} from "../shared/product";
import {systemClock} from "./deadline";
import {acquireDesktopLock, askRunningShell} from "./lock";
import {DesktopShell, readUncleanStop} from "./shell";
import type {StartupView} from "./shell";
import type {CloseReason, WindowId, WindowPort} from "./windows";

const ENTRY = join(import.meta.dir, "..", "server", "main.ts");
const SCRIPTED = join(import.meta.dir, "testing", "scripted-server.ts");
let tmp = "";
let sequence = 0;
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-desktop", "shell");
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});
const nextRoot = () => join(tmp, `state-${String((sequence += 1))}`);

interface FakeShellOptions {
    readonly version?: string;
    /** 换成脚本入口（`SCRIPTED`）与它的环境变量。 */
    readonly entry?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly stopDeadlineMs?: number;
    /** 自有服务端意外退出时用户的选择；缺省“稍后”。 */
    readonly onServerExited?: "restart" | "later";
}

function fakeShell(stateRoot: string, options: FakeShellOptions = {}) {
    const views: StartupView[] = [];
    const loaded: Array<[WindowId, string]> = [];
    const asks: Array<[WindowId, number, CloseReason]> = [];
    const open = new Set<WindowId>();
    let nextId = 0;
    let exitCode: number | null = null;
    const events: string[] = [];
    let shell!: DesktopShell;
    const windows: WindowPort = {
        open() {
            nextId += 1;
            open.add(nextId);
            return nextId;
        },
        load: (id, url) => void loaded.push([id, url]),
        commitClose(id) {
            setImmediate(() => {
                open.delete(id);
                shell.windows.closed(id);
            });
        },
        askPage: (id, generation, reason) => void asks.push([id, generation, reason]),
        endAsk: () => undefined,
        showNotResponding: () => undefined,
        closeNotResponding: () => undefined,
    };
    shell = new DesktopShell({
        root: {ok: true, stateRoot, portable: false, source: "env"},
        version: options.version ?? PRODUCT_VERSION,
        server: {bun: process.execPath, entry: options.entry ?? ENTRY, webRoot: null, env: {...process.env, NBOOK_PORT: "0", NBOOK_RPC_PORT: "0", ...options.env}, stopDeadlineMs: options.stopDeadlineMs},
        ports: {
            windows,
            startupView: (view) => void views.push(view),
            askServerExited: () => Promise.resolve(options.onServerExited ?? "later"),
            tellRestartFailed: () => undefined,
            openPath: () => undefined,
            exit: (code) => {
                exitCode = code;
            },
        },
        clock: systemClock,
        report: (event) => void events.push(event),
    });
    /** 用户关一个窗口，页面接下并同意。 */
    const closeAndAllow = (id: WindowId) => {
        shell.windows.closeRequested(id);
        const ask = asks.filter((entry) => entry[0] === id).at(-1);
        if (ask === undefined) throw new Error("没有询问");
        shell.windows.pageAcked(id, ask[1]);
        shell.windows.pageAnswered(id, ask[1], "allow");
        return ask[2];
    };
    return {shell, views, loaded, asks, open, events, closeAndAllow, exitCode: () => exitCode};
}

/** 脚本入口在状态根上记下的各代（`testing/scripted-server.ts`）。 */
async function records(stateRoot: string, file: "targets.jsonl" | "stopped.jsonl"): Promise<Array<{generation: number; pid?: number; supervisor?: number}>> {
    const path = join(stateRoot, file);
    if (!existsSync(path)) return [];
    return (await readFile(path, "utf8")).split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as {generation: number; pid?: number; supervisor?: number});
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

describe("桌面壳的流程", () => {
    it("拉起自有服务端、窗口加载页面；关最后一个窗口以 quit 询问，同意后服务端有序停止、放锁、以 0 退出", async () => {
        const root = nextRoot();
        const a = fakeShell(root);
        void a.shell.run();
        await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 60_000, intervalMs: 50});
        expect((await queryNeuroBook(root)).state).toBe("running");
        expect(a.closeAndAllow(1)).toBe("quit");
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 60_000, intervalMs: 50});
        expect(a.exitCode()).toBe(0);
        expect((await queryNeuroBook(root)).state).toBe("none");
        expect(await readUncleanStop(root)).toBeNull();
        // 锁放下了：再取得到。
        const again = await acquireDesktopLock({stateRoot: root, report: () => undefined, onOpenWindow: () => ({ok: true})});
        expect(again.ok).toBe(true);
        if (again.ok) await again.claim.release();
    }, 90_000);

    it("同版本的壳在运行时再启动：后来者转交开窗、以 0 退出，不开自己的服务端；先来的多出一个窗口", async () => {
        const root = nextRoot();
        const a = fakeShell(root);
        void a.shell.run();
        await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 60_000, intervalMs: 50});
        const b = fakeShell(root);
        await b.shell.run();
        expect(b.exitCode()).toBe(0);
        expect(a.open.size).toBe(2);
        // 关掉 a 的两个窗口：第一个是 window，第二个是 quit。
        expect(a.closeAndAllow(1)).toBe("window");
        await waitUntil("第一个窗口关掉", () => !a.open.has(1));
        expect(a.closeAndAllow(2)).toBe("quit");
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 60_000, intervalMs: 50});
    }, 90_000);

    it("锁被不同版本的壳持有：启动页说明，只给退出；点退出后退出，不碰那个壳", async () => {
        const root = nextRoot();
        const other = await acquireDesktopLock({stateRoot: root, version: "0.0.1", report: () => undefined, onOpenWindow: () => ({ok: true})});
        if (!other.ok) throw new Error(other.reason);
        const b = fakeShell(root);
        const running = b.shell.run();
        await waitUntil("版本不同的说明", () => b.views.some((view) => view.kind === "error" && view.reason === "version-mismatch-shell"));
        expect(b.views.at(-1)).toMatchObject({kind: "error", detail: "0.0.1", actions: ["exit"]});
        b.shell.startupAction("exit");
        await running;
        expect(b.exitCode()).toBe(0);
        expect((await queryNeuroBook(root)).state).toBe("none");
        await other.claim.release();
    });

    it("启动中关掉启动页：启动作废，已经拉起的服务端停掉，放锁退出", async () => {
        const root = nextRoot();
        const a = fakeShell(root);
        void a.shell.run();
        await waitUntil("开始拉起服务端", () => a.views.some((view) => view.kind === "starting"), {timeoutMs: 30_000});
        a.shell.windows.closeRequested(1);
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 60_000, intervalMs: 50});
        expect(a.loaded).toEqual([]);
        await waitUntil("没有残留的服务端", async () => (await queryNeuroBook(root)).state === "none", {timeoutMs: 30_000, intervalMs: 100});
    }, 90_000);

    it("上次没有正常停止：启动页先说明，点继续后清掉记录、照常启动", async () => {
        const root = nextRoot();
        await mkdir(join(root, "logs", "desktop"), {recursive: true});
        await writeFile(join(root, "logs", "desktop", "unclean-stop.json"), "{}\n");
        const a = fakeShell(root);
        void a.shell.run();
        await waitUntil("说明上次没有正常停止", () => a.views.some((view) => view.kind === "unclean-stop"));
        a.shell.startupAction("continue");
        await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 60_000, intervalMs: 50});
        expect(await readUncleanStop(root)).toBeNull();
        a.closeAndAllow(1);
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 60_000, intervalMs: 50});
    }, 90_000);

    it("场景 5：另一个壳在确认关闭时点“退出”：新进程以 0 退出，之后不再转交、不再取锁或开窗", async () => {
        const root = nextRoot();
        const other = await acquireDesktopLock({stateRoot: root, report: () => undefined, onOpenWindow: () => ({ok: false, code: "closing"})});
        if (!other.ok) throw new Error(other.reason);
        try {
            const b = fakeShell(root);
            const running = b.shell.run();
            await waitUntil("正在确认关闭", () => b.views.some((view) => view.kind === "waiting-close"));
            b.shell.startupAction("exit");
            // run 交回说明取锁与重问的循环已经结束：之后那边取消关闭或放锁，这个进程都不会再来问、再取锁或开窗。
            await running;
            expect(b.exitCode()).toBe(0);
            expect(b.views.at(-1)).toEqual({kind: "waiting-close"});
        } finally {
            await other.claim.release();
        }
    });

    it.skipIf(process.platform === "win32")("监督进程停住、确认不了服务端已结束：壳停在停止中，不退出、不放锁；监督进程恢复、树结束后才记录、放锁、退出", async () => {
        const root = nextRoot();
        const a = fakeShell(root, {entry: SCRIPTED, env: {NBOOK_TEST_TARGET_STOP: "ignore"}, stopDeadlineMs: 100});
        void a.shell.run();
        await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 30_000, intervalMs: 50});
        const [target] = await records(root, "targets.jsonl");
        const supervisor = target?.supervisor ?? 0;
        const pid = target?.pid ?? 0;
        try {
            process.kill(supervisor, "SIGSTOP");
            expect(a.closeAndAllow(1)).toBe("quit");
            await waitUntil("owned-process 报告确认不了收口", () => a.events.includes("desktop.server.completion-failed"), {timeoutMs: 20_000, intervalMs: 50});
            expect(a.exitCode()).toBeNull();
            expect(await askRunningShell(root)).toEqual({kind: "stopping"});
            expect(alive(pid)).toBe(true);
            process.kill(supervisor, "SIGCONT");
            await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 20_000, intervalMs: 50});
            expect(alive(pid)).toBe(false);
            expect(await askRunningShell(root)).toEqual({kind: "lock-free"});
            expect(await readUncleanStop(root)).toMatchObject({forced: true});
        } finally {
            if (alive(supervisor)) process.kill(supervisor, "SIGCONT");
            if (alive(pid)) process.kill(-pid, "SIGKILL");
        }
    }, 60_000);

    it("自有服务端意外退出、重新启动还在拉起中时关掉最后一个窗口：以 quit 询问，第二代收到 stop、有序停止，壳以 0 退出", async () => {
        const root = nextRoot();
        const a = fakeShell(root, {entry: SCRIPTED, env: {NBOOK_TEST_TARGET_HOLD: "2"}, onServerExited: "restart"});
        void a.shell.run();
        await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 30_000, intervalMs: 50});
        const first = (await records(root, "targets.jsonl"))[0]?.pid ?? 0;
        let second = 0;
        try {
            process.kill(first, "SIGKILL");
            await waitUntil("第二代认领、停在启动中", async () => (await records(root, "targets.jsonl")).length === 2, {timeoutMs: 30_000, intervalMs: 50});
            second = (await records(root, "targets.jsonl"))[1]?.pid ?? 0;
            expect(await queryNeuroBook(root)).toMatchObject({state: "running", instance: {pid: second, status: "starting"}});
            expect(a.closeAndAllow(1)).toBe("quit");
            await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 30_000, intervalMs: 50});
            expect(a.exitCode()).toBe(0);
            expect(await records(root, "stopped.jsonl")).toEqual([{generation: 2}]);
            expect(alive(second)).toBe(false);
            expect((await queryNeuroBook(root)).state).toBe("none");
            expect(await readUncleanStop(root)).toBeNull();
        } finally {
            if (second !== 0 && alive(second)) process.kill(second, "SIGKILL");
        }
    }, 60_000);

    it("场景 14：启动中关掉启动页、自有服务端停止超时被强制结束：记“没有正常停止”，下一次启动先提示", async () => {
        const root = nextRoot();
        const a = fakeShell(root, {entry: SCRIPTED, env: {NBOOK_TEST_TARGET_STOP: "ignore", NBOOK_TEST_TARGET_HOLD: "1"}, stopDeadlineMs: 100});
        void a.shell.run();
        await waitUntil("自有服务端认领、停在启动中", async () => (await queryNeuroBook(root)).state === "running", {timeoutMs: 30_000, intervalMs: 50});
        a.shell.windows.closeRequested(1);
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 30_000, intervalMs: 50});
        expect(a.loaded).toEqual([]);
        expect((await queryNeuroBook(root)).state).toBe("none");
        expect(await readUncleanStop(root)).toMatchObject({forced: true});

        const b = fakeShell(root);
        const running = b.shell.run();
        await waitUntil("说明上次没有正常停止", () => b.views.length > 0);
        expect(b.views[0]?.kind).toBe("unclean-stop");
        b.shell.windows.closeRequested(1);
        await running;
        await waitUntil("壳退出", () => b.exitCode() !== null);
    }, 60_000);
});
