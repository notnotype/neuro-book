import fs from "node:fs/promises";
import path from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {WorldEngineFacade} from "nbook/server/world-engine/world-engine.facade";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {
    addKnowledge,
    addUnknown,
    commitTickMemory,
    ensureRpCharacter,
    listUnknown,
    readActorView,
    readCharacterRegistry,
    readGodView,
    readSummary,
    resolveCharacterId,
    revealUnknown,
    rollupMidToFar,
    rollupRecentToMid,
    setTruthNote,
} from "nbook/server/rp/character-store";
import {listDiceRolls, rollDice} from "nbook/server/rp/dice-store";
import {listTickProse, listTicks} from "nbook/server/rp/prose-store";
import {
    beginRpBootstrap,
    completeRpBootstrap,
    completeRpBootstrapStage,
    confirmRpIntakeFromPlayer,
    reviewRpIntake,
    RP_INTAKE_FIELD_KEYS,
    updateRpIntakeField,
} from "nbook/server/rp/intake-store";

/**
 * RP v2 多 Tick 剧本回归（数据面，不经过 LLM）：以内置奇幻故事「勇者召唤」为剧本，
 * 由测试代演六角色跨 3 个 Tick 的全部数据面操作。在 rp-tick-flow（单 Tick 闭环）之上
 * 额外覆盖 2026-07-27 实测复盘修复的全部机制：
 * - 角色 id 注册表：显示名/别名解析、重名建档拒绝、未登记即错；
 * - rp_tick_info 权威 Tick 总账：nextTick 推进与 prose/report 缺失可见；
 * - 真实掷骰（crypto RNG + rolls.jsonl seq 校验）；
 * - pending 未来切片的到期兑现（删占位 + 落实主切片）；
 * - 记忆三级摘要滚动（近期→中期→远期）；
 * - 轻量通道 Tick（只有正文与记忆，无世界写回）。
 */
describe("rp v2 multi-tick scenario (勇者召唤)", {timeout: 120_000}, () => {
    const slug = `rp-scenario-test-${Date.now()}`;
    const projectPath = `workspace/${slug}`;
    let projectRoot: string;
    let facade: WorldEngineFacade;

    beforeAll(async () => {
        projectRoot = path.join(resolveRuntimeWorkspaceRoot(), slug);
        await fs.mkdir(path.join(projectRoot, "rp", "world-engine", "schema"), {recursive: true});
        await fs.writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: 勇者召唤（RP 剧本回归）\nsummary: ''\n", "utf-8");
        await fs.writeFile(path.join(projectRoot, "rp", "world-engine", "schema", "index.ts"), SCHEMA_SOURCE, "utf-8");
        await fs.writeFile(path.join(projectRoot, "rp", "world-engine", "calendar.ts"), CALENDAR_SOURCE, "utf-8");
        await openProjectForTest(projectPath);
        facade = new WorldEngineFacade(resolveRuntimeWorkspaceRoot());
    }, 60_000);

    afterAll(async () => {
        await closeProjectForTest(projectPath).catch(() => undefined);
        await facade.closeProject(projectPath);
        await fs.rm(projectRoot, {recursive: true, force: true});
    }, 60_000);

    it("bootstrap → Tick 1(轻量) → Tick 2(掷骰+pending) → Tick 3(兑现+揭示+滚动)", async () => {
        // ══════════ Bootstrap（开团引导产物之后的技术初始化） ══════════
        for (const key of RP_INTAKE_FIELD_KEYS) await updateRpIntakeField(projectRoot, key, {status: "confirmed", value: `${key} ready`});
        const reviewing = await reviewRpIntake(projectRoot);
        await confirmRpIntakeFromPlayer(projectRoot, reviewing.version);
        await beginRpBootstrap(projectRoot);
        for (const stage of ["config", "world", "map", "characters", "opening_event", "narrative"] as const) await completeRpBootstrapStage(projectRoot, stage);
        await completeRpBootstrap(projectRoot);

        // 角色建档：注册表要求显示名 + 别名
        await ensureRpCharacter(projectRoot, "veiluosi", {name: "薇洛丝", aliases: ["白发女孩"], soul: "# 我是薇洛丝\n\n地球转生者,冷静观察,尚未觉醒可见能力。\n"});
        await ensureRpCharacter(projectRoot, "brauer", {name: "布劳尔", aliases: ["子爵"], soul: "# 我是布劳尔子爵\n\n召唤仪式的主持者,外表虔诚,内里焦虑。\n"});
        await ensureRpCharacter(projectRoot, "glasses-girl", {name: "眼镜女生", soul: "# 我是眼镜女生\n\n胆小但心细的高中生。\n"});

        // 注册表闸门：同一角色换拼法重复建档 → 拒绝并指回已有 id（实测 brauer/bulaoer 双档的根因防线）
        await expect(ensureRpCharacter(projectRoot, "bulaoer", {name: "布劳尔"})).rejects.toThrow(/id=brauer/);
        // 显示名与别名都能解析到目录 id；未登记名报错并附对照表
        expect(await resolveCharacterId(projectRoot, "薇洛丝")).toBe("veiluosi");
        expect(await resolveCharacterId(projectRoot, "子爵")).toBe("brauer");
        await expect(resolveCharacterId(projectRoot, "月涟")).rejects.toThrow(/已登记角色/);
        expect((await readCharacterRegistry(projectRoot)).map((entry) => entry.id).sort()).toEqual(["brauer", "glasses-girl", "veiluosi"]);

        // rp.world 初始化：世界/地点/角色首切片（复兴纪元 488 年,仪式大厅）
        const init = await facade.writeSlice(projectPath, {
            instant: 0n,
            title: "Tick 000 initial-state",
            summary: "位面交汇之日,勇者召唤仪式完成",
            patches: [
                {subjectId: "world", type: "world", name: "世界", path: "/era", op: "replace", value: "复兴纪元488年"},
                {subjectId: "veiluosi", type: "character", name: "薇洛丝", path: "/hp", op: "replace", value: 100},
                {subjectId: "veiluosi", path: "/位置", op: "replace", value: "subject://ritual-hall"},
                {subjectId: "veiluosi", path: "/secret", op: "replace", value: {隐藏体质: "召唤失败的例外体"}},
                {subjectId: "brauer", type: "character", name: "布劳尔子爵", path: "/hp", op: "replace", value: 60},
                {subjectId: "brauer", path: "/位置", op: "replace", value: "subject://ritual-hall"},
                {subjectId: "brauer", path: "/secret", op: "replace", value: {真实动机: "领地财政危机下的孤注一掷"}},
                {subjectId: "ritual-hall", type: "location", name: "仪式大厅", path: "/连接", op: "append", value: {目标: "subject://corridor", 方向: "西", 距离: "近"}},
                {subjectId: "corridor", type: "location", name: "回廊", path: "/连接", op: "append", value: {目标: "subject://ritual-hall", 方向: "东", 距离: "近"}},
            ],
        }, "rp");
        expect(init.issues).toEqual([]);

        // 开场白正文（rp.writer 产物）：Tick 总账应识别 000000
        await writeProse(0, "initial-state", "# 序幕：仪式大厅\n\n金色的光幕散去,你站在巨大的召唤法阵中央。\n");
        expect(await listTicks(projectRoot)).toMatchObject({maxTick: 0, nextTick: 1});

        // god-view 账本：screenwriter 给薇洛丝登记「她不知道的事」+ 假信念批注
        // （store 层只认注册表 id;显示名/别名解析发生在工具层,这里模拟工具层先 resolve）
        const veiluosi = await resolveCharacterId(projectRoot, "薇洛丝");
        await addUnknown(projectRoot, veiluosi, {topic: "召唤的真相", content: "召唤实为领地财政绝望下的孤注一掷", occurredTick: 0, revealHint: "管家酒后失言"});
        const belief = await addKnowledge(projectRoot, await resolveCharacterId(projectRoot, "白发女孩"), {topic: "子爵的动机", content: "子爵是虔诚的预言信徒", source: "当众观察", tick: 0});
        await setTruthNote(projectRoot, "veiluosi", {knowledgeId: belief.id, truth: "false", note: "实际动机是财政危机"});

        // ══════════ Tick 1：轻量通道（纯对话,无世界影响） ══════════
        // leader 用 rp_tick_info 宣告：本 Tick = 1
        const tick1 = (await listTicks(projectRoot)).nextTick;
        expect(tick1).toBe(1);

        // screenwriter 判定「世界影响: 无」→ 跳过 P3/P4,不写世界切片,只有正文与记忆
        await writeProse(tick1, "approach-glasses-girl", "# 搭话\n\n你走向抱着帆布包的眼镜女生,轻声问:有没有事?\n");
        await commitTickMemory(projectRoot, veiluosi, {
            tick: tick1,
            time: "复兴纪元488年1日 08:02",
            participants: ["veiluosi", "glasses-girl"],
            detail: "我主动走向眼镜女生搭话。她很紧张,但没有拒绝我。",
            summaryLine: "与眼镜女生搭话建立初步信任",
            mood: "# 心境\n\n找到了一个同样'什么都没有'的人,稍微安心。\n",
        });
        await commitTickMemory(projectRoot, "glasses-girl", {
            tick: tick1,
            detail: "白发女孩主动过来跟我说话。她身上什么能力都没有,却很冷静。",
            summaryLine: "被薇洛丝搭话,紧张但感到一丝安全",
        });
        // 轻量通道断言：世界切片数不变（仍只有初始切片）
        expect(await facade.listSlices(projectPath, {}, "rp")).toHaveLength(1);

        // ══════════ Tick 2：掷骰判定 + pending 未来切片 ══════════
        const tick2 = (await listTicks(projectRoot)).nextTick;
        expect(tick2).toBe(2);

        // screenwriter 事前判定：溜到回廊偷听,普通难度 2d6≥7,待掷骰 → leader 记下当前 seq 并暂停
        const seqBefore = (await listDiceRolls(projectRoot)).at(-1)?.seq ?? 0;
        // 用户点击前端骰子按钮（服务端 crypto RNG 落盘）
        const roll = await rollDice(projectRoot);
        expect(roll.seq).toBe(seqBefore + 1);
        expect(roll.total).toBe(roll.d1 + roll.d2);
        expect(roll.d1).toBeGreaterThanOrEqual(1);
        expect(roll.d1).toBeLessThanOrEqual(6);
        // leader 校验：文件是唯一真相源,seq 必须大于暂停前记下的值
        const latest = (await listDiceRolls(projectRoot)).at(-1)!;
        expect(latest.seq).toBeGreaterThan(seqBefore);
        const outcome = latest.total >= 7 ? "成功" : latest.total >= 5 ? "部分成功" : "失败";

        // 终裁报告 + 写回：掷骰记录进切片 summary 尾部；pending 未来切片（女仆 2 分钟后到达）
        await fs.mkdir(tickDirPath(tick2, "sneak-corridor"), {recursive: true});
        await fs.writeFile(path.join(tickDirPath(tick2, "sneak-corridor"), "report.md"), `## Tick 00${tick2} 终裁\n\n[掷骰#${latest.seq}] 行动=溜到回廊偷听, 目标=≥7, 骰=${latest.d1}+${latest.d2}=${latest.total}, 结果=${outcome}\n`, "utf-8");
        await writeProse(tick2, "sneak-corridor", "# 回廊\n\n你贴着廊柱屏住呼吸——大厅里的对峙掩护了你的脚步。\n");
        const writeBack = await facade.writeSlice(projectPath, {
            instant: 120n,
            title: `Tick 00${tick2} sneak-corridor`,
            summary: `薇洛丝溜到回廊。[掷骰#${latest.seq}] 行动=溜到回廊偷听, 目标=≥7, 骰=${latest.d1}+${latest.d2}=${latest.total}, 结果=${outcome}`,
            patches: [
                {subjectId: "veiluosi", path: "/位置", op: "replace", value: "subject://corridor"},
                {subjectId: "veiluosi", path: "/关系", op: "append", value: {对象: "subject://glasses-girl", 类型: "初步信任", 好感: 30}},
            ],
        }, "rp");
        expect(writeBack.issues).toEqual([]);
        const pending = await facade.writeSlice(projectPath, {
            instant: 240n,
            title: "女仆莉丝端茶到达大厅侧门",
            kind: "pending",
            patches: [{subjectId: "world", path: "/era", op: "replace", value: "复兴纪元488年"}],
        }, "rp");
        expect(pending.issues).toEqual([]);
        await commitTickMemory(projectRoot, "veiluosi", {
            tick: tick2,
            detail: "我溜到回廊,听到子爵和管家压低声音争执钱的事。",
            summaryLine: "溜到回廊偷听,得知领地缺钱的线索",
        });

        // ══════════ Tick 3：pending 到期兑现 + 揭示 + 摘要滚动 ══════════
        const tick3 = (await listTicks(projectRoot)).nextTick;
        expect(tick3).toBe(3);

        // P1 状态分发：列出已到期 pending（当前时刻 300 ≥ 240）
        const duePending = (await facade.listSlices(projectPath, {to: 300n}, "rp")).filter((slice) => slice.kind === "pending");
        expect(duePending.map((slice) => slice.title)).toEqual(["女仆莉丝端茶到达大厅侧门"]);
        // 兑现：删除占位,在本 Tick 主切片中落实
        await facade.deleteSlice(projectPath, duePending[0]!.id, "rp");
        const settle = await facade.writeSlice(projectPath, {
            instant: 300n,
            title: `Tick 00${tick3} maid-arrives`,
            summary: "女仆莉丝端茶进入大厅,打断了对峙;薇洛丝借机回到人群",
            patches: [
                {subjectId: "veiluosi", path: "/位置", op: "replace", value: "subject://ritual-hall"},
            ],
        }, "rp");
        expect(settle.issues).toEqual([]);
        expect((await facade.listSlices(projectPath, {}, "rp")).filter((slice) => slice.kind === "pending")).toHaveLength(0);

        // 揭示：U 条目转入已知信息（按角色实际听到的版本改写）
        const unknownEntries = await listUnknown(projectRoot, "veiluosi");
        await revealUnknown(projectRoot, "veiluosi", unknownEntries[0]!.id, {source: "回廊偷听", tick: tick3, contentOverride: "领地好像快没钱了,召唤和钱有关"});
        await writeProse(tick3, "maid-arrives", "# 茶香\n\n侧门吱呀一声,端着托盘的女仆让所有人的视线短暂偏移。\n");
        await commitTickMemory(projectRoot, "veiluosi", {
            tick: tick3,
            detail: "女仆进来打断了对峙,我趁乱回到人群。刚才听到的话在心里发酵。",
            summaryLine: "借女仆到场回到人群,消化偷听到的秘密",
        });

        // 摘要滚动：近期(1-3)→中期,再中期→远期（压缩概括由 agent 生成,这里由测试代演）
        await rollupRecentToMid(projectRoot, "veiluosi", {fromTick: 1, toTick: tick3, mergedLine: "召唤当日:与眼镜女生结识,偷听得知领地财政危机"});
        const afterMid = await readSummary(projectRoot, "veiluosi");
        expect(afterMid.recent).toHaveLength(0);
        expect(afterMid.mid).toHaveLength(1);
        await rollupMidToFar(projectRoot, "veiluosi", {count: 1, mergedParagraph: "被召唤的第一天,薇洛丝在仪式大厅结识同伴并察觉了子爵的秘密。"});
        const afterFar = await readSummary(projectRoot, "veiluosi");
        expect(afterFar.mid).toHaveLength(0);
        expect(afterFar.far.join("")).toContain("第一天");

        // ══════════ 终局断言 ══════════
        // Tick 总账：4 个 Tick,000001 无 report(轻量通道)可被识别,nextTick=4
        const ledger = await listTicks(projectRoot);
        expect(ledger.nextTick).toBe(4);
        expect(ledger.ticks.map((tick) => [tick.tick, tick.hasProse, tick.hasReport])).toEqual([
            [0, true, false],
            [1, true, false],
            [2, true, true],
            [3, true, false],
        ]);
        // 正文面板聚合：按 Tick 升序四段正文
        const prose = await listTickProse(projectRoot);
        expect(prose.map((item) => item.tick)).toEqual([0, 1, 2, 3]);
        expect(prose[0]!.title).toBe("序幕：仪式大厅");
        // 世界线隔离：main 无配置直接报错,绝不回退
        await expect(facade.listSlices(projectPath)).rejects.toThrow();
        // 视图隔离：actor 视图永不含 god 内容;god 视图账本已清空、批注仍在
        const actorView = await readActorView(projectRoot, "veiluosi");
        expect(JSON.stringify(actorView)).not.toContain("孤注一掷");
        expect(JSON.stringify(actorView)).not.toContain("truthNotes");
        expect(actorView.knowledge.map((entry) => entry.topic)).toContain("召唤的真相");
        const godView = await readGodView(projectRoot, "veiluosi");
        expect(godView.unknown).toHaveLength(0);
        expect(godView.truthNotes.find((note) => note.truth === "false")).toBeDefined();
        // 掷骰唯一真相源：rolls.jsonl 只有用户亲掷的一条
        expect(await listDiceRolls(projectRoot)).toHaveLength(1);
    });

    function tickDirPath(tick: number, slugName: string): string {
        return path.join(projectRoot, "rp", "ticks", `${String(tick).padStart(6, "0")}-${slugName}`);
    }

    async function writeProse(tick: number, slugName: string, content: string): Promise<void> {
        const dir = tickDirPath(tick, slugName);
        await fs.mkdir(dir, {recursive: true});
        await fs.writeFile(path.join(dir, "prose.md"), content, "utf-8");
    }
});

const SCHEMA_SOURCE = [
    'import {z} from "zod";',
    "",
    "function Ref(targetType: string) {",
    "    return z.string().regex(/^subject:\\/\\/[\\w-]+$/).describe(`ref:${targetType}`);",
    "}",
    "export const WorldSchema = {",
    "    world: z.object({",
    "        era: z.string().default('复兴纪元488年').describe('纪元'),",
    "    }),",
    "    character: z.object({",
    "        hp: z.number().int().default(100).describe('生命值'),",
    "        位置: Ref('location').optional().describe('当前位置'),",
    "        关系: z.array(z.object({对象: Ref('character'), 类型: z.string(), 好感: z.number().optional()})).default([]).describe('人际关系'),",
    "        secret: z.record(z.string(), z.string()).optional().describe('god-view 隐藏状态(键值均为字符串)'),",
    "    }),",
    "    location: z.object({",
    "        连接: z.array(z.object({目标: Ref('location'), 方向: z.string().optional(), 距离: z.string().optional()})).default([]).describe('通路'),",
    "    }),",
    "} as const;",
    "",
].join("\n");

const CALENDAR_SOURCE = [
    "export default {",
    "  type: 'simple',",
    "  eraBefore: '复兴纪元',",
    "  eraAfter: '复兴纪元',",
    "  baseUnit: 'second',",
    "  units: [",
    "    {name: 'minute', parent: 'second', ratio: 60},",
    "    {name: 'hour', parent: 'minute', ratio: 60},",
    "    {name: 'day', parent: 'hour', ratio: 24},",
    "  ],",
    "  format: '{eraName}{day}日 {hour:02}:{minute:02}:{second:02}',",
    "};",
    "",
].join("\n");
