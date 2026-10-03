import type {Prisma} from "nbook/server/generated/project-prisma/client";
import type {
    StoryAct,
    StoryChapter,
    StoryDecision,
    StoryPhase,
    StoryPromise,
    StoryPromiseBeat,
    StoryScene,
    StorySceneRef,
    StoryThread,
} from "nbook/server/generated/project-prisma/client";
import type {
    CreateStoryActRequestDto,
    CreateStoryChapterRequestDto,
    CreateStoryDecisionRequestDto,
    CreateStoryPromiseRequestDto,
    CreateStorySceneRequestDto,
    CreateStoryThreadRequestDto,
    ReorderStoryPhasesRequestDto,
    ReorderStoryScenesRequestDto,
    ReorderStoryThreadsRequestDto,
    SetPromiseBeatRequestDto,
    StoryRefDto,
    UpdateStoryActRequestDto,
    UpdateStoryChapterRequestDto,
    UpdateStoryDecisionRequestDto,
    UpdateStoryPromiseRequestDto,
    UpdateStorySceneRequestDto,
    UpdateStoryThreadRequestDto,
} from "nbook/shared/dto/plot.dto";
import type {Instant} from "nbook/server/world-engine/types";

/**
 * 剧情模块可用的 Prisma 执行器。
 */
export type PrismaExecutor = Prisma.TransactionClient | {
    story: Prisma.TransactionClient["story"];
    storyAct: Prisma.TransactionClient["storyAct"];
    storyChapter: Prisma.TransactionClient["storyChapter"];
    storyPhase: Prisma.TransactionClient["storyPhase"];
    storyThread: Prisma.TransactionClient["storyThread"];
    storyScene: Prisma.TransactionClient["storyScene"];
    storySceneRef: Prisma.TransactionClient["storySceneRef"];
    storyPromise: Prisma.TransactionClient["storyPromise"];
    storyPromiseBeat: Prisma.TransactionClient["storyPromiseBeat"];
    storyDecision: Prisma.TransactionClient["storyDecision"];
    $executeRaw: Prisma.TransactionClient["$executeRaw"];
    $executeRawUnsafe: Prisma.TransactionClient["$executeRawUnsafe"];
};

/**
 * Scene 与 World Engine 的桥接锚点。
 */
export type SceneWorldAnchor = {
    // `null` 表示 Scene 尚未连接 World Engine 起点。
    startInstant: Instant | null;
    // `null` 表示 Scene 尚未连接 World Engine 终点。
    endInstant: Instant | null;
    subjectIds: string[];
    // `null` 表示 Scene 没有指定地点 subject。
    locationSubjectId: string | null;
};

/**
 * Scene ref 查询结果。
 */
export type StorySceneRefWithTargets = StorySceneRef & {
    targetThread: Pick<StoryThread, "id" | "name"> | null;
    targetScene: Pick<StoryScene, "id"> | null;
};

/**
 * Plot 层对外使用的 Thread 实体。
 *
 * 数据库中 `tags` 使用 JSON array 文本以兼容 SQLite/Postgres；进入 Plot
 * service 后统一归一化为 string[]，避免 DTO 和前端感知持久化差异。
 */
export type StoryThreadEntity = Omit<StoryThread, "tags"> & {
    tags: string[];
};

/**
 * Scene 上内嵌的 Chapter 轻量引用。
 */
export type StoryChapterRef = Pick<StoryChapter, "id" | "name" | "title">;

/**
 * 带所属 Chapter 摘要的 Scene 读取模型;`chapter` 为空表示 Scene 未挂章。
 */
export type StorySceneWithChapter = StoryScene & {
    chapter: StoryChapterRef | null;
};

/**
 * ChapterBrief 的数据库列展开(StoryChapter 上的 brief* 字段组)。
 */
export type ChapterBriefColumns = Pick<
    StoryChapter,
    "briefGoal" | "briefPov" | "briefTone" | "briefPacing"
    | "briefReaderKnows" | "briefProtagonistKnows" | "briefMustHide" | "briefHintOnly"
    | "briefOpening" | "briefEnding" | "briefDoNotWrite"
>;

/**
 * 带 Chapter 的 Act 聚合结果(承载树节点)。
 */
export type StoryActWithChapters = StoryAct & {
    chapters: StoryChapter[];
};

/**
 * Thread 详情聚合结果，不包含 refs。
 */
export type StoryThreadWithScenes = StoryThreadEntity & {
    scenes: StorySceneWithChapter[];
};

/**
 * Scene 详情聚合结果。
 */
export type StorySceneWithDetails = StorySceneWithChapter & {
    refs: StorySceneRefWithTargets[];
    thread: StoryThreadEntity;
    promiseBeats: StoryPromiseBeatWithPromise[];
};

/**
 * Plot 层对外使用的 Promise 实体。
 * 数据库中 `tags` 是 JSON array 文本;进入 service 后统一归一化为 string[]。
 */
export type StoryPromiseEntity = Omit<StoryPromise, "tags"> & {
    tags: string[];
};

/**
 * beat + 所在 Scene(含所属章轻量摘要)聚合。
 * Scene.status 驱动 beat 三态派生;chapter 提供章位展示。
 */
export type StoryPromiseBeatWithScene = StoryPromiseBeat & {
    scene: StorySceneWithChapter;
};

/**
 * Promise 详情聚合:beats 及其所在场/章位 + 期限章轻量摘要;派生态从 beats 计算。
 */
export type StoryPromiseWithBeats = StoryPromiseEntity & {
    beats: StoryPromiseBeatWithScene[];
    // `deadlineChapter` 为空表示无兑现期限或期限章已被删除(外键 SetNull)。
    deadlineChapter: StoryChapterRef | null;
};

/**
 * Scene 视角的 beat + 所属 Promise 摘要(scene detail 的 promiseBeats 与 brief 任务段共用)。
 * payoffExpectation 供 brief「本章 Promise 任务」段在兑现场输出预期戏剧效果(D25)。
 */
export type StoryPromiseBeatWithPromise = StoryPromiseBeat & {
    promise: Pick<StoryPromise, "id" | "name" | "title" | "status" | "payoffExpectation">;
};

/**
 * Decision open 态候选方案条目(options JSON 的元素)。
 */
export type StoryDecisionOption = {
    option: string;
    // `note` 为空表示该候选没有补充说明。
    note: string | null;
};

/**
 * Decision decided 态否决记录条目(rejectedAlternatives JSON 的元素)。
 * decide 转换从 options 未选项生成骨架(whyRejected=null),理由由调用方补(D11)。
 */
export type StoryDecisionRejectedAlternative = {
    option: string;
    // `whyRejected` 为空表示否决理由尚未补全。
    whyRejected: string | null;
};

/**
 * Plot 层对外使用的 Decision 实体。
 * 数据库中 options/rejectedAlternatives/serves/dependsOn 是 JSON 文本;进入 service 后统一归一化为结构化数组。
 */
export type StoryDecisionEntity = Omit<StoryDecision, "options" | "rejectedAlternatives" | "serves" | "dependsOn"> & {
    options: StoryDecisionOption[];
    rejectedAlternatives: StoryDecisionRejectedAlternative[];
    serves: string[];
    dependsOn: string[];
};

/**
 * serves/dependsOn 引用条目的读取解析结果(D12 死引用容错)。
 */
export type StoryDecisionRefResolved = {
    target: string;
    // 目标剧情对象已被删除(JSON 引用无 SetNull 保护)时 false;content 路径不校验存在性,恒 true。
    valid: boolean;
};

/**
 * Decision 读取聚合:引用死引用标注与期限章摘要已由 service 解析,assembler 只做 DTO 映射。
 */
export type StoryDecisionResolved = Omit<StoryDecisionEntity, "serves" | "dependsOn"> & {
    // `deadlineChapter` 为空且 deadlineChapterId 非空 = 期限章已被删除(死引用,无外键保护)。
    deadlineChapter: StoryChapterRef | null;
    serves: StoryDecisionRefResolved[];
    dependsOn: StoryDecisionRefResolved[];
};

/**
 * Decision anchor 解析结果:kind 已按载体路由到对应外键列,其余列为 null(写库形态)。
 */
export type ResolvedStoryDecisionAnchor = {
    anchorKind: StoryDecision["anchorKind"];
    anchorActId: number | null;
    anchorChapterId: number | null;
    anchorThreadId: number | null;
    anchorSceneId: number | null;
    anchorPromiseId: number | null;
    anchorPath: string | null;
};

/**
 * Decision 创建输入(HTTP DTO 的 id 字符串已解析为 number)。
 */
export type ParsedCreateStoryDecisionInput = Omit<CreateStoryDecisionRequestDto, "deadlineChapterId"> & {
    // `deadlineChapterId` 为 null 表示无拍板期限。
    deadlineChapterId: number | null;
};

/**
 * Decision 更新输入。
 */
export type ParsedUpdateStoryDecisionInput = Omit<UpdateStoryDecisionRequestDto, "deadlineChapterId" | "supersededById"> & {
    // `deadlineChapterId` 为 undefined 表示不修改;null 表示清空拍板期限。
    deadlineChapterId?: number | null;
    // `supersededById` 为 undefined 表示不修改;null 表示清空取代链接。
    supersededById?: number | null;
};

/**
 * Promise 创建输入(HTTP DTO 的 id 字符串已解析为 number)。
 */
export type ParsedCreateStoryPromiseInput = Omit<CreateStoryPromiseRequestDto, "deadlineChapterId"> & {
    // `deadlineChapterId` 为 null 表示无兑现期限。
    deadlineChapterId: number | null;
};

/**
 * Promise 更新输入。
 */
export type ParsedUpdateStoryPromiseInput = Omit<UpdateStoryPromiseRequestDto, "deadlineChapterId"> & {
    // `deadlineChapterId` 为 undefined 表示不修改;null 表示清空兑现期限。
    deadlineChapterId?: number | null;
};

/**
 * beat set 输入(upsert:同场同线仅一条)。
 */
export type ParsedSetPromiseBeatInput = Omit<SetPromiseBeatRequestDto, "sceneId"> & {
    sceneId: number;
};

/**
 * Workbench Scene 聚合结果。
 */
export type StoryWorkbenchScene = StorySceneWithChapter & {
    refs: StorySceneRefWithTargets[];
};

/**
 * Workbench Thread 聚合结果。
 */
export type StoryWorkbenchThread = StoryThreadEntity & {
    scenes: StoryWorkbenchScene[];
};

/**
 * Workbench Phase 聚合结果。
 */
export type StoryWorkbenchPhase = StoryPhase & {
    threads: StoryWorkbenchThread[];
};

/**
 * 章节剧情详情聚合结果。
 */
export type ChapterPlotSceneWithThread = StoryScene & {
    thread: Pick<StoryThread, "id" | "title" | "isMainThread">;
};

/**
 * Chapter writer brief 专用 Scene read model。带 refs 以便编译「建议读取」。
 */
export type ChapterWriterBriefSceneWithThread = StoryScene & {
    thread: Pick<StoryThread, "id" | "title" | "isMainThread" | "summary" | "writingTip">;
    refs: StorySceneRefWithTargets[];
};

/**
 * Act 创建输入。
 */
export type ParsedCreateStoryActInput = CreateStoryActRequestDto;

/**
 * Act 更新输入。
 */
export type ParsedUpdateStoryActInput = UpdateStoryActRequestDto;

/**
 * Chapter 创建输入。
 */
export type ParsedCreateStoryChapterInput = Omit<CreateStoryChapterRequestDto, "actId"> & {
    // `actId` 为 null 表示创建未归卷章节。
    actId: number | null;
};

/**
 * Chapter 更新输入。
 */
export type ParsedUpdateStoryChapterInput = Omit<UpdateStoryChapterRequestDto, "actId"> & {
    // `actId` 为 undefined 表示不修改;null 表示移动到未归卷区。
    actId?: number | null;
};

/**
 * 解析后的引用写入结构。
 */
export type ResolvedStoryRefInput = {
    sortOrder: number;
    relation: string;
    rawTarget: string;
    targetKind: "content" | "thread" | "scene";
    targetThreadId: number | null;
    targetSceneId: number | null;
    visibility: StoryRefDto["visibility"];
    // `note` 为空表示该引用没有额外备注。
    note: string | null;
};

/**
 * 剧情阶段重排项。
 */
export type ParsedReorderStoryPhaseItem = {
    phaseId: number;
    sortOrder: number;
};

/**
 * 剧情线程重排项。
 */
export type ParsedReorderStoryThreadItem = {
    threadId: number;
    storyPhaseId: number | null;
    sortOrder: number;
};

/**
 * 剧情场景重排项。
 */
export type ParsedReorderStorySceneItem = {
    sceneId: number;
    threadId: number;
    chapterId: number | null;
    threadSortOrder: number;
    chapterSortOrder: number | null;
};

/**
 * 线程创建输入。
 */
export type ParsedCreateStoryThreadInput = Omit<CreateStoryThreadRequestDto, "storyPhaseId"> & {
    storyPhaseId: number | null;
};

/**
 * 线程更新输入。
 */
export type ParsedUpdateStoryThreadInput = Omit<UpdateStoryThreadRequestDto, "storyPhaseId"> & {
    // `storyPhaseId` 为 undefined 表示不修改；null 表示移动到未分组。
    storyPhaseId?: number | null;
};

/**
 * 场景创建输入。
 */
export type ParsedCreateStorySceneInput = Omit<CreateStorySceneRequestDto, "threadId" | "chapterId" | "refs" | "worldAnchor"> & {
    threadId: number;
    chapterId: number | null;
    refs: StoryRefDto[];
    // `resolvedRefs` 非空表示内容层已经完成目标存在性校验，可直接写库。
    resolvedRefs?: ResolvedStoryRefInput[];
    worldAnchor: SceneWorldAnchor;
};

/**
 * 场景更新输入。
 */
export type ParsedUpdateStorySceneInput = Omit<UpdateStorySceneRequestDto, "threadId" | "chapterId" | "refs" | "worldAnchor"> & {
    // `threadId` 为 undefined 表示不修改所属线程。
    threadId?: number;
    // `chapterId` 为 undefined 表示不修改；null 表示从章节顺序中移除。
    chapterId?: number | null;
    refs?: StoryRefDto[];
    // `resolvedRefs` 非空表示内容层已经完成目标存在性校验，可直接写库。
    resolvedRefs?: ResolvedStoryRefInput[];
    // `worldAnchor` 为 undefined 表示不修改 World Engine 桥接锚点。
    worldAnchor?: SceneWorldAnchor;
};

export type ReorderStoryPhaseItem = ReorderStoryPhasesRequestDto["items"][number];
export type ReorderStoryThreadItem = ReorderStoryThreadsRequestDto["items"][number];
export type ReorderStorySceneItem = ReorderStoryScenesRequestDto["items"][number];
