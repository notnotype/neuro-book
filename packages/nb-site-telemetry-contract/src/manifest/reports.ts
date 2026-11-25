/**
 * 由字段表拼出“按某个版本组装的一整份上报”的 schema：给发送方核对自己组装的上报、给测试造样例用。
 *
 * 服务端不拿它校验收到的上报：一整份的 schema 出错时报不出是哪个字段（联合类型一错报几条、缺字段时路径是空的），
 * 也表达不了协议里的丢弃与版本回退。服务端按字段表逐个字段判（docs/specs/telemetry/protocol.md 输出 13）。
 *
 * 和逐个字段判相比，这里有两处不同，都是 JSON Schema 本身的限制：多出来的字段照样放行（协议输出 3 是丢弃、不拒收）；
 * `list` 字段的 `uniqueBy`（同一对 `owner` 与 `code` 只出现一次）表达不了，不检查。
 */

import {Type} from "typebox";
import type {TSchema} from "typebox";

import {REPORT_ENVELOPE} from "./envelope";
import type {AnonymousManifest, DependentField, Field, UsageManifest, ValueField} from "./types";

type Table = Readonly<Record<string, Field>>;

function optionalUnless(required: boolean, schema: TSchema): TSchema {
    return required ? schema : Type.Optional(schema);
}

function fieldSchema(field: Exclude<Field, DependentField>): TSchema {
    switch (field.kind) {
        case "value":
            return field.schema;
        case "group":
            return tableSchema(field.fields);
        case "list":
            return Type.Array(tableSchema(field.item.fields), {maxItems: field.maxItems});
    }
}

/**
 * 一层字段表的对象 schema。有取值随别的字段而变的字段时，按决定它的那个字段的每个取值各写一个对象、取并集：
 * 决定它的字段在每个分支里是一个字面量，依赖它的字段取这时的 schema。一层里只许有一个决定别人的字段，
 * 多了要按取值的组合展开，清单里没有这种情况，遇到就在构造时报错，不悄悄放宽。
 */
function tableSchema(table: Table): TSchema {
    const plain: Record<string, TSchema> = {};
    const dependents: Array<[string, DependentField]> = [];
    for (const [name, field] of Object.entries(table)) {
        if (field.kind === "dependent") dependents.push([name, field]);
        else plain[name] = optionalUnless(field.required, fieldSchema(field));
    }
    if (dependents.length === 0) return Type.Object(plain);
    const controllers = new Set(dependents.map(([, field]) => field.dependsOn));
    if (controllers.size !== 1) throw new Error(`a field table may have only one controlling field, got ${[...controllers].join(", ")}`);
    const [controllerName] = controllers as Set<string>;
    const controller = table[controllerName!];
    if (controller?.kind !== "value" || controller.values === undefined) throw new Error(`controlling field ${controllerName} must be an enumerated value field`);
    const branches = Object.keys(controller.values).map((value) => {
        const properties: Record<string, TSchema> = {...plain, [controllerName!]: Type.Literal(value)};
        for (const [name, field] of dependents) {
            const schema = field.schemaBy[value];
            if (schema === undefined) throw new Error(`field ${name} has no values for ${controllerName}=${value}`);
            properties[name] = optionalUnless(field.required, schema);
        }
        return Type.Object(properties);
    });
    return Type.Union(branches);
}

function anonymousFields(fields: Readonly<Record<string, ValueField>>): Record<string, TSchema> {
    return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, optionalUnless(field.required, field.schema)]));
}

const REPORT_ID = REPORT_ENVELOPE.daily.reportId.schema;

/**
 * 按匿名档 `anonymous` 与使用档 `usage` 组装的每日上报；`usage` 为 `null` 时是不带使用档的一份。
 * 带使用档时 `usageEnabled` 只能是 `true`、`manifest.usage` 必填（协议输出 6 与 13）；不带时不许出现 `usage`。
 */
export function dailyReportSchema(anonymous: AnonymousManifest, usage: UsageManifest | null): TSchema {
    const fields = anonymousFields(anonymous.daily);
    if (usage === null) {
        return Type.Object({manifest: Type.Object({anonymous: Type.Literal(anonymous.version)}), reportId: REPORT_ID, ...fields, usage: Type.Optional(Type.Never())});
    }
    return Type.Object({
        manifest: Type.Object({anonymous: Type.Literal(anonymous.version), usage: Type.Literal(usage.version)}),
        reportId: REPORT_ID,
        ...fields,
        usageEnabled: Type.Literal(true),
        usage: tableSchema(usage.usage.fields),
    });
}

export function heartbeatReportSchema(anonymous: AnonymousManifest): TSchema {
    return Type.Object({manifest: Type.Object({anonymous: Type.Literal(anonymous.version)}), ...anonymousFields(anonymous.heartbeat)});
}

/** 立即事件属于使用档：`manifest.usage` 必填，种类与码按使用档的版本（协议 `POST /v1/event`）。 */
export function eventReportSchema(anonymous: AnonymousManifest, usage: UsageManifest): TSchema {
    const envelope = Type.Object({manifest: Type.Object({anonymous: Type.Literal(anonymous.version), usage: Type.Literal(usage.version)}), reportId: REPORT_ID, ...anonymousFields(anonymous.event)});
    return Type.Intersect([envelope, tableSchema(usage.event)]);
}
