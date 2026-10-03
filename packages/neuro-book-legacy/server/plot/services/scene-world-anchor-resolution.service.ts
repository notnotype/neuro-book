import type {WorldEngineFacade} from "nbook/server/world-engine/world-engine.facade";
import type {WorldSubjectListItem} from "nbook/server/world-engine/types";
import type {StorySceneWorldAnchorDto} from "nbook/shared/dto/plot.dto";

type WorldSubjectMap = Map<string, WorldSubjectListItem>;

/**
 * 解析 Scene World Anchor 的只读展示状态。
 *
 * Plot 聚合读取只需要 subject 身份与可选的人类可读时间；缺少 calendar.ts 时，
 * subject 解析仍应可用，raw instant 保留，formatted time 降级为 null。
 */
export class SceneWorldAnchorResolutionService {
    constructor(private readonly worldEngineFacade: WorldEngineFacade) {}

    /**
     * 解析单个 Scene World Anchor。
     */
    async resolve(anchor: StorySceneWorldAnchorDto): Promise<StorySceneWorldAnchorDto> {
        return (await this.resolveMany([anchor]))[0] ?? anchor;
    }

    /**
     * 批量解析 Scene World Anchor，并共享一次 subject identity 读取。
     */
    async resolveMany(anchors: StorySceneWorldAnchorDto[]): Promise<StorySceneWorldAnchorDto[]> {
        const subjectIds = uniqueSubjectIds(anchors.flatMap((anchor) => [
            ...anchor.subjectIds,
            ...(anchor.locationSubjectId === null ? [] : [anchor.locationSubjectId]),
        ]));
        const subjects = subjectIds.length === 0
            ? []
            : await this.worldEngineFacade.listSubjectIdentities({ids: subjectIds});
        const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
        return Promise.all(anchors.map((anchor) => this.resolveWithSubjectMap(anchor, subjectMap)));
    }

    /**
     * 使用已加载的 subject 身份表解析单个 anchor。
     */
    private async resolveWithSubjectMap(
        anchor: StorySceneWorldAnchorDto,
        subjectMap: WorldSubjectMap,
    ): Promise<StorySceneWorldAnchorDto> {
        const subjects = anchor.subjectIds.map((subjectId) => resolveAnchorSubject(subjectId, subjectMap));
        const locationSubject = anchor.locationSubjectId === null ? null : resolveAnchorSubject(anchor.locationSubjectId, subjectMap);
        const [startTime, endTime] = await Promise.all([
            this.formatAnchorTime(anchor.startInstant),
            this.formatAnchorTime(anchor.endInstant),
        ]);

        return {
            ...anchor,
            startTime,
            endTime,
            subjects,
            locationSubject,
            unresolvedSubjectIds: uniqueSubjectIds([
                ...subjects.filter((subject) => !subject.resolved).map((subject) => subject.id),
                ...(locationSubject && !locationSubject.resolved ? [locationSubject.id] : []),
            ]),
        };
    }

    /**
     * 格式化 raw instant；缺少 calendar.ts 时只降级当前展示字段。
     */
    private async formatAnchorTime(instant: string | null): Promise<string | null> {
        if (instant === null) {
            return null;
        }
        try {
            return await this.worldEngineFacade.formatTime(BigInt(instant));
        } catch (error: unknown) {
            if (isMissingCalendarError(error)) {
                return null;
            }
            throw error;
        }
    }
}

/**
 * 将 Scene World Anchor 的 subject id 解析为展示对象；不存在时保留占位。
 */
function resolveAnchorSubject(subjectId: string, subjectMap: WorldSubjectMap): StorySceneWorldAnchorDto["subjects"][number] {
    const subject = subjectMap.get(subjectId);
    if (!subject) {
        return {
            id: subjectId,
            name: subjectId,
            type: "unknown",
            resolved: false,
        };
    }
    return {
        id: subject.id,
        name: subject.name || subject.id,
        type: subject.type,
        resolved: true,
    };
}

/**
 * 判断错误是否来自缺少 calendar.ts；损坏 calendar.ts 必须继续抛出。
 */
function isMissingCalendarError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
        return false;
    }
    const statusCode = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    const statusMessage = "statusMessage" in error && typeof error.statusMessage === "string" ? error.statusMessage : "";
    const text = `${message}\n${statusMessage}`;
    return statusCode === 400 && text.includes("Project 缺少 world-engine/calendar.ts");
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
