import {access, lstat, mkdir, readFile, rm, symlink, utimes, writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    createTestTmpRoot,
    sweepStaleTmpRoots,
    TMP_MARKER_FILE,
    TMP_MARKER_SCHEMA_VERSION,
    type TestTmpRootMarker,
} from "nbook/server/workspace-files/test-tmp-sweep";

/** 仓库根：`server/workspace-files/` 向上两级。 */
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const TMP_ROOT = resolve(REPO_ROOT, ".agent", "tmp");

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
    await writeFile(resolve(root, TMP_MARKER_FILE), JSON.stringify(full), "utf8");
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
    it("sweep 只回收「无 marker 超窗」与「有 marker 超窗且 owner 已死」的 root", async () => {
        const dayMs = 24 * 60 * 60 * 1000;
        const old = new Date(Date.now() - 3 * dayMs).toISOString();
        const aliveOwner = await fakeTmpRoot({createdAt: old, pid: process.pid});
        const withinWindow = await fakeTmpRoot({createdAt: new Date().toISOString(), pid: deadPid()});
        const schemaMismatch = await fakeTmpRoot({createdAt: old, pid: deadPid(), schemaVersion: 999});
        const markedReclaimable = await fakeTmpRoot({createdAt: old, pid: deadPid()});
        // 无 marker 的存量测试目录：靠 mtime 超窗回收。
        const noMarkerReclaimable = await tmpDir("no-marker");
        await ageDir(noMarkerReclaimable);
        // 无 marker 但 mtime 仍在窗口内：保留（可能是并行 run 的活动目录）。
        const noMarkerFresh = await tmpDir("no-marker");

        const report = await sweepStaleTmpRoots(REPO_ROOT);

        for (const root of [markedReclaimable, noMarkerReclaimable]) {
            expect(report.removed).toContain(root);
            await expect(access(root)).rejects.toMatchObject({code: "ENOENT"});
        }
        // 其余都必须原样保留：无法证明安全就不删。
        for (const [root, reason] of [
            [aliveOwner, "owner_alive"],
            [withinWindow, "within_window"],
            [schemaMismatch, "schema_mismatch"],
            [noMarkerFresh, "within_window"],
        ] as const) {
            await expect(access(root)).resolves.toBeUndefined();
            expect(report.retained).toContainEqual({root, reason});
        }
    });

    it("sweep 对 .agent/tmp 下的 symlink 与普通文件一律保留（unreadable）", async () => {
        const target = await tmpDir("symlink-target");
        const linkRoot = resolve(TMP_ROOT, `sweep-symlink-${randomUUID()}`);
        await symlink(target, linkRoot, "junction");
        cleanedRoots.push(linkRoot);

        const fileRoot = resolve(TMP_ROOT, `sweep-file-${randomUUID()}`);
        await writeFile(fileRoot, "not a dir\n", "utf8");
        cleanedRoots.push(fileRoot);

        const report = await sweepStaleTmpRoots(REPO_ROOT);

        expect(report.removed).not.toContain(linkRoot);
        expect(report.removed).not.toContain(fileRoot);
        expect(report.retained).toContainEqual({root: linkRoot, reason: "unreadable"});
        expect(report.retained).toContainEqual({root: fileRoot, reason: "unreadable"});
        await expect(lstat(linkRoot)).resolves.toBeDefined();
        await expect(access(fileRoot)).resolves.toBeUndefined();
    });

    it("createTestTmpRoot 创建带 owner marker 的临时根，purpose 可指定", async () => {
        const root = await createTestTmpRoot(REPO_ROOT, "create-test", "purpose-check");
        try {
            expect(root.startsWith(resolve(TMP_ROOT, "create-test-"))).toBe(true);
            const marker = JSON.parse(await readFile(resolve(root, TMP_MARKER_FILE), "utf8")) as TestTmpRootMarker;
            expect(marker.schemaVersion).toBe(TMP_MARKER_SCHEMA_VERSION);
            expect(marker.pid).toBe(process.pid);
            expect(marker.purpose).toBe("purpose-check");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("sweep 不越界：只扫 .agent/tmp，不动 .agent 下其它临时目录", async () => {
        const outside = resolve(REPO_ROOT, ".agent", "outside-tmp-dir");
        await mkdir(outside, {recursive: true});
        cleanedRoots.push(outside);
        await writeFile(resolve(outside, "keep.txt"), "keep\n", "utf8");

        await sweepStaleTmpRoots(REPO_ROOT);

        await expect(access(resolve(outside, "keep.txt"))).resolves.toBeUndefined();
    });
});
