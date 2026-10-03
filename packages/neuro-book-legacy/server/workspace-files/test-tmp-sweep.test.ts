import {access, lstat, mkdir, readFile, rm, symlink, utimes, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    createTestTmpRoot,
    removeMarkedTmpRoot,
    resolveTmpRoot,
    sweepStaleTmpRoots,
    TMP_MARKER_FILE,
    TMP_MARKER_SCHEMA_VERSION,
    type TestTmpRootMarker,
    writeTmpMarker,
} from "@notnotype/neuro-book-test-support/tmp";

/** 系统 Temp 下的 Agent 测试临时根。 */
const TMP_ROOT = resolveTmpRoot();

/** 本次测试创建的临时根；afterEach 清理，失败中断时由下次 run 的 sweep 兜底。 */
const cleanedRoots: string[] = [];

afterEach(async () => {
    await Promise.all(cleanedRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

async function tmpDir(name: string): Promise<string> {
    const root = resolve(TMP_ROOT, `${name}-${randomUUID()}`);
    await mkdir(root, {recursive: true});
    cleanedRoots.push(root);
    return root;
}

/** 造一个带 marker 的假 tmp root，用于 sweep 判定测试。 */
async function fakeTmpRoot(marker: Partial<TestTmpRootMarker>): Promise<string> {
    const root = await tmpDir("sweep-case");
    const full: TestTmpRootMarker = {
        schemaVersion: TMP_MARKER_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        pid: process.pid,
        runId: "test-run",
        purpose: "sweep-test",
        ...marker,
    };
    await writeTmpMarker(root, full);
    return root;
}

/** 把目录 mtime 改到 25 小时前，模拟「无 marker 目录超窗」。 */
async function ageDir(root: string): Promise<void> {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(root, old, old);
}

/** 找一个几乎不可能存活的 PID，用来模拟「owner 已死」。 */
function deadPid(): number {
    for (let candidate = 999_999; candidate > 900_000; candidate -= 7919) {
        try {
            process.kill(candidate, 0);
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH") {
                return candidate;
            }
        }
    }
    throw new Error("找不到可用于测试的死亡 PID");
}

describe("测试临时根 sweep 兜底清理", () => {
    it("sweep 只回收合法 marker 的死 owner root，无 marker 一律保留", async () => {
        const dayMs = 24 * 60 * 60 * 1000;
        const old = new Date(Date.now() - 3 * dayMs).toISOString();
        const aliveOwner = await fakeTmpRoot({createdAt: old, pid: process.pid});
        const withinWindow = await fakeTmpRoot({createdAt: new Date().toISOString(), pid: deadPid()});
        const schemaMismatch = await fakeTmpRoot({createdAt: old, pid: deadPid(), schemaVersion: 999});
        const markedReclaimable = await fakeTmpRoot({createdAt: old, pid: deadPid()});
        const noMarkerReclaimable = await tmpDir("no-marker");
        await ageDir(noMarkerReclaimable);
        const noMarkerFresh = await tmpDir("no-marker");

        const report = await sweepStaleTmpRoots(TMP_ROOT);

        expect(report.removed).toContain(markedReclaimable);
        await expect(access(markedReclaimable)).rejects.toMatchObject({code: "ENOENT"});
        for (const [root, reason] of [
            [aliveOwner, "owner_alive"],
            [withinWindow, "within_window"],
            [schemaMismatch, "schema_mismatch"],
            [noMarkerReclaimable, "no_marker"],
            [noMarkerFresh, "no_marker"],
        ] as const) {
            await expect(access(root)).resolves.toBeUndefined();
            expect(report.retained).toContainEqual({root, reason});
        }
    });

    it("sweep 对 Agent 根下的 symlink 与普通文件一律保留（unreadable）", async () => {
        const target = await tmpDir("symlink-target");
        const linkRoot = resolve(TMP_ROOT, `sweep-symlink-${randomUUID()}`);
        await symlink(target, linkRoot, process.platform === "win32" ? "junction" : "dir");
        cleanedRoots.push(linkRoot);

        const fileRoot = resolve(TMP_ROOT, `sweep-file-${randomUUID()}`);
        await writeFile(fileRoot, "not a dir\n", "utf8");
        cleanedRoots.push(fileRoot);

        const report = await sweepStaleTmpRoots(TMP_ROOT);

        expect(report.removed).not.toContain(linkRoot);
        expect(report.removed).not.toContain(fileRoot);
        expect(report.retained).toContainEqual({root: linkRoot, reason: "unreadable"});
        expect(report.retained).toContainEqual({root: fileRoot, reason: "unreadable"});
        await expect(lstat(linkRoot)).resolves.toBeDefined();
        await expect(access(fileRoot)).resolves.toBeUndefined();
    });

    it("marker-owned teardown 拒绝被替换成链接的 root", async () => {
        const target = await tmpDir("replacement-target");
        await writeFile(resolve(target, "keep.txt"), "keep\n", "utf8");
        const replacedRoot = await fakeTmpRoot({purpose: "teardown-replacement"});
        await rm(replacedRoot, {recursive: true, force: true});
        await symlink(target, replacedRoot, process.platform === "win32" ? "junction" : "dir");

        await expect(removeMarkedTmpRoot(replacedRoot, resolve(replacedRoot, TMP_MARKER_FILE))).rejects.toThrow("真实目录");
        await expect(readFile(resolve(target, "keep.txt"), "utf8")).resolves.toBe("keep\n");
    });


    it("createTestTmpRoot 创建带 owner marker 的临时根，purpose 可指定", async () => {
        const root = await createTestTmpRoot("create-test", "purpose-check");
        try {
            const marker = JSON.parse(await readFile(resolve(root, TMP_MARKER_FILE), "utf8")) as TestTmpRootMarker;
            expect(marker.schemaVersion).toBe(TMP_MARKER_SCHEMA_VERSION);
            expect(marker.pid).toBe(process.pid);
            expect(marker.purpose).toBe("purpose-check");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("sweep 不越界：只扫 Agent 根，不动系统 Temp 其它目录", async () => {
        const outside = resolve(TMP_ROOT, "..", `outside-agent-${randomUUID()}`);
        await mkdir(outside, {recursive: true});
        cleanedRoots.push(outside);
        await writeFile(resolve(outside, "keep.txt"), "keep\n", "utf8");

        await sweepStaleTmpRoots();

        await expect(access(resolve(outside, "keep.txt"))).resolves.toBeUndefined();
    });
});
