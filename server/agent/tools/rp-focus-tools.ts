import {Type} from "typebox";
import type {Static} from "typebox";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import {providerObjectSchema} from "nbook/server/agent/tools/provider-object-schema";
import type {ToolExecutionContext, UserInputFormSpec, UserInputRequestContext} from "nbook/server/agent/tools/types";
import {
    planRpRuntime,
    readRpFocusState,
    rebalanceRpFocus,
    recordRpLongJumpSummary,
    RP_FOCUS_LEVELS,
    RP_RUN_INTENSITIES,
    setRpObjectFocus,
    setRpRunIntensity,
} from "nbook/server/rp/focus-store";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";

const ProjectPath = Type.String({minLength: 1});
const FocusLevel = Type.Union(RP_FOCUS_LEVELS.map((level) => Type.Literal(level)));
const Intensity = Type.Union(RP_RUN_INTENSITIES.map((intensity) => Type.Literal(intensity)));
const FocusKind = Type.Union([
    Type.Literal("location"), Type.Literal("npc"), Type.Literal("event"), Type.Literal("faction"), Type.Literal("plan"), Type.Literal("resource"),
]);
const FocusItem = Type.Object({id: Type.String({minLength: 1}), kind: FocusKind, reason: Type.String({minLength: 1})}, {additionalProperties: false});
const Instant = Type.String({
    pattern: "^-?[0-9]+$",
    description: "Raw World Engine Instant as a base-10 bigint string, for example 7808400. Never pass a formatted calendar label.",
});

const Schema = Type.Union([
    Type.Object({op: Type.Literal("get"), projectPath: ProjectPath}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("set_intensity"), projectPath: ProjectPath, intensity: Intensity}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("set_focus"), projectPath: ProjectPath, id: Type.String({minLength: 1}), kind: FocusKind,
        level: FocusLevel, pinned: Type.Boolean(), reason: Type.String({minLength: 1}), tick: Type.Integer({minimum: 0}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("rebalance"), projectPath: ProjectPath, tick: Type.Integer({minimum: 0}),
        current: Type.Array(FocusItem), activeBackground: Type.Array(FocusItem), lowFrequency: Type.Array(FocusItem),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("plan_runtime"), projectPath: ProjectPath, turnId: Type.String({minLength: 1}), longJump: Type.Boolean(),
        startInstant: Instant, endInstant: Instant,
        currentNpcIds: Type.Array(Type.String({minLength: 1})), directInteractionNpcIds: Type.Array(Type.String({minLength: 1})),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("record_long_jump"), projectPath: ProjectPath, turnId: Type.String({minLength: 1}),
        startTime: Type.String({minLength: 1}), endTime: Type.String({minLength: 1}), deterministicSummary: Type.String({minLength: 1}),
        characterSummary: Type.String({minLength: 1}), worldSummary: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
]);
type Input = Static<typeof Schema>;

export const rpFocusTools = {
    rpFocus: defineAgentTool({
        key: "rp_focus",
        name: "rp_focus",
        label: "RP Focus Runtime",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: [
            "Maintain persistent light/standard/deep runtime intensity and current/active_background/low_frequency/dormant focus levels.",
            "Read this state at every turn. Intensity changes only remote-world richness; never reduce current scenes, directly interacting characters, hard events, deterministic settlement, or explicit probability draws.",
            "World only uses rebalance and plan_runtime: rebalance accepts exactly op, projectPath, tick, current, activeBackground and lowFrequency; each focus item contains id, kind and reason. Never add a root reason field and never call set_focus as rp.world.",
            "plan_runtime accepts exactly op, projectPath, turnId, longJump, startInstant, endInstant, currentNpcIds and directInteractionNpcIds. startInstant/endInstant are raw base-10 World Engine bigint strings, not formatted calendar text; worldSummary belongs only to record_long_jump.",
            "Player-pinned set_focus changes belong to rp.leader and require a real approval dialog. Major characters retain at least low_frequency focus.",
            "For long jumps, plan deterministic modules once and record one batch summary. Never generate daily RP ticks merely to simulate elapsed time.",
        ].join("\n"),
        parameters: providerObjectSchema(Schema),
        validationSchema: Schema,
        authorize(context, args) {
            assertFocusPermission(context.profileKey, (args as Input).op);
        },
        userInputRequest: {
            when(context: UserInputRequestContext): UserInputFormSpec | null {
                const input = context.args as Input;
                if (input.op !== "set_focus") return null;
                return {
                    prompt: input.pinned ? "确认固定该世界对象的关注度" : "确认解除该世界对象的固定关注度",
                    layout: "dialog",
                    form: {
                        defaults: {approved: false},
                        fields: [{path: "approved", component: "radio", label: `${input.id} → ${input.level}`, required: true, options: [
                            {value: true, label: "确认"}, {value: false, label: "取消"},
                        ], defaultValue: false}],
                    },
                };
            },
        },
        async executeWithContext(context, _toolCallId, params: unknown, userInput?: unknown) {
            const input = params as Input;
            assertFocusPermission(context.profileKey, input.op);
            const root = resolveProjectRoot(context, input.projectPath);
            switch (input.op) {
                case "get": return result(await readRpFocusState(root));
                case "set_intensity": return result(await setRpRunIntensity(root, input.intensity));
                case "set_focus": {
                    if (!(userInput as {approved?: boolean} | undefined)?.approved) return result({approved: false, objectId: input.id});
                    return result(await setRpObjectFocus(root, {...input, playerApproved: true}));
                }
                case "rebalance": return result(await rebalanceRpFocus(root, input));
                case "plan_runtime": return result(await planRpRuntime(root, input));
                case "record_long_jump": return result(await recordRpLongJumpSummary(root, input.turnId, input));
            }
        },
    }),
} as const;

/** 强度由 leader/UI 管理；世界关注平衡与长跳落盘只归 world。 */
export function assertFocusPermission(profileKey: string, operation: Input["op"]): void {
    if (operation === "get" && ["rp.leader", "rp.screenwriter", "rp.world"].includes(profileKey)) return;
    if (["set_intensity", "set_focus"].includes(operation) && profileKey === "rp.leader") return;
    if (operation === "plan_runtime" && ["rp.screenwriter", "rp.world"].includes(profileKey)) return;
    if (["rebalance", "record_long_jump"].includes(operation) && profileKey === "rp.world") return;
    throw new Error(`RP 关注度操作 ${operation} 不允许由 ${profileKey} 执行。`);
}

function resolveProjectRoot(context: ToolExecutionContext, projectPath: string): string {
    const normalized = normalizeProjectPath(projectPath);
    assertProjectOpen(normalized);
    markProjectActivity(normalized);
    return resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
}

function result(value: object) {
    const details = normalizeToolResultDetails(value as unknown as JsonValue);
    return {content: [{type: "text" as const, text: JSON.stringify(details, null, 2)}], details};
}
