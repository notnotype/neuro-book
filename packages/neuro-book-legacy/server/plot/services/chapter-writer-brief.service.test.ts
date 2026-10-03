import type {ChapterRepository, PromiseRepository, SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {ChapterWriterBriefSceneWithThread, StoryPromiseBeatWithPromise, StorySceneRefWithTargets} from "nbook/server/plot/core/types";
import type {StoryChapter} from "nbook/server/generated/project-prisma/client";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {ChapterService} from "nbook/server/plot/services/chapter.service";
import {ChapterWriterBriefService} from "nbook/server/plot/services/chapter-writer-brief.service";
import type {DecisionService} from "nbook/server/plot/services/decision.service";
import type {SceneWorldAnchorResolutionService} from "nbook/server/plot/services/scene-world-anchor-resolution.service";
import type {SceneWorldContextService} from "nbook/server/plot/services/scene-world-context.service";
import type {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import type {StoryService} from "nbook/server/plot/services/story.service";
import type {SceneWorldContextDto, StoryDecisionDto, StorySceneWorldAnchorDto} from "nbook/shared/dto/plot.dto";
import {describe, expect, it, vi} from "vitest";

const chapterId = 7;

/** 章实体 fixture;默认信息控制填了 mustHide(否则会降级 needs_chapter_brief)。 */
function chapterEntity(briefPatch: Partial<StoryChapter> = {}): StoryChapter {
    return {
        id: chapterId,
        storyId: 1,
        actId: null,
        sortOrder: 0,
        name: "001-opening",
        title: "开篇",
        note: null,
        briefGoal: null,
        briefPov: null,
        briefTone: null,
        briefPacing: null,
        briefReaderKnows: null,
        briefProtagonistKnows: null,
        briefMustHide: "薇洛丝不知道项链是前作遗物",
        briefHintOnly: null,
        briefOpening: null,
        briefEnding: null,
        briefDoNotWrite: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        ...briefPatch,
    } satisfies StoryChapter;
}

describe("ChapterWriterBriefService", () => {
    it("autonomous ready：只给查询提示,不展开状态,含信息控制与建议读取", async () => {
        const {service, sceneWorldContextService} = createService([createRecord()]);

        const brief = await service.getChapterWriterBrief(chapterId, "autonomous");

        expect(brief.status).toBe("ready");
        expect(brief.mode).toBe("autonomous");
        expect(brief.totalScenes).toBe(1);
        expect(brief.chapter).toMatchObject({id: "7", name: "001-opening"});
        expect(sceneWorldContextService.getSceneWorldContextForScene).toHaveBeenCalledOnce();

        const md = brief.suggestedBriefMarkdown;
        expect(md).toContain("Autonomous");
        expect(md).toContain("神殿相遇");
        expect(md).toContain("信息控制");
        expect(md).toContain("必须隐藏：薇洛丝不知道项链是前作遗物");
        expect(md).toContain("World 查询提示");
        // 建议读取由 Scene refs 编译。
        expect(md).toContain("## 建议读取");
        expect(md).toContain("lorebook/character/weiluosi/");
        // autonomous 不展开可查询状态,也不含 raw attrs/patch。
        expect(md).not.toContain("Subject states");
        expect(md).not.toContain("attrs");
        expect(md).not.toContain("\"hp\"");
        // 不产出「写作约束」段(文风归 writer profile)。
        expect(md).not.toContain("写作约束");
    });

    it("curated ready：展开 World Context 状态摘要供投喂", async () => {
        const {service} = createService([createRecord()]);

        const brief = await service.getChapterWriterBrief(chapterId, "curated");

        expect(brief.status).toBe("ready");
        expect(brief.mode).toBe("curated");
        const md = brief.suggestedBriefMarkdown;
        expect(md).toContain("Curated");
        expect(md).toContain("World slices");
        expect(md).toContain("Subject states");
        expect(md).toContain("主角(character)");
        // curated 展开状态,但仍不 dump raw attrs JSON。
        expect(md).not.toContain("attrs");
        expect(md).not.toContain("\"hp\"");
    });

    it("needs_chapter_brief：信息控制四项全空时阻断 handoff", async () => {
        const {service} = createService([createRecord()], {}, chapterEntity({
            briefReaderKnows: null,
            briefProtagonistKnows: null,
            briefMustHide: null,
            briefHintOnly: null,
        }));

        const brief = await service.getChapterWriterBrief(chapterId, "autonomous");

        expect(brief.status).toBe("needs_chapter_brief");
        expect(brief.warnings.some((warning) => warning.includes("信息控制未填写"))).toBe(true);
        expect(brief.suggestedBriefMarkdown).toContain("⚠ 未设置");
    });

    it("F1 修复链路：save_story_chapter 补信息控制后 status 从 needs_chapter_brief 走到 ready", async () => {
        // 阶段一：信息控制四项全空 → needs_chapter_brief（Agent 自主流程在此死锁，Task 87 遗留）。
        let stored = chapterEntity({
            briefReaderKnows: null,
            briefProtagonistKnows: null,
            briefMustHide: null,
            briefHintOnly: null,
        });
        const before = createService([createRecord()], {}, stored);
        expect((await before.service.getChapterWriterBrief(chapterId, "autonomous")).status).toBe("needs_chapter_brief");

        // 阶段二：用真实 ChapterService.updateStoryChapter 应用 save_story_chapter 工具透传的 brief patch（{brief: {mustHide}}）。
        const chapterService = new ChapterService(
            // 只需要 updateChapter 一个方法;按 Prisma 语义忽略 undefined 键（cast 原因：测试桩不实现全量接口）。
            {
                updateChapter: async (_chapterId: number, patch: Partial<StoryChapter>) => {
                    stored = {
                        ...stored,
                        ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
                    };
                    return stored;
                },
            } as unknown as ChapterRepository,
            {
                ensureStory: vi.fn(async () => ({id: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
            } as unknown as StoryService,
            {
                assertChapter: vi.fn(async () => stored),
            } as unknown as PlotScopeGuard,
            new PlotDtoAssembler(),
        );
        await chapterService.updateStoryChapter(chapterId, {
            brief: {mustHide: "薇洛丝不知道项链是前作遗物"},
        });

        // 阶段三：重新编译 brief → ready，死锁解除。
        const after = createService([createRecord()], {}, stored);
        expect((await after.service.getChapterWriterBrief(chapterId, "autonomous")).status).toBe("ready");
    });

    it("needs_plot：章节没有关联 Scene 时要求先补 Plot", async () => {
        const {service, sceneWorldContextService} = createService([]);

        const brief = await service.getChapterWriterBrief(chapterId, "autonomous");

        expect(brief.status).toBe("needs_plot");
        expect(brief.scenes).toEqual([]);
        expect(brief.warnings).toContain("本章节尚未关联 Plot Scene；请先建立章节 Scene 顺序。");
        expect(sceneWorldContextService.getSceneWorldContextForScene).not.toHaveBeenCalled();
    });

    it("needs_world_anchor：Scene 缺少完整时间范围时不查询 World Context", async () => {
        const {service, sceneWorldContextService} = createService([createRecord({startInstant: null})]);

        const brief = await service.getChapterWriterBrief(chapterId, "autonomous");

        expect(brief.status).toBe("needs_world_anchor");
        expect(brief.scenes[0]?.worldContext).toBeNull();
        expect(brief.warnings).toContain("Scene「神殿相遇」尚未设置完整 World Engine 时间范围。");
        expect(sceneWorldContextService.getSceneWorldContextForScene).not.toHaveBeenCalled();
    });

    it("needs_world_context：存在 unresolved subject 时阻断 handoff", async () => {
        const {service} = createService([createRecord()], {unresolvedSubjectIds: ["future-ally"]});

        const brief = await service.getChapterWriterBrief(chapterId, "autonomous");

        expect(brief.status).toBe("needs_world_context");
        expect(brief.warnings).toContain("Scene「神殿相遇」存在未解析 subject：future-ally。");
    });

    it("本章 Promise 任务(D25)：按 Scene 分组渲染指令行,note 全文,兑现场附 payoffExpectation", async () => {
        const records = [
            createRecord(),
            createRecord({id: 12, chapterSortOrder: 1, title: "回营地"}),
        ];
        const beatsByScene = new Map<number, StoryPromiseBeatWithPromise[]>([
            [10, [
                createBeat({note: "只写到项链发烫，不许发光。"}),
                createBeat({
                    id: 92,
                    promiseId: 32,
                    kind: "payoff",
                    note: "正面揭示格里沙的誓言来源。",
                    promise: {id: 32, name: "grisha-oath", title: "格里沙誓言线", status: "fulfilled", payoffExpectation: "读者回读第一章的改口细节产生 aha。"},
                }),
            ]],
            [12, [createBeat({id: 93, sceneId: 12, kind: "advance"})]],
        ]);
        const {service} = createService(records, {}, chapterEntity(), {beatsByScene});

        const brief = await service.getChapterWriterBrief(chapterId, "autonomous");

        // DTO:任务按章内 Scene 顺序平铺;payoffExpectation 只附在 payoff 任务上。
        expect(brief.promiseTasks).toHaveLength(3);
        expect(brief.promiseTasks[0]).toMatchObject({sceneId: "10", promiseName: "f-necklace", kind: "plant", note: "只写到项链发烫，不许发光。", payoffExpectation: null});
        expect(brief.promiseTasks[1]).toMatchObject({sceneId: "10", promiseName: "grisha-oath", kind: "payoff", payoffExpectation: "读者回读第一章的改口细节产生 aha。"});
        expect(brief.promiseTasks[2]).toMatchObject({sceneId: "12", kind: "advance", note: null, payoffExpectation: null});

        // markdown:四类指令措辞按 D25,note 与 payoffExpectation 全文输出。
        const md = brief.suggestedBriefMarkdown;
        expect(md).toContain("## 本章 Promise 任务");
        expect(md).toContain("### Scene「神殿相遇」");
        expect(md).toContain("### Scene「回营地」");
        expect(md).toContain("- [建立] 项链伏笔（f-necklace）：自然埋下线索，不要提前解释答案。");
        expect(md).toContain("  - 本次指示: 只写到项链发烫，不许发光。");
        expect(md).toContain("- [兑现] 格里沙誓言线（grisha-oath）：正面揭示并兑现此线，避免只重复此前的提示；写出揭示带来的情绪与后果。");
        expect(md).toContain("  - 预期戏剧效果: 读者回读第一章的改口细节产生 aha。");
        expect(md).toContain("- [推进] 项链伏笔（f-necklace）：侧面提及、制造回忆点，但保持悬念，不在本场展开解释。");
        // 建立场不给预期效果(D7:payoffExpectation 只给兑现场)。
        expect(md.indexOf("预期戏剧效果")).toBe(md.lastIndexOf("预期戏剧效果"));
        // 段落顺序:关键剧情点 → Promise 任务 → 建议读取。
        expect(md.indexOf("## 本章 Promise 任务")).toBeGreaterThan(md.indexOf("## 关键剧情点"));
        expect(md.indexOf("## 建议读取")).toBeGreaterThan(md.indexOf("## 本章 Promise 任务"));
    });

    it("本章 Promise 任务：无 beats 不出段;archived 场不查询,abandoned 线不下发", async () => {
        const records = [
            createRecord(),
            createRecord({id: 11, chapterSortOrder: 1, title: "废弃场", status: "archived"}),
        ];
        const beatsByScene = new Map<number, StoryPromiseBeatWithPromise[]>([
            // 正常场上只有 abandoned 线的 beat → 不下发。
            [10, [createBeat({promise: {status: "abandoned"}})]],
            // archived 场的 beats 不参与派生(D5),查询都不该发生。
            [11, [createBeat({id: 94, sceneId: 11})]],
        ]);
        const {service, promiseRepository} = createService(records, {}, chapterEntity(), {beatsByScene});

        const brief = await service.getChapterWriterBrief(chapterId, "autonomous");

        expect(brief.promiseTasks).toEqual([]);
        expect(brief.suggestedBriefMarkdown).not.toContain("本章 Promise 任务");
        expect(promiseRepository.findBeatsByScene).toHaveBeenCalledTimes(1);
        expect(promiseRepository.findBeatsByScene).toHaveBeenCalledWith(10);
    });

    it("未决决策警告(D26)：anchor 四分支与 story 级期限 ≤3 章命中,其余不触及;非 open 不进段", async () => {
        // 章序:ch7(本章,序位0) ch8 ch9 ch10 ch11。
        const chapters = [
            chapterEntity(),
            chapterEntity({id: 8, sortOrder: 1, name: "002", title: "第二章"}),
            chapterEntity({id: 9, sortOrder: 2, name: "003", title: "第三章"}),
            chapterEntity({id: 10, sortOrder: 3, name: "004", title: "第四章"}),
            chapterEntity({id: 11, sortOrder: 4, name: "005", title: "第五章"}),
        ];
        const decisions = [
            createDecisionDto({id: "51", name: "d-anchor-chapter", anchorKind: "chapter", anchorTargetId: "7"}),
            createDecisionDto({id: "52", name: "d-other-chapter", anchorKind: "chapter", anchorTargetId: "8"}),
            createDecisionDto({id: "53", name: "d-anchor-scene", anchorKind: "scene", anchorTargetId: "10"}),
            createDecisionDto({id: "54", name: "d-anchor-thread", anchorKind: "thread", anchorTargetId: "2"}),
            createDecisionDto({id: "55", name: "d-anchor-promise", anchorKind: "promise", anchorTargetId: "31"}),
            createDecisionDto({id: "56", name: "d-deadline-near", deadlineChapterId: "10", deadlineChapter: {id: "10", name: "004", title: "第四章"}}),
            createDecisionDto({id: "57", name: "d-deadline-far", deadlineChapterId: "11", deadlineChapter: {id: "11", name: "005", title: "第五章"}}),
            createDecisionDto({id: "58", name: "d-deadline-passed", deadlineChapterId: "7", deadlineChapter: {id: "7", name: "001-opening", title: "开篇"}}),
            createDecisionDto({id: "59", name: "d-already-decided", status: "decided", anchorKind: "chapter", anchorTargetId: "7", decision: "已拍板", motivation: "略", risk: "略"}),
        ];
        const beatsByScene = new Map<number, StoryPromiseBeatWithPromise[]>([[10, [createBeat()]]]);
        const {service} = createService([createRecord()], {}, chapterEntity(), {beatsByScene, decisions, chapters});

        const brief = await service.getChapterWriterBrief(chapterId, "autonomous");

        const touched = brief.openDecisions.map((decision) => decision.name);
        expect(touched).toEqual(["d-anchor-chapter", "d-anchor-scene", "d-anchor-thread", "d-anchor-promise", "d-deadline-near", "d-deadline-passed"]);
        expect(brief.openDecisions[0]?.reason).toBe("决策锚定本章");
        expect(brief.openDecisions[1]?.reason).toContain("Scene「神殿相遇」");
        expect(brief.openDecisions[2]?.reason).toContain("Thread「主线」");
        expect(brief.openDecisions[3]?.reason).toContain("线「项链伏笔」");
        expect(brief.openDecisions[4]?.reason).toContain("需在章「第四章」前拍板");
        expect(brief.openDecisions[5]?.reason).toContain("已到而仍未拍板");

        const md = brief.suggestedBriefMarkdown;
        expect(md).toContain("## 未决决策警告");
        expect(md).toContain("不得擅自写死");
        expect(md).toContain("### 莉雅误召真相走向（d-anchor-chapter）");
        expect(md).toContain("- 待决问题: 误召的真相按哪个方案揭开？");
        expect(md).toContain("- 候选方案: 自愿献祭（情感冲击大） / 被诱骗");
        expect(md).not.toContain("d-other-chapter");
        expect(md).not.toContain("d-deadline-far");
        expect(md).not.toContain("d-already-decided");
    });

    it("未决决策警告：存在 open Decision 但全不触及本章时整段不出现", async () => {
        const decisions = [
            createDecisionDto({anchorKind: "chapter", anchorTargetId: "8"}),
            // story 级但无 deadline:不做全章广播(误伤所有章)。
            createDecisionDto({id: "52", name: "d-story-no-deadline"}),
        ];
        const {service} = createService([createRecord()], {}, chapterEntity(), {decisions});

        const brief = await service.getChapterWriterBrief(chapterId, "autonomous");

        expect(brief.openDecisions).toEqual([]);
        expect(brief.suggestedBriefMarkdown).not.toContain("未决决策警告");
    });

    it("curated 模式：规划层两段与现有 World 展开段共存,互不破坏", async () => {
        const beatsByScene = new Map<number, StoryPromiseBeatWithPromise[]>([[10, [createBeat()]]]);
        const decisions = [createDecisionDto({anchorKind: "chapter", anchorTargetId: "7"})];
        const {service} = createService([createRecord()], {}, chapterEntity(), {beatsByScene, decisions});

        const brief = await service.getChapterWriterBrief(chapterId, "curated");

        const md = brief.suggestedBriefMarkdown;
        expect(md).toContain("World slices");
        expect(md).toContain("Subject states");
        expect(md).toContain("## 本章 Promise 任务");
        expect(md).toContain("## 未决决策警告");
        expect(md).toContain("## 建议读取");
    });
});

/** 规划层 fixtures:beats 驱动「本章 Promise 任务」段,decisions 驱动「未决决策警告」段。 */
type PlanningFixtures = {
    // sceneId → 该场 beats;缺省全部场无 beat(任务段不出现)。
    beatsByScene?: Map<number, StoryPromiseBeatWithPromise[]>;
    // listStoryDecisions 的返回(service 内会过滤 status=open);缺省无决策(警告段不出现)。
    decisions?: StoryDecisionDto[];
    // 章序投影用的章列表(按 story 级 sortOrder 排列);缺省只有当前章。
    chapters?: StoryChapter[];
};

/**
 * 创建 service 与 mock 依赖。
 */
function createService(
    records: ChapterWriterBriefSceneWithThread[],
    contextPatch: Partial<SceneWorldContextDto> = {},
    chapter: StoryChapter = chapterEntity(),
    planning: PlanningFixtures = {},
) {
    const sceneRepository = {
        findChapterScenesForBrief: vi.fn(async () => records),
    } as unknown as SceneRepository & {findChapterScenesForBrief: ReturnType<typeof vi.fn>};
    const storyService = {
        ensureStory: vi.fn(async () => ({id: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
    } as unknown as StoryService & {ensureStory: ReturnType<typeof vi.fn>};
    const scopeGuard = {
        assertChapter: vi.fn(async () => chapter),
    } as unknown as PlotScopeGuard & {assertChapter: ReturnType<typeof vi.fn>};
    const sceneWorldContextService = {
        getSceneWorldContextForScene: vi.fn(async () => createWorldContext(contextPatch)),
    } as unknown as SceneWorldContextService & {getSceneWorldContextForScene: ReturnType<typeof vi.fn>};
    const anchorResolutionService = {
        resolveMany: vi.fn(async (anchors: StorySceneWorldAnchorDto[]) => anchors.map(resolveAnchor)),
    } as unknown as SceneWorldAnchorResolutionService & {resolveMany: ReturnType<typeof vi.fn>};
    // cast 原因:测试桩只实现 brief 编译消费的单个方法,不实现全量接口。
    const promiseRepository = {
        findBeatsByScene: vi.fn(async (sceneId: number) => planning.beatsByScene?.get(sceneId) ?? []),
    } as unknown as PromiseRepository & {findBeatsByScene: ReturnType<typeof vi.fn>};
    const chapterRepository = {
        findChaptersByStory: vi.fn(async () => planning.chapters ?? [chapter]),
    } as unknown as ChapterRepository & {findChaptersByStory: ReturnType<typeof vi.fn>};
    const decisionService = {
        listStoryDecisions: vi.fn(async () => planning.decisions ?? []),
    } as unknown as DecisionService & {listStoryDecisions: ReturnType<typeof vi.fn>};

    return {
        service: new ChapterWriterBriefService(
            sceneRepository,
            storyService,
            scopeGuard,
            sceneWorldContextService,
            anchorResolutionService,
            new PlotDtoAssembler(),
            promiseRepository,
            chapterRepository,
            decisionService,
        ),
        sceneRepository,
        scopeGuard,
        sceneWorldContextService,
        anchorResolutionService,
        promiseRepository,
        chapterRepository,
        decisionService,
    };
}

/**
 * 创建带一条 content ref 的 brief read model 记录。
 */
function createRecord(patch: Partial<ChapterWriterBriefSceneWithThread> = {}): ChapterWriterBriefSceneWithThread {
    const ref: StorySceneRefWithTargets = {
        id: 1,
        sceneId: 10,
        sortOrder: 0,
        relation: "depends_on",
        rawTarget: "lorebook/character/weiluosi/",
        targetKind: "content",
        targetThreadId: null,
        targetSceneId: null,
        visibility: "author",
        note: "确认项链设定",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        targetThread: null,
        targetScene: null,
    };
    const base: ChapterWriterBriefSceneWithThread = {
        id: 10,
        storyId: 1,
        threadId: 2,
        chapterId,
        threadSortOrder: 0,
        chapterSortOrder: 0,
        title: "神殿相遇",
        status: "draft",
        outcomeType: null,
        pacingRole: null,
        summary: "主角在神殿遇到未来盟友。",
        purpose: "建立同盟关系。",
        writingTip: "突出压迫感。",
        note: null,
        startInstant: 100n,
        endInstant: 200n,
        subjectIdsJson: JSON.stringify(["hero"]),
        locationSubjectId: "temple",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        thread: {
            id: 2,
            title: "主线",
            isMainThread: true,
            summary: "主线推进到神殿。",
            writingTip: "保持悬疑。",
        },
        refs: [ref],
    };
    return {
        ...base,
        ...patch,
        thread: {...base.thread, ...(patch.thread ?? {})},
        refs: patch.refs ?? base.refs,
    };
}

/**
 * 创建 Scene 上的 promise beat fixture(带所属 Promise 摘要;promise 子对象支持局部覆盖)。
 */
function createBeat(
    patch: Partial<Omit<StoryPromiseBeatWithPromise, "promise">> & {promise?: Partial<StoryPromiseBeatWithPromise["promise"]>} = {},
): StoryPromiseBeatWithPromise {
    const base: StoryPromiseBeatWithPromise = {
        id: 91,
        promiseId: 31,
        sceneId: 10,
        kind: "plant",
        note: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        promise: {
            id: 31,
            name: "f-necklace",
            title: "项链伏笔",
            status: "open",
            payoffExpectation: null,
        },
    };
    return {
        ...base,
        ...patch,
        promise: {...base.promise, ...(patch.promise ?? {})},
    };
}

/**
 * 创建 Decision DTO fixture(listStoryDecisions 的返回形,默认 open + story 锚)。
 */
function createDecisionDto(patch: Partial<StoryDecisionDto> = {}): StoryDecisionDto {
    return {
        id: "51",
        storyId: "1",
        name: "d-liya-truth",
        title: "莉雅误召真相走向",
        status: "open",
        question: "误召的真相按哪个方案揭开？",
        options: [
            {option: "自愿献祭", note: "情感冲击大"},
            {option: "被诱骗", note: null},
        ],
        deadlineChapterId: null,
        deadlineChapter: null,
        decision: null,
        motivation: null,
        rejectedAlternatives: [],
        risk: null,
        serves: [],
        dependsOn: [],
        supersededById: null,
        anchorKind: "story",
        anchorTargetId: null,
        anchorPath: null,
        note: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...patch,
    };
}

/**
 * 创建 World Context fixture。
 */
function createWorldContext(patch: Partial<SceneWorldContextDto> = {}): SceneWorldContextDto {
    return {
        slices: [
            {
                id: "slice-1",
                time: "复兴纪元1日 00:02:00",
                title: "相关切面",
                summary: "神殿灯火变暗。",
                kind: "event",
                patchCount: 2,
            },
        ],
        subjectStates: [
            {
                subjectId: "hero",
                type: "character",
                name: "主角",
                attrs: {hp: 8},
            },
        ],
        unresolvedSubjectIds: [],
        ...patch,
    };
}

/**
 * 把 raw anchor fixture 解析成人类可读显示状态。
 */
function resolveAnchor(anchor: StorySceneWorldAnchorDto): StorySceneWorldAnchorDto {
    return {
        ...anchor,
        startTime: anchor.startInstant === null ? null : "复兴纪元1日 00:01:40",
        endTime: anchor.endInstant === null ? null : "复兴纪元1日 00:03:20",
        subjects: anchor.subjectIds.map((subjectId) => ({
            id: subjectId,
            name: subjectId === "hero" ? "主角" : subjectId,
            type: subjectId === "hero" ? "character" : "unknown",
            resolved: subjectId === "hero",
        })),
        locationSubject: anchor.locationSubjectId === null
            ? null
            : {
                id: anchor.locationSubjectId,
                name: "荒野神殿",
                type: "location",
                resolved: true,
            },
        unresolvedSubjectIds: anchor.subjectIds.filter((subjectId) => subjectId !== "hero"),
    };
}
