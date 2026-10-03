import type {ChapterRepository, PromiseRepository, SceneRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {ChapterWriterBriefSceneWithThread} from "nbook/server/plot/core/types";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import {DecisionService} from "nbook/server/plot/services/decision.service";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {SceneWorldAnchorResolutionService} from "nbook/server/plot/services/scene-world-anchor-resolution.service";
import {SceneWorldContextService} from "nbook/server/plot/services/scene-world-context.service";
import {StoryService} from "nbook/server/plot/services/story.service";
import {stringifyEntityId} from "nbook/server/utils/novel-chapter";
import type {
    ChapterBriefDto,
    ChapterWriterBriefDto,
    ChapterWriterBriefMode,
    ChapterWriterBriefOpenDecisionDto,
    ChapterWriterBriefPromiseTaskDto,
    ChapterWriterBriefReadingDto,
    ChapterWriterBriefSceneDto,
    ChapterWriterBriefStatus,
    SceneWorldContextDto,
    StoryChapterDto,
    StoryDecisionDto,
    StoryPromiseBeatKindDto,
} from "nbook/shared/dto/plot.dto";

/**
 * Chapter writer brief 只读聚合服务。
 *
 * 聚合 ChapterBrief(章级写作指令)+ Scene 剧情点 + Scene/Thread refs + Scene World Context
 * + 规划层两段(本章 Promise 任务 D25 / 未决决策警告 D26),
 * 按 writer 防全知模式渲染两种 markdown:
 * - autonomous:writer 自查 World Engine/lorebook,brief 只给「查哪些 subject / 哪个时间窗」的查询提示,不展开状态。
 * - curated:writer 读不到设定源,brief 展开 World Context 状态摘要,由 leader 投喂前按 mustHide 删减。
 *
 * 信息控制是防全知唯一的按章控制面,四项全空时 status 降级为 needs_chapter_brief,阻断 handoff。
 * 规划层两段只追加内容,不参与 status 阶梯(D26 第一版不做 status 阻断)。
 */
export class ChapterWriterBriefService {
    constructor(
        private readonly sceneRepository: SceneRepository,
        private readonly storyService: StoryService,
        private readonly scopeGuard: PlotScopeGuard,
        private readonly sceneWorldContextService: SceneWorldContextService,
        private readonly anchorResolutionService: SceneWorldAnchorResolutionService,
        private readonly assembler: PlotDtoAssembler,
        private readonly promiseRepository: PromiseRepository,
        private readonly chapterRepository: ChapterRepository,
        private readonly decisionService: DecisionService,
    ) {}

    /**
     * 生成指定章节的 writer brief DTO 与可直接交给 writer 的 markdown 草案。
     * @param mode 防全知模式;默认 autonomous。
     */
    async getChapterWriterBrief(chapterId: number, mode: ChapterWriterBriefMode = "autonomous"): Promise<ChapterWriterBriefDto> {
        const story = await this.storyService.ensureStory();
        const chapter = await this.scopeGuard.assertChapter(story.id, chapterId);
        const chapterDto = this.assembler.toStoryChapterDto(chapter);
        const records = await this.sceneRepository.findChapterScenesForBrief(chapter.id);
        const scenes = await this.buildBriefScenes(records);
        const suggestedReading = this.buildSuggestedReading(records);
        const promiseTasks = await this.buildPromiseTasks(records);
        const openDecisions = await this.buildOpenDecisionWarnings(story.id, chapter.id, records);
        const warnings = uniqueStrings(scenes.flatMap((scene) => scene.warnings));
        const status = chooseStatus(scenes, chapterDto.brief);
        if (records.length === 0) {
            warnings.push("本章节尚未关联 Plot Scene；请先建立章节 Scene 顺序。");
        }
        if (status === "needs_chapter_brief") {
            warnings.push("信息控制未填写：请在 ChapterBrief 补「读者已知 / 主角已知 / 必须隐藏 / 可暗示」中至少一项，这是防全知唯一的按章控制面。");
        }

        const brief: Omit<ChapterWriterBriefDto, "suggestedBriefMarkdown"> = {
            chapter: chapterDto,
            mode,
            status,
            scenes,
            totalScenes: scenes.length,
            suggestedReading,
            promiseTasks,
            openDecisions,
            warnings,
        };
        return {
            ...brief,
            suggestedBriefMarkdown: renderSuggestedBriefMarkdown(brief),
        };
    }

    /**
     * 为每个 Scene 组装 brief scene item。
     */
    private async buildBriefScenes(
        records: ChapterWriterBriefSceneWithThread[],
    ): Promise<ChapterWriterBriefSceneDto[]> {
        const rawAnchors = records.map((record) => this.assembler.toStorySceneWorldAnchorDto(record));
        const resolvedAnchors = await this.anchorResolutionService.resolveMany(rawAnchors);
        const result: ChapterWriterBriefSceneDto[] = [];

        for (const [index, record] of records.entries()) {
            const worldAnchor = resolvedAnchors[index] ?? rawAnchors[index]!;
            const warnings: string[] = [];
            let worldContext: SceneWorldContextDto | null = null;

            if (record.startInstant === null || record.endInstant === null) {
                warnings.push(`Scene「${record.title}」尚未设置完整 World Engine 时间范围。`);
            } else {
                worldContext = await this.readWorldContext(record, warnings);
                if (worldContext && worldContext.unresolvedSubjectIds.length > 0) {
                    warnings.push(`Scene「${record.title}」存在未解析 subject：${worldContext.unresolvedSubjectIds.join(", ")}。`);
                }
                if (worldContext && worldContext.slices.length === 0 && worldContext.subjectStates.length === 0 && worldContext.unresolvedSubjectIds.length === 0) {
                    warnings.push(`Scene「${record.title}」没有可展示的 World Engine 上下文；可继续写作，但建议 leader 复核是否需要补状态。`);
                }
            }

            result.push({
                id: stringifyEntityId(record.id),
                threadId: stringifyEntityId(record.thread.id),
                threadTitle: record.thread.title,
                threadIsMain: record.thread.isMainThread,
                threadSummary: record.thread.summary,
                threadWritingTip: record.thread.writingTip,
                chapterId: record.chapterId === null ? null : stringifyEntityId(record.chapterId),
                chapterSortOrder: record.chapterSortOrder,
                threadSortOrder: record.threadSortOrder,
                title: record.title,
                status: record.status,
                summary: record.summary,
                purpose: record.purpose,
                writingTip: record.writingTip,
                worldAnchor,
                worldContext,
                warnings,
            });
        }

        return result;
    }

    /**
     * 从 Scene refs 编译建议读取清单(仅 content 类内容节点),按 path 去重。
     * 替代 leader 手写「设定复述」;Thread 级 refs 目前不存在,全部标 source=scene。
     */
    private buildSuggestedReading(records: ChapterWriterBriefSceneWithThread[]): ChapterWriterBriefReadingDto[] {
        const seen = new Set<string>();
        const reading: ChapterWriterBriefReadingDto[] = [];
        for (const record of records) {
            for (const ref of record.refs) {
                if (ref.targetKind !== "content") {
                    continue;
                }
                const path = this.assembler.normalizeStoryRefTarget(ref);
                if (seen.has(path)) {
                    continue;
                }
                seen.add(path);
                reading.push({path, relation: ref.relation, note: ref.note, source: "scene"});
            }
        }
        return reading;
    }

    /**
     * 编译「本章 Promise 任务」条目(D25):本章各 Scene 上的 beats → 推进指令。
     * - archived 场的 beats 不参与任何派生(D5),任务也不下发;
     * - abandoned 线已被作者放弃,其 beats 不再给 writer 下发指令;
     * - payoffExpectation 只附在兑现(payoff)任务上(D7:只给兑现场的 writer)。
     * 逐场查询与 World Context 的每场查询同量级,本章 Scene 数小,不做批量接口。
     */
    private async buildPromiseTasks(records: ChapterWriterBriefSceneWithThread[]): Promise<ChapterWriterBriefPromiseTaskDto[]> {
        const tasks: ChapterWriterBriefPromiseTaskDto[] = [];
        for (const record of records) {
            if (record.status === "archived") {
                continue;
            }
            const beats = await this.promiseRepository.findBeatsByScene(record.id);
            for (const beat of beats) {
                if (beat.promise.status === "abandoned") {
                    continue;
                }
                tasks.push({
                    sceneId: stringifyEntityId(record.id),
                    sceneTitle: record.title,
                    promiseId: stringifyEntityId(beat.promise.id),
                    promiseName: beat.promise.name,
                    promiseTitle: beat.promise.title,
                    kind: beat.kind,
                    note: beat.note,
                    payoffExpectation: beat.kind === "payoff" ? beat.promise.payoffExpectation : null,
                });
            }
        }
        return tasks;
    }

    /**
     * 编译「未决决策警告」条目(D26):从全部 open Decision 里筛出触及本章的。
     * 触及判定 = anchor 命中本章 / 本章内 Scene / 本章 Scene 所属 Thread / 本章 beats 的 Promise,
     * 外加 story 级且拍板期限距本章 ≤3 章序位(承载树章序坐标系,D17)。
     * 判定宁多勿漏(警告成本低、漏报会被写死):Scene/Thread/Promise 三个触及集合都不排除
     * archived 场与 abandoned 线——buildPromiseTasks 的严口径只管"下发任务",与此处的宽口径分离。
     */
    private async buildOpenDecisionWarnings(
        storyId: number,
        chapterId: number,
        records: ChapterWriterBriefSceneWithThread[],
    ): Promise<ChapterWriterBriefOpenDecisionDto[]> {
        const openDecisions = (await this.decisionService.listStoryDecisions()).filter((decision) => decision.status === "open");
        if (openDecisions.length === 0) {
            return [];
        }
        const chapterIdText = stringifyEntityId(chapterId);
        const sceneTitleById = new Map(records.map((record) => [stringifyEntityId(record.id), record.title]));
        const threadTitleById = new Map(records.map((record) => [stringifyEntityId(record.thread.id), record.thread.title]));
        // Promise 触及集合直接取本章全部场的 beats(含 archived 场与 abandoned 线),不复用任务集合;
        // 仅在存在 open Decision 时才发生这轮查询,量级与任务编译的逐场查询相同。
        const promiseTitleById = new Map<string, string>();
        for (const record of records) {
            for (const beat of await this.promiseRepository.findBeatsByScene(record.id)) {
                promiseTitleById.set(stringifyEntityId(beat.promise.id), beat.promise.title);
            }
        }
        // 章序投影:findChaptersByStory 按 story 级 sortOrder 排列,列表下标即章序位。
        const chapters = await this.chapterRepository.findChaptersByStory(storyId);
        const orderByChapterId = new Map(chapters.map((chapter, index) => [stringifyEntityId(chapter.id), index]));

        const result: ChapterWriterBriefOpenDecisionDto[] = [];
        for (const decision of openDecisions) {
            const reason = resolveDecisionTouchReason(decision, {
                chapterIdText,
                sceneTitleById,
                threadTitleById,
                promiseTitleById,
                orderByChapterId,
            });
            if (reason === null) {
                continue;
            }
            result.push({
                decisionId: decision.id,
                name: decision.name,
                title: decision.title,
                question: decision.question,
                options: decision.options,
                reason,
            });
        }
        return result;
    }

    /**
     * 读取单个 Scene 的 World Engine 上下文，失败时只记录通用 warning。
     */
    private async readWorldContext(
        record: ChapterWriterBriefSceneWithThread,
        warnings: string[],
    ): Promise<SceneWorldContextDto | null> {
        try {
            return await this.sceneWorldContextService.getSceneWorldContextForScene(record);
        } catch {
            warnings.push(`Scene「${record.title}」的 World Engine 上下文查询失败；请先让 leader 或 world.engine 复核世界状态。`);
            return null;
        }
    }
}

/**
 * 判断信息控制四项是否全空。
 */
function isInfoControlEmpty(brief: ChapterBriefDto): boolean {
    return !brief.readerKnows && !brief.protagonistKnows && !brief.mustHide && !brief.hintOnly;
}

/**
 * 按固定优先级聚合 brief 状态。
 * needs_chapter_brief(信息控制缺失)排在世界上下文之后:先保证 Scene/World 数据完整,再要求信息控制。
 */
function chooseStatus(scenes: ChapterWriterBriefSceneDto[], brief: ChapterBriefDto): ChapterWriterBriefStatus {
    if (scenes.length === 0) {
        return "needs_plot";
    }
    if (scenes.some((scene) => scene.worldAnchor.startInstant === null || scene.worldAnchor.endInstant === null)) {
        return "needs_world_anchor";
    }
    if (scenes.some((scene) => scene.worldContext === null || scene.worldContext.unresolvedSubjectIds.length > 0)) {
        return "needs_world_context";
    }
    if (isInfoControlEmpty(brief)) {
        return "needs_chapter_brief";
    }
    return "ready";
}

/**
 * 单条 open Decision 的触及判定(D26),命中返回人类可读原因,未触及返回 null。
 * anchorKind 是单值,各分支互斥;act/content 锚不做章级触及判定(D26 未列入)。
 * anchor 已由读取层归一化(载体被删视同 story),此处不再处理死引用锚。
 */
function resolveDecisionTouchReason(decision: StoryDecisionDto, context: {
    chapterIdText: string;
    sceneTitleById: Map<string, string>;
    threadTitleById: Map<string, string>;
    promiseTitleById: Map<string, string>;
    orderByChapterId: Map<string, number>;
}): string | null {
    switch (decision.anchorKind) {
        case "chapter":
            return decision.anchorTargetId === context.chapterIdText ? "决策锚定本章" : null;
        case "scene": {
            const title = decision.anchorTargetId === null ? undefined : context.sceneTitleById.get(decision.anchorTargetId);
            return title === undefined ? null : `决策锚定本章 Scene「${title}」`;
        }
        case "thread": {
            const title = decision.anchorTargetId === null ? undefined : context.threadTitleById.get(decision.anchorTargetId);
            return title === undefined ? null : `决策锚定本章 Scene 所属 Thread「${title}」`;
        }
        case "promise": {
            const title = decision.anchorTargetId === null ? undefined : context.promiseTitleById.get(decision.anchorTargetId);
            return title === undefined ? null : `决策锚定本章 beats 涉及的 Promise 线「${title}」`;
        }
        case "story": {
            // story 级只按拍板期限临近触发:期限距本章 ≤3 章序位(含期限已到/已过——未决而期限已过更需要警告)。
            if (decision.deadlineChapterId === null) {
                return null;
            }
            const currentOrder = context.orderByChapterId.get(context.chapterIdText);
            const deadlineOrder = context.orderByChapterId.get(decision.deadlineChapterId);
            // 期限章已被删除(死引用,无外键保护)时无从计算章序,不触发。
            if (currentOrder === undefined || deadlineOrder === undefined || deadlineOrder - currentOrder > 3) {
                return null;
            }
            const deadlineLabel = decision.deadlineChapter === null ? "" : `「${decision.deadlineChapter.title}」`;
            return deadlineOrder <= currentOrder
                ? `story 级决策的拍板期限${deadlineLabel}已到而仍未拍板`
                : `story 级决策拍板期限临近：需在章${deadlineLabel}前拍板`;
        }
        default:
            return null;
    }
}

/**
 * 渲染可直接作为 writer message 草案的 markdown。
 */
function renderSuggestedBriefMarkdown(brief: Omit<ChapterWriterBriefDto, "suggestedBriefMarkdown">): string {
    const modeLabel = brief.mode === "curated" ? "Curated（受控投喂）" : "Autonomous（自主全知）";
    const lines: string[] = [
        `# Chapter Writer Brief — ${modeLabel}`,
        "",
        `Chapter: ${brief.chapter.title}(name: ${brief.chapter.name})`,
        `Status: ${brief.status}`,
        brief.mode === "curated"
            ? "> 受控模式:writer 读不到设定源,以下状态摘要即写作依据;leader 投喂前必须按「必须隐藏」删减。"
            : "> 自主模式:writer 自行用 execute_world 查证状态与读 lorebook;以下只给框架与查询提示,不含可查询状态。",
        "",
    ];

    appendChapterBriefSections(lines, brief.chapter.brief);

    if (brief.warnings.length > 0) {
        lines.push("## Warnings", ...brief.warnings.map((warning) => `- ${warning}`), "");
    }

    if (brief.scenes.length === 0) {
        lines.push("## 关键剧情点", "- 本章节尚未关联 Plot Scene。", "");
    } else {
        lines.push("## 关键剧情点（按 Scene）");
        for (const [index, scene] of brief.scenes.entries()) {
            lines.push(
                "",
                `### ${index + 1}. ${scene.title}`,
                `- Thread: ${scene.threadTitle}${scene.threadIsMain ? "（主线）" : ""}`,
                `- 本场做什么: ${scene.summary || "未填写"}`,
                `- 本场目的: ${scene.purpose ?? "未填写"}`,
            );
            if (scene.writingTip) {
                lines.push(`- 写作提示: ${scene.writingTip}`);
            }
            if (scene.threadSummary) {
                lines.push(`- 线索脉络: ${scene.threadSummary}`);
            }
            appendSceneWorld(lines, scene, brief.mode);
        }
        lines.push("");
    }

    appendPromiseTasks(lines, brief.promiseTasks);
    appendOpenDecisionWarnings(lines, brief.openDecisions);
    appendSuggestedReading(lines, brief.suggestedReading);
    return lines.join("\n").trimEnd();
}

/**
 * 渲染 ChapterBrief 章级指令段(目标/参数/信息控制/节奏/禁写)。空字段不渲染,信息控制全空时显式标注必填缺口。
 */
function appendChapterBriefSections(lines: string[], brief: ChapterBriefDto): void {
    const goalParts = [brief.goal, brief.ending ? `落点：${brief.ending}` : null].filter(Boolean);
    if (goalParts.length > 0) {
        lines.push("## 本章目标与落点", ...goalParts.map((part) => `- ${part}`), "");
    }

    const params = [
        brief.pov ? `视角：${brief.pov}` : null,
        brief.tone ? `语气：${brief.tone}` : null,
    ].filter(Boolean);
    if (params.length > 0) {
        lines.push("## 本章参数（覆盖 writer 默认）", ...params.map((part) => `- ${part}`), "");
    }

    lines.push("## 信息控制（必填）");
    const infoControl = [
        brief.readerKnows ? `读者已知：${brief.readerKnows}` : null,
        brief.protagonistKnows ? `主角已知：${brief.protagonistKnows}` : null,
        brief.mustHide ? `必须隐藏：${brief.mustHide}` : null,
        brief.hintOnly ? `可暗示但不可明说：${brief.hintOnly}` : null,
    ].filter(Boolean);
    if (infoControl.length > 0) {
        lines.push(...infoControl.map((part) => `- ${part}`));
    } else {
        lines.push("- ⚠ 未设置：writer 拥有上帝视角查询能力,缺信息控制会导致越界泄露。请在 ChapterBrief 补齐后再交接。");
    }
    lines.push("");

    const pacingParts = [
        brief.pacing ? `节奏：${brief.pacing}` : null,
        brief.opening ? `开场钩子：${brief.opening}` : null,
    ].filter(Boolean);
    if (pacingParts.length > 0) {
        lines.push("## 节奏 / 下一章牵引", ...pacingParts.map((part) => `- ${part}`), "");
    }

    if (brief.doNotWrite) {
        lines.push("## 禁写", `- ${brief.doNotWrite}`, "");
    }
}

/**
 * 按模式渲染单个 Scene 的世界连接:autonomous 给查询提示,curated 展开状态摘要。
 */
function appendSceneWorld(lines: string[], scene: ChapterWriterBriefSceneDto, mode: ChapterWriterBriefMode): void {
    const timeRange = formatRange(scene.worldAnchor.startTime ?? scene.worldAnchor.startInstant, scene.worldAnchor.endTime ?? scene.worldAnchor.endInstant);
    const subjectHint = formatSubjects(scene.worldAnchor.subjects);
    const location = scene.worldAnchor.locationSubject?.name ?? "未指定";

    if (mode === "autonomous") {
        lines.push(`- World 查询提示: 用 execute_world 查 subject [${subjectHint}]${location === "未指定" ? "" : `、地点 ${location}`} 在 ${timeRange} 的状态`);
        return;
    }

    // curated:展开状态摘要,writer 直接依赖。
    lines.push(`- 时间: ${timeRange}｜出场: ${subjectHint}｜地点: ${location}`);
    appendWorldContext(lines, scene.worldContext);
}

/**
 * 渲染简短 World Engine 上下文，避免输出 raw attrs 或 patch JSON。仅 curated 模式使用。
 */
function appendWorldContext(lines: string[], context: SceneWorldContextDto | null): void {
    if (!context) {
        lines.push("  - World context: 暂不可用");
        return;
    }

    if (context.slices.length === 0) {
        lines.push("  - World slices: 无匹配切面");
    } else {
        lines.push("  - World slices:");
        for (const slice of context.slices) {
            lines.push(`    - ${slice.time} ${slice.title}: ${slice.summary || "无摘要"}（相关 patches: ${slice.patchCount}）`);
        }
    }

    if (context.subjectStates.length === 0) {
        lines.push("  - Subject states: 无可展示终态");
    } else {
        lines.push(`  - Subject states: ${context.subjectStates.map((subject) => `${subject.name}(${subject.type})`).join(", ")}`);
    }
}

/**
 * beat kind → 任务行标签与指令措辞(D25,措辞参考 storyforge:埋设不解释/推进保悬念/反挫压回/兑现不复读)。
 */
const PROMISE_BEAT_DIRECTIVES: Record<StoryPromiseBeatKindDto, {label: string; instruction: string}> = {
    plant: {label: "建立", instruction: "自然埋下线索，不要提前解释答案。"},
    advance: {label: "推进", instruction: "侧面提及、制造回忆点，但保持悬念，不在本场展开解释。"},
    setback: {label: "反挫", instruction: "安排反挫或假揭露后压回：让读者以为要揭晓再落空，不得在本场真正兑现。"},
    payoff: {label: "兑现", instruction: "正面揭示并兑现此线，避免只重复此前的提示；写出揭示带来的情绪与后果。"},
};

/**
 * 渲染「本章 Promise 任务」段(D25):按章内 Scene 顺序分组输出 beats 指令行,
 * beat.note 与 payoffExpectation 全文输出(默认详细形态)。本章无任何任务时整段不出现。
 */
function appendPromiseTasks(lines: string[], tasks: ChapterWriterBriefPromiseTaskDto[]): void {
    if (tasks.length === 0) {
        return;
    }
    lines.push(
        "## 本章 Promise 任务",
        "> 以下是本章各场戏对读者债务线（Promise）的推进任务；把指令自然融入正文，不要照抄措辞。",
    );
    // tasks 生成时已按章内 Scene 顺序连续排列,按 sceneId 连续分组即可保序。
    for (const [index, task] of tasks.entries()) {
        if (index === 0 || tasks[index - 1]!.sceneId !== task.sceneId) {
            lines.push("", `### Scene「${task.sceneTitle}」`);
        }
        const directive = PROMISE_BEAT_DIRECTIVES[task.kind];
        lines.push(`- [${directive.label}] ${task.promiseTitle}（${task.promiseName}）：${directive.instruction}`);
        if (task.note) {
            lines.push(`  - 本次指示: ${task.note}`);
        }
        if (task.payoffExpectation) {
            lines.push(`  - 预期戏剧效果: ${task.payoffExpectation}`);
        }
    }
    lines.push("");
}

/**
 * 渲染「未决决策警告」段(D26):触及本章的 open Decision,不得擅自写死。无触及时整段不出现。
 */
function appendOpenDecisionWarnings(lines: string[], decisions: ChapterWriterBriefOpenDecisionDto[]): void {
    if (decisions.length === 0) {
        return;
    }
    lines.push(
        "## 未决决策警告",
        "> 以下问题尚未拍板（open Decision）：正文**不得擅自写死**任何候选答案；涉及处用模糊写法保留全部候选的可能性，需要定论时先联系 leader 拍板。",
    );
    for (const decision of decisions) {
        lines.push("", `### ${decision.title}（${decision.name}）`);
        lines.push(`- 待决问题: ${decision.question}`);
        const options = decision.options.map((item) => item.note ? `${item.option}（${item.note}）` : item.option);
        lines.push(`- 候选方案: ${options.length > 0 ? options.join(" / ") : "未列出"}`);
        lines.push(`- 触及原因: ${decision.reason}`);
    }
    lines.push("");
}

/**
 * 渲染建议读取清单。
 */
function appendSuggestedReading(lines: string[], reading: ChapterWriterBriefReadingDto[]): void {
    if (reading.length === 0) {
        return;
    }
    lines.push("## 建议读取");
    for (const item of reading) {
        const gloss = item.note ? `${item.relation} · ${item.note}` : item.relation;
        lines.push(`- ${item.path}（${gloss}）`);
    }
    lines.push("");
}

/**
 * 格式化时间范围。
 */
function formatRange(start: string | null, end: string | null): string {
    if (!start || !end) {
        return "未连接";
    }
    return `${start} ~ ${end}`;
}

/**
 * 格式化 Scene subjects。
 */
function formatSubjects(subjects: ChapterWriterBriefSceneDto["worldAnchor"]["subjects"]): string {
    if (subjects.length === 0) {
        return "未指定";
    }
    return subjects.map((subject) => subject.resolved ? subject.name : `${subject.id}（未解析）`).join(", ");
}

/**
 * 保留顺序去重字符串。
 */
function uniqueStrings(values: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) {
            continue;
        }
        seen.add(value);
        result.push(value);
    }
    return result;
}
