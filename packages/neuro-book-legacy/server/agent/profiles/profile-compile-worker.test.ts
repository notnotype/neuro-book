import {cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {setTimeout as sleep} from "node:timers/promises";
import {describe, expect, it} from "vitest";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {ProfileCompileWorkerService, profileSourceFileSetChangedSinceCompile, resolveProfileCompileWorkerPathsForRoot, useProfileCompileWorker} from "nbook/server/agent/profiles/profile-compile-worker";
import {runProfileCompile, runProfileCompileAll, runProfileCompileEntry} from "nbook/server/agent/profiles/profile-compile-worker-runtime";
import {assertProfileFullReleaseFresh, createProfileArtifactPathContext, PROFILE_COMPILED_DIR_NAME, readProfileArtifactManifest, resolveProfileArtifactPathContext, stageProfileArtifacts} from "nbook/server/agent/profiles/profile-artifact-compiler";
import type {ProfileCompileWorkerResult} from "nbook/server/agent/profiles/profile-compile-worker-types";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths, type RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
import {createProfileArtifactPathContextResolver} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {withIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/test-workspace-fixture";
async function artifactPathContext(profileRoot: string, rootLabel = "workspace/.nbook/agent/profiles") {
    return createProfileArtifactPathContext(
        profileRoot,
        rootLabel,
        await resolveRuntimeArtifactCompilerContext(resolve(".")),
    );
}

async function readManifest(profileRoot: string, rootLabel = "workspace/.nbook/agent/profiles") {
    return readProfileArtifactManifest(profileRoot, await artifactPathContext(profileRoot, rootLabel));
}

function runtimePathsFor(assets: IsolatedWorkspaceAssets): RuntimePaths {
    return createRuntimePaths({
        applicationRoot: absoluteFsPath(assets.applicationRoot),
        stateRoot: absoluteFsPath(assets.root),
    });
}
describe("profile compile worker runtime", () => {
    it("Product Root 只使用预编译 Authoring Kit worker，不携带 tsx vendor 或运行源码", async () => {
        const productRoot = await createProductWorkerFixture();
        try {
            await mkdir(resolve(productRoot, "node_modules"));
            const paths = await resolveProfileCompileWorkerPathsForRoot(productRoot, {
                NEURO_BOOK_PRODUCT_IMAGE_ROOT: resolve(productRoot, ".output"),
                NEURO_BOOK_PRODUCT_BUILD: "1",
                NODE_PATH: resolve(productRoot, "wrong-node-path"),
            });
            expect(paths).toEqual({
                entry: resolve(productRoot, ".output", "server", "authoring", "profile-compile-worker.mjs"),
                precompiled: true,
            });
            await expect(pathExists(resolve(productRoot, "node_modules"))).resolves.toBe(true);
            await expect(pathExists(resolve(productRoot, ".output", "server", "node_modules"))).resolves.toBe(false);
            await expect(pathExists(resolve(productRoot, "release-meta.json"))).resolves.toBe(false);
            await expect(pathExists(resolve(productRoot, ".output", "server", "package.json"))).resolves.toBe(true);
        } finally {
            await rm(productRoot, {recursive: true, force: true});
        }
    }, 120000);

    it("在 worker runtime 中编译 .profile.tsx 源码", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const fileName = "builtin/leader.default.profile.tsx";
            const source = await readFile(profilePath(assets, fileName), "utf8");

            const result = await runProfileCompile({
                fileName,
                source,
                dryRun: false,
                preview: false,
                profileRoot: assets.userProfileRoot,
                runtimePaths: runtimePathsFor(assets),
            });
            try {
                expect(result.ok).toBe(true);
                expect(result.detail).toBeNull();
                expect(result.stagedRelease?.manifest.profiles.some((profile) => profile.profileKey === "leader.default")).toBe(true);
                expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
            } finally {
                await cleanupStagedResult(result);
            }
        });
    }, 120000);

    it("通过 worker service 后台编译 .profile.tsx 源码", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const fileName = "builtin/leader.default.profile.tsx";
            const source = await readFile(profilePath(assets, fileName), "utf8");
            const worker = useProfileCompileWorker(assets.userProfileRoot, runtimePathsFor(assets));

            try {
                const result = await worker.compile({
                    fileName,
                    source,
                    dryRun: false,
                    preview: false,
                });

                const manifest = await readManifest(assets.userProfileRoot);
                expect(result.ok).toBe(true);
                expect(manifest.profiles.some((profile) => profile.profileKey === "leader.default")).toBe(true);
                expect("stagedRelease" in result).toBe(false);
                expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
            } finally {
                worker.dispose();
            }
        });
    }, 120000);
    it("worker runtime 单文件与全量 release 保留显式 Project root label", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const profileRootLabel = "workspace/project/.nbook/agent/profiles";
            const single = await runProfileCompileEntry({
                fileName: "builtin/leader.default.profile.tsx",
                dryRun: false,
                preview: false,
                profileRoot: assets.userProfileRoot,
                profileRootLabel,
                runtimePaths: runtimePathsFor(assets),
            } as Parameters<typeof runProfileCompileEntry>[0]);
            expect(single.stagedRelease?.manifest.profilesRoot).toBe(profileRootLabel);
            await cleanupStagedResult(single);
            const all = await runProfileCompileAll({
                preview: false,
                profileRoot: assets.userProfileRoot,
                profileRootLabel,
                runtimePaths: runtimePathsFor(assets),
            });
            expect(all.stagedRelease?.manifest.profilesRoot).toBe(profileRootLabel);
            await cleanupStagedResult(all);
        });
    }, 120000);

    it("worker service 并发单文件编译不会互相覆盖 manifest entry", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const profileRoot = assets.userProfileRoot;
            const firstFile = "codex.concurrent.one.profile.tsx";
            const secondFile = "codex.concurrent.two.profile.tsx";
            const firstPath = resolve(profileRoot, firstFile);
            const secondPath = resolve(profileRoot, secondFile);
            const worker = new ProfileCompileWorkerService("test-concurrent-single", 2, undefined, assets.userProfileRoot, undefined, runtimePathsFor(assets));
            try {
                await writeFile(firstPath, await temporaryProfileSource(assets, "codex.concurrent.one"), "utf8");
                await writeFile(secondPath, await temporaryProfileSource(assets, "codex.concurrent.two"), "utf8");

                const [first, second] = await Promise.all([
                    worker.compile({fileName: firstFile, dryRun: false, preview: false}),
                    worker.compile({fileName: secondFile, dryRun: false, preview: false}),
                ]);
                const manifest = await readManifest(profileRoot);

                expect(first.ok).toBe(true);
                expect(second.ok).toBe(true);
                expect(manifest.entries.map((entry) => entry.profileKey).sort()).toEqual(expect.arrayContaining([
                    "codex.concurrent.one",
                    "codex.concurrent.two",
                ]));
            } finally {
                worker.dispose();
                await rm(firstPath, {force: true});
                await rm(secondPath, {force: true});
            }
        });
    }, 120000);

    it("watcher与手动请求并发编译同一文件时不会微任务自旋", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const profileRoot = assets.userProfileRoot;
            const fileName = "codex.concurrent.same.profile.tsx";
            const sourcePath = resolve(profileRoot, fileName);
            const worker = new ProfileCompileWorkerService("test-concurrent-same-file", 2, undefined, assets.userProfileRoot, undefined, runtimePathsFor(assets));
            try {
                await writeFile(sourcePath, await temporaryProfileSource(assets, "codex.concurrent.same"), "utf8");

                const [manual, watcher] = await Promise.all([
                    worker.compile({fileName, dryRun: false, preview: false}),
                    worker.compile({fileName, dryRun: false, preview: false}),
                ]);
                const manifest = await readManifest(profileRoot);

                expect(manual.ok).toBe(true);
                expect(watcher.ok).toBe(true);
                expect(manifest.entries.filter((entry) => entry.fileName === fileName)).toHaveLength(1);
            } finally {
                worker.dispose();
                await rm(sourcePath, {force: true});
            }
        });
    }, 120000);

    it("worker service 并发 in-process 单文件编译后 Registry 保留完整 manifest", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const profileRoot = join(assets.workspaceContainerRoot, "project", ".nbook", "agent", "profiles");
            await mkdir(profileRoot, {recursive: true});
            const firstFile = "codex.registry.one.profile.tsx";
            const secondFile = "codex.registry.two.profile.tsx";
            const firstPath = resolve(profileRoot, firstFile);
            const secondPath = resolve(profileRoot, secondFile);
            const catalog = new AgentProfileCatalog(
                "__missing_system__",
                profileRoot,
                undefined,
                undefined,
                createProfileArtifactPathContextResolver(resolve(import.meta.dirname, "../../..")),
                {project: "workspace/project/.nbook/agent/profiles"},
            );
            const worker = new ProfileCompileWorkerService(
                "test-concurrent-registry",
                2,
                undefined,
                profileRoot,
                "workspace/project/.nbook/agent/profiles",
                runtimePathsFor(assets),
            );
            try {
                await writeFile(firstPath, await temporaryProfileSource(assets, "codex.registry.one"), "utf8");
                await writeFile(secondPath, await temporaryProfileSource(assets, "codex.registry.two"), "utf8");
                catalog.enableRuntimeRegistry();
                await catalog.refreshRuntimeRegistry("test");

                const [first, second] = await Promise.all([
                    worker.compile({fileName: firstFile, dryRun: false, preview: false}, {mode: "in_process", registry: catalog}),
                    worker.compile({fileName: secondFile, dryRun: false, preview: false}, {mode: "in_process", registry: catalog}),
                ]);
                const snapshot = await catalog.snapshot();

                expect(first.ok).toBe(true);
                expect(second.ok).toBe(true);
                expect(snapshot.profiles.map((profile) => profile.key)).toEqual(expect.arrayContaining([
                    "codex.registry.one",
                    "codex.registry.two",
                ]));
            } finally {
                worker.dispose();
                await catalog.dispose();
                await rm(firstPath, {force: true});
                await rm(secondPath, {force: true});
            }
        });
    }, 120000);

    it("staging cleanup 失败不会阻断结果或后续 worker 任务", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const profileRoot = assets.userProfileRoot;
            const firstFile = "codex.cleanup.one.profile.tsx";
            const secondFile = "codex.cleanup.two.profile.tsx";
            const firstPath = resolve(profileRoot, firstFile);
            const secondPath = resolve(profileRoot, secondFile);
            const cleanupDirs: string[] = [];
            const worker = new ProfileCompileWorkerService("test-cleanup-failure", 1, async (dir) => {
                cleanupDirs.push(dir);
                throw new Error("cleanup denied");
            }, assets.userProfileRoot, undefined, runtimePathsFor(assets));
            try {
                await writeFile(firstPath, await temporaryProfileSource(assets, "codex.cleanup.one"), "utf8");
                await writeFile(secondPath, await temporaryProfileSource(assets, "codex.cleanup.two"), "utf8");

                const first = await worker.compile({fileName: firstFile, dryRun: false, preview: false});
                const second = await worker.compile({fileName: secondFile, dryRun: false, preview: false});

                expect(first.ok).toBe(true);
                expect(second.ok).toBe(true);
                expect(cleanupDirs.length).toBeGreaterThanOrEqual(2);
            } finally {
                worker.dispose();
                await rm(firstPath, {force: true});
                await rm(secondPath, {force: true});
                await Promise.all(cleanupDirs.map((dir) => rm(dir, {recursive: true, force: true})));
            }
        });
    }, 120000);

    it("full compile 发布前能发现 profile 源文件集合变化", async () => {
        const profileRoot = await mkdtemp(testHostPath("nbook-profile-source-set-"));
        const firstPath = resolve(profileRoot, "codex.source-set.one.profile.tsx");
        const secondPath = resolve(profileRoot, "codex.source-set.two.profile.tsx");
        try {
            await writeFile(firstPath, await temporaryProfileSource("codex.sourceSet.one"), "utf8");
            const filesAtStart = [{
                fileName: "codex.source-set.one.profile.tsx",
                absolutePath: firstPath,
            }];

            await expect(profileSourceFileSetChangedSinceCompile(profileRoot, filesAtStart)).resolves.toBe(false);
            await writeFile(secondPath, await temporaryProfileSource("codex.sourceSet.two"), "utf8");
            await expect(profileSourceFileSetChangedSinceCompile(profileRoot, filesAtStart)).resolves.toBe(true);

            await rm(secondPath, {force: true});
            await rm(firstPath, {force: true});
            await expect(profileSourceFileSetChangedSinceCompile(profileRoot, filesAtStart)).resolves.toBe(true);
        } finally {
            await rm(profileRoot, {recursive: true, force: true});
        }
    });

    it("full compile 发布前能发现同名 profile 源码内容变化", async () => {
        const profileRoot = await mkdtemp(testHostPath("nbook-profile-source-content-"));
        const fileName = "codex.source-content.profile.tsx";
        const sourcePath = resolve(profileRoot, fileName);
        const stagedDirs: string[] = [];
        try {
            await writeFile(sourcePath, await temporaryProfileSource("codex.sourceContent.before"), "utf8");
            const staged = await stageProfileArtifacts({
                profileRoot,
                artifactPathContext: await artifactPathContext(profileRoot),
            });
            stagedDirs.push(staged.buildCompiledDir);
            await writeFile(sourcePath, await temporaryProfileSource("codex.sourceContent.after"), "utf8");

            await expect(assertProfileFullReleaseFresh(profileRoot, staged.sourceFilesAtStart, staged.manifest.entries)).rejects.toThrow("源码内容发生变化");
        } finally {
            await Promise.all(stagedDirs.map((dir) => rm(dir, {recursive: true, force: true})));
            await rm(profileRoot, {recursive: true, force: true});
        }
    }, 120000);

    it("worker service compileAll 发布前发现 profile 源文件集合变化时返回 stale", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const slowFile = "aaa.codex-source-set-slow.profile.tsx";
            const addedFile = "zzz.codex-source-set-added.profile.tsx";
            const slowPath = profilePath(assets, slowFile);
            const addedPath = profilePath(assets, addedFile);
            const worker = new ProfileCompileWorkerService("test-source-set-stale", 1, undefined, assets.userProfileRoot, undefined, runtimePathsFor(assets));
            try {
                await writeFile(slowPath, `await new Promise((resolve) => setTimeout(resolve, 500));\n${await temporaryProfileSource(assets, "codex.sourceSet.slow")}`, "utf8");
                const running = worker.compileAll({preview: false});
                await sleep(100);
                await writeFile(addedPath, await temporaryProfileSource(assets, "codex.sourceSet.added"), "utf8");
                const result = await running;

                expect(result.stale).toBe(true);
                expect(result.ok).toBe(false);
            } finally {
                worker.dispose();
                await rm(slowPath, {force: true});
                await rm(addedPath, {force: true});
            }
        });
    }, 120000);

    it("worker service compileAll 发布前发现同名 profile 源码内容变化时返回 stale", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const slowFile = "aaa.codex-source-content-slow.profile.tsx";
            const slowPath = profilePath(assets, slowFile);
            const markerPath = resolve(assets.root, "worker-source-content-ready.txt");
            const releasePath = resolve(assets.root, "worker-source-content-release.txt");
            const worker = new ProfileCompileWorkerService("test-source-content-stale", 1, undefined, assets.userProfileRoot, undefined, runtimePathsFor(assets));
            let running: Promise<Awaited<ReturnType<ProfileCompileWorkerService["compileAll"]>>> | null = null;
            try {
                await writeFile(slowPath, await blockingProfileSource(assets, "codex.sourceContent.slow", markerPath, releasePath), "utf8");
                running = worker.compileAll({preview: false});
                await waitForPath(markerPath);
                await writeFile(slowPath, await temporaryProfileSource(assets, "codex.sourceContent.changed"), "utf8");
                await writeFile(releasePath, "release", "utf8");
                const result = await running;
                const manifest = await readManifest(assets.userProfileRoot);

                expect(result.stale).toBe(true);
                expect(result.ok).toBe(false);
                expect(manifest.entries.some((entry) => entry.fileName === slowFile)).toBe(false);
            } finally {
                await writeFile(releasePath, "release", "utf8").catch(() => undefined);
                await running?.catch(() => undefined);
                worker.dispose();
                await rm(slowPath, {force: true});
                await rm(markerPath, {force: true});
                await rm(releasePath, {force: true});
            }
        });
    }, 120000);

    it("旧 worker runtime runProfileCompileAll 发布前发现 profile 源文件集合变化时返回 stale", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const slowFile = "aaa.codex-runtime-source-set-slow.profile.tsx";
            const addedFile = "zzz.codex-runtime-source-set-added.profile.tsx";
            const slowPath = profilePath(assets, slowFile);
            const addedPath = profilePath(assets, addedFile);
            try {
                await writeFile(slowPath, `await new Promise((resolve) => setTimeout(resolve, 500));\n${await temporaryProfileSource(assets, "codex.runtimeSourceSet.slow")}`, "utf8");
                const running = runProfileCompileAll({preview: false, profileRoot: assets.userProfileRoot, runtimePaths: runtimePathsFor(assets)});
                await sleep(100);
                await writeFile(addedPath, await temporaryProfileSource(assets, "codex.runtimeSourceSet.added"), "utf8");
                const result = await running;

                expect(result.stale).toBe(true);
                expect(result.ok).toBe(false);
                expect(result.stagedRelease).toBeUndefined();
            } finally {
                await rm(slowPath, {force: true});
                await rm(addedPath, {force: true});
            }
        });
    }, 120000);

    it("旧 worker runtime runProfileCompileAll 发布前发现同名 profile 源码内容变化时返回 stale", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const slowFile = "aaa.codex-runtime-source-content-slow.profile.tsx";
            const slowPath = profilePath(assets, slowFile);
            const markerPath = resolve(assets.root, "runtime-source-content-ready.txt");
            const releasePath = resolve(assets.root, "runtime-source-content-release.txt");
            let running: Promise<ProfileCompileWorkerResult> | null = null;
            try {
                await writeFile(slowPath, await blockingProfileSource(assets, "codex.runtimeSourceContent.slow", markerPath, releasePath), "utf8");
                running = runProfileCompileAll({preview: false, profileRoot: assets.userProfileRoot, runtimePaths: runtimePathsFor(assets)});
                await waitForPath(markerPath);
                await writeFile(slowPath, await temporaryProfileSource(assets, "codex.runtimeSourceContent.changed"), "utf8");
                await writeFile(releasePath, "release", "utf8");
                const result = await running;

                expect(result.stale).toBe(true);
                expect(result.ok).toBe(false);
                expect(result.stagedRelease).toBeUndefined();
            } finally {
                await writeFile(releasePath, "release", "utf8").catch(() => undefined);
                await running?.catch(() => undefined);
                await rm(slowPath, {force: true});
                await rm(markerPath, {force: true});
                await rm(releasePath, {force: true});
            }
        });
    }, 120000);

    it("通过 worker runtime 全量编译用户 profile root", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const result = await runProfileCompileAll({
                preview: false,
                profileRoot: assets.userProfileRoot,
                runtimePaths: runtimePathsFor(assets),
            });
            try {
                expect(result.ok).toBe(true);
                expect(result.compiledCount).toBeGreaterThan(0);
                expect(result.profiles?.some((profile) => profile.profileKey === "leader.default")).toBe(true);
                expect(result.stagedRelease?.manifest.profiles.some((profile) => profile.profileKey === "leader.default")).toBe(true);
                expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
            } finally {
                await cleanupStagedResult(result);
            }
        });
    }, 120000);

    it("worker runtime 单文件 entry 模式只返回一条 staging entry", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const fileName = "builtin/leader.default.profile.tsx";
            const result = await runProfileCompileEntry({
                fileName,
                dryRun: false,
                preview: false,
                profileRoot: assets.userProfileRoot,
                runtimePaths: runtimePathsFor(assets),
            });
            try {
                expect(result.ok).toBe(true);
                expect(result.stagedRelease?.manifest.entries).toHaveLength(1);
                expect(result.stagedRelease?.manifest.entries[0]).toEqual(expect.objectContaining({
                    fileName,
                    profileKey: "leader.default",
                }));
            } finally {
                await cleanupStagedResult(result);
            }
        });
    }, 120000);

    it("全量编译遇到坏 profile 时继续编译其它 profile", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const brokenFile = profilePath(assets, "broken-aggregate.profile.tsx");
            await writeFile(brokenFile, "export default ;\n", "utf8");
            try {
                const result = await runProfileCompileAll({
                    preview: false,
                    profileRoot: assets.userProfileRoot,
                    runtimePaths: runtimePathsFor(assets),
                });
                try {
                    expect(result.ok).toBe(false);
                    expect(result.profiles?.some((profile) => profile.profileKey === "leader.default")).toBe(true);
                    expect(result.issues).toEqual(expect.arrayContaining([
                        expect.objectContaining({
                            severity: "error",
                            fileName: "broken-aggregate.profile.tsx",
                        }),
                    ]));
                } finally {
                    await cleanupStagedResult(result);
                }
            } finally {
                await rm(brokenFile, {force: true});
            }
        });
    }, 120000);

    it("通过 worker service 后台全量编译用户 profile root", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const worker = useProfileCompileWorker(assets.userProfileRoot, runtimePathsFor(assets));
            try {
                const result = await worker.compileAll({preview: false});

                if (!result.ok) {
                    throw new Error(`worker compile-all failed: ${JSON.stringify(result.issues, null, 2)}`);
                }
                expect(result.ok).toBe(true);
                expect(result.compiledCount).toBeGreaterThan(0);
                expect(result.profiles?.some((profile) => profile.profileKey === "leader.default")).toBe(true);
            } finally {
                worker.dispose();
            }
        });
    }, 120000);

    it("worker service in-process 发布会回调 Registry sink，且不把 staging 泄露给调用方", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const worker = new ProfileCompileWorkerService("test-in-process-publish", 1, undefined, assets.userProfileRoot, undefined, runtimePathsFor(assets));
            const publishedRoots: string[] = [];
            try {
                const result = await worker.compileAll({preview: false}, {
                    mode: "in_process",
                    registry: {
                        publishProfileRelease(profileRoot) {
                            publishedRoots.push(profileRoot.replaceAll("\\", "/"));
                        },
                    },
                });

                expect(result.ok).toBe(true);
                expect("stagedRelease" in result).toBe(false);
                expect(publishedRoots.some((root) => root.endsWith("workspace/.nbook/agent/profiles") || root === assets.userProfileRoot.replaceAll("\\", "/"))).toBe(true);
            } finally {
                worker.dispose();
            }
        });
    }, 120000);

    it("worker service 全量编译出的 director artifact 不依赖 Nitro importMeta shim", async () => {
        await withCompiledRootSnapshot(async (assets) => {
            const worker = useProfileCompileWorker(assets.userProfileRoot, runtimePathsFor(assets));
            try {
                const result = await worker.compileAll({preview: false});
                const profileRoot = assets.userProfileRoot;
                const manifest = await readManifest(profileRoot);
                const director = manifest.profiles.find((profile) => profile.profileKey === "director")!;
                const artifactPath = resolve(profileRoot, PROFILE_COMPILED_DIR_NAME, ...director.artifactFileName.split("/"));
                const artifact = await readFile(artifactPath, "utf8");
                const head = artifact.slice(0, 2048);
                const globalWithShim = globalThis as typeof globalThis & {_importMeta_?: unknown};
                const previousImportMeta = globalWithShim._importMeta_;

                try {
                    delete globalWithShim._importMeta_;
                    const mod = await import(`${pathToFileURL(artifactPath).href}?director=${Date.now()}`) as {
                        default?: {manifest?: {key?: string}};
                    };

                    expect(result.ok).toBe(true);
                    expect(head).toContain("import.meta.url");
                    expect(head).not.toContain("globalThis._importMeta_");
                    expect(mod.default?.manifest?.key).toBe("director");
                } finally {
                    if (previousImportMeta === undefined) delete globalWithShim._importMeta_;
                    else globalWithShim._importMeta_ = previousImportMeta;
                }
            } finally {
                worker.dispose();
            }
        }, ["builtin/director.profile.tsx"]);
    }, 120000);
});


async function cleanupStagedResult(result: ProfileCompileWorkerResult): Promise<void> {
    if (result.stagedRelease) {
        await rm(result.stagedRelease.buildCompiledDir, {recursive: true, force: true});
    }
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

async function waitForPath(filePath: string, timeoutMs = 20_000): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await pathExists(filePath)) {
            return;
        }
        await sleep(50);
    }
    throw new Error(`等待文件出现超时: ${filePath}`);
}

async function createProductWorkerFixture(): Promise<string> {
    const productRoot = await mkdtemp(testHostPath("nbook-profile-product-"));
    const outputRoot = resolve(productRoot, ".output", "server");
    await mkdir(resolve(outputRoot, "authoring"), {recursive: true});
    await writeFile(resolve(outputRoot, "index.mjs"), "", "utf8");
    await writeFile(resolve(outputRoot, "package.json"), "{\"name\":\"neuro-book-output\",\"version\":\"0.0.0\",\"type\":\"module\"}\n", "utf8");
    await writeFile(resolve(outputRoot, "authoring", "package.json"), "{\"name\":\"@notnotype/neuro-book-profile-authoring-kit\",\"private\":true,\"type\":\"module\"}\n", "utf8");
    await writeFile(resolve(outputRoot, "authoring", "tsconfig.json"), "{}\n", "utf8");
    await writeFile(resolve(outputRoot, "authoring", "profile-compile-worker.mjs"), "export {};\n", "utf8");
    return productRoot;
}

async function withCompiledRootSnapshot(
    run: (assets: IsolatedWorkspaceAssets) => Promise<void>,
    extraProfileFiles: string[] = [],
): Promise<void> {
    await withIsolatedWorkspaceAssets({}, async (assets) => {
        await seedProfileSources(assets, [
            "builtin/leader.default.profile.tsx",
            "builtin/researcher.profile.tsx",
            ...extraProfileFiles,
        ]);
        await run(assets);
    });
}

/** 只复制当前用例需要编译的Profile源码，避免无关动态模块在同一Vitest fork中累计。 */
async function seedProfileSources(assets: IsolatedWorkspaceAssets, fileNames: string[]): Promise<void> {
    for (const fileName of fileNames) {
        const target = resolve(assets.userProfileRoot, fileName);
        await mkdir(dirname(target), {recursive: true});
        await cp(resolve(assets.systemProfileRoot, fileName), target, {force: true});
    }
}

function profilePath(assets: IsolatedWorkspaceAssets, fileName: string): string {
    return resolve(assets.userProfileRoot, ...fileName.split("/"));
}

async function temporaryProfileSource(assetsOrProfileKey: IsolatedWorkspaceAssets | string, maybeProfileKey?: string): Promise<string> {
    const assets = typeof assetsOrProfileKey === "string" ? null : assetsOrProfileKey;
    const profileKey = typeof assetsOrProfileKey === "string" ? assetsOrProfileKey : maybeProfileKey!;
    const sourceRoot = assets?.userProfileRoot ?? resolve("assets", "workspace", ".nbook", "agent", "profiles");
    const source = await readFile(resolve(sourceRoot, "builtin", "researcher.profile.tsx"), "utf8");
    return source.replace('key: "researcher"', `key: "${profileKey}"`);
}

async function blockingProfileSource(assets: IsolatedWorkspaceAssets, profileKey: string, markerPath: string, releasePath: string): Promise<string> {
    return `${await temporaryProfileSource(assets, profileKey)}

const {existsSync: __codexProfileSignalExists} = await import("node:fs");
const {writeFile: __codexWriteProfileSignal} = await import("node:fs/promises");
const {setTimeout: __codexWaitProfileSignal} = await import("node:timers/promises");
await __codexWriteProfileSignal(${JSON.stringify(markerPath)}, "ready", "utf8");
while (!__codexProfileSignalExists(${JSON.stringify(releasePath)})) {
    await __codexWaitProfileSignal(50);
}
`;
}
