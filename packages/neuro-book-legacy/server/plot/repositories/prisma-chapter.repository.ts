import type {StoryAct, StoryChapter} from "nbook/server/generated/project-prisma/client";
import type {ChapterRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {ChapterBriefColumns, PrismaExecutor, StoryActWithChapters} from "nbook/server/plot/core/types";

/**
 * Prisma 版 Act / Chapter(承载树)仓储。
 */
export class PrismaChapterRepository implements ChapterRepository {
    constructor(private readonly prisma: PrismaExecutor) {}

    /**
     * 查询卷。
     */
    async findActById(actId: number): Promise<StoryAct | null> {
        return this.prisma.storyAct.findUnique({
            where: {id: actId},
        });
    }

    /**
     * 查询 Story 下全部卷,按 sortOrder 排列。
     */
    async findActsByStory(storyId: number): Promise<StoryAct[]> {
        return this.prisma.storyAct.findMany({
            where: {storyId},
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
        });
    }

    /**
     * 按 name 查询卷,用于唯一性校验。
     */
    async findActByName(storyId: number, name: string, excludeActId?: number): Promise<StoryAct | null> {
        return this.prisma.storyAct.findFirst({
            where: {
                storyId,
                name,
                ...(excludeActId === undefined ? {} : {id: {not: excludeActId}}),
            },
        });
    }

    /**
     * 查询承载树:卷及旗下章节,均按 sortOrder 排列。
     */
    async findActsWithChapters(storyId: number): Promise<StoryActWithChapters[]> {
        return this.prisma.storyAct.findMany({
            where: {storyId},
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
            include: {
                chapters: {
                    orderBy: [
                        {sortOrder: "asc"},
                        {id: "asc"},
                    ],
                },
            },
        });
    }

    /**
     * 创建卷。
     */
    async createAct(input: {storyId: number; sortOrder: number; name: string; title: string; summary: string; note: string | null}): Promise<StoryAct> {
        return this.prisma.storyAct.create({
            data: input,
        });
    }

    /**
     * 更新卷。
     */
    async updateAct(actId: number, data: Partial<Pick<StoryAct, "name" | "title" | "summary" | "note" | "sortOrder">>): Promise<StoryAct> {
        return this.prisma.storyAct.update({
            where: {id: actId},
            data,
        });
    }

    /**
     * 删除卷;旗下章节按外键 SetNull 回落到未归卷区。
     */
    async deleteAct(actId: number): Promise<void> {
        await this.prisma.storyAct.delete({
            where: {id: actId},
        });
    }

    /**
     * 查询章。
     */
    async findChapterById(chapterId: number): Promise<StoryChapter | null> {
        return this.prisma.storyChapter.findUnique({
            where: {id: chapterId},
        });
    }

    /**
     * 查询 Story 下全部章,按 sortOrder 排列。
     */
    async findChaptersByStory(storyId: number): Promise<StoryChapter[]> {
        return this.prisma.storyChapter.findMany({
            where: {storyId},
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
        });
    }

    /**
     * 查询未归卷的章。
     */
    async findUngroupedChapters(storyId: number): Promise<StoryChapter[]> {
        return this.prisma.storyChapter.findMany({
            where: {storyId, actId: null},
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
        });
    }

    /**
     * 按 name 查询章,用于唯一性校验与 Prose frontmatter 反指解析。
     */
    async findChapterByName(storyId: number, name: string, excludeChapterId?: number): Promise<StoryChapter | null> {
        return this.prisma.storyChapter.findFirst({
            where: {
                storyId,
                name,
                ...(excludeChapterId === undefined ? {} : {id: {not: excludeChapterId}}),
            },
        });
    }

    /**
     * 创建章;ChapterBrief 列可在创建时一并写入。
     */
    async createChapter(input: {storyId: number; actId: number | null; sortOrder: number; name: string; title: string; note: string | null} & Partial<ChapterBriefColumns>): Promise<StoryChapter> {
        return this.prisma.storyChapter.create({
            data: input,
        });
    }

    /**
     * 更新章;ChapterBrief 列按传入键更新,undefined 键保持不变。
     */
    async updateChapter(chapterId: number, data: Partial<Pick<StoryChapter, "actId" | "sortOrder" | "name" | "title" | "note">> & Partial<ChapterBriefColumns>): Promise<StoryChapter> {
        return this.prisma.storyChapter.update({
            where: {id: chapterId},
            data,
        });
    }

    /**
     * 删除章;旗下 Scene 按外键 SetNull 脱离章节承载。
     */
    async deleteChapter(chapterId: number): Promise<void> {
        await this.prisma.storyChapter.delete({
            where: {id: chapterId},
        });
    }
}
