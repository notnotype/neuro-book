import {Type} from "typebox";
import type {Static} from "typebox";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import {providerObjectSchema} from "nbook/server/agent/tools/provider-object-schema";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {
    advanceRpPipeline,
    captureRpTurnSnapshot,
    readRpPipeline,
    registerRpNarrative,
    reportRpPipelineFailure,
    resolveRpPipelineFailure,
    resolveRpProposalConflicts,
    RP_PIPELINE_STAGES,
    submitRpActorProposals,
    submitRpAdjudication,
    submitRpExtrasProposal,
    submitRpScreenwriterPlan,
} from "nbook/server/rp/pipeline-store";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";

const ProjectPath = Type.String({minLength: 1});
const TurnId = Type.String({minLength: 1});
const SnapshotId = Type.String({minLength: 1});
const Stage = Type.Union(RP_PIPELINE_STAGES.map((stage) => Type.Literal(stage)));
const FailureKind = Type.Union([
    Type.Literal("screenwriter"), Type.Literal("major_actor"), Type.Literal("extras"), Type.Literal("world"), Type.Literal("writer"),
]);
const Conflict = Type.Object({
    id: Type.String({minLength: 1}),
    kind: Type.Union([Type.Literal("character_intent"), Type.Literal("world_fact"), Type.Literal("resource"), Type.Literal("timing")]),
    description: Type.String({minLength: 1}),
    sources: Type.Array(Type.String({minLength: 1}), {minItems: 1}),
}, {additionalProperties: false});
const Resolution = Type.Object({
    conflictId: Type.String({minLength: 1}),
    chosenSource: Type.String({minLength: 1}),
    reason: Type.String({minLength: 1}),
}, {additionalProperties: false});

const Schema = Type.Union([
    Type.Object({op: Type.Literal("get"), projectPath: ProjectPath, turnId: TurnId}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("advance"), projectPath: ProjectPath, turnId: TurnId, target: Stage, publicSummary: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("capture_snapshot"), projectPath: ProjectPath, turnId: TurnId,
        worldInstant: Type.String({minLength: 1}), publicSummary: Type.String({minLength: 1}),
        // Agent 提交的世界快照是外部 JSON 边界，进入 store 后由递归 JsonValue schema 校验。
        state: Type.Unknown(),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("submit_plan"), projectPath: ProjectPath, turnId: TurnId, snapshotId: SnapshotId,
        expectedActorIds: Type.Array(Type.String({minLength: 1})), extrasRequired: Type.Boolean(), lightweight: Type.Boolean(),
        requiresPlayerRoll: Type.Boolean(), summary: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("submit_actor_proposals"), projectPath: ProjectPath, turnId: TurnId, snapshotId: SnapshotId,
        proposals: Type.Array(Type.Object({
            actorId: Type.String({minLength: 1}), visibleResponse: Type.String({minLength: 1}), spokenWords: Type.String(), innerResponse: Type.String({minLength: 1}),
        }, {additionalProperties: false})),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("submit_extras"), projectPath: ProjectPath, turnId: TurnId, snapshotId: SnapshotId, summary: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("resolve_conflicts"), projectPath: ProjectPath, turnId: TurnId, snapshotId: SnapshotId,
        conflicts: Type.Array(Conflict), resolutions: Type.Array(Resolution), mergedSummary: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("submit_adjudication"), projectPath: ProjectPath, turnId: TurnId, snapshotId: SnapshotId,
        summary: Type.String({minLength: 1}),
        // 终裁草案允许任意 JSON 结构，提交时仍由 store 的 JsonValue schema 收口。
        settlementDraft: Type.Unknown(),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("register_narrative"), projectPath: ProjectPath, turnId: TurnId, prosePath: Type.String({minLength: 1}), summary: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("report_failure"), projectPath: ProjectPath, turnId: TurnId, kind: FailureKind,
        agent: Type.String({minLength: 1}), actorId: Type.Optional(Type.Union([Type.String({minLength: 1}), Type.Null()])), message: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("resolve_failure"), projectPath: ProjectPath, turnId: TurnId, failureId: Type.String({minLength: 1}),
        resolution: Type.Union([Type.Literal("retried"), Type.Literal("extras_rebuilt")]),
    }, {additionalProperties: false}),
]);
type Input = Static<typeof Schema>;

export const rpPipelineTools = {
    rpPipeline: defineAgentTool({
        key: "rp_pipeline",
        name: "rp_pipeline",
        label: "RP Turn Pipeline",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: [
            "Persist and enforce every RP turn stage. A stage is complete only after this tool records its required artifact; natural-language claims do not advance the turn.",
            "screenwriter/cast/extras/world proposals must reuse the exact snapshotId captured at world_snapshot. Cast submits all major actor proposals together; extras submits only ordinary NPC reactions.",
            "World resolves proposal conflicts before screenwriter adjudication. Character intent from an actor cannot be overwritten by a screenwriter plan.",
            "A failed major actor remains blocking until that same actor successfully submits. Never let leader or extras impersonate it. All failures return stage, reason, commit state context and recovery options.",
        ].join("\n"),
        parameters: providerObjectSchema(Schema),
        validationSchema: Schema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as Input;
            assertPipelinePermission(context.profileKey, input);
            const root = resolveProjectRoot(context, input.projectPath);
            switch (input.op) {
                case "get": return result(await readRpPipeline(root, input.turnId));
                case "advance": return result(await advanceRpPipeline(root, input.turnId, input.target, input.publicSummary));
                case "capture_snapshot": return result(await captureRpTurnSnapshot(root, input.turnId, {...input, state: input.state as JsonValue}));
                case "submit_plan": return result(await submitRpScreenwriterPlan(root, input.turnId, input));
                case "submit_actor_proposals": return result(await submitRpActorProposals(root, input.turnId, input.snapshotId, input.proposals));
                case "submit_extras": return result(await submitRpExtrasProposal(root, input.turnId, input.snapshotId, input.summary));
                case "resolve_conflicts": return result(await resolveRpProposalConflicts(root, input.turnId, input));
                case "submit_adjudication": return result(await submitRpAdjudication(root, input.turnId, input.snapshotId, input.summary, input.settlementDraft as JsonValue));
                case "register_narrative": return result(await registerRpNarrative(root, input.turnId, input.prosePath, input.summary));
                case "report_failure": return result(await reportRpPipelineFailure(root, input.turnId, input));
                case "resolve_failure": return result(await resolveRpPipelineFailure(root, input.turnId, input.failureId, input.resolution));
            }
        },
    }),
} as const;

/** 按职责约束 pipeline 写面，避免 leader 在代码层代替下游产出。 */
export function assertPipelinePermission(profileKey: string, input: Pick<Input, "op"> & {kind?: Static<typeof FailureKind>}): void {
    if (input.op === "get" && ["rp.leader", "rp.world", "rp.screenwriter"].includes(profileKey)) return;
    if (["advance", "register_narrative", "resolve_failure"].includes(input.op) && profileKey === "rp.leader") return;
    if (["capture_snapshot", "resolve_conflicts"].includes(input.op) && profileKey === "rp.world") return;
    if (["submit_plan", "submit_adjudication"].includes(input.op) && profileKey === "rp.screenwriter") return;
    if (input.op === "submit_actor_proposals" && profileKey === "rp.cast") return;
    if (input.op === "submit_extras" && profileKey === "rp.extras") return;
    if (input.op === "report_failure") {
        if (profileKey === "rp.leader") return;
        if (profileKey === "rp.screenwriter" && input.kind === "screenwriter") return;
        if (profileKey === "rp.cast" && input.kind === "major_actor") return;
        if (profileKey === "rp.extras" && input.kind === "extras") return;
        if (profileKey === "rp.world" && input.kind === "world") return;
    }
    throw new Error(`RP pipeline 操作 ${input.op} 不允许由 ${profileKey} 执行。`);
}

function resolveProjectRoot(context: ToolExecutionContext, projectPath: string): string {
    const normalized = normalizeProjectPath(projectPath);
    assertProjectOpen(normalized);
    markProjectActivity(normalized);
    return resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
}

function result(value: object | null) {
    const details = normalizeToolResultDetails(value as unknown as JsonValue);
    return {content: [{type: "text" as const, text: JSON.stringify(details, null, 2)}], details};
}
