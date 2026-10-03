import type {SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {StoryScene} from "nbook/server/generated/project-prisma/client";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {SceneWorldContextService} from "nbook/server/plot/services/scene-world-context.service";
import type {StoryService} from "nbook/server/plot/services/story.service";
import type {WorldEngineFacade} from "nbook/server/world-engine/world-engine.facade";
import {describe, expect, it, vi} from "vitest";

/**
 * 创建满足 StoryScene 字段形状的测试 Scene。
 */
function createScene(patch: Partial<StoryScene> = {}): StoryScene {
    return {
        id: 10,
        storyId: 1,
        threadId: 2,
        chapterPath: null,
        threadSortOrder: 0,
        chapterSortOrder: null,
        title: "Scene",
        status: "draft",
        summary: "",
        purpose: null,
        writingTip: null,
        note: null,
        startInstant: 100n,
        endInstant: 200n,
        subjectIdsJson: JSON.stringify(["hero", "villain", "hero"]),
        locationSubjectId: "temple",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        ...patch,
    };
}

/**
 * 创建 Scene World Context 服务及其 mock 依赖。
 */
function createService(scene: StoryScene | null = createScene()) {
    const sceneRepository = {
        findSceneById: vi.fn(async () => scene),
    } as unknown as SceneRepository & {findSceneById: ReturnType<typeof vi.fn>};
    const storyService = {
        ensureStory: vi.fn(async () => ({id: 1})),
    } as unknown as StoryService & {ensureStory: ReturnType<typeof vi.fn>};
    const scopeGuard = {
        assertScene: vi.fn(async () => undefined),
    } as unknown as PlotScopeGuard & {assertScene: ReturnType<typeof vi.fn>};
    const worldEngineFacade = {
        listSlices: vi.fn(async () => [
            {
                id: "slice-relevant",
                instant: 120n,
                title: "相关切面",
                summary: "主角进入神殿。",
                kind: "event",
                patches: [
                    {subjectId: "hero"},
                    {subjectId: "bystander"},
                ],
            },
            {
                id: "slice-unrelated",
                instant: 140n,
                title: "无关切面",
                summary: "远方商队移动。",
                kind: "event",
                patches: [
                    {subjectId: "merchant"},
                ],
            },
        ]),
        queryState: vi.fn(async () => ({
            subjects: [
                {subjectId: "hero", type: "character", attrs: {hp: 8}},
                {subjectId: "temple", type: "location", attrs: {light: "dim"}},
            ],
        })),
        listSubjectIdentities: vi.fn(async () => [
            {id: "hero", name: "主角"},
            {id: "temple", name: "荒野神殿"},
        ]),
        formatTime: vi.fn(async (instant: bigint) => `T${instant.toString()}`),
    } as unknown as WorldEngineFacade & {
        listSlices: ReturnType<typeof vi.fn>;
        queryState: ReturnType<typeof vi.fn>;
        listSubjectIdentities: ReturnType<typeof vi.fn>;
        formatTime: ReturnType<typeof vi.fn>;
    };

    return {
        service: new SceneWorldContextService(sceneRepository, storyService, scopeGuard, worldEngineFacade),
        sceneRepository,
        storyService,
        scopeGuard,
        worldEngineFacade,
    };
}

describe("SceneWorldContextService", () => {
    it("按 Scene 时间范围和 subject/location 收窄 World Engine 上下文", async () => {
        const {service, worldEngineFacade, scopeGuard} = createService();

        const result = await service.getSceneWorldContext(10);

        expect(scopeGuard.assertScene).toHaveBeenCalledWith(1, 10);
        expect(worldEngineFacade.listSlices).toHaveBeenCalledWith({
            from: 100n,
            to: 200n,
            withPatches: true,
            subjectIds: ["hero", "temple"],
            subjectMode: "any",
        });
        expect(worldEngineFacade.queryState).toHaveBeenCalledWith({
            subjectIds: ["hero", "temple"],
            at: 200n,
        });
        expect(result.slices).toEqual([
            {
                id: "slice-relevant",
                time: "T120",
                title: "相关切面",
                summary: "主角进入神殿。",
                kind: "event",
                patchCount: 1,
            },
        ]);
        expect(result.subjectStates).toEqual([
            {subjectId: "hero", type: "character", name: "主角", attrs: {hp: 8}},
            {subjectId: "temple", type: "location", name: "荒野神殿", attrs: {light: "dim"}},
        ]);
        expect(result.unresolvedSubjectIds).toEqual(["villain"]);
    });

    it("Scene 未设置完整时间范围时拒绝查询", async () => {
        const {service, worldEngineFacade} = createService(createScene({startInstant: null}));

        await expect(service.getSceneWorldContext(10)).rejects.toThrow("Scene 尚未设置完整 World Engine 时间范围");
        expect(worldEngineFacade.listSlices).not.toHaveBeenCalled();
    });

    it("Scene 没有 subject 和地点时返回空上下文且不查询 World Engine", async () => {
        const {service, worldEngineFacade} = createService(createScene({
            subjectIdsJson: "[]",
            locationSubjectId: null,
        }));

        await expect(service.getSceneWorldContext(10)).resolves.toEqual({
            slices: [],
            subjectStates: [],
            unresolvedSubjectIds: [],
        });
        expect(worldEngineFacade.listSubjectIdentities).not.toHaveBeenCalled();
        expect(worldEngineFacade.listSlices).not.toHaveBeenCalled();
        expect(worldEngineFacade.queryState).not.toHaveBeenCalled();
    });

    it("Scene 只有占位 subject 时返回 unresolved 且不查询切面和状态", async () => {
        const {service, worldEngineFacade} = createService(createScene({
            subjectIdsJson: JSON.stringify(["future-hero"]),
            locationSubjectId: "future-place",
        }));

        await expect(service.getSceneWorldContext(10)).resolves.toEqual({
            slices: [],
            subjectStates: [],
            unresolvedSubjectIds: ["future-hero", "future-place"],
        });
        expect(worldEngineFacade.listSubjectIdentities).toHaveBeenCalledOnce();
        expect(worldEngineFacade.listSlices).not.toHaveBeenCalled();
        expect(worldEngineFacade.queryState).not.toHaveBeenCalled();
    });
});
