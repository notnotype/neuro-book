/**
 * 账号模块的公开入口。进程入口 `nb-site-server` 用这里的三样东西把模块包成它的 `SiteModule`：迁移清单、读配置、建实例。
 *
 * 本包不导入进程入口的类型：入口依赖模块包，反过来导入就成了环（ADR 0059 决策 2 只许模块依赖自己的合同包与通用包）。
 * 所以选项与返回值的类型由本包自己声明，入口的适配器负责对上形状。模块之间要用到的东西（统计模块问身份）也由适配器转接。
 */

import type {Database} from "bun:sqlite";
import type {Hono} from "hono";

import {CREATE_ADMIN_COMMAND, createAdminConnection, runCreateAdmin, type CreateAdminFailure} from "./commands/create-admin";
import {processPasswordSource} from "./commands/read-password";
import {IdentityConnection} from "./db/connection";
import {assembleIdentity, type IdentityAssemblyOptions} from "./module";

export type {CreateAdminFailure} from "./commands/create-admin";
export {parseIdentityConfig, type IdentityConfig, type IdentityConfigProblem, type IdentityConfigResult} from "./config";
export {identityMigrations, type IdentityMigration} from "./migrations";
export type {IdentityJob} from "./module";

/** 模块写日志的出口；`event` 是稳定的英文事件名，`message` 是英文说明，`fields` 不放秘密与正文。 */
export interface IdentityLog {
    info(event: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
    warn(event: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
    error(event: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface IdentityModuleOptions extends IdentityAssemblyOptions {
    /**
     * 本模块自己的库连接，迁移已全部执行；只有本模块写它（ADR 0061 决策 1）。这里交给 `IdentityConnection`，模块的其余代码
     * 只经它的队列访问库（`db/connection.ts` 文件头）。
     */
    readonly db: Database;
}

export interface IdentityModule {
    /** 站点地址上的子应用；入口把它挂在 `IDENTITY_API_PREFIX` 下，子应用里的路由不再带前缀。 */
    readonly site: Hono;
    /** 库的对外端点（标准端点与社交回调）；入口把它挂在 `IDENTITY_AUTH_PREFIX` 下，子应用里的路由不带前缀（计划 3.13）。 */
    readonly oauth: Hono;
    /** 两份发现文档；入口把它挂在 `/.well-known` 下。 */
    readonly wellKnown: Hono;
    /**
     * 问身份（`site.accounts` 输出 7；计划 3.11）：与 `GET whoami` 是同一个函数，只读请求的 Cookie 头，回 `WhoamiResponse` 或 503 的
     * `ErrorBody`。统计模块（t11）经入口的适配器在进程内调它；拆成两个进程时同一个形状就是对 `whoami` 端点的 `fetch`。
     */
    whoami(request: Request): Promise<Response>;
    /** 停止时调用：队列拒收新的访问，再等当前持锁者放锁，至多 2 秒。不关连接（连接归入口）。 */
    close(): Promise<void>;
}

/** 建实例。库的结构对不上（表少了列）时 reject，入口按 `start_failed` 收口。 */
export async function createIdentityModule(options: IdentityModuleOptions): Promise<IdentityModule> {
    const conn = new IdentityConnection(options.db, {log: options.log});
    const assembly = await assembleIdentity(conn, options);
    return {site: assembly.site, oauth: assembly.oauth, wellKnown: assembly.wellKnown, whoami: (request) => assembly.sessions.whoami(request), close: assembly.close};
}

/** 入口交给模块命令的东西里本模块用到的部分；形状是入口 `CommandContext` 的子集，适配器原样转交。 */
export interface IdentityCommandContext {
    /** 命令自己的库连接，迁移已全部执行；命令返回后由入口关掉。这里交给 `IdentityConnection`，与模块实例同一条规则。 */
    readonly db: Database;
    readonly log: IdentityLog;
    readonly clock: {now(): number};
    readonly args: Readonly<Record<string, string | undefined>>;
    /** 进程第一次收到 `SIGTERM` 或 `SIGINT` 时 abort。 */
    readonly signal: AbortSignal;
}

/** 本模块的子命令；形状对得上入口的 `SiteCommand`，由 `nb-site-server/src/modules.ts` 登记。 */
export interface IdentityCommand {
    readonly name: string;
    readonly description: string;
    readonly access: "exclusive" | "shared";
    readonly arguments: readonly {readonly name: string; readonly required: boolean}[];
    run(context: IdentityCommandContext): Promise<CreateAdminFailure | undefined>;
}

/**
 * `create-admin <username> [email]`（`site.operations` 输出 5）。`shared`：等密码输入时不挡服务启动，服务在跑时也能执行
 * （`site.operations` 的时序一节）。密码从进程的标准输入读。
 */
export const createAdminCommand: IdentityCommand = {
    name: CREATE_ADMIN_COMMAND,
    description: "create an administrator account, or reset an existing account's password and make it an unbanned administrator; the password is read from standard input",
    access: "shared",
    arguments: [
        {name: "username", required: true},
        {name: "email", required: false},
    ],
    run: (context) =>
        runCreateAdmin({
            conn: createAdminConnection(context.db, context.log),
            log: context.log,
            clock: context.clock,
            args: context.args,
            signal: context.signal,
            input: processPasswordSource(),
        }),
};
