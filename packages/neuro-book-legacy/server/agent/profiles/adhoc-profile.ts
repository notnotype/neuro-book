import {Type, type Static} from "typebox";
import type {TSchema} from "typebox";
import {Compile, IsSchema} from "typebox/schema";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";

/**
 * ad-hoc agent 的创建参数（Task 111 PLAN-E E3 定稿）：纯数据 spec，不是代码 DSL。
 * - initial = 角色（稳定）；任务内容走 invoke.message（不设 humanMessage/inputSchema）；
 * - outputSchema 是 JSON Schema 对象（typebox Type.Object 产物或裸字面量都合法），
 *   动态成为该 session report_result 的 dataSchema；
 * - V1 不开 tools 白名单字段：固定工具集 = read + report_result（防临时工提权；二期再议）。
 */
export const AdhocInitialSchema = Type.Object({
    name: Type.Optional(Type.String({description: "角色名（写进 system prompt；session 标题请在创建时用 title 传）。"})),
    systemPrompt: Type.String({description: "该临时 agent 的完整角色设定与工作要求；few-shot 示例也写在这里。"}),
    outputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
        description: "JSON Schema object for the structured result. When set, report_result.data must match it.",
    })),
}, {additionalProperties: false});

export type AdhocInitial = Static<typeof AdhocInitialSchema>;

const JSON_SCHEMA_TYPES = new Set(["null", "boolean", "object", "array", "number", "integer", "string"]);

/**
 * 校验用户提供 JSON Schema 的结构关键字。
 * JSON Schema 允许未知注解关键字，因此只严格校验会改变验证语义的标准字段及其嵌套 schema。
 */
function assertJsonSchema(schema: unknown, path = "adhoc.outputSchema"): asserts schema is TSchema {
    if (!IsSchema(schema) || Array.isArray(schema)) {
        throw new Error(`${path} 必须是合法 JSON Schema 对象`);
    }
    const record = schema as Record<string, unknown>;
    if (record.type !== undefined) {
        const types = Array.isArray(record.type) ? record.type : [record.type];
        if (types.length === 0 || types.some((type) => typeof type !== "string" || !JSON_SCHEMA_TYPES.has(type))) {
            throw new Error(`${path}.type 不是合法 JSON Schema 类型`);
        }
    }
    if (record.required !== undefined && (!Array.isArray(record.required) || record.required.some((key) => typeof key !== "string"))) {
        throw new Error(`${path}.required 必须是字符串数组`);
    }
    if (record.properties !== undefined) {
        if (!record.properties || typeof record.properties !== "object" || Array.isArray(record.properties)) {
            throw new Error(`${path}.properties 必须是 schema 映射`);
        }
        for (const [key, child] of Object.entries(record.properties)) assertJsonSchema(child, `${path}.properties.${key}`);
    }
    for (const key of ["items", "additionalProperties", "contains", "not", "if", "then", "else"] as const) {
        if (record[key] !== undefined && typeof record[key] !== "boolean") assertJsonSchema(record[key], `${path}.${key}`);
    }
    for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"] as const) {
        if (record[key] === undefined) continue;
        if (!Array.isArray(record[key]) || record[key].length === 0) throw new Error(`${path}.${key} 必须是非空 schema 数组`);
        record[key].forEach((child, index) => assertJsonSchema(child, `${path}.${key}[${index}]`));
    }
}

/** 从 initial 提取 outputSchema；显式传入但非法时 fail closed，禁止静默退化成文本输出。 */
function outputSchemaFromInitial(initial: JsonValue | null): TSchema | undefined {
    if (!initial || typeof initial !== "object" || Array.isArray(initial)) return undefined;
    const schema = (initial as {outputSchema?: unknown}).outputSchema;
    if (schema === undefined) return undefined;
    assertJsonSchema(schema);
    try {
        Compile(schema);
    } catch (error) {
        throw new Error(`adhoc.outputSchema 无法编译：${error instanceof Error ? error.message : String(error)}`);
    }
    return schema as TSchema;
}

/**
 * 内置 ad-hoc profile：用「提示词 + 输出 schema」直接造一个一次性 agent，不写 profile 文件。
 * 消费面：create_agent({profileKey: "adhoc", initial}) 与 workflow 内 wf.agents.create("adhoc", {initial, model, ephemeral: true})。
 */
export const adhocAgentProfile = defineAgentProfile({
    manifest: {
        key: "adhoc",
        name: "临时 Agent",
        description: "按提示词临时定义的一次性 agent：initial.systemPrompt 定角色，可选 initial.outputSchema 约束 report_result.data 结构化输出。适合 workflow 内的并发帮工（配 ephemeral: true）。",
    },
    initialSchema: AdhocInitialSchema,
    tools: toolset(
        builtin.file.read,
        builtin.result.main({dataSchemaFromInitial: outputSchemaFromInitial}),
    ),
    prepare(ctx) {
        const initial = ctx.initial as AdhocInitial;
        const hasSchema = outputSchemaFromInitial(initial as JsonValue) !== undefined;
        return {
            systemPrompt: [
                initial.name ? `你的角色：${initial.name}。` : "",
                initial.systemPrompt,
                "",
                "# 汇报纪律",
                hasSchema
                    ? "任务完成后必须调用 report_result：result 写简短可读结论，data 必须符合工具参数中声明的结构（不要输出多余字段）。"
                    : "任务完成后调用 report_result，把结论写进 result。",
            ].filter(Boolean).join("\n"),
        };
    },
});
