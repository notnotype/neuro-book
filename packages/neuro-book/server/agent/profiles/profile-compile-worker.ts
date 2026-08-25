import {Worker} from "node:worker_threads";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {copyFile, mkdir, rm} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {existsSync} from "node:fs";
import {availableParallelism} from "node:os";
import {performance} from "node:perf_hooks";
import {
    hashFile,
    listProfileArtifactSourceFiles,
    PROFILE_ARTIFACT_COMPILER_VERSION,
    profileFullReleaseChangedSinceCompile,
    ProfileReleasePublisher,
    readProfileArtifactManifest,
    resolveProfileArtifactPathContext,
    type ProfileArtifactManifest,
    type ProfileArtifactManifestEntry,
    type ProfileArtifactManifestItem,
    type ProfileArtifactPathContext,
    type ProfileArtifactSourceFile,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
export {profileSourceFileSetChangedSinceCompile} from "nbook/server/agent/profiles/profile-artifact-compiler";
import type {ProfileCompilePublishOptions, ProfileCompileWorkerResult} from "nbook/server/agent/profiles/profile-compile-worker-types";
import {appLogger} from "nbook/server/app-logs/logger";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {
    isProjectNotOpenError,
    ProjectNotOpenError,
} from "nbook/server/workspace-files/project-session-service";
import type {
    AgentProfileCompileAllRequestDto,
    AgentProfileCompileRequestDto,
    AgentProfileCompileResultDto,
    AgentProfileIssueDto,
} from "nbook/shared/dto/agent-profile.dto";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
import {
    AgentSessionNotFoundError,
    isAgentSessionNotFoundError,
} from "nbook/server/agent/session/session-not-found-error";

type CompileTask = {
    id: number;
    input: AgentProfileCompileRequestDto | AgentProfileCompileAllRequestDto;
    mode: "single" | "all";
    resolve: (result: AgentProfileCompileResultDto) => void;
    reject: (error: Error) => void;
    publish?: ProfileCompilePublishOptions;
    stale: boolean;
};

type WorkerResponse = {
    id: number;
    result: ProfileCompileWorkerResult;
};

type WorkerSlotTask = CompileTask | ProfileCompileEntryTask;

type ProfileCompileEntryTask = {
    id: number;
    mode: "entry";
    input: AgentProfileCompileRequestDto;
    resolve: (result: ProfileCompileWorkerResult) => void;
};

type CompileWorkerPaths = {
    entry: string;
    /** Product 使用预编译 worker 时为空；Source worker 才需要 TS loader。 */
    tsxLoaderUrl?: string;
    precompiled: boolean;
};

type CompileWorkerSlot = {
    id: number;
    worker: Worker;
    task: WorkerSlotTask | null;
};

type CleanupStagedDir = (dir: string) => Promise<void>;

let service: ProfileCompileWorkerService | undefined;
const WORKER_VERSION = "profile-compile-worker-v2";
const MAX_DEFAULT_COMPILE_WORKERS = 4;
const DEFAULT_PROFILE_ROOT_LABEL = "workspace/.nbook/agent/profiles";

/** 获取指定 physical root 的编译 worker；Install Profile Root 与 RuntimePaths 均由调用方提供。 */
export function useProfileCompileWorker(profileRoot: string, runtimePaths: RuntimePaths, profileRootLabel = DEFAULT_PROFILE_ROOT_LABEL): ProfileCompileWorkerService {
    const normalizedRoot = resolve(profileRoot);
    if (!service || service.version !== WORKER_VERSION || service.profileRoot !== normalizedRoot || service.profileRootLabel !== profileRootLabel || !sameRuntimePaths(service.runtimePaths, runtimePaths)) {
        service?.dispose();
        service = new ProfileCompileWorkerService(WORKER_VERSION, undefined, undefined, normalizedRoot, profileRootLabel, runtimePaths);
    }
    return service;
}

/**
 * 后台编译 worker 池。真实 TSX loader 跑在 worker 内，避免阻塞 Nitro 主线程；
 * 同一 profile 与全量编译保持互斥，防止旧任务后发布覆盖新任务。
 */
export class ProfileCompileWorkerService {
    private readonly workers: CompileWorkerSlot[] = [];
    private readonly running = new Map<number, WorkerSlotTask>();
    private readonly queue: CompileTask[] = [];
    private activeAllTask: CompileTask | null = null;
    private pumping: Promise<void> | null = null;
    private disposed = false;
    private nextId = 1;
    private nextWorkerId = 1;
    private readonly maxWorkers: number;

    constructor(
        readonly version = WORKER_VERSION,
        maxWorkers = defaultCompileWorkerCount(),
        private readonly cleanupStagedDir: CleanupStagedDir = defaultCleanupStagedDir,
        readonly profileRoot: string,
        readonly profileRootLabel = DEFAULT_PROFILE_ROOT_LABEL,
        readonly runtimePaths?: RuntimePaths,
    ) {
        this.maxWorkers = Math.max(1, maxWorkers);
    }
    private async resolveArtifactPathContext(profileRoot = this.profileRoot, rootLabel = this.profileRootLabel): Promise<ProfileArtifactPathContext> {
        if (!this.runtimePaths) {
            throw new Error("Profile compile worker 需要显式 RuntimePaths。");
        }
        return resolveProfileArtifactPathContext(profileRoot, rootLabel, this.runtimePaths.applicationRoot);
    }

    /**
     * 提交单文件编译任务。同一 fileName 的等待任务会被标记 stale，并只保留最新源码。
     */
    compile(input: AgentProfileCompileRequestDto, publish?: ProfileCompilePublishOptions): Promise<AgentProfileCompileResultDto> {
        return this.enqueue("single", input, publish);
    }

    /**
     * 提交全量编译任务。等待中的单文件任务都会标记 stale；
     * 真正编译时按 profile 文件 fan-out 到 worker 池，最后 fan-in 一次发布 manifest。
     */
    compileAll(input: AgentProfileCompileAllRequestDto = {preview: false}, publish?: ProfileCompilePublishOptions): Promise<AgentProfileCompileResultDto> {
        return this.enqueue("all", input, publish);
    }

    private enqueue(mode: CompileTask["mode"], input: CompileTask["input"], publish?: ProfileCompilePublishOptions): Promise<AgentProfileCompileResultDto> {
        if (this.disposed) {
            return Promise.resolve(workerFailedResult(input, new Error("profile compile worker disposed")));
        }
        const task: CompileTask = {
            id: this.nextId++,
            input,
            mode,
            resolve: () => {},
            reject: () => {},
            publish,
            stale: false,
        };
        const promise = new Promise<AgentProfileCompileResultDto>((resolvePromise, rejectPromise) => {
            task.resolve = resolvePromise;
            task.reject = rejectPromise;
        });
        if (mode === "all") {
            this.markAllPendingStale();
        } else {
            this.markPendingStale((input as AgentProfileCompileRequestDto).fileName);
        }
        this.queue.push(task);
        this.schedulePump();
        return promise;
    }

    private markPendingStale(fileName: string): void {
        for (const task of this.queue) {
            if (task.mode === "single" && "fileName" in task.input && task.input.fileName === fileName) {
                task.stale = true;
            }
        }
    }

    private markAllPendingStale(): void {
        for (const task of this.queue) {
            task.stale = true;
        }
    }

    private schedulePump(): void {
        if (this.pumping) return;
        this.pumping = this.pump().catch((error: unknown) => {
            const failure = error instanceof Error ? error : new Error(String(error));
            for (const task of this.queue.splice(0)) {
                task.resolve(workerFailedResult(task.input, failure));
            }
        }).finally(() => {
            this.pumping = null;
            // 同一文件的后续任务会被 running task 暂时阻塞；此时不能因 queue 非空
            // 反复排微任务，否则 Worker 的 message/exit 事件永远得不到执行。
            if (this.queue.length > 0
                && !this.activeAllTask
                && this.running.size < this.maxWorkers
                && this.nextStartableTaskIndex() >= 0) {
                this.schedulePump();
            }
        });
    }

    private async pump(): Promise<void> {
        if (this.activeAllTask) {
            return;
        }
        while (this.running.size < this.maxWorkers) {
            const taskIndex = this.nextStartableTaskIndex();
            if (taskIndex < 0) {
                return;
            }
            const [task] = this.queue.splice(taskIndex, 1);
            if (!task) {
                return;
            }
            if (task.stale) {
                task.resolve({
                    ok: false,
                    stale: true,
                    detail: null,
                    preview: null,
                    issues: [],
                });
                continue;
            }
            if (task.mode === "all") {
                this.activeAllTask = task;
                void this.runCompileAllFanout(task).then((result) => {
                    if (this.activeAllTask === task) {
                        this.activeAllTask = null;
                    }
                    task.resolve(result);
                    this.schedulePump();
                }, (error) => {
                    if (this.activeAllTask === task) {
                        this.activeAllTask = null;
                    }
                    task.resolve(workerFailedResult(task.input, error instanceof Error ? error : new Error(String(error))));
                    this.schedulePump();
                });
                return;
            }
            const slot = await this.ensureIdleWorker();
            if (!slot) {
                task.resolve(workerFailedResult(task.input, new Error("profile compile worker disposed")));
                continue;
            }
            slot.task = task;
            this.running.set(task.id, task);
            slot.worker.postMessage({
                id: task.id,
                mode: task.mode,
                input: withWorkerRoot(task.input, this.profileRoot, this.profileRootLabel, this.runtimePaths),
            });
        }
    }

    private nextStartableTaskIndex(): number {
        if (this.activeAllTask) {
            return -1;
        }
        for (let index = 0; index < this.queue.length; index += 1) {
            const task = this.queue[index];
            if (!task || task.stale || this.canStart(task)) {
                return index;
            }
        }
        return -1;
    }

    private canStart(task: CompileTask): boolean {
        if (this.activeAllTask) {
            return false;
        }
        const runningTasks = [...this.running.values()].filter(isCompileTask);
        if (task.mode === "all") {
            return runningTasks.length === 0;
        }
        if (runningTasks.some((running) => running.mode === "all")) {
            return false;
        }
        const fileName = "fileName" in task.input ? task.input.fileName : null;
        return !runningTasks.some((running) => "fileName" in running.input && running.input.fileName === fileName);
    }

    private async ensureIdleWorker(): Promise<CompileWorkerSlot | null> {
        if (this.disposed) {
            return null;
        }
        const idle = this.workers.find((slot) => !slot.task);
        if (idle) {
            return idle;
        }
        const slot: CompileWorkerSlot = {
            id: this.nextWorkerId++,
            worker: await createCompileWorker(this.runtimePaths),
            task: null,
        };
        if (this.disposed) {
            await slot.worker.terminate();
            return null;
        }
        slot.worker.on("message", (message: WorkerResponse) => this.handleMessage(slot, message));
        slot.worker.on("error", (error) => this.handleCrash(slot, error instanceof Error ? error : new Error(String(error))));
        slot.worker.on("exit", (code) => {
            if (code !== 0) {
                this.handleCrash(slot, new Error(`profile compile worker exited: ${code}`));
            }
            this.removeWorker(slot);
        });
        this.workers.push(slot);
        return slot;
    }

    private handleMessage(slot: CompileWorkerSlot, message: WorkerResponse): void {
        const task = slot.task;
        if (!task || task.id !== message.id) {
            return;
        }
        if (task.mode === "entry") {
            slot.task = null;
            this.running.delete(task.id);
            task.resolve(message.result);
            this.schedulePump();
            return;
        }
        void (async () => {
            try {
                const staged = message.result.stagedRelease;
                const artifactPathContext = await this.resolveArtifactPathContext(
                    staged?.profileRoot ?? this.profileRoot,
                    staged?.manifest.profilesRoot ?? this.profileRootLabel,
                );
                const result = await publishWorkerResult(task, message.result, artifactPathContext, this.cleanupStagedDir);
                slot.task = null;
                this.running.delete(task.id);
                task.resolve(result);
            } catch (error) {
                slot.task = null;
                this.running.delete(task.id);
                if (isProjectNotOpenError(error) || isAgentSessionNotFoundError(error)) {
                    task.reject(error);
                } else {
                    task.resolve(workerFailedResult(task.input, error instanceof Error ? error : new Error(String(error))));
                }
            }
            this.schedulePump();
        })();
    }

    private handleCrash(slot: CompileWorkerSlot, error: Error): void {
        const task = slot.task;
        slot.task = null;
        this.running.delete(task?.id ?? -1);
        this.removeWorker(slot);
        if (task) {
            task.resolve(workerFailedResult(task.input, error));
        }
        this.schedulePump();
    }

    private removeWorker(slot: CompileWorkerSlot): void {
        const index = this.workers.indexOf(slot);
        if (index >= 0) {
            this.workers.splice(index, 1);
        }
    }

    /**
     * HMR 或服务版本变更时关闭旧 worker，避免继续使用旧 loader 状态。
     */
    dispose(): void {
        this.disposed = true;
        const error = new Error("profile compile worker disposed");
        for (const slot of this.workers.splice(0)) {
            void slot.worker.terminate();
            if (slot.task) {
                slot.task.resolve(workerFailedResult(slot.task.input, error));
            }
        }
        this.running.clear();
        if (this.activeAllTask) {
            this.activeAllTask.resolve(workerFailedResult(this.activeAllTask.input, error));
            this.activeAllTask = null;
        }
        for (const task of this.queue.splice(0)) {
            task.resolve(workerFailedResult(task.input, error));
        }
    }

    private async runCompileAllFanout(task: CompileTask): Promise<AgentProfileCompileResultDto> {
        const startedAt = performance.now();
        const buildCompiledDir = join(dirname(this.profileRoot), ".staging", "profile-artifact-fan-in", randomUUID());
        const stagedDirs: string[] = [buildCompiledDir];
        try {
            const artifactPathContext = await this.resolveArtifactPathContext();
            const [files, existingManifest] = await Promise.all([
                listProfileArtifactSourceFiles(this.profileRoot),
                readProfileArtifactManifest(this.profileRoot, artifactPathContext),
            ]);
            await mkdir(buildCompiledDir, {recursive: true});
            const workerResults = await this.compileEntriesInWorkerPool(files);
            const entries: ProfileArtifactManifestEntry[] = [];
            const issues: AgentProfileIssueDto[] = [];
            for (const result of workerResults) {
                if (result.stagedRelease) {
                    stagedDirs.push(result.stagedRelease.buildCompiledDir);
                }
                if (!result.stagedRelease || result.stagedRelease.manifest.entries.length !== 1) {
                    return compileAllInfrastructureFailure(result, startedAt);
                }
                const entry = result.stagedRelease.manifest.entries[0]!;
                entries.push(entry);
                issues.push(...result.issues);
                if (entry.status !== "compile_failed") {
                    await copyCompiledEntryArtifacts(result.stagedRelease.buildCompiledDir, buildCompiledDir, entry);
                }
            }
            if (await profileFullReleaseChangedSinceCompile(this.profileRoot, files, entries)) {
                return {
                    ok: false,
                    stale: true,
                    detail: null,
                    preview: null,
                    issues: [],
                    elapsedMs: elapsedSince(startedAt),
                    compiledCount: entries.filter(isLoadedManifestEntry).length,
                    profiles: profileItemsFromEntries(entries),
                };
            }
            const nextEntries = entries.sort((left, right) => left.fileName.localeCompare(right.fileName));
            const manifest: ProfileArtifactManifest = {
                compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
                generatedAt: JSON.stringify(existingManifest.entries) === JSON.stringify(nextEntries) ? existingManifest.generatedAt : new Date().toISOString(),
                profilesRoot: this.profileRootLabel,
                entries: nextEntries,
                profiles: nextEntries.filter(isLoadedManifestEntry),
            };
            await new ProfileReleasePublisher({
                profileRoot: this.profileRoot,
                artifactPathContext,
                mode: task.publish?.mode ?? "disk_only",
                registry: task.publish?.registry,
            }).publishStaged(buildCompiledDir, manifest);
            return {
                ok: issues.every((issue) => issue.severity !== "error") && manifest.entries.length === files.length && manifest.entries.every(isLoadedManifestEntry),
                stale: false,
                detail: null,
                preview: null,
                issues,
                elapsedMs: elapsedSince(startedAt),
                compiledCount: manifest.profiles.length,
                profiles: profileItemsFromEntries(manifest.entries),
            };
        } catch (error) {
            return {
                ok: false,
                stale: false,
                detail: null,
                preview: null,
                issues: [issueFromError(error, "*", "compile_all_failed")],
                elapsedMs: elapsedSince(startedAt),
                compiledCount: 0,
                profiles: [],
            };
        } finally {
            await cleanupStagedDirs(stagedDirs, "compile_all_cleanup_failed", this.cleanupStagedDir);
        }
    }

    private async compileEntriesInWorkerPool(files: ProfileArtifactSourceFile[]): Promise<ProfileCompileWorkerResult[]> {
        const results: ProfileCompileWorkerResult[] = new Array<ProfileCompileWorkerResult>(files.length);
        let nextIndex = 0;
        const workers = Array.from({length: Math.min(this.maxWorkers, files.length)}, async () => {
            while (true) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= files.length) {
                    return;
                }
                const file = files[index]!;
                results[index] = await this.compileEntryInWorker(file.fileName);
            }
        });
        await Promise.all(workers);
        return results;
    }

    private async compileEntryInWorker(fileName: string): Promise<ProfileCompileWorkerResult> {
        const task: ProfileCompileEntryTask = {
            id: this.nextId++,
            mode: "entry",
            input: {
                fileName,
                dryRun: false,
                preview: false,
            },
            resolve: () => {},
        };
        const promise = new Promise<ProfileCompileWorkerResult>((resolvePromise) => {
            task.resolve = resolvePromise;
        });
        const slot = await this.ensureIdleWorker();
        if (!slot) {
            task.resolve(workerFailedResult(task.input, new Error("profile compile worker disposed")));
            return promise;
        }
        slot.task = task;
        this.running.set(task.id, task);
            slot.worker.postMessage({
                id: task.id,
                mode: task.mode,
                input: withWorkerRoot(task.input, this.profileRoot, this.profileRootLabel, this.runtimePaths),
            });
        return promise;
    }
}

/**
 * 在主线程发布 worker 生成的 staging release，并清理临时目录。
 */
async function publishWorkerResult(
    task: CompileTask,
    result: ProfileCompileWorkerResult,
    artifactPathContext: ProfileArtifactPathContext,
    cleanupStagedDir: CleanupStagedDir = defaultCleanupStagedDir,
): Promise<AgentProfileCompileResultDto> {
    throwLifecycleError(result);
    const staged = result.stagedRelease;
    if (!staged) {
        return stripWorkerResult(result);
    }
    try {
        if (await workerResultSourceChanged(task, result)) {
            return {
                ...stripWorkerResult(result),
                ok: false,
                stale: true,
                issues: [],
            };
        }
        const publisher = new ProfileReleasePublisher({
            profileRoot: staged.profileRoot,
            artifactPathContext,
            mode: task.publish?.mode ?? "disk_only",
            registry: task.publish?.registry,
        });
        if (task.mode === "single") {
            const entry = staged.manifest.entries[0];
            if (!entry || staged.manifest.entries.length !== 1) {
                throw new Error("single profile compile worker 未返回单文件 staging entry。");
            }
            await publisher.publishStagedEntry(staged.buildCompiledDir, entry);
        } else {
            await publisher.publishStaged(staged.buildCompiledDir, staged.manifest);
        }
        return stripWorkerResult(result);
    } catch (error) {
        return {
            ok: false,
            stale: false,
            detail: null,
            preview: null,
            issues: [{
                severity: "error",
                message: error instanceof Error ? error.message : String(error),
                code: "compile_publish_failed",
                fileName: "fileName" in task.input ? task.input.fileName : "*",
                stack: process.env.NODE_ENV === "production" ? undefined : error instanceof Error ? error.stack : undefined,
            }],
            elapsedMs: result.elapsedMs,
            compiledCount: result.compiledCount,
            profiles: result.profiles,
        };
    } finally {
        await cleanupStagedDirs([staged.buildCompiledDir], "compile_cleanup_failed", cleanupStagedDir);
    }
}

async function cleanupStagedDirs(dirs: string[], code: string, cleanupStagedDir: CleanupStagedDir): Promise<void> {
    await Promise.all([...new Set(dirs)].map(async (dir) => {
        try {
            await cleanupStagedDir(dir);
        } catch (error) {
            void appLogger.warn("agent.profileCompile.cleanupFailed", {
                code,
                dir,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }));
}

async function defaultCleanupStagedDir(dir: string): Promise<void> {
    await rm(dir, {recursive: true, force: true});
}

async function copyCompiledEntryArtifacts(fromCompiledDir: string, toCompiledDir: string, entry: ProfileArtifactManifestItem): Promise<void> {
    await copyStagedArtifact(fromCompiledDir, toCompiledDir, entry.artifactFileName);
    if (entry.typeFileName) {
        await copyStagedArtifact(fromCompiledDir, toCompiledDir, entry.typeFileName);
    }
}

async function copyStagedArtifact(fromCompiledDir: string, toCompiledDir: string, artifactFileName: string): Promise<void> {
    const sourcePath = join(fromCompiledDir, ...artifactFileName.split("/"));
    const targetPath = join(toCompiledDir, ...artifactFileName.split("/"));
    if (!existsSync(sourcePath)) {
        return;
    }
    await mkdir(dirname(targetPath), {recursive: true});
    await copyFile(sourcePath, targetPath);
}

async function workerResultSourceChanged(task: CompileTask, result: ProfileCompileWorkerResult): Promise<boolean> {
    if (!result.stagedRelease) {
        return false;
    }
    const input = task.input;
    if (task.mode === "single" && "fileName" in input) {
        const entry = result.stagedRelease.manifest.entries.find((item) => item.fileName === input.fileName);
        return !entry || await entrySourceChanged(result.stagedRelease.profileRoot, entry);
    }
    return entriesChangedSinceCompile(result.stagedRelease.profileRoot, result.stagedRelease.manifest.entries);
}

async function entriesChangedSinceCompile(profileRoot: string, entries: ProfileArtifactManifestEntry[]): Promise<boolean> {
    for (const entry of entries) {
        if (await entrySourceChanged(profileRoot, entry)) {
            return true;
        }
    }
    return false;
}

async function entrySourceChanged(profileRoot: string, entry: ProfileArtifactManifestEntry): Promise<boolean> {
    const current = await hashFile(join(profileRoot, ...entry.fileName.split("/"))).catch(() => null);
    return !current || current.sha256 !== entry.sourceSha256 || current.bytes !== entry.sourceBytes;
}

function compileAllInfrastructureFailure(result: ProfileCompileWorkerResult, startedAt: number): AgentProfileCompileResultDto {
    return {
        ok: false,
        stale: result.stale,
        detail: null,
        preview: null,
        issues: result.issues.length > 0 ? result.issues : [issueFromError(new Error("profile compile worker 未返回单文件 staging release。"), "*", "compile_worker_failed")],
        elapsedMs: elapsedSince(startedAt),
        compiledCount: 0,
        profiles: [],
    };
}

function profileItemsFromEntries(entries: ProfileArtifactManifestEntry[]): NonNullable<AgentProfileCompileResultDto["profiles"]> {
    return entries.map((entry) => ({
        profileKey: entry.profileKey,
        fileName: entry.fileName,
        loadStatus: entry.status === "compile_failed" ? "compile_failed" : "loaded",
    }));
}

function isLoadedManifestEntry(entry: ProfileArtifactManifestEntry): entry is ProfileArtifactManifestItem {
    return entry.status !== "compile_failed";
}

function isCompileTask(task: WorkerSlotTask): task is CompileTask {
    return task.mode === "single" || task.mode === "all";
}

function issueFromError(error: unknown, fileName: string, code: string): AgentProfileIssueDto {
    return {
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        code,
        fileName,
        stack: process.env.NODE_ENV === "production" ? undefined : error instanceof Error ? error.stack : undefined,
    };
}

function elapsedSince(startedAt: number): number {
    return Math.round((performance.now() - startedAt) * 100) / 100;
}

/**
 * 去掉 worker 内部字段，避免 staging 目录路径进入 HTTP 响应。
 */
function stripWorkerResult(result: ProfileCompileWorkerResult): AgentProfileCompileResultDto {
    const {stagedRelease: _stagedRelease, lifecycleError: _lifecycleError, ...publicResult} = result;
    return publicResult;
}

function throwLifecycleError(result: ProfileCompileWorkerResult): void {
    if (!result.lifecycleError) {
        return;
    }
    if (result.lifecycleError.code === "PROJECT_NOT_OPEN") {
        throw new ProjectNotOpenError(result.lifecycleError.projectRoot);
    }
    throw new AgentSessionNotFoundError(result.lifecycleError.sessionId);
}

function workerFailedResult(input: AgentProfileCompileRequestDto | AgentProfileCompileAllRequestDto, error: Error): AgentProfileCompileResultDto {
    const fileName = "fileName" in input ? input.fileName : "*";
    return {
        ok: false,
        stale: false,
        detail: null,
        preview: null,
        issues: [{
            severity: "error",
            message: error.message,
            code: "compile_worker_failed",
            fileName,
            stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
        }],
    };
}

/**
 * 默认 worker 数给主线程和 esbuild 内部并行留余量，避免全量重编吃满机器。
 */
function defaultCompileWorkerCount(): number {
    return Math.max(1, Math.min(MAX_DEFAULT_COMPILE_WORKERS, availableParallelism() - 2));
}


function withWorkerRoot<T extends AgentProfileCompileRequestDto | AgentProfileCompileAllRequestDto>(input: T, profileRoot: string, profileRootLabel: string, runtimePaths?: RuntimePaths): T & {profileRoot: string; profileRootLabel: string; runtimePaths?: RuntimePaths} {
    return {
        ...input,
        profileRoot,
        profileRootLabel,
        runtimePaths,
    };
}
function sameRuntimePaths(left: RuntimePaths | undefined, right: RuntimePaths | undefined): boolean {
    return left?.applicationRoot === right?.applicationRoot
        && left?.stateRoot === right?.stateRoot
        && left?.workspaceRoot === right?.workspaceRoot
        && left?.userNbookRoot === right?.userNbookRoot;
}

async function createCompileWorker(runtimePaths?: RuntimePaths): Promise<Worker> {
    const workerPaths = await resolveCompileWorkerPaths(runtimePaths);
    if (workerPaths.precompiled) {
        return new Worker(pathToFileURL(workerPaths.entry));
    }
    return new Worker(pathToFileURL(workerPaths.entry), {
        execArgv: ["--import", requiredWorkerPath(workerPaths.tsxLoaderUrl, "tsx loader")],
    });
}

async function resolveCompileWorkerPaths(runtimePaths?: RuntimePaths): Promise<CompileWorkerPaths> {
    if (!runtimePaths) {
        throw new Error("Profile compile worker 需要显式 RuntimePaths。");
    }
    return await resolveProfileCompileWorkerPathsForRoot(runtimePaths.applicationRoot, process.env);
}

/**
 * 按指定 Product/source root 解析 worker 入口和 TSX loader 依赖。
 */
export async function resolveProfileCompileWorkerPathsForRoot(
    root: string,
    env: NodeJS.ProcessEnv = process.env,
): Promise<CompileWorkerPaths> {
    const context = await resolveRuntimeArtifactCompilerContext(root, env);
    if (context.productRuntime) {
        return {
            entry: resolve(context.outputRoot, "authoring", "profile-compile-worker.mjs"),
            precompiled: true,
        };
    }

    const entry = resolve(root, "server", "agent", "profiles", "profile-compile-worker-entry.ts");
    const runtime = resolve(root, "server", "agent", "profiles", "profile-compile-worker-runtime.ts");
    if (!existsSync(entry) || !existsSync(runtime)) {
        throw new Error("Product runtime 缺少 profile compile worker 运行源码，请确认 server/ 已打入 product 根。");
    }
    return {
        entry,
        precompiled: false,
        tsxLoaderUrl: resolvePackageUrl(
            existsSync(resolve(root, "package.json")) ? resolve(root, "package.json") : entry,
            "tsx",
            false,
        ),
    };
}

/**
 * 将 package specifier 解析为可动态 import 的绝对 file URL。
 */
function resolvePackageUrl(requireRoot: string, specifier: string, productRuntime: boolean): string {
    try {
        const requireFromRoot = createRequire(pathToFileURL(requireRoot));
        return pathToFileURL(requireFromRoot.resolve(specifier)).href;
    } catch (error) {
        if (productRuntime) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Product runtime 缺少 tsx vendor：无法从 .output/server/node_modules 解析 ${specifier}。请确认 product:stage 已复制 tsx。原始错误：${message}`);
        }
        throw error;
    }
}

/** 可选 Product/Source 路径在进入具体执行分支后必须完整。 */
function requiredWorkerPath(value: string | undefined, label: string): string {
    if (!value) {
        throw new Error(`Profile compile worker 缺少 ${label}。`);
    }
    return value;
}
