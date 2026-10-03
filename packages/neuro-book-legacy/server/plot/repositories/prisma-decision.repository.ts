import type {StoryDecision} from "nbook/server/generated/project-prisma/client";
import type {DecisionRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {
    PrismaExecutor,
    ResolvedStoryDecisionAnchor,
    StoryDecisionEntity,
    StoryDecisionOption,
    StoryDecisionRejectedAlternative,
} from "nbook/server/plot/core/types";

/** 数据库原始行:四个结构化字段仍是 JSON 文本。 */
type StoryDecisionWithJsonColumns = Omit<StoryDecision, "options" | "rejectedAlternatives" | "serves" | "dependsOn"> & {
    options: string;
    rejectedAlternatives: string;
    serves: string;
    dependsOn: string;
};

/**
 * Prisma 版 Decision 仓储。
 * options/rejectedAlternatives/serves/dependsOn 在读写边界完成 JSON 归一化,service 只见结构化数组。
 */
export class PrismaDecisionRepository implements DecisionRepository {
    constructor(private readonly prisma: PrismaExecutor) {}

    /**
     * 查询 Decision 实体。
     */
    async findDecisionById(decisionId: number): Promise<StoryDecisionEntity | null> {
        const decision = await this.prisma.storyDecision.findUnique({
            where: {id: decisionId},
        }) as StoryDecisionWithJsonColumns | null;
        return decision ? normalizeDecisionJsonColumns(decision) : null;
    }

    /**
     * 列出 Story 下全部 Decision(排序在 service 做:open 优先)。
     */
    async findDecisionsByStory(storyId: number): Promise<StoryDecisionEntity[]> {
        const decisions = await this.prisma.storyDecision.findMany({
            where: {storyId},
            orderBy: [
                {id: "asc"},
            ],
        }) as StoryDecisionWithJsonColumns[];
        return decisions.map(normalizeDecisionJsonColumns);
    }

    /**
     * 按 name 查询 Decision(唯一性校验用)。
     */
    async findDecisionByName(storyId: number, name: string, excludeDecisionId?: number): Promise<StoryDecisionEntity | null> {
        const decision = await this.prisma.storyDecision.findFirst({
            where: {
                storyId,
                name,
                ...(excludeDecisionId ? {
                    NOT: {id: excludeDecisionId},
                } : {}),
            },
        }) as StoryDecisionWithJsonColumns | null;
        return decision ? normalizeDecisionJsonColumns(decision) : null;
    }

    /**
     * 统计 status=open 的 Decision 数(get_story_tree 的 openDecisionCount)。
     */
    async countOpenDecisionsByStory(storyId: number): Promise<number> {
        return this.prisma.storyDecision.count({
            where: {
                storyId,
                status: "open",
            },
        });
    }

    /**
     * 创建 Decision(恒 open 态,decided 走服务层 decide 转换)。
     */
    async createDecision(input: {
        storyId: number;
        name: string;
        title: string;
        question: string;
        options: StoryDecisionOption[];
        deadlineChapterId: number | null;
        serves: string[];
        dependsOn: string[];
        note: string | null;
    } & ResolvedStoryDecisionAnchor): Promise<StoryDecisionEntity> {
        const decision = await this.prisma.storyDecision.create({
            data: {
                ...input,
                options: JSON.stringify(input.options),
                serves: JSON.stringify(input.serves),
                dependsOn: JSON.stringify(input.dependsOn),
            },
        }) as StoryDecisionWithJsonColumns;
        return normalizeDecisionJsonColumns(decision);
    }

    /**
     * 更新 Decision。结构化数组字段整体替换,undefined 保持不变。
     */
    async updateDecision(decisionId: number, data: Partial<Pick<
        StoryDecision,
        "name" | "title" | "status" | "question" | "deadlineChapterId" | "decision" | "motivation" | "risk" | "supersededById"
        | "anchorKind" | "anchorActId" | "anchorChapterId" | "anchorThreadId" | "anchorSceneId" | "anchorPromiseId" | "anchorPath" | "note"
    >> & {
        options?: StoryDecisionOption[];
        rejectedAlternatives?: StoryDecisionRejectedAlternative[];
        serves?: string[];
        dependsOn?: string[];
    }): Promise<StoryDecisionEntity> {
        const {options, rejectedAlternatives, serves, dependsOn, ...rest} = data;
        const decision = await this.prisma.storyDecision.update({
            where: {id: decisionId},
            data: {
                ...rest,
                ...(options === undefined ? {} : {options: JSON.stringify(options)}),
                ...(rejectedAlternatives === undefined ? {} : {rejectedAlternatives: JSON.stringify(rejectedAlternatives)}),
                ...(serves === undefined ? {} : {serves: JSON.stringify(serves)}),
                ...(dependsOn === undefined ? {} : {dependsOn: JSON.stringify(dependsOn)}),
            },
        }) as StoryDecisionWithJsonColumns;
        return normalizeDecisionJsonColumns(decision);
    }

    /**
     * 物理删除 Decision。不开放给 Agent,留给 UI/人(Task 97 D4;Agent 软删出口是 action=drop)。
     */
    async deleteDecision(decisionId: number): Promise<void> {
        await this.prisma.storyDecision.delete({
            where: {id: decisionId},
        });
    }

    /**
     * 批量核对引用目标存在性(同 story)。
     * 写入校验(serves/dependsOn 的 id 必须真实存在)与读取死引用标注(D12)共用。
     */
    async findExistingRefIds(storyId: number, ids: {
        promiseIds: number[];
        decisionIds: number[];
        threadIds: number[];
        sceneIds: number[];
    }): Promise<{
        promiseIds: Set<number>;
        decisionIds: Set<number>;
        threadIds: Set<number>;
        sceneIds: Set<number>;
    }> {
        const [promises, decisions, threads, scenes] = await Promise.all([
            ids.promiseIds.length === 0 ? [] : this.prisma.storyPromise.findMany({
                where: {storyId, id: {in: ids.promiseIds}},
                select: {id: true},
            }),
            ids.decisionIds.length === 0 ? [] : this.prisma.storyDecision.findMany({
                where: {storyId, id: {in: ids.decisionIds}},
                select: {id: true},
            }),
            ids.threadIds.length === 0 ? [] : this.prisma.storyThread.findMany({
                where: {storyId, id: {in: ids.threadIds}},
                select: {id: true},
            }),
            ids.sceneIds.length === 0 ? [] : this.prisma.storyScene.findMany({
                where: {storyId, id: {in: ids.sceneIds}},
                select: {id: true},
            }),
        ]);
        return {
            promiseIds: new Set(promises.map((item: {id: number}) => item.id)),
            decisionIds: new Set(decisions.map((item: {id: number}) => item.id)),
            threadIds: new Set(threads.map((item: {id: number}) => item.id)),
            sceneIds: new Set(scenes.map((item: {id: number}) => item.id)),
        };
    }
}

/**
 * 把数据库 JSON 列归一化为结构化数组(解析失败与非法条目静默过滤,读取容错)。
 */
function normalizeDecisionJsonColumns(decision: StoryDecisionWithJsonColumns): StoryDecisionEntity {
    return {
        ...decision,
        options: parseObjectEntries(decision.options, "option", "note"),
        rejectedAlternatives: parseObjectEntries(decision.rejectedAlternatives, "option", "whyRejected"),
        serves: parseStringArray(decision.serves),
        dependsOn: parseStringArray(decision.dependsOn),
    };
}

/**
 * 解析 [{<textKey>, <noteKey>?}] 形态的 JSON 列。
 */
function parseObjectEntries<TTextKey extends string, TNoteKey extends string>(
    raw: string,
    textKey: TTextKey,
    noteKey: TNoteKey,
): Array<{[K in TTextKey]: string} & {[K in TNoteKey]: string | null}> {
    let parsed: unknown; // JSON.parse 的返回值形状未知,下面逐条收窄。
    try {
        parsed = JSON.parse(raw);
    } catch {
        parsed = [];
    }
    if (!Array.isArray(parsed)) {
        return [];
    }
    const entries: Array<{[K in TTextKey]: string} & {[K in TNoteKey]: string | null}> = [];
    for (const item of parsed) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
        }
        const record = item as Record<string, unknown>; // JSON 对象条目按键收窄,仅本函数内部使用。
        const text = record[textKey];
        if (typeof text !== "string" || !text.trim()) {
            continue;
        }
        const note = record[noteKey];
        entries.push({
            [textKey]: text,
            [noteKey]: typeof note === "string" ? note : null,
        } as {[K in TTextKey]: string} & {[K in TNoteKey]: string | null});
    }
    return entries;
}

/**
 * 解析字符串数组形态的 JSON 列(serves/dependsOn)。
 */
function parseStringArray(raw: string): string[] {
    let parsed: unknown; // JSON.parse 的返回值形状未知,下面逐条收窄。
    try {
        parsed = JSON.parse(raw);
    } catch {
        parsed = [];
    }
    return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
}
