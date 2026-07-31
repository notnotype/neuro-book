import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {readRpCharacterRelations, settleRpRelationsTurn} from "nbook/server/rp/relation-store";
import {activateIntake} from "nbook/server/rp/test-fixtures";

describe("RP relation store", () => {
    let projectRoot: string;
    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-relations-"));
        await activateIntake(projectRoot);
    });
    afterEach(async () => rm(projectRoot, {recursive: true, force: true}));

    it("八维关系严格有向，标签独立于数值并记录原因", async () => {
        await settleRpRelationsTurn(projectRoot, "turn-1", [{
            tick: 1, sourceId: "lin", targetId: "player", deltas: {familiarity: 10, trust: 4, hostility: 2},
            addTags: ["竞争者"], basis: "interaction", reason: "共同完成调查，但目标仍有冲突",
        }]);
        const player = await readRpCharacterRelations(projectRoot, "player");
        const lin = await readRpCharacterRelations(projectRoot, "lin");
        expect(lin.outgoing[0]).toMatchObject({targetId: "player", dimensions: {familiarity: 10, trust: 4, hostility: 2}, tags: ["竞争者"]});
        expect(player.outgoing).toEqual([]);
        expect(player.incoming).toHaveLength(1);
    });

    it("骰子不得直接改变关系，系统不得替化身决定信任情感和吸引", async () => {
        await expect(settleRpRelationsTurn(projectRoot, "turn-dice", [{
            tick: 1, sourceId: "lin", targetId: "player", deltas: {trust: 20}, basis: "dice", reason: "交涉成功",
        }])).rejects.toThrow("骰子只能影响是否愿意交流");
        await expect(settleRpRelationsTurn(projectRoot, "turn-avatar", [{
            tick: 1, sourceId: "player", targetId: "lin", deltas: {attraction: 10}, basis: "interaction", reason: "系统推断",
            sourceIsAvatar: true,
        }])).rejects.toThrow("系统不能替玩家决定化身");
        await expect(settleRpRelationsTurn(projectRoot, "turn-declared", [{
            tick: 1, sourceId: "player", targetId: "lin", deltas: {attraction: 10}, basis: "player_declaration", reason: "玩家明确表示被吸引",
            sourceIsAvatar: true, playerDeclared: true,
        }])).resolves.toMatchObject({settledTurnIds: ["turn-declared"]});
    });

    it("同 turnId 重试不重复叠加", async () => {
        const change = [{tick: 2, sourceId: "lin", targetId: "player", deltas: {respect: 8}, basis: "interaction" as const, reason: "兑现承诺"}];
        await settleRpRelationsTurn(projectRoot, "turn-2", change);
        await settleRpRelationsTurn(projectRoot, "turn-2", change);
        expect((await readRpCharacterRelations(projectRoot, "lin")).outgoing[0]?.dimensions.respect).toBe(8);
    });
});
