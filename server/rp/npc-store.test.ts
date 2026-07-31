import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    markRpNpcResourcesReady,
    promoteRpNpc,
    readRpNpcState,
    registerNamedRpNpc,
    setRpNpcPresence,
    suggestRpNpcPromotion,
} from "nbook/server/rp/npc-store";
import {activateIntake} from "nbook/server/rp/test-fixtures";

describe("RP NPC lifecycle store", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-npc-"));
        await activateIntake(projectRoot);
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("群演报出姓名后建立最低具名记录并阻止重复身份", async () => {
        const lin = await register("lin", "林", "extra_named", "中立商人");
        expect(lin).toMatchObject({tier: "named", resourceStatus: "none", actorSession: "lazy"});
        await expect(register("another-lin", "林", "world", "身份重复")).rejects.toThrow("禁止建立重复档案");
        await expect(register("lin", "林", "extra_named", "再次见面")).resolves.toMatchObject({id: "lin", lastSeenTick: 1});
    });

    it("擢升必须玩家确认，major 会补齐人设和历史记忆", async () => {
        await register("rival", "宿敌", "world", "敌对竞争者");
        await expect(promoteRpNpc(projectRoot, {npcId: "rival", targetTier: "major", playerApproved: false, reason: "长期对抗", tick: 6})).rejects.toThrow("玩家确认");
        const promoted = await promoteRpNpc(projectRoot, {
            npcId: "rival", targetTier: "major", playerApproved: true, reason: "与玩家建立了持续而深刻的敌对联系", tick: 6,
            soul: "# 我是谁\n\n我是玩家长期的竞争者。",
            memoryBackfill: [{tick: 3, summaryLine: "第一次正面对峙", detail: "我在桥上第一次与玩家交锋。", sourceRef: "rp/ticks/000003-bridge/report.md"}],
        });
        expect(promoted.npc).toMatchObject({tier: "major", resourceStatus: "pending"});
        await expect(promoteRpNpc(projectRoot, {npcId: "rival", targetTier: "major", playerApproved: true, reason: "响应丢失后重试", tick: 6})).resolves.toMatchObject({npc: {tier: "major"}});
        expect((await readRpNpcState(projectRoot)).promotions).toHaveLength(1);
        await expect(readFile(join(projectRoot, "rp/characters/rival/人设/soul.md"), "utf-8")).resolves.toContain("长期的竞争者");
        await expect(readFile(join(projectRoot, "rp/characters/rival/记忆/ticks/Tick000003.md"), "utf-8")).resolves.toContain("桥上第一次");
    });

    it("screenwriter 建议不阻塞叙事，实际擢升后建议才标记 accepted", async () => {
        await register("guard", "守卫", "world", "可靠守卫");
        const suggestion = await suggestRpNpcPromotion(projectRoot, {npcId: "guard", targetTier: "resident", reason: "连续多次帮助玩家", evidence: ["Tick 2 带路", "Tick 5 援护"]});
        expect(suggestion.status).toBe("open");
        expect((await readRpNpcState(projectRoot)).npcs[0]?.tier).toBe("named");
        await promoteRpNpc(projectRoot, {npcId: "guard", targetTier: "resident", playerApproved: true, reason: "玩家确认保留", tick: 5});
        expect((await readRpNpcState(projectRoot)).suggestions[0]?.status).toBe("accepted");
    });

    it("长期离场转 major_inactive，回归时恢复且档案不删除", async () => {
        await register("mage", "法师", "world", "同行法师");
        await promoteRpNpc(projectRoot, {npcId: "mage", targetTier: "major", playerApproved: true, reason: "核心同伴", tick: 2});
        await expect(setRpNpcPresence(projectRoot, {npcId: "mage", tick: 20, active: false, reason: "远赴北境"})).resolves.toMatchObject({tier: "major_inactive", inactiveReason: "远赴北境"});
        await expect(setRpNpcPresence(projectRoot, {npcId: "mage", tick: 30, active: true, locationId: "capital", reason: "返回队伍"})).resolves.toMatchObject({tier: "major", inactiveReason: null});
        await expect(readFile(join(projectRoot, "rp/characters/mage/人设/soul.md"), "utf-8")).resolves.toContain("我是谁");
    });

    it("常驻角色必须显式完成精确资源初始化", async () => {
        await register("shopkeeper", "店主", "world", "固定商店经营者");
        await promoteRpNpc(projectRoot, {npcId: "shopkeeper", targetTier: "resident", playerApproved: true, reason: "长期经营据点", tick: 4});
        expect((await readRpNpcState(projectRoot)).npcs[0]?.resourceStatus).toBe("pending");
        await expect(markRpNpcResourcesReady(projectRoot, "shopkeeper")).resolves.toMatchObject({resourceStatus: "ready"});
    });

    it("活跃主要角色超过八名只给软提示，不设置硬上限", async () => {
        let warnings: string[] = [];
        for (let index = 1; index <= 9; index += 1) {
            const id = `major-${index}`;
            await register(id, `主要角色${index}`, "world", index % 2 === 0 ? "敌对角色" : "同行者");
            warnings = (await promoteRpNpc(projectRoot, {npcId: id, targetTier: "major", playerApproved: true, reason: "玩家明确擢升", tick: index})).warnings;
        }
        expect((await readRpNpcState(projectRoot)).npcs.filter((npc) => npc.tier === "major")).toHaveLength(9);
        expect(warnings[0]).toContain("超过软上限 8");
    });

    async function register(id: string, name: string, origin: "extra_named" | "world", narrativeRole: string) {
        return registerNamedRpNpc(projectRoot, {
            id, name, origin, narrativeRole, aliases: [], playerSummary: `${name}出现在场景中。`, household: "普通收入", tick: 1, locationId: "market",
        });
    }
});
