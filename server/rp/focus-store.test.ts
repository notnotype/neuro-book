import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {registerFormalEvent} from "nbook/server/rp/event-store";
import {
    planRpRuntime,
    readRpFocusState,
    rebalanceRpFocus,
    recordRpLongJumpSummary,
    RP_FOCUS_LEDGER_PATH,
    RP_LONG_JUMP_ROOT,
    setRpObjectFocus,
    setRpRunIntensity,
} from "nbook/server/rp/focus-store";
import {promoteRpNpc, registerNamedRpNpc} from "nbook/server/rp/npc-store";
import {activateIntake} from "nbook/server/rp/test-fixtures";

describe("RP focus runtime", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-focus-"));
        await activateIntake(projectRoot);
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("默认 standard，强度持久化且玩家固定关注度不会被 world 降级", async () => {
        await expect(readRpFocusState(projectRoot)).resolves.toMatchObject({intensity: "standard", objects: []});
        await expect(setRpObjectFocus(projectRoot, {
            id: "capital", kind: "location", level: "current", pinned: true, playerApproved: false, reason: "玩家关注", tick: 1,
        })).rejects.toThrow("玩家确认");
        await setRpRunIntensity(projectRoot, "light");
        await setRpObjectFocus(projectRoot, {
            id: "capital", kind: "location", level: "current", pinned: true, playerApproved: true, reason: "玩家固定首都", tick: 1,
        });
        await rebalanceRpFocus(projectRoot, {tick: 2, current: [], activeBackground: [], lowFrequency: []});
        const state = await readRpFocusState(projectRoot);
        expect(state.intensity).toBe("light");
        expect(state.objects[0]).toMatchObject({id: "capital", level: "current", pinned: true});
    });

    it("主要角色至少保持 low_frequency，离开当前关注也不会休眠", async () => {
        await register("lin", "林");
        await promoteRpNpc(projectRoot, {npcId: "lin", targetTier: "major", playerApproved: true, reason: "长期同伴", tick: 2});
        await rebalanceRpFocus(projectRoot, {tick: 3, current: [], activeBackground: [], lowFrequency: []});
        expect((await readRpFocusState(projectRoot)).objects).toContainEqual(expect.objectContaining({id: "lin", kind: "npc", level: "low_frequency"}));
    });

    it("三档只改变远端预算，当前/直接互动角色、硬事件和确定性结算始终保留", async () => {
        await register("lin", "林");
        await register("vendor", "商贩");
        await register("passerby", "路人甲");
        await promoteRpNpc(projectRoot, {npcId: "lin", targetTier: "major", playerApproved: true, reason: "主要同伴", tick: 2});
        const exam = await registerFormalEvent(projectRoot, {
            origin: "hard_schedule",
            trigger: "plan_due",
            tone: "dangerous",
            title: "期末考试",
            playerSummary: "预定考试已经开始。",
            hard: true,
            hardKind: "schedule",
            startActive: true,
        });
        await rebalanceRpFocus(projectRoot, {
            tick: 3,
            current: [{id: "academy", kind: "location", reason: "玩家当前场景"}],
            activeBackground: [{id: "lin", kind: "npc", reason: "同场主要角色"}],
            lowFrequency: [],
        });

        await setRpRunIntensity(projectRoot, "light");
        const light = await planRpRuntime(projectRoot, {
            turnId: "turn-light", longJump: false, startInstant: "0", endInstant: "5", currentNpcIds: ["lin"], directInteractionNpcIds: ["vendor"],
        });
        await setRpRunIntensity(projectRoot, "standard");
        const standard = await planRpRuntime(projectRoot, {
            turnId: "turn-standard", longJump: false, startInstant: "5", endInstant: "10", currentNpcIds: ["lin"], directInteractionNpcIds: ["vendor"],
        });
        await setRpRunIntensity(projectRoot, "deep");
        const deep = await planRpRuntime(projectRoot, {
            turnId: "turn-deep", longJump: false, startInstant: "10", endInstant: "15", currentNpcIds: ["lin"], directInteractionNpcIds: ["vendor"],
        });

        expect(light.independentNpcIds).toEqual(["lin", "vendor"]);
        expect(light.batchNpcIds).toContain("passerby");
        expect(light.deterministicModules).toContain("hard_events");
        expect(light.backgroundObjectIds).toContain(exam.id);
        expect([light.remoteSceneBudget, standard.remoteSceneBudget, deep.remoteSceneBudget]).toEqual([0, 2, 6]);
    });

    it("运行计划拒绝格式化日历文本和逆序 Instant", async () => {
        await expect(planRpRuntime(projectRoot, {
            turnId: "turn-calendar", longJump: false, startInstant: "地下城历1年1月1日 11:50", endInstant: "11", currentNpcIds: [], directInteractionNpcIds: [],
        })).rejects.toThrow("bigint 十进制字符串");
        await expect(planRpRuntime(projectRoot, {
            turnId: "turn-reversed", longJump: false, startInstant: "12", endInstant: "11", currentNpcIds: [], directInteractionNpcIds: [],
        })).rejects.toThrow("不能早于");
    });

    it("长时间跳跃只保存一次汇总文件，不逐日制造回合", async () => {
        const input = {
            startTime: "第1日",
            endTime: "第31日",
            deterministicSummary: "租金与生理周期完成一次批量结算",
            characterSummary: "主要角色关系缓慢变化",
            worldSummary: "远端局势按关注度推演",
        };
        const results = await Promise.all(Array.from({length: 8}, () => recordRpLongJumpSummary(projectRoot, "turn-long-jump", input)));
        expect(new Set(results.map((result) => result.path)).size).toBe(1);
        const saved = JSON.parse(await readFile(join(projectRoot, RP_LONG_JUMP_ROOT, "turn-long-jump.json"), "utf-8")) as {worldSummary: string};
        expect(saved.worldSummary).toBe(input.worldSummary);
        const ledger = (await readFile(join(projectRoot, RP_FOCUS_LEDGER_PATH), "utf-8")).trim().split("\n");
        expect(ledger.filter((line) => line.includes('"operation":"record_long_jump"'))).toHaveLength(1);
        expect((await readRpFocusState(projectRoot)).plans).toEqual([]);
    });

    async function register(id: string, name: string): Promise<void> {
        await registerNamedRpNpc(projectRoot, {
            id,
            name,
            origin: "world",
            narrativeRole: "测试角色",
            playerSummary: `${name}出现在场景中。`,
            household: "普通收入",
            tick: 1,
            locationId: "academy",
        });
    }
});
