import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import type {SceneRepository, StoryRepository, ThreadRepository} from "nbook/server/plot/contracts/plot-repositories";
import {OrderService} from "nbook/server/plot/services/order.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {RefResolverService} from "nbook/server/plot/services/ref-resolver.service";
import {SceneService} from "nbook/server/plot/services/scene.service";
import {SceneWorldAnchorValidator} from "nbook/server/plot/services/scene-world-anchor.validator";
import type {PromiseService} from "nbook/server/plot/services/promise.service";
import type {StoryService} from "nbook/server/plot/services/story.service";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";

type CreateErrorInput = {statusCode: number; message: string};
type TestGlobal = typeof globalThis & {
    createError?: (input: CreateErrorInput) => Error & CreateErrorInput;
};

describe("SceneService", () => {
    const testGlobal = globalThis as TestGlobal;
    const previousCreateError = testGlobal.createError;

    beforeAll(() => {
        testGlobal.createError = (input: CreateErrorInput) => Object.assign(new Error(input.message), input);
    });

    afterAll(() => {
        testGlobal.createError = previousCreateError;
    });

    it("重排 Scene 时会先写入临时排序，避免 threadId + threadSortOrder 唯一约束冲突", async () => {
        const updateCalls: Array<{sceneId: number; data: {threadId?: number; threadSortOrder?: number; chapterId?: number | null; chapterSortOrder?: number | null}}> = [];
        const sceneRepository = {
            findSceneIdsByStory: vi.fn(async () => [101, 102]),
            findScenesByThread: vi.fn(async () => [
                {id: 101, threadSortOrder: 0},
                {id: 102, threadSortOrder: 1},
            ]),
            updateScene: vi.fn(async (sceneId: number, data: {threadId?: number; threadSortOrder?: number; chapterId?: number | null; chapterSortOrder?: number | null}) => {
                updateCalls.push({sceneId, data});
                return {
                    id: sceneId,
                    storyId: 1,
                    threadId: data.threadId ?? 11,
                    chapterId: data.chapterId ?? null,
                    threadSortOrder: data.threadSortOrder ?? 0,
                    chapterSortOrder: data.chapterSortOrder ?? null,
                    title: "",
                    status: "draft",
                    summary: "",
                    purpose: null,
                    writingTip: null,
                    note: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
            }),
        } as unknown as SceneRepository;
        const storyService = {
            ensureStory: vi.fn(async () => ({id: 1, novelId: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
            getPlotTree: vi.fn(async () => ({
                story: {id: "1", novelId: "1", title: "小说", summary: "", note: null, createdAt: "", updatedAt: ""},
                phases: [],
                ungroupedThreads: [],
                acts: [],
                ungroupedChapters: [],
                totalPhases: 0,
                totalThreads: 0,
                totalScenes: 2,
                totalActs: 0,
                totalChapters: 0,
            })),
        } as unknown as StoryService;
        const scopeGuard = {
            listThreadIds: vi.fn(async () => [11]),
        } as unknown as PlotScopeGuard;
        const orderService = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            sceneRepository,
        );
        const service = new SceneService(
            sceneRepository,
            storyService,
            scopeGuard,
            orderService,
            {} as RefResolverService,
            new SceneWorldAnchorValidator(),
            new PlotDtoAssembler(),
            {} as PromiseService,
        );

        await service.reorderStoryScenes([
            {sceneId: 101, threadId: 11, chapterId: null, threadSortOrder: 1, chapterSortOrder: null},
            {sceneId: 102, threadId: 11, chapterId: null, threadSortOrder: 0, chapterSortOrder: null},
        ]);

        expect(updateCalls).toEqual([
            {sceneId: 101, data: {threadId: 11, chapterId: null, threadSortOrder: -1, chapterSortOrder: null}},
            {sceneId: 102, data: {threadId: 11, chapterId: null, threadSortOrder: -2, chapterSortOrder: null}},
            {sceneId: 101, data: {threadSortOrder: 1}},
            {sceneId: 102, data: {threadSortOrder: 0}},
        ]);
    });

    it("重排 Scene 时只要求覆盖目标 Thread，不要求提交整个 Story 的全部 Scene", async () => {
        const sceneRepository = {
            findSceneIdsByStory: vi.fn(async () => [101, 102, 201]),
            findScenesByThread: vi.fn(async () => [
                {id: 101, threadSortOrder: 0},
                {id: 102, threadSortOrder: 1},
            ]),
            updateScene: vi.fn(async () => ({})),
        } as unknown as SceneRepository;
        const storyService = {
            ensureStory: vi.fn(async () => ({id: 1, novelId: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
            getPlotTree: vi.fn(async () => ({
                story: {id: "1", novelId: "1", title: "小说", summary: "", note: null, createdAt: "", updatedAt: ""},
                phases: [],
                ungroupedThreads: [],
                acts: [],
                ungroupedChapters: [],
                totalPhases: 0,
                totalThreads: 0,
                totalScenes: 3,
                totalActs: 0,
                totalChapters: 0,
            })),
        } as unknown as StoryService;
        const scopeGuard = {
            listThreadIds: vi.fn(async () => [11, 22]),
        } as unknown as PlotScopeGuard;
        const orderService = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            sceneRepository,
        );
        const service = new SceneService(
            sceneRepository,
            storyService,
            scopeGuard,
            orderService,
            {} as RefResolverService,
            new SceneWorldAnchorValidator(),
            new PlotDtoAssembler(),
            {} as PromiseService,
        );

        await service.reorderStoryScenes([
            {sceneId: 101, threadId: 11, chapterId: null, threadSortOrder: 1, chapterSortOrder: null},
            {sceneId: 102, threadId: 11, chapterId: null, threadSortOrder: 0, chapterSortOrder: null},
        ]);

        expect(sceneRepository.updateScene).toHaveBeenCalledTimes(4);
    });

    it("重排 Scene 时会拒绝没有覆盖目标 Thread bucket 的请求", async () => {
        const sceneRepository = {
            findSceneIdsByStory: vi.fn(async () => [101, 102]),
            findScenesByThread: vi.fn(async () => [
                {id: 101, threadSortOrder: 0},
                {id: 102, threadSortOrder: 1},
            ]),
            updateScene: vi.fn(),
        } as unknown as SceneRepository;
        const storyService = {
            ensureStory: vi.fn(async () => ({id: 1, novelId: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
            getPlotTree: vi.fn(),
        } as unknown as StoryService;
        const scopeGuard = {
            listThreadIds: vi.fn(async () => [11]),
        } as unknown as PlotScopeGuard;
        const orderService = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            sceneRepository,
        );
        const service = new SceneService(
            sceneRepository,
            storyService,
            scopeGuard,
            orderService,
            {} as RefResolverService,
            new SceneWorldAnchorValidator(),
            new PlotDtoAssembler(),
            {} as PromiseService,
        );

        await expect(service.reorderStoryScenes([
            {sceneId: 101, threadId: 11, chapterId: null, threadSortOrder: 0, chapterSortOrder: null},
        ])).rejects.toThrow("剧情线程 11 下的 Scene 重排必须覆盖当前 Thread 的全部 Scene");
        expect(sceneRepository.updateScene).not.toHaveBeenCalled();
    });

    it("update 置 status=archived 时以该 sceneId 触发 Promise fulfilled 回退同步;非 archived patch 不触发", async () => {
        const scene = {id: 10, storyId: 1, threadId: 11, chapterId: null};
        const sceneRepository = {
            updateScene: vi.fn(async () => scene),
            findSceneWithDetailsById: vi.fn(async () => scene),
        } as unknown as SceneRepository;
        const storyService = {
            ensureStory: vi.fn(async () => ({id: 1, novelId: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
        } as unknown as StoryService;
        const scopeGuard = {
            assertScene: vi.fn(async () => scene),
        } as unknown as PlotScopeGuard;
        const promiseService = {
            syncFulfilledAfterSceneChange: vi.fn(async () => undefined),
        } as unknown as PromiseService & {syncFulfilledAfterSceneChange: ReturnType<typeof vi.fn>};
        const service = new SceneService(
            sceneRepository,
            storyService,
            scopeGuard,
            // cast 原因:本用例只走 update→sync 联动,不触发排序/refs/DTO 细节,桩只实现被调用面。
            {} as OrderService,
            {} as RefResolverService,
            new SceneWorldAnchorValidator(),
            {toStorySceneDetailDto: vi.fn(() => ({id: "10"}))} as unknown as PlotDtoAssembler,
            promiseService,
        );

        await service.updateStoryScene(10, {status: "archived"});
        expect(promiseService.syncFulfilledAfterSceneChange).toHaveBeenCalledTimes(1);
        expect(promiseService.syncFulfilledAfterSceneChange).toHaveBeenCalledWith(10);

        await service.updateStoryScene(10, {title: "改名不触发回退"});
        expect(promiseService.syncFulfilledAfterSceneChange).toHaveBeenCalledTimes(1);
    });

    it("delete 先收集受影响 Promise 再删 Scene,删除后以收集结果跑回退(顺序倒置会永远收集不到)", async () => {
        const calls: string[] = [];
        const scene = {id: 10, storyId: 1, threadId: 11, chapterId: 7};
        const sceneRepository = {
            deleteScene: vi.fn(async () => {
                calls.push("delete");
            }),
        } as unknown as SceneRepository;
        const storyService = {
            ensureStory: vi.fn(async () => ({id: 1, novelId: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
        } as unknown as StoryService;
        const scopeGuard = {
            assertScene: vi.fn(async () => scene),
        } as unknown as PlotScopeGuard;
        const promiseService = {
            promiseIdsWithBeatOnScene: vi.fn(async () => {
                calls.push("collect");
                return [31, 32];
            }),
            revertFulfilledWithoutValidPayoff: vi.fn(async (promiseIds: number[]) => {
                calls.push(`revert:${promiseIds.join(",")}`);
            }),
        } as unknown as PromiseService;
        const service = new SceneService(
            sceneRepository,
            storyService,
            scopeGuard,
            // cast 原因:排序归一化不在本用例断言范围,桩只吞调用。
            {normalizeSceneThread: vi.fn(async () => undefined), normalizeSceneChapter: vi.fn(async () => undefined)} as unknown as OrderService,
            {} as RefResolverService,
            new SceneWorldAnchorValidator(),
            new PlotDtoAssembler(),
            promiseService,
        );

        await service.deleteStoryScene(10);

        expect(calls).toEqual(["collect", "delete", "revert:31,32"]);
    });
});
