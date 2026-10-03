/**
 * 驱动适配器边界：机制只经它触碰具体 SQLite 实现，驱动差异（错误码、只读语义、忙碌等待）收口在这里。
 *
 * 缺省适配器是 Node 24 内置 `node:sqlite`。它为同步 API：打开、执行、关闭都不返回 Promise；机制因此
 * 在借用层做同步执行，只把“登记与收口”放进受管获取。`node:sqlite` 在只读模式写入报 errcode 8、
 * 只读打开缺失文件报 errcode 14 且不创建文件、忙碌报 errcode 5、关闭后调用报 `ERR_INVALID_STATE`。
 *
 * 打开前守卫（只读资源与 `create: false` 拒绝缺失文件）由机制完成：适配器只把 `create` 当作声明，
 * 不在打开时创建目录或空库。
 */

import {DatabaseSync, constants} from "node:sqlite";
import type {SQLInputValue, SQLOutputValue, StatementSync} from "node:sqlite";

import {SqliteError} from "./contracts";
import type {DatabaseStatementResult, DatabaseTransactionMode, SqliteParameters, SqliteRow, SqliteValue} from "./contracts";

/** 一次打开的驱动选项。 */
export interface SqliteDriverOpenOptions {
    readonly readOnly: boolean;
    /** 允许创建缺失文件；只读打开永远不创建。 */
    readonly create: boolean;
    /** 忙碌/锁定时的有限等待毫秒（0 即不等待）。 */
    readonly busyTimeoutMs: number;
}

/**
 * 一条受管驱动连接。
 *
 * `usable` 是“能否继续调用”的快照：连接被外部销毁、驱动失效或关闭后为 false；提交失败且连接不再可用时
 * 机制据此判定结果未知，而不是假报成功或失败。
 */
export interface SqliteConnection {
    readonly path: string;
    readonly readOnly: boolean;
    readonly usable: boolean;
    execute(sql: string, parameters?: SqliteParameters): DatabaseStatementResult;
    query(sql: string, parameters?: SqliteParameters): ReadonlyArray<SqliteRow>;
    begin(mode: DatabaseTransactionMode): void;
    commit(): void;
    rollback(): void;
    /** 拒绝 ATTACH/DETACH：一条连接只服务一个物理文件，跨库语句映射为 `cross-database`。 */
    denyCrossDatabase(): void;
    close(): void;
}

export interface SqliteDriver {
    readonly name: string;
    open(path: string, options: SqliteDriverOpenOptions): SqliteConnection;
}

type DriverFailure =
    | "busy"
    | "locked"
    | "read-only"
    | "constraint"
    | "not-found"
    | "permission-denied"
    | "cross-database"
    | "connection-lost"
    | "unknown";

/** SQLite 主错误码 → 驱动失败；扩展码先按 0xff 折叠（例如 1555 约束失败归 19）。 */
const FAILURE_BY_PRIMARY_CODE: Readonly<Record<number, DriverFailure>> = {
    3: "permission-denied",
    5: "busy",
    6: "locked",
    8: "read-only",
    14: "not-found",
    19: "constraint",
    23: "cross-database",
};

/**
 * 把驱动异常映射为机制错误。
 *
 * `driver-failed` 是其余驱动异常的收口码：查询缺表、参数不可绑定等都属于这一层，调用方不必区分驱动细节。
 * 提交路径的“结果未知”不在这里判定——那由调用方按连接是否仍可用决定（见 `SqliteConnection.usable`）。
 */
export function driverFailureError(error: unknown): SqliteError {
    const failure = classifyDriverFailure(error);
    const detail = driverMessage(error);
    const code = failure === "locked" ? "busy" : failure === "connection-lost" ? "driver-failed" : failure === "unknown" ? "driver-failed" : failure;
    return new SqliteError({code, detail, cause: error});
}

function classifyDriverFailure(error: unknown): DriverFailure {
    if (typeof error !== "object" || error === null) {
        return "unknown";
    }
    if ("code" in error && error.code === "ERR_INVALID_STATE") {
        return "connection-lost";
    }
    if ("errcode" in error && typeof error.errcode === "number") {
        return FAILURE_BY_PRIMARY_CODE[error.errcode & 0xff] ?? "unknown";
    }
    return "unknown";
}

/** 驱动原文只用于诊断：SQLite 的错误文本不含绑定参数值。 */
function driverMessage(error: unknown): string {
    if (error instanceof Error && error.message !== "") {
        return error.message;
    }
    return "驱动未提供错误信息";
}

/** `Array.isArray` 不收窄只读数组；显式守卫区分匿名与具名绑定。 */
function isPositional(parameters: SqliteParameters): parameters is ReadonlyArray<SqliteValue> {
    return Array.isArray(parameters);
}

/** 机制的可绑定值是驱动输入值的子集；按形态分派到驱动的两个重载。 */
function bindRun(statement: StatementSync, parameters: SqliteParameters | undefined): ReturnType<StatementSync["run"]> {
    if (parameters === undefined) {
        return statement.run();
    }
    if (isPositional(parameters)) {
        const positional: SQLInputValue[] = [...parameters];
        return statement.run(...positional);
    }
    const named: Record<string, SQLInputValue> = {...parameters};
    return statement.run(named);
}

function bindAll(statement: StatementSync, parameters: SqliteParameters | undefined): Record<string, SQLOutputValue>[] {
    if (parameters === undefined) {
        return statement.all();
    }
    if (isPositional(parameters)) {
        const positional: SQLInputValue[] = [...parameters];
        return statement.all(...positional);
    }
    const named: Record<string, SQLInputValue> = {...parameters};
    return statement.all(named);
}

class NodeSqliteConnection implements SqliteConnection {
    readonly path: string;
    readonly readOnly: boolean;
    readonly #database: DatabaseSync;

    constructor(filePath: string, options: SqliteDriverOpenOptions) {
        this.path = filePath;
        this.readOnly = options.readOnly;
        this.#database = new DatabaseSync(filePath, {readOnly: options.readOnly, timeout: options.busyTimeoutMs});
    }

    get usable(): boolean {
        return this.#database.isOpen;
    }

    execute(sql: string, parameters?: SqliteParameters): DatabaseStatementResult {
        const result = bindRun(this.#database.prepare(sql), parameters);
        return {changes: result.changes, lastInsertRowid: result.lastInsertRowid};
    }

    query(sql: string, parameters?: SqliteParameters): ReadonlyArray<SqliteRow> {
        // 驱动返回 null-prototype 行；复制成普通对象，避免消费者踩到原型缺失。
        return bindAll(this.#database.prepare(sql), parameters).map((row) => ({...row}));
    }

    begin(mode: DatabaseTransactionMode): void {
        this.#database.exec(mode === "immediate" ? "BEGIN IMMEDIATE" : "BEGIN DEFERRED");
    }

    commit(): void {
        this.#database.exec("COMMIT");
    }

    rollback(): void {
        this.#database.exec("ROLLBACK");
    }

    denyCrossDatabase(): void {
        this.#database.setAuthorizer((action) => (
            action === constants.SQLITE_ATTACH || action === constants.SQLITE_DETACH
                ? constants.SQLITE_DENY
                : constants.SQLITE_OK
        ));
    }

    close(): void {
        if (this.#database.isOpen) {
            this.#database.close();
        }
    }
}

/** 缺省驱动：Node 内置 `node:sqlite`（同步 API）。 */
export function createNodeSqliteDriver(): SqliteDriver {
    return {
        name: "node:sqlite",
        open: (filePath, options) => new NodeSqliteConnection(filePath, options),
    };
}
