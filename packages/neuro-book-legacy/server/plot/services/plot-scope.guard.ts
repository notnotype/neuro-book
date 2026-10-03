import type {
    StoryAct,
    StoryChapter,
    StoryPhase,
    StoryScene,
} from "nbook/server/generated/project-prisma/client";
import type {StoryDecisionEntity, StoryPromiseEntity, StoryThreadEntity} from "nbook/server/plot/core/types";
import type {
    ChapterRepository,
    DecisionRepository,
    PromiseRepository,
    SceneRepository,
    StoryRepository,
    ThreadRepository,
} from "nbook/server/plot/contracts/plot-repositories";
import {throwPlotBadRequest, throwPlotNotFound} from "nbook/server/plot/core/errors";

/**
 * 剧情模块作用域守卫。
 * 负责跨 service 复用的存在性、归属关系、唯一性校验。
 */
export class PlotScopeGuard {
    constructor(
        private readonly storyRepository: StoryRepository,
        private readonly threadRepository: ThreadRepository,
        private readonly sceneRepository: SceneRepository,
        private readonly chapterRepository: ChapterRepository,
        private readonly promiseRepository: PromiseRepository,
        private readonly decisionRepository: DecisionRepository,
    ) {}

    /**
     * 校验阶段属于当前 Story。
     */
    async assertPhase(storyId: number, phaseId: number): Promise<StoryPhase> {
        const phase = await this.storyRepository.findPhaseById(phaseId);
        if (!phase || phase.storyId !== storyId) {
            throwPlotNotFound("剧情阶段不存在");
        }
        return phase;
    }

    /**
     * 校验线程属于当前 Story。
     */
    async assertThread(storyId: number, threadId: number): Promise<StoryThreadEntity> {
        const thread = await this.threadRepository.findThreadById(threadId);
        if (!thread || thread.storyId !== storyId) {
            throwPlotNotFound("剧情线程不存在");
        }
        return thread;
    }

    /**
     * 校验场景属于当前 Story。
     */
    async assertScene(storyId: number, sceneId: number): Promise<StoryScene> {
        const scene = await this.sceneRepository.findSceneById(sceneId);
        if (!scene || scene.storyId !== storyId) {
            throwPlotNotFound("剧情场景不存在");
        }
        return scene;
    }

    /**
     * 校验卷属于当前 Story。
     */
    async assertAct(storyId: number, actId: number): Promise<StoryAct> {
        const act = await this.chapterRepository.findActById(actId);
        if (!act || act.storyId !== storyId) {
            throwPlotNotFound("剧情卷不存在");
        }
        return act;
    }

    /**
     * 校验章属于当前 Story。
     */
    async assertChapter(storyId: number, chapterId: number): Promise<StoryChapter> {
        const chapter = await this.chapterRepository.findChapterById(chapterId);
        if (!chapter || chapter.storyId !== storyId) {
            throwPlotNotFound("章节不存在;chapterId 必须指向当前 Story 下的 StoryChapter");
        }
        return chapter;
    }

    /**
     * 校验 Promise 属于当前 Story。
     * beat 写入(scene×promise)两侧都过本守卫即保证同 story。
     */
    async assertPromise(storyId: number, promiseId: number): Promise<StoryPromiseEntity> {
        const promise = await this.promiseRepository.findPromiseById(promiseId);
        if (!promise || promise.storyId !== storyId) {
            throwPlotNotFound("Promise 不存在;promiseId 必须指向当前 Story 下的 StoryPromise");
        }
        return promise;
    }

    /**
     * 校验 Promise name 唯一。name 是互指引用的 slug,冲突会破坏引用解析。
     */
    async assertPromiseNameUnique(storyId: number, name: string, excludePromiseId?: number): Promise<void> {
        const promise = await this.promiseRepository.findPromiseByName(storyId, name, excludePromiseId);
        if (promise) {
            throwPlotBadRequest(`Promise name 已存在：${name}`);
        }
    }

    /**
     * 校验 Decision 属于当前 Story。
     * anchor 各外键与 supersededById 写入都过本守卫即保证同 story(D12)。
     */
    async assertDecision(storyId: number, decisionId: number): Promise<StoryDecisionEntity> {
        const decision = await this.decisionRepository.findDecisionById(decisionId);
        if (!decision || decision.storyId !== storyId) {
            throwPlotNotFound("Decision 不存在;decisionId 必须指向当前 Story 下的 StoryDecision");
        }
        return decision;
    }

    /**
     * 校验 Decision name 唯一。name 是互指引用的 slug(如 d-liya-truth),冲突会破坏引用解析。
     */
    async assertDecisionNameUnique(storyId: number, name: string, excludeDecisionId?: number): Promise<void> {
        const decision = await this.decisionRepository.findDecisionByName(storyId, name, excludeDecisionId);
        if (decision) {
            throwPlotBadRequest(`Decision name 已存在：${name}`);
        }
    }

    /**
     * 校验卷 name 唯一。
     */
    async assertActNameUnique(storyId: number, name: string, excludeActId?: number): Promise<void> {
        const act = await this.chapterRepository.findActByName(storyId, name, excludeActId);
        if (act) {
            throwPlotBadRequest(`剧情卷 name 已存在：${name}`);
        }
    }

    /**
     * 校验章 name 唯一。Prose frontmatter 通过 name 反指章,name 冲突会破坏反指解析。
     */
    async assertChapterNameUnique(storyId: number, name: string, excludeChapterId?: number): Promise<void> {
        const chapter = await this.chapterRepository.findChapterByName(storyId, name, excludeChapterId);
        if (chapter) {
            throwPlotBadRequest(`章节 name 已存在：${name}`);
        }
    }

    /**
     * 校验阶段 name 唯一。
     */
    async assertPhaseNameUnique(storyId: number, name: string, excludePhaseId?: number): Promise<void> {
        const phase = await this.storyRepository.findPhaseByName(storyId, name, excludePhaseId);
        if (phase) {
            throwPlotBadRequest(`剧情阶段 name 已存在：${name}`);
        }
    }

    /**
     * 校验线程 name 唯一。
     */
    async assertThreadNameUnique(storyId: number, name: string, excludeThreadId?: number): Promise<void> {
        const thread = await this.threadRepository.findThreadByName(storyId, name, excludeThreadId);
        if (thread) {
            throwPlotBadRequest(`剧情线程 name 已存在：${name}`);
        }
    }

    /**
     * 返回 Story 下的阶段 ID。
     */
    async listPhaseIds(storyId: number): Promise<number[]> {
        return this.storyRepository.findPhaseIdsByStory(storyId);
    }

    /**
     * 返回 Story 下的线程 ID。
     */
    async listThreadIds(storyId: number): Promise<number[]> {
        return this.threadRepository.findThreadIdsByStory(storyId);
    }

}
