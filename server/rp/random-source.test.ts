import {describe, expect, it} from "vitest";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {rollDice} from "nbook/server/rp/dice-store";
import {randomSelectRpCandidate, registerCandidateBatch} from "nbook/server/rp/event-store";
import {resolveRpRisk} from "nbook/server/rp/mechanics-store";
import {rpRandomInt, withRpTestRandomSeed} from "nbook/server/rp/random-source";
import {activateIntake} from "nbook/server/rp/test-fixtures";

describe("RP 固定测试随机源", () => {
    it("同一种子可复现，且并发作用域互不污染", async () => {
        const draw = (seed: number) => withRpTestRandomSeed(seed, async () => Array.from({length: 8}, () => rpRandomInt(1, 7)));
        const [first, second, other] = await Promise.all([draw(42), draw(42), draw(99)]);
        expect(first).toEqual(second);
        expect(first).not.toEqual(other);
        expect(first.every((value) => value >= 1 && value <= 6)).toBe(true);
    });

    it("不同随机入口共享同一作用域序列", async () => {
        const values = await withRpTestRandomSeed(7, async () => [rpRandomInt(10), rpRandomInt(10), rpRandomInt(10)]);
        expect(values).toEqual(await withRpTestRandomSeed(7, async () => [rpRandomInt(10), rpRandomInt(10), rpRandomInt(10)]));
    });

    it("骰子、候选事件和概率结算均可在测试中整体复现", async () => {
        const firstRoot = await mkdtemp(join(tmpdir(), "rp-random-a-"));
        const secondRoot = await mkdtemp(join(tmpdir(), "rp-random-b-"));
        try {
            await Promise.all([activateIntake(firstRoot), activateIntake(secondRoot)]);
            const run = (projectRoot: string) => withRpTestRandomSeed(20260729, async () => {
                const dice = await rollDice(projectRoot);
                const candidates = await registerCandidateBatch(projectRoot, {trigger: "new_activity", proposals: [
                    {tone: "calm", title: "平静", playerSummary: "平静入口"},
                    {tone: "exciting", title: "刺激", playerSummary: "刺激入口"},
                    {tone: "dangerous", title: "危险", playerSummary: "危险入口"},
                    {tone: "unusual", title: "异常", playerSummary: "异常入口"},
                ]});
                const selected = await randomSelectRpCandidate(projectRoot, candidates.map((event) => event.id));
                const risk = await resolveRpRisk(projectRoot, {
                    operationId: "fixed-risk", subjectId: "avatar", kind: "custom", riskLevel: "high",
                    cycleFactorPpm: 1_000_000, protectionFactorPpm: 1_000_000, private: false, reason: "固定源验收",
                });
                return {dice: [dice.d1, dice.d2], selected: selected.title, risk: risk.rollPpm};
            });
            expect(await run(firstRoot)).toEqual(await run(secondRoot));
        } finally {
            await Promise.all([rm(firstRoot, {recursive: true, force: true}), rm(secondRoot, {recursive: true, force: true})]);
        }
    });
});
