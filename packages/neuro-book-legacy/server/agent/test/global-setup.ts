import {randomBytes} from "node:crypto";
import {rm} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";
import {
    createSharedSystemAssetsSnapshot,
    removeFixtureTree,
    TEST_SYSTEM_ASSETS_SNAPSHOT_ENV,
} from "nbook/server/workspace-files/test-workspace-fixture";
import {
    createTestTmpRoot,
    sweepStaleFixtureRoots,
    sweepStaleTmpRoots,
    TEST_RUN_ID_ENV,
} from "@notnotype/neuro-book-test-support/tmp";

/** 仓库根：`packages/neuro-book/server/agent/test/global-setup.ts` 向上五级。 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const APPLICATION_ROOT = resolve(REPO_ROOT, "packages", "neuro-book");

/** 本次 run 建立的共享 snapshot；teardown 时删除。 */
let snapshotRoot: string | null = null;
let testStateRoot: string | null = null;
let testCacheRoot: string | null = null;

/**
 * Vitest run 级准备。
 *
 * 先保守回收上一次运行留下的 fixture 残留与测试临时残留，再建立一份
 * run 级共享只读 system assets snapshot，通过环境变量传给各测试 fork。这样单次 run
 * 只投影一份 system 模板，而不是每个用例复制一份完整 `.nbook`。
 *
 * State/Cache Root 走 `createTestTmpRoot`：写入 owner marker 并落在受控临时根内，
 * 进程被强杀时由下一次 run 的 `sweepStaleTmpRoots` 按 dead owner 兜底回收（其中可能含明文 Provider 副本）。
 */
export async function setup(): Promise<void> {
    process.env[TEST_RUN_ID_ENV] = randomBytes(4).toString("hex");
    testStateRoot = await createTestTmpRoot("app-state", "application-state-root");
    testCacheRoot = await createTestTmpRoot("app-cache", "application-cache-root");
    process.env.NEURO_BOOK_APPLICATION_ROOT = APPLICATION_ROOT;
    process.env.NEURO_BOOK_STATE_ROOT = testStateRoot;
    process.env.NEURO_BOOK_CACHE_ROOT = testCacheRoot;
    const sweep = await sweepStaleFixtureRoots();
    if (sweep.removed.length > 0 || sweep.failures.length > 0) {
        console.info(`[fixture] 回收残留 root ${sweep.removed.length} 个，保留 ${sweep.retained.length} 个，失败 ${sweep.failures.length} 个`);
    }
    const tmpSweep = await sweepStaleTmpRoots();
    if (tmpSweep.removed.length > 0 || tmpSweep.failures.length > 0) {
        console.info(`[test-tmp] 回收残留目录 ${tmpSweep.removed.length} 个，保留 ${tmpSweep.retained.length} 个，失败 ${tmpSweep.failures.length} 个`);
    }
    snapshotRoot = await createSharedSystemAssetsSnapshot();
    process.env[TEST_SYSTEM_ASSETS_SNAPSHOT_ENV] = snapshotRoot;
}

/**
 * run 结束时删除共享 snapshot。
 * 进程被强杀时这里不会执行，由下一次 run 的 sweep 按 owner marker 兜底回收。
 */
export async function teardown(): Promise<void> {
    if (testStateRoot) await rm(testStateRoot, {recursive: true, force: true});
    if (testCacheRoot) await rm(testCacheRoot, {recursive: true, force: true});
    testStateRoot = null;
    testCacheRoot = null;
    if (snapshotRoot) {
        await removeFixtureTree(snapshotRoot).catch(() => undefined);
        snapshotRoot = null;
    }
}
