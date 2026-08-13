import {mkdir, readdir, rm, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {randomBytes} from "node:crypto";
import {join} from "node:path";

/**
 * 受控测试临时根的 run 级清理（仓库级 Vitest globalSetup）。
 *
 * - setup：生成短 runId（8 位 hex，避免路径超 Windows MAX_PATH），写入
 *   `NBOOK_TEST_RUN_ID`，并回收 `neuro-book-vitest/` 下超过 24 小时的旧 run
 *   残留（并行 run 的活跃目录因时间窗口保留）。
 * - teardown：删除本 run 的 `neuro-book-vitest/<runId>` 目录。worker 级
 *   afterAll 在 Vitest 回收 worker 时不可靠，因此清理集中在 run 结束；
 *   并行 run 因 runId 不同互不干扰。进程被强杀时这里不执行，由下一次 run
 *   的 setup 按超窗兜底。
 */
const STALE_WINDOW_MS = 24 * 60 * 60 * 1000;
const BASE_TMP = tmpdir();
const VITEST_TMP_ROOT = join(BASE_TMP, "neuro-book-vitest");

let runId: string | null = null;

export async function setup(): Promise<void> {
    runId = randomBytes(4).toString("hex");
    process.env.NBOOK_TEST_RUN_ID = runId;
    await mkdir(VITEST_TMP_ROOT, {recursive: true});
    const now = Date.now();
    const entries = await readdir(VITEST_TMP_ROOT).catch(() => []);
    await Promise.all(entries.map(async (name) => {
        if (name === runId) return;
        const info = await stat(join(VITEST_TMP_ROOT, name)).catch(() => null);
        if (info?.isDirectory() && now - info.mtimeMs > STALE_WINDOW_MS) {
            await rm(join(VITEST_TMP_ROOT, name), {recursive: true, force: true}).catch(() => undefined);
        }
    }));
}

export async function teardown(): Promise<void> {
    if (!runId) return;
    await rm(join(VITEST_TMP_ROOT, runId), {recursive: true, force: true}).catch(() => undefined);
}
