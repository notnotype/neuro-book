/**
 * 创建管理员的命令 `create-admin <用户名> [邮箱]`（`site.operations` 输出 5、失败表与时序一节；w00037 t07 计划 3.12）。
 *
 * 它是另一个进程，用入口交来的自己那条连接写账号库，与正在运行的服务靠 SQLite 的写锁排队：
 * - 哈希用与服务相同的参数（`hashPassword`），不经服务的哈希限额。
 * - 写库是一个同步的 `BEGIN IMMEDIATE` 事务（`IdentityConnection.write`）：查账号、改或建、结束会话、写审计一次做完，中间没有
 *   `await`，停止信号插不进来，要么全部生效、要么都不生效。
 * - 等写锁不能是同步的：`bun:sqlite` 在 `busy_timeout` 里同步睡，这期间信号处理函数跑不了；锁在这段里放开时事务照样提交，
 *   随后才看到早已到达的 `SIGTERM`（omp 实现审查第 2 条，实测账号与审计各多一行、以 0 退出）。所以命令自己那条连接设
 *   `busy_timeout = 0`（`createAdminConnection`；入口给服务的连接不动），撞忙立即以 `SQLITE_BUSY` 回来，由 `writeWithRetry`
 *   用看 `signal` 的异步睡眠隔一阵再试。总的等待与改之前相当：原来每次同步等 250 毫秒、再隔 100 毫秒，51 次约 17.8 秒；现在每次
 *   隔 50 毫秒，至多再试 360 次，约 18 秒，用完以 `unavailable` 失败。服务那一侧的事务都很短，实际不会等满。
 * - 停止信号（`signal`）：读密码时、算完哈希后、每次尝试写库前都看，重试之间的睡眠也会被它打断；已 abort 就不写，reject 为
 *   `signal.reason`，入口报 `interrupted`（`SiteCommand` 的约定）。拿到写锁之后到提交是同步的一小段，这时到的信号要等它提交
 *   之后才被处理：事务已经开始，算做完了，不再中止。用户在终端里按 Ctrl-C、空输入时按 Ctrl-D 是取消，那时 `signal` 没有 abort，
 *   所以以 `interrupted` 的失败 resolve，不 reject（reject 会被入口当成没预料到的错误）。
 *
 * 服务没有账号的内存缓存（会话缓存关着），命令提交以后服务立即按新状态判断：旧会话已被删掉、新密码可以登录。
 */

import {SQLiteError, type Database} from "bun:sqlite";

import {EMAIL, parseUsernameInput} from "@notnotype/nb-site-identity-contract";

import {appendAudit} from "../audit";
import {IdentityConnection, type IdentityTx} from "../db/connection";
import {insertCredentialRow, insertUserRow, libDate} from "../db/library-rows";
import type {IdentityLog} from "../index";
import {hashPassword} from "../password";
import {endAllSessions} from "../session";
import {readPassword, type PasswordProblem, type PasswordSource} from "./read-password";

export const CREATE_ADMIN_COMMAND = "create-admin";

/** 命令的失败；形状与入口的 `CommandFailure` 相同，码与字段见 `site.operations` 的失败表。 */
export interface CreateAdminFailure {
    readonly code: "invalid_argument" | "email_taken" | "unavailable" | "interrupted";
    readonly message: string;
    readonly fields?: Readonly<Record<string, unknown>>;
}

/** 撞忙时的重试。产品用缺省值；包内测试注入很少的次数与自己的睡眠函数（在睡眠里放开别处持着的写锁）。 */
export interface BusyRetry {
    /** 第一次之后再试的次数。 */
    readonly retries: number;
    readonly delayMs: number;
    /** 睡 `ms` 毫秒；`signal` abort 时 reject 为 `signal.reason`。 */
    sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface CreateAdminOptions {
    /** 命令自己那条连接上的队列（`index.ts` 用 `CommandContext.db` 经 `createAdminConnection` 建）。 */
    readonly conn: IdentityConnection;
    readonly log: Pick<IdentityLog, "info">;
    readonly clock: {now(): number};
    /** `username` 与 `email`，按命令声明的参数名。 */
    readonly args: Readonly<Record<string, string | undefined>>;
    readonly signal: AbortSignal;
    readonly input: PasswordSource;
    /** 缺省 `hashPassword`。包内测试传一个先调它、再在“算完、写之前”插入动作的包装。 */
    readonly hash?: (password: string) => Promise<string>;
    readonly busyRetry?: BusyRetry;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
            reject(signal.reason);
            return;
        }
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        // `signal` 是进程级的停止信号，睡完就摘掉监听。
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, {once: true});
    });
}

/**
 * 产品用的重试。次数与间隔的由来见文件头：撞忙立即回来（`busy_timeout = 0`），总共约等 18 秒。导出给包内测试借它的睡眠函数
 * （停止信号要能打断它）。
 */
export const DEFAULT_BUSY_RETRY: BusyRetry = {retries: 360, delayMs: 50, sleep: abortableSleep};

/**
 * 命令在入口交来的那条连接上建的队列。`busy_timeout = 0`：等写锁交给 `writeWithRetry` 的异步重试，不在 SQLite 里同步睡（文件头）。
 * 入口在命令返回后关这条连接，不会再拿它给服务用，所以改它的设置不影响别人。
 */
export function createAdminConnection(db: Database, log: IdentityLog): IdentityConnection {
    return new IdentityConnection(db, {log, busyTimeoutMs: 0});
}

/** SQLite 的主结果码 `SQLITE_BUSY`（5）：别的连接持着写锁。只有它值得重试；只读、I/O 这类错误重试也不会好，照常抛出。 */
function isBusy(error: unknown): boolean {
    return error instanceof SQLiteError && (error.errno & 0xff) === 5;
}

/**
 * 占位邮箱（`site.legacy-import` 去向表的“邮箱”一行）：没给邮箱的新管理员与导入的旧账号用同一种写法。`.invalid` 后缀不是合法的
 * 注册邮箱（`site.accounts` 字段规则），所以不会与任何人的真实邮箱相撞。
 */
export function placeholderEmail(userId: number): string {
    return `u${String(userId)}@placeholder.invalid`;
}

const EMAIL_PATTERN = new RegExp(EMAIL.pattern, "u");

type EmailArgument = {readonly kind: "absent"} | {readonly kind: "valid"; readonly email: string} | {readonly kind: "invalid"};

/** 没给与给了空串都算没给（与配置变量的读法一致）。合规则的转小写：邮箱按小写存与比较。 */
function parseEmailArgument(raw: string | undefined): EmailArgument {
    if (raw === undefined || raw === "") return {kind: "absent"};
    return EMAIL_PATTERN.test(raw) ? {kind: "valid", email: raw.toLowerCase()} : {kind: "invalid"};
}

function invalidArgument(name: "username" | "email" | "password", problem: PasswordProblem): CreateAdminFailure {
    return {code: "invalid_argument", message: `create-admin rejected the ${name} (${problem})`, fields: {name, problem}};
}

const INTERRUPTED: CreateAdminFailure = {
    code: "interrupted",
    message: "create-admin was cancelled at the password prompt",
    fields: {module: "identity", command: CREATE_ADMIN_COMMAND},
};

interface Upsert {
    /** 小写的登录名。 */
    readonly username: string;
    /** 原样的写法；新建时也用作显示名（`site.legacy-import`：显示名为空时取用户名的原样写法）。 */
    readonly displayUsername: string;
    readonly email: EmailArgument;
    readonly passwordHash: string;
    readonly now: number;
}

type UpsertResult =
    | {readonly kind: "done"; readonly userId: number; readonly created: boolean}
    | {readonly kind: "email_invalid"}
    | {readonly kind: "email_taken"};

/** 写事务的回调：同步执行，结果之外的失败（`email_*`）没有写入任何东西。 */
function upsertAdmin(tx: IdentityTx, input: Upsert): UpsertResult {
    const at = libDate(input.now);
    const existing = tx.query<{id: number}, [string]>(`SELECT "id" FROM "user" WHERE "username" = ?`).get(input.username);
    if (existing !== null) {
        const userId = existing.id;
        // 解封：库的解封同样清掉封禁原因与到期时间（计划第 10 节第 4 条：留着封禁就拿不回管理员）。邮箱不动（`site.operations` 输出 5）。
        tx.query(`UPDATE "user" SET "role" = 'admin', "banned" = 0, "banReason" = NULL, "banExpires" = NULL, "updatedAt" = ? WHERE "id" = ?`).run(at, userId);
        const updated = tx.query(`UPDATE "account" SET "password" = ?, "updatedAt" = ? WHERE "userId" = ? AND "providerId" = 'credential'`).run(input.passwordHash, at, userId);
        if (updated.changes === 0) insertCredentialRow(tx, {userId, passwordHash: input.passwordHash, now: input.now});
        endAllSessions(tx, userId, input.now);
        appendAudit(tx, {actorId: null, action: "admin.cli_upsert", targetType: "user", targetId: userId, params: {created: false}, now: input.now});
        return {kind: "done", userId, created: false};
    }

    // 邮箱只在新建时校验与查重：已存在的账号忽略给的邮箱（omp 设计审查第 15 条）。
    if (input.email.kind === "invalid") return {kind: "email_invalid"};
    if (input.email.kind === "valid" && tx.query(`SELECT 1 FROM "user" WHERE "email" = ?`).get(input.email.email) !== null) return {kind: "email_taken"};
    // 占位邮箱带账号 id，id 要插入之后才知道：先填一个临时的唯一值（用户名是唯一的，`pending.` 开头的写法别处不用），拿到 id 再改。
    // 两步在同一个事务里，别人看不到临时值。
    const email = input.email.kind === "valid" ? input.email.email : `pending.${input.username}@placeholder.invalid`;
    const userId = insertUserRow(tx, {username: input.username, displayUsername: input.displayUsername, name: input.displayUsername, email, role: "admin", now: input.now});
    const emailPending = input.email.kind === "absent";
    if (emailPending) tx.query(`UPDATE "user" SET "email" = ? WHERE "id" = ?`).run(placeholderEmail(userId), userId);
    tx.query(`INSERT INTO identity_profile (user_id, email_pending) VALUES (?, ?)`).run(userId, emailPending ? 1 : 0);
    insertCredentialRow(tx, {userId, passwordHash: input.passwordHash, now: input.now});
    appendAudit(tx, {actorId: null, action: "admin.cli_upsert", targetType: "user", targetId: userId, params: {created: true}, now: input.now});
    return {kind: "done", userId, created: true};
}

/**
 * 写库，撞忙时按 `retry` 重试；每次尝试之前看一次 `signal`，睡眠也在 abort 时立即 reject。用完仍忙回 null。
 * 尝试之前的检查到 `BEGIN IMMEDIATE` 之间只隔着命令自己那条连接上的队列：没有别人排队，只过几轮微任务，信号处理函数（宏任务）
 * 落不进去，所以事务里不再看一次。
 */
async function writeWithRetry<T>(options: CreateAdminOptions, fn: (tx: IdentityTx) => T): Promise<T | null> {
    const retry = options.busyRetry ?? DEFAULT_BUSY_RETRY;
    for (let attempt = 0; ; attempt += 1) {
        if (options.signal.aborted) throw options.signal.reason;
        try {
            return await options.conn.write(fn);
        } catch (error) {
            if (!isBusy(error)) throw error;
            if (attempt >= retry.retries) return null;
        }
        await retry.sleep(retry.delayMs, options.signal);
    }
}

/**
 * 运行命令。成功时 resolve 为 undefined 并写一行 `identity.admin_upserted`；预料之中的失败 resolve 为 `CreateAdminFailure`；
 * 停止信号 reject 为 `signal.reason`。
 */
export async function runCreateAdmin(options: CreateAdminOptions): Promise<CreateAdminFailure | undefined> {
    // 参数先于密码校验：用户名不对时不必先输两遍密码。邮箱要看账号存不存在才知道算不算数，在写事务里判。
    const rawUsername = options.args.username ?? "";
    if (rawUsername === "") return invalidArgument("username", "missing");
    const username = parseUsernameInput(rawUsername);
    if (username === undefined) return invalidArgument("username", "invalid");
    const email = parseEmailArgument(options.args.email);

    const outcome = await readPassword(options.input, options.signal);
    if (outcome.kind === "cancelled") return INTERRUPTED;
    if (outcome.kind === "invalid") return invalidArgument("password", outcome.problem);

    const passwordHash = await (options.hash ?? hashPassword)(outcome.password);
    const result = await writeWithRetry(options, (tx) => upsertAdmin(tx, {username, displayUsername: rawUsername, email, passwordHash, now: options.clock.now()}));
    if (result === null) {
        return {code: "unavailable", message: "the identity database stayed locked by another process", fields: {module: "identity"}};
    }
    switch (result.kind) {
        case "email_invalid":
            return invalidArgument("email", "invalid");
        case "email_taken":
            return {code: "email_taken", message: "the email is already used by another account"};
        case "done":
            // 不写用户名、邮箱与密码：日志只认账号 id（`site.operations` 输出 5 要求的两个字段，另加邮箱是否被忽略）。
            options.log.info("identity.admin_upserted", "an administrator account was created or reset from the command line", {
                userId: result.userId,
                created: result.created,
                emailIgnored: !result.created && email.kind !== "absent",
            });
            return undefined;
    }
}
