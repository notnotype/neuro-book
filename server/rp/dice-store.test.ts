import {mkdtemp, rm, readFile, appendFile, mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, dirname} from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {listDiceRolls, rollDice, RP_DICE_RELATIVE_PATH} from "nbook/server/rp/dice-store";

describe("rp dice store", () => {
    let projectRoot: string;

    beforeAll(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-dice-"));
    });

    afterAll(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("空项目返回空列表", async () => {
        expect(await listDiceRolls(projectRoot)).toEqual([]);
    });

    it("掷骰:2d6 范围合法,seq 递增,追加持久化", async () => {
        const first = await rollDice(projectRoot);
        const second = await rollDice(projectRoot);
        for (const roll of [first, second]) {
            expect(roll.d1).toBeGreaterThanOrEqual(1);
            expect(roll.d1).toBeLessThanOrEqual(6);
            expect(roll.d2).toBeGreaterThanOrEqual(1);
            expect(roll.d2).toBeLessThanOrEqual(6);
            expect(roll.total).toBe(roll.d1 + roll.d2);
            expect(roll.at).toMatch(/^\d{4}-/);
        }
        expect(first.seq).toBe(1);
        expect(second.seq).toBe(2);

        const rolls = await listDiceRolls(projectRoot);
        expect(rolls).toHaveLength(2);
        expect(rolls[1]).toEqual(second);
        // 文件为 JSONL,每行可独立解析
        const raw = await readFile(join(projectRoot, RP_DICE_RELATIVE_PATH), "utf-8");
        expect(raw.trim().split("\n")).toHaveLength(2);
    });

    it("坏行跳过不阻断,seq 从最后有效行续", async () => {
        const filePath = join(projectRoot, RP_DICE_RELATIVE_PATH);
        await mkdir(dirname(filePath), {recursive: true});
        await appendFile(filePath, "not-json\n", "utf-8");
        const third = await rollDice(projectRoot);
        expect(third.seq).toBe(3);
        expect(await listDiceRolls(projectRoot)).toHaveLength(3);
    });

    it("分布粗检:大量掷骰覆盖全值域且无越界", async () => {
        const seen = new Set<number>();
        for (let index = 0; index < 200; index += 1) {
            const roll = await rollDice(projectRoot);
            seen.add(roll.d1);
            seen.add(roll.d2);
        }
        expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    });
});
