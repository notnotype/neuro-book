/**
 * 本包写 schema 用的两个小工具，不从包入口转出：调用方只认识写好的 schema，不需要它们。
 */

import {Type} from "typebox";
import type {TLiteral, TNull, TObject, TProperties, TSchema, TUnion} from "typebox";

/** 可空：Spec 里“没有时为空”的字段都给 `null`，不省略键。 */
export function nullable<Schema extends TSchema>(schema: Schema): TUnion<[Schema, TNull]> {
    return Type.Union([schema, Type.Null()]);
}

/**
 * 拒收多余键的对象。请求用它是合同（多出来的键按 `validation_failed` 报，`fields` 里是那个键）；
 * 响应用它是为了让合同测试拦下多带的字段（例如漏出来的哈希或原始的浏览器标识）。
 */
export function strictObject<Properties extends TProperties>(properties: Properties, options: {readonly minProperties?: number} = {}): TObject<Properties> {
    return Type.Object(properties, {...options, additionalProperties: false});
}

/** 取值是一组字符串之一。由运行时数组生成，免得枚举与它的常量各写一份。 */
export function literalUnion<const Values extends readonly string[]>(values: Values): TUnion<TLiteral<Values[number]>[]> {
    return Type.Union(values.map((value) => Type.Literal(value))) as TUnion<TLiteral<Values[number]>[]>;
}
