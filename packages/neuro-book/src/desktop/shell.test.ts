/**
 * 桌面壳的流程（docs/specs/runtime/desktop-shell.md 输出 1 到 5、16 到 19、21、23、28 到 31）：真实的桌面锁与真实服务端（源码的产品入口）；
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
import type {ShellUpdates, StartupView} from "./shell";
import type {TrayView, WorkCheck} from "./tray";
import {EMPTY_UPDATE_STATE, UPDATE_STATE_FILE, fileUpdateState} from "./update-install";
import type {ApplyResult, UpdaterPort, UpdateState} from "./update-install";
import type {CloseLastWindow} from "../shared/desktop-bridge";
import type {CloseReason, WindowId, WindowPort} from "./windows";

const ENTRY = join(import.meta.dir, "..", "server", "main.ts");
const SCRIPTED = join(import.meta.dir, "testing", "scripted-server.ts");
const HOLDER = join(import.meta.dir, "testing", "install-holder.ts");
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
    /** 自有服务端意外退出时用户的选择；缺省“稍后”；`hold` 是对话框一直开着。 */
    readonly onServerExited?: "restart" | "later" | "hold";
    /** 状态根从哪来；缺省 `env`（与更新无关的用例）。 */
    readonly source?: "env" | "portable" | "default";
    readonly updates?: ShellUpdates;
    readonly closeLastWindow?: CloseLastWindow;
    /** 适配层建不出托盘图标。 */
    readonly trayFails?: boolean;
    readonly runningWork?: (serverUrl: string) => Promise<WorkCheck>;
}

function fakeShell(stateRoot: string, options: FakeShellOptions = {}) {
    const views: StartupView[] = [];
    const loaded: Array<[WindowId, string]> = [];
    const asks: Array<[WindowId, number, CloseReason]> = [];
    const open = new Set<WindowId>();
    let nextId = 0;
    let exitCode: number | null = null;
    const events: string[] = [];
    /** 记录事实的诊断（`key=value` 的文字），按“事件 文字”记。 */
    const facts: string[] = [];
    /** 交给适配层的托盘视图、置前的窗口、“有工作在跑”对话框的显示与关闭（`close`），按先后记。 */
    const trays: TrayView[] = [];
    const focused: WindowId[] = [];
    const quitWork: Array<WorkCheck | "close"> = [];
    /** 每次服务端意外退出对话框的 `background`。 */
    const exitedAsks: boolean[] = [];
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
        sendHint: () => undefined,
        endHint: () => undefined,
    };
    shell = new DesktopShell({
        root: {ok: true, stateRoot, portable: options.source === "portable", source: options.source ?? "env"},
        version: options.version ?? PRODUCT_VERSION,
        server: {bun: process.execPath, entry: options.entry ?? ENTRY, webRoot: null, env: {...process.env, NBOOK_PORT: "0", NBOOK_RPC_PORT: "0", ...options.env}, stopDeadlineMs: options.stopDeadlineMs},
        ports: {
            windows,
            startupView: (view) => void views.push(view),
            askServerExited: (_code, _logDir, background) => {
                exitedAsks.push(background);
                const choice = options.onServerExited ?? "later";
                return choice === "hold" ? new Promise(() => undefined) : Promise.resolve(choice);
            },
            tellRestartFailed: () => undefined,
            openPath: () => undefined,
            setTray: (view) => void trays.push(view),
            trayShown: () => options.trayFails !== true && trays.at(-1)?.visible === true,
            focusWindow: (id) => void focused.push(id),
            showQuitWork: (work) => void quitWork.push(work),
            closeQuitWork: () => void quitWork.push("close"),
            exit: (code) => {
                exitCode = code;
            },
        },
        clock: systemClock,
        report: (event, detail) => {
            events.push(event);
            if (typeof detail === "string") facts.push(`${event} ${detail}`);
        },
        updates: options.updates,
        closeLastWindow: options.closeLastWindow,
        runningWork: options.runningWork,
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
    /** 开窗转交开的、托盘打开开的最近一个窗口。 */
    const newest = () => Math.max(...open);
    return {shell, views, loaded, asks, open, events, facts, trays, focused, quitWork, exitedAsks, closeAndAllow, newest, exitCode: () => exitCode};
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
        // 正向证据：就绪时记下服务端的 PID，经停止路径停完记下没有强制结束、退出码 0。
        expect(a.facts.filter((fact) => fact.startsWith("desktop.server."))).toEqual([expect.stringMatching(/^desktop\.server\.ready pid=\d+$/), "desktop.server.stopped forced=false exitCode=0"]);
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
            // 第一代意外退出有记录（它不经停止路径，也不写异常标记）；第二代经停止路径以 0 停完。
            expect(a.facts.filter((fact) => fact.startsWith("desktop.server."))).toEqual([`desktop.server.ready pid=${String(first)}`, expect.stringMatching(/^desktop\.server\.exited exitCode=/), "desktop.server.stopped forced=false exitCode=0"]);
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
        expect(a.facts).toContainEqual(expect.stringMatching(/^desktop\.server\.stopped forced=true exitCode=/));

        const b = fakeShell(root);
        const running = b.shell.run();
        await waitUntil("说明上次没有正常停止", () => b.views.length > 0);
        expect(b.views[0]?.kind).toBe("unclean-stop");
        b.shell.windows.closeRequested(1);
        await running;
        await waitUntil("壳退出", () => b.exitCode() !== null);
    }, 60_000);
});

describe("桌面壳的更新（desktop-update 输出 8 到 10）", () => {
    const A = {version: "0.90.1", hash: "hasha"};
    const B = {version: "0.90.2", hash: "hashb"};
    /** 更新器替身：检查一律失败（不打扰），换上的结果由用例给。 */
    const fakeUpdater = (apply: UpdaterPort["apply"] = () => Promise.resolve({failed: "not expected"})): UpdaterPort & {checks: () => number} => {
        let checks = 0;
        return {
            local: A,
            check: () => ((checks += 1), Promise.resolve({ok: false, error: "offline"})),
            download: () => Promise.resolve({ok: false, error: "not expected"}),
            apply,
            results: () => Promise.resolve([]),
            helperRunning: () => Promise.resolve(false),
            checks: () => checks,
        };
    };
    const channel = async () => {
        const path = join(tmp, `channel-${String((sequence += 1))}`);
        await mkdir(path, {recursive: true});
        return path;
    };
    const writeState = (channelRoot: string, state: UpdateState) => fileUpdateState(channelRoot, () => undefined).write(state);
    const stateText = async (channelRoot: string) => (existsSync(join(channelRoot, UPDATE_STATE_FILE)) ? await readFile(join(channelRoot, UPDATE_STATE_FILE), "utf8") : null);
    const scripted = {entry: SCRIPTED};

    it("有可换的、没人在用：取桌面锁之前显示“正在更新”并交给更新器，不取锁、不拉起服务端；退出请求在这段放行", async () => {
        const root = nextRoot();
        const channelRoot = await channel();
        await writeState(channelRoot, {...EMPTY_UPDATE_STATE, downloaded: B});
        let applied!: () => void;
        const applying = new Promise<void>((resolve) => (applied = resolve));
        const updater = fakeUpdater(() => {
            applied();
            return Promise.resolve("exiting");
        });
        const a = fakeShell(root, {...scripted, source: "default", updates: {updater, channelRoot, openDownloadPage: () => undefined}});
        expect(a.shell.acceptsQuit).toBe(true);
        const running = a.shell.run();
        await applying;
        await running;
        expect(a.views).toContainEqual({kind: "updating", version: B.version});
        expect(a.shell.acceptsQuit).toBe(true);
        expect((await askRunningShell(root)).kind).toBe("lock-free");
        expect((await queryNeuroBook(root)).state).toBe("none");
        expect(a.exitCode()).toBeNull();
    }, 30_000);

    it("取到桌面锁之后退出请求不再放行；运行中检查更新", async () => {
        const root = nextRoot();
        const channelRoot = await channel();
        const updater = fakeUpdater();
        const a = fakeShell(root, {...scripted, source: "default", updates: {updater, channelRoot, openDownloadPage: () => undefined}});
        void a.shell.run();
        await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 30_000, intervalMs: 20});
        expect(a.shell.acceptsQuit).toBe(false);
        await waitUntil("检查了一次", () => updater.checks() === 1);
        a.closeAndAllow(1);
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 30_000, intervalMs: 20});
    }, 60_000);

    it("别人持独占在发起换上：每秒重试；一直拿不到就报“另一个 NeuroBook 正在更新”，服务端与页面都没起来；持有者退出后“重试”就能启动", async () => {
        const root = nextRoot();
        const channelRoot = await channel();
        const child = Bun.spawn([process.execPath, HOLDER, channelRoot, "exclusive"], {stdin: "pipe", stdout: "pipe", stderr: "inherit"});
        try {
            const reader = child.stdout.getReader();
            expect(new TextDecoder().decode((await reader.read()).value).trim()).toBe("held");
            reader.releaseLock();
            const a = fakeShell(root, {...scripted, source: "env", updates: {updater: fakeUpdater(), channelRoot, openDownloadPage: () => undefined, installWaitMs: 1_200}});
            void a.shell.run();
            await waitUntil("启动错误", () => a.views.some((view) => view.kind === "error" && view.reason === "install-busy"), {timeoutMs: 10_000, intervalMs: 20});
            expect(a.views.at(-1)).toEqual({kind: "error", reason: "install-busy", detail: "", actions: ["retry", "exit"]});
            expect((await queryNeuroBook(root)).state).toBe("none");
            expect(a.loaded).toEqual([]);
            child.stdin.end();
            await child.exited;
            a.shell.startupAction("retry");
            await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 30_000, intervalMs: 20});
            a.closeAndAllow(1);
            await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 30_000, intervalMs: 20});
        } finally {
            child.kill();
        }
    }, 60_000);

    it("取锁后对账还在读结果时关掉启动页：等对账写完才放锁、退出，之后不建控制器、不检查", async () => {
        const root = nextRoot();
        const channelRoot = await channel();
        await writeState(channelRoot, {...EMPTY_UPDATE_STATE, downloaded: B, attempt: {version: B.version, hash: B.hash, from: A.hash, at: 0}});
        let answerResults!: (results: ReadonlyArray<ApplyResult>) => void;
        let asked = false;
        const updater = {...fakeUpdater(), results: () => ((asked = true), new Promise<ReadonlyArray<ApplyResult>>((resolve) => (answerResults = resolve)))};
        let checks = 0;
        updater.check = () => ((checks += 1), Promise.resolve({ok: false, error: "offline"}));
        const a = fakeShell(root, {...scripted, source: "default", updates: {updater, channelRoot, openDownloadPage: () => undefined}});
        void a.shell.run();
        await waitUntil("对账在读结果", () => asked, {timeoutMs: 10_000});
        a.shell.windows.closeRequested(1);
        await waitUntil("启动页关掉", () => a.open.size === 0);
        expect(a.exitCode()).toBeNull();
        expect((await askRunningShell(root)).kind).not.toBe("lock-free");
        answerResults([{version: B.version, hash: B.hash, success: false, phase: "swapping", modifiedAt: 1}]);
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 10_000});
        expect(JSON.parse((await stateText(channelRoot)) ?? "null")).toMatchObject({attempt: null, failed: [B.hash], pendingNotice: {kind: "update-failed"}});
        expect(a.shell.updates).toBeNull();
        expect(checks).toBe(0);
    }, 30_000);

    it("单写者：设了 NBOOK_STATE_ROOT 的壳与缺省状态根的壳共用一份安装，只有后者读写状态文件；退出后共享锁放下", async () => {
        const channelRoot = await channel();
        // 上一次换上已成功（本地就是目标）：缺省状态根的壳对账时会写回。
        await writeState(channelRoot, {...EMPTY_UPDATE_STATE, downloaded: {version: "0.90.1", hash: "hasha"}, attempt: {version: A.version, hash: A.hash, from: "hashz", at: 0}});
        const before = await stateText(channelRoot);
        const envShell = fakeShell(nextRoot(), {...scripted, source: "env", updates: {updater: fakeUpdater(), channelRoot, openDownloadPage: () => undefined}});
        void envShell.shell.run();
        await waitUntil("设了环境变量的壳加载了页面", () => envShell.loaded.length === 1, {timeoutMs: 30_000, intervalMs: 20});
        expect(await stateText(channelRoot)).toBe(before);
        const defaultShell = fakeShell(nextRoot(), {...scripted, source: "default", updates: {updater: fakeUpdater(), channelRoot, openDownloadPage: () => undefined}});
        void defaultShell.shell.run();
        await waitUntil("缺省状态根的壳加载了页面", () => defaultShell.loaded.length === 1, {timeoutMs: 30_000, intervalMs: 20});
        expect(JSON.parse((await stateText(channelRoot)) ?? "null")).toEqual({...EMPTY_UPDATE_STATE, pendingNotice: {kind: "updated", version: A.version, forHash: A.hash}});
        envShell.closeAndAllow(1);
        defaultShell.closeAndAllow(1);
        await waitUntil("两个壳都退出", () => envShell.exitCode() !== null && defaultShell.exitCode() !== null, {timeoutMs: 30_000, intervalMs: 20});
        const probe = Bun.spawn([process.execPath, HOLDER, channelRoot, "exclusive"], {stdin: "pipe", stdout: "pipe", stderr: "inherit"});
        const reader = probe.stdout.getReader();
        expect(new TextDecoder().decode((await reader.read()).value).trim()).toBe("held");
        probe.stdin.end();
        await probe.exited;
    }, 90_000);
});

describe("托盘与后台（输出 28 到 31）", () => {
    /** 托盘退出取在跑的工作的替身：每次调用排一个，由测试交回结果。 */
    function manualWork() {
        const pending: Array<(work: WorkCheck) => void> = [];
        return {
            runningWork: () => new Promise<WorkCheck>((resolve) => void pending.push(resolve)),
            calls: () => pending.length,
            answer: (work: WorkCheck) => pending.at(-1)?.(work),
        };
    }
    const lastTray = (a: ReturnType<typeof fakeShell>) => a.trays.at(-1);

    it("设置是 tray：关最后一个窗口以 window 询问、留在后台，服务端还在；托盘退出向真实服务端取到没有工作，有序停止、以 0 退出", async () => {
        const root = nextRoot();
        const a = fakeShell(root, {closeLastWindow: "tray"});
        void a.shell.run();
        await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 60_000, intervalMs: 50});
        expect(lastTray(a)).toEqual({visible: true, tooltip: "NeuroBook"});
        expect(a.closeAndAllow(1)).toBe("window");
        await waitUntil("窗口关掉", () => a.open.size === 0);
        expect(lastTray(a)).toEqual({visible: true, tooltip: "NeuroBook（在后台运行）"});
        expect((await queryNeuroBook(root)).state).toBe("running");
        expect(a.exitCode()).toBeNull();
        a.shell.trayQuit();
        expect(lastTray(a)).toEqual({visible: true, tooltip: "NeuroBook（正在检查在跑的工作）"});
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 60_000, intervalMs: 50});
        expect(a.exitCode()).toBe(0);
        expect(a.quitWork).toEqual([]);
        expect(lastTray(a)?.visible).toBe(false);
        expect(a.facts).toContain("desktop.server.stopped forced=false exitCode=0");
        expect((await queryNeuroBook(root)).state).toBe("none");
    }, 90_000);

    it("托盘退出遇到在跑的工作：取的过程中再点不理；对话框的取消、打开、仍然退出各走一遍，开出窗口时对话框关掉、退出作废", async () => {
        const root = nextRoot();
        const work = manualWork();
        const a = fakeShell(root, {entry: SCRIPTED, closeLastWindow: "tray", runningWork: work.runningWork});
        void a.shell.run();
        await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 30_000, intervalMs: 50});
        a.closeAndAllow(1);
        await waitUntil("进后台", () => a.open.size === 0);

        // 取消：对话框关掉，照旧在后台；对话框开着时再点“退出”把它置前（再显示一次）。
        a.shell.trayQuit();
        a.shell.trayQuit();
        expect(work.calls()).toBe(1);
        work.answer({count: 2, uncertain: false});
        await waitUntil("显示对话框", () => a.quitWork.length === 1);
        a.shell.trayQuit();
        expect(a.quitWork).toEqual([{count: 2, uncertain: false}, {count: 2, uncertain: false}]);
        a.shell.quitWorkChose("cancel");
        expect(a.quitWork.at(-1)).toBe("close");
        expect(lastTray(a)).toEqual({visible: true, tooltip: "NeuroBook（在后台运行）"});

        // 打开：取不到时也给对话框；点“打开 NeuroBook”开一个窗口，不退出。
        a.shell.trayQuit();
        work.answer({count: 0, uncertain: true});
        await waitUntil("显示对话框", () => a.quitWork.at(-1) !== "close");
        a.shell.quitWorkChose("open");
        expect(a.open.size).toBe(1);
        a.closeAndAllow(a.newest());
        await waitUntil("回到后台", () => a.open.size === 0);

        // 对话框开着时开窗转交开出了窗口：对话框关掉，之后的选择不理。
        a.shell.trayQuit();
        work.answer({count: 1, uncertain: false});
        await waitUntil("显示对话框", () => a.quitWork.at(-1) !== "close");
        expect(a.shell.windows.openWindowRequested()).toEqual({ok: true});
        expect(a.quitWork.at(-1)).toBe("close");
        a.shell.quitWorkChose("quit");
        expect(a.exitCode()).toBeNull();
        a.closeAndAllow(a.newest());
        await waitUntil("回到后台", () => a.open.size === 0);

        // 取的过程中点托盘“打开”：开出窗口，取回的“没有工作”不再用。
        a.shell.trayQuit();
        a.shell.trayOpen();
        expect(a.open.size).toBe(1);
        work.answer({count: 0, uncertain: false});
        await Bun.sleep(0);
        expect(a.exitCode()).toBeNull();
        expect(a.shell.windows.stopping).toBe(false);
        a.shell.trayOpen();
        expect(a.focused).toEqual([a.newest()]);
        a.closeAndAllow(a.newest());
        await waitUntil("回到后台", () => a.open.size === 0);

        // 仍然退出：有序停止、以 0 退出。
        a.shell.trayQuit();
        work.answer({count: 3, uncertain: true});
        await waitUntil("显示对话框", () => a.quitWork.at(-1) !== "close");
        a.shell.quitWorkChose("quit");
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 30_000, intervalMs: 50});
        expect(await records(root, "stopped.jsonl")).toEqual([{generation: 1}]);
    }, 60_000);

    it("取在跑的工作的过程中：开窗转交开出窗口则作废；服务端意外退出则取回后直接退出，不弹对话框", async () => {
        const root = nextRoot();
        const work = manualWork();
        const a = fakeShell(root, {entry: SCRIPTED, closeLastWindow: "tray", onServerExited: "hold", runningWork: work.runningWork});
        void a.shell.run();
        await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 30_000, intervalMs: 50});
        a.closeAndAllow(1);
        await waitUntil("进后台", () => a.open.size === 0);

        a.shell.trayQuit();
        expect(a.shell.windows.openWindowRequested()).toEqual({ok: true});
        expect(lastTray(a)).toEqual({visible: true, tooltip: "NeuroBook"});
        work.answer({count: 0, uncertain: false});
        await Bun.sleep(0);
        expect(a.shell.windows.stopping).toBe(false);
        a.closeAndAllow(a.newest());
        await waitUntil("回到后台", () => a.open.size === 0);

        a.shell.trayQuit();
        process.kill((await records(root, "targets.jsonl"))[0]?.pid ?? 0, "SIGKILL");
        await waitUntil("问用户", () => a.exitedAsks.length === 1, {timeoutMs: 30_000, intervalMs: 50});
        work.answer({count: 0, uncertain: true});
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 30_000, intervalMs: 50});
        expect(a.quitWork).toEqual([]);
    }, 60_000);

    it("后台时自有服务端意外退出：对话框说没有窗口；对话框开着时点托盘退出，不取工作、直接退出", async () => {
        const root = nextRoot();
        const work = manualWork();
        const a = fakeShell(root, {entry: SCRIPTED, closeLastWindow: "tray", onServerExited: "hold", runningWork: work.runningWork});
        void a.shell.run();
        await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 30_000, intervalMs: 50});
        a.closeAndAllow(1);
        await waitUntil("进后台", () => a.open.size === 0);
        process.kill((await records(root, "targets.jsonl"))[0]?.pid ?? 0, "SIGKILL");
        await waitUntil("问用户", () => a.exitedAsks.length === 1, {timeoutMs: 30_000, intervalMs: 50});
        expect(a.exitedAsks).toEqual([true]);
        expect(lastTray(a)?.visible).toBe(true);
        a.shell.trayQuit();
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 30_000, intervalMs: 50});
        expect(work.calls()).toBe(0);
    }, 60_000);

    it("后台时自有服务端意外退出：选“重新启动服务”后仍在后台，托盘退出停的是第二代；选“稍后”时壳退出", async () => {
        const restartRoot = nextRoot();
        const work = manualWork();
        const a = fakeShell(restartRoot, {entry: SCRIPTED, closeLastWindow: "tray", onServerExited: "restart", runningWork: work.runningWork});
        void a.shell.run();
        await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 30_000, intervalMs: 50});
        a.closeAndAllow(1);
        await waitUntil("进后台", () => a.open.size === 0);
        process.kill((await records(restartRoot, "targets.jsonl"))[0]?.pid ?? 0, "SIGKILL");
        await waitUntil("第二代就绪", () => a.facts.filter((fact) => fact.startsWith("desktop.server.ready")).length === 2, {timeoutMs: 30_000, intervalMs: 50});
        expect(a.exitCode()).toBeNull();
        expect(lastTray(a)).toEqual({visible: true, tooltip: "NeuroBook（在后台运行）"});
        a.shell.trayQuit();
        work.answer({count: 0, uncertain: false});
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 30_000, intervalMs: 50});
        expect(await records(restartRoot, "stopped.jsonl")).toEqual([{generation: 2}]);

        const laterRoot = nextRoot();
        const b = fakeShell(laterRoot, {entry: SCRIPTED, closeLastWindow: "tray", onServerExited: "later"});
        void b.shell.run();
        await waitUntil("窗口加载了页面", () => b.loaded.length === 1, {timeoutMs: 30_000, intervalMs: 50});
        b.closeAndAllow(1);
        await waitUntil("进后台", () => b.open.size === 0);
        process.kill((await records(laterRoot, "targets.jsonl"))[0]?.pid ?? 0, "SIGKILL");
        await waitUntil("壳退出", () => b.exitCode() !== null, {timeoutMs: 30_000, intervalMs: 50});
        expect(lastTray(b)?.visible).toBe(false);
    }, 90_000);

    it("设置是 tray 而托盘图标建不出来：关最后一个窗口以 quit 询问、停止；设置是 quit 时没有图标", async () => {
        const root = nextRoot();
        const a = fakeShell(root, {entry: SCRIPTED, closeLastWindow: "tray", trayFails: true});
        void a.shell.run();
        await waitUntil("窗口加载了页面", () => a.loaded.length === 1, {timeoutMs: 30_000, intervalMs: 50});
        a.shell.setCloseLastWindow("quit");
        expect(lastTray(a)?.visible).toBe(false);
        a.shell.setCloseLastWindow("tray");
        expect(a.closeAndAllow(1)).toBe("quit");
        await waitUntil("壳退出", () => a.exitCode() !== null, {timeoutMs: 30_000, intervalMs: 50});
    }, 60_000);
});
