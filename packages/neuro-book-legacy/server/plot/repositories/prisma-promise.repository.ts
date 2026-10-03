import type {Prisma, StoryPromise, StoryPromiseBeat} from "nbook/server/generated/project-prisma/client";
import type {PromiseRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {
    PrismaExecutor,
    StoryPromiseBeatWithPromise,
    StoryPromiseBeatWithScene,
    StoryPromiseEntity,
    StoryPromiseWithBeats,
} from "nbook/server/plot/core/types";
import {STORY_SCENE_CHAPTER_INCLUDE} from "nbook/server/plot/repositories/includes";

/** 数据库原始行:tags 仍是 JSON 文本。 */
type StoryPromiseWithJsonTags = Omit<StoryPromise, "tags"> & {
    tags: string;
};

/** Promise 详情聚合 include:beats 带所在 Scene(含章摘要)+ 期限章轻量摘要。 */
const STORY_PROMISE_DETAIL_INCLUDE = {
    beats: {
        orderBy: [
            {sceneId: "asc" as const},
            {id: "asc" as const},
        ],
        include: {
            scene: {
                include: STORY_SCENE_CHAPTER_INCLUDE,
            },
        },
    },
    deadlineChapter: {
        select: {
            id: true,
            name: true,
            title: true,
        },
    },
} satisfies Prisma.StoryPromiseInclude;

/**
 * Prisma 版 Promise 仓储。
 */
export class PrismaPromiseRepository implements PromiseRepository {
    constructor(private readonly prisma: PrismaExecutor) {}

    /**
     * 查询 Promise 实体。
     */
    async findPromiseById(promiseId: number): Promise<StoryPromiseEntity | null> {
        const promise = await this.prisma.storyPromise.findUnique({
            where: {id: promiseId},
        }) as StoryPromiseWithJsonTags | null;
        return promise ? normalizePromiseTags(promise) : null;
    }

    /**
     * 查询带 beats(含所在 Scene/章位)的 Promise 详情。
     */
    async findPromiseWithBeatsById(promiseId: number): Promise<StoryPromiseWithBeats | null> {
        const promise = await this.prisma.storyPromise.findUnique({
            where: {id: promiseId},
            include: STORY_PROMISE_DETAIL_INCLUDE,
        }) as (StoryPromiseWithJsonTags & Pick<StoryPromiseWithBeats, "beats" | "deadlineChapter">) | null;
        return promise ? normalizePromiseTags(promise) : null;
    }

    /**
     * 列出 Story 下全部 Promise(带 beats,供列表派生态与计数)。
     * 排序:open 优先,importance 高在前,再按 id 稳定。
     */
    async findPromisesByStory(storyId: number): Promise<StoryPromiseWithBeats[]> {
        const promises = await this.prisma.storyPromise.findMany({
            where: {storyId},
            orderBy: [
                {id: "asc"},
            ],
            include: STORY_PROMISE_DETAIL_INCLUDE,
        }) as Array<StoryPromiseWithJsonTags & Pick<StoryPromiseWithBeats, "beats" | "deadlineChapter">>;
        return promises.map(normalizePromiseTags);
    }

    /**
     * 按 name 查询 Promise(唯一性校验用)。
     */
    async findPromiseByName(storyId: number, name: string, excludePromiseId?: number): Promise<StoryPromiseEntity | null> {
        const promise = await this.prisma.storyPromise.findFirst({
            where: {
                storyId,
                name,
                ...(excludePromiseId ? {
                    NOT: {id: excludePromiseId},
                } : {}),
            },
        }) as StoryPromiseWithJsonTags | null;
        return promise ? normalizePromiseTags(promise) : null;
    }

    /**
     * 统计 status=open 的 Promise 数(get_story_tree 的 openPromiseCount)。
     */
    async countOpenPromisesByStory(storyId: number): Promise<number> {
        return this.prisma.storyPromise.count({
            where: {
                storyId,
                status: "open",
            },
        });
    }

    /**
     * 创建 Promise。
     */
    async createPromise(input: {
        storyId: number;
        name: string;
        title: string;
        importance: StoryPromise["importance"];
        summary: string;
        payoffExpectation: string | null;
        cadenceChapters: number | null;
        deadlineChapterId: number | null;
        tags: string[];
    }): Promise<StoryPromiseEntity> {
        const promise = await this.prisma.storyPromise.create({
            data: {
                ...input,
                tags: serializeTags(input.tags),
            },
        }) as StoryPromiseWithJsonTags;
        return normalizePromiseTags(promise);
    }

    /**
     * 更新 Promise。
     */
    async updatePromise(promiseId: number, data: Partial<Pick<
        StoryPromise,
        "name" | "title" | "status" | "importance" | "summary" | "payoffExpectation" | "cadenceChapters" | "deadlineChapterId"
    >> & {tags?: string[]}): Promise<StoryPromiseEntity> {
        const {tags, ...rest} = data;
        const promise = await this.prisma.storyPromise.update({
            where: {id: promiseId},
            data: {
                ...rest,
                ...(tags === undefined ? {} : {tags: serializeTags(tags)}),
            },
        }) as StoryPromiseWithJsonTags;
        return normalizePromiseTags(promise);
    }

    /**
     * 删除 Promise(beats 级联删除)。
     */
    async deletePromise(promiseId: number): Promise<void> {
        await this.prisma.storyPromise.delete({
            where: {id: promiseId},
        });
    }

    /**
     * upsert beat:同场同线仅一条(promiseId×sceneId 唯一),存在则覆盖 kind/note。
     */
    async upsertBeat(input: {promiseId: number; sceneId: number; kind: StoryPromiseBeat["kind"]; note: string | null}): Promise<StoryPromiseBeat> {
        return this.prisma.storyPromiseBeat.upsert({
            where: {
                promiseId_sceneId: {
                    promiseId: input.promiseId,
                    sceneId: input.sceneId,
                },
            },
            create: input,
            update: {
                kind: input.kind,
                note: input.note,
            },
        });
    }

    /**
     * 查询单个 beat。
     */
    async findBeat(promiseId: number, sceneId: number): Promise<StoryPromiseBeat | null> {
        return this.prisma.storyPromiseBeat.findUnique({
            where: {
                promiseId_sceneId: {promiseId, sceneId},
            },
        });
    }

    /**
     * 删除单个 beat。
     */
    async deleteBeat(promiseId: number, sceneId: number): Promise<void> {
        await this.prisma.storyPromiseBeat.delete({
            where: {
                promiseId_sceneId: {promiseId, sceneId},
            },
        });
    }

    /**
     * 查询 Scene 上全部 beats(带所属 Promise 摘要)。
     */
    async findBeatsByScene(sceneId: number): Promise<StoryPromiseBeatWithPromise[]> {
        return this.prisma.storyPromiseBeat.findMany({
            where: {sceneId},
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
        });
    }

    /**
     * 查询 Promise 的全部 beats(带所在 Scene)。
     */
    async findBeatsByPromise(promiseId: number): Promise<StoryPromiseBeatWithScene[]> {
        return this.prisma.storyPromiseBeat.findMany({
            where: {promiseId},
            orderBy: [
                {sceneId: "asc"},
                {id: "asc"},
            ],
            include: {
                scene: {
                    include: STORY_SCENE_CHAPTER_INCLUDE,
                },
            },
        });
    }
}

/**
 * 把数据库 JSON tags 归一化为 string[]。
 */
function normalizePromiseTags<T extends StoryPromiseWithJsonTags>(promise: T): Omit<T, "tags"> & {tags: string[]} {
    let parsed: unknown;
    try {
        parsed = JSON.parse(promise.tags);
    } catch {
        parsed = [];
    }
    return {
        ...promise,
        tags: Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === "string")
            : [],
    };
}

/**
 * 序列化写入 tags:trim + 去空。
 */
function serializeTags(tags: string[]): string {
    return JSON.stringify(tags.map((tag) => tag.trim()).filter(Boolean));
}
