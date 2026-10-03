import type {PromiseRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {StoryScene} from "nbook/server/generated/project-prisma/client";
import type {
    StoryPromiseBeatWithScene,
    StoryPromiseEntity,
    StoryPromiseWithBeats,
    StorySceneWithChapter,
} from "nbook/server/plot/core/types";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {PromiseService} from "nbook/server/plot/services/promise.service";
import type {StoryService} from "nbook/server/plot/services/story.service";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";

type CreateErrorInput = {statusCode: number; message: string};
type TestGlobal = typeof globalThis & {
    createError?: (input: CreateErrorInput) => Error & CreateErrorInput;
};

/** 构造 Promise 实体夹具(默认 open/medium)。 */
function promiseEntity(overrides: Partial<StoryPromiseEntity> = {}): StoryPromiseEntity {
    return {
        id: 5,
        storyId: 10,
        name: "silver-key",
        title: "银钥匙之谜",
        status: "open",
        importance: "medium",
        summary: "读者被承诺:银钥匙能打开地下室",
        payoffExpectation: null,
        cadenceChapters: null,
        deadlineChapterId: null,
        tags: [],
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-01T00:00:00Z"),
        ...overrides,
    } as StoryPromiseEntity;
}

/** 构造 beat + 所在场夹具;sceneStatus 驱动三态派生。 */
function beatWithScene(input: {id: number; kind: StoryPromiseBeatWithScene["kind"]; sceneId: number; sceneStatus: StoryScene["status"]; promiseId?: number}): StoryPromiseBeatWithScene {
    return {
        id: input.id,
        promiseId: input.promiseId ?? 5,
        sceneId: input.sceneId,
        kind: input.kind,
        note: null,
        createdAt: new Date("2026-07-02T00:00:00Z"),
        updatedAt: new Date("2026-07-02T00:00:00Z"),
        scene: {
            id: input.sceneId,
            threadId: 2,
            title: `场景 ${input.sceneId}`,
            status: input.sceneStatus,
            chapterId: null,
            chapter: null,
            chapterSortOrder: null,
        } as StorySceneWithChapter,
    } as StoryPromiseBeatWithScene;
}

/** 组装 Promise 详情聚合(deadlineChapter 置空)。 */
function withBeats(promise: StoryPromiseEntity, beats: StoryPromiseBeatWithScene[]): StoryPromiseWithBeats {
    return {...promise, beats, deadlineChapter: null};
}

type ServiceFixture = {
    service: PromiseService;
    repository: {
        updatePromise: ReturnType<typeof vi.fn>;
        upsertBeat: ReturnType<typeof vi.fn>;
        deleteBeat: ReturnType<typeof vi.fn>;
    };
};

/** 构造被测服务:仓储/守卫用 mock,组装器用真实实现以覆盖 D5 派生规则。 */
function createService(options: {
    promise: StoryPromiseEntity;
    /** findPromiseWithBeatsById 与 findBeatsByPromise 返回的 beats(回退检查与详情组装共用)。 */
    beats?: StoryPromiseBeatWithScene[];
    /** setPromiseBeat 前已存在的 beat(findBeat 返回值);缺省无。 */
    existingBeat?: StoryPromiseBeatWithScene | null;
    /** assertScene 返回的目标场;缺省 active。 */
    scene?: Partial<StoryScene>;
}): ServiceFixture {
    const beats = options.beats ?? [];
    const repository = {
        findPromiseById: vi.fn(async () => options.promise),
        findPromiseWithBeatsById: vi.fn(async () => withBeats(options.promise, beats)),
        findBeat: vi.fn(async () => options.existingBeat ?? null),
        upsertBeat: vi.fn(async () => beats[0]),
        deleteBeat: vi.fn(async () => undefined),
        findBeatsByPromise: vi.fn(async () => beats),
        findBeatsByScene: vi.fn(async () => beats.map((beat) => ({...beat, promise: options.promise}))),
        updatePromise: vi.fn(async () => options.promise),
    };
    const storyService = {
        ensureStory: vi.fn(async () => ({id: 10})),
    } as unknown as StoryService;
    const scopeGuard = {
        assertPromise: vi.fn(async () => options.promise),
        assertScene: vi.fn(async () => ({id: 20, status: "active", ...options.scene})),
        assertPromiseNameUnique: vi.fn(async () => undefined),
        assertChapter: vi.fn(async () => undefined),
    } as unknown as PlotScopeGuard;
    const service = new PromiseService(
        repository as unknown as PromiseRepository,
        storyService,
        scopeGuard,
        new PlotDtoAssembler(),
    );
    return {service, repository};
}

describe("PromiseService", () => {
    const testGlobal = globalThis as TestGlobal;
    const previousCreateError = testGlobal.createError;

    beforeAll(() => {
        testGlobal.createError = (input: CreateErrorInput) => Object.assign(new Error(input.message), input);
    });

    afterAll(() => {
        testGlobal.createError = previousCreateError;
    });

    it("setPromiseBeat kind=payoff 默认自动把 open 置为 fulfilled", async () => {
        const {service, repository} = createService({promise: promiseEntity()});

        await service.setPromiseBeat(5, {sceneId: 20, kind: "payoff"});

        expect(repository.upsertBeat).toHaveBeenCalledWith({promiseId: 5, sceneId: 20, kind: "payoff", note: null});
        expect(repository.updatePromise).toHaveBeenCalledWith(5, {status: "fulfilled"});
    });

    it("setPromiseBeat autoFulfill=false 不自动置(弧光线里程碑后仍延续)", async () => {
        const {service, repository} = createService({promise: promiseEntity()});

        await service.setPromiseBeat(5, {sceneId: 20, kind: "payoff", autoFulfill: false});

        expect(repository.updatePromise).not.toHaveBeenCalled();
    });

    it("setPromiseBeat 目标场 archived 时 payoff 不参与派生,不自动置", async () => {
        const {service, repository} = createService({promise: promiseEntity(), scene: {status: "archived"}});

        await service.setPromiseBeat(5, {sceneId: 20, kind: "payoff"});

        expect(repository.updatePromise).not.toHaveBeenCalled();
    });

    it("setPromiseBeat 把 payoff 改型为 advance 后,若无剩余有效 payoff 则回退 open", async () => {
        // 改型后该 promise 只剩一条 advance beat,fulfilled 失去支撑。
        const {service, repository} = createService({
            promise: promiseEntity({status: "fulfilled"}),
            beats: [beatWithScene({id: 1, kind: "advance", sceneId: 20, sceneStatus: "active"})],
            existingBeat: beatWithScene({id: 1, kind: "payoff", sceneId: 20, sceneStatus: "active"}),
        });

        await service.setPromiseBeat(5, {sceneId: 20, kind: "advance"});

        expect(repository.updatePromise).toHaveBeenCalledWith(5, {status: "open"});
    });

    it("removePromiseBeat 撤走最后一个有效 payoff 后回退 open", async () => {
        const {service, repository} = createService({
            promise: promiseEntity({status: "fulfilled"}),
            beats: [],
            existingBeat: beatWithScene({id: 1, kind: "payoff", sceneId: 20, sceneStatus: "written"}),
        });

        await service.removePromiseBeat(5, 20);

        expect(repository.deleteBeat).toHaveBeenCalledWith(5, 20);
        expect(repository.updatePromise).toHaveBeenCalledWith(5, {status: "open"});
    });

    it("removePromiseBeat 多 payoff 删其一不回退(仍有有效 payoff 支撑)", async () => {
        const {service, repository} = createService({
            promise: promiseEntity({status: "fulfilled"}),
            beats: [beatWithScene({id: 2, kind: "payoff", sceneId: 21, sceneStatus: "written"})],
            existingBeat: beatWithScene({id: 1, kind: "payoff", sceneId: 20, sceneStatus: "written"}),
        });

        await service.removePromiseBeat(5, 20);

        expect(repository.updatePromise).not.toHaveBeenCalled();
    });

    it("syncFulfilledAfterSceneChange:payoff 所在场 archived 后视为无效,fulfilled 回退 open", async () => {
        // 场景归档把最后一个 payoff 变为不参与派生;回退检查只认非 archived 场上的 payoff。
        const {service, repository} = createService({
            promise: promiseEntity({status: "fulfilled"}),
            beats: [beatWithScene({id: 1, kind: "payoff", sceneId: 20, sceneStatus: "archived"})],
        });

        await service.syncFulfilledAfterSceneChange(20);

        expect(repository.updatePromise).toHaveBeenCalledWith(5, {status: "open"});
    });

    it("revertFulfilledWithoutValidPayoff 只回退 fulfilled;open/abandoned 不受影响", async () => {
        const {service, repository} = createService({
            promise: promiseEntity({status: "abandoned"}),
            beats: [],
        });

        await service.revertFulfilledWithoutValidPayoff([5]);

        expect(repository.updatePromise).not.toHaveBeenCalled();
    });

    it("listStoryPromises 排序 open 优先、importance 高在前;派生态与 beat 三态计数正确", async () => {
        const paidOff = withBeats(
            promiseEntity({id: 1, name: "crown", title: "王冠", status: "fulfilled", importance: "high"}),
            [beatWithScene({id: 11, kind: "payoff", sceneId: 30, sceneStatus: "written", promiseId: 1})],
        );
        const echoed = withBeats(
            promiseEntity({id: 3, name: "mask", title: "面具", status: "open", importance: "high"}),
            [
                // plant 计划中、advance 已成文、payoff 挂在 archived 场(不参与派生)。
                beatWithScene({id: 31, kind: "plant", sceneId: 40, sceneStatus: "active", promiseId: 3}),
                beatWithScene({id: 32, kind: "advance", sceneId: 41, sceneStatus: "written", promiseId: 3}),
                beatWithScene({id: 33, kind: "payoff", sceneId: 42, sceneStatus: "archived", promiseId: 3}),
            ],
        );
        const unplanted = withBeats(
            promiseEntity({id: 2, name: "letter", title: "信件", status: "open", importance: "low"}),
            [],
        );
        const repository = {
            findPromisesByStory: vi.fn(async () => [paidOff, unplanted, echoed]),
        };
        const storyService = {ensureStory: vi.fn(async () => ({id: 10}))} as unknown as StoryService;
        const service = new PromiseService(
            repository as unknown as PromiseRepository,
            storyService,
            {} as PlotScopeGuard,
            new PlotDtoAssembler(),
        );

        const result = await service.listStoryPromises();

        // open 优先(高 importance 在前),fulfilled 殿后。
        expect(result.map((item) => item.id)).toEqual(["3", "2", "1"]);
        expect(result[2]).toMatchObject({derivedStage: "paid_off", beatStats: {payoff: 1, factual: 1}});
        // archived 场上的 payoff 不计入 kind 计数,派生停在 echoed;三态计数 planned/factual/archived 各 1。
        expect(result[0]).toMatchObject({
            derivedStage: "echoed",
            beatStats: {plant: 1, advance: 1, setback: 0, payoff: 0, planned: 1, factual: 1, archived: 1},
        });
        expect(result[1]).toMatchObject({derivedStage: "unplanted"});
    });
});
