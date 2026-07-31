import {Type} from "typebox";
import type {Static} from "typebox";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {readRpCharacterRelations, readRpRelationState} from "nbook/server/rp/relation-store";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";

const Schema = Type.Object({
    projectPath: Type.String({minLength: 1}),
    characterId: Type.Optional(Type.String({minLength: 1, description: "Omit for the complete directed graph; set for incoming/outgoing edges of one character."})),
}, {additionalProperties: false});
type Input = Static<typeof Schema>;

export const rpRelationTools = {
    rpRelation: defineAgentTool({
        key: "rp_relation",
        name: "rp_relation",
        label: "RP Directed Relations",
        executionMode: "parallel",
        description: "Read the canonical directed eight-dimensional RP relationship graph. Changes are accepted only through rp_turn commit rules, where dice basis and unauthorized avatar feelings are rejected.",
        parameters: Schema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            if (!["rp.leader", "rp.screenwriter", "rp.world"].includes(context.profileKey)) throw new Error(`RP relation read 不允许由 ${context.profileKey} 执行。`);
            const input = params as Input;
            const normalized = normalizeProjectPath(input.projectPath);
            assertProjectOpen(normalized);
            markProjectActivity(normalized);
            const root = resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
            const value = input.characterId ? await readRpCharacterRelations(root, input.characterId) : await readRpRelationState(root);
            const details = normalizeToolResultDetails(value as unknown as JsonValue);
            return {content: [{type: "text" as const, text: JSON.stringify(details, null, 2)}], details};
        },
    }),
} as const;
