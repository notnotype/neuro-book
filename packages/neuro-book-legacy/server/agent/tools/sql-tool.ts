import {Type} from "typebox";
import type {Static} from "typebox";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {
    AGENT_SQL_ROW_LIMIT,
    PROJECT_AGENT_SQL_MODULE_TOKEN,
    type ExecuteSqlResult,
} from "nbook/server/agent/tools/agent-sql-project-module";
import type {NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";

const ExecuteSqlSchema = Type.Object({
    sql: Type.String({description: "A single Project SQLite statement: SELECT / WITH / INSERT / UPDATE / DELETE. DDL, transaction control, PRAGMA, ATTACH/DETACH, and multi-statement queries are prohibited."}),
});

/** 创建只负责Agent上下文适配的execute_sql工具。 */
export function createSqlTool(): NeuroAgentTool {
    return {
        key: "execute_sql",
        name: "execute_sql",
        label: "Execute SQL",
        executionMode: "sequential",
        description: buildSqlToolDescription(),
        parameters: ExecuteSqlSchema,
        async execute() {
            throw new Error("execute_sql 需要 v3 session context，并且只能访问当前 Project Workspace 的 .nbook/project.sqlite。");
        },
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as Static<typeof ExecuteSqlSchema>;
            const result = await executeSql(context, input.sql);
            return {
                content: [{type: "text", text: JSON.stringify(result, null, 2)}],
                details: result as unknown as JsonValue,
            };
        },
    };
}

/** 构建provider可见的execute_sql稳定能力说明。 */
function buildSqlToolDescription(): string {
    return [
        "Execute a single SQL statement against the current Project Workspace SQLite database.",
        "Target database is fixed to the current Project Workspace .nbook/project.sqlite.",
        "The tool has no sqlitePath/databasePath parameter and cannot access App SQLite.",
        "Allowed: SELECT / WITH / INSERT / UPDATE / DELETE.",
        "Prohibited: DDL, transaction control, session control, PRAGMA, ATTACH/DETACH, VACUUM, and multi-statement queries.",
        `Query rows are capped at ${String(AGENT_SQL_ROW_LIMIT)}.`,
        "Use read/write/edit/apply_patch for manuscript or document files; execute_sql is only for structured Project SQLite data.",
        "SQLite dialect: quote business table and camelCase column names with double quotes when unsure, e.g. SELECT id, title FROM \"StoryThread\" ORDER BY \"createdAt\" DESC.",
        "Schema discovery uses sqlite_schema and PRAGMA table_info / foreign_key_list internally; agents may not execute PRAGMA directly.",
        "Raw SQL does not apply Prisma @updatedAt client semantics; update \"updatedAt\" explicitly when needed.",
    ].join("\n");
}

/** 使用 invocation admission 捕获的 ready Project generation 调用其 lazy SQL handle。 */
async function executeSql(context: ToolExecutionContext, sql: string): Promise<ExecuteSqlResult> {
    if (!context.invocationId) {
        throw new Error("execute_sql 缺少 invocationId，无法读取已捕获的 Project generation。");
    }
    const ready = context.harness.projectForInvocation(context.invocationId);
    if (!ready) {
        throw new Error("execute_sql 需要当前 session 位于具体 Project Workspace；目标固定为该项目的 .nbook/project.sqlite。");
    }
    const {activateReadyProjectModule} = await import("nbook/server/runtime/product-project");
    const handle = await activateReadyProjectModule(ready, PROJECT_AGENT_SQL_MODULE_TOKEN);
    return handle.execute(sql);
}
