/**
 * 按收集清单校验三种上报并归一成要记入的记录（docs/specs/telemetry/protocol.md 输出 3 到 6、13；字段表与取值表）。
 *
 * 这里只管协议输出 13 里从“请求体不是 JSON 对象”起的几步；内容类型、来源地址、限流、请求体大小排在它们前面，由写入口
 * 先判。三种上报各写一个函数，各自照协议写自己的必填项与版本规则，只共用逐个字段判的那部分（`checkObject`）。
 *
 * 逐个字段判，不拿一整份的 schema 判：整份的 schema 出错时报不出是哪个字段，也表达不了丢弃与版本回退
 * （合同包 `manifest/reports.ts` 的模块头）。每个字段的 schema 第一次用到时编译一次。
 *
 * 读请求方给的对象一律用 `Object.hasOwn`：JSON 里的 `__proto__`、`constructor` 是普通的键，`in` 与按键取值会摸到
 * 原型上的东西（例如 `owner` 写成 `constructor` 时取到 `Object.prototype.constructor`）。
 */

import {ANONYMOUS_MANIFESTS, REPORT_ENVELOPE, USAGE_MANIFESTS} from "@notnotype/nb-site-telemetry-contract";
import type {AnonymousManifest, Field, FieldTable, IngestKind, UsageManifest} from "@notnotype/nb-site-telemetry-contract";
import type {TSchema} from "typebox";
import {Compile} from "typebox/compile";

import {isoWeekMonday, isoWeekMondayOf} from "./days";

/** 不合格时只回 `invalid_report` 与出问题的字段：嵌套的写点分路径，请求体不是 JSON 对象时为 null（协议输出 12）。 */
export type Validation<R> = {readonly ok: true; readonly record: R; readonly dropped: readonly string[]} | {readonly ok: false; readonly field: string | null};

/** 记入时的两个清单版本：发送方声明的，与服务端实际按它校验、记入的（生效的，协议输出 5）。 */
export interface AnonymousVersions {
    readonly declared: number;
    readonly effective: number;
}

/** `usage.errors` 的一项：`[owner, code, 次数分档]`。 */
export type UsageError = readonly [owner: string, code: string, count: string];

/** 服务端记下的使用段；`version` 是使用档的生效版本。 */
export interface UsageSegment {
    readonly version: number;
    readonly errors: readonly UsageError[];
    readonly crashes: string;
    readonly upgrade: string;
}

/** daysSinceLast 的整数编码：first 记 0，1 到 28 记原值，more 记 29（清单第 1 版；表的注释同此）。 */
export const DAYS_SINCE_LAST_FIRST = 0;
export const DAYS_SINCE_LAST_MORE = 29;

export interface DailyRecord {
    readonly reportId: string;
    readonly anonymous: AnonymousVersions;
    /** 发送方声明的使用档版本；`manifest.usage` 没给时为 null。比服务端新时照记，哪怕使用段被丢弃了。 */
    readonly usageDeclared: number | null;
    readonly appVersion: string;
    readonly channel: string;
    readonly form: string;
    readonly osVersion: string;
    readonly arch: string;
    readonly locale: string;
    readonly region: string;
    readonly daysSinceLast: number;
    readonly installWeek: string;
    readonly usageEnabled: boolean;
    readonly noticeSeen: string;
    /** 没带使用段、或使用档版本比服务端新而整段丢弃时为 null。生效版本只在这里，所以“版本与使用段同在同不在”由类型保证。 */
    readonly usage: UsageSegment | null;
}

export interface HeartbeatRecord {
    /** 匿名档的生效版本：心跳只按它聚合。 */
    readonly anonymousVersion: number;
    readonly appVersion: string;
    readonly form: string;
}

export interface EventRecord {
    readonly reportId: string;
    readonly anonymous: AnonymousVersions;
    /** 立即事件属于使用档，两个版本都必有；比服务端新时生效的是服务端认识的最新版本（协议 POST /v1/event）。 */
    readonly usage: {readonly declared: number; readonly effective: number};
    readonly appVersion: string;
    readonly form: string;
    readonly kind: string;
    /** 省略了 `code` 时为 null。 */
    readonly code: string | null;
}

export interface ValidatedRecords {
    readonly daily: DailyRecord;
    readonly heartbeat: HeartbeatRecord;
    readonly event: EventRecord;
}

/** 服务端认识的清单版本。产品用合同包的版本表（`validateReport`）；测试可以另给一套，造出版本表里有空号、码表各不相同的情况。 */
export interface ManifestSet {
    readonly anonymous: ReadonlyMap<number, AnonymousManifest>;
    readonly usage: ReadonlyMap<number, UsageManifest>;
}

/**
 * 按种类校验一份已经解析成 JSON 的请求体。`serverDay` 是记入用的服务端日：`installWeek` 的范围按它所在的周算。
 * 不会抛错：请求体是什么样子都只回合格或不合格。
 */
export type ReportValidator = <K extends IngestKind>(kind: K, body: unknown, serverDay: number) => Validation<ValidatedRecords[K]>;

interface Checker {
    Check(value: unknown): boolean;
}

/** 清单的版本发布后不改、被冻住（合同包 `fields.ts` 的 `deepFreeze`），所以按 schema 对象缓存编译结果是安全的。 */
const compiled = new WeakMap<TSchema, Checker>();

function check(schema: TSchema, value: unknown): boolean {
    let checker = compiled.get(schema);
    if (checker === undefined) compiled.set(schema, (checker = Compile(schema)));
    return checker.Check(value);
}

type JsonObject = Readonly<Record<string, unknown>>;

/** JSON 里的对象（不是数组、不是 null）。 */
function isObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinPath(prefix: string, name: string): string {
    return prefix === "" ? name : `${prefix}.${name}`;
}

/** 某个字段取值合格之后的额外规则，键是字段的点分路径；只用于取值要看服务端状态的字段（`installWeek` 的范围）。 */
type Refinements = Readonly<Record<string, (value: unknown) => boolean>>;

/**
 * 按一层字段表判一个对象，返回第一个不合格的字段的路径，全部合格时为 null。字段按表里的顺序判，先遇到的决定回应
 * （协议输出 13 的最后一项）。表里没有的键记进 `dropped`：`dropPath` 是不带数组下标的路径（协议输出 3），同一个路径只记一次。
 * 不合格时 `dropped` 里可能已经记了一些，调用方丢掉它。
 */
function checkObject(table: FieldTable, object: JsonObject, path: string, dropPath: string, dropped: Set<string>, refinements: Refinements): string | null {
    for (const key of Object.keys(object)) if (!Object.hasOwn(table, key)) dropped.add(joinPath(dropPath, key));
    for (const [name, field] of Object.entries(table)) {
        const fieldPath = joinPath(path, name);
        // 可省的字段先看在不在：`Type.Optional` 包着的 schema 单独对 undefined 校验是不通过的。
        if (!Object.hasOwn(object, name)) {
            if (field.required) return fieldPath;
            continue;
        }
        const failed = checkField(field, object[name], object, path, fieldPath, joinPath(dropPath, name), dropped, refinements);
        if (failed !== null) return failed;
    }
    return null;
}

function checkField(field: Field, value: unknown, owner: JsonObject, path: string, fieldPath: string, dropPath: string, dropped: Set<string>, refinements: Refinements): string | null {
    switch (field.kind) {
        case "value": {
            const refine = refinements[fieldPath];
            return check(field.schema, value) && (refine === undefined || refine(value)) ? null : fieldPath;
        }
        case "dependent": {
            // 取值表按同一层的 `dependsOn` 取（合同包 `types.ts`）。决定它的字段本身不合格时报那个字段：没有它就无从判这一个。
            const controller = owner[field.dependsOn];
            if (typeof controller !== "string" || !Object.hasOwn(field.schemaBy, controller)) return joinPath(path, field.dependsOn);
            return check(field.schemaBy[controller]!, value) ? null : fieldPath;
        }
        case "group":
            return isObject(value) ? checkObject(field.fields, value, fieldPath, dropPath, dropped, refinements) : fieldPath;
        case "list": {
            if (!check(field.schema, value)) return fieldPath;
            const seen = new Set<string>();
            for (const [index, item] of (value as readonly unknown[]).entries()) {
                const itemPath = `${fieldPath}.${index}`;
                if (!isObject(item)) return itemPath;
                const failed = checkObject(field.item.fields, item, itemPath, dropPath, dropped, refinements);
                if (failed !== null) return failed;
                // 这几个字段的组合至多出现一次；重复时报后出现的那一项。项里的字段这时都已合格。
                const key = JSON.stringify(field.uniqueBy.map((name) => item[name]));
                if (seen.has(key)) return itemPath;
                seen.add(key);
            }
            return null;
        }
        default: {
            const unreachable: never = field;
            throw new Error(`unknown field kind ${JSON.stringify(unreachable)}`);
        }
    }
}

/**
 * 清单版本号的合格写法：不小于 1 的整数（合同包 `envelope.ts` 的 schema），另要求是安全整数，免得 `1e300` 这种
 * 比任何版本都“新”的数一路当成最新版本。`1.0` 在 JSON 里与 `1` 是同一个数，解析后分不出来，照 TypeBox 的行为算整数。
 */
function isVersionNumber(value: unknown): value is number {
    return check(VERSION_SCHEMA, value) && Number.isSafeInteger(value);
}

const VERSION_SCHEMA: TSchema = (() => {
    const field = REPORT_ENVELOPE.daily.manifest.fields.anonymous;
    if (field?.kind !== "value") throw new Error("manifest.anonymous must be a value field");
    return field.schema;
})();

type Resolved<M> = {readonly kind: "known"; readonly manifest: M} | {readonly kind: "newer"} | {readonly kind: "rejected"};

/** 比认识的最新版本还新的是 `newer`；不合格、或不新却不在表里（比最旧的还旧，或是中间缺的号）的是 `rejected`（协议输出 13）。 */
function resolveVersion<M>(versions: ReadonlyMap<number, M>, latest: number, value: unknown): Resolved<M> {
    if (!isVersionNumber(value)) return {kind: "rejected"};
    if (value > latest) return {kind: "newer"};
    const manifest = versions.get(value);
    return manifest === undefined ? {kind: "rejected"} : {kind: "known", manifest};
}

function latestOf<M extends {readonly version: number}>(versions: ReadonlyMap<number, M>, tier: string): M {
    let latest: M | undefined;
    for (const manifest of versions.values()) if (latest === undefined || manifest.version > latest.version) latest = manifest;
    if (latest === undefined) throw new Error(`no ${tier} manifest versions`);
    return latest;
}

const reject = (field: string | null): {readonly ok: false; readonly field: string | null} => ({ok: false, field});

/**
 * 每日上报的 `installWeek` 只收服务端日所在周往前 13 周到往后 1 周（含两端）之间的周，另收 `older`（协议字段表）。
 * 写法由清单的 schema 先判过；写法对、这一年却没有这一周（例如没有第 53 周的年份写了 W53）同样不合格。
 */
function installWeekInRange(serverDay: number): (value: unknown) => boolean {
    const current = isoWeekMondayOf(serverDay);
    return (value) => {
        if (value === "older") return true;
        const match = typeof value === "string" ? /^(\d{4})-W(\d{2})$/u.exec(value) : null;
        if (match === null) return false;
        const monday = isoWeekMonday(Number(match[1]), Number(match[2]));
        return monday !== null && monday >= current - 13 * 7 && monday <= current + 7;
    };
}

/**
 * 归一时按名字取字段：调用前 `checkObject` 已按生效版本的字段表判过，这些字段都在、取值都合格。名字是清单第 1 版的，
 * 新版本改了字段时这里与表的列一起改。
 */
const text = (object: JsonObject, name: string): string => object[name] as string;

export function createReportValidator(manifests: ManifestSet): ReportValidator {
    const latestAnonymous = latestOf(manifests.anonymous, "anonymous");
    const latestUsage = latestOf(manifests.usage, "usage");

    /** 生效版本的匿名档：比服务端新时按认识的最新版本（协议输出 5）。 */
    const anonymousOf = (value: unknown): AnonymousManifest | null => {
        const resolved = resolveVersion(manifests.anonymous, latestAnonymous.version, value);
        return resolved.kind === "known" ? resolved.manifest : resolved.kind === "newer" ? latestAnonymous : null;
    };

    const validateDaily = (body: unknown, serverDay: number): Validation<DailyRecord> => {
        if (!isObject(body)) return reject(null);

        // `manifest`：匿名档必有；使用档可省，有就要合格。
        if (!Object.hasOwn(body, "manifest") || !isObject(body.manifest)) return reject("manifest");
        const manifest = body.manifest;
        if (!Object.hasOwn(manifest, "anonymous")) return reject("manifest.anonymous");
        const anonymous = anonymousOf(manifest.anonymous);
        if (anonymous === null) return reject("manifest.anonymous");
        const declaresUsage = Object.hasOwn(manifest, "usage");
        const usageVersion = declaresUsage ? resolveVersion(manifests.usage, latestUsage.version, manifest.usage) : null;
        if (usageVersion?.kind === "rejected") return reject("manifest.usage");

        // 带了使用段：先于逐个字段判，使用档版本比服务端新、整段要丢弃时同样判（协议输出 6、13）。
        const hasUsage = Object.hasOwn(body, "usage");
        if (hasUsage && body.usageEnabled !== true) return reject("usage");
        if (hasUsage && usageVersion === null) return reject("manifest.usage");

        // 版本比服务端新时字段表里没有 `usage`，它整段作为不认识的字段进 `dropped`，里面的内容不看（协议输出 5）。
        const usageManifest = hasUsage && usageVersion?.kind === "known" ? usageVersion.manifest : null;
        const table: FieldTable = {
            manifest: REPORT_ENVELOPE.daily.manifest,
            reportId: REPORT_ENVELOPE.daily.reportId,
            ...anonymous.daily,
            ...(usageManifest === null ? {} : {usage: usageManifest.usage}),
        };
        const dropped = new Set<string>();
        const failed = checkObject(table, body, "", "", dropped, {installWeek: installWeekInRange(serverDay)});
        if (failed !== null) return reject(failed);

        const daysSinceLast = body.daysSinceLast;
        const usage = usageManifest === null ? null : (body.usage as JsonObject);
        const record: DailyRecord = {
            reportId: text(body, "reportId"),
            anonymous: {declared: manifest.anonymous as number, effective: anonymous.version},
            usageDeclared: declaresUsage ? (manifest.usage as number) : null,
            appVersion: text(body, "appVersion"),
            channel: text(body, "channel"),
            form: text(body, "form"),
            osVersion: text(body, "osVersion"),
            arch: text(body, "arch"),
            locale: text(body, "locale"),
            region: text(body, "region"),
            daysSinceLast: daysSinceLast === "first" ? DAYS_SINCE_LAST_FIRST : daysSinceLast === "more" ? DAYS_SINCE_LAST_MORE : (daysSinceLast as number),
            installWeek: text(body, "installWeek"),
            usageEnabled: body.usageEnabled as boolean,
            noticeSeen: text(body, "noticeSeen"),
            usage:
                usage === null
                    ? null
                    : {
                          version: usageManifest!.version,
                          errors: (usage.errors as readonly JsonObject[]).map((item) => [text(item, "owner"), text(item, "code"), text(item, "count")] as const),
                          crashes: text(usage, "crashes"),
                          upgrade: text(usage, "upgrade"),
                      },
        };
        return {ok: true, record, dropped: [...dropped]};
    };

    const validateHeartbeat = (body: unknown): Validation<HeartbeatRecord> => {
        if (!isObject(body)) return reject(null);

        // 心跳只带匿名档的版本；`manifest.usage` 不在它的字段表里，带了就按不认识的字段丢弃。
        if (!Object.hasOwn(body, "manifest") || !isObject(body.manifest)) return reject("manifest");
        const manifest = body.manifest;
        if (!Object.hasOwn(manifest, "anonymous")) return reject("manifest.anonymous");
        const anonymous = anonymousOf(manifest.anonymous);
        if (anonymous === null) return reject("manifest.anonymous");

        const table: FieldTable = {manifest: REPORT_ENVELOPE.heartbeat.manifest, ...anonymous.heartbeat};
        const dropped = new Set<string>();
        const failed = checkObject(table, body, "", "", dropped, {});
        if (failed !== null) return reject(failed);
        return {ok: true, record: {anonymousVersion: anonymous.version, appVersion: text(body, "appVersion"), form: text(body, "form")}, dropped: [...dropped]};
    };

    const validateEvent = (body: unknown): Validation<EventRecord> => {
        if (!isObject(body)) return reject(null);

        // 立即事件属于使用档：`manifest.usage` 必填，缺了按 `manifest` 不合格、报 `manifest.usage`；比服务端新时按认识的
        // 最新版本处理，不丢弃整条（协议 POST /v1/event）。
        if (!Object.hasOwn(body, "manifest") || !isObject(body.manifest)) return reject("manifest");
        const manifest = body.manifest;
        if (!Object.hasOwn(manifest, "anonymous")) return reject("manifest.anonymous");
        const anonymous = anonymousOf(manifest.anonymous);
        if (anonymous === null) return reject("manifest.anonymous");
        if (!Object.hasOwn(manifest, "usage")) return reject("manifest.usage");
        const usageVersion = resolveVersion(manifests.usage, latestUsage.version, manifest.usage);
        if (usageVersion.kind === "rejected") return reject("manifest.usage");
        const usage = usageVersion.kind === "known" ? usageVersion.manifest : latestUsage;

        const table: FieldTable = {manifest: REPORT_ENVELOPE.event.manifest, reportId: REPORT_ENVELOPE.event.reportId, ...anonymous.event, ...usage.event};
        const dropped = new Set<string>();
        const failed = checkObject(table, body, "", "", dropped, {});
        if (failed !== null) return reject(failed);
        const record: EventRecord = {
            reportId: text(body, "reportId"),
            anonymous: {declared: manifest.anonymous as number, effective: anonymous.version},
            usage: {declared: manifest.usage as number, effective: usage.version},
            appVersion: text(body, "appVersion"),
            form: text(body, "form"),
            kind: text(body, "kind"),
            code: Object.hasOwn(body, "code") ? text(body, "code") : null,
        };
        return {ok: true, record, dropped: [...dropped]};
    };

    const byKind: {readonly [K in IngestKind]: (body: unknown, serverDay: number) => Validation<ValidatedRecords[K]>} = {
        daily: validateDaily,
        heartbeat: validateHeartbeat,
        event: validateEvent,
    };
    return (kind, body, serverDay) => byKind[kind](body, serverDay);
}

/** 按合同包里服务端认识的清单版本校验。 */
export const validateReport: ReportValidator = createReportValidator({anonymous: ANONYMOUS_MANIFESTS, usage: USAGE_MANIFESTS});
