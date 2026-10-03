import type {TSchema} from "typebox";

/**
 * 变量 path 解析结果。rootKey 是注册变量根，schema 是目标子路径 schema。
 */
export type ResolvedVariableSchema = {
    rootKey: string;
    schema: TSchema;
};

/**
 * TypeBox 稳定子集 resolver。它只解析项目变量系统承诺支持的 JSON Schema 形态，
 * 解析不了时直接报错，避免把未知结构暴露成宽松 unknown。
 */
export class VariableSchemaResolver {
    /**
     * 解析变量根下的点号子路径。
     */
    resolve(rootKey: string, schema: TSchema, path: string): ResolvedVariableSchema {
        const rest = path === rootKey ? [] : path.startsWith(`${rootKey}.`) ? path.slice(rootKey.length + 1).split(".") : null;
        if (!rest) {
            throw new Error(`变量路径 ${path} 不属于注册根 ${rootKey}。`);
        }
        let current: TSchema = schema;
        for (const segment of rest) {
            current = this.childSchema(current, segment, path);
        }
        return {
            rootKey,
            schema: current,
        };
    }

    private childSchema(schema: TSchema, segment: string, fullPath: string): TSchema {
        const record = schema as Record<string, unknown>;
        if (record.type === "object") {
            const properties = record.properties;
            if (properties && typeof properties === "object" && !Array.isArray(properties) && segment in properties) {
                const child = (properties as Record<string, TSchema | undefined>)[segment];
                if (child) {
                    return child;
                }
            }
            const additional = record.additionalProperties;
            if (additional && typeof additional === "object" && !Array.isArray(additional)) {
                return additional as TSchema;
            }
            const patternProperties = record.patternProperties;
            if (patternProperties && typeof patternProperties === "object" && !Array.isArray(patternProperties)) {
                const entries = Object.values(patternProperties as Record<string, unknown>)
                    .filter((item): item is TSchema => Boolean(item) && typeof item === "object" && !Array.isArray(item));
                if (entries.length === 1) {
                    return entries[0]!;
                }
            }
            throw new Error(`变量路径 ${fullPath} 无法解析字段 ${segment}，请注册更明确的变量 schema。`);
        }
        if (record.type === "array") {
            if (!/^\d+$/.test(segment)) {
                throw new Error(`变量路径 ${fullPath} 的数组下标必须是非负整数。`);
            }
            if (!record.items || typeof record.items !== "object" || Array.isArray(record.items)) {
                throw new Error(`变量路径 ${fullPath} 的数组 items schema 不明确。`);
            }
            return record.items as TSchema;
        }
        if (Array.isArray(record.anyOf) || Array.isArray(record.oneOf)) {
            const variants = (record.anyOf ?? record.oneOf) as unknown[];
            const resolved = variants.flatMap((variant) => {
                if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
                    return [];
                }
                try {
                    return [this.childSchema(variant as TSchema, segment, fullPath)];
                } catch {
                    return [];
                }
            });
            if (resolved.length === 1) {
                return resolved[0]!;
            }
            throw new Error(`变量路径 ${fullPath} 的 union 子路径不唯一，请注册更明确的变量 schema。`);
        }
        if (Array.isArray(record.allOf)) {
            const resolved = record.allOf.flatMap((variant) => {
                if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
                    return [];
                }
                try {
                    return [this.childSchema(variant as TSchema, segment, fullPath)];
                } catch {
                    return [];
                }
            });
            if (resolved.length > 0) {
                return resolved[0]!;
            }
        }
        throw new Error(`变量路径 ${fullPath} 无法从 ${String(record.type ?? "schema")} 继续下钻。`);
    }
}
