import {performance} from "node:perf_hooks";
import {randomUUID} from "node:crypto";
import {cp, rm} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {
    compileProfileArtifacts,
    cleanupProfileArtifactStaging,
    listProfileArtifactSourceFiles,
    PROFILE_ARTIFACT_COMPILER_VERSION,
    profileFullReleaseChangedSinceCompile,
    ProfileArtifactSourceMissingError,
    resolveProfileArtifactPathContext,
    stageProfileArtifactEntry,
    stageProfileArtifacts,
} from "nbook/server/agent/profiles/profile-artifact-compiler";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {listProfileFiles, readProfileSource, saveProfileSourceDraft} from "nbook/server/agent/profiles/workbench-service";
import type {ProfileCompileWorkerResult} from "nbook/server/agent/profiles/profile-compile-worker-types";
import type {RuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import type {
    AgentProfileCompileAllRequestDto,
    AgentProfileCompileRequestDto,
    AgentProfileCompileResultDto,
    AgentProfileIssueDto,
} from "nbook/shared/dto/agent-profile.dto";
import {
    isProjectNotOpenError,
    type ProjectNotOpenError,
} from "nbook/server/workspace-files/project-session-service";
import {
    isAgentSessionNotFoundError,
    type AgentSessionNotFoundError,
} from "nbook/server/agent/session/session-not-found-error";

type InternalProfileCompileRequest = AgentProfileCompileRequestDto & {
    profileRoot?: string;
    profileRootLabel?: string;
    runtimePaths?: RuntimePaths;
};

type InternalProfileCompileAllRequest = AgentProfileCompileAllRequestDto & {
    profileRoot?: string;
    profileRootLabel?: string;
    runtimePaths?: RuntimePaths;
};

const DEFAULT_PROFILE_ROOT_LABEL = "workspace/.nbook/agent/profiles";

function profileRootLabel(input: {profileRootLabel?: string}): string {
    return input.profileRootLabel ?? DEFAULT_PROFILE_ROOT_LABEL;
}

/**
 * Worker 内执行真实 profile 编译。这里允许走完整 runtime loader，
 * 因为它运行在 worker 线程中，不阻塞 Nitro 主事件循环。
 */
export async function runProfileCompile(input: InternalProfileCompileRequest): Promise<ProfileCompileWorkerResult> {
    const startedAt = performance.now();
    try {
        const profileRoot = resolveProfileRoot(input);
        const artifactPathContext = await resolveWorkerArtifactPathContext(input, profileRoot);
        if (input.dryRun) {
            const result = await runDryRunProfilePreview(input, profileRoot);
            return {
                ...result,
                elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
            };
        }
        const staged = await stageProfileArtifactEntry({
            profileRoot: profileRoot,
            fileName: input.fileName,
            artifactPathContext,
        });
        const entry = staged.entry;
        const issues = entry.status === "compile_failed"
            ? entry.issues.map((issue) => issueFromCompileFailure(issue, input.fileName))
            : [];
        return {
            ok: entry.status !== "compile_failed",
            stale: false,
            detail: null,
            preview: null,
            issues,
            compiledCount: staged.compiled ? 1 : 0,
            profiles: [{
                profileKey: entry.profileKey,
                fileName: entry.fileName,
                loadStatus: entry.status === "compile_failed" ? "compile_failed" : "loaded",
            }],
            stagedRelease: {
                profileRoot: staged.profileRoot,
                buildCompiledDir: staged.buildCompiledDir,
                manifest: {
                    compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
                    generatedAt: new Date().toISOString(),
                    profilesRoot: profileRootLabel(input),
                    entries: [entry],
                    profiles: staged.compiled ? [staged.compiled] : [],
                },
            },
            elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        };
    } catch (error) {
        if (isProjectNotOpenError(error)) {
            return lifecycleErrorResult(error, startedAt);
        }
        if (isAgentSessionNotFoundError(error)) {
            return lifecycleErrorResult(error, startedAt);
        }
        if (error instanceof ProfileArtifactSourceMissingError) {
            return {
                ok: false,
                stale: true,
                detail: null,
                preview: null,
                issues: [],
                compiledCount: 0,
                profiles: [],
                elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
            };
        }
        return {
            ok: false,
            stale: false,
            detail: null,
            preview: null,
            issues: [issueFromError(error, input.fileName)],
            elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        };
    }
}

/**
 * Worker 池 full build 的单文件 fan-out 入口。它只返回单条 entry 的 staging release，
 * 不读取旧 manifest，也不发布真实 `.compiled`。
 */
export async function runProfileCompileEntry(input: InternalProfileCompileRequest): Promise<ProfileCompileWorkerResult> {
    const startedAt = performance.now();
    try {
        const profileRoot = resolveProfileRoot(input);
        const artifactPathContext = await resolveWorkerArtifactPathContext(input, profileRoot);
        const staged = await stageProfileArtifactEntry({
            profileRoot: profileRoot,
            fileName: input.fileName,
            artifactPathContext,
        });
        const entry = staged.entry;
        const issues = entry.status === "compile_failed"
            ? entry.issues.map((issue) => issueFromCompileFailure(issue, entry.fileName))
            : [];
        return {
            ok: entry.status !== "compile_failed",
            stale: false,
            detail: null,
            preview: null,
            issues,
            compiledCount: staged.compiled ? 1 : 0,
            profiles: [{
                profileKey: entry.profileKey,
                fileName: entry.fileName,
                loadStatus: entry.status === "compile_failed" ? "compile_failed" : "loaded",
            }],
            stagedRelease: {
                profileRoot: staged.profileRoot,
                buildCompiledDir: staged.buildCompiledDir,
                manifest: {
                    compilerVersion: PROFILE_ARTIFACT_COMPILER_VERSION,
                    generatedAt: new Date().toISOString(),
                    profilesRoot: profileRootLabel(input),
                    entries: [entry],
                    profiles: staged.compiled ? [staged.compiled] : [],
                },
            },
            elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        };
    } catch (error) {
        return {
            ok: false,
            stale: false,
            detail: null,
            preview: null,
            issues: [issueFromError(error, input.fileName)],
            compiledCount: 0,
            profiles: [],
            elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        };
    }
}

/**
 * Worker 内全量编译用户 profile root，供 Workbench 的“编译全部”使用。
 */
export async function runProfileCompileAll(input: InternalProfileCompileAllRequest = {preview: false}): Promise<ProfileCompileWorkerResult> {
    const startedAt = performance.now();
    try {
        const profileRoot = resolveProfileRoot(input);
        const artifactPathContext = await resolveWorkerArtifactPathContext(input, profileRoot);
        const sourceFilesAtStart = await listProfileArtifactSourceFiles(profileRoot);
        const files = await listProfileFiles({
            profileRoot: profileRoot,
            artifactPathContextResolver: async (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, input.runtimePaths!.applicationRoot),
        });
        const staged = await stageProfileArtifacts({
            profileRoot: profileRoot,
            artifactPathContext,
        });
        const profileItems = files.map((file) => {
            const manifestEntry = staged.manifest.entries.find((profile) => profile.fileName === file.fileName);
            return {
                profileKey: manifestEntry?.profileKey ?? file.profileKey ?? file.fileName,
                fileName: file.fileName,
                loadStatus: manifestEntry
                    ? manifestEntry.status === "compile_failed" ? "compile_failed" as const : "loaded" as const
                    : "not_compiled" as const,
            };
        });
        const issues = staged.manifest.entries.flatMap((entry) => entry.status === "compile_failed"
            ? entry.issues.map((issue) => issueFromCompileFailure(issue, entry.fileName))
            : []);
        if (await profileFullReleaseChangedSinceCompile(profileRoot, sourceFilesAtStart, staged.manifest.entries)) {
            await cleanupProfileArtifactStaging(staged.buildCompiledDir);
            return {
                ok: false,
                stale: true,
                detail: null,
                preview: null,
                issues: [],
                compiledCount: staged.compiled.length,
                profiles: profileItems,
                elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
            };
        }
        return {
            ok: issues.every((issue) => issue.severity !== "error") && profileItems.every((item) => item.loadStatus === "loaded") && profileItems.length === files.length,
            stale: false,
            detail: null,
            preview: null,
            issues,
            compiledCount: staged.compiled.length,
            profiles: profileItems,
            stagedRelease: {
                profileRoot: staged.profileRoot,
                buildCompiledDir: staged.buildCompiledDir,
                manifest: staged.manifest,
            },
            elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        };
    } catch (error) {
        return {
            ok: false,
            stale: false,
            detail: null,
            preview: null,
            issues: [issueFromError(error, "*")],
            compiledCount: 0,
            profiles: [],
            elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
        };
    }
}

/**
 * 在后台 worker 内用临时 profile root 预览当前源码，不污染真实用户 `.compiled`。
 */
async function runDryRunProfilePreview(input: InternalProfileCompileRequest, profileRoot: string): Promise<AgentProfileCompileResultDto> {
    const temporaryRoot = join(dirname(profileRoot), ".staging", "profile-source-check", randomUUID());
    try {
        await cp(profileRoot, temporaryRoot, {recursive: true, force: true}).catch(() => undefined);
        if (input.source !== undefined) {
            await saveProfileSourceDraft({
                fileName: input.fileName,
                source: input.source,
            }, {
                profileRoot: temporaryRoot,
            });
        }
        const artifactPathContext = await resolveWorkerArtifactPathContext(input, temporaryRoot);
        await compileProfileArtifacts({
            profileRoot: temporaryRoot,
            fileName: input.fileName,
            artifactPathContext,
        });
        const profiles = new AgentProfileCatalog(
            temporaryRoot,
            undefined,
            undefined,
            undefined,
            async (profileRoot, rootLabel) => resolveProfileArtifactPathContext(profileRoot, rootLabel, input.runtimePaths!.applicationRoot),
            {install: "temporary-profile-source-check"},
        );
        const detail = await readProfileSource(profiles, {fileName: input.fileName}, {
            profileRoot: temporaryRoot,
        });
        const issues = detail.issues;
        if (issues.some((issue) => issue.severity === "error") || !detail.manifest?.key) {
            return {
                ok: false,
                stale: false,
                detail,
                preview: null,
                issues,
            };
        }
        if (!input.runtimePaths) {
            throw new Error("Profile compile preview 需要显式 RuntimePaths。");
        }
        const [{NeuroAgentHarness}, {previewAgentProfilePrepare}] = await Promise.all([
            import("nbook/server/agent/harness/neuro-agent-harness"),
            import("nbook/server/agent/profiles/profile-http-service"),
        ]);
        const preview = await previewAgentProfilePrepare(new NeuroAgentHarness({
            runtimePaths: input.runtimePaths,
            profiles,
        }), {
            profileKey: detail.manifest.key,
            sessionId: input.sessionId,
            initial: input.initial,
            initialOverrides: input.initialOverrides,
        });
        return {
            ok: preview.ok && issues.every((issue) => issue.severity !== "error"),
            stale: false,
            detail,
            preview,
            issues: [...issues, ...preview.issues],
        };
    } finally {
        await rm(temporaryRoot, {recursive: true, force: true});
    }
}

async function resolveWorkerArtifactPathContext(
    input: {runtimePaths?: RuntimePaths; profileRootLabel?: string},
    profileRoot: string,
) {
    if (!input.runtimePaths) {
        throw new Error("Profile compile worker 需要显式 RuntimePaths。");
    }
    return resolveProfileArtifactPathContext(
        profileRoot,
        profileRootLabel(input),
        input.runtimePaths.applicationRoot,
    );
}
function resolveProfileRoot(input: {profileRoot?: string}): string {
    if (!input.profileRoot) {
        throw new Error("Profile compile worker 需要显式 Profile Root。");
    }
    return resolve(input.profileRoot);
}

function lifecycleErrorResult(error: ProjectNotOpenError | AgentSessionNotFoundError, startedAt: number): ProfileCompileWorkerResult {
    return {
        ok: false,
        stale: false,
        detail: null,
        preview: null,
        issues: [],
        lifecycleError: isAgentSessionNotFoundError(error)
            ? {code: "SESSION_NOT_FOUND", sessionId: error.sessionId}
            : {code: "PROJECT_NOT_OPEN", projectRoot: error.projectRoot},
        elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
    };
}

/**
 * 将 worker 内异常收敛为 DTO issue，避免跨线程 Error 对象序列化差异。
 */
function issueFromError(error: unknown, fileName: string): AgentProfileIssueDto {
    return {
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
        code: "compile_failed",
        fileName,
        stack: process.env.NODE_ENV === "production" ? undefined : error instanceof Error ? error.stack : undefined,
    };
}


/**
 * 将 manifest 中的编译失败项转换为前端统一 issue。
 */
function issueFromCompileFailure(issue: {code: "compile_failed"; message: string; stack?: string}, fileName: string): AgentProfileIssueDto {
    return {
        severity: "error",
        message: issue.message,
        code: issue.code,
        fileName,
        stack: issue.stack,
    };
}
