import {Type} from "typebox";
import type {Static} from "typebox";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import {providerObjectSchema} from "nbook/server/agent/tools/provider-object-schema";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {
    awaitRpTurnPlayer,
    beginRpTurnCommit,
    cancelRpTurn,
    commitRpTurn,
    failRpTurn,
    listIncompleteRpTurns,
    linkRpTurnRequest,
    readRpTurn,
    resumeRpTurn,
    startRpTurn,
    type RpTurnRecord,
} from "nbook/server/rp/turn-store";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";
import {worldEngineFacadeForWorkspaceRoot} from "nbook/server/world-engine";
import {analyzeRpLongJump, verifyRpJumpApproval} from "nbook/server/rp/mechanics-store";
import type {RpTurnRulesSettlement} from "nbook/server/rp/turn-rules-store";

const ProjectPath = Type.String({minLength: 1, description: "Project Workspace path, e.g. workspace/my-novel."});
const TurnId = Type.String({pattern: "^turn-\\d{6}-[a-f0-9]{8}$"});
const RelationDeltas = Type.Object({
    familiarity: Type.Optional(Type.Integer({minimum: -100, maximum: 100})),
    trust: Type.Optional(Type.Integer({minimum: -100, maximum: 100})),
    affection: Type.Optional(Type.Integer({minimum: -100, maximum: 100})),
    attraction: Type.Optional(Type.Integer({minimum: -100, maximum: 100})),
    respect: Type.Optional(Type.Integer({minimum: -100, maximum: 100})),
    dependence: Type.Optional(Type.Integer({minimum: -100, maximum: 100})),
    fear: Type.Optional(Type.Integer({minimum: -100, maximum: 100})),
    hostility: Type.Optional(Type.Integer({minimum: -100, maximum: 100})),
}, {additionalProperties: false});
const CognitionChange = Type.Union([
    Type.Object({
        op: Type.Literal("learn"), characterId: Type.String({minLength: 1}), factId: Type.String({minLength: 1}),
        belief: Type.Union([Type.Literal("believes"), Type.Literal("disbelieves"), Type.Literal("uncertain")]),
        content: Type.String({minLength: 1}), source: Type.String({minLength: 1}), tick: Type.Integer({minimum: 0}),
        channel: Type.Union([Type.Literal("observed"), Type.Literal("told"), Type.Literal("inferred")]),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("rumor"), fromCharacterId: Type.String({minLength: 1}), toCharacterId: Type.String({minLength: 1}),
        factId: Type.String({minLength: 1}), content: Type.String({minLength: 1}), tick: Type.Integer({minimum: 0}), relevanceReason: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("fact_status"), factId: Type.String({minLength: 1}),
        status: Type.Union([Type.Literal("established"), Type.Literal("disputed"), Type.Literal("superseded")]),
        tick: Type.Integer({minimum: 0}), reason: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
]);
const RulesSettlement = Type.Object({
    time: Type.Object({
        startTime: Type.String({minLength: 1, description: "Project RP calendar string at turn start."}),
        endTime: Type.String({minLength: 1, description: "Project RP calendar string at turn end. Must equal the latest committed RP World instant."}),
        longJump: Type.Boolean(),
        summary: Type.String({minLength: 1, maxLength: 1000}),
        jumpApprovalId: Type.Optional(Type.String({minLength: 1, description: "Required when a long jump crosses active or due hard events."})),
    }, {additionalProperties: false}),
    resources: Type.Array(Type.Object({
        accountId: Type.String({minLength: 1}), delta: Type.Integer(), reason: Type.String({minLength: 1}),
    }, {additionalProperties: false})),
    relations: Type.Array(Type.Object({
        tick: Type.Integer({minimum: 0}), sourceId: Type.String({minLength: 1}), targetId: Type.String({minLength: 1}), deltas: RelationDeltas,
        addTags: Type.Optional(Type.Array(Type.String({minLength: 1}))), removeTags: Type.Optional(Type.Array(Type.String({minLength: 1}))),
        basis: Type.Union([Type.Literal("interaction"), Type.Literal("setting"), Type.Literal("player_declaration"), Type.Literal("dice")]),
        reason: Type.String({minLength: 1}), sourceIsAvatar: Type.Optional(Type.Boolean()), playerDeclared: Type.Optional(Type.Boolean()),
    }, {additionalProperties: false})),
    cognition: Type.Array(CognitionChange),
}, {additionalProperties: false});

const TurnSchema = Type.Union([
    Type.Object({
        op: Type.Literal("start"),
        projectPath: ProjectPath,
        inputSummary: Type.String({minLength: 1, maxLength: 1000}),
        requestKey: Type.Optional(Type.String({minLength: 1, maxLength: 300, description: "Omit to use the current Agent invocation id. Supply only for deterministic tests or external recovery."})),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("get"), projectPath: ProjectPath, turnId: TurnId}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("list_incomplete"), projectPath: ProjectPath}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("await_player"), projectPath: ProjectPath, turnId: TurnId, note: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("resume"), projectPath: ProjectPath, turnId: TurnId}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("begin_commit"), projectPath: ProjectPath, turnId: TurnId}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("commit"),
        projectPath: ProjectPath,
        turnId: TurnId,
        prosePath: Type.String({pattern: "^rp/ticks/\\d{6}(?:-[\\w-]+)?/prose\\.md$"}),
        // Agent 结算是外部 JSON seam；执行入口将其收口为项目 JsonValue 后只写文件，不注入后续上下文。
        settlement: Type.Unknown({description: "Complete structured turn settlement for the World Status update window."}),
        meaningfulEvent: Type.Boolean({description: "true when this committed turn started/advanced/resolved a formal event; false for a calm turn. Used by the server-side five-calm-turn trigger."}),
        rules: RulesSettlement,
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("fail"),
        projectPath: ProjectPath,
        turnId: TurnId,
        stage: Type.String({minLength: 1}),
        agent: Type.String({minLength: 1}),
        message: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("cancel"), projectPath: ProjectPath, turnId: TurnId, note: Type.String({minLength: 1})}, {additionalProperties: false}),
]);

type TurnInput = Static<typeof TurnSchema>;

export const rpTurnTools = {
    rpTurn: defineAgentTool({
        key: "rp_turn",
        name: "rp_turn",
        label: "RP Turn Ledger",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: [
            "Canonical RP turn state machine and file ledger under Project Workspace .nbook/rp/runtime/.",
            "For every IC turn call start before invoking RP child agents. The same Agent invocation reuses the same turn through requestKey idempotency.",
            "Use await_player before dice/confirmation, resume after valid user input, then begin_commit before rp.world writeback.",
            "begin_commit returns worldOperationId. Pass it unchanged as execute_world.operationId so a lost response cannot duplicate World Engine settlement.",
            "After world write succeeds call commit with the complete structured settlement. It is written to files for the World Status update window; this tool returns only compact metadata.",
            "On failure call fail with stage/agent/message. Do not cancel a committing turn until recovery checks the World operation id.",
        ].join("\n"),
        parameters: providerObjectSchema(TurnSchema),
        validationSchema: TurnSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as TurnInput;
            const projectRoot = resolveProjectRoot(context, input.projectPath);
            switch (input.op) {
                case "start": {
                    const requestKey = input.requestKey ?? context.invocationId;
                    if (!requestKey) throw new Error("rp_turn start 缺少 invocationId；请显式提供 requestKey。");
                    return compact(await startRpTurn(projectRoot, {
                        requestKey: `${context.sessionId}:${requestKey}`,
                        sessionId: context.sessionId,
                        invocationId: context.invocationId,
                        inputSummary: input.inputSummary,
                    }));
                }
                case "get":
                    return compact(await readRpTurn(projectRoot, input.turnId));
                case "list_incomplete":
                    return compactList(await listIncompleteRpTurns(projectRoot));
                case "await_player":
                    return compact(await awaitRpTurnPlayer(projectRoot, input.turnId, input.note));
                case "resume":
                    {
                        const resumed = await resumeRpTurn(projectRoot, input.turnId);
                        if (context.invocationId) {
                            await linkRpTurnRequest(projectRoot, `${context.sessionId}:${context.invocationId}`, input.turnId, context.sessionId);
                        }
                        return compact(resumed);
                    }
                case "begin_commit":
                    return compact(await beginRpTurnCommit(projectRoot, input.turnId));
                case "commit":
                    return compact(await commitRpTurn(
                        projectRoot,
                        input.turnId,
                        input.prosePath,
                        input.settlement as JsonValue,
                        input.meaningfulEvent,
                        await prepareRules(context, input.projectPath, input.turnId, input.rules),
                    ));
                case "fail":
                    return compact(await failRpTurn(projectRoot, input.turnId, {stage: input.stage, agent: input.agent, message: input.message}));
                case "cancel":
                    return compact(await cancelRpTurn(projectRoot, input.turnId, input.note));
            }
        },
    }),
} as const;

function resolveProjectRoot(context: ToolExecutionContext, projectPath: string): string {
    const normalized = normalizeProjectPath(projectPath);
    assertProjectOpen(normalized);
    markProjectActivity(normalized);
    return resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
}

/** 将人读日历时间收口为 Instant，并核对 World 写回与长跳审批。 */
async function prepareRules(
    context: ToolExecutionContext,
    projectPath: string,
    turnId: string,
    input: Extract<TurnInput, {op: "commit"}>["rules"],
): Promise<RpTurnRulesSettlement> {
    const normalized = normalizeProjectPath(projectPath);
    const facade = worldEngineFacadeForWorkspaceRoot(context.workspaceFsRoot);
    const startInstant = await facade.parseTime(normalized, input.time.startTime, "rp");
    const endInstant = await facade.parseTime(normalized, input.time.endTime, "rp");
    const worldState = await facade.queryState(normalized, {listLimit: 1}, "rp");
    if (worldState.instant !== endInstant) {
        const actual = await facade.formatTime(normalized, worldState.instant, "rp");
        throw new Error(`RP 回合 endTime 必须等于 World Engine 最新时间；传入 ${input.time.endTime}，当前为 ${actual}。`);
    }
    if (input.time.longJump) {
        const projectRoot = resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
        const analysis = await analyzeRpLongJump(
            projectRoot,
            startInstant.toString(),
            endInstant.toString(),
            (time) => facade.parseTime(normalized, time, "rp"),
        );
        if (!analysis.allowed) {
            if (!input.time.jumpApprovalId) throw new Error(`长跳被 ${analysis.blockers.length} 个事件阻断，必须先通过 rp_mechanics approve_jump 询问玩家。`);
            await verifyRpJumpApproval(projectRoot, {
                approvalId: input.time.jumpApprovalId,
                turnId,
                startInstant: startInstant.toString(),
                endInstant: endInstant.toString(),
                eventIds: analysis.blockers.map((blocker) => blocker.eventId),
            });
        }
    }
    return {
        mechanics: {
            startInstant: startInstant.toString(), endInstant: endInstant.toString(),
            startTime: input.time.startTime, endTime: input.time.endTime, longJump: input.time.longJump, summary: input.time.summary,
            resourceChanges: input.resources,
        },
        relations: input.relations,
        cognition: input.cognition,
    };
}

function compact(turn: RpTurnRecord) {
    const details = normalizeToolResultDetails({
        id: turn.id,
        sequence: turn.sequence,
        status: turn.status,
        worldOperationId: turn.worldOperationId,
        prosePath: turn.prosePath,
        note: turn.note,
        error: turn.error,
        createdAt: turn.createdAt,
        updatedAt: turn.updatedAt,
    } as unknown as JsonValue);
    return {content: [{type: "text" as const, text: JSON.stringify(details, null, 2)}], details};
}

function compactList(turns: RpTurnRecord[]) {
    const details = normalizeToolResultDetails(turns.map((turn) => ({
        id: turn.id,
        sequence: turn.sequence,
        status: turn.status,
        worldOperationId: turn.worldOperationId,
        prosePath: turn.prosePath,
        note: turn.note,
        error: turn.error,
        updatedAt: turn.updatedAt,
    })) as unknown as JsonValue);
    return {content: [{type: "text" as const, text: JSON.stringify(details, null, 2)}], details};
}
