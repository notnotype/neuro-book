import {Type} from "typebox";
import type {TObject, TProperties, TSchema, TUnion} from "typebox";

/**
 * 将由多个对象操作组成的严格联合，投影为 Provider 可接受的顶层对象 schema。
 *
 * 根节点保留 object 类型以满足 Provider 约束，同时通过 anyOf 暴露每个 op 的精确字段分支。
 * 根 properties 只承担 Provider 的字段发现；anyOf 与执行期 validationSchema 共同保证契约一致。
 */
export function providerObjectSchema(validationSchema: TUnion<TObject[]>): TObject<TProperties> {
    if (validationSchema.anyOf.length === 0) {
        throw new Error("Provider 对象 schema 至少需要一个操作分支。");
    }

    const variants = validationSchema.anyOf;
    const propertyKeys = new Set(variants.flatMap((variant) => Object.keys(variant.properties)));
    const properties: TProperties = {};

    for (const key of propertyKeys) {
        const uniqueSchemas = new Map<string, TSchema>();
        for (const variant of variants) {
            const propertySchema = variant.properties[key];
            if (propertySchema) {
                uniqueSchemas.set(JSON.stringify(propertySchema), propertySchema);
            }
        }

        const schemas = [...uniqueSchemas.values()];
        const firstSchema = schemas[0];
        if (!firstSchema) {
            throw new Error(`Provider 对象 schema 无法解析属性 ${key}。`);
        }
        const mergedSchema = schemas.length === 1 ? firstSchema : Type.Union(schemas);
        const requiredInEveryVariant = variants.every((variant) => {
            const requiredKeys: readonly string[] = variant.required ?? [];
            return requiredKeys.includes(key);
        });
        properties[key] = requiredInEveryVariant ? mergedSchema : Type.Optional(mergedSchema);
    }

    const envelope = Type.Object(properties, {
        additionalProperties: false,
        description: "Provider-visible operation envelope. Select exactly one operation branch; fields from other operations are not allowed.",
    });
    return {
        ...envelope,
        anyOf: variants,
    } as TObject<TProperties>;
}
