/**
 * 受管 SQLite 服务：具名资源的 owner 登记、借用、事务、代次与关闭门禁。
 *
 * 所有权模型：物理数据库文件与其全部驱动连接归登记的 owner 持有。资源本身登记在调用方给出的 owner 作用域
 * （应用级或 Project 代次级）上，经受管获取在打开前计入关闭门禁；每个借用另开一条连接，登记在借用者作用域上，
 * 归还时由 owner 关闭。原始连接不交给消费者，借用没有关闭连接或转交 owner 的能力。
 *
 * 关闭语义：owner 停止先拒绝新借用，等仍在使用的借用归还，再关闭登记连接并释放文件身份占用；仍有未归还借用
 * 时保留在停止中并报告“关闭未完成”，只有显式恢复才另起一次尝试。释放顺序靠寿命与依赖边保证：借用连接依赖
 * 它对资源的借用关系，资源可声明依赖调用方持有的服务绑定；服务收口时仍有存活资源即报告关闭未完成并保留占用。
 *
 * 行为合同见 docs/specs/platform/sqlite.md。
 */

import {existsSync} from "node:fs";

import {LifecycleStateError} from "nbook/runtime/lifecycle/lifecycle";
import type {BorrowHandle, BorrowResult, ReleaseDependency, ResourceHandle, Scope, ScopeId} from "nbook/runtime/lifecycle/lifecycle";

import {SqliteError} from "./contracts";
import type {
    DatabaseAccess,
    DatabaseBorrow,
    DatabaseBorrowMode,
    DatabaseCloseResult,
    DatabaseCommitResult,
    DatabaseFileIdentity,
    DatabaseResource,
    DatabaseResourceDeclaration,
    DatabaseResourceState,
    DatabaseStatementResult,
    DatabaseTransactionMode,
    SqliteParameters,
    SqliteRow,
    SqliteService,
    SqliteServiceState,
} from "./contracts";
import {driverFailureError} from "./driver";
import type {SqliteConnection, SqliteDriver} from "./driver";
import {databaseFileIdentity, resolveDatabaseLocation} from "./location";

export interface SqliteServiceOptions {
    readonly driver: SqliteDriver;
}

export class SqliteServiceImpl implements SqliteService {
    readonly #driver: SqliteDriver;
    readonly #resources = new Set<ResourceRecord>();
    readonly #generations = new Map<string, number>();
    #state: SqliteServiceState = "available";

    constructor(options: SqliteServiceOptions) {
        this.#driver = options.driver;
    }

    /** 机制内部：资源记录经它打开新连接。 */
    get driver(): SqliteDriver {
        return this.#driver;
    }

    get state(): SqliteServiceState {
        return this.#state;
    }

    async register(
        declaration: DatabaseResourceDeclaration,
        options: {readonly scope: Scope; readonly dependsOn?: ReadonlyArray<ReleaseDependency>},
    ): Promise<DatabaseResource> {
        if (this.#state !== "available") {
            throw new SqliteError({code: this.#state === "closed" ? "closed" : "stopping", detail: "环境不接受新的资源登记"});
        }
        validateDeclaration(declaration);
        const resolved = resolveDatabaseLocation(declaration.location);
        if (!existsSync(resolved.absolutePath) && (declaration.access === "read-only" || !declaration.create)) {
            throw new SqliteError({code: "not-found", detail: `${resolved.absolutePath}（未创建）`});
        }
        const scopeId = options.scope.id;
        for (const resource of this.#resources) {
            if (resource.name === declaration.name && resource.scopeId === scopeId) {
                throw new SqliteError({code: "duplicate-resource", detail: `${declaration.name}`});
            }
        }
        const file = databaseFileIdentity(resolved.absolutePath);
        for (const resource of this.#resources) {
            if (resource.file.identity === file.identity) {
                throw new SqliteError({code: "file-owned", detail: `${file.absolutePath} 已由 ${resource.name}#${resource.generation} 持有`});
            }
        }
        const generation = (this.#generations.get(file.identity) ?? 0) + 1;
        this.#generations.set(file.identity, generation);
        const record = new ResourceRecord(this, declaration, file, generation, scopeId);
        this.#resources.add(record);
        let acquired;
        try {
            acquired = await options.scope.acquire<ResourceRecord>({
                kind: "sqlite-resource",
                label: `${declaration.name}#${generation}`,
                // 失败直接交还调用方；必需获取失败会让 owner 作用域永远无法进入可用。
                required: false,
                acquire: () => record.open(),
                release: (value) => value.releaseFromOwnerScope(),
                dependsOn: options.dependsOn,
            });
        } catch (error) {
            this.#resources.delete(record);
            throw this.scopeRejection(options.scope, error);
        }
        if (acquired.status === "acquired") {
            record.attachHandle(acquired.handle);
            return record;
        }
        if (acquired.status === "late") {
            // 迟到登记只收口不发布：连接已打开，交由该资源自己的收口路径关闭。
            throw new SqliteError({code: "stopping", detail: `owner 作用域已进入停止：${declaration.name}`});
        }
        this.#resources.delete(record);
        if (acquired.status === "failed") {
            throw asSqliteError(acquired.error);
        }
        throw new SqliteError({code: options.scope.phase === "closed" ? "closed" : "stopping", detail: "owner 作用域不再接纳新的资源登记"});
    }

    resource(name: string, options: {readonly scope: Scope}): DatabaseResource {
        for (let current: Scope | null = options.scope; current !== null; current = current.parent) {
            for (const resource of this.#resources) {
                if (resource.state === "opening") {
                    continue;
                }
                if (resource.name === name && resource.scopeId === current.id) {
                    return resource;
                }
            }
        }
        throw new SqliteError({code: "unknown-resource", detail: name});
    }

    /**
     * 服务收口：拒绝新登记；资源随各自 owner 作用域收口。仍有存活资源（owner 作用域比服务更长寿、
     * 或资源自身关闭未完成）即抛 `stopping`，保留占用并停在停止中，由显式恢复重新检查。
     */
    async release(): Promise<void> {
        if (this.#state === "closed") {
            return;
        }
        this.#state = "stopping";
        const remaining = [...this.#resources];
        if (remaining.length > 0) {
            throw new SqliteError({
                code: "stopping",
                detail: `关闭未完成：${remaining.length} 个具名资源仍未收口（${remaining.map((resource) => `${resource.name}#${resource.generation}`).join("、")}）`,
            });
        }
        this.#state = "closed";
    }

    /** 机制内部：资源收口后交回文件身份占用。 */
    forget(resource: ResourceRecord): void {
        this.#resources.delete(resource);
    }

    /** 机制内部：同一物理文件是否已有更新代次登记（旧句柄据此报告代次失效）。 */
    supersedes(identity: string, generation: number): boolean {
        return (this.#generations.get(identity) ?? generation) > generation;
    }

    /** 机制内部：把作用域拒绝（停止中、已关闭或获取失败）翻译成机制错误码。 */
    scopeRejection(scope: Scope, error: unknown): SqliteError {
        if (error instanceof SqliteError) {
            return error;
        }
        if (error instanceof LifecycleStateError) {
            return new SqliteError({code: scope.phase === "closed" ? "closed" : "stopping", detail: "作用域不再接纳新的受管获取"});
        }
        return new SqliteError({code: "driver-failed", detail: error instanceof Error ? error.message : "受管获取失败", cause: error});
    }
}

class ResourceRecord implements DatabaseResource {
    readonly name: string;
    readonly generation: number;
    readonly access: DatabaseAccess;
    readonly file: DatabaseFileIdentity;
    readonly scopeId: ScopeId;
    readonly #service: SqliteServiceImpl;
    readonly #absolutePath: string;
    readonly #create: boolean;
    readonly #busyTimeoutMs: number;
    readonly #borrows = new Set<BorrowRecord>();
    #state: DatabaseResourceState = "opening";
    #handle: ResourceHandle<ResourceRecord> | null = null;
    #attempt: Promise<DatabaseCloseResult> | null = null;
    #lastResult: DatabaseCloseResult | null = null;
    #closedResultValue: DatabaseCloseResult | null = null;

    constructor(service: SqliteServiceImpl, declaration: DatabaseResourceDeclaration, file: DatabaseFileIdentity, generation: number, scopeId: ScopeId) {
        this.#service = service;
        this.#absolutePath = file.absolutePath;
        this.#create = declaration.create;
        this.#busyTimeoutMs = declaration.busyTimeoutMs ?? 0;
        this.name = declaration.name;
        this.generation = generation;
        this.access = declaration.access;
        this.file = file;
        this.scopeId = scopeId;
    }

    get state(): DatabaseResourceState {
        return this.#state;
    }

    /** 登记期间的受管获取：打开只做连接探测，不建表、不迁移；打开（可能创建文件）后核实物理身份未变。 */
    open(): ResourceRecord {
        const connection = this.#service.driver.open(this.#absolutePath, {
            readOnly: this.access === "read-only",
            create: this.#create,
            busyTimeoutMs: this.#busyTimeoutMs,
        });
        try {
            connection.query("pragma schema_version");
        } catch (error) {
            connection.close();
            throw driverFailureError(error);
        }
        connection.close();
        // 预留身份来自“父目录实路径 + 目标名”；创建完成后以文件自身实路径复核，链接或替换造成的偏差即拒绝。
        if (databaseFileIdentity(this.#absolutePath).identity !== this.file.identity) {
            throw new SqliteError({code: "invalid-location", detail: `${this.file.absolutePath} 打开后的物理身份与登记时不一致`});
        }
        return this;
    }

    attachHandle(handle: ResourceHandle<ResourceRecord>): void {
        this.#handle = handle;
        this.#state = "available";
    }

    /** owner 作用域释放入口：收口失败即抛出，让 lifecycle 记录 release-failed 并停在停止中。 */
    releaseFromOwnerScope(): Promise<void> {
        return this.settle().then((result) => {
            if (result.status !== "closed") {
                throw this.#incompleteError(result);
            }
        });
    }

    async borrow(options: {readonly mode: DatabaseBorrowMode; readonly scope: Scope}): Promise<DatabaseBorrow> {
        if (this.#state === "closed") {
            throw this.closedError();
        }
        if (options.mode !== "read" && options.mode !== "write") {
            throw new TypeError(`借用模式必须是 read 或 write，收到 ${String(options.mode)}`);
        }
        if (options.mode === "write" && this.access === "read-only") {
            throw new SqliteError({code: "permission-denied", detail: `资源 ${this.name} 只声明只读访问`});
        }
        const handle = this.#handle;
        if (handle === null || this.#state !== "available") {
            throw new SqliteError({code: "stopping", detail: `资源正在打开或停止中：${this.name}#${this.generation}`});
        }
        const relation = this.#attachRelation(options.scope, handle);
        const record = new BorrowRecord(this, options.mode, relation);
        this.#borrows.add(record);
        let acquired;
        try {
            acquired = await options.scope.acquire<BorrowRecord>({
                kind: "sqlite-borrow",
                label: `${this.name}#${this.generation}:${options.mode}`,
                required: false,
                acquire: () => this.#openBorrow(record),
                release: (value) => value.returnConnection(),
                // 连接先于借用关系释放：借用者作用域收口时 owner 看到的借用已无在用连接。
                dependsOn: [relation],
            });
        } catch (error) {
            record.returnConnection();
            throw this.#service.scopeRejection(options.scope, error);
        }
        if (acquired.status === "acquired") {
            return record;
        }
        record.returnConnection();
        if (acquired.status === "failed") {
            throw asSqliteError(acquired.error);
        }
        throw new SqliteError({code: options.scope.phase === "closed" ? "closed" : "stopping", detail: "借用者作用域不再接纳新的借用"});
    }

    close(): Promise<DatabaseCloseResult> {
        if (this.#state === "closed") {
            return Promise.resolve(this.#closedResult());
        }
        if (this.#attempt !== null) {
            return this.#attempt;
        }
        if (this.#lastResult !== null) {
            return Promise.resolve(this.#lastResult);
        }
        return this.settle();
    }

    recover(): Promise<DatabaseCloseResult> {
        return this.settle();
    }

    /** 收口尝试：共享在途尝试，否则另起一次；已归还借用的连接由 owner 收口，仍在使用的借用阻塞关闭。 */
    settle(): Promise<DatabaseCloseResult> {
        if (this.#state === "closed") {
            return Promise.resolve(this.#closedResult());
        }
        if (this.#attempt !== null) {
            return this.#attempt;
        }
        this.#state = "stopping";
        const attempt = this.#runCloseAttempt();
        this.#attempt = attempt;
        void attempt.then((result) => {
            if (this.#attempt === attempt) {
                this.#attempt = null;
            }
            this.#lastResult = result;
        });
        return attempt;
    }

    /** 机制内部：借用归还后从关闭门禁台账移除。 */
    forgetBorrow(borrow: BorrowRecord): void {
        this.#borrows.delete(borrow);
    }

    /** 机制内部：已关闭资源上迟到调用使用的错误；同路径已重新登记时报告代次失效。 */
    closedError(): SqliteError {
        return new SqliteError({
            code: this.#service.supersedes(this.file.identity, this.generation) ? "stale-generation" : "closed",
            detail: `${this.name}#${this.generation}`,
        });
    }

    async #runCloseAttempt(): Promise<DatabaseCloseResult> {
        for (const borrow of [...this.#borrows]) {
            if (!borrow.relationReleased) {
                continue;
            }
            // 借用者已结束使用但连接尚未收口：owner 现在关闭它（幂等），失败则保留在台账里可见。
            try {
                borrow.returnConnection();
            } catch {
                // 失败记录已由 BorrowRecord 置为 driver-failed，下面统一汇总。
            }
        }
        let outstanding = 0;
        let failed = 0;
        for (const borrow of this.#borrows) {
            if (borrow.connectionLost) {
                failed += 1;
            } else {
                outstanding += 1;
            }
        }
        if (outstanding === 0 && failed === 0) {
            this.#state = "closed";
            this.#service.forget(this);
            const result = this.#closedResult();
            // 资源已收口：文件身份占用随之交回，同一文件可以登记新代次。
            return result;
        }
        return {
            status: "incomplete",
            resource: this.name,
            generation: this.generation,
            reason: outstanding > 0 ? "borrows-outstanding" : "driver-failed",
            outstandingBorrows: outstanding + failed,
            failedBorrows: failed,
        };
    }

    #closedResult(): DatabaseCloseResult {
        this.#closedResultValue ??= {status: "closed", resource: this.name, generation: this.generation};
        return this.#closedResultValue;
    }

    #incompleteError(result: Extract<DatabaseCloseResult, {status: "incomplete"}>): SqliteError {
        return new SqliteError({
            code: "stopping",
            detail: `关闭未完成：${result.resource}#${result.generation} 有 ${result.outstandingBorrows} 个未归还或失效的借用（${result.reason}）`,
        });
    }

    #attachRelation(scope: Scope, handle: ResourceHandle<ResourceRecord>): BorrowHandle<ResourceRecord> {
        let borrowed: BorrowResult<ResourceRecord>;
        try {
            borrowed = scope.borrow(handle);
        } catch (error) {
            // 自有/后代/跨实例作用域不得持有该资源：这是借用者身份范围，不是驱动故障。
            throw new SqliteError({
                code: "permission-denied",
                detail: error instanceof Error ? error.message : `借用作用域不在资源 ${this.name} 的寿命范围内`,
                cause: error,
            });
        }
        if (borrowed.status === "borrowed") {
            return borrowed.handle;
        }
        throw new SqliteError({code: borrowed.reason === "owner-closed" ? "closed" : "stopping", detail: `资源 ${this.name} 的 owner 作用域正在停止`});
    }

    #openBorrow(record: BorrowRecord): BorrowRecord {
        // 驱动的读写打开会创建缺失文件：登记后文件被外部删除时明确失败，不静默建出空库。
        if (!existsSync(this.#absolutePath)) {
            throw new SqliteError({code: "not-found", detail: `${this.name}#${this.generation} 的数据库文件已不存在`});
        }
        const connection = this.#service.driver.open(this.#absolutePath, {
            // 读借用也用只读连接：越权写由驱动拒绝并映射为 read-only。
            readOnly: this.access === "read-only" || record.mode === "read",
            create: false,
            busyTimeoutMs: this.#busyTimeoutMs,
        });
        try {
            connection.denyCrossDatabase();
        } catch (error) {
            connection.close();
            throw driverFailureError(error);
        }
        record.attach(connection);
        return record;
    }
}

class BorrowRecord implements DatabaseBorrow {
    readonly resource: string;
    readonly generation: number;
    readonly mode: DatabaseBorrowMode;
    readonly #owner: ResourceRecord;
    readonly #relation: BorrowHandle<ResourceRecord>;
    #connection: SqliteConnection | null = null;
    #state: "opening" | "open" | "returned" | "failed" = "opening";

    constructor(owner: ResourceRecord, mode: DatabaseBorrowMode, relation: BorrowHandle<ResourceRecord>) {
        this.#owner = owner;
        this.#relation = relation;
        this.resource = owner.name;
        this.generation = owner.generation;
        this.mode = mode;
    }

    get released(): boolean {
        return this.#state === "returned";
    }

    get connectionLost(): boolean {
        return this.#state === "failed";
    }

    /** 借用者作用域已结束这条使用关系（无论由谁触发）。 */
    get relationReleased(): boolean {
        return this.#relation.released;
    }

    attach(connection: SqliteConnection): void {
        this.#connection = connection;
        this.#state = "open";
    }

    execute(sql: string, parameters?: SqliteParameters): DatabaseStatementResult {
        const connection = this.#require();
        try {
            return connection.execute(sql, parameters);
        } catch (error) {
            throw this.#mapCallError(connection, error);
        }
    }

    query(sql: string, parameters?: SqliteParameters): ReadonlyArray<SqliteRow> {
        const connection = this.#require();
        try {
            return connection.query(sql, parameters);
        } catch (error) {
            throw this.#mapCallError(connection, error);
        }
    }

    begin(mode: DatabaseTransactionMode = "deferred"): void {
        if (mode !== "deferred" && mode !== "immediate") {
            throw new TypeError(`事务模式必须是 deferred 或 immediate，收到 ${String(mode)}`);
        }
        const connection = this.#require();
        try {
            connection.begin(mode);
        } catch (error) {
            throw this.#mapCallError(connection, error);
        }
    }

    commit(): DatabaseCommitResult {
        const connection = this.#require();
        try {
            connection.commit();
            return {status: "committed"};
        } catch (error) {
            if (!connection.usable) {
                // 提交应答丢失、提交期间断连：既不是成功也不是失败，且不自动重放。
                this.#state = "failed";
                return {
                    status: "outcome-unknown",
                    error: new SqliteError({code: "outcome-unknown", detail: "提交期间连接失效，无法判定是否已提交", cause: error}),
                };
            }
            return {status: "failed", error: driverFailureError(error)};
        }
    }

    rollback(): void {
        const connection = this.#require();
        try {
            connection.rollback();
        } catch (error) {
            throw this.#mapCallError(connection, error);
        }
    }

    release(): void {
        this.returnConnection();
    }

    /**
     * 归还：先关闭借用的连接，再结束使用关系；幂等。连接关闭失败时使用关系保持存活，owner 的关闭门禁
     * 仍能看到这条借用（不静默当作已归还）。
     */
    returnConnection(): void {
        if (this.#state === "returned") {
            return;
        }
        const connection = this.#connection;
        if (connection !== null && connection.usable) {
            try {
                connection.close();
            } catch (error) {
                this.#state = "failed";
                throw driverFailureError(error);
            }
        }
        this.#connection = null;
        this.#state = "returned";
        this.#relation.release();
        this.#owner.forgetBorrow(this);
    }

    #require(): SqliteConnection {
        if (this.#owner.state === "closed") {
            // 旧代次优先：已关闭资源的借用一律失效，不得被静默路由到新代次的连接。
            throw this.#owner.closedError();
        }
        if (this.#state === "returned") {
            throw new SqliteError({code: "borrow-released", detail: `${this.resource}#${this.generation}`});
        }
        const connection = this.#connection;
        if (this.#state === "failed" || connection === null) {
            throw new SqliteError({code: "driver-failed", detail: "借用连接已失效"});
        }
        return connection;
    }

    #mapCallError(connection: SqliteConnection, error: unknown): SqliteError {
        if (!connection.usable) {
            // 驱动连接被外部销毁或失效：停止后续调用并保留未结算的借用。
            this.#state = "failed";
            return new SqliteError({code: "driver-failed", detail: "借用连接已失效", cause: error});
        }
        return driverFailureError(error);
    }
}

function validateDeclaration(declaration: DatabaseResourceDeclaration): void {
    if (typeof declaration.name !== "string" || declaration.name.trim() === "") {
        throw new TypeError("数据库资源必须有非空名称");
    }
    if (declaration.access !== "read-only" && declaration.access !== "read-write") {
        throw new TypeError(`资源访问模式必须是 read-only 或 read-write，收到 ${String(declaration.access)}`);
    }
    if (typeof declaration.create !== "boolean") {
        throw new TypeError("资源声明必须给出 create 布尔值");
    }
    if (typeof declaration.schemaOwner !== "string" || declaration.schemaOwner.trim() === "") {
        throw new TypeError("资源声明必须给出非空 schemaOwner");
    }
    const timeout = declaration.busyTimeoutMs;
    if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 0)) {
        throw new TypeError(`busyTimeoutMs 必须是非负整数毫秒，收到 ${String(timeout)}`);
    }
}

/** 机制内部错误只按 code 分支：非机制错误统一收口为 driver-failed，保留原文用于诊断。 */
function asSqliteError(error: unknown): SqliteError {
    if (error instanceof SqliteError) {
        return error;
    }
    return new SqliteError({code: "driver-failed", detail: error instanceof Error ? error.message : "驱动调用失败", cause: error});
}
