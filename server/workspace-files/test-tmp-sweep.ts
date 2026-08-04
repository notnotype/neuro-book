import {lstat, mkdir, mkdtemp, readdir, readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {isProcessAlive, TEST_RUN_ID_ENV} from "nbook/server/workspace-files/test-workspace-fixture";
import {removeFixtureTree} from "nbook/server/workspace-files/test-workspace-fixture";

/**
 * 测试临时根的兜底清理（.agent/tmp）。
 *
 * 约定：测试临时目录统一放 `<repoRoot>/.agent/tmp/<name>-<uuid>/`，由 vitest
 * globalSetup 在每次 run 起点 sweep 上一次 run 的残留。正常路径由各测试自己清理，
 * 这里只负责被强杀/中断后无法走到清理代码的残留。
 */
export const TMP_ROOT_REL = ".agent/tmp";
/** owner marker 文件名。 */
export const TMP_MARKER_FILE = ".nbook-tmp.json";
/** marker 结构版本；sweep 只回收版本一致的 root。 */
export const TMP_MARKER_SCHEMA_VERSION = 1;
/** 保守回收窗口：超过该时长且（无 marker 或 owner 已死）的目录才允许回收。 */
export const TMP_STALE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 测试临时根目录的 owner marker。 */
export type TestTmpRootMarker = {
    /** marker 结构版本；不一致一律保留并报告，不回收。 */
    schemaVersion: number;
    /** 创建时刻 ISO 字符串；用于保守回收窗口判定。 */
    createdAt: string;
    /** 创建进程 PID；仍存活时绝不回收。 */
    pid: number;
    /** 单次 Vitest run 标识；用于把同一 run 的 root 归组诊断。 */
    runId: string;
    /** 用途标签，仅用于诊断。 */
    purpose: string;
};

/** sweep 判定保留某个 root 的原因。 */
export type TmpSweepRetainReason = "no_marker" | "schema_mismatch" | "owner_alive" | "within_window" | "unreadable";

export type TmpSweepReport = {
    /** 已成功回收的 root 绝对路径。 */
    removed: string[];
    /** 无法证明可安全回收的 root 及原因。 */
    retained: {root: string; reason: TmpSweepRetainReason}[];
    /** 回收过程中的失败项；不阻断本次 run。 */
    failures: {root: string; message: string}[];
};

/** 解析 `.agent/tmp` 在仓库中的绝对路径。 */
export function resolveTmpRoot(repoRoot: string): string {
    return resolve(repoRoot, TMP_ROOT_REL);
}

/**
 * 新建测试临时根（新测试的推荐入口）：在 `<repoRoot>/.agent/tmp/<name>-` 下
 * `mkdtemp` 并写 owner marker。
 *
 * 存量测试的 `resolve(".agent", "tmp", ...)` 直接 mkdir 写法不要求迁移到本函数：
 * sweep 对无 marker 目录按 mtime 超窗兜底回收。
 */
export async function createTestTmpRoot(repoRoot: string, name: string, purpose?: string): Promise<string> {
    const tmpRoot = resolveTmpRoot(repoRoot);
    await mkdir(tmpRoot, {recursive: true});
    const root = await mkdtemp(resolve(tmpRoot, `${name}-`));
    await writeTmpMarker(root, {
        schemaVersion: TMP_MARKER_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        pid: process.pid,
        runId: process.env[TEST_RUN_ID_ENV] ?? randomUUID(),
        purpose: purpose ?? `test-${name}`,
    });
    return root;
}

/**
 * 回收上一次运行留下的测试临时 root。
 *
 * 安全优先：判定链上任何一步无法证明安全，一律保留并报告，绝不删除。
 * - 有 marker：必须是真实目录 → marker 可读且 schema 一致 → 超过保守窗口 → owner 进程已死。
 * - 无 marker：目录 mtime 超过保守窗口即可回收（存量测试不写 marker，严格要求 marker
 *   会让残留永不回收，止不住目录暴涨）；窗口内的目录可能是并行 run 的活动目录，保留。
 */
export async function sweepStaleTmpRoots(repoRoot: string, now: number = Date.now()): Promise<TmpSweepReport> {
    const report: TmpSweepReport = {removed: [], retained: [], failures: []};
    const tmpRoot = resolveTmpRoot(repoRoot);
    const entries = await readdir(tmpRoot, {withFileTypes: true}).catch(() => []);
    for (const entry of entries) {
        const root = resolve(tmpRoot, entry.name);
        const stats = await lstat(root).catch(() => null);
        if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
            report.retained.push({root, reason: "unreadable"});
            continue;
        }
        const marker = await readTmpMarker(root);
        if (marker === null) {
            if (now - stats.mtimeMs < TMP_STALE_WINDOW_MS) {
                report.retained.push({root, reason: "within_window"});
                continue;
            }
        } else {
            if (marker.schemaVersion !== TMP_MARKER_SCHEMA_VERSION) {
                report.retained.push({root, reason: "schema_mismatch"});
                continue;
            }
            const createdAt = Date.parse(marker.createdAt);
            if (!Number.isFinite(createdAt) || now - createdAt < TMP_STALE_WINDOW_MS) {
                report.retained.push({root, reason: "within_window"});
                continue;
            }
            if (isProcessAlive(marker.pid)) {
                report.retained.push({root, reason: "owner_alive"});
                continue;
            }
        }
        try {
            await removeFixtureTree(root);
            report.removed.push(root);
        } catch (error) {
            report.failures.push({root, message: error instanceof Error ? error.message : String(error)});
        }
    }
    return report;
}

/** 写入 owner marker。 */
async function writeTmpMarker(root: string, marker: TestTmpRootMarker): Promise<void> {
    await writeFile(resolve(root, TMP_MARKER_FILE), `${JSON.stringify(marker, null, 4)}\n`, "utf8");
}

/** 读取并逐字段窄化 owner marker；任何字段不合法都返回 null，交由调用方保留目录。 */
async function readTmpMarker(root: string): Promise<TestTmpRootMarker | null> {
    const text = await readFile(resolve(root, TMP_MARKER_FILE), "utf8").catch(() => null);
    if (text === null) {
        return null;
    }
    let value: unknown;
    try {
        // marker 是磁盘上的外部数据，解析前形态未知，这里是 unknown 的正当用法。
        value = JSON.parse(text) as unknown;
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const candidate = value as Partial<Record<keyof TestTmpRootMarker, unknown>>;
    if (typeof candidate.schemaVersion !== "number"
        || typeof candidate.createdAt !== "string"
        || typeof candidate.pid !== "number"
        || typeof candidate.runId !== "string"
        || typeof candidate.purpose !== "string") {
        return null;
    }
    return {
        schemaVersion: candidate.schemaVersion,
        createdAt: candidate.createdAt,
        pid: candidate.pid,
        runId: candidate.runId,
        purpose: candidate.purpose,
    };
}
