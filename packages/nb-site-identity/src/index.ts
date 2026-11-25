/**
 * 账号模块的公开入口。进程入口 `nb-site-server` 用这里的三样东西把模块包成它的 `SiteModule`：迁移清单、读配置、建实例。
 *
 * 本包不导入进程入口的类型：入口依赖模块包，反过来导入就成了环（ADR 0059 决策 2 只许模块依赖自己的合同包与通用包）。
 * 所以选项与返回值的类型由本包自己声明，入口的适配器负责对上形状。模块之间要用到的东西（统计模块问身份）也由适配器转接。
 */

import type {Database} from "bun:sqlite";
import type {Hono} from "hono";

import {IdentityConnection} from "./db/connection";
import {assembleIdentity, type IdentityAssemblyOptions} from "./module";

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
    return {site: assembly.site, whoami: (request) => assembly.sessions.whoami(request), close: assembly.close};
}
