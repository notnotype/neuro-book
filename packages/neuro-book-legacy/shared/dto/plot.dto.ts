import {z} from "zod";
import {
    withWriteDiagnosticsSchema,
} from "nbook/shared/dto/write-response";
import {
    MAX_REFERENCE_COUNT,
    MAX_REFERENCE_NOTE_LENGTH,
    MAX_REFERENCE_RELATION_LENGTH,
    MAX_REFERENCE_TARGET_LENGTH,
    ReferenceVisibilitySchema,
    StoryStructuredReferenceKindSchema,
    StructuredReferenceDtoSchema,
} from "nbook/shared/reference-core";

export const MAX_STORY_NAME_LENGTH = 120;
export const MAX_STORY_TITLE_LENGTH = 120;
export const MAX_STORY_SUMMARY_LENGTH = 5_000;
export const MAX_STORY_NOTE_LENGTH = 5_000;
export const MAX_STORY_TIP_LENGTH = 2_000;
export const MAX_STORY_RELATION_LENGTH = MAX_REFERENCE_RELATION_LENGTH;
export const MAX_STORY_TARGET_LENGTH = MAX_REFERENCE_TARGET_LENGTH;
export const MAX_STORY_TAG_LENGTH = 120;
export const MAX_STORY_TAG_COUNT = 50;
export const MAX_STORY_REFS_COUNT = MAX_REFERENCE_COUNT;
export const MAX_STORY_SCENE_SUBJECT_COUNT = 100;

const NonEmptyStringSchema = z.string().trim().min(1, "不能为空");
const StoryNameSchema = z.string()
    .trim()
    .min(1, "name 不能为空")
    .max(MAX_STORY_NAME_LENGTH, "name 过长")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "name 仅允许小写字母、数字和中划线");
const StoryShortTextSchema = z.string().trim().min(1, "不能为空").max(MAX_STORY_TAG_LENGTH, "内容过长");
const StorySummarySchema = z.string().max(MAX_STORY_SUMMARY_LENGTH, "summary 过长");
const StoryNoteSchema = z.string().max(Math.max(MAX_STORY_NOTE_LENGTH, MAX_REFERENCE_NOTE_LENGTH), "note 过长");
const StoryTipSchema = z.string().max(MAX_STORY_TIP_LENGTH, "writingTip 过长");

type PlotJsonValue = null | boolean | number | string | PlotJsonValue[] | {[key: string]: PlotJsonValue};
const PlotJsonValueSchema: z.ZodType<PlotJsonValue> = z.lazy(() => z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(PlotJsonValueSchema),
    z.record(z.string(), PlotJsonValueSchema),
]));

export const StoryThreadStatusSchema = z.enum(["active", "draft", "paused", "done", "archived"]);
export const StorySceneStatusSchema = z.enum(["draft", "active", "written", "revised", "archived"]);
// MICE Quotient 线型:决定"这条线怎样才算关"(idea=谜底揭晓,character=身份认同达成)。null=未填写。
export const StoryThreadMiceTypeSchema = z.enum(["milieu", "idea", "character", "event"]);
// 本场主要行动者主动尝试的结果。null 仅=未填写(D29);非冲突场显式填 no_conflict,被动承受场填 passive。
export const StorySceneOutcomeTypeSchema = z.enum(["yes_but", "no_and", "yes_and", "no_but", "yes", "no", "no_conflict", "passive"]);
// 张弛角色;节奏检查按承载树章序投影消费。null=未填写。
export const StoryScenePacingRoleSchema = z.enum(["setup", "escalation", "breather", "climax", "resolution"]);
// Promise 存储态(作者意图):open/fulfilled/abandoned;中间态从 beats 派生,见 StoryPromiseDerivedStageSchema。
export const StoryPromiseStatusSchema = z.enum(["open", "fulfilled", "abandoned"]);
export const StoryPromiseImportanceSchema = z.enum(["low", "medium", "high"]);
// beat 类型:plant(建立)/advance(推进/呼应/投喂)/setback(反挫,含假揭露)/payoff(兑现)。
export const StoryPromiseBeatKindSchema = z.enum(["plant", "advance", "setback", "payoff"]);
// Promise 派生阶段(D5:中间态从有效 beats 派生,不落库;有效 beat=所在 Scene 非 archived):
// unplanted=尚无有效 beat;planted=仅埋设;echoed=已有推进/反挫;paid_off=已有兑现 beat。
export const StoryPromiseDerivedStageSchema = z.enum(["unplanted", "planted", "echoed", "paid_off"]);
// beat 计划/事实/不参与三态,由所在 Scene.status 派生(D2a/D5):
// draft/active=planned(计划),written/revised=factual(事实),archived=archived(不参与任何派生,记录保留)。
export const StoryPromiseBeatStateSchema = z.enum(["planned", "factual", "archived"]);
// Decision(ADR)生命周期:open(待决)/decided(已拍板)/superseded(被新决策取代)/dropped(问题因剧情改道失效,D11)。
export const StoryDecisionStatusSchema = z.enum(["open", "decided", "superseded", "dropped"]);
// Decision 主锚点类型(D12):story=锚在全书层(无更窄载体),content 用 anchorPath 存内容节点路径。
export const StoryDecisionAnchorKindSchema = z.enum(["story", "act", "chapter", "thread", "scene", "promise", "content"]);
export const StoryRefTargetKindSchema = StoryStructuredReferenceKindSchema;
export const StoryRefVisibilitySchema = ReferenceVisibilitySchema;

export const StoryRefDtoSchema = StructuredReferenceDtoSchema.extend({
    visibility: StoryRefVisibilitySchema,
    note: StoryNoteSchema.nullable().optional().default(null),
});

export const StoryEffectiveRefDtoSchema = StoryRefDtoSchema.extend({
    sourceType: z.enum(["scene"]),
    sourceId: z.string(),
});

const StoryRefsInputSchema = z.array(StoryRefDtoSchema).max(MAX_STORY_REFS_COUNT, "refs 过多");
const StoryTagsInputSchema = z.array(StoryShortTextSchema).max(MAX_STORY_TAG_COUNT, "tags 过多");

export const StorySceneWorldAnchorInputDtoSchema = z.object({
    // `startTime` 为空表示 Scene 尚未连接 World Engine 起点。
    startTime: z.string().trim().min(1, "startTime 不能为空").nullable(),
    // `endTime` 为空表示 Scene 尚未连接 World Engine 终点。
    endTime: z.string().trim().min(1, "endTime 不能为空").nullable(),
    // `startInstant` 只用字符串承载 bigint，普通 UI 不直接编辑。
    startInstant: z.string().nullable(),
    // `endInstant` 只用字符串承载 bigint，普通 UI 不直接编辑。
    endInstant: z.string().nullable(),
    subjectIds: z.array(z.string().trim().min(1, "subjectId 不能为空")).max(MAX_STORY_SCENE_SUBJECT_COUNT, "出场 subjects 过多"),
    // `locationSubjectId` 为空表示 Scene 没有指定地点 subject。
    locationSubjectId: z.string().trim().min(1, "locationSubjectId 不能为空").nullable(),
});

export const StorySceneWorldAnchorSubjectDtoSchema = z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    resolved: z.boolean(),
});

export const StorySceneWorldAnchorDtoSchema = StorySceneWorldAnchorInputDtoSchema.extend({
    subjects: z.array(StorySceneWorldAnchorSubjectDtoSchema),
    // `locationSubject` 为空表示未指定地点；resolved=false 表示占位 subject 尚未接入 World Engine。
    locationSubject: StorySceneWorldAnchorSubjectDtoSchema.nullable(),
    unresolvedSubjectIds: z.array(z.string()),
});

export const SceneWorldContextDtoSchema = z.object({
    slices: z.array(z.object({
        id: z.string(),
        time: z.string(),
        title: z.string(),
        summary: z.string(),
        kind: z.string(),
        patchCount: z.number().int().nonnegative(),
    })),
    subjectStates: z.array(z.object({
        subjectId: z.string(),
        type: z.string(),
        name: z.string(),
        attrs: z.record(z.string(), PlotJsonValueSchema),
    })),
    unresolvedSubjectIds: z.array(z.string()),
});

export const StoryDtoSchema = z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    // `note` 为空表示没有额外备注。
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const StoryPhaseDtoSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    sortOrder: z.number().int().nonnegative(),
    name: z.string(),
    title: z.string(),
    summary: z.string(),
    // `note` 为空表示没有额外备注。
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

// 承载树:Act(卷)。与 manuscript volume 目录切割,排序权威在 sortOrder。
export const StoryActDtoSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    sortOrder: z.number().int().nonnegative(),
    name: z.string(),
    title: z.string(),
    summary: z.string(),
    // `note` 为空表示没有额外备注。
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

// ChapterBrief:章级写作指令(POV/信息控制/开头收尾/禁写等)。字段全部可空,
// 空表示该维度未约束、交给 writer 自由发挥;非空即 leader/用户对本章的显式指令,兼作写后审查依据。
export const ChapterBriefDtoSchema = z.object({
    // 章节目标 / 落点。
    goal: z.string().nullable(),
    // 本章视角、叙述距离、切换限制。
    pov: z.string().nullable(),
    // 语气 / 情绪温度 / 风格约束。
    tone: z.string().nullable(),
    // 节奏、悬念、下一章牵引。
    pacing: z.string().nullable(),
    // 信息控制:读者已知。
    readerKnows: z.string().nullable(),
    // 信息控制:主角已知。
    protagonistKnows: z.string().nullable(),
    // 信息控制:必须隐藏。
    mustHide: z.string().nullable(),
    // 信息控制:可暗示但不可明说。
    hintOnly: z.string().nullable(),
    // 开场钩子。
    opening: z.string().nullable(),
    // 章节落点 / 结尾定句。
    ending: z.string().nullable(),
    // 禁写事项。
    doNotWrite: z.string().nullable(),
});

// 承载树:Chapter(章)一等实体。Prose 文件通过 frontmatter `chapter: <name>` 反指本实体。
export const StoryChapterDtoSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    // `actId` 为空表示该章尚未归入具体卷。
    actId: z.string().nullable(),
    sortOrder: z.number().int().nonnegative(),
    name: z.string(),
    title: z.string(),
    // `note` 为空表示没有额外备注。
    note: z.string().nullable(),
    brief: ChapterBriefDtoSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

// Scene 上内嵌的 Chapter 轻量摘要,供列表/树展示,避免 UI 再查一次。
export const StorySceneChapterRefDtoSchema = z.object({
    id: z.string(),
    name: z.string(),
    title: z.string(),
});

export const StoryThreadSummaryDtoSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    // `storyPhaseId` 为空表示当前线程未归入具体阶段。
    storyPhaseId: z.string().nullable(),
    sortOrder: z.number().int().nonnegative(),
    name: z.string(),
    title: z.string(),
    isMainThread: z.boolean(),
    status: StoryThreadStatusSchema,
    // `miceType` 为空表示未填写线型;非空是 MICE 线型(决定"这条线怎样才算关")。
    miceType: StoryThreadMiceTypeSchema.nullable(),
    summary: z.string(),
    tags: z.array(z.string()),
    // `writingTip` 为空表示没有额外写作提示。
    writingTip: z.string().nullable(),
    // `note` 为空表示没有额外备注。
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const StorySceneSummaryDtoSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    threadId: z.string(),
    // `chapterId` 为空表示当前 Scene 还未挂入具体章节。
    chapterId: z.string().nullable(),
    // `chapter` 为空同 chapterId;非空时是所属 Chapter 的轻量摘要。
    chapter: StorySceneChapterRefDtoSchema.nullable(),
    threadSortOrder: z.number().int().nonnegative(),
    // `chapterSortOrder` 为空表示当前 Scene 未进入正文顺序。
    chapterSortOrder: z.number().int().nonnegative().nullable(),
    title: z.string(),
    status: StorySceneStatusSchema,
    // `outcomeType` 为空仅表示未填写(D29);非空是本场主要行动者主动尝试的结果。
    outcomeType: StorySceneOutcomeTypeSchema.nullable(),
    // `pacingRole` 为空表示未填写;非空是本场张弛角色。
    pacingRole: StoryScenePacingRoleSchema.nullable(),
    summary: z.string(),
    // `purpose` 为空表示尚未填写场景功能说明。
    purpose: z.string().nullable(),
    // `writingTip` 为空表示没有额外写作提示。
    writingTip: z.string().nullable(),
    // `note` 为空表示没有额外备注。
    note: z.string().nullable(),
    worldAnchor: StorySceneWorldAnchorDtoSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const StoryThreadDetailDtoSchema = StoryThreadSummaryDtoSchema.extend({
    scenes: z.array(StorySceneSummaryDtoSchema).optional(),
});
export const StoryThreadWriteResponseDtoSchema = withWriteDiagnosticsSchema(StoryThreadDetailDtoSchema);

// 有效 beats(所在 Scene 非 archived)按 kind 的计数 + 三态计数;账本摘要与派生展示用。
export const StoryPromiseBeatStatsDtoSchema = z.object({
    plant: z.number().int().nonnegative(),
    advance: z.number().int().nonnegative(),
    setback: z.number().int().nonnegative(),
    payoff: z.number().int().nonnegative(),
    // 三态计数:planned(计划)/factual(事实)/archived(不参与派生)。
    planned: z.number().int().nonnegative(),
    factual: z.number().int().nonnegative(),
    archived: z.number().int().nonnegative(),
});

// 规划层:Promise(对读者的债务,含伏笔)。形态由字段有无驱动,不设 kind 分类(D2)。
export const StoryPromiseDtoSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    name: z.string(),
    title: z.string(),
    // 存储态(作者意图):open/fulfilled/abandoned。
    status: StoryPromiseStatusSchema,
    // 派生阶段:从有效 beats 派生的中间态,不落库(D5)。
    derivedStage: StoryPromiseDerivedStageSchema,
    importance: StoryPromiseImportanceSchema,
    // 向读者许了什么(账本展示用)。
    summary: z.string(),
    // `payoffExpectation` 为空表示未写预期戏剧效果;非空只给兑现场的 writer(D7)。
    payoffExpectation: z.string().nullable(),
    // `cadenceChapters` 为空表示无节奏提示;非空是提示性参考节奏(非硬约束,D6)。
    cadenceChapters: z.number().int().positive().nullable(),
    // `deadlineChapterId` 为空表示无逾期概念;非空是兑现期限章。
    deadlineChapterId: z.string().nullable(),
    // `deadlineChapter` 为空同 deadlineChapterId;非空是期限章轻量摘要。
    deadlineChapter: StorySceneChapterRefDtoSchema.nullable(),
    // 伏笔按兑现机制四分类推荐词表:setup_payoff/prophecy/motif/mirror(D8),自由扩展。
    tags: z.array(z.string()),
    beatStats: StoryPromiseBeatStatsDtoSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

// beat 所在 Scene 的轻量摘要(含章位),Promise 详情展示"埋/呼/收发生在哪"用。
export const StoryPromiseBeatSceneDtoSchema = z.object({
    id: z.string(),
    threadId: z.string(),
    title: z.string(),
    status: StorySceneStatusSchema,
    // `chapterId` 为空表示所在 Scene 尚未挂章(无章位)。
    chapterId: z.string().nullable(),
    // `chapter` 为空同 chapterId;非空是所在章轻量摘要。
    chapter: StorySceneChapterRefDtoSchema.nullable(),
    // `chapterSortOrder` 为空表示未进入正文顺序。
    chapterSortOrder: z.number().int().nonnegative().nullable(),
});

export const StoryPromiseBeatDtoSchema = z.object({
    id: z.string(),
    promiseId: z.string(),
    sceneId: z.string(),
    kind: StoryPromiseBeatKindSchema,
    // `note` 为空表示本次推进没有单独指示;非空只给该场的 writer(D7)。
    note: z.string().nullable(),
    // 三态:planned(计划)/factual(事实)/archived(不参与派生),由所在 Scene.status 派生。
    state: StoryPromiseBeatStateSchema,
    scene: StoryPromiseBeatSceneDtoSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const StoryPromiseDetailDtoSchema = StoryPromiseDtoSchema.extend({
    beats: z.array(StoryPromiseBeatDtoSchema),
});

// Decision open 态候选方案条目。
export const StoryDecisionOptionDtoSchema = z.object({
    option: z.string().trim().min(1, "option 不能为空"),
    // `note` 为空表示该候选没有补充说明。
    note: StoryNoteSchema.nullable().optional().default(null),
});

// Decision decided 态否决记录条目;decide 转换从 options 未选项生成骨架(whyRejected=null),理由由调用方补(D11)。
export const StoryDecisionRejectedAlternativeDtoSchema = z.object({
    option: z.string().trim().min(1, "option 不能为空"),
    // `whyRejected` 为空表示否决理由尚未补全(decide 转换生成的骨架)。
    whyRejected: StoryNoteSchema.nullable().optional().default(null),
});

// serves/dependsOn 引用条目(读取视图):写入是字符串数组,读取时逐条做死引用标注(D12)。
export const StoryDecisionRefDtoSchema = z.object({
    // 引用原文:promise://{id} / decision://{id} / thread://{id} / scene://{id} 或内容节点相对路径。
    target: z.string(),
    // 死引用标注:目标剧情对象已被删除(JSON 引用无 SetNull 保护)时 false;content 路径不校验存在性,恒 true。
    valid: z.boolean(),
});

// Decision 主锚点写入(D12):整体替换,kind 决定载体必填性,防止 kind 与外键错配。
export const StoryDecisionAnchorInputDtoSchema = z.object({
    kind: StoryDecisionAnchorKindSchema,
    // `id` 在 kind=act/chapter/thread/scene/promise 时必填(对应实体 ID);story/content 不接受。
    id: z.string().trim().min(1, "anchor.id 不能为空").optional(),
    // `path` 在 kind=content 时必填(Project Workspace 相对内容节点路径);其他 kind 不接受。
    path: z.string().trim().min(1, "anchor.path 不能为空").optional(),
}).refine((value) => {
    if (value.kind === "story") {
        return value.id === undefined && value.path === undefined;
    }
    if (value.kind === "content") {
        return value.id === undefined && value.path !== undefined;
    }
    return value.id !== undefined && value.path === undefined;
}, {
    message: "anchor 载体与 kind 不匹配:story 不带 id/path,content 只带 path,其余 kind 只带 id",
});

// 规划层:Decision(ADR 式决策记录,D10/D11)。open 态防 writer 写死,decided 态供审查与接手。
export const StoryDecisionDtoSchema = z.object({
    id: z.string(),
    storyId: z.string(),
    name: z.string(),
    title: z.string(),
    status: StoryDecisionStatusSchema,
    // 待决问题(open 态核心)。
    question: z.string(),
    options: z.array(StoryDecisionOptionDtoSchema),
    // `deadlineChapterId` 为空表示无拍板期限;非空而 deadlineChapter 为空 = 期限章已被删除(死引用,无外键保护)。
    deadlineChapterId: z.string().nullable(),
    // `deadlineChapter` 为空同上;非空是期限章轻量摘要。
    deadlineChapter: StorySceneChapterRefDtoSchema.nullable(),
    // `decision` 为空表示尚未拍板;decided 态非空(服务层校验)。
    decision: z.string().nullable(),
    // `motivation` 为空表示尚未拍板;decided 态非空(服务层校验)。
    motivation: z.string().nullable(),
    rejectedAlternatives: z.array(StoryDecisionRejectedAlternativeDtoSchema),
    // `risk` 为空表示尚未拍板;decided 态必填(writer 的刹车点,D11)。
    risk: z.string().nullable(),
    // 本决策服务的对象(读取视图,含死引用标注)。
    serves: z.array(StoryDecisionRefDtoSchema),
    // 本决策依赖的前置决策/对象(读取视图,含死引用标注)。
    dependsOn: z.array(StoryDecisionRefDtoSchema),
    // `supersededById` 为空表示未被取代;superseded 态非空(服务层校验)。
    supersededById: z.string().nullable(),
    // 主锚点(读时归一化,D12):anchorKind 对应载体被删(外键 SetNull)后视同 story,不回写数据库。
    anchorKind: StoryDecisionAnchorKindSchema,
    // `anchorTargetId` 为空表示锚在全书层或 content;非空是 anchorKind 对应实体 ID。
    anchorTargetId: z.string().nullable(),
    // `anchorPath` 为空表示锚不是内容节点;anchorKind=content 时非空。
    anchorPath: z.string().nullable(),
    // `note` 为空表示没有额外备注;dropped 态承载失效原因(非空,服务层校验)。
    note: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

// Scene 视角的 promise beat:「这场戏服务哪些线」(get_story_scene_context 透出)。
export const StoryScenePromiseBeatDtoSchema = z.object({
    id: z.string(),
    promiseId: z.string(),
    promiseName: z.string(),
    promiseTitle: z.string(),
    promiseStatus: StoryPromiseStatusSchema,
    kind: StoryPromiseBeatKindSchema,
    // `note` 为空表示本次推进没有单独指示。
    note: z.string().nullable(),
    // 三态:由本 Scene 自身 status 派生。
    state: StoryPromiseBeatStateSchema,
});

export const StorySceneDetailDtoSchema = StorySceneSummaryDtoSchema.extend({
    refs: z.array(StoryRefDtoSchema),
    effectiveRefs: z.array(StoryEffectiveRefDtoSchema),
    // 本场上的 promise beats:这场戏服务哪些读者债务线。
    promiseBeats: z.array(StoryScenePromiseBeatDtoSchema),
});
export const StorySceneWriteResponseDtoSchema = withWriteDiagnosticsSchema(StorySceneDetailDtoSchema);

export const ChapterPlotSceneDtoSchema = z.object({
    id: z.string(),
    threadId: z.string(),
    threadTitle: z.string(),
    threadIsMain: z.boolean(),
    chapterId: z.string().nullable(),
    chapterSortOrder: z.number().int().nonnegative().nullable(),
    threadSortOrder: z.number().int().nonnegative(),
    title: z.string(),
    status: StorySceneStatusSchema,
    summary: z.string(),
    purpose: z.string().nullable(),
    worldAnchor: StorySceneWorldAnchorDtoSchema,
});

export const ChapterPlotDetailDtoSchema = z.object({
    chapter: StoryChapterDtoSchema,
    scenes: z.array(ChapterPlotSceneDtoSchema),
    totalScenes: z.number().int().nonnegative(),
});

// Writer 防全知模式:autonomous=writer 自查 World Engine/lorebook,brief 只给查询提示;
// curated=writer 读不到设定源,brief 需带上过滤后的状态摘要,由 leader 投喂。
export const ChapterWriterBriefModeSchema = z.enum(["autonomous", "curated"]);

export const ChapterWriterBriefStatusSchema = z.enum([
    "ready",
    "needs_plot",
    "needs_world_anchor",
    "needs_world_context",
    // 信息控制四项(读者已知/主角已知/必须隐藏/可暗示)全空:信息控制是防全知唯一的按章控制面,必填。
    "needs_chapter_brief",
]);

// brief 编译出的建议读取项。来源于 Scene/Thread 的结构化 refs(content 类),替代 leader 手写设定复述。
export const ChapterWriterBriefReadingDtoSchema = z.object({
    // Project Workspace 相对内容节点路径,例如 lorebook/character/weiluosi/。
    path: z.string(),
    // 关系标签(foreshadows/depends_on 等),作为「为什么读」的 gloss。
    relation: z.string(),
    // `note` 为空表示该 ref 没有额外备注。
    note: z.string().nullable(),
    // 引用来源:来自某个 Scene 还是所属 Thread。
    source: z.enum(["scene", "thread"]),
});

// brief「本章 Promise 任务」条目(D25):本章某场戏上的一个 beat 推进指令。
// archived 场的 beats 与 abandoned 线的 beats 不生成任务(前者不参与派生,后者已被作者放弃)。
export const ChapterWriterBriefPromiseTaskDtoSchema = z.object({
    sceneId: z.string(),
    sceneTitle: z.string(),
    promiseId: z.string(),
    promiseName: z.string(),
    promiseTitle: z.string(),
    kind: StoryPromiseBeatKindSchema,
    // `note` 为空表示该 beat 没有单独指示;非空是本次推进的具体指令(D7,brief 全文输出)。
    note: z.string().nullable(),
    // `payoffExpectation` 仅 kind=payoff 且 Promise 写了预期戏剧效果时非空(D7:只给兑现场的 writer)。
    payoffExpectation: z.string().nullable(),
});

// brief「未决决策警告」条目(D26):触及本章的 open Decision,writer 不得擅自写死。
export const ChapterWriterBriefOpenDecisionDtoSchema = z.object({
    decisionId: z.string(),
    name: z.string(),
    title: z.string(),
    // 待决问题。
    question: z.string(),
    options: z.array(StoryDecisionOptionDtoSchema),
    // 触及本章的原因(锚定本章/本章 Scene/所属 Thread/本章任务涉及的 Promise/story 级拍板期限临近),人类可读。
    reason: z.string(),
});

export const ChapterWriterBriefSceneDtoSchema = z.object({
    id: z.string(),
    threadId: z.string(),
    threadTitle: z.string(),
    threadIsMain: z.boolean(),
    threadSummary: z.string(),
    // `threadWritingTip` 为空表示该 Thread 没有额外写作提示。
    threadWritingTip: z.string().nullable(),
    chapterId: z.string().nullable(),
    chapterSortOrder: z.number().int().nonnegative().nullable(),
    threadSortOrder: z.number().int().nonnegative(),
    title: z.string(),
    status: StorySceneStatusSchema,
    summary: z.string(),
    // `purpose` 为空表示 Scene 没有单独的场景功能说明。
    purpose: z.string().nullable(),
    // `writingTip` 为空表示 Scene 没有单独的写作提示。
    writingTip: z.string().nullable(),
    worldAnchor: StorySceneWorldAnchorDtoSchema,
    // `worldContext` 为空表示该 Scene 尚不能安全提供 World Engine 上下文。
    worldContext: SceneWorldContextDtoSchema.nullable(),
    warnings: z.array(z.string()),
});

export const ChapterWriterBriefDtoSchema = z.object({
    chapter: StoryChapterDtoSchema,
    mode: ChapterWriterBriefModeSchema,
    status: ChapterWriterBriefStatusSchema,
    scenes: z.array(ChapterWriterBriefSceneDtoSchema),
    totalScenes: z.number().int().nonnegative(),
    // 由 Scene/Thread refs 编译的建议读取清单(已按 path 去重)。
    suggestedReading: z.array(ChapterWriterBriefReadingDtoSchema),
    // 本章 Promise 任务(D25):本章各场 beats 的推进指令,按章内 Scene 顺序排列。
    promiseTasks: z.array(ChapterWriterBriefPromiseTaskDtoSchema),
    // 触及本章的未决决策警告(D26):writer 不得擅自写死;第一版不做 status 阻断。
    openDecisions: z.array(ChapterWriterBriefOpenDecisionDtoSchema),
    warnings: z.array(z.string()),
    suggestedBriefMarkdown: z.string().min(1),
});

export const StoryThreadTreeNodeDtoSchema = StoryThreadSummaryDtoSchema.extend({
    scenes: z.array(StorySceneSummaryDtoSchema),
});

export const StoryPhaseTreeNodeDtoSchema = StoryPhaseDtoSchema.extend({
    threads: z.array(StoryThreadTreeNodeDtoSchema),
});

// 承载树节点:Act 携带旗下 Chapter(按 sortOrder 排列)。
export const StoryActTreeNodeDtoSchema = StoryActDtoSchema.extend({
    chapters: z.array(StoryChapterDtoSchema),
});

export const PlotTreeDtoSchema = z.object({
    story: StoryDtoSchema,
    // 因果树:Phase → Thread → Scene。
    phases: z.array(StoryPhaseTreeNodeDtoSchema),
    ungroupedThreads: z.array(StoryThreadTreeNodeDtoSchema),
    // 承载树:Act → Chapter;未归卷的 Chapter 平铺在 ungroupedChapters。
    acts: z.array(StoryActTreeNodeDtoSchema),
    ungroupedChapters: z.array(StoryChapterDtoSchema),
    totalPhases: z.number().int().nonnegative(),
    totalThreads: z.number().int().nonnegative(),
    totalScenes: z.number().int().nonnegative(),
    totalActs: z.number().int().nonnegative(),
    totalChapters: z.number().int().nonnegative(),
    // 规划层摘要:当前 status=open 的 Promise 数(读者债务账本入口提示)。
    openPromiseCount: z.number().int().nonnegative(),
    // 规划层摘要:当前 status=open 的 Decision 数(未决决策入口提示)。
    openDecisionCount: z.number().int().nonnegative(),
});

export const StoryWorkbenchSceneDtoSchema = StorySceneSummaryDtoSchema.extend({
    refs: z.array(StoryRefDtoSchema),
});

export const StoryWorkbenchThreadDtoSchema = StoryThreadSummaryDtoSchema.extend({
    scenes: z.array(StoryWorkbenchSceneDtoSchema),
});

export const StoryWorkbenchPhaseDtoSchema = StoryPhaseDtoSchema.extend({
    threads: z.array(StoryWorkbenchThreadDtoSchema),
});

export const PlotWorkbenchDtoSchema = z.object({
    story: StoryDtoSchema,
    phases: z.array(StoryWorkbenchPhaseDtoSchema),
    ungroupedThreads: z.array(StoryWorkbenchThreadDtoSchema),
    totalPhases: z.number().int().nonnegative(),
    totalThreads: z.number().int().nonnegative(),
    totalScenes: z.number().int().nonnegative(),
});

export const UpdateStoryRequestDtoSchema = z.object({
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional(),
    summary: StorySummarySchema.optional(),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional(),
}).refine((value) => value.title !== undefined || value.summary !== undefined || value.note !== undefined, {
    message: "至少提供一个更新字段",
});

export const CreateStoryPhaseRequestDtoSchema = z.object({
    name: StoryNameSchema,
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长"),
    summary: StorySummarySchema.optional(),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional(),
});

export const UpdateStoryPhaseRequestDtoSchema = z.object({
    name: StoryNameSchema.optional(),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional(),
    summary: StorySummarySchema.optional(),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional(),
}).refine((value) => (
    value.name !== undefined
    || value.title !== undefined
    || value.summary !== undefined
    || value.note !== undefined
), {
    message: "至少提供一个更新字段",
});

export const ReorderStoryPhaseItemDtoSchema = z.object({
    phaseId: z.string().trim().min(1, "phaseId 不能为空"),
    sortOrder: z.number().int().nonnegative(),
});

export const ReorderStoryPhasesRequestDtoSchema = z.object({
    items: z.array(ReorderStoryPhaseItemDtoSchema).min(1, "items 不能为空"),
});

// ChapterBrief 写入 schema:每个字段 undefined=不修改,null=显式清空。
export const ChapterBriefInputDtoSchema = z.object({
    goal: StorySummarySchema.nullable().optional().describe("Chapter goal / landing point. Null clears it."),
    pov: StorySummarySchema.nullable().optional().describe("POV, narrative distance and switching constraints for this chapter. Null clears it."),
    tone: StorySummarySchema.nullable().optional().describe("Tone / emotional temperature / style constraints. Null clears it."),
    pacing: StorySummarySchema.nullable().optional().describe("Pacing, suspense and next-chapter pull. Null clears it."),
    readerKnows: StorySummarySchema.nullable().optional().describe("Information control: what the reader already knows. Null clears it."),
    protagonistKnows: StorySummarySchema.nullable().optional().describe("Information control: what the protagonist knows. Null clears it."),
    mustHide: StorySummarySchema.nullable().optional().describe("Information control: facts that must stay hidden this chapter. Null clears it."),
    hintOnly: StorySummarySchema.nullable().optional().describe("Information control: may be hinted at but not stated. Null clears it."),
    opening: StorySummarySchema.nullable().optional().describe("Opening hook. Null clears it."),
    ending: StorySummarySchema.nullable().optional().describe("Chapter landing / closing line. Null clears it."),
    doNotWrite: StorySummarySchema.nullable().optional().describe("Do-not-write list (secrets, premature reveals). Null clears it."),
});

export const CreateStoryActRequestDtoSchema = z.object({
    name: StoryNameSchema.describe("Machine-friendly name (lowercase letters, digits, hyphens)."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").describe("Human-readable act (volume) title."),
    summary: StorySummarySchema.optional().describe("Act summary (max 5000 characters)."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
});

export const UpdateStoryActRequestDtoSchema = z.object({
    name: StoryNameSchema.optional().describe("Machine-friendly name (lowercase letters, digits, hyphens)."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional().describe("Human-readable act (volume) title."),
    summary: StorySummarySchema.optional().describe("Act summary (max 5000 characters)."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
    sortOrder: z.number().int().nonnegative().optional().describe("Act order within the story."),
}).refine((value) => (
    value.name !== undefined
    || value.title !== undefined
    || value.summary !== undefined
    || value.note !== undefined
    || value.sortOrder !== undefined
), {
    message: "至少提供一个更新字段",
});

export const CreateStoryChapterRequestDtoSchema = z.object({
    // `actId` 为空表示创建未归卷章节。
    actId: z.string().trim().min(1, "actId 不能为空").nullable().optional().describe("Act ID to group this chapter under. Null for an ungrouped chapter."),
    name: StoryNameSchema.describe("Machine-friendly name (lowercase letters, digits, hyphens). Prose files point back via frontmatter `chapter: <name>`."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").describe("Human-readable chapter title."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
    brief: ChapterBriefInputDtoSchema.optional().describe("Chapter-level writer brief (goal, POV, info control, opening/ending, do-not-write)."),
});

export const UpdateStoryChapterRequestDtoSchema = z.object({
    // `actId` 为空表示移动到未归卷区。
    actId: z.string().trim().min(1, "actId 不能为空").nullable().optional().describe("Act ID to move the chapter to. Null moves to ungrouped."),
    name: StoryNameSchema.optional().describe("Machine-friendly name (lowercase letters, digits, hyphens). Renaming breaks existing prose frontmatter pointers."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional().describe("Human-readable chapter title."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
    sortOrder: z.number().int().nonnegative().optional().describe("Chapter order within the story."),
    brief: ChapterBriefInputDtoSchema.optional().describe("Chapter-level writer brief fields to update. Omitted fields stay unchanged; null fields are cleared."),
}).refine((value) => (
    value.actId !== undefined
    || value.name !== undefined
    || value.title !== undefined
    || value.note !== undefined
    || value.sortOrder !== undefined
    || value.brief !== undefined
), {
    message: "至少提供一个更新字段",
});

export const CreateStoryThreadRequestDtoSchema = z.object({
    // `storyPhaseId` 为空表示创建未分组线程。
    storyPhaseId: z.string().trim().min(1, "storyPhaseId 不能为空").nullable().optional().describe("Phase ID to group this thread under. Null for an ungrouped thread."),
    name: StoryNameSchema.describe("Machine-friendly name (lowercase letters, digits, hyphens)."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").describe("Human-readable thread title."),
    isMainThread: z.boolean().optional().describe("Whether this is the main story thread."),
    status: StoryThreadStatusSchema.optional().describe("Thread status (active, draft, paused, done, archived)."),
    // `miceType` 为空表示显式清空线型。
    miceType: StoryThreadMiceTypeSchema.nullable().optional().describe("MICE Quotient thread type (milieu/idea/character/event); hints what closing this thread means. Null clears it."),
    summary: StorySummarySchema.optional().describe("Thread summary (max 5000 characters)."),
    tags: StoryTagsInputSchema.optional().describe("Tags for categorization (max 50)."),
    // `writingTip` 为空表示显式清空写作提示。
    writingTip: StoryTipSchema.nullable().optional().describe("Writing tip for the thread. Null clears it."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
});

export const UpdateStoryThreadRequestDtoSchema = z.object({
    // `storyPhaseId` 为空表示移动到未分组线程。
    storyPhaseId: z.string().trim().min(1, "storyPhaseId 不能为空").nullable().optional().describe("Phase ID to move the thread to. Null moves to ungrouped."),
    name: StoryNameSchema.optional().describe("Machine-friendly name (lowercase letters, digits, hyphens)."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional().describe("Human-readable thread title."),
    isMainThread: z.boolean().optional().describe("Whether this is the main story thread."),
    status: StoryThreadStatusSchema.optional().describe("Thread status (active, draft, paused, done, archived)."),
    // `miceType` 为空表示显式清空线型。
    miceType: StoryThreadMiceTypeSchema.nullable().optional().describe("MICE Quotient thread type (milieu/idea/character/event). Null clears it."),
    summary: StorySummarySchema.optional().describe("Thread summary (max 5000 characters)."),
    tags: StoryTagsInputSchema.optional().describe("Tags for categorization (max 50)."),
    // `writingTip` 为空表示显式清空写作提示。
    writingTip: StoryTipSchema.nullable().optional().describe("Writing tip for the thread. Null clears it."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
}).refine((value) => (
    value.storyPhaseId !== undefined
    || value.name !== undefined
    || value.title !== undefined
    || value.isMainThread !== undefined
    || value.status !== undefined
    || value.miceType !== undefined
    || value.summary !== undefined
    || value.tags !== undefined
    || value.writingTip !== undefined
    || value.note !== undefined
), {
    message: "至少提供一个更新字段",
});

export const ReorderStoryThreadItemDtoSchema = z.object({
    threadId: z.string().trim().min(1, "threadId 不能为空"),
    // `storyPhaseId` 为空表示放入未分组线程区。
    storyPhaseId: z.string().trim().min(1, "storyPhaseId 不能为空").nullable(),
    sortOrder: z.number().int().nonnegative(),
});

export const ReorderStoryThreadsRequestDtoSchema = z.object({
    items: z.array(ReorderStoryThreadItemDtoSchema).min(1, "items 不能为空"),
});

export const CreateStorySceneRequestDtoSchema = z.object({
    threadId: z.string().trim().min(1, "threadId 不能为空").describe("Thread ID to attach this scene to."),
    // `chapterId` 为空表示当前 Scene 还未挂入具体章节。
    chapterId: z.string().trim().min(1, "chapterId 不能为空").nullable().optional().describe("StoryChapter ID to attach this scene to. Null if not yet placed in a chapter."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").describe("Human-readable scene title."),
    status: StorySceneStatusSchema.optional().describe("Scene status (draft, active, written, revised, archived)."),
    // `outcomeType` 为空表示显式清空(回到未填写)。
    outcomeType: StorySceneOutcomeTypeSchema.nullable().optional().describe("Outcome of the scene's main actor's active attempt (yes_but/no_and/yes_and/no_but/yes/no); non-conflict scenes use no_conflict, passive-endurance scenes use passive. Null clears it."),
    // `pacingRole` 为空表示显式清空(回到未填写)。
    pacingRole: StoryScenePacingRoleSchema.nullable().optional().describe("Pacing role of this scene (setup/escalation/breather/climax/resolution). Null clears it."),
    summary: StorySummarySchema.optional().describe("Scene summary (max 5000 characters)."),
    // `purpose` 为空表示显式清空场景功能说明。
    purpose: StorySummarySchema.nullable().optional().describe("Scene purpose/function description. Null clears it."),
    // `writingTip` 为空表示显式清空写作提示。
    writingTip: StoryTipSchema.nullable().optional().describe("Writing tip for the scene. Null clears it."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
    worldAnchor: StorySceneWorldAnchorInputDtoSchema.optional().describe("World Engine time/subject anchor for this scene."),
    refs: StoryRefsInputSchema.optional().describe("Structured references (max 100). Use workspace content-node paths for lore, e.g. lorebook/character/foo/. Use thread:// or scene:// for plot entities. pending:// is not supported."),
});

export const UpdateStorySceneRequestDtoSchema = z.object({
    threadId: z.string().trim().min(1, "threadId 不能为空").optional().describe("Thread ID to move this scene to."),
    // `chapterId` 为空表示从章节顺序中移除当前 Scene。
    chapterId: z.string().trim().min(1, "chapterId 不能为空").nullable().optional().describe("StoryChapter ID. Null removes the scene from chapter ordering."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional().describe("Human-readable scene title."),
    status: StorySceneStatusSchema.optional().describe("Scene status (draft, active, written, revised, archived)."),
    // `outcomeType` 为空表示显式清空(回到未填写)。
    outcomeType: StorySceneOutcomeTypeSchema.nullable().optional().describe("Outcome of the scene's main actor's active attempt. Null clears it."),
    // `pacingRole` 为空表示显式清空(回到未填写)。
    pacingRole: StoryScenePacingRoleSchema.nullable().optional().describe("Pacing role of this scene. Null clears it."),
    summary: StorySummarySchema.optional().describe("Scene summary (max 5000 characters)."),
    // `purpose` 为空表示显式清空场景功能说明。
    purpose: StorySummarySchema.nullable().optional().describe("Scene purpose/function description. Null clears it."),
    // `writingTip` 为空表示显式清空写作提示。
    writingTip: StoryTipSchema.nullable().optional().describe("Writing tip for the scene. Null clears it."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
    worldAnchor: StorySceneWorldAnchorInputDtoSchema.optional().describe("World Engine time/subject anchor for this scene."),
    refs: StoryRefsInputSchema.optional().describe("Structured references (max 100). Use workspace content-node paths for lore, e.g. lorebook/character/foo/. Use thread:// or scene:// for plot entities. pending:// is not supported."),
}).refine((value) => (
    value.threadId !== undefined
    || value.chapterId !== undefined
    || value.title !== undefined
    || value.status !== undefined
    || value.outcomeType !== undefined
    || value.pacingRole !== undefined
    || value.summary !== undefined
    || value.purpose !== undefined
    || value.writingTip !== undefined
    || value.note !== undefined
    || value.worldAnchor !== undefined
    || value.refs !== undefined
), {
    message: "至少提供一个更新字段",
});

export const ReorderStorySceneItemDtoSchema = z.object({
    sceneId: z.string().trim().min(1, "sceneId 不能为空"),
    threadId: z.string().trim().min(1, "threadId 不能为空"),
    // `chapterId` 为空表示该 Scene 当前不挂入正文顺序。
    chapterId: z.string().trim().min(1, "chapterId 不能为空").nullable(),
    threadSortOrder: z.number().int().nonnegative(),
    // `chapterSortOrder` 为空表示该 Scene 当前不挂入正文顺序。
    chapterSortOrder: z.number().int().nonnegative().nullable(),
});

export const ReorderStoryScenesRequestDtoSchema = z.object({
    items: z.array(ReorderStorySceneItemDtoSchema).min(1, "items 不能为空"),
});

export const CreateStoryPromiseRequestDtoSchema = z.object({
    name: StoryNameSchema.describe("Machine-friendly name (lowercase letters, digits, hyphens), unique per story; used for cross references."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").describe("Human-readable promise title."),
    importance: StoryPromiseImportanceSchema.optional().describe("Importance tier (low/medium/high); defaults to medium. Used for density weighting and ledger ordering."),
    summary: StorySummarySchema.optional().describe("What was promised to the reader (ledger display)."),
    // `payoffExpectation` 为空表示显式清空。
    payoffExpectation: StorySummarySchema.nullable().optional().describe("Expected dramatic effect at payoff time (only fed to the payoff scene's writer). Null clears it."),
    // `cadenceChapters` 为空表示显式清空节奏提示。
    cadenceChapters: z.number().int().positive().nullable().optional().describe("Advisory pacing hint in chapters (not a hard constraint). Null clears it."),
    // `deadlineChapterId` 为空表示显式清空兑现期限。
    deadlineChapterId: z.string().trim().min(1, "deadlineChapterId 不能为空").nullable().optional().describe("StoryChapter ID before which the promise must pay off. Null clears the deadline."),
    tags: StoryTagsInputSchema.optional().describe("Tags; foreshadowing taxonomy vocabulary: setup_payoff / prophecy / motif / mirror."),
});

export const UpdateStoryPromiseRequestDtoSchema = z.object({
    name: StoryNameSchema.optional().describe("Machine-friendly name (lowercase letters, digits, hyphens). Renaming breaks existing cross references."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional().describe("Human-readable promise title."),
    // 存储态是作者意图:fulfilled/abandoned 走显式动作,open 用于重开(误伤回退后的重置也在此)。
    status: StoryPromiseStatusSchema.optional().describe("Authorial status (open/fulfilled/abandoned). Reopen with open; fulfilled/abandoned usually go through explicit actions."),
    importance: StoryPromiseImportanceSchema.optional().describe("Importance tier (low/medium/high)."),
    summary: StorySummarySchema.optional().describe("What was promised to the reader."),
    // `payoffExpectation` 为空表示显式清空。
    payoffExpectation: StorySummarySchema.nullable().optional().describe("Expected dramatic effect at payoff time. Null clears it."),
    // `cadenceChapters` 为空表示显式清空节奏提示。
    cadenceChapters: z.number().int().positive().nullable().optional().describe("Advisory pacing hint in chapters. Null clears it."),
    // `deadlineChapterId` 为空表示显式清空兑现期限。
    deadlineChapterId: z.string().trim().min(1, "deadlineChapterId 不能为空").nullable().optional().describe("StoryChapter ID before which the promise must pay off. Null clears the deadline."),
    tags: StoryTagsInputSchema.optional().describe("Tags; foreshadowing taxonomy vocabulary: setup_payoff / prophecy / motif / mirror."),
}).refine((value) => (
    value.name !== undefined
    || value.title !== undefined
    || value.status !== undefined
    || value.importance !== undefined
    || value.summary !== undefined
    || value.payoffExpectation !== undefined
    || value.cadenceChapters !== undefined
    || value.deadlineChapterId !== undefined
    || value.tags !== undefined
), {
    message: "至少提供一个更新字段",
});

// beat set:同场同线仅一条(upsert,kind 取主导);写入前校验 scene 与 promise 同 story。
export const SetPromiseBeatRequestDtoSchema = z.object({
    sceneId: z.string().trim().min(1, "sceneId 不能为空").describe("StoryScene ID the beat lands on."),
    kind: StoryPromiseBeatKindSchema.describe("Beat kind: plant (establish) / advance (progress or echo) / setback (reversal, incl. fake reveal) / payoff (fulfill)."),
    // `note` 为空表示显式清空本次推进指示。
    note: StoryNoteSchema.nullable().optional().describe("Concrete instruction for this beat's writer, e.g. scope limits. Null clears it."),
    // 打 payoff beat 时默认自动置 fulfilled;弧光线里程碑后线仍延续时传 false 关闭。
    autoFulfill: z.boolean().optional().describe("When kind=payoff, automatically set promise status to fulfilled (default true). Pass false for milestone payoffs where the promise continues."),
});

// serves/dependsOn 写入格式(D12):promise://{id} / decision://{id} / thread://{id} / scene://{id} 或内容节点相对路径;
// 格式与 id 存在性由服务层校验(一次报出全部非法条目)。
const StoryDecisionRefsInputSchema = z.array(z.string().trim().min(1, "引用不能为空").max(MAX_STORY_TARGET_LENGTH, "引用过长")).max(MAX_STORY_REFS_COUNT, "引用过多");
const StoryDecisionOptionsInputSchema = z.array(StoryDecisionOptionDtoSchema).max(MAX_STORY_REFS_COUNT, "options 过多");
const StoryDecisionRejectedInputSchema = z.array(StoryDecisionRejectedAlternativeDtoSchema).max(MAX_STORY_REFS_COUNT, "rejectedAlternatives 过多");

// Decision 创建恒为 open 态(decided 走 decide 转换),故不接受 status/decision/motivation/risk 等 decided 态字段。
export const CreateStoryDecisionRequestDtoSchema = z.object({
    name: StoryNameSchema.describe("Machine-friendly decision name (lowercase letters, digits, hyphens), unique per story; e.g. d-liya-truth."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").describe("Human-readable decision title."),
    question: StorySummarySchema.refine((value) => value.trim().length > 0, "question 不能为空").describe("The open question to be decided (core of the open state)."),
    options: StoryDecisionOptionsInputSchema.optional().describe("Candidate answers, each {option, note?}."),
    // `deadlineChapterId` 为空表示显式清空拍板期限。
    deadlineChapterId: z.string().trim().min(1, "deadlineChapterId 不能为空").nullable().optional().describe("StoryChapter ID before which this must be decided. Null clears the deadline."),
    serves: StoryDecisionRefsInputSchema.optional().describe("What this decision serves: promise://{id} / decision://{id} / thread://{id} / scene://{id} or a content-node path like lorebook/character/chen-yao/."),
    dependsOn: StoryDecisionRefsInputSchema.optional().describe("Prerequisites in the same reference format."),
    anchor: StoryDecisionAnchorInputDtoSchema.optional().describe("Primary anchor. kind=story needs no id/path; kind=content needs path; other kinds need id. Defaults to story."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note. Null clears it."),
});

export const UpdateStoryDecisionRequestDtoSchema = z.object({
    name: StoryNameSchema.optional().describe("Machine-friendly decision name. Renaming breaks existing cross references."),
    title: NonEmptyStringSchema.max(MAX_STORY_TITLE_LENGTH, "title 过长").optional().describe("Human-readable decision title."),
    // 状态不变式由服务层校验:decided 需 decision/motivation/risk 非空,dropped 需 note(失效原因)非空,superseded 需 supersededById 非空。
    status: StoryDecisionStatusSchema.optional().describe("Lifecycle status (open/decided/superseded/dropped). Reopen with open; decided requires decision+motivation+risk, dropped requires note, superseded requires supersededById."),
    question: StorySummarySchema.optional().describe("The open question to be decided."),
    options: StoryDecisionOptionsInputSchema.optional().describe("Candidate answers, each {option, note?}."),
    // `deadlineChapterId` 为空表示显式清空拍板期限。
    deadlineChapterId: z.string().trim().min(1, "deadlineChapterId 不能为空").nullable().optional().describe("StoryChapter ID before which this must be decided. Null clears the deadline."),
    // `decision` 为空表示显式清空(退回未拍板文本)。
    decision: StorySummarySchema.nullable().optional().describe("The conclusion. Required (non-null) while status=decided. Null clears it."),
    // `motivation` 为空表示显式清空。
    motivation: StorySummarySchema.nullable().optional().describe("Why this conclusion. Required (non-null) while status=decided. Null clears it."),
    rejectedAlternatives: StoryDecisionRejectedInputSchema.optional().describe("Rejected candidates, each {option, whyRejected?}. Omit on decide to auto-generate skeletons from unchosen options."),
    // `risk` 为空表示显式清空。
    risk: StorySummarySchema.nullable().optional().describe("The brake point for writers (what to watch out for). Required (non-null) while status=decided. Null clears it."),
    // decide 转换指令:命中 options 的被选项,其余未选项转 rejectedAlternatives 骨架;不传则全部候选转骨架。
    chosenOption: z.string().trim().min(1, "chosenOption 不能为空").optional().describe("When deciding: the chosen option text (must match one of options); unchosen options become rejectedAlternatives skeletons. Omit if the conclusion is a brand-new plan (all options rejected)."),
    serves: StoryDecisionRefsInputSchema.optional().describe("What this decision serves (replaces the whole list)."),
    dependsOn: StoryDecisionRefsInputSchema.optional().describe("Prerequisites (replaces the whole list)."),
    // `supersededById` 为空表示显式清空取代链接。
    supersededById: z.string().trim().min(1, "supersededById 不能为空").nullable().optional().describe("The decision that supersedes this one. Required (non-null) while status=superseded. Null clears it."),
    anchor: StoryDecisionAnchorInputDtoSchema.optional().describe("Primary anchor, replaced as a whole. kind=story needs no id/path; kind=content needs path; other kinds need id."),
    // `note` 为空表示显式清空备注。
    note: StoryNoteSchema.nullable().optional().describe("Optional note; carries the invalidation reason while status=dropped. Null clears it."),
}).refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: "至少提供一个更新字段",
});

export type StoryThreadStatusDto = z.infer<typeof StoryThreadStatusSchema>;
export type StorySceneStatusDto = z.infer<typeof StorySceneStatusSchema>;
export type StoryThreadMiceTypeDto = z.infer<typeof StoryThreadMiceTypeSchema>;
export type StorySceneOutcomeTypeDto = z.infer<typeof StorySceneOutcomeTypeSchema>;
export type StoryScenePacingRoleDto = z.infer<typeof StoryScenePacingRoleSchema>;
export type StoryPromiseStatusDto = z.infer<typeof StoryPromiseStatusSchema>;
export type StoryPromiseImportanceDto = z.infer<typeof StoryPromiseImportanceSchema>;
export type StoryPromiseBeatKindDto = z.infer<typeof StoryPromiseBeatKindSchema>;
export type StoryPromiseDerivedStageDto = z.infer<typeof StoryPromiseDerivedStageSchema>;
export type StoryPromiseBeatStateDto = z.infer<typeof StoryPromiseBeatStateSchema>;
export type StoryPromiseBeatStatsDto = z.infer<typeof StoryPromiseBeatStatsDtoSchema>;
export type StoryPromiseDto = z.infer<typeof StoryPromiseDtoSchema>;
export type StoryPromiseBeatSceneDto = z.infer<typeof StoryPromiseBeatSceneDtoSchema>;
export type StoryPromiseBeatDto = z.infer<typeof StoryPromiseBeatDtoSchema>;
export type StoryPromiseDetailDto = z.infer<typeof StoryPromiseDetailDtoSchema>;
export type StoryScenePromiseBeatDto = z.infer<typeof StoryScenePromiseBeatDtoSchema>;
export type StoryRefTargetKindDto = z.infer<typeof StoryRefTargetKindSchema>;
export type StoryRefVisibilityDto = z.infer<typeof StoryRefVisibilitySchema>;
export type StoryRefDto = z.infer<typeof StoryRefDtoSchema>;
export type StoryEffectiveRefDto = z.infer<typeof StoryEffectiveRefDtoSchema>;
export type StorySceneWorldAnchorInputDto = z.infer<typeof StorySceneWorldAnchorInputDtoSchema>;
export type StorySceneWorldAnchorSubjectDto = z.infer<typeof StorySceneWorldAnchorSubjectDtoSchema>;
export type StorySceneWorldAnchorDto = z.infer<typeof StorySceneWorldAnchorDtoSchema>;
export type SceneWorldContextDto = z.infer<typeof SceneWorldContextDtoSchema>;
export type StoryDto = z.infer<typeof StoryDtoSchema>;
export type StoryPhaseDto = z.infer<typeof StoryPhaseDtoSchema>;
export type StoryActDto = z.infer<typeof StoryActDtoSchema>;
export type ChapterBriefDto = z.infer<typeof ChapterBriefDtoSchema>;
export type StoryChapterDto = z.infer<typeof StoryChapterDtoSchema>;
export type StorySceneChapterRefDto = z.infer<typeof StorySceneChapterRefDtoSchema>;
export type StoryThreadSummaryDto = z.infer<typeof StoryThreadSummaryDtoSchema>;
export type StoryThreadDetailDto = z.infer<typeof StoryThreadDetailDtoSchema>;
export type StoryThreadWriteResponseDto = z.infer<typeof StoryThreadWriteResponseDtoSchema>;
export type StorySceneSummaryDto = z.infer<typeof StorySceneSummaryDtoSchema>;
export type StorySceneDetailDto = z.infer<typeof StorySceneDetailDtoSchema>;
export type StorySceneWriteResponseDto = z.infer<typeof StorySceneWriteResponseDtoSchema>;
export type ChapterPlotSceneDto = z.infer<typeof ChapterPlotSceneDtoSchema>;
export type ChapterPlotDetailDto = z.infer<typeof ChapterPlotDetailDtoSchema>;
export type ChapterWriterBriefStatus = z.infer<typeof ChapterWriterBriefStatusSchema>;
export type ChapterWriterBriefMode = z.infer<typeof ChapterWriterBriefModeSchema>;
export type ChapterWriterBriefReadingDto = z.infer<typeof ChapterWriterBriefReadingDtoSchema>;
export type ChapterWriterBriefPromiseTaskDto = z.infer<typeof ChapterWriterBriefPromiseTaskDtoSchema>;
export type ChapterWriterBriefOpenDecisionDto = z.infer<typeof ChapterWriterBriefOpenDecisionDtoSchema>;
export type ChapterWriterBriefSceneDto = z.infer<typeof ChapterWriterBriefSceneDtoSchema>;
export type ChapterWriterBriefDto = z.infer<typeof ChapterWriterBriefDtoSchema>;
export type StoryThreadTreeNodeDto = z.infer<typeof StoryThreadTreeNodeDtoSchema>;
export type StoryPhaseTreeNodeDto = z.infer<typeof StoryPhaseTreeNodeDtoSchema>;
export type StoryActTreeNodeDto = z.infer<typeof StoryActTreeNodeDtoSchema>;
export type PlotTreeDto = z.infer<typeof PlotTreeDtoSchema>;
export type StoryWorkbenchSceneDto = z.infer<typeof StoryWorkbenchSceneDtoSchema>;
export type StoryWorkbenchThreadDto = z.infer<typeof StoryWorkbenchThreadDtoSchema>;
export type StoryWorkbenchPhaseDto = z.infer<typeof StoryWorkbenchPhaseDtoSchema>;
export type PlotWorkbenchDto = z.infer<typeof PlotWorkbenchDtoSchema>;
export type UpdateStoryRequestDto = z.infer<typeof UpdateStoryRequestDtoSchema>;
export type CreateStoryPhaseRequestDto = z.infer<typeof CreateStoryPhaseRequestDtoSchema>;
export type UpdateStoryPhaseRequestDto = z.infer<typeof UpdateStoryPhaseRequestDtoSchema>;
export type ChapterBriefInputDto = z.infer<typeof ChapterBriefInputDtoSchema>;
export type CreateStoryActRequestDto = z.infer<typeof CreateStoryActRequestDtoSchema>;
export type UpdateStoryActRequestDto = z.infer<typeof UpdateStoryActRequestDtoSchema>;
export type CreateStoryChapterRequestDto = z.infer<typeof CreateStoryChapterRequestDtoSchema>;
export type UpdateStoryChapterRequestDto = z.infer<typeof UpdateStoryChapterRequestDtoSchema>;
export type ReorderStoryPhasesRequestDto = z.infer<typeof ReorderStoryPhasesRequestDtoSchema>;
export type CreateStoryThreadRequestDto = z.infer<typeof CreateStoryThreadRequestDtoSchema>;
export type UpdateStoryThreadRequestDto = z.infer<typeof UpdateStoryThreadRequestDtoSchema>;
export type ReorderStoryThreadsRequestDto = z.infer<typeof ReorderStoryThreadsRequestDtoSchema>;
export type CreateStorySceneRequestDto = z.infer<typeof CreateStorySceneRequestDtoSchema>;
export type UpdateStorySceneRequestDto = z.infer<typeof UpdateStorySceneRequestDtoSchema>;
export type ReorderStoryScenesRequestDto = z.infer<typeof ReorderStoryScenesRequestDtoSchema>;
export type CreateStoryPromiseRequestDto = z.infer<typeof CreateStoryPromiseRequestDtoSchema>;
export type UpdateStoryPromiseRequestDto = z.infer<typeof UpdateStoryPromiseRequestDtoSchema>;
export type SetPromiseBeatRequestDto = z.infer<typeof SetPromiseBeatRequestDtoSchema>;
export type StoryDecisionStatusDto = z.infer<typeof StoryDecisionStatusSchema>;
export type StoryDecisionAnchorKindDto = z.infer<typeof StoryDecisionAnchorKindSchema>;
export type StoryDecisionOptionDto = z.infer<typeof StoryDecisionOptionDtoSchema>;
export type StoryDecisionRejectedAlternativeDto = z.infer<typeof StoryDecisionRejectedAlternativeDtoSchema>;
export type StoryDecisionRefDto = z.infer<typeof StoryDecisionRefDtoSchema>;
export type StoryDecisionAnchorInputDto = z.infer<typeof StoryDecisionAnchorInputDtoSchema>;
export type StoryDecisionDto = z.infer<typeof StoryDecisionDtoSchema>;
export type CreateStoryDecisionRequestDto = z.infer<typeof CreateStoryDecisionRequestDtoSchema>;
export type UpdateStoryDecisionRequestDto = z.infer<typeof UpdateStoryDecisionRequestDtoSchema>;
