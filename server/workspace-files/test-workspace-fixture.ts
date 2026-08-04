import {lstat, mkdir, mkdtemp, readdir, readFile, rm, rmdir, symlink, writeFile} from "node:fs/promises";
import {execFile} from "node:child_process";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {readProfileArtifactManifest} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {SystemAssetsProjection} from "nbook/server/workspace-files/system-assets-projection";
import {
    getSystemWorkspaceAssetContextForTest,
    resolveApplicationRoot,
    resolveSystemNbookRoot,
    setSystemWorkspaceAssetContextForTest,
    type SystemWorkspaceAssetContext,
} from "nbook/server/workspace-files/system-workspace-assets";
import {
    getWorkspaceRuntimeRootContextForTest,
    setWorkspaceRuntimeRootContextForTest,
    type WorkspaceRuntimeRootContext,
} from "nbook/server/workspace-files/workspace-runtime-root";

/** fixture 临时 root 的固定前缀；sweep 只认这个前缀。 */
export const FIXTURE_ROOT_PREFIX = "nbook-workspace-assets-";
/** run 级共享只读 system assets snapshot 的固定前缀。 */
export const SNAPSHOT_ROOT_PREFIX = "nbook-workspace-snapshot-";
/** owner marker 文件名。 */
export const FIXTURE_MARKER_FILE = ".nbook-fixture.json";
/** marker 结构版本；sweep 只回收版本完全一致的 root。 */
export const FIXTURE_MARKER_SCHEMA_VERSION = 1;
/** 保守回收窗口：只有超过该时长且 owner 不活跃的 root 才允许回收。 */
export const FIXTURE_STALE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 共享 snapshot 的投影字节预算；超出说明有人又把不可达 artifact 放回了模板。 */
export const SHARED_SNAPSHOT_BYTE_BUDGET = 512 * 1024 * 1024;
/** globalSetup 把共享 snapshot 路径通过该环境变量传给各测试 fork。 */
export const TEST_SYSTEM_ASSETS_SNAPSHOT_ENV = "NBOOK_TEST_SYSTEM_ASSETS_SNAPSHOT";
/** globalSetup 生成的单次 run 标识，写进 marker 便于把残留 root 归组。 */
export const TEST_RUN_ID_ENV = "NBOOK_TEST_RUN_ID";

/** 进程内 fallback run id：没有 globalSetup 时（例如单文件直跑）仍然要能写出 marker。 */
const processRunId = randomUUID();
const systemAssetsProjection = new SystemAssetsProjection();

/**
 * system assets 的投影方式。
 *
 * - `shared`：`<root>/assets` 由 run 级 snapshot 投影而来。可变文件各自持有独立副本（约 4 MB），
 *   只有内容寻址的不可变 artifact 走硬链接（约 382 MiB 共享 inode）。
 * - `isolated`：整棵树真实拷贝，供**会写入 system `.compiled` artifact** 的测试独占。
 */
export type SystemAssetsMode = "shared" | "isolated";

export type IsolatedWorkspaceAssets = {
    root: string;
    applicationRoot: string;
    systemNbookRoot: string;
    workspaceContainerRoot: string;
    userNbookRoot: string;
    userProfileRoot: string;
    systemProfileRoot: string;
    dispose: () => Promise<void>;
};

export type IsolatedWorkspaceAssetsOptions = {
    /**
     * 为 true 时临时切换 cwd 到隔离 root；helper 会用 junction 暴露项目源码和依赖。
     */
    useAsCwd?: boolean;
    /**
     * 默认 `shared`（只读共享 snapshot）。只有会修改 system assets 的测试才用 `isolated`。
     */
    systemAssets?: SystemAssetsMode;
    /**
     * 写进 owner marker 的用途标签，仅用于诊断残留 root；为空时按 vitest worker 编号生成。
     */
    purpose?: string;
};

/**
 * fixture root 的 owner marker。sweep 只在这些字段全部可证明安全时才回收目录。
 */
export type TestWorkspaceFixtureMarker = {
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
    /** system assets 投影方式，用于诊断哪些 root 真的复制了模板。 */
    systemAssets: SystemAssetsMode;
};

/** sweep 判定保留某个 root 的原因。 */
export type FixtureSweepRetainReason = "no_marker" | "schema_mismatch" | "owner_alive" | "within_window" | "unreadable";

export type FixtureSweepReport = {
    /** 已成功回收的 root 绝对路径。 */
    removed: string[];
    /** 匹配前缀但无法证明可安全回收的 root 及原因。 */
    retained: {root: string; reason: FixtureSweepRetainReason}[];
    /** 回收过程中的失败项；不阻断本次 run。 */
    failures: {root: string; message: string}[];
};

/**
 * 在隔离的 Workspace assets root 中执行测试，避免并行测试写入真实 user-assets。
 */
export async function withIsolatedWorkspaceAssets<T>(
    options: IsolatedWorkspaceAssetsOptions,
    task: (assets: IsolatedWorkspaceAssets) => Promise<T>,
): Promise<T> {
    const assets = await createIsolatedWorkspaceAssets(options);
    try {
        return await task(assets);
    } finally {
        await assets.dispose();
    }
}

/**
 * 创建独立 Workspace assets root，并把全局 context 指向该 root。
 *
 * 初始化任一步失败时由本函数自己回收已创建的 root 再 rethrow；
 * 调用方永远不会因为拿不到 `dispose()` 而泄漏临时目录。
 */
export async function createIsolatedWorkspaceAssets(options: IsolatedWorkspaceAssetsOptions = {}): Promise<IsolatedWorkspaceAssets> {
    const root = await mkdtemp(path.join(tmpdir(), FIXTURE_ROOT_PREFIX));
    try {
        return await initializeFixture(root, options);
    } catch (error) {
        await removeFixtureTree(root).catch(() => undefined);
        throw error;
    }
}

/**
 * 在已创建的 root 上完成投影、链接、cwd 切换和全局 context 覆盖。
 *
 * `<root>/assets/workspace/.nbook` 这个**物理相对路径必须始终存在**：
 * profile 编译把依赖路径记成 cwd 相对（`normalizeArtifactPath`），
 * user-assets sync 又按 `assets/workspace/.nbook/agent/profiles` 这个字符串标签
 * 把 system entry rehome 成 user entry。把 system root 挪到 cwd 之外会让依赖标签
 * 退化成临时目录绝对路径，rehome 随之失配。
 */
async function initializeFixture(root: string, options: IsolatedWorkspaceAssetsOptions): Promise<IsolatedWorkspaceAssets> {
    const previousSystemContext = getSystemWorkspaceAssetContextForTest();
    const previousRuntimeContext = getWorkspaceRuntimeRootContextForTest();
    const previousCwd = process.cwd();
    const applicationRoot = resolveApplicationRoot();
    const systemAssets: SystemAssetsMode = options.systemAssets ?? "shared";
    const assetsRoot = path.join(root, "assets");
    const systemNbookRoot = path.join(assetsRoot, "workspace", ".nbook");
    const workspaceContainerRoot = path.join(root, "workspace");
    const userNbookRoot = path.join(workspaceContainerRoot, ".nbook");

    await writeFixtureMarker(root, {
        schemaVersion: FIXTURE_MARKER_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        pid: process.pid,
        runId: process.env[TEST_RUN_ID_ENV] ?? processRunId,
        purpose: options.purpose ?? `vitest-worker-${process.env.VITEST_WORKER_ID ?? "0"}`,
        systemAssets,
    });

    const snapshotRoot = resolveSharedSnapshotRoot();
    const snapshotNbookRoot = path.join(snapshotRoot, "assets", "workspace", ".nbook");
    // 共享模式只对内容寻址的不可变 Profile artifact 尝试硬链接；其余文件始终真实复制。
    // junction 会被子进程 realpath 穿透，因此两种模式都必须落成 fixture 内的真实目录项。
    await systemAssetsProjection.copyToEmpty({
        sourceRoot: snapshotNbookRoot,
        targetRoot: systemNbookRoot,
        profileArtifactMode: systemAssets === "shared" ? "hardlink" : "copy",
    });
    await mkdir(userNbookRoot, {recursive: true});

    if (options.useAsCwd) {
        await linkApplicationFiles(applicationRoot, root);
        process.chdir(root);
    }

    const systemContext: SystemWorkspaceAssetContext = {applicationRoot, systemNbookRoot};
    const runtimeContext: WorkspaceRuntimeRootContext = {workspaceRoot: workspaceContainerRoot, userNbookRoot};
    setSystemWorkspaceAssetContextForTest(systemContext);
    setWorkspaceRuntimeRootContextForTest(runtimeContext);

    return {
        root,
        applicationRoot,
        systemNbookRoot,
        workspaceContainerRoot,
        userNbookRoot,
        userProfileRoot: path.join(userNbookRoot, "agent", "profiles"),
        systemProfileRoot: path.join(systemNbookRoot, "agent", "profiles"),
        dispose: async () => {
            // context 恢复是同步赋值，不会抛，放最前面保证一定生效。
            setSystemWorkspaceAssetContextForTest(previousSystemContext);
            setWorkspaceRuntimeRootContextForTest(previousRuntimeContext);
            const failures: unknown[] = [];
            if (options.useAsCwd) {
                try {
                    process.chdir(previousCwd);
                } catch (error) {
                    failures.push(error);
                }
            }
            try {
                await removeFixtureTree(root);
            } catch (error) {
                failures.push(error);
            }
            if (failures.length > 0) {
                throw new AggregateError(failures, `Workspace fixture 销毁存在失败项：${root}`);
            }
        },
    };
}

/**
 * 解析 run 级共享 snapshot root。
 *
 * 未经 globalSetup 就使用 `shared` 模式属于调用顺序错误，直接抛错而不是静默回退到
 * 真实仓库 assets——静默回退会让测试写穿到仓库本体。
 */
function resolveSharedSnapshotRoot(): string {
    const snapshotRoot = process.env[TEST_SYSTEM_ASSETS_SNAPSHOT_ENV]?.trim();
    if (!snapshotRoot) {
        throw new Error(`缺少共享 system assets snapshot：请确认 vitest globalSetup 已运行并设置 ${TEST_SYSTEM_ASSETS_SNAPSHOT_ENV}。`);
    }
    return snapshotRoot;
}

/**
 * 构建 run 级共享只读 system assets snapshot。
 *
 * 这是对**已发布 release 的纯投影**，不做任何编译：源码、manifest 和 manifest 当前引用的
 * artifact 一起复制过来，三者本来就相互一致，投影后依然新鲜。manifest 里的依赖路径是
 * cwd 相对（`assets/workspace/.nbook/...`、`node_modules/...`），而 snapshot 根同时挂了
 * `assets` 与仓库 junction，因此这些路径在 snapshot 里解析到同样的字节。
 *
 * 刻意不在这里重编：重编一旦失败会用 compile_failed 覆盖掉刚投影进来的有效 manifest，
 * 让所有依赖 system profile 的测试一起垮掉，而失败原因往往与被测代码无关。
 * 系统 assets 的编译由 `bun run dev` / `system-assets:prepare` 负责。
 */
export async function createSharedSystemAssetsSnapshot(): Promise<string> {
    const snapshotRoot = await mkdtemp(path.join(tmpdir(), SNAPSHOT_ROOT_PREFIX));
    try {
        await writeFixtureMarker(snapshotRoot, {
            schemaVersion: FIXTURE_MARKER_SCHEMA_VERSION,
            createdAt: new Date().toISOString(),
            pid: process.pid,
            runId: process.env[TEST_RUN_ID_ENV] ?? processRunId,
            purpose: "shared-system-snapshot",
            systemAssets: "isolated",
        });
        const applicationRoot = resolveApplicationRoot();
        const sourceSystemNbookRoot = resolveSystemNbookRoot();
        const targetSystemNbookRoot = path.join(snapshotRoot, "assets", "workspace", ".nbook");
        await ensurePublishedSystemArtifactsFresh(sourceSystemNbookRoot);
        await systemAssetsProjection.copyToEmpty({
            sourceRoot: sourceSystemNbookRoot,
            targetRoot: targetSystemNbookRoot,
        });
        // snapshot 内要执行 `workspace node ...` 之类的子进程，bun 会 realpath 后向上找
        // package.json / tsconfig.json / node_modules，所以 snapshot 根也要挂全套链接。
        await linkApplicationFiles(applicationRoot, snapshotRoot);
        return snapshotRoot;
    } catch (error) {
        await removeFixtureTree(snapshotRoot).catch(() => undefined);
        throw error;
    }
}

/**
 * 保证已发布的 system Profile/Variable release 相对当前源码是新鲜的，必要时就地重编一次。
 *
 * snapshot 是纯投影，不重编；一旦 `server/**`、`packages/**` 等依赖在发布之后被改过，
 * 投影出来的 manifest 会整体判成 `dependency_changed`，所有 system profile 变 stale，
 * user-assets sync 直接跳过 profile —— 表现为一堆「期望非空却拿到 []」的断言失败，极难定位。
 *
 * 编译刻意放在**仓库根**（此时 cwd 就是仓库根）而不是 snapshot 或 fixture 内：
 * 依赖路径按 cwd 相对记录，只有在仓库根编译出来的 manifest 才能被任意 fixture 复用；
 * 而且临时 root 下的裸包解析本就不可靠。
 *
 * 只探测第一个 profile：14 个内置 profile 共享绝大部分依赖图，够用且省掉 14 倍哈希开销。
 */
async function ensurePublishedSystemArtifactsFresh(systemNbookRoot: string): Promise<void> {
    const {ProfileFreshnessChecker} = await import("nbook/server/agent/profiles/profile-freshness-checker");
    const {readVariableDefinitionManifest, validateVariableDefinitionArtifact} = await import("nbook/server/agent/variables/definition-artifact");
    const profileRoot = path.join(systemNbookRoot, "agent", "profiles");
    const variableRoot = path.join(systemNbookRoot, "agent", "variables");
    const checker = new ProfileFreshnessChecker();
    const probeProfile = async (): Promise<{fresh: boolean; detail: string} | null> => {
        const manifest = await readProfileArtifactManifest(profileRoot).catch(() => null);
        const probe = manifest?.profiles[0];
        if (!probe) {
            return null;
        }
        const result = await checker.validate(profileRoot, probe, {checkDependencies: true});
        const detail = result.dependency ? `${result.reason}: ${result.dependency.path}` : result.reason ?? "unknown";
        return {fresh: result.fresh, detail: `${probe.fileName}，${detail}`};
    };
    const probeVariable = async (): Promise<{fresh: boolean; detail: string} | null> => {
        const manifest = await readVariableDefinitionManifest(variableRoot).catch(() => null);
        const probe = manifest?.definitions[0];
        if (!probe) {
            return null;
        }
        const result = await validateVariableDefinitionArtifact(variableRoot, probe, {requireTypeArtifact: true});
        const detail = result.dependency ? `${result.reason}: ${result.dependency.path}` : result.reason ?? "unknown";
        return {fresh: result.fresh, detail: `${probe.fileName}，${detail}`};
    };

    const [profileBefore, variableBefore] = await Promise.all([probeProfile(), probeVariable()]);
    if (profileBefore?.fresh && variableBefore?.fresh) {
        return;
    }

    // 必须开子进程：把 14 个 profile 的 esbuild 依赖图拉进 vitest 主进程会直接 OOM
    // （实测 heap 打满在 mark-compact）。这里复用与 `bun run system-assets:prepare`
    // 完全相同的入口，避免测试侧另立一套编译路径。
    await new Promise<void>((resolvePromise, rejectPromise) => {
        execFile(
            "bun",
            ["scripts/build/prepare-system-assets.ts"],
            {cwd: process.cwd(), encoding: "utf-8"},
            (error, _stdout, stderr) => {
                if (error) {
                    rejectPromise(new Error(`系统 assets 重编失败：${stderr || error.message}`));
                    return;
                }
                resolvePromise();
            },
        );
    });

    const [profileAfter, variableAfter] = await Promise.all([probeProfile(), probeVariable()]);
    const failures = [
        !profileAfter ? "Profile manifest 没有 loaded entry" : !profileAfter.fresh ? `Profile ${profileAfter.detail}` : null,
        !variableAfter ? "Variable manifest 没有 definition entry" : !variableAfter.fresh ? `Variable ${variableAfter.detail}` : null,
    ].filter((failure): failure is string => Boolean(failure));
    if (failures.length > 0) {
        throw new Error(`系统 assets 重编后仍然不新鲜（${failures.join("；")}）。请手动运行 \`bun run system-assets:prepare\` 查看真实编译错误。`);
    }
}

/**
 * 删除 fixture root。
 *
 * root 下含指向仓库本体的 junction（`node_modules`、`server`、`app` 等），
 * 必须先 `lstat` 判定 reparse point 只解链接本身。Windows junction 在 Node 中
 * 同样报告 `isSymbolicLink() === true`，跟随它递归删除会删掉仓库源码。
 */
export async function removeFixtureTree(root: string): Promise<void> {
    const entries = await readdir(root, {withFileTypes: true}).catch(() => []);
    const failures: unknown[] = [];
    for (const entry of entries) {
        // marker 必须最后删除；否则某个 junction/文件删除失败后只剩无 owner 的半棵目录，
        // 后续 sweep 将永远无法证明它可安全回收。
        if (entry.name === FIXTURE_MARKER_FILE) {
            continue;
        }
        const target = path.join(root, entry.name);
        try {
            const stats = await lstat(target);
            if (stats.isSymbolicLink()) {
                // 必须带 recursive：Windows 目录 junction 不能用非递归 rm 解除（会 EFAULT/EPERM）。
                // `fs.rm` 对 symlink/junction 只解链接、不进入目标，所以这里不会删到仓库本体。
                await rm(target, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
                continue;
            }
            await rm(target, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length > 0) {
        throw new AggregateError(failures, `fixture root 清理存在失败项：${root}`);
    }

    const markerPath = path.join(root, FIXTURE_MARKER_FILE);
    const markerText = await readFile(markerPath, "utf8").catch(() => null);
    await rm(markerPath, {force: true, maxRetries: 10, retryDelay: 100});
    try {
        await rmdir(root);
    } catch (error) {
        if (markerText !== null) {
            await writeFile(markerPath, markerText, "utf8").catch((restoreError: unknown) => {
                throw new AggregateError([error, restoreError], `fixture root 清理失败且无法恢复owner marker：${root}`);
            });
        }
        throw new AggregateError([error], `fixture root 清理存在失败项：${root}`);
    }
}

/**
 * 回收上一次运行留下的 fixture root。
 *
 * 判定链上任何一步无法证明安全，一律保留并报告，绝不删除：
 * 必须是真实目录（不跟随同名 symlink）→ marker 可读且 schema 一致 →
 * 超过保守窗口 → owner 进程已不活跃。
 */
export async function sweepStaleFixtureRoots(now: number = Date.now()): Promise<FixtureSweepReport> {
    const report: FixtureSweepReport = {removed: [], retained: [], failures: []};
    const tempRoot = tmpdir();
    const entries = await readdir(tempRoot, {withFileTypes: true}).catch(() => []);
    for (const entry of entries) {
        if (!entry.name.startsWith(FIXTURE_ROOT_PREFIX) && !entry.name.startsWith(SNAPSHOT_ROOT_PREFIX)) {
            continue;
        }
        const root = path.join(tempRoot, entry.name);
        const stats = await lstat(root).catch(() => null);
        if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
            report.retained.push({root, reason: "unreadable"});
            continue;
        }
        const marker = await readFixtureMarker(root);
        if (!marker) {
            report.retained.push({root, reason: "no_marker"});
            continue;
        }
        if (marker.schemaVersion !== FIXTURE_MARKER_SCHEMA_VERSION) {
            report.retained.push({root, reason: "schema_mismatch"});
            continue;
        }
        const createdAt = Date.parse(marker.createdAt);
        if (!Number.isFinite(createdAt) || now - createdAt < FIXTURE_STALE_WINDOW_MS) {
            report.retained.push({root, reason: "within_window"});
            continue;
        }
        if (isProcessAlive(marker.pid)) {
            report.retained.push({root, reason: "owner_alive"});
            continue;
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
async function writeFixtureMarker(root: string, marker: TestWorkspaceFixtureMarker): Promise<void> {
    await writeFile(path.join(root, FIXTURE_MARKER_FILE), `${JSON.stringify(marker, null, 4)}\n`, "utf8");
}

/** 读取并逐字段窄化 owner marker；任何字段不合法都返回 null，交由调用方保留目录。 */
async function readFixtureMarker(root: string): Promise<TestWorkspaceFixtureMarker | null> {
    const text = await readFile(path.join(root, FIXTURE_MARKER_FILE), "utf8").catch(() => null);
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
    const candidate = value as Partial<Record<keyof TestWorkspaceFixtureMarker, unknown>>;
    if (typeof candidate.schemaVersion !== "number"
        || typeof candidate.createdAt !== "string"
        || typeof candidate.pid !== "number"
        || typeof candidate.runId !== "string"
        || typeof candidate.purpose !== "string"
        || (candidate.systemAssets !== "shared" && candidate.systemAssets !== "isolated")) {
        return null;
    }
    return {
        schemaVersion: candidate.schemaVersion,
        createdAt: candidate.createdAt,
        pid: candidate.pid,
        runId: candidate.runId,
        purpose: candidate.purpose,
        systemAssets: candidate.systemAssets,
    };
}

/**
 * 判断 owner 进程是否仍活跃。
 * ESRCH 表示进程不存在；EPERM 表示存在但无权限，视为存活。无法判定一律视为存活。
 */
export function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return true;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH");
    }
}

// 这些条目必须覆盖 profile manifest 里依赖路径的全部顶层前缀：
// 依赖按 cwd 相对记录（`normalizeArtifactPath`），fixture 内解析不到就会被判成
// dependency_changed，进而让所有 system profile 变 stale、sync 直接跳过。
// 当前实测前缀为 node_modules / server / shared / packages / profile-sdk /
// variable-sdk / assets / tsconfig.json。
const linkedApplicationEntries = [
    {name: "app", type: "junction" as const},
    {name: "server", type: "junction" as const},
    {name: "shared", type: "junction" as const},
    {name: "packages", type: "junction" as const},
    {name: "profile-sdk", type: "junction" as const},
    {name: "variable-sdk", type: "junction" as const},
    {name: "reference", type: "junction" as const},
    {name: "docs", type: "junction" as const},
    {name: "node_modules", type: "junction" as const},
    {name: ".nuxt", type: "junction" as const},
    {name: "package.json", type: "file" as const},
    {name: "tsconfig.json", type: "file" as const},
    {name: "nuxt.config.ts", type: "file" as const},
];

async function linkApplicationFiles(applicationRoot: string, isolatedRoot: string): Promise<void> {
    for (const entry of linkedApplicationEntries) {
        const source = path.join(applicationRoot, entry.name);
        const target = path.join(isolatedRoot, entry.name);
        await symlink(source, target, entry.type).catch((error) => {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                return;
            }
            throw error;
        });
    }
}
