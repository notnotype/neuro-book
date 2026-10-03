import {z} from "zod";
import type {
    FormAnnotationFieldMetaDto,
    FormAnnotationKindDto,
    FormAnnotationSchemaMetaDto,
    JsonValue,
} from "nbook/shared/dto/ai-form-annotation.dto";
import {
    StoryRefDtoSchema,
    StorySceneStatusSchema,
    StoryThreadStatusSchema,
} from "nbook/shared/dto/plot.dto";

type FormMeta = {
    title: string;
    description: string | null;
};

type FieldMeta = {
    label: string;
    description?: string;
    aiEditable?: boolean;
    inlineAnnotation?: boolean;
};

const ChapterStatusSchema = z.enum(["NOT_STARTED", "DRAFT", "REVISING", "DONE"]);

type FormAnnotationRegistryItem = {
    schema: z.ZodObject<Record<string, z.ZodType<JsonValue | undefined>>>;
    meta: FormAnnotationSchemaMetaDto;
};

const chapterMetaSchema = z.object({
    title: z.string().max(120).optional().meta({
        label: "章节标题",
        description: "章节的显示标题，适合通过表单级 AI 调整措辞。",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
    status: ChapterStatusSchema.optional().meta({
        label: "章节状态",
        description: "短字段，不支持 inline 批注。",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
    summary: z.string().max(5_000).optional().meta({
        label: "章节摘要",
        description: "用于概括章节内容，可使用 inline 引用和 AI 批注。",
        aiEditable: true,
        inlineAnnotation: true,
    } satisfies FieldMeta),
    characters: z.array(z.string()).optional().meta({
        label: "角色列表",
        description: "章节涉及角色名列表。",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
    todos: z.array(z.string()).optional().meta({
        label: "待办列表",
        description: "章节待办项列表。",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
}).meta({
    title: "章节元数据表单",
    description: "用于编辑章节标题、摘要、角色与待办，不包含正文。",
} satisfies FormMeta);

const storyThreadSchema = z.object({
    title: z.string().optional().meta({
        label: "标题",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
    status: StoryThreadStatusSchema.optional().meta({
        label: "状态",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
    isMainThread: z.boolean().optional().meta({
        label: "主线标记",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
    summary: z.string().optional().meta({
        label: "摘要",
        description: "Thread 摘要，支持 inline 引用与 AI 批注。",
        aiEditable: true,
        inlineAnnotation: true,
    } satisfies FieldMeta),
    tags: z.array(z.string()).optional().meta({
        label: "标签",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
    writingTip: z.string().nullable().optional().meta({
        label: "写作提示",
        aiEditable: true,
        inlineAnnotation: true,
    } satisfies FieldMeta),
    refs: z.array(StoryRefDtoSchema).optional().meta({
        label: "结构化引用",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
}).meta({
    title: "Thread 表单",
    description: "用于编辑剧情线程的长线目标、标签与写作提示。",
} satisfies FormMeta);

const storySceneSchema = z.object({
    title: z.string().optional().meta({
        label: "标题",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
    status: StorySceneStatusSchema.optional().meta({
        label: "状态",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
    chapterId: z.string().nullable().optional().meta({
        label: "章节归属",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
    summary: z.string().optional().meta({
        label: "摘要",
        aiEditable: true,
        inlineAnnotation: true,
    } satisfies FieldMeta),
    purpose: z.string().nullable().optional().meta({
        label: "目的",
        aiEditable: true,
        inlineAnnotation: true,
    } satisfies FieldMeta),
    writingTip: z.string().nullable().optional().meta({
        label: "写作提示",
        aiEditable: true,
        inlineAnnotation: true,
    } satisfies FieldMeta),
    refs: z.array(StoryRefDtoSchema).optional().meta({
        label: "结构化引用",
        aiEditable: true,
        inlineAnnotation: false,
    } satisfies FieldMeta),
}).meta({
    title: "Scene 表单",
    description: "用于编辑场景摘要、目的、写作提示和引用。",
} satisfies FormMeta);

function buildSchemaMeta(
    formKind: FormAnnotationKindDto,
    schema: z.ZodObject<Record<string, z.ZodType<JsonValue | undefined>>>,
): FormAnnotationSchemaMetaDto {
    const formMeta = (schema.meta() ?? {}) as Partial<FormMeta>;
    const fields: FormAnnotationFieldMetaDto[] = Object.entries(schema.shape).map(([key, childSchema]) => {
        const fieldMeta = (childSchema.meta() ?? {}) as Partial<FieldMeta>;
        return {
            key,
            label: fieldMeta.label ?? key,
            description: fieldMeta.description ?? null,
            aiEditable: fieldMeta.aiEditable !== false,
            inlineAnnotation: fieldMeta.inlineAnnotation === true,
        };
    });

    return {
        formKind,
        title: formMeta.title ?? formKind,
        description: formMeta.description ?? null,
        fields,
    };
}

function createRegistryItem(
    formKind: FormAnnotationKindDto,
    schema: z.ZodObject<Record<string, z.ZodType<JsonValue | undefined>>>,
): FormAnnotationRegistryItem {
    return {
        schema,
        meta: buildSchemaMeta(formKind, schema),
    };
}

export const FORM_ANNOTATION_REGISTRY: Record<FormAnnotationKindDto, FormAnnotationRegistryItem> = {
    chapter_meta: createRegistryItem("chapter_meta", chapterMetaSchema),
    story_thread: createRegistryItem("story_thread", storyThreadSchema),
    story_scene: createRegistryItem("story_scene", storySceneSchema),
};
