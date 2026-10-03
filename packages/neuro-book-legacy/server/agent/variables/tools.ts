import {Type} from "typebox";
import type {Static} from "typebox";
import type {NeuroAgentTool} from "nbook/server/agent/tools/types";
import type {VariableJsonPatchOperation, VariableNamespace} from "nbook/server/agent/variables/types";

const NamespaceSchema = Type.Union([
    Type.Literal("client"),
    Type.Literal("global"),
    Type.Literal("project"),
    Type.Literal("session"),
]);

const VariableSchemaQuerySchema = Type.Object({
    namespace: Type.Optional(NamespaceSchema),
    prefix: Type.Optional(Type.String({description: "Namespace-relative prefix, for example affections."})),
    paths: Type.Optional(Type.Array(Type.String({description: "Full variable path, for example project.affections."}))),
    writableOnly: Type.Optional(Type.Boolean()),
    detail: Type.Optional(Type.Boolean()),
});

const VariableReadSchema = Type.Object({
    namespace: NamespaceSchema,
    path: Type.String({description: "Namespace-relative registered variable path, for example affections.alice."}),
    maxBytes: Type.Optional(Type.Integer({minimum: 256, maximum: 20000})),
});

const JsonPatchOperationSchema = Type.Union([
    Type.Object({
        op: Type.Union([Type.Literal("add"), Type.Literal("replace"), Type.Literal("test")]),
        path: Type.String({description: "JSON Pointer relative to the selected target. Use empty string to replace the whole target."}),
        value: Type.Unknown(),
    }),
    Type.Object({
        op: Type.Literal("remove"),
        path: Type.String({description: "JSON Pointer relative to the selected target."}),
    }),
]);

const VariablePatchSchema = Type.Object({
    namespace: NamespaceSchema,
    path: Type.String({description: "Namespace-relative registered variable path. Empty namespace root is not allowed."}),
    patch: Type.Array(JsonPatchOperationSchema, {minItems: 1}),
});

/**
 * 变量系统工具。Agent 修改变量时应先 schema/read，再 patch，重要变更后再次 read 验证。
 */
export function createVariableTools(): NeuroAgentTool[] {
    return [
        {
            key: "variable_schema",
            name: "variable_schema",
            label: "Variable Schema",
            executionMode: "parallel",
            description: "Inspect focused registered variable schemas. Pass namespace/prefix or full paths; do not request an unfiltered full dump.",
            parameters: VariableSchemaQuerySchema,
            async execute() {
                throw new Error("variable_schema 必须在 Agent session 上下文中执行。");
            },
            async executeWithContext(context, _toolCallId, params: unknown) {
                const query = params as Static<typeof VariableSchemaQuerySchema>;
                if (!query.namespace && !query.paths?.length) {
                    throw new Error("variable_schema 需要 namespace 或 paths，避免无参数全量 dump。");
                }
                if (!context.vars) {
                    throw new Error("当前工具上下文没有变量访问器。");
                }
                const result = context.vars.catalog({
                    namespace: query.namespace,
                    prefix: query.prefix,
                    paths: query.paths,
                    writableOnly: query.writableOnly,
                    detail: query.detail,
                });
                return {
                    content: [{type: "text", text: JSON.stringify(query.detail ? result : {catalog: result.catalog, schemas: result.schemas, issues: result.issues}, null, 2)}],
                    details: result as never,
                };
            },
        },
        {
            key: "variable_read",
            name: "variable_read",
            label: "Variable Read",
            executionMode: "parallel",
            description: "Read a registered variable value by namespace and path. Large values may be truncated; narrow the path for detail.",
            parameters: VariableReadSchema,
            async execute() {
                throw new Error("variable_read 必须在 Agent session 上下文中执行。");
            },
            async executeWithContext(context, _toolCallId, params: unknown) {
                const query = params as Static<typeof VariableReadSchema>;
                if (!context.vars) {
                    throw new Error("当前工具上下文没有变量访问器。");
                }
                const result = await context.vars.read(`${query.namespace}.${query.path}`, {maxBytes: query.maxBytes});
                const text = result.issue ? result.issue.message : JSON.stringify(result, null, 2);
                return {content: [{type: "text", text}], details: result as never};
            },
        },
        {
            key: "variable_patch",
            name: "variable_patch",
            label: "Variable Patch",
            executionMode: "sequential",
            description: "Patch one writable registered variable target with RFC 6902 JSON Patch. After important changes, call variable_read to verify.",
            parameters: VariablePatchSchema,
            async execute() {
                throw new Error("variable_patch 必须在 Agent session 上下文中执行。");
            },
            async executeWithContext(context, toolCallId, params: unknown) {
                const query = params as Static<typeof VariablePatchSchema>;
                if (!context.vars) {
                    throw new Error("当前工具上下文没有变量访问器。");
                }
                const result = await context.vars.patch(query.namespace as VariableNamespace, query.path, query.patch as VariableJsonPatchOperation[], "agent", toolCallId);
                if (result.issue) {
                    throw new Error(result.issue.message);
                }
                return {content: [{type: "text", text: `patched ${query.namespace}.${query.path}`}], details: result as never};
            },
        },
    ];
}
