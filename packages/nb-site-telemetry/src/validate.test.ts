/**
 * 校验的全表（docs/specs/telemetry/protocol.md 输出 3 到 6、12、13 与字段表、取值表）：
 * - 按清单逐个字段生成用例：缺了必填的、取值不在 schema 里的、每个列出的取值都收；
 * - 手写的：协议写明的边界（编号长度、版本号、`installWeek` 的范围与跨年）、版本的回退与拒收、使用段的三种情况、
 *   几处同时不合格时报哪一处、`dropped` 的写法、归一后的记录。
 * 生成的用例只拿清单当“哪些取值合格”的来源，期望的字段路径与先后照协议写。
 */

import {describe, expect, it} from "bun:test";
import {ANONYMOUS_MANIFESTS, REPORT_ENVELOPE, USAGE_MANIFESTS} from "@notnotype/nb-site-telemetry-contract";
import type {AnonymousManifest, DependentField, Field, IngestKind, UsageManifest, ValueField} from "@notnotype/nb-site-telemetry-contract";
import {Type} from "typebox";
import {Value} from "typebox/value";

import {formatIsoWeek, serverDayAt} from "./days";
import {createReportValidator, validateReport} from "./validate";

type Json = Record<string, unknown>;

const SERVER_DAY = serverDayAt(Date.parse("2026-11-24T12:00:00Z"));
const ANONYMOUS_V1 = ANONYMOUS_MANIFESTS.get(1)!;
const USAGE_V1 = USAGE_MANIFESTS.get(1)!;

const REPORT_ID = "abcdefghijklmnopqrstuv_-0123456789";

function daily(): Json {
    return {
        manifest: {anonymous: 1},
        reportId: REPORT_ID,
        appVersion: "0.17.0",
        channel: "stable",
        form: "desktop",
        osVersion: "linux",
        arch: "x64",
        locale: "zh-CN",
        region: "east-asia",
        daysSinceLast: 3,
        installWeek: formatIsoWeek(SERVER_DAY),
        usageEnabled: false,
        noticeSeen: "wizard",
    };
}

function dailyWithUsage(): Json {
    return {
        ...daily(),
        manifest: {anonymous: 1, usage: 1},
        usageEnabled: true,
        usage: {errors: [{owner: "nbook.files", code: "other", count: "2-4"}, {owner: "other", code: "other", count: "1"}], crashes: "0", upgrade: "none"},
    };
}

function heartbeat(): Json {
    return {manifest: {anonymous: 1}, appVersion: "0.17.0", form: "cli"};
}

function event(): Json {
    return {manifest: {anonymous: 1, usage: 1}, reportId: REPORT_ID, appVersion: "0.17.0", form: "desktop", kind: "crash", code: "other"};
}

const BASES: Record<IngestKind, () => Json> = {daily: dailyWithUsage, heartbeat, event};

type Path = readonly (string | number)[];

function at(body: Json, path: Path): Json {
    let current: unknown = body;
    for (const key of path) current = (current as Record<string | number, unknown>)[key];
    return current as Json;
}

/** 把 `body` 里 `path` 处的值换成 `value`；`value` 为 `undefined` 时删掉这个键。 */
function withValue(body: Json, path: Path, value: unknown): Json {
    const copy = structuredClone(body);
    const parent = at(copy, path.slice(0, -1)) as Record<string | number, unknown>;
    const key = path[path.length - 1]!;
    if (value === undefined) delete parent[key];
    else parent[key] = value;
    return copy;
}

const rejectedAt = (field: string | null) => ({ok: false, field}) as const;

/** 各种类型、各种长度的取值；对每个字段只挑出它的 schema 不收的那些。 */
const CANDIDATES: readonly unknown[] = [null, true, false, 0, -1, 1.5, 29, "", "x", "not-a-listed-value", "constructor", "__proto__", "1", "x".repeat(65), [], {}, ["stable"]];

interface Target {
    readonly route: IngestKind;
    /** 改这个字段之前的合格样例。 */
    readonly base: () => Json;
    readonly path: Path;
    readonly field: ValueField | DependentField;
}

/** 使用段里只有一项错误：改这一项的 owner 或 code 时不会和别的项撞成重复的一对。 */
function dailyWithOneError(): Json {
    return withValue(dailyWithUsage(), ["usage", "errors"], [{owner: "nbook.files", code: "other", count: "2-4"}]);
}

/**
 * 三种上报里每个取值字段的位置，按清单的字段表列出（`manifest` 的版本号另有手写用例）。每日上报的匿名档字段用不带使用段的样例：
 * 带着使用段时，缺了 `usageEnabled` 或它不为真先按“带了使用段”拒收（协议输出 13），轮不到逐个字段判。
 */
function targets(): Target[] {
    const list: Target[] = [];
    const add = (route: IngestKind, base: () => Json, prefix: Path, table: Readonly<Record<string, Field>>): void => {
        for (const [name, field] of Object.entries(table)) {
            if (field.kind === "value" || field.kind === "dependent") list.push({route, base, path: [...prefix, name], field});
        }
    };
    add("daily", daily, [], {reportId: REPORT_ENVELOPE.daily.reportId, ...ANONYMOUS_V1.daily});
    add("daily", dailyWithUsage, ["usage"], USAGE_V1.usage.fields);
    const errors = USAGE_V1.usage.fields.errors;
    if (errors?.kind !== "list") throw new Error("usage.errors must be a list");
    add("daily", dailyWithOneError, ["usage", "errors", 0], errors.item.fields);
    add("heartbeat", heartbeat, [], ANONYMOUS_V1.heartbeat);
    add("event", event, [], {reportId: REPORT_ENVELOPE.event.reportId, ...ANONYMOUS_V1.event, ...USAGE_V1.event});
    return list;
}

/** 这个字段在 `body` 里此刻适用的 schema：`dependent` 按同一层的决定字段取。 */
function schemaIn(target: Target, body: Json) {
    if (target.field.kind === "value") return target.field.schema;
    const controller = at(body, [...target.path.slice(0, -1), target.field.dependsOn]) as unknown as string;
    return target.field.schemaBy[controller]!;
}

function listedValues(target: Target, body: Json): string[] {
    if (target.field.kind === "value") return Object.keys(target.field.values ?? {});
    const controller = at(body, [...target.path.slice(0, -1), target.field.dependsOn]) as unknown as string;
    return Object.keys(target.field.valuesBy[controller]!);
}

describe("按清单逐个字段（协议输出 4）", () => {
    it("每种上报的合格样例本身合格", () => {
        for (const route of ["daily", "heartbeat", "event"] as const) {
            expect({route, result: validateReport(route, BASES[route](), SERVER_DAY).ok}).toEqual({route, result: true});
        }
        expect(validateReport("daily", daily(), SERVER_DAY).ok).toBe(true);
    });

    for (const target of targets()) {
        const name = `${target.route} ${target.path.join(".")}`;
        const fieldPath = target.path.join(".");

        it(`${name}：${target.field.required ? "缺了拒收" : "可省"}`, () => {
            const result = validateReport(target.route, withValue(target.base(), target.path, undefined), SERVER_DAY);
            expect(result.ok ? "ok" : result.field).toBe(target.field.required ? fieldPath : "ok");
        });

        it(`${name}：schema 不收的取值拒收，报这个字段`, () => {
            const base = target.base();
            const bad = CANDIDATES.filter((value) => !Value.Check(schemaIn(target, base), value));
            expect(bad.length).toBeGreaterThan(0);
            for (const value of bad) {
                const result = validateReport(target.route, withValue(base, target.path, value), SERVER_DAY);
                expect({value, result}).toEqual({value, result: rejectedAt(fieldPath)});
            }
        });

        it(`${name}：清单列出的每个取值都收`, () => {
            const base = target.base();
            for (const value of listedValues(target, base)) {
                const result = validateReport(target.route, withValue(base, target.path, value), SERVER_DAY);
                expect({value, ok: result.ok}).toEqual({value, ok: true});
            }
        });
    }

    it("usage 段、errors 列表与它的项不是对象或数组时拒收，报这一层", () => {
        for (const value of [null, "x", 1, []]) expect(validateReport("daily", withValue(dailyWithUsage(), ["usage"], value), SERVER_DAY)).toEqual(rejectedAt("usage"));
        for (const value of [null, "x", {}]) expect(validateReport("daily", withValue(dailyWithUsage(), ["usage", "errors"], value), SERVER_DAY)).toEqual(rejectedAt("usage.errors"));
        for (const value of [null, "x", [], 1]) expect(validateReport("daily", withValue(dailyWithUsage(), ["usage", "errors", 1], value), SERVER_DAY)).toEqual(rejectedAt("usage.errors.1"));
    });
});

describe("协议写明的边界", () => {
    const dailyWith = (name: string, value: unknown) => validateReport("daily", withValue(daily(), [name], value), SERVER_DAY);

    it("reportId：22 到 64 个字符，只含大小写字母、数字、_、-", () => {
        expect(dailyWith("reportId", "a".repeat(22)).ok).toBe(true);
        expect(dailyWith("reportId", "Z9_-".repeat(16)).ok).toBe(true);
        expect(dailyWith("reportId", "a".repeat(21))).toEqual(rejectedAt("reportId"));
        expect(dailyWith("reportId", "a".repeat(65))).toEqual(rejectedAt("reportId"));
        expect(dailyWith("reportId", `${"a".repeat(21)}!`)).toEqual(rejectedAt("reportId"));
        expect(dailyWith("reportId", `${"a".repeat(21)}é`)).toEqual(rejectedAt("reportId"));
    });

    it("appVersion：语义化版本，至多 32 个字符", () => {
        expect(dailyWith("appVersion", "1.2.3-preview.4+build.5").ok).toBe(true);
        expect(dailyWith("appVersion", `1.2.3-${"a".repeat(26)}`).ok).toBe(true);
        expect(dailyWith("appVersion", `1.2.3-${"a".repeat(27)}`)).toEqual(rejectedAt("appVersion"));
        for (const value of ["v1.2.3", "1.2", "01.2.3", "other"]) expect(dailyWith("appVersion", value)).toEqual(rejectedAt("appVersion"));
    });

    it("daysSinceLast：first、1 到 28 的整数、more", () => {
        for (const value of ["first", 1, 28, "more"]) expect(dailyWith("daysSinceLast", value).ok).toBe(true);
        for (const value of [0, 29, 1.5, "3", "never"]) expect(dailyWith("daysSinceLast", value)).toEqual(rejectedAt("daysSinceLast"));
    });

    it("installWeek：写法不对拒收", () => {
        for (const value of ["2026-W54", "2026-W00", "2026-48", "26-W48", "2026-w48"]) expect(dailyWith("installWeek", value)).toEqual(rejectedAt("installWeek"));
    });
});

describe("installWeek 的范围：服务端日往前两天那一天所在周往前 13 周到服务端日所在周往后 1 周，含两端（协议字段表）", () => {
    const installWeek = (day: string, week: string) => validateReport("daily", withValue(daily(), ["installWeek"], week), serverDayAt(Date.parse(`${day}T12:00:00Z`)));

    it("2026-11-25（周三）在 2026-W48，往前两天是同一周的周一：收 W35 到 W49 与 older", () => {
        for (const week of ["2026-W35", "2026-W48", "2026-W49", "older"]) expect({week, ok: installWeek("2026-11-25", week).ok}).toEqual({week, ok: true});
        for (const week of ["2026-W34", "2026-W50", "2027-W48", "2025-W48"]) expect({week, result: installWeek("2026-11-25", week)}).toEqual({week, result: rejectedAt("installWeek")});
    });

    it("每周开头两天下限仍按上一周算：2026-11-23（周一）往前两天是 W47 的周六，收 W47 的下限 W34；上限仍是 W49", () => {
        for (const week of ["2026-W34", "2026-W49"]) expect({week, ok: installWeek("2026-11-23", week).ok}).toEqual({week, ok: true});
        for (const week of ["2026-W33", "2026-W50"]) expect({week, result: installWeek("2026-11-23", week)}).toEqual({week, result: rejectedAt("installWeek")});
    });

    it("跨年与第 53 周：2027-01-01 在 2026-W53，收 2026-W40 到 2027-W01", () => {
        for (const week of ["2026-W40", "2026-W53", "2027-W01"]) expect({week, ok: installWeek("2027-01-01", week).ok}).toEqual({week, ok: true});
        for (const week of ["2026-W39", "2027-W02"]) expect({week, result: installWeek("2027-01-01", week)}).toEqual({week, result: rejectedAt("installWeek")});
    });

    it("往前跨年：2026-01-01 在 2026-W01，收 2025-W40 到 2026-W02；2025 年没有第 53 周", () => {
        for (const week of ["2025-W40", "2025-W52", "2026-W01", "2026-W02"]) expect({week, ok: installWeek("2026-01-01", week).ok}).toEqual({week, ok: true});
        for (const week of ["2025-W39", "2025-W53", "2026-W03"]) expect({week, result: installWeek("2026-01-01", week)}).toEqual({week, result: rejectedAt("installWeek")});
    });
});

describe("请求体与清单版本（协议输出 5、13）", () => {
    it("请求体不是 JSON 对象：field 为 null，三种上报都一样", () => {
        for (const route of ["daily", "heartbeat", "event"] as const) {
            for (const body of [null, [], ["x"], "x", 1, true]) expect({route, body, result: validateReport(route, body, SERVER_DAY)}).toEqual({route, body, result: rejectedAt(null)});
        }
    });

    it("manifest 缺了或不是对象报 manifest，匿名档的版本缺了或不合格报 manifest.anonymous", () => {
        for (const route of ["daily", "heartbeat", "event"] as const) {
            for (const value of [undefined, null, 1, [1]]) expect(validateReport(route, withValue(BASES[route](), ["manifest"], value), SERVER_DAY)).toEqual(rejectedAt("manifest"));
            for (const value of [undefined, 0, -1, 1.5, "1", null, 2 ** 53, 1e300]) {
                expect({route, value, result: validateReport(route, withValue(BASES[route](), ["manifest", "anonymous"], value), SERVER_DAY)}).toEqual({route, value, result: rejectedAt("manifest.anonymous")});
            }
        }
    });

    it("JSON 里写成 1.0 的版本号与 1 是同一个数，照收", () => {
        const body = JSON.parse(JSON.stringify(daily()).replace('"anonymous":1', '"anonymous":1.0'));
        expect(validateReport("daily", body, SERVER_DAY).ok).toBe(true);
    });

    it("匿名档版本比服务端新：照服务端认识的最新版本记入，新字段进 dropped", () => {
        const result = validateReport("daily", {...daily(), manifest: {anonymous: 5}, futureField: 1}, SERVER_DAY);
        expect(result).toMatchObject({ok: true, dropped: ["futureField"], record: {anonymous: {declared: 5, effective: 1}}});
        expect(validateReport("heartbeat", {...heartbeat(), manifest: {anonymous: 5}}, SERVER_DAY)).toMatchObject({ok: true, record: {anonymousVersion: 1}});
    });

    it("服务端不认识的更旧版本（比最旧的还旧，或是中间缺的号）拒收", () => {
        const anonymousV3: AnonymousManifest = {...ANONYMOUS_V1, version: 3};
        const usageV3: UsageManifest = {...USAGE_V1, version: 3};
        const validate = createReportValidator({anonymous: new Map([[1, ANONYMOUS_V1], [3, anonymousV3]]), usage: new Map([[1, USAGE_V1], [3, usageV3]])});
        expect(validate("daily", {...daily(), manifest: {anonymous: 2}}, SERVER_DAY)).toEqual(rejectedAt("manifest.anonymous"));
        expect(validate("daily", {...daily(), manifest: {anonymous: 3}}, SERVER_DAY)).toMatchObject({ok: true, record: {anonymous: {declared: 3, effective: 3}}});
        expect(validate("daily", {...daily(), manifest: {anonymous: 4}}, SERVER_DAY)).toMatchObject({ok: true, record: {anonymous: {declared: 4, effective: 3}}});
        expect(validate("daily", {...dailyWithUsage(), manifest: {anonymous: 1, usage: 2}}, SERVER_DAY)).toEqual(rejectedAt("manifest.usage"));
        expect(validate("event", {...event(), manifest: {anonymous: 1, usage: 2}}, SERVER_DAY)).toEqual(rejectedAt("manifest.usage"));
        expect(validate("event", {...event(), manifest: {anonymous: 1, usage: 4}}, SERVER_DAY)).toMatchObject({ok: true, record: {usage: {declared: 4, effective: 3}}});
    });

    it("每日上报的使用档版本有就要合格", () => {
        for (const value of [0, "1", 1.5, null]) expect(validateReport("daily", withValue(dailyWithUsage(), ["manifest", "usage"], value), SERVER_DAY)).toEqual(rejectedAt("manifest.usage"));
    });
});

describe("使用段（协议输出 5、6）", () => {
    it("同意了使用统计、这一份没带使用段：合格，没有使用段，声明的版本照记", () => {
        const body = withValue(dailyWithUsage(), ["usage"], undefined);
        expect(validateReport("daily", body, SERVER_DAY)).toEqual({ok: true, dropped: [], record: expect.objectContaining({usageEnabled: true, usageDeclared: 1, usage: null})});
    });

    it("使用档版本比服务端新：整段丢弃、不看内容，dropped 里有 usage，匿名档字段照常记入", () => {
        const body = {...dailyWithUsage(), manifest: {anonymous: 1, usage: 9}, usage: {errors: "garbage", newCategory: {}}};
        expect(validateReport("daily", body, SERVER_DAY)).toEqual({ok: true, dropped: ["usage"], record: expect.objectContaining({channel: "stable", usageDeclared: 9, usage: null})});
    });

    it("带了使用段而 errors 是空的：合格，使用段在、错误为空", () => {
        const body = withValue(dailyWithUsage(), ["usage", "errors"], []);
        expect(validateReport("daily", body, SERVER_DAY)).toEqual({ok: true, dropped: [], record: expect.objectContaining({usage: {version: 1, errors: [], crashes: "0", upgrade: "none"}})});
    });

    it("usageEnabled 不为真却带了使用段：拒收，报 usage", () => {
        for (const value of [false, undefined, "true", 1]) expect(validateReport("daily", withValue(dailyWithUsage(), ["usageEnabled"], value), SERVER_DAY)).toEqual(rejectedAt("usage"));
    });

    it("带了使用段而没给 manifest.usage：拒收，报 manifest.usage", () => {
        expect(validateReport("daily", withValue(dailyWithUsage(), ["manifest", "usage"], undefined), SERVER_DAY)).toEqual(rejectedAt("manifest.usage"));
    });

    it("usage.errors 至多 50 项，同一对 owner 与 code 至多出现一次（重复时报后出现的那一项）", () => {
        const item = {owner: "other", code: "other", count: "1"};
        expect(validateReport("daily", withValue(dailyWithUsage(), ["usage", "errors"], Array.from({length: 51}, () => item)), SERVER_DAY)).toEqual(rejectedAt("usage.errors"));
        const twice = [{owner: "nbook.files", code: "other", count: "1"}, {owner: "other", code: "other", count: "1"}, {owner: "nbook.files", code: "other", count: "5-9"}];
        expect(validateReport("daily", withValue(dailyWithUsage(), ["usage", "errors"], twice), SERVER_DAY)).toEqual(rejectedAt("usage.errors.2"));
    });

    it("owner 写成原型上的名字时按不在名单里拒收", () => {
        for (const owner of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
            const body = JSON.parse(JSON.stringify(dailyWithUsage()).replace('"owner":"nbook.files"', `"owner":"${owner}"`));
            expect({owner, result: validateReport("daily", body, SERVER_DAY)}).toEqual({owner, result: rejectedAt("usage.errors.0.owner")});
        }
    });
});

describe("取值随别的字段而变的字段按 dependsOn 取表", () => {
    const literals = (values: readonly string[]) => Type.Union(values.map((value) => Type.Literal(value)));
    const description = {"zh-CN": "测试", "en-US": "Test"};
    const valuesBy = {a: ["x", "other"], b: ["y", "other"], other: ["other"]};
    const table = (values: readonly string[]) => Object.fromEntries(values.map((value) => [value, description]));
    const usage: UsageManifest = (() => {
        const errors = USAGE_V1.usage.fields.errors;
        if (errors?.kind !== "list") throw new Error("usage.errors must be a list");
        const owner: ValueField = {kind: "value", tier: "usage", required: true, description, schema: literals(Object.keys(valuesBy)), values: table(Object.keys(valuesBy))};
        const code: DependentField = {
            kind: "dependent",
            tier: "usage",
            required: true,
            description,
            dependsOn: "owner",
            valuesBy: Object.fromEntries(Object.entries(valuesBy).map(([key, values]) => [key, table(values)])),
            schemaBy: Object.fromEntries(Object.entries(valuesBy).map(([key, values]) => [key, literals(values)])),
        };
        const kindCodes = {crash: ["boom", "other"], upgrade_failed: ["disk", "other"]};
        const eventCode: DependentField = {
            ...code,
            required: false,
            dependsOn: "kind",
            valuesBy: Object.fromEntries(Object.entries(kindCodes).map(([key, values]) => [key, table(values)])),
            schemaBy: Object.fromEntries(Object.entries(kindCodes).map(([key, values]) => [key, literals(values)])),
        };
        return {
            ...USAGE_V1,
            usage: {...USAGE_V1.usage, fields: {...USAGE_V1.usage.fields, errors: {...errors, item: {...errors.item, fields: {...errors.item.fields, owner, code}}}}},
            event: {...USAGE_V1.event, code: eventCode},
        };
    })();
    const validate = createReportValidator({anonymous: ANONYMOUS_MANIFESTS, usage: new Map([[1, usage]])});
    const withError = (owner: string, code: string) => withValue(dailyWithUsage(), ["usage", "errors"], [{owner, code, count: "1"}]);

    it("每个 owner 只收自己名下的码", () => {
        expect(validate("daily", withError("a", "x"), SERVER_DAY).ok).toBe(true);
        expect(validate("daily", withError("b", "y"), SERVER_DAY).ok).toBe(true);
        expect(validate("daily", withError("a", "y"), SERVER_DAY)).toEqual(rejectedAt("usage.errors.0.code"));
        expect(validate("daily", withError("b", "x"), SERVER_DAY)).toEqual(rejectedAt("usage.errors.0.code"));
        expect(validate("daily", withError("other", "x"), SERVER_DAY)).toEqual(rejectedAt("usage.errors.0.code"));
    });

    it("立即事件的码按 kind 取表，可省", () => {
        expect(validate("event", {...event(), kind: "crash", code: "boom"}, SERVER_DAY).ok).toBe(true);
        expect(validate("event", {...event(), kind: "upgrade_failed", code: "boom"}, SERVER_DAY)).toEqual(rejectedAt("code"));
        expect(validate("event", withValue(event(), ["code"], undefined), SERVER_DAY)).toMatchObject({ok: true, record: {code: null}});
    });
});

describe("几处同时不合格时报哪一处（协议输出 13）", () => {
    it("manifest 先于使用段、使用段先于逐个字段", () => {
        const broken = {...dailyWithUsage(), channel: "beta", usageEnabled: false, manifest: {anonymous: 0}};
        expect(validateReport("daily", broken, SERVER_DAY)).toEqual(rejectedAt("manifest.anonymous"));
        expect(validateReport("daily", {...broken, manifest: {anonymous: 1, usage: 1}}, SERVER_DAY)).toEqual(rejectedAt("usage"));
        expect(validateReport("daily", {...broken, manifest: {anonymous: 1}}, SERVER_DAY)).toEqual(rejectedAt("usage"));
        expect(validateReport("daily", {...broken, manifest: {anonymous: 1}, usageEnabled: true}, SERVER_DAY)).toEqual(rejectedAt("manifest.usage"));
        expect(validateReport("daily", {...broken, manifest: {anonymous: 1, usage: 1}, usageEnabled: true}, SERVER_DAY)).toEqual(rejectedAt("channel"));
    });

    it("使用档版本比服务端新、整段要丢弃时，usageEnabled 不为真照样拒收", () => {
        expect(validateReport("daily", {...dailyWithUsage(), manifest: {anonymous: 1, usage: 9}, usageEnabled: false}, SERVER_DAY)).toEqual(rejectedAt("usage"));
    });

    it("逐个字段判时按字段表的顺序，先遇到的决定回应", () => {
        expect(validateReport("daily", {...daily(), reportId: "short", appVersion: "bad", noticeSeen: "bad"}, SERVER_DAY)).toEqual(rejectedAt("reportId"));
        expect(validateReport("daily", {...daily(), noticeSeen: "bad", channel: "bad"}, SERVER_DAY)).toEqual(rejectedAt("channel"));
        expect(validateReport("daily", {...dailyWithUsage(), noticeSeen: "bad", usage: {errors: [], crashes: "many", upgrade: "none"}}, SERVER_DAY)).toEqual(rejectedAt("noticeSeen"));
        expect(validateReport("event", {...event(), form: "web", kind: "oops"}, SERVER_DAY)).toEqual(rejectedAt("form"));
    });

    it("立即事件缺 manifest.usage 先于逐个字段", () => {
        expect(validateReport("event", {...event(), manifest: {anonymous: 1}, kind: "oops"}, SERVER_DAY)).toEqual(rejectedAt("manifest.usage"));
    });
});

describe("不认识的字段进 dropped（协议输出 3）", () => {
    it("顶层写名字，嵌套的写点分路径，数组里的不带下标、不重复列", () => {
        const body = dailyWithUsage();
        const usage = body.usage as Json;
        const errors = usage.errors as Json[];
        const result = validateReport(
            "daily",
            {
                ...body,
                extra: 1,
                manifest: {...(body.manifest as Json), x: 1},
                usage: {...usage, x: 1, errors: [{...errors[0], note: "a"}, {...errors[1], note: "b", other: 2}]},
            },
            SERVER_DAY,
        );
        expect(result.ok && [...result.dropped].sort()).toEqual(["extra", "manifest.x", "usage.errors.note", "usage.errors.other", "usage.x"]);
    });

    it("JSON 里的 __proto__ 是普通的键，按不认识的字段丢弃", () => {
        const body = JSON.parse(JSON.stringify(daily()).replace("{", '{"__proto__":{"channel":"x"},'));
        expect(validateReport("daily", body, SERVER_DAY)).toMatchObject({ok: true, dropped: ["__proto__"]});
    });

    it("心跳的字段表里没有上报编号、使用段与使用档版本", () => {
        const result = validateReport("heartbeat", {...heartbeat(), manifest: {anonymous: 1, usage: "x"}, reportId: REPORT_ID, usage: {}}, SERVER_DAY);
        expect(result.ok && [...result.dropped].sort()).toEqual(["manifest.usage", "reportId", "usage"]);
    });

    it("立即事件的字段表里没有每日上报的字段", () => {
        expect(validateReport("event", {...event(), channel: "stable", usage: {}}, SERVER_DAY)).toMatchObject({ok: true, dropped: ["channel", "usage"]});
    });
});

describe("归一后的记录", () => {
    it("每日上报：daysSinceLast 编成整数，使用段的错误编成三元组，只留字段表里的字段", () => {
        const first = validateReport("daily", {...dailyWithUsage(), daysSinceLast: "first", extra: "dropped"}, SERVER_DAY);
        expect(first).toEqual({
            ok: true,
            dropped: ["extra"],
            record: {
                reportId: REPORT_ID,
                anonymous: {declared: 1, effective: 1},
                usageDeclared: 1,
                appVersion: "0.17.0",
                channel: "stable",
                form: "desktop",
                osVersion: "linux",
                arch: "x64",
                locale: "zh-CN",
                region: "east-asia",
                daysSinceLast: 0,
                installWeek: formatIsoWeek(SERVER_DAY),
                usageEnabled: true,
                noticeSeen: "wizard",
                usage: {version: 1, errors: [["nbook.files", "other", "2-4"], ["other", "other", "1"]], crashes: "0", upgrade: "none"},
            },
        });
        expect(validateReport("daily", {...daily(), daysSinceLast: "more"}, SERVER_DAY)).toMatchObject({record: {daysSinceLast: 29}});
        expect(validateReport("daily", {...daily(), daysSinceLast: 17}, SERVER_DAY)).toMatchObject({record: {daysSinceLast: 17, usageDeclared: null, usage: null}});
    });

    it("心跳与立即事件", () => {
        expect(validateReport("heartbeat", heartbeat(), SERVER_DAY)).toEqual({ok: true, dropped: [], record: {anonymousVersion: 1, appVersion: "0.17.0", form: "cli"}});
        expect(validateReport("event", event(), SERVER_DAY)).toEqual({
            ok: true,
            dropped: [],
            record: {reportId: REPORT_ID, anonymous: {declared: 1, effective: 1}, usage: {declared: 1, effective: 1}, appVersion: "0.17.0", form: "desktop", kind: "crash", code: "other"},
        });
    });
});
