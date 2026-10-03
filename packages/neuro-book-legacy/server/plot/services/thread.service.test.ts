import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import type {ThreadRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {OrderService} from "nbook/server/plot/services/order.service";
import type {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import type {PromiseService} from "nbook/server/plot/services/promise.service";
import type {StoryService} from "nbook/server/plot/services/story.service";
import {ThreadService} from "nbook/server/plot/services/thread.service";
import {describe, expect, it, vi} from "vitest";

describe("ThreadService", () => {
    it("delete 先按场收集受影响 Promise 再删 Thread,删除后以收集结果跑回退(D5:Thread 删除=批量 Scene 删除)", async () => {
        const calls: string[] = [];
        const thread = {id: 5, storyId: 1, storyPhaseId: null, name: "main", title: "主线"};
        const threadRepository = {
            // 删除前读一次场清单供收集;beats 随 Scene 级联消失,删除后无从得知受影响 Promise。
            findThreadWithScenesById: vi.fn(async () => ({...thread, scenes: [{id: 10}, {id: 11}]})),
            deleteThread: vi.fn(async () => {
                calls.push("delete");
            }),
        } as unknown as ThreadRepository;
        const storyService = {
            ensureStory: vi.fn(async () => ({id: 1, novelId: 1, title: "小说", summary: "", note: null, createdAt: new Date(), updatedAt: new Date()})),
        } as unknown as StoryService;
        const scopeGuard = {
            assertThread: vi.fn(async () => thread),
        } as unknown as PlotScopeGuard;
        const promiseService = {
            promiseIdsWithBeatOnScene: vi.fn(async (sceneId: number) => {
                calls.push(`collect:${sceneId}`);
                return sceneId === 10 ? [31] : [31, 32];
            }),
            revertFulfilledWithoutValidPayoff: vi.fn(async (promiseIds: number[]) => {
                calls.push(`revert:${promiseIds.join(",")}`);
            }),
        } as unknown as PromiseService;
        const service = new ThreadService(
            threadRepository,
            storyService,
            scopeGuard,
            // cast 原因:本用例只断言删除→回退联动,排序归一化桩只吞调用。
            {normalizeThreads: vi.fn(async () => undefined)} as unknown as OrderService,
            new PlotDtoAssembler(),
            promiseService,
        );

        await service.deleteStoryThread(5);

        // 顺序不变式:收集必须发生在删除前(倒置会永远收集不到);回退用收集到的全量 id(去重在回退入口内做)。
        expect(calls).toEqual(["collect:10", "collect:11", "delete", "revert:31,31,32"]);
    });
});
