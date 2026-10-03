import type {StoryScene} from "nbook/server/generated/prisma/client";
import type {ThreadRepository} from "nbook/server/plot/contracts/plot-repositories";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {RefResolverService} from "nbook/server/plot/services/ref-resolver.service";
import {beforeAll, describe, expect, it, vi} from "vitest";

beforeAll(() => {
    (globalThis as typeof globalThis & {
        createError?: (input: {statusCode?: number; message?: string}) => Error & {statusCode?: number};
    }).createError = ({statusCode, message}) => Object.assign(new Error(message), {statusCode});
});

function createScene(id: number, storyId: number): StoryScene {
    return {
        id,
        storyId,
        threadId: 1,
        chapterPath: null,
        threadSortOrder: 0,
        chapterSortOrder: null,
        title: "场景",
        status: "draft",
        summary: "",
        purpose: null,
        writingTip: null,
        note: null,
        startInstant: null,
        endInstant: null,
        subjectIdsJson: "[]",
        locationSubjectId: null,
        createdAt: new Date("2026-04-13T00:00:00.000Z"),
        updatedAt: new Date("2026-04-13T00:00:00.000Z"),
    };
}

describe("RefResolverService", () => {
    it("会解析内容节点与剧情内部引用目标", async () => {
        const threadRepository = {
            findThreadTargetByName: vi.fn(async () => ({id: 22, name: "main-thread"})),
        } as ThreadRepository;
        const scopeGuard = {
            assertThread: vi.fn(async () => ({id: 22, storyId: 1, name: "main-thread"})),
            assertScene: vi.fn(async () => createScene(23, 1)),
        } as PlotScopeGuard;
        const service = new RefResolverService(threadRepository, scopeGuard);

        const result = await service.resolveRefs(1, [
            {relation: "涉及", target: "lorebook/character/主角/", visibility: "author", note: null},
            {relation: "关联", target: "thread:main-thread", visibility: "reader", note: null},
            {relation: "发生于", target: "scene://23", visibility: "author", note: null},
        ]);

        expect(result).toEqual([
            expect.objectContaining({
                targetKind: "content",
                rawTarget: "lorebook/character/主角/",
            }),
            expect.objectContaining({
                targetKind: "thread",
                rawTarget: "thread://22",
                targetThreadId: 22,
            }),
            expect.objectContaining({
                targetKind: "scene",
                rawTarget: "scene://23",
                targetSceneId: 23,
            }),
        ]);
    });

    it("会拒绝 pending refs", async () => {
        const service = new RefResolverService(
            {} as ThreadRepository,
            {} as PlotScopeGuard,
        );

        await expect(service.resolveRefs(1, [
            {relation: "涉及", target: "pending://idea/x", visibility: "author", note: null},
        ])).rejects.toMatchObject({
            statusCode: 400,
            message: "不支持的引用目标：pending://idea/x",
        });
        await expect(service.resolveRefs(1, [
            {relation: "涉及", target: "pending.idea[x]", visibility: "author", note: null},
        ])).rejects.toMatchObject({
            statusCode: 400,
            message: "不支持的引用目标：pending.idea[x]",
        });
    });

    it("会拒绝重复 refs", async () => {
        const service = new RefResolverService(
            {} as ThreadRepository,
            {} as PlotScopeGuard,
        );

        await expect(service.resolveRefs(1, [
            {relation: "涉及", target: "lorebook/note/x/", visibility: "author", note: null},
            {relation: "涉及", target: "lorebook/note/x/", visibility: "reader", note: null},
        ])).rejects.toMatchObject({
            statusCode: 400,
            message: "refs 中存在重复关系",
        });
    });
});
