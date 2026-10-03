import {parseEntityId, parseNullableEntityId} from "nbook/server/utils/novel-chapter";
import type {
    ParsedCreateStoryChapterInput,
    ParsedCreateStoryDecisionInput,
    ParsedCreateStoryPromiseInput,
    ParsedCreateStorySceneInput,
    ParsedCreateStoryThreadInput,
    ParsedReorderStoryPhaseItem,
    ParsedReorderStorySceneItem,
    ParsedReorderStoryThreadItem,
    ParsedSetPromiseBeatInput,
    ParsedUpdateStoryChapterInput,
    ParsedUpdateStoryDecisionInput,
    ParsedUpdateStoryPromiseInput,
    ParsedUpdateStorySceneInput,
    ParsedUpdateStoryThreadInput,
    ResolvedStoryRefInput,
    SceneWorldAnchor,
} from "nbook/server/plot/core/types";
import type {
    CreateStoryChapterRequestDto,
    CreateStoryDecisionRequestDto,
    CreateStoryPromiseRequestDto,
    CreateStorySceneRequestDto,
    CreateStoryThreadRequestDto,
    ReorderStoryPhasesRequestDto,
    ReorderStoryScenesRequestDto,
    ReorderStoryThreadsRequestDto,
    SetPromiseBeatRequestDto,
    UpdateStoryChapterRequestDto,
    UpdateStoryDecisionRequestDto,
    UpdateStoryPromiseRequestDto,
    UpdateStorySceneRequestDto,
    UpdateStoryThreadRequestDto,
} from "nbook/shared/dto/plot.dto";

/**
 * 剧情模块输入解析器。
 * 负责把 HTTP DTO 转成内部使用的 number/null 结构。
 */
export class PlotInputParser {

    /**
     * 解析线程创建输入。
     */
    parseCreateThread(input: CreateStoryThreadRequestDto): ParsedCreateStoryThreadInput {
        return {
            ...input,
            storyPhaseId: parseNullableEntityId("phaseId", input.storyPhaseId),
        };
    }

    /**
     * 解析线程更新输入。
     */
    parseUpdateThread(input: UpdateStoryThreadRequestDto): ParsedUpdateStoryThreadInput {
        return {
            ...input,
            storyPhaseId: input.storyPhaseId === undefined
                ? undefined
                : parseNullableEntityId("phaseId", input.storyPhaseId),
        };
    }

    /**
     * 解析线程重排输入。
     */
    parseReorderThreads(input: ReorderStoryThreadsRequestDto): ParsedReorderStoryThreadItem[] {
        return input.items.map((item) => ({
            threadId: parseEntityId("threadId", item.threadId),
            storyPhaseId: parseNullableEntityId("phaseId", item.storyPhaseId),
            sortOrder: item.sortOrder,
        }));
    }

    /**
     * 解析阶段重排输入。
     */
    parseReorderPhases(input: ReorderStoryPhasesRequestDto): ParsedReorderStoryPhaseItem[] {
        return input.items.map((item) => ({
            phaseId: parseEntityId("phaseId", item.phaseId),
            sortOrder: item.sortOrder,
        }));
    }

    /**
     * 解析章节创建输入。
     */
    parseCreateChapter(input: CreateStoryChapterRequestDto): ParsedCreateStoryChapterInput {
        return {
            ...input,
            actId: parseNullableEntityId("actId", input.actId),
        };
    }

    /**
     * 解析章节更新输入。
     */
    parseUpdateChapter(input: UpdateStoryChapterRequestDto): ParsedUpdateStoryChapterInput {
        return {
            ...input,
            actId: input.actId === undefined
                ? undefined
                : parseNullableEntityId("actId", input.actId),
        };
    }

    /**
     * 解析场景创建输入。
     */
    parseCreateScene(
        input: Omit<CreateStorySceneRequestDto, "worldAnchor"> & {resolvedRefs?: ResolvedStoryRefInput[]; worldAnchor: SceneWorldAnchor},
    ): ParsedCreateStorySceneInput {
        return {
            ...input,
            threadId: parseEntityId("threadId", input.threadId),
            chapterId: parseNullableEntityId("chapterId", input.chapterId),
            refs: input.refs ?? [],
        };
    }

    /**
     * 解析场景更新输入。
     */
    parseUpdateScene(
        input: Omit<UpdateStorySceneRequestDto, "worldAnchor"> & {resolvedRefs?: ResolvedStoryRefInput[]; worldAnchor?: SceneWorldAnchor},
    ): ParsedUpdateStorySceneInput {
        return {
            ...input,
            threadId: input.threadId === undefined ? undefined : parseEntityId("threadId", input.threadId),
            chapterId: input.chapterId === undefined ? undefined : parseNullableEntityId("chapterId", input.chapterId),
            refs: input.refs,
        };
    }

    /**
     * 解析场景重排输入。
     */
    parseReorderScenes(input: ReorderStoryScenesRequestDto): ParsedReorderStorySceneItem[] {
        return input.items.map((item) => ({
            sceneId: parseEntityId("sceneId", item.sceneId),
            threadId: parseEntityId("threadId", item.threadId),
            chapterId: parseNullableEntityId("chapterId", item.chapterId),
            threadSortOrder: item.threadSortOrder,
            chapterSortOrder: item.chapterSortOrder,
        }));
    }

    /**
     * 解析 Promise 创建输入。deadlineChapterId 缺省与 null 都表示无兑现期限。
     */
    parseCreatePromise(input: CreateStoryPromiseRequestDto): ParsedCreateStoryPromiseInput {
        return {
            ...input,
            deadlineChapterId: parseNullableEntityId("chapterId", input.deadlineChapterId),
        };
    }

    /**
     * 解析 Promise 更新输入。deadlineChapterId 为 undefined 不修改,null 显式清空。
     */
    parseUpdatePromise(input: UpdateStoryPromiseRequestDto): ParsedUpdateStoryPromiseInput {
        return {
            ...input,
            deadlineChapterId: input.deadlineChapterId === undefined
                ? undefined
                : parseNullableEntityId("chapterId", input.deadlineChapterId),
        };
    }

    /**
     * 解析 beat set 输入(sceneId 转数字)。
     */
    parseSetPromiseBeat(input: SetPromiseBeatRequestDto): ParsedSetPromiseBeatInput {
        return {
            ...input,
            sceneId: parseEntityId("sceneId", input.sceneId),
        };
    }

    /**
     * 解析 Decision 创建输入。deadlineChapterId 缺省与 null 都表示无拍板期限。
     */
    parseCreateDecision(input: CreateStoryDecisionRequestDto): ParsedCreateStoryDecisionInput {
        return {
            ...input,
            deadlineChapterId: parseNullableEntityId("chapterId", input.deadlineChapterId),
        };
    }

    /**
     * 解析 Decision 更新输入。deadlineChapterId/supersededById 为 undefined 不修改,null 显式清空。
     */
    parseUpdateDecision(input: UpdateStoryDecisionRequestDto): ParsedUpdateStoryDecisionInput {
        return {
            ...input,
            deadlineChapterId: input.deadlineChapterId === undefined
                ? undefined
                : parseNullableEntityId("chapterId", input.deadlineChapterId),
            supersededById: input.supersededById === undefined
                ? undefined
                : parseNullableEntityId("decisionId", input.supersededById),
        };
    }
}
