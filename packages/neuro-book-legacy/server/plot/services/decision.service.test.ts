import type {ChapterRepository, DecisionRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {StoryChapter} from "nbook/server/generated/project-prisma/client";
import type {StoryDecisionEntity} from "nbook/server/plot/core/types";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {DecisionService} from "nbook/server/plot/services/decision.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import type {StoryService} from "nbook/server/plot/services/story.service";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";

type CreateErrorInput = {statusCode: number; message: string};
type TestGlobal = typeof globalThis & {
    createError?: (input: CreateErrorInput) => Error & CreateErrorInput;
};

/** 构造 Decision 实体夹具(默认 open、story 锚、两个候选)。 */
function decisionEntity(overrides: Partial<StoryDecisionEntity> = {}): StoryDecisionEntity {
    return {
        id: 8,
        storyId: 10,
        name: "d-liya-truth",
        title: "莉雅误召真相揭示时机",
        status: "open",
        question: "莉雅误召的真相在第几章揭示?",
        options: [
            {option: "第10章揭示", note: null},
            {option: "第15章揭示", note: null},
        ],
        deadlineChapterId: null,
        decision: null,
        motivation: null,
        rejectedAlternatives: [],
        risk: null,
        serves: [],
        dependsOn: [],
        supersededById: null,
        anchorKind: "story",
        anchorActId: null,
        anchorChapterId: null,
        anchorThreadId: null,
        anchorSceneId: null,
        anchorPromiseId: null,
        anchorPath: null,
        note: null,
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
        ...overrides,
    } as StoryDecisionEntity;
}

/** 空的引用存在集合(全部引用视为死引用)。 */
function noExistingRefs() {
    return {
        promiseIds: new Set<number>(),
        decisionIds: new Set<number>(),
        threadIds: new Set<number>(),
        sceneIds: new Set<number>(),
    };
}

type ServiceFixture = {
    service: DecisionService;
    repository: {
        updateDecision: ReturnType<typeof vi.fn>;
        createDecision: ReturnType<typeof vi.fn>;
        findExistingRefIds: ReturnType<typeof vi.fn>;
    };
};

/** 构造被测服务:仓储/守卫用 mock,组装器用真实实现以覆盖 anchor 归一化与死引用标注。 */
function createService(options: {
    decision: StoryDecisionEntity;
    /** findExistingRefIds 返回的存在集合;缺省全空(引用都不存在)。 */
    existingRefIds?: ReturnType<typeof noExistingRefs>;
    /** findChapterById 返回的章;缺省 null。 */
    chapter?: StoryChapter | null;
}): ServiceFixture {
    const repository = {
        findDecisionById: vi.fn(async () => options.decision),
        findDecisionsByStory: vi.fn(async () => [options.decision]),
        findDecisionByName: vi.fn(async () => null),
        countOpenDecisionsByStory: vi.fn(async () => 1),
        createDecision: vi.fn(async () => options.decision),
        updateDecision: vi.fn(async () => options.decision),
        deleteDecision: vi.fn(async () => undefined),
        findExistingRefIds: vi.fn(async () => options.existingRefIds ?? noExistingRefs()),
    };
    const chapterRepository = {
        findChapterById: vi.fn(async () => options.chapter ?? null),
        findChaptersByStory: vi.fn(async () => options.chapter ? [options.chapter] : []),
    } as unknown as ChapterRepository;
    const storyService = {
        ensureStory: vi.fn(async () => ({id: 10})),
    } as unknown as StoryService;
    const scopeGuard = {
        assertDecision: vi.fn(async (_storyId: number, decisionId: number) => {
            if (decisionId !== options.decision.id) {
                throw Object.assign(new Error("Decision 不存在"), {statusCode: 404});
            }
            return options.decision;
        }),
        assertDecisionNameUnique: vi.fn(async () => undefined),
        assertChapter: vi.fn(async () => ({id: 7, storyId: 10})),
        assertAct: vi.fn(async () => ({id: 3, storyId: 10})),
        assertThread: vi.fn(async () => ({id: 2, storyId: 10})),
        assertScene: vi.fn(async () => ({id: 20, storyId: 10})),
        assertPromise: vi.fn(async () => ({id: 5, storyId: 10})),
    } as unknown as PlotScopeGuard;
    const service = new DecisionService(
        repository as unknown as DecisionRepository,
        chapterRepository,
        storyService,
        scopeGuard,
        new PlotDtoAssembler(),
    );
    return {service, repository};
}

describe("DecisionService", () => {
    const testGlobal = globalThis as TestGlobal;
    const previousCreateError = testGlobal.createError;

    beforeAll(() => {
        testGlobal.createError = (input: CreateErrorInput) => Object.assign(new Error(input.message), input);
    });

    afterAll(() => {
        testGlobal.createError = previousCreateError;
    });

    it("decide(status=decided)缺 risk 时拒绝并返回可读诊断", async () => {
        const {service} = createService({decision: decisionEntity()});

        await expect(service.updateStoryDecision(8, {
            status: "decided",
            decision: "第15章交汇事件时揭示",
            motivation: "与项链伏笔同场收束,戏剧密度最高",
        })).rejects.toThrow("risk(刹车点)");
    });

    it("decide 转换把 options 未选项转 rejectedAlternatives 骨架(chosenOption 排除,whyRejected 留空)", async () => {
        const {service, repository} = createService({decision: decisionEntity()});

        await service.updateStoryDecision(8, {
            status: "decided",
            decision: "第15章交汇事件时揭示",
            motivation: "与项链伏笔同场收束",
            risk: "第10-14章需持续微量提示,否则揭示突兀",
            chosenOption: "第15章揭示",
        });

        expect(repository.updateDecision).toHaveBeenCalledWith(8, expect.objectContaining({
            status: "decided",
            rejectedAlternatives: [{option: "第10章揭示", whyRejected: null}],
        }));
    });

    it("decide 不传 chosenOption 时全部候选转骨架(结论是全新方案)", async () => {
        const {service, repository} = createService({decision: decisionEntity()});

        await service.updateStoryDecision(8, {
            status: "decided",
            decision: "拆成两段:第10章半揭示+第15章全揭示",
            motivation: "兼顾节奏与冲击",
            risk: "半揭示的信息量要严格控制",
        });

        expect(repository.updateDecision).toHaveBeenCalledWith(8, expect.objectContaining({
            rejectedAlternatives: [
                {option: "第10章揭示", whyRejected: null},
                {option: "第15章揭示", whyRejected: null},
            ],
        }));
    });

    it("chosenOption 未命中 options 时拒绝", async () => {
        const {service} = createService({decision: decisionEntity()});

        await expect(service.updateStoryDecision(8, {
            status: "decided",
            decision: "结论",
            motivation: "理由",
            risk: "风险",
            chosenOption: "不存在的候选",
        })).rejects.toThrow("chosenOption 未命中 options");
    });

    it("拍板时 chosenOption 与显式 rejectedAlternatives 同时提供被拒绝(防止 chosenOption 静默失效)", async () => {
        const {service, repository} = createService({decision: decisionEntity()});

        await expect(service.updateStoryDecision(8, {
            status: "decided",
            decision: "第15章交汇事件时揭示",
            motivation: "与项链伏笔同场收束",
            risk: "第10-14章需持续微量提示",
            chosenOption: "第15章揭示",
            rejectedAlternatives: [{option: "第10章揭示", whyRejected: "太早"}],
        })).rejects.toThrow("不可同时提供");
        expect(repository.updateDecision).not.toHaveBeenCalled();
    });

    it("options 候选文本重复(trim 后同名)被拒绝:拍板按候选文本识别被选项,重复会让否决骨架错乱", async () => {
        const {service, repository} = createService({decision: decisionEntity()});

        await expect(service.updateStoryDecision(8, {
            options: [{option: "第15章揭示", note: null}, {option: " 第15章揭示 ", note: "trim 后同名"}],
        })).rejects.toThrow("候选文本重复");
        expect(repository.updateDecision).not.toHaveBeenCalled();
    });

    it("anchor.kind=content 的 path 复用引用卫生规则:拒绝目录穿越/绝对路径/URI 形态", async () => {
        const {service} = createService({decision: decisionEntity()});

        for (const path of ["../../etc", "/abs/path", "C:\\evil", "promise://3"]) {
            await expect(service.updateStoryDecision(8, {
                anchor: {kind: "content", path},
            })).rejects.toThrow("anchor.path 格式非法");
        }
    });

    it("已 decided 再 update 不重新生成骨架(保护已补全的 whyRejected)", async () => {
        const {service, repository} = createService({decision: decisionEntity({
            status: "decided",
            decision: "第15章揭示",
            motivation: "理由",
            risk: "风险",
            rejectedAlternatives: [{option: "第10章揭示", whyRejected: "太早,悬念不足"}],
        })});

        await service.updateStoryDecision(8, {title: "新标题"});

        expect(repository.updateDecision).toHaveBeenCalledWith(8, expect.objectContaining({
            title: "新标题",
            rejectedAlternatives: undefined,
        }));
    });

    it("drop(status=dropped)缺失效原因时拒绝;note 承载失效原因后成功", async () => {
        const {service, repository} = createService({decision: decisionEntity()});

        await expect(service.updateStoryDecision(8, {
            status: "dropped",
        })).rejects.toThrow("失效的原因");

        await service.updateStoryDecision(8, {
            status: "dropped",
            note: "鉴定异常子情节整体删除,问题不复存在",
        });
        expect(repository.updateDecision).toHaveBeenCalledWith(8, expect.objectContaining({
            status: "dropped",
            note: "鉴定异常子情节整体删除,问题不复存在",
        }));
    });

    it("superseded 需要 supersededById;指向自身时拒绝", async () => {
        const {service} = createService({decision: decisionEntity()});

        await expect(service.updateStoryDecision(8, {
            status: "superseded",
        })).rejects.toThrow("supersededById");

        await expect(service.updateStoryDecision(8, {
            status: "superseded",
            supersededById: 8,
        })).rejects.toThrow("不能指向自身");
    });

    it("anchor 读时归一化:anchorKind=scene 而 anchorSceneId 为 null(外键 SetNull)时视同 story", async () => {
        const orphaned = createService({decision: decisionEntity({anchorKind: "scene", anchorSceneId: null})});
        const dto = await orphaned.service.getStoryDecisionDto(8);
        expect(dto.anchorKind).toBe("story");
        expect(dto.anchorTargetId).toBeNull();

        const anchored = createService({decision: decisionEntity({anchorKind: "scene", anchorSceneId: 42})});
        const anchoredDto = await anchored.service.getStoryDecisionDto(8);
        expect(anchoredDto.anchorKind).toBe("scene");
        expect(anchoredDto.anchorTargetId).toBe("42");
    });

    it("serves 写入:格式非法拒绝;剧情对象 id 不存在拒绝并点名条目", async () => {
        const {service} = createService({decision: decisionEntity()});

        await expect(service.updateStoryDecision(8, {
            serves: ["banana://1"],
        })).rejects.toThrow("引用格式非法");

        await expect(service.updateStoryDecision(8, {
            serves: ["promise://99"],
        })).rejects.toThrow("serves: promise://99");
    });

    it("读取时死引用容错标注:被删对象 valid=false,content 路径恒 valid=true", async () => {
        const {service} = createService({
            decision: decisionEntity({
                serves: ["promise://5", "promise://99", "lorebook/character/chen-yao/"],
            }),
            existingRefIds: {
                promiseIds: new Set([5]),
                decisionIds: new Set<number>(),
                threadIds: new Set<number>(),
                sceneIds: new Set<number>(),
            },
        });

        const dto = await service.getStoryDecisionDto(8);

        expect(dto.serves).toEqual([
            {target: "promise://5", valid: true},
            {target: "promise://99", valid: false},
            {target: "lorebook/character/chen-yao/", valid: true},
        ]);
    });

    it("listStoryDecisions 排序 open 优先,再按 id 稳定", async () => {
        const open = decisionEntity({id: 3, name: "d-open", status: "open"});
        const decided = decisionEntity({
            id: 1,
            name: "d-decided",
            status: "decided",
            decision: "结论",
            motivation: "理由",
            risk: "风险",
        });
        const dropped = decisionEntity({id: 2, name: "d-dropped", status: "dropped", note: "失效"});
        const repository = {
            findDecisionsByStory: vi.fn(async () => [decided, dropped, open]),
            findExistingRefIds: vi.fn(async () => noExistingRefs()),
        };
        const chapterRepository = {
            findChaptersByStory: vi.fn(async () => []),
        } as unknown as ChapterRepository;
        const storyService = {ensureStory: vi.fn(async () => ({id: 10}))} as unknown as StoryService;
        const service = new DecisionService(
            repository as unknown as DecisionRepository,
            chapterRepository,
            storyService,
            {} as PlotScopeGuard,
            new PlotDtoAssembler(),
        );

        const result = await service.listStoryDecisions();

        expect(result.map((item) => item.id)).toEqual(["3", "1", "2"]);
    });
});
