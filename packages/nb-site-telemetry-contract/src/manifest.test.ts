/**
 * 收集清单对着 docs/specs/telemetry/protocol.md 的核对。“协议逐项”一节的期望值是照协议的字段表与取值表手写的：
 * 协议改了，这里跟着改，再改清单（加一个新版本，不改旧版本）。
 */

import {describe, expect, it} from "bun:test";
import type {TSchema} from "typebox";
import {Value} from "typebox/value";

import {
    ANONYMOUS_MANIFESTS,
    dailyReportSchema,
    eventReportSchema,
    heartbeatReportSchema,
    LATEST_ANONYMOUS_MANIFEST,
    LATEST_USAGE_MANIFEST,
    REPORT_ENVELOPE,
    USAGE_MANIFESTS,
} from "./index";
import type {AnonymousManifest, Bilingual, DependentField, Field, UsageManifest, ValueField} from "./index";

const A1 = ANONYMOUS_MANIFESTS.get(1)!;
const U1 = USAGE_MANIFESTS.get(1)!;

/** 第 1 版的自带插件名单（`packages/neuro-book/src/manifest.ts` 的 `productPlugins`，2026-11-24），加上 `other`。 */
const OWNERS_V1 = [
    "runtime.diagnostics", "nbook.http", "nbook.state", "nbook.settings", "nbook.commands", "nbook.storage", "nbook.network", "nbook.models", "nbook.tasks",
    "nbook.agent", "nbook.stickers", "nbook.bots", "nbook.web-tools", "nbook.plugins", "nbook.workbench", "nbook.projects", "nbook.files", "nbook.explorer",
    "nbook.markdown", "nbook.editor", "nbook.image-viewer", "nbook.html-preview", "nbook.canon", "nbook.plot", "nbook.theme-study", "nbook.desktop", "other",
];

function sorted(values: Iterable<string>): string[] {
    return [...values].sort();
}

/** schema 接受的字符串字面量（`const`，含 `anyOf` 里的）。 */
function literalsOf(schema: TSchema): string[] {
    const node = schema as {readonly const?: unknown; readonly anyOf?: readonly TSchema[]};
    if (typeof node.const === "string") return [node.const];
    return (node.anyOf ?? []).flatMap(literalsOf);
}

function valueField(field: Field | undefined): ValueField {
    if (field?.kind !== "value") throw new Error(`expected a value field, got ${field?.kind}`);
    return field;
}

function dependentField(field: Field | undefined): DependentField {
    if (field?.kind !== "dependent") throw new Error(`expected a dependent field, got ${field?.kind}`);
    return field;
}

function valuesOf(field: Field | undefined): string[] {
    return sorted(Object.keys(valueField(field).values ?? {}));
}

/** 一份清单里的每个字段，带点分路径。 */
function* walk(table: Readonly<Record<string, Field>>, prefix: string): Generator<[string, Field]> {
    for (const [name, field] of Object.entries(table)) {
        const path = prefix === "" ? name : `${prefix}.${name}`;
        yield [path, field];
        if (field.kind === "group") yield* walk(field.fields, path);
        if (field.kind === "list") yield* walk(field.item.fields, path);
    }
}

function fieldsOfAnonymous(manifest: AnonymousManifest): Array<[string, Field]> {
    return [...walk(manifest.daily, "daily"), ...walk(manifest.heartbeat, "heartbeat"), ...walk(manifest.event, "event")];
}

function fieldsOfUsage(manifest: UsageManifest): Array<[string, Field]> {
    return [...walk({usage: manifest.usage}, "daily"), ...walk(manifest.event, "event")];
}

const ALL_FIELDS: Array<[string, Field]> = [
    ...[...ANONYMOUS_MANIFESTS.values()].flatMap((manifest) => fieldsOfAnonymous(manifest).map(([path, field]): [string, Field] => [`anonymous ${manifest.version} ${path}`, field])),
    ...[...USAGE_MANIFESTS.values()].flatMap((manifest) => fieldsOfUsage(manifest).map(([path, field]): [string, Field] => [`usage ${manifest.version} ${path}`, field])),
    ...walk(REPORT_ENVELOPE.daily, "envelope daily"),
    ...walk(REPORT_ENVELOPE.heartbeat, "envelope heartbeat"),
    ...walk(REPORT_ENVELOPE.event, "envelope event"),
];

/** 说明缺了一种语言、是空的、或英文里混着汉字时，返回问题；没有问题返回 null。 */
function bilingualProblem(text: Bilingual | undefined): string | null {
    if (text === undefined) return "missing";
    for (const locale of ["zh-CN", "en-US"] as const) {
        const value = (text as Partial<Bilingual>)[locale];
        if (typeof value !== "string" || value.trim() === "") return `no ${locale}`;
    }
    if (/\p{Script=Han}/u.test(text["en-US"])) return "en-US contains Chinese";
    return null;
}

describe("收集清单：版本表", () => {
    it("两档的版本号都从 1 起连续，表里的键就是清单自己的版本号，最新的是号最大的那个", () => {
        for (const [versions, latest] of [[ANONYMOUS_MANIFESTS, LATEST_ANONYMOUS_MANIFEST], [USAGE_MANIFESTS, LATEST_USAGE_MANIFEST]] as const) {
            const keys = [...versions.keys()];
            expect(keys).toEqual(keys.map((_, index) => index + 1));
            for (const [key, manifest] of versions) expect(manifest.version).toBe(key);
            expect(latest.version).toBe(keys.length);
        }
    });

    it("发布出去的版本是冻住的：读的一方改不了它", () => {
        expect(() => {
            (A1.daily.region!.values as Record<string, Bilingual>)["mars"] = {"zh-CN": "火星", "en-US": "Mars"};
        }).toThrow(TypeError);
        expect(() => {
            (U1 as {version: number}).version = 9;
        }).toThrow(TypeError);
    });
});

describe("收集清单：每个字段都能生成说明", () => {
    it("每个字段都有中英文说明", () => {
        const problems = ALL_FIELDS.flatMap(([path, field]) => {
            const problem = bilingualProblem(field.description);
            return problem === null ? [] : [`${path}: ${problem}`];
        });
        expect(problems).toEqual([]);
    });

    it("每个枚举取值都有中英文说明", () => {
        const problems: string[] = [];
        for (const [path, field] of ALL_FIELDS) {
            const tables = field.kind === "value" ? {"": field.values ?? {}} : field.kind === "dependent" ? field.valuesBy : {};
            for (const [by, table] of Object.entries(tables)) {
                for (const [value, text] of Object.entries(table)) {
                    const problem = bilingualProblem(text);
                    if (problem !== null) problems.push(`${path}${by === "" ? "" : `[${by}]`}=${value}: ${problem}`);
                }
            }
        }
        expect(problems).toEqual([]);
    });

    it("枚举字段的说明表与 schema 对得上：每个说明了的取值都被接受，schema 里的每个字面量都有说明", () => {
        const problems: string[] = [];
        for (const [path, field] of ALL_FIELDS) {
            if (field.kind !== "value") continue;
            const described = Object.keys(field.values ?? {});
            for (const value of described) if (!Value.Check(field.schema, value)) problems.push(`${path}: ${value} is described but rejected`);
            for (const literal of literalsOf(field.schema)) if (!described.includes(literal)) problems.push(`${path}: ${literal} is accepted but not described`);
        }
        expect(problems).toEqual([]);
    });

    it("枚举取值在一个字段里不重复", () => {
        for (const [path, field] of ALL_FIELDS) {
            if (field.kind !== "value") continue;
            const literals = literalsOf(field.schema);
            expect({path, literals: new Set(literals).size}).toEqual({path, literals: literals.length});
        }
    });

    it("取值随别的字段而变时，决定它的字段的每个取值都有一张取值表，且只取表里的值", () => {
        const problems: string[] = [];
        for (const manifest of USAGE_MANIFESTS.values()) {
            const tables: Array<[string, Readonly<Record<string, Field>>]> = [["usage.errors", manifest.usage.fields.errors!.kind === "list" ? manifest.usage.fields.errors.item.fields : {}], ["event", manifest.event]];
            for (const [where, table] of tables) {
                for (const [name, field] of Object.entries(table)) {
                    if (field.kind !== "dependent") continue;
                    const controller = valuesOf(table[field.dependsOn]);
                    if (sorted(Object.keys(field.valuesBy)).join() !== controller.join()) problems.push(`${where}.${name}: valuesBy does not cover ${field.dependsOn}`);
                    if (sorted(Object.keys(field.schemaBy)).join() !== controller.join()) problems.push(`${where}.${name}: schemaBy does not cover ${field.dependsOn}`);
                    for (const [by, values] of Object.entries(field.valuesBy)) {
                        const schema = field.schemaBy[by]!;
                        if (sorted(literalsOf(schema)).join() !== sorted(Object.keys(values)).join()) problems.push(`${where}.${name}[${by}]: schema and values differ`);
                    }
                }
            }
        }
        expect(problems).toEqual([]);
    });

    it("匿名档里没有取值随别的字段而变的字段", () => {
        const kinds = [...ANONYMOUS_MANIFESTS.values()].flatMap((manifest) => fieldsOfAnonymous(manifest).map(([, field]) => field.kind));
        expect(new Set(kinds)).toEqual(new Set(["value"]));
    });
});

describe("收集清单：与协议逐项一致（匿名档 1）", () => {
    it("每日上报、心跳、立即事件里各有哪些匿名档字段，全是匿名档、全是必填", () => {
        expect(sorted(Object.keys(A1.daily))).toEqual(sorted(["appVersion", "channel", "form", "osVersion", "arch", "locale", "region", "daysSinceLast", "installWeek", "usageEnabled", "noticeSeen"]));
        expect(sorted(Object.keys(A1.heartbeat))).toEqual(["appVersion", "form"]);
        expect(sorted(Object.keys(A1.event))).toEqual(["appVersion", "form"]);
        for (const [, field] of fieldsOfAnonymous(A1)) expect([field.tier, field.required]).toEqual(["anonymous", true]);
    });

    it("每个枚举字段的取值", () => {
        expect(valuesOf(A1.daily.channel)).toEqual(sorted(["canary", "preview", "stable"]));
        expect(valuesOf(A1.daily.form)).toEqual(sorted(["desktop", "cli"]));
        expect(valuesOf(A1.daily.osVersion)).toEqual(sorted(["windows-10", "windows-11", "windows", "macos-13", "macos-14", "macos-15", "macos-26", "macos-27", "macos", "linux", "other"]));
        expect(valuesOf(A1.daily.arch)).toEqual(sorted(["x64", "arm64", "other"]));
        expect(valuesOf(A1.daily.locale)).toEqual(sorted(["zh-CN", "en-US", "other"]));
        expect(valuesOf(A1.daily.region)).toEqual(sorted(["east-asia", "southeast-asia", "south-asia", "europe", "north-america", "latin-america", "middle-east-africa", "oceania", "other"]));
        expect(valuesOf(A1.daily.noticeSeen)).toEqual(sorted(["wizard", "workbench", "settings"]));
        expect(valuesOf(A1.daily.daysSinceLast)).toEqual(["first", "more"]);
        expect(valuesOf(A1.daily.installWeek)).toEqual(["older"]);
    });

    it("daysSinceLast 的数值只能是 1 到 28 的整数", () => {
        const schema = valueField(A1.daily.daysSinceLast).schema;
        for (const accepted of [1, 28, "first", "more"]) expect(Value.Check(schema, accepted)).toBe(true);
        for (const rejected of [0, 29, 1.5, "1", "28+"]) expect(Value.Check(schema, rejected)).toBe(false);
    });

    it("appVersion 是至多 32 个字符的语义化版本号", () => {
        const schema = valueField(A1.daily.appVersion).schema;
        for (const accepted of ["0.17.0", "1.0.0-canary.3", "1.2.3+build.7", `1.0.0-${"a".repeat(26)}`]) expect(Value.Check(schema, accepted)).toBe(true);
        for (const rejected of ["v0.17.0", "0.17", "01.2.3", "", `1.0.0-${"a".repeat(27)}`]) expect(Value.Check(schema, rejected)).toBe(false);
    });

    it("installWeek 是 ISO 周的写法或 older；日期范围由服务端判", () => {
        const schema = valueField(A1.daily.installWeek).schema;
        for (const accepted of ["2026-W48", "2026-W01", "2026-W53", "older", "1999-W10"]) expect(Value.Check(schema, accepted)).toBe(true);
        for (const rejected of ["2026-W00", "2026-W54", "2026-48", "2026-W4", "26-W48"]) expect(Value.Check(schema, rejected)).toBe(false);
    });

    it("usageEnabled 是布尔", () => {
        const schema = valueField(A1.daily.usageEnabled).schema;
        expect([true, false, "true", 1].map((value) => Value.Check(schema, value))).toEqual([true, true, false, false]);
    });
});

describe("收集清单：与协议逐项一致（使用档 1）", () => {
    it("usage 段里的字段与 errors 每一项的字段", () => {
        const errors = U1.usage.fields.errors!;
        expect([U1.usage.tier, U1.usage.required]).toEqual(["usage", false]);
        expect(sorted(Object.keys(U1.usage.fields))).toEqual(["crashes", "errors", "upgrade"]);
        expect(errors.kind).toBe("list");
        if (errors.kind !== "list") return;
        expect(sorted(Object.keys(errors.item.fields))).toEqual(["code", "count", "owner"]);
        expect(errors.maxItems).toBe(50);
        expect(errors.uniqueBy).toEqual(["owner", "code"]);
        for (const [, field] of fieldsOfUsage(U1)) expect(field.tier).toBe("usage");
    });

    it("次数分档：0、1、2-4、5-9、10-49、50+，首尾相接、从 0 起；分档字段只取这些档", () => {
        const names = ["0", "1", "2-4", "5-9", "10-49", "50+"];
        expect(U1.countBuckets.map((bucket) => bucket.name)).toEqual(names);
        expect(U1.countBuckets[0]!.min).toBe(0);
        expect(U1.countBuckets.at(-1)!.max).toBeNull();
        for (let index = 1; index < U1.countBuckets.length; index += 1) expect(U1.countBuckets[index]!.min).toBe(U1.countBuckets[index - 1]!.max! + 1);
        const errors = U1.usage.fields.errors!;
        if (errors.kind !== "list") throw new Error("errors is not a list");
        expect(valuesOf(errors.item.fields.count)).toEqual(sorted(names));
        expect(valuesOf(U1.usage.fields.crashes)).toEqual(sorted(names));
    });

    it("upgrade 与立即事件的种类", () => {
        expect(valuesOf(U1.usage.fields.upgrade)).toEqual(sorted(["none", "succeeded", "failed"]));
        expect(sorted(Object.keys(U1.event))).toEqual(["code", "kind"]);
        expect(valuesOf(U1.event.kind)).toEqual(sorted(["crash", "upgrade_failed"]));
    });

    it("owner 是自带插件的名单加 other；code 按 owner 取码表，owner 为 other 时只能是 other", () => {
        const errors = U1.usage.fields.errors!;
        if (errors.kind !== "list") throw new Error("errors is not a list");
        expect(valuesOf(errors.item.fields.owner)).toEqual(sorted(OWNERS_V1));
        const code = dependentField(errors.item.fields.code);
        expect(code.dependsOn).toBe("owner");
        expect(Object.keys(code.valuesBy.other!)).toEqual(["other"]);
        // 第 1 版的码表：每个 owner 只有 other（来由见 usage.ts 的文件头）。
        for (const owner of OWNERS_V1) expect(Object.keys(code.valuesBy[owner]!)).toEqual(["other"]);
    });

    it("立即事件的 code 按 kind 取码表，可以省略", () => {
        const code = dependentField(U1.event.code);
        expect([code.dependsOn, code.required]).toEqual(["kind", false]);
        // 第 1 版同样：每个 kind 只有 other。
        expect(Object.fromEntries(Object.entries(code.valuesBy).map(([kind, values]) => [kind, Object.keys(values)]))).toEqual({crash: ["other"], upgrade_failed: ["other"]});
    });
});

describe("收集清单：不属于哪一档的字段", () => {
    it("每日上报与立即事件带上报编号，心跳不带；立即事件的 manifest.usage 必填，每日上报的可省", () => {
        expect(sorted(Object.keys(REPORT_ENVELOPE.daily))).toEqual(["manifest", "reportId"]);
        expect(sorted(Object.keys(REPORT_ENVELOPE.heartbeat))).toEqual(["manifest"]);
        expect(sorted(Object.keys(REPORT_ENVELOPE.event))).toEqual(["manifest", "reportId"]);
        expect(Object.fromEntries(Object.entries(REPORT_ENVELOPE.daily.manifest.fields).map(([name, field]) => [name, field.required]))).toEqual({anonymous: true, usage: false});
        expect(Object.fromEntries(Object.entries(REPORT_ENVELOPE.event.manifest.fields).map(([name, field]) => [name, field.required]))).toEqual({anonymous: true, usage: true});
        expect(Object.keys(REPORT_ENVELOPE.heartbeat.manifest.fields)).toEqual(["anonymous"]);
        for (const [, field] of [...walk(REPORT_ENVELOPE.daily, ""), ...walk(REPORT_ENVELOPE.event, "")]) expect(field.tier).toBeNull();
    });

    it("上报编号是 22 到 64 个字母、数字、_ 或 -；清单版本是正整数", () => {
        const reportId = REPORT_ENVELOPE.daily.reportId.schema;
        for (const accepted of ["a".repeat(22), "A_b-9".repeat(12) + "abcd", "Z".repeat(64)]) expect(Value.Check(reportId, accepted)).toBe(true);
        for (const rejected of ["a".repeat(21), "a".repeat(65), `${"a".repeat(21)}=`, `${"a".repeat(21)}.`, `${"a".repeat(21)}中`]) expect(Value.Check(reportId, rejected)).toBe(false);
        const version = valueField(REPORT_ENVELOPE.daily.manifest.fields.anonymous).schema;
        expect([1, 7, 0, -1, 1.5, "1"].map((value) => Value.Check(version, value))).toEqual([true, true, false, false, false, false]);
    });
});

describe("三种上报的 schema", () => {
    const REPORT_ID = "r8fQx2_kLm9-Zp4Tq7Wv1a";
    const anonymousDaily = {
        appVersion: "0.17.0",
        channel: "canary",
        form: "desktop",
        osVersion: "windows-11",
        arch: "x64",
        locale: "zh-CN",
        region: "east-asia",
        daysSinceLast: 3,
        installWeek: "2026-W45",
        noticeSeen: "wizard",
    };
    const dailyWithUsage = {
        manifest: {anonymous: 1, usage: 1},
        reportId: REPORT_ID,
        ...anonymousDaily,
        usageEnabled: true,
        usage: {errors: [{owner: "nbook.files", code: "other", count: "2-4"}, {owner: "other", code: "other", count: "1"}], crashes: "0", upgrade: "succeeded"},
    };
    const dailyWithoutUsage = {manifest: {anonymous: 1}, reportId: REPORT_ID, ...anonymousDaily, usageEnabled: false};
    const heartbeat = {manifest: {anonymous: 1}, appVersion: "0.17.0", form: "cli"};
    const event = {manifest: {anonymous: 1, usage: 1}, reportId: REPORT_ID, appVersion: "0.17.0", form: "desktop", kind: "upgrade_failed", code: "other"};

    const daily = dailyReportSchema(A1, U1);
    const dailyAnonymousOnly = dailyReportSchema(A1, null);
    const beat = heartbeatReportSchema(A1);
    const immediate = eventReportSchema(A1, U1);

    it("合格的每日上报（带使用档与不带）、心跳、立即事件各自过自己的 schema", () => {
        expect(Value.Check(daily, dailyWithUsage)).toBe(true);
        expect(Value.Check(dailyAnonymousOnly, dailyWithoutUsage)).toBe(true);
        expect(Value.Check(beat, heartbeat)).toBe(true);
        expect(Value.Check(immediate, event)).toBe(true);
        const {code: _omitted, ...eventWithoutCode} = event;
        expect(Value.Check(immediate, eventWithoutCode)).toBe(true);
    });

    it("多出来的字段照样放行（协议输出 3：丢弃，不拒收）", () => {
        expect(Value.Check(beat, {...heartbeat, extra: 1, manifest: {anonymous: 1, x: 2}})).toBe(true);
    });

    it("不合格的上报不过", () => {
        const rejected: Array<[string, TSchema, unknown]> = [
            ["区域不在表里", dailyAnonymousOnly, {...dailyWithoutUsage, region: "mars"}],
            ["缺 installWeek", dailyAnonymousOnly, Object.fromEntries(Object.entries(dailyWithoutUsage).filter(([key]) => key !== "installWeek"))],
            ["不带使用档时出现 usage", dailyAnonymousOnly, {...dailyWithoutUsage, usage: dailyWithUsage.usage}],
            ["带使用档而 usageEnabled 为假", daily, {...dailyWithUsage, usageEnabled: false}],
            ["带使用档而没给 manifest.usage", daily, {...dailyWithUsage, manifest: {anonymous: 1}}],
            ["只在开发时加载的插件不是 owner", daily, {...dailyWithUsage, usage: {...dailyWithUsage.usage, errors: [{owner: "nbook.lab", code: "other", count: "1"}]}}],
            ["码不在这个 owner 的码表里", daily, {...dailyWithUsage, usage: {...dailyWithUsage.usage, errors: [{owner: "nbook.files", code: "not-found", count: "1"}]}}],
            ["次数不是分档的名字", daily, {...dailyWithUsage, usage: {...dailyWithUsage.usage, errors: [{owner: "nbook.files", code: "other", count: "3"}]}}],
            ["errors 超过 50 项", daily, {...dailyWithUsage, usage: {...dailyWithUsage.usage, errors: Array.from({length: 51}, () => ({owner: "other", code: "other", count: "1"}))}}],
            ["心跳缺 form", beat, {manifest: {anonymous: 1}, appVersion: "0.17.0"}],
            ["立即事件没给 manifest.usage", immediate, {...event, manifest: {anonymous: 1}}],
            ["立即事件的种类不在表里", immediate, {...event, kind: "hang"}],
            ["立即事件的码不在这个种类的码表里", immediate, {...event, code: "phase-swapping"}],
        ];
        const passed = rejected.filter(([, schema, report]) => Value.Check(schema, report)).map(([name]) => name);
        expect(passed).toEqual([]);
    });
});
