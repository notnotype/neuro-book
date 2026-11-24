/**
 * 产品的模块列表：把两个模块包导出的迁移清单、读配置与建实例的函数包成 `SiteModule`（为什么由入口做适配见 `module.ts`）。
 * `satisfies` 让类型检查核对模块包的形状与 `SiteModule` 对得上；对不上时在这里报错，而不是在运行时。
 */

import {createIdentityModule, identityMigrations, parseIdentityConfig, type IdentityConfig} from "@notnotype/nb-site-identity";
import {IDENTITY_API_PREFIX} from "@notnotype/nb-site-identity-contract";
import {createTelemetryModule, parseTelemetryConfig, telemetryMigrations, type TelemetryConfig} from "@notnotype/nb-site-telemetry";
import {TELEMETRY_API_PREFIX} from "@notnotype/nb-site-telemetry-contract";

import type {SiteModule} from "./module";

const identity = {
    name: "identity",
    surfaces: ["site"],
    migrations: identityMigrations,
    parseConfig: parseIdentityConfig,
    create: (context) => {
        const module = createIdentityModule({db: context.db, config: context.config, log: context.log});
        return {mounts: [{surface: "site", prefix: IDENTITY_API_PREFIX, app: module.site}]};
    },
} satisfies SiteModule<IdentityConfig>;

/** 统计模块声明了写入口（`ingest`），所以进程要求 `NB_SITE_TELEMETRY_URL`；写入口上的 mount 由 t06 加。 */
const telemetry = {
    name: "telemetry",
    surfaces: ["site", "ingest"],
    migrations: telemetryMigrations,
    parseConfig: parseTelemetryConfig,
    create: (context) => {
        const module = createTelemetryModule({db: context.db, config: context.config, log: context.log});
        return {mounts: [{surface: "site", prefix: TELEMETRY_API_PREFIX, app: module.site}]};
    },
} satisfies SiteModule<TelemetryConfig>;

export const SITE_MODULES: readonly SiteModule[] = [identity, telemetry];
