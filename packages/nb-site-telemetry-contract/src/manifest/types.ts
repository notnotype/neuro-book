/**
 * 收集清单的形状（docs/specs/telemetry/protocol.md 的“收集清单”）。清单是公开合同：服务端按它校验与聚合，
 * 应用的遥测插件按它组装上报、生成收集项说明，官网的“我们收集什么”也由它生成。
 *
 * 一个版本是一份不可变的数据，字段表按上报种类分开写。字段只有四种形状，读的一方按 `kind` 穷尽处理，不用猜：
 * - `value`：取值只看自己，`schema` 就是全部规则；
 * - `dependent`：取值表随同一层的另一个字段而变（例如错误码随 `owner`），规则在 `dependsOn` 与 `valuesBy` 里；
 * - `group`：一个对象，里面是一层字段表；
 * - `list`：对象数组，每一项是一层字段表，另有项数上限与“这几个字段的组合不重复”。
 * 匿名档只有 `value`（类型上就排除了另外三种），所以匿名档里没有跨字段的规则。
 */

import type {TSchema} from "typebox";

/** 说明文字的语言：与协议里 `locale` 的两个具名取值相同。 */
export type ManifestLocale = "zh-CN" | "en-US";

/** 给用户看的一段说明，中英文意思一致。 */
export type Bilingual = Readonly<Record<ManifestLocale, string>>;

/** 字段属于哪一档；上报编号与清单版本不属于哪一档，记为 `null`（协议字段表里的“—”）。 */
export type Tier = "anonymous" | "usage";

/** 枚举字段的取值与每个取值的说明；键就是上报里出现的取值。 */
export type ValueTable = Readonly<Record<string, Bilingual>>;

interface FieldBase {
    readonly tier: Tier | null;
    /** 缺了这个字段时整份上报不合格；`false` 的字段可以省略。 */
    readonly required: boolean;
    readonly description: Bilingual;
}

/** 取值只看自己的字段。 */
export interface ValueField extends FieldBase {
    readonly kind: "value";
    /** 这个字段取值的全部规则。 */
    readonly schema: TSchema;
    /**
     * 字面量取值与说明：`schema` 接受的每个字符串字面量都在这里，这里的每个键都被 `schema` 接受。
     * 取值不是枚举的部分（版本号、整数范围、周的写法）由 `description` 说明，不列在这里。没有字面量取值的字段不给。
     */
    readonly values?: ValueTable;
}

/** 取值表随同一层另一个字段的取值而变的字段（只在使用档里出现）。 */
export interface DependentField extends FieldBase {
    readonly kind: "dependent";
    /** 同一层里决定取值表的字段名；那个字段是带 `values`、只取字面量的 `value` 字段。 */
    readonly dependsOn: string;
    /** 键是 `dependsOn` 字段的每一个取值（一个不漏），值是这时这个字段可用的取值与说明。 */
    readonly valuesBy: Readonly<Record<string, ValueTable>>;
    /** 与 `valuesBy` 一一对应：`dependsOn` 取某个值时，这个字段的 `schema`。 */
    readonly schemaBy: Readonly<Record<string, TSchema>>;
}

/** 一层字段表：键是上报里的字段名。 */
export type FieldTable = Readonly<Record<string, Field>>;

/** 值是对象的字段；对象里的字段按 `fields` 判，`schema` 只管“是一个对象”。 */
export interface GroupField extends FieldBase {
    readonly kind: "group";
    readonly schema: TSchema;
    readonly fields: FieldTable;
}

/** 值是对象数组的字段；`schema` 只管“至多 `maxItems` 项的数组”，每一项按 `item` 判。 */
export interface ListField extends FieldBase {
    readonly kind: "list";
    readonly schema: TSchema;
    readonly maxItems: number;
    /** 每一项要是对象，项里的字段按 `item.fields` 判。 */
    readonly item: {readonly schema: TSchema; readonly fields: Readonly<Record<string, ValueField | DependentField>>};
    /** 这几个字段的取值组合在同一个数组里至多出现一次。JSON Schema 表达不了按部分字段判重，由读的一方检查。 */
    readonly uniqueBy: readonly string[];
}

export type Field = ValueField | DependentField | GroupField | ListField;

/** 匿名档的一个版本：三种上报里各自带的匿名档字段。 */
export interface AnonymousManifest {
    readonly tier: "anonymous";
    readonly version: number;
    /** `POST /v1/daily` 里的匿名档字段。 */
    readonly daily: Readonly<Record<string, ValueField>>;
    /** `POST /v1/heartbeat` 的字段。 */
    readonly heartbeat: Readonly<Record<string, ValueField>>;
    /** `POST /v1/event` 里随事件带的应用信息；事件本身（种类与码）属于使用档。 */
    readonly event: Readonly<Record<string, ValueField>>;
}

/** 次数分档里的一档：`min` 到 `max`（含两端），`max` 为 `null` 表示不设上限。 */
export interface CountBucket {
    readonly name: string;
    readonly min: number;
    readonly max: number | null;
}

/** 使用档的一个版本。 */
export interface UsageManifest {
    readonly tier: "usage";
    readonly version: number;
    /** 次数分档，从小到大、首尾相接，从 0 起；分档字段的取值就是这些档的名字。 */
    readonly countBuckets: readonly CountBucket[];
    /** 每日上报里的 `usage` 段。 */
    readonly usage: GroupField;
    /** `POST /v1/event` 里属于使用档的字段（种类与码）。 */
    readonly event: Readonly<Record<string, ValueField | DependentField>>;
}

/** 不属于哪一档、按上报种类固定的字段：发送方所用的清单版本与上报编号。 */
export interface ReportEnvelope {
    readonly daily: Readonly<{manifest: GroupField; reportId: ValueField}>;
    readonly heartbeat: Readonly<{manifest: GroupField}>;
    readonly event: Readonly<{manifest: GroupField; reportId: ValueField}>;
}
