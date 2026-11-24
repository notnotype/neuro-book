/**
 * 收集清单的版本表。读的一方只经这里取版本：服务端按收到的版本号取字段表（取不到就是不认识的版本，怎样处理见
 * docs/specs/telemetry/protocol.md 输出 5 与 13），应用的遥测插件与官网取最新的版本。
 */

import {ANONYMOUS_VERSIONS} from "./anonymous";
import {USAGE_VERSIONS} from "./usage";
import type {AnonymousManifest, UsageManifest} from "./types";

function byVersion<M extends {readonly version: number}>(versions: readonly M[]): ReadonlyMap<number, M> {
    return new Map(versions.map((manifest) => [manifest.version, manifest]));
}

/** 匿名档的每个版本，键是版本号。 */
export const ANONYMOUS_MANIFESTS: ReadonlyMap<number, AnonymousManifest> = byVersion(ANONYMOUS_VERSIONS);

/** 使用档的每个版本，键是版本号。 */
export const USAGE_MANIFESTS: ReadonlyMap<number, UsageManifest> = byVersion(USAGE_VERSIONS);

/** 最新的匿名档：应用组装上报、官网生成说明都用它。 */
export const LATEST_ANONYMOUS_MANIFEST: AnonymousManifest = ANONYMOUS_VERSIONS[ANONYMOUS_VERSIONS.length - 1]!;

/** 最新的使用档。 */
export const LATEST_USAGE_MANIFEST: UsageManifest = USAGE_VERSIONS[USAGE_VERSIONS.length - 1]!;

export {REPORT_ENVELOPE} from "./envelope";
export {dailyReportSchema, eventReportSchema, heartbeatReportSchema} from "./reports";
export type {AnonymousManifest, Bilingual, CountBucket, DependentField, Field, FieldTable, GroupField, ListField, ManifestLocale, ReportEnvelope, Tier, UsageManifest, ValueField, ValueTable} from "./types";
