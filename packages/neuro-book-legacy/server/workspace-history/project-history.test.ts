import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile, unlink} from "node:fs/promises";
import {join} from "node:path";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {WorkspaceHistory} from "@notnotype/nb-history";
import {
    closeAllProjects,
    requireReadyModuleHandle,
    requireReadyProject,
    resetProjectSessionsForTest,
} from "nbook/server/runtime/product-project";
import {openProjectForTest, closeProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {writeProjectManifest as writeProjectManifestAtRoot} from "nbook/server/workspace-files/project-workspace";
import {resolveRuntimeWorkspaceRoot, setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {projectWorkspaceRef, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-identity";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {isHistoryTrackedRelativePath} from "nbook/server/workspace-history/history-paths";
import {
    LOCAL_USER_ID,
    PROJECT_HISTORY_MODULE_TOKEN,
    advanceAgentCursor as advanceAgentCursorAtRoot,
    readUnseenForAgent as readUnseenForAgentAtRoot,
    recordProjectWrite as recordProjectWriteAtRoot,
    resetWorkspaceHistoryForTest,
    setHistoryEnabledOverrideForTest,
    type ProjectHistoryHandle,
} from "nbook/server/workspace-history/project-history";

/** 测试Adapter：把当前隔离Runtime Workspace Root显式投影到Project历史Interface。 */
function resolveProjectAbsolutePath(projectRoot: string) {
    return resolveProjectWorkspaceRoot(resolveRuntimeWorkspaceRoot(), projectWorkspaceRef(projectRoot));
}

async function writeProjectManifest(projectRoot: string, manifest: Parameters<typeof writeProjectManifestAtRoot>[2]) {
    return writeProjectManifestAtRoot(resolveRuntimeWorkspaceRoot(), projectWorkspaceRef(projectRoot), manifest);
}

function projectHistory(projectRoot: string): ProjectHistoryHandle {
    const ready = requireReadyProject(projectWorkspaceRef(projectRoot));
    return requireReadyModuleHandle(
        ready,
        PROJECT_HISTORY_MODULE_TOKEN,
    );
}

async function readUnseenForAgent(projectRoot: string, sessionId: number) {
    return readUnseenForAgentAtRoot(projectHistory(projectRoot), sessionId);
}

async function advanceAgentCursor(projectRoot: string, sessionId: number, entryId: number) {
    return advanceAgentCursorAtRoot(projectHistory(projectRoot), sessionId, entryId);
}

async function recordProjectWrite(input: Parameters<typeof recordProjectWriteAtRoot>[1] & {projectRoot: string}) {
    const {projectRoot, ...write} = input;
    return recordProjectWriteAtRoot(projectHistory(projectRoot), write);
}

describe("history-paths 谓词", () => {
    it("排除 .git/.nbook/.agent 任意段与项目根第一层 agents/", () => {
        expect(isHistoryTrackedRelativePath("manuscript/001/index.md")).toBe(true);
        expect(isHistoryTrackedRelativePath("lorebook/agents/npc.md")).toBe(true);
        expect(isHistoryTrackedRelativePath("world-engine/calendar.ts")).toBe(true);
        expect(isHistoryTrackedRelativePath("world-engine/schema/index.ts")).toBe(true);
        expect(isHistoryTrackedRelativePath(".nbook/history.sqlite")).toBe(false);
        expect(isHistoryTrackedRelativePath("sub/.git/HEAD")).toBe(false);
        expect(isHistoryTrackedRelativePath(".agent/plan/x.md")).toBe(false);
        expect(isHistoryTrackedRelativePath("agents/leader.default/persona.md")).toBe(false);
        expect(isHistoryTrackedRelativePath("world-engine/.runtime-artifact-import-cache/world-engine-calendar/a.mjs")).toBe(false);
        expect(isHistoryTrackedRelativePath("world-engine/.world-engine-calendar-0123456789abcdef.mjs")).toBe(false);
        expect(isHistoryTrackedRelativePath("")).toBe(false);
    });
});

describe("workspace-history 门面", () => {
    let tempRoot: string;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        setHistoryEnabledOverrideForTest(true);
        tempRoot = testHostPath(`neuro-book-workspace-history-test-${randomUUID()}`);
        await mkdir(join(tempRoot, "workspace"), {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot: join(tempRoot, "workspace")});
    });

    afterEach(async () => {
        await closeAllProjects().catch(() => undefined);
        await resetWorkspaceHistoryForTest();
        resetProjectSessionsForTest();
        setWorkspaceRuntimeRootContextForTest(null);
        setHistoryEnabledOverrideForTest(null);
        collectReleasedSqliteHandles({force: true});
        await rm(tempRoot, {recursive: true, force: true}).catch(() => undefined);
    }, 60_000);

    /** 建一个可 open 的真实 Project（含 manifest）。 */
    async function createTempProject(slug: string): Promise<string> {
        const projectRoot = slug;
        await writeProjectManifest(projectRoot, {kind: "novel", title: slug, summary: ""});
        return projectRoot;
    }

    it("记账 + 谓词过滤：受管路径入账归因正确，排除路径与未 open 项目静默跳过", async () => {
        const projectRoot = await createTempProject("record");
        await openProjectForTest(projectRoot);

        await recordProjectWrite({
            projectRoot,
            relativePath: "manuscript/ch1.md",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null,
            after: new TextEncoder().encode("正文 v1"),
        });
        await recordProjectWrite({
            projectRoot,
            relativePath: "agents/leader.default/persona.md",
            actor: {kind: "system", source: "profile-home"},
            before: null,
            after: new TextEncoder().encode("排除区"),
        });

        const history = await projectHistory(projectRoot).history;
        expect(history).not.toBeNull();
        const timeline = await history!.timeline("manuscript/ch1.md");
        expect(timeline).toHaveLength(1);
        expect(timeline[0]!.entry.operation.type).toBe("file.create");
        expect(timeline[0]!.entry.actor).toEqual({kind: "user", userId: LOCAL_USER_ID});
        expect(await history!.timeline("agents/leader.default/persona.md")).toHaveLength(0);

        // Project 数据面不按路径寻找“最新实例”，未 open 必须明确拒绝。
        expect(() => projectHistory("not-open")).toThrow();
    });

    it("enabled=false 全链 no-op：不开库、不建库文件", async () => {
        setHistoryEnabledOverrideForTest(false);
        const projectRoot = await createTempProject("disabled");
        await openProjectForTest(projectRoot);

        expect(await projectHistory(projectRoot).history).toBeNull();
        const databasePath = join(resolveProjectAbsolutePath(projectRoot), ".nbook", "history.sqlite");
        await expect(rm(databasePath)).rejects.toMatchObject({code: "ENOENT"});
    });

    it("closeProject 级联关库：close 后 ensure 返回 null，重新 open 可再用", async () => {
        const projectRoot = await createTempProject("lifecycle");
        await openProjectForTest(projectRoot);
        const history = await projectHistory(projectRoot).history;
        expect(history).not.toBeNull();
        await history!.performWrite({kind: "user", userId: LOCAL_USER_ID}, "manuscript/a.md", "v1");

        await closeProjectForTest(projectRoot);
        expect(() => projectHistory(projectRoot)).toThrow();

        await openProjectForTest(projectRoot);
        const reopened = await projectHistory(projectRoot).history;
        expect(reopened).not.toBeNull();
        expect(await reopened!.timeline("manuscript/a.md")).toHaveLength(1);
    });

    it("open 在 unseen 与 D15 前原子清理旧 runtime artifact 历史并保留 cursor", async () => {
        const projectRoot = await createTempProject("purge-runtime-artifact");
        await openProjectForTest(projectRoot);
        const root = resolveProjectAbsolutePath(projectRoot);
        const history = (await projectHistory(projectRoot).history)!;
        const acceptedCachePath = "world-engine/.runtime-artifact-import-cache/world-engine-calendar/0123456789abcdef.mjs";
        const unacceptedCachePath = "world-engine/schema/.runtime-artifact-import-cache/world-engine-schema/fedcba9876543210.mjs";
        await mkdir(join(root, "world-engine", ".runtime-artifact-import-cache", "world-engine-calendar"), {recursive: true});
        await mkdir(join(root, "world-engine", "schema", ".runtime-artifact-import-cache", "world-engine-schema"), {recursive: true});
        await writeFile(join(root, ...acceptedCachePath.split("/")), "accepted runtime artifact", "utf-8");
        await writeFile(join(root, ...unacceptedCachePath.split("/")), "unaccepted runtime artifact", "utf-8");

        await history.performWrite({kind: "user", userId: LOCAL_USER_ID}, "manuscript/before.md", "游标前正文");
        await history.initCursor("77");
        await history.performWrite({kind: "agent", sessionId: "other"}, acceptedCachePath, "accepted runtime artifact");
        await history.accept(LOCAL_USER_ID, acceptedCachePath);
        await history.performWrite({kind: "agent", sessionId: "other"}, unacceptedCachePath, "unaccepted runtime artifact");
        await history.performWrite({kind: "user", userId: LOCAL_USER_ID}, "manuscript/keep.md", "正文");
        await closeProjectForTest(projectRoot);

        await openProjectForTest(projectRoot);
        const reopened = (await projectHistory(projectRoot).history)!;
        expect(await reopened.timeline(acceptedCachePath)).toHaveLength(0);
        expect(await reopened.timeline(unacceptedCachePath)).toHaveLength(0);
        expect(await reopened.timeline("manuscript/before.md")).toHaveLength(1);
        expect(await reopened.timeline("manuscript/keep.md")).toHaveLength(1);
        const inboxPaths = (await reopened.inbox(LOCAL_USER_ID)).map((group) => group.path);
        expect(inboxPaths).not.toContain(acceptedCachePath);
        expect(inboxPaths).not.toContain(unacceptedCachePath);
        const unseenBeforeMaintenance = (await reopened.unseenChanges("77")).map((group) => group.path);
        expect(unseenBeforeMaintenance).not.toContain("manuscript/before.md");
        expect(unseenBeforeMaintenance).toContain("manuscript/keep.md");
        expect(unseenBeforeMaintenance).not.toContain(acceptedCachePath);
        expect(unseenBeforeMaintenance).not.toContain(unacceptedCachePath);

        await vi.waitFor(async () => {
            expect(await reopened.timeline("project.yaml")).toHaveLength(1);
        });
        expect(await reopened.timeline(acceptedCachePath)).toHaveLength(0);
        expect(await reopened.timeline(unacceptedCachePath)).toHaveLength(0);
        const projectManifestTimeline = await reopened.timeline("project.yaml");
        expect(projectManifestTimeline[0]!.entry.actor).toEqual({kind: "external"});
        await reopened.performWrite({kind: "user", userId: LOCAL_USER_ID}, "manuscript/after.md", "后续正文");
        const unseenPaths = (await reopened.unseenChanges("77")).map((group) => group.path);
        expect(unseenPaths).toContain("manuscript/after.md");
        expect(unseenPaths).not.toContain(acceptedCachePath);
        expect(unseenPaths).not.toContain(unacceptedCachePath);
    });

    it("purge 失败时关闭句柄并移除 opening，后续 ensure 可重试", async () => {
        const projectRoot = await createTempProject("purge-open-failure");
        const closeSpy = vi.spyOn(WorkspaceHistory.prototype, "close");
        const purgeSpy = vi.spyOn(WorkspaceHistory.prototype, "purgePaths")
            .mockRejectedValueOnce(new Error("purge failed"));

        await expect(openProjectForTest(projectRoot)).rejects.toMatchObject({
            code: "PROJECT_SESSION_OPEN_FAILED",
            cause: expect.objectContaining({message: "purge failed"}),
        });
        expect(closeSpy).toHaveBeenCalledTimes(1);

        purgeSpy.mockRestore();
        closeSpy.mockRestore();
        await expect(openProjectForTest(projectRoot)).resolves.toMatchObject({
            workspace: {ref: {projectRoot}},
        });
        await expect(projectHistory(projectRoot).history).resolves.not.toBeNull();
    });

    it("watcher 对账批：外部直写补 external、回声抑制、排除路径忽略、unlink 补删除", async () => {
        const projectRoot = await createTempProject("reconcile");
        await openProjectForTest(projectRoot);
        const root = resolveProjectAbsolutePath(projectRoot);
        await mkdir(join(root, "manuscript"), {recursive: true});
        await mkdir(join(root, "world-engine", ".runtime-artifact-import-cache", "world-engine-calendar"), {recursive: true});
        await writeFile(join(root, "manuscript", "ext.md"), "外部写入", "utf-8");
        await writeFile(join(root, "world-engine", ".runtime-artifact-import-cache", "world-engine-calendar", "a.mjs"), "cache", "utf-8");

        const events = [
            {kind: "add" as const, path: "manuscript/ext.md"},
            {kind: "change" as const, path: ".nbook/project.sqlite"},
            {kind: "add" as const, path: "world-engine/.runtime-artifact-import-cache/world-engine-calendar/a.mjs"},
        ];
        const handle = projectHistory(projectRoot);
        await handle.reconcileRawEvents({events, droppedEventCount: 0});
        const history = (await handle.history)!;
        const timeline = await history.timeline("manuscript/ext.md");
        expect(timeline).toHaveLength(1);
        expect(timeline[0]!.entry.actor).toEqual({kind: "external"});
        expect(await history.timeline(".nbook/project.sqlite")).toHaveLength(0);
        expect(await history.timeline("world-engine/.runtime-artifact-import-cache/world-engine-calendar/a.mjs")).toHaveLength(0);

        // 回声：同内容再对账不产生新条目
        await handle.reconcileRawEvents({events: [{kind: "change", path: "manuscript/ext.md"}], droppedEventCount: 0});
        expect(await history.timeline("manuscript/ext.md")).toHaveLength(1);

        // 外部删除
        await unlink(join(root, "manuscript", "ext.md"));
        await handle.reconcileRawEvents({events: [{kind: "unlink", path: "manuscript/ext.md"}], droppedEventCount: 0});
        const afterDelete = await history.timeline("manuscript/ext.md");
        expect(afterDelete).toHaveLength(2);
        expect(afterDelete[1]!.entry.operation.type).toBe("file.delete");
        expect((await history.deletedFiles()).map((f) => f.path)).toEqual(["manuscript/ext.md"]);
    });

    it("unseen 懒游标：首查为空建基线，他人变更可见且不含本会话自己，推进后清空", async () => {
        const projectRoot = await createTempProject("unseen");
        await openProjectForTest(projectRoot);

        // 会话 7 首查：懒 initCursor，以当下为基线
        expect(await readUnseenForAgent(projectRoot, 7)).toEqual([]);

        // 用户改文件 + 会话 7 自己也改文件
        await recordProjectWrite({
            projectRoot, relativePath: "manuscript/user.md",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null, after: new TextEncoder().encode("用户写"),
        });
        await recordProjectWrite({
            projectRoot, relativePath: "manuscript/self.md",
            actor: {kind: "agent", sessionId: "7"},
            before: null, after: new TextEncoder().encode("自己写"),
        });

        const unseen = await readUnseenForAgent(projectRoot, 7);
        expect(unseen.map((group) => group.path)).toEqual(["manuscript/user.md"]);

        // 游标按模块契约原样传 maxEntryId（last_seen 语义）；多传 1 会吞掉恰好落在 max+1 的下一条他人写入。
        await advanceAgentCursor(projectRoot, 7, unseen[0]!.maxEntryId);
        expect(await readUnseenForAgent(projectRoot, 7)).toEqual([]);

        // 回归钉子（off-by-one）：推进后紧接着的下一条他人写入（id 恰为推进目标 +1 附近）必须重新可见。
        await recordProjectWrite({
            projectRoot, relativePath: "manuscript/user-again.md",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null, after: new TextEncoder().encode("用户又写"),
        });
        expect((await readUnseenForAgent(projectRoot, 7)).map((group) => group.path)).toEqual(["manuscript/user-again.md"]);
    });

    it("D15 open 对账扫描：closed 期间的外部新增补 external、外部删除补 delete", async () => {
        const projectRoot = await createTempProject("d15");
        await openProjectForTest(projectRoot);
        const root = resolveProjectAbsolutePath(projectRoot);

        // open 期间正常记账文件 A
        await mkdir(join(root, "manuscript"), {recursive: true});
        await writeFile(join(root, "manuscript", "a.md"), "A v1", "utf-8");
        await recordProjectWrite({
            projectRoot, relativePath: "manuscript/a.md",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null, after: new TextEncoder().encode("A v1"),
        });
        await closeProjectForTest(projectRoot);

        // closed 期间：外部新增 B、删除 A
        await writeFile(join(root, "manuscript", "b.md"), "B 外部", "utf-8");
        await unlink(join(root, "manuscript", "a.md"));

        // 重新 open + 预热维护（D15 扫描）
        await openProjectForTest(projectRoot);
        const history = (await projectHistory(projectRoot).history)!;
        await vi.waitFor(async () => {
            expect(await history.timeline("manuscript/b.md")).toHaveLength(1);
            const timelineA = await history.timeline("manuscript/a.md");
            expect(timelineA[timelineA.length - 1]!.entry.operation.type).toBe("file.delete");
        });
        const timelineB = await history.timeline("manuscript/b.md");
        expect(timelineB).toHaveLength(1);
        expect(timelineB[0]!.entry.actor).toEqual({kind: "external"});
        const timelineA = await history.timeline("manuscript/a.md");
        expect(timelineA[timelineA.length - 1]!.entry.operation.type).toBe("file.delete");
        expect((await history.deletedFiles()).map((f) => f.path)).toEqual(["manuscript/a.md"]);
    });
});
