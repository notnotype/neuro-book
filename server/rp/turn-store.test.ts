import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    awaitRpTurnPlayer,
    beginRpTurnCommit,
    cancelRpTurn,
    commitRpTurn,
    failRpTurn,
    listIncompleteRpTurns,
    readRpTurn,
    resumeRpTurn,
    RP_ERROR_LEDGER_PATH,
    RP_TURN_LEDGER_PATH,
    RP_UPDATE_LEDGER_PATH,
    startRpTurn,
} from "nbook/server/rp/turn-store";
import {listTickProse} from "nbook/server/rp/prose-store";
import {readRpEventState} from "nbook/server/rp/event-store";
import {defineRpResource, openRpResourceAccount, readRpMechanicsState} from "nbook/server/rp/mechanics-store";
import {readRpRelationState} from "nbook/server/rp/relation-store";
import {readRpCharacterCognition, registerRpWorldFact} from "nbook/server/rp/cognition-store";
import {activateIntake, preparePipelineForCommit} from "nbook/server/rp/test-fixtures";

describe("RP turn store", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-turn-"));
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("只有 active 冒险能开始常规回合，相同 requestKey 复用同一 turn", async () => {
        await expect(startRpTurn(projectRoot, {
            requestKey: "session:invocation-1",
            sessionId: 1,
            inputSummary: "向门卫问路",
        })).rejects.toThrow("当前冒险阶段为 empty");

        await activateIntake(projectRoot);
        const first = await startRpTurn(projectRoot, {
            requestKey: "session:invocation-1",
            sessionId: 1,
            invocationId: "invocation-1",
            inputSummary: "向门卫问路",
        });
        const retried = await startRpTurn(projectRoot, {
            requestKey: "session:invocation-1",
            sessionId: 1,
            invocationId: "invocation-1",
            inputSummary: "这段文本不会创建第二回合",
        });

        expect(first.status).toBe("running");
        expect(retried.id).toBe(first.id);
        expect(retried.sequence).toBe(1);
        expect(retried.worldOperationId).toBe(`rp-turn:${first.id}:world-commit`);
    });

    it("暂停、恢复、提交形成状态闭环，详细结算只写文件且重复提交不重复投影", async () => {
        await activateIntake(projectRoot);
        const turn = await startRpTurn(projectRoot, {
            requestKey: "session:invocation-2",
            sessionId: 2,
            inputSummary: "尝试翻越高墙",
        });

        await expect(awaitRpTurnPlayer(projectRoot, turn.id, "等待玩家掷 2d6")).resolves.toMatchObject({status: "awaiting_player"});
        await expect(resumeRpTurn(projectRoot, turn.id)).resolves.toMatchObject({status: "running"});
        const prosePath = "rp/ticks/000001-climb-wall/prose.md";
        await preparePipelineForCommit(projectRoot, turn.id, prosePath);
        const committing = await beginRpTurnCommit(projectRoot, turn.id);
        expect(committing.status).toBe("committing");

        const settlement = {
            startTime: "第1日 10:00",
            endTime: "第1日 10:05",
            resources: [{subject: "player", key: "体力", delta: -5}],
            events: ["成功翻墙，但惊动巡逻犬"],
        };
        const committed = await commitRpTurn(projectRoot, turn.id, prosePath, settlement);
        const retried = await commitRpTurn(projectRoot, turn.id, prosePath, {ignored: true});
        expect(committed.status).toBe("committed");
        expect(retried.settlement).toEqual(settlement);
        expect(retried.prosePath).toBe(prosePath);
        expect((await readRpTurn(projectRoot, turn.id)).settlement).toEqual(settlement);

        const updates = (await readFile(join(projectRoot, RP_UPDATE_LEDGER_PATH), "utf-8")).trim().split("\n");
        expect(updates).toHaveLength(1);
        expect(updates[0]).toContain("成功翻墙");
        const ledger = await readFile(join(projectRoot, RP_TURN_LEDGER_PATH), "utf-8");
        expect(ledger).toContain('"status":"draft"');
        expect(ledger).toContain('"status":"committed"');
        await expect(listIncompleteRpTurns(projectRoot)).resolves.toEqual([]);
    });

    it("失败记录包含阶段和 Agent，未完成扫描只返回可恢复回合", async () => {
        await activateIntake(projectRoot);
        const failedTurn = await startRpTurn(projectRoot, {requestKey: "failed", sessionId: 3, inputSummary: "调查密室"});
        const waitingTurn = await startRpTurn(projectRoot, {requestKey: "waiting", sessionId: 3, inputSummary: "等待选择"});
        const cancelledTurn = await startRpTurn(projectRoot, {requestKey: "cancelled", sessionId: 3, inputSummary: "旧行动"});

        const failed = await failRpTurn(projectRoot, failedTurn.id, {
            stage: "actor",
            agent: "rp.actor:lin",
            message: "角色档案无法读取",
        });
        await awaitRpTurnPlayer(projectRoot, waitingTurn.id, "等待玩家决定");
        await cancelRpTurn(projectRoot, cancelledTurn.id, "玩家修改行动");

        expect(failed.error).toMatchObject({stage: "actor", agent: "rp.actor:lin"});
        const errors = await readFile(join(projectRoot, RP_ERROR_LEDGER_PATH), "utf-8");
        expect(errors).toContain("角色档案无法读取");
        const incomplete = await listIncompleteRpTurns(projectRoot);
        expect(incomplete.map((turn) => turn.id)).toEqual([waitingTurn.id]);
    });

    it("committing 回合不能直接取消，必须先检查 World operation", async () => {
        await activateIntake(projectRoot);
        const turn = await startRpTurn(projectRoot, {requestKey: "commit-ambiguous", sessionId: 4, inputSummary: "推进世界"});
        await preparePipelineForCommit(projectRoot, turn.id, "rp/ticks/000001-recovered/prose.md");
        await beginRpTurnCommit(projectRoot, turn.id);
        const ambiguous = await failRpTurn(projectRoot, turn.id, {
            stage: "world_commit",
            agent: "rp.world",
            message: "响应中断，提交结果未知",
        });
        expect(ambiguous.status).toBe("committing");
        expect(ambiguous.error?.message).toContain("结果未知");
        await expect(cancelRpTurn(projectRoot, turn.id, "直接丢弃")).rejects.toThrow("不能进入 cancelled");
        await expect(commitRpTurn(projectRoot, turn.id, "rp/ticks/000001-recovered/prose.md", {recovered: true}))
            .resolves.toMatchObject({status: "committed"});
    });

    it("正文面板只读取开场和 committed 回合登记的 prosePath", async () => {
        await activateIntake(projectRoot);
        for (const dir of ["000000-initial-state", "000001-committed", "000002-uncommitted"]) {
            await mkdir(join(projectRoot, "rp/ticks", dir), {recursive: true});
            await writeFile(join(projectRoot, "rp/ticks", dir, "prose.md"), `# ${dir}\n`, "utf-8");
        }
        const turn = await startRpTurn(projectRoot, {requestKey: "prose-filter", sessionId: 5, inputSummary: "已提交行动"});
        await preparePipelineForCommit(projectRoot, turn.id, "rp/ticks/000001-committed/prose.md");
        await beginRpTurnCommit(projectRoot, turn.id);
        await commitRpTurn(projectRoot, turn.id, "rp/ticks/000001-committed/prose.md", {events: ["完成"]});

        const prose = await listTickProse(projectRoot);
        expect(prose.map((item) => item.dir)).toEqual(["000000-initial-state", "000001-committed"]);
    });

    it("只有 committed 回合进入五次平淡触发器，同一回合重试不重复计数", async () => {
        await activateIntake(projectRoot);
        const abandoned = await startRpTurn(projectRoot, {requestKey: "abandoned-calm", sessionId: 6, inputSummary: "在长椅上休息"});
        await cancelRpTurn(projectRoot, abandoned.id, "玩家改变主意");

        for (let sequence = 1; sequence <= 5; sequence += 1) {
            const turn = await startRpTurn(projectRoot, {requestKey: `calm-${sequence}`, sessionId: 6, inputSummary: "平静度过一段时间"});
            const prosePath = `rp/ticks/${String(sequence).padStart(6, "0")}-calm/prose.md`;
            await preparePipelineForCommit(projectRoot, turn.id, prosePath);
            await beginRpTurnCommit(projectRoot, turn.id);
            await commitRpTurn(projectRoot, turn.id, prosePath, {events: []}, false);
        }
        const latest = await readRpEventState(projectRoot);
        expect(latest).toMatchObject({calmTickStreak: 5, candidateGenerationDue: true});
        expect(latest.recordedTurnIds).toHaveLength(5);

        const fifth = latest.recordedTurnIds[4];
        if (!fifth) throw new Error("fixture 缺少第五个回合");
        await commitRpTurn(projectRoot, fifth, "rp/ticks/000005-calm/prose.md", {ignored: true}, false);
        expect((await readRpEventState(projectRoot)).recordedTurnIds).toHaveLength(5);
    });

    it("P4 时间资源、关系和认知只在 commit 收口，跨领域预检失败不留下半套状态", async () => {
        await activateIntake(projectRoot);
        await defineRpResource(projectRoot, {id: "money", label: "金钱", kind: "ledger", unit: "分", min: 0, max: null, bands: [], periodicRules: [], derivedRate: null});
        const account = await openRpResourceAccount(projectRoot, {subjectId: "player", ownerTier: "player", resourceId: "money", initialValue: 1000, anchorInstant: "0"});
        await registerRpWorldFact(projectRoot, {id: "fact:rain", statement: "正在下雨", importance: "normal", tick: 1, source: "世界状态"});
        const turn = await startRpTurn(projectRoot, {requestKey: "p4-rules", sessionId: 7, inputSummary: "与林在雨中交谈"});
        await preparePipelineForCommit(projectRoot, turn.id, "rp/ticks/000001-rain/prose.md");
        await beginRpTurnCommit(projectRoot, turn.id);

        const invalidRules = {
            mechanics: {startInstant: "0", endInstant: "60", startTime: "T0", endTime: "T60", longJump: false, summary: "交谈一分钟", resourceChanges: [{accountId: account.id, delta: -100, reason: "买伞"}]},
            relations: [{tick: 1, sourceId: "lin", targetId: "player", deltas: {trust: 10}, basis: "dice" as const, reason: "骰子成功"}],
            cognition: [{op: "learn" as const, characterId: "player", factId: "fact:rain", belief: "believes" as const, content: "外面在下雨", source: "亲眼看见", tick: 1, channel: "observed" as const}],
        };
        await expect(commitRpTurn(projectRoot, turn.id, "rp/ticks/000001-rain/prose.md", {events: []}, true, invalidRules)).rejects.toThrow("骰子只能影响");
        expect((await readRpTurn(projectRoot, turn.id)).status).toBe("committing");
        expect((await readRpMechanicsState(projectRoot)).timeRecords).toEqual([]);

        const rules = {...invalidRules, relations: [{...invalidRules.relations[0]!, basis: "interaction" as const, reason: "林认可玩家冒雨赴约"}]};
        await commitRpTurn(projectRoot, turn.id, "rp/ticks/000001-rain/prose.md", {events: []}, true, rules);
        await commitRpTurn(projectRoot, turn.id, "rp/ticks/000001-rain/prose.md", {ignored: true}, true, rules);
        expect((await readRpMechanicsState(projectRoot)).accounts[0]?.value).toBe(900);
        expect((await readRpRelationState(projectRoot)).edges[0]?.dimensions.trust).toBe(10);
        expect(await readRpCharacterCognition(projectRoot, "player")).toHaveLength(1);
    });
});
