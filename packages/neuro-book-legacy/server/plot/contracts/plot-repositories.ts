import type {
    Story,
    StoryAct,
    StoryChapter,
    StoryDecision,
    StoryPhase,
    StoryPromise,
    StoryPromiseBeat,
    StoryScene,
    StoryThread,
} from "nbook/server/generated/project-prisma/client";
import type {
    ChapterBriefColumns,
    ChapterPlotSceneWithThread,
    ChapterWriterBriefSceneWithThread,
    ResolvedStoryDecisionAnchor,
    ResolvedStoryRefInput,
    StoryActWithChapters,
    StoryDecisionEntity,
    StoryDecisionOption,
    StoryDecisionRejectedAlternative,
    StoryPromiseBeatWithPromise,
    StoryPromiseBeatWithScene,
    StoryPromiseEntity,
    StoryPromiseWithBeats,
    StoryThreadEntity,
    StorySceneWithChapter,
    StorySceneWithDetails,
    StoryThreadWithScenes,
    StoryWorkbenchPhase,
    StoryWorkbenchThread,
} from "nbook/server/plot/core/types";

/**
 * Story 仓储接口。
 */
export interface StoryRepository {
    findStory(): Promise<Story | null>;
    createStory(input: {title: string; summary: string}): Promise<Story>;
    updateStory(storyId: number, data: Partial<Pick<Story, "title" | "summary" | "note">>): Promise<Story>;
    findPhaseById(phaseId: number): Promise<StoryPhase | null>;
    findPhasesByStory(storyId: number): Promise<StoryPhase[]>;
    findPhaseIdsByStory(storyId: number): Promise<number[]>;
    createPhase(input: {storyId: number; sortOrder: number; name: string; title: string; summary: string; note: string | null}): Promise<StoryPhase>;
    updatePhase(phaseId: number, data: Partial<Pick<StoryPhase, "name" | "title" | "summary" | "note" | "sortOrder">>): Promise<StoryPhase>;
    deletePhase(phaseId: number): Promise<void>;
    findPhaseByName(storyId: number, name: string, excludePhaseId?: number): Promise<StoryPhase | null>;
}

/**
 * Thread 仓储接口。
 */
export interface ThreadRepository {
    findThreadById(threadId: number): Promise<StoryThreadEntity | null>;
    findThreadWithScenesById(threadId: number): Promise<StoryThreadWithScenes | null>;
    findThreadIdsByStory(storyId: number): Promise<number[]>;
    findThreadsByStoryPhase(storyId: number, storyPhaseId: number | null): Promise<StoryThreadEntity[]>;
    findThreadByName(storyId: number, name: string, excludeThreadId?: number): Promise<StoryThreadEntity | null>;
    createThread(input: {
        storyId: number;
        storyPhaseId: number | null;
        sortOrder: number;
        name: string;
        title: string;
        isMainThread: boolean;
        status: StoryThread["status"];
        miceType: StoryThread["miceType"];
        summary: string;
        tags: string[];
        writingTip: string | null;
        note: string | null;
    }): Promise<StoryThreadEntity>;
    updateThread(threadId: number, data: Partial<Pick<
        StoryThread,
        "storyPhaseId" | "sortOrder" | "name" | "title" | "isMainThread" | "status" | "miceType" | "summary" | "writingTip" | "note"
    >> & {tags?: string[]}): Promise<StoryThreadEntity>;
    deleteThread(threadId: number): Promise<void>;
    findThreadTargetByName(storyId: number, name: string): Promise<Pick<StoryThread, "id" | "name"> | null>;
    findUngroupedThreads(storyId: number): Promise<Array<StoryThreadEntity & {scenes: StorySceneWithChapter[]}>>;
    findPhaseThreadsWithScenes(storyId: number): Promise<Array<StoryPhase & {threads: Array<StoryThreadEntity & {scenes: StorySceneWithChapter[]}>}>>;
    findUngroupedWorkbenchThreads(storyId: number): Promise<StoryWorkbenchThread[]>;
    findWorkbenchPhaseThreads(storyId: number): Promise<StoryWorkbenchPhase[]>;
}

/**
 * Act / Chapter(承载树)仓储接口。
 */
export interface ChapterRepository {
    findActById(actId: number): Promise<StoryAct | null>;
    findActsByStory(storyId: number): Promise<StoryAct[]>;
    findActByName(storyId: number, name: string, excludeActId?: number): Promise<StoryAct | null>;
    findActsWithChapters(storyId: number): Promise<StoryActWithChapters[]>;
    createAct(input: {storyId: number; sortOrder: number; name: string; title: string; summary: string; note: string | null}): Promise<StoryAct>;
    updateAct(actId: number, data: Partial<Pick<StoryAct, "name" | "title" | "summary" | "note" | "sortOrder">>): Promise<StoryAct>;
    deleteAct(actId: number): Promise<void>;
    findChapterById(chapterId: number): Promise<StoryChapter | null>;
    findChaptersByStory(storyId: number): Promise<StoryChapter[]>;
    findUngroupedChapters(storyId: number): Promise<StoryChapter[]>;
    findChapterByName(storyId: number, name: string, excludeChapterId?: number): Promise<StoryChapter | null>;
    createChapter(input: {storyId: number; actId: number | null; sortOrder: number; name: string; title: string; note: string | null} & Partial<ChapterBriefColumns>): Promise<StoryChapter>;
    updateChapter(chapterId: number, data: Partial<Pick<StoryChapter, "actId" | "sortOrder" | "name" | "title" | "note">> & Partial<ChapterBriefColumns>): Promise<StoryChapter>;
    deleteChapter(chapterId: number): Promise<void>;
}

/**
 * Scene 仓储接口。
 */
export interface SceneRepository {
    findSceneById(sceneId: number): Promise<StoryScene | null>;
    findSceneWithDetailsById(sceneId: number): Promise<StorySceneWithDetails | null>;
    findChapterScenes(chapterId: number): Promise<ChapterPlotSceneWithThread[]>;
    findChapterScenesForBrief(chapterId: number): Promise<ChapterWriterBriefSceneWithThread[]>;
    findSceneIdsByStory(storyId: number): Promise<number[]>;
    createScene(input: {
        storyId: number;
        threadId: number;
        chapterId: number | null;
        threadSortOrder: number;
        chapterSortOrder: number | null;
        title: string;
        status: StoryScene["status"];
        outcomeType: StoryScene["outcomeType"];
        pacingRole: StoryScene["pacingRole"];
        summary: string;
        purpose: string | null;
        writingTip: string | null;
        note: string | null;
        startInstant: bigint | null;
        endInstant: bigint | null;
        subjectIdsJson: string;
        locationSubjectId: string | null;
    }): Promise<StoryScene>;
    updateScene(sceneId: number, data: Partial<Pick<
        StoryScene,
        "threadId" | "chapterId" | "threadSortOrder" | "chapterSortOrder" | "title" | "status" | "outcomeType" | "pacingRole" | "summary" | "purpose" | "writingTip" | "note" | "startInstant" | "endInstant" | "subjectIdsJson" | "locationSubjectId"
    >>): Promise<StoryScene>;
    deleteScene(sceneId: number): Promise<void>;
    replaceRefs(sceneId: number, refs: ResolvedStoryRefInput[]): Promise<void>;
    findScenesByThread(threadId: number): Promise<Pick<StoryScene, "id" | "threadSortOrder">[]>;
    findScenesByChapter(chapterId: number): Promise<Pick<StoryScene, "id" | "chapterSortOrder">[]>;
}

/**
 * Promise(读者债务账本)仓储接口。
 * beats 聚合始终带所在 Scene(含章摘要):派生态、三态与章位都依赖 Scene.status/chapter。
 */
export interface PromiseRepository {
    findPromiseById(promiseId: number): Promise<StoryPromiseEntity | null>;
    findPromiseWithBeatsById(promiseId: number): Promise<StoryPromiseWithBeats | null>;
    findPromisesByStory(storyId: number): Promise<StoryPromiseWithBeats[]>;
    findPromiseByName(storyId: number, name: string, excludePromiseId?: number): Promise<StoryPromiseEntity | null>;
    countOpenPromisesByStory(storyId: number): Promise<number>;
    createPromise(input: {
        storyId: number;
        name: string;
        title: string;
        importance: StoryPromise["importance"];
        summary: string;
        payoffExpectation: string | null;
        cadenceChapters: number | null;
        deadlineChapterId: number | null;
        tags: string[];
    }): Promise<StoryPromiseEntity>;
    updatePromise(promiseId: number, data: Partial<Pick<
        StoryPromise,
        "name" | "title" | "status" | "importance" | "summary" | "payoffExpectation" | "cadenceChapters" | "deadlineChapterId"
    >> & {tags?: string[]}): Promise<StoryPromiseEntity>;
    deletePromise(promiseId: number): Promise<void>;
    /** 同场同线仅一条(唯一约束 promiseId×sceneId):存在则覆盖 kind/note,不存在则创建。 */
    upsertBeat(input: {promiseId: number; sceneId: number; kind: StoryPromiseBeat["kind"]; note: string | null}): Promise<StoryPromiseBeat>;
    findBeat(promiseId: number, sceneId: number): Promise<StoryPromiseBeat | null>;
    deleteBeat(promiseId: number, sceneId: number): Promise<void>;
    /** 查询 Scene 上全部 beats(带所属 Promise 摘要);scene detail 与回退收集用。 */
    findBeatsByScene(sceneId: number): Promise<StoryPromiseBeatWithPromise[]>;
    /** 查询 Promise 的全部 beats(带所在 Scene);fulfilled 回退边界判定用。 */
    findBeatsByPromise(promiseId: number): Promise<StoryPromiseBeatWithScene[]>;
}

/**
 * Decision(ADR 式决策记录)仓储接口。
 * options/rejectedAlternatives/serves/dependsOn 的 JSON 归一化在仓储层完成,service 只见结构化数组。
 */
export interface DecisionRepository {
    findDecisionById(decisionId: number): Promise<StoryDecisionEntity | null>;
    findDecisionsByStory(storyId: number): Promise<StoryDecisionEntity[]>;
    findDecisionByName(storyId: number, name: string, excludeDecisionId?: number): Promise<StoryDecisionEntity | null>;
    countOpenDecisionsByStory(storyId: number): Promise<number>;
    createDecision(input: {
        storyId: number;
        name: string;
        title: string;
        question: string;
        options: StoryDecisionOption[];
        deadlineChapterId: number | null;
        serves: string[];
        dependsOn: string[];
        note: string | null;
    } & ResolvedStoryDecisionAnchor): Promise<StoryDecisionEntity>;
    updateDecision(decisionId: number, data: Partial<Pick<
        StoryDecision,
        "name" | "title" | "status" | "question" | "deadlineChapterId" | "decision" | "motivation" | "risk" | "supersededById"
        | "anchorKind" | "anchorActId" | "anchorChapterId" | "anchorThreadId" | "anchorSceneId" | "anchorPromiseId" | "anchorPath" | "note"
    >> & {
        options?: StoryDecisionOption[];
        rejectedAlternatives?: StoryDecisionRejectedAlternative[];
        serves?: string[];
        dependsOn?: string[];
    }): Promise<StoryDecisionEntity>;
    deleteDecision(decisionId: number): Promise<void>;
    /** 批量核对引用目标存在性(同 story;死引用标注与写入校验共用),返回各类别中真实存在的 id 集合。 */
    findExistingRefIds(storyId: number, ids: {
        promiseIds: number[];
        decisionIds: number[];
        threadIds: number[];
        sceneIds: number[];
    }): Promise<{
        promiseIds: Set<number>;
        decisionIds: Set<number>;
        threadIds: Set<number>;
        sceneIds: Set<number>;
    }>;
}
