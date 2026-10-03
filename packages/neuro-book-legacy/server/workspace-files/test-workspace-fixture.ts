import {mkdir, mkdtemp, symlink} from "node:fs/promises";
import {execFile} from "node:child_process";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {resolveAgentTempRoot} from "@notnotype/neuro-book-test-support/paths";
import {createProfileArtifactPathContextResolver, readProfileArtifactManifest} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {readVariableDefinitionManifest, resolveVariableDefinitionArtifactPathContext, validateVariableDefinitionArtifact} from "nbook/server/agent/variables/definition-artifact";
import {SystemAssetsProjection} from "nbook/server/workspace-files/system-assets-projection";
import {projectLlmlintSkill} from "nbook/server/workspace-files/llmlint-skill-projection";
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
import {
    FIXTURE_MARKER_FILE,
    FIXTURE_MARKER_SCHEMA_VERSION,
    FIXTURE_ROOT_PREFIX,
    SNAPSHOT_ROOT_PREFIX,
    TEST_RUN_ID_ENV,
    removeFixtureTree,
    sweepStaleFixtureRoots,
    writeFixtureMarker,
    type SystemAssetsMode,
} from "@notnotype/neuro-book-test-support/tmp";
export {
    FIXTURE_MARKER_FILE,
    FIXTURE_MARKER_SCHEMA_VERSION,
    FIXTURE_ROOT_PREFIX,
    SNAPSHOT_ROOT_PREFIX,
    TEST_RUN_ID_ENV,
    removeFixtureTree,
    sweepStaleFixtureRoots,
} from "@notnotype/neuro-book-test-support/tmp";
export type {
    FixtureSweepReport,
    FixtureSweepRetainReason,
    SystemAssetsMode,
    TestWorkspaceFixtureMarker,
} from "@notnotype/neuro-book-test-support/tmp";

/** 共享 snapshot 的投影字节预算；超出说明有人又把不可达 artifact 放回了模板。 */
export const SHARED_SNAPSHOT_BYTE_BUDGET = 512 * 1024 * 1024;
/** globalSetup 把共享 snapshot 路径通过该环境变量传给各测试 fork。 */
export const TEST_SYSTEM_ASSETS_SNAPSHOT_ENV = "NBOOK_TEST_SYSTEM_ASSETS_SNAPSHOT";

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
    const fixturesRoot = path.join(resolveAgentTempRoot(), "fixtures");
    await mkdir(fixturesRoot, {recursive: true});
    const root = await mkdtemp(path.join(fixturesRoot, FIXTURE_ROOT_PREFIX));
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
    const fixturesRoot = path.join(resolveAgentTempRoot(), "fixtures");
    await mkdir(fixturesRoot, {recursive: true});
    const snapshotRoot = await mkdtemp(path.join(fixturesRoot, SNAPSHOT_ROOT_PREFIX));
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
        await projectLlmlintSkill({
            sourceRoot: path.resolve(applicationRoot, "..", "llmlint", "skill"),
            targetRoot: path.join(sourceSystemNbookRoot, "agent", "skills", "llmlint"),
        });
        await ensurePublishedSystemArtifactsFresh(sourceSystemNbookRoot, applicationRoot);
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
async function ensurePublishedSystemArtifactsFresh(systemNbookRoot: string, applicationRoot: string): Promise<void> {
    const {ProfileFreshnessChecker} = await import("nbook/server/agent/profiles/profile-freshness-checker");
    const profileRoot = path.join(systemNbookRoot, "agent", "profiles");
    const variableRoot = path.join(systemNbookRoot, "agent", "variables");
    const profileContextResolver = createProfileArtifactPathContextResolver(applicationRoot);
    const profileRootLabel = "assets/workspace/.nbook/agent/profiles";
    const variableRootLabel = "assets/workspace/.nbook/agent/variables";
    const profileContext = await profileContextResolver(profileRoot, profileRootLabel);
    const variableContext = await resolveVariableDefinitionArtifactPathContext(variableRoot, variableRootLabel, applicationRoot);
    const checker = new ProfileFreshnessChecker(profileContextResolver);
    const probeProfile = async (): Promise<{fresh: boolean; detail: string} | null> => {
        const manifest = await readProfileArtifactManifest(profileRoot, profileContext).catch(() => null);
        const probe = manifest?.profiles[0];
        if (!probe) {
            return null;
        }
        const result = await checker.validate(profileRoot, profileRootLabel, probe, {checkDependencies: true});
        const detail = result.dependency ? `${result.reason}: ${result.dependency.path}` : result.reason ?? "unknown";
        return {fresh: result.fresh, detail: `${probe.fileName}，${detail}`};
    };
    const probeVariable = async (): Promise<{fresh: boolean; detail: string} | null> => {
        const manifest = await readVariableDefinitionManifest(variableRoot, variableContext).catch(() => null);
        const probe = manifest?.definitions[0];
        if (!probe) {
            return null;
        }
        const result = await validateVariableDefinitionArtifact(variableRoot, probe, variableContext, {requireTypeArtifact: true});
        const detail = result.dependency ? `${result.reason}: ${result.dependency.path}` : result.reason ?? "unknown";
        return {fresh: result.fresh, detail: `${probe.fileName}，${detail}`};
    };

    const [profileBefore, variableBefore] = await Promise.all([probeProfile(), probeVariable()]);
    if (profileBefore?.fresh && variableBefore?.fresh) {
        return;
    }

    // 必须开子进程：把 14 个 profile 的 esbuild 依赖图拉进 vitest 主进程会直接 OOM。
    // 应用专属入口位于当前 application source root，cwd 保持为应用包根。
    await new Promise<void>((resolvePromise, rejectPromise) => {
        execFile(
            "bun",
            [path.resolve(applicationRoot, "scripts", "build", "prepare-system-assets.ts")],
            {cwd: applicationRoot, encoding: "utf-8"},
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
