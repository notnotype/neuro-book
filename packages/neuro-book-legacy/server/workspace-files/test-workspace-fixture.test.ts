import {access, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile} from "node:fs/promises";
import {basename, join, sep} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {resolveAgentTempRoot} from "@notnotype/neuro-book-test-support/paths";
import {
    createIsolatedWorkspaceAssets,
    FIXTURE_MARKER_FILE,
    FIXTURE_MARKER_SCHEMA_VERSION,
    FIXTURE_ROOT_PREFIX,
    removeFixtureTree,
    sweepStaleFixtureRoots,
    TEST_SYSTEM_ASSETS_SNAPSHOT_ENV,
    type TestWorkspaceFixtureMarker,
} from "nbook/server/workspace-files/test-workspace-fixture";

const scratchRoots: string[] = [];

afterEach(async () => {
    await Promise.all(scratchRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

async function scratchDir(prefix: string): Promise<string> {
    const fixturesRoot = join(resolveAgentTempRoot(), "fixtures");
    await mkdir(fixturesRoot, {recursive: true});
    const root = await mkdtemp(join(fixturesRoot, prefix));
    scratchRoots.push(root);
    return root;
}

/** 造一个带 marker 的假 fixture root，用于 sweep 判定测试。 */
async function fakeFixtureRoot(marker: Partial<TestWorkspaceFixtureMarker>): Promise<string> {
    const root = await scratchDir(FIXTURE_ROOT_PREFIX);
    const full: TestWorkspaceFixtureMarker = {
        schemaVersion: FIXTURE_MARKER_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        pid: process.pid,
        runId: "test-run",
        purpose: "sweep-test",
        systemAssets: "shared",
        ...marker,
    };
    await writeFile(join(root, FIXTURE_MARKER_FILE), JSON.stringify(full), "utf8");
    return root;
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

describe("Test Workspace Fixture 所有权", () => {
    it("removeFixtureTree 只解链接，绝不删除 junction 指向的目标", async () => {
        // 这条是整个 sweep 设计里代价最高的失误面：fixture root 下挂着指向仓库本体的
        // junction（node_modules / server / app ...），跟随它递归删除就是删仓库。
        const sentinelRoot = await scratchDir("nbook-fixture-sentinel-");
        await writeFile(join(sentinelRoot, "keep.txt"), "keep\n", "utf8");
        await mkdir(join(sentinelRoot, "nested"), {recursive: true});
        await writeFile(join(sentinelRoot, "nested", "deep.txt"), "deep\n", "utf8");

        const root = await scratchDir(FIXTURE_ROOT_PREFIX);
        await symlink(sentinelRoot, join(root, "linked"), "junction");

        await removeFixtureTree(root);

        await expect(access(root)).rejects.toMatchObject({code: "ENOENT"});
        await expect(readFile(join(sentinelRoot, "keep.txt"), "utf8")).resolves.toBe("keep\n");
        await expect(readFile(join(sentinelRoot, "nested", "deep.txt"), "utf8")).resolves.toBe("deep\n");
    });

    it("初始化失败时自行回收已创建的 root，不留残留", async () => {
        const previous = process.env[TEST_SYSTEM_ASSETS_SNAPSHOT_ENV];
        const fixturesRoot = join(resolveAgentTempRoot(), "fixtures");
        await mkdir(fixturesRoot, {recursive: true});
        // 指向不存在的 snapshot：这是投影阶段的自然失败路径，不需要在生产代码里开注入口。
        process.env[TEST_SYSTEM_ASSETS_SNAPSHOT_ENV] = join(fixturesRoot, "nbook-missing-snapshot-does-not-exist");
        const countRoots = async (): Promise<number> =>
            (await readdir(fixturesRoot)).filter((name) => name.startsWith(FIXTURE_ROOT_PREFIX)).length;
        const before = await countRoots();
        try {
            await expect(createIsolatedWorkspaceAssets({})).rejects.toThrow();
            expect(await countRoots()).toBe(before);
        } finally {
            if (previous === undefined) {
                delete process.env[TEST_SYSTEM_ASSETS_SNAPSHOT_ENV];
            } else {
                process.env[TEST_SYSTEM_ASSETS_SNAPSHOT_ENV] = previous;
            }
        }
    });

    it("sweep 只回收 schema 匹配、过窗口且 owner 已死的 root", async () => {
        const dayMs = 24 * 60 * 60 * 1000;
        const old = new Date(Date.now() - 3 * dayMs).toISOString();
        const aliveOwner = await fakeFixtureRoot({createdAt: old, pid: process.pid});
        const withinWindow = await fakeFixtureRoot({createdAt: new Date().toISOString(), pid: deadPid()});
        const schemaMismatch = await fakeFixtureRoot({createdAt: old, pid: deadPid(), schemaVersion: 999});
        const reclaimable = await fakeFixtureRoot({createdAt: old, pid: deadPid()});
        const noMarker = await scratchDir(FIXTURE_ROOT_PREFIX);

        const report = await sweepStaleFixtureRoots();

        expect(report.removed).toContain(reclaimable);
        await expect(access(reclaimable)).rejects.toMatchObject({code: "ENOENT"});
        // 其余四种都必须原样保留：无法证明安全就不删。
        for (const [root, reason] of [
            [aliveOwner, "owner_alive"],
            [withinWindow, "within_window"],
            [schemaMismatch, "schema_mismatch"],
            [noMarker, "no_marker"],
        ] as const) {
            await expect(access(root)).resolves.toBeUndefined();
            expect(report.retained).toContainEqual({root, reason});
        }
    });

    it("fixture 会写出可供 sweep 判定的 owner marker", async () => {
        const assets = await createIsolatedWorkspaceAssets({purpose: "marker-test"});
        try {
            const marker = JSON.parse(await readFile(join(assets.root, FIXTURE_MARKER_FILE), "utf8")) as TestWorkspaceFixtureMarker;
            expect(marker.schemaVersion).toBe(FIXTURE_MARKER_SCHEMA_VERSION);
            expect(marker.pid).toBe(process.pid);
            expect(marker.purpose).toBe("marker-test");
            expect(marker.systemAssets).toBe("shared");
            expect(basename(assets.systemNbookRoot)).toBe(".nbook");
            // 共享模式下 system root 必须是 fixture 内的真实路径（硬链接投影），
            // 不能是指向 snapshot 的 reparse point，否则子进程会 realpath 穿透出去。
            expect(assets.systemNbookRoot.startsWith(`${assets.root}${sep}`)).toBe(true);
            expect((await stat(assets.systemNbookRoot)).isDirectory()).toBe(true);
        } finally {
            await assets.dispose();
        }
        await expect(access(assets.root)).rejects.toMatchObject({code: "ENOENT"});
    });
});
