import type {StoryScene} from "nbook/server/generated/project-prisma/client";
import type {SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {
    ChapterPlotSceneWithThread,
    ChapterWriterBriefSceneWithThread,
    PrismaExecutor,
    ResolvedStoryRefInput,
    StorySceneWithDetails,
    StoryThreadEntity,
} from "nbook/server/plot/core/types";
import {STORY_SCENE_CHAPTER_INCLUDE, STORY_SCENE_REF_INCLUDE} from "nbook/server/plot/repositories/includes";
import {normalizeThreadJsonTags} from "nbook/server/plot/repositories/thread-tags";

/**
 * Prisma 版 Scene 仓储。
 */
export class PrismaSceneRepository implements SceneRepository {
    constructor(private readonly prisma: PrismaExecutor) {}

    /**
     * 查询场景。
     */
    async findSceneById(sceneId: number): Promise<StoryScene | null> {
        return this.prisma.storyScene.findUnique({
            where: {id: sceneId},
        });
    }

    /**
     * 查询场景详情(含 refs、thread 与本场 promise beats)。
     */
    async findSceneWithDetailsById(sceneId: number): Promise<StorySceneWithDetails | null> {
        const scene = await this.prisma.storyScene.findUnique({
            where: {id: sceneId},
            include: {
                ...STORY_SCENE_CHAPTER_INCLUDE,
                refs: {
                    orderBy: [
                        {sortOrder: "asc"},
                        {id: "asc"},
                    ],
                    include: STORY_SCENE_REF_INCLUDE,
                },
                promiseBeats: {
                    orderBy: [
                        {promiseId: "asc"},
                        {id: "asc"},
                    ],
                    include: {
                        promise: {
                            select: {
                                id: true,
                                name: true,
                                title: true,
                                status: true,
                                payoffExpectation: true,
                            },
                        },
                    },
                },
                thread: {
                    select: {
                        id: true,
                        storyId: true,
                        storyPhaseId: true,
                        sortOrder: true,
                        name: true,
                        title: true,
                        isMainThread: true,
                        status: true,
                        miceType: true,
                        summary: true,
                        tags: true,
                        writingTip: true,
                        note: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
            },
        }) as Omit<StorySceneWithDetails, "thread"> & {thread: Omit<StoryThreadEntity, "tags"> & {tags: string}} | null;
        if (!scene) {
            return null;
        }
        return {
            ...scene,
            thread: normalizeThreadJsonTags(scene.thread),
        };
    }

    /**
     * 查询章节下的 Scene。
     */
    async findChapterScenes(chapterId: number): Promise<ChapterPlotSceneWithThread[]> {
        return this.prisma.storyScene.findMany({
            where: {chapterId},
            orderBy: [
                {chapterSortOrder: "asc"},
                {id: "asc"},
            ],
            include: {
                thread: {
                    select: {
                        id: true,
                        title: true,
                        isMainThread: true,
                    },
                },
            },
        }) as Promise<ChapterPlotSceneWithThread[]>;
    }

    /**
     * 查询 Chapter writer brief 所需的 Scene 与 Thread 只读字段(含 refs 供建议读取)。
     */
    async findChapterScenesForBrief(chapterId: number): Promise<ChapterWriterBriefSceneWithThread[]> {
        return this.prisma.storyScene.findMany({
            where: {chapterId},
            orderBy: [
                {chapterSortOrder: "asc"},
                {id: "asc"},
            ],
            include: {
                refs: {
                    orderBy: [
                        {sortOrder: "asc"},
                        {id: "asc"},
                    ],
                    include: STORY_SCENE_REF_INCLUDE,
                },
                thread: {
                    select: {
                        id: true,
                        title: true,
                        isMainThread: true,
                        summary: true,
                        writingTip: true,
                    },
                },
            },
        }) as Promise<ChapterWriterBriefSceneWithThread[]>;
    }

    /**
     * 返回 Story 下 Scene ID。
     */
    async findSceneIdsByStory(storyId: number): Promise<number[]> {
        const scenes = await this.prisma.storyScene.findMany({
            where: {storyId},
            select: {id: true},
        });
        return scenes.map((scene) => scene.id);
    }

    /**
     * 创建场景。
     */
    async createScene(input: {
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
    }): Promise<StoryScene> {
        return this.prisma.storyScene.create({
            data: input,
        });
    }

    /**
     * 更新场景。
     */
    async updateScene(
        sceneId: number,
        data: Partial<Pick<
        StoryScene,
        "threadId" | "chapterId" | "threadSortOrder" | "chapterSortOrder" | "title" | "status" | "outcomeType" | "pacingRole" | "summary" | "purpose" | "writingTip" | "note" | "startInstant" | "endInstant" | "subjectIdsJson" | "locationSubjectId"
    >>,
    ): Promise<StoryScene> {
        return this.prisma.storyScene.update({
            where: {id: sceneId},
            data,
        });
    }

    /**
     * 删除场景。
     */
    async deleteScene(sceneId: number): Promise<void> {
        await this.prisma.storyScene.delete({
            where: {id: sceneId},
        });
    }

    /**
     * 全量替换场景 refs。
     */
    async replaceRefs(sceneId: number, refs: ResolvedStoryRefInput[]): Promise<void> {
        await this.prisma.storySceneRef.deleteMany({
            where: {sceneId},
        });

        if (refs.length === 0) {
            return;
        }

        await this.prisma.storySceneRef.createMany({
            data: refs.map((ref) => ({
                sceneId,
                sortOrder: ref.sortOrder,
                relation: ref.relation,
                rawTarget: ref.rawTarget,
                targetKind: ref.targetKind,
                targetThreadId: ref.targetThreadId,
                targetSceneId: ref.targetSceneId,
                visibility: ref.visibility,
                note: ref.note,
            })),
        });
    }

    /**
     * 查询线程内的 Scene 排序快照。
     */
    async findScenesByThread(threadId: number): Promise<Pick<StoryScene, "id" | "threadSortOrder">[]> {
        return this.prisma.storyScene.findMany({
            where: {threadId},
            orderBy: [
                {threadSortOrder: "asc"},
                {id: "asc"},
            ],
            select: {
                id: true,
                threadSortOrder: true,
            },
        });
    }

    /**
     * 查询章节内的 Scene 排序快照。
     */
    async findScenesByChapter(chapterId: number): Promise<Pick<StoryScene, "id" | "chapterSortOrder">[]> {
        return this.prisma.storyScene.findMany({
            where: {chapterId},
            orderBy: [
                {chapterSortOrder: "asc"},
                {id: "asc"},
            ],
            select: {
                id: true,
                chapterSortOrder: true,
            },
        });
    }
}
