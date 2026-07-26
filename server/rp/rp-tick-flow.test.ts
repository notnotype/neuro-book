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
    readGodView,
    readSummary,
    revealUnknown,
    setTruthNote,
} from "nbook/server/rp/character-store";

/**
 * RP v2 Tick 流水线结构级端到端测试：不经过 LLM，按协议手动执行六角色在一个
 * 完整 Tick 中的全部数据面操作，验证 世界线隔离 / secret / 记忆 / 账本 / 落盘 闭环。
 * 对应 docs/tasks/100-rp-mode-v2 P5 的「端到端实测（数据面）」。
 */
describe("rp v2 tick flow (data plane)", {timeout: 60_000}, () => {
    const slug = `rp-flow-test-${Date.now()}`;
    const projectPath = `workspace/${slug}`;
    let projectRoot: string;
    let facade: WorldEngineFacade;

    beforeAll(async () => {
        projectRoot = path.join(resolveRuntimeWorkspaceRoot(), slug);
        await fs.mkdir(path.join(projectRoot, "world-engine", "schema"), {recursive: true});
        await fs.writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: RP Flow Test\nsummary: ''\n", "utf-8");
        await fs.writeFile(path.join(projectRoot, "world-engine", "schema", "index.ts"), SCHEMA_SOURCE, "utf-8");
        await fs.writeFile(path.join(projectRoot, "world-engine", "calendar.ts"), CALENDAR_SOURCE, "utf-8");
        await openProjectForTest(projectPath);
        facade = new WorldEngineFacade(resolveRuntimeWorkspaceRoot());
    }, 60_000);

    afterAll(async () => {
        await closeProjectForTest(projectPath).catch(() => undefined);
        await facade.closeProject(projectPath);
        await fs.rm(projectRoot, {recursive: true, force: true});
    }, 60_000);

    it("bootstrap → Tick 001 全流程", async () => {
        // ===== Bootstrap（rp.world 初始化 + 角色建档） =====
        const init = await facade.writeSlice(projectPath, {
            instant: 0n,
            title: "Tick 000 initial-state",
            summary: "被召唤到仪式大厅",
            patches: [
                {subjectId: "erina", type: "character", name: "艾琳娜", path: "/hp", op: "replace", value: 100},
                {subjectId: "erina", path: "/位置", op: "replace", value: "subject://ritual-hall"},
                {subjectId: "erina", path: "/关系", op: "append", value: {对象: "subject://viscount", 类型: "警惕", 好感: 20}},
                {subjectId: "erina", path: "/secret", op: "replace", value: {隐藏体质: "召唤失败的例外体"}},
                {subjectId: "ritual-hall", type: "location", name: "仪式大厅", path: "/连接", op: "append", value: {目标: "subject://corridor", 方向: "西", 距离: "近"}},
                {subjectId: "corridor", type: "location", name: "回廊", path: "/连接", op: "append", value: {目标: "subject://ritual-hall", 方向: "东", 距离: "近"}},
                {subjectId: "viscount", type: "character", name: "子爵", path: "/hp", op: "replace", value: 60},
            ],
        }, "rp");
        expect(init.issues).toEqual([]);

        await ensureRpCharacter(projectRoot, "erina", {soul: "# 我是艾琳娜\n\n白发少女,谨慎、观察力强。\n"});
        await addKnowledge(projectRoot, "erina", {topic: "召唤的说法", content: "子爵说我们是被预言召唤的勇者", source: "子爵当众宣布", tick: 0});
        // screenwriter：god-view 账本 + 假话批注
        await addUnknown(projectRoot, "erina", {topic: "召唤的真相", content: "召唤实为领地财政绝望下的孤注一掷", occurredTick: 0, revealHint: "管家酒后失言"});
        const belief = await addKnowledge(projectRoot, "erina", {topic: "子爵的动机", content: "子爵是虔诚的预言信徒", source: "观察推断", tick: 0});
        await setTruthNote(projectRoot, "erina", {knowledgeId: belief.id, truth: "false", note: "实际动机是财政危机"});

        // ===== Tick 001 =====
        // P1 rp.world 状态分发：reduce 当前状态,校验 secret 存在但由分发层剥除
        const state = await facade.queryState(projectPath, {subjectIds: ["erina"], attrs: ["hp", "位置", "secret"]}, "rp");
        expect(state.subjects[0]?.attrs.hp).toBe(100);
        expect(state.subjects[0]?.attrs.secret).toBeDefined();
        const distributed = {...state.subjects[0]!.attrs};
        delete distributed.secret;
        expect(JSON.stringify(distributed)).not.toContain("例外体");

        // P2 screenwriter 事前判断：掷骰记录（结构化,写入切片 summary 尾部）
        const dice = {行动: "溜到回廊偷听", 难度依据: "卫兵注意力在对峙上", 概率: 65, 掷骰: 41, 结果: "成功"};

        // P3 actor 视角回忆（actor view 永不含 god-view）
        const actorView = await readActorView(projectRoot, "erina");
        expect(JSON.stringify(actorView)).not.toContain("财政");
        expect(JSON.stringify(actorView)).not.toContain("孤注一掷");
        expect(actorView.knowledge.map((entry) => entry.topic)).toContain("子爵的动机");

        // P4 终裁：报告落盘 rp/ticks/
        const tickDir = path.join(projectRoot, "rp", "ticks", "000001-sneak-corridor");
        await fs.mkdir(tickDir, {recursive: true});
        await fs.writeFile(path.join(tickDir, "report.md"), `## Tick 001 终裁\n\n[掷骰] ${JSON.stringify(dice)}\n`, "utf-8");
        // 信息变动：角色得知了账本中的真相（按角色听到的版本）
        const unknownEntries = await listUnknown(projectRoot, "erina");
        await revealUnknown(projectRoot, "erina", unknownEntries[0]!.id, {source: "偷听到子爵与管家的争执", tick: 1, contentOverride: "领地好像快没钱了,召唤和钱有关"});

        // P5 rp.world 写回 + 记忆维护 + pending 未来切片
        const writeBack = await facade.writeSlice(projectPath, {
            instant: 60n,
            title: "Tick 001 sneak-corridor",
            summary: `偷听成功,得知财政危机线索。[掷骰] 概率=${dice.概率} 骰值=${dice.掷骰} ${dice.结果}`,
            patches: [
                {subjectId: "erina", path: "/位置", op: "replace", value: "subject://corridor"},
            ],
        }, "rp");
        expect(writeBack.issues).toEqual([]);
        await facade.writeSlice(projectPath, {
            instant: 300n,
            title: "女仆端茶到达大厅",
            kind: "pending",
            patches: [{subjectId: "viscount", path: "/hp", op: "increment", value: 0}],
        }, "rp");
        await commitTickMemory(projectRoot, "erina", {
            tick: 1,
            time: "复兴纪元1日 00:01:00",
            participants: ["erina", "viscount"],
            detail: "我趁对峙溜到回廊,听到子爵和管家在争执钱的事。",
            summaryLine: "溜到回廊偷听,得知领地缺钱",
            mood: "# 心境\n\n有了筹码,警惕转为盘算。\n",
        });

        // ===== 断言闭环 =====
        // 1. 世界线隔离：main 世界线完全无数据
        expect(await facade.listSlices(projectPath)).toEqual([]);
        expect((await facade.listSlices(projectPath, {}, "rp")).map((slice) => slice.title)).toEqual([
            "Tick 000 initial-state",
            "Tick 001 sneak-corridor",
            "女仆端茶到达大厅",
        ]);
        // 2. pending 切片可辨识
        const rpSlices = await facade.listSlices(projectPath, {}, "rp");
        expect(rpSlices.find((slice) => slice.kind === "pending")?.title).toBe("女仆端茶到达大厅");
        // 3. 状态推算：位置已更新,关系/连接可供图谱提取
        const after = await facade.queryState(projectPath, {subjectIds: ["erina", "ritual-hall"]}, "rp");
        const erina = after.subjects.find((subject) => subject.subjectId === "erina");
        expect(erina?.attrs["位置"]).toBe("subject://corridor");
        expect(JSON.stringify(after.subjects.find((subject) => subject.subjectId === "ritual-hall")?.attrs["连接"])).toContain("corridor");
        // 4. 掷骰记录随切片可查
        expect(rpSlices.find((slice) => slice.title.includes("001"))?.summary).toContain("骰值=41");
        // 5. 记忆闭环：摘要行 + 揭示进入已知 + god 批注仍隔离
        const summary = await readSummary(projectRoot, "erina");
        expect(summary.recent.map((item) => item.tick)).toEqual([1]);
        const godView = await readGodView(projectRoot, "erina");
        expect(godView.unknown).toHaveLength(0);
        expect(godView.knowledge.map((entry) => entry.topic)).toContain("召唤的真相");
        expect(godView.knowledge.find((entry) => entry.topic === "召唤的真相")?.content).toContain("快没钱了");
        expect(godView.truthNotes.find((note) => note.truth === "false")).toBeDefined();
        const actorAfter = await readActorView(projectRoot, "erina");
        expect(JSON.stringify(actorAfter)).not.toContain("truthNotes");
        // 6. 终裁报告落盘
        expect(await fs.readFile(path.join(tickDir, "report.md"), "utf-8")).toContain("掷骰");
    });
});

const SCHEMA_SOURCE = [
    'import {z} from "zod";',
    "",
    "function Ref(targetType: string) {",
    "    return z.string().regex(/^subject:\\/\\/[\\w-]+$/).describe(`ref:${targetType}`);",
    "}",
    "export const WorldSchema = {",
    "    world: z.object({",
    "        era: z.string().default('复兴纪元').describe('纪元'),",
    "    }),",
    "    character: z.object({",
    "        hp: z.number().int().default(100).describe('生命值'),",
    "        位置: Ref('location').optional().describe('当前位置'),",
    "        关系: z.array(z.object({对象: Ref('character'), 类型: z.string(), 好感: z.number().optional()})).default([]).describe('人际关系'),",
    "        secret: z.object({隐藏体质: z.string().optional()}).optional().describe('god-view 隐藏状态'),",
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
