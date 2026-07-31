import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    advanceRpPipeline,
    captureRpTurnSnapshot,
    readRpPipeline,
    registerRpNarrative,
    reportRpPipelineFailure,
    resolveRpPipelineFailure,
    resolveRpProposalConflicts,
    submitRpActorProposals,
    submitRpAdjudication,
    submitRpExtrasProposal,
    submitRpScreenwriterPlan,
} from "nbook/server/rp/pipeline-store";
import {activateIntake} from "nbook/server/rp/test-fixtures";
import {beginRpTurnCommit, commitRpTurn, startRpTurn} from "nbook/server/rp/turn-store";

describe("RP turn pipeline", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-pipeline-"));
        await activateIntake(projectRoot);
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("start 自动初始化代码可见阶段，阶段不可跳跃且快照重试幂等", async () => {
        const turn = await start("pipeline-order");
        await expect(readRpPipeline(projectRoot, turn.id)).resolves.toMatchObject({stage: "action_understanding", turnId: turn.id});
        await expect(advanceRpPipeline(projectRoot, turn.id, "condition_check", "跳过快照"))
            .rejects.toThrow("只能相邻推进");

        await advanceRpPipeline(projectRoot, turn.id, "world_snapshot", "读取世界状态");
        const first = await captureRpTurnSnapshot(projectRoot, turn.id, {
            worldInstant: "day:1:10:00",
            publicSummary: "玩家位于城门",
            state: {location: "gate", money: 10},
        });
        const retried = await captureRpTurnSnapshot(projectRoot, turn.id, {
            worldInstant: "ignored",
            publicSummary: "响应丢失后的重试",
            state: {ignored: true},
        });
        expect(retried).toEqual(first);
        expect(first.stateHash).toMatch(/^[a-f0-9]{64}$/u);
    });

    it("所有主要 actor 必须绑定同一快照返回，失败不能手工代演", async () => {
        const {turnId, snapshotId} = await reachActorStage("major-actor", ["lin"], false);
        const failure = await reportRpPipelineFailure(projectRoot, turnId, {
            kind: "major_actor",
            agent: "rp.actor:lin",
            actorId: "lin",
            message: "角色会话暂时不可用",
        });
        expect(failure).toMatchObject({blocking: true, recoveryOptions: ["重试同一 actor", "取消并修改本回合行动"]});
        await expect(resolveRpPipelineFailure(projectRoot, turnId, failure.id, "retried")).rejects.toThrow("不能手工代演");
        await expect(submitRpActorProposals(projectRoot, turnId, "wrong-snapshot", [{
            actorId: "lin", visibleResponse: "抬头", spokenWords: "你好", innerResponse: "保持警惕",
        }])).rejects.toThrow("snapshotId");
        await expect(advanceRpPipeline(projectRoot, turnId, "conflict_resolution", "尝试继续"))
            .rejects.toThrow("尚未全部返回");

        await submitRpActorProposals(projectRoot, turnId, snapshotId, [{
            actorId: "lin", visibleResponse: "林谨慎地抬头", spokenWords: "你找我？", innerResponse: "先听听来意",
        }]);
        expect((await readRpPipeline(projectRoot, turnId)).failures[0]?.resolved).toBe(true);
        await expect(advanceRpPipeline(projectRoot, turnId, "conflict_resolution", "主要角色已返回"))
            .resolves.toMatchObject({stage: "conflict_resolution"});
    });

    it("extras 可重建，但 plan 要求的群演提案仍不能省略", async () => {
        const {turnId, snapshotId} = await reachActorStage("extras-rebuild", [], true);
        const failure = await reportRpPipelineFailure(projectRoot, turnId, {kind: "extras", agent: "rp.extras", message: "群演会话损坏"});
        expect(failure.blocking).toBe(false);
        await resolveRpPipelineFailure(projectRoot, turnId, failure.id, "extras_rebuilt");
        await expect(advanceRpPipeline(projectRoot, turnId, "conflict_resolution", "跳过群演"))
            .rejects.toThrow("尚未提交群演提案");
        await submitRpExtrasProposal(projectRoot, turnId, snapshotId, "酒馆客人停下交谈，朝门口看去");
        await expect(advanceRpPipeline(projectRoot, turnId, "conflict_resolution", "群演提案已返回"))
            .resolves.toMatchObject({stage: "conflict_resolution"});
    });

    it("角色意图冲突以 actor 为先，screenwriter 不得覆盖", async () => {
        const {turnId, snapshotId} = await reachActorStage("actor-priority", ["lin"], false);
        await submitRpActorProposals(projectRoot, turnId, snapshotId, [{
            actorId: "lin", visibleResponse: "林后退半步", spokenWords: "不。", innerResponse: "拒绝这个危险计划",
        }]);
        await advanceRpPipeline(projectRoot, turnId, "conflict_resolution", "开始统一解决冲突");
        const conflict = {id: "lin-choice", kind: "character_intent" as const, description: "林是否接受邀请", sources: ["screenwriter", "actor:lin"]};
        await expect(resolveRpProposalConflicts(projectRoot, turnId, {
            snapshotId,
            conflicts: [conflict],
            resolutions: [{conflictId: conflict.id, chosenSource: "screenwriter", reason: "更方便剧情"}],
            mergedSummary: "林接受邀请",
        })).rejects.toThrow("不能覆盖 actor");
        await expect(resolveRpProposalConflicts(projectRoot, turnId, {
            snapshotId,
            conflicts: [conflict],
            resolutions: [{conflictId: conflict.id, chosenSource: "actor:lin", reason: "符合既有人设与当前关系"}],
            mergedSummary: "林拒绝邀请",
        })).resolves.toMatchObject({snapshotId});
    });

    it("终裁和叙事 artifact 是提交硬门禁，正式提交后自动进入 ui_update", async () => {
        const {turnId, snapshotId} = await reachActorStage("commit-gate", [], false);
        await advanceRpPipeline(projectRoot, turnId, "conflict_resolution", "没有角色提案");
        await resolveRpProposalConflicts(projectRoot, turnId, {snapshotId, conflicts: [], resolutions: [], mergedSummary: "无冲突"});
        await advanceRpPipeline(projectRoot, turnId, "adjudication", "进入终裁");
        await submitRpAdjudication(projectRoot, turnId, snapshotId, "行动成功", {result: "success"});
        await advanceRpPipeline(projectRoot, turnId, "narrative", "进入叙事");
        await expect(beginRpTurnCommit(projectRoot, turnId)).rejects.toThrow("未到 world_commit");
        await expect(advanceRpPipeline(projectRoot, turnId, "world_commit", "跳过叙事登记"))
            .rejects.toThrow("尚未登记");

        const prosePath = "rp/ticks/000001-pipeline/prose.md";
        await registerRpNarrative(projectRoot, turnId, prosePath, "玩家进入城门");
        await advanceRpPipeline(projectRoot, turnId, "world_commit", "准备统一提交");
        await beginRpTurnCommit(projectRoot, turnId);
        await commitRpTurn(projectRoot, turnId, prosePath, {result: "success"});
        await expect(readRpPipeline(projectRoot, turnId)).resolves.toMatchObject({stage: "ui_update", completedAt: expect.any(String)});
    });

    async function start(requestKey: string) {
        return startRpTurn(projectRoot, {requestKey, sessionId: 1, inputSummary: "玩家采取行动"});
    }

    async function reachActorStage(requestKey: string, expectedActorIds: string[], extrasRequired: boolean): Promise<{turnId: string; snapshotId: string}> {
        const turn = await start(requestKey);
        await advanceRpPipeline(projectRoot, turn.id, "world_snapshot", "读取世界状态");
        const snapshot = await captureRpTurnSnapshot(projectRoot, turn.id, {worldInstant: "0", publicSummary: "同一回合开始状态", state: {tick: 1}});
        await advanceRpPipeline(projectRoot, turn.id, "condition_check", "条件检查完成");
        await advanceRpPipeline(projectRoot, turn.id, "screenwriter_plan", "进入编排");
        await submitRpScreenwriterPlan(projectRoot, turn.id, {
            snapshotId: snapshot.id,
            expectedActorIds,
            extrasRequired,
            lightweight: false,
            requiresPlayerRoll: false,
            summary: "安排同场角色独立提案",
        });
        await advanceRpPipeline(projectRoot, turn.id, "actor_proposals", "等待同快照角色提案");
        return {turnId: turn.id, snapshotId: snapshot.id};
    }
});
