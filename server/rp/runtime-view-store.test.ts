import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {registerCandidateBatch} from "nbook/server/rp/event-store";
import {defineRpResource, openRpResourceAccount} from "nbook/server/rp/mechanics-store";
import {proposeRpLocation, reviewRpLocationProposal} from "nbook/server/rp/map-store";
import {registerNamedRpNpc} from "nbook/server/rp/npc-store";
import {ensureRpCharacter} from "nbook/server/rp/character-store";
import {settleRpRelationsTurn} from "nbook/server/rp/relation-store";
import {listRpUpdates, readRpRuntimeOverview, readRpUpdateDetail} from "nbook/server/rp/runtime-view-store";
import {activateIntake, preparePipelineForCommit} from "nbook/server/rp/test-fixtures";
import {beginRpTurnCommit, commitRpTurn, startRpTurn} from "nbook/server/rp/turn-store";

describe("RP runtime player view", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-runtime-view-"));
        await activateIntake(projectRoot);
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("聚合运行概况与玩家投影，不泄露事件幕后安排或 NPC 人设草案", async () => {
        await registerCandidateBatch(projectRoot, {
            trigger: "new_location",
            proposals: [
                card("calm", "街角长椅", "安静休息", "幕后平静安排"),
                card("exciting", "飞驰马车", "马车冲过街口", "幕后刺激安排"),
                card("dangerous", "屋顶黑影", "高处有人窥视", "幕后危险安排"),
                card("unusual", "倒流钟声", "钟声次序异常", "幕后异常安排"),
            ],
        });
        const worldProposal = await proposeRpLocation(projectRoot, {
            requestedId: "world",
            parentId: null,
            level: "world",
            canonicalName: "世界",
            playerSummary: "当前冒险所在的世界。",
            rumorLabel: "世界",
            approximateDirection: null,
            initialStatus: "discovered",
            persistenceBasis: ["world_structure"],
            origin: "screenwriter",
        });
        await reviewRpLocationProposal(projectRoot, worldProposal.id, {accepted: true});
        const proposal = await proposeRpLocation(projectRoot, {
            requestedId: "old-town",
            parentId: "world",
            level: "town",
            canonicalName: "旧城",
            playerSummary: "城墙后隐约可见旧屋。",
            rumorLabel: "传闻中的旧城",
            approximateDirection: "北方",
            initialStatus: "rumored",
            persistenceBasis: ["world_structure"],
            origin: "screenwriter",
        });
        await reviewRpLocationProposal(projectRoot, proposal.id, {accepted: true});
        await registerNamedRpNpc(projectRoot, {
            id: "lin", name: "林", aliases: ["隐藏称号"], origin: "world", narrativeRole: "商人", playerSummary: "经营杂货铺。",
            personaSummary: "绝不能出现在玩家投影的秘密人设", household: "普通收入", tick: 1, locationId: "old-town",
        });
        await ensureRpCharacter(projectRoot, "player", {name: "玩家", aliases: ["不能公开的解析别名"], kind: "player"});
        await settleRpRelationsTurn(projectRoot, "relation-seed", [{
            tick: 1, sourceId: "lin", targetId: "player", deltas: {familiarity: 10}, addTags: ["认识"], basis: "setting", reason: "开局设定",
        }]);
        await defineRpResource(projectRoot, {id: "money", label: "金钱", kind: "ledger", unit: "分", min: 0, max: null, bands: [], periodicRules: [], derivedRate: null});
        await openRpResourceAccount(projectRoot, {subjectId: "player", ownerTier: "player", resourceId: "money", initialValue: 1250, anchorInstant: "0"});
        const turn = await startRpTurn(projectRoot, {requestKey: "overview", sessionId: 1, inputSummary: "进入旧城"});

        const overview = await readRpRuntimeOverview(projectRoot, [
            {id: "player", name: "玩家"}, {id: "lin", name: "林"}, {id: "extra", name: "路过角色"},
        ]);
        expect(overview).toMatchObject({
            intake: {phase: "active", confirmedVersion: 8, bootstrap: {status: "complete"}},
            intensity: "standard",
            currentTurn: {id: turn.id, status: "running"},
            pipeline: {stage: "action_understanding", stageIndex: 1, stageCount: 10},
            counts: {committedTurns: 0, incompleteTurns: 1},
        });
        expect(overview.events.items).toHaveLength(4);
        expect(overview.map.nodes.find((node) => node.id === "old-town")).toMatchObject({id: "old-town", label: "传闻中的旧城", status: "rumored"});
        expect(overview.roster.npcs[0]).toMatchObject({id: "lin", tier: "named"});
        expect(overview.characters).toEqual(expect.arrayContaining([
            expect.objectContaining({id: "player", category: "player"}),
            expect.objectContaining({id: "lin", category: "named"}),
            expect.objectContaining({id: "extra", category: "other"}),
        ]));
        expect(overview.relations).toContainEqual(expect.objectContaining({sourceId: "lin", targetId: "player", tags: ["认识"]}));
        expect(overview.resources[0]).toMatchObject({label: "金钱", value: 1250, unit: "分"});
        const serialized = JSON.stringify(overview);
        expect(serialized).not.toContain("幕后危险安排");
        expect(serialized).not.toContain("秘密人设");
        expect(serialized).not.toContain("隐藏称号");
        expect(serialized).not.toContain("不能公开的解析别名");
    });

    it("更新列表分页只返回摘要，详情按需读取 settlement 与公开阶段历史", async () => {
        for (let index = 1; index <= 3; index += 1) {
            const turn = await startRpTurn(projectRoot, {requestKey: `update-${index}`, sessionId: 1, inputSummary: `执行行动 ${index}`});
            const prosePath = `rp/ticks/${String(index).padStart(6, "0")}-update/prose.md`;
            await preparePipelineForCommit(projectRoot, turn.id, prosePath);
            await beginRpTurnCommit(projectRoot, turn.id);
            await commitRpTurn(projectRoot, turn.id, prosePath, {summary: `结算摘要 ${index}`, privateDetail: `详情 ${index}`});
        }

        const page = await listRpUpdates(projectRoot, 1, 1);
        expect(page).toMatchObject({total: 3, offset: 1, limit: 1});
        expect(page.items[0]).toMatchObject({sequence: 2, summary: "结算摘要 2"});
        expect(JSON.stringify(page)).not.toContain("详情 2");

        const detail = await readRpUpdateDetail(projectRoot, page.items[0]!.turnId);
        expect(detail.settlement).toMatchObject({summary: "结算摘要 2", privateDetail: "详情 2"});
        expect(detail.stageHistory.at(-1)?.stage).toBe("ui_update");
        expect(detail.turn.status).toBe("committed");
    });

    it("拒绝把未提交回合作为正式更新详情", async () => {
        const turn = await startRpTurn(projectRoot, {requestKey: "running-detail", sessionId: 1, inputSummary: "尚在运行"});
        await expect(readRpUpdateDetail(projectRoot, turn.id)).rejects.toThrow("尚未 committed");
    });

    function card(tone: "calm" | "exciting" | "dangerous" | "unusual", title: string, playerSummary: string, hiddenSetup: string) {
        return {tone, title, playerSummary, hiddenSetup, locationId: "old-town"};
    }
});
