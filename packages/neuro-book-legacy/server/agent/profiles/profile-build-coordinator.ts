import {readFile, readdir, stat} from "node:fs/promises";
import {basename, join, relative, resolve} from "node:path";
import {AgentProfileCatalog, type AgentProfileBuildCoordinatorPort, type AgentProfileBuildState} from "nbook/server/agent/profiles/catalog";
import {hashFile, readProfileArtifactManifest, resolveProfileArtifactPathContext, validateProfileArtifact} from "nbook/server/agent/profiles/profile-artifact-compiler";
import type {ProfileCompilePublishOptions} from "nbook/server/agent/profiles/profile-compile-worker-types";
import {useProfileCompileWorker} from "nbook/server/agent/profiles/profile-compile-worker";
import {appLogger} from "nbook/server/app-logs/logger";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import type {
    AgentProfileCompileAllRequestDto,
    AgentProfileCompileRequestDto,
    AgentProfileCompileResultDto,
} from "nbook/shared/dto/agent-profile.dto";

const PROFILE_BUILD_DEBOUNCE_MS = 500;

type QueuedProfileBuild = {
    fileName?: string;
    profileKey: string;
    profileKeys: string[];
    reason: string;
};

export type ProfileBuildWorkerPort = {
    compile(input: AgentProfileCompileRequestDto, publish?: ProfileCompilePublishOptions): Promise<AgentProfileCompileResultDto>;
    compileAll(input: AgentProfileCompileAllRequestDto, publish?: ProfileCompilePublishOptions): Promise<AgentProfileCompileResultDto>;
};

/**
 * HTTP runtime 的 profile 构建编排器。它只负责排队、去抖、状态和 worker 调度；
 * artifact 由主线程 worker service 通过 in-process Publisher 发布并翻转 Registry。
 */
export class ProfileBuildCoordinator implements AgentProfileBuildCoordinatorPort {
    private readonly states = new Map<string, AgentProfileBuildState>();
    private readonly queue = new Map<string, QueuedProfileBuild>();
    private readonly producerPromises = new Set<Promise<void>>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private running = false;
    private activePump: Promise<void> | null = null;
    private closing = false;

    constructor(readonly input: {
        catalog: AgentProfileCatalog;
        profileRoot: string;
        profileRootLabel?: string;
        runtimePaths: RuntimePaths;
        debounceMs?: number;
        worker?: ProfileBuildWorkerPort;
    }) {}

    /** 读取 profile 当前构建状态。 */
    stateFor(profileKey: string): AgentProfileBuildState {
        return this.states.get(profileKey) ?? idleProfileBuildState();
    }

    /**
     * 入队一次构建请求。多个请求在 500ms 单窗口内合并。
     */
    async enqueue(input: {fileName?: string; reason: string}): Promise<void> {
        this.assertOpen();
        await this.runProducer(() => this.enqueueOpen(input));
    }

    /** 完成一次已经通过入口检查的异步解析，并在关闭开始后丢弃尚未发布的请求。 */
    private async enqueueOpen(input: {fileName?: string; reason: string}): Promise<void> {
        const profileKey = input.fileName
            ? await this.profileKeyFromFile(input.fileName)
            : "*";
        if (this.closing) return;
        const profileKeys = input.fileName ? [profileKey] : await this.profileKeysForFullBuild();
        if (this.closing) return;
        const key = input.fileName ?? "*";
        this.queue.set(key, {
            fileName: input.fileName,
            profileKey,
            profileKeys,
            reason: input.reason,
        });
        const updatedAt = new Date().toISOString();
        for (const key of profileKeys) {
            this.states.set(key, {
                running: false,
                queued: true,
                reason: input.reason,
                updatedAt,
            });
        }
        this.schedule();
    }

    /**
     * 启动后对账源码集合与 manifest。这里只验源码 sha/bytes 与 compilerVersion gate，
     * 不做依赖全量 rehash；依赖变化由运行期 watcher 触发重编。
     */
    async bootSweep(): Promise<void> {
        this.assertOpen();
        await this.runProducer(() => this.bootSweepOpen());
    }

    /** 执行启动对账；关闭开始后结束扫描，不再产生新队列。 */
    private async bootSweepOpen(): Promise<void> {
        const profileRoot = resolve(this.input.profileRoot);
        const artifactPathContext = await resolveProfileArtifactPathContext(
            profileRoot,
            this.input.profileRootLabel ?? "workspace/.nbook/agent/profiles",
            this.input.runtimePaths.applicationRoot,
        );
        const [files, manifest] = await Promise.all([
            this.findProfileFiles(profileRoot),
            readProfileArtifactManifest(profileRoot, artifactPathContext),
        ]);
        for (const file of files) {
            if (this.closing) return;
            const entry = manifest.entries.find((item) => item.fileName === file.fileName);
            if (!entry || entry.status === "compile_failed") {
                await this.enqueueOpen({fileName: file.fileName, reason: "profile_boot_sweep"});
                continue;
            }
            const sourceHash = await hashFile(file.absolutePath).catch(() => null);
            if (this.closing) return;
            if (!sourceHash || sourceHash.sha256 !== entry.sourceSha256 || sourceHash.bytes !== entry.sourceBytes) {
                await this.enqueueOpen({fileName: file.fileName, reason: "profile_boot_sweep"});
            }
        }
    }

    /**
     * 立即排空当前 debounce 窗口以及 stale 结果产生的后续队列。
     *
     * 发布收口和测试可以等待一个确定的 idle checkpoint；普通 HTTP 保存仍只调用 enqueue，
     * 不会把后台编译改成同步请求。
     */
    async flush(): Promise<void> {
        this.assertOpen();
        this.cancelTimer();
        do {
            await this.startPump();
            this.cancelTimer();
        } while (!this.closing && this.queue.size > 0);
    }

    /**
     * 清理待运行任务并等待正在执行的 pump 收口。不会 terminate 全局 worker，避免影响其它手动编译调用。
     */
    async dispose(): Promise<void> {
        this.closing = true;
        this.cancelTimer();
        this.queue.clear();
        try {
            await Promise.all(this.producerPromises);
            await this.activePump;
        } finally {
            this.cancelTimer();
            this.queue.clear();
        }
    }

    private schedule(): void {
        if (this.closing) {
            return;
        }
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.startPump().catch(() => undefined);
        }, this.input.debounceMs ?? PROFILE_BUILD_DEBOUNCE_MS);
    }

    /** 同一时刻只发布一个 pump Promise，供 flush/dispose 等待真实完成态。 */
    private startPump(): Promise<void> {
        if (this.activePump) {
            return this.activePump;
        }
        if (this.closing) {
            return Promise.resolve();
        }
        const operation = this.pump().finally(() => {
            this.activePump = null;
        });
        this.activePump = operation;
        return operation;
    }

    /** 取消尚未开始的 debounce timer。 */
    private cancelTimer(): void {
        if (!this.timer) return;
        clearTimeout(this.timer);
        this.timer = null;
    }

    /** 登记会读取 Profile 根目录或 Catalog 的异步 producer，供 dispose 等待真实 I/O 终态。 */
    private runProducer(operation: () => Promise<void>): Promise<void> {
        const task = Promise.resolve().then(operation);
        const settled = task.then(() => undefined, () => undefined);
        this.producerPromises.add(settled);
        void settled.then(() => {
            this.producerPromises.delete(settled);
        });
        return task;
    }

    private async pump(): Promise<void> {
        if (this.running || this.closing || this.queue.size === 0) {
            return;
        }
        this.running = true;
        const batch = [...this.queue.values()];
        this.queue.clear();
        const runnableBatch: QueuedProfileBuild[] = [];
        try {
            const skippedAt = new Date().toISOString();
            for (const item of batch) {
                if (item.fileName && await this.profileEntryIsFresh(item.fileName)) {
                    for (const profileKey of item.profileKeys) {
                        this.states.set(profileKey, {
                            running: false,
                            queued: false,
                            reason: null,
                            updatedAt: skippedAt,
                        });
                    }
                    continue;
                }
                runnableBatch.push(item);
            }
            if (runnableBatch.length === 0) {
                return;
            }
            const startedAt = new Date().toISOString();
            for (const item of runnableBatch) {
                for (const profileKey of item.profileKeys) {
                    this.states.set(profileKey, {
                        running: true,
                        queued: false,
                        reason: item.reason,
                        updatedAt: startedAt,
                    });
                }
            }
            const profileRoot = resolve(this.input.profileRoot);
            const profileRootLabel = this.input.profileRootLabel ?? "workspace/.nbook/agent/profiles";
            const worker = this.input.worker ?? useProfileCompileWorker(profileRoot, this.input.runtimePaths, profileRootLabel);
            const publish: ProfileCompilePublishOptions = {
                mode: "in_process",
                registry: this.input.catalog,
            };
            const result = runnableBatch.length === 1 && runnableBatch[0]?.fileName
                ? await worker.compile({fileName: runnableBatch[0].fileName, dryRun: false, preview: false}, publish)
                : await worker.compileAll({preview: false}, publish);
            if (result.stale) {
                if (!this.closing) {
                    await this.requeueStaleBatch(runnableBatch);
                }
                return;
            }
            const finishedAt = new Date().toISOString();
            for (const item of runnableBatch) {
                for (const profileKey of item.profileKeys) {
                    this.states.set(profileKey, {
                        running: false,
                        queued: false,
                        reason: result.ok ? null : item.reason,
                        updatedAt: finishedAt,
                    });
                }
            }
            for (const profile of result.profiles ?? []) {
                this.states.set(profile.profileKey, {
                    running: false,
                    queued: false,
                    reason: profile.loadStatus === "loaded" ? null : "profile_build_finished",
                    updatedAt: finishedAt,
                });
            }
            if (!result.ok) {
                const detail = result.issues
                    .filter((issue) => issue.severity === "error")
                    .map((issue) => issue.message)
                    .join("；");
                throw new Error(detail ? `Profile 编译失败：${detail}` : "Profile 编译失败");
            }
        } catch (error) {
            const failedAt = new Date().toISOString();
            for (const item of batch) {
                for (const profileKey of item.profileKeys) {
                    this.states.set(profileKey, {
                        running: false,
                        queued: false,
                        reason: "profile_build_failed",
                        updatedAt: failedAt,
                    });
                }
            }
            void appLogger.warn("agent.profileBuild.failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            try {
                await this.input.catalog.refreshRuntimeRegistry("profile_build_failed");
            } catch (refreshError) {
                throw new AggregateError([error, refreshError], "Profile 构建失败且 Registry 恢复失败");
            }
            throw error;
        } finally {
            this.running = false;
            if (!this.closing && this.queue.size > 0) {
                this.schedule();
            }
        }
    }

    private async requeueStaleBatch(batch: QueuedProfileBuild[]): Promise<void> {
        let fullBuildQueued = false;
        for (const item of batch) {
            if (this.closing) {
                return;
            }
            if (item.fileName && !await this.profileSourceExists(item.fileName)) {
                if (!fullBuildQueued) {
                    fullBuildQueued = true;
                    await this.enqueue({
                        reason: "profile_build_stale_source_missing",
                    });
                }
                continue;
            }
            await this.enqueue({
                fileName: item.fileName,
                reason: "profile_build_stale",
            });
        }
    }

    /** 关闭开始后拒绝新的 producer，避免 teardown 后重新创建 timer 或 worker。 */
    private assertOpen(): void {
        if (this.closing) {
            throw new Error("ProfileBuildCoordinator 已关闭");
        }
    }

    private async profileKeyFromFile(fileName: string): Promise<string> {
        const sourcePath = resolve(this.input.profileRoot, ...fileName.split("/"));
        const source = await readFile(sourcePath, "utf8").catch(() => "");
        const match = source.match(/\bkey\s*:\s*["'`]([^"'`]+)["'`]/u);
        return match?.[1] ?? basename(fileName).replace(/\.profile\.(tsx|ts|mjs|js)$/u, "");
    }

    private async profileSourceExists(fileName: string): Promise<boolean> {
        const sourcePath = resolve(this.input.profileRoot, ...fileName.split("/"));
        return stat(sourcePath).then(() => true, () => false);
    }

    private async profileEntryIsFresh(fileName: string): Promise<boolean> {
        const profileRoot = resolve(this.input.profileRoot);
        const artifactPathContext = await resolveProfileArtifactPathContext(
            profileRoot,
            this.input.profileRootLabel ?? "workspace/.nbook/agent/profiles",
            this.input.runtimePaths.applicationRoot,
        );
        const manifest = await readProfileArtifactManifest(profileRoot, artifactPathContext).catch(() => null);
        const entry = manifest?.entries.find((item) => item.fileName === fileName);
        if (!entry || entry.status === "compile_failed") {
            return false;
        }
        const validation = await validateProfileArtifact(profileRoot, entry, artifactPathContext, {
            requireTypeArtifact: true,
            checkDependencies: false,
        });
        return validation.fresh;
    }

    private async profileKeysForFullBuild(): Promise<string[]> {
        const snapshot = await this.input.catalog.snapshot({includeFileIssues: false}).catch(() => null);
        const keys = snapshot?.profiles
            .filter((profile) => profile.source === "project")
            .map((profile) => profile.key) ?? [];
        return keys.length > 0 ? keys : ["*"];
    }

    private async findProfileFiles(root: string, current = root): Promise<Array<{fileName: string; absolutePath: string}>> {
        const entries = await readdir(current, {withFileTypes: true}).catch(() => []);
        const files: Array<{fileName: string; absolutePath: string}> = [];
        for (const entry of entries) {
            const fullPath = join(current, entry.name);
            if (entry.isDirectory()) {
                files.push(...await this.findProfileFiles(root, fullPath));
                continue;
            }
            if (!entry.isFile() || !/\.profile\.(tsx|ts|mjs|js)$/u.test(entry.name)) {
                continue;
            }
            await stat(fullPath);
            files.push({
                absolutePath: fullPath,
                fileName: relative(root, fullPath).split(/[\\/]+/).join("/"),
            });
        }
        return files.sort((left, right) => left.fileName.localeCompare(right.fileName));
    }
}

function idleProfileBuildState(): AgentProfileBuildState {
    return {
        running: false,
        queued: false,
        reason: null,
        updatedAt: null,
    };
}
