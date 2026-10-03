import type {Story, StoryPhase} from "nbook/server/generated/project-prisma/client";
import type {StoryRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {PrismaExecutor} from "nbook/server/plot/core/types";

/**
 * Prisma 版 Story 仓储。
 */
export class PrismaStoryRepository implements StoryRepository {
    constructor(private readonly prisma: PrismaExecutor) {}

    /**
     * 查询当前 Project SQLite 中的 Story。
     */
    async findStory(): Promise<Story | null> {
        return this.prisma.story.findFirst({
            orderBy: {id: "asc"},
        });
    }

    /**
     * 创建当前 Project SQLite 的 Story。
     */
    async createStory(input: {title: string; summary: string}): Promise<Story> {
        return this.prisma.story.create({
            data: {
                title: input.title,
                summary: input.summary,
            },
        });
    }

    /**
     * 更新 Story 基本信息。
     */
    async updateStory(storyId: number, data: Partial<Pick<Story, "title" | "summary" | "note">>): Promise<Story> {
        return this.prisma.story.update({
            where: {id: storyId},
            data,
        });
    }

    /**
     * 查询剧情阶段。
     */
    async findPhaseById(phaseId: number): Promise<StoryPhase | null> {
        return this.prisma.storyPhase.findUnique({
            where: {id: phaseId},
        });
    }

    /**
     * 列出 Story 下的全部阶段。
     */
    async findPhasesByStory(storyId: number): Promise<StoryPhase[]> {
        return this.prisma.storyPhase.findMany({
            where: {storyId},
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
        });
    }

    /**
     * 返回 Story 下的阶段 ID 集合。
     */
    async findPhaseIdsByStory(storyId: number): Promise<number[]> {
        const phases = await this.prisma.storyPhase.findMany({
            where: {storyId},
            select: {id: true},
        });
        return phases.map((phase) => phase.id);
    }

    /**
     * 创建剧情阶段。
     */
    async createPhase(input: {
        storyId: number;
        sortOrder: number;
        name: string;
        title: string;
        summary: string;
        note: string | null;
    }): Promise<StoryPhase> {
        return this.prisma.storyPhase.create({
            data: input,
        });
    }

    /**
     * 更新剧情阶段。
     */
    async updatePhase(
        phaseId: number,
        data: Partial<Pick<StoryPhase, "name" | "title" | "summary" | "note" | "sortOrder">>,
    ): Promise<StoryPhase> {
        return this.prisma.storyPhase.update({
            where: {id: phaseId},
            data,
        });
    }

    /**
     * 删除剧情阶段。
     */
    async deletePhase(phaseId: number): Promise<void> {
        await this.prisma.storyPhase.delete({
            where: {id: phaseId},
        });
    }

    /**
     * 按 name 查询阶段，用于唯一性校验。
     */
    async findPhaseByName(storyId: number, name: string, excludePhaseId?: number): Promise<StoryPhase | null> {
        return this.prisma.storyPhase.findFirst({
            where: {
                storyId,
                name,
                ...(excludePhaseId ? {
                    NOT: {id: excludePhaseId},
                } : {}),
            },
        });
    }
}
