import {Type} from "typebox";
import type {Static} from "typebox";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import {providerObjectSchema} from "nbook/server/agent/tools/provider-object-schema";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {
    activateRpEvent,
    advanceRpEventStage,
    discardRpCandidate,
    finishRpEvent,
    invalidateRpLocationCandidates,
    randomSelectRpCandidate,
    readRpPlayerEvents,
    readRpEventState,
    registerCandidateBatch,
    registerFormalEvent,
    revalidateRpCandidate,
    saveRpCandidate,
    selectRpCandidate,
    suspendRpEvent,
    validateCandidateBatch,
    type RpCandidateProposal,
} from "nbook/server/rp/event-store";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";

const ProjectPath = Type.String({minLength: 1, description: "Project Workspace path, e.g. workspace/my-novel."});
const EventId = Type.String({pattern: "^event-[0-9a-f-]{36}$"});
const Tone = Type.Union([Type.Literal("calm"), Type.Literal("exciting"), Type.Literal("dangerous"), Type.Literal("unusual")]);
const Trigger = Type.Union([
    Type.Literal("new_location"),
    Type.Literal("new_activity"),
    Type.Literal("calm_streak"),
    Type.Literal("plan_due"),
    Type.Literal("player_request"),
    Type.Literal("opening_stable"),
]);
const Candidate = Type.Object({
    tone: Tone,
    title: Type.String({minLength: 1, maxLength: 120}),
    playerSummary: Type.String({minLength: 1, maxLength: 1000, description: "Player-visible entry signs only. Do not include a predetermined outcome."}),
    hiddenSetup: Type.Optional(Type.String({maxLength: 2000, description: "Host-only setup rationale; never a fixed ending."})),
    locationId: Type.Optional(Type.String({minLength: 1, maxLength: 200})),
    compatibilityKey: Type.Optional(Type.String({minLength: 1, maxLength: 200, description: "Optional exclusivity key used for deterministic conflict checks."})),
}, {additionalProperties: false});

const EventToolSchema = Type.Union([
    Type.Object({op: Type.Literal("get"), projectPath: ProjectPath, view: Type.Optional(Type.Union([Type.Literal("player"), Type.Literal("gm")]))}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("validate_candidates"), projectPath: ProjectPath, proposals: Type.Array(Candidate, {minItems: 4, maxItems: 4})}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("register_candidates"), projectPath: ProjectPath, trigger: Trigger, proposals: Type.Array(Candidate, {minItems: 4, maxItems: 4})}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("register_event"),
        projectPath: ProjectPath,
        origin: Type.Union([Type.Literal("opening"), Type.Literal("hard_schedule"), Type.Literal("player")]),
        trigger: Trigger,
        tone: Tone,
        title: Type.String({minLength: 1, maxLength: 120}),
        playerSummary: Type.String({minLength: 1, maxLength: 1000}),
        hiddenSetup: Type.Optional(Type.String({maxLength: 2000})),
        locationId: Type.Optional(Type.String({minLength: 1, maxLength: 200})),
        compatibilityKey: Type.Optional(Type.String({minLength: 1, maxLength: 200})),
        hard: Type.Optional(Type.Boolean()),
        hardKind: Type.Optional(Type.Union([Type.Literal("schedule"), Type.Literal("weather"), Type.Literal("appointment"), Type.Literal("plan")])),
        dueAt: Type.Optional(Type.String({minLength: 1, maxLength: 200})),
        startActive: Type.Optional(Type.Boolean()),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("save"), projectPath: ProjectPath, eventId: EventId}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("discard"), projectPath: ProjectPath, eventId: EventId}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("select"), projectPath: ProjectPath, eventId: EventId}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("random_select"), projectPath: ProjectPath, eventIds: Type.Array(EventId, {minItems: 1, maxItems: 4})}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("invalidate_location"), projectPath: ProjectPath, locationId: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("revalidate"), projectPath: ProjectPath, eventId: EventId, valid: Type.Boolean(), reason: Type.String()}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("activate"), projectPath: ProjectPath, eventId: EventId}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("advance_stage"),
        projectPath: ProjectPath,
        eventId: EventId,
        stage: Type.Union([
            Type.Literal("entry"), Type.Literal("involvement"), Type.Literal("development"),
            Type.Literal("critical_choice"), Type.Literal("outcome"), Type.Literal("aftermath"),
        ]),
        change: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("suspend"), projectPath: ProjectPath, eventId: EventId, reason: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("finish"),
        projectPath: ProjectPath,
        eventId: EventId,
        status: Type.Union([
            Type.Literal("resolved"), Type.Literal("failed"), Type.Literal("missed"),
            Type.Literal("continued_without_player"), Type.Literal("expired"), Type.Literal("cancelled"),
        ]),
        reason: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
]);

type EventToolInput = Static<typeof EventToolSchema>;

export const rpEventTools = {
    rpEvent: defineAgentTool({
        key: "rp_event",
        name: "rp_event",
        label: "RP Event Ledger",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: [
            "Canonical RP candidate/formal event state machine under Project Workspace .nbook/rp/runtime/events/.",
            "Permission split is enforced by profile: rp.screenwriter validates four-card proposals; rp.world registers candidates and advances objective lifecycle; rp.leader reads player view and performs explicit player save/select/discard/random actions.",
            "A four-card batch must contain exactly calm/exciting/dangerous/unusual. Selection fixes only the entry, never the ending. Random selection is performed by the server from 1-4 player-approved candidate ids.",
            "Normal active events are limited to 3; a due hard schedule/weather/appointment/plan may temporarily become the fourth focus. Leaving a location invalidates normal cards and marks saved cards for revalidation.",
            "The five-calm-turn trigger is updated atomically from rp_turn commit; event agents cannot increment it directly.",
        ].join("\n"),
        parameters: providerObjectSchema(EventToolSchema),
        validationSchema: EventToolSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as EventToolInput;
            assertOperationPermission(context.profileKey, input.op);
            const projectRoot = resolveProjectRoot(context, input.projectPath);
            switch (input.op) {
                case "get": {
                    return result(input.view === "gm" ? await readRpEventState(projectRoot) : await readRpPlayerEvents(projectRoot));
                }
                case "validate_candidates":
                    return result({proposals: validateCandidateBatch(input.proposals as RpCandidateProposal[])});
                case "register_candidates":
                    return result(await registerCandidateBatch(projectRoot, {trigger: input.trigger, proposals: input.proposals as RpCandidateProposal[]}));
                case "register_event":
                    return result(await registerFormalEvent(projectRoot, input));
                case "save":
                    return result(await saveRpCandidate(projectRoot, input.eventId));
                case "discard":
                    return result(await discardRpCandidate(projectRoot, input.eventId));
                case "select":
                    return result(await selectRpCandidate(projectRoot, input.eventId));
                case "random_select":
                    return result(await randomSelectRpCandidate(projectRoot, input.eventIds));
                case "invalidate_location":
                    return result(await invalidateRpLocationCandidates(projectRoot, input.locationId));
                case "revalidate":
                    return result(await revalidateRpCandidate(projectRoot, input.eventId, input.valid, input.reason));
                case "activate":
                    return result(await activateRpEvent(projectRoot, input.eventId));
                case "advance_stage":
                    return result(await advanceRpEventStage(projectRoot, input.eventId, input.stage, input.change));
                case "suspend":
                    return result(await suspendRpEvent(projectRoot, input.eventId, input.reason));
                case "finish":
                    return result(await finishRpEvent(projectRoot, input.eventId, input.status, input.reason));
            }
        },
    }),
} as const;

/** 工具级权限是 Prompt 之外的硬边界。 */
export function assertOperationPermission(profileKey: string, operation: EventToolInput["op"]): void {
    if (operation === "get") {
        if (["rp.leader", "rp.screenwriter", "rp.world"].includes(profileKey)) return;
    } else if (operation === "validate_candidates") {
        if (profileKey === "rp.screenwriter") return;
    } else if (["save", "discard", "select", "random_select"].includes(operation)) {
        if (profileKey === "rp.leader") return;
    } else if (profileKey === "rp.world") {
        return;
    }
    throw new Error(`RP 事件操作 ${operation} 不允许由 ${profileKey} 执行。`);
}

function resolveProjectRoot(context: ToolExecutionContext, projectPath: string): string {
    const normalized = normalizeProjectPath(projectPath);
    assertProjectOpen(normalized);
    markProjectActivity(normalized);
    return resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
}

function result(value: object) {
    const details = normalizeToolResultDetails(value as unknown as JsonValue);
    return {
        content: [{type: "text" as const, text: JSON.stringify(details, null, 2)}],
        details,
    };
}
