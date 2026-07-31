import {Type} from "typebox";
import type {Static} from "typebox";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import {providerObjectSchema} from "nbook/server/agent/tools/provider-object-schema";
import type {ToolExecutionContext, UserInputFormSpec, UserInputRequestContext} from "nbook/server/agent/tools/types";
import {
    readRpCharacterCognition,
    readRpCognitionState,
    readRpPlayerKnowledge,
    registerRpWorldFact,
    setRpOocVisibility,
} from "nbook/server/rp/cognition-store";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";

const ProjectPath = Type.String({minLength: 1});
const Schema = Type.Union([
    Type.Object({op: Type.Literal("get_player"), projectPath: ProjectPath}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("get_character"), projectPath: ProjectPath, characterId: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("get_gm"), projectPath: ProjectPath}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("register_fact"), projectPath: ProjectPath, id: Type.String({minLength: 1}), statement: Type.String({minLength: 1}),
        status: Type.Optional(Type.Union([Type.Literal("established"), Type.Literal("disputed"), Type.Literal("superseded")])),
        importance: Type.Union([Type.Literal("normal"), Type.Literal("important"), Type.Literal("secret")]),
        tags: Type.Optional(Type.Array(Type.String({minLength: 1}))), tick: Type.Integer({minimum: 0}), source: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("set_visibility"), projectPath: ProjectPath, factId: Type.String({minLength: 1}), visible: Type.Boolean(), reason: Type.String({minLength: 1})}, {additionalProperties: false}),
]);
type Input = Static<typeof Schema>;

export const rpCognitionTools = {
    rpCognition: defineAgentTool({
        key: "rp_cognition",
        name: "rp_cognition",
        label: "RP Cognition Layers",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: "Maintain/read three strictly separate layers: objective facts, character beliefs, and player OOC knowledge. user_revealed never creates avatar_known. Character learning/rumors are committed through rp_turn rules.",
        parameters: providerObjectSchema(Schema),
        validationSchema: Schema,
        authorize(context, args) {
            assertPermission(context.profileKey, (args as Input).op);
        },
        userInputRequest: {
            when(context: UserInputRequestContext): UserInputFormSpec | null {
                const input = context.args as Input;
                if (input.op !== "set_visibility") return null;
                return {
                    prompt: input.visible ? "解除重要条目隐藏" : "重新隐藏重要条目",
                    layout: "dialog",
                    form: {
                        defaults: {approved: false},
                        fields: [{path: "approved", component: "radio", label: input.factId, required: true, options: [
                            {value: true, label: "确认"}, {value: false, label: "取消"},
                        ], defaultValue: false}],
                    },
                };
            },
        },
        async executeWithContext(context, _toolCallId, params: unknown, userInput?: unknown) {
            const input = params as Input;
            assertPermission(context.profileKey, input.op);
            const normalized = normalizeProjectPath(input.projectPath);
            assertProjectOpen(normalized);
            markProjectActivity(normalized);
            const root = resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
            switch (input.op) {
                case "get_player": return result(await readRpPlayerKnowledge(root));
                case "get_character": return result(await readRpCharacterCognition(root, input.characterId));
                case "get_gm": return result(await readRpCognitionState(root));
                case "register_fact": return result(await registerRpWorldFact(root, input));
                case "set_visibility": {
                    if (!(userInput as {approved?: boolean} | undefined)?.approved) return result({approved: false, factId: input.factId});
                    return result(await setRpOocVisibility(root, input.factId, input.visible, input.reason));
                }
            }
        },
    }),
} as const;

export function assertPermission(profileKey: string, operation: Input["op"]): void {
    if (operation === "get_player" && profileKey === "rp.leader") return;
    if (operation === "get_character" && ["rp.leader", "rp.screenwriter"].includes(profileKey)) return;
    if (operation === "get_gm" && ["rp.leader", "rp.screenwriter", "rp.world"].includes(profileKey)) return;
    if (operation === "register_fact" && profileKey === "rp.world") return;
    if (operation === "set_visibility" && profileKey === "rp.leader") return;
    throw new Error(`RP cognition 操作 ${operation} 不允许由 ${profileKey} 执行。`);
}

function result(value: object) {
    const details = normalizeToolResultDetails(value as unknown as JsonValue);
    return {content: [{type: "text" as const, text: JSON.stringify(details, null, 2)}], details};
}
