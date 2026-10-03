import {existsSync} from "node:fs";
import {mkdir, readFile, readdir, stat} from "node:fs/promises";
import {basename, join, relative, resolve} from "node:path";
import {assertTypeBoxValue} from "nbook/server/agent/profiles/schema-validation";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {
    PROFILE_COMPILED_DIR_NAME,
    readProfileArtifactManifest,
    type ProfileArtifactManifest,
    type ProfileArtifactManifestEntry,
    type ProfileArtifactManifestItem,
    type ProfileArtifactPathContextResolver,
    type ProfileReleaseRegistrySink,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {ProfileArtifactStore, ProfileArtifactStoreError} from "nbook/server/agent/profiles/profile-artifact-store";
import {ProfileFreshnessChecker} from "nbook/server/agent/profiles/profile-freshness-checker";
import {ProfileRegistry} from "nbook/server/agent/profiles/profile-registry";
import {ProfileSourceWatcher, type ProfileSourceWatchEvent} from "nbook/server/agent/profiles/profile-source-watcher";
import {resolveProjectAgentRoot} from "nbook/server/workspace-files/system-workspace-assets";
import type {
    AgentCatalogSnapshot,
    AgentCatalogItem,
    AgentProfile,
    AgentProfileIssue,
    AgentProfileIssueCode,
    AgentProfileSourceKind,
} from "nbook/server/agent/profiles/types";
import {appLogger} from "nbook/server/app-logs/logger";
import type {ResolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";

type ProfileSource = {
    profile: AgentProfile;
    sourcePath?: string;
    builtin: boolean;
    source: AgentProfileSourceKind;
    issue?: AgentProfileIssue;
};

type UnloadedProfileSource = {
    key: string;
    name: string;
    description?: string;
    sourcePath: string;
    builtin: boolean;
    source: Exclude<AgentProfileSourceKind, "memory">;
    loadStatus: AgentCatalogItem["loadStatus"];
    issue: AgentProfileIssue;
};

type LoadedProfileCatalog = {
    profiles: Map<string, ProfileSource>;
    unloadedProfiles: Map<string, UnloadedProfileSource>;
    issues: AgentProfileIssue[];
};

type ProfileFileEntry = {
    file: string;
    fileName: string;
    mtimeMs: number;
    size: number;
};

type ProfileInventory = {
    install: ProfileFileEntry[];
    project: ProfileFileEntry[];
    installManifest: ProfileArtifactManifest;
    projectManifest: ProfileArtifactManifest;
};


type CatalogCache = {
    signature: string;
    catalog: LoadedProfileCatalog;
};

type PendingCatalogLoad = {
    signature: string;
    generation: number;
    promise: Promise<LoadedProfileCatalog>;
};

type ProfileCatalogTiming = {
    cacheHit: number;
    inventory: number;
    signature: number;
    loadInventory: number;
    total: number;
};

export type AgentProfileRuntimeResolution = {
    profile: AgentProfile | null;
    availability: "loaded" | "missing" | "unloadable";
    issueMessage?: string;
};

export type AgentProfileBuildState = {
    running: boolean;
    queued: boolean;
    /** 为空表示当前没有构建任务；非空描述最近一次入队/运行原因。 */
    reason: string | null;
    /** 为空表示尚无构建状态更新时间。 */
    updatedAt: string | null;
};

export type AgentProfileBuildCoordinatorPort = {
    stateFor(profileKey: string): AgentProfileBuildState;
    enqueue(input: {fileName?: string; reason: string}): Promise<void> | void;
    dispose?(): Promise<void>;
};

const PROFILE_CATALOG_SLOW_MS = 500;
const PROFILE_CATALOG_TIMING_KEYS: Array<keyof ProfileCatalogTiming> = [
    "cacheHit",
    "inventory",
    "signature",
    "loadInventory",
    "total",
];

function createProfileCatalogTiming(): ProfileCatalogTiming {
    return {
        cacheHit: 0,
        inventory: 0,
        signature: 0,
        loadInventory: 0,
        total: 0,
    };
}

async function measureProfileCatalogStep<T>(
    timing: ProfileCatalogTiming,
    key: Exclude<keyof ProfileCatalogTiming, "total">,
    task: () => Promise<T>,
): Promise<T> {
    const startedAt = performance.now();
    try {
        return await task();
    } finally {
        timing[key] += performance.now() - startedAt;
    }
}

function roundProfileCatalogTiming(timing: ProfileCatalogTiming): ProfileCatalogTiming {
    return PROFILE_CATALOG_TIMING_KEYS.reduce((result, key) => {
        result[key] = Math.round(timing[key] * 100) / 100;
        return result;
    }, createProfileCatalogTiming());
}

function idleProfileBuildState(): AgentProfileBuildState {
    return {
        running: false,
        queued: false,
        reason: null,
        updatedAt: null,
    };
}

/**
 * 动态 profile catalog。运行期只加载 Install Root，并在显式绑定 Project 时让
 * Project Root 按 profile key 整体覆盖 Install Root。
 */
export class AgentProfileCatalog implements ProfileReleaseRegistrySink {
    private readonly installRoot: string;
    private readonly projectRoot?: string;
    private readonly parent?: AgentProfileCatalog;
    private readonly projectChildren = new Map<symbol, AgentProfileCatalog>();
    private readonly memoryProfiles = new Map<string, ProfileSource>();
    private memoryRevision = 0;
    private catalogGeneration = 0;
    private catalogCache?: CatalogCache;
    private pendingCatalogLoad?: PendingCatalogLoad;
    private catalogDirty = true;
    private sourceWatcher?: ProfileSourceWatcher;
    private watching = false;
    private buildCoordinator?: AgentProfileBuildCoordinatorPort;
    private buildCoordinatorFactory?: (catalog: AgentProfileCatalog, profileRoot: string, profileRootLabel: string) => AgentProfileBuildCoordinatorPort;
    private runtimeRegistryEnabled = false;
    private runtimeRegistryLoad?: Promise<LoadedProfileCatalog>;
    private runtimeRegistryLoadGeneration = -1;
    private readonly artifactStore: ProfileArtifactStore;
    private readonly freshness: ProfileFreshnessChecker;
    private readonly artifactPathContextResolver: ProfileArtifactPathContextResolver;
    private readonly installRootLabel: string;
    private readonly projectRootLabel: string | undefined;
    private readonly runtimeRegistry = new ProfileRegistry<LoadedProfileCatalog>();

    constructor(
        installRoot: string,
        projectRoot?: string,
        inheritedMemoryProfiles?: ReadonlyMap<string, ProfileSource>,
        parent?: AgentProfileCatalog,
        artifactPathContextResolver?: ProfileArtifactPathContextResolver,
        rootLabels?: {install?: string; project?: string},
    ) {
        this.installRoot = resolve(installRoot);
        this.projectRoot = projectRoot ? resolve(projectRoot) : undefined;
        this.installRootLabel = rootLabels?.install ?? parent?.installRootLabel ?? "workspace/.nbook/agent/profiles";
        this.projectRootLabel = this.projectRoot
            ? rootLabels?.project ?? parent?.projectRootLabel ?? profileRootLabelForProject(this.projectRoot)
            : undefined;
        this.parent = parent;
        if (inheritedMemoryProfiles) {
            for (const [key, source] of inheritedMemoryProfiles) this.memoryProfiles.set(key, source);
        }
        this.artifactStore = new ProfileArtifactStore();
        this.artifactPathContextResolver = artifactPathContextResolver ?? parent?.artifactPathContextResolver ?? ((profileRoot, rootLabel) => {
            throw new Error(`Profile Catalog 缺少显式 artifact path context：${rootLabel} (${profileRoot})`);
        });
        this.freshness = new ProfileFreshnessChecker(this.artifactPathContextResolver);
    }
    /** 创建按 Project 隔离的视图；child 拥有自己的 watcher/coordinator。 */
    forProjectWorkspace(project: ResolvedProjectWorkspace): AgentProfileCatalog {
        const owner = this.parent ?? this;
        const existing = owner.projectChildren.get(project.key);
        if (existing) return existing;
        const child = new AgentProfileCatalog(
            owner.installRoot,
            join(resolveProjectAgentRoot(project), "profiles"),
            owner.memoryProfiles,
            owner,
            owner.artifactPathContextResolver,
            {install: owner.installRootLabel, project: `workspace/${project.ref.projectRoot}/.nbook/agent/profiles`},
        );
        owner.projectChildren.set(project.key, child);
        if (owner.buildCoordinatorFactory && child.projectRoot && child.projectRootLabel) {
            child.attachBuildCoordinator(owner.buildCoordinatorFactory(child, child.projectRoot, child.projectRootLabel));
        }
        if (owner.runtimeRegistryEnabled) child.enableRuntimeRegistry();
        if (owner.watching) void child.startWatching();
        return child;
    }

    /** 挂载构建协调器；Project child 通过工厂创建独立 owner。 */
    attachBuildCoordinator(
        coordinator: AgentProfileBuildCoordinatorPort,
        factory?: (catalog: AgentProfileCatalog, profileRoot: string, profileRootLabel: string) => AgentProfileBuildCoordinatorPort,
    ): void {
        this.buildCoordinator = coordinator;
        if (factory) {
            this.buildCoordinatorFactory = factory;
        }
    }

    /** 将 Catalog 已知来源的物理源码路径投影为工作台稳定 fileName。 */
    sourceFileName(sourcePath: string, source: AgentProfileSourceKind): string {
        const root = source === "install"
            ? this.installRoot
            : source === "project"
                ? this.projectRoot
                : null;
        return root ? relative(root, sourcePath).split(/[\\/]+/).join("/") : basename(sourcePath);
    }


    /**
     * 注册内存 profile，主要给测试和最小内置 profile 使用。
     */
    register(profile: AgentProfile, builtin = true): void {
        this.memoryProfiles.set(profile.manifest.key, {
            profile,
            builtin,
            source: "memory",
        });
        this.memoryRevision += 1;
        this.invalidate("register");
    }


    /**
     * 启用 server 进程内 Registry。启用后 get/resolveMany/snapshot 只读内存视图；
     * 文件系统扫描/import 只发生在显式 refresh seam。
     */
    enableRuntimeRegistry(): void {
        if (this.runtimeRegistryEnabled) {
            return;
        }
        this.runtimeRegistryEnabled = true;
        void this.refreshRuntimeRegistry("startup").catch((error) => {
            void appLogger.warn("agent.profileCatalog.registryStartupFailed", {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }

    /**
     * 从当前 `.compiled/manifest.json` 重建 server 内存 Registry。
     */
    async refreshRuntimeRegistry(reason = "manual"): Promise<void> {
        if (!this.runtimeRegistryEnabled) {
            this.invalidate(reason);
            return;
        }
        if (this.runtimeRegistryLoad && this.runtimeRegistryLoadGeneration === this.catalogGeneration) {
            await this.runtimeRegistryLoad;
            return;
        }
        const generationAtStart = this.catalogGeneration;
        const load = (async () => {
            const inventory = await this.readProfileInventory();
            const catalog = await this.loadInventory(inventory);
            if (this.catalogGeneration === generationAtStart) {
                this.runtimeRegistry.publish(catalog);
                this.catalogCache = {
                    signature: `runtime:${this.catalogGeneration}`,
                    catalog,
                };
                this.catalogDirty = false;
            }
            return catalog;
        })().finally(() => {
            if (this.runtimeRegistryLoad === load) {
                this.runtimeRegistryLoad = undefined;
                this.runtimeRegistryLoadGeneration = -1;
            }
        });
        this.runtimeRegistryLoad = load;
        this.runtimeRegistryLoadGeneration = generationAtStart;
        await load;
    }

    /**
     * in-process Publisher 的 Registry 翻转入口。磁盘 manifest 已经原子提交后，
     * 这里用同一份 manifest 构建 server 进程内存视图，避免路由层再手动补刷。
     */
    async publishProfileRelease(profileRoot: string, manifest: ProfileArtifactManifest): Promise<void> {
        if (!this.runtimeRegistryEnabled) {
            this.invalidate("profile_release_published");
            for (const child of this.projectChildren.values()) child.invalidate("parent_profile_release_published");
            return;
        }
        const root = resolve(profileRoot);
        const installRoot = resolve(this.installRoot);
        const projectRoot = this.projectRoot ? resolve(this.projectRoot) : null;
        if (root !== installRoot && root !== projectRoot) {
            await this.refreshRuntimeRegistry("profile_release_unknown_root");
            return;
        }
        const generationAtStart = this.catalogGeneration + 1;
        this.catalogGeneration = generationAtStart;
        this.runtimeRegistryLoad = undefined;
        this.runtimeRegistryLoadGeneration = -1;
        this.pendingCatalogLoad = undefined;
        const inventory = await this.readProfileInventory();
        const nextInventory: ProfileInventory = {
            ...inventory,
            installManifest: root === installRoot ? manifest : inventory.installManifest,
            projectManifest: root === projectRoot ? manifest : inventory.projectManifest,
        };
        const catalog = await this.loadInventory(nextInventory);
        if (this.catalogGeneration !== generationAtStart) return;
        this.runtimeRegistry.publish(catalog);
        this.catalogCache = {signature: `runtime:${this.catalogGeneration}`, catalog};
        this.catalogDirty = false;
        if (root === installRoot) {
            for (const child of this.projectChildren.values()) child.invalidate("parent_install_release_published");
        }
    }

    buildStateFor(profileKey: string): AgentProfileBuildState {
        return this.buildCoordinator?.stateFor(profileKey) ?? idleProfileBuildState();
    }

    /**
     * 源码保存/创建后请求后台编译。未挂载 Coordinator 时只标 dirty。
     */
    async enqueueBuild(input: {fileName?: string; reason: string}): Promise<void> {
        this.invalidate(input.reason);
        await this.buildCoordinator?.enqueue(input);
    }

    /**
     * 清理 catalog 缓存。手动编译或源码保存后可显式刷新。
     */
    invalidate(_reason = "manual"): void {
        this.catalogGeneration += 1;
        if (this.runtimeRegistryEnabled) {
            void this.refreshRuntimeRegistry(_reason).catch((error) => {
                void appLogger.warn("agent.profileCatalog.registryRefreshFailed", {
                    error: error instanceof Error ? error.message : String(error),
                    reason: _reason,
                });
            });
            return;
        }
        this.catalogDirty = true;
        this.catalogCache = undefined;
        this.pendingCatalogLoad = undefined;
    }

    /**
     * 启动 profile root 文件 watcher。HTTP runtime 使用它感知外部编辑器或 bash 写入。
     */
    async startWatching(): Promise<void> {
        this.watching = true;
        if (!this.sourceWatcher) {
            this.sourceWatcher = new ProfileSourceWatcher({
                installRoot: this.installRoot,
                projectRoot: this.projectRoot,
                onEvent: (event) => this.handleWatchEvent(event),
                onError: (error, startup) => {
                    this.invalidate("watch_error");
                    void appLogger.warn("agent.profileCatalog.watchError", {error: error.message, startup});
                },
            });
        }
        try {
            await this.sourceWatcher.start();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void appLogger.warn("agent.profileCatalog.watchStartFailed", {error: message});
            throw error;
        }
    }

    private handleWatchEvent(event: ProfileSourceWatchEvent): void {
        void appLogger.debug("agent.profileCatalog.watchDirty", {
            eventName: event.eventName,
            path: event.changedPath,
        });
        const isInstallEvent = event.kind === "install_profile" || event.kind === "install_dependency";
        const isProjectEvent = event.kind === "project_profile" || event.kind === "project_dependency";
        if (isInstallEvent && this.projectRoot) {
            this.invalidate(`watch:${event.kind}:${event.eventName}`);
            return;
        }
        if (!isInstallEvent && !isProjectEvent) {
            this.invalidate(`watch:${event.kind}:${event.eventName}`);
            return;
        }
        if (isProjectEvent && !this.projectRoot) {
            this.invalidate(`watch:${event.kind}:${event.eventName}`);
            return;
        }
        const isDeleted = event.eventName === "unlink" || event.eventName === "unlinkDir";
        const reason = `watch:${event.eventName}`;
        const build = !isDeleted && event.kind.endsWith("_profile") && event.fileName
            ? {fileName: event.fileName, reason}
            : {reason};
        void this.enqueueBuild(build).catch((error) => {
            void appLogger.warn("agent.profileCatalog.watchEnqueueFailed", {
                error: error instanceof Error ? error.message : String(error),
                path: event.changedPath,
            });
        });
    }
    /**
     * 关闭 profile watcher。测试和临时 catalog 用它避免文件句柄泄漏。
     */
    async dispose(): Promise<void> {
        const failures: unknown[] = [];
        for (const [key, child] of this.projectChildren) {
            try {
                await child.dispose();
            } catch (error) {
                failures.push(error);
            }
            this.projectChildren.delete(key);
        }
        const watcher = this.sourceWatcher;
        this.sourceWatcher = undefined;
        this.watching = false;
        try {
            await watcher?.dispose();
        } catch (error) {
            failures.push(error);
        }
        const coordinator = this.buildCoordinator;
        this.buildCoordinator = undefined;
        try {
            await coordinator?.dispose?.();
        } catch (error) {
            failures.push(error);
        }
        if (failures.length > 0) {
            throw new AggregateError(failures, "Profile Catalog 清理存在失败项");
        }
    }

    /**
     * 返回指定 profile。用户文件覆盖系统文件和内存 builtin。
     */
    async get(profileKey: string): Promise<AgentProfile> {
        const buildState = this.buildStateFor(profileKey);
        if (buildState.running || buildState.queued) {
            throw new Error(`agent profile ${profileKey} 正在编译，当前不可运行。`);
        }
        const catalog = await this.loadAll();
        const profile = catalog.profiles.get(profileKey)?.profile;
        if (!profile) {
            const unloaded = catalog.unloadedProfiles.get(profileKey);
            if (unloaded?.issue) {
                throw new Error(`agent profile ${profileKey} 不可运行：${unloaded.issue.message}`);
            }
            throw new Error(`未找到 agent profile: ${profileKey}`);
        }
        return profile;
    }

    /**
     * 批量解析 profile 运行态。列表类调用必须跨一次 catalog seam，
     * 避免对每个 session 重复扫描 profile inventory 和依赖签名。
     */
    async resolveMany(profileKeys: Iterable<string>): Promise<Map<string, AgentProfileRuntimeResolution>> {
        const catalog = await this.loadAll();
        const result = new Map<string, AgentProfileRuntimeResolution>();
        for (const profileKey of [...new Set(profileKeys)]) {
            const buildState = this.buildStateFor(profileKey);
            if (buildState.running || buildState.queued) {
                result.set(profileKey, {
                    profile: null,
                    availability: "unloadable",
                    issueMessage: `agent profile ${profileKey} 正在编译，当前不可运行。`,
                });
                continue;
            }
            const source = catalog.profiles.get(profileKey);
            if (source) {
                result.set(profileKey, {
                    profile: source.profile,
                    availability: "loaded",
                });
                continue;
            }
            const unloaded = catalog.unloadedProfiles.get(profileKey);
            if (unloaded) {
                result.set(profileKey, {
                    profile: null,
                    availability: "unloadable",
                    issueMessage: unloaded.issue?.message ?? `agent profile ${profileKey} 不可运行`,
                });
                continue;
            }
            result.set(profileKey, {
                profile: null,
                availability: "missing",
                issueMessage: `未找到 agent profile: ${profileKey}`,
            });
        }
        return result;
    }

    /**
     * 解析并校验 profile initial。
     */
    parseInitial(profile: AgentProfile, initial: JsonValue): JsonValue {
        try {
            assertTypeBoxValue(profile.initialSchema, initial);
            return initial;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`profile ${profile.manifest.key} initial 校验失败：${message}`);
        }
    }

    /**
     * 解析并校验单次 invocation payload。未声明 PayloadSchema 的 profile 不接受 payload。
     */
    parsePayload(profile: AgentProfile, payload: JsonValue | undefined): JsonValue | undefined {
        if (payload === undefined) {
            return undefined;
        }
        if (!profile.payloadSchema) {
            throw new AgentInvocationPayloadError(`profile ${profile.manifest.key} 未声明 PayloadSchema，不能接收 invocation input。`);
        }
        try {
            assertTypeBoxValue(profile.payloadSchema, payload);
            return payload;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new AgentInvocationPayloadError(`profile ${profile.manifest.key} payload 校验失败：${message}`);
        }
    }

    /**
     * 提供给 profile prepare 的只读 snapshot。
     */
    async snapshot(options: {includeFileIssues?: boolean} = {}): Promise<AgentCatalogSnapshot> {
        const catalog = await this.loadAll();
        const loaded = [...catalog.profiles.values()].map(({profile, source, sourcePath, builtin, issue}): AgentCatalogItem => {
            const buildState = this.buildStateFor(profile.manifest.key);
            return {
                key: profile.manifest.key,
                name: profile.manifest.name,
                description: profile.manifest.description,
                toolKeys: profile.rootToolKeys,
                initialSchema: profile.initialSchema,
                payloadSchema: profile.payloadSchema,
                outputSchema: profile.outputSchema,
                source,
                sourcePath,
                builtin,
                loadStatus: buildState.running || buildState.queued ? "compiling" : issue ? statusFromIssue(issue) : "loaded",
                hasSettingsForm: Boolean(profile.settingsForm),
                canResetHome: Boolean(profile.home?.reset),
                creationMode: profile.capabilities?.creation ?? "public",
                issue,
            };
        });
        const unloaded = [...catalog.unloadedProfiles.values()].map((profile): AgentCatalogItem => {
            const buildState = this.buildStateFor(profile.key);
            return {
                key: profile.key,
                name: profile.name,
                description: profile.description,
                source: profile.source,
                sourcePath: profile.sourcePath,
                builtin: profile.builtin,
                loadStatus: buildState.running || buildState.queued ? "compiling" : profile.loadStatus,
                hasSettingsForm: false,
                canResetHome: false,
                creationMode: "public",
                issue: profile.issue,
            };
        });
        return {
            profiles: [...loaded, ...unloaded].sort((left, right) => left.key.localeCompare(right.key)),
            issues: options.includeFileIssues === false
                ? catalog.issues.filter((issue) => Boolean(issue.profileKey))
                : catalog.issues,
        };
    }

    private async loadAll(): Promise<LoadedProfileCatalog> {
        if (this.runtimeRegistryEnabled) {
            if (this.runtimeRegistry.catalog) {
                return this.runtimeRegistry.catalog;
            }
            await this.refreshRuntimeRegistry("loadAll");
            if (this.runtimeRegistry.catalog) {
                return this.runtimeRegistry.catalog;
            }
        }
        const timing = createProfileCatalogTiming();
        const startedAt = performance.now();
        const dirtyAtStart = this.catalogDirty;
        const generationAtStart = this.catalogGeneration;
        let cacheState: "memory_hit" | "signature_hit" | "pending_join" | "loaded" = "loaded";
        try {
            if (this.catalogCache && !this.catalogDirty) {
                cacheState = "memory_hit";
                timing.cacheHit = performance.now() - startedAt;
                return this.catalogCache.catalog;
            }
            const inventory = await measureProfileCatalogStep(timing, "inventory", () => this.readProfileInventory());
            const signature = await measureProfileCatalogStep(timing, "signature", () => this.catalogSignature(inventory));
            if (this.catalogCache?.signature === signature) {
                cacheState = "signature_hit";
                if (this.catalogGeneration === generationAtStart) {
                    this.catalogDirty = false;
                }
                return this.catalogCache.catalog;
            }
            if (
                this.pendingCatalogLoad?.signature === signature
                && this.pendingCatalogLoad.generation === generationAtStart
                && this.catalogGeneration === generationAtStart
            ) {
                cacheState = "pending_join";
                return measureProfileCatalogStep(timing, "loadInventory", () => this.pendingCatalogLoad!.promise);
            }

            const promise = this.loadInventory(inventory).then((catalog) => {
                if (this.catalogGeneration === generationAtStart) {
                    this.catalogCache = {signature, catalog};
                    this.catalogDirty = false;
                }
                return catalog;
            }).finally(() => {
                if (this.pendingCatalogLoad?.promise === promise) {
                    this.pendingCatalogLoad = undefined;
                }
            });
            if (this.catalogGeneration === generationAtStart) {
                this.pendingCatalogLoad = {signature, generation: generationAtStart, promise};
            }
            return await measureProfileCatalogStep(timing, "loadInventory", () => promise);
        } finally {
            timing.total = performance.now() - startedAt;
            this.logCatalogTiming(cacheState, dirtyAtStart, timing);
        }
    }

    private logCatalogTiming(cacheState: "memory_hit" | "signature_hit" | "pending_join" | "loaded", dirtyAtStart: boolean, timing: ProfileCatalogTiming): void {
        if (cacheState === "memory_hit" && timing.total <= PROFILE_CATALOG_SLOW_MS) {
            return;
        }
        const data = {
            cacheState,
            dirtyAtStart,
            timing: roundProfileCatalogTiming(timing),
        };
        if (timing.total > PROFILE_CATALOG_SLOW_MS) {
            void appLogger.warn("agent.profileCatalog.slow", data);
            return;
        }
        void appLogger.debug("agent.profileCatalog.resolve", data);
    }

    private async loadInventory(inventory: ProfileInventory): Promise<LoadedProfileCatalog> {
        const profiles = new Map<string, ProfileSource>(this.memoryProfiles);
        const unloadedProfiles = new Map<string, UnloadedProfileSource>();
        const issues: AgentProfileIssue[] = [];
        const install = await this.loadDirectory(inventory.install, inventory.installManifest, "install", true, this.installRoot, this.installRootLabel);
        issues.push(...install.issues);
        for (const source of install.sources) profiles.set(source.profile.manifest.key, source);
        for (const source of install.unloadedSources) {
            profiles.delete(source.key);
            unloadedProfiles.set(source.key, source);
        }
        const projectRoot = this.projectRoot;
        if (projectRoot) {
            const project = await this.loadDirectory(inventory.project, inventory.projectManifest, "project", false, projectRoot, this.projectRootLabel!);
            issues.push(...project.issues);
            for (const source of project.sources) {
                profiles.set(source.profile.manifest.key, source);
                unloadedProfiles.delete(source.profile.manifest.key);
            }
            for (const source of project.unloadedSources) {
                profiles.delete(source.key);
                unloadedProfiles.set(source.key, source);
            }
        }
        return {profiles, unloadedProfiles, issues};
    }

    private async loadDirectory(
        files: ProfileFileEntry[],
        manifest: ProfileArtifactManifest,
        source: Exclude<AgentProfileSourceKind, "memory">,
        builtin: boolean,
        root: string,
        rootLabel: string,
    ): Promise<{sources: ProfileSource[]; unloadedSources: UnloadedProfileSource[]; issues: AgentProfileIssue[]}> {
        const sources: ProfileSource[] = [];
        const unloadedSources: UnloadedProfileSource[] = [];
        const issues: AgentProfileIssue[] = [];
        for (const file of files) {
            const manifestEntry = manifest.entries.find((item) => item.fileName === file.fileName);
            if (!manifestEntry) {
                const issue = this.notCompiledIssue(source, file);
                issues.push(issue);
                unloadedSources.push(this.unloadedFromFile(file, source, builtin, "not_compiled", issue));
                continue;
            }
            if (manifestEntry.status === "compile_failed") {
                const issue = this.compileFailedIssue(source, file, manifestEntry);
                issues.push(issue);
                unloadedSources.push(this.unloadedFromManifest(file, manifestEntry, source, builtin, "compile_failed", issue));
                continue;
            }
            const freshness = await this.freshness.validate(root, rootLabel, manifestEntry, {checkDependencies: false});
            if (!freshness.fresh) {
                const issue = this.staleIssue(source, file, manifestEntry, freshness.reason);
                issues.push(issue);
                unloadedSources.push(this.unloadedFromManifest(file, manifestEntry, source, builtin, "compile_stale", issue));
                continue;
            }
            try {
                const profile = await this.artifactStore.importProfile(root, manifestEntry);
                const locked = this.applyBuiltinSchemaLock(profile, source, file.file);
                const filenameIssue = this.filenameIssue(locked.profile, source, file.file);
                sources.push({profile: locked.profile, sourcePath: file.file, builtin, source, issue: locked.issue ?? filenameIssue});
                if (locked.issue) issues.push(locked.issue);
                if (filenameIssue) issues.push(filenameIssue);
            } catch (error) {
                const issue = this.issueFromError(error, source, file.file, manifestEntry.profileKey, "compiled_load_failed");
                issues.push(issue);
                unloadedSources.push(this.unloadedFromManifest(file, manifestEntry, source, builtin, "compiled_load_failed", issue));
            }
        }
        return {sources, unloadedSources, issues};
    }

    private async readProfileInventory(): Promise<ProfileInventory> {
        const projectRoot = this.projectRoot;
        const installManifestPromise = this.artifactPathContextResolver(this.installRoot, this.installRootLabel)
            .then((context) => readProfileArtifactManifest(this.installRoot, context));
        const projectManifestPromise = projectRoot
            ? this.artifactPathContextResolver(projectRoot, this.projectRootLabel!)
                .then((context) => readProfileArtifactManifest(projectRoot, context))
            : installManifestPromise.then((manifest) => ({...manifest, entries: [], profiles: []}));
        const [install, project, installManifest, projectManifest] = await Promise.all([
            this.findProfileFiles(this.installRoot),
            projectRoot ? this.findProfileFiles(projectRoot) : Promise.resolve([]),
            installManifestPromise,
            projectManifestPromise,
        ]);
        return {install, project, installManifest, projectManifest};
    }

    private async findProfileFiles(root: string, current = root): Promise<ProfileFileEntry[]> {
        if (!existsSync(current)) {
            return [];
        }
        const files: ProfileFileEntry[] = [];
        const entries = await readdir(current, {withFileTypes: true});
        for (const entry of entries) {
            if (entry.name === PROFILE_COMPILED_DIR_NAME) {
                continue;
            }
            const fullPath = join(current, entry.name);
            if (entry.isDirectory()) {
                files.push(...await this.findProfileFiles(root, fullPath));
                continue;
            }
            if (entry.isFile() && /\.profile\.(tsx|ts|mjs|js)$/.test(entry.name)) {
                const fileStat = await stat(fullPath);
                files.push({
                    file: fullPath,
                    fileName: this.relativeProfilePath(fullPath, root),
                    mtimeMs: fileStat.mtimeMs,
                    size: fileStat.size,
                });
            }
        }
        return files.sort((left, right) => left.file.localeCompare(right.file));
    }

    private async catalogSignature(inventory: ProfileInventory): Promise<string> {
        return JSON.stringify({
            memoryRevision: this.memoryRevision,
            installRoot: this.installRoot,
            projectRoot: this.projectRoot,
            install: inventory.install,
            project: inventory.project,
            installManifest: inventory.installManifest,
            projectManifest: inventory.projectManifest,
            installDependencies: await this.freshness.dependencySignatures(this.installRoot, this.installRootLabel, inventory.installManifest),
            projectDependencies: this.projectRoot
                ? await this.freshness.dependencySignatures(this.projectRoot, this.projectRootLabel!, inventory.projectManifest)
                : [],
        });
    }

    private profileIssueCode(value: unknown): AgentProfileIssueCode {
        if (value && typeof value === "object" && !("initialSchema" in value)) {
            return "schema_missing";
        }
        return "invalid_export";
    }

    private applyBuiltinSchemaLock(profile: AgentProfile, source: AgentProfileSourceKind, sourcePath: string): {
        profile: AgentProfile;
        issue?: AgentProfileIssue;
    } {
        const builtin = this.memoryProfiles.get(profile.manifest.key);
        if (!builtin?.builtin) {
            return {profile};
        }
        const initialChanged = !this.sameSchema(profile.initialSchema, builtin.profile.initialSchema);
        const payloadChanged = !this.sameSchema(profile.payloadSchema, builtin.profile.payloadSchema);
        const outputChanged = !this.sameSchema(profile.outputSchema, builtin.profile.outputSchema);
        if (!initialChanged && !payloadChanged && !outputChanged) {
            return {profile};
        }
        const issue: AgentProfileIssue = {
            code: "builtin_schema_locked",
            message: `builtin profile ${profile.manifest.key} 的 Initial/Payload/Output schema 被锁定，运行时将继续使用内置 schema。`,
            profileKey: profile.manifest.key,
            source,
            sourcePath,
        };
        return {
            profile: {
                ...profile,
                initialSchema: builtin.profile.initialSchema,
                payloadSchema: builtin.profile.payloadSchema,
                outputSchema: builtin.profile.outputSchema,
            },
            issue,
        };
    }

    private issueFromError(error: unknown, source: AgentProfileSourceKind, sourcePath: string, profileKey?: string, fallbackCode: AgentProfileIssueCode = "load_failed"): AgentProfileIssue {
        const code = error instanceof ProfileArtifactStoreError ? error.code : fallbackCode;
        const message = error instanceof Error ? error.message : String(error);
        return {
            code,
            message,
            profileKey,
            source,
            sourcePath,
        };
    }

    private filenameIssue(profile: AgentProfile, source: AgentProfileSourceKind, sourcePath: string): AgentProfileIssue | undefined {
        const fileName = basename(sourcePath).replace(/\.profile\.(tsx|ts|mjs|js)$/, "");
        if (fileName === profile.manifest.key) {
            return undefined;
        }
        return {
            code: "filename_mismatch",
            message: `profile 文件名建议与 manifest.key 保持一致：${fileName} -> ${profile.manifest.key}`,
            profileKey: profile.manifest.key,
            source,
            sourcePath,
        };
    }

    private sameSchema(left: unknown, right: unknown): boolean {
        return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
    }


    private notCompiledIssue(source: Exclude<AgentProfileSourceKind, "memory">, file: ProfileFileEntry): AgentProfileIssue {
        return {
            code: "not_compiled",
            message: `profile ${file.fileName} 尚未编译，请先运行 Workbench 编译或 profile compile。`,
            profileKey: keyFromFileName(file.fileName),
            source,
            sourcePath: file.file,
        };
    }

    private compileFailedIssue(source: Exclude<AgentProfileSourceKind, "memory">, file: ProfileFileEntry, manifestItem: ProfileArtifactManifestEntry): AgentProfileIssue {
        const message = manifestItem.status === "compile_failed" && manifestItem.issues[0]?.message
            ? manifestItem.issues[0].message
            : `profile ${manifestItem.profileKey} 最近一次编译失败。`;
        return {
            code: "compile_failed",
            message,
            profileKey: manifestItem.profileKey,
            source,
            sourcePath: file.file,
        };
    }

    private staleIssue(source: Exclude<AgentProfileSourceKind, "memory">, file: ProfileFileEntry, manifestItem: ProfileArtifactManifestItem, reason?: "source_changed" | "dependency_changed" | "artifact_missing" | "artifact_changed" | "type_artifact_missing" | "type_artifact_changed"): AgentProfileIssue {
        const message = reason === "artifact_missing"
            ? `profile ${manifestItem.profileKey} 缺少 compiled artifact，需要重新编译。`
            : reason === "artifact_changed"
                ? `profile ${manifestItem.profileKey} 的 compiled artifact 与 manifest 不匹配，需要重新同步或重新编译。`
                : reason === "type_artifact_missing"
                    ? `profile ${manifestItem.profileKey} 缺少 type artifact，需要重新编译。`
                    : reason === "type_artifact_changed"
                        ? `profile ${manifestItem.profileKey} 的 type artifact 与 manifest 不匹配，需要重新同步或重新编译。`
                : reason === "source_changed"
                    ? `profile ${manifestItem.profileKey} 的源码已修改，需要重新编译。`
                    : reason === "dependency_changed"
                        ? `profile ${manifestItem.profileKey} 的依赖已变化，建议重新编译。`
                        : `profile ${manifestItem.profileKey} 不可运行，需要重新编译。`;
        return {
            code: "compile_stale",
            message,
            profileKey: manifestItem.profileKey,
            source,
            sourcePath: file.file,
        };
    }

    private unloadedFromFile(file: ProfileFileEntry, source: Exclude<AgentProfileSourceKind, "memory">, builtin: boolean, loadStatus: UnloadedProfileSource["loadStatus"], issue: AgentProfileIssue): UnloadedProfileSource {
        return {
            key: issue.profileKey ?? keyFromFileName(file.fileName),
            name: keyFromFileName(file.fileName),
            sourcePath: file.file,
            builtin,
            source,
            loadStatus,
            issue,
        };
    }

    private unloadedFromManifest(file: ProfileFileEntry, manifestItem: ProfileArtifactManifestEntry, source: Exclude<AgentProfileSourceKind, "memory">, builtin: boolean, loadStatus: UnloadedProfileSource["loadStatus"], issue: AgentProfileIssue): UnloadedProfileSource {
        return {
            key: manifestItem.profileKey,
            name: manifestItem.profileKey,
            sourcePath: file.file,
            builtin,
            source,
            loadStatus,
            issue,
        };
    }

    private relativeProfilePath(sourcePath: string, root: string): string {
        return relative(root, sourcePath).split(/[\\/]+/).join("/");
    }
}

/** Admission阶段的结构化payload错误；prompt将其转为error结果，队列操作继续拒绝入队。 */
export class AgentInvocationPayloadError extends Error {
    readonly code = "invalid_payload";

    constructor(message: string) {
        super(message);
        this.name = "AgentInvocationPayloadError";
    }
}

function statusFromIssue(issue: AgentProfileIssue): AgentCatalogItem["loadStatus"] {
    if (issue.code === "filename_mismatch" || issue.code === "builtin_schema_locked" || issue.code === "source_stale" || issue.code === "dependency_stale") {
        return "loaded";
    }
    if (issue.code === "not_compiled" || issue.code === "compile_failed" || issue.code === "compile_stale" || issue.code === "compiled_load_failed" || issue.code === "source_error") {
        return issue.code;
    }
    return "source_error";
}

function profileRootLabelForProject(profileRoot: string): string {
    const normalized = profileRoot.replace(/[\\/]+/gu, "/");
    const marker = "/.nbook/agent/profiles";
    const index = normalized.lastIndexOf(marker);
    if (index < 0) {
        throw new Error(`Project Root 缺少 .nbook/agent/profiles 边界：${profileRoot}`);
    }
    const prefix = normalized.slice(0, index);
    const workspaceMarker = "/workspace/";
    const workspaceIndex = prefix.lastIndexOf(workspaceMarker);
    const projectRoot = workspaceIndex >= 0 ? prefix.slice(workspaceIndex + workspaceMarker.length) : "";
    if (!projectRoot || projectRoot.includes("/")) {
        throw new Error(`Project Root 缺少 Workspace project 边界：${profileRoot}`);
    }
    return `workspace/${projectRoot}${marker}`;
}
function keyFromFileName(fileName: string): string {
    return basename(fileName).replace(/\.profile\.(tsx|ts|mjs|js)$/, "");
}
