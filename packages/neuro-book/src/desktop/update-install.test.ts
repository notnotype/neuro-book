/**
 * 安装级的更新状态与启动时换上（docs/specs/runtime/desktop-update.md 输出 7、8、9）：真实的状态文件、真实的 nb-flock，
 * “别的壳在用”“别的壳在发起换上”由另起的子进程持锁（`testing/install-holder.ts`）。更新器是替身；结果文件按 Electrobun 2.0.6
 * 的格式写成夹具。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, readFile, rm, utimes, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {Subprocess} from "bun";

import {systemClock} from "./deadline";
import {isNewer} from "./update";
import {ATTEMPT_GRACE_MS, EMPTY_UPDATE_STATE, UPDATE_STATE_FILE, acquireInstallUse, applyAtStartup, applyOutcome, fileUpdateState, reconcileAtStartup, scanApplyResults, settleAttempt} from "./update-install";
import type {ApplyResult, UpdaterPort, UpdateState} from "./update-install";

const HOLDER = join(import.meta.dir, "testing", "install-holder.ts");
const A = {version: "0.90.1", hash: "hasha"};
const B = {version: "0.90.2", hash: "hashb"};
const C = {version: "0.90.3", hash: "hashc"};
const IDENTITY = {identifier: "dev.neurobook.test", channel: "stable"};

let tmp = "";
let sequence = 0;
const children = new Set<Subprocess<"pipe", "pipe", "inherit">>();
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-desktop", "update-install");
});
afterEach(async () => {
    for (const child of children) {
        child.stdin.end();
        await child.exited;
    }
    children.clear();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function nextChannelRoot(): Promise<string> {
    sequence += 1;
    const root = join(tmp, `channel-${String(sequence)}`);
    await mkdir(root, {recursive: true});
    return root;
}

/** 另一个进程拿安装锁；交回它拿没拿到，拿到的一直持有到测试结束或 `release()`。 */
async function holder(channelRoot: string, mode: "shared" | "exclusive"): Promise<{held: boolean; release(): Promise<void>}> {
    const child = Bun.spawn([process.execPath, HOLDER, channelRoot, mode], {stdin: "pipe", stdout: "pipe", stderr: "inherit"});
    children.add(child);
    const reader = child.stdout.getReader();
    const {value} = await reader.read();
    reader.releaseLock();
    const held = new TextDecoder().decode(value).trim() === "held";
    return {
        held,
        async release() {
            child.stdin.end();
            await child.exited;
            children.delete(child);
        },
    };
}

const report = (events: string[]) => (event: string) => void events.push(event);

function updater(local = A, apply: UpdaterPort["apply"] = () => Promise.resolve({failed: "not expected"})): Pick<UpdaterPort, "local" | "apply"> {
    return {local, apply};
}

async function writeState(channelRoot: string, state: UpdateState): Promise<void> {
    await fileUpdateState(channelRoot, () => undefined).write(state);
}
const readState = (channelRoot: string) => fileUpdateState(channelRoot, () => undefined).read();

describe("启动时换上", () => {
    it("没有可换的（没下载、就是本地、在失败或被取代名单里、版本不高于本地）：不拿锁、不调更新器", async () => {
        for (const state of [
            EMPTY_UPDATE_STATE,
            {...EMPTY_UPDATE_STATE, downloaded: A},
            {...EMPTY_UPDATE_STATE, downloaded: B, failed: [B.hash]},
            {...EMPTY_UPDATE_STATE, downloaded: B, superseded: [B.hash]},
            {...EMPTY_UPDATE_STATE, downloaded: {version: A.version, hash: "other"}},
        ]) {
            const root = await nextChannelRoot();
            await writeState(root, state);
            let applied = false;
            const outcome = await applyAtStartup({channelRoot: root, updater: updater(A, () => ((applied = true), Promise.resolve("exiting"))), state: fileUpdateState(root, () => undefined), newer: isNewer, now: () => 0, onApplying: () => undefined, report: () => undefined});
            expect(outcome).toBe("continue");
            expect(applied).toBe(false);
        }
    });

    it("有别的壳在用（另一个进程持共享锁）：不换，已下载的保留", async () => {
        const root = await nextChannelRoot();
        await writeState(root, {...EMPTY_UPDATE_STATE, downloaded: B});
        expect((await holder(root, "shared")).held).toBe(true);
        let applied = false;
        const outcome = await applyAtStartup({channelRoot: root, updater: updater(A, () => ((applied = true), Promise.resolve("exiting"))), state: fileUpdateState(root, () => undefined), newer: isNewer, now: () => 0, onApplying: () => undefined, report: () => undefined});
        expect(outcome).toBe("continue");
        expect(applied).toBe(false);
        expect(await readState(root)).toEqual({...EMPTY_UPDATE_STATE, downloaded: B});
    });

    it("拿到独占之后重读状态：别的壳刚换过（已下载的没了）就不换，放下独占", async () => {
        const root = await nextChannelRoot();
        await writeState(root, {...EMPTY_UPDATE_STATE, downloaded: B});
        const real = fileUpdateState(root, () => undefined);
        let reads = 0;
        const state = {
            async read() {
                reads += 1;
                const value = await real.read();
                // 第一次读完、拿锁之前，别的壳换上并清掉了已下载的。
                if (reads === 1) await real.write({...value, downloaded: null});
                return value;
            },
            write: real.write,
        };
        let applied = false;
        const outcome = await applyAtStartup({channelRoot: root, updater: updater(A, () => ((applied = true), Promise.resolve("exiting"))), state, newer: isNewer, now: () => 0, onApplying: () => undefined, report: () => undefined});
        expect(outcome).toBe("continue");
        expect(applied).toBe(false);
        expect((await holder(root, "exclusive")).held).toBe(true);
    });

    it("取到独占：先写 attempt、显示“正在更新”，再交给更新器；在退出时独占一直持有", async () => {
        const root = await nextChannelRoot();
        await writeState(root, {...EMPTY_UPDATE_STATE, downloaded: B});
        const applying: string[] = [];
        let seenAtApply: UpdateState | null = null;
        const outcome = await applyAtStartup({
            channelRoot: root,
            updater: updater(A, async () => {
                seenAtApply = await readState(root);
                return "exiting";
            }),
            state: fileUpdateState(root, () => undefined),
            newer: isNewer,
            now: () => 12_345,
            onApplying: (version) => void applying.push(version),
            report: () => undefined,
        });
        expect(outcome).toBe("exiting");
        expect(applying).toEqual([B.version]);
        expect(seenAtApply).toMatchObject({attempt: {version: B.version, hash: B.hash, from: A.hash, at: 12_345}});
        expect((await holder(root, "shared")).held).toBe(false);
        expect((await holder(root, "exclusive")).held).toBe(false);
    });

    it("同步失败：记进失败名单与“更新没有完成”的通知，放下独占照常启动；下一次不再换", async () => {
        const root = await nextChannelRoot();
        await writeState(root, {...EMPTY_UPDATE_STATE, downloaded: B});
        const events: string[] = [];
        const options = {channelRoot: root, state: fileUpdateState(root, () => undefined), newer: isNewer, now: () => 1, onApplying: () => undefined, report: report(events)};
        expect(await applyAtStartup({...options, updater: updater(A, () => Promise.resolve({failed: "no prepared update"}))})).toBe("continue");
        expect(await readState(root)).toEqual({...EMPTY_UPDATE_STATE, downloaded: B, failed: [B.hash], pendingNotice: {kind: "update-failed", version: B.version, forHash: A.hash}});
        expect(events).toEqual(["desktop.update.apply-failed"]);
        const probe = await holder(root, "exclusive");
        expect(probe.held).toBe(true);
        await probe.release();
        let applied = false;
        expect(await applyAtStartup({...options, updater: updater(A, () => ((applied = true), Promise.resolve("exiting")))})).toBe("continue");
        expect(applied).toBe(false);
    });

    it("有未对账的 attempt 时不再发起", async () => {
        const root = await nextChannelRoot();
        await writeState(root, {...EMPTY_UPDATE_STATE, downloaded: B, attempt: {version: B.version, hash: B.hash, from: A.hash, at: 0}});
        let applied = false;
        expect(await applyAtStartup({channelRoot: root, updater: updater(A, () => ((applied = true), Promise.resolve("exiting"))), state: fileUpdateState(root, () => undefined), newer: isNewer, now: () => 0, onApplying: () => undefined, report: () => undefined})).toBe("continue");
        expect(applied).toBe(false);
    });
});

describe("登记在用这份安装", () => {
    it("与别的共享持有者共存；被独占挡着时每秒重试，持有者退出后拿到", async () => {
        const root = await nextChannelRoot();
        const other = await holder(root, "shared");
        expect(other.held).toBe(true);
        const shared = await acquireInstallUse({channelRoot: root, clock: systemClock, waitMs: 0, report: () => undefined});
        expect(shared).not.toBeNull();
        shared?.release();
        await other.release();

        const exclusive = await holder(root, "exclusive");
        expect(exclusive.held).toBe(true);
        // 第一次尝试在调用里同步发生、必然失败，之后放锁，拿到的只能是重试。
        const acquiring = acquireInstallUse({channelRoot: root, clock: systemClock, waitMs: 10_000, report: () => undefined});
        await exclusive.release();
        const lease = await acquiring;
        expect(lease).not.toBeNull();
        lease?.release();
    }, 20_000);

    it("持有者一直不放：到等待上限交回 null", async () => {
        const root = await nextChannelRoot();
        expect((await holder(root, "exclusive")).held).toBe(true);
        const started = Date.now();
        expect(await acquireInstallUse({channelRoot: root, clock: systemClock, waitMs: 1_500, report: () => undefined})).toBeNull();
        expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
    }, 20_000);
});

describe("对账", () => {
    const attempt = {version: B.version, hash: B.hash, from: A.hash, at: 100_000};
    const port = (local: typeof A, results: ReadonlyArray<ApplyResult> | null, helper: boolean | null) => ({local, results: () => Promise.resolve(results), helperRunning: () => Promise.resolve(helper)});
    const result = (overrides: Partial<ApplyResult>): ApplyResult => ({version: B.version, hash: B.hash, success: false, phase: "swapping", modifiedAt: attempt.at + 1, ...overrides});

    it("对账表六行", async () => {
        const later = attempt.at + ATTEMPT_GRACE_MS;
        expect(await settleAttempt(attempt, port(B, [], false), later)).toBe("updated");
        expect(await settleAttempt(attempt, port(A, [result({})], false), later)).toBe("failed");
        expect(await settleAttempt(attempt, port(A, [result({success: true, phase: "complete"})], false), later)).toBe("reverted");
        expect(await settleAttempt(attempt, port(A, [], true), later)).toBe("in-progress");
        expect(await settleAttempt(attempt, port(A, [], false), later - 1)).toBe("in-progress");
        expect(await settleAttempt(attempt, port(A, [], false), later)).toBe("failed");
        expect(await settleAttempt(attempt, port(C, [result({})], false), later)).toBe("replaced");
    });

    it("进程查不了按“还在”；结果读不了按“还没有结果”；早于发起、哈希不同的结果不算，取最新的一份", async () => {
        const later = attempt.at + ATTEMPT_GRACE_MS;
        expect(await settleAttempt(attempt, port(A, [], null), later)).toBe("in-progress");
        expect(await settleAttempt(attempt, port(A, null, false), later)).toBe("failed");
        expect(await settleAttempt(attempt, port(A, [result({modifiedAt: attempt.at - 1}), result({hash: "hashc"})], true), later)).toBe("in-progress");
        expect(await settleAttempt(attempt, port(A, [result({modifiedAt: attempt.at + 1}), result({success: true, phase: "complete", modifiedAt: attempt.at + 2})], false), later)).toBe("reverted");
    });

    it("按终态改状态；不该由这个构建显示的通知清掉", () => {
        const base: UpdateState = {...EMPTY_UPDATE_STATE, downloaded: B, attempt};
        expect(applyOutcome(base, "updated", B.hash)).toEqual({...EMPTY_UPDATE_STATE, pendingNotice: {kind: "updated", version: B.version, forHash: B.hash}});
        expect(applyOutcome(base, "failed", A.hash)).toEqual({...EMPTY_UPDATE_STATE, downloaded: B, failed: [B.hash], pendingNotice: {kind: "update-failed", version: B.version, forHash: A.hash}});
        expect(applyOutcome(base, "reverted", A.hash)).toEqual(EMPTY_UPDATE_STATE);
        expect(applyOutcome(base, "replaced", C.hash)).toEqual(EMPTY_UPDATE_STATE);
        expect(applyOutcome(base, "in-progress", A.hash)).toBe(base);
        // 装回旧版本之后不再说“已更新到 B”。
        expect(applyOutcome({...EMPTY_UPDATE_STATE, pendingNotice: {kind: "updated", version: B.version, forHash: B.hash}}, "in-progress", A.hash)).toEqual(EMPTY_UPDATE_STATE);
    });

    it("启动时对账写回文件；新版本起来后崩溃、下一次才对账，仍是成功", async () => {
        const root = await nextChannelRoot();
        await writeState(root, {...EMPTY_UPDATE_STATE, downloaded: B, attempt});
        const state = fileUpdateState(root, () => undefined);
        const next = await reconcileAtStartup(state, port(B, [], false), attempt.at + 60 * 60_000, () => undefined);
        expect(next).toEqual({...EMPTY_UPDATE_STATE, pendingNotice: {kind: "updated", version: B.version, forHash: B.hash}});
        expect(await readState(root)).toEqual(next);
    });
});

describe("状态文件", () => {
    it("不存在是空状态；截断、坏 JSON、形状不对时也是空状态并写日志", async () => {
        const root = await nextChannelRoot();
        const events: string[] = [];
        const port = fileUpdateState(root, report(events));
        expect(await port.read()).toEqual(EMPTY_UPDATE_STATE);
        expect(events).toEqual([]);
        await port.write({...EMPTY_UPDATE_STATE, downloaded: B});
        const text = await readFile(join(root, UPDATE_STATE_FILE), "utf8");
        for (const broken of [text.slice(0, text.length / 2), "{not json", JSON.stringify({...EMPTY_UPDATE_STATE, failed: "x"})]) {
            await writeFile(join(root, UPDATE_STATE_FILE), broken);
            expect(await port.read()).toEqual(EMPTY_UPDATE_STATE);
        }
        expect(events).toEqual(["desktop.update.state-invalid", "desktop.update.state-invalid", "desktop.update.state-invalid"]);
    });

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("没有读权限时是空状态并写日志", async () => {
        const root = await nextChannelRoot();
        await writeState(root, {...EMPTY_UPDATE_STATE, downloaded: B});
        await chmod(join(root, UPDATE_STATE_FILE), 0o000);
        const events: string[] = [];
        try {
            expect(await fileUpdateState(root, report(events)).read()).toEqual(EMPTY_UPDATE_STATE);
            expect(events).toEqual(["desktop.update.state-unreadable"]);
        } finally {
            await chmod(join(root, UPDATE_STATE_FILE), 0o600);
        }
    });
});

describe("换上程序的结果文件（Electrobun 2.0.6 的格式）", () => {
    const transaction = "0123456789abcdef0123456789abcdef";
    const document = (overrides: Record<string, unknown> = {}) => ({schema_version: 1, transaction_id: transaction, success: false, phase: "swapping", message: "Access is denied", identifier: IDENTITY.identifier, channel: IDENTITY.channel, version: B.version, hash: B.hash, ...overrides});
    const put = async (root: string, name: string, content: unknown) => writeFile(join(root, name), typeof content === "string" ? content : JSON.stringify(content));

    it("只认合格的文件：文件名、字段、事务号、身份、success 与 phase 一致", async () => {
        const root = await nextChannelRoot();
        await put(root, `.electrobun-update-${transaction}.result.json`, document());
        const other = "fedcba9876543210fedcba9876543210";
        await put(root, `.electrobun-update-${other}.result.json`, document({transaction_id: other, success: true, phase: "complete", hash: C.hash, version: C.version}));
        // 不合格的：文件名不合、事务号与文件名不同、多一个字段、success 与 phase 矛盾、身份不同、坏 JSON。
        await put(root, `.electrobun-update-${transaction.toUpperCase()}.result.json`, document());
        await put(root, ".electrobun-update-11111111111111111111111111111111.result.json", document());
        await put(root, ".electrobun-update-22222222222222222222222222222222.result.json", {...document({transaction_id: "22222222222222222222222222222222"}), extra: 1});
        await put(root, ".electrobun-update-33333333333333333333333333333333.result.json", document({transaction_id: "33333333333333333333333333333333", success: true}));
        await put(root, ".electrobun-update-44444444444444444444444444444444.result.json", document({transaction_id: "44444444444444444444444444444444", channel: "canary"}));
        await put(root, ".electrobun-update-55555555555555555555555555555555.result.json", "{");
        await mkdir(join(root, ".electrobun-update-66666666666666666666666666666666.result.json"));
        const modified = new Date(1_700_000_000_000);
        await utimes(join(root, `.electrobun-update-${transaction}.result.json`), modified, modified);
        const results = await scanApplyResults(root, IDENTITY);
        expect(results?.map((item) => [item.hash, item.success, item.phase]).sort()).toEqual([
            [B.hash, false, "swapping"],
            [C.hash, true, "complete"],
        ]);
        expect(results?.find((item) => item.hash === B.hash)?.modifiedAt).toBe(modified.getTime());
    });

    it("通道根不存在时是空列表；不是规范的绝对路径、结果文件太多时交回 null", async () => {
        const root = await nextChannelRoot();
        expect(await scanApplyResults(join(root, "missing"), IDENTITY)).toEqual([]);
        expect(await scanApplyResults(`${root}/./`, IDENTITY)).toBeNull();
        for (let index = 0; index < 65; index += 1) await put(root, `.electrobun-update-${index.toString(16).padStart(32, "0")}.result.json`, "{}");
        expect(await scanApplyResults(root, IDENTITY)).toBeNull();
    });
});
