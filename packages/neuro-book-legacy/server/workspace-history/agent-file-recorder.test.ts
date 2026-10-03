import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    closeAllProjects,
    closeProject,
    openProject,
    requireReadyModuleHandle,
    resetProjectSessionsForTest,
} from "nbook/server/runtime/product-project";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {authorizeFileOperation} from "nbook/server/workspace-files/authorized-file-operation";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {
    PROJECT_FILE_INDEX_MODULE_TOKEN,
    setProjectFileIndexCommitHookForTest,
} from "nbook/server/workspace-files/project-file-index";
import {
    captureAgentWorkspaceWrite,
    recordAgentWorkspaceWrite,
} from "nbook/server/workspace-history/agent-file-recorder";
import {
    PROJECT_HISTORY_MODULE_TOKEN,
    resetWorkspaceHistoryForTest,
    setHistoryEnabledOverrideForTest,
} from "nbook/server/workspace-history/project-history";

describe("recordAgentWorkspaceWrite 归因记账", () => {
    let tempRoot: string;
    let workspaceRoot: AbsoluteFsPath;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        setHistoryEnabledOverrideForTest(true);
        tempRoot = testHostPath(`neuro-book-agent-recorder-test-${randomUUID()}`);
        workspaceRoot = absoluteFsPath(join(tempRoot, "workspace"));
        await mkdir(workspaceRoot, {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});
    });

    afterEach(async () => {
        await closeAllProjects().catch(() => undefined);
        await resetWorkspaceHistoryForTest();
        resetProjectSessionsForTest();
        setWorkspaceRuntimeRootContextForTest(null);
        setHistoryEnabledOverrideForTest(null);
        setProjectFileIndexCommitHookForTest(null);
        collectReleasedSqliteHandles({force: true});
        await rm(tempRoot, {recursive: true, force: true}).catch(() => undefined);
    }, 60_000);

    it("写入归因 agent + String(sessionId)，删除记 before 快照，无Project地址静默跳过", async () => {
        const ready = await openReadyProject("attribution");
        const address = (await authorizeFileOperation(
            {workspaceRoot, currentProject: ready},
            "manuscript/ch1.md",
            "write",
        )).target;
        const historyHandle = requireReadyModuleHandle(ready, PROJECT_HISTORY_MODULE_TOKEN);
        const fileIndex = requireReadyModuleHandle(ready, PROJECT_FILE_INDEX_MODULE_TOKEN);
        await fileIndex.read();
        let indexCommitCount = 0;
        setProjectFileIndexCommitHookForTest(() => {
            indexCommitCount += 1;
        });
        const createCapture = captureAgentWorkspaceWrite(address);
        expect(createCapture).toEqual(expect.objectContaining({
            history: historyHandle,
            fileIndex,
        }));
        await fileIndex.mutate(() => recordAgentWorkspaceWrite({
            sessionId: 42,
            capture: createCapture,
            before: null,
            after: "v1",
        }));
        await fileIndex.read();
        expect(indexCommitCount).toBe(1);
        await fileIndex.mutate(() => recordAgentWorkspaceWrite({
            sessionId: 42,
            capture: captureAgentWorkspaceWrite(address),
            before: "v1",
            after: null,
        }));
        await fileIndex.read();
        expect(indexCommitCount).toBe(2);

        const history = await requireReadyModuleHandle(
            ready,
            PROJECT_HISTORY_MODULE_TOKEN,
        ).history;
        expect(history).not.toBeNull();
        const timeline = await history!.timeline("manuscript/ch1.md");
        expect(timeline.map((item) => item.entry.operation.type)).toEqual(["file.create", "file.delete"]);
        expect(timeline[0]!.entry.actor).toEqual({kind: "agent", sessionId: "42"});

        // 没有 Project 归属的绝对地址不创建 History capture，record 保持 fail-open。
        const unownedAddress = (await authorizeFileOperation(
            {workspaceRoot, currentProject: null},
            join(workspaceRoot, "not-open", "manuscript", "x.md"),
            "write",
        )).target;
        expect(captureAgentWorkspaceWrite(unownedAddress)).toBeNull();
        await recordAgentWorkspaceWrite({
            sessionId: 42,
            capture: captureAgentWorkspaceWrite(unownedAddress),
            before: null, after: "x",
        });
    });

    it("显式跨Project地址直接按授权目标的exact generation归入目标Project", async () => {
        const currentReady = await openReadyProject("current");
        const targetReady = await openReadyProject("target");
        const address = (await authorizeFileOperation(
            {workspaceRoot, currentProject: currentReady},
            "workspace/target/lorebook/npc.md",
            "write",
        )).target;

        const capture = captureAgentWorkspaceWrite(address);
        expect(capture).not.toBeNull();
        await capture!.fileIndex.mutate(() => recordAgentWorkspaceWrite({
            sessionId: 7,
            capture,
            before: null,
            after: "npc",
        }));

        const targetHistory = await requireReadyModuleHandle(
            targetReady,
            PROJECT_HISTORY_MODULE_TOKEN,
        ).history;
        expect(targetHistory).not.toBeNull();
        expect((await targetHistory!.timeline("lorebook/npc.md"))[0]?.entry.actor)
            .toEqual({kind: "agent", sessionId: "7"});
        const currentHistory = await requireReadyModuleHandle(
            currentReady,
            PROJECT_HISTORY_MODULE_TOKEN,
        ).history;
        expect(currentHistory).not.toBeNull();
        expect(await currentHistory!.timeline("lorebook/npc.md")).toEqual([]);
    });

    it("close/reopen后旧capture不会把记录写入新generation", async () => {
        const ref = projectWorkspaceRef("generation-safe");
        const oldReady = await openReadyProject("generation-safe");
        const address = (await authorizeFileOperation(
            {workspaceRoot, currentProject: oldReady},
            "manuscript/ch1.md",
            "write",
        )).target;
        const oldCapture = captureAgentWorkspaceWrite(address);
        expect(oldCapture).not.toBeNull();

        await closeProject(ref, "shutdown");
        const currentReady = await openProject(ref, {kind: "job", source: "agent-file-recorder-test"}, workspaceRoot);

        await expect(recordAgentWorkspaceWrite({
            sessionId: 99,
            capture: oldCapture,
            before: null,
            after: "must-not-cross-generation",
        })).resolves.toBeUndefined();

        const currentHistory = await requireReadyModuleHandle(
            currentReady,
            PROJECT_HISTORY_MODULE_TOKEN,
        ).history;
        expect(currentHistory).not.toBeNull();
        expect(await currentHistory!.timeline("manuscript/ch1.md")).toEqual([]);
    });

    /** 创建最小Project Workspace并返回本次测试持有的ready generation。 */
    async function openReadyProject(projectRoot: string): Promise<ReadyProjectSessionRef> {
        const projectWorkspaceRoot = join(workspaceRoot, projectRoot);
        await mkdir(projectWorkspaceRoot, {recursive: true});
        await writeFile(
            join(projectWorkspaceRoot, "project.yaml"),
            `kind: novel\ntitle: ${projectRoot}\nsummary: ''\n`,
            "utf8",
        );
        return openProject(
            projectWorkspaceRef(projectRoot),
            {kind: "job", source: "agent-file-recorder-test"},
            workspaceRoot,
        );
    }
});
