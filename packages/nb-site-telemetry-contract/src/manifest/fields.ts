/**
 * 写清单字面量用的构造函数：枚举字段的 schema 由取值表生成，免得取值与说明写成两份、对不上。
 * 只在本目录里用，不从包入口导出。
 */

import {Type} from "typebox";
import type {TSchema} from "typebox";

import type {Bilingual, DependentField, FieldTable, GroupField, ListField, Tier, ValueField, ValueTable} from "./types";

interface FieldInput {
    readonly tier: Tier | null;
    readonly required: boolean;
    readonly description: Bilingual;
}

/** 只取表里列出的字面量。 */
function literalsOf(values: ValueTable): TSchema {
    return Type.Union(Object.keys(values).map((value) => Type.Literal(value)));
}

/** 取值不全是字面量的字段；`values` 是 `schema` 里字面量那部分的说明。 */
export function valueField(input: FieldInput & {readonly schema: TSchema; readonly values?: ValueTable}): ValueField {
    return {kind: "value", ...input};
}

/** 只取表里列出的字面量的字段。 */
export function enumField(input: FieldInput & {readonly values: ValueTable}): ValueField {
    return {kind: "value", ...input, schema: literalsOf(input.values)};
}

export function dependentField(input: FieldInput & {readonly dependsOn: string; readonly valuesBy: Readonly<Record<string, ValueTable>>}): DependentField {
    const schemaBy = Object.fromEntries(Object.entries(input.valuesBy).map(([key, values]) => [key, literalsOf(values)]));
    return {kind: "dependent", ...input, schemaBy};
}

export function groupField(input: FieldInput & {readonly fields: FieldTable}): GroupField {
    return {kind: "group", ...input, schema: Type.Object({})};
}

export function listField(input: FieldInput & {readonly maxItems: number; readonly fields: Readonly<Record<string, ValueField | DependentField>>; readonly uniqueBy: readonly string[]}): ListField {
    const {fields, ...rest} = input;
    return {kind: "list", ...rest, schema: Type.Array(Type.Unknown(), {maxItems: input.maxItems}), item: {schema: Type.Object({}), fields}};
}

/**
 * 发布出去的版本不许被任何读的一方改掉（Spec 边界一节：旧版本发布后不改）。TypeBox 的编译与 `Value.Check` 不写 schema，
 * 冻住之后照常可用。
 */
export function deepFreeze<T>(value: T): T {
    if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}
