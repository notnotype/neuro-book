/**
 * 产品的模块列表：把两个模块包导出的迁移清单、读配置与建实例的函数包成 `SiteModule`（为什么由入口做适配见 `module.ts`）。
 * `satisfies` 让类型检查核对模块包的形状与 `SiteModule` 对得上；对不上时在这里报错，而不是在运行时。
 */

import {createAdminCommand, createIdentityModule, identityMigrations, parseIdentityConfig, type IdentityConfig} from "@notnotype/nb-site-identity";
import {IDENTITY_API_PREFIX, IDENTITY_AUTH_PREFIX} from "@notnotype/nb-site-identity-contract";
import {createTelemetryModule, parseTelemetryConfig, prepareTelemetryBackupCopy, TELEMETRY_INGEST_PREFIX, telemetryMigrations, type TelemetryConfig} from "@notnotype/nb-site-telemetry";
import {TELEMETRY_API_PREFIX} from "@notnotype/nb-site-telemetry-contract";

import type {SiteModule} from "./module";

const identity = {
    name: "identity",
    surfaces: ["site"],
    migrations: identityMigrations,
    parseConfig: parseIdentityConfig,
    create: async (context) => {
        const module = await createIdentityModule({
            db: context.db,
            config: context.config,
            siteUrl: context.site.siteUrl,
            log: context.log,
            clock: context.clock,
            jobs: context.jobs,
            clientAddress: (c) => context.clientAddress(c),
        });
        // “问身份”（`site.accounts` 输出 7；t07 计划 3.11）跟着这个实例走：统计模块（t11）要的是这里的 `module.whoami`，接上时在
        // 同一次装配里从实例上取。不记进本文件的模块级变量：那样进程里后建的实例会盖掉先建的，实例关闭之后也还指着它（实现审查
        // 第 6 条）。拆成两个进程时，同一个形状就是对 `whoami` 端点的 `fetch`。
        // 三个前缀互不重叠（计划 3.13）：自家接口、库的对外端点（白名单在 `module.oauth` 里）、两份发现文档。
        return {
            mounts: [
                {surface: "site", prefix: IDENTITY_API_PREFIX, app: module.site},
                {surface: "site", prefix: IDENTITY_AUTH_PREFIX, app: module.oauth},
                {surface: "site", prefix: "/.well-known", app: module.wellKnown},
            ],
            close: () => module.close(),
        };
    },
    commands: [createAdminCommand],
} satisfies SiteModule<IdentityConfig>;

/**
 * 统计模块在两个入口上各有一个 mount：站点地址上的接口（`TELEMETRY_API_PREFIX`），写入口主机上的三个写入口
 * （`TELEMETRY_INGEST_PREFIX`）。声明了写入口（`ingest`），所以进程要求 `NB_SITE_TELEMETRY_URL`。备份时在副本上清掉原始上报
 * （`prepareTelemetryBackupCopy`，`site.operations` 输出 6）。
 */
const telemetry = {
    name: "telemetry",
    surfaces: ["site", "ingest"],
    migrations: telemetryMigrations,
    parseConfig: parseTelemetryConfig,
    create: (context) => {
        const module = createTelemetryModule({
            db: context.db,
            config: context.config,
            log: context.log,
            clock: context.clock,
            jobs: context.jobs,
            clientAddress: (c) => context.clientAddress(c),
        });
        return {
            mounts: [
                {surface: "site", prefix: TELEMETRY_API_PREFIX, app: module.site},
                {surface: "ingest", prefix: TELEMETRY_INGEST_PREFIX, app: module.ingest},
            ],
            close: () => module.close(),
        };
    },
    prepareBackupCopy: prepareTelemetryBackupCopy,
} satisfies SiteModule<TelemetryConfig>;

export const SITE_MODULES: readonly SiteModule[] = [identity, telemetry];
