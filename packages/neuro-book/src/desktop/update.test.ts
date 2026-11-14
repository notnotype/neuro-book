/**
 * 运行中的更新（docs/specs/runtime/desktop-update.md 输出 1 到 7、9、10，“状态与转换”）。更新器是替身，形状照适配层
 * （方法不抛错，失败按返回值交回；下载与检查由测试决定何时完成）；状态文件用内存里的端口（真实文件的读写在
 * `update-install.test.ts`）；时间用手动时钟。
 */

import {describe, expect, it} from "bun:test";
import {rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {UpdateChoice} from "../shared/desktop-bridge";
import type {DeadlineClock} from "./deadline";
import {CHECK_INTERVAL_MS, isNewer, isStableVersion, RECHECK_ATTEMPT_MS, UpdateController} from "./update";
import type {CurrentHint, UpdateMode} from "./update";
import {WindowCoordinator} from "./windows";
import {EMPTY_UPDATE_STATE, scanApplyResults} from "./update-install";
import type {ApplyResult, CheckResult, DownloadResult, UpdaterPort, UpdateState, UpdateTarget} from "./update-install";

const A = {version: "0.90.1", hash: "hash-a"};
const B = {version: "0.90.2", hash: "hash-b"};
const C = {version: "0.90.3", hash: "hash-c"};

/** 一个由测试控制完成时刻的调用。 */
interface Pending<T> {
    resolve(value: T): void;
}

function harness(options: {mode?: "auto" | "notify-only"; envRoot?: boolean; initial?: UpdateState; local?: UpdateTarget; results?: UpdaterPort["results"]; onHint?: (current: CurrentHint | null, endPrevious: boolean) => void} = {}) {
    let now = 1_000_000;
    const timers = new Set<{due: number; callback: () => void}>();
    const clock: DeadlineClock = {
        now: () => now,
        schedule(callback, ms) {
            const timer = {due: now + ms, callback};
            timers.add(timer);
            return () => void timers.delete(timer);
        },
    };
    const checks: Array<Pending<CheckResult>> = [];
    const downloads: Array<{target: UpdateTarget} & Pending<DownloadResult>> = [];
    let results: ReadonlyArray<ApplyResult> | null = [];
    let helper: boolean | null = false;
    const updater: UpdaterPort = {
        local: options.local ?? A,
        check: () => new Promise((resolve) => checks.push({resolve})),
        download: (target) => new Promise((resolve) => downloads.push({target, resolve})),
        apply: () => Promise.resolve({failed: "not used here"}),
        results: options.results ?? (() => Promise.resolve(results)),
        helperRunning: () => Promise.resolve(helper),
    };
    let written: UpdateState = options.initial ?? EMPTY_UPDATE_STATE;
    let failWrites = false;
    const writes: UpdateState[] = [];
    const statePort = {
        read: () => Promise.resolve(written),
        write(state: UpdateState) {
            if (failWrites) return Promise.reject(new Error("EACCES: read-only channel root"));
            written = state;
            writes.push(state);
            return Promise.resolve();
        },
    };
    const mode: UpdateMode = (options.mode ?? "auto") === "auto" ? {kind: "auto", state: statePort, initial: written} : {kind: "notify-only", envRoot: options.envRoot ?? false};
    const hints: Array<[CurrentHint | null, boolean]> = [];
    const events: string[] = [];
    let pagesOpened = 0;
    const controller = new UpdateController({
        mode,
        updater,
        clock,
        onHint: (current, endPrevious) => {
            hints.push([current, endPrevious]);
            options.onHint?.(current, endPrevious);
        },
        openDownloadPage: () => void (pagesOpened += 1),
        report: (event) => void events.push(event),
    });
    /** 让排队的异步步骤都走完。 */
    const settle = async () => {
        for (let index = 0; index < 20; index += 1) await Promise.resolve();
    };
    const advance = async (ms: number) => {
        now += ms;
        for (const timer of [...timers].sort((a, b) => a.due - b.due)) {
            if (timer.due <= now && timers.delete(timer)) timer.callback();
        }
        await settle();
    };
    /** 完成最早一个还在等的检查。 */
    const answerCheck = async (result: CheckResult) => {
        const pending = checks.shift();
        if (pending === undefined) throw new Error("no check is pending");
        pending.resolve(result);
        await settle();
    };
    const answerDownload = async (result: DownloadResult) => {
        const pending = downloads.shift();
        if (pending === undefined) throw new Error("no download is pending");
        pending.resolve(result);
        await settle();
    };
    const choose = async (choice: UpdateChoice, id = controller.current?.id ?? -1) => {
        controller.choose(id, choice);
        await settle();
    };
    const remote = (target: UpdateTarget): CheckResult => ({ok: true, ...target});
    return {
        controller,
        hints,
        events,
        checks,
        downloads,
        writes,
        state: () => written,
        pagesOpened: () => pagesOpened,
        setResults: (value: ReadonlyArray<ApplyResult> | null) => void (results = value),
        setHelper: (value: boolean | null) => void (helper = value),
        setFailWrites: (value: boolean) => void (failWrites = value),
        settle,
        advance,
        answerCheck,
        answerDownload,
        choose,
        remote,
        now: () => now,
    };
}

const kinds = (hints: Array<[CurrentHint | null, boolean]>) => hints.map(([current]) => (current === null ? null : `${current.hint.kind} ${current.hint.version}`));

describe("版本号", () => {
    it("只认严格的稳定版本号；构建元数据可有可无", () => {
        for (const good of ["0.90.2", "1.0.0", "10.20.30", "1.0.0+build.7"]) expect(isStableVersion(good)).toBe(true);
        for (const bad of ["2", "v2.0.0", "02.0.0", "1.0.0-beta.1", "1.0.0\n", " 1.0.0", "1.0", ""]) expect(isStableVersion(bad)).toBe(false);
        expect(isNewer("0.90.10", "0.90.9")).toBe(true);
        expect(isNewer("1.0.0+b", "1.0.0")).toBe(false);
    });
});

describe("更新控制器", () => {
    it("进入运行中检查一次、之后每 24 小时；检查失败与不合格的版本只写日志", async () => {
        const h = harness();
        h.controller.start();
        await h.settle();
        expect(h.checks).toHaveLength(1);
        await h.answerCheck({ok: false, error: "offline"});
        expect(h.events).toEqual(["desktop.update.check-failed"]);
        await h.advance(CHECK_INTERVAL_MS - 1);
        expect(h.checks).toHaveLength(0);
        await h.advance(1);
        expect(h.checks).toHaveLength(1);
        await h.answerCheck({ok: true, version: "v0.90.2", hash: "x"});
        expect(h.events).toEqual(["desktop.update.check-failed", "desktop.update.check-failed"]);
        expect(h.hints).toEqual([]);
    });

    it("只升不降：等于、低于本地都不提示（即使哈希不同），更高才提示“可以更新”", async () => {
        const h = harness({local: B});
        h.controller.start();
        await h.settle();
        await h.answerCheck(h.remote({version: B.version, hash: "other"}));
        await h.advance(CHECK_INTERVAL_MS);
        await h.answerCheck(h.remote(A));
        expect(h.hints).toEqual([]);
        await h.advance(CHECK_INTERVAL_MS);
        await h.answerCheck(h.remote(C));
        expect(kinds(h.hints)).toEqual(["available 0.90.3"]);
        // 同一份再查到：保持原样，不换 id、不重发。
        await h.advance(CHECK_INTERVAL_MS);
        await h.answerCheck(h.remote(C));
        expect(h.hints).toHaveLength(1);
    });

    it("进入停止中之后不再检查、不再提示、不收选择", async () => {
        const h = harness();
        h.controller.start();
        await h.settle();
        h.controller.stop();
        await h.answerCheck(h.remote(B));
        await h.advance(CHECK_INTERVAL_MS);
        expect(h.checks).toHaveLength(0);
        expect(h.hints).toEqual([]);
    });

    it("“以后”只压这个版本：这次运行不再提示 B，更高的 C 照常提示；关掉之后中心里的“下载”照样能点", async () => {
        const h = harness();
        h.controller.start();
        await h.settle();
        await h.answerCheck(h.remote(B));
        const b = h.controller.current?.id ?? -1;
        await h.choose("later", b);
        expect(h.hints.at(-1)).toEqual([null, false]);
        await h.advance(CHECK_INTERVAL_MS);
        await h.answerCheck(h.remote(B));
        expect(h.hints).toHaveLength(2);
        // 场景 7：通知中心里留下的“下载”。
        await h.choose("download", b);
        expect(h.checks).toHaveLength(1);
        await h.answerCheck(h.remote(B));
        expect(h.downloads.map((download) => download.target)).toEqual([B]);
        expect(kinds(h.hints).at(-1)).toBe("downloading 0.90.2");
    });

    it("“以后”之后更高的版本照常提示", async () => {
        const h = harness();
        h.controller.start();
        await h.settle();
        await h.answerCheck(h.remote(B));
        await h.choose("later");
        await h.advance(CHECK_INTERVAL_MS);
        await h.answerCheck(h.remote(C));
        expect(kinds(h.hints)).toEqual(["available 0.90.2", null, "available 0.90.3"]);
    });

    it("下载前重新检查：仍是同一份才下；下完写进已下载，通知“已下载”（一次性，显示后清掉）", async () => {
        const h = harness();
        h.controller.start();
        await h.settle();
        await h.answerCheck(h.remote(B));
        await h.choose("download");
        await h.answerCheck(h.remote(B));
        await h.choose("download");
        expect(h.downloads).toHaveLength(1);
        await h.answerDownload({ok: true});
        expect(h.state().downloaded).toEqual(B);
        expect(h.hints.slice(1)).toEqual([
            [{id: expect.any(Number), hint: {kind: "downloading", version: B.version}}, true],
            [{id: expect.any(Number), hint: {kind: "downloaded", version: B.version}}, true],
        ]);
        h.controller.shown(h.controller.current?.id ?? -1);
        expect(h.hints.at(-1)).toEqual([null, false]);
        // 已下载 B 之后只在高于 B 时提示。
        await h.advance(CHECK_INTERVAL_MS);
        await h.answerCheck(h.remote(B));
        expect(h.hints).toHaveLength(4);
    });

    it("下载前重新检查发现目标变了：更高的改提示新版本，降级了不下载", async () => {
        const moved = harness();
        moved.controller.start();
        await moved.settle();
        await moved.answerCheck(moved.remote(B));
        await moved.choose("download");
        await moved.answerCheck(moved.remote(C));
        expect(moved.downloads).toHaveLength(0);
        expect(kinds(moved.hints)).toEqual(["available 0.90.2", "available 0.90.3"]);
        expect(moved.hints.at(-1)?.[1]).toBe(true);

        const downgraded = harness();
        downgraded.controller.start();
        await downgraded.settle();
        await downgraded.answerCheck(downgraded.remote(B));
        await downgraded.choose("download");
        await downgraded.answerCheck(downgraded.remote(A));
        expect(downgraded.downloads).toHaveLength(0);
        expect(kinds(downgraded.hints)).toEqual(["available 0.90.2", null]);
    });

    it("下载失败后重新检查：远端已是更高的版本时提示它；仍是同一版本时给“重试”，重试再下", async () => {
        const moved = harness();
        moved.controller.start();
        await moved.settle();
        await moved.answerCheck(moved.remote(B));
        await moved.choose("download");
        await moved.answerCheck(moved.remote(B));
        await moved.answerDownload({ok: false, error: "hash mismatch"});
        await moved.answerCheck(moved.remote(C));
        expect(kinds(moved.hints).at(-1)).toBe("available 0.90.3");
        expect(moved.events).toContain("desktop.update.download-failed");

        const same = harness();
        same.controller.start();
        await same.settle();
        await same.answerCheck(same.remote(B));
        await same.choose("download");
        await same.answerCheck(same.remote(B));
        await same.answerDownload({ok: false, error: "network"});
        await same.answerCheck(same.remote(B));
        expect(kinds(same.hints).at(-1)).toBe("download-failed 0.90.2");
        await same.choose("retry");
        await same.answerCheck(same.remote(B));
        expect(same.downloads.map((download) => download.target)).toEqual([B]);
        await same.answerDownload({ok: true});
        expect(same.state().downloaded).toEqual(B);
    });

    it("已下载 B 之后选下载 C：开始前把 B 记为被取代；C 下载失败时没有可换的，B 也不再算基线", async () => {
        const h = harness({initial: {...EMPTY_UPDATE_STATE, downloaded: B}});
        h.controller.start();
        await h.settle();
        await h.answerCheck(h.remote(C));
        await h.choose("download");
        await h.answerCheck(h.remote(C));
        expect(h.state().superseded).toEqual([B.hash]);
        await h.answerDownload({ok: false, error: "network"});
        await h.answerCheck(h.remote(C));
        expect(kinds(h.hints).at(-1)).toBe("download-failed 0.90.3");
        // B 被取代后基线回到本地：远端是 B 也会提示。
        await h.choose("later");
        await h.advance(CHECK_INTERVAL_MS);
        await h.answerCheck(h.remote(B));
        expect(kinds(h.hints).at(-1)).toBe("available 0.90.2");
    });

    it("失败名单里的那份不算基线；明确重新下载并成功后从失败、被取代名单里移除", async () => {
        const h = harness({initial: {...EMPTY_UPDATE_STATE, downloaded: B, failed: [B.hash], superseded: [B.hash]}});
        h.controller.start();
        await h.settle();
        await h.answerCheck(h.remote(B));
        expect(kinds(h.hints)).toEqual(["available 0.90.2"]);
        await h.choose("download");
        await h.answerCheck(h.remote(B));
        await h.answerDownload({ok: true});
        expect(h.state()).toMatchObject({downloaded: B, failed: [], superseded: []});
    });

    it("下载失败时不解除失败名单", async () => {
        const h = harness({initial: {...EMPTY_UPDATE_STATE, downloaded: B, failed: [B.hash]}});
        h.controller.start();
        await h.settle();
        await h.answerCheck(h.remote(B));
        await h.choose("download");
        await h.answerCheck(h.remote(B));
        await h.answerDownload({ok: false, error: "network"});
        expect(h.state().failed).toEqual([B.hash]);
    });

    it("在途下载在 stop() 之后、close() 之前完成时写进已下载但不提示；close() 之后完成时丢掉", async () => {
        const kept = harness();
        kept.controller.start();
        await kept.settle();
        await kept.answerCheck(kept.remote(B));
        await kept.choose("download");
        await kept.answerCheck(kept.remote(B));
        kept.controller.stop();
        const before = kept.hints.length;
        await kept.answerDownload({ok: true});
        expect(kept.state().downloaded).toEqual(B);
        expect(kept.hints).toHaveLength(before);
        await kept.controller.close();

        const dropped = harness();
        dropped.controller.start();
        await dropped.settle();
        await dropped.answerCheck(dropped.remote(B));
        await dropped.choose("download");
        await dropped.answerCheck(dropped.remote(B));
        await dropped.controller.close();
        await dropped.answerDownload({ok: true});
        expect(dropped.state().downloaded).toBeNull();
    });

    it("选择只收最近那条提示的、这一种允许的：被新阶段取代的旧 id、不符的选择写诊断后忽略", async () => {
        const h = harness();
        h.controller.start();
        await h.settle();
        await h.answerCheck(h.remote(B));
        const old = h.controller.current?.id ?? -1;
        await h.advance(CHECK_INTERVAL_MS);
        await h.answerCheck(h.remote(C));
        await h.choose("download", old);
        expect(h.checks).toHaveLength(0);
        await h.choose("open-page");
        await h.choose("retry");
        expect(h.checks).toHaveLength(0);
        expect(h.events.filter((event) => event === "desktop.update.choice-ignored")).toHaveLength(3);
        // 正在下载的提示不收选择。
        await h.choose("download");
        await h.answerCheck(h.remote(C));
        await h.choose("later");
        expect(kinds(h.hints).at(-1)).toBe("downloading 0.90.3");
    });

    it("三种可关闭的提示关掉之后，中心里的动作仍被接受；被新阶段取代后同一动作被拒", async () => {
        const failed = harness();
        failed.controller.start();
        await failed.settle();
        await failed.answerCheck(failed.remote(B));
        await failed.choose("download");
        await failed.answerCheck(failed.remote(B));
        await failed.answerDownload({ok: false, error: "network"});
        await failed.answerCheck(failed.remote(B));
        const retryId = failed.controller.current?.id ?? -1;
        await failed.choose("later", retryId);
        await failed.choose("retry", retryId);
        expect(failed.checks).toHaveLength(1);
        await failed.answerCheck(failed.remote(B));
        expect(failed.downloads).toHaveLength(1);
        // 下载开始后“重试”所在的提示已被取代。
        await failed.choose("retry", retryId);
        expect(failed.events.at(-1)).toBe("desktop.update.choice-ignored");

        const notify = harness({mode: "notify-only"});
        notify.controller.start();
        await notify.settle();
        await notify.answerCheck(notify.remote(B));
        const pageId = notify.controller.current?.id ?? -1;
        await notify.choose("later", pageId);
        await notify.choose("open-page", pageId);
        expect(notify.pagesOpened()).toBe(1);
    });

    it("只提示的启动：只和本地版本比，提示“可以下载”，不下载；设了 NBOOK_STATE_ROOT 时带说明", async () => {
        const h = harness({mode: "notify-only", envRoot: true});
        h.controller.start();
        await h.settle();
        await h.answerCheck(h.remote(B));
        expect(h.hints).toEqual([[{id: expect.any(Number), hint: {kind: "notify-only", version: B.version, envRoot: true}}, true]]);
        await h.choose("download");
        expect(h.checks).toHaveLength(0);
        await h.choose("open-page");
        expect(h.pagesOpened()).toBe(1);
        expect(h.hints.at(-1)).toEqual([null, false]);

        const portable = harness({mode: "notify-only"});
        portable.controller.start();
        await portable.settle();
        await portable.answerCheck(portable.remote(B));
        expect(portable.hints[0]?.[0]?.hint).toEqual({kind: "notify-only", version: B.version});
    });

    it("待显示的通知先显示，检查到的提示排在它后面；显示之后从状态文件里清掉", async () => {
        const h = harness({local: B, initial: {...EMPTY_UPDATE_STATE, pendingNotice: {kind: "updated", version: B.version, forHash: B.hash}}});
        h.controller.start();
        await h.settle();
        expect(kinds(h.hints)).toEqual(["updated 0.90.2"]);
        await h.answerCheck(h.remote(C));
        expect(h.hints).toHaveLength(1);
        h.controller.shown(h.controller.current?.id ?? -1);
        await h.settle();
        expect(kinds(h.hints)).toEqual(["updated 0.90.2", "available 0.90.3"]);
        expect(h.hints.at(-1)?.[1]).toBe(false);
        expect(h.state().pendingNotice).toBeNull();
    });

    it("有未对账的换上时不检查；每 30 秒重判，出了失败的结果就在这次运行里通知“更新没有完成”并恢复检查", async () => {
        const attemptAt = 1_000_000 - 10_000;
        const h = harness({initial: {...EMPTY_UPDATE_STATE, downloaded: B, attempt: {version: B.version, hash: B.hash, from: A.hash, at: attemptAt}}});
        h.setHelper(true);
        h.controller.start();
        await h.settle();
        expect(h.checks).toHaveLength(0);
        await h.advance(RECHECK_ATTEMPT_MS);
        expect(h.checks).toHaveLength(0);
        expect(h.state().attempt).not.toBeNull();
        // 换上程序晚于产品窗口写出失败的结果、重新启动的旧版本被转交给这个壳。
        h.setHelper(false);
        h.setResults([{version: B.version, hash: B.hash, success: false, phase: "swap", modifiedAt: h.now()}]);
        await h.advance(RECHECK_ATTEMPT_MS);
        expect(h.state()).toMatchObject({attempt: null, failed: [B.hash], pendingNotice: {kind: "update-failed", version: B.version, forHash: A.hash}});
        expect(kinds(h.hints)).toEqual(["update-failed 0.90.2"]);
        expect(h.checks).toHaveLength(1);
        // 恢复检查后 B 在失败名单里，不算基线：查到 B 照常提示（排在一次性通知之后）。
        await h.answerCheck(h.remote(B));
        h.controller.shown(h.controller.current?.id ?? -1);
        await h.settle();
        expect(kinds(h.hints).at(-1)).toBe("available 0.90.2");
        expect(h.state().pendingNotice).toBeNull();
    });

    it("把已下载的那份记为被取代要写成功才下载：写不成时不下载，给“重试”", async () => {
        const h = harness({initial: {...EMPTY_UPDATE_STATE, downloaded: B}});
        h.controller.start();
        await h.settle();
        await h.answerCheck(h.remote(C));
        h.setFailWrites(true);
        await h.choose("download");
        await h.answerCheck(h.remote(C));
        expect(h.downloads).toHaveLength(0);
        expect(h.state()).toEqual({...EMPTY_UPDATE_STATE, downloaded: B});
        expect(kinds(h.hints).at(-1)).toBe("download-failed 0.90.3");
        expect(h.events).toContain("desktop.update.state-write-failed");
        h.setFailWrites(false);
        await h.choose("retry");
        await h.answerCheck(h.remote(C));
        expect(h.state().superseded).toEqual([B.hash]);
        expect(h.downloads).toHaveLength(1);
    });

    it("与窗口协调器合用：“以后”关掉的 B 在检查到 C 时从那个窗口的中心里收起", async () => {
        const calls: string[] = [];
        let coordinator!: WindowCoordinator;
        const h = harness({onHint: (current, endPrevious) => coordinator.setUpdateHint(current, endPrevious)});
        let nextId = 0;
        coordinator = new WindowCoordinator({
            port: {
                open: () => (nextId += 1),
                load: () => undefined,
                commitClose: () => undefined,
                askPage: () => undefined,
                endAsk: () => undefined,
                showNotResponding: () => undefined,
                closeNotResponding: () => undefined,
                sendHint: (id, hintId, hint) => void calls.push(`send ${String(id)} ${String(hintId)} ${hint.kind} ${hint.version}`),
                endHint: (id, hintId) => void calls.push(`end ${String(id)} ${String(hintId)}`),
            },
            clock: {now: () => 0, schedule: () => () => undefined},
            onQuit: () => undefined,
            onAllClosed: () => undefined,
        });
        coordinator.serverReady("http://127.0.0.1:4217/", true);
        const win = coordinator.openWindow();
        coordinator.pageReady(win);
        h.controller.start();
        await h.settle();
        await h.answerCheck(h.remote(B));
        await h.choose("later");
        await h.advance(CHECK_INTERVAL_MS);
        await h.answerCheck(h.remote(C));
        expect(calls).toEqual(["send 1 1 available 0.90.2", "end 1 1", "send 1 2 available 0.90.3"]);
    });

    it("真实的结果文件（Electrobun 2.0.6 的格式）驱动运行中重判：换上程序写出失败的结果后通知“更新没有完成”", async () => {
        const dir = await createTestTmpRoot("neuro-book-desktop", "update-results");
        try {
            const attemptAt = 1_000_000 - 10_000;
            const identity = {identifier: "dev.neurobook.test", channel: "stable"};
            const h = harness({
                local: {version: A.version, hash: "hasha"},
                initial: {...EMPTY_UPDATE_STATE, downloaded: {version: B.version, hash: "hashb"}, attempt: {version: B.version, hash: "hashb", from: "hasha", at: attemptAt}},
                results: () => scanApplyResults(dir, identity),
            });
            h.setHelper(false);
            h.controller.start();
            await h.settle();
            // 发起还不到 2 分钟、没有结果：进行中。
            await h.advance(RECHECK_ATTEMPT_MS);
            expect(h.state().attempt).not.toBeNull();
            const transaction = "0123456789abcdef0123456789abcdef";
            await writeFile(join(dir, `.electrobun-update-${transaction}.result.json`), JSON.stringify({schema_version: 1, transaction_id: transaction, success: false, phase: "swapping", message: "The process cannot access the file", identifier: identity.identifier, channel: identity.channel, version: B.version, hash: "hashb"}));
            await h.advance(RECHECK_ATTEMPT_MS);
            // 对账读的是真实文件，不只是微任务：等可观察的结果。
            await waitUntil("对账出终态", () => h.state().attempt === null);
            await waitUntil("发出通知", () => h.hints.length > 0);
            expect(h.state()).toMatchObject({attempt: null, failed: ["hashb"], pendingNotice: {kind: "update-failed", version: B.version}});
            expect(kinds(h.hints)).toEqual(["update-failed 0.90.2"]);
        } finally {
            await rm(dir, {recursive: true, force: true});
        }
    });
});
