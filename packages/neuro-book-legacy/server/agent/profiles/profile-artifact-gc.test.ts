import {mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile} from "node:fs/promises";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    PROFILE_ARTIFACT_COMPILER_VERSION,
    PROFILE_COMPILED_ARTIFACT_GC_GRACE_MS,
    PROFILE_COMPILED_ARTIFACT_GC_MIN_AGE_MS,
    PROFILE_COMPILED_ARTIFACTS_DIR_NAME,
    PROFILE_COMPILED_BUILTIN_SOURCE_ORPHAN_BUDGET_BYTES,
    PROFILE_COMPILED_MANIFEST_FILE,
    PROFILE_COMPILED_PRODUCT_ORPHAN_BUDGET_BYTES,
    PROFILE_COMPILED_PUBLISH_LOCK,
    PROFILE_COMPILED_USER_ORPHAN_BUDGET_BYTES,
    profileArtifactOrphanBudget,
    pruneCompiledArtifacts,
    resolveProfileArtifactPathContext,
    sweepProfileArtifactBudget,
    type ProfileArtifactManifest,
    type ProfileArtifactManifestItem,
    type ProfileArtifactPathContext,
} from "nbook/server/agent/profiles/profile-artifact-compiler";

const TEST_COMPILER_ROOT = resolve(import.meta.dirname, "../../..");

async function artifactPathContext(profileRoot: string): Promise<ProfileArtifactPathContext> {
    return resolveProfileArtifactPathContext(profileRoot, "workspace/.nbook/agent/profiles", TEST_COMPILER_ROOT);
}

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

/** 建一个 `.compiled` 目录，写入若干 artifact，返回目录路径。 */
async function createCompiledDir(): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-profile-gc-"));
    roots.push(root);
    const compiledDir = join(root, ".compiled");
    await mkdir(join(compiledDir, PROFILE_COMPILED_ARTIFACTS_DIR_NAME), {recursive: true});
    await writeFile(join(compiledDir, PROFILE_COMPILED_MANIFEST_FILE), "{}\n", "utf8");
    return compiledDir;
}

/**
 * 写一个指定字节数的 artifact 并把 mtime 设为「距今 ageMs 毫秒之前」。
 * GC 的驱逐序完全由 mtime 决定，所以测试必须能精确控制它。
 */
async function writeArtifact(compiledDir: string, sha: string, bytes: number, ageMs: number): Promise<string> {
    const filePath = join(compiledDir, PROFILE_COMPILED_ARTIFACTS_DIR_NAME, `${sha}.mjs`);
    await writeFile(filePath, "x".repeat(bytes), "utf8");
    const when = (Date.now() - ageMs) / 1000;
    await utimes(filePath, when, when);
    return filePath;
}

/** 构造只含 loaded entry 的 manifest；GC 的可达集合来自 `profiles`。 */
function manifestWith(shas: string[]): ProfileArtifactManifest {
    const profiles: ProfileArtifactManifestItem[] = shas.map((sha, index) => ({
        status: "loaded",
        fileName: `builtin/p${index}.profile.tsx`,
        profileKey: `p${index}`,
        sourceSha256: `source-${sha}`,
        sourceBytes: 1,
        dependencyHash: "dep",
        artifactFileName: `${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${sha}.mjs`,
        artifactSha256: sha,
        artifactBytes: 1,
        dependencies: [],
    }));
    return {
        compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
        generatedAt: new Date(0).toISOString(),
        profilesRoot: "assets/workspace/.nbook/agent/profiles",
        entries: profiles,
        profiles,
    };
}

/** 磁盘 manifest 是 profileKey 映射，且字段名与内存形态不同（artifactSha256 -> artifactSha）。 */
function serializedManifest(shas: string[]): {compilerVersion: number; generatedAt: string; profilesRoot: string; profiles: Record<string, unknown>} {
    const profiles: Record<string, unknown> = {};
    manifestWith(shas).profiles.forEach((item, index) => {
        profiles[`p${index}`] = {
            status: "loaded",
            fileName: item.fileName,
            profileKey: item.profileKey,
            sourceSha256: item.sourceSha256,
            sourceBytes: item.sourceBytes,
            dependencyHash: item.dependencyHash,
            artifactSha: item.artifactSha256,
            artifactBytes: item.artifactBytes,
            dependencies: [],
        };
    });
    return {
        compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
        generatedAt: new Date(0).toISOString(),
        profilesRoot: "assets/workspace/.nbook/agent/profiles",
        profiles,
    };
}

async function artifactNames(compiledDir: string): Promise<string[]> {
    return (await readdir(join(compiledDir, PROFILE_COMPILED_ARTIFACTS_DIR_NAME))).sort();
}

describe("Profile artifact GC", () => {
    it("按 Product、内置 Source、用户三种生命周期返回固定 orphan 预算", () => {
        expect(profileArtifactOrphanBudget("product")).toBe(PROFILE_COMPILED_PRODUCT_ORPHAN_BUDGET_BYTES);
        expect(profileArtifactOrphanBudget("builtin_source")).toBe(PROFILE_COMPILED_BUILTIN_SOURCE_ORPHAN_BUDGET_BYTES);
        expect(profileArtifactOrphanBudget("user")).toBe(PROFILE_COMPILED_USER_ORPHAN_BUDGET_BYTES);
        expect(PROFILE_COMPILED_PRODUCT_ORPHAN_BUDGET_BYTES).toBe(0);
        expect(PROFILE_COMPILED_BUILTIN_SOURCE_ORPHAN_BUDGET_BYTES).toBe(128 * 1024 * 1024);
        expect(PROFILE_COMPILED_USER_ORPHAN_BUDGET_BYTES).toBe(512 * 1024 * 1024);
    });

    it("Product 零预算仍保护未过最小安全年龄的并发读者 artifact", async () => {
        const compiledDir = await createCompiledDir();
        await writeArtifact(compiledDir, "current", 100, 60 * 60 * 1000);
        await writeArtifact(compiledDir, "reader", 500, Math.floor(PROFILE_COMPILED_ARTIFACT_GC_MIN_AGE_MS / 2));

        const report = await pruneCompiledArtifacts(
            compiledDir,
            manifestWith(["current"]),
            "publish",
            profileArtifactOrphanBudget("product"),
        );

        expect(await artifactNames(compiledDir)).toEqual(["current.mjs", "reader.mjs"]);
        expect(report.protectedBytes).toBe(500);
        expect(report.overBudgetBytes).toBe(500);
    });

    it("current manifest 引用的 artifact 永不删除，哪怕远超字节预算", async () => {
        const compiledDir = await createCompiledDir();
        await writeArtifact(compiledDir, "current", 4096, 30 * 24 * 60 * 60 * 1000);

        const report = await pruneCompiledArtifacts(compiledDir, manifestWith(["current"]), "publish", 1);

        expect(await artifactNames(compiledDir)).toEqual(["current.mjs"]);
        expect(report.deletedFiles).toBe(0);
        expect(report.currentFiles).toBe(1);
        expect(report.orphanFiles).toBe(0);
    });

    it("超预算时从最久未被引用的 orphan 开始驱逐，直到回到预算内", async () => {
        const compiledDir = await createCompiledDir();
        const hour = 60 * 60 * 1000;
        await writeArtifact(compiledDir, "current", 100, hour);
        await writeArtifact(compiledDir, "oldest", 100, 5 * hour);
        await writeArtifact(compiledDir, "middle", 100, 3 * hour);
        await writeArtifact(compiledDir, "newest", 100, 2 * hour);

        // 预算只装得下一个 orphan（100 bytes），另外两个必须按 mtime 从旧到新驱逐。
        const report = await pruneCompiledArtifacts(compiledDir, manifestWith(["current"]), "publish", 100);

        expect(await artifactNames(compiledDir)).toEqual(["current.mjs", "newest.mjs"]);
        expect(report.deletedFiles).toBe(2);
        expect(report.overBudgetBytes).toBe(0);
    });

    it("未过最小安全年龄的 orphan 即使超预算也不驱逐，并如实上报 overBudgetBytes", async () => {
        const compiledDir = await createCompiledDir();
        await writeArtifact(compiledDir, "current", 100, 60 * 60 * 1000);
        // 刚落盘的 orphan 可能正被并发读者 import，地板优先于预算。
        await writeArtifact(compiledDir, "brandNew", 500, Math.floor(PROFILE_COMPILED_ARTIFACT_GC_MIN_AGE_MS / 2));

        const report = await pruneCompiledArtifacts(compiledDir, manifestWith(["current"]), "publish", 1);

        expect(await artifactNames(compiledDir)).toEqual(["brandNew.mjs", "current.mjs"]);
        expect(report.deletedFiles).toBe(0);
        expect(report.protectedBytes).toBe(500);
        expect(report.overBudgetBytes).toBe(499);
    });

    it("超过 grace 的 orphan 即使没超预算也回收", async () => {
        const compiledDir = await createCompiledDir();
        await writeArtifact(compiledDir, "current", 10, 60 * 60 * 1000);
        await writeArtifact(compiledDir, "expired", 10, PROFILE_COMPILED_ARTIFACT_GC_GRACE_MS + 60 * 1000);

        const report = await pruneCompiledArtifacts(compiledDir, manifestWith(["current"]), "publish", 1024 * 1024);

        expect(await artifactNames(compiledDir)).toEqual(["current.mjs"]);
        expect(report.deletedFiles).toBe(1);
    });

    it("manifest 没有任何 loaded entry 时跳过预算回收，不清空 artifacts 目录", async () => {
        const compiledDir = await createCompiledDir();
        const hour = 60 * 60 * 1000;
        await writeArtifact(compiledDir, "a", 1000, hour);
        await writeArtifact(compiledDir, "b", 1000, 2 * hour);
        const degenerate: ProfileArtifactManifest = {
            ...manifestWith([]),
            // 全量编译失败（例如宿主依赖临时缺失）时真实出现过的形态：账本非空但没有可加载 entry。
            entries: [{status: "compile_failed", fileName: "builtin/a.profile.tsx", profileKey: "a", sourceSha256: "s", sourceBytes: 1, issues: [{code: "compile_failed", message: "boom"}]}],
        };

        const report = await pruneCompiledArtifacts(compiledDir, degenerate, "publish", 1);

        expect(await artifactNames(compiledDir)).toEqual(["a.mjs", "b.mjs"]);
        expect(report.skippedDegenerate).toBe(true);
        expect(report.deletedFiles).toBe(0);
    });

    it("回收不会误伤 manifest.json 与 .publish.lock", async () => {
        const compiledDir = await createCompiledDir();
        const hour = 60 * 60 * 1000;
        // proper-lockfile 用 mkdir 语义，锁是目录且位于 `.compiled/` 下而不是 artifacts/ 下。
        await mkdir(join(compiledDir, PROFILE_COMPILED_PUBLISH_LOCK), {recursive: true});
        await writeArtifact(compiledDir, "orphan", 1000, hour);

        await pruneCompiledArtifacts(compiledDir, manifestWith([]), "publish", 1);

        await expect(stat(join(compiledDir, PROFILE_COMPILED_MANIFEST_FILE))).resolves.toBeTruthy();
        await expect(stat(join(compiledDir, PROFILE_COMPILED_PUBLISH_LOCK))).resolves.toBeTruthy();
    });

    it("零写入 sweep 也能把超预算 orphan 收敛回预算内", async () => {
        // 发布时被最小安全年龄地板挡下的 orphan，只有等下一次真实发布才会被重新考虑。
        // 长期不发布时这份超预算会一直留在盘上，所以 sweep 入口不能依赖 publishRequired。
        const compiledDir = await createCompiledDir();
        const profileRoot = join(compiledDir, "..");
        const hour = 60 * 60 * 1000;
        await writeArtifact(compiledDir, "current", 100, hour);
        await writeArtifact(compiledDir, "stale1", 100, 5 * hour);
        await writeArtifact(compiledDir, "stale2", 100, 4 * hour);
        await writeFile(join(compiledDir, PROFILE_COMPILED_MANIFEST_FILE), JSON.stringify(serializedManifest(["current"])), "utf8");

        const report = await sweepProfileArtifactBudget(profileRoot, await artifactPathContext(profileRoot), 100);

        expect(report).not.toBeNull();
        expect(report?.trigger).toBe("sweep");
        expect(await artifactNames(compiledDir)).toEqual(["current.mjs", "stale2.mjs"]);
    });

    it("sweep 预检发现全部可达时直接返回 null，不取发布锁", async () => {
        const compiledDir = await createCompiledDir();
        const profileRoot = join(compiledDir, "..");
        await writeArtifact(compiledDir, "current", 100, 60 * 60 * 1000);
        await writeFile(join(compiledDir, PROFILE_COMPILED_MANIFEST_FILE), JSON.stringify(serializedManifest(["current"])), "utf8");

        await expect(sweepProfileArtifactBudget(profileRoot, await artifactPathContext(profileRoot), 1)).resolves.toBeNull();
        // 没取过锁：稳态下每次启动只付一次 readdir。
        await expect(stat(join(compiledDir, PROFILE_COMPILED_PUBLISH_LOCK))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("把 current artifact 的 mtime 刷新成最后一次被引用的时间", async () => {
        const compiledDir = await createCompiledDir();
        const filePath = await writeArtifact(compiledDir, "current", 10, 30 * 24 * 60 * 60 * 1000);
        const before = (await stat(filePath)).mtimeMs;

        await pruneCompiledArtifacts(compiledDir, manifestWith(["current"]), "publish", 1024 * 1024);

        // 不刷新的话，一个被长期引用的 artifact 一旦脱离 current 就会带着最旧的 mtime，
        // 立刻成为最优先驱逐对象——恰恰是最可能马上被重新引用的那一个。
        expect((await stat(filePath)).mtimeMs).toBeGreaterThan(before);
    });
});
