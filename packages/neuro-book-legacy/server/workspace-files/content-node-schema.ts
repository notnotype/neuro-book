import {toJSONSchema, z} from "zod";

export const WORKSPACE_CONTENT_STATUSES = ["draft", "pending", "active", "archived"] as const;
export const WORKSPACE_CONTENT_TYPES = ["world", "character", "location", "faction", "item", "event", "system", "instruction", "rule", "note", "species", "creature", "organization", "volume", "chapter"] as const;

export type WorkspaceContentStatus = typeof WORKSPACE_CONTENT_STATUSES[number];
export type WorkspaceContentType = typeof WORKSPACE_CONTENT_TYPES[number];

export const WORKSPACE_STATUS_DESCRIPTIONS: Record<WorkspaceContentStatus, string> = {
    draft: "草稿中，尚未确认，不应作为稳定事实强依赖。",
    pending: "待定问题或未决设定，例如死亡原因、归属、动机仍未确认。",
    active: "已确认事实，可作为写作和检索的稳定依据。",
    archived: "历史保留，不再作为当前默认事实。",
};

const FreeObjectSchema = z.record(z.string(), z.unknown())
    .describe("自由扩展对象；系统不校验、不编辑、不依赖。");

export const WorkspaceContentStatusSchema = z.enum(WORKSPACE_CONTENT_STATUSES)
    .describe("内容节点状态：draft 草稿、pending 待定、active 已确认、archived 已归档。");

export const WorkspaceContentTypeSchema = z.enum(WORKSPACE_CONTENT_TYPES)
    .describe("内容节点类型。lorebook 使用 world/character/location/faction/item/event/system/instruction/note 等类型，manuscript 使用 volume/chapter。");

export const WorkspaceContentRefSchema = z.object({
    relation: z.string().describe("引用关系类型，例如 mentions、foreshadows、depends_on。"),
    target: z.string().min(1).describe("Markdown 相对路径。内容节点指向目录并保留结尾 `/`，普通文件指向具体文件名。"),
    note: z.string().nullable().describe("引用说明。"),
}).describe("结构化引用。");

export const WorkspaceRetrievalSchema = z.object({
    enabled: z.boolean().describe("是否允许该内容节点进入 AI 自动检索候选。"),
    trigger: z.string().nullable().describe("自然语言触发条件；为空表示不需要额外触发判断。"),
}).describe("AI 检索候选配置。");

export const WorkspaceContentStateFrontmatterSchema = z.looseObject({
    statusNote: z.string().optional().describe("当前状态摘要；缺省表示未填写。"),
    updatedAt: z.string().nullable().optional().describe("状态更新时间；为空表示未记录。"),
    knowledge: z.array(z.string()).optional().describe("该状态文件记录的信息差；每项为自然语言，可包含 Markdown 内容节点链接。"),
    ext: FreeObjectSchema.optional(),
}).describe("内容节点 state.md 当前状态 frontmatter。");

export const WorkspaceGovernanceSchema = z.object({
    source: z.string().describe("内容来源，例如 manual、imported、generated。"),
    review: z.string().describe("审阅状态，例如 proposed、reviewed。"),
}).describe("来源与审阅信息。");

export const WorkspaceContentFrontmatterSchema = z.looseObject({
    title: z.string().describe("内容节点显示标题。"),
    type: WorkspaceContentTypeSchema,
    subtype: z.string().nullable().describe("内容节点细分类别。"),
    status: WorkspaceContentStatusSchema,
    icon: z.string().nullable().describe("Lucide 图标名。"),
    aliases: z.array(z.string()).describe("别名列表。"),
    tags: z.array(z.string()).describe("中文短标签列表。标签必须有明确分类意义、易理解、可复用；不要为了填字段随意设置标签。"),
    summary: z.string().describe("节点摘要。"),
    refs: z.array(WorkspaceContentRefSchema).describe("结构化引用列表。"),
    retrieval: WorkspaceRetrievalSchema,
    governance: WorkspaceGovernanceSchema,
    ext: FreeObjectSchema,
}).describe("标准内容节点 frontmatter。");

/**
 * 返回指定内容节点类型对应的 Zod schema。
 */
export function schemaForWorkspaceContentType(type: string | null | undefined): z.ZodType<Record<string, unknown>> {
    return WorkspaceContentFrontmatterSchema as z.ZodType<Record<string, unknown>>;
}

/**
 * 生成内容节点 JSON schema。
 */
export function workspaceContentJsonSchema(type: string | null | undefined): Record<string, unknown> {
    const schema = toJSONSchema(schemaForWorkspaceContentType(type), {
        target: "draft-7",
        unrepresentable: "any",
    }) as Record<string, unknown>;
    return applyJsonSchemaDefaults(schema, createWorkspaceContentFrontmatterDefaults({
        title: "未命名",
        type: readDefaultContentType(type),
    }));
}

/**
 * 按类型生成完整 frontmatter 默认值。
 */
export function createWorkspaceContentFrontmatterDefaults(input: {
    title: string;
    type: string;
    status?: string;
}): Record<string, unknown> {
    const frontmatter: Record<string, unknown> = {
        title: input.title,
        type: input.type,
        subtype: input.type === "character" ? "person" : null,
        status: input.status ?? "draft",
        icon: null,
        aliases: [],
        tags: [],
        summary: "",
        refs: [],
        retrieval: {
            enabled: true,
            trigger: null,
        },
        governance: {
            source: "manual",
            review: "proposed",
        },
        ext: {},
    };

    return frontmatter;
}

/**
 * 给已有 frontmatter 补齐缺失的标准字段，只新增 key，不覆盖已有值。
 */
export function applyWorkspaceContentFrontmatterDefaults(input: {
    frontmatter: Record<string, unknown>;
    title: string;
    type: string;
}): {frontmatter: Record<string, unknown>; changed: boolean} {
    const defaults = createWorkspaceContentFrontmatterDefaults({
        title: input.title,
        type: input.type,
        status: typeof input.frontmatter.status === "string" ? input.frontmatter.status : "draft",
    });
    const nextFrontmatter = fillNullableArrayItemKeys(mergeMissingKeys(defaults, input.frontmatter)) as Record<string, unknown>;
    return {
        frontmatter: nextFrontmatter,
        changed: JSON.stringify(nextFrontmatter) !== JSON.stringify(input.frontmatter),
    };
}

/**
 * 递归补齐缺失字段，保留用户已有字段和值。
 */
function mergeMissingKeys(defaultValue: unknown, currentValue: unknown): unknown {
    if (!isPlainObject(defaultValue) || !isPlainObject(currentValue)) {
        return currentValue === undefined ? defaultValue : currentValue;
    }

    const result: Record<string, unknown> = {...currentValue};
    for (const [key, value] of Object.entries(defaultValue)) {
        result[key] = key in result ? mergeMissingKeys(value, result[key]) : value;
    }
    return result;
}

/**
 * 补齐数组元素中的 nullable 字段。当前只约束 refs[].note。
 */
function fillNullableArrayItemKeys(value: unknown): unknown {
    if (!isPlainObject(value)) {
        return value;
    }

    const result: Record<string, unknown> = {...value};
    if (Array.isArray(result.refs)) {
        result.refs = result.refs.map((ref) => {
            if (!isPlainObject(ref) || "note" in ref) {
                return ref;
            }
            return {
                ...ref,
                note: null,
            };
        });
    }
    return result;
}

/**
 * 将 frontmatter 默认值补进 JSON schema 的 default 字段。
 */
function applyJsonSchemaDefaults(schema: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> {
    const nextSchema = structuredClone(schema) as Record<string, unknown>;
    applyObjectPropertyDefaults(nextSchema, defaults);
    return nextSchema;
}

/**
 * 递归给 JSON schema properties 设置默认值。
 */
function applyObjectPropertyDefaults(schema: Record<string, unknown>, defaults: Record<string, unknown>): void {
    const properties = schema.properties;
    if (!isPlainObject(properties)) {
        return;
    }

    for (const [key, defaultValue] of Object.entries(defaults)) {
        const property = properties[key];
        if (!isPlainObject(property)) {
            continue;
        }
        property.default = defaultValue;
        if (isPlainObject(defaultValue)) {
            applyObjectPropertyDefaults(property, defaultValue);
        }
    }
}

/**
 * 读取 JSON schema 默认 type，非法类型回退为 note。
 */
function readDefaultContentType(type: string | null | undefined): WorkspaceContentType {
    const trimmedType = type?.trim();
    return WORKSPACE_CONTENT_TYPES.includes(trimmedType as WorkspaceContentType)
        ? trimmedType as WorkspaceContentType
        : "note";
}

/**
 * 判断未知值是否为普通对象。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
