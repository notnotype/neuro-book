import fs from "node:fs/promises";
import path from "node:path";
import {createError} from "h3";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {importSingleFileTypeScriptConfig} from "nbook/server/world-engine/single-file-typescript-config-import";
import type {RuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
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
    constructor(private readonly compilerContext: RuntimeArtifactCompilerContext | Promise<RuntimeArtifactCompilerContext>) {}

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
                compilerContext: await this.compilerContext,
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

    // Schema 被编译成独立 runtime artifact 后，Zod 构造函数来自 artifact 内的副本；
    // 不能用宿主副本的 instanceof，改用 Zod v4 公开 def.type 判定。
    if (zodKind(current) === "array") {
        const items = unwrapZod(zodArrayElement(current));
        const isUnique = uniqueArrays.has(attrName);
        const attr: WorldAttrSchema = {
            kind: isUnique ? "collection" : "list",
            itemType: zodItemType(items),
            default: defaultValue,
            desc: description,
        };
        if (isEmbeddingTextZod(items)) {
            attr.embedding = "array";
        }
        return attr;
    }

    if (zodKind(current) === "object") {
        const fields: Record<string, WorldAttrSchema> = {};
        for (const [key, childField] of Object.entries(zodObjectShape(current))) {
            fields[key] = zodFieldToAttr(childField, `${attrName}.${key}`, refs, uniqueArrays, defaults);
        }
        return {kind: "object", fields, default: defaultValue, desc: description};
    }

    if (zodKind(current) === "record") {
        const valueType = unwrapZod(zodRecordValueType(current, attrName));
        const attr: WorldAttrSchema = {
            kind: "object",
            itemType: zodItemType(valueType),
            default: defaultValue,
            desc: description,
        };
        if (isEmbeddingTextZod(valueType)) {
            attr.embedding = "record";
        }
        return attr;
    }

    if (zodKind(current) === "enum") {
        return {kind: "scalar", type: "enum", enum: [...zodEnumOptions(current)], default: defaultValue, desc: description};
    }

    if (zodKind(current) === "number") {
        return {kind: "scalar", type: zodIsInt(current) ? "int" : "float", default: defaultValue, desc: description};
    }

    if (zodKind(current) === "boolean") {
        return {kind: "scalar", type: "boolean", default: defaultValue, desc: description};
    }

    return {kind: "scalar", type: "string", default: defaultValue, desc: description};
}

/** 读取 ZodRecord 的 value 类型；缺失时给出 schema 作者能直接修的错误。 */
function zodRecordValueType(record: z.ZodType, attrName: string): z.ZodType {
    const valueType = zodRuntime(record).valueType ?? zodRuntimeDef(record).valueType;
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
    const kind = zodKind(element);
    if (kind === "number") {
        return zodIsInt(element) ? "int" : "float";
    }
    if (kind === "boolean") {
        return "boolean";
    }
    if (kind === "object" || kind === "array" || kind === "record") {
        return "object";
    }
    return "string";
}

/** 判断 Zod 类型是否为 EmbeddingText（含 text / vector / model 字段）。 */
function isEmbeddingTextZod(zodType: z.ZodType): boolean {
    const unwrapped = unwrapZod(zodType);
    if (zodKind(unwrapped) !== "object") {
        return false;
    }
    const shape = zodObjectShape(unwrapped);
    return "text" in shape && "vector" in shape && "model" in shape;
}

/** 解包 ZodOptional / ZodNullable / ZodDefault，兼容独立 artifact 内的 Zod 副本。 */
function unwrapZod(field: z.ZodType): z.ZodType {
    let current = field;
    while (["optional", "nullable", "default"].includes(zodKind(current) ?? "")) {
        const inner = zodRuntimeDef(current).innerType;
        if (!inner) break;
        current = inner;
    }
    return current;
}

type ZodRuntimeDef = {
    type?: string;
    typeName?: string;
    innerType?: z.ZodType;
    element?: z.ZodType;
    checks?: readonly unknown[];
    shape?: Record<string, z.ZodType>;
    valueType?: z.ZodType;
    entries?: Record<string, string>;
};

type ZodRuntimeShape = {
    def?: ZodRuntimeDef;
    _def?: ZodRuntimeDef;
    type?: string;
    shape?: Record<string, z.ZodType>;
    element?: z.ZodType;
    valueType?: z.ZodType;
    options?: readonly string[];
};

function zodRuntime(value: z.ZodType): ZodRuntimeShape {
    return value as unknown as ZodRuntimeShape;
}

function zodRuntimeDef(value: z.ZodType): ZodRuntimeDef {
    const runtime = zodRuntime(value);
    return runtime.def ?? runtime._def ?? {};
}

function zodKind(value: z.ZodType): string | undefined {
    const runtime = zodRuntime(value);
    const def = zodRuntimeDef(value);
    const raw = def.typeName ?? def.type ?? runtime.type;
    return raw?.startsWith("Zod") ? raw.slice(3).toLowerCase() : raw;
}

function zodArrayElement(value: z.ZodType): z.ZodType {
    const runtime = zodRuntime(value);
    const element = runtime.element ?? zodRuntimeDef(value).element;
    if (!element) throw new Error("z.array 缺少 element 类型");
    return element;
}

function zodObjectShape(value: z.ZodType): Record<string, z.ZodType> {
    const runtime = zodRuntime(value);
    const shape = runtime.shape ?? zodRuntimeDef(value).shape;
    if (!shape) throw new Error("z.object 缺少 shape");
    return shape;
}

function zodEnumOptions(value: z.ZodType): readonly string[] {
    const runtime = zodRuntime(value);
    if (runtime.options) return runtime.options;
    const entries = zodRuntimeDef(value).entries;
    if (!entries) throw new Error("z.enum 缺少 options");
    return Object.values(entries);
}

/** Zod v4 整数判定：`.int()` 在公开 `.def.checks` 上记 format "safeint"。 */
function zodIsInt(field: z.ZodType): boolean {
    const checks = zodRuntimeDef(field).checks ?? [];
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
