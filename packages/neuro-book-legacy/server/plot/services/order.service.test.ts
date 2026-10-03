import {OrderService} from "nbook/server/plot/services/order.service";
import type {
    SceneRepository,
    StoryRepository,
    ThreadRepository,
} from "nbook/server/plot/contracts/plot-repositories";
import {afterAll, beforeAll, describe, expect, it} from "vitest";

type CreateErrorInput = {statusCode: number; message: string};
type TestGlobal = typeof globalThis & {
    createError?: (input: CreateErrorInput) => Error & CreateErrorInput;
};

describe("OrderService", () => {
    const testGlobal = globalThis as TestGlobal;
    const previousCreateError = testGlobal.createError;

    beforeAll(() => {
        testGlobal.createError = (input: CreateErrorInput) => Object.assign(new Error(input.message), input);
    });

    afterAll(() => {
        testGlobal.createError = previousCreateError;
    });

    it("会校验 Scene 在线程 bucket 内的连续排序", () => {
        const service = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            {} as SceneRepository,
        );

        expect(() => service.validateSceneReorderItems(
            [1, 2],
            [10],
            [
                {sceneId: 1, threadId: 10, chapterId: 7, threadSortOrder: 0, chapterSortOrder: 0},
                {sceneId: 2, threadId: 10, chapterId: 7, threadSortOrder: 2, chapterSortOrder: 1},
            ],
        )).toThrowError("剧情线程 10 下的 Scene排序必须从 0 开始连续递增");
    });

    it("会校验未挂章节的 Scene 不能提供 chapterSortOrder", () => {
        const service = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            {} as SceneRepository,
        );

        expect(() => service.validateSceneReorderItems(
            [1],
            [10],
            [
                {sceneId: 1, threadId: 10, chapterId: null, threadSortOrder: 0, chapterSortOrder: 0},
            ],
        )).toThrowError("未挂入章节的 Scene 不能提供 chapterSortOrder");
    });

    it("局部重排 Thread 时不会要求 chapterSortOrder 连续", () => {
        const service = new OrderService(
            {} as StoryRepository,
            {} as ThreadRepository,
            {} as SceneRepository,
        );

        expect(() => service.validateSceneReorderItems(
            [1, 2, 3],
            [10],
            [
                {sceneId: 1, threadId: 10, chapterId: 7, threadSortOrder: 0, chapterSortOrder: 2},
                {sceneId: 2, threadId: 10, chapterId: 7, threadSortOrder: 1, chapterSortOrder: 3},
            ],
        )).not.toThrow();
    });
});
