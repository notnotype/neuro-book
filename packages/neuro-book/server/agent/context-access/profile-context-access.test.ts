import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    normalizeContentAccessPath,
    recordContextAccess,
    recordExplicitContextEntries,
    renderGeneratedRecommendations,
    type ContextAccessState,
} from "nbook/server/agent/context-access/profile-context-access";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

const mocks = vi.hoisted(() => ({
    mutate: vi.fn(),
    requireReadyModuleHandle: vi.fn(),
    runReadyProjectOperation: vi.fn(),
}));

vi.mock("nbook/server/workspace-files/project-session", () => ({
    requireReadyModuleHandle: mocks.requireReadyModuleHandle,
    runReadyProjectOperation: mocks.runReadyProjectOperation,
}));

describe("profile context access", () => {
    let projectRoot: string;
    let project: ReadyProjectSessionRef;

    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.mutate.mockImplementation(async (operation: () => Promise<unknown>) => operation());
        mocks.requireReadyModuleHandle.mockReturnValue({mutate: mocks.mutate});
        mocks.runReadyProjectOperation.mockImplementation(async (
            _ready: ReadyProjectSessionRef,
            operation: () => Promise<unknown>,
        ) => operation());
        projectRoot = await mkdtemp(testHostPath("nbook-context-access-"));
        const workspaceRoot = absoluteFsPath(path.dirname(projectRoot));
        const ref = projectWorkspaceRef("novel-1");
        project = {
            workspace: resolvedProjectWorkspace(
                ref,
                absoluteFsPath(projectRoot),
                createProjectWorkspaceKey(workspaceRoot, ref),
            ),
            generation: 7,
            publicId: "test-ready:7",
        };
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("按内容节点目录归一化 index.md 和 state.md", () => {
        expect(normalizeContentAccessPath("lorebook/location/castle/index.md")).toEqual({
            path: "lorebook/location/castle/",
            signal: "index-read",
        });
        expect(normalizeContentAccessPath("lorebook/location/castle/state.md")).toEqual({
            path: "lorebook/location/castle/",
            signal: "state-read",
        });
        expect(normalizeContentAccessPath("reference/raw.md")).toBeNull();
    });

    it("记录 read 访问并渲染 generated recommendation", async () => {
        await recordContextAccess({
            project,
            profileKey: "subagent.writer",
            sessionId: "thread-1",
            filePath: "lorebook/location/castle/index.md",
            now: new Date("2026-06-06T00:00:00.000Z"),
        });
        await recordContextAccess({
            project,
            profileKey: "subagent.writer",
            sessionId: "thread-1",
            filePath: "lorebook/location/castle/state.md",
            now: new Date("2026-06-06T00:01:00.000Z"),
        });

        const state = JSON.parse(await readFile(path.join(projectRoot, ".nbook/context-access/writer.json"), "utf-8")) as ContextAccessState;
        expect(state.profile).toBe("writer");
        expect(state.project).toEqual({slug: "novel-1"});
        expect(state.entries).toHaveLength(1);
        expect(state.entries[0]).toMatchObject({
            path: "lorebook/location/castle/",
            accessCount: 2,
            signals: {
                "index-read": 1,
                "state-read": 1,
            },
        });

        const generated = await readFile(path.join(projectRoot, "agents/writer/generated.md"), "utf-8");
        expect(generated).toContain("# writer generated context");
        expect(generated).toContain("## possible");
        expect(generated).toContain("### lorebook/location/castle/");
        expect(generated).toContain("- signals: index-read:1, state-read:1");
        expect(mocks.requireReadyModuleHandle.mock.calls.every(([ready]) => ready === project)).toBe(true);
        expect(mocks.mutate).toHaveBeenCalledTimes(2);
    });

    it("同一 Project generation 与 profile 的并行 read 保留全部 entry 和 count", async () => {
        const filePaths = [
            "lorebook/character/alpha/index.md",
            "lorebook/character/beta/index.md",
            "lorebook/location/castle/state.md",
            "manuscript/chapter-01.md",
        ];
        const reads = Array.from({length: 24}, (_, index) => recordContextAccess({
            project,
            profileKey: "subagent.writer",
            sessionId: `thread-${String(index % 3)}`,
            filePath: filePaths[index % filePaths.length]!,
            now: new Date(Date.parse("2026-06-06T00:00:00.000Z") + index),
        }));

        await Promise.all(reads);

        const statePath = path.join(projectRoot, ".nbook/context-access/writer.json");
        const stateText = await readFile(statePath, "utf-8");
        expect(() => JSON.parse(stateText)).not.toThrow();
        const state = JSON.parse(stateText) as ContextAccessState;
        expect(state.entries).toHaveLength(filePaths.length);
        expect(state.entries.reduce((sum, entry) => sum + entry.accessCount, 0)).toBe(reads.length);
        for (const entry of state.entries) {
            expect(entry.accessCount).toBe(6);
            expect(entry.sessions.reduce((sum, session) => sum + session.accessCount, 0)).toBe(6);
        }

        const generated = await readFile(path.join(projectRoot, "agents/writer/generated.md"), "utf-8");
        expect(generated).toContain("### lorebook/character/alpha/");
        expect(generated).toContain("### lorebook/character/beta/");
        expect(generated).toContain("### lorebook/location/castle/");
        expect(generated).toContain("### manuscript/chapter-01.md");
        expect((await readdir(path.dirname(statePath))).some((name) => name.endsWith(".tmp"))).toBe(false);
        expect((await readdir(path.join(projectRoot, "agents/writer"))).some((name) => name.endsWith(".tmp"))).toBe(false);
        expect(mocks.mutate).toHaveBeenCalledTimes(reads.length);
    });

    it("显式 lorebookEntries 多次出现时进入 strong", async () => {
        await recordExplicitContextEntries({
            project,
            profileKey: "subagent.writer",
            sessionId: "thread-1",
            entries: [{path: "lorebook/character/hero/"}],
            now: new Date("2026-06-06T00:00:00.000Z"),
        });
        await recordExplicitContextEntries({
            project,
            profileKey: "subagent.writer",
            sessionId: "thread-2",
            entries: [{path: "lorebook/character/hero/index.md"}],
            now: new Date("2026-06-06T00:01:00.000Z"),
        });

        const generated = await readFile(path.join(projectRoot, "agents/writer/generated.md"), "utf-8");
        expect(generated).toContain("## strong");
        expect(generated).toContain("### lorebook/character/hero/");
        expect(generated).toContain("- signals: explicitInput:2");
        expect(generated).toContain("- sessions: 2");
    });

    it("不剥离其他 Project File Address 后误记到当前 Project", async () => {
        await recordExplicitContextEntries({
            project,
            profileKey: "subagent.writer",
            sessionId: "thread-1",
            entries: [{path: "workspace/other-project/lorebook/character/hero/index.md"}],
            now: new Date("2026-06-06T00:00:00.000Z"),
        });

        await expect(readFile(path.join(projectRoot, ".nbook/context-access/writer.json"), "utf-8")).rejects.toMatchObject({
            code: "ENOENT",
        });
        expect(mocks.requireReadyModuleHandle).not.toHaveBeenCalled();
    });

    it("渲染 avoid section 时只输出事实数据", () => {
        const markdown = renderGeneratedRecommendations({
            version: 1,
            project: {slug: "novel-1"},
            profile: "writer",
            updatedAt: "2026-06-06T00:00:00.000Z",
            entries: [{
                path: "lorebook/system/AI指令/",
                kind: "lorebook",
                title: "AI指令",
                lastAccessedAt: "2026-06-06T00:00:00.000Z",
                accessCount: 1,
                sessions: [{sessionId: "thread-1", lastAccessedAt: "2026-06-06T00:00:00.000Z", accessCount: 1}],
                signals: {read: 1},
                score: {value: 0.08, updatedAt: "2026-06-06T00:00:00.000Z"},
            }],
        });

        expect(markdown).toContain("## avoid");
        expect(markdown).toContain("### lorebook/system/AI指令/");
        expect(markdown).toContain("- signals: read:1");
        expect(markdown).not.toContain("推荐原因");
    });
});
