import {mkdir, readdir, rm, stat} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {join} from "node:path";
import {
    resolveAgentTempRoot,
    resolveAgentTestRoot,
    resolveSystemTempRoot,
} from "./paths";
import {TEST_HOST_PATHS_DIR} from "./test-path";
import {TEST_RUN_ID_ENV} from "./process";

const STALE_WINDOW_MS = 24 * 60 * 60 * 1000;
const TEST_RUN_DIR = "vitest";

/**
 * Vitest worker setup：把所有 os.tmpdir()/mkdtemp(tmpdir()) 收敛到受控 Agent Temp。
 * 该模块由各配置同时作为 globalSetup 和 setupFiles 使用；worker import 时
 * `NBOOK_TEST_RUN_ID` 已由 global setup 设置，直接配置当前 run 根。
 */
configureWorkerTempRoot();

/** Vitest globalSetup：建立 run id，并回收超时的旧 run 根。 */
export async function setup(): Promise<void> {
    // Worker 会把 TMPDIR/TEMP/TMP 改写到 run 根；必须先固定宿主锚点，
    // 否则 worker 内 resolveAgentTempRoot() 漂移到 run 根，testHostPath() 指向未创建的 test-paths。
    process.env.NBOOK_HOST_SYSTEM_TEMP_ROOT ??= resolveSystemTempRoot();
    const runId = process.env[TEST_RUN_ID_ENV] ?? randomBytes(4).toString("hex");
    process.env[TEST_RUN_ID_ENV] = runId;
    const root = resolveAgentTestRoot(runId);
    await mkdir(root, {recursive: true});
    process.env.NBOOK_TEST_TMPDIR = root;
    await mkdir(join(resolveAgentTempRoot(), TEST_HOST_PATHS_DIR), {recursive: true});

    const testRoot = join(resolveAgentTempRoot(), TEST_RUN_DIR);
    await mkdir(testRoot, {recursive: true});
    const now = Date.now();
    const entries = await readdir(testRoot, {withFileTypes: true}).catch(() => []);
    await Promise.all(entries.map(async (entry) => {
        if (!entry.isDirectory() || entry.name === runId) return;
        const candidate = join(testRoot, entry.name);
        const info = await stat(candidate).catch(() => null);
        if (info?.isDirectory() && now - info.mtimeMs > STALE_WINDOW_MS) {
            await rm(candidate, {recursive: true, force: true}).catch(() => undefined);
        }
    }));
}

/** Vitest global teardown：删除当前 run 的受控根。 */
export async function teardown(): Promise<void> {
    const runId = process.env[TEST_RUN_ID_ENV];
    if (!runId) return;
    await rm(resolveAgentTestRoot(runId), {recursive: true, force: true}).catch(() => undefined);
}

function configureWorkerTempRoot(): void {
    const runId = process.env[TEST_RUN_ID_ENV];
    if (!runId) return;
    const controlledRoot = resolveAgentTestRoot(runId);
    process.env.TMPDIR = controlledRoot;
    process.env.TEMP = controlledRoot;
    process.env.TMP = controlledRoot;
    process.env.NBOOK_TEST_TMPDIR = controlledRoot;
}
