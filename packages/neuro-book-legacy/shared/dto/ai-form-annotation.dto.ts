import {z} from "zod";

/**
 * 递归 JSON 值类型。
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = {
    [key: string]: JsonValue;
};

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
]));

export const FormAnnotationKindSchema = z.enum([
    "chapter_meta",
    "story_thread",
    "story_scene",
]);

export const FormAnnotationRequestDtoSchema = z.object({
    formKind: FormAnnotationKindSchema,
    draft: z.record(z.string(), JsonValueSchema),
    instruction: z.string().trim().min(1, "instruction 不能为空").max(8_000, "instruction 过长"),
    context: z.record(z.string(), JsonValueSchema).optional(),
});

export const FormAnnotationFieldMetaDtoSchema = z.object({
    key: z.string(),
    label: z.string(),
    description: z.string().nullable(),
    aiEditable: z.boolean(),
    inlineAnnotation: z.boolean(),
});

export const FormAnnotationSchemaMetaDtoSchema = z.object({
    formKind: FormAnnotationKindSchema,
    title: z.string(),
    description: z.string().nullable(),
    fields: z.array(FormAnnotationFieldMetaDtoSchema),
});

export const FormAnnotationResponseDtoSchema = z.object({
    status: z.literal("stub"),
    nextDraft: z.record(z.string(), JsonValueSchema),
    schema: FormAnnotationSchemaMetaDtoSchema,
    editableDraft: z.record(z.string(), JsonValueSchema),
    workingDraftYaml: z.string(),
    notes: z.array(z.string()),
});

export type FormAnnotationKindDto = z.infer<typeof FormAnnotationKindSchema>;
export type FormAnnotationRequestDto = z.infer<typeof FormAnnotationRequestDtoSchema>;
export type FormAnnotationFieldMetaDto = z.infer<typeof FormAnnotationFieldMetaDtoSchema>;
export type FormAnnotationSchemaMetaDto = z.infer<typeof FormAnnotationSchemaMetaDtoSchema>;
export type FormAnnotationResponseDto = z.infer<typeof FormAnnotationResponseDtoSchema>;
