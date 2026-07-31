import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    activateRpEvent,
    discardRpCandidate,
    finishRpEvent,
    invalidateRpLocationCandidates,
    randomSelectRpCandidate,
    readRpEventState,
    recordRpEventTick,
    registerCandidateBatch,
    registerFormalEvent,
    revalidateRpCandidate,
    RP_EVENT_LEDGER_PATH,
    saveRpCandidate,
    selectRpCandidate,
    suspendRpEvent,
    validateCandidateBatch,
} from "nbook/server/rp/event-store";
import {
    beginRpBootstrap,
    confirmRpIntakeFromPlayer,
    reviewRpIntake,
    RP_INTAKE_FIELD_KEYS,
    updateRpIntakeField,
} from "nbook/server/rp/intake-store";
import {activateIntake, prepareBootstrapArtifacts} from "nbook/server/rp/test-fixtures";

describe("RP event store", () => {
    let projectRoot: string;

    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-events-"));
        await activateIntake(projectRoot);
        const opening = (await readRpEventState(projectRoot)).events.find((event) => event.origin === "opening" && event.status === "active");
        if (opening) await finishRpEvent(projectRoot, opening.id, "resolved", "测试夹具开场已结束");
    });

    afterEach(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("只接受恰好覆盖四种基调的四卡，并登记为同一批候选", async () => {
        expect(() => validateCandidateBatch(cards().slice(0, 3))).toThrow("恰好为 4 张");
        expect(() => validateCandidateBatch([
            ...cards().slice(0, 3),
            {...cards()[3]!, tone: "calm"},
        ])).toThrow("分别为 calm、exciting、dangerous、unusual");

        const created = await registerCandidateBatch(projectRoot, {trigger: "new_location", proposals: cards()});
        expect(created).toHaveLength(4);
        expect(new Set(created.map((event) => event.batchId)).size).toBe(1);
        expect(created.map((event) => event.tone)).toEqual(["calm", "exciting", "dangerous", "unusual"]);
        expect(created.every((event) => event.status === "available" && event.stage === null)).toBe(true);

        const replacement = await registerCandidateBatch(projectRoot, {trigger: "new_activity", proposals: cards("港口")});
        const state = await readRpEventState(projectRoot);
        expect(replacement).toHaveLength(4);
        expect(state.events.filter((event) => event.origin === "candidate" && event.availability === "unavailable")).toHaveLength(4);
        expect(state.events.filter((event) => event.origin === "candidate" && event.availability === "available")).toHaveLength(4);
    });

    it("支持保留、地点失效、重新校验、选择与服务端随机", async () => {
        const candidates = await registerCandidateBatch(projectRoot, {trigger: "new_location", proposals: cards()});
        const saved = await saveRpCandidate(projectRoot, candidates[0]!.id);
        expect(saved.status).toBe("saved");

        const invalidated = await invalidateRpLocationCandidates(projectRoot, "market");
        expect(invalidated).toHaveLength(4);
        expect(invalidated.find((event) => event.id === saved.id)?.availability).toBe("needs_revalidation");
        expect(invalidated.filter((event) => event.status === "available").every((event) => event.availability === "unavailable")).toBe(true);
        await expect(selectRpCandidate(projectRoot, saved.id)).rejects.toThrow("当前不可选择");

        await revalidateRpCandidate(projectRoot, saved.id, true, "已返回集市");
        await expect(selectRpCandidate(projectRoot, saved.id)).resolves.toMatchObject({status: "selected"});

        const nextBatch = await registerCandidateBatch(projectRoot, {trigger: "player_request", proposals: cards("钟楼")});
        const random = await randomSelectRpCandidate(projectRoot, nextBatch.slice(1, 4).map((event) => event.id));
        expect(nextBatch.slice(1, 4).map((event) => event.id)).toContain(random.id);
        expect(random.status).toBe("selected");
    });

    it("保留候选用互斥键做合理性检查，冲突时说明原因而非静默加入", async () => {
        const proposals = cards().map((proposal, index) => index < 2 ? {...proposal, compatibilityKey: "npc:lin:tonight"} : proposal);
        const candidates = await registerCandidateBatch(projectRoot, {trigger: "player_request", proposals});
        await saveRpCandidate(projectRoot, candidates[0]!.id);
        await expect(saveRpCandidate(projectRoot, candidates[1]!.id)).rejects.toThrow("请修改其中一个设定或放弃保留");
        await expect(discardRpCandidate(projectRoot, candidates[1]!.id)).resolves.toMatchObject({status: "cancelled"});
    });

    it("普通 active 最多三个，硬性日程可临时成为第四焦点", async () => {
        const candidates = await registerCandidateBatch(projectRoot, {trigger: "new_activity", proposals: cards()});
        for (const candidate of candidates.slice(0, 3)) {
            await selectRpCandidate(projectRoot, candidate.id);
            await activateRpEvent(projectRoot, candidate.id);
        }
        await selectRpCandidate(projectRoot, candidates[3]!.id);
        await expect(activateRpEvent(projectRoot, candidates[3]!.id)).rejects.toThrow("最多只能有 3 个普通 active");

        const exam = await registerFormalEvent(projectRoot, {
            origin: "hard_schedule",
            trigger: "plan_due",
            tone: "dangerous",
            title: "期末考试",
            playerSummary: "约定的考试时间已经到来。",
            hard: true,
            hardKind: "schedule",
            dueAt: "第30日 09:00",
        });
        await expect(activateRpEvent(projectRoot, exam.id)).resolves.toMatchObject({status: "active", hard: true});

        const storm = await registerFormalEvent(projectRoot, {
            origin: "hard_schedule",
            trigger: "plan_due",
            tone: "dangerous",
            title: "台风登陆",
            playerSummary: "预报中的台风抵达城市。",
            hard: true,
            hardKind: "weather",
        });
        await expect(activateRpEvent(projectRoot, storm.id)).rejects.toThrow("已存在 4 个 active 焦点");
    });

    it("完整生命周期保留阶段、暂停后台演化与离场终态", async () => {
        const [candidate] = await registerCandidateBatch(projectRoot, {trigger: "new_location", proposals: cards()});
        if (!candidate) throw new Error("fixture 缺少候选");
        await selectRpCandidate(projectRoot, candidate.id);
        await activateRpEvent(projectRoot, candidate.id);
        const suspended = await suspendRpEvent(projectRoot, candidate.id, "玩家离开考场");
        expect(suspended).toMatchObject({status: "suspended", backgroundProgress: true, stage: "entry"});
        const continued = await finishRpEvent(projectRoot, candidate.id, "continued_without_player", "考试在玩家离开后照常结束");
        expect(continued).toMatchObject({status: "continued_without_player", backgroundProgress: false});
        expect(continued.terminalAt).not.toBeNull();
    });

    it("连续五个平淡 committed 回合触发候选生成且重试幂等", async () => {
        for (let tick = 1; tick <= 5; tick += 1) {
            await recordRpEventTick(projectRoot, `turn-${tick}`, false);
        }
        const due = await recordRpEventTick(projectRoot, "turn-5", false);
        expect(due).toMatchObject({calmTickStreak: 5, candidateGenerationDue: true});
        expect(due.recordedTurnIds).toHaveLength(5);

        await registerCandidateBatch(projectRoot, {trigger: "calm_streak", proposals: cards()});
        await expect(readRpEventState(projectRoot)).resolves.toMatchObject({calmTickStreak: 0, candidateGenerationDue: false});
        const ledger = await readFile(join(projectRoot, RP_EVENT_LEDGER_PATH), "utf-8");
        expect(ledger).toContain('"candidateGenerationDue":true');
        expect(ledger).toContain('"operation":"register_candidates"');
    });

    it("开场事件可在 bootstrap 期间直接成为第一个 active 事件", async () => {
        const bootstrapRoot = await mkdtemp(join(tmpdir(), "rp-opening-"));
        try {
            await prepareBootstrap(bootstrapRoot);
            await prepareBootstrapArtifacts(bootstrapRoot, "characters");
            const opening = await registerFormalEvent(bootstrapRoot, {
                origin: "opening",
                trigger: "opening_stable",
                tone: "exciting",
                title: "雨夜来客",
                playerSummary: "门外传来三下急促的敲门声。",
                startActive: true,
            });
            expect(opening).toMatchObject({status: "active", stage: "entry", origin: "opening"});
        } finally {
            await rm(bootstrapRoot, {recursive: true, force: true});
        }
    });
});

function cards(prefix = "集市") {
    return [
        {tone: "calm" as const, title: `${prefix}闲谈`, playerSummary: "摊主似乎知道一些附近的传闻。", locationId: "market"},
        {tone: "exciting" as const, title: `${prefix}追逐`, playerSummary: "一个抱着包裹的人撞开人群奔来。", locationId: "market"},
        {tone: "dangerous" as const, title: `${prefix}骚乱`, playerSummary: "武器出鞘的声音从街角传来。", locationId: "market"},
        {tone: "unusual" as const, title: `${prefix}怪钟`, playerSummary: "停摆多年的钟忽然倒着走了。", locationId: "market"},
    ];
}

async function prepareBootstrap(projectRoot: string): Promise<void> {
    for (const key of RP_INTAKE_FIELD_KEYS) {
        await updateRpIntakeField(projectRoot, key, {status: "confirmed", value: `${key} ready`});
    }
    const reviewing = await reviewRpIntake(projectRoot);
    await confirmRpIntakeFromPlayer(projectRoot, reviewing.version);
    await beginRpBootstrap(projectRoot);
}
