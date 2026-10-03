import type {ChapterRepository, DecisionRepository} from "nbook/server/plot/contracts/plot-repositories";
import {throwPlotBadRequest} from "nbook/server/plot/core/errors";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import type {
    ParsedCreateStoryDecisionInput,
    ParsedUpdateStoryDecisionInput,
    ResolvedStoryDecisionAnchor,
    StoryChapterRef,
    StoryDecisionEntity,
    StoryDecisionOption,
    StoryDecisionRefResolved,
    StoryDecisionRejectedAlternative,
    StoryDecisionResolved,
} from "nbook/server/plot/core/types";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {StoryService} from "nbook/server/plot/services/story.service";
import {parseEntityId} from "nbook/server/utils/novel-chapter";
import type {
    StoryDecisionAnchorInputDto,
    StoryDecisionDto,
} from "nbook/shared/dto/plot.dto";

/** 列表排序权重:open 优先(未决决策先看),再按 id 稳定。 */
const STATUS_ORDER = {open: 0, decided: 1, superseded: 2, dropped: 3} as const;

/** serves/dependsOn 支持的剧情对象 URI scheme(D12);content 相对路径不在此列。 */
const DECISION_REF_SCHEMES = ["promise", "decision", "thread", "scene"] as const;
type DecisionRefScheme = (typeof DECISION_REF_SCHEMES)[number];

/** serves/dependsOn 引用条目的解析结果。 */
type ParsedDecisionRef =
    | {kind: DecisionRefScheme; id: number}
    | {kind: "content"; path: string};

/** 引用存在性批查结果(按类别的存在 id 集合)。 */
type ExistingRefIds = {
    promiseIds: Set<number>;
    decisionIds: Set<number>;
    threadIds: Set<number>;
    sceneIds: Set<number>;
};

/**
 * Decision(ADR 式决策记录)用例服务。
 *
 * 生命周期模型(D11):open → decided / superseded / dropped。
 * - decide 转换 = update 置 status=decided:置 decision/motivation,risk 必填(缺失拒绝并给可读诊断);
 *   rejectedAlternatives 未显式提供时从 options 未选项生成骨架(whyRejected=null,理由由调用方补)。
 * - dropped = 问题因剧情改道失效:必须在 note 记录失效原因。
 * - superseded = 被新决策取代:必须提供 supersededById 链接。
 * - 状态不变式每次写入都对合并后的最终字段状态校验,HTTP 与 Agent 工具共用同一套约束,无绕过面。
 *
 * 引用与锚点(D12):
 * - serves/dependsOn 写入时校验格式(promise:// decision:// thread:// scene:// 或内容节点相对路径)
 *   与剧情对象 id 存在性(同 story);读取时死引用容错标注失效,不做级联清理。
 * - anchor 各外键写入过 plot-scope.guard 同 story 校验;读取时归一化:anchorKind 对应载体为 null
 *   (外键被 SetNull)时视同 story,不做写时回退。
 */
export class DecisionService {
    constructor(
        private readonly decisionRepository: DecisionRepository,
        private readonly chapterRepository: ChapterRepository,
        private readonly storyService: StoryService,
        private readonly scopeGuard: PlotScopeGuard,
        private readonly assembler: PlotDtoAssembler,
    ) {}

    /**
     * Decision 列表(open 优先,再按 id 稳定),含死引用标注与期限章摘要。
     */
    async listStoryDecisions(): Promise<StoryDecisionDto[]> {
        const story = await this.storyService.ensureStory();
        const decisions = await this.decisionRepository.findDecisionsByStory(story.id);
        // 引用存在性与期限章摘要都整批解析,避免逐条 N+1。
        const existing = await this.findExistingRefIdsFor(story.id, decisions);
        const chapters = new Map((await this.chapterRepository.findChaptersByStory(story.id)).map((chapter) => [chapter.id, chapter]));
        return decisions
            .map((decision) => this.assembler.toStoryDecisionDto(this.resolveDecision(decision, existing, (chapterId) => chapters.get(chapterId) ?? null)))
            .sort((left, right) => (
                STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
                || Number(left.id) - Number(right.id)
            ));
    }

    /**
     * Decision 详情(含死引用标注与期限章摘要)。
     */
    async getStoryDecisionDto(decisionId: number): Promise<StoryDecisionDto> {
        const story = await this.storyService.ensureStory();
        const decision = await this.scopeGuard.assertDecision(story.id, decisionId);
        const existing = await this.findExistingRefIdsFor(story.id, [decision]);
        const deadlineChapter = decision.deadlineChapterId === null
            ? null
            : await this.chapterRepository.findChapterById(decision.deadlineChapterId);
        return this.assembler.toStoryDecisionDto(this.resolveDecision(decision, existing, () => deadlineChapter));
    }

    /**
     * 创建 Decision(恒 open 态;decided 走 decide 转换,防止绕过 risk 必填)。
     */
    async createStoryDecision(input: ParsedCreateStoryDecisionInput): Promise<StoryDecisionDto> {
        const story = await this.storyService.ensureStory();
        await this.scopeGuard.assertDecisionNameUnique(story.id, input.name);
        if (input.deadlineChapterId !== null) {
            await this.scopeGuard.assertChapter(story.id, input.deadlineChapterId);
        }
        const anchor = await this.resolveAnchor(story.id, input.anchor ?? {kind: "story"});
        await this.assertRefTargets(story.id, [
            {field: "serves", targets: input.serves ?? []},
            {field: "dependsOn", targets: input.dependsOn ?? []},
        ]);
        const decision = await this.decisionRepository.createDecision({
            storyId: story.id,
            name: input.name,
            title: input.title,
            question: input.question,
            options: normalizeOptions(input.options ?? []),
            deadlineChapterId: input.deadlineChapterId,
            serves: input.serves ?? [],
            dependsOn: input.dependsOn ?? [],
            note: input.note ?? null,
            ...anchor,
        });
        return this.getStoryDecisionDto(decision.id);
    }

    /**
     * 更新 Decision。status 直改承载 decide/drop/supersede/reopen;
     * 状态不变式对合并后的最终字段状态校验,decide 转换在此统一发生。
     */
    async updateStoryDecision(
        decisionId: number,
        patch: ParsedUpdateStoryDecisionInput,
    ): Promise<StoryDecisionDto> {
        const story = await this.storyService.ensureStory();
        const decision = await this.scopeGuard.assertDecision(story.id, decisionId);
        const {chosenOption, anchor, ...fields} = patch;

        if (fields.name !== undefined && fields.name !== decision.name) {
            await this.scopeGuard.assertDecisionNameUnique(story.id, fields.name, decision.id);
        }
        if (fields.deadlineChapterId !== undefined && fields.deadlineChapterId !== null) {
            await this.scopeGuard.assertChapter(story.id, fields.deadlineChapterId);
        }
        if (fields.supersededById !== undefined && fields.supersededById !== null) {
            if (fields.supersededById === decision.id) {
                throwPlotBadRequest("supersededById 不能指向自身;superseded 表示被另一条新决策取代");
            }
            await this.scopeGuard.assertDecision(story.id, fields.supersededById);
        }
        const resolvedAnchor = anchor === undefined ? undefined : await this.resolveAnchor(story.id, anchor);
        await this.assertRefTargets(story.id, [
            {field: "serves", targets: fields.serves ?? []},
            {field: "dependsOn", targets: fields.dependsOn ?? []},
        ]);

        // 合并出写入后的最终字段状态(undefined=沿用现值),不变式与 decide 转换都基于它判定。
        const final = {
            status: fields.status ?? decision.status,
            options: fields.options === undefined ? decision.options : normalizeOptions(fields.options),
            decision: fields.decision === undefined ? decision.decision : fields.decision,
            motivation: fields.motivation === undefined ? decision.motivation : fields.motivation,
            risk: fields.risk === undefined ? decision.risk : fields.risk,
            note: fields.note === undefined ? decision.note : fields.note,
            supersededById: fields.supersededById === undefined ? decision.supersededById : fields.supersededById,
        };

        // decide 转换(D11):仅在 open/superseded/dropped → decided 的转换时刻生成否决骨架;
        // 已 decided 再 update 不重新转换,避免覆盖调用方已补全的 whyRejected。
        const isDecideTransition = final.status === "decided" && decision.status !== "decided";
        if (chosenOption !== undefined && !isDecideTransition) {
            throwPlotBadRequest("chosenOption 仅在拍板转换(status 变为 decided)时有效;补改否决理由请直接更新 rejectedAlternatives");
        }
        // 两个参数职责互斥:chosenOption 驱动骨架自动生成,显式 rejectedAlternatives 是整体替换;
        // 同时提供时 chosenOption 会被整体替换完全覆盖,静默吞掉与"可读诊断"风格不符,显式拒绝。
        if (isDecideTransition && chosenOption !== undefined && fields.rejectedAlternatives !== undefined) {
            throwPlotBadRequest("chosenOption 与 rejectedAlternatives 不可同时提供:前者用于拍板时从 options 未选项自动生成否决骨架,后者是对否决清单的整体替换;请二选一");
        }
        let rejectedAlternatives = fields.rejectedAlternatives === undefined ? undefined : normalizeRejected(fields.rejectedAlternatives);
        if (isDecideTransition && rejectedAlternatives === undefined) {
            if (chosenOption !== undefined && !final.options.some((item) => item.option === chosenOption)) {
                throwPlotBadRequest(`chosenOption 未命中 options:${chosenOption};候选是 ${final.options.map((item) => item.option).join(" / ") || "(空)"}`);
            }
            rejectedAlternatives = final.options
                .filter((item) => item.option !== chosenOption)
                .map((item) => ({option: item.option, whyRejected: null}));
        }

        this.assertStatusInvariants(final);

        await this.decisionRepository.updateDecision(decision.id, {
            name: fields.name,
            title: fields.title,
            status: fields.status,
            question: fields.question,
            options: fields.options === undefined ? undefined : normalizeOptions(fields.options),
            deadlineChapterId: fields.deadlineChapterId,
            decision: fields.decision,
            motivation: fields.motivation,
            rejectedAlternatives,
            risk: fields.risk,
            serves: fields.serves,
            dependsOn: fields.dependsOn,
            supersededById: fields.supersededById,
            note: fields.note,
            ...(resolvedAnchor ?? {}),
        });
        return this.getStoryDecisionDto(decision.id);
    }

    /**
     * 物理删除 Decision。不开放给 Agent,留给 UI/人(Task 97 D4;Agent 软删出口是 action=drop)。
     */
    async deleteStoryDecision(decisionId: number): Promise<void> {
        const story = await this.storyService.ensureStory();
        const decision = await this.scopeGuard.assertDecision(story.id, decisionId);
        await this.decisionRepository.deleteDecision(decision.id);
    }

    /**
     * 状态不变式(D11,对合并后的最终字段状态):
     * decided 需要 decision/motivation/risk 非空,dropped 需要 note(失效原因)非空,superseded 需要 supersededById。
     */
    private assertStatusInvariants(final: {
        status: StoryDecisionEntity["status"];
        decision: string | null;
        motivation: string | null;
        risk: string | null;
        note: string | null;
        supersededById: number | null;
    }): void {
        if (final.status === "decided") {
            if (!final.decision?.trim()) {
                throwPlotBadRequest("拍板失败:status=decided 需要 decision(结论)非空");
            }
            if (!final.motivation?.trim()) {
                throwPlotBadRequest("拍板失败:status=decided 需要 motivation(理由)非空;理由链是下一个 Agent 接手的依据");
            }
            if (!final.risk?.trim()) {
                throwPlotBadRequest("拍板失败:status=decided 需要 risk(刹车点)非空——没有 risk 的决策只告诉 writer 往哪走、没告诉哪停;请写明执行本决策时需要控制的风险");
            }
        }
        if (final.status === "dropped" && !final.note?.trim()) {
            throwPlotBadRequest("置为 dropped 失败:需要在 note 写明问题失效的原因(如子情节删除导致问题不复存在)");
        }
        if (final.status === "superseded" && final.supersededById === null) {
            throwPlotBadRequest("置为 superseded 失败:需要 supersededById 指向取代本决策的新 Decision");
        }
    }

    /**
     * 解析主锚点(D12):kind 决定载体必填性;各外键过 plot-scope.guard 同 story 校验。
     */
    private async resolveAnchor(storyId: number, anchor: StoryDecisionAnchorInputDto): Promise<ResolvedStoryDecisionAnchor> {
        const empty = {
            anchorActId: null,
            anchorChapterId: null,
            anchorThreadId: null,
            anchorSceneId: null,
            anchorPromiseId: null,
            anchorPath: null,
        };
        if (anchor.kind === "story" || anchor.kind === "content") {
            if (anchor.id !== undefined) {
                throwPlotBadRequest(`anchor.kind=${anchor.kind} 不接受 anchor.id;实体锚请改用 act/chapter/thread/scene/promise`);
            }
            if (anchor.kind === "story") {
                if (anchor.path !== undefined) {
                    throwPlotBadRequest("anchor.kind=story 不接受 anchor.path;内容节点锚请改用 kind=content");
                }
                return {anchorKind: "story", ...empty};
            }
            if (anchor.path === undefined) {
                throwPlotBadRequest("anchor.kind=content 需要 anchor.path(Project Workspace 相对内容节点路径,如 lorebook/character/chen-yao/)");
            }
            // 主锚点与 serves/dependsOn 的 content 路径共用同一套卫生规则(D12):
            // 拒绝绝对路径、盘符、反斜杠、目录穿越与 URI 形态,只收 Project Workspace 相对路径。
            const parsedPath = parseDecisionRefTarget(anchor.path);
            if (!parsedPath || parsedPath.kind !== "content") {
                throwPlotBadRequest(`anchor.path 格式非法:${anchor.path};需要 Project Workspace 相对内容节点路径(如 lorebook/character/chen-yao/),不接受绝对路径、盘符、反斜杠、目录穿越或 promise:// 等 URI(实体锚请改用对应 anchor.kind)`);
            }
            return {anchorKind: "content", ...empty, anchorPath: parsedPath.path};
        }
        if (anchor.path !== undefined) {
            throwPlotBadRequest(`anchor.kind=${anchor.kind} 不接受 anchor.path;内容节点锚请改用 kind=content`);
        }
        if (anchor.id === undefined) {
            throwPlotBadRequest(`anchor.kind=${anchor.kind} 需要 anchor.id(对应实体 ID)`);
        }
        switch (anchor.kind) {
            case "act": {
                const act = await this.scopeGuard.assertAct(storyId, parseEntityId("actId", anchor.id));
                return {anchorKind: "act", ...empty, anchorActId: act.id};
            }
            case "chapter": {
                const chapter = await this.scopeGuard.assertChapter(storyId, parseEntityId("chapterId", anchor.id));
                return {anchorKind: "chapter", ...empty, anchorChapterId: chapter.id};
            }
            case "thread": {
                const thread = await this.scopeGuard.assertThread(storyId, parseEntityId("threadId", anchor.id));
                return {anchorKind: "thread", ...empty, anchorThreadId: thread.id};
            }
            case "scene": {
                const scene = await this.scopeGuard.assertScene(storyId, parseEntityId("sceneId", anchor.id));
                return {anchorKind: "scene", ...empty, anchorSceneId: scene.id};
            }
            case "promise": {
                const promise = await this.scopeGuard.assertPromise(storyId, parseEntityId("promiseId", anchor.id));
                return {anchorKind: "promise", ...empty, anchorPromiseId: promise.id};
            }
        }
    }

    /**
     * serves/dependsOn 写入校验(D12):先一次性报出全部格式非法条目,再批查存在性一次性报出全部死引用。
     */
    private async assertRefTargets(storyId: number, groups: Array<{field: "serves" | "dependsOn"; targets: string[]}>): Promise<void> {
        const malformed: string[] = [];
        const parsedEntries: Array<{field: string; target: string; parsed: ParsedDecisionRef}> = [];
        for (const group of groups) {
            for (const target of group.targets) {
                const parsed = parseDecisionRefTarget(target);
                if (!parsed) {
                    malformed.push(`${group.field}: ${target}`);
                    continue;
                }
                parsedEntries.push({field: group.field, target, parsed});
            }
        }
        if (malformed.length > 0) {
            throwPlotBadRequest(`引用格式非法:${malformed.join("、")};合法形态是 promise://{id} / decision://{id} / thread://{id} / scene://{id} 或内容节点相对路径(如 lorebook/character/chen-yao/)`);
        }
        const parsedRefs = parsedEntries.map((entry) => entry.parsed);
        const existing = await this.decisionRepository.findExistingRefIds(storyId, {
            promiseIds: collectRefIds(parsedRefs, "promise"),
            decisionIds: collectRefIds(parsedRefs, "decision"),
            threadIds: collectRefIds(parsedRefs, "thread"),
            sceneIds: collectRefIds(parsedRefs, "scene"),
        });
        const missing = parsedEntries
            .filter((entry) => entry.parsed.kind !== "content" && !refIdSet(existing, entry.parsed.kind).has(entry.parsed.id))
            .map((entry) => `${entry.field}: ${entry.target}`);
        if (missing.length > 0) {
            throwPlotBadRequest(`引用了当前 Story 下不存在的对象:${missing.join("、")}`);
        }
    }

    /**
     * 收集一批实体的 serves/dependsOn 引用并批查存在性(读取死引用标注用,一次往返)。
     */
    private async findExistingRefIdsFor(storyId: number, decisions: StoryDecisionEntity[]): Promise<ExistingRefIds> {
        const parsed = decisions
            .flatMap((decision) => [...decision.serves, ...decision.dependsOn])
            .map((target) => parseDecisionRefTarget(target))
            .filter((item): item is ParsedDecisionRef => item !== null);
        return this.decisionRepository.findExistingRefIds(storyId, {
            promiseIds: collectRefIds(parsed, "promise"),
            decisionIds: collectRefIds(parsed, "decision"),
            threadIds: collectRefIds(parsed, "thread"),
            sceneIds: collectRefIds(parsed, "scene"),
        });
    }

    /**
     * 组装读取聚合:serves/dependsOn 死引用标注 + 期限章摘要(死引用容错,查不到只置空不抛错)。
     */
    private resolveDecision(
        decision: StoryDecisionEntity,
        existing: ExistingRefIds,
        chapterById: (chapterId: number) => {id: number; storyId: number; name: string; title: string} | null,
    ): StoryDecisionResolved {
        let deadlineChapter: StoryChapterRef | null = null;
        if (decision.deadlineChapterId !== null) {
            const chapter = chapterById(decision.deadlineChapterId);
            // 期限章无外键保护(建表决策):章被删后 id 悬空,读取容错为 null,id 保留供死引用判定。
            deadlineChapter = chapter && chapter.storyId === decision.storyId
                ? {id: chapter.id, name: chapter.name, title: chapter.title}
                : null;
        }
        return {
            ...decision,
            deadlineChapter,
            serves: decision.serves.map((target) => resolveRefEntry(target, existing)),
            dependsOn: decision.dependsOn.map((target) => resolveRefEntry(target, existing)),
        };
    }
}

/**
 * 解析 serves/dependsOn 引用条目(D12 格式规范)。
 * 合法形态:promise://{id} / decision://{id} / thread://{id} / scene://{id}(id 为正整数),
 * 或 Project Workspace 相对内容节点路径(拒绝绝对路径、盘符、反斜杠与目录穿越);其余返回 null。
 */
function parseDecisionRefTarget(target: string): ParsedDecisionRef | null {
    const trimmed = target.trim();
    if (!trimmed) {
        return null;
    }
    const matched = trimmed.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/i);
    if (matched) {
        const scheme = (matched[1] ?? "").toLowerCase();
        const idText = (matched[2] ?? "").trim();
        if (!(DECISION_REF_SCHEMES as readonly string[]).includes(scheme) || !/^[1-9]\d*$/.test(idText)) {
            return null;
        }
        return {kind: scheme as DecisionRefScheme, id: Number.parseInt(idText, 10)};
    }
    if (trimmed.startsWith("/") || trimmed.includes("\\") || trimmed.includes("..") || /^[a-z]:/i.test(trimmed)) {
        return null;
    }
    return {kind: "content", path: trimmed};
}

/**
 * 读取视图的单条引用解析(D12 死引用容错):
 * 剧情对象 id 不在存在集合 → valid=false;content 路径不校验存在性恒 true;
 * 历史脏数据(格式非法)也标 false,提示引用已失效。
 */
function resolveRefEntry(target: string, existing: ExistingRefIds): StoryDecisionRefResolved {
    const parsed = parseDecisionRefTarget(target);
    if (!parsed) {
        return {target, valid: false};
    }
    if (parsed.kind === "content") {
        return {target, valid: true};
    }
    return {target, valid: refIdSet(existing, parsed.kind).has(parsed.id)};
}

/**
 * 按引用 scheme 取对应的存在 id 集合。
 */
function refIdSet(existing: ExistingRefIds, kind: DecisionRefScheme): Set<number> {
    switch (kind) {
        case "promise": return existing.promiseIds;
        case "decision": return existing.decisionIds;
        case "thread": return existing.threadIds;
        case "scene": return existing.sceneIds;
    }
}

/**
 * 从解析结果中收集某一 scheme 的去重 id 列表。
 */
function collectRefIds(parsed: ParsedDecisionRef[], kind: DecisionRefScheme): number[] {
    return [...new Set(parsed.filter((item): item is {kind: DecisionRefScheme; id: number} => item.kind === kind).map((item) => item.id))];
}

/**
 * 归一化 options 输入(note 缺省补 null,条目去掉首尾空白)。
 * 候选文本必须唯一(trim 后比较):decide 转换按 chosenOption 文本识别被选项,
 * 重复文本会让否决骨架把同名候选一并排除、否决记录缺失;create/update 共用此唯一入口,所有调用面在此被约束。
 */
function normalizeOptions(options: Array<{option: string; note?: string | null}>): StoryDecisionOption[] {
    const normalized = options.map((item) => ({option: item.option.trim(), note: item.note ?? null}));
    const seen = new Set<string>();
    for (const item of normalized) {
        if (seen.has(item.option)) {
            throwPlotBadRequest(`options 候选文本重复:「${item.option}」;拍板(chosenOption)按候选文本识别被选项,候选必须唯一`);
        }
        seen.add(item.option);
    }
    return normalized;
}

/**
 * 归一化 rejectedAlternatives 输入(whyRejected 缺省补 null)。
 */
function normalizeRejected(rejected: Array<{option: string; whyRejected?: string | null}>): StoryDecisionRejectedAlternative[] {
    return rejected.map((item) => ({option: item.option.trim(), whyRejected: item.whyRejected ?? null}));
}
