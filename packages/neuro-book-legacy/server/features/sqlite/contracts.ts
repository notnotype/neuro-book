/**
 * platform.sqlite 的公开合同：服务键、声明/句柄/结果类型与唯一会抛出的错误类。
 *
 * 只有类型、服务键与错误类，没有 I/O 与单例；行为合同见 docs/specs/platform/sqlite.md。
 * 调用方只通过 `./sqlite` 取得这些符号。
 */

import type {ReleaseDependency, Scope} from "nbook/runtime/lifecycle/lifecycle";
import {defineServiceKey} from "nbook/runtime/services/services";

/** 受管 SQLite 能力键：一个解析作用域内最多一个提供者。 */
export const sqliteKey = defineServiceKey<SqliteService>("nbook.sqlite/sqlite");

/**
 * 调用方按 `code` 分支的失败原因。
 *
 * `stopping`/`closed` 是阶段拒绝，`not-found`/`permission-denied`/`read-only`/`busy`/`constraint`/
 * `cross-database` 是驱动报告的明确失败，`outcome-unknown` 只在无法判定是否已提交时出现。
 */
export type SqliteErrorCode =
    | "invalid-location"
    | "unknown-resource"
    | "duplicate-resource"
    | "file-owned"
    | "not-found"
    | "permission-denied"
    | "read-only"
    | "busy"
    | "constraint"
    | "cross-database"
    | "stale-generation"
    | "borrow-released"
    | "closed"
    | "stopping"
    | "driver-failed"
    | "outcome-unknown";

const CODE_TEXT: Readonly<Record<SqliteErrorCode, string>> = {
    "invalid-location": "SQLite 定位非法",
    "unknown-resource": "未登记的 SQLite 具名资源",
    "duplicate-resource": "同一作用域内已有同名 SQLite 资源",
    "file-owned": "该物理数据库文件已被另一个存活登记占用",
    "not-found": "SQLite 数据库文件不存在",
    "permission-denied": "SQLite 权限不足",
    "read-only": "只读连接拒绝写操作",
    "busy": "SQLite 数据库忙碌或锁定",
    "constraint": "SQLite 约束校验失败",
    "cross-database": "SQLite 不支持跨数据库语句",
    "stale-generation": "SQLite 资源代次已失效",
    "borrow-released": "SQLite 借用已归还",
    closed: "SQLite 资源或服务已关闭",
    stopping: "SQLite 资源或服务正在停止",
    "driver-failed": "SQLite 驱动调用失败",
    "outcome-unknown": "SQLite 提交结果未知",
};

/** SQLite 机制的失败：`code` 是分支依据，文案只用于诊断。 */
export class SqliteError extends Error {
    readonly code: SqliteErrorCode;

    constructor(input: {readonly code: SqliteErrorCode; readonly detail?: string; readonly cause?: unknown}) {
        const detail = input.detail === undefined || input.detail === "" ? "" : `：${input.detail}`;
        super(`${CODE_TEXT[input.code]}${detail}`, input.cause === undefined ? undefined : {cause: input.cause});
        this.name = "SqliteError";
        this.code = input.code;
    }
}

/**
 * 宿主交付的已解析定位。
 *
 * `path` 是宿主已解析的绝对路径（例如 `server/runtime/app-sqlite-location.ts` 的结果）；
 * `url` 是 `file:` URL 与 State Root，由机制按宿主同一套规则校验形态与越界，不实现第二套优先级解析。
 */
export type DatabaseLocation = {readonly path: string} | {readonly url: string; readonly stateRoot: string};

/** 资源声明的访问模式；借用不得高于它。 */
export type DatabaseAccess = "read-only" | "read-write";

/** 数据 owner 声明的具名数据库资源。 */
export interface DatabaseResourceDeclaration {
    /** 具名资源身份；同一 owner 作用域内唯一。 */
    readonly name: string;
    readonly location: DatabaseLocation;
    readonly access: DatabaseAccess;
    /** 是否允许创建不存在的数据库文件；只读资源无论该值都不会创建文件或目录。 */
    readonly create: boolean;
    /** schema/迁移归属；机制不解释它，只用于诊断与冲突排查。 */
    readonly schemaOwner: string;
    /** 忙碌/锁定时的有限等待毫秒；缺省 0，即不等待、不隐藏忙碌。 */
    readonly busyTimeoutMs?: number;
}

/** 借用访问模式；`write` 借用不得声明在只读资源上。 */
export type DatabaseBorrowMode = "read" | "write";

/** 事务模式：`immediate` 立即取得写锁，用于显式写事务竞争。 */
export type DatabaseTransactionMode = "deferred" | "immediate";

/** 可绑定的 SQL 值；机制不提供把值拼进 SQL 文本的路径。 */
export type SqliteValue = null | number | bigint | string | Uint8Array;

/** 参数绑定：匿名数组或具名对象（键可带或省略 `:`/`@`/`$` 前缀，由驱动语义决定）。 */
export type SqliteParameters = ReadonlyArray<SqliteValue> | Readonly<Record<string, SqliteValue>>;

/** 结果行；键是列名，值是可绑定类型。 */
export type SqliteRow = Readonly<Record<string, SqliteValue>>;

/** 参数化执行的影响行数与最后插入行号。 */
export interface DatabaseStatementResult {
    readonly changes: number | bigint;
    readonly lastInsertRowid: number | bigint;
}

/**
 * 提交结果。
 *
 * `failed` 表示驱动明确报告提交前失败（忙碌/锁定、约束、权限等），事务未提交；
 * `outcome-unknown` 只在无法判定是否已提交时出现（提交应答丢失、提交期间连接断开），借用随即失效，
 * 机制不自动重放，由领域通过重新读取或恢复流程判定。
 */
export type DatabaseCommitResult =
    | {readonly status: "committed"}
    | {readonly status: "failed"; readonly error: SqliteError}
    | {readonly status: "outcome-unknown"; readonly error: SqliteError};

/**
 * 受限使用面：只提供执行、事务与归还，不含关闭连接或转交 owner 的能力。
 *
 * 归还幂等；归还后任何调用都明确失败。原始驱动连接只由 owner 与其 adapter 持有。
 */
export interface DatabaseBorrow {
    readonly resource: string;
    readonly generation: number;
    readonly mode: DatabaseBorrowMode;
    readonly released: boolean;
    execute(sql: string, parameters?: SqliteParameters): DatabaseStatementResult;
    query(sql: string, parameters?: SqliteParameters): ReadonlyArray<SqliteRow>;
    begin(mode?: DatabaseTransactionMode): void;
    commit(): DatabaseCommitResult;
    rollback(): void;
    release(): void;
}

/** 资源阶段；`opening` 只在登记的受管获取期间出现，此时资源尚未发布；`stopping` 拒绝新借用但已接纳的借用仍可提交、回滚与归还。 */
export type DatabaseResourceState = "opening" | "available" | "stopping" | "closed";

/** 服务阶段：创建中由插件激活承担，服务对象构造完成即可用。 */
export type SqliteServiceState = "available" | "stopping" | "closed";

/**
 * 关闭尝试结果。
 *
 * `incomplete` 表示资源保留在 `stopping`：仍有未归还借用（不静默强关正在使用的连接）或驱动未收口；
 * 只有显式 `recover()` 才另起一次尝试。
 */
export type DatabaseCloseResult =
    | {readonly status: "closed"; readonly resource: string; readonly generation: number}
    | {
          readonly status: "incomplete";
          readonly resource: string;
          readonly generation: number;
          readonly reason: "borrows-outstanding" | "driver-failed";
          readonly outstandingBorrows: number;
          readonly failedBorrows: number;
      };

/** 物理文件身份：`absolutePath` 是宿主交付拼写，`identity` 是可判等的物理身份（父目录实路径 + 文件名）。 */
export interface DatabaseFileIdentity {
    readonly absolutePath: string;
    readonly identity: string;
}

/** 数据 owner 持有的资源句柄；借用与关闭都只经它。 */
export interface DatabaseResource {
    readonly name: string;
    readonly generation: number;
    readonly state: DatabaseResourceState;
    readonly access: DatabaseAccess;
    readonly file: DatabaseFileIdentity;
    /** 借用：`scope` 必须是本资源 owner 作用域的后代（更长寿命的作用域不得持有短寿命资源）。 */
    borrow(options: {readonly mode: DatabaseBorrowMode; readonly scope: Scope}): Promise<DatabaseBorrow>;
    /** 幂等：同一目标只有一次收口尝试，重复调用共享它的结果；另起尝试须 `recover()`。 */
    close(): Promise<DatabaseCloseResult>;
    /** 显式恢复：另起一次收口尝试；在途尝试未结算时返回它而不重入。 */
    recover(): Promise<DatabaseCloseResult>;
}

/** 受管 SQLite 服务：登记具名资源、按作用域可见性取句柄、拒绝新的登记并在停止中收口。 */
export interface SqliteService {
    readonly state: SqliteServiceState;
    /**
     * 登记并打开具名资源：打开前即计入 owner 作用域的关闭门禁，失败即收口本轮部分资源。
     * 打开只做连接探测，不建表、不迁移；重复登记（同作用域同名、或同一物理文件已有存活登记）被拒绝。
     */
    register(
        declaration: DatabaseResourceDeclaration,
        options: {
            readonly scope: Scope;
            /**
             * 资源消费的提供者（通常取解析 `sqliteKey` 得到的 `binding.dependency`）：声明后资源先于该借用
             * 释放，服务收口时不会看到仍存活的资源。
             */
            readonly dependsOn?: ReadonlyArray<ReleaseDependency>;
        },
    ): Promise<DatabaseResource>;
    /**
     * 按名称取某作用域可见的资源：只可见登记在该作用域或其祖先上的资源（与寿命模型一致）。
     * 未登记即 `unknown-resource`；调用方只能取具名资源，不能凭路径打开任意数据库文件。
     */
    resource(name: string, options: {readonly scope: Scope}): DatabaseResource;
    /** 服务级收口：拒绝新登记；仍有存活资源时抛 `stopping`（关闭未完成）。可重入，不重复已完成的副作用。 */
    release(): Promise<void>;
}
