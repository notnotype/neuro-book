import {Type} from "typebox";
import type {Static, TSchema} from "typebox";
import type {JsonValue as AgentJsonValue} from "nbook/server/agent/messages/types";
import type {NeuroAgentTool, NeuroToolResult, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {buildExecuteWorldDescription} from "nbook/server/agent/world-engine-tool-description";
import type {ExecuteWorldMode} from "nbook/server/world-engine/world-engine.facade";
import {randomBytes} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {resolveSessionFileScope} from "nbook/server/agent/workspace/session-file-scope";
import {worldEngineFacadeForWorkspaceRoot} from "nbook/server/world-engine";

const NonEmptyString = (description: string) => Type.String({minLength: 1, description});

const ExecuteWorldSchema = Type.Object({
    projectPath: NonEmptyString("Required Project Workspace path, e.g. workspace/silver-dragon-hime."),
    code: Type.String({minLength: 1, description: "Inline JavaScript code to execute in the World Engine CodeAct sandbox."}),
    worldKey: Type.Optional(Type.Union([Type.Literal("main"), Type.Literal("rp")], {
        description: "World timeline to operate on. Omit or \"main\" = writing-mode world (default, config root world-engine/). \"rp\" = the fully isolated RP-mode world (own config root rp/world-engine/, own database; no fallback to main).",
    })),
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
                    const facade = worldEngineFacadeForWorkspaceRoot(context.workspaceFsRoot);
                    const result = await facade.executeCodeActWorld(input.projectPath, input.code, mode, {worldKey: input.worldKey ?? "main"});
                    return worldResult(result);
                } catch (error) {
                    const tempPath = await saveTempCode(context, input.code);
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    throw new Error(`世界引擎脚本执行失败：${errorMessage}\n失败的代码已保存到：${tempPath}`);
                }
            },
        ),
    ];
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

/** 保存失败的 CodeAct 脚本，方便用户或后续 agent 复查。 */
async function saveTempCode(context: ToolExecutionContext, code: string): Promise<string> {
    const tempDir = join(resolveSessionFileScope(context).root, ".temp");
    await mkdir(tempDir, {recursive: true});

    const hash = randomBytes(6).toString("hex");
    const filename = `world-execute-${hash}.js`;
    const fullPath = join(tempDir, filename);

    await writeFile(fullPath, code, "utf-8");
    return `.temp/${filename}`;
}
