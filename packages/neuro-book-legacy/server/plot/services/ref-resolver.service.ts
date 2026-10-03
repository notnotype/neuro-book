import {
    throwPlotBadRequest,
} from "nbook/server/plot/core/errors";
import type {ThreadRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {ResolvedStoryRefInput} from "nbook/server/plot/core/types";
import type {StoryRefDto} from "nbook/shared/dto/plot.dto";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {
    buildReferenceUri,
    parseStructuredReferenceTarget,
} from "nbook/shared/reference-core";

/**
 * 剧情引用解析服务。
 */
export class RefResolverService {
    constructor(
        private readonly threadRepository: ThreadRepository,
        private readonly scopeGuard: PlotScopeGuard,
    ) {}

    /**
     * 解析 refs。
     */
    async resolveRefs(storyId: number, refs: StoryRefDto[]): Promise<ResolvedStoryRefInput[]> {
        this.assertDistinctRefs(refs);

        const resolvedRefs: ResolvedStoryRefInput[] = [];
        for (const [index, ref] of refs.entries()) {
            const normalizedTarget = ref.target.trim();
            const parsedTarget = parseStructuredReferenceTarget(normalizedTarget);
            if (!parsedTarget) {
                throwPlotBadRequest(`不支持的引用目标：${normalizedTarget}`);
            }

            if (parsedTarget.kind === "content") {
                resolvedRefs.push({
                    sortOrder: index,
                    relation: ref.relation,
                    rawTarget: parsedTarget.canonicalTarget,
                    targetKind: "content",
                    targetThreadId: null,
                    targetSceneId: null,
                    visibility: ref.visibility,
                    note: ref.note,
                });
                continue;
            }

            if (parsedTarget.kind === "thread") {
                const thread = /^\d+$/.test(parsedTarget.targetId)
                    ? await this.scopeGuard.assertThread(storyId, Number.parseInt(parsedTarget.targetId, 10))
                    : await this.threadRepository.findThreadTargetByName(storyId, parsedTarget.targetId);
                if (!thread) {
                    throwPlotBadRequest(`引用目标不存在：${normalizedTarget}`);
                }

                resolvedRefs.push({
                    sortOrder: index,
                    relation: ref.relation,
                    rawTarget: buildReferenceUri("thread", String(thread.id)),
                    targetKind: "thread",
                    targetThreadId: thread.id,
                    targetSceneId: null,
                    visibility: ref.visibility,
                    note: ref.note,
                });
                continue;
            }

            if (parsedTarget.kind === "scene" && /^\d+$/.test(parsedTarget.targetId)) {
                const scene = await this.scopeGuard.assertScene(storyId, Number.parseInt(parsedTarget.targetId, 10));
                resolvedRefs.push({
                    sortOrder: index,
                    relation: ref.relation,
                    rawTarget: buildReferenceUri("scene", String(scene.id)),
                    targetKind: "scene",
                    targetThreadId: null,
                    targetSceneId: scene.id,
                    visibility: ref.visibility,
                    note: ref.note,
                });
                continue;
            }

            throwPlotBadRequest(`不支持的引用目标：${normalizedTarget}`);
        }

        return resolvedRefs;
    }

    /**
     * 校验 refs 不重复。
     */
    private assertDistinctRefs(refs: StoryRefDto[]): void {
        const duplicateKeySet = new Set<string>();

        for (const ref of refs) {
            const duplicateKey = `${ref.relation}\u0000${ref.target}`;
            if (duplicateKeySet.has(duplicateKey)) {
                throwPlotBadRequest("refs 中存在重复关系");
            }
            duplicateKeySet.add(duplicateKey);
        }
    }
}
