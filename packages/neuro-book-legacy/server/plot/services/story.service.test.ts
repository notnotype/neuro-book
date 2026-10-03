import type {
    ChapterRepository,
    DecisionRepository,
    PromiseRepository,
    SceneRepository,
    StoryRepository,
    ThreadRepository,
} from "nbook/server/plot/contracts/plot-repositories";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {OrderService} from "nbook/server/plot/services/order.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {StoryService} from "nbook/server/plot/services/story.service";
import {describe, expect, it, vi} from "vitest";

describe("StoryService", () => {
    it("删除阶段后会把线程移到未分组 bucket，并压缩阶段排序", async () => {
        const phases = [
            {id: 1, storyId: 10, sortOrder: 0, name: "phase-1", title: "阶段 1", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()},
            {id: 2, storyId: 10, sortOrder: 1, name: "phase-2", title: "阶段 2", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()},
            {id: 3, storyId: 10, sortOrder: 3, name: "phase-3", title: "阶段 3", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()},
        ];
        const ungroupedThreads = [
            {id: 9, storyId: 10, storyPhaseId: null, sortOrder: 4, name: "free", title: "未分组", isMainThread: false, status: "draft", summary: "", tags: [], writingTip: null, note: null, createdAt: new Date(), updatedAt: new Date()},
        ];
        const threadUpdates: Array<{threadId: number; data: {storyPhaseId?: number | null; sortOrder?: number}}> = [];

        const storyRepository = {
            findStory: vi.fn(async () => ({id: 10, novelId: 100, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
            upsertStoryForNovel: vi.fn(async () => ({id: 10, novelId: 100, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
            findPhaseById: vi.fn(async (phaseId: number) => phases.find((phase) => phase.id === phaseId) ?? null),
            findPhasesByStory: vi.fn(async () => [...phases].sort((left, right) => left.sortOrder - right.sortOrder)),
            findPhaseIdsByStory: vi.fn(async () => phases.map((phase) => phase.id)),
            updatePhase: vi.fn(async (phaseId: number, data: {sortOrder?: number}) => {
                const phase = phases.find((item) => item.id === phaseId);
                if (!phase) {
                    throw new Error("phase 不存在");
                }
                if (data.sortOrder !== undefined) {
                    phase.sortOrder = data.sortOrder;
                }
                return phase;
            }),
            deletePhase: vi.fn(async (phaseId: number) => {
                const phaseIndex = phases.findIndex((phase) => phase.id === phaseId);
                phases.splice(phaseIndex, 1);
            }),
        } as StoryRepository;
        const threadRepository = {
            findThreadsByStoryPhase: vi.fn(async (_storyId: number, storyPhaseId: number | null) => {
                if (storyPhaseId === 2) {
                    return [
                        {id: 11, storyId: 10, storyPhaseId: 2, sortOrder: 0, name: "thread-11", title: "线程 11", isMainThread: false, status: "draft", summary: "", tags: [], writingTip: null, note: null, createdAt: new Date(), updatedAt: new Date()},
                        {id: 12, storyId: 10, storyPhaseId: 2, sortOrder: 1, name: "thread-12", title: "线程 12", isMainThread: false, status: "draft", summary: "", tags: [], writingTip: null, note: null, createdAt: new Date(), updatedAt: new Date()},
                    ];
                }
                return storyPhaseId === null ? ungroupedThreads : [];
            }),
            updateThread: vi.fn(async (threadId: number, data: {storyPhaseId?: number | null; sortOrder?: number}) => {
                threadUpdates.push({threadId, data});
                return ungroupedThreads[0]!;
            }),
        } as ThreadRepository;
        const sceneRepository = {} as SceneRepository;
        const chapterRepository = {} as ChapterRepository;
        const promiseRepository = {} as PromiseRepository;
        const decisionRepository = {} as DecisionRepository;
        const orderService = new OrderService(
            storyRepository,
            threadRepository,
            sceneRepository,
        );
        const scopeGuard = new PlotScopeGuard(
            storyRepository,
            threadRepository,
            sceneRepository,
            chapterRepository,
            promiseRepository,
            decisionRepository,
        );
        scopeGuard.assertPhase = vi.fn(async (_storyId: number, phaseId: number) => {
            const phase = phases.find((item) => item.id === phaseId);
            if (!phase) {
                throw new Error("phase 不存在");
            }
            return phase;
        });
        const service = new StoryService(
            {kind: "novel", title: "小说", summary: ""},
            storyRepository,
            threadRepository,
            chapterRepository,
            promiseRepository,
            decisionRepository,
            orderService,
            new PlotDtoAssembler(),
            scopeGuard,
        );

        await service.deleteStoryPhase(2);

        expect(threadUpdates).toEqual([
            {threadId: 11, data: {storyPhaseId: null, sortOrder: 5}},
            {threadId: 12, data: {storyPhaseId: null, sortOrder: 6}},
        ]);
        expect(phases.map((phase) => ({id: phase.id, sortOrder: phase.sortOrder}))).toEqual([
            {id: 1, sortOrder: 0},
            {id: 3, sortOrder: 1},
        ]);
    });
});
