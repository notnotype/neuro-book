/**
 * 统计模块的公开入口。进程入口 `nb-site-server` 用这里的三样东西把模块包成它的 `SiteModule`：迁移清单、读配置、建实例。
 *
 * 本包不导入进程入口的类型：入口依赖模块包，反过来导入就成了环（ADR 0059 决策 2 只许模块依赖自己的合同包与通用包）。
 * 所以选项与返回值的类型由本包自己声明，入口的适配器负责对上形状。要问账号模块的事（t07 以后的“问身份”）也由适配器作为参数传进来。
 */

import type {Database} from "bun:sqlite";
import {Hono} from "hono";

import type {TelemetryConfig} from "./config";

export {telemetryMigrations, type TelemetryMigration} from "./migrations";
export {parseTelemetryConfig, type TelemetryConfig, type TelemetryConfigProblem, type TelemetryConfigResult} from "./config";

/** 模块写日志的出口；`event` 是稳定的英文事件名，`message` 是英文说明，`fields` 不放秘密、正文与来源地址。 */
export interface TelemetryLog {
    info(event: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
    warn(event: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
    error(event: string, message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface TelemetryModuleOptions {
    /** 本模块自己的库连接，迁移已全部执行；只有本模块写它（ADR 0061 决策 1）。 */
    readonly db: Database;
    readonly config: TelemetryConfig;
    readonly log: TelemetryLog;
}

export interface TelemetryModule {
    /** 站点地址上的子应用；入口把它挂在 `TELEMETRY_API_PREFIX` 下，子应用里的路由不再带前缀。写入口（t06）另给一个挂在写入口主机上的子应用。 */
    readonly site: Hono;
}

export function createTelemetryModule(_options: TelemetryModuleOptions): TelemetryModule {
    return {site: new Hono()};
}
