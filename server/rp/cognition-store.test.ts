import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    readRpCharacterCognition,
    readRpPlayerKnowledge,
    registerRpWorldFact,
    setRpOocVisibility,
    settleRpCognitionTurn,
} from "nbook/server/rp/cognition-store";
import {activateIntake} from "nbook/server/rp/test-fixtures";

describe("RP cognition store", () => {
    let projectRoot: string;
    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-cognition-"));
        await activateIntake(projectRoot);
    });
    afterEach(async () => rm(projectRoot, {recursive: true, force: true}));

    it("世界事实、角色信念和玩家 OOC 认知三层分离", async () => {
        await registerRpWorldFact(projectRoot, {id: "fact:hidden-door", statement: "书架后有暗门", importance: "important", tick: 1, source: "世界状态"});
        expect(await readRpPlayerKnowledge(projectRoot)).toEqual([]);
        expect(await readRpCharacterCognition(projectRoot, "player")).toEqual([]);

        await setRpOocVisibility(projectRoot, "fact:hidden-door", true, "玩家主动解除隐藏");
        expect((await readRpPlayerKnowledge(projectRoot))[0]).toMatchObject({fact: {id: "fact:hidden-door"}, visibility: "user_revealed"});
        expect(await readRpCharacterCognition(projectRoot, "player")).toEqual([]);

        await settleRpCognitionTurn(projectRoot, "turn-1", [{
            op: "learn", characterId: "player", factId: "fact:hidden-door", belief: "believes", content: "书架似乎能移动", source: "亲眼观察", tick: 2, channel: "observed",
        }]);
        expect((await readRpCharacterCognition(projectRoot, "player"))[0]).toMatchObject({belief: "believes", channel: "observed"});
    });

    it("传闻按明确相关性惰性传播，内容保持不确定", async () => {
        await registerRpWorldFact(projectRoot, {id: "fact:treasure", statement: "宝物在北塔", importance: "secret", tick: 1, source: "世界真相"});
        await settleRpCognitionTurn(projectRoot, "turn-rumor", [{
            op: "rumor", fromCharacterId: "merchant", toCharacterId: "lin", factId: "fact:treasure", content: "听说北塔藏着宝贝", tick: 3, relevanceReason: "林正在收集北塔传闻",
        }]);
        expect((await readRpCharacterCognition(projectRoot, "lin"))[0]).toMatchObject({belief: "uncertain", channel: "rumor"});
    });

    it("同 turnId 重试不重复创建认知", async () => {
        await registerRpWorldFact(projectRoot, {id: "fact:rain", statement: "正在下雨", importance: "normal", tick: 1, source: "天气"});
        const changes = [{op: "learn" as const, characterId: "lin", factId: "fact:rain", belief: "believes" as const, content: "外面在下雨", source: "看见雨水", tick: 1, channel: "observed" as const}];
        await settleRpCognitionTurn(projectRoot, "turn-rain", changes);
        await settleRpCognitionTurn(projectRoot, "turn-rain", changes);
        expect(await readRpCharacterCognition(projectRoot, "lin")).toHaveLength(1);
    });
});
