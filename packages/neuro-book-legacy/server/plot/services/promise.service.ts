import type {PromiseRepository} from "nbook/server/plot/contracts/plot-repositories";
import {throwPlotNotFound} from "nbook/server/plot/core/errors";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import type {
    ParsedCreateStoryPromiseInput,
    ParsedSetPromiseBeatInput,
    ParsedUpdateStoryPromiseInput,
} from "nbook/server/plot/core/types";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {StoryService} from "nbook/server/plot/services/story.service";
import type {
    StoryPromiseDetailDto,
    StoryPromiseDto,
} from "nbook/shared/dto/plot.dto";

/** 摘要列表排序权重:open 优先(账本先看未清偿的),再按 importance 高到低。 */
const STATUS_ORDER = {open: 0, fulfilled: 1, abandoned: 2} as const;
const IMPORTANCE_ORDER = {high: 0, medium: 1, low: 2} as const;

/**
 * Promise(读者债务账本)用例服务。
 *
 * 状态模型(D5 派生优先):
 * - 存储态仅 open/fulfilled/abandoned(作者意图);planted/echoed 等中间态从 beats 派生,组装时计算。
 * - fulfilled 在打 payoff beat 时默认自动置(autoFulfill 参数可关,弧光线里程碑后仍延续时用)。
 * - 回退边界:删除 beat、beat 改型或 Scene 删除/归档后,不再存在任何有效 payoff beat
 *   (有效=所在 Scene 非 archived)时才把 fulfilled 回退 open;多 payoff 删其一不回退。
 * - archived 场的 beats 不参与任何派生(视同不存在,记录保留)。
 */
export class PromiseService {
    constructor(
        private readonly promiseRepository: PromiseRepository,
        private readonly storyService: StoryService,
        private readonly scopeGuard: PlotScopeGuard,
        private readonly assembler: PlotDtoAssembler,
    ) {}

    /**
     * Promise 摘要列表(含派生阶段与 beat 计数)。open 优先,importance 高在前。
     */
    async listStoryPromises(): Promise<StoryPromiseDto[]> {
        const story = await this.storyService.ensureStory();
        const promises = await this.promiseRepository.findPromisesByStory(story.id);
        return promises
            .map((promise) => this.assembler.toStoryPromiseDto(promise))
            .sort((left, right) => (
                STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
                || IMPORTANCE_ORDER[left.importance] - IMPORTANCE_ORDER[right.importance]
                || Number(left.id) - Number(right.id)
            ));
    }

    /**
     * Promise 详情(字段 + beats 及各 beat 所在 Scene/章位 + 派生态)。
     */
    async getStoryPromiseDetailDto(promiseId: number): Promise<StoryPromiseDetailDto> {
        const story = await this.storyService.ensureStory();
        await this.scopeGuard.assertPromise(story.id, promiseId);
        const promise = await this.promiseRepository.findPromiseWithBeatsById(promiseId);
        if (!promise) {
            throwPlotNotFound("Promise 不存在");
        }
        return this.assembler.toStoryPromiseDetailDto(promise);
    }

    /**
     * 创建 Promise。deadlineChapterId 需指向当前 Story 下的章。
     */
    async createStoryPromise(input: ParsedCreateStoryPromiseInput): Promise<StoryPromiseDetailDto> {
        const story = await this.storyService.ensureStory();
        await this.scopeGuard.assertPromiseNameUnique(story.id, input.name);
        if (input.deadlineChapterId !== null) {
            await this.scopeGuard.assertChapter(story.id, input.deadlineChapterId);
        }
        const promise = await this.promiseRepository.createPromise({
            storyId: story.id,
            name: input.name,
            title: input.title,
            importance: input.importance ?? "medium",
            summary: input.summary ?? "",
            payoffExpectation: input.payoffExpectation ?? null,
            cadenceChapters: input.cadenceChapters ?? null,
            deadlineChapterId: input.deadlineChapterId,
            tags: input.tags ?? [],
        });
        return this.getStoryPromiseDetailDto(promise.id);
    }

    /**
     * 更新 Promise。status 直改承载 abandon/fulfill/reopen(存储态是作者意图,重置幂等)。
     */
    async updateStoryPromise(
        promiseId: number,
        patch: ParsedUpdateStoryPromiseInput,
    ): Promise<StoryPromiseDetailDto> {
        const story = await this.storyService.ensureStory();
        const promise = await this.scopeGuard.assertPromise(story.id, promiseId);
        if (patch.name !== undefined && patch.name !== promise.name) {
            await this.scopeGuard.assertPromiseNameUnique(story.id, patch.name, promise.id);
        }
        if (patch.deadlineChapterId !== undefined && patch.deadlineChapterId !== null) {
            await this.scopeGuard.assertChapter(story.id, patch.deadlineChapterId);
        }
        await this.promiseRepository.updatePromise(promise.id, {
            name: patch.name,
            title: patch.title,
            status: patch.status,
            importance: patch.importance,
            summary: patch.summary,
            payoffExpectation: patch.payoffExpectation,
            cadenceChapters: patch.cadenceChapters,
            deadlineChapterId: patch.deadlineChapterId,
            tags: patch.tags,
        });
        return this.getStoryPromiseDetailDto(promise.id);
    }

    /**
     * 物理删除 Promise(beats 级联)。不开放给 Agent,留给 UI/人(Task 97 D4)。
     */
    async deleteStoryPromise(promiseId: number): Promise<void> {
        const story = await this.storyService.ensureStory();
        const promise = await this.scopeGuard.assertPromise(story.id, promiseId);
        await this.promiseRepository.deletePromise(promise.id);
    }

    /**
     * set beat(upsert:同场同线仅一条,kind 取主导)。
     * scene 与 promise 都过 scope guard,保证 scene×promise 同 story。
     * kind=payoff 且 autoFulfill!==false 时自动把 open 置为 fulfilled;
     * 目标场已 archived 的 beat 不参与派生,因此不触发自动置。
     * beat 从 payoff 改为其他 kind 时跑回退检查(可能撤走最后一个有效 payoff)。
     */
    async setPromiseBeat(promiseId: number, input: ParsedSetPromiseBeatInput): Promise<StoryPromiseDetailDto> {
        const story = await this.storyService.ensureStory();
        const promise = await this.scopeGuard.assertPromise(story.id, promiseId);
        const scene = await this.scopeGuard.assertScene(story.id, input.sceneId);

        const existing = await this.promiseRepository.findBeat(promise.id, scene.id);
        await this.promiseRepository.upsertBeat({
            promiseId: promise.id,
            sceneId: scene.id,
            kind: input.kind,
            // undefined=沿用已有指示(新建时为 null),null=显式清空。
            note: input.note === undefined ? existing?.note ?? null : input.note,
        });

        if (input.kind === "payoff" && input.autoFulfill !== false && promise.status === "open" && scene.status !== "archived") {
            await this.promiseRepository.updatePromise(promise.id, {status: "fulfilled"});
        }
        if (existing?.kind === "payoff" && input.kind !== "payoff") {
            await this.revertFulfilledWithoutValidPayoff([promise.id]);
        }
        return this.getStoryPromiseDetailDto(promise.id);
    }

    /**
     * remove beat。删除后跑回退检查(可能撤走最后一个有效 payoff)。
     */
    async removePromiseBeat(promiseId: number, sceneId: number): Promise<StoryPromiseDetailDto> {
        const story = await this.storyService.ensureStory();
        const promise = await this.scopeGuard.assertPromise(story.id, promiseId);
        const existing = await this.promiseRepository.findBeat(promise.id, sceneId);
        if (!existing) {
            throwPlotNotFound("该 Scene 上不存在此 Promise 的 beat");
        }
        await this.promiseRepository.deleteBeat(promise.id, sceneId);
        await this.revertFulfilledWithoutValidPayoff([promise.id]);
        return this.getStoryPromiseDetailDto(promise.id);
    }

    /**
     * 收集在给定 Scene 上打过 beat 的 promiseId。
     * Scene 删除前必须先调用(删除后 beats 级联消失,无从收集)。
     */
    async promiseIdsWithBeatOnScene(sceneId: number): Promise<number[]> {
        const beats = await this.promiseRepository.findBeatsByScene(sceneId);
        return [...new Set(beats.map((beat) => beat.promise.id))];
    }

    /**
     * Scene 状态变化(archive 等)后的 fulfilled 同步:对该场 beats 涉及的 promises 跑回退检查。
     */
    async syncFulfilledAfterSceneChange(sceneId: number): Promise<void> {
        await this.revertFulfilledWithoutValidPayoff(await this.promiseIdsWithBeatOnScene(sceneId));
    }

    /**
     * 回退边界(D5):对给定 promises,若存储态为 fulfilled 且不再存在任何有效 payoff beat
     * (有效=所在 Scene 非 archived),把 fulfilled 回退为 open。
     * 多 payoff(弧光线多里程碑)删其一不回退;手动置的 fulfilled 被误伤时重置一次即可(幂等)。
     * 只回退不自动置:Scene 恢复后 fulfilled 不自动回来,由 payoff beat 写入或显式 fulfill 驱动。
     *
     * 调用清单——凡是能让 Scene 或 beat 消失/失效的路径都必须经过此入口,新增此类路径时同步登记:
     * - setPromiseBeat:beat 从 payoff 改为其他 kind(撤走 payoff);
     * - removePromiseBeat:删除 beat;
     * - SceneService.updateStoryScene:Scene status 置 archived(经 syncFulfilledAfterSceneChange);
     * - SceneService.deleteStoryScene:Scene 删除级联删 beats(删除前先 promiseIdsWithBeatOnScene 收集);
     * - ThreadService.deleteStoryThread:Thread 删除级联删名下全部 Scene 与 beats(批量场删除,同上先收集)。
     */
    async revertFulfilledWithoutValidPayoff(promiseIds: number[]): Promise<void> {
        for (const promiseId of new Set(promiseIds)) {
            const promise = await this.promiseRepository.findPromiseById(promiseId);
            if (!promise || promise.status !== "fulfilled") {
                continue;
            }
            const beats = await this.promiseRepository.findBeatsByPromise(promiseId);
            const hasValidPayoff = beats.some((beat) => beat.kind === "payoff" && beat.scene.status !== "archived");
            if (!hasValidPayoff) {
                await this.promiseRepository.updatePromise(promiseId, {status: "open"});
            }
        }
    }
}
