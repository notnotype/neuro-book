import {mkdtemp, mkdir, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import {createAssistantTextMessage} from "nbook/server/agent/messages/message-utils";
import {AGENT_TASKS_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import {ToolSessionWriteSink} from "nbook/server/agent/session/tool-session-write-sink";
import type {SessionWriteExecutor, SessionWritePlan} from "nbook/server/agent/session/write-plan";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";

describe("task tools", () => {
    let root: string;
    let workspaceRoot: string;
    let harness: NeuroAgentHarness;

    beforeEach(async () => {
        root = await mkdtemp(testHostPath("nbook-task-tools-test-"));
        workspaceRoot = join(root, "workspace");
        await mkdir(workspaceRoot, {recursive: true});
        harness = new NeuroAgentHarness({
            repo: new JsonlSessionRepository(workspaceRoot),
            enableSessionSummarizer: false,
        });
    });

    afterEach(async () => {
        await harness.dispose();
        await rm(root, {recursive: true, force: true});
    });

    it("task_create / task_set_status 写入 session custom state 并返回任务卡结构", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const context = {
            harness,
            sessionId: created.sessionId,
            profileKey: "leader.default",
            workspaceRoot: absoluteFsPath(workspaceRoot),
            currentProject: null,
        };
        const taskCreate = harness.tools.get("task_create");
        const taskSetStatus = harness.tools.get("task_set_status");

        const createdTasks = await taskCreate?.executeWithContext?.(context, "task-1", {
            title: "迁移",
            steps: [
                {id: "one", text: "第一步", status: "in_progress"},
                {id: "two", text: "第二步", status: "pending"},
            ],
        });
        const updatedTasks = await taskSetStatus?.executeWithContext?.(context, "task-2", {
            id: "one",
            status: "completed",
            note: "完成",
        });
        const session = await harness.readSessionContext(created.sessionId);

        expect(createdTasks?.details).toMatchObject({
            title: "迁移",
            steps: [
                {id: "one", text: "第一步", status: "in_progress"},
                {id: "two", text: "第二步", status: "pending"},
            ],
        });
        expect(updatedTasks?.details).toMatchObject({
            title: "迁移",
            steps: [
                {id: "one", text: "第一步", status: "completed", note: "完成"},
                {id: "two", text: "第二步", status: "pending"},
            ],
        });
        expect(session.customState[AGENT_TASKS_STATE_KEY]).toEqual(updatedTasks?.details);
    }, 60_000);

    it("真实 turn 的 savePoint 提交后任务清单仍保持在当前分支", async () => {
        const created = await harness.createAgent({
            profileKey: "leader.default",
            initial: {},
        });
        const writeExecutor = (harness as unknown as {writeExecutor: SessionWriteExecutor}).writeExecutor;
        const pendingPlans: Array<{plan: SessionWritePlan; toolCallIndex: number; enqueueOrder: number}> = [];
        let enqueueOrder = 0;
        const snapshotBeforeTurn = await harness.repo.readSession(created.sessionId);
        const context = {
            harness,
            sessionId: created.sessionId,
            profileKey: "leader.default",
            workspaceRoot: absoluteFsPath(workspaceRoot),
            currentProject: null,
            sessionWrites: new ToolSessionWriteSink({
                executor: writeExecutor,
                sessionId: created.sessionId,
                toolCallIndex: 0,
                toolCallId: "task-create-call",
                enqueueSavePoint(plan, source) {
                    pendingPlans.push({plan, toolCallIndex: source.toolCallIndex, enqueueOrder: enqueueOrder++});
                },
            }),
        };
        const taskCreate = harness.tools.get("task_create");
        const taskSetStatus = harness.tools.get("task_set_status");

        await taskCreate?.executeWithContext?.(context, "task-create-call", {
            title: "当前分支任务",
            steps: [
                {id: "one", text: "第一步", status: "in_progress"},
                {id: "two", text: "第二步", status: "pending"},
            ],
        });
        await taskSetStatus?.executeWithContext?.(context, "task-set-call", {
            id: "one",
            status: "completed",
        });

        await writeExecutor.execute([
            {
                target: {sessionId: created.sessionId},
                cause: "turn.ingest",
                durability: "savePoint",
                ops: [{
                    kind: "appendMany",
                    entries: [{
                        type: "message",
                        message: createAssistantTextMessage({text: "完成任务更新"}),
                        origin: "harness",
                        parentId: snapshotBeforeTurn.leafId,
                    }],
                }],
            },
            ...pendingPlans
                .sort((left, right) => left.toolCallIndex - right.toolCallIndex || left.enqueueOrder - right.enqueueOrder)
                .map((item) => item.plan),
        ]);

        const afterTurn = await harness.readSessionContext(created.sessionId);
        expect(afterTurn.customState[AGENT_TASKS_STATE_KEY]).toMatchObject({
            title: "当前分支任务",
            steps: [
                {id: "one", status: "completed"},
                {id: "two", status: "pending"},
            ],
        });

        await harness.repo.moveLeaf(created.sessionId, snapshotBeforeTurn.leafId);
        const otherBranch = await harness.readSessionContext(created.sessionId);
        expect(otherBranch.customState[AGENT_TASKS_STATE_KEY]).toBeUndefined();
    }, 60_000);
});
