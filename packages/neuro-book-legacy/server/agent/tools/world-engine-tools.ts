import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import type {JsonValue as AgentJsonValue} from "nbook/server/agent/messages/types";
import type {NeuroAgentTool, NeuroToolResult, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {buildExecuteWorldDescription} from "nbook/server/agent/world-engine-tool-description";
import type {ExecuteWorldMode} from "nbook/server/world-engine/world-engine.facade";
import {PROJECT_PLOT_WORLD_MODULE_TOKEN} from "nbook/server/plot";
import {
    activateReadyProjectModule,
    requireActiveReadyProject,
    runReadyProjectOperation,
} from "nbook/server/runtime/product-project";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";

const NonEmptyString = (description: string) => Type.String({minLength: 1, description});

const ExecuteWorldSchema = Type.Object({
    projectRoot: Type.Optional(NonEmptyString("Optional single-segment Project root for an explicit cross-Project call.")),
    code: Type.String({minLength: 1, description: "Inline JavaScript code to execute in the World Engine CodeAct sandbox."}),
}, {
    additionalProperties: false,
});

/** 构造 World Engine Agent 工具。 */
export function createWorldEngineTools(): NeuroAgentTool[] {
    return [
        tool(
            "execute_world",
            buildExecuteWorldDescription("readwrite"),
            ExecuteWorldSchema,
            async (context, input) => {
                const mode = modeForContext(context);
                try {
                    const ready = worldProjectForTool(context, input.projectRoot);
                    return await runReadyProjectOperation(ready, async () => {
                        const {world: facade} = await activateReadyProjectModule(
                            ready,
                            PROJECT_PLOT_WORLD_MODULE_TOKEN,
                        );
                        const result = await facade.executeCodeActWorld(input.code, mode);
                        return worldResult(result);
                    });
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    throw new Error(`世界引擎脚本执行失败：${errorMessage}`, {cause: error});
                }
            },
        ),
    ];
}

/** Current Project复用工具上下文的exact ref；显式跨Project root要求目标已ready。 */
function worldProjectForTool(context: ToolExecutionContext, projectRootInput?: string): ReadyProjectSessionRef {
    if (projectRootInput === undefined) {
        if (!context.currentProject) {
            throw new Error("execute_world 需要当前已打开的 Project；未绑定 Project 时请先打开目标 Project，或显式提供 projectRoot。");
        }
        return context.currentProject;
    }
    const ref = projectWorkspaceRef(projectRootInput);
    const currentProject = context.currentProject;
    if (currentProject?.workspace.ref.projectRoot === ref.projectRoot) {
        return currentProject;
    }
    return requireActiveReadyProject(ref);
}

function tool<TSchemaValue extends TSchema>(
    key: string,
    description: string,
    parameters: TSchemaValue,
    execute: (context: ToolExecutionContext, input: Static<TSchemaValue>) => Promise<NeuroToolResult>,
): NeuroAgentTool {
    return {
        key,
        name: key,
        label: key,
        executionMode: "sequential",
        description,
        parameters,
        async execute() {
            throw new Error(`${key} 需要 v3 session context。`);
        },
        async executeWithContext(context, _toolCallId, params: unknown) {
            return execute(context, params as Static<TSchemaValue>);
        },
    };
}

function modeForContext(context: ToolExecutionContext): ExecuteWorldMode {
    return context.profileKey === "writer" ? "readonly" : "readwrite";
}

function worldResult(details: unknown): NeuroToolResult {
    const normalized = normalizeToolDetails(details);
    return {
        content: [{type: "text" as const, text: renderWorldResultText(normalized)}],
        details: normalized,
    };
}

function renderWorldResultText(details: AgentJsonValue): string {
    if (isRecord(details) && typeof details.data === "string" && Array.isArray(details.issues)) {
        if (details.issues.length === 0) {
            return details.data;
        }
        return `${details.data}\n\nissues:\n${JSON.stringify(details.issues, null, 2)}`;
    }
    return JSON.stringify(details, null, 2);
}

function isRecord(value: AgentJsonValue): value is Record<string, AgentJsonValue> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolDetails(value: unknown): AgentJsonValue {
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (value === undefined) {
        return null;
    }
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(normalizeToolDetails);
    }
    if (typeof value === "object") {
        return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, normalizeToolDetails(item)]));
    }
    return String(value);
}
