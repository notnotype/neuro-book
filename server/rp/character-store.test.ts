import {mkdtemp, readFile, rm, access} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {
    addKnowledge,
    addUnknown,
    commitTickMemory,
    ensureRpCharacter,
    listKnowledge,
    listRpCharacters,
    listTruthNotes,
    listUnknown,
    readActorView,
    readGodView,
    readMood,
    readSummary,
    readTickMemory,
    revealUnknown,
    rollupMidToFar,
    rollupRecentToMid,
    rpCharacterRoot,
    safeCharacterId,
    setTruthNote,
    summaryRollupNeeded,
    tickFileName,
    updateKnowledge,
} from "nbook/server/rp/character-store";

describe("rp character store", () => {
    let projectRoot: string;
    const id = "erina";

    beforeAll(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), "rp-character-store-"));
        await ensureRpCharacter(projectRoot, id, {soul: "# 我是艾琳娜\n"});
    });

    afterAll(async () => {
        await rm(projectRoot, {recursive: true, force: true});
    });

    it("初始化骨架幂等且不覆盖已有内容", async () => {
        await ensureRpCharacter(projectRoot, id, {soul: "# 被覆盖?"});
        expect(await readFile(join(rpCharacterRoot(projectRoot, id), "人设/soul.md"), "utf-8")).toBe("# 我是艾琳娜\n");
        expect(await listRpCharacters(projectRoot)).toEqual(["erina"]);
        await expect(access(join(rpCharacterRoot(projectRoot, id), "events.jsonl"))).resolves.toBeUndefined();
    });

    it("角色 id 安全校验", () => {
        expect(safeCharacterId("薇洛丝")).toBe("薇洛丝");
        expect(() => safeCharacterId("../escape")).toThrow();
        expect(() => safeCharacterId("a/b")).toThrow();
        expect(() => safeCharacterId(" ")).toThrow();
    });

    it("已知信息:新增/更新,id 递增,updatedTick 跟随", async () => {
        const first = await addKnowledge(projectRoot, id, {topic: "钥匙的位置", content: "钥匙在管家抽屉", source: "管家告知", tick: 3});
        const second = await addKnowledge(projectRoot, id, {topic: "子爵的处境", content: "领地缺钱", source: "偷听", tick: 5});
        expect(first.id).toBe("K001");
        expect(second.id).toBe("K002");

        await updateKnowledge(projectRoot, id, "K001", {content: "钥匙被移到了书房", source: "亲眼所见", tick: 9});
        const entries = await listKnowledge(projectRoot, id);
        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatchObject({id: "K001", content: "钥匙被移到了书房", learnedTick: 3, updatedTick: 9});
    });

    it("未知信息账本:登记与揭示转移", async () => {
        const unknown = await addUnknown(projectRoot, id, {topic: "挚友的行踪", content: "挚友已离开城镇前往北方", occurredTick: 5, revealHint: "旅店老板闲聊"});
        expect(unknown.id).toBe("U001");
        expect((await listUnknown(projectRoot, id))).toHaveLength(1);

        const revealed = await revealUnknown(projectRoot, id, "U001", {source: "旅店老板说的", tick: 12, contentOverride: "听说挚友往北边去了(不确定)"});
        expect(revealed.id).toBe("K003");
        expect(revealed.content).toBe("听说挚友往北边去了(不确定)");
        expect(revealed.learnedTick).toBe(12);
        expect(await listUnknown(projectRoot, id)).toHaveLength(0);
    });

    it("属实批注(god-view):设置与更新", async () => {
        await setTruthNote(projectRoot, id, {knowledgeId: "K002", truth: "false", note: "领地缺钱是幌子,子爵在藏宝"});
        await setTruthNote(projectRoot, id, {knowledgeId: "K002", truth: "unverified", note: "尚待确认"});
        const notes = await listTruthNotes(projectRoot, id);
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({knowledgeId: "K002", truth: "unverified", note: "尚待确认"});
    });

    it("记忆提交:详情文件 + 摘要近期行 + 心境;同 tick 重复提交幂等", async () => {
        await commitTickMemory(projectRoot, id, {
            tick: 1,
            time: "公元1年1月1日 08:00",
            participants: ["erina", "viscount"],
            detail: "我在大厅醒来,子爵向我们说明了召唤的缘由。",
            summaryLine: "在大厅醒来,听子爵说明召唤缘由",
            mood: "# 心境\n\n警惕,但压住了慌乱。\n",
        });
        await commitTickMemory(projectRoot, id, {tick: 2, detail: "我走向了眼镜女生。", summaryLine: "主动接近眼镜女生"});
        // 同 tick 重复提交:覆盖
        await commitTickMemory(projectRoot, id, {tick: 2, detail: "我走向眼镜女生并轻声搭话。", summaryLine: "接近眼镜女生并搭话"});

        const detail = await readTickMemory(projectRoot, id, 2);
        expect(detail).toContain("轻声搭话");
        expect(await readTickMemory(projectRoot, id, 99)).toBeNull();
        expect(tickFileName(2)).toBe("Tick000002.md");

        const summary = await readSummary(projectRoot, id);
        expect(summary.recent).toEqual([
            {tick: 1, line: "在大厅醒来,听子爵说明召唤缘由"},
            {tick: 2, line: "接近眼镜女生并搭话"},
        ]);
        expect(await readMood(projectRoot, id)).toContain("警惕");
    });

    it("摘要滚动:近期→中期→远期,内容由调用方提供", async () => {
        for (let tick = 3; tick <= 12; tick += 1) {
            await commitTickMemory(projectRoot, id, {tick, detail: `Tick ${tick} 详情`, summaryLine: `第 ${tick} 轮经历`});
        }
        expect((await summaryRollupNeeded(projectRoot, id, 10)).needed).toBe(true);

        await rollupRecentToMid(projectRoot, id, {fromTick: 1, toTick: 6, mergedLine: "被召唤后的最初周旋"});
        let summary = await readSummary(projectRoot, id);
        expect(summary.recent[0]?.tick).toBe(7);
        expect(summary.mid).toEqual(["- [Tick 001-006] 被召唤后的最初周旋"]);

        await rollupRecentToMid(projectRoot, id, {fromTick: 7, toTick: 9, mergedLine: "与同伴建立初步信任"});
        await rollupMidToFar(projectRoot, id, {count: 2, mergedParagraph: "Tick 1-9:被召唤到异界,从戒备到与同伴建立初步信任。"});
        summary = await readSummary(projectRoot, id);
        expect(summary.mid).toEqual([]);
        expect(summary.far).toEqual(["Tick 1-9:被召唤到异界,从戒备到与同伴建立初步信任。"]);
        expect(summary.recent.map((item) => item.tick)).toEqual([10, 11, 12]);

        // 压缩空区间报错
        await expect(rollupRecentToMid(projectRoot, id, {fromTick: 1, toTick: 6, mergedLine: "x"})).rejects.toThrow();
        await expect(rollupMidToFar(projectRoot, id, {count: 1, mergedParagraph: "x"})).rejects.toThrow();
    });

    it("视图隔离:actor 视图无 god-view 内容,god 视图齐全", async () => {
        await addUnknown(projectRoot, id, {topic: "法师的注视", content: "法师怀疑她是特殊召唤体", occurredTick: 2});
        const actorView = await readActorView(projectRoot, id);
        const godView = await readGodView(projectRoot, id);

        expect(actorView).not.toHaveProperty("unknown");
        expect(actorView).not.toHaveProperty("truthNotes");
        expect(JSON.stringify(actorView)).not.toContain("特殊召唤体");
        expect(actorView.knowledge.length).toBeGreaterThan(0);
        expect(actorView.soul).toContain("艾琳娜");

        expect(godView.unknown.map((item) => item.topic)).toContain("法师的注视");
        expect(godView.truthNotes).toHaveLength(1);
    });

    it("markdown 往返稳定:解析→渲染→再解析一致", async () => {
        const before = await listKnowledge(projectRoot, id);
        // 触发一次无实质变化的写(update 同内容)
        await updateKnowledge(projectRoot, id, before[0]!.id, {tick: before[0]!.updatedTick});
        const after = await listKnowledge(projectRoot, id);
        expect(after).toEqual(before);
    });
});
