import fs from "node:fs/promises";
import path from "node:path";
import {createError} from "h3";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {importSingleFileTypeScriptConfig} from "nbook/server/world-engine/single-file-typescript-config-import";
import {resolveRuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
import {
    collectZodDefaults,
    extractRefs,
    extractUniqueArrays,
    type JsonValue,
    type WorldAttrKind,
    type WorldAttrSchema,
    type WorldSchema,
    type WorldSchemaProjectionAttr,
    type ZodSchemaRefs,
    type ZodSchemaRegistry,
    type ZodSchemaUniqueArrays,
} from "nbook/server/world-engine/types";
import {z} from "zod/v4";

const SCHEMA_TS_PATH = "world-engine/schema/index.ts";

/**
 * 加载 Project Workspace 内的 world-engine schema。
 *
 * Zod-native（Decision #23）：Zod 是运行时唯一真相，schema 只来自
 * `world-engine/schema/index.ts`。不再支持 YAML，不再做有损的旧格式预转换。
 *
 * 运行时表示仍是 WorldSchema / WorldAttrSchema（reduce / 校验 / 投影沿用），
 * 但由 Zod 无损派生：EmbeddingText 容器被标记为一等的 `embedding` 字段。
 */
export class WorldSchemaLoader {
    async load(projectRoot: AbsoluteFsPath): Promise<WorldSchema> {
        const tsSchemaPath = path.join(projectRoot, SCHEMA_TS_PATH);

        try {
            await fs.access(tsSchemaPath);
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                // schema/index.ts 不存在，检查是否存在旧的 schema.yaml
                const yamlSchemaPath = path.join(projectRoot, "world-engine/schema.yaml");
                try {
                    await fs.access(yamlSchemaPath);
                    // 旧 schema.yaml 存在，提示迁移
                    throw createError({
                        statusCode: 400,
                        message: "检测到旧格式 schema.yaml。World Engine 已硬切到 Zod schema (world-engine/schema/index.ts)，不再支持 YAML 格式。请参考文档迁移 schema。",
                    });
                } catch (yamlError) {
                    if (typeof yamlError === "object" && yamlError !== null && "code" in yamlError && yamlError.code === "ENOENT") {
                        // yaml 也不存在，返回空 schema（允许从空开始）
                        return {subjectTypes: {}};
                    }
                    // yaml access 错误，说明 yaml 存在但无法访问，抛出迁移提示
                    throw createError({
                        statusCode: 400,
                        message: "检测到旧格式 schema.yaml。World Engine 已硬切到 Zod schema (world-engine/schema/index.ts)，不再支持 YAML 格式。",
                    });
                }
            }
            throw createError({
                statusCode: 500,
                message: `无法访问 schema: ${error instanceof Error ? error.message : String(error)}`,
            });
        }

        try {
            const schemaModule = await importSingleFileTypeScriptConfig<{default?: unknown; WorldSchema?: unknown}>({
                filePath: tsSchemaPath,
                label: "schema",
                runtimeCacheRoot: path.join(projectRoot, ".nbook", "runtime-artifact-import-cache"),
                compilerContext: await resolveRuntimeArtifactCompilerContext(),
            });
            const exportedSchema = schemaModule.default ?? schemaModule.WorldSchema;
            if (!exportedSchema || typeof exportedSchema !== "object") {
                throw createError({statusCode: 400, message: "schema 必须导出 { subjectTypes: {...} } 或 WorldSchema 注册表对象"});
            }
            const schemaRecord = exportedSchema as {subjectTypes?: unknown};
            const schemaRegistry = schemaRecord.subjectTypes ?? exportedSchema;
            if (!schemaRegistry || typeof schemaRegistry !== "object") {
                throw createError({statusCode: 400, message: "schema 必须导出 { subjectTypes: {...} } 或 WorldSchema 注册表对象"});
            }
            const schema = buildWorldSchema(schemaRegistry as ZodSchemaRegistry);
            validateRefTargets(schema);
            return schema;
        } catch (error) {
            // 已是 h3 error 时原样抛出，避免吞掉 statusCode / message。
            if (typeof error === "object" && error !== null && "statusCode" in error) {
                throw error;
            }
            throw createError({
                statusCode: 400,
                message: `加载 schema 失败：${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }
}

// ============================================================================
// Zod -> 运行时 WorldSchema（无损派生）
// ============================================================================

/** 由 Zod 注册表构建运行时 WorldSchema。 */
export function buildWorldSchema(registry: ZodSchemaRegistry): WorldSchema {
    const subjectTypes: WorldSchema["subjectTypes"] = {};
    for (const [typeName, zodSchema] of Object.entries(registry)) {
        const refs = extractRefs(zodSchema);
        const uniqueArrays = extractUniqueArrays(zodSchema);
        const defaults = collectZodDefaults(zodSchema);
        const attrs: Record<string, WorldAttrSchema> = {};
        // Zod v4 把子类型静态记为 core $ZodType；运行时仍是 classic z.ZodType 实例，
        // 故在边界处下转为 z.ZodType（instanceof 与 .description/.def 等都依赖 classic 视图）。
        for (const [attrName, field] of Object.entries(zodSchema.shape)) {
            attrs[attrName] = zodFieldToAttr(field as z.ZodType, attrName, refs, uniqueArrays, defaults);
        }
        subjectTypes[typeName] = {
            desc: zodSchema.description,
            attrs,
        };
    }
    return {subjectTypes};
}

/** 把单个 Zod 字段转换为运行时 WorldAttrSchema（含 embedding 标记）。走 Zod 公开 API。 */
function zodFieldToAttr(
    field: z.ZodType,
    attrName: string,
    refs: ZodSchemaRefs,
    uniqueArrays: ZodSchemaUniqueArrays,
    defaults: Record<string, JsonValue | undefined>,
): WorldAttrSchema {
    const defaultValue = defaults[attrName];
    const current = unwrapZod(field);
    const description = field.description ?? current.description;

    // 标量 ref（refs 由 .describe("ref:xxx") 提取）。
    // 注意：ref 数组（"item[]"）/ ref record（"item{}"）不在此短路，
    // 交给下面的 array / record 分支，由 itemType 记成 ref(item)。
    const refMeta = refs[attrName];
    if (refMeta && !refMeta.endsWith("[]") && !refMeta.endsWith("{}")) {
        return {kind: "scalar", type: `ref(${refMeta})`, default: defaultValue, desc: description};
    }

    // 数组
    if (current instanceof z.ZodArray) {
        const items = unwrapZod(current.element as z.ZodType);
        const isUnique = uniqueArrays.has(attrName);
        const attr: WorldAttrSchema = {
            kind: isUnique ? "collection" : "list",
            itemType: zodItemType(items),
            default: defaultValue,
            desc: description,
        };
        // EmbeddingText 数组（如 events）：append-only，标记 embedding=array
        if (isEmbeddingTextZod(items)) {
            attr.embedding = "array";
        }
        return attr;
    }

    // 固定键对象
    if (current instanceof z.ZodObject) {
        const fields: Record<string, WorldAttrSchema> = {};
        for (const [key, childField] of Object.entries(current.shape)) {
            fields[key] = zodFieldToAttr(childField as z.ZodType, `${attrName}.${key}`, refs, uniqueArrays, defaults);
        }
        return {kind: "object", fields, default: defaultValue, desc: description};
    }

    // 动态键映射（Record）
    if (current instanceof z.ZodRecord) {
        const valueType = unwrapZod(zodRecordValueType(current, attrName));
        const attr: WorldAttrSchema = {
            kind: "object",
            itemType: zodItemType(valueType),
            default: defaultValue,
            desc: description,
        };
        // EmbeddingText record（如 memory）：可变映射，标记 embedding=record
        if (isEmbeddingTextZod(valueType)) {
            attr.embedding = "record";
        }
        return attr;
    }

    // 枚举
    if (current instanceof z.ZodEnum) {
        return {kind: "scalar", type: "enum", enum: current.options, default: defaultValue, desc: description};
    }

    // 数值
    if (current instanceof z.ZodNumber) {
        return {kind: "scalar", type: zodIsInt(current) ? "int" : "float", default: defaultValue, desc: description};
    }

    // 布尔
    if (current instanceof z.ZodBoolean) {
        return {kind: "scalar", type: "boolean", default: defaultValue, desc: description};
    }

    // 字符串及兜底
    return {kind: "scalar", type: "string", default: defaultValue, desc: description};
}

/** 读取 ZodRecord 的 value 类型；缺失时给出 schema 作者能直接修的错误。 */
function zodRecordValueType(record: z.ZodRecord, attrName: string): z.ZodType {
    const valueType = record.valueType as z.ZodType | undefined;
    if (!valueType) {
        throw new Error(`${attrName} 使用 z.record 时必须显式声明 value 类型，例如 z.record(z.string(), z.string())`);
    }
    return valueType;
}

/** 数组 / record 元素的旧格式 itemType：复合类型统一记为 "object"。 */
function zodItemType(element: z.ZodType): string {
    const description = element.description;
    if (typeof description === "string") {
        const match = description.match(/^ref:(\w+)/);
        if (match?.[1]) {
            return `ref(${match[1]})`;
        }
    }
    if (element instanceof z.ZodNumber) {
        return zodIsInt(element) ? "int" : "float";
    }
    if (element instanceof z.ZodBoolean) {
        return "boolean";
    }
    if (element instanceof z.ZodObject || element instanceof z.ZodArray || element instanceof z.ZodRecord) {
        return "object";
    }
    return "string";
}

/** 判断 Zod 类型是否为 EmbeddingText（含 text / vector / model 字段的对象）。 */
function isEmbeddingTextZod(zodType: z.ZodType): boolean {
    const unwrapped = unwrapZod(zodType);
    if (!(unwrapped instanceof z.ZodObject)) {
        return false;
    }
    const shape = unwrapped.shape;
    return "text" in shape && "vector" in shape && "model" in shape;
}

/** 解包 ZodOptional / ZodNullable / ZodDefault，拿到内层类型（公开 .unwrap()）。 */
function unwrapZod(field: z.ZodType): z.ZodType {
    let current = field;
    while (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
        // .unwrap() 静态返回 core $ZodType，运行时仍是 classic 实例，边界处下转。
        current = current.unwrap() as z.ZodType;
    }
    return current;
}

/** Zod v4 整数判定：`.int()` 在公开 `.def.checks` 上记 format "safeint"。
 *  Zod 未公开"是否整数"的类型，故对 check 做一次最小字段读取（非 any/unknown 绕过）。 */
function zodIsInt(field: z.ZodNumber): boolean {
    const checks = field.def.checks ?? [];
    return checks.some((check) => {
        const c = check as {format?: string; isInt?: boolean};
        return c.isInt === true || c.format === "safeint" || c.format === "int32" || c.format === "uint32";
    });
}

/** 校验 schema 中所有 ref 指向已声明的 subject type。 */
function validateRefTargets(schema: WorldSchema): void {
    for (const [typeName, subjectType] of Object.entries(schema.subjectTypes)) {
        validateAttrRefs(subjectType.attrs, schema.subjectTypes, `types.${typeName}`);
    }
}

function validateAttrRefs(
    attrs: Record<string, WorldAttrSchema>,
    subjectTypes: WorldSchema["subjectTypes"],
    pathLabel: string,
): void {
    for (const [name, attr] of Object.entries(attrs)) {
        const attrPath = `${pathLabel}.${name}`;
        const refType = extractRefType(attr.type) ?? extractRefType(attr.itemType);
        if (refType && !subjectTypes[refType]) {
            throw createError({statusCode: 400, message: `${attrPath}: ref 指向未声明的 subject type: ${refType}`});
        }
        if (attr.fields) {
            validateAttrRefs(attr.fields, subjectTypes, attrPath);
        }
    }
}

function extractRefType(type: string | undefined): string | undefined {
    if (!type) {
        return undefined;
    }
    return /^ref\((.+)\)$/.exec(type)?.[1];
}

// ============================================================================
// 访问器：reduce / 校验 / 投影沿用，作用于运行时 WorldSchema
// ============================================================================

/** 查询某个属性路径在 schema 中的定义；未声明属性返回 null。
 *
 * 支持两种路径格式：
 * - JSON Pointer（`/equipment/head`）
 * - 点号分隔符（`equipment.head`）
 */
export function findAttrSchema(schema: WorldSchema, subjectType: string, attrPath: string): WorldAttrSchema | null {
    const subjectSchema = schema.subjectTypes[subjectType];
    if (!subjectSchema) {
        return null;
    }

    let parts: string[];
    if (attrPath.startsWith("/")) {
        parts = attrPath.slice(1).split("/").filter(Boolean);
    } else {
        parts = attrPath.split(".").filter(Boolean);
    }

    if (parts.length === 0) {
        return null;
    }

    const firstPart = parts[0];
    if (!firstPart) {
        return null;
    }

    let current: WorldAttrSchema | undefined = subjectSchema.attrs[firstPart];
    for (const part of parts.slice(1)) {
        if (!current) {
            return null;
        }
        const kind = normalizeAttrKind(current);
        if (kind !== "object") {
            return null;
        }
        if (current.fields?.[part]) {
            current = current.fields[part];
            continue;
        }
        if (current.itemType) {
            current = current.itemType === "object" ? {kind: "object"} : {kind: "scalar", type: current.itemType};
            continue;
        }
        return null;
    }
    return current ?? null;
}

/** 返回属性的 kind，子字段省略 kind 时按 scalar 处理。 */
export function normalizeAttrKind(attr: WorldAttrSchema | null): WorldAttrKind {
    return attr?.kind ?? "scalar";
}

/** 从 schema 中收集创建 subject 时要写入 init slice 的默认值。 */
export function collectDefaultAttrs(schema: WorldSchema, subjectType: string): Array<{attr: string; value: JsonValue}> {
    const subjectSchema = schema.subjectTypes[subjectType];
    if (!subjectSchema) {
        return [];
    }
    const defaults: Array<{attr: string; value: JsonValue}> = [];
    collectDefaultsFromAttrs(subjectSchema.attrs, "", defaults);
    return defaults;
}

/** 生成 Agent 友好的 schema 属性列表。 */
export function flattenAttrs(attrs: Record<string, WorldAttrSchema>, prefix = ""): WorldSchemaProjectionAttr[] {
    const result: WorldSchemaProjectionAttr[] = [];
    for (const [name, attr] of Object.entries(attrs)) {
        const fullName = prefix ? `${prefix}.${name}` : name;
        const projected = projectAttrSchema(fullName, attr);
        result.push({
            ...projected,
            name: fullName,
        });
        if (attr.kind === "object" && attr.fields) {
            result.push(...flattenAttrs(attr.fields, fullName));
        }
    }
    return result;
}

function projectAttrSchema(name: string, attr: WorldAttrSchema): WorldSchemaProjectionAttr {
    const fields = attr.fields
        ? Object.fromEntries(Object.entries(attr.fields).map(([fieldName, fieldSchema]) => [fieldName, projectAttrSchema(fieldName, fieldSchema)]))
        : undefined;
    const projected: WorldSchemaProjectionAttr = {
        name,
        kind: normalizeAttrKind(attr),
        type: attr.type ?? attr.itemType,
        enum: attr.enum,
        default: attr.default,
        desc: attr.desc,
    };
    if (attr.itemType) {
        projected.itemType = attr.itemType;
    }
    if (fields) {
        projected.fields = fields;
    }
    return projected;
}

function collectDefaultsFromAttrs(attrs: Record<string, WorldAttrSchema>, prefix: string, output: Array<{attr: string; value: JsonValue}>): void {
    for (const [name, attr] of Object.entries(attrs)) {
        const fullName = prefix ? `${prefix}.${name}` : name;
        const defaultValue = attr.default;
        if (defaultValue !== undefined) {
            output.push({attr: fullName, value: defaultValue});
            continue;
        }
        const kind = normalizeAttrKind(attr);
        // list / collection 默认空数组：为相对 op 建立基准，首次追加不被当成「缺基」。
        if (kind === "list" || kind === "collection") {
            output.push({attr: fullName, value: []});
            continue;
        }
        if (kind === "object" && attr.fields) {
            collectDefaultsFromAttrs(attr.fields, fullName, output);
        }
    }
}
