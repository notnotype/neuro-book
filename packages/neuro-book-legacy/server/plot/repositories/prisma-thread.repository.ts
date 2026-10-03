import type {StoryPhase, StoryThread} from "nbook/server/generated/project-prisma/client";
import type {ThreadRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {
    PrismaExecutor,
    StorySceneWithChapter,
    StoryThreadEntity,
    StoryThreadWithScenes,
    StoryWorkbenchPhase,
    StoryWorkbenchThread,
} from "nbook/server/plot/core/types";
import {STORY_SCENE_CHAPTER_INCLUDE, STORY_SCENE_REF_INCLUDE} from "nbook/server/plot/repositories/includes";

type StoryThreadWithJsonTags = Omit<StoryThread, "tags"> & {
    tags: string;
};

type StoryThreadData = Partial<Pick<
    StoryThread,
    "storyPhaseId" | "sortOrder" | "name" | "title" | "isMainThread" | "status" | "miceType" | "summary" | "writingTip" | "note"
>> & {
    tags?: string[];
};

/**
 * Prisma 版 Thread 仓储。
 */
export class PrismaThreadRepository implements ThreadRepository {
    constructor(private readonly prisma: PrismaExecutor) {}

    /**
     * 查询线程。
     */
    async findThreadById(threadId: number): Promise<StoryThreadEntity | null> {
        return normalizeThread(await this.prisma.storyThread.findUnique({
            where: {id: threadId},
        }) as StoryThreadWithJsonTags | null);
    }

    /**
     * 查询带 Scene 摘要的线程详情。
     */
    async findThreadWithScenesById(threadId: number): Promise<StoryThreadWithScenes | null> {
        const thread = await this.prisma.storyThread.findUnique({
            where: {id: threadId},
            include: {
                scenes: {
                    orderBy: [
                        {threadSortOrder: "asc"},
                        {id: "asc"},
                    ],
                    include: STORY_SCENE_CHAPTER_INCLUDE,
                },
            },
        }) as StoryThreadWithJsonTags & {scenes: StorySceneWithChapter[]} | null;
        return thread ? normalizeThreadWithScenes(thread) : null;
    }

    /**
     * 返回 Story 下线程 ID。
     */
    async findThreadIdsByStory(storyId: number): Promise<number[]> {
        const threads = await this.prisma.storyThread.findMany({
            where: {storyId},
            select: {id: true},
        });
        return threads.map((thread) => thread.id);
    }

    /**
     * 按 bucket 列出线程。
     */
    async findThreadsByStoryPhase(storyId: number, storyPhaseId: number | null): Promise<StoryThreadEntity[]> {
        const threads = await this.prisma.storyThread.findMany({
            where: {
                storyId,
                storyPhaseId,
            },
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
        }) as StoryThreadWithJsonTags[];
        return threads.map(normalizeThread);
    }

    /**
     * 按 name 查询线程。
     */
    async findThreadByName(storyId: number, name: string, excludeThreadId?: number): Promise<StoryThreadEntity | null> {
        return normalizeThread(await this.prisma.storyThread.findFirst({
            where: {
                storyId,
                name,
                ...(excludeThreadId ? {
                    NOT: {id: excludeThreadId},
                } : {}),
            },
        }) as StoryThreadWithJsonTags | null);
    }

    /**
     * 创建线程。
     */
    async createThread(input: {
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
    }): Promise<StoryThreadEntity> {
        return normalizeThread(await this.prisma.storyThread.create({
            data: toThreadData(input),
        }) as StoryThreadWithJsonTags);
    }

    /**
     * 更新线程。
     */
    async updateThread(
        threadId: number,
        data: StoryThreadData,
    ): Promise<StoryThreadEntity> {
        return normalizeThread(await this.prisma.storyThread.update({
            where: {id: threadId},
            data: toThreadData(data),
        }) as StoryThreadWithJsonTags);
    }

    /**
     * 删除线程。
     */
    async deleteThread(threadId: number): Promise<void> {
        await this.prisma.storyThread.delete({
            where: {id: threadId},
        });
    }

    /**
     * 按 name 解析 Thread 引用目标。
     */
    async findThreadTargetByName(storyId: number, name: string): Promise<Pick<StoryThread, "id" | "name"> | null> {
        return this.prisma.storyThread.findFirst({
            where: {
                storyId,
                name,
            },
            select: {
                id: true,
                name: true,
            },
        });
    }

    /**
     * 查询未分组线程树。
     */
    async findUngroupedThreads(storyId: number): Promise<Array<StoryThreadEntity & {scenes: StorySceneWithChapter[]}>> {
        const threads = await this.prisma.storyThread.findMany({
            where: {
                storyId,
                storyPhaseId: null,
            },
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
            include: {
                scenes: {
                    orderBy: [
                        {threadSortOrder: "asc"},
                        {id: "asc"},
                    ],
                    include: STORY_SCENE_CHAPTER_INCLUDE,
                },
            },
        }) as Array<StoryThreadWithJsonTags & {scenes: StorySceneWithChapter[]}>;
        return threads.map(normalizeThreadWithScenes);
    }

    /**
     * 查询未分组线程工作台树。
     */
    async findUngroupedWorkbenchThreads(storyId: number): Promise<StoryWorkbenchThread[]> {
        const threads = await this.prisma.storyThread.findMany({
            where: {
                storyId,
                storyPhaseId: null,
            },
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
            include: {
                scenes: {
                    orderBy: [
                        {threadSortOrder: "asc"},
                        {id: "asc"},
                    ],
                    include: {
                        ...STORY_SCENE_CHAPTER_INCLUDE,
                        refs: {
                            orderBy: [
                                {sortOrder: "asc"},
                                {id: "asc"},
                            ],
                            include: STORY_SCENE_REF_INCLUDE,
                        },
                    },
                },
            },
        }) as Array<StoryThreadWithJsonTags & StoryWorkbenchThread>;
        return threads.map(normalizeThreadWithScenes) as StoryWorkbenchThread[];
    }

    /**
     * 查询阶段树。
     */
    async findPhaseThreadsWithScenes(storyId: number): Promise<Array<StoryPhase & {threads: Array<StoryThreadEntity & {scenes: StorySceneWithChapter[]}>}>> {
        const phases = await this.prisma.storyPhase.findMany({
            where: {storyId},
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
            include: {
                threads: {
                    where: {storyId},
                    orderBy: [
                        {sortOrder: "asc"},
                        {id: "asc"},
                    ],
                    include: {
                        scenes: {
                            orderBy: [
                                {threadSortOrder: "asc"},
                                {id: "asc"},
                            ],
                            include: STORY_SCENE_CHAPTER_INCLUDE,
                        },
                    },
                },
            },
        });
        return phases.map((phase) => ({
            ...phase,
            threads: phase.threads.map((thread) => normalizeThreadWithScenes(thread as StoryThreadWithJsonTags & {scenes: StorySceneWithChapter[]})),
        }));
    }

    /**
     * 查询阶段线程工作台树。
     */
    async findWorkbenchPhaseThreads(storyId: number): Promise<StoryWorkbenchPhase[]> {
        const phases = await this.prisma.storyPhase.findMany({
            where: {storyId},
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
            include: {
                threads: {
                    where: {storyId},
                    orderBy: [
                        {sortOrder: "asc"},
                        {id: "asc"},
                    ],
                    include: {
                        scenes: {
                            orderBy: [
                                {threadSortOrder: "asc"},
                                {id: "asc"},
                            ],
                            include: {
                                ...STORY_SCENE_CHAPTER_INCLUDE,
                                refs: {
                                    orderBy: [
                                        {sortOrder: "asc"},
                                        {id: "asc"},
                                    ],
                                    include: STORY_SCENE_REF_INCLUDE,
                                },
                            },
                        },
                    },
                },
            },
        }) as Array<StoryPhase & {threads: Array<StoryThreadWithJsonTags & StoryWorkbenchThread>}>;
        return phases.map((phase) => ({
            ...phase,
            threads: phase.threads.map((thread) => normalizeThreadWithScenes(thread) as StoryWorkbenchThread),
        }));
    }
}

function normalizeThread<T extends StoryThreadWithJsonTags | null>(thread: T): T extends null ? null : StoryThreadEntity {
    if (!thread) {
        return null as T extends null ? null : StoryThreadEntity;
    }
    return ({
        ...thread,
        tags: normalizeTags(thread.tags),
    } as unknown) as T extends null ? null : StoryThreadEntity;
}

function normalizeThreadWithScenes<T extends StoryThreadWithJsonTags & {scenes: StorySceneWithChapter[]}>(thread: T): Omit<T, "tags"> & {tags: string[]} {
    return {
        ...thread,
        tags: normalizeTags(thread.tags),
    };
}

function normalizeTags(value: string): string[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return [];
    }
    return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
}

function toThreadData<T extends StoryThreadData>(data: T): Omit<T, "tags"> & {tags?: string} {
    if (!("tags" in data)) {
        return data as Omit<T, "tags"> & {tags?: string};
    }
    return {
        ...data,
        tags: normalizeInputTags(data.tags),
    };
}

function normalizeInputTags(value: string[] | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    return JSON.stringify(value.map((tag) => tag.trim()).filter(Boolean));
}
