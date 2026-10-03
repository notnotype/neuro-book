import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
    ProjectWorkspaceKey,
    ResolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import {
    PROJECT_FILE_INDEX_MODULE_TOKEN,
} from "nbook/server/workspace-files/project-file-index";
import {
    requireReadyModuleHandle,
    runReadyProjectOperation,
} from "nbook/server/runtime/product-project";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

type ContextAccessSignal = "index-read" | "state-read" | "read" | "explicitInput";

const contextAccessWriteQueues = new Map<ProjectWorkspaceKey, Map<string, Promise<void>>>();

export type ContextAccessEntrySession = {
    sessionId: string;
    lastAccessedAt: string;
    accessCount: number;
};

export type ContextAccessEntry = {
    path: string;
    kind: "lorebook" | "manuscript" | "other";
    title: string | null;
    lastAccessedAt: string;
    accessCount: number;
    sessions: ContextAccessEntrySession[];
    signals: Partial<Record<ContextAccessSignal, number>>;
    score: {
        value: number;
        updatedAt: string;
    };
};

export type ContextAccessState = {
    version: 1;
    project: {
        slug: string;
    };
    profile: string;
    updatedAt: string;
    entries: ContextAccessEntry[];
};

export type RecordContextAccessInput = {
    /** 本次访问开始时捕获的精确 Project ready generation。 */
    project: ReadyProjectSessionRef;
    profileKey: string;
    sessionId: string;
    filePath: string;
    signal?: ContextAccessSignal;
    now?: Date;
};

export type RecordExplicitContextEntriesInput = {
    /** 本次 invocation 开始时捕获的精确 Project ready generation。 */
    project: ReadyProjectSessionRef;
    profileKey: string;
    sessionId: string;
    entries: Array<{path: string}>;
    now?: Date;
};

/**
 * 记录成功读取或显式输入的 Project 上下文访问，并刷新 generated recommendations。
 */
export async function recordContextAccess(input: RecordContextAccessInput): Promise<void> {
    const normalized = normalizeContentAccessPath(input.filePath);
    if (!normalized) {
        return;
    }
    await runReadyProjectOperation(input.project, async () => {
        const fileIndex = requireReadyModuleHandle(input.project, PROJECT_FILE_INDEX_MODULE_TOKEN);
        const profileKey = contextProfileKey(input.profileKey);
        await fileIndex.mutate(() => updateContextAccessState({
            project: input.project,
            profileKey,
            sessionId: input.sessionId,
            path: normalized.path,
            signal: input.signal ?? normalized.signal,
            now: input.now ?? new Date(),
        }));
    });
}

/**
 * 记录 writer 等 profile invocation 中显式传入的 context entries。
 */
export async function recordExplicitContextEntries(input: RecordExplicitContextEntriesInput): Promise<void> {
    const entries = input.entries
        .map((entry) => normalizeContentAccessPath(entry.path))
        .filter((entry): entry is {path: string; signal: ContextAccessSignal} => entry !== null);
    if (entries.length === 0) {
        return;
    }
    await runReadyProjectOperation(input.project, async () => {
        const fileIndex = requireReadyModuleHandle(input.project, PROJECT_FILE_INDEX_MODULE_TOKEN);
        const profileKey = contextProfileKey(input.profileKey);
        for (const normalized of entries) {
            await fileIndex.mutate(() => updateContextAccessState({
                project: input.project,
                profileKey,
                sessionId: input.sessionId,
                path: normalized.path,
                signal: "explicitInput",
                now: input.now ?? new Date(),
            }));
        }
    });
}

/**
 * 归一化工具读取路径。内容节点的 index.md 和同级 state.md 都归到节点目录。
 */
export function normalizeContentAccessPath(filePath: string): {path: string; signal: ContextAccessSignal} | null {
    const rawPath = filePath.trim().replaceAll("\\", "/").replace(/^\/+/, "");
    const normalized = normalizeEntryPath(filePath);
    if (!normalized.startsWith("lorebook/") && !normalized.startsWith("manuscript/")) {
        return null;
    }
    if (rawPath.endsWith("/index.md")) {
        return {path: normalized, signal: "index-read"};
    }
    if (rawPath.endsWith("/state.md")) {
        return {path: normalized, signal: "state-read"};
    }
    if (normalized.endsWith(".md")) {
        return {path: normalized, signal: "read"};
    }
    return {path: normalized.endsWith("/") ? normalized : `${normalized}/`, signal: "read"};
}

/**
 * 生成某个 profile 的 generated recommendation Markdown。
 */
export function renderGeneratedRecommendations(state: ContextAccessState): string {
    const sortedEntries = [...state.entries]
        .sort((left, right) => right.score.value - left.score.value || right.lastAccessedAt.localeCompare(left.lastAccessedAt));
    const strong = sortedEntries.filter((entry) => (entry.signals.explicitInput ?? 0) >= 2);
    const possible = sortedEntries.filter((entry) => !strong.includes(entry));
    const avoid = sortedEntries.filter((entry) => isAvoidPath(entry.path));

    return [
        `# ${state.profile} generated context`,
        "",
        `generatedAt: ${state.updatedAt}`,
        `profile: ${state.profile}`,
        "",
        renderSection("strong", strong),
        renderSection("possible", possible.filter((entry) => !avoid.includes(entry))),
        renderSection("avoid", avoid),
    ].join("\n").trimEnd() + "\n";
}

async function updateContextAccessState(input: {
    project: ReadyProjectSessionRef;
    profileKey: string;
    sessionId: string;
    path: string;
    signal: ContextAccessSignal;
    now: Date;
}): Promise<void> {
    await withContextAccessWriteLock(input.project, input.profileKey, async () => {
        const workspace = input.project.workspace;
        const statePath = contextAccessStatePath(workspace, input.profileKey);
        const nowText = input.now.toISOString();
        const state = await readContextAccessState(
            statePath,
            workspace.ref.projectRoot,
            input.profileKey,
            nowText,
        );
        const existing = state.entries.find((entry) => entry.path === input.path);
        const entry = existing ?? {
            path: input.path,
            kind: readEntryKind(input.path),
            title: readEntryTitle(input.path),
            lastAccessedAt: nowText,
            accessCount: 0,
            sessions: [],
            signals: {},
            score: {
                value: 0,
                updatedAt: nowText,
            },
        };

        entry.lastAccessedAt = nowText;
        entry.accessCount += 1;
        entry.signals[input.signal] = (entry.signals[input.signal] ?? 0) + 1;
        entry.score = {
            value: scoreEntry(entry),
            updatedAt: nowText,
        };
        const session = entry.sessions.find((item) => item.sessionId === input.sessionId);
        if (session) {
            session.lastAccessedAt = nowText;
            session.accessCount += 1;
        } else {
            entry.sessions.push({
                sessionId: input.sessionId,
                lastAccessedAt: nowText,
                accessCount: 1,
            });
        }

        if (!existing) {
            state.entries.push(entry);
        }
        state.updatedAt = nowText;
        await writeTextAtomically(statePath, `${JSON.stringify(state, null, 4)}\n`);
        await writeGeneratedRecommendations(workspace, state);
    });
}

async function readContextAccessState(statePath: string, projectSlug: string, profileKey: string, nowText: string): Promise<ContextAccessState> {
    try {
        const parsed = JSON.parse(await fs.readFile(statePath, "utf-8")) as Partial<ContextAccessState>;
        if (parsed.version === 1 && Array.isArray(parsed.entries)) {
            return {
                version: 1,
                project: {slug: projectSlug},
                profile: parsed.profile ?? profileKey,
                updatedAt: parsed.updatedAt ?? nowText,
                entries: parsed.entries.filter(isContextAccessEntry),
            };
        }
    } catch (error) {
        if (!isNotFoundError(error)) {
            throw error;
        }
    }
    return {
        version: 1,
        project: {slug: projectSlug},
        profile: profileKey,
        updatedAt: nowText,
        entries: [],
    };
}

async function writeGeneratedRecommendations(workspace: ResolvedProjectWorkspace, state: ContextAccessState): Promise<void> {
    const generatedPath = path.join(workspace.root, "agents", safeProfileFileName(state.profile), "generated.md");
    await writeTextAtomically(generatedPath, renderGeneratedRecommendations(state));
}

/** 同一 Project generation 与 profile 的完整读改写必须按调用顺序执行。 */
async function withContextAccessWriteLock<T>(
    project: ReadyProjectSessionRef,
    profileKey: string,
    action: () => Promise<T>,
): Promise<T> {
    let projectQueues = contextAccessWriteQueues.get(project.workspace.key);
    if (!projectQueues) {
        projectQueues = new Map<string, Promise<void>>();
        contextAccessWriteQueues.set(project.workspace.key, projectQueues);
    }
    const queueKey = `${String(project.generation)}\0${safeProfileFileName(profileKey)}`;
    const previous = projectQueues.get(queueKey) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    projectQueues.set(queueKey, queued);

    await previous.catch(() => undefined);
    try {
        return await action();
    } finally {
        release();
        if (projectQueues.get(queueKey) === queued) {
            projectQueues.delete(queueKey);
        }
        if (projectQueues.size === 0 && contextAccessWriteQueues.get(project.workspace.key) === projectQueues) {
            contextAccessWriteQueues.delete(project.workspace.key);
        }
    }
}

/** 通过同目录唯一临时文件原子替换文本，避免并发读观察到半份 JSON 或 Markdown。 */
async function writeTextAtomically(filePath: string, text: string): Promise<void> {
    const directory = path.dirname(filePath);
    const temporaryPath = path.join(
        directory,
        `.${path.basename(filePath)}.${String(process.pid)}.${randomUUID()}.tmp`,
    );
    await fs.mkdir(directory, {recursive: true});
    try {
        await fs.writeFile(temporaryPath, text, {encoding: "utf-8", flag: "wx"});
        await fs.rename(temporaryPath, filePath);
    } finally {
        await fs.rm(temporaryPath, {force: true}).catch(() => undefined);
    }
}

function contextAccessStatePath(workspace: ResolvedProjectWorkspace, profileKey: string): string {
    return path.join(workspace.root, ".nbook", "context-access", `${safeProfileFileName(profileKey)}.json`);
}

function normalizeEntryPath(filePath: string): string {
    const normalized = filePath.trim().replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/g, (match) => match ? "/" : "");
    if (normalized.endsWith("/index.md")) {
        return normalized.slice(0, -"index.md".length);
    }
    if (normalized.endsWith("/state.md")) {
        return normalized.slice(0, -"state.md".length);
    }
    return normalized;
}

function readEntryKind(entryPath: string): ContextAccessEntry["kind"] {
    if (entryPath.startsWith("lorebook/")) return "lorebook";
    if (entryPath.startsWith("manuscript/")) return "manuscript";
    return "other";
}

function readEntryTitle(entryPath: string): string | null {
    const trimmed = entryPath.replace(/\/$/g, "");
    const lastSegment = trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed;
    return lastSegment || null;
}

function scoreEntry(entry: ContextAccessEntry): number {
    const explicit = entry.signals.explicitInput ?? 0;
    const stateRead = entry.signals["state-read"] ?? 0;
    const indexRead = entry.signals["index-read"] ?? 0;
    const read = entry.signals.read ?? 0;
    const rawScore = explicit * 0.35 + indexRead * 0.12 + stateRead * 0.1 + read * 0.08 + Math.min(entry.sessions.length, 5) * 0.04;
    return Math.min(1, Math.round(rawScore * 100) / 100);
}

function renderSection(title: "strong" | "possible" | "avoid", entries: ContextAccessEntry[]): string {
    if (entries.length === 0) {
        return [`## ${title}`, "", "- none", ""].join("\n");
    }
    return [
        `## ${title}`,
        "",
        ...entries.map((entry) => [
            `### ${entry.path}`,
            "",
            `- score: ${entry.score.value.toFixed(2)}`,
            `- signals: ${renderSignals(entry.signals)}`,
            `- lastAccessedAt: ${entry.lastAccessedAt}`,
            `- sessions: ${entry.sessions.length}`,
            "",
        ].join("\n")),
    ].join("\n");
}

function renderSignals(signals: Partial<Record<ContextAccessSignal, number>>): string {
    const parts = Object.entries(signals)
        .filter(([, count]) => typeof count === "number" && count > 0)
        .map(([signal, count]) => `${signal}:${String(count)}`);
    return parts.length > 0 ? parts.join(", ") : "none";
}

function isAvoidPath(entryPath: string): boolean {
    return entryPath.startsWith("lorebook/system/AI指令/");
}

function safeProfileFileName(profileKey: string): string {
    return profileKey.replace(/[\\/]/g, "_");
}

function contextProfileKey(profileKey: string): string {
    if (profileKey === "subagent.writer") return "writer";
    if (profileKey === "subagent.retrieval") return "retrieval";
    return profileKey;
}

function isContextAccessEntry(value: unknown): value is ContextAccessEntry {
    return Boolean(value)
        && typeof value === "object"
        && !Array.isArray(value)
        && typeof (value as ContextAccessEntry).path === "string"
        && typeof (value as ContextAccessEntry).accessCount === "number"
        && Array.isArray((value as ContextAccessEntry).sessions);
}

function isNotFoundError(error: unknown): boolean {
    return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
