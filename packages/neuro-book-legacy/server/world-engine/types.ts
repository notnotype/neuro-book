import type {Prisma} from "nbook/server/generated/project-prisma/client";
import type { z } from "zod";

/** 世界引擎唯一时间真相源：自世界零点起经过的秒数。 */
export type Instant = bigint;

/** JSON 可持久化值。 */
export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

/** World Engine Patch 操作类型（JSON Patch 风格，精简版）。 */
export type WorldPatchOp = "replace" | "increment" | "remove" | "append";

/**
 * World Engine Patch 操作。
 *
 * 操作语义：
 * - replace: 替换指定路径的值。
 * - increment: 数值累加，仅数值类型。
 * - remove: 删除指定路径。
 * - append: 数组追加，unique 数组自动去重。
 *
 * 路径格式：JSON Pointer（`/equipment/head`），不支持点号分隔符。
 *
 * 跨引用操作禁止：
 * - ✅ `/equipment/armor/chest` → `"subject://mythril-plate"`（替换引用）
 * - ❌ `/equipment/armor/chest/durability` → 50（不能操作引用目标的属性）
 */
export type WorldPatch = {
    subjectId: string;
    op: WorldPatchOp;
    /** JSON Pointer 路径（如 `/equipment/head`）*/
    path: string;
    /** 操作值（remove 时不需要）*/
    value?: unknown;
    /** 可选的人类可读描述 */
    summary?: string;
};

/** timeline subject 过滤模式：any=任一命中，all=全部命中。 */
export type WorldSliceSubjectFilterMode = "any" | "all";

// ============================================================================
// 新类型系统：Zod Schema
// ============================================================================

/** Zod schema 注册表类型 */
export type ZodSchemaRegistry = Record<string, z.ZodObject<any>>;

/** 从 Zod schema 中提取的引用元数据：属性路径 -> 目标类型 */
export type ZodSchemaRefs = Record<string, string>;

/** 从 Zod schema 中提取的 unique 数组路径集合 */
export type ZodSchemaUniqueArrays = Set<string>;

// ============================================================================
// 旧类型系统（保留向后兼容）
// ============================================================================

/** subject 属性语义类型。@deprecated 使用新类型系统 WorldSchemaNode */
export type WorldAttrKind = "scalar" | "list" | "collection" | "object";

/** schema 中单个属性定义。@deprecated 使用新类型系统 WorldSchemaNode */
export type WorldAttrSchema = {
    kind?: WorldAttrKind;
    type?: string;
    itemType?: string;
    enum?: JsonValue[];
    fields?: Record<string, WorldAttrSchema>;
    default?: JsonValue;
    desc?: string;
    /**
     * EmbeddingText 容器标记（一等元数据，由 Zod schema 派生）。
     * - "record"：`z.record(z.string(), EmbeddingText)`（如 memory），存活集按 key 取最新
     * - "array"：`z.array(EmbeddingText)`（如 events），append-only 全保留
     * 非空表示该字段承载可向量搜索的 EmbeddingText；空表示普通字段。
     */
    embedding?: "record" | "array";
};

/** schema 中单个 subject type 定义。@deprecated 使用新类型系统 WorldSubjectTypeSchemaV2 */
export type WorldSubjectTypeSchema = {
    desc?: string;
    attrs: Record<string, WorldAttrSchema>;
};

/** 项目级世界 schema。@deprecated 使用新类型系统 WorldSchemaV2 */
export type WorldSchema = {
    subjectTypes: Record<string, WorldSubjectTypeSchema>;
};

// ============================================================================
// 新类型系统：递归类型定义，支持无限嵌套
// ============================================================================

/** 世界引擎基础数据类型。 */
export type WorldSchemaType =
    | "int"       // 整数
    | "float"     // 浮点数
    | "string"    // 字符串
    | "boolean"   // 布尔值
    | "ref"       // 引用（指向 subject id）
    | "array"     // 数组（有序列表）
    | "object";   // 对象（固定键结构）

/**
 * 世界引擎递归类型节点。
 *
 * 基础类型（int/float/string/boolean/ref）：
 *   - type 指定类型
 *   - values 可选，表示枚举约束
 *
 * array 类型：
 *   - type = "array"
 *   - items 定义数组元素类型（递归）
 *   - unique = true 表示集合语义（无序、不重复，对应旧 collection）
 *
 * object 类型：
 *   - type = "object"
 *   - properties 定义固定键结构（递归）
 *   - dynamic = true 表示动态键映射（key 任意，value 类型统一）
 *
 * 约束说明：
 *   - values: 枚举值约束，适用于基础类型
 *   - unique: 集合语义，仅用于 array（去重、无序）
 *   - dynamic: 动态键，仅用于 object（类似 Record<string, T>）
 */
export type WorldSchemaNode =
    | WorldSchemaNodePrimitive
    | WorldSchemaNodeArray
    | WorldSchemaNodeObject;

/** 基础类型节点：int/float/string/boolean/ref */
export type WorldSchemaNodePrimitive = {
    type: "int" | "float" | "string" | "boolean" | "ref";
    /** ref 类型：引用的 subject type */
    ref?: string;
    /** 枚举约束：限定可选值 */
    values?: JsonValue[];
    /** 默认值 */
    default?: JsonValue;
    /** 描述 */
    desc?: string;
};

/** 数组类型节点 */
export type WorldSchemaNodeArray = {
    type: "array";
    /** 数组元素类型（递归） */
    items: WorldSchemaNode;
    /** 集合语义：true = 无序、不重复（对应旧 collection），false = 有序列表（对应旧 list） */
    unique?: boolean;
    /** 默认值 */
    default?: JsonValue;
    /** 描述 */
    desc?: string;
};

/** 对象类型节点 */
export type WorldSchemaNodeObject = {
    type: "object";
    /** 固定键结构：键名 -> 类型定义（递归） */
    properties?: Record<string, WorldSchemaNode>;
    /** 动态键映射：true = key 任意，value 类型统一（类似 Record<string, T>） */
    dynamic?: boolean;
    /** 动态键的值类型（仅 dynamic=true 时有效） */
    valueType?: string;
    /** 默认值 */
    default?: JsonValue;
    /** 描述 */
    desc?: string;
};

/** 新 subject type 定义 */
export type WorldSubjectTypeSchemaV2 = {
    type: "object";
    properties: Record<string, WorldSchemaNode>;
    desc?: string;
};

/** 新世界 schema */
export type WorldSchemaV2 = {
    types: Record<string, WorldSubjectTypeSchemaV2>;
};

// ============================================================================
// 兼容性转换：新类型 <-> 旧类型
// ============================================================================

/**
 * 将新 schema node 转换为旧 WorldAttrKind。
 *
 * 映射规则：
 * - int/float/string/boolean/ref（无 values） -> "scalar"
 * - int/float/string/boolean/ref（有 values） -> "scalar"（枚举约束在 enum 字段体现）
 * - array（unique=false/undefined） -> "list"
 * - array（unique=true） -> "collection"
 * - object（properties） -> "object"
 * - object（dynamic=true） -> "object"（动态键映射，旧系统通过 fields 为空 + itemType 表达）
 */
export function schemaNodeToAttrKind(node: WorldSchemaNode): WorldAttrKind {
    if (node.type === "array") {
        return node.unique ? "collection" : "list";
    }
    if (node.type === "object") {
        return "object";
    }
    return "scalar";
}

/**
 * 将新 schema node 转换为旧 WorldAttrSchema。
 *
 * 用于向后兼容：新系统写入 schema 时，同步生成旧格式供现有代码读取。
 */
export function schemaNodeToAttrSchema(node: WorldSchemaNode): WorldAttrSchema {
    const kind = schemaNodeToAttrKind(node);
    const base: WorldAttrSchema = {
        kind,
        default: node.default,
        desc: node.desc,
    };

    // 基础类型
    if (node.type !== "array" && node.type !== "object") {
        // ref 类型需要编码目标到 type 字段
        if (node.type === "ref" && "ref" in node && node.ref) {
            base.type = `ref(${node.ref})`;
        } else if ("values" in node && node.values) {
            // 有 values 约束时，旧格式必须使用 type: "enum"
            base.type = "enum";
            base.enum = node.values;
        } else {
            base.type = node.type;
        }
        return base;
    }

    // 数组类型
    if (node.type === "array") {
        const itemNode = node.items;
        // 如果元素是基础类型，直接用 itemType
        if (itemNode.type !== "array" && itemNode.type !== "object") {
            // ref 类型需要编码目标
            if (itemNode.type === "ref" && "ref" in itemNode && itemNode.ref) {
                base.itemType = `ref(${itemNode.ref})`;
            } else {
                base.itemType = itemNode.type;
            }
        } else {
            // 如果元素是复合类型，标记为 object（旧系统可能不支持深度嵌套）
            base.itemType = "object";
        }
        return base;
    }

    // 对象类型
    if (node.type === "object") {
        if (node.dynamic && node.valueType) {
            // 动态键映射：旧系统用 itemType 表达值类型
            base.itemType = node.valueType;
        } else if (node.properties) {
            // 固定键结构：递归转换 properties
            base.fields = {};
            for (const [key, childNode] of Object.entries(node.properties)) {
                base.fields[key] = schemaNodeToAttrSchema(childNode);
            }
        }
        return base;
    }

    return base;
}

/**
 * 将旧 WorldAttrSchema 转换为新 WorldSchemaNode。
 *
 * 用于迁移：读取现有 schema 时，转换为新类型供新代码使用。
 */
export function attrSchemaToSchemaNode(attr: WorldAttrSchema): WorldSchemaNode {
    const kind = attr.kind ?? "scalar";

    // scalar -> 基础类型
    if (kind === "scalar") {
        const type = attr.type ?? "string";
        if (type === "int" || type === "float" || type === "string" || type === "boolean" || type.startsWith("ref")) {
            const node: WorldSchemaNodePrimitive = {
                type: type.startsWith("ref") ? "ref" : (type as "int" | "float" | "string" | "boolean"),
                default: attr.default,
                desc: attr.desc,
            };
            if (type.startsWith("ref(") && type.endsWith(")")) {
                node.ref = type.slice(4, -1);
            }
            if (attr.enum) {
                node.values = attr.enum;
            }
            return node;
        }
    }

    // list -> array
    if (kind === "list") {
        const itemType = attr.itemType ?? "string";
        const items: WorldSchemaNode = itemType === "object"
            ? { type: "object" }
            : { type: itemType as "int" | "float" | "string" | "boolean" | "ref" };

        return {
            type: "array",
            items,
            unique: false,
            default: attr.default,
            desc: attr.desc,
        };
    }

    // collection -> array + unique
    if (kind === "collection") {
        const itemType = attr.itemType ?? "string";
        const items: WorldSchemaNode = itemType === "object"
            ? { type: "object" }
            : { type: itemType as "int" | "float" | "string" | "boolean" | "ref" };

        return {
            type: "array",
            items,
            unique: true,
            default: attr.default,
            desc: attr.desc,
        };
    }

    // object
    if (kind === "object") {
        if (attr.fields) {
            // 固定键结构
            const properties: Record<string, WorldSchemaNode> = {};
            for (const [key, childAttr] of Object.entries(attr.fields)) {
                properties[key] = attrSchemaToSchemaNode(childAttr);
            }
            return {
                type: "object",
                properties,
                default: attr.default,
                desc: attr.desc,
            };
        } else if (attr.itemType) {
            // 动态键映射
            return {
                type: "object",
                dynamic: true,
                valueType: attr.itemType,
                default: attr.default,
                desc: attr.desc,
            };
        }
    }

    // 降级处理：未知结构返回 string scalar
    return { type: "string" };
}

/** 一条待写入 patch。 */
export type PatchInput = {
    /** 只在读取既有切面时出现：对应 WorldPatch 行 id。写入新切面时不要传。 */
    patchId?: string;
    subjectId: string;
    op: WorldPatchOp;
    path: string;
    value?: JsonValue;
    summary?: string;
    /** 仅首写该 subject 时使用：声明 subject 类型，writeSlice 据此自动注册 WorldSubject（C1）。subject 已存在时忽略。 */
    type?: string;
    /** 仅首写该 subject 时使用：subject 显示名（表级元数据）。subject 已存在时忽略。 */
    name?: string;
};

/** 一个切面写入输入。 */
export type SliceInput = {
    instant: Instant;
    title?: string;
    summary?: string;
    kind?: string;
    /** 当前运行时唯一写入格式。 */
    patches: PatchInput[];
};

/** World Engine 诊断问题代号；具体含义以 `reference/world-engine/issues.md` 和运行时 catalog 为准。 */
export type WorldIssueCode =
    | "broken-relative"
    | "dangling-ref"
    | "base-shifted"
    | "masked"
    | "invalid-path"
    | "cross-ref"
    | "embedding-whole-replace";

/** World Engine issue 处理级别：error 必须修，advisory 只需确认本次写入语义。 */
export type WorldIssueSeverity = "error" | "advisory";

/** World Engine issue 的 reference label，用于 UI 展示和文档锚点。 */
export type WorldIssueLabel = "E1" | "E2" | "E3" | "E4" | "E5" | "A1" | "A2";

/** 面向作者/Agent 的结构化解释。 */
export type WorldIssueExplanation = {
    whatHappened: string;
    whyItMatters: string;
    suggestedAction: string;
};

/** 一条数据校验问题。sliceId：E 表示错误显形的切面；A 表示触发本次提醒的下游切面。 */
export type WorldIssue = {
    code: WorldIssueCode;
    label: WorldIssueLabel;
    severity: WorldIssueSeverity;
    sliceId?: string;
    patchId?: string;
    subjectId: string;
    attr: string;
    path?: string;
    op?: WorldPatchOp;
    title: string;
    message: string;
    explanation: WorldIssueExplanation;
};

/** 写入或编辑切面后的结果：切面 id + 本次产生的问题（E + A）；edit 原样保存不重复返回 A。 */
export type SliceWriteResult = {
    sliceId: string;
    issues: WorldIssue[];
};

/** 删除切面后的结果：删后受影响 subject 重算出的持久问题（E）。 */
export type DeleteSliceResult = {
    issues: WorldIssue[];
};

/** 某 subject 在某个时刻 reduce 出来的状态。 */
export type SubjectState = {
    subjectId: string;
    type: string;
    attrs: Record<string, JsonValue>;
};

/** 某时刻的世界状态。issues：reduce 时现算的持久问题（E）。 */
export type WorldState = {
    instant: Instant;
    subjects: SubjectState[];
    issues: WorldIssue[];
};

/** 收窄查询结果。issues：reduce 时现算的持久问题（E）；传 attrs 时只返回相关属性问题。 */
export type QueryStateResult = {
    instant: Instant;
    subjects: SubjectState[];
    issues: WorldIssue[];
};

/** timeline 切面列表项。issues：读时现算、归属到该切面的持久问题（E），不落库。 */
export type SliceListItem = {
    id: string;
    instant: Instant;
    previousInstant?: Instant;
    title: string;
    summary: string;
    kind: string;
    patches?: PatchInput[];
    issues?: WorldIssue[];
};

/** subject 列表项。 */
export type WorldSubjectListItem = {
    id: string;
    type: string;
    name: string;
};

/** 创建 subject 的结果。issues：创建（非空 default 写 init slice）时产生的问题。 */
export type CreateWorldSubjectResult = {
    subjectId: string;
    issues: WorldIssue[];
};

/** 创建 subject 的输入；attrs 只初始化 schema 已声明属性，不复制外部文件正文。 */
export type CreateWorldSubjectInput = {
    id: string;
    type: string;
    name?: string;
    at: Instant;
    attrs?: Record<string, JsonValue>;
};

/** Agent 友好的 schema 属性投影。 */
export type WorldSchemaProjectionAttr = {
    name: string;
    kind: WorldAttrKind;
    type?: string;
    itemType?: string;
    enum?: JsonValue[];
    default?: JsonValue;
    desc?: string;
    fields?: Record<string, WorldSchemaProjectionAttr>;
};

/** Agent 友好的 schema 投影。 */
export type WorldSchemaProjection = {
    subjectTypes: Array<{
        type: string;
        desc?: string;
        attrs: WorldSchemaProjectionAttr[];
    }>;
    calendar: {
        format: string;
        examples: string[];
    };
};

/** 世界引擎可用的 Prisma 执行器。 */
export type WorldPrismaExecutor = Prisma.TransactionClient | {
    worldSubject: Prisma.TransactionClient["worldSubject"];
    worldSlice: Prisma.TransactionClient["worldSlice"];
    worldPatch: Prisma.TransactionClient["worldPatch"];
};

/** 读取 patch 时带上 subject type，避免 reduce 阶段反复查表。 */
export type WorldPatchRow = {
    id: string;
    sliceId: string;
    subjectId: string;
    instant: bigint;
    seq: number;
    path: string;
    op: string;
    value: string | null;
    summary: string | null;
};

/**
 * EmbeddingText 落到 WorldPatch 列的载荷（Phase 3，Decision #8）。
 * 仅写 embedding 字段（memory / events）的 patch 才带；vector 为空表示未向量化。
 */
export type EmbeddingColumns = {
    /** 文本内容（写入 text 列） */
    text: string;
    /** Float32 BLOB；null 表示尚未向量化 */
    vector: Uint8Array | null;
    /** 向量化模型；null 表示尚未向量化 */
    model: string | null;
};

/** 检索 embedding 行的结果（供 searchText / vectorize）。 */
export type WorldEmbeddingRow = {
    id: string;
    subjectId: string;
    subjectType: string;
    sliceId: string;
    instant: bigint;
    seq: number;
    path: string;
    op: string;
    text: string;
    /** Float32 BLOB；null 表示未向量化 */
    vector: Uint8Array | null;
    model: string | null;
};

// ============================================================================
// Zod Schema 元数据提取
// ============================================================================

/**
 * 从 Zod schema 中提取引用关系。
 *
 * 扫描 schema 的所有属性，查找 `.describe("ref:targetType")` 标记。
 * 返回：属性路径 -> 目标类型的映射。
 *
 * @example
 * ```ts
 * const Character = z.object({
 *     location: z.string().describe("ref:location").optional(),
 *     equipment: z.object({
 *         weapon: z.string().describe("ref:item").optional(),
 *     }),
 * });
 *
 * extractRefs(Character);
 * // => { "location": "location", "equipment.weapon": "item" }
 * ```
 */
export function extractRefs(schema: z.ZodObject<any>, prefix = ""): ZodSchemaRefs {
    const refs: ZodSchemaRefs = {};
    const shape = schema.shape;

    for (const [key, field] of Object.entries(shape)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        extractRefsFromField(field as z.ZodTypeAny, fullPath, refs);
    }

    return refs;
}

/**
 * 从单个字段中提取引用关系（递归）。
 */
function extractRefsFromField(field: z.ZodTypeAny, path: string, refs: ZodSchemaRefs): void {
    let currentField = field;

    // 解包 ZodOptional / ZodNullable / ZodDefault
    while (true) {
        const typeName = (currentField as any)._def?.typeName || (currentField as any)._def?.type;
        if (typeName === "ZodOptional" || typeName === "optional" ||
            typeName === "ZodNullable" || typeName === "nullable" ||
            typeName === "ZodDefault" || typeName === "default") {
            currentField = (currentField as any)._def.innerType;
        } else {
            break;
        }
    }

    // 检查 description 中的 ref 标记
    const description = (currentField as any).description;
    if (typeof description === "string") {
        const match = description.match(/^ref:(\w+)/);
        if (match?.[1]) {
            refs[path] = match[1];
            return; // ref 字段不再递归
        }
    }

    // 递归处理复合类型
    const typeName = (currentField as any)._def?.typeName || (currentField as any)._def?.type;

    // ZodObject：递归处理 properties
    if (typeName === "ZodObject" || typeName === "object") {
        const shape = (currentField as z.ZodObject<any>).shape;
        for (const [key, childField] of Object.entries(shape)) {
            extractRefsFromField(childField as z.ZodTypeAny, `${path}.${key}`, refs);
        }
        return;
    }

    // ZodArray：递归处理 items
    if (typeName === "ZodArray" || typeName === "array") {
        const items = (currentField as any)._def.element || (currentField as any)._def.type || (currentField as any).element;
        // 数组元素不展开路径，因为运行时是索引访问
        // 但需要检查元素是否为 ref
        const itemDescription = (items as any).description;
        if (typeof itemDescription === "string") {
            const match = itemDescription.match(/^ref:(\w+)/);
            if (match) {
                // 标记整个数组字段为 ref 数组
                refs[path] = `${match[1]}[]`;
                return;
            }
        }
        return;
    }

    // ZodRecord：检查 value 类型
    if (typeName === "ZodRecord" || typeName === "record") {
        const valueType = (currentField as z.ZodRecord).valueType as z.ZodTypeAny | undefined;
        if (!valueType) return;
        const valueDescription = valueType.description;
        if (typeof valueDescription === "string") {
            const match = valueDescription.match(/^ref:(\w+)/);
            if (match) {
                // 标记整个 record 字段为 ref record
                refs[path] = `${match[1]}{}`;
                return;
            }
        }
        return;
    }
}

/**
 * 从 Zod schema 中提取 unique 数组路径。
 *
 * 扫描 schema 的所有 ZodArray 字段，查找 `.unique()` 标记。
 * 返回：标记为 unique 的数组字段路径集合。
 *
 * @example
 * ```ts
 * const Character = z.object({
 *     skills: z.array(z.string()).unique(),
 *     inventory: z.array(z.string()), // 非 unique
 * });
 *
 * extractUniqueArrays(Character);
 * // => Set(["skills"])
 * ```
 */
export function extractUniqueArrays(schema: z.ZodObject<any>, prefix = ""): ZodSchemaUniqueArrays {
    const uniqueArrays = new Set<string>();
    const shape = schema.shape;

    for (const [key, field] of Object.entries(shape)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        extractUniqueArraysFromField(field as z.ZodTypeAny, fullPath, uniqueArrays);
    }

    return uniqueArrays;
}

/**
 * 从单个字段中提取 unique 数组（递归）。
 */
function extractUniqueArraysFromField(field: z.ZodTypeAny, path: string, uniqueArrays: Set<string>): void {
    let currentField = field;

    // 解包 ZodOptional / ZodNullable / ZodDefault
    while (true) {
        const typeName = (currentField as any)._def?.typeName || (currentField as any)._def?.type;
        if (typeName === "ZodOptional" || typeName === "optional" ||
            typeName === "ZodNullable" || typeName === "nullable" ||
            typeName === "ZodDefault" || typeName === "default") {
            currentField = (currentField as any)._def.innerType;
        } else {
            break;
        }
    }

    const typeName = (currentField as any)._def?.typeName || (currentField as any)._def?.type;

    // ZodArray：检查 unique 标记
    if (typeName === "ZodArray" || typeName === "array") {
        const isUnique = (currentField as any)._def.unique === true;
        if (isUnique) {
            uniqueArrays.add(path);
        }
        return; // 不递归到数组元素
    }

    // ZodObject：递归处理 properties
    if (typeName === "ZodObject" || typeName === "object") {
        const shape = (currentField as z.ZodObject<any>).shape;
        for (const [key, childField] of Object.entries(shape)) {
            extractUniqueArraysFromField(childField as z.ZodTypeAny, `${path}.${key}`, uniqueArrays);
        }
        return;
    }
}

/**
 * 从 Zod schema 中收集所有属性的默认值（包括 undefined）。
 *
 * 用于创建 subject 时写入 init slice。
 * 根据 Decision 12，所有 schema 属性都写入 init slice（包括无 default 的）。
 *
 * @example
 * ```ts
 * const Character = z.object({
 *     hp: z.number().default(100),
 *     location: z.string().optional(), // 无 default
 * });
 *
 * collectZodDefaults(Character);
 * // => { hp: 100, location: undefined }
 * ```
 */
export function collectZodDefaults(schema: z.ZodObject<any>, prefix = ""): Record<string, JsonValue | undefined> {
    const defaults: Record<string, JsonValue | undefined> = {};
    const shape = schema.shape;

    for (const [key, field] of Object.entries(shape)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        const value = extractDefaultValue(field as z.ZodTypeAny);
        defaults[fullPath] = value;
    }

    return defaults;
}

/**
 * 从单个字段中提取默认值（递归）。
 */
function extractDefaultValue(field: z.ZodTypeAny): JsonValue | undefined {
    let currentField = field;
    let hasDefault = false;
    let defaultValue: any = undefined;

    // 解包 ZodOptional / ZodNullable / ZodDefault
    while (true) {
        const typeName = (currentField as any)._def?.typeName || (currentField as any)._def?.type;

        if (typeName === "ZodDefault" || typeName === "default") {
            hasDefault = true;
            const defaultFn = (currentField as any)._def.defaultValue;
            defaultValue = typeof defaultFn === "function" ? defaultFn() : defaultFn;
            currentField = (currentField as any)._def.innerType;
        } else if (typeName === "ZodOptional" || typeName === "optional" ||
                   typeName === "ZodNullable" || typeName === "nullable") {
            currentField = (currentField as any)._def.innerType;
        } else {
            break;
        }
    }

    if (hasDefault) {
        return defaultValue as JsonValue;
    }

    // 无 default 的字段返回 undefined
    return undefined;
}
