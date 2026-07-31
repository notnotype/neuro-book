import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    analyzeRpLongJump,
    defineRpCycle,
    defineRpResource,
    openRpResourceAccount,
    readRpCycleAt,
    readRpMechanicsState,
    readRpResourceAt,
    resolveRpRisk,
    settleRpMechanicsTurn,
} from "nbook/server/rp/mechanics-store";
import {registerFormalEvent} from "nbook/server/rp/event-store";
import {activateIntake} from "nbook/server/rp/test-fixtures";

describe("RP mechanics store", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-mechanics-"));
        await activateIntake(projectRoot);
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("长跨度一次批量结算周期资源，直接变化和重试都保持幂等", async () => {
        await defineRpResource(projectRoot, {
            id: "money", label: "金钱", kind: "ledger", unit: "分", min: 0, max: null, bands: [], derivedRate: null,
            periodicRules: [{id: "daily-income", everySeconds: "100", delta: 500, anchorInstant: "0", label: "周期收入"}],
        });
        const account = await openRpResourceAccount(projectRoot, {subjectId: "player", ownerTier: "player", resourceId: "money", initialValue: 1000, anchorInstant: "0"});
        const settlement = {
            startInstant: "0", endInstant: "300", startTime: "第1日 00:00", endTime: "第4日 00:00", longJump: true, summary: "平静度过三日",
            resourceChanges: [{accountId: account.id, delta: -200, reason: "购买补给"}],
        };
        const first = await settleRpMechanicsTurn(projectRoot, "turn-1", settlement);
        const retried = await settleRpMechanicsTurn(projectRoot, "turn-1", {...settlement, resourceChanges: [{accountId: account.id, delta: -999, reason: "不应重放"}]});
        expect(first.accounts[0]?.value).toBe(2300);
        expect(first.transactions).toHaveLength(2);
        expect(retried.accounts[0]?.value).toBe(2300);
        expect(retried.timeRecords).toHaveLength(1);
    });

    it("time_derived 保存锚点精确值，读取时计算状态词而不逐时写记录", async () => {
        await defineRpResource(projectRoot, {
            id: "desire", label: "欲望", kind: "time_derived", unit: "点", min: 0, max: 100,
            bands: [{min: 0, max: 24, label: "平静"}, {min: 25, max: 49, label: "微热"}, {min: 50, max: 74, label: "亢奋"}, {min: 75, max: 100, label: "难耐"}],
            periodicRules: [], derivedRate: {numeratorDelta: 5, numeratorSeconds: "60"},
        });
        const account = await openRpResourceAccount(projectRoot, {subjectId: "player", ownerTier: "player", resourceId: "desire", initialValue: 20, anchorInstant: "0"});
        await expect(readRpResourceAt(projectRoot, account.id, "360")).resolves.toMatchObject({value: 50, band: "亢奋"});
        expect((await readRpMechanicsState(projectRoot)).accounts[0]?.value).toBe(20);
    });

    it("周期模块完整覆盖后按锚点计算阶段", async () => {
        await defineRpCycle(projectRoot, {
            id: "cycle:lin", subjectId: "lin", label: "生理周期", anchorInstant: "1000", lengthSeconds: "400",
            phases: [
                {label: "阶段A", startSecond: "0", endSecond: "100"},
                {label: "阶段B", startSecond: "100", endSecond: "300"},
                {label: "阶段C", startSecond: "300", endSecond: "400"},
            ],
            private: true,
        });
        await expect(readRpCycleAt(projectRoot, "cycle:lin", "1450")).resolves.toMatchObject({phase: "阶段A", offsetSecond: "50"});
    });

    it("长跳遇到 active 或区间内硬性事件时暂停并返回具体问题", async () => {
        const active = await registerFormalEvent(projectRoot, {
            origin: "opening", trigger: "opening_stable", tone: "exciting", title: "正在调查", playerSummary: "线索尚未查完", startActive: true,
        });
        const exam = await registerFormalEvent(projectRoot, {
            origin: "hard_schedule", trigger: "plan_due", tone: "dangerous", title: "考试", playerSummary: "约定的考试即将开始",
            hard: true, hardKind: "schedule", dueAt: "T:150",
        });
        const blocked = await analyzeRpLongJump(projectRoot, "100", "200", async (time) => BigInt(time.slice(2)));
        expect(blocked.allowed).toBe(false);
        expect(blocked.blockers.map((item) => item.eventId)).toEqual([active.id, exam.id]);
        const approved = await analyzeRpLongJump(projectRoot, "100", "200", async (time) => BigInt(time.slice(2)), [active.id, exam.id]);
        expect(approved).toEqual({allowed: true, blockers: []});
    });

    it("概率由服务端抽取并按 operationId 幂等", async () => {
        const input = {
            operationId: "risk:turn-1", subjectId: "lin", kind: "pregnancy" as const, riskLevel: "high" as const,
            cycleFactorPpm: 800_000, protectionFactorPpm: 500_000, private: true, reason: "高风险行为、周期与措施综合",
        };
        const first = await resolveRpRisk(projectRoot, input, () => 90_000);
        const retried = await resolveRpRisk(projectRoot, input, () => 999_999);
        expect(first).toMatchObject({probabilityPpm: 100_000, occurred: true, rollPpm: 90_000});
        expect(retried).toEqual(first);
    });
});
