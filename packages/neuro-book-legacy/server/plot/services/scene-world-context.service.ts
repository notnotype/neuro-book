import type {SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {StoryScene} from "nbook/server/generated/project-prisma/client";
import {throwPlotBadRequest, throwPlotNotFound} from "nbook/server/plot/core/errors";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {StoryService} from "nbook/server/plot/services/story.service";
import type {SceneWorldContextDto} from "nbook/shared/dto/plot.dto";
import type {WorldEngineFacade} from "nbook/server/world-engine/world-engine.facade";

/**
 * Scene 到 World Engine 上下文的只读桥接服务。
 */
export class SceneWorldContextService {
    constructor(
        private readonly sceneRepository: SceneRepository,
        private readonly storyService: StoryService,
        private readonly scopeGuard: PlotScopeGuard,
        private readonly worldEngineFacade: WorldEngineFacade,
    ) {}

    /**
     * 查询指定 Scene 相关的 World Engine 切面与 subject 终态。
     */
    async getSceneWorldContext(sceneId: number): Promise<SceneWorldContextDto> {
        const story = await this.storyService.ensureStory();
        await this.scopeGuard.assertScene(story.id, sceneId);
        const scene = await this.sceneRepository.findSceneById(sceneId);
        if (!scene) {
            throwPlotNotFound("剧情场景不存在");
        }
        return this.getSceneWorldContextForScene(scene);
    }

    /**
     * 使用已加载的 Scene 实体查询 World Engine 上下文。
     */
    async getSceneWorldContextForScene(scene: Pick<
        StoryScene,
        "startInstant" | "endInstant" | "subjectIdsJson" | "locationSubjectId"
    >): Promise<SceneWorldContextDto> {
        if (scene.startInstant === null || scene.endInstant === null) {
            throwPlotBadRequest("Scene 尚未设置完整 World Engine 时间范围");
        }

        const subjectIds = uniqueSubjectIds([
            ...parseSubjectIdsJson(scene.subjectIdsJson),
            ...(scene.locationSubjectId ? [scene.locationSubjectId] : []),
        ]);
        if (subjectIds.length === 0) {
            return {slices: [], subjectStates: [], unresolvedSubjectIds: []};
        }

        const subjects = await this.worldEngineFacade.listSubjectIdentities({ids: subjectIds});
        const subjectNameMap = new Map(subjects.map((subject) => [subject.id, subject.name || subject.id]));
        const resolvedSubjectIds = subjectIds.filter((subjectId) => subjectNameMap.has(subjectId));
        const unresolvedSubjectIds = subjectIds.filter((subjectId) => !subjectNameMap.has(subjectId));
        if (resolvedSubjectIds.length === 0) {
            return {slices: [], subjectStates: [], unresolvedSubjectIds};
        }

        const subjectIdSet = new Set(resolvedSubjectIds);
        const [slices, state] = await Promise.all([
            this.worldEngineFacade.listSlices({
                from: scene.startInstant,
                to: scene.endInstant,
                withPatches: true,
                subjectIds: resolvedSubjectIds,
                subjectMode: "any",
            }),
            this.worldEngineFacade.queryState({
                subjectIds: resolvedSubjectIds,
                at: scene.endInstant,
            }),
        ]);

        const contextSlices = await Promise.all(slices.map(async (slice) => ({
            id: slice.id,
            time: await this.worldEngineFacade.formatTime(slice.instant),
            title: slice.title,
            summary: slice.summary,
            kind: slice.kind,
            patchCount: (slice.patches ?? []).filter((patch) => subjectIdSet.has(patch.subjectId)).length,
        })));

        return {
            slices: contextSlices.filter((slice) => slice.patchCount > 0),
            subjectStates: state.subjects.map((subject) => ({
                subjectId: subject.subjectId,
                type: subject.type,
                name: subjectNameMap.get(subject.subjectId) ?? subject.subjectId,
                attrs: subject.attrs,
            })),
            unresolvedSubjectIds,
        };
    }
}

/**
 * 解析 StoryScene.subjectIdsJson。
 */
function parseSubjectIdsJson(value: string): string[] {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((item): item is string => typeof item === "string");
    } catch {
        return [];
    }
}

/**
 * 去重并清理 subject id。
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
