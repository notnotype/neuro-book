import {Type} from "typebox";
import type {Static} from "typebox";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import {providerObjectSchema} from "nbook/server/agent/tools/provider-object-schema";
import type {ToolExecutionContext, UserInputFormSpec, UserInputRequestContext} from "nbook/server/agent/tools/types";
import {
    analyzeRpLongJump,
    approveRpLongJump,
    defineRpCycle,
    defineRpResource,
    openRpResourceAccount,
    readRpCycleAt,
    readRpMechanicsState,
    readRpResourceAt,
    resolveRpRisk,
} from "nbook/server/rp/mechanics-store";
import {worldEngineFacadeForWorkspaceRoot} from "nbook/server/world-engine";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";

const ProjectPath = Type.String({minLength: 1});
const MechanicsSchema = Type.Union([
    Type.Object({op: Type.Literal("get"), projectPath: ProjectPath, view: Type.Optional(Type.Union([Type.Literal("player"), Type.Literal("gm")]))}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("define_resource"), projectPath: ProjectPath, id: Type.String({minLength: 1}), label: Type.String({minLength: 1}),
        kind: Type.Union([Type.Literal("ledger"), Type.Literal("time_derived"), Type.Literal("dynamic")]), unit: Type.String(),
        min: Type.Union([Type.Integer(), Type.Null()]), max: Type.Union([Type.Integer(), Type.Null()]),
        bands: Type.Array(Type.Object({min: Type.Integer(), max: Type.Integer(), label: Type.String({minLength: 1})}, {additionalProperties: false})),
        periodicRules: Type.Array(Type.Object({
            id: Type.String({minLength: 1}), everySeconds: Type.String({pattern: "^[1-9]\\d*$"}), delta: Type.Integer(),
            anchorTime: Type.String({minLength: 1}), label: Type.String({minLength: 1}),
        }, {additionalProperties: false})),
        derivedRate: Type.Union([
            Type.Object({numeratorDelta: Type.Integer(), numeratorSeconds: Type.String({pattern: "^[1-9]\\d*$"})}, {additionalProperties: false}),
            Type.Null(),
        ]),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("open_account"), projectPath: ProjectPath, subjectId: Type.String({minLength: 1}),
        ownerTier: Type.Union([Type.Literal("player"), Type.Literal("resident"), Type.Literal("major")]),
        resourceId: Type.String({minLength: 1}), initialValue: Type.Integer(), anchorTime: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("define_cycle"), projectPath: ProjectPath, id: Type.String({minLength: 1}), subjectId: Type.String({minLength: 1}), label: Type.String({minLength: 1}),
        anchorTime: Type.String({minLength: 1}), lengthSeconds: Type.String({pattern: "^[1-9]\\d*$"}),
        phases: Type.Array(Type.Object({label: Type.String({minLength: 1}), startSecond: Type.String({pattern: "^\\d+$"}), endSecond: Type.String({pattern: "^[1-9]\\d*$"})}, {additionalProperties: false}), {minItems: 1}),
        private: Type.Boolean(),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("read_resource"), projectPath: ProjectPath, accountId: Type.String({minLength: 1}), atTime: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("read_cycle"), projectPath: ProjectPath, cycleId: Type.String({minLength: 1}), atTime: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("plan_jump"), projectPath: ProjectPath, startTime: Type.String({minLength: 1}), endTime: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("approve_jump"), projectPath: ProjectPath, turnId: Type.String({minLength: 1}), startTime: Type.String({minLength: 1}), endTime: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("resolve_risk"), projectPath: ProjectPath, operationId: Type.String({minLength: 1}), subjectId: Type.String({minLength: 1}),
        kind: Type.Union([Type.Literal("pregnancy"), Type.Literal("custom")]),
        riskLevel: Type.Union([Type.Literal("none"), Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("extreme")]),
        cycleFactorPpm: Type.Integer({minimum: 0, maximum: 1_000_000}), protectionFactorPpm: Type.Integer({minimum: 0, maximum: 1_000_000}),
        private: Type.Boolean(), reason: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
]);
type MechanicsInput = Static<typeof MechanicsSchema>;

export const rpMechanicsTools = {
    rpMechanics: defineAgentTool({
        key: "rp_mechanics",
        name: "rp_mechanics",
        label: "RP Time and Resources",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: [
            "Deterministic RP time/resource/cycle rules. World Engine Instant remains the only current-time truth; this store records turn start/end and exact integer mechanics.",
            "rp.world defines resources/accounts/cycles and resolves server randomness. rp.leader can inspect player view and plan/approve long jumps. Five-minute or multi-year jumps settle periodic rules once, never create daily ticks.",
            "approve_jump always pauses for real player approval and binds the approval to turn/time/current blockers.",
        ].join("\n"),
        parameters: providerObjectSchema(MechanicsSchema),
        validationSchema: MechanicsSchema,
        authorize(context, args) {
            assertPermission(context.profileKey, (args as MechanicsInput).op);
        },
        userInputRequest: {
            when(context: UserInputRequestContext): UserInputFormSpec | null {
                const input = context.args as MechanicsInput;
                if (input.op !== "approve_jump") return null;
                return {
                    prompt: "长时间跳跃会跨过必须处理的事件",
                    layout: "dialog",
                    form: {
                        defaults: {approved: false},
                        fields: [{
                            path: "approved", component: "radio", label: `${input.startTime} → ${input.endTime}`,
                            description: "批准后，途中事件会按主持列出的处理方式推演；取消则返回当前时间。", required: true,
                            options: [{value: true, label: "批准跳跃"}, {value: false, label: "暂不跳跃"}], defaultValue: false,
                        }],
                    },
                };
            },
        },
        async executeWithContext(context, _toolCallId, params: unknown, userInput?: unknown) {
            const input = params as MechanicsInput;
            assertPermission(context.profileKey, input.op);
            const normalized = normalizeProjectPath(input.projectPath);
            assertProjectOpen(normalized);
            markProjectActivity(normalized);
            const projectRoot = resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
            const facade = worldEngineFacadeForWorkspaceRoot(context.workspaceFsRoot);
            switch (input.op) {
                case "get": {
                    const state = await readRpMechanicsState(projectRoot);
                    return result(input.view === "gm" ? state : playerView(state));
                }
                case "define_resource": {
                    const periodicRules = await Promise.all(input.periodicRules.map(async (rule) => ({
                        id: rule.id, everySeconds: rule.everySeconds, delta: rule.delta,
                        anchorInstant: (await facade.parseTime(normalized, rule.anchorTime, "rp")).toString(), label: rule.label,
                    })));
                    return result(await defineRpResource(projectRoot, {...input, periodicRules}));
                }
                case "open_account":
                    return result(await openRpResourceAccount(projectRoot, {
                        subjectId: input.subjectId, ownerTier: input.ownerTier, resourceId: input.resourceId, initialValue: input.initialValue,
                        anchorInstant: (await facade.parseTime(normalized, input.anchorTime, "rp")).toString(),
                    }));
                case "define_cycle":
                    return result(await defineRpCycle(projectRoot, {
                        id: input.id, subjectId: input.subjectId, label: input.label,
                        anchorInstant: (await facade.parseTime(normalized, input.anchorTime, "rp")).toString(),
                        lengthSeconds: input.lengthSeconds, phases: input.phases, private: input.private,
                    }));
                case "read_resource":
                    return result(await readRpResourceAt(projectRoot, input.accountId, (await facade.parseTime(normalized, input.atTime, "rp")).toString()));
                case "read_cycle":
                    return result(await readRpCycleAt(projectRoot, input.cycleId, (await facade.parseTime(normalized, input.atTime, "rp")).toString()));
                case "plan_jump": {
                    const start = await facade.parseTime(normalized, input.startTime, "rp");
                    const end = await facade.parseTime(normalized, input.endTime, "rp");
                    return result(await analyzeRpLongJump(projectRoot, start.toString(), end.toString(), (time) => facade.parseTime(normalized, time, "rp")));
                }
                case "approve_jump": {
                    if (!(userInput as {approved?: boolean} | undefined)?.approved) return result({approved: false, message: "玩家取消长跳。"});
                    const start = await facade.parseTime(normalized, input.startTime, "rp");
                    const end = await facade.parseTime(normalized, input.endTime, "rp");
                    const analysis = await analyzeRpLongJump(projectRoot, start.toString(), end.toString(), (time) => facade.parseTime(normalized, time, "rp"));
                    return result(await approveRpLongJump(projectRoot, {
                        turnId: input.turnId, startInstant: start.toString(), endInstant: end.toString(), eventIds: analysis.blockers.map((blocker) => blocker.eventId),
                    }));
                }
                case "resolve_risk":
                    return result(await resolveRpRisk(projectRoot, input));
            }
        },
    }),
} as const;

export function assertPermission(profileKey: string, operation: MechanicsInput["op"]): void {
    if (["get", "read_resource", "read_cycle", "plan_jump"].includes(operation) && ["rp.leader", "rp.screenwriter", "rp.world"].includes(profileKey)) return;
    if (operation === "approve_jump" && profileKey === "rp.leader") return;
    if (["define_resource", "open_account", "define_cycle", "resolve_risk"].includes(operation) && profileKey === "rp.world") return;
    throw new Error(`RP mechanics 操作 ${operation} 不允许由 ${profileKey} 执行。`);
}

function playerView(state: Awaited<ReturnType<typeof readRpMechanicsState>>) {
    return {
        schemaVersion: state.schemaVersion,
        resources: state.resources,
        accounts: state.accounts,
        cycles: state.cycles.filter((cycle) => !cycle.private),
        transactions: state.transactions,
        timeRecords: state.timeRecords,
        riskResolutions: state.riskResolutions.filter((resolution) => !resolution.private),
        updatedAt: state.updatedAt,
    };
}

function result(value: object) {
    const details = normalizeToolResultDetails(value as unknown as JsonValue);
    return {content: [{type: "text" as const, text: JSON.stringify(details, null, 2)}], details};
}
