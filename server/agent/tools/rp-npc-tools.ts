import {Type} from "typebox";
import type {Static} from "typebox";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import {providerObjectSchema} from "nbook/server/agent/tools/provider-object-schema";
import type {ToolExecutionContext, UserInputFormSpec, UserInputRequestContext} from "nbook/server/agent/tools/types";
import {
    markRpNpcResourcesReady,
    promoteRpNpc,
    readRpNpcState,
    readRpPlayerRoster,
    registerNamedRpNpc,
    rejectRpNpcSuggestion,
    setRpNpcPresence,
    suggestRpNpcPromotion,
} from "nbook/server/rp/npc-store";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";

const ProjectPath = Type.String({minLength: 1});
const NpcOrigin = Type.Union([Type.Literal("extra_named"), Type.Literal("world"), Type.Literal("player"), Type.Literal("import")]);
const RegisterFields = {
    id: Type.String({minLength: 1}),
    name: Type.String({minLength: 1}),
    aliases: Type.Optional(Type.Array(Type.String({minLength: 1}))),
    narrativeRole: Type.String({minLength: 1}),
    playerSummary: Type.String({minLength: 1}),
    personaSummary: Type.Optional(Type.String()),
    household: Type.String({minLength: 1}),
    tick: Type.Integer({minimum: 0}),
    locationId: Type.Optional(Type.Union([Type.String({minLength: 1}), Type.Null()])),
};
const MemoryBackfill = Type.Object({
    tick: Type.Integer({minimum: 0}),
    summaryLine: Type.String({minLength: 1}),
    detail: Type.String({minLength: 1}),
    time: Type.Optional(Type.String()),
    participants: Type.Optional(Type.Array(Type.String({minLength: 1}))),
    sourceRef: Type.String({minLength: 1}),
}, {additionalProperties: false});

const Schema = Type.Union([
    Type.Object({op: Type.Literal("get"), projectPath: ProjectPath, view: Type.Union([Type.Literal("player"), Type.Literal("gm")])}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("register_named"), projectPath: ProjectPath, origin: NpcOrigin, ...RegisterFields}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("register_player"), projectPath: ProjectPath, ...RegisterFields}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("suggest"), projectPath: ProjectPath, npcId: Type.String({minLength: 1}),
        targetTier: Type.Union([Type.Literal("resident"), Type.Literal("major")]), reason: Type.String({minLength: 1}), evidence: Type.Array(Type.String({minLength: 1}), {minItems: 1}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("promote"), projectPath: ProjectPath, npcId: Type.String({minLength: 1}),
        targetTier: Type.Union([Type.Literal("resident"), Type.Literal("major")]), reason: Type.String({minLength: 1}), tick: Type.Integer({minimum: 0}),
        soul: Type.Optional(Type.String()), memoryBackfill: Type.Optional(Type.Array(MemoryBackfill)),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("reject_suggestion"), projectPath: ProjectPath, suggestionId: Type.String({minLength: 1}), reason: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("set_presence"), projectPath: ProjectPath, npcId: Type.String({minLength: 1}), tick: Type.Integer({minimum: 0}),
        locationId: Type.Optional(Type.Union([Type.String({minLength: 1}), Type.Null()])), active: Type.Boolean(), reason: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("resources_ready"), projectPath: ProjectPath, npcId: Type.String({minLength: 1})}, {additionalProperties: false}),
]);
type Input = Static<typeof Schema>;

export const rpNpcTools = {
    rpNpc: defineAgentTool({
        key: "rp_npc",
        name: "rp_npc",
        label: "RP NPC Lifecycle",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: [
            "Maintain the NPC lifecycle roster: unnamed extra (not stored) -> named -> resident -> major -> major_inactive.",
            "Any extra who states a name must be register_named immediately. screenwriter can only create non-blocking promotion suggestions; rp.leader performs promotion through a real player approval dialog. Enemies/rivals may be major characters.",
            "Promoting to major creates the rp/characters dossier and can backfill perspective memories from prior Tick/event/interaction summaries. Actor sessions remain lazy until actual appearance.",
            "Resident/major resourceStatus becomes pending; rp.world initializes a reasonable precise account through rp_mechanics, then calls resources_ready.",
        ].join("\n"),
        parameters: providerObjectSchema(Schema),
        validationSchema: Schema,
        authorize(context, args) {
            assertNpcPermission(context.profileKey, (args as Input).op);
        },
        userInputRequest: {
            when(context: UserInputRequestContext): UserInputFormSpec | null {
                const input = context.args as Input;
                if (input.op !== "promote") return null;
                return {
                    prompt: input.targetTier === "major" ? "确认擢升为主要角色" : "确认擢升为常驻 NPC",
                    layout: "dialog",
                    form: {
                        defaults: {approved: false},
                        fields: [{path: "approved", component: "radio", label: `${input.npcId}：${input.reason}`, required: true, options: [
                            {value: true, label: "确认擢升"}, {value: false, label: "暂不擢升"},
                        ], defaultValue: false}],
                    },
                };
            },
        },
        async executeWithContext(context, _toolCallId, params: unknown, userInput?: unknown) {
            const input = params as Input;
            assertNpcPermission(context.profileKey, input.op);
            const root = resolveProjectRoot(context, input.projectPath);
            switch (input.op) {
                case "get": return result(input.view === "player" ? await readRpPlayerRoster(root) : await readRpNpcState(root));
                case "register_named": return result(await registerNamedRpNpc(root, input));
                case "register_player": return result(await registerNamedRpNpc(root, {...input, origin: "player"}));
                case "suggest": return result(await suggestRpNpcPromotion(root, input));
                case "promote": {
                    if (!(userInput as {approved?: boolean} | undefined)?.approved) return result({approved: false, npcId: input.npcId});
                    return result(await promoteRpNpc(root, {...input, playerApproved: true}));
                }
                case "reject_suggestion": return result(await rejectRpNpcSuggestion(root, input.suggestionId, input.reason));
                case "set_presence": return result(await setRpNpcPresence(root, input));
                case "resources_ready": return result(await markRpNpcResourcesReady(root, input.npcId));
            }
        },
    }),
} as const;

/** 工具级职责边界：注册/出场事实归 world，建议归 screenwriter，玩家创建与确认归 leader。 */
export function assertNpcPermission(profileKey: string, operation: Input["op"]): void {
    if (operation === "get" && ["rp.leader", "rp.screenwriter", "rp.world"].includes(profileKey)) return;
    if (operation === "suggest" && profileKey === "rp.screenwriter") return;
    if (["register_player", "promote", "reject_suggestion"].includes(operation) && profileKey === "rp.leader") return;
    if (["register_named", "set_presence", "resources_ready"].includes(operation) && profileKey === "rp.world") return;
    throw new Error(`RP NPC 操作 ${operation} 不允许由 ${profileKey} 执行。`);
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
