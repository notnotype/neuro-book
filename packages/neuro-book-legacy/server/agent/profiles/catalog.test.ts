import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {randomUUID} from "node:crypto";
import {copyFile, cp, mkdir, readFile, readdir, rm, symlink, utimes, writeFile} from "node:fs/promises";
import {dirname, join, relative, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {lock as lockFile} from "proper-lockfile";
import {Type} from "typebox";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {createProjectWorkspaceKey, projectWorkspaceRef, resolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    compileProfileArtifacts as compileProfileArtifactsWithContext,
    createProfileArtifactPathContext,
    hashFile,
    isProfileReleaseCommittedButRegistryFailedError,
    PROFILE_ARTIFACT_COMPILER_VERSION,
    PROFILE_COMPILED_ARTIFACT_GC_GRACE_MS,
    PROFILE_COMPILED_ARTIFACTS_DIR_NAME,
    PROFILE_COMPILED_DIR_NAME,
    PROFILE_COMPILED_PUBLISH_LOCK,
    ProfileArtifactSourceFileSetChangedError,
    ProfileReleaseCommittedButRegistryFailedError,
    ProfileReleasePublisher,
    readProfileArtifactManifest as readProfileArtifactManifestWithContext,
    rehomeProfileArtifactItem,
    resolveProfileArtifactPathContext,
    stageProfileArtifactEntry as stageProfileArtifactEntryWithContext,
    stageProfileArtifacts as stageProfileArtifactsWithContext,
    type CompileProfileArtifactsOptions,
    type ProfileArtifactManifest,
    type ProfileArtifactManifestItem,
    type ProfileArtifactPathContext,
    validateProfileArtifact as validateProfileArtifactWithContext,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
import {defineAgentProfile as defineRuntimeAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {profileToolsFromKeys} from "nbook/server/agent/test/profile-tools";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {messageText} from "nbook/server/agent/messages/message-utils";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";
import {createTestRuntimeSession} from "nbook/server/agent/profiles/test/runtime-session";

function defineAgentProfile(profile: any): ReturnType<typeof defineRuntimeAgentProfile> {
    const {
        allowedToolKeys,
        ...rest
    } = profile;
    return defineRuntimeAgentProfile({
        ...rest,
        tools: rest.tools ?? profileToolsFromKeys(allowedToolKeys ?? []),
    });
}

describe("AgentProfileCatalog", {timeout: 15_000}, () => {
    let root: string;
    let installRoot: string;
    let projectProfileRoot: string;
    let applicationRootBeforeTest: string | undefined;
    let productImageRootBeforeTest: string | undefined;
    let productBuildBeforeTest: string | undefined;

    beforeEach(async () => {
        applicationRootBeforeTest = process.env.NEURO_BOOK_APPLICATION_ROOT;
        productImageRootBeforeTest = process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
        productBuildBeforeTest = process.env.NEURO_BOOK_PRODUCT_BUILD;
        root = testHostPath("tmp", "agent-profile-catalog-test", randomUUID());
        installRoot = join(root, "assets", "workspace", ".nbook", "agent", "profiles");
        projectProfileRoot = join(root, "workspace", "project", ".nbook", "agent", "profiles");
        await mkdir(installRoot, {recursive: true});
        await mkdir(projectProfileRoot, {recursive: true});
    });

    afterEach(async () => {
        if (applicationRootBeforeTest === undefined) delete process.env.NEURO_BOOK_APPLICATION_ROOT;
        else process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRootBeforeTest;
        if (productImageRootBeforeTest === undefined) delete process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT;
        else process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = productImageRootBeforeTest;
        if (productBuildBeforeTest === undefined) delete process.env.NEURO_BOOK_PRODUCT_BUILD;
        else process.env.NEURO_BOOK_PRODUCT_BUILD = productBuildBeforeTest;
        await rm(root, {recursive: true, force: true});
    });

    it("Project workspace 传入真实 root 后使用 .nbook/agent/profiles 并覆盖 Install profile", async () => {
        const installProfile = "custom.scope.profile.tsx";
        await writeProfile(installRoot, installProfile, profileSource("custom.scope", "Install"));
        await compileRoot(installRoot, installProfile);
        const projectRoot = join(root, "workspace", "project-alpha");
        const scopedProfileRoot = join(projectRoot, ".nbook", "agent", "profiles");
        await writeProfile(scopedProfileRoot, installProfile, profileSource("custom.scope", "Project"));
        const ref = projectWorkspaceRef("project-alpha");
        await compileRoot(scopedProfileRoot, installProfile);
        const workspace = resolvedProjectWorkspace(ref, absoluteFsPath(projectRoot), createProjectWorkspaceKey(absoluteFsPath(join(root, "workspace")), ref));
        const catalog = createTestCatalog(installRoot);
        const scoped = catalog.forProjectWorkspace(workspace);
        await expect(scoped.get("custom.scope")).resolves.toMatchObject({manifest: {name: "Project"}});
        await expect(catalog.get("custom.scope")).resolves.toMatchObject({manifest: {name: "Install"}});
    });
    it("Project child watcher 事件交给 Project coordinator 构建并不触发 Install coordinator", async () => {
        const ref = projectWorkspaceRef("project-build");
        const projectRoot = join(root, "workspace", "project-build");
        const scopedProfileRoot = join(projectRoot, ".nbook", "agent", "profiles");
        const workspace = resolvedProjectWorkspace(ref, absoluteFsPath(projectRoot), createProjectWorkspaceKey(absoluteFsPath(join(root, "workspace")), ref));
        const catalog = createTestCatalog(installRoot);
        const installEnqueued: Array<{fileName?: string; reason: string}> = [];
        const projectEnqueued: Array<{fileName?: string; reason: string}> = [];
        const coordinator = (enqueued: Array<{fileName?: string; reason: string}>) => ({
            stateFor: () => ({running: false, queued: false, reason: null, updatedAt: null}),
            enqueue: async (input: {fileName?: string; reason: string}) => {
                enqueued.push(input);
            },
        });
        catalog.attachBuildCoordinator(coordinator(installEnqueued), (child) => {
            expect(child).not.toBe(catalog);
            return coordinator(projectEnqueued);
        });
        const scoped = catalog.forProjectWorkspace(workspace);
        const internal = scoped as unknown as {
            handleWatchEvent(event: {eventName: string; changedPath: string; kind: "project_profile"; fileName: string}): void;
        };

        internal.handleWatchEvent({
            eventName: "change",
            changedPath: join(scopedProfileRoot, "custom.project.profile.tsx"),
            kind: "project_profile",
            fileName: "custom.project.profile.tsx",
        });
        await Promise.resolve();

        expect(installEnqueued).toEqual([]);
        expect(projectEnqueued).toEqual([{
            fileName: "custom.project.profile.tsx",
            reason: "watch:change",
        }]);
    });
    it("坏 profile 进入 issue，不阻断其他 profile", async () => {
        await writeProfile(installRoot, "good.profile.tsx", `
            import {Type, defineAgentProfile, toolset} from "nbook/profile-sdk";
            export const profileManifest = { key: "custom.good", name: "Good" } as const;
            export type Initial = { topic: string };
            export type Output = { result: string };
            export default defineAgentProfile({
                manifest: profileManifest,
                initialSchema: Type.Object({ topic: Type.String() }),
                outputSchema: Type.Object({ result: Type.String() }),
                tools: toolset(),
                prepare() { return { systemPrompt: "ok" }; },
            });
        `);
        await writeProfile(installRoot, "bad.profile.tsx", "export default { manifest: { key: 'bad', name: 'Bad' } };");
        await compileRoot(installRoot, "good.profile.tsx");
        const catalog = createTestCatalog(installRoot, projectProfileRoot);
        catalog.register(defaultAgentProfile);

        const snapshot = await catalog.snapshot();

        expect(snapshot.profiles.map((profile) => profile.key)).toContain("custom.good");
        expect(snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "not_compiled",
            }),
        ]));
    });
    it("watcher 按 Project 优先分类嵌套根与 dependency 事件", async () => {
        const ref = projectWorkspaceRef("nested");
        const projectRoot = join(root, "workspace", "nested", ".nbook", "agent", "profiles");
        const events: Array<{kind: string; fileName?: string}> = [];
        const {ProfileSourceWatcher} = await import("nbook/server/agent/profiles/profile-source-watcher");
        const watcher = new ProfileSourceWatcher({
            installRoot: join(root, "workspace", ".nbook", "agent", "profiles"),
            projectRoot,
            onEvent: (event) => events.push({kind: event.kind, fileName: event.fileName}),
            onError: () => undefined,
        });
        const internal = watcher as unknown as {
            classifyEvent(eventName: string, changedPath: string): {kind: string; fileName?: string};
        };

        expect(internal.classifyEvent("change", join(projectRoot, "custom.profile.tsx"))).toEqual(expect.objectContaining({kind: "project_profile", fileName: "custom.profile.tsx"}));
        expect(internal.classifyEvent("change", join(projectRoot, "helper.ts"))).toEqual(expect.objectContaining({kind: "project_dependency"}));
        expect(internal.classifyEvent("change", join(root, "workspace", ".nbook", "agent", "profiles", "builtin.profile.tsx"))).toEqual(expect.objectContaining({kind: "install_profile", fileName: "builtin.profile.tsx"}));
        void ref;
        void events;
    });

    it("用户 profile 按 key 覆盖系统 profile", async () => {
        await writeProfile(installRoot, "custom.same.profile.tsx", profileSource("custom.same", "System"));
        await writeProfile(projectProfileRoot, "custom.same.profile.tsx", profileSource("custom.same", "User"));
        await compileRoot(installRoot);
        await compileRoot(projectProfileRoot);
        const catalog = createTestCatalog(installRoot, projectProfileRoot);

        const profile = await catalog.get("custom.same");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("User");
        expect(snapshot.profiles.find((item) => item.key === "custom.same")).toEqual(expect.objectContaining({
            name: "User",
            source: "project",
            loadStatus: "loaded",
        }));
    });

    it("resolveMany 批量返回 loaded、missing 和 unloadable", async () => {
        await writeProfile(installRoot, "custom.loaded.profile.tsx", profileSource("custom.loaded", "Loaded"));
        await writeProfile(installRoot, "custom.unloadable.profile.tsx", "export default { manifest: { key: 'custom.unloadable', name: 'Broken' } };");
        await compileRoot(installRoot, "custom.loaded.profile.tsx");
        const catalog = createTestCatalog(installRoot, projectProfileRoot);

        const resolved = await catalog.resolveMany(["custom.loaded", "custom.missing", "custom.unloadable"]);

        expect(resolved.get("custom.loaded")).toEqual(expect.objectContaining({
            availability: "loaded",
            profile: expect.objectContaining({
                manifest: expect.objectContaining({key: "custom.loaded"}),
            }),
        }));
        expect(resolved.get("custom.missing")).toEqual(expect.objectContaining({
            availability: "missing",
            profile: null,
        }));
        expect(resolved.get("custom.unloadable")).toEqual(expect.objectContaining({
            availability: "unloadable",
            profile: null,
            issueMessage: expect.stringContaining("未编译"),
        }));
    });

    it("热路径命中 catalog cache，不重复扫描 inventory", async () => {
        await writeProfile(installRoot, "custom.cached.profile.tsx", profileSource("custom.cached", "Cached"));
        await compileRoot(installRoot);
        const catalog = createTestCatalog(installRoot, projectProfileRoot);
        const instrumented = catalog as unknown as {
            readProfileInventory: () => Promise<unknown>;
        };
        const originalReadProfileInventory = instrumented.readProfileInventory.bind(catalog);
        let inventoryReads = 0;
        instrumented.readProfileInventory = async () => {
            inventoryReads += 1;
            return originalReadProfileInventory();
        };

        await catalog.get("custom.cached");
        await catalog.get("custom.cached");
        await catalog.resolveMany(["custom.cached"]);
        await catalog.snapshot();

        expect(inventoryReads).toBe(1);

        catalog.invalidate();
        await catalog.get("custom.cached");

        expect(inventoryReads).toBe(2);
    });

    it("invalidate 后旧 loadAll promise 不能回写 stale catalog cache", async () => {
        await writeProfile(installRoot, "custom.race.profile.tsx", profileSource("custom.race", "Race V1"));
        await compileRoot(installRoot);
        const catalog = createTestCatalog(installRoot, projectProfileRoot);
        const instrumented = catalog as unknown as {
            loadInventory: (inventory: unknown) => Promise<unknown>;
        };
        const originalLoadInventory = instrumented.loadInventory.bind(catalog);
        const staleLoadReady = createDeferred();
        const releaseStaleLoad = createDeferred();
        let loadInventoryCalls = 0;
        instrumented.loadInventory = async (inventory: unknown) => {
            loadInventoryCalls += 1;
            const loaded = await originalLoadInventory(inventory);
            if (loadInventoryCalls === 1) {
                staleLoadReady.resolve();
                await releaseStaleLoad.promise;
            }
            return loaded;
        };

        const staleProfilePromise = catalog.get("custom.race");
        await staleLoadReady.promise;
        await writeProfile(installRoot, "custom.race.profile.tsx", profileSource("custom.race", "Race V2"));
        await compileRoot(installRoot);
        catalog.invalidate();

        const freshProfile = await catalog.get("custom.race");
        releaseStaleLoad.resolve();
        const staleProfile = await staleProfilePromise;
        const cachedProfile = await catalog.get("custom.race");

        expect(loadInventoryCalls).toBe(2);
        expect((await staleProfile.prepare!(context())).systemPrompt).toBe("Race V1");
        expect((await freshProfile.prepare!(context())).systemPrompt).toBe("Race V2");
        expect((await cachedProfile.prepare!(context())).systemPrompt).toBe("Race V2");
    });

    it("profile watcher 会把外部源码和 compiled artifact 变化标记为 dirty", async () => {
        await writeProfile(installRoot, "prompt-helper.ts", `export const helperText = "watch-v1";`);
        await writeProfile(installRoot, "custom.watch.profile.tsx", `
            import {Type, defineAgentProfile, toolset} from "nbook/profile-sdk";
            import {helperText} from "./prompt-helper";

            export const profileManifest = { key: "custom.watch", name: "Watch" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                initialSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                tools: toolset(),
                prepare() { return { systemPrompt: helperText }; },
            });
        `);
        await compileRoot(installRoot);
        const catalog = createTestCatalog(installRoot, projectProfileRoot);
        await catalog.startWatching();
        try {
            const firstProfile = await catalog.get("custom.watch");
            expect((await firstProfile.prepare!(context())).systemPrompt).toBe("watch-v1");

            await writeProfile(installRoot, "prompt-helper.ts", `export const helperText = "watch-v2";`);
            await compileRoot(installRoot);

            await waitFor(async () => {
                const nextProfile = await catalog.get("custom.watch");
                expect((await nextProfile.prepare!(context())).systemPrompt).toBe("watch-v2");
            }, 3_000);
        } finally {
            await catalog.dispose();
        }
    });

    it("profile watcher 启动期 error 会清理 watcher 并允许重试", async () => {
        const catalog = createTestCatalog(installRoot, projectProfileRoot);
        const internal = catalog as unknown as {
            sourceWatcher?: {
                watcher: {
                    emit(eventName: "error", error: Error): boolean;
                } | null;
            };
        };

        const start = catalog.startWatching();
        internal.sourceWatcher?.watcher?.emit("error", new Error("watch startup failed"));

        await expect(start).rejects.toThrow("watch startup failed");
        expect(internal.sourceWatcher?.watcher).toBeNull();

        await catalog.startWatching();
        expect(internal.sourceWatcher?.watcher).not.toBeNull();
        await catalog.dispose();
    });

    it("profile watcher 收到用户 profile unlink 时触发 full build", async () => {
        const catalog = createTestCatalog(installRoot, projectProfileRoot);
        const enqueued: Array<{fileName?: string; reason: string}> = [];
        catalog.attachBuildCoordinator({
            stateFor() {
                return {
                    running: false,
                    queued: false,
                    reason: null,
                    updatedAt: null,
                };
            },
            async enqueue(input) {
                enqueued.push(input);
            },
        });
        const internal = catalog as unknown as {
            handleWatchEvent(event: {eventName: string; changedPath: string; kind: "project_profile"; fileName: string}): void;
        };

        internal.handleWatchEvent({
            eventName: "unlink",
            changedPath: join(projectProfileRoot, "custom.deleted.profile.tsx"),
            kind: "project_profile",
            fileName: "custom.deleted.profile.tsx",
        });
        await Promise.resolve();

        expect(enqueued).toEqual([{
            reason: "watch:unlink",
        }]);
    });

    it("dispose 先停止 watcher producer，再停止 build coordinator", async () => {
        const catalog = createTestCatalog(installRoot, projectProfileRoot);
        const order: string[] = [];
        const internal = catalog as unknown as {
            sourceWatcher?: {dispose(): Promise<void>};
            buildCoordinator?: {dispose(): Promise<void>};
        };
        internal.sourceWatcher = {
            async dispose() {
                order.push("watcher");
            },
        };
        internal.buildCoordinator = {
            async dispose() {
                order.push("coordinator");
            },
        };

        await catalog.dispose();

        expect(order).toEqual(["watcher", "coordinator"]);
        expect(internal.sourceWatcher).toBeUndefined();
        expect(internal.buildCoordinator).toBeUndefined();
    });

    it("加载 TSX DSL profile 时使用自动 JSX runtime", async () => {
        await writeProfile(installRoot, "custom.jsx.profile.tsx", `
            /** @jsxImportSource nbook/profile-sdk */
            /** @jsxRuntime automatic */
            import {Type, defineAgentProfile, toolset, AppendingSet, Message, ProfilePrompt, System} from "nbook/profile-sdk";

            export const profileManifest = { key: "custom.jsx", name: "JSX" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                initialSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                tools: toolset(),
                context() {
                    return (
                        <ProfilePrompt>
                            <System>system</System>
                            <AppendingSet>
                                <Message>append</Message>
                            </AppendingSet>
                        </ProfilePrompt>
                    );
                },
            });
        `);
        await compileRoot(installRoot);
        const catalog = createTestCatalog(installRoot, projectProfileRoot);

        const profile = await catalog.get("custom.jsx");
        const prepared = await profile.prepare!(context());

        expect(prepared.systemPrompt).toBe("system");
        expect((prepared.appendingMessages ?? []).map(messageText)).toEqual(["append"]);
    });

    it("profile 编译产物包含 session variable authoring types", async () => {
        await writeProfile(installRoot, "custom.session-types.profile.tsx", `
            import {Type, defineAgentProfile, defineSessionVariable, toolset} from "nbook/profile-sdk";

            export const profileManifest = { key: "custom.sessionTypes", name: "Session Types" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                initialSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                tools: toolset(),
                variableDefinitions: [
                    defineSessionVariable({
                        key: "draftGoal",
                        schema: Type.String(),
                    }),
                ],
                prepare() {
                    return {};
                },
            });
        `);
        const result = await compileProfileArtifacts({
            profileRoot: installRoot,
            fileName: "custom.session-types.profile.tsx",
            rootLabel: "test-system-profiles",
        });
        const item = result.compiled[0];

        expect(item?.registeredVariablePaths).toEqual(["session.draftGoal"]);
        expectContentAddressedArtifact(item!);
        expect(await readFile(compiledTypeArtifactPath(installRoot, item!), "utf8")).toContain("\"session.draftGoal\": string;");
    });

    it("profile 编译产物使用 artifact-local import.meta.url require banner", async () => {
        await writeProfile(installRoot, "custom.banner.profile.tsx", profileSource("custom.banner", "Banner"));

        const result = await compileProfileArtifacts({
            profileRoot: installRoot,
            fileName: "custom.banner.profile.tsx",
            rootLabel: "test-system-profiles",
        });
        const item = result.compiled[0]!;
        const artifactPath = compiledArtifactPath(installRoot, item);
        const artifact = await readFile(artifactPath, "utf8");
        const artifactHash = await hashFile(artifactPath);
        const head = artifact.slice(0, 2048);

        expect(item.artifactSha256).toBe(artifactHash.sha256);
        expect(item.artifactBytes).toBe(artifactHash.bytes);
        expect(head).toContain(`nbook-profile-artifact-compiler-version:${PROFILE_ARTIFACT_COMPILER_VERSION}`);
        expect(head).toContain("__nbookCreateRequire(import.meta.url)");
        expect(head).not.toContain("globalThis._importMeta_");
        await expect(validateProfileArtifact(installRoot, item, {}, "test-system-profiles")).resolves.toEqual({fresh: true});
    });

    it("相同 Profile 从不同物理根编译时生成同一内容寻址 artifact", async () => {
        const firstRoot = join(root, "profile-root-a", "profiles");
        const secondRoot = join(root, "profile-root-b", "profiles");
        const fileName = "builtin/custom.reproducible.profile.tsx";
        const source = `
            import {Type, defineAgentProfile, toolset} from "nbook/profile-sdk";
            export default defineAgentProfile({
                manifest: {key: "custom.reproducible", name: "Reproducible"},
                initialSchema: Type.Object({}),
                tools: toolset(),
                context() { return []; },
            });
        `;
        await writeProfile(firstRoot, fileName, source);
        await writeProfile(secondRoot, fileName, source);

        const productCompileOptions = {
            fileName,
            rootLabel: "assets/workspace/.nbook/agent/profiles",
            manifestGeneratedAt: new Date(0).toISOString(),
        } as const;
        const first = await compileProfileArtifacts({profileRoot: firstRoot, ...productCompileOptions});
        const second = await compileProfileArtifacts({profileRoot: secondRoot, ...productCompileOptions});
        expect(first.compiled, JSON.stringify(first.manifest.entries, null, 2)).toHaveLength(1);
        expect(second.compiled, JSON.stringify(second.manifest.entries, null, 2)).toHaveLength(1);
        const firstItem = first.compiled[0]!;
        const secondItem = second.compiled[0]!;
        const firstArtifact = await readFile(compiledArtifactPath(firstRoot, firstItem), "utf8");
        const secondArtifact = await readFile(compiledArtifactPath(secondRoot, secondItem), "utf8");

        expect(secondItem.artifactSha256).toBe(firstItem.artifactSha256);
        expect(secondItem.artifactFileName).toBe(firstItem.artifactFileName);
        expect(secondArtifact).toBe(firstArtifact);
        expect(first.manifest.generatedAt).toBe("1970-01-01T00:00:00.000Z");
        expect(second.manifest.generatedAt).toBe(first.manifest.generatedAt);
        expect(firstArtifact).not.toContain("profile-root-a");
        expect(secondArtifact).not.toContain("profile-root-b");
    });
    it("同一 Profile 移动到另一物理根后依赖 freshness 仍正确", async () => {
        const firstRoot = join(root, "profile-root-dependency-a", "profiles");
        const secondRoot = join(root, "profile-root-dependency-b", "profiles");
        const fileName = "builtin/custom.movable.profile.tsx";
        const source = `
            import {Type, defineAgentProfile, toolset} from "nbook/profile-sdk";
            import {helperText} from "./prompt-helper";

            export default defineAgentProfile({
                manifest: {key: "custom.movable", name: "Movable"},
                initialSchema: Type.Object({}),
                tools: toolset(),
                prepare() { return {systemPrompt: helperText}; },
            });
        `;
        await Promise.all([
            writeProfile(firstRoot, "builtin/custom.movable.profile.tsx", source),
            writeProfile(secondRoot, "builtin/custom.movable.profile.tsx", source),
            writeProfile(firstRoot, "builtin/prompt-helper.ts", `export const helperText = "moved";`),
            writeProfile(secondRoot, "builtin/prompt-helper.ts", `export const helperText = "moved";`),
        ]);

        const compileOptions = {
            fileName,
            rootLabel: "workspace/.nbook/agent/profiles",
            manifestGeneratedAt: new Date(0).toISOString(),
        } as const;
        const first = await compileProfileArtifacts({profileRoot: firstRoot, ...compileOptions});
        const second = await compileProfileArtifacts({profileRoot: secondRoot, ...compileOptions});
        expect(first.compiled, JSON.stringify(first.manifest.entries, null, 2)).toHaveLength(1);
        expect(second.compiled, JSON.stringify(second.manifest.entries, null, 2)).toHaveLength(1);
        const firstItem = first.compiled[0]!;
        const secondItem = second.compiled[0]!;

        expect(firstItem.dependencies.map((dependency) => dependency.path)).toEqual(
            secondItem.dependencies.map((dependency) => dependency.path),
        );
        await rm(firstRoot, {recursive: true, force: true});
        await expect(validateProfileArtifact(secondRoot, firstItem, {requireTypeArtifact: true})).resolves.toEqual({fresh: true});
    });

    it("profile 编译产物包含 Nitro importMeta shim 时强制过期", async () => {
        await writeProfile(installRoot, "custom.bad-shim.profile.tsx", profileSource("custom.badShim", "Bad Shim"));
        const result = await compileProfileArtifacts({
            profileRoot: installRoot,
            fileName: "custom.bad-shim.profile.tsx",
            rootLabel: "test-system-profiles",
        });
        const item = result.compiled[0]!;
        const artifactPath = compiledArtifactPath(installRoot, item);
        const artifact = await readFile(artifactPath, "utf8");
        await writeFile(artifactPath, artifact.replace("import.meta.url", "globalThis._importMeta_.url"), "utf8");
        const badHash = await hashFile(artifactPath);

        await expect(validateProfileArtifact(installRoot, {
            ...item,
            artifactSha256: badHash.sha256,
            artifactBytes: badHash.bytes,
        })).resolves.toEqual({
            fresh: false,
            reason: "artifact_changed",
        });
    });

    it("runtime registry warm 后 get 只读内存，显式 refresh 后才感知 artifact 变化", async () => {
        await writeProfile(installRoot, "custom.registry.profile.tsx", profileSource("custom.registry", "Registry V1"));
        const result = await compileProfileArtifacts({
            profileRoot: installRoot,
            fileName: "custom.registry.profile.tsx",
            rootLabel: "test-system-profiles",
        });
        const item = result.compiled[0]!;
        const catalog = createTestCatalog(installRoot, projectProfileRoot);
        catalog.enableRuntimeRegistry();
        await catalog.refreshRuntimeRegistry("test");
        const profile = await catalog.get("custom.registry");
        await writeFile(compiledArtifactPath(installRoot, item), "export default null;\n", "utf8");

        await expect(catalog.get("custom.registry")).resolves.toBe(profile);
        await catalog.refreshRuntimeRegistry("test-corrupt-artifact");
        await expect(catalog.get("custom.registry")).rejects.toThrow("不可运行");
    });

    it("full compile 使用内容寻址 artifact 并清理旧扁平 artifact", async () => {
        await writeProfile(installRoot, "builtin/custom.stable.profile.tsx", profileSource("custom.stable", "Stable"));
        await mkdir(join(installRoot, ".compiled"), {recursive: true});
        await writeFile(join(installRoot, ".compiled", "old-hash-artifact.mjs"), "export default null;", "utf8");
        await writeFile(join(installRoot, ".compiled", "old-hash-artifact.types.d.ts"), "export {};", "utf8");

        const result = await compileProfileArtifacts({
            profileRoot: installRoot,
            rootLabel: "test-system-profiles",
        });
        const item = result.compiled.find((profile) => profile.profileKey === "custom.stable");

        expectContentAddressedArtifact(item!);
        await expect(readFile(join(installRoot, ".compiled", "old-hash-artifact.mjs"), "utf8")).rejects.toThrow();
        await expect(readFile(join(installRoot, ".compiled", "old-hash-artifact.types.d.ts"), "utf8")).rejects.toThrow();
    });

    it("内容寻址 artifact GC 只删除过 grace 且未被 current manifest 引用的文件", async () => {
        await writeProfile(installRoot, "builtin/custom.gc.profile.tsx", profileSource("custom.gc", "GC"));
        const first = await compileProfileArtifacts({profileRoot: installRoot});
        const item = first.manifest.profiles.find((profile) => profile.profileKey === "custom.gc")!;
        const artifactsDir = join(installRoot, ".compiled", PROFILE_COMPILED_ARTIFACTS_DIR_NAME);
        const oldOrphan = join(artifactsDir, `${"0".repeat(64)}.mjs`);
        const freshOrphan = join(artifactsDir, `${"1".repeat(64)}.mjs`);
        await writeFile(oldOrphan, "export default null;", "utf8");
        await writeFile(freshOrphan, "export default null;", "utf8");
        const oldTime = new Date(Date.now() - PROFILE_COMPILED_ARTIFACT_GC_GRACE_MS - 10_000);
        await utimes(oldOrphan, oldTime, oldTime);

        await compileProfileArtifacts({profileRoot: installRoot});

        await expect(readFile(compiledArtifactPath(installRoot, item), "utf8")).resolves.toContain("nbook-profile-artifact-compiler-version");
        await expect(readFile(oldOrphan, "utf8")).rejects.toThrow();
        await expect(readFile(freshOrphan, "utf8")).resolves.toContain("export default null");
    });

    it("ProfileReleasePublisher 会等待 per-root publish lock 释放后再写 manifest", async () => {
        await writeProfile(installRoot, "custom.locked.profile.tsx", profileSource("custom.locked", "Locked"));
        const staged = await stageProfileArtifacts({profileRoot: installRoot});
        const compiledDir = join(installRoot, PROFILE_COMPILED_DIR_NAME);
        await mkdir(compiledDir, {recursive: true});
        const release = await lockFile(compiledDir, {
            lockfilePath: join(compiledDir, PROFILE_COMPILED_PUBLISH_LOCK),
            realpath: false,
            stale: 30_000,
            update: 10_000,
            retries: {
                retries: 0,
            },
        });
        let settled = false;
        try {
            const publish = new ProfileReleasePublisher({
                profileRoot: installRoot,
                artifactPathContext: await artifactPathContext(installRoot),
                mode: "disk_only",
            }).publishStaged(staged.buildCompiledDir, staged.manifest).then(() => {
                settled = true;
            });
            await sleep(100);
            expect(settled).toBe(false);
            await expect(readFile(join(compiledDir, "manifest.json"), "utf8")).rejects.toThrow();
            await release();
            await publish;
            expect(settled).toBe(true);
            await expect(readFile(join(compiledDir, "manifest.json"), "utf8")).resolves.toContain("custom.locked");
        } finally {
            await rm(staged.buildCompiledDir, {recursive: true, force: true});
            await release().catch(() => undefined);
        }
    });

    it("ProfileReleasePublisher 单 entry 发布会在锁内合并当前 manifest", async () => {
        await writeProfile(installRoot, "custom.first.profile.tsx", profileSource("custom.first", "First"));
        await compileRoot(installRoot);
        await writeProfile(installRoot, "custom.second.profile.tsx", profileSource("custom.second", "Second"));
        const staged = await stageProfileArtifactEntry({
            profileRoot: installRoot,
            fileName: "custom.second.profile.tsx",
        });
        try {
            await new ProfileReleasePublisher({
                profileRoot: installRoot,
                artifactPathContext: await artifactPathContext(installRoot),
                mode: "disk_only",
            }).publishStagedEntry(staged.buildCompiledDir, staged.entry);
            const manifest = await readProfileArtifactManifest(installRoot);

            expect(manifest.entries.map((entry) => entry.profileKey).sort()).toEqual([
                "custom.first",
                "custom.second",
            ]);
        } finally {
            await rm(staged.buildCompiledDir, {recursive: true, force: true});
        }
    });

    it("ProfileReleasePublisher batch entries 发布会在锁内合并当前 manifest", async () => {
        await writeProfile(installRoot, "custom.batch-base.profile.tsx", profileSource("custom.batchBase", "Batch Base"));
        await compileRoot(installRoot);
        await writeProfile(installRoot, "custom.batch-patch.profile.tsx", profileSource("custom.batchPatch", "Batch Patch"));
        await writeProfile(installRoot, "custom.batch-single.profile.tsx", profileSource("custom.batchSingle", "Batch Single"));
        const batch = await stageProfileArtifactEntry({
            profileRoot: installRoot,
            fileName: "custom.batch-patch.profile.tsx",
        });
        const single = await stageProfileArtifactEntry({
            profileRoot: installRoot,
            fileName: "custom.batch-single.profile.tsx",
        });
        try {
            const publisher = new ProfileReleasePublisher({
                profileRoot: installRoot,
                artifactPathContext: await artifactPathContext(installRoot),
                mode: "disk_only",
            });
            await publisher.publishStagedEntry(single.buildCompiledDir, single.entry);
            await publisher.publishStagedEntries(batch.buildCompiledDir, [batch.entry]);
            const manifest = await readProfileArtifactManifest(installRoot);

            expect(manifest.entries.map((entry) => entry.profileKey).sort()).toEqual([
                "custom.batchBase",
                "custom.batchPatch",
                "custom.batchSingle",
            ]);
        } finally {
            await rm(batch.buildCompiledDir, {recursive: true, force: true});
            await rm(single.buildCompiledDir, {recursive: true, force: true});
        }
    });

    it("compileProfileArtifacts 可通过 in-process Publisher 翻转 Registry", async () => {
        await writeProfile(installRoot, "custom.runtime-system.profile.tsx", profileSource("custom.runtimeSystem", "Runtime System"));
        const registryRoots: string[] = [];
        const registryManifests: string[][] = [];

        const result = await compileProfileArtifacts({
            profileRoot: installRoot,
            rootLabel: "assets/workspace/.nbook/agent/profiles",
            publish: {
                mode: "in_process",
                registry: {
                    publishProfileRelease(profileRoot, manifest) {
                        registryRoots.push(profileRoot);
                        registryManifests.push(manifest.entries.map((entry) => entry.profileKey));
                    },
                },
            },
        });

        expect(result.manifest.profilesRoot).toBe("assets/workspace/.nbook/agent/profiles");
        expect(registryRoots).toEqual([installRoot]);
        expect(registryManifests).toEqual([expect.arrayContaining(["custom.runtimeSystem"])]);
    });

    it("ProfileReleasePublisher 同 root 发布会串行到 Registry 翻转完成", async () => {
        await writeProfile(installRoot, "custom.queue-one.profile.tsx", profileSource("custom.queueOne", "Queue One"));
        await writeProfile(installRoot, "custom.queue-two.profile.tsx", profileSource("custom.queueTwo", "Queue Two"));
        const first = await stageProfileArtifactEntry({
            profileRoot: installRoot,
            fileName: "custom.queue-one.profile.tsx",
        });
        const second = await stageProfileArtifactEntry({
            profileRoot: installRoot,
            fileName: "custom.queue-two.profile.tsx",
        });
        const firstRegistryEntered = createDeferred();
        const releaseFirstRegistry = createDeferred();
        const registryCalls: string[][] = [];
        const registry = {
            async publishProfileRelease(_profileRoot: string, manifest: ProfileArtifactManifest): Promise<void> {
                registryCalls.push(manifest.entries.map((entry) => entry.profileKey).sort());
                if (registryCalls.length === 1) {
                    firstRegistryEntered.resolve();
                    await releaseFirstRegistry.promise;
                }
            },
        };
        try {
            const publisher = new ProfileReleasePublisher({
                profileRoot: installRoot,
                artifactPathContext: await artifactPathContext(installRoot),
                mode: "in_process",
                registry,
            });
            const firstPublish = publisher.publishStagedEntry(first.buildCompiledDir, first.entry);
            await firstRegistryEntered.promise;
            const secondPublish = publisher.publishStagedEntry(second.buildCompiledDir, second.entry);
            await sleep(100);

            expect(registryCalls).toEqual([["custom.queueOne"]]);
            await expect(readProfileArtifactManifest(installRoot)).resolves.toEqual(expect.objectContaining({
                profilesRoot: "workspace/.nbook/agent/profiles",
                entries: [expect.objectContaining({profileKey: "custom.queueOne"})],
            }));

            releaseFirstRegistry.resolve();
            await Promise.all([firstPublish, secondPublish]);
            expect(registryCalls).toEqual([
                ["custom.queueOne"],
                ["custom.queueOne", "custom.queueTwo"],
            ]);
        } finally {
            releaseFirstRegistry.resolve();
            await rm(first.buildCompiledDir, {recursive: true, force: true});
            await rm(second.buildCompiledDir, {recursive: true, force: true});
        }
    });

    it("ProfileReleasePublisher 在磁盘已发布但 Registry 失败时抛 committed error 并释放队列", async () => {
        await writeProfile(installRoot, "custom.registry-fail.profile.tsx", profileSource("custom.registryFail", "Registry Fail"));
        await writeProfile(installRoot, "custom.registry-after.profile.tsx", profileSource("custom.registryAfter", "Registry After"));
        const failed = await stageProfileArtifactEntry({
            profileRoot: installRoot,
            fileName: "custom.registry-fail.profile.tsx",
        });
        const after = await stageProfileArtifactEntry({
            profileRoot: installRoot,
            fileName: "custom.registry-after.profile.tsx",
        });
        let registryAttempts = 0;
        const failingPublisher = new ProfileReleasePublisher({
            profileRoot: installRoot,
            artifactPathContext: await artifactPathContext(installRoot),
            mode: "in_process",
            registry: {
                publishProfileRelease() {
                    registryAttempts += 1;
                    throw new Error("registry denied");
                },
            },
        });
        try {
            let caught: unknown;
            try {
                await failingPublisher.publishStagedEntry(failed.buildCompiledDir, failed.entry);
            } catch (error) {
                caught = error;
            }
            const manifestAfterFailure = await readProfileArtifactManifest(installRoot);

            expect(isProfileReleaseCommittedButRegistryFailedError(caught)).toBe(true);
            expect(registryAttempts).toBe(2);
            expect(manifestAfterFailure.entries.map((entry) => entry.profileKey)).toContain("custom.registryFail");
            if (!isProfileReleaseCommittedButRegistryFailedError(caught)) {
                throw new Error("expected committed error");
            }
            expect(caught.manifest.entries.map((entry) => entry.profileKey)).toContain("custom.registryFail");

            await new ProfileReleasePublisher({
                profileRoot: installRoot,
                artifactPathContext: await artifactPathContext(installRoot),
                mode: "disk_only",
            }).publishStagedEntry(after.buildCompiledDir, after.entry);
            const manifestAfterRecovery = await readProfileArtifactManifest(installRoot);
            expect(manifestAfterRecovery.entries.map((entry) => entry.profileKey).sort()).toEqual([
                "custom.registryAfter",
                "custom.registryFail",
            ]);
        } finally {
            await rm(failed.buildCompiledDir, {recursive: true, force: true});
            await rm(after.buildCompiledDir, {recursive: true, force: true});
        }
    });

    it("ProfileReleasePublisher full 与 batch 发布也使用 committed error 契约", async () => {
        await writeProfile(installRoot, "custom.full-fail.profile.tsx", profileSource("custom.fullFail", "Full Fail"));
        await writeProfile(installRoot, "custom.batch-fail.profile.tsx", profileSource("custom.batchFail", "Batch Fail"));
        const full = await stageProfileArtifacts({
            profileRoot: installRoot,
            rootLabel: "workspace/.nbook/agent/profiles",
        });
        const batch = await stageProfileArtifactEntry({
            profileRoot: installRoot,
            fileName: "custom.batch-fail.profile.tsx",
        });
        const registry = {
            publishProfileRelease() {
                throw new Error("registry denied");
            },
        };
        try {
            await expect(new ProfileReleasePublisher({
                profileRoot: installRoot,
                artifactPathContext: await artifactPathContext(installRoot),
                mode: "in_process",
                registry,
            }).publishStaged(full.buildCompiledDir, full.manifest)).rejects.toBeInstanceOf(ProfileReleaseCommittedButRegistryFailedError);
            await expect(new ProfileReleasePublisher({
                profileRoot: installRoot,
                artifactPathContext: await artifactPathContext(installRoot),
                mode: "in_process",
                registry,
            }).publishStagedEntries(batch.buildCompiledDir, [batch.entry])).rejects.toBeInstanceOf(ProfileReleaseCommittedButRegistryFailedError);
        } finally {
            await rm(full.buildCompiledDir, {recursive: true, force: true});
            await rm(batch.buildCompiledDir, {recursive: true, force: true});
        }
    });

    it("compileProfileArtifacts full replacement 发布前发现 source file set 变化时不发布", async () => {
        await writeProfile(installRoot, "aaa.slow.profile.tsx", `await new Promise((resolve) => setTimeout(resolve, 300));\n${profileSource("custom.slow", "Slow")}`);
        const running = compileProfileArtifacts({
            profileRoot: installRoot,
            rootLabel: "assets/workspace/.nbook/agent/profiles",
        });
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
        await writeProfile(installRoot, "zzz.added.profile.tsx", profileSource("custom.added", "Added"));

        await expect(running).rejects.toBeInstanceOf(ProfileArtifactSourceFileSetChangedError);
        const manifest = await readProfileArtifactManifest(installRoot);
        expect(manifest.entries).toEqual([]);
    }, 120000);

    it("ProfileReleaseStore 会在发布锁内修复同名 corrupt artifact", async () => {
        const fileName = "custom.corrupt.profile.tsx";
        await writeProfile(installRoot, fileName, profileSource("custom.corrupt", "Corrupt"));
        const first = await stageProfileArtifactEntry({
            profileRoot: installRoot,
            fileName,
        });
        const second = await stageProfileArtifactEntry({
            profileRoot: installRoot,
            fileName,
        });
        try {
            const publisher = new ProfileReleasePublisher({
                profileRoot: installRoot,
                artifactPathContext: await artifactPathContext(installRoot),
                mode: "disk_only",
            });
            await publisher.publishStagedEntry(first.buildCompiledDir, first.entry);
            const manifest = await readProfileArtifactManifest(installRoot);
            const item = manifest.profiles.find((profile) => profile.fileName === fileName)!;
            await writeFile(compiledArtifactPath(installRoot, item), "export default { corrupt: true };\n", "utf8");
            await expect(validateProfileArtifact(installRoot, item)).resolves.toEqual({
                fresh: false,
                reason: "artifact_changed",
            });
            await publisher.publishStagedEntry(second.buildCompiledDir, second.entry);

            await expect(validateProfileArtifact(installRoot, item)).resolves.toEqual({fresh: true});
        } finally {
            await rm(first.buildCompiledDir, {recursive: true, force: true});
            await rm(second.buildCompiledDir, {recursive: true, force: true});
        }
    });

    it("manifest 使用 profileKey 映射并记录失败 profile 状态", async () => {
        await writeProfile(installRoot, "custom.manifest.profile.tsx", profileSource("custom.manifest", "Manifest"));
        await writeProfile(installRoot, "custom.bad.profile.tsx", "export default null;");

        await compileRoot(installRoot);
        const raw = JSON.parse(await readFile(join(installRoot, ".compiled", "manifest.json"), "utf8")) as {
            profiles?: {
                "custom.manifest"?: {
                    status?: string;
                    artifactSha?: string;
                    artifactFileName?: string;
                };
                "custom.bad"?: {
                    status?: string;
                    issues?: Array<{code?: string; message?: string}>;
                };
            };
        };

        expect(Array.isArray(raw.profiles)).toBe(false);
        expect(raw.profiles?.["custom.manifest"]?.status).toBe("loaded");
        expect(raw.profiles?.["custom.manifest"]?.artifactSha).toMatch(/^[a-f0-9]{64}$/);
        expect(raw.profiles?.["custom.manifest"]?.artifactFileName).toBeUndefined();
        expect(raw.profiles?.["custom.bad"]?.status).toBe("compile_failed");
        expect(raw.profiles?.["custom.bad"]?.issues?.[0]).toEqual(expect.objectContaining({
            code: "compile_failed",
        }));
    });

    it("TSX profile 依赖 helper 文件变化时重新编译缓存", async () => {
        await writeProfile(installRoot, "prompt-helper.ts", `export const helperText = "v1";`);
        await writeProfile(installRoot, "custom.helper.profile.tsx", `
            import {Type, defineAgentProfile, toolset} from "nbook/profile-sdk";
            import {helperText} from "./prompt-helper";

            export const profileManifest = { key: "custom.helper", name: "Helper" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                initialSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                tools: toolset(),
                prepare() { return { systemPrompt: helperText }; },
            });
        `);

        await compileRoot(installRoot);
        const firstCatalog = createTestCatalog(installRoot, projectProfileRoot);
        const firstProfile = await firstCatalog.get("custom.helper");
        expect((await firstProfile.prepare!(context())).systemPrompt).toBe("v1");

        await writeProfile(installRoot, "prompt-helper.ts", `export const helperText = "v2";`);
        firstCatalog.invalidate();
        const unchangedProfile = await firstCatalog.get("custom.helper");
        expect((await unchangedProfile.prepare!(context())).systemPrompt).toBe("v1");

        await compileRoot(installRoot);
        firstCatalog.invalidate();
        const secondProfile = await firstCatalog.get("custom.helper");

        expect((await secondProfile.prepare!(context())).systemPrompt).toBe("v2");
    });

    it("用户 profile 依赖变化不会由 catalog reader 重复 rehash", async () => {
        await writeProfile(projectProfileRoot, "prompt-helper.ts", `export const helperText = "v1";`);
        await writeProfile(projectProfileRoot, "custom.user-helper.profile.tsx", `
            import {Type, defineAgentProfile, toolset} from "nbook/profile-sdk";
            import {helperText} from "./prompt-helper";

            export const profileManifest = { key: "custom.user-helper", name: "User Helper" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                initialSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                tools: toolset(),
                prepare() { return { systemPrompt: helperText }; },
            });
        `);
        await compileRoot(projectProfileRoot);
        const firstCatalog = createTestCatalog(installRoot, projectProfileRoot);
        const firstProfile = await firstCatalog.get("custom.user-helper");
        expect((await firstProfile.prepare!(context())).systemPrompt).toBe("v1");

        await writeProfile(projectProfileRoot, "prompt-helper.ts", `export const helperText = "v2";`);
        firstCatalog.invalidate();
        const unchangedProfile = await firstCatalog.get("custom.user-helper");
        expect((await unchangedProfile.prepare!(context())).systemPrompt).toBe("v1");

        await compileRoot(projectProfileRoot);
        firstCatalog.invalidate();
        const secondProfile = await firstCatalog.get("custom.user-helper");
        expect((await secondProfile.prepare!(context())).systemPrompt).toBe("v2");
    });

    it("用户 profile 源码变化但未编译时标记 compile_stale 且不可运行", async () => {
        await writeProfile(projectProfileRoot, "custom.unsaved.profile.tsx", profileSource("custom.unsaved", "Compiled Version"));
        await compileRoot(projectProfileRoot);
        await writeProfile(projectProfileRoot, "custom.unsaved.profile.tsx", profileSource("custom.unsaved", "Edited Source"));
        const catalog = createTestCatalog(installRoot, projectProfileRoot);

        const snapshot = await catalog.snapshot();

        await expect(catalog.get("custom.unsaved")).rejects.toThrow("不可运行");
        expect(snapshot.profiles.find((item) => item.key === "custom.unsaved")).toEqual(expect.objectContaining({
            loadStatus: "compile_stale",
            source: "project",
            issue: expect.objectContaining({
                code: "compile_stale",
            }),
        }));
        expect(snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "compile_stale",
                profileKey: "custom.unsaved",
            }),
        ]));
    });

    it("用户 profile 依赖变化且 artifact 损坏时不可运行", async () => {
        await writeProfile(projectProfileRoot, "prompt-helper.ts", `export const helperText = "v1";`);
        await writeProfile(projectProfileRoot, "custom.broken-artifact.profile.tsx", `
            import {Type, defineAgentProfile, toolset} from "nbook/profile-sdk";
            import {helperText} from "./prompt-helper";

            export const profileManifest = { key: "custom.broken-artifact", name: "Broken Artifact" } as const;
            export default defineAgentProfile({
                manifest: profileManifest,
                initialSchema: Type.Object({}),
                outputSchema: Type.Object({}),
                tools: toolset(),
                prepare() { return { systemPrompt: helperText }; },
            });
        `);
        await compileRoot(projectProfileRoot);
        const manifest = await readProfileArtifactManifest(projectProfileRoot);
        const manifestItem = manifest.profiles.find((item) => item.profileKey === "custom.broken-artifact")!;
        await writeProfile(projectProfileRoot, "prompt-helper.ts", `export const helperText = "v2";`);
        await writeFile(compiledArtifactPath(projectProfileRoot, manifestItem), "export default null;", "utf8");
        const catalog = createTestCatalog(installRoot, projectProfileRoot);

        const snapshot = await catalog.snapshot();

        expect(snapshot.profiles.find((item) => item.key === "custom.broken-artifact")).toEqual(expect.objectContaining({
            loadStatus: "compile_stale",
            issue: expect.objectContaining({
                code: "compile_stale",
            }),
        }));
        await expect(catalog.get("custom.broken-artifact")).rejects.toThrow("不可运行");
    });

    it("builtin 覆盖只替换运行时实现，不替换锁定 schema", async () => {
        await writeProfile(projectProfileRoot, "leader.default.profile.tsx", `
            import {Type, defineAgentProfile, toolset} from "nbook/profile-sdk";
            export const profileManifest = { key: "leader.default", name: "User Leader" } as const;
            export type Initial = { changed: string };
            export type Output = { changed: string };
            export default defineAgentProfile({
                manifest: profileManifest,
                initialSchema: Type.Object({ changed: Type.String() }),
                outputSchema: Type.Object({ changed: Type.String() }),
                tools: toolset(),
                prepare() { return { systemPrompt: "user" }; },
            });
        `);
        await compileRoot(projectProfileRoot);
        const catalog = createTestCatalog(installRoot, projectProfileRoot);
        catalog.register(defaultAgentProfile);

        const profile = await catalog.get("leader.default");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("User Leader");
        expect(profile.initialSchema).toEqual(defaultAgentProfile.initialSchema);
        expect(snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: "builtin_schema_locked",
                profileKey: "leader.default",
            }),
        ]));
    });

    it("系统 leader.default schema 与 builtin contract 一致时不产生 schema lock issue", async () => {
        await writeProfile(installRoot, "leader.default.profile.tsx", `
            import {defineAgentProfile, toolset, LeaderDefaultInitialSchema, LeaderDefaultOutputSchema} from "nbook/profile-sdk";
            export const profileManifest = { key: "leader.default", name: "System Leader" } as const;
            export type Initial = typeof LeaderDefaultInitialSchema.static;
            export type Output = typeof LeaderDefaultOutputSchema.static;
            export default defineAgentProfile({
                manifest: profileManifest,
                initialSchema: LeaderDefaultInitialSchema,
                outputSchema: LeaderDefaultOutputSchema,
                tools: toolset(),
                prepare() { return { systemPrompt: "system" }; },
            });
        `);
        await compileRoot(installRoot);
        const catalog = createTestCatalog(installRoot, projectProfileRoot);
        catalog.register(defaultAgentProfile);

        const profile = await catalog.get("leader.default");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("System Leader");
        expect(snapshot.issues.some((issue) => issue.code === "builtin_schema_locked")).toBe(false);
    });

    it("内存 builtin 可参与 snapshot schema", async () => {
        const catalog = createTestCatalog(installRoot, projectProfileRoot);
        catalog.register(defineAgentProfile({
            manifest: {
                key: "memory.profile",
                name: "Memory",
            },
            initialSchema: Type.Object({}),
            tools: profileToolsFromKeys([]),
            prepare() {
                return {};
            },
        }));

        await expect(catalog.snapshot()).resolves.toEqual(expect.objectContaining({
            profiles: [
                expect.objectContaining({
                    key: "memory.profile",
                    source: "memory",
                    builtin: true,
                }),
            ],
        }));
    });

    it("文件名与 manifest key 不一致只产生 warning issue，不阻断加载", async () => {
        await writeProfile(installRoot, "wrong-name.profile.tsx", profileSource("custom.right-name", "Right"));
        await compileRoot(installRoot);
        const catalog = createTestCatalog(installRoot, projectProfileRoot);

        const profile = await catalog.get("custom.right-name");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("Right");
        expect(snapshot.issues).toEqual([
            expect.objectContaining({
                code: "filename_mismatch",
                profileKey: "custom.right-name",
            }),
        ]);
    });

    it("未编译 profile 不可运行，并在 snapshot 中标记 not_compiled", async () => {
        await writeProfile(installRoot, "custom.needs-compile.profile.tsx", profileSource("custom.needs-compile", "Needs Compile"));
        const catalog = createTestCatalog(installRoot, projectProfileRoot);

        const snapshot = await catalog.snapshot();

        expect(snapshot.profiles.find((item) => item.key === "custom.needs-compile")?.loadStatus).toBe("not_compiled");
        await expect(catalog.get("custom.needs-compile")).rejects.toThrow("不可运行");
    });

    it("未编译的系统文件会遮蔽同 key 内存 fallback", async () => {
        await writeProfile(installRoot, "leader.default.profile.tsx", profileSource("leader.default", "Stale Leader"));
        const catalog = createTestCatalog(installRoot, projectProfileRoot);
        catalog.register(defaultAgentProfile);

        const snapshot = await catalog.snapshot();

        expect(snapshot.profiles.find((item) => item.key === "leader.default")?.loadStatus).toBe("not_compiled");
        await expect(catalog.get("leader.default")).rejects.toThrow("不可运行");
    });

    it("全量编译失败时发布 compile_failed 且保留已成功 profile", async () => {
        await writeProfile(installRoot, "custom.safe.profile.tsx", profileSource("custom.safe", "Safe"));
        await compileRoot(installRoot);
        const manifestPath = join(installRoot, ".compiled", "manifest.json");
        const previousCatalog = createTestCatalog(installRoot, projectProfileRoot);
        await expect(previousCatalog.get("custom.safe")).resolves.toEqual(expect.objectContaining({
            manifest: expect.objectContaining({key: "custom.safe"}),
        }));

        await writeProfile(installRoot, "custom.bad.profile.tsx", "export default null;");
        await compileRoot(installRoot);

        await expect(readFile(manifestPath, "utf8")).resolves.toContain("\"status\": \"compile_failed\"");
        const nextCatalog = createTestCatalog(installRoot, projectProfileRoot);
        await expect(nextCatalog.get("custom.safe")).resolves.toEqual(expect.objectContaining({
            manifest: expect.objectContaining({key: "custom.safe"}),
        }));
        await expect(nextCatalog.get("custom.bad")).rejects.toThrow("不可运行");
    });

    it("单文件编译失败时发布 compile_failed 且不留下 building artifact", async () => {
        await writeProfile(installRoot, "custom.safe.profile.tsx", profileSource("custom.safe", "Safe"));
        await compileRoot(installRoot);

        await writeProfile(installRoot, "custom.bad.profile.tsx", "export default null;");
        await compileRoot(installRoot, "custom.bad.profile.tsx");

        const compiledEntries = await readdir(join(installRoot, ".compiled"));
        expect(compiledEntries.some((entry) => entry.includes(".building."))).toBe(false);
        const nextCatalog = createTestCatalog(installRoot, projectProfileRoot);
        await expect(nextCatalog.get("custom.safe")).resolves.toEqual(expect.objectContaining({
            manifest: expect.objectContaining({key: "custom.safe"}),
        }));
        await expect(nextCatalog.get("custom.bad")).rejects.toThrow("不可运行");
    });

    it("skipFresh 会在 type artifact 缺失时重新编译 profile", async () => {
        await writeProfile(installRoot, "custom.typed.profile.tsx", profileSource("custom.typed", "Typed"));
        const first = await compileProfileArtifacts({profileRoot: installRoot});
        const firstItem = first.manifest.profiles.find((item) => item.profileKey === "custom.typed")!;
        await rm(compiledTypeArtifactPath(installRoot, firstItem), {force: true});

        const next = await compileProfileArtifacts({profileRoot: installRoot, skipFresh: true});
        const nextItem = next.manifest.profiles.find((item) => item.profileKey === "custom.typed")!;

        expect(next.compiled.map((item) => item.profileKey)).toContain("custom.typed");
        await expect(readFile(compiledTypeArtifactPath(installRoot, nextItem), "utf8")).resolves.toContain("ProfileVariableValueMap");
        await expect(validateProfileArtifact(installRoot, nextItem)).resolves.toEqual({fresh: true});
    });

    it("只读 Product profile 新鲜时零写入，过期时要求重建", async () => {
        const stagingRoot = join(root, "runtime-staging");
        const profilePath = join(installRoot, "custom.readonly.profile.tsx");
        await writeProfile(installRoot, "custom.readonly.profile.tsx", profileSource("custom.readonly", "Readonly"));
        await compileProfileArtifacts({
            profileRoot: installRoot,
            rootLabel: "assets/workspace/.nbook/agent/profiles",
            stagingRoot,
        });
        await rm(stagingRoot, {recursive: true, force: true});
        const manifestPath = join(installRoot, ".compiled", "manifest.json");
        const manifestBefore = await readFile(manifestPath, "utf8");

        const fresh = await compileProfileArtifacts({
            profileRoot: installRoot,
            rootLabel: "assets/workspace/.nbook/agent/profiles",
            skipFresh: true,
            writePolicy: "forbid",
            stagingRoot,
        });
        expect(fresh.compiled).toEqual([]);
        await expect(readFile(stagingRoot, "utf8")).rejects.toThrow();
        expect(await readFile(manifestPath, "utf8")).toBe(manifestBefore);

        await writeFile(profilePath, (await readFile(profilePath, "utf8")).replace("Readonly", "Changed"), "utf8");
        await expect(compileProfileArtifacts({
            profileRoot: installRoot,
            rootLabel: "assets/workspace/.nbook/agent/profiles",
            skipFresh: true,
            writePolicy: "forbid",
            stagingRoot,
        })).rejects.toThrow("请重新构建或安装与源码匹配的 Product");
        await expect(readFile(stagingRoot, "utf8")).rejects.toThrow();
        expect(await readFile(manifestPath, "utf8")).toBe(manifestBefore);
    });

    it("系统 artifact 同步到用户 root 后入口源码依赖可重定位", async () => {
        await writeProfile(installRoot, "builtin/custom.synced.profile.tsx", profileSource("custom.synced", "Synced"));
        await writeProfile(projectProfileRoot, "builtin/custom.synced.profile.tsx", profileSource("custom.synced", "Synced"));
        await compileRoot(installRoot);
        const systemManifest = await readProfileArtifactManifest(installRoot);
        const systemItem = systemManifest.profiles.find((item) => item.profileKey === "custom.synced")!;
        await mkdir(dirname(compiledArtifactPath(projectProfileRoot, systemItem)), {recursive: true});
        await copyFile(compiledArtifactPath(installRoot, systemItem), compiledArtifactPath(projectProfileRoot, systemItem));
        const userItem = rehomeProfileArtifactItem(systemItem, {
            fromRootLabel: "assets/workspace/.nbook/agent/profiles",
            toRootLabel: "workspace/.nbook/agent/profiles",
        });
        expect(userItem.dependencies.some((dependency) => dependency.path.replace(/[\\/]+/gu, "/") === `workspace/.nbook/agent/profiles/${systemItem.fileName}`)).toBe(true);
        await expect(validateProfileArtifact(projectProfileRoot, userItem)).resolves.toEqual({fresh: true});
    });

    it("Product system artifact 的 output-root 入口源码依赖可 rehome", () => {
        const item = {
            fileName: "builtin/custom.product.profile.mjs",
            profileKey: "custom.product",
            sourceSha256: "source",
            sourceBytes: 1,
            dependencyHash: "dependencies",
            artifactFileName: "artifacts/artifact.mjs",
            artifactSha256: "artifact",
            artifactBytes: 1,
            dependencies: [{path: ".output/server/assets/workspace/.nbook/agent/profiles/builtin/custom.product.profile.mjs", sha256: "source", bytes: 1}],
        } satisfies ProfileArtifactManifestItem;
        const rehomed = rehomeProfileArtifactItem(item, {
            fromRootLabel: "assets/workspace/.nbook/agent/profiles",
            toRootLabel: "workspace/.nbook/agent/profiles",
        });
        expect(rehomed.dependencies).toEqual([expect.objectContaining({path: "workspace/.nbook/agent/profiles/builtin/custom.product.profile.mjs"})]);
    });

    it("Product profile artifact 不写入构建机绝对 require 路径", async () => {
        const productRoot = join(root, "product");
        const outputServerRoot = join(productRoot, ".output", "server");
        installRoot = join(outputServerRoot, "assets", "workspace", ".nbook", "agent", "profiles");
        projectProfileRoot = join(productRoot, "workspace", "product-project", ".nbook", "agent", "profiles");
        await mkdir(outputServerRoot, {recursive: true});
        await writeFile(join(productRoot, "package.json"), "{\"name\":\"neuro-book-product\",\"version\":\"0.0.0\",\"type\":\"module\"}\n", "utf8");
        await writeFile(join(productRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(outputServerRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(outputServerRoot, "index.mjs"), "", "utf8");
        await writeProductAuthoringFixture(outputServerRoot);
        await writeProfile(installRoot, "custom.product.profile.mjs", `
            export default {
                manifest: { key: "custom.product", name: "Product" },
                initialSchema: { type: "object", properties: {} },
                outputSchema: { type: "object", properties: {} },
                tools: {},
                rootToolKeys: [],
                prepare() {
                    return { systemPrompt: "product" };
                },
            };
        `);

        const previousCwd = process.cwd();
        process.env.NEURO_BOOK_APPLICATION_ROOT = productRoot;
        process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = join(productRoot, ".output");
        process.env.NEURO_BOOK_PRODUCT_BUILD = "1";
        process.chdir(productRoot);
        try {
            await compileProfileArtifacts({
                profileRoot: installRoot,
                rootLabel: "assets/workspace/.nbook/agent/profiles",
            });
        } finally {
            process.chdir(previousCwd);
        }

        const manifest = await readProfileArtifactManifest(installRoot);
        const manifestItem = manifest.profiles.find((item) => item.profileKey === "custom.product")!;
        const artifact = await readFile(compiledArtifactPath(installRoot, manifestItem), "utf8");
        expect(artifact.slice(0, 2048)).toContain("__nbookResolveProductRequireRoot");
        expect(artifact.slice(0, 2048)).toContain("NEURO_BOOK_APPLICATION_ROOT");
        expect(artifact.slice(0, 2048)).not.toContain("process.cwd()");
        expect(artifact.slice(0, 2048)).not.toContain("globalThis._importMeta_");
        expect(artifact.slice(0, 2048)).not.toMatch(/file:\/\/\/[A-Za-z]:/u);
        expect(artifact).not.toContain("D:/a/neuro-book/");
        expect(manifestItem.dependencies.every((dependency) => dependency.path.startsWith(".output/server/"))).toBe(true);
        process.chdir(productRoot);
        try {
            await expect(validateProfileArtifact(installRoot, manifestItem, {requireTypeArtifact: true})).resolves.toEqual({fresh: true});
            delete process.env.NEURO_BOOK_APPLICATION_ROOT;
            delete process.env.NEURO_BOOK_PRODUCT_BUILD;
            const catalog = createTestCatalog(installRoot, projectProfileRoot);
            await expect(catalog.get("custom.product")).rejects.toThrow("必须来自 verified image identity");
        } finally {
            process.chdir(previousCwd);
        }
    });

    it("显式 Product identity 无根 Product package 时仍可编译和加载Profile", async () => {
        const productRoot = join(root, "product-output-runner");
        installRoot = join(productRoot, ".output", "server", "assets", "workspace", ".nbook", "agent", "profiles");
        projectProfileRoot = join(productRoot, "workspace", "output-project", ".nbook", "agent", "profiles");
        await mkdir(join(productRoot, ".output", "server"), {recursive: true});
        await writeFile(join(productRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(productRoot, ".output", "server", "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(productRoot, ".output", "server", "index.mjs"), "", "utf8");
        await writeFile(join(productRoot, ".output", "server", "package.json"), "{\"name\":\"neuro-book-output\",\"version\":\"0.0.0\",\"type\":\"module\"}\n", "utf8");
        await writeProductAuthoringFixture(join(productRoot, ".output", "server"));
        await writeProfile(installRoot, "custom.output.profile.mjs", `
            export default {
                manifest: { key: "custom.output", name: "Output" },
                initialSchema: { type: "object", properties: {} },
                outputSchema: { type: "object", properties: {} },
                tools: {},
                rootToolKeys: [],
                prepare() {
                    return { systemPrompt: "output" };
                },
            };
        `);

        const previousCwd = process.cwd();
        process.env.NEURO_BOOK_APPLICATION_ROOT = productRoot;
        process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = join(productRoot, ".output");
        process.env.NEURO_BOOK_PRODUCT_BUILD = "1";
        process.chdir(productRoot);
        try {
            await compileProfileArtifacts({
                profileRoot: installRoot,
                rootLabel: "assets/workspace/.nbook/agent/profiles",
            });
            const manifest = await readProfileArtifactManifest(installRoot);
            const manifestItem = manifest.profiles.find((item) => item.profileKey === "custom.output")!;
            const artifact = await readFile(compiledArtifactPath(installRoot, manifestItem), "utf8");
            const catalog = createTestCatalog(installRoot, projectProfileRoot);
            const profile = await catalog.get("custom.output");

            expect(artifact.slice(0, 2048)).toContain("__nbookResolveProductRequireRoot");
            expect(artifact.slice(0, 2048)).not.toContain("globalThis._importMeta_");
            expect(await profile.prepare!(context())).toEqual(expect.objectContaining({
                systemPrompt: "output",
            }));
        } finally {
            process.chdir(previousCwd);
        }
    });

    it("通用 .output Product runner 会重编源码模式遗留 artifact", async () => {
        const productRoot = join(root, "product-output-stale-artifact");
        const sourceRoot = join(root, "source-artifact-root");
        installRoot = join(productRoot, ".output", "server", "assets", "workspace", ".nbook", "agent", "profiles");
        await mkdir(join(productRoot, ".output", "server"), {recursive: true});
        await writeFile(join(productRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(productRoot, ".output", "server", "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(productRoot, ".output", "server", "index.mjs"), "", "utf8");
        await writeFile(join(productRoot, ".output", "server", "package.json"), "{\"name\":\"neuro-book-output\",\"version\":\"0.0.0\",\"type\":\"module\"}\n", "utf8");
        await writeProductAuthoringFixture(join(productRoot, ".output", "server"));
        await writeProfile(installRoot, "custom.output.profile.mjs", `
            export default {
                manifest: { key: "custom.output", name: "Output" },
                initialSchema: { type: "object", properties: {} },
                outputSchema: { type: "object", properties: {} },
                tools: {},
                rootToolKeys: [],
                prepare() { return { systemPrompt: "ok" }; },
            };
        `);
        await mkdir(join(sourceRoot, "assets", "workspace", ".nbook", "agent"), {recursive: true});
        await writeFile(join(sourceRoot, "tsconfig.json"), "{}\n", "utf8");
        await cp(installRoot, join(sourceRoot, "assets", "workspace", ".nbook", "agent", "profiles"), {recursive: true});

        const previousCwd = process.cwd();
        process.chdir(sourceRoot);
        try {
            await compileProfileArtifacts({
                profileRoot: join(sourceRoot, "assets", "workspace", ".nbook", "agent", "profiles"),
                rootLabel: "assets/workspace/.nbook/agent/profiles",
            });
        } finally {
            process.chdir(previousCwd);
        }
        await cp(
            join(sourceRoot, "assets", "workspace", ".nbook", "agent", "profiles", ".compiled"),
            join(installRoot, ".compiled"),
            {recursive: true},
        );
        process.chdir(productRoot);
        process.env.NEURO_BOOK_APPLICATION_ROOT = productRoot;
        process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = join(productRoot, ".output");
        process.env.NEURO_BOOK_PRODUCT_BUILD = "1";
        try {
            const staleManifest = await readProfileArtifactManifest(installRoot);
            await expect(validateProfileArtifact(installRoot, staleManifest.profiles[0]!)).resolves.toEqual({
                fresh: false,
                reason: "artifact_changed",
            });
            await compileProfileArtifacts({
                profileRoot: installRoot,
                rootLabel: "assets/workspace/.nbook/agent/profiles",
                skipFresh: true,
            });
            const nextManifest = await readProfileArtifactManifest(installRoot);
            const nextItem = nextManifest.profiles.find((item) => item.profileKey === "custom.output")!;
            const artifact = await readFile(compiledArtifactPath(installRoot, nextItem), "utf8");
            expect(artifact.slice(0, 2048)).toContain("__nbookResolveProductRequireRoot");
            expect(artifact.slice(0, 2048)).not.toContain("globalThis._importMeta_");
        } finally {
            process.chdir(previousCwd);
        }
    });

    it("Product 用户层 artifact 经过 portable workspace junction 后仍可编译和加载", async () => {
        const portableRoot = join(root, "portable");
        const productRoot = join(portableRoot, "app");
        const dataWorkspaceRoot = join(portableRoot, "data", "workspace");
        installRoot = join(productRoot, "assets", "workspace", ".nbook", "agent", "profiles");
        projectProfileRoot = join(productRoot, "workspace", "portable-project", ".nbook", "agent", "profiles");
        await mkdir(dataWorkspaceRoot, {recursive: true});
        await mkdir(productRoot, {recursive: true});
        await mkdir(join(productRoot, ".output", "server"), {recursive: true});
        await symlink(dataWorkspaceRoot, join(productRoot, "workspace"), process.platform === "win32" ? "junction" : "dir");
        await writeFile(join(productRoot, "package.json"), "{\"name\":\"neuro-book-product\",\"version\":\"0.0.0\",\"type\":\"module\"}\n", "utf8");
        await writeFile(join(productRoot, "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(productRoot, ".output", "server", "tsconfig.json"), "{}\n", "utf8");
        await writeFile(join(productRoot, ".output", "server", "index.mjs"), "", "utf8");
        await writeProductAuthoringFixture(join(productRoot, ".output", "server"));
        await writeProfile(projectProfileRoot, "custom.portable.profile.mjs", `
            export default {
                manifest: { key: "custom.portable", name: "Portable" },
                initialSchema: { type: "object", properties: {} },
                outputSchema: { type: "object", properties: {} },
                tools: {},
                rootToolKeys: [],
                prepare() {
                    return { systemPrompt: "portable" };
                },
            };
        `);

        const previousCwd = process.cwd();
        process.env.NEURO_BOOK_APPLICATION_ROOT = productRoot;
        process.env.NEURO_BOOK_PRODUCT_IMAGE_ROOT = join(productRoot, ".output");
        process.env.NEURO_BOOK_PRODUCT_BUILD = "1";
        process.chdir(productRoot);
        try {
            await compileProfileArtifacts({
                profileRoot: projectProfileRoot,
                rootLabel: "workspace/.nbook/agent/profiles",
            });
            const catalog = createTestCatalog(installRoot, projectProfileRoot);
            const profile = await catalog.get("custom.portable");
            expect(await profile.prepare!(context())).toEqual(expect.objectContaining({
                systemPrompt: "portable",
            }));
        } finally {
            process.chdir(previousCwd);
        }
    });
});

async function writeProfile(root: string, name: string, source: string): Promise<void> {
    await mkdir(dirname(join(root, name)), {recursive: true});
    await writeFile(join(root, name), source, "utf8");
}

/** Product fixture 必须具备真实编译上下文要求的最小 Authoring Kit。 */
async function writeProductAuthoringFixture(outputServerRoot: string): Promise<void> {
    const authoringRoot = join(outputServerRoot, "authoring");
    await mkdir(authoringRoot, {recursive: true});
    await writeFile(join(outputServerRoot, "package.json"), "{\"name\":\"neuro-book-output\",\"type\":\"module\"}\n", "utf8");
    await writeFile(join(authoringRoot, "package.json"), "{\"name\":\"@notnotype/neuro-book-profile-authoring-kit\",\"private\":true,\"type\":\"module\"}\n", "utf8");
    await writeFile(join(authoringRoot, "tsconfig.json"), "{}\n", "utf8");
    await writeFile(join(authoringRoot, "profile-compile-worker.mjs"), "export {};\n", "utf8");
}

function compiledArtifactPath(root: string, item: ProfileArtifactManifestItem): string {
    return join(root, PROFILE_COMPILED_DIR_NAME, ...item.artifactFileName.split("/"));
}

function compiledTypeArtifactPath(root: string, item: ProfileArtifactManifestItem): string {
    if (!item.typeFileName) {
        throw new Error(`profile ${item.profileKey} 缺少 type artifact。`);
    }
    return join(root, PROFILE_COMPILED_DIR_NAME, ...item.typeFileName.split("/"));
}

function expectContentAddressedArtifact(item: ProfileArtifactManifestItem): void {
    expect(item.artifactFileName).toMatch(new RegExp(`^${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/[a-f0-9]{64}\\.mjs$`));
    expect(item.artifactFileName).toBe(`${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${item.artifactSha256}.mjs`);
    expect(item.typeFileName).toBe(`${PROFILE_COMPILED_ARTIFACTS_DIR_NAME}/${item.artifactSha256}.types.d.ts`);
}

function profileSource(key: string, name: string): string {
    return `
        import {Type, defineAgentProfile, toolset} from "nbook/profile-sdk";
        export const profileManifest = { key: ${JSON.stringify(key)}, name: ${JSON.stringify(name)} } as const;
        export type Initial = {};
        export type Output = {};
        export default defineAgentProfile({
            manifest: profileManifest,
            initialSchema: Type.Object({}),
            outputSchema: Type.Object({}),
            tools: toolset(),
            prepare() { return { systemPrompt: ${JSON.stringify(name)} }; },
        });
    `;
}

function context() {
    const session = createTestRuntimeSession({
        profileKey: "custom.jsx",
    });
    return {
        session,
        initial: {},
        vars: createTestVariableAccessor(),
        catalog: {
            profiles: [],
            issues: [],
        },
        skills: [],
        runtime: {
            now: "2026-05-23T00:00:00.000Z",
            promptUserTurnCount: 0,
        },
        settings: {},
    };
}

async function artifactPathContext(profileRoot: string, rootLabel = "workspace/.nbook/agent/profiles"): Promise<ProfileArtifactPathContext> {
    return createProfileArtifactPathContext(
        profileRoot,
        rootLabel,
        await resolveRuntimeArtifactCompilerContext(resolve(import.meta.dirname, "../../..")),
    );
}

async function compileProfileArtifacts(options: Omit<CompileProfileArtifactsOptions, "artifactPathContext"> & {rootLabel?: string}): Promise<Awaited<ReturnType<typeof compileProfileArtifactsWithContext>>> {
    const {rootLabel, ...rest} = options;
    return compileProfileArtifactsWithContext({
        ...rest,
        artifactPathContext: await artifactPathContext(options.profileRoot, rootLabel ?? "workspace/.nbook/agent/profiles"),
    });
}

async function readProfileArtifactManifest(profileRoot: string, rootLabel = "workspace/.nbook/agent/profiles") {
    return readProfileArtifactManifestWithContext(profileRoot, await artifactPathContext(profileRoot, rootLabel));
}

async function validateProfileArtifact(profileRoot: string, item: ProfileArtifactManifestItem, options: {requireTypeArtifact?: boolean; checkDependencies?: boolean} = {}, rootLabel = "workspace/.nbook/agent/profiles") {
    return validateProfileArtifactWithContext(profileRoot, item, await artifactPathContext(profileRoot, rootLabel), options);
}

async function stageProfileArtifacts(options: Omit<CompileProfileArtifactsOptions, "artifactPathContext"> & {rootLabel?: string}) {
    const {rootLabel, ...rest} = options;
    return stageProfileArtifactsWithContext({
        ...rest,
        artifactPathContext: await artifactPathContext(options.profileRoot, rootLabel ?? "workspace/.nbook/agent/profiles"),
    });
}

async function stageProfileArtifactEntry(options: Omit<Parameters<typeof stageProfileArtifactEntryWithContext>[0], "artifactPathContext"> & {rootLabel?: string}) {
    const {rootLabel, ...rest} = options;
    return stageProfileArtifactEntryWithContext({
        ...rest,
        artifactPathContext: await artifactPathContext(options.profileRoot, rootLabel ?? "workspace/.nbook/agent/profiles"),
    });
}
function createTestCatalog(installRoot: string, projectRoot?: string): AgentProfileCatalog {
    const compilerRoot = resolve(import.meta.dirname, "../../..");
    const resolver = (profileRoot: string, rootLabel: string) => resolveProfileArtifactPathContext(profileRoot, rootLabel, compilerRoot);
    return new AgentProfileCatalog(
        installRoot,
        projectRoot,
        undefined,
        undefined,
        resolver,
        {
            install: profileRootLabelForTest(installRoot),
            ...(projectRoot ? {project: profileRootLabelForTest(projectRoot)} : {}),
        },
    );
}

async function compileRoot(profileRoot: string, fileName?: string): Promise<void> {
    await compileProfileArtifacts({profileRoot, fileName, rootLabel: profileRootLabelForTest(profileRoot)});
}

function profileRootLabelForTest(profileRoot: string): string {
    const normalized = profileRoot.replace(/[\\/]+/gu, "/");
    const marker = "/.nbook/agent/profiles";
    const installMarker = "/assets/workspace/.nbook/agent/profiles";
    if (normalized.includes(installMarker)) {
        return "assets/workspace/.nbook/agent/profiles";
    }
    const markerIndex = normalized.lastIndexOf(marker);
    if (markerIndex < 0) {
        throw new Error(`测试 Profile Root 缺少 .nbook/agent/profiles 边界：${profileRoot}`);
    }
    const prefix = normalized.slice(0, markerIndex);
    const workspaceMarker = "/workspace/";
    const workspaceIndex = prefix.lastIndexOf(workspaceMarker);
    const projectRoot = workspaceIndex >= 0 ? prefix.slice(workspaceIndex + workspaceMarker.length) : "";
    if (!projectRoot || projectRoot.includes("/")) {
        throw new Error(`测试 Project Root 缺少 Workspace project 边界：${profileRoot}`);
    }
    return `workspace/${projectRoot}${marker}`;
}

/**
 * 创建测试用 deferred，用于控制并发 cache 写回顺序。
 */
function createDeferred(): {promise: Promise<void>; resolve: () => void} {
    let resolve!: () => void;
    const promise = new Promise<void>((nextResolve) => {
        resolve = nextResolve;
    });
    return {promise, resolve};
}

async function waitFor(assertion: () => Promise<void> | void, timeoutMs = 1_000): Promise<void> {
    const startedAt = Date.now();
    let lastError: unknown;
    while (Date.now() - startedAt < timeoutMs) {
        try {
            await assertion();
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }
    if (lastError instanceof Error) {
        throw lastError;
    }
    throw new Error(String(lastError));
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolveSleep) => {
        setTimeout(resolveSleep, ms);
    });
}
