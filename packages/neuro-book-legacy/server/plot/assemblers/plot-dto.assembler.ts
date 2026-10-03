import type {
    Story,
    StoryAct,
    StoryChapter,
    StoryPhase,
    StoryScene,
} from "nbook/server/generated/project-prisma/client";
import type {
    ChapterPlotSceneWithThread,
    StoryActWithChapters,
    StoryPromiseBeatWithPromise,
    StoryPromiseBeatWithScene,
    StoryPromiseWithBeats,
    StoryDecisionResolved,
    StorySceneRefWithTargets,
    StorySceneWithChapter,
    StorySceneWithDetails,
    StoryThreadEntity,
    StoryThreadWithScenes,
    StoryWorkbenchPhase,
    StoryWorkbenchScene,
    StoryWorkbenchThread,
} from "nbook/server/plot/core/types";
import {stringifyEntityId} from "nbook/server/utils/novel-chapter";
import type {
    ChapterBriefDto,
    ChapterPlotDetailDto,
    ChapterPlotSceneDto,
    PlotTreeDto,
    PlotWorkbenchDto,
    StoryActDto,
    StoryActTreeNodeDto,
    StoryChapterDto,
    StoryDto,
    StoryEffectiveRefDto,
    StoryPhaseDto,
    StoryPromiseBeatDto,
    StoryPromiseBeatStateDto,
    StoryPromiseBeatStatsDto,
    StoryPromiseDetailDto,
    StoryPromiseDto,
    StoryDecisionDto,
    StoryRefDto,
    StorySceneDetailDto,
    StoryScenePromiseBeatDto,
    StorySceneWorldAnchorDto,
    StorySceneSummaryDto,
    StoryWorkbenchPhaseDto,
    StoryWorkbenchSceneDto,
    StoryWorkbenchThreadDto,
    StoryThreadDetailDto,
    StoryThreadSummaryDto,
} from "nbook/shared/dto/plot.dto";
import {
    buildReferenceUri,
    parseStructuredReferenceTarget,
} from "nbook/shared/reference-core";

/**
 * 剧情 DTO 组装器。
 */
export class PlotDtoAssembler {

    /**
     * 映射 Story DTO。
     */
    toStoryDto(story: Story): StoryDto {
        return {
            id: stringifyEntityId(story.id),
            title: story.title,
            summary: story.summary,
            note: story.note,
            createdAt: story.createdAt.toISOString(),
            updatedAt: story.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 StoryPhase DTO。
     */
    toStoryPhaseDto(phase: StoryPhase): StoryPhaseDto {
        return {
            id: stringifyEntityId(phase.id),
            storyId: stringifyEntityId(phase.storyId),
            sortOrder: phase.sortOrder,
            name: phase.name,
            title: phase.title,
            summary: phase.summary,
            note: phase.note,
            createdAt: phase.createdAt.toISOString(),
            updatedAt: phase.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 Thread 摘要 DTO。
     */
    toStoryThreadSummaryDto(thread: StoryThreadEntity): StoryThreadSummaryDto {
        return {
            id: stringifyEntityId(thread.id),
            storyId: stringifyEntityId(thread.storyId),
            storyPhaseId: thread.storyPhaseId === null ? null : stringifyEntityId(thread.storyPhaseId),
            sortOrder: thread.sortOrder,
            name: thread.name,
            title: thread.title,
            isMainThread: thread.isMainThread,
            status: thread.status,
            miceType: thread.miceType,
            summary: thread.summary,
            tags: thread.tags,
            writingTip: thread.writingTip,
            note: thread.note,
            createdAt: thread.createdAt.toISOString(),
            updatedAt: thread.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 StoryAct DTO。
     */
    toStoryActDto(act: StoryAct): StoryActDto {
        return {
            id: stringifyEntityId(act.id),
            storyId: stringifyEntityId(act.storyId),
            sortOrder: act.sortOrder,
            name: act.name,
            title: act.title,
            summary: act.summary,
            note: act.note,
            createdAt: act.createdAt.toISOString(),
            updatedAt: act.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 ChapterBrief DTO(StoryChapter 上的 brief* 列 → 嵌套对象)。
     */
    toChapterBriefDto(chapter: StoryChapter): ChapterBriefDto {
        return {
            goal: chapter.briefGoal,
            pov: chapter.briefPov,
            tone: chapter.briefTone,
            pacing: chapter.briefPacing,
            readerKnows: chapter.briefReaderKnows,
            protagonistKnows: chapter.briefProtagonistKnows,
            mustHide: chapter.briefMustHide,
            hintOnly: chapter.briefHintOnly,
            opening: chapter.briefOpening,
            ending: chapter.briefEnding,
            doNotWrite: chapter.briefDoNotWrite,
        };
    }

    /**
     * 映射 StoryChapter DTO。
     */
    toStoryChapterDto(chapter: StoryChapter): StoryChapterDto {
        return {
            id: stringifyEntityId(chapter.id),
            storyId: stringifyEntityId(chapter.storyId),
            actId: chapter.actId === null ? null : stringifyEntityId(chapter.actId),
            sortOrder: chapter.sortOrder,
            name: chapter.name,
            title: chapter.title,
            note: chapter.note,
            brief: this.toChapterBriefDto(chapter),
            createdAt: chapter.createdAt.toISOString(),
            updatedAt: chapter.updatedAt.toISOString(),
        };
    }

    /**
     * 映射承载树 Act 节点 DTO。
     */
    toStoryActTreeNodeDto(act: StoryActWithChapters): StoryActTreeNodeDto {
        return {
            ...this.toStoryActDto(act),
            chapters: act.chapters.map((chapter) => this.toStoryChapterDto(chapter)),
        };
    }

    /**
     * 映射 Scene 摘要 DTO。
     */
    toStorySceneSummaryDto(scene: StorySceneWithChapter): StorySceneSummaryDto {
        return {
            id: stringifyEntityId(scene.id),
            storyId: stringifyEntityId(scene.storyId),
            threadId: stringifyEntityId(scene.threadId),
            chapterId: scene.chapterId === null ? null : stringifyEntityId(scene.chapterId),
            chapter: scene.chapter === null ? null : {
                id: stringifyEntityId(scene.chapter.id),
                name: scene.chapter.name,
                title: scene.chapter.title,
            },
            threadSortOrder: scene.threadSortOrder,
            chapterSortOrder: scene.chapterSortOrder,
            title: scene.title,
            status: scene.status,
            outcomeType: scene.outcomeType,
            pacingRole: scene.pacingRole,
            summary: scene.summary,
            purpose: scene.purpose,
            writingTip: scene.writingTip,
            note: scene.note,
            worldAnchor: this.toStorySceneWorldAnchorDto(scene),
            createdAt: scene.createdAt.toISOString(),
            updatedAt: scene.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 Scene World Anchor DTO。
     */
    toStorySceneWorldAnchorDto(scene: StoryScene): StorySceneWorldAnchorDto {
        const subjectIds = parseSubjectIdsJson(scene.subjectIdsJson);
        const locationSubjectId = scene.locationSubjectId;
        return {
            startTime: null,
            endTime: null,
            startInstant: scene.startInstant === null ? null : scene.startInstant.toString(),
            endInstant: scene.endInstant === null ? null : scene.endInstant.toString(),
            subjectIds,
            locationSubjectId,
            subjects: subjectIds.map(createUnresolvedAnchorSubject),
            locationSubject: locationSubjectId === null ? null : createUnresolvedAnchorSubject(locationSubjectId),
            unresolvedSubjectIds: uniqueSubjectIds([
                ...subjectIds,
                ...(locationSubjectId === null ? [] : [locationSubjectId]),
            ]),
        };
    }

    /**
     * 规范化 ref target。
     */
    normalizeStoryRefTarget(ref: StorySceneRefWithTargets): string {
        if (ref.targetKind === "content") {
            return parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget;
        }

        if (ref.targetKind === "thread") {
            return ref.targetThread ? buildReferenceUri("thread", stringifyEntityId(ref.targetThread.id)) : (
                parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget
            );
        }

        if (ref.targetKind === "scene") {
            return ref.targetScene ? buildReferenceUri("scene", stringifyEntityId(ref.targetScene.id)) : (
                parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget
            );
        }

        return parseStructuredReferenceTarget(ref.rawTarget)?.canonicalTarget ?? ref.rawTarget;
    }

    /**
     * 映射 ref DTO。
     */
    toStoryRefDto(ref: StorySceneRefWithTargets): StoryRefDto {
        return {
            relation: ref.relation,
            target: this.normalizeStoryRefTarget(ref),
            visibility: ref.visibility,
            note: ref.note,
        };
    }

    /**
     * 组装 Scene 的有效 refs。
     */
    buildEffectiveSceneRefs(scene: StorySceneWithDetails): StoryEffectiveRefDto[] {
        return scene.refs.map((ref) => ({
            ...this.toStoryRefDto(ref),
            sourceType: "scene" as const,
            sourceId: stringifyEntityId(scene.id),
        }));
    }

    /**
     * 映射不含 refs 的 Thread 详情 DTO。
     */
    toStoryThreadDetailWithoutRefsDto(thread: StoryThreadWithScenes): StoryThreadDetailDto {
        return {
            ...this.toStoryThreadSummaryDto(thread),
            scenes: thread.scenes.map((scene) => this.toStorySceneSummaryDto(scene)),
        };
    }

    /**
     * 映射 Scene 详情 DTO。
     */
    toStorySceneDetailDto(scene: StorySceneWithDetails): StorySceneDetailDto {
        return {
            ...this.toStorySceneSummaryDto(scene),
            refs: scene.refs.map((ref) => this.toStoryRefDto(ref)),
            effectiveRefs: this.buildEffectiveSceneRefs(scene),
            promiseBeats: scene.promiseBeats.map((beat) => this.toStoryScenePromiseBeatDto(beat, scene.status)),
        };
    }

    /**
     * 把 Scene.status 派生为 beat 三态(D2a/D5):
     * draft/active=planned(计划),written/revised=factual(事实),archived=archived(不参与任何派生)。
     */
    promiseBeatState(sceneStatus: StoryScene["status"]): StoryPromiseBeatStateDto {
        if (sceneStatus === "archived") {
            return "archived";
        }
        return sceneStatus === "written" || sceneStatus === "revised" ? "factual" : "planned";
    }

    /**
     * 映射 Scene 视角的 promise beat DTO(「这场戏服务哪些线」)。
     */
    toStoryScenePromiseBeatDto(beat: StoryPromiseBeatWithPromise, sceneStatus: StoryScene["status"]): StoryScenePromiseBeatDto {
        return {
            id: stringifyEntityId(beat.id),
            promiseId: stringifyEntityId(beat.promise.id),
            promiseName: beat.promise.name,
            promiseTitle: beat.promise.title,
            promiseStatus: beat.promise.status,
            kind: beat.kind,
            note: beat.note,
            state: this.promiseBeatState(sceneStatus),
        };
    }

    /**
     * 映射 Promise beat DTO(Promise 详情视角:含所在 Scene 与章位)。
     */
    toStoryPromiseBeatDto(beat: StoryPromiseBeatWithScene): StoryPromiseBeatDto {
        return {
            id: stringifyEntityId(beat.id),
            promiseId: stringifyEntityId(beat.promiseId),
            sceneId: stringifyEntityId(beat.sceneId),
            kind: beat.kind,
            note: beat.note,
            state: this.promiseBeatState(beat.scene.status),
            scene: {
                id: stringifyEntityId(beat.scene.id),
                threadId: stringifyEntityId(beat.scene.threadId),
                title: beat.scene.title,
                status: beat.scene.status,
                chapterId: beat.scene.chapterId === null ? null : stringifyEntityId(beat.scene.chapterId),
                chapter: beat.scene.chapter === null ? null : {
                    id: stringifyEntityId(beat.scene.chapter.id),
                    name: beat.scene.chapter.name,
                    title: beat.scene.chapter.title,
                },
                chapterSortOrder: beat.scene.chapterSortOrder,
            },
            createdAt: beat.createdAt.toISOString(),
            updatedAt: beat.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 Promise 摘要 DTO,同时计算派生阶段与 beat 计数(D5:中间态不落库)。
     * 有效 beat = 所在 Scene 非 archived;archived 场的 beats 只计入 archived 计数,不参与派生。
     */
    toStoryPromiseDto(promise: StoryPromiseWithBeats): StoryPromiseDto {
        const beatStats = this.buildPromiseBeatStats(promise.beats);
        return {
            id: stringifyEntityId(promise.id),
            storyId: stringifyEntityId(promise.storyId),
            name: promise.name,
            title: promise.title,
            status: promise.status,
            derivedStage: beatStats.payoff > 0
                ? "paid_off"
                : beatStats.advance + beatStats.setback > 0
                    ? "echoed"
                    : beatStats.plant > 0
                        ? "planted"
                        : "unplanted",
            importance: promise.importance,
            summary: promise.summary,
            payoffExpectation: promise.payoffExpectation,
            cadenceChapters: promise.cadenceChapters,
            deadlineChapterId: promise.deadlineChapterId === null ? null : stringifyEntityId(promise.deadlineChapterId),
            deadlineChapter: promise.deadlineChapter === null ? null : {
                id: stringifyEntityId(promise.deadlineChapter.id),
                name: promise.deadlineChapter.name,
                title: promise.deadlineChapter.title,
            },
            tags: promise.tags,
            beatStats,
            createdAt: promise.createdAt.toISOString(),
            updatedAt: promise.updatedAt.toISOString(),
        };
    }

    /**
     * 映射 Promise 详情 DTO(摘要 + beats 列表)。
     */
    toStoryPromiseDetailDto(promise: StoryPromiseWithBeats): StoryPromiseDetailDto {
        return {
            ...this.toStoryPromiseDto(promise),
            beats: promise.beats.map((beat) => this.toStoryPromiseBeatDto(beat)),
        };
    }

    /**
     * 映射 Decision DTO。
     * anchor 读时归一化(D12):anchorKind 对应载体(外键或 path)为 null——锚对象被删触发 SetNull——时
     * 视同 story 输出,不回写数据库;serves/dependsOn 的死引用标注由 service 解析后传入。
     */
    toStoryDecisionDto(decision: StoryDecisionResolved): StoryDecisionDto {
        const anchor = normalizeDecisionAnchor(decision);
        return {
            id: stringifyEntityId(decision.id),
            storyId: stringifyEntityId(decision.storyId),
            name: decision.name,
            title: decision.title,
            status: decision.status,
            question: decision.question,
            options: decision.options.map((item) => ({option: item.option, note: item.note})),
            deadlineChapterId: decision.deadlineChapterId === null ? null : stringifyEntityId(decision.deadlineChapterId),
            deadlineChapter: decision.deadlineChapter === null ? null : {
                id: stringifyEntityId(decision.deadlineChapter.id),
                name: decision.deadlineChapter.name,
                title: decision.deadlineChapter.title,
            },
            decision: decision.decision,
            motivation: decision.motivation,
            rejectedAlternatives: decision.rejectedAlternatives.map((item) => ({option: item.option, whyRejected: item.whyRejected})),
            risk: decision.risk,
            serves: decision.serves,
            dependsOn: decision.dependsOn,
            supersededById: decision.supersededById === null ? null : stringifyEntityId(decision.supersededById),
            anchorKind: anchor.anchorKind,
            anchorTargetId: anchor.anchorTargetId === null ? null : stringifyEntityId(anchor.anchorTargetId),
            anchorPath: anchor.anchorPath,
            note: decision.note,
            createdAt: decision.createdAt.toISOString(),
            updatedAt: decision.updatedAt.toISOString(),
        };
    }

    /**
     * 统计 beats:有效 beats(非 archived 场)按 kind 计数 + planned/factual/archived 三态计数。
     */
    private buildPromiseBeatStats(beats: StoryPromiseBeatWithScene[]): StoryPromiseBeatStatsDto {
        const stats: StoryPromiseBeatStatsDto = {plant: 0, advance: 0, setback: 0, payoff: 0, planned: 0, factual: 0, archived: 0};
        for (const beat of beats) {
            const state = this.promiseBeatState(beat.scene.status);
            stats[state] += 1;
            if (state !== "archived") {
                stats[beat.kind] += 1;
            }
        }
        return stats;
    }

    /**
     * 映射章节剧情 Scene DTO。
     */
    toChapterPlotSceneDto(scene: ChapterPlotSceneWithThread): ChapterPlotSceneDto {
        return {
            id: stringifyEntityId(scene.id),
            threadId: stringifyEntityId(scene.thread.id),
            threadTitle: scene.thread.title,
            threadIsMain: scene.thread.isMainThread,
            chapterId: scene.chapterId === null ? null : stringifyEntityId(scene.chapterId),
            chapterSortOrder: scene.chapterSortOrder,
            threadSortOrder: scene.threadSortOrder,
            title: scene.title,
            status: scene.status,
            summary: scene.summary,
            purpose: scene.purpose,
            worldAnchor: this.toStorySceneWorldAnchorDto(scene),
        };
    }

    /**
     * 映射章节剧情详情 DTO。
     */
    toChapterPlotDetailDto(chapter: StoryChapter, scenes: ChapterPlotSceneWithThread[]): ChapterPlotDetailDto {
        return {
            chapter: this.toStoryChapterDto(chapter),
            scenes: scenes.map((scene) => this.toChapterPlotSceneDto(scene)),
            totalScenes: scenes.length,
        };
    }

    /**
     * 映射 Workbench Scene DTO。
     */
    toStoryWorkbenchSceneDto(scene: StoryWorkbenchScene): StoryWorkbenchSceneDto {
        return {
            ...this.toStorySceneSummaryDto(scene),
            refs: scene.refs.map((ref) => this.toStoryRefDto(ref)),
        };
    }

    /**
     * 映射 Workbench Thread DTO。
     */
    toStoryWorkbenchThreadDto(thread: StoryWorkbenchThread): StoryWorkbenchThreadDto {
        return {
            ...this.toStoryThreadSummaryDto(thread),
            scenes: thread.scenes.map((scene) => this.toStoryWorkbenchSceneDto(scene)),
        };
    }

    /**
     * 映射 Workbench Phase DTO。
     */
    toStoryWorkbenchPhaseDto(phase: StoryWorkbenchPhase): StoryWorkbenchPhaseDto {
        return {
            ...this.toStoryPhaseDto(phase),
            threads: phase.threads.map((thread) => this.toStoryWorkbenchThreadDto(thread)),
        };
    }

    /**
     * 组装剧情树 DTO(因果树 + 承载树 + 规划层摘要)。
     */
    toPlotTreeDto(input: {
        story: Story;
        phases: Array<StoryPhase & {threads: Array<StoryThreadEntity & {scenes: StorySceneWithChapter[]}>}>;
        ungroupedThreads: Array<StoryThreadEntity & {scenes: StorySceneWithChapter[]}>;
        acts: StoryActWithChapters[];
        ungroupedChapters: StoryChapter[];
        openPromiseCount: number;
        openDecisionCount: number;
    }): PlotTreeDto {
        const phases = input.phases.map((phase) => ({
            ...this.toStoryPhaseDto(phase),
            threads: phase.threads.map((thread) => ({
                ...this.toStoryThreadSummaryDto(thread),
                scenes: thread.scenes.map((scene) => this.toStorySceneSummaryDto(scene)),
            })),
        }));
        const ungroupedThreads = input.ungroupedThreads.map((thread) => ({
            ...this.toStoryThreadSummaryDto(thread),
            scenes: thread.scenes.map((scene) => this.toStorySceneSummaryDto(scene)),
        }));
        const acts = input.acts.map((act) => this.toStoryActTreeNodeDto(act));
        const ungroupedChapters = input.ungroupedChapters.map((chapter) => this.toStoryChapterDto(chapter));

        return {
            story: this.toStoryDto(input.story),
            phases,
            ungroupedThreads,
            acts,
            ungroupedChapters,
            totalPhases: phases.length,
            totalThreads: phases.reduce((sum, phase) => sum + phase.threads.length, 0) + ungroupedThreads.length,
            totalScenes: phases.reduce((sum, phase) => (
                sum + phase.threads.reduce((threadSum, thread) => threadSum + thread.scenes.length, 0)
            ), 0) + ungroupedThreads.reduce((sum, thread) => sum + thread.scenes.length, 0),
            totalActs: acts.length,
            totalChapters: acts.reduce((sum, act) => sum + act.chapters.length, 0) + ungroupedChapters.length,
            openPromiseCount: input.openPromiseCount,
            openDecisionCount: input.openDecisionCount,
        };
    }

    /**
     * 组装剧本工作台 DTO。
     */
    toPlotWorkbenchDto(input: {
        story: Story;
        phases: StoryWorkbenchPhase[];
        ungroupedThreads: StoryWorkbenchThread[];
    }): PlotWorkbenchDto {
        const phases = input.phases.map((phase) => this.toStoryWorkbenchPhaseDto(phase));
        const ungroupedThreads = input.ungroupedThreads.map((thread) => this.toStoryWorkbenchThreadDto(thread));
        const totalScenes = phases.reduce((sum, phase) => (
            sum + phase.threads.reduce((threadSum, thread) => threadSum + thread.scenes.length, 0)
        ), 0) + ungroupedThreads.reduce((sum, thread) => sum + thread.scenes.length, 0);

        return {
            story: this.toStoryDto(input.story),
            phases,
            ungroupedThreads,
            totalPhases: phases.length,
            totalThreads: phases.reduce((sum, phase) => sum + phase.threads.length, 0) + ungroupedThreads.length,
            totalScenes,
        };
    }
}

type NormalizedDecisionAnchor = {
    anchorKind: StoryDecisionDto["anchorKind"];
    anchorTargetId: number | null;
    anchorPath: string | null;
};

/**
 * 归一化 Decision 主锚点。外键 SetNull 或 content path 缺失时降级为 story 视图。
 */
function normalizeDecisionAnchor(decision: StoryDecisionResolved): NormalizedDecisionAnchor {
    switch (decision.anchorKind) {
        case "act":
            return decision.anchorActId === null ? storyDecisionAnchor() : {anchorKind: "act", anchorTargetId: decision.anchorActId, anchorPath: null};
        case "chapter":
            return decision.anchorChapterId === null ? storyDecisionAnchor() : {anchorKind: "chapter", anchorTargetId: decision.anchorChapterId, anchorPath: null};
        case "thread":
            return decision.anchorThreadId === null ? storyDecisionAnchor() : {anchorKind: "thread", anchorTargetId: decision.anchorThreadId, anchorPath: null};
        case "scene":
            return decision.anchorSceneId === null ? storyDecisionAnchor() : {anchorKind: "scene", anchorTargetId: decision.anchorSceneId, anchorPath: null};
        case "promise":
            return decision.anchorPromiseId === null ? storyDecisionAnchor() : {anchorKind: "promise", anchorTargetId: decision.anchorPromiseId, anchorPath: null};
        case "content":
            return decision.anchorPath === null ? storyDecisionAnchor() : {anchorKind: "content", anchorTargetId: null, anchorPath: decision.anchorPath};
        case "story":
            return storyDecisionAnchor();
    }
}

/**
 * Decision 默认全书层锚点。
 */
function storyDecisionAnchor(): NormalizedDecisionAnchor {
    return {anchorKind: "story", anchorTargetId: null, anchorPath: null};
}

/**
 * 解析 Scene 出场 subject 列表。
 */
function parseSubjectIdsJson(value: string): string[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .map((item) => item.trim());
    } catch {
        return [];
    }
}

/**
 * 生成尚未解析到 World Engine subject 的占位展示项。
 */
function createUnresolvedAnchorSubject(subjectId: string): StorySceneWorldAnchorDto["subjects"][number] {
    return {
        id: subjectId,
        name: subjectId,
        type: "unknown",
        resolved: false,
    };
}

/**
 * 保留顺序去重 subject id。
 */
function uniqueSubjectIds(subjectIds: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const subjectId of subjectIds) {
        const normalized = subjectId.trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}
