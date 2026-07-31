import {Type} from "typebox";
import type {Static} from "typebox";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import {providerObjectSchema} from "nbook/server/agent/tools/provider-object-schema";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {
    beginRpBootstrap,
    failRpBootstrap,
    readRpIntake,
    reviewRpIntake,
    RP_BOOTSTRAP_STAGES,
    updateRpIntakeField,
} from "nbook/server/rp/intake-store";
import {activateRpAdventure, checkpointRpBootstrap, initializeRpBootstrapConfig} from "nbook/server/rp/bootstrap-store";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";

const ProjectPathField = Type.String({minLength: 1, description: "Project Workspace path, e.g. workspace/my-novel."});

const IntakeSchema = Type.Union([
    Type.Object({
        op: Type.Literal("get"),
        projectPath: ProjectPathField,
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("update_field"),
        projectPath: ProjectPathField,
        field: Type.Union([
            Type.Literal("source"),
            Type.Literal("premise"),
            Type.Literal("avatar"),
            Type.Literal("playStyle"),
            Type.Literal("systems"),
            Type.Literal("boundaries"),
            Type.Literal("initialMap"),
            Type.Literal("opening"),
        ]),
        status: Type.Union([
            Type.Literal("missing"),
            Type.Literal("provisional"),
            Type.Literal("confirmed"),
            Type.Literal("conflict"),
            Type.Literal("disabled"),
        ]),
        // 工具输入是外部 JSON seam，Type.Unknown 仅用于在执行入口接收后收口为 JsonValue。
        value: Type.Unknown({description: "JSON value for the field. Use null only when status=missing."}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("review"),
        projectPath: ProjectPathField,
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("begin_bootstrap"),
        projectPath: ProjectPathField,
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("initialize_config"),
        projectPath: ProjectPathField,
        calendarPreset: Type.Union([
            Type.Literal("gregorian"),
            Type.Literal("simple"),
        ], {description: "Use gregorian for modern/urban/school settings; simple for fixed-length fictional calendars."}),
        eraBefore: Type.Optional(Type.String({minLength: 1, description: "Optional era name before instant zero."})),
        eraAfter: Type.Optional(Type.String({minLength: 1, description: "Optional era name at/after instant zero."})),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("checkpoint_bootstrap"),
        projectPath: ProjectPathField,
        stage: Type.Union(RP_BOOTSTRAP_STAGES.map((stage) => Type.Literal(stage))),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("fail_bootstrap"),
        projectPath: ProjectPathField,
        message: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("activate"),
        projectPath: ProjectPathField,
    }, {additionalProperties: false}),
]);

type IntakeInput = Static<typeof IntakeSchema>;

export const rpIntakeTools = {
    rpIntake: defineAgentTool({
        key: "rp_intake",
        name: "rp_intake",
        label: "RP Adventure Intake",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: [
            "Persistent RP adventure-intake state in Project Workspace .nbook (not formal rp/ content).",
            "Call get before any new-adventure conversation. Update exactly one field whenever the user answers; provisional means host proposal awaiting final review.",
            "Call review only after all required fields are resolved, show the complete plan, then stop the turn and direct the player to the RP status panel's confirm-and-start button.",
            "The Agent cannot confirm a plan. After the status-panel action records confirmedVersion, call get and then begin_bootstrap; the server binds the confirmed version automatically.",
            "Bootstrap is a server-enforced sequence: config, world, map, characters, opening_event, narrative. In config call initialize_config to generate a trusted Zod Schema and Calendar; do not hand-write those TypeScript files. Use gregorian for modern/urban/school settings and simple for fixed-length fictional calendars.",
            "After finishing each current stage call checkpoint_bootstrap with that stage. Call activate only after the server returns ready_to_activate. Validation failures remain at the same stage, record the real error, and allow correction plus direct checkpoint retry.",
        ].join("\n"),
        parameters: providerObjectSchema(IntakeSchema),
        validationSchema: IntakeSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as IntakeInput;
            const projectRoot = resolveProjectRoot(context, input.projectPath);
            switch (input.op) {
                case "get":
                    return result(await readRpIntake(projectRoot));
                case "update_field":
                    return result(await updateRpIntakeField(projectRoot, input.field, {
                        status: input.status,
                        value: input.value as JsonValue,
                    }));
                case "review":
                    return result(await reviewRpIntake(projectRoot));
                case "begin_bootstrap":
                    return result(await beginRpBootstrap(projectRoot));
                case "initialize_config":
                    return result(await initializeRpBootstrapConfig(projectRoot, {
                        calendarPreset: input.calendarPreset,
                        eraBefore: input.eraBefore,
                        eraAfter: input.eraAfter,
                    }), "已写入并加载服务端标准 RP Schema/Calendar。");
                case "checkpoint_bootstrap":
                    return result(await checkpointRpBootstrap(projectRoot, input.stage));
                case "fail_bootstrap":
                    return result(await failRpBootstrap(projectRoot, input.message));
                case "activate":
                    return result(await activateRpAdventure(projectRoot));
            }
        },
    }),
} as const;

/** 将工具传入的 Project Workspace 路径解析到物理项目根。 */
function resolveProjectRoot(context: ToolExecutionContext, projectPath: string): string {
    const normalized = normalizeProjectPath(projectPath);
    assertProjectOpen(normalized);
    markProjectActivity(normalized);
    return resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
}

function result(state: Awaited<ReturnType<typeof readRpIntake>>, message?: string) {
    const details = normalizeToolResultDetails(state as unknown as JsonValue);
    return {
        content: [{type: "text" as const, text: message ? `${message}\n${JSON.stringify(details, null, 2)}` : JSON.stringify(details, null, 2)}],
        details,
    };
}
