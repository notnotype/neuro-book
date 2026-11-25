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

/** 一组字符串逐个换成字面量 schema，元组的长度与先后不变。 */
type LiteralTuple<Values extends readonly string[]> = {-readonly [Index in keyof Values]: TLiteral<Values[Index]>};

/**
 * 取值是一组字符串之一。由运行时数组生成，免得枚举与它的常量各写一份。`values` 要是元组（`as const` 的常量）：TypeBox 按元组
 * 逐项推 `Static`，交给它普通数组类型时推出 `never`（w00037 t07 第 3 片实现时发现，`contract.test.ts` 的类型断言兜底）。
 */
export function literalUnion<const Values extends readonly string[]>(values: Values): TUnion<LiteralTuple<Values>> {
    return Type.Union(values.map((value) => Type.Literal(value))) as TUnion<LiteralTuple<Values>>;
}
