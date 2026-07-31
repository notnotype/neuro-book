import {createHash, randomUUID} from "node:crypto";
import {appendFile, mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {z} from "zod";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {readRpTurn} from "nbook/server/rp/turn-store";

export const RP_PIPELINE_ROOT = ".nbook/rp/runtime/pipelines";
export const RP_PIPELINE_LEDGER_PATH = ".nbook/rp/runtime/pipeline-ledger.jsonl";

export const RP_PIPELINE_STAGES = [
    "action_understanding",
    "world_snapshot",
    "condition_check",
    "screenwriter_plan",
    "actor_proposals",
    "conflict_resolution",
    "adjudication",
    "narrative",
    "world_commit",
    "ui_update",
] as const;

export type RpPipelineStage = typeof RP_PIPELINE_STAGES[number];
export type RpPipelineFailureKind = "screenwriter" | "major_actor" | "extras" | "world" | "writer";

export type RpTurnSnapshot = {
    id: string;
    turnId: string;
    worldInstant: string;
    stateHash: string;
    publicSummary: string;
    state: JsonValue;
    createdAt: string;
};

export type RpScreenwriterPlan = {
    snapshotId: string;
    expectedActorIds: string[];
    extrasRequired: boolean;
    lightweight: boolean;
    requiresPlayerRoll: boolean;
    summary: string;
    createdAt: string;
};

export type RpActorProposal = {
    actorId: string;
    snapshotId: string;
    visibleResponse: string;
    spokenWords: string;
    innerResponse: string;
    createdAt: string;
};

export type RpExtrasProposal = {
    snapshotId: string;
    summary: string;
    createdAt: string;
};

export type RpProposalConflict = {
    id: string;
    kind: "character_intent" | "world_fact" | "resource" | "timing";
    description: string;
    sources: string[];
};

export type RpConflictResolution = {
    conflictId: string;
    chosenSource: string;
    reason: string;
};

export type RpWorldResolution = {
    snapshotId: string;
    conflicts: RpProposalConflict[];
    resolutions: RpConflictResolution[];
    mergedSummary: string;
    createdAt: string;
};

export type RpPipelineFailure = {
    id: string;
    stage: RpPipelineStage;
    kind: RpPipelineFailureKind;
    agent: string;
    actorId: string | null;
    message: string;
    blocking: boolean;
    resolved: boolean;
    recoveryOptions: string[];
    createdAt: string;
    resolvedAt: string | null;
};

export type RpPipelineState = {
    schemaVersion: 1;
    turnId: string;
    stage: RpPipelineStage;
    snapshot: RpTurnSnapshot | null;
    plan: RpScreenwriterPlan | null;
    actorProposals: RpActorProposal[];
    extrasProposal: RpExtrasProposal | null;
    worldResolution: RpWorldResolution | null;
    adjudication: {snapshotId: string; summary: string; settlementDraft: JsonValue; createdAt: string} | null;
    narrative: {prosePath: string; summary: string; createdAt: string} | null;
    failures: RpPipelineFailure[];
    stageHistory: Array<{stage: RpPipelineStage; publicSummary: string; at: string}>;
    completedAt: string | null;
    updatedAt: string;
};

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));
const SnapshotSchema: z.ZodType<RpTurnSnapshot> = z.object({
    id: z.string(), turnId: z.string(), worldInstant: z.string(), stateHash: z.string(), publicSummary: z.string(), state: JsonValueSchema, createdAt: z.string(),
});
const PlanSchema: z.ZodType<RpScreenwriterPlan> = z.object({
    snapshotId: z.string(), expectedActorIds: z.array(z.string()), extrasRequired: z.boolean(), lightweight: z.boolean(), requiresPlayerRoll: z.boolean(), summary: z.string(), createdAt: z.string(),
});
const ActorProposalSchema: z.ZodType<RpActorProposal> = z.object({
    actorId: z.string(), snapshotId: z.string(), visibleResponse: z.string(), spokenWords: z.string(), innerResponse: z.string(), createdAt: z.string(),
});
const ExtrasProposalSchema: z.ZodType<RpExtrasProposal> = z.object({snapshotId: z.string(), summary: z.string(), createdAt: z.string()});
const ConflictSchema: z.ZodType<RpProposalConflict> = z.object({id: z.string(), kind: z.enum(["character_intent", "world_fact", "resource", "timing"]), description: z.string(), sources: z.array(z.string())});
const ResolutionSchema: z.ZodType<RpConflictResolution> = z.object({conflictId: z.string(), chosenSource: z.string(), reason: z.string()});
const WorldResolutionSchema: z.ZodType<RpWorldResolution> = z.object({
    snapshotId: z.string(), conflicts: z.array(ConflictSchema), resolutions: z.array(ResolutionSchema), mergedSummary: z.string(), createdAt: z.string(),
});
const FailureSchema: z.ZodType<RpPipelineFailure> = z.object({
    id: z.string(), stage: z.enum(RP_PIPELINE_STAGES), kind: z.enum(["screenwriter", "major_actor", "extras", "world", "writer"]), agent: z.string(), actorId: z.string().nullable(),
    message: z.string(), blocking: z.boolean(), resolved: z.boolean(), recoveryOptions: z.array(z.string()), createdAt: z.string(), resolvedAt: z.string().nullable(),
});
const StateSchema: z.ZodType<RpPipelineState> = z.object({
    schemaVersion: z.literal(1), turnId: z.string(), stage: z.enum(RP_PIPELINE_STAGES), snapshot: SnapshotSchema.nullable(), plan: PlanSchema.nullable(), actorProposals: z.array(ActorProposalSchema),
    extrasProposal: ExtrasProposalSchema.nullable(), worldResolution: WorldResolutionSchema.nullable(),
    adjudication: z.object({snapshotId: z.string(), summary: z.string(), settlementDraft: JsonValueSchema, createdAt: z.string()}).nullable(),
    narrative: z.object({prosePath: z.string(), summary: z.string(), createdAt: z.string()}).nullable(), failures: z.array(FailureSchema),
    stageHistory: z.array(z.object({stage: z.enum(RP_PIPELINE_STAGES), publicSummary: z.string(), at: z.string()})), completedAt: z.string().nullable(), updatedAt: z.string(),
});

const locks = new Map<string, Promise<void>>();

/** startRpTurn 后建立代码可见的 P6 阶段状态。重复初始化返回同一状态。 */
export async function ensureRpPipeline(projectRoot: string, turnId: string): Promise<RpPipelineState> {
    const path = pipelinePath(projectRoot, turnId);
    return withLock(path, async () => {
        const existing = await readOptional(path);
        if (existing) return existing;
        const turn = await readRpTurn(projectRoot, turnId);
        const now = new Date().toISOString();
        const state: RpPipelineState = {
            schemaVersion: 1,
            turnId,
            stage: "action_understanding",
            snapshot: null,
            plan: null,
            actorProposals: [],
            extrasProposal: null,
            worldResolution: null,
            adjudication: null,
            narrative: null,
            failures: [],
            stageHistory: [{stage: "action_understanding", publicSummary: turn.inputSummary, at: now}],
            completedAt: null,
            updatedAt: now,
        };
        await writeAtomic(path, state);
        await appendLedger(projectRoot, {operation: "initialize", turnId, stage: state.stage, at: now});
        return state;
    });
}

/** 读取单回合阶段状态。 */
export async function readRpPipeline(projectRoot: string, turnId: string): Promise<RpPipelineState> {
    const state = await readOptional(pipelinePath(projectRoot, turnId));
    if (!state) throw new Error(`回合 ${turnId} 尚未初始化 P6 pipeline。`);
    return state;
}

/** leader 只能按固定邻接顺序推进；每个阶段的服务端产物是硬前置条件。 */
export async function advanceRpPipeline(projectRoot: string, turnId: string, target: RpPipelineStage, publicSummary: string): Promise<RpPipelineState> {
    return mutate(projectRoot, turnId, "advance", (state, now) => {
        const currentIndex = RP_PIPELINE_STAGES.indexOf(state.stage);
        const targetIndex = RP_PIPELINE_STAGES.indexOf(target);
        if (targetIndex === currentIndex) return {value: state, detail: {stage: target, duplicate: true}};
        if (targetIndex !== currentIndex + 1) throw new Error(`回合阶段只能相邻推进：当前 ${state.stage}，目标 ${target}。`);
        assertStageReady(state);
        if (state.failures.some((failure) => failure.blocking && !failure.resolved)) throw new Error("当前阶段存在未恢复的阻塞失败，不能继续推进。");
        state.stage = target;
        state.stageHistory.push({stage: target, publicSummary: requireText(publicSummary, "阶段公开摘要"), at: now});
        return {value: state, detail: {stage: target, publicSummary}};
    });
}

/** world 捕获一次回合开始状态；所有后续提案必须绑定返回的 snapshotId。 */
export async function captureRpTurnSnapshot(projectRoot: string, turnId: string, input: {
    worldInstant: string;
    publicSummary: string;
    state: JsonValue;
}): Promise<RpTurnSnapshot> {
    return mutate(projectRoot, turnId, "capture_snapshot", (pipeline, now) => {
        requireStage(pipeline, "world_snapshot");
        if (pipeline.snapshot) return {value: pipeline.snapshot, detail: {snapshotId: pipeline.snapshot.id, duplicate: true}};
        const serialized = JSON.stringify(input.state);
        const snapshot: RpTurnSnapshot = {
            id: `snapshot-${createHash("sha256").update(`${turnId}\0${input.worldInstant}\0${serialized}`).digest("hex").slice(0, 20)}`,
            turnId,
            worldInstant: requireText(input.worldInstant, "World Instant"),
            stateHash: createHash("sha256").update(serialized).digest("hex"),
            publicSummary: requireText(input.publicSummary, "世界快照摘要"),
            state: input.state,
            createdAt: now,
        };
        pipeline.snapshot = snapshot;
        return {value: snapshot, detail: {snapshotId: snapshot.id, worldInstant: snapshot.worldInstant, stateHash: snapshot.stateHash}};
    });
}

/** screenwriter 提交出场规划；expectedActorIds 决定主要角色 actor 完整性门禁。 */
export async function submitRpScreenwriterPlan(projectRoot: string, turnId: string, input: Omit<RpScreenwriterPlan, "createdAt">): Promise<RpScreenwriterPlan> {
    return mutate(projectRoot, turnId, "submit_plan", (state, now) => {
        requireStage(state, "screenwriter_plan");
        requireSnapshot(state, input.snapshotId);
        const expectedActorIds = normalizeIds(input.expectedActorIds);
        const plan: RpScreenwriterPlan = {...input, snapshotId: input.snapshotId, expectedActorIds, summary: requireText(input.summary, "编排摘要"), createdAt: now};
        if (state.plan) {
            if (JSON.stringify({...state.plan, createdAt: ""}) === JSON.stringify({...plan, createdAt: ""})) return {value: state.plan, detail: {duplicate: true}};
            throw new Error("screenwriter plan 已提交；修改玩家行动应取消旧回合并新建回合。");
        }
        state.plan = plan;
        return {value: plan, detail: {snapshotId: plan.snapshotId, expectedActorIds, extrasRequired: plan.extrasRequired, lightweight: plan.lightweight}};
    });
}

/** cast 汇总主要角色提案；每个角色必须来自同一 snapshot，缺一不可。 */
export async function submitRpActorProposals(projectRoot: string, turnId: string, snapshotId: string, proposals: Array<Omit<RpActorProposal, "snapshotId" | "createdAt">>): Promise<RpActorProposal[]> {
    return mutate(projectRoot, turnId, "submit_actor_proposals", (state, now) => {
        requireStage(state, "actor_proposals");
        const plan = requirePlan(state, snapshotId);
        const actorIds = normalizeIds(proposals.map((proposal) => proposal.actorId));
        if (actorIds.some((actorId) => !plan.expectedActorIds.includes(actorId))) throw new Error("actor 提案包含 screenwriter plan 未声明的主要角色。");
        const saved = proposals.map((proposal) => {
            const existing = state.actorProposals.find((item) => item.actorId === proposal.actorId);
            if (existing) return existing;
            const value: RpActorProposal = {
                actorId: proposal.actorId,
                snapshotId,
                visibleResponse: requireText(proposal.visibleResponse, "可见反应"),
                spokenWords: proposal.spokenWords.trim(),
                innerResponse: requireText(proposal.innerResponse, "内心反应"),
                createdAt: now,
            };
            state.actorProposals.push(value);
            resolveActorFailure(state, proposal.actorId, now);
            return value;
        });
        return {value: saved, detail: {snapshotId, actorIds: saved.map((item) => item.actorId)}};
    });
}

/** extras 只批量提交普通 NPC 反应；失败后可重建新 extras session 再提交。 */
export async function submitRpExtrasProposal(projectRoot: string, turnId: string, snapshotId: string, summary: string): Promise<RpExtrasProposal> {
    return mutate(projectRoot, turnId, "submit_extras", (state, now) => {
        requireStage(state, "actor_proposals");
        const plan = requirePlan(state, snapshotId);
        if (!plan.extrasRequired) throw new Error("本回合 plan 未要求 extras 提案。");
        if (state.extrasProposal) return {value: state.extrasProposal, detail: {duplicate: true}};
        const proposal = {snapshotId, summary: requireText(summary, "群演提案摘要"), createdAt: now};
        state.extrasProposal = proposal;
        for (const failure of state.failures.filter((item) => item.kind === "extras" && !item.resolved)) {
            failure.resolved = true;
            failure.resolvedAt = now;
        }
        return {value: proposal, detail: {snapshotId}};
    });
}

/** world 统一解决同快照提案冲突；角色意图冲突不能让 screenwriter 压过成功返回的 actor。 */
export async function resolveRpProposalConflicts(projectRoot: string, turnId: string, input: {
    snapshotId: string;
    conflicts: RpProposalConflict[];
    resolutions: RpConflictResolution[];
    mergedSummary: string;
}): Promise<RpWorldResolution> {
    return mutate(projectRoot, turnId, "resolve_conflicts", (state, now) => {
        requireStage(state, "conflict_resolution");
        requirePlan(state, input.snapshotId);
        if (state.worldResolution) return {value: state.worldResolution, detail: {duplicate: true}};
        const conflictIds = new Set(input.conflicts.map((conflict) => safeId(conflict.id, "冲突 id")));
        if (conflictIds.size !== input.conflicts.length) throw new Error("冲突 id 不能重复。");
        if (input.resolutions.length !== input.conflicts.length) throw new Error("world 必须逐项解决全部提案冲突。");
        for (const conflict of input.conflicts) {
            const resolution = input.resolutions.find((item) => item.conflictId === conflict.id);
            if (!resolution) throw new Error(`冲突 ${conflict.id} 缺少解决方案。`);
            if (!conflict.sources.includes(resolution.chosenSource)) throw new Error(`冲突 ${conflict.id} 的 chosenSource 不在候选来源中。`);
            if (conflict.kind === "character_intent" && conflict.sources.some((source) => source.startsWith("actor:")) && resolution.chosenSource === "screenwriter") {
                throw new Error("角色意图冲突必须以 actor 人设与已建立状态为先，screenwriter 计划不能覆盖 actor。 ");
            }
            requireText(resolution.reason, "冲突解决原因");
        }
        const resolution: RpWorldResolution = {
            snapshotId: input.snapshotId,
            conflicts: input.conflicts,
            resolutions: input.resolutions,
            mergedSummary: requireText(input.mergedSummary, "world 合并摘要"),
            createdAt: now,
        };
        state.worldResolution = resolution;
        return {value: resolution, detail: {snapshotId: input.snapshotId, conflictCount: input.conflicts.length}};
    });
}

/** screenwriter 在 world 冲突收口后提交终裁草案。 */
export async function submitRpAdjudication(projectRoot: string, turnId: string, snapshotId: string, summary: string, settlementDraft: JsonValue): Promise<RpPipelineState["adjudication"]> {
    return mutate(projectRoot, turnId, "submit_adjudication", (state, now) => {
        requireStage(state, "adjudication");
        requireSnapshot(state, snapshotId);
        if (!state.worldResolution) throw new Error("world 尚未解决同快照提案冲突，不能终裁。");
        if (state.adjudication) return {value: state.adjudication, detail: {duplicate: true}};
        state.adjudication = {snapshotId, summary: requireText(summary, "终裁摘要"), settlementDraft, createdAt: now};
        return {value: state.adjudication, detail: {snapshotId}};
    });
}

/** leader 在 writer 产出后登记叙事 artifact；未登记不能 begin_commit。 */
export async function registerRpNarrative(projectRoot: string, turnId: string, prosePath: string, summary: string): Promise<RpPipelineState["narrative"]> {
    if (!/^rp\/ticks\/\d{6}(?:-[\w-]+)?\/prose\.md$/u.test(prosePath)) throw new Error(`非法 RP prosePath：${prosePath}`);
    return mutate(projectRoot, turnId, "register_narrative", (state, now) => {
        requireStage(state, "narrative");
        if (!state.adjudication) throw new Error("尚无 screenwriter 终裁，不能登记叙事。");
        if (state.narrative) return {value: state.narrative, detail: {duplicate: true}};
        state.narrative = {prosePath, summary: requireText(summary, "叙事摘要"), createdAt: now};
        return {value: state.narrative, detail: {prosePath}};
    });
}

/** 任一 Agent 失败都写可恢复问题；主要 actor 失败永远阻塞，不能由 leader/extras 代演。 */
export async function reportRpPipelineFailure(projectRoot: string, turnId: string, input: {
    kind: RpPipelineFailureKind;
    agent: string;
    actorId?: string | null;
    message: string;
}): Promise<RpPipelineFailure> {
    return mutate(projectRoot, turnId, "report_failure", (state, now) => {
        if (input.kind === "major_actor" && !input.actorId?.trim()) throw new Error("major_actor 失败必须标明 actorId。");
        const failure: RpPipelineFailure = {
            id: `pipeline-failure-${randomUUID()}`,
            stage: state.stage,
            kind: input.kind,
            agent: requireText(input.agent, "失败 Agent"),
            actorId: input.actorId?.trim() || null,
            message: requireText(input.message, "失败原因"),
            blocking: input.kind !== "extras",
            resolved: false,
            recoveryOptions: recoveryOptions(input.kind, state.stage),
            createdAt: now,
            resolvedAt: null,
        };
        state.failures.push(failure);
        return {value: failure, detail: {failureId: failure.id, stage: failure.stage, kind: failure.kind, blocking: failure.blocking, recoveryOptions: failure.recoveryOptions}};
    });
}

/** retry 成功后由对应角色显式解除；不能用 resolve 伪造主要 actor 的反应。 */
export async function resolveRpPipelineFailure(projectRoot: string, turnId: string, failureId: string, resolution: "retried" | "extras_rebuilt"): Promise<RpPipelineFailure> {
    return mutate(projectRoot, turnId, "resolve_failure", (state, now) => {
        const failure = state.failures.find((item) => item.id === failureId);
        if (!failure) throw new Error(`未找到 pipeline failure：${failureId}`);
        if (failure.resolved) return {value: failure, detail: {duplicate: true}};
        if (failure.kind === "major_actor") throw new Error("主要角色 actor 失败只能由同 actor 成功提交提案解除，不能手工代演或标记恢复。");
        if (resolution === "extras_rebuilt" && failure.kind !== "extras") throw new Error("只有普通群演失败允许 extras 重建。");
        failure.resolved = true;
        failure.resolvedAt = now;
        return {value: failure, detail: {failureId, resolution}};
    });
}

/** begin_commit 的硬前置条件。 */
export async function assertRpPipelineReadyForCommit(projectRoot: string, turnId: string): Promise<void> {
    const state = await readRpPipeline(projectRoot, turnId);
    if (state.stage !== "world_commit") throw new Error(`回合 pipeline 当前为 ${state.stage}，未到 world_commit。`);
    if (!state.narrative || !state.adjudication || !state.worldResolution) throw new Error("回合 pipeline 缺少冲突解决、终裁或叙事 artifact，不能提交。");
    if (state.failures.some((failure) => failure.blocking && !failure.resolved)) throw new Error("回合仍有未恢复的阻塞失败，不能提交。");
}

/** committed 后自动进入 ui_update；这里只记录公开阶段，不包含幕后思维。 */
export async function completeRpPipeline(projectRoot: string, turnId: string): Promise<RpPipelineState> {
    return mutate(projectRoot, turnId, "complete", (state, now) => {
        if (state.completedAt) return {value: state, detail: {duplicate: true}};
        if (state.stage !== "world_commit") throw new Error(`只有 world_commit 阶段可以完成 pipeline，当前 ${state.stage}。`);
        state.stage = "ui_update";
        state.completedAt = now;
        state.stageHistory.push({stage: "ui_update", publicSummary: "世界状态与界面投影已更新", at: now});
        return {value: state, detail: {stage: state.stage, completedAt: now}};
    });
}

function assertStageReady(state: RpPipelineState): void {
    switch (state.stage) {
        case "world_snapshot":
            if (!state.snapshot) throw new Error("world_snapshot 尚未捕获，不能推进。");
            break;
        case "screenwriter_plan":
            if (!state.plan) throw new Error("screenwriter plan 尚未提交，不能推进。");
            break;
        case "actor_proposals": {
            const plan = state.plan;
            if (!plan) throw new Error("缺少 screenwriter plan。");
            const returned = new Set(state.actorProposals.map((proposal) => proposal.actorId));
            const missing = plan.expectedActorIds.filter((actorId) => !returned.has(actorId));
            if (missing.length) throw new Error(`主要角色 actor 尚未全部返回：${missing.join(", ")}`);
            if (plan.extrasRequired && !state.extrasProposal) throw new Error("本回合要求 extras，但尚未提交群演提案。");
            break;
        }
        case "conflict_resolution":
            if (!state.worldResolution) throw new Error("world 尚未解决提案冲突，不能推进。");
            break;
        case "adjudication":
            if (!state.adjudication) throw new Error("screenwriter 终裁尚未提交，不能推进。");
            break;
        case "narrative":
            if (!state.narrative) throw new Error("writer 叙事 artifact 尚未登记，不能推进。");
            break;
        case "action_understanding":
        case "condition_check":
        case "world_commit":
        case "ui_update":
            break;
    }
}

function requireStage(state: RpPipelineState, stage: RpPipelineStage): void {
    if (state.stage !== stage) throw new Error(`操作要求 pipeline stage=${stage}，当前为 ${state.stage}。`);
}

function requireSnapshot(state: RpPipelineState, snapshotId: string): RpTurnSnapshot {
    if (!state.snapshot || state.snapshot.id !== snapshotId) throw new Error("提案 snapshotId 与本回合开始快照不一致。");
    return state.snapshot;
}

function requirePlan(state: RpPipelineState, snapshotId: string): RpScreenwriterPlan {
    requireSnapshot(state, snapshotId);
    if (!state.plan || state.plan.snapshotId !== snapshotId) throw new Error("尚无绑定当前快照的 screenwriter plan。");
    return state.plan;
}

function resolveActorFailure(state: RpPipelineState, actorId: string, now: string): void {
    for (const failure of state.failures.filter((item) => item.kind === "major_actor" && item.actorId === actorId && !item.resolved)) {
        failure.resolved = true;
        failure.resolvedAt = now;
    }
}

function recoveryOptions(kind: RpPipelineFailureKind, stage: RpPipelineStage): string[] {
    if (kind === "major_actor") return ["重试同一 actor", "取消并修改本回合行动"];
    if (kind === "extras") return ["重试 extras", "创建新的 extras 重建群演反应", "继续前取消群演需求"];
    if (kind === "world" && stage === "world_commit") return ["用同一 worldOperationId 查询或重试", "确认提交状态后恢复"];
    if (kind === "screenwriter") return ["重试 screenwriter", "取消并修改本回合行动"];
    if (kind === "writer") return ["用同一终裁重新生成叙事", "取消本回合"];
    return ["重试当前阶段", "取消本回合"];
}

function normalizeIds(values: string[]): string[] {
    const normalized = values.map((value) => safeId(value, "角色 id"));
    if (new Set(normalized).size !== normalized.length) throw new Error("角色 id 不能重复。");
    return normalized;
}

function safeId(value: string, label: string): string {
    const normalized = value.trim();
    if (!/^[\p{L}\p{N}_.:-]+$/u.test(normalized)) throw new Error(`非法${label}：${value}`);
    return normalized;
}

function requireText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label}不能为空。`);
    return normalized;
}

async function mutate<T>(projectRoot: string, turnId: string, operation: string, action: (state: RpPipelineState, now: string) => {value: T; detail: object}): Promise<T> {
    const turn = await readRpTurn(projectRoot, turnId);
    if (["committed", "cancelled", "failed"].includes(turn.status) && operation !== "complete") throw new Error(`回合 ${turnId} 已为 ${turn.status}，不能修改 pipeline。`);
    const path = pipelinePath(projectRoot, turnId);
    return withLock(path, async () => {
        const state = await readRpPipeline(projectRoot, turnId);
        const now = new Date().toISOString();
        const result = action(state, now);
        state.updatedAt = now;
        await writeAtomic(path, state);
        await appendLedger(projectRoot, {operation, turnId, stage: state.stage, at: now, ...result.detail});
        return result.value;
    });
}

function pipelinePath(projectRoot: string, turnId: string): string {
    return join(projectRoot, RP_PIPELINE_ROOT, `${safeId(turnId, "turn id")}.json`);
}

async function readOptional(path: string): Promise<RpPipelineState | null> {
    try {
        const parsed: unknown = JSON.parse(await readFile(path, "utf-8"));
        return StateSchema.parse(parsed);
    } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
    }
}

async function writeAtomic(path: string, state: RpPipelineState): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    await rename(temporary, path);
}

async function appendLedger(projectRoot: string, value: object): Promise<void> {
    const path = join(projectRoot, RP_PIPELINE_LEDGER_PATH);
    await mkdir(dirname(path), {recursive: true});
    await appendFile(path, `${JSON.stringify(value)}\n`, "utf-8");
}

async function withLock<T>(path: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(path) ?? Promise.resolve();
    let release = (): void => {};
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    locks.set(path, tail);
    await previous;
    try {
        return await action();
    } finally {
        release();
        if (locks.get(path) === tail) locks.delete(path);
    }
}

function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}
