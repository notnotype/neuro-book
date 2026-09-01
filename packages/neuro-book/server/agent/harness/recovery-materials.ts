import {createHash} from "node:crypto";
import {readFile, stat} from "node:fs/promises";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import {createStoredUserMessage} from "nbook/server/agent/messages/message-utils";
import {estimateStoredMessageTokens} from "nbook/server/agent/messages/stored-message-tokens";
import type {ResolvedFileTarget} from "nbook/server/workspace-files/authorized-file-operation";
import {authorizeFileOperation} from "nbook/server/workspace-files/authorized-file-operation";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

/** Recovery materials are deliberately small and invocation-scoped. */
export const RECOVERY_MATERIAL_MAX_CAPTURE_BYTES = 16 * 1024;
export const RECOVERY_MATERIAL_MAX_VERIFY_BYTES = 256 * 1024;
export const RECOVERY_MATERIAL_MAX_REFERENCES = 16;
export const RECOVERY_MATERIAL_MAX_BODY_TOKENS = 1_200;
export const RECOVERY_MATERIAL_MAX_TOTAL_TOKENS = 2_000;

export type RecoveryMaterialSource = "read" | "write" | "edit" | "apply_patch";

export type RecoveryMaterialVersion = {
    size: number;
    mtimeMs: number;
    sha256: string;
};

export type RecoveryMaterialCandidateMetadata = {
    path: string;
    projectRoot: string;
    projectGeneration: number;
    sources: RecoveryMaterialSource[];
    version: RecoveryMaterialVersion;
};

export type RecoveryMaterialCandidate = RecoveryMaterialCandidateMetadata & {
    project: ReadyProjectSessionRef;
    capturedText: string;
};

export type RecoveryMaterialTracker = {
    readonly injectedKeys: Set<string>;
    recordSuccess(input: {
        target: ResolvedFileTarget;
        source: RecoveryMaterialSource;
        content: string;
        mtimeMs: number;
    }): void;
    snapshot(): RecoveryMaterialCandidate[];
};

/**
 * Tracks only successful, Project-bound text operations. The target carries the
 * exact ready generation captured before the operation; no path is re-resolved
 * when the candidate is later materialized.
 */
export function createRecoveryMaterialTracker(): RecoveryMaterialTracker {
    const candidates = new Map<string, RecoveryMaterialCandidate>();
    const injectedKeys = new Set<string>();

    return {
        injectedKeys,
        recordSuccess(input) {
            const project = input.target.project;
            const relativePath = input.target.relativePath;
            if (!project || !relativePath || relativePath === "." || !isSafeText(input.content)) {
                return;
            }
            const contentBytes = Buffer.byteLength(input.content, "utf8");
            if (contentBytes > RECOVERY_MATERIAL_MAX_VERIFY_BYTES) {
                return;
            }
            const version: RecoveryMaterialVersion = {
                size: contentBytes,
                mtimeMs: input.mtimeMs,
                sha256: createHash("sha256").update(input.content, "utf8").digest("hex"),
            };
            const capturedText = truncateUtf8(input.content, RECOVERY_MATERIAL_MAX_CAPTURE_BYTES);
            const previous = candidates.get(relativePath);
            const sources = previous
                ? [...new Set([...previous.sources, input.source])]
                : [input.source];
            candidates.set(relativePath, {
                path: relativePath,
                projectRoot: project.workspace.ref.projectRoot,
                projectGeneration: project.generation,
                sources,
                version,
                project,
                capturedText,
            });
        },
        snapshot() {
            return [...candidates.values()].map((candidate) => ({
                ...candidate,
                sources: [...candidate.sources],
                version: {...candidate.version},
            }));
        },
    };
}

export type RecoveryMaterializationResult = {
    message?: StoredAgentMessage;
    accepted: RecoveryMaterialCandidateMetadata[];
    skipped: Array<{path: string; reason: string}>;
};

/**
 * Validate candidates against the exact Project generation and current file
 * version, then build one bounded temporary model message. Invalid candidates
 * are intentionally omitted rather than represented by a missing-file marker.
 */
export async function materializeRecoveryMaterials(input: {
    candidates: readonly RecoveryMaterialCandidate[];
    workspaceRoot: AbsoluteFsPath;
    currentProject: ReadyProjectSessionRef | null;
    injectedKeys: ReadonlySet<string>;
}): Promise<RecoveryMaterializationResult> {
    const accepted: RecoveryMaterialCandidateMetadata[] = [];
    const skipped: Array<{path: string; reason: string}> = [];
    const references: string[] = [];
    const bodies: string[] = [];
    let bodyTokens = 0;

    for (const candidate of input.candidates.slice(0, RECOVERY_MATERIAL_MAX_REFERENCES)) {
        const key = candidateKey(candidate);
        if (input.injectedKeys.has(key)) {
            continue;
        }
        if (!input.currentProject || candidate.project !== input.currentProject || candidate.project.generation !== candidate.projectGeneration) {
            skipped.push({path: candidate.path, reason: "project_generation_unavailable"});
            continue;
        }
        let authorized: Awaited<ReturnType<typeof authorizeFileOperation>>;
        try {
            authorized = await authorizeFileOperation({
                workspaceRoot: input.workspaceRoot,
                currentProject: candidate.project,
            }, candidate.path, "read");
        } catch {
            skipped.push({path: candidate.path, reason: "authorization_failed"});
            continue;
        }
        if (authorized.target.project !== candidate.project || authorized.target.relativePath !== candidate.path) {
            skipped.push({path: candidate.path, reason: "target_mismatch"});
            continue;
        }
        let current: {size: number; mtimeMs: number; sha256: string; text: string};
        try {
            const metadata = await stat(authorized.target.absolutePath);
            if (!metadata.isFile()) {
                skipped.push({path: candidate.path, reason: "not_a_file"});
                continue;
            }
            if (metadata.size > RECOVERY_MATERIAL_MAX_VERIFY_BYTES) {
                skipped.push({path: candidate.path, reason: "verification_too_large"});
                continue;
            }
            const text = await readFile(authorized.target.absolutePath, "utf8");
            const after = await stat(authorized.target.absolutePath);
            if (!after.isFile() || after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs) {
                skipped.push({path: candidate.path, reason: "changed_during_read"});
                continue;
            }
            current = {
                size: after.size,
                mtimeMs: after.mtimeMs,
                sha256: createHash("sha256").update(text, "utf8").digest("hex"),
                text,
            };
        } catch {
            skipped.push({path: candidate.path, reason: "read_failed"});
            continue;
        }
        if (!sameStat(current.size, current.mtimeMs, candidate.version)
            || current.sha256 !== candidate.version.sha256) {
            skipped.push({path: candidate.path, reason: "version_changed"});
            continue;
        }

        const metadata: RecoveryMaterialCandidateMetadata = {
            path: candidate.path,
            projectRoot: candidate.projectRoot,
            projectGeneration: candidate.projectGeneration,
            sources: [...candidate.sources],
            version: {...candidate.version},
        };
        const reference = `- ${candidate.projectRoot}/${candidate.path} (${candidate.sources.join(", ")}; sha256 ${candidate.version.sha256.slice(0, 12)})`;
        if (recoveryMessageTokens([...references, reference], bodies) > RECOVERY_MATERIAL_MAX_TOTAL_TOKENS) {
            skipped.push({path: candidate.path, reason: "token_budget"});
            continue;
        }
        accepted.push(metadata);
        references.push(reference);

        if (!candidate.capturedText) {
            continue;
        }
        const body = truncateUtf8(current.text, RECOVERY_MATERIAL_MAX_CAPTURE_BYTES);
        if (!body.trim()) {
            continue;
        }
        const renderedBody = renderBody(candidate.path, body);
        const nextBodyTokens = bodyTokens + estimateStoredMessageTokens(createStoredUserMessage(renderedBody));
        if (nextBodyTokens > RECOVERY_MATERIAL_MAX_BODY_TOKENS
            || recoveryMessageTokens(references, [...bodies, renderedBody]) > RECOVERY_MATERIAL_MAX_TOTAL_TOKENS) {
            continue;
        }
        bodyTokens = nextBodyTokens;
        bodies.push(renderedBody);
    }

    if (accepted.length === 0) {
        return {accepted, skipped};
    }
    const text = renderRecoveryMessage(references, bodies);
    return {
        message: createStoredUserMessage(text),
        accepted,
        skipped,
    };
}

export function recoveryMaterialKey(candidate: Pick<RecoveryMaterialCandidateMetadata, "projectRoot" | "projectGeneration" | "path" | "version">): string {
    return candidateKey(candidate);
}

function candidateKey(candidate: Pick<RecoveryMaterialCandidateMetadata, "projectRoot" | "projectGeneration" | "path" | "version">): string {
    return `${candidate.projectRoot}\0${candidate.projectGeneration}\0${candidate.path}\0${candidate.version.sha256}`;
}

function sameStat(size: number, mtimeMs: number, version: RecoveryMaterialVersion): boolean {
    return size === version.size && mtimeMs === version.mtimeMs;
}

function isSafeText(value: string): boolean {
    return !value.includes("\u0000");
}

function truncateUtf8(value: string, maxBytes: number): string {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.byteLength <= maxBytes) {
        return value;
    }
    return bytes.subarray(0, maxBytes).toString("utf8");
}

function recoveryMessageTokens(references: string[], bodies: string[]): number {
    return estimateStoredMessageTokens(createStoredUserMessage(renderRecoveryMessage(references, bodies)));
}

function renderRecoveryMessage(references: string[], bodies: string[]): string {
    return [
        "<compaction-recovery-materials>",
        "Verified references from successful Project file operations. References are not file permissions; use the file tool for any further read.",
        ...references,
        ...bodies,
        "</compaction-recovery-materials>",
    ].join("\n");
}

function renderBody(path: string, text: string): string {
    const longestFence = Math.max(3, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length + 1));
    const fence = "`".repeat(longestFence);
    return `<recovery-file path=${JSON.stringify(path)}>\n${fence}text\n${text}\n${fence}\n</recovery-file>`;
}
