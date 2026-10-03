import {Prisma, PrismaClient} from "nbook/server/generated/project-prisma/client";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {PrismaChapterRepository} from "nbook/server/plot/repositories/prisma-chapter.repository";
import {PrismaDecisionRepository} from "nbook/server/plot/repositories/prisma-decision.repository";
import {PrismaPromiseRepository} from "nbook/server/plot/repositories/prisma-promise.repository";
import {PrismaSceneRepository} from "nbook/server/plot/repositories/prisma-scene.repository";
import {PrismaStoryRepository} from "nbook/server/plot/repositories/prisma-story.repository";
import {PrismaThreadRepository} from "nbook/server/plot/repositories/prisma-thread.repository";
import type {PrismaExecutor, SceneWorldAnchor} from "nbook/server/plot/core/types";
import {PlotInputParser} from "nbook/server/plot/http/plot-input.parser";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";
import {ChapterService} from "nbook/server/plot/services/chapter.service";
import {ChapterBootstrapService, writeProsePointers, type CarrierTreeBootstrapResult} from "nbook/server/plot/services/chapter-bootstrap.service";
import {ChapterProseService, type ChapterProseNode} from "nbook/server/plot/services/chapter-prose.service";
import {OrderService} from "nbook/server/plot/services/order.service";
import {ChapterWriterBriefService} from "nbook/server/plot/services/chapter-writer-brief.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {DecisionService} from "nbook/server/plot/services/decision.service";
import {PromiseService} from "nbook/server/plot/services/promise.service";
import {RefResolverService} from "nbook/server/plot/services/ref-resolver.service";
import {SceneService} from "nbook/server/plot/services/scene.service";
import {SceneWorldAnchorValidator} from "nbook/server/plot/services/scene-world-anchor.validator";
import {SceneWorldAnchorResolutionService} from "nbook/server/plot/services/scene-world-anchor-resolution.service";
import {SceneWorldContextService} from "nbook/server/plot/services/scene-world-context.service";
import {StoryService} from "nbook/server/plot/services/story.service";
import {ThreadService} from "nbook/server/plot/services/thread.service";
import {toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import type {ProjectDatabaseModuleHandle} from "nbook/server/workspace-files/project-database-module";
import {readProjectWorkspaceTreeSnapshot} from "nbook/server/workspace-files/project-workspace-index";
import type {ProjectFileIndexHandle} from "nbook/server/workspace-files/project-file-index";
import type {ProjectHistoryHandle} from "nbook/server/workspace-history/project-history";
import type {WorldEngineFacade} from "nbook/server/world-engine";
import type {ResolvedProjectWorkspace} from "nbook/server/workspace-files/project-identity";
import type {ProjectManifest} from "nbook/server/workspace-files/project-workspace";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import {
    mergeContentDiagnostics,
    processTextFieldsWithResults,
    processStructuredReferences,
    toResponseContentDiagnostics,
} from "nbook/server/content/content-middleware";
import {STORY_STRUCTURED_REFERENCE_KINDS} from "nbook/shared/reference-core";
import type {
    ChapterPlotDetailDto,
    ChapterWriterBriefDto,
    ChapterWriterBriefMode,
    PlotWorkbenchDto,
    CreateStoryActRequestDto,
    CreateStoryChapterRequestDto,
    CreateStoryDecisionRequestDto,
    CreateStoryPhaseRequestDto,
    CreateStoryPromiseRequestDto,
    CreateStorySceneRequestDto,
    CreateStoryThreadRequestDto,
    PlotTreeDto,
    ReorderStoryPhasesRequestDto,
    ReorderStoryScenesRequestDto,
    ReorderStoryThreadsRequestDto,
    SceneWorldContextDto,
    SetPromiseBeatRequestDto,
    StoryActDto,
    StoryChapterDto,
    StoryDecisionDto,
    StoryDto,
    StoryPhaseDto,
    StoryPromiseDetailDto,
    StoryPromiseDto,
    StorySceneDetailDto,
    StorySceneWriteResponseDto,
    StoryThreadDetailDto,
    StoryThreadWriteResponseDto,
    UpdateStoryActRequestDto,
    UpdateStoryChapterRequestDto,
    UpdateStoryDecisionRequestDto,
    UpdateStoryPhaseRequestDto,
    UpdateStoryPromiseRequestDto,
    UpdateStoryRequestDto,
    UpdateStorySceneRequestDto,
    UpdateStoryThreadRequestDto,
    StorySceneWorldAnchorInputDto,
    StorySceneWorldAnchorDto,
} from "nbook/shared/dto/plot.dto";

type PlotModule = {
    inputParser: PlotInputParser;
    storyService: StoryService;
    threadService: ThreadService;
    sceneService: SceneService;
    chapterService: ChapterService;
    chapterBootstrapService: ChapterBootstrapService;
    sceneWorldContextService: SceneWorldContextService;
    chapterWriterBriefService: ChapterWriterBriefService;
    refResolverService: RefResolverService;
    promiseService: PromiseService;
    decisionService: DecisionService;
};

type PlotClientEntry = {
    client: PrismaClient;
    adapter: TrackedPrismaLibSql;
};

type ProjectWorkspaceFileTarget = Extract<WorkspaceFileTarget, {kind: "project-workspace"}>;

/**
 * 剧情模块门面。
 */
export class PlotFacade {
    private readonly clients = new Map<string, PlotClientEntry>();
    private readonly fileTarget: ProjectWorkspaceFileTarget;
    private readonly sceneWorldAnchorResolutionService: SceneWorldAnchorResolutionService;
    // Prose 反指解析不依赖 Project SQLite,直接复用 workspace 内存索引,做 facade 级单例。
    private readonly chapterProseService: ChapterProseService;
    private accepting = true;
    private closed = false;
    private closing: Promise<void> | null = null;

    constructor(
        private readonly workspace: ResolvedProjectWorkspace,
        private readonly project: ProjectManifest,
        private readonly database: ProjectDatabaseModuleHandle,
        private readonly fileIndex: ProjectFileIndexHandle,
        private readonly history: ProjectHistoryHandle,
        private readonly worldEngine: WorldEngineFacade,
    ) {
        this.fileTarget = {
            kind: "project-workspace",
            root: workspace.root,
            projectRoot: workspace.ref.projectRoot,
        };
        this.sceneWorldAnchorResolutionService = new SceneWorldAnchorResolutionService(worldEngine);
        this.chapterProseService = new ChapterProseService(this.fileTarget, this.fileIndex);
    }

    /**
     * 解析指定章的 Prose 文件(frontmatter `chapter: <name>` 反指)。
     */
    async findProseForChapter(chapterName: string): Promise<ChapterProseNode[]> {
        this.assertAccepting();
        return this.chapterProseService.findProseForChapter(chapterName);
    }

    /**
     * 按已注册 Chapter name 分拣孤儿 Prose 指针。
     */
    async findOrphanProsePointers(): Promise<ChapterProseNode[]> {
        const module = await this.createModule();
        const story = await module.storyService.ensureStory();
        const chapters = await module.chapterService.listChapterNames(story.id);
        return this.chapterProseService.findOrphanPointers(new Set(chapters));
    }

    /**
     * 承载树 Bootstrap:把现有 manuscript 目录导入 Act/Chapter,并回写 Prose frontmatter 反指。
     * 一次性迁移工具,幂等可重跑。
     *
     * 事务边界:manuscript 目录扫描(事务前)与 frontmatter 回写(事务提交后)都是慢文件 I/O,必须留在
     * DB interactive transaction 之外——否则真实项目会撑爆默认 5s 事务超时(Task 87 实测踩坑)。
     * 事务内只做 Act/Chapter 的纯 DB 写入。
     */
    async bootstrapCarrierTree(): Promise<CarrierTreeBootstrapResult> {
        this.assertAccepting();
        const snapshot = await readProjectWorkspaceTreeSnapshot({
            target: this.fileTarget,
            fileIndex: this.fileIndex,
        });
        const dbResult = await this.runInTransaction((module) => module.chapterBootstrapService.applyCarrierTree(snapshot.nodes));
        const fsResult = await writeProsePointers(
            this.fileTarget,
            dbResult.pendingPointers,
            this.history,
            this.fileIndex,
        );
        return {
            actsCreated: dbResult.actsCreated,
            chaptersCreated: dbResult.chaptersCreated,
            chaptersLinkedToAct: dbResult.chaptersLinkedToAct,
            proseFrontmatterWritten: fsResult.proseFrontmatterWritten,
            warnings: fsResult.warnings,
        };
    }

    /**
     * 关闭当前generation拥有的全部Plot client。
     *
     * 首次调用立即拒绝新操作；每个entry只有在完整关闭成功后才从本handle registry删除，失败entry
     * 保留原client与adapter，供同一ProjectSession generation精确重试。
     */
    async close(): Promise<void> {
        if (this.closed) {
            return;
        }
        if (this.closing) {
            return this.closing;
        }
        this.accepting = false;
        const attempt = (async () => {
            for (const [cacheKey, entry] of [...this.clients.entries()]) {
                await entry.client.$disconnect();
                entry.adapter.closeTrackedClients();
                collectReleasedSqliteHandles();
                this.clients.delete(cacheKey);
            }
            this.closed = true;
        })();
        this.closing = attempt;
        try {
            await attempt;
        } finally {
            if (!this.closed && this.closing === attempt) {
                this.closing = null;
            }
        }
    }

    /**
     * 查询 Story。
     */
    async getStoryDto(): Promise<StoryDto> {
        return (await this.createModule()).storyService.getStoryDto();
    }

    /**
     * 更新 Story。
     */
    async updateStory(patch: UpdateStoryRequestDto): Promise<StoryDto> {
        return this.runInTransaction((module) => module.storyService.updateStory(patch));
    }

    /**
     * 查询剧情树。
     */
    async getPlotTree(): Promise<PlotTreeDto> {
        return this.formatPlotTreeAnchors(await (await this.createModule()).storyService.getPlotTree());
    }

    /**
     * 查询剧本工作台聚合数据。
     */
    async getPlotWorkbench(): Promise<PlotWorkbenchDto> {
        return this.formatPlotWorkbenchAnchors(await (await this.createModule()).storyService.getPlotWorkbench());
    }

    /**
     * 查询阶段详情。
     */
    async getStoryPhaseDto(phaseId: number): Promise<StoryPhaseDto> {
        return (await this.createModule()).storyService.getStoryPhaseDto(phaseId);
    }

    /**
     * 创建阶段。
     */
    async createStoryPhase(input: CreateStoryPhaseRequestDto): Promise<StoryPhaseDto> {
        return this.runInTransaction((module) => module.storyService.createStoryPhase(input));
    }

    /**
     * 更新阶段。
     */
    async updateStoryPhase(phaseId: number, patch: UpdateStoryPhaseRequestDto): Promise<StoryPhaseDto> {
        return this.runInTransaction((module) => module.storyService.updateStoryPhase(phaseId, patch));
    }

    /**
     * 删除阶段。
     */
    async deleteStoryPhase(phaseId: number): Promise<void> {
        await this.runInTransaction((module) => module.storyService.deleteStoryPhase(phaseId));
    }

    /**
     * 重排阶段。
     */
    async reorderStoryPhases(input: ReorderStoryPhasesRequestDto): Promise<PlotTreeDto> {
        return this.runInTransaction((module) => (
            module.storyService.reorderStoryPhases(module.inputParser.parseReorderPhases(input))
        ));
    }

    /**
     * 查询线程详情。
     */
    async getStoryThreadDetailDto(threadId: number): Promise<StoryThreadDetailDto> {
        return this.formatThreadDetailAnchors(await (await this.createModule()).threadService.getStoryThreadDetailDto(threadId));
    }

    /**
     * 创建线程。
     */
    async createStoryThread(input: CreateStoryThreadRequestDto): Promise<StoryThreadWriteResponseDto> {
        const processedInput = processTextFieldsWithResults(input, ["summary", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
            const detail = await module.threadService.createStoryThread(module.inputParser.parseCreateThread({
                ...processedInput.values,
            }));
            return {
                ...detail,
                diagnostics: toResponseContentDiagnostics(processedInput.diagnostics),
            };
        });
    }

    /**
     * 更新线程。
     */
    async updateStoryThread(
        threadId: number,
        patch: UpdateStoryThreadRequestDto,
    ): Promise<StoryThreadWriteResponseDto> {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "writingTip", "note"]);
        return this.runInTransaction(async (module) => {
            const detail = await module.threadService.updateStoryThread(
                threadId,
                module.inputParser.parseUpdateThread({
                    ...processedPatch.values,
                }),
            );
            return {
                ...detail,
                diagnostics: toResponseContentDiagnostics(processedPatch.diagnostics),
            };
        });
    }

    /**
     * 删除线程。
     */
    async deleteStoryThread(threadId: number): Promise<void> {
        await this.runInTransaction((module) => module.threadService.deleteStoryThread(threadId));
    }

    /**
     * 重排线程。
     */
    async reorderStoryThreads(input: ReorderStoryThreadsRequestDto): Promise<PlotTreeDto> {
        return this.runInTransaction((module) => (
            module.threadService.reorderStoryThreads(module.inputParser.parseReorderThreads(input))
        ));
    }

    /**
     * 查询 Scene 详情。
     */
    async getStorySceneDetailDto(sceneId: number): Promise<StorySceneDetailDto> {
        return this.formatSceneDetailAnchor(await (await this.createModule()).sceneService.getStorySceneDetailDto(sceneId));
    }

    /**
     * 查询章节下的剧情 Scene。
     */
    async getChapterPlotDetailDto(chapterId: number): Promise<ChapterPlotDetailDto> {
        return this.formatChapterPlotAnchors(await (await this.createModule()).sceneService.getChapterPlotDetailDto(chapterId));
    }

    /**
     * 查询章节 writer brief。
     * @param mode 防全知模式;默认 autonomous。
     */
    async getChapterWriterBrief(chapterId: number, mode: ChapterWriterBriefMode = "autonomous"): Promise<ChapterWriterBriefDto> {
        return (await this.createModule()).chapterWriterBriefService.getChapterWriterBrief(chapterId, mode);
    }

    /**
     * 查询卷详情。
     */
    async getStoryActDto(actId: number): Promise<StoryActDto> {
        return (await this.createModule()).chapterService.getStoryActDto(actId);
    }

    /**
     * 创建卷。
     */
    async createStoryAct(input: CreateStoryActRequestDto): Promise<StoryActDto> {
        return this.runInTransaction((module) => module.chapterService.createStoryAct(input));
    }

    /**
     * 更新卷。
     */
    async updateStoryAct(actId: number, patch: UpdateStoryActRequestDto): Promise<StoryActDto> {
        return this.runInTransaction((module) => module.chapterService.updateStoryAct(actId, patch));
    }

    /**
     * 删除卷。
     */
    async deleteStoryAct(actId: number): Promise<void> {
        await this.runInTransaction((module) => module.chapterService.deleteStoryAct(actId));
    }

    /**
     * 查询章详情(含 ChapterBrief)。
     */
    async getStoryChapterDto(chapterId: number): Promise<StoryChapterDto> {
        return (await this.createModule()).chapterService.getStoryChapterDto(chapterId);
    }

    /**
     * 创建章。
     */
    async createStoryChapter(input: CreateStoryChapterRequestDto): Promise<StoryChapterDto> {
        const processedInput = processTextFieldsWithResults(input, ["note"]);
        return this.runInTransaction((module) => (
            module.chapterService.createStoryChapter(module.inputParser.parseCreateChapter({
                ...processedInput.values,
            }))
        ));
    }

    /**
     * 更新章(含 ChapterBrief 字段)。
     */
    async updateStoryChapter(chapterId: number, patch: UpdateStoryChapterRequestDto): Promise<StoryChapterDto> {
        const processedPatch = processTextFieldsWithResults(patch, ["note"]);
        return this.runInTransaction((module) => (
            module.chapterService.updateStoryChapter(chapterId, module.inputParser.parseUpdateChapter({
                ...processedPatch.values,
            }))
        ));
    }

    /**
     * 删除章。
     */
    async deleteStoryChapter(chapterId: number): Promise<void> {
        await this.runInTransaction((module) => module.chapterService.deleteStoryChapter(chapterId));
    }

    /**
     * 查询 Scene 对应的 World Engine 上下文。
     */
    async getSceneWorldContext(sceneId: number): Promise<SceneWorldContextDto> {
        return (await this.createModule()).sceneWorldContextService.getSceneWorldContext(sceneId);
    }

    /**
     * 创建 Scene。
     */
    async createStoryScene(input: CreateStorySceneRequestDto): Promise<StorySceneWriteResponseDto> {
        const processedInput = processTextFieldsWithResults(input, ["summary", "purpose", "writingTip", "note"]);
        const result = await this.runInTransaction(async (module) => {
            const story = await module.storyService.ensureStory();
            const processedRefs = await processStructuredReferences({
                refs: processedInput.values.refs ?? [],
                allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
                label: "plot",
                resolve: (nextRefs) => module.refResolverService.resolveRefs(story.id, nextRefs),
            });
            const detail = await module.sceneService.createStoryScene(module.inputParser.parseCreateScene({
                ...processedInput.values,
                worldAnchor: await this.parseWorldAnchorDto(processedInput.values.worldAnchor),
                refs: processedRefs.normalized,
                resolvedRefs: processedRefs.resolved,
            }));
            return {
                detail,
                diagnostics: toResponseContentDiagnostics(mergeContentDiagnostics(
                    processedInput.diagnostics,
                    processedRefs.diagnostics,
                )),
            };
        });
        return {
            ...await this.formatSceneDetailAnchor(result.detail),
            diagnostics: result.diagnostics,
        };
    }

    /**
     * 更新 Scene。
     */
    async updateStoryScene(
        sceneId: number,
        patch: UpdateStorySceneRequestDto,
    ): Promise<StorySceneWriteResponseDto> {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "purpose", "writingTip", "note"]);
        const result = await this.runInTransaction(async (module) => {
            const story = await module.storyService.ensureStory();
            const processedRefs = processedPatch.values.refs === undefined
                ? null
                : await processStructuredReferences({
                    refs: processedPatch.values.refs,
                    allowedKinds: STORY_STRUCTURED_REFERENCE_KINDS,
                    label: "plot",
                    resolve: (nextRefs) => module.refResolverService.resolveRefs(story.id, nextRefs),
                });
            const detail = await module.sceneService.updateStoryScene(
                sceneId,
                module.inputParser.parseUpdateScene({
                    ...processedPatch.values,
                    worldAnchor: processedPatch.values.worldAnchor === undefined
                        ? undefined
                        : await this.parseWorldAnchorDto(processedPatch.values.worldAnchor),
                    refs: processedRefs?.normalized,
                    resolvedRefs: processedRefs?.resolved,
                }),
            );
            return {
                detail,
                diagnostics: toResponseContentDiagnostics(mergeContentDiagnostics(
                    processedPatch.diagnostics,
                    processedRefs?.diagnostics ?? {errors: [], warnings: [], notes: []},
                )),
            };
        });
        return {
            ...await this.formatSceneDetailAnchor(result.detail),
            diagnostics: result.diagnostics,
        };
    }

    /**
     * 删除 Scene。
     */
    async deleteStoryScene(sceneId: number): Promise<void> {
        await this.runInTransaction((module) => module.sceneService.deleteStoryScene(sceneId));
    }

    /**
     * 重排 Scene。
     */
    async reorderStoryScenes(input: ReorderStoryScenesRequestDto): Promise<PlotTreeDto> {
        const tree = await this.runInTransaction(async (module) => (
            module.sceneService.reorderStoryScenes(module.inputParser.parseReorderScenes(input))
        ));
        return this.formatPlotTreeAnchors(tree);
    }

    /**
     * 查询 Promise 摘要列表(open 优先、importance 高在前,含派生阶段与 beat 计数)。
     */
    async listStoryPromises(): Promise<StoryPromiseDto[]> {
        return (await this.createModule()).promiseService.listStoryPromises();
    }

    /**
     * 查询 Promise 详情(含 beats 及各 beat 所在 Scene/章位)。
     */
    async getStoryPromiseDetailDto(promiseId: number): Promise<StoryPromiseDetailDto> {
        return (await this.createModule()).promiseService.getStoryPromiseDetailDto(promiseId);
    }

    /**
     * 创建 Promise(读者债务账本条目)。
     */
    async createStoryPromise(input: CreateStoryPromiseRequestDto): Promise<StoryPromiseDetailDto> {
        const processedInput = processTextFieldsWithResults(input, ["summary", "payoffExpectation"]);
        return this.runInTransaction((module) => (
            module.promiseService.createStoryPromise(module.inputParser.parseCreatePromise({
                ...processedInput.values,
            }))
        ));
    }

    /**
     * 更新 Promise。status 直改承载 abandon/fulfill/reopen。
     */
    async updateStoryPromise(promiseId: number, patch: UpdateStoryPromiseRequestDto): Promise<StoryPromiseDetailDto> {
        const processedPatch = processTextFieldsWithResults(patch, ["summary", "payoffExpectation"]);
        return this.runInTransaction((module) => (
            module.promiseService.updateStoryPromise(promiseId, module.inputParser.parseUpdatePromise({
                ...processedPatch.values,
            }))
        ));
    }

    /**
     * 物理删除 Promise(beats 级联)。只给 UI/人工使用,不开放给 Agent(Task 97 D4)。
     */
    async deleteStoryPromise(promiseId: number): Promise<void> {
        await this.runInTransaction((module) => module.promiseService.deleteStoryPromise(promiseId));
    }

    /**
     * set beat(upsert:同场同线仅一条)。kind=payoff 且 autoFulfill!==false 时自动置 fulfilled。
     */
    async setPromiseBeat(promiseId: number, input: SetPromiseBeatRequestDto): Promise<StoryPromiseDetailDto> {
        const processedInput = processTextFieldsWithResults(input, ["note"]);
        return this.runInTransaction((module) => (
            module.promiseService.setPromiseBeat(promiseId, module.inputParser.parseSetPromiseBeat({
                ...processedInput.values,
            }))
        ));
    }

    /**
     * remove beat。删除后跑 fulfilled 回退检查(D5 回退边界)。
     */
    async removePromiseBeat(promiseId: number, sceneId: number): Promise<StoryPromiseDetailDto> {
        return this.runInTransaction((module) => module.promiseService.removePromiseBeat(promiseId, sceneId));
    }

    /**
     * 查询 Decision 列表(open 优先,含死引用标注与期限章摘要)。
     */
    async listStoryDecisions(): Promise<StoryDecisionDto[]> {
        return (await this.createModule()).decisionService.listStoryDecisions();
    }

    /**
     * 查询 Decision 详情。
     */
    async getStoryDecisionDto(decisionId: number): Promise<StoryDecisionDto> {
        return (await this.createModule()).decisionService.getStoryDecisionDto(decisionId);
    }

    /**
     * 创建 Decision(恒 open 态;decided 走 update 的 decide 转换)。
     */
    async createStoryDecision(input: CreateStoryDecisionRequestDto): Promise<StoryDecisionDto> {
        const processedInput = processTextFieldsWithResults(input, ["question", "note"]);
        return this.runInTransaction((module) => (
            module.decisionService.createStoryDecision(module.inputParser.parseCreateDecision({
                ...processedInput.values,
            }))
        ));
    }

    /**
     * 更新 Decision。status 直改承载 decide/drop/supersede/reopen;
     * decide 转换(risk 必填、options 未选项转否决骨架)在服务层统一发生。
     */
    async updateStoryDecision(decisionId: number, patch: UpdateStoryDecisionRequestDto): Promise<StoryDecisionDto> {
        const processedPatch = processTextFieldsWithResults(patch, ["question", "decision", "motivation", "risk", "note"]);
        return this.runInTransaction((module) => (
            module.decisionService.updateStoryDecision(decisionId, module.inputParser.parseUpdateDecision({
                ...processedPatch.values,
            }))
        ));
    }

    /**
     * 物理删除 Decision。只给 UI/人工使用,不开放给 Agent(Task 97 D4;Agent 软删出口是 action=drop)。
     */
    async deleteStoryDecision(decisionId: number): Promise<void> {
        await this.runInTransaction((module) => module.decisionService.deleteStoryDecision(decisionId));
    }

    /**
     * 将 HTTP DTO 的日历字符串解析为服务层 World Anchor。
     */
    private async parseWorldAnchorDto(dto?: StorySceneWorldAnchorInputDto): Promise<SceneWorldAnchor> {
        if (!dto) {
            return {
                startInstant: null,
                endInstant: null,
                subjectIds: [],
                locationSubjectId: null,
            };
        }

        return {
            startInstant: dto.startTime === null ? null : await this.worldEngine.parseTime(dto.startTime),
            endInstant: dto.endTime === null ? null : await this.worldEngine.parseTime(dto.endTime),
            subjectIds: dto.subjectIds.map((subjectId) => subjectId.trim()),
            locationSubjectId: dto.locationSubjectId === null ? null : dto.locationSubjectId.trim(),
        };
    }

    /**
     * 格式化剧情树里所有 Scene 的 World Anchor。
     */
    private async formatPlotTreeAnchors(tree: PlotTreeDto): Promise<PlotTreeDto> {
        const anchorMap = await this.resolveSceneAnchorMap([
            ...tree.phases.flatMap((phase) => phase.threads.flatMap((thread) => thread.scenes)),
            ...tree.ungroupedThreads.flatMap((thread) => thread.scenes),
        ]);
        return {
            ...tree,
            phases: await Promise.all(tree.phases.map(async (phase) => ({
                ...phase,
                threads: await Promise.all(phase.threads.map(async (thread) => ({
                    ...thread,
                    scenes: thread.scenes.map((scene) => this.attachResolvedAnchor(scene, anchorMap)),
                }))),
            }))),
            ungroupedThreads: await Promise.all(tree.ungroupedThreads.map(async (thread) => ({
                ...thread,
                scenes: thread.scenes.map((scene) => this.attachResolvedAnchor(scene, anchorMap)),
            }))),
        };
    }

    /**
     * 格式化工作台里所有 Scene 的 World Anchor。
     */
    private async formatPlotWorkbenchAnchors(workbench: PlotWorkbenchDto): Promise<PlotWorkbenchDto> {
        const anchorMap = await this.resolveSceneAnchorMap([
            ...workbench.phases.flatMap((phase) => phase.threads.flatMap((thread) => thread.scenes)),
            ...workbench.ungroupedThreads.flatMap((thread) => thread.scenes),
        ]);
        return {
            ...workbench,
            phases: await Promise.all(workbench.phases.map(async (phase) => ({
                ...phase,
                threads: await Promise.all(phase.threads.map(async (thread) => ({
                    ...thread,
                    scenes: thread.scenes.map((scene) => this.attachResolvedAnchor(scene, anchorMap)),
                }))),
            }))),
            ungroupedThreads: await Promise.all(workbench.ungroupedThreads.map(async (thread) => ({
                ...thread,
                scenes: thread.scenes.map((scene) => this.attachResolvedAnchor(scene, anchorMap)),
            }))),
        };
    }

    /**
     * 格式化 Thread 详情里的 Scene World Anchor。
     */
    private async formatThreadDetailAnchors(detail: StoryThreadDetailDto): Promise<StoryThreadDetailDto> {
        const anchorMap = await this.resolveSceneAnchorMap(detail.scenes ?? []);
        return {
            ...detail,
            scenes: detail.scenes === undefined
                ? undefined
                : detail.scenes.map((scene) => this.attachResolvedAnchor(scene, anchorMap)),
        };
    }

    /**
     * 格式化 Scene 详情里的 World Anchor。
     */
    private async formatSceneDetailAnchor(detail: StorySceneDetailDto): Promise<StorySceneDetailDto> {
        return {
            ...detail,
            worldAnchor: await this.sceneWorldAnchorResolutionService.resolve(detail.worldAnchor),
        };
    }

    /**
     * 格式化章节剧情里的 Scene World Anchor。
     */
    private async formatChapterPlotAnchors(detail: ChapterPlotDetailDto): Promise<ChapterPlotDetailDto> {
        const anchorMap = await this.resolveSceneAnchorMap(detail.scenes);
        return {
            ...detail,
            scenes: detail.scenes.map((scene) => this.attachResolvedAnchor(scene, anchorMap)),
        };
    }

    /**
     * 批量解析 Scene 摘要中的 World Anchor。
     */
    private async resolveSceneAnchorMap<TScene extends {worldAnchor: StorySceneWorldAnchorDto}>(
        scenes: TScene[],
    ): Promise<Map<TScene, StorySceneWorldAnchorDto>> {
        const resolvedAnchors = await this.sceneWorldAnchorResolutionService.resolveMany(
            scenes.map((scene) => scene.worldAnchor),
        );
        return new Map(scenes.map((scene, index) => [scene, resolvedAnchors[index] ?? scene.worldAnchor]));
    }

    /**
     * 把已解析的 World Anchor 接回 Scene DTO。
     */
    private attachResolvedAnchor<TScene extends {worldAnchor: StorySceneWorldAnchorDto}>(
        scene: TScene,
        anchorMap: Map<TScene, StorySceneWorldAnchorDto>,
    ): TScene {
        return {
            ...scene,
            worldAnchor: anchorMap.get(scene) ?? scene.worldAnchor,
        };
    }

    /**
     * 在事务里执行写操作。
     */
    private async runInTransaction<TResult>(callback: (module: PlotModule) => Promise<TResult>): Promise<TResult> {
        const prisma = await this.client();
        return prisma.$transaction(async (transactionClient: Prisma.TransactionClient) => {
            return callback(this.createModuleFromExecutor(transactionClient));
        });
    }

    /**
     * 按执行器构建剧情模块对象图。
     */
    private async createModule(): Promise<PlotModule> {
        return this.createModuleFromExecutor(await this.client());
    }

    /**
     * 返回当前generation的Project SQLite PrismaClient。
     */
    private async client(): Promise<PrismaClient> {
        this.assertAccepting();
        const databasePath = await this.database.databasePath;
        const cacheKey = databasePath.replace(/\\/g, "/");
        const existing = this.clients.get(cacheKey);
        if (existing) {
            return existing.client;
        }
        const adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(databasePath)});
        const client = new PrismaClient({
            adapter,
        });
        this.clients.set(cacheKey, {client, adapter});
        return client;
    }

    /** generation开始关闭后拒绝创建新连接或读取Project文件。 */
    private assertAccepting(): void {
        if (!this.accepting) {
            throw new Error(`Plot facade已进入关闭状态：${this.workspace.ref.projectRoot}`);
        }
    }

    /**
     * 按执行器构建剧情模块对象图。
     */
    private createModuleFromExecutor(executor: PrismaExecutor): PlotModule {
        const inputParser = new PlotInputParser();
        const assembler = new PlotDtoAssembler();
        const storyRepository = new PrismaStoryRepository(executor);
        const threadRepository = new PrismaThreadRepository(executor);
        const sceneRepository = new PrismaSceneRepository(executor);
        const chapterRepository = new PrismaChapterRepository(executor);
        const promiseRepository = new PrismaPromiseRepository(executor);
        const decisionRepository = new PrismaDecisionRepository(executor);
        const orderService = new OrderService(storyRepository, threadRepository, sceneRepository);
        const scopeGuard = new PlotScopeGuard(
            storyRepository,
            threadRepository,
            sceneRepository,
            chapterRepository,
            promiseRepository,
            decisionRepository,
        );
        const storyService = new StoryService(
            this.project,
            storyRepository,
            threadRepository,
            chapterRepository,
            promiseRepository,
            decisionRepository,
            orderService,
            assembler,
            scopeGuard,
        );
        const refResolverService = new RefResolverService(threadRepository, scopeGuard);
        const worldAnchorValidator = new SceneWorldAnchorValidator();
        const promiseService = new PromiseService(
            promiseRepository,
            storyService,
            scopeGuard,
            assembler,
        );
        const decisionService = new DecisionService(
            decisionRepository,
            chapterRepository,
            storyService,
            scopeGuard,
            assembler,
        );
        const threadService = new ThreadService(
            threadRepository,
            storyService,
            scopeGuard,
            orderService,
            assembler,
            promiseService,
        );
        const sceneService = new SceneService(
            sceneRepository,
            storyService,
            scopeGuard,
            orderService,
            refResolverService,
            worldAnchorValidator,
            assembler,
            promiseService,
        );
        const sceneWorldContextService = new SceneWorldContextService(
            sceneRepository,
            storyService,
            scopeGuard,
            this.worldEngine,
        );
        const chapterService = new ChapterService(
            chapterRepository,
            storyService,
            scopeGuard,
            assembler,
        );
        const chapterBootstrapService = new ChapterBootstrapService(
            chapterRepository,
            storyService,
            scopeGuard,
        );
        const chapterWriterBriefService = new ChapterWriterBriefService(
            sceneRepository,
            storyService,
            scopeGuard,
            sceneWorldContextService,
            this.sceneWorldAnchorResolutionService,
            assembler,
            promiseRepository,
            chapterRepository,
            decisionService,
        );

        return {
            inputParser,
            storyService,
            threadService,
            sceneService,
            chapterService,
            chapterBootstrapService,
            sceneWorldContextService,
            chapterWriterBriefService,
            refResolverService,
            promiseService,
            decisionService,
        };
    }
}
