import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import {parseEntityId} from "nbook/server/utils/novel-chapter";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {PLOT_SELECTION_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";
import type {NeuroAgentTool, NeuroToolResult, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import {PROJECT_PLOT_WORLD_MODULE_TOKEN} from "nbook/server/plot";
import type {PlotFacade} from "nbook/server/plot/facade/plot.facade";
import {
    activateReadyProjectModule,
    requireActiveReadyProject,
    runReadyProjectOperation,
} from "nbook/server/workspace-files/project-session";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";

const NonEmptyString = (description: string) => Type.String({minLength: 1, description});
const NullableString = (description: string) => Type.Union([Type.String({minLength: 1, description}), Type.Null({description: "显式清空。"})]);
const StoryRefSchema = Type.Object({
    relation: Type.String(),
    target: Type.String(),
    visibility: Type.Union([Type.Literal("author"), Type.Literal("reader")]),
    note: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ProjectScopedSchema = Type.Object({
    projectRoot: Type.Optional(NonEmptyString("Optional single-segment Project root for an explicit cross-Project call.")),
});

const SceneWorldAnchorSchema = Type.Object({
    startTime: Type.Union([Type.String({minLength: 1}), Type.Null()]),
    endTime: Type.Union([Type.String({minLength: 1}), Type.Null()]),
    startInstant: Type.Union([Type.String(), Type.Null()]),
    endInstant: Type.Union([Type.String(), Type.Null()]),
    subjectIds: Type.Array(Type.String({minLength: 1}), {maxItems: 100}),
    locationSubjectId: Type.Union([Type.String({minLength: 1}), Type.Null()]),
});

const ThreadPatchSchema = {
    storyPhaseId: Type.Optional(NullableString("Phase ID to group this thread under. Null moves to ungrouped.")),
    name: Type.Optional(NonEmptyString("Machine-friendly thread name. Required when action=create.")),
    title: Type.Optional(NonEmptyString("Human-readable thread title. Required when action=create.")),
    isMainThread: Type.Optional(Type.Boolean()),
    status: Type.Optional(Type.Union([
        Type.Literal("active"),
        Type.Literal("draft"),
        Type.Literal("paused"),
        Type.Literal("done"),
        Type.Literal("archived"),
    ])),
    // MICE 线型:milieu(进出某环境)/idea(问题与解答)/character(自我认知变化)/event(秩序破坏与恢复)。null 显式清空。
    miceType: Type.Optional(Type.Union([
        Type.Literal("milieu"),
        Type.Literal("idea"),
        Type.Literal("character"),
        Type.Literal("event"),
        Type.Null(),
    ], {description: "MICE Quotient thread type (milieu/idea/character/event); hints what closing this thread means. Null clears it."})),
    summary: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
    writingTip: Type.Optional(NullableString("Writing tip for the thread. Null clears it.")),
    note: Type.Optional(NullableString("Optional note. Null clears it.")),
};

const ScenePatchSchema = {
    threadId: Type.Optional(NonEmptyString("Thread ID. Defaults to plot.selection selected thread.")),
    chapterId: Type.Optional(NullableString("StoryChapter ID to attach this scene to. Null removes chapter ordering.")),
    title: Type.Optional(NonEmptyString("Human-readable scene title. Required when action=create.")),
    status: Type.Optional(Type.Union([
        Type.Literal("draft"),
        Type.Literal("active"),
        Type.Literal("written"),
        Type.Literal("revised"),
        Type.Literal("archived"),
    ])),
    // 本场主要行动者主动尝试的结果(D29:null 仅=未填写);非冲突场显式填 no_conflict,被动承受场填 passive。
    outcomeType: Type.Optional(Type.Union([
        Type.Literal("yes_but"),
        Type.Literal("no_and"),
        Type.Literal("yes_and"),
        Type.Literal("no_but"),
        Type.Literal("yes"),
        Type.Literal("no"),
        Type.Literal("no_conflict"),
        Type.Literal("passive"),
        Type.Null(),
    ], {description: "Outcome of the scene's main actor's active attempt (yes_but/no_and/yes_and/no_but/yes/no); non-conflict scenes use no_conflict, passive-endurance scenes use passive. Null clears it."})),
    // 张弛角色:节奏检查按承载树章序投影消费。null 显式清空。
    pacingRole: Type.Optional(Type.Union([
        Type.Literal("setup"),
        Type.Literal("escalation"),
        Type.Literal("breather"),
        Type.Literal("climax"),
        Type.Literal("resolution"),
        Type.Null(),
    ], {description: "Pacing role of this scene (setup/escalation/breather/climax/resolution). Null clears it."})),
    summary: Type.Optional(Type.String()),
    purpose: Type.Optional(NullableString("Scene purpose/function. Null clears it.")),
    writingTip: Type.Optional(NullableString("Writing tip for the scene. Null clears it.")),
    note: Type.Optional(NullableString("Optional note. Null clears it.")),
    worldAnchor: Type.Optional(SceneWorldAnchorSchema),
    refs: Type.Optional(Type.Array(StoryRefSchema)),
};

// ChapterBrief:章级写作指令。全部可选自由文本;undefined 不修改,null 显式清空。
const ChapterBriefSchema = Type.Object({
    goal: Type.Optional(NullableString("Chapter goal / landing point. Null clears it.")),
    pov: Type.Optional(NullableString("POV, narrative distance and switching constraints. Null clears it.")),
    tone: Type.Optional(NullableString("Tone / emotional temperature / style constraints. Null clears it.")),
    pacing: Type.Optional(NullableString("Pacing, suspense and next-chapter pull. Null clears it.")),
    readerKnows: Type.Optional(NullableString("Info control: what the reader already knows. Null clears it.")),
    protagonistKnows: Type.Optional(NullableString("Info control: what the protagonist knows. Null clears it.")),
    mustHide: Type.Optional(NullableString("Info control: facts that must stay hidden this chapter. Null clears it.")),
    hintOnly: Type.Optional(NullableString("Info control: may be hinted at but never stated. Null clears it.")),
    opening: Type.Optional(NullableString("Opening hook. Null clears it.")),
    ending: Type.Optional(NullableString("Chapter landing / closing line. Null clears it.")),
    doNotWrite: Type.Optional(NullableString("Do-not-write list (secrets, premature reveals). Null clears it.")),
});

const ActPatchSchema = {
    name: Type.Optional(NonEmptyString("Machine-friendly act name (lowercase, digits, hyphens). Required when action=create.")),
    title: Type.Optional(NonEmptyString("Human-readable act (volume) title. Required when action=create.")),
    summary: Type.Optional(Type.String()),
    note: Type.Optional(NullableString("Optional note. Null clears it.")),
    sortOrder: Type.Optional(Type.Integer({minimum: 0, description: "Act order within the story."})),
};

const ChapterPatchSchema = {
    actId: Type.Optional(NullableString("Act ID to group this chapter under. Null moves to ungrouped.")),
    name: Type.Optional(NonEmptyString("Machine-friendly chapter name. Required when action=create. Prose files point back via frontmatter `chapter: <name>`; renaming breaks existing pointers.")),
    title: Type.Optional(NonEmptyString("Human-readable chapter title. Required when action=create.")),
    note: Type.Optional(NullableString("Optional note. Null clears it.")),
    sortOrder: Type.Optional(Type.Integer({minimum: 0, description: "Chapter order within the story."})),
    brief: Type.Optional(ChapterBriefSchema),
};

const GetStoryTreeSchema = ProjectScopedSchema;
const GetStoryThreadSchema = Type.Object({...ProjectScopedSchema.properties, threadId: Type.Optional(NonEmptyString("Thread ID. Defaults to plot.selection selected thread."))});
const GetStorySceneContextSchema = Type.Object({...ProjectScopedSchema.properties, sceneId: Type.Optional(NonEmptyString("Scene ID. Defaults to plot.selection selected scene."))});
const GetStoryChapterSchema = Type.Object({...ProjectScopedSchema.properties, chapterId: NonEmptyString("StoryChapter ID. Use get_story_tree to list chapters.")});
const GetChapterWriterBriefSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    chapterId: NonEmptyString("StoryChapter ID. Use get_story_tree to list chapters."),
    mode: Type.Optional(Type.Union([Type.Literal("autonomous"), Type.Literal("curated")], {
        description: "Anti-omniscience mode. autonomous (default): writer self-queries World Engine/lorebook, brief gives only query hints. curated: writer can't read sources, brief expands filtered state summaries for the leader to feed.",
    })),
});

// save_* 写面(Task 97 D2/D4):action 必填枚举显式声明意图,实体字段平铺可选,执行层按 action 校验必填。
const SaveStoryActSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    action: Type.Union([Type.Literal("create"), Type.Literal("update")], {
        description: "Explicit intent. create: new act (requires name + title); update: patch an existing act (requires actId).",
    }),
    actId: Type.Optional(NonEmptyString("Act ID. Required when action=update.")),
    ...ActPatchSchema,
});
const SaveStoryChapterSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    action: Type.Union([Type.Literal("create"), Type.Literal("update")], {
        description: "Explicit intent. create: new chapter (requires name + title); update: patch an existing chapter (requires chapterId).",
    }),
    chapterId: Type.Optional(NonEmptyString("StoryChapter ID. Required when action=update.")),
    ...ChapterPatchSchema,
});
const SaveStoryThreadSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("archive")], {
        description: "Explicit intent. create: new thread (requires name + title); update: patch an existing thread; archive: soft-delete by setting status to archived.",
    }),
    threadId: Type.Optional(NonEmptyString("Thread ID for update/archive. Defaults to plot.selection selected thread.")),
    ...ThreadPatchSchema,
});
const SaveStorySceneSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("archive")], {
        description: "Explicit intent. create: new scene (requires title; threadId defaults to plot.selection); update: patch an existing scene; archive: soft-delete by setting status to archived.",
    }),
    sceneId: Type.Optional(NonEmptyString("Scene ID for update/archive. Defaults to plot.selection selected scene.")),
    ...ScenePatchSchema,
});

// Promise(读者债务账本,Task 93):字段平铺;status 生命周期由 action=abandon/fulfill 承载,update+status=open 用于重开。
const PromisePatchSchema = {
    name: Type.Optional(NonEmptyString("Machine-friendly promise name (lowercase, digits, hyphens), unique per story. Required when action=create; renaming breaks cross references.")),
    title: Type.Optional(NonEmptyString("Human-readable promise title. Required when action=create.")),
    status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("fulfilled"), Type.Literal("abandoned")], {
        description: "Authorial status. Usually set via action=abandon/fulfill; pass status=open with action=update to reopen.",
    })),
    importance: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")], {
        description: "Importance tier for density weighting and ledger ordering. Defaults to medium.",
    })),
    summary: Type.Optional(Type.String({description: "What was promised to the reader (ledger display)."})),
    payoffExpectation: Type.Optional(NullableString("Expected dramatic effect at payoff time; fed to the payoff scene's writer. Null clears it.")),
    cadenceChapters: Type.Optional(Type.Union([Type.Integer({minimum: 1}), Type.Null()], {
        description: "Advisory pacing hint in chapters (NOT a hard constraint). Null clears it.",
    })),
    deadlineChapterId: Type.Optional(NullableString("StoryChapter ID before which the promise must pay off. Null clears the deadline.")),
    tags: Type.Optional(Type.Array(Type.String(), {description: "Tags; foreshadowing taxonomy vocabulary: setup_payoff / prophecy / motif / mirror."})),
};

const GetStoryPromiseSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    promiseId: Type.Optional(NonEmptyString("Promise ID. Omit to list all promises (open first, importance high first) with derived stage and beat stats.")),
});
const SaveStoryPromiseSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("abandon"), Type.Literal("fulfill")], {
        description: "Explicit intent. create: new promise (requires name + title); update: patch fields (requires promiseId); abandon: mark the promise dropped; fulfill: mark it paid off (usually automatic when a payoff beat is set).",
    }),
    promiseId: Type.Optional(NonEmptyString("Promise ID. Required unless action=create.")),
    ...PromisePatchSchema,
});
const SavePromiseBeatSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    action: Type.Union([Type.Literal("set"), Type.Literal("remove")], {
        description: "set: upsert this promise's beat on a scene (one beat per promise x scene, kind takes over); remove: delete the beat from a scene (re-checks the fulfilled revert boundary).",
    }),
    promiseId: NonEmptyString("Promise ID the beat belongs to."),
    sceneId: Type.Optional(NonEmptyString("Scene ID the beat lands on. Defaults to plot.selection selected scene.")),
    kind: Type.Optional(Type.Union([Type.Literal("plant"), Type.Literal("advance"), Type.Literal("setback"), Type.Literal("payoff")], {
        description: "Beat kind: plant (establish) / advance (progress or echo) / setback (reversal, incl. fake reveal) / payoff (fulfill). Required when action=set.",
    })),
    note: Type.Optional(NullableString("Concrete instruction for this beat's writer (e.g. scope limits). Null clears it.")),
    autoFulfill: Type.Optional(Type.Boolean({description: "When kind=payoff, automatically mark the promise fulfilled (default true). Pass false for milestone payoffs where the promise continues."})),
});

// Decision(ADR 式决策记录,Task 93 D10-D12):open 防 writer 写死,decided 供审查与接手。
const DecisionOptionSchema = Type.Object({
    option: Type.String({minLength: 1, description: "Candidate answer text."}),
    note: Type.Optional(Type.Union([Type.String(), Type.Null()], {description: "Optional remark for this candidate. Null means no remark."})),
});
const DecisionRejectedAlternativeSchema = Type.Object({
    option: Type.String({minLength: 1, description: "Rejected candidate text."}),
    whyRejected: Type.Optional(Type.Union([Type.String(), Type.Null()], {description: "Why it was rejected. Null leaves the skeleton blank for later."})),
});
// 主锚点:kind 决定载体必填性(story 不带 id/path,content 只带 path,其余只带 id);整体替换防 kind 与外键错配。
const DecisionAnchorSchema = Type.Object({
    kind: Type.Union([
        Type.Literal("story"),
        Type.Literal("act"),
        Type.Literal("chapter"),
        Type.Literal("thread"),
        Type.Literal("scene"),
        Type.Literal("promise"),
        Type.Literal("content"),
    ], {description: "Anchor kind. story = whole-book level (no id/path)."}),
    id: Type.Optional(NonEmptyString("Target entity ID. Required for kind=act/chapter/thread/scene/promise; not accepted otherwise.")),
    path: Type.Optional(NonEmptyString("Project Workspace content-node path (e.g. lorebook/character/chen-yao/). Required for kind=content; not accepted otherwise.")),
});
const DecisionPatchSchema = {
    name: Type.Optional(NonEmptyString("Machine-friendly decision name (lowercase, digits, hyphens, e.g. d-liya-truth), unique per story. Required when action=create; renaming breaks cross references.")),
    title: Type.Optional(NonEmptyString("Human-readable decision title. Required when action=create.")),
    status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("decided"), Type.Literal("superseded"), Type.Literal("dropped")], {
        description: "Lifecycle status. Usually set via action=decide/drop; pass status=open with action=update to reopen, or status=superseded with supersededById when a new decision replaces this one.",
    })),
    question: Type.Optional(Type.String({description: "The open question to be decided (core of the open state). Required when action=create."})),
    options: Type.Optional(Type.Array(DecisionOptionSchema, {description: "Candidate answers. On decide, unchosen options become rejectedAlternatives skeletons."})),
    deadlineChapterId: Type.Optional(NullableString("StoryChapter ID before which this must be decided. Null clears the deadline.")),
    decision: Type.Optional(NullableString("The conclusion. Required when action=decide. Null clears it.")),
    motivation: Type.Optional(NullableString("Why this conclusion — the reasoning chain the next agent relies on. Required when action=decide. Null clears it.")),
    rejectedAlternatives: Type.Optional(Type.Array(DecisionRejectedAlternativeSchema, {description: "Rejected candidates with reasons. Omit on decide to auto-generate skeletons from unchosen options, then fill whyRejected later."})),
    risk: Type.Optional(NullableString("The brake point for writers: what could go wrong executing this decision and what to control. Required when action=decide — a decision without risk tells the writer where to go but not where to stop. Null clears it.")),
    chosenOption: Type.Optional(NonEmptyString("When action=decide: the chosen option text (must match one of options); the rest become rejectedAlternatives skeletons. Omit if the conclusion is a brand-new plan (all options rejected).")),
    serves: Type.Optional(Type.Array(Type.String({minLength: 1}), {description: "What this decision serves: promise://{id} / decision://{id} / thread://{id} / scene://{id} or a content-node path like lorebook/character/chen-yao/. Replaces the whole list."})),
    dependsOn: Type.Optional(Type.Array(Type.String({minLength: 1}), {description: "Prerequisite references in the same format. Replaces the whole list."})),
    supersededById: Type.Optional(NullableString("Decision ID that supersedes this one. Required when status=superseded. Null clears it.")),
    anchor: Type.Optional(DecisionAnchorSchema),
    note: Type.Optional(NullableString("Optional note; carries the invalidation reason when action=drop (required then). Null clears it.")),
};

const GetStoryDecisionSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    decisionId: Type.Optional(NonEmptyString("Decision ID. Omit to list all decisions (open first) with dangling-reference marks.")),
});
const SaveStoryDecisionSchema = Type.Object({
    ...ProjectScopedSchema.properties,
    action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("decide"), Type.Literal("drop")], {
        description: "Explicit intent. create: new open decision (requires name + title + question); update: patch fields / reopen / supersede (requires decisionId); decide: settle it (requires decision + motivation + risk; unchosen options become rejectedAlternatives skeletons); drop: the question became moot (requires note explaining why).",
    }),
    decisionId: Type.Optional(NonEmptyString("Decision ID. Required unless action=create.")),
    ...DecisionPatchSchema,
});

type PlotSelection = {
    projectRoot?: string;
    threadId?: string;
    sceneId?: string;
};

type SceneRefPayload = {
    relation: string;
    target: string;
    visibility: "author" | "reader";
    note?: string | null;
};

type SceneRefPayloadWithNote = Omit<SceneRefPayload, "note"> & {
    note: string | null;
};

/**
 * 创建 v3 plot 工具（Task 97 重排后形态：读 get_story_* 前缀统一，写 save_* + 显式 action）。
 * 默认使用当前 Project；跨 Project 时显式传 projectRoot。Thread/Scene 焦点写入 session custom state。
 */
export function createPlotTools(): NeuroAgentTool[] {
    return [
        tool("get_story_tree", "Return the story tree (carrier acts/chapters + causal phases/threads) for the given Project Workspace.", GetStoryTreeSchema, {mutates: false}, async (context, input) => (
            runPlotOperation(context, input.projectRoot, async (facade) => plotResult(await facade.getPlotTree()))
        )),
        tool("get_story_thread", "Read the full detail of a story thread. threadId defaults to plot.selection.", GetStoryThreadSchema, {mutates: false}, async (context, input) => {
            const threadId = await resolveThreadId(context, input.projectRoot, input.threadId);
            const result = await runPlotOperation(context, input.projectRoot, (facade) => facade.getStoryThreadDetailDto(threadId));
            await writeSelection(context, {projectRoot: input.projectRoot, threadId: String(threadId), sceneId: undefined});
            return plotResult(result);
        }),
        tool("get_story_scene_context", "Read a story scene with its parent thread and chapter plot view. sceneId defaults to plot.selection.", GetStorySceneContextSchema, {mutates: false}, async (context, input) => {
            const sceneId = await resolveSceneId(context, input.projectRoot, input.sceneId);
            const result = await runPlotOperation(context, input.projectRoot, async (facade) => {
                const scene = await facade.getStorySceneDetailDto(sceneId);
                const thread = await facade.getStoryThreadDetailDto(parseEntityId("threadId", scene.threadId));
                const chapterPlot = scene.chapterId ? await facade.getChapterPlotDetailDto(parseEntityId("chapterId", scene.chapterId)) : null;
                return {thread, scene, chapterPlot};
            });
            const {scene} = result;
            await writeSelection(context, {projectRoot: input.projectRoot, threadId: scene.threadId, sceneId: String(sceneId)});
            return plotResult(result);
        }),
        tool("get_scene_world_context", "Read filtered World Engine slices and subject states for a story scene. sceneId defaults to plot.selection.", GetStorySceneContextSchema, {mutates: false}, async (context, input) => {
            const sceneId = await resolveSceneId(context, input.projectRoot, input.sceneId);
            const result = await runPlotOperation(context, input.projectRoot, (facade) => facade.getSceneWorldContext(sceneId));
            await writeSelection(context, {projectRoot: input.projectRoot, sceneId: String(sceneId)});
            return plotResult(result);
        }),
        tool("get_story_chapter", "Read a StoryChapter detail (including its ChapterBrief fields) and the scenes attached to it.", GetStoryChapterSchema, {mutates: false}, async (context, input) => (
            runPlotOperation(context, input.projectRoot, async (facade) => (
                plotResult(await facade.getChapterPlotDetailDto(parseEntityId("chapterId", input.chapterId)))
            ))
        )),
        tool("get_chapter_writer_brief", "Compile a chapter writer brief from ChapterBrief, Plot Scenes and filtered World Engine context. mode=autonomous (default) gives query hints; mode=curated expands state summaries. Returns markdown text for writer handoff and full DTO in details.", GetChapterWriterBriefSchema, {mutates: false}, async (context, input) => (
            runPlotOperation(context, input.projectRoot, async (facade) => {
                const result = await facade.getChapterWriterBrief(parseEntityId("chapterId", input.chapterId), input.mode ?? "autonomous");
                return {
                    content: [{type: "text" as const, text: result.suggestedBriefMarkdown}],
                    details: result as JsonValue,
                };
            })
        )),
        tool("get_story_promise", "Read the reader-promise ledger. Without promiseId: list all promises (open first) with derived stage (unplanted/planted/echoed/paid_off) and beat stats. With promiseId: full detail including beats and the scene/chapter each beat lands on.", GetStoryPromiseSchema, {mutates: false}, async (context, input) => (
            runPlotOperation(context, input.projectRoot, async (facade) => (
                input.promiseId === undefined
                    ? plotResult(await facade.listStoryPromises())
                    : plotResult(await facade.getStoryPromiseDetailDto(parseEntityId("promiseId", input.promiseId)))
            ))
        )),
        tool("get_story_decision", "Read story decisions (ADR ledger). Without decisionId: list all decisions (open first — check before planning so you neither re-litigate settled questions nor write dead open ones). With decisionId: full detail including options, rejected alternatives, risk and references (dangling references are marked valid=false).", GetStoryDecisionSchema, {mutates: false}, async (context, input) => (
            runPlotOperation(context, input.projectRoot, async (facade) => (
                input.decisionId === undefined
                    ? plotResult(await facade.listStoryDecisions())
                    : plotResult(await facade.getStoryDecisionDto(parseEntityId("decisionId", input.decisionId)))
            ))
        )),
        tool("save_story_act", "Create or update a story act (volume) in the carrier tree. action=create requires name + title; action=update requires actId.", SaveStoryActSchema, {mutates: true}, async (context, input) => {
            const {projectRoot, action, actId, ...payload} = input;
            return runPlotOperation(context, projectRoot, async (facade) => {
                if (action === "create") {
                    if (actId !== undefined) {
                        throw new Error("save_story_act 参数校验失败：action=create 不接受 actId；如要修改已有 Act，请改用 action=update。");
                    }
                    const {name, title} = payload;
                    if (!name || !title) {
                        throw new Error("save_story_act 参数校验失败：action=create 必须提供 name 和 title。");
                    }
                    return plotResult(await facade.createStoryAct({...payload, name, title}));
                }
                if (!actId) {
                    throw new Error("save_story_act 参数校验失败：action=update 必须提供 actId；可先用 get_story_tree 查看现有 Act。");
                }
                return plotResult(await facade.updateStoryAct(parseEntityId("actId", actId), payload));
            });
        }),
        tool("save_story_chapter", "Create or update a StoryChapter (carrier tree), including its ChapterBrief fields via `brief` (undefined keeps, null clears). action=create requires name + title; action=update requires chapterId. Prose files link back via frontmatter `chapter: <name>`.", SaveStoryChapterSchema, {mutates: true}, async (context, input) => {
            const {projectRoot, action, chapterId, ...payload} = input;
            return runPlotOperation(context, projectRoot, async (facade) => {
                if (action === "create") {
                    if (chapterId !== undefined) {
                        throw new Error("save_story_chapter 参数校验失败：action=create 不接受 chapterId；如要修改已有章，请改用 action=update。");
                    }
                    const {name, title} = payload;
                    if (!name || !title) {
                        throw new Error("save_story_chapter 参数校验失败：action=create 必须提供 name 和 title。");
                    }
                    return plotResult(await facade.createStoryChapter({...payload, name, title}));
                }
                if (!chapterId) {
                    throw new Error("save_story_chapter 参数校验失败：action=update 必须提供 chapterId；可先用 get_story_tree 查看现有章。");
                }
                return plotResult(await facade.updateStoryChapter(parseEntityId("chapterId", chapterId), payload));
            });
        }),
        tool("save_story_thread", "Create, update or archive a story thread. action=create requires name + title; action=update/archive targets threadId (defaults to plot.selection); archive sets status to archived (soft delete).", SaveStoryThreadSchema, {mutates: true}, async (context, input) => {
            const {projectRoot, action, threadId, ...payload} = input;
            const result = await runPlotOperation(context, projectRoot, async (facade) => {
                if (action === "create") {
                    if (threadId !== undefined) {
                        throw new Error("save_story_thread 参数校验失败：action=create 不接受 threadId；如要修改已有 Thread，请改用 action=update。");
                    }
                    const {name, title} = payload;
                    if (!name || !title) {
                        throw new Error("save_story_thread 参数校验失败：action=create 必须提供 name 和 title。");
                    }
                    return facade.createStoryThread({...payload, name, title});
                }
                const resolvedThreadId = await resolveThreadId(context, projectRoot, threadId);
                if (action === "archive" && payload.status !== undefined && payload.status !== "archived") {
                    throw new Error(`save_story_thread 参数校验失败：action=archive 会把 status 置为 archived，不能同时传入 status=${payload.status}；如要设置其他状态请用 action=update。`);
                }
                const patch = action === "archive" ? {...payload, status: "archived" as const} : payload;
                return facade.updateStoryThread(resolvedThreadId, patch);
            });
            if (action === "create") {
                await writeSelection(context, {projectRoot, threadId: result.id, sceneId: undefined});
                return plotResult(result);
            }
            await writeSelection(context, {projectRoot, threadId: result.id, sceneId: undefined});
            return plotResult(result);
        }),
        tool("save_story_scene", "Create, update or archive a story scene. action=create requires title (threadId defaults to plot.selection); action=update/archive targets sceneId (defaults to plot.selection); archive sets status to archived (soft delete).", SaveStorySceneSchema, {mutates: true}, async (context, input) => {
            const {projectRoot, action, sceneId, ...payload} = input;
            const result = await runPlotOperation(context, projectRoot, async (facade) => {
                if (action === "create") {
                    if (sceneId !== undefined) {
                        throw new Error("save_story_scene 参数校验失败：action=create 不接受 sceneId；如要修改已有 Scene，请改用 action=update。");
                    }
                    const {title} = payload;
                    if (!title) {
                        throw new Error("save_story_scene 参数校验失败：action=create 必须提供 title。");
                    }
                    const threadId = await resolveThreadId(context, projectRoot, payload.threadId);
                    return facade.createStoryScene(normalizeScenePayload({...payload, title, threadId: String(threadId)}));
                }
                const resolvedSceneId = await resolveSceneId(context, projectRoot, sceneId);
                if (action === "archive" && payload.status !== undefined && payload.status !== "archived") {
                    throw new Error(`save_story_scene 参数校验失败：action=archive 会把 status 置为 archived，不能同时传入 status=${payload.status}；如要设置其他状态请用 action=update。`);
                }
                const patch = action === "archive" ? {...payload, status: "archived" as const} : payload;
                return facade.updateStoryScene(resolvedSceneId, normalizeScenePayload(patch));
            });
            if (action === "create") {
                await writeSelection(context, {projectRoot, threadId: result.threadId, sceneId: result.id});
                return plotResult(result);
            }
            await writeSelection(context, {projectRoot, threadId: result.threadId, sceneId: result.id});
            return plotResult(result);
        }),
        tool("save_story_promise", "Create or update a reader promise (ledger entry), or mark it abandoned/fulfilled. action=create requires name + title; other actions require promiseId. Reopen with action=update + status=open. Payoff usually fulfills automatically via save_promise_beat.", SaveStoryPromiseSchema, {mutates: true}, async (context, input) => {
            const {projectRoot, action, promiseId, ...payload} = input;
            return runPlotOperation(context, projectRoot, async (facade) => {
                if (action === "create") {
                    if (promiseId !== undefined) {
                        throw new Error("save_story_promise 参数校验失败：action=create 不接受 promiseId；如要修改已有 Promise，请改用 action=update。");
                    }
                    if (payload.status !== undefined) {
                        throw new Error("save_story_promise 参数校验失败：action=create 不接受 status（新建 Promise 恒为 open）；生命周期用 action=abandon/fulfill。");
                    }
                    const {name, title} = payload;
                    if (!name || !title) {
                        throw new Error("save_story_promise 参数校验失败：action=create 必须提供 name 和 title。");
                    }
                    return plotResult(await facade.createStoryPromise({...payload, name, title}));
                }
                if (!promiseId) {
                    throw new Error(`save_story_promise 参数校验失败：action=${action} 必须提供 promiseId；可先用 get_story_promise 查看现有 Promise。`);
                }
                const resolvedPromiseId = parseEntityId("promiseId", promiseId);
                if (action === "abandon" || action === "fulfill") {
                    const targetStatus = action === "abandon" ? "abandoned" as const : "fulfilled" as const;
                    if (payload.status !== undefined && payload.status !== targetStatus) {
                        throw new Error(`save_story_promise 参数校验失败：action=${action} 会把 status 置为 ${targetStatus}，不能同时传入 status=${payload.status}；如要设置其他状态请用 action=update。`);
                    }
                    return plotResult(await facade.updateStoryPromise(resolvedPromiseId, {...payload, status: targetStatus}));
                }
                return plotResult(await facade.updateStoryPromise(resolvedPromiseId, payload));
            });
        }),
        tool("save_promise_beat", "Set (upsert) or remove a promise beat on a story scene — the planned/factual touchpoint of a promise. One beat per promise x scene; setting again overwrites kind/note. kind=payoff auto-fulfills the promise unless autoFulfill=false. sceneId defaults to plot.selection.", SavePromiseBeatSchema, {mutates: true}, async (context, input) => {
            const promiseId = parseEntityId("promiseId", input.promiseId);
            const sceneId = await resolveSceneId(context, input.projectRoot, input.sceneId);
            return runPlotOperation(context, input.projectRoot, async (facade) => {
                if (input.action === "set") {
                    if (!input.kind) {
                        throw new Error("save_promise_beat 参数校验失败：action=set 必须提供 kind（plant/advance/setback/payoff）。");
                    }
                    return plotResult(await facade.setPromiseBeat(promiseId, {
                        sceneId: String(sceneId),
                        kind: input.kind,
                        note: input.note,
                        autoFulfill: input.autoFulfill,
                    }));
                }
                if (input.kind !== undefined || input.note !== undefined || input.autoFulfill !== undefined) {
                    throw new Error("save_promise_beat 参数校验失败：action=remove 只需要 promiseId 与 sceneId，不接受 kind/note/autoFulfill。");
                }
                return plotResult(await facade.removePromiseBeat(promiseId, sceneId));
            });
        }),
        tool("save_story_decision", "Create or update a story decision (ADR entry), settle it (decide) or drop it as moot. Record a decision whenever the reasoning, if unwritten, would let the next agent make a different or worse choice. action=create requires name + title + question; action=decide requires decision + motivation + risk (the brake point — enforced) and turns unchosen options into rejectedAlternatives skeletons (fill whyRejected afterwards); action=drop requires note explaining why the question became moot. Reopen with action=update + status=open; supersede with action=update + status=superseded + supersededById.", SaveStoryDecisionSchema, {mutates: true}, async (context, input) => {
            const {projectRoot, action, decisionId, ...rawPayload} = input;
            return runPlotOperation(context, projectRoot, async (facade) => {
                // options/rejectedAlternatives 的可省备注统一补 null,对齐 DTO 的显式清空语义。
                const payload = {
                    ...rawPayload,
                    options: rawPayload.options?.map((item) => ({option: item.option, note: item.note ?? null})),
                    rejectedAlternatives: rawPayload.rejectedAlternatives?.map((item) => ({option: item.option, whyRejected: item.whyRejected ?? null})),
                };
                if (action === "create") {
                    if (decisionId !== undefined) {
                        throw new Error("save_story_decision 参数校验失败：action=create 不接受 decisionId；如要修改已有 Decision，请改用 action=update。");
                    }
                    const decidedOnlyFields: string[] = [];
                    if (payload.status !== undefined) decidedOnlyFields.push("status");
                    if (payload.decision !== undefined) decidedOnlyFields.push("decision");
                    if (payload.motivation !== undefined) decidedOnlyFields.push("motivation");
                    if (payload.risk !== undefined) decidedOnlyFields.push("risk");
                    if (payload.rejectedAlternatives !== undefined) decidedOnlyFields.push("rejectedAlternatives");
                    if (payload.supersededById !== undefined) decidedOnlyFields.push("supersededById");
                    if (payload.chosenOption !== undefined) decidedOnlyFields.push("chosenOption");
                    if (decidedOnlyFields.length > 0) {
                        throw new Error(`save_story_decision 参数校验失败：action=create 建立 open 态决策，不接受 ${decidedOnlyFields.join("/")}；拍板请随后用 action=decide。`);
                    }
                    const {name, title, question} = payload;
                    if (!name || !title || !question) {
                        throw new Error("save_story_decision 参数校验失败：action=create 必须提供 name、title 和 question（待决问题是 open 态的核心）。");
                    }
                    return plotResult(await facade.createStoryDecision({
                        name,
                        title,
                        question,
                        options: payload.options,
                        deadlineChapterId: payload.deadlineChapterId,
                        serves: payload.serves,
                        dependsOn: payload.dependsOn,
                        anchor: payload.anchor,
                        note: payload.note,
                    }));
                }
                if (!decisionId) {
                    throw new Error(`save_story_decision 参数校验失败：action=${action} 必须提供 decisionId；可先用 get_story_decision 查看现有 Decision。`);
                }
                const resolvedDecisionId = parseEntityId("decisionId", decisionId);
                if (action === "decide" || action === "drop") {
                    const targetStatus = action === "decide" ? "decided" as const : "dropped" as const;
                    if (payload.status !== undefined && payload.status !== targetStatus) {
                        throw new Error(`save_story_decision 参数校验失败：action=${action} 会把 status 置为 ${targetStatus}，不能同时传入 status=${payload.status}；如要设置其他状态请用 action=update。`);
                    }
                    return plotResult(await facade.updateStoryDecision(resolvedDecisionId, {...payload, status: targetStatus}));
                }
                return plotResult(await facade.updateStoryDecision(resolvedDecisionId, payload));
            });
        }),
        tool("bootstrap_carrier_tree", "Scan the manuscript directory tree and rebuild the carrier side of the plot tree: create a StoryAct per volume directory and a StoryChapter per chapter directory, then write `chapter: <name>` back-references into each chapter's Prose index.md frontmatter. Idempotent — reruns skip existing entities and pointers. Use once after importing a finished book into manuscript/ so the plot tree mirrors the actual chapters.", ProjectScopedSchema, {mutates: true}, async (context, input) => (
            runPlotOperation(context, input.projectRoot, async (facade) => plotResult(await facade.bootstrapCarrierTree()))
        )),
    ];
}

/**
 * plot 工具定义 helper。options.mutates 必填：强制每个工具显式声明读写意图（D29 显式语义），
 * save_* 落库 project.sqlite 属 Project Workspace 状态变更，标 mutatesWorkspace 后
 * 只读模式（discuss/plan）由 harness 按 Task 90 机制注入写审批（Task 97 D8 确认沿用该等价机制，不另造 mutates 字段）。
 */
function tool<TSchemaValue extends TSchema>(
    key: string,
    description: string,
    parameters: TSchemaValue,
    options: {mutates: boolean},
    execute: (context: ToolExecutionContext, input: Static<TSchemaValue>) => Promise<NeuroToolResult>,
): NeuroAgentTool {
    return {
        key,
        name: key,
        label: key,
        executionMode: "sequential",
        description,
        parameters,
        mutatesWorkspace: options.mutates,
        async execute() {
            throw new Error(`${key} 需要 v3 session context。`);
        },
        async executeWithContext(context, _toolCallId, params: unknown) {
            return execute(context, params as Static<TSchemaValue>);
        },
    };
}

async function readSelection(context: ToolExecutionContext): Promise<PlotSelection> {
    const session = await context.harness.readSessionContext(context.sessionId);
    const value = session.customState[PLOT_SELECTION_STATE_KEY];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const record = value as Record<string, JsonValue>;
    return {
        projectRoot: typeof record.projectRoot === "string" ? record.projectRoot : undefined,
        threadId: typeof record.threadId === "string" ? record.threadId : undefined,
        sceneId: typeof record.sceneId === "string" ? record.sceneId : undefined,
    };
}

async function resolveThreadId(context: ToolExecutionContext, projectRoot: string | undefined, threadId?: string): Promise<number> {
    const resolvedProjectRoot = projectRootForTool(context, projectRoot);
    const selection = await readSelection(context);
    const value = threadId ?? readSelectedId(selection, resolvedProjectRoot, "threadId");
    if (!value) {
        throw new Error("缺少 threadId；请显式提供 threadId，或先读取/创建一个 Thread 建立 plot.selection。");
    }
    return parseEntityId("threadId", value);
}

async function resolveSceneId(context: ToolExecutionContext, projectRoot: string | undefined, sceneId?: string): Promise<number> {
    const resolvedProjectRoot = projectRootForTool(context, projectRoot);
    const selection = await readSelection(context);
    const value = sceneId ?? readSelectedId(selection, resolvedProjectRoot, "sceneId");
    if (!value) {
        throw new Error("缺少 sceneId；请显式提供 sceneId，或先读取/创建一个 Scene 建立 plot.selection。");
    }
    return parseEntityId("sceneId", value);
}

function readSelectedId(selection: PlotSelection, projectRoot: string, key: "threadId" | "sceneId"): string | undefined {
    if (!selection[key]) {
        return undefined;
    }
    if (selection.projectRoot && selection.projectRoot !== projectRoot) {
        throw new Error(`plot.selection 属于 projectRoot=${selection.projectRoot}，本次工具调用传入 projectRoot=${projectRoot}；跨 Project 访问时请显式提供 ${key}。`);
    }
    return selection[key];
}

function normalizeScenePayload<TPayload extends {refs?: SceneRefPayload[]}>(payload: TPayload): Omit<TPayload, "refs"> & {refs?: SceneRefPayloadWithNote[]} {
    if (!payload.refs) {
        return payload as Omit<TPayload, "refs"> & {refs?: SceneRefPayloadWithNote[]};
    }
    return {
        ...payload,
        refs: payload.refs.map((ref) => ({
            ...ref,
            note: ref.note ?? null,
        })),
    };
}

async function writeSelection(context: ToolExecutionContext, patch: PlotSelection): Promise<void> {
    const current = await readSelection(context);
    const projectRoot = patch.projectRoot ?? context.currentProject?.workspace.ref.projectRoot;
    if (!projectRoot) {
        throw new Error("plot.selection 需要当前已打开的 Project；未绑定 Project 时不能省略 projectRoot。");
    }
    await context.harness.appendCustomState(context.sessionId, PLOT_SELECTION_STATE_KEY, {
        ...current,
        ...patch,
        projectRoot,
        updatedAt: new Date().toISOString(),
    } as JsonValue, context.invocationId);
}

function plotResult(details: unknown): NeuroToolResult {
    return {
        content: [{type: "text" as const, text: JSON.stringify(details, null, 2)}],
        details: normalizeToolResultDetails(details),
    };
}

/** 在调用方选定的 exact Project generation 内执行一次 Plot 操作。 */
async function runPlotOperation<TResult>(
    context: ToolExecutionContext,
    projectRootInput: string | undefined,
    operation: (facade: PlotFacade) => Promise<TResult>,
): Promise<TResult> {
    const ready = plotProjectForTool(context, projectRootInput);
    return runReadyProjectOperation(ready, async () => {
        const {plot} = await activateReadyProjectModule(
            ready,
            PROJECT_PLOT_WORLD_MODULE_TOKEN,
        );
        return operation(plot);
    });
}

/** Current Project复用工具上下文的exact ref；显式跨Project root要求目标已ready。 */
function plotProjectForTool(context: ToolExecutionContext, projectRootInput?: string): ReadyProjectSessionRef {
    if (projectRootInput === undefined) {
        if (!context.currentProject) {
            throw new Error("Plot 工具需要当前已打开的 Project；未绑定 Project 时请显式提供 projectRoot。");
        }
        return context.currentProject;
    }
    const ref = projectWorkspaceRef(projectRootInput);
    const currentProject = context.currentProject;
    if (currentProject?.workspace.ref.projectRoot === ref.projectRoot) {
        return currentProject;
    }
    return requireActiveReadyProject(ref);
}

/** 返回当前或显式目标 Project 的稳定单段 root，仅用于 selection 归属比较。 */
function projectRootForTool(context: ToolExecutionContext, projectRootInput?: string): string {
    return plotProjectForTool(context, projectRootInput).workspace.ref.projectRoot;
}
