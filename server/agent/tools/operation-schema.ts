import type {TObject, TSchema} from "typebox";

type OperationUnionSchema = TSchema & {anyOf?: TObject[]};

/**
 * 对带 `op` 判别字段的对象联合选择唯一执行分支。
 *
 * Provider 与执行期使用同一组分支；提前选择分支可让校验错误直接指出当前操作的
 * 缺失/额外字段，而不是输出其他操作分支的无关错误。
 */
export function operationSchemaForArguments(schema: TSchema, args: unknown): TSchema {
    if (!isObject(args) || typeof args.op !== "string") return schema;
    const variants = (schema as OperationUnionSchema).anyOf;
    if (!Array.isArray(variants)) return schema;
    const matches = variants.filter((variant) => (variant.properties?.op as TSchema & {const?: unknown} | undefined)?.const === args.op);
    return matches.length === 1 ? matches[0]! : schema;
}

function isObject(value: unknown): value is {op?: unknown} {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
