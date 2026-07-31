import fs from "node:fs/promises";
import path from "node:path";
import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {PlotFacade} from "nbook/server/plot/facade/plot.facade";
import {WorldEngineFacade} from "nbook/server/world-engine/world-engine.facade";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";

/**
 * 写作模式主链数据面回归（不经过 LLM）：以内置奇幻故事「勇者召唤」为素材，
 * 由测试代演 leader/writer 走完主链：
 * lorebook 素材 → World Engine(main) 初始化与状态推进 → Plot 因果树(Phase/Thread/Scene)
 * → 承载树(Act/Chapter + ChapterBrief) → Scene 挂章 + World Anchor → autonomous Writer Brief 编译
 * → manuscript 正文以 frontmatter `chapter:` 反指 → 章-文关联可查。
 * 对应提示词主链「03 Lorebook → World Engine 初始化 → 08 剧情规划 → 09 章节写作」的数据面。
 */
describe("writing mode main chain (勇者召唤)", {timeout: 120_000}, () => {
    const slug = `writing-chain-test-${Date.now()}`;
    const projectPath = `workspace/${slug}`;
    let projectRoot: string;
    let world: WorldEngineFacade;
    let plot: PlotFacade;

    beforeAll(async () => {
        projectRoot = path.join(resolveRuntimeWorkspaceRoot(), slug);
        await fs.mkdir(path.join(projectRoot, "world-engine", "schema"), {recursive: true});
        await fs.writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: 勇者召唤（写作主链回归）\nsummary: ''\n", "utf-8");
        // 写作模式 World Engine 配置根 = 项目根 world-engine/（与 RP 的 rp/world-engine/ 分离）
        await fs.writeFile(path.join(projectRoot, "world-engine", "schema", "index.ts"), SCHEMA_SOURCE, "utf-8");
        await fs.writeFile(path.join(projectRoot, "world-engine", "calendar.ts"), CALENDAR_SOURCE, "utf-8");
        // lorebook 素材（03 步产物）：内容节点 = 目录 + index.md frontmatter
        await writeContentNode("lorebook/character/veiluosi", {title: "薇洛丝", type: "character"}, "地球转生的白发少女,被勇者召唤仪式带到复兴纪元 488 年。尚未觉醒可见能力。");
        await writeContentNode("lorebook/location/ritual-hall", {title: "仪式大厅", type: "location"}, "布劳尔子爵城堡的仪式大厅,地面刻有巨大的召唤法阵。");
        await openProjectForTest(projectPath);
        const workspaceRoot = resolveRuntimeWorkspaceRoot();
        world = new WorldEngineFacade(workspaceRoot);
        plot = new PlotFacade(workspaceRoot, world);
    }, 60_000);

    afterAll(async () => {
        await closeProjectForTest(projectPath).catch(() => undefined);
        await plot.closeProject(projectPath).catch(() => undefined);
        await world.closeProject(projectPath);
        await fs.rm(projectRoot, {recursive: true, force: true});
    }, 60_000);

    it("lorebook → WE 初始化 → plot 规划 → chapter brief → manuscript 反指", async () => {
        // ══════════ World Engine 初始化（main 世界线,默认 worldKey） ══════════
        const init = await world.writeSlice(projectPath, {
            instant: 0n,
            title: "勇者召唤仪式完成",
            summary: "位面交汇之日,四名异界者被召唤到仪式大厅",
            patches: [
                {subjectId: "veiluosi", type: "character", name: "薇洛丝", path: "/hp", op: "replace", value: 100},
                {subjectId: "veiluosi", path: "/位置", op: "replace", value: "subject://ritual-hall"},
                {subjectId: "brauer", type: "character", name: "布劳尔子爵", path: "/hp", op: "replace", value: 60},
                {subjectId: "ritual-hall", type: "location", name: "仪式大厅", path: "/连接", op: "append", value: {目标: "subject://corridor", 方向: "西"}},
                {subjectId: "corridor", type: "location", name: "回廊", path: "/连接", op: "append", value: {目标: "subject://ritual-hall", 方向: "东"}},
            ],
        });
        expect(init.issues).toEqual([]);

        // ══════════ Plot 因果树（08 剧情规划:Phase → Thread → Scene） ══════════
        const phase = await plot.createStoryPhase(projectPath, {name: "summoning-arc", title: "召唤篇", summary: "异界者们抵达并卷入领地危机"});
        const thread = await plot.createStoryThread(projectPath, {
            storyPhaseId: phase.id,
            name: "awakening-line",
            title: "薇洛丝觉醒线",
            isMainThread: true,
            miceType: "character",
            summary: "薇洛丝从『召唤失败的例外体』一步步觉醒",
        });
        const scene = await plot.createStoryScene(projectPath, {
            threadId: thread.id,
            title: "仪式大厅初醒",
            status: "active",
            pacingRole: "setup",
            summary: "薇洛丝在法阵中央醒来,观察在场众人,与眼镜女生建立初步信任",
            // 锚点输入只认日历字符串,instant 由 facade 解析派生（startInstant/endInstant 输入被忽略）
            worldAnchor: {
                startTime: "复兴纪元1日 00:00:00",
                endTime: "复兴纪元1日 01:00:00",
                startInstant: null,
                endInstant: null,
                subjectIds: ["veiluosi", "brauer"],
                locationSubjectId: "ritual-hall",
            },
            refs: [
                {relation: "mentions", target: "lorebook/character/veiluosi/", visibility: "author"},
                {relation: "mentions", target: "lorebook/location/ritual-hall/", visibility: "author"},
            ],
        });

        // ══════════ 承载树（Act/Chapter + ChapterBrief 信息控制） ══════════
        const act = await plot.createStoryAct(projectPath, {name: "volume-1", title: "第一卷 召唤之日"});
        const chapter = await plot.createStoryChapter(projectPath, {
            actId: act.id,
            name: "001-summoned",
            title: "第一章 被召唤的人",
            brief: {
                goal: "落地世界观与四名异界者群像,结尾留下薇洛丝『什么都没有』的悬念",
                pov: "薇洛丝第三人称有限视角",
                mustHide: "薇洛丝是召唤失败的例外体;子爵的真实动机是财政危机",
                hintOnly: "持杖法师对薇洛丝的异常注视",
            },
        });
        // Scene 挂章
        await plot.updateStoryScene(projectPath, Number(scene.id), {chapterId: chapter.id});

        // ══════════ Writer Brief 编译（autonomous 模式,09 章节写作入口） ══════════
        const brief = await plot.getChapterWriterBrief(projectPath, Number(chapter.id), "autonomous");
        expect(brief.status).toBe("ready");
        expect(brief.totalScenes).toBe(1);
        const md = brief.suggestedBriefMarkdown ?? "";
        expect(md).toContain("仪式大厅初醒");
        expect(md).toContain("信息控制");
        expect(md).toContain("例外体");
        expect(md).toContain("lorebook/character/veiluosi/");

        // ══════════ Scene 的 World 上下文（World Anchor → 状态注入） ══════════
        const context = await plot.getSceneWorldContext(projectPath, Number(scene.id));
        expect(JSON.stringify(context)).toContain("veiluosi");

        // ══════════ Writer 落盘（manuscript frontmatter 反指 chapter） ══════════
        await writeContentNode("manuscript/001-volume/001-summoned", {title: "第一章 被召唤的人", type: "chapter", chapter: "001-summoned"},
            "金色的光幕散去,薇洛丝站在巨大的召唤法阵中央。\n\n她低头看了看自己的手——没有光,没有纹章,什么都没有。");
        const proseNodes = await plot.findProseForChapter(projectPath, "001-summoned");
        expect(proseNodes).toHaveLength(1);
        expect(proseNodes[0]!.indexPath).toBe("manuscript/001-volume/001-summoned/index.md");
        expect(proseNodes[0]!.words).toBeGreaterThan(0);

        // ══════════ 状态推进（08 步写回:写作推进后世界状态可查） ══════════
        const advance = await world.writeSlice(projectPath, {
            instant: 3600n,
            title: "初步信任建立",
            summary: "薇洛丝与眼镜女生结成同盟,子爵宣布晚宴",
            patches: [
                {subjectId: "veiluosi", path: "/关系", op: "append", value: {对象: "subject://brauer", 类型: "警惕", 好感: 20}},
            ],
        });
        expect(advance.issues).toEqual([]);
        const state = await world.queryState(projectPath, {subjectIds: ["veiluosi"]});
        expect(JSON.stringify(state.subjects[0]?.attrs["关系"])).toContain("警惕");

        // ══════════ 模式分离（写作侧视角）：本项目无 rp/world-engine 配置,rp 世界线拒绝而非回退 ══════════
        await expect(world.listSlices(projectPath, {}, "rp")).rejects.toThrow();
    });

    /** 写一个内容节点：目录 + index.md（frontmatter + 正文）。 */
    async function writeContentNode(relativeDir: string, frontmatter: Record<string, string>, body: string): Promise<void> {
        const dir = path.join(projectRoot, relativeDir);
        await fs.mkdir(dir, {recursive: true});
        const fm = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`).join("\n");
        await fs.writeFile(path.join(dir, "index.md"), `---\n${fm}\n---\n\n${body}\n`, "utf-8");
    }
});

const SCHEMA_SOURCE = [
    'import {z} from "zod";',
    "",
    "function Ref(targetType: string) {",
    "    return z.string().regex(/^subject:\\/\\/[\\w-]+$/).describe(`ref:${targetType}`);",
    "}",
    "export const WorldSchema = {",
    "    character: z.object({",
    "        hp: z.number().int().default(100).describe('生命值'),",
    "        位置: Ref('location').optional().describe('当前位置'),",
    "        关系: z.array(z.object({对象: Ref('character'), 类型: z.string(), 好感: z.number().optional()})).default([]).describe('人际关系'),",
    "    }),",
    "    location: z.object({",
    "        连接: z.array(z.object({目标: Ref('location'), 方向: z.string().optional()})).default([]).describe('通路'),",
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
