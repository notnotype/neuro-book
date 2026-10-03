import {createClient} from "@libsql/client";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {PROJECT_DATABASE_MODULE_TOKEN} from "nbook/server/workspace-files/project-database-module";
import {
    projectModuleToken,
    registerProjectModule,
    type ProjectModule,
    type ProjectModuleHandle,
} from "nbook/server/workspace-files/project-module";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";

export const AGENT_SQL_ROW_LIMIT = 200;

const SQLITE_TABLE_QUERY = `
    SELECT name AS "tableName"
    FROM sqlite_schema
    WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name <> '_prisma_migrations'
    ORDER BY name ASC
`;
const AGENT_SQL_DETAIL_TABLES = new Set(["Story", "StoryPhase", "StoryThread", "StoryScene", "StorySceneRef", "ProjectMetadata"]);

type AgentSqlSchemaRow = {
    tableName: string;
    columnName: string;
    ordinalPosition: number;
    isNullable: "YES" | "NO";
    columnDefault: string | null;
    dataType: string;
    udtName: string;
};

type AgentSqlForeignKeyRow = {
    tableName: string;
    columnName: string;
    foreignTableName: string;
    foreignColumnName: string;
};

type AgentSqlCommand = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export type ExecuteSqlResult = {
    mode: "read" | "write";
    command: AgentSqlCommand;
    rowCount: number;
    rows: Record<string, unknown>[];
    effects: {
        refreshChapterTree: boolean;
    };
};

/** Agent SQL Module当前generation持有的数据库访问资源。 */
export interface ProjectAgentSqlHandle extends ProjectModuleHandle {
    /** 在当前generation的Project SQLite执行一条受限SQL。 */
    execute(sql: string): Promise<ExecuteSqlResult>;
    /** 读取当前generation共享的Project SQLite schema摘要。 */
    schemaSummary(): Promise<string>;
}

/** Agent SQL对libSQL外部边界的最小依赖，便于验证generation资源所有权。 */
export type ProjectAgentSqlClient = {
    execute(statement: string): Promise<{
        readonly rows: readonly Record<string, unknown>[];
        readonly rowsAffected: number;
    }>;
    close(): Promise<void> | void;
};

/** Project Agent SQL Module的外部资源Adapter。 */
export type ProjectAgentSqlModuleDependencies = {
    openClient(databasePath: AbsoluteFsPath): ProjectAgentSqlClient;
    clientClosed(): void;
};

/** Project Agent SQL的稳定typed token。 */
export const PROJECT_AGENT_SQL_MODULE_TOKEN = projectModuleToken<ProjectAgentSqlHandle>(
    "agent-sql",
    "lazy",
);

/** 构造generation-scoped lazy Agent SQL Module。 */
export function createProjectAgentSqlModule(
    dependencies: ProjectAgentSqlModuleDependencies,
): ProjectModule<ProjectAgentSqlHandle> {
    return Object.freeze({
        token: PROJECT_AGENT_SQL_MODULE_TOKEN,

        /** 同步绑定同generation Database handle，并把重资源延迟到首次SQL访问。 */
        start(context) {
            const database = context.require(PROJECT_DATABASE_MODULE_TOKEN);
            const ready = Promise.resolve().then(() => context.signal.throwIfAborted());
            let state: "open" | "closing" | "closing_failed" | "closed" = "open";
            let client: ProjectAgentSqlClient | null = null;
            let clientPromise: Promise<ProjectAgentSqlClient> | null = null;
            let schemaSummaryPromise: Promise<string> | null = null;
            let closePromise: Promise<void> | null = null;

            /** 首次数据面访问才打开当前generation Database handle发布的精确路径。 */
            async function useGenerationClient(): Promise<ProjectAgentSqlClient> {
                await ready;
                context.signal.throwIfAborted();
                if (state !== "open") {
                    throw new Error("Project Agent SQL handle已经开始关闭");
                }
                if (!clientPromise) {
                    const opening = database.databasePath.then((databasePath) => {
                        context.signal.throwIfAborted();
                        if (state !== "open") {
                            throw new Error("Project Agent SQL handle已经开始关闭");
                        }
                        const openedClient = dependencies.openClient(databasePath);
                        client = openedClient;
                        return openedClient;
                    }).catch((error: unknown) => {
                        if (clientPromise === opening && client === null) {
                            clientPromise = null;
                        }
                        throw error;
                    });
                    clientPromise = opening;
                }
                return clientPromise;
            }

            return Object.freeze({
                ready,
                /** SQL执行始终复用本handle自己的client，不跨generation切槽。 */
                async execute(sql: string): Promise<ExecuteSqlResult> {
                    const normalized = normalizeSql(sql);
                    validateExecuteSql(normalized);
                    return executeWithClient(await useGenerationClient(), normalized);
                },
                /** schema summary在当前generation内单飞并缓存，不跨Project或重开复用。 */
                async schemaSummary(): Promise<string> {
                    if (!schemaSummaryPromise) {
                        const loading = readSchemaSummary(await useGenerationClient()).catch((error: unknown) => {
                            if (schemaSummaryPromise === loading) {
                                schemaSummaryPromise = null;
                            }
                            throw error;
                        });
                        schemaSummaryPromise = loading;
                    }
                    return schemaSummaryPromise;
                },
                /** 关闭本handle捕获的精确client；其他generation不受影响。 */
                async close(): Promise<void> {
                    if (state === "closed") {
                        return undefined;
                    }
                    if (closePromise) {
                        return closePromise;
                    }
                    state = "closing";
                    let closedSuccessfully = false;
                    const closing = (async (): Promise<void> => {
                        if (clientPromise) {
                            try {
                                await clientPromise;
                            } catch {
                                // client尚未创建时无需把数据面opening失败升级为close失败。
                            }
                        }
                        if (client) {
                            await client.close();
                            dependencies.clientClosed();
                            client = null;
                            clientPromise = null;
                        }
                        schemaSummaryPromise = null;
                        state = "closed";
                        closedSuccessfully = true;
                    })();
                    closePromise = closing;
                    try {
                        await closing;
                    } finally {
                        if (!closedSuccessfully) {
                            state = "closing_failed";
                            closePromise = null;
                        }
                    }
                },
            });
        },
    });
}

/** 生产Agent SQL Module使用真实libSQL client并登记句柄释放。 */
export const projectAgentSqlModule = createProjectAgentSqlModule({
    openClient(databasePath) {
        return createClient({url: toSqliteFileUrl(databasePath)});
    },
    clientClosed() {
        collectReleasedSqliteHandles();
    },
});

registerProjectModule(projectAgentSqlModule);

/** 根据 schema 查询结果生成 Agent SQL 摘要。 */
export function buildAgentSqlSchemaSummary(rows: AgentSqlSchemaRow[], foreignKeys: AgentSqlForeignKeyRow[]): string {
    if (rows.length === 0) {
        return "当前 Project SQLite 尚未发现业务表，请先确认项目数据库是否完成初始化。";
    }

    const tableColumns = new Map<string, string[]>();
    const detailedTableColumns = new Map<string, AgentSqlSchemaRow[]>();
    const foreignKeyMap = new Map<string, AgentSqlForeignKeyRow>();

    for (const foreignKey of foreignKeys) {
        foreignKeyMap.set(`${foreignKey.tableName}.${foreignKey.columnName}`, foreignKey);
    }
    for (const row of rows) {
        tableColumns.set(row.tableName, [...tableColumns.get(row.tableName) ?? [], formatSummaryColumnName(row.columnName)]);
        detailedTableColumns.set(row.tableName, [...detailedTableColumns.get(row.tableName) ?? [], row]);
    }

    const lines = ["当前 Project SQLite 业务表（表名和 camelCase 字段按原样双引号引用最稳）："];
    for (const tableName of Array.from(AGENT_SQL_DETAIL_TABLES.values()).filter((name) => tableColumns.has(name))) {
        lines.push(`${quoteIdentifier(tableName)}:`);
        for (const row of detailedTableColumns.get(tableName) ?? []) {
            const flags = [
                row.isNullable === "NO" ? "NOT NULL" : "NULLABLE",
                formatColumnDefault(row.columnDefault),
            ];
            const foreignKey = foreignKeyMap.get(`${row.tableName}.${row.columnName}`);
            if (foreignKey) {
                flags.push(`FK -> ${quoteIdentifier(foreignKey.foreignTableName)}.${formatSummaryColumnName(foreignKey.foreignColumnName)}`);
            }
            if (row.columnName === "tags") {
                flags.push("JSON array persisted as string[] DTO");
            }
            lines.push(`- ${formatSummaryColumnName(row.columnName)}: ${formatSummaryDataType(row)}; ${flags.join("; ")}`);
        }
    }

    const compactTables = Array.from(tableColumns.entries()).filter(([tableName]) => !AGENT_SQL_DETAIL_TABLES.has(tableName));
    if (compactTables.length > 0) {
        lines.push("其他业务表简表：");
        compactTables.forEach(([tableName, columns], index) => {
            lines.push(`${String(index + 1)}. ${quoteIdentifier(tableName)}(${columns.join(", ")})`);
        });
    }
    return lines.join("\n");
}

/** 从当前generation client读取并格式化Project SQLite schema。 */
async function readSchemaSummary(client: ProjectAgentSqlClient): Promise<string> {
    const tablesResult = await client.execute(SQLITE_TABLE_QUERY);
    const tableNames = tablesResult.rows.map((row) => String(row.tableName));
    const rows: AgentSqlSchemaRow[] = [];
    const foreignKeys: AgentSqlForeignKeyRow[] = [];

    for (const tableName of tableNames) {
        const columns = await client.execute(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
        rows.push(...columns.rows.map((row) => ({
            tableName,
            columnName: String(row.name),
            ordinalPosition: Number(row.cid) + 1,
            isNullable: Number(row.notnull) === 1 || Number(row.pk) === 1 ? "NO" as const : "YES" as const,
            columnDefault: row.dflt_value === null || row.dflt_value === undefined ? null : String(row.dflt_value),
            dataType: String(row.type || "TEXT"),
            udtName: String(row.type || "TEXT"),
        })));

        const fkRows = await client.execute(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`);
        foreignKeys.push(...fkRows.rows.map((row) => ({
            tableName,
            columnName: String(row.from),
            foreignTableName: String(row.table),
            foreignColumnName: String(row.to),
        })));
    }
    return buildAgentSqlSchemaSummary(rows, foreignKeys);
}

/** 统一去除首尾空白和末尾分号。 */
function normalizeSql(sql: string): string {
    return sql.trim().replace(/;+$/g, "").trim();
}

/** 安全引用SQLite identifier。 */
function quoteIdentifier(value: string): string {
    return `"${value.replaceAll("\"", "\"\"")}"`;
}

/** camelCase字段在摘要中显式引用。 */
function formatSummaryColumnName(columnName: string): string {
    return /[A-Z]/.test(columnName) ? quoteIdentifier(columnName) : columnName;
}

/** 把数据库类型规范化为Agent可读名称。 */
function formatSummaryDataType(row: AgentSqlSchemaRow): string {
    return row.dataType.toUpperCase() === "JSONB" ? "JSON" : row.dataType;
}

/** 把SQLite默认值格式化为摘要标记。 */
function formatColumnDefault(value: string | null): string {
    if (!value) {
        return "无默认值";
    }
    if (value.includes("CURRENT_TIMESTAMP")) {
        return "DEFAULT CURRENT_TIMESTAMP";
    }
    if (value.toUpperCase().includes("AUTOINCREMENT")) {
        return "DEFAULT 自增";
    }
    return `DEFAULT ${value}`;
}

/** 读取标准化SQL的首关键字。 */
function getSqlLeadingKeyword(sql: string): string {
    return normalizeSql(sql).match(/^[a-zA-Z]+/)?.[0]?.toLowerCase() ?? "";
}

/** 判断语句是否走只读行数限制包装。 */
function isReadSql(sql: string): boolean {
    const leadingKeyword = getSqlLeadingKeyword(sql);
    return leadingKeyword === "select" || leadingKeyword === "with";
}

/** 把允许的SQL首关键字映射为稳定命令类型。 */
function detectSqlCommand(sql: string): AgentSqlCommand {
    const leadingKeyword = getSqlLeadingKeyword(sql);
    if (leadingKeyword === "select" || leadingKeyword === "with") {
        return "SELECT";
    }
    if (leadingKeyword === "insert") {
        return "INSERT";
    }
    if (leadingKeyword === "update") {
        return "UPDATE";
    }
    if (leadingKeyword === "delete") {
        return "DELETE";
    }
    throw new Error("sql 只允许 SELECT / WITH / INSERT / UPDATE / DELETE");
}

/** 校验Agent SQL只包含一条允许的数据读写语句。 */
export function validateExecuteSql(sql: string): void {
    const normalized = normalizeSql(sql);
    const leadingKeyword = getSqlLeadingKeyword(normalized);
    const blockedPattern = /\b(alter|create|drop|truncate|grant|revoke|begin|commit|rollback|copy|vacuum|analyze|reset|show|call|pragma|attach|detach)\b/i;

    if (!normalized) {
        throw new Error("sql 不能为空");
    }
    if (hasSqlStatementSeparator(normalized)) {
        throw new Error("sql 只允许单条语句");
    }
    if (!["select", "with", "insert", "update", "delete"].includes(leadingKeyword)) {
        throw new Error("sql 只允许 SELECT / WITH / INSERT / UPDATE / DELETE");
    }
    if (blockedPattern.test(stripSqlLiterals(normalized))) {
        throw new Error("sql 包含被禁止的关键字");
    }
}

/** 检测真正的SQL语句分隔符；字符串、identifier和注释内的分号不计。 */
export function hasSqlStatementSeparator(sql: string): boolean {
    let index = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;

    while (index < sql.length) {
        const char = sql[index] ?? "";
        const nextChar = sql[index + 1] ?? "";

        if (inLineComment) {
            if (char === "\n" || char === "\r") {
                inLineComment = false;
            }
            index++;
            continue;
        }
        if (inBlockComment) {
            if (char === "*" && nextChar === "/") {
                inBlockComment = false;
                index += 2;
                continue;
            }
            index++;
            continue;
        }
        if (inSingleQuote) {
            if (char === "'" && nextChar === "'") {
                index += 2;
                continue;
            }
            if (char === "'") {
                inSingleQuote = false;
            }
            index++;
            continue;
        }
        if (inDoubleQuote) {
            if (char === "\"" && nextChar === "\"") {
                index += 2;
                continue;
            }
            if (char === "\"") {
                inDoubleQuote = false;
            }
            index++;
            continue;
        }
        if (char === "-" && nextChar === "-") {
            inLineComment = true;
            index += 2;
            continue;
        }
        if (char === "/" && nextChar === "*") {
            inBlockComment = true;
            index += 2;
            continue;
        }
        if (char === "'") {
            inSingleQuote = true;
            index++;
            continue;
        }
        if (char === "\"") {
            inDoubleQuote = true;
            index++;
            continue;
        }
        if (char === ";") {
            return true;
        }
        index++;
    }
    return false;
}

/** 把literal、identifier和注释遮蔽后交给禁止关键字检查。 */
function stripSqlLiterals(sql: string): string {
    let result = "";
    let index = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;

    while (index < sql.length) {
        const char = sql[index] ?? "";
        const nextChar = sql[index + 1] ?? "";

        if (inLineComment) {
            if (char === "\n" || char === "\r") {
                inLineComment = false;
                result += char;
            } else {
                result += " ";
            }
            index++;
            continue;
        }
        if (inBlockComment) {
            if (char === "*" && nextChar === "/") {
                result += "  ";
                inBlockComment = false;
                index += 2;
                continue;
            }
            result += " ";
            index++;
            continue;
        }
        if (inSingleQuote) {
            if (char === "'" && nextChar === "'") {
                result += "  ";
                index += 2;
                continue;
            }
            if (char === "'") {
                inSingleQuote = false;
            }
            result += " ";
            index++;
            continue;
        }
        if (inDoubleQuote) {
            if (char === "\"" && nextChar === "\"") {
                result += "  ";
                index += 2;
                continue;
            }
            if (char === "\"") {
                inDoubleQuote = false;
            }
            result += " ";
            index++;
            continue;
        }
        if (char === "-" && nextChar === "-") {
            result += "  ";
            inLineComment = true;
            index += 2;
            continue;
        }
        if (char === "/" && nextChar === "*") {
            result += "  ";
            inBlockComment = true;
            index += 2;
            continue;
        }
        if (char === "'") {
            inSingleQuote = true;
            result += " ";
            index++;
            continue;
        }
        if (char === "\"") {
            inDoubleQuote = true;
            result += " ";
            index++;
            continue;
        }
        result += char;
        index++;
    }
    return result;
}

/** 把底层SQLite错误补充为Agent可操作的错误提示。 */
export function buildAgentSqlErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const hintLines = [`SQL 执行失败：${message}`];
    if (/no such (?:table|column)/i.test(message)) {
        hintLines.push("提示：当前目标是 Project SQLite；先确认当前 Project Workspace 和表/列名。业务表和 camelCase 字段建议使用双引号。");
    }
    return hintLines.join("\n");
}

/** 在已经归属当前generation的精确client上执行标准化SQL。 */
async function executeWithClient(client: ProjectAgentSqlClient, normalized: string): Promise<ExecuteSqlResult> {
    const statement = isReadSql(normalized)
        ? `SELECT * FROM (${normalized}) AS agent_query LIMIT ${String(AGENT_SQL_ROW_LIMIT)}`
        : normalized;
    try {
        const result = await client.execute(statement);
        const rows = result.rows.map((row) => ({...row}) as Record<string, unknown>);
        return toExecuteSqlResult(normalized, rows, result.rowsAffected || rows.length);
    } catch (error) {
        throw new Error(buildAgentSqlErrorMessage(error));
    }
}

/** 生成稳定的Agent工具JSON结果。 */
function toExecuteSqlResult(normalized: string, rows: Record<string, unknown>[], rowCount: number): ExecuteSqlResult {
    return {
        mode: isReadSql(normalized) ? "read" : "write",
        command: detectSqlCommand(normalized),
        rowCount,
        rows,
        effects: {
            refreshChapterTree: false,
        },
    };
}
