import type {SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import {throwPlotNotFound} from "nbook/server/plot/core/errors";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import type {
    ParsedCreateStorySceneInput,
    ParsedReorderStorySceneItem,
    ParsedUpdateStorySceneInput,
} from "nbook/server/plot/core/types";
import {throwPlotBadRequest} from "nbook/server/plot/core/errors";
import {OrderService} from "nbook/server/plot/services/order.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {PromiseService} from "nbook/server/plot/services/promise.service";
import {RefResolverService} from "nbook/server/plot/services/ref-resolver.service";
import {SceneWorldAnchorValidator} from "nbook/server/plot/services/scene-world-anchor.validator";
import {StoryService} from "nbook/server/plot/services/story.service";
import type {
    ChapterPlotDetailDto,
    PlotTreeDto,
    StorySceneDetailDto,
} from "nbook/shared/dto/plot.dto";

/**
 * Scene 用例服务。
 */
export class SceneService {
    constructor(
        private readonly sceneRepository: SceneRepository,
        private readonly storyService: StoryService,
        private readonly scopeGuard: PlotScopeGuard,
        private readonly orderService: OrderService,
        private readonly refResolverService: RefResolverService,
        private readonly worldAnchorValidator: SceneWorldAnchorValidator,
        private readonly assembler: PlotDtoAssembler,
        private readonly promiseService: PromiseService,
    ) {}

    /**
     * 查询场景详情。
     */
    async getStorySceneDetailDto(sceneId: number): Promise<StorySceneDetailDto> {
        const story = await this.storyService.ensureStory();
        await this.scopeGuard.assertScene(story.id, sceneId);
        const scene = await this.sceneRepository.findSceneWithDetailsById(sceneId);
        if (!scene) {
            throwPlotNotFound("剧情场景不存在");
        }

        return this.assembler.toStorySceneDetailDto(scene);
    }

    /**
     * 查询章节下的剧情 Scene。
     */
    async getChapterPlotDetailDto(chapterId: number): Promise<ChapterPlotDetailDto> {
        const story = await this.storyService.ensureStory();
        const chapter = await this.scopeGuard.assertChapter(story.id, chapterId);
        const scenes = await this.sceneRepository.findChapterScenes(chapter.id);
        return this.assembler.toChapterPlotDetailDto(chapter, scenes);
    }

    /**
     * 创建场景。
     */
    async createStoryScene(input: ParsedCreateStorySceneInput): Promise<StorySceneDetailDto> {
        const story = await this.storyService.ensureStory();

        await this.scopeGuard.assertThread(story.id, input.threadId);
        const chapterId = input.chapterId === null ? null : (await this.scopeGuard.assertChapter(story.id, input.chapterId)).id;
        this.worldAnchorValidator.validate(input.worldAnchor);

        const refs = input.resolvedRefs ?? await this.refResolverService.resolveRefs(story.id, input.refs);
        const scene = await this.sceneRepository.createScene({
            storyId: story.id,
            threadId: input.threadId,
            chapterId,
            threadSortOrder: await this.orderService.getNextSceneThreadSortOrder(input.threadId),
            chapterSortOrder: await this.orderService.getNextSceneChapterSortOrder(chapterId),
            title: input.title,
            status: input.status ?? "draft",
            outcomeType: input.outcomeType ?? null,
            pacingRole: input.pacingRole ?? null,
            summary: input.summary ?? "",
            purpose: input.purpose ?? null,
            writingTip: input.writingTip ?? null,
            note: input.note ?? null,
            startInstant: input.worldAnchor.startInstant,
            endInstant: input.worldAnchor.endInstant,
            subjectIdsJson: JSON.stringify(input.worldAnchor.subjectIds),
            locationSubjectId: input.worldAnchor.locationSubjectId,
        });

        await this.sceneRepository.replaceRefs(scene.id, refs);
        return this.getStorySceneDetailDto(scene.id);
    }

    /**
     * 更新场景。
     */
    async updateStoryScene(
        sceneId: number,
        patch: ParsedUpdateStorySceneInput,
    ): Promise<StorySceneDetailDto> {
        const story = await this.storyService.ensureStory();
        const scene = await this.scopeGuard.assertScene(story.id, sceneId);
        const nextThreadId = patch.threadId === undefined ? scene.threadId : patch.threadId;
        const nextChapterId = patch.chapterId === undefined
            ? scene.chapterId
            : patch.chapterId === null
                ? null
                : (await this.scopeGuard.assertChapter(story.id, patch.chapterId)).id;
        const threadChanged = nextThreadId !== scene.threadId;
        const chapterChanged = nextChapterId !== scene.chapterId;

        if (threadChanged) {
            await this.scopeGuard.assertThread(story.id, nextThreadId);
        }

        const refs = patch.refs === undefined
            ? null
            : patch.resolvedRefs ?? await this.refResolverService.resolveRefs(story.id, patch.refs);
        if (patch.worldAnchor !== undefined) {
            this.worldAnchorValidator.validate(patch.worldAnchor);
        }
        await this.sceneRepository.updateScene(scene.id, {
            threadId: nextThreadId,
            chapterId: patch.chapterId === undefined ? undefined : nextChapterId,
            threadSortOrder: threadChanged ? await this.orderService.getNextSceneThreadSortOrder(nextThreadId) : undefined,
            chapterSortOrder: patch.chapterId === undefined
                ? undefined
                : nextChapterId === null
                    ? null
                    : chapterChanged
                        ? await this.orderService.getNextSceneChapterSortOrder(nextChapterId)
                        : undefined,
            title: patch.title,
            status: patch.status,
            outcomeType: patch.outcomeType,
            pacingRole: patch.pacingRole,
            summary: patch.summary,
            purpose: patch.purpose,
            writingTip: patch.writingTip,
            note: patch.note,
            startInstant: patch.worldAnchor?.startInstant,
            endInstant: patch.worldAnchor?.endInstant,
            subjectIdsJson: patch.worldAnchor === undefined ? undefined : JSON.stringify(patch.worldAnchor.subjectIds),
            locationSubjectId: patch.worldAnchor?.locationSubjectId,
        });

        if (refs !== null) {
            await this.sceneRepository.replaceRefs(scene.id, refs);
        }
        if (threadChanged) {
            await this.orderService.normalizeSceneThread(scene.threadId);
        }
        if (chapterChanged && scene.chapterId !== null) {
            await this.orderService.normalizeSceneChapter(scene.chapterId);
        }
        // Scene 归档后其 beats 不再是有效派生输入(D5),同步 fulfilled 回退边界。
        if (patch.status === "archived") {
            await this.promiseService.syncFulfilledAfterSceneChange(scene.id);
        }

        return this.getStorySceneDetailDto(scene.id);
    }

    /**
     * 删除场景。级联删除其 beats,删除后同步受影响 Promise 的 fulfilled 回退边界(D5)。
     */
    async deleteStoryScene(sceneId: number): Promise<void> {
        const story = await this.storyService.ensureStory();
        const scene = await this.scopeGuard.assertScene(story.id, sceneId);
        // beats 随 Scene 级联删除,必须先收集受影响 promise 再删。
        const affectedPromiseIds = await this.promiseService.promiseIdsWithBeatOnScene(scene.id);
        await this.sceneRepository.deleteScene(scene.id);
        await this.orderService.normalizeSceneThread(scene.threadId);
        await this.orderService.normalizeSceneChapter(scene.chapterId);
        await this.promiseService.revertFulfilledWithoutValidPayoff(affectedPromiseIds);
    }

    /**
     * 批量重排场景。
     */
    async reorderStoryScenes(items: ParsedReorderStorySceneItem[]): Promise<PlotTreeDto> {
        const story = await this.storyService.ensureStory();
        const [existingSceneIds, existingThreadIds] = await Promise.all([
            this.sceneRepository.findSceneIdsByStory(story.id),
            this.scopeGuard.listThreadIds(story.id),
        ]);
        for (const item of items) {
            if (item.chapterId !== null) {
                await this.scopeGuard.assertChapter(story.id, item.chapterId);
            }
        }
        const parsedItems = this.orderService.validateSceneReorderItems(
            existingSceneIds,
            existingThreadIds,
            items,
        );
        const affectedThreadIds = new Set(parsedItems.map((item) => item.threadId));

        for (const threadId of affectedThreadIds) {
            const existingThreadSceneIds = (await this.sceneRepository.findScenesByThread(threadId)).map((scene) => scene.id);
            const inputThreadSceneIds = parsedItems.filter((item) => item.threadId === threadId).map((item) => item.sceneId);
            if (
                existingThreadSceneIds.length !== inputThreadSceneIds.length
                || existingThreadSceneIds.some((sceneId) => !inputThreadSceneIds.includes(sceneId))
            ) {
                throwPlotBadRequest(`剧情线程 ${threadId} 下的 Scene 重排必须覆盖当前 Thread 的全部 Scene`);
            }
        }

        for (const [index, item] of parsedItems.entries()) {
            await this.sceneRepository.updateScene(item.sceneId, {
                threadId: item.threadId,
                chapterId: item.chapterId,
                threadSortOrder: -(index + 1),
                chapterSortOrder: item.chapterSortOrder,
            });
        }

        for (const item of parsedItems) {
            await this.sceneRepository.updateScene(item.sceneId, {
                threadSortOrder: item.threadSortOrder,
            });
        }

        return this.storyService.getPlotTree();
    }
}
