import {z} from "zod";

export type LowCodeJsonValue =
    | string
    | number
    | boolean
    | null
    | LowCodeJsonValue[]
    | {[key: string]: LowCodeJsonValue};

export type LowCodeJsonObject = {[key: string]: LowCodeJsonValue};

const LowCodeJsonValueSchema: z.ZodType<LowCodeJsonValue> = z.lazy(() => z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(LowCodeJsonValueSchema),
    z.record(z.string(), LowCodeJsonValueSchema),
]));

export const LowCodeJsonObjectSchema: z.ZodType<LowCodeJsonObject> = z.record(z.string(), LowCodeJsonValueSchema);

export const LowCodeFieldComponentDtoSchema = z.enum([
    "text",
    "textarea",
    "number",
    "switch",
    "select",
    "combobox",
    "radio",
    "checkbox",
    "resource-preset",
]);

export const LowCodeFieldOptionValueDtoSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
]);

export const LowCodeFieldOptionDtoSchema = z.object({
    value: LowCodeFieldOptionValueDtoSchema,
    label: z.string().trim().min(1),
    description: z.string().trim().optional(),
    disabled: z.boolean().optional(),
});

export const LowCodeResourcePresetOptionDtoSchema = z.object({
    key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    description: z.string().trim().optional(),
    origin: z.enum(["global", "project"]).optional(),
    editable: z.boolean().default(false),
    deletable: z.boolean().default(false),
});

export const LowCodeResourcePresetContentDtoSchema = z.object({
    key: z.string().trim().min(1),
    content: z.string(),
    contentType: z.literal("markdown"),
    origin: z.enum(["global", "project"]).optional(),
    updatedAt: z.string().trim().optional(),
});

export const LowCodeResourcePresetDtoSchema = z.object({
    contentType: z.literal("markdown"),
    options: z.array(LowCodeResourcePresetOptionDtoSchema).default([]),
    content: LowCodeResourcePresetContentDtoSchema.nullable().default(null),
    contents: z.array(LowCodeResourcePresetContentDtoSchema).default([]),
    template: z.string().optional(),
    createKeyPrefix: z.string().optional(),
    createKeySuffix: z.string().optional(),
    capabilities: z.object({
        create: z.boolean().default(false),
        update: z.boolean().default(false),
        rename: z.boolean().default(false),
        remove: z.boolean().default(false),
    }),
});

export const LowCodeFieldDtoSchema = z.object({
    path: z.string().trim().min(1),
    component: LowCodeFieldComponentDtoSchema,
    label: z.string().trim().min(1),
    description: z.string().trim().optional(),
    placeholder: z.string().optional(),
    required: z.boolean().default(false),
    defaultValue: LowCodeJsonValueSchema.optional(),
    options: z.array(LowCodeFieldOptionDtoSchema).default([]),
    rows: z.number().int().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    integer: z.boolean().optional(),
    resource: LowCodeResourcePresetDtoSchema.optional(),
});

export const LowCodeFormDtoSchema = z.object({
    defaults: LowCodeJsonObjectSchema.default({}),
    fields: z.array(LowCodeFieldDtoSchema).default([]),
});

export const LowCodeFormIssueDtoSchema = z.object({
    path: z.string().trim().optional(),
    severity: z.enum(["error", "warning"]).default("error"),
    code: z.string().trim().optional(),
    message: z.string().trim().min(1),
});

export type LowCodeFieldComponentDto = z.infer<typeof LowCodeFieldComponentDtoSchema>;
export type LowCodeFieldOptionValueDto = z.infer<typeof LowCodeFieldOptionValueDtoSchema>;
export type LowCodeFieldOptionDto = z.infer<typeof LowCodeFieldOptionDtoSchema>;
export type LowCodeResourcePresetOptionDto = z.infer<typeof LowCodeResourcePresetOptionDtoSchema>;
export type LowCodeResourcePresetContentDto = z.infer<typeof LowCodeResourcePresetContentDtoSchema>;
export type LowCodeResourcePresetDto = z.infer<typeof LowCodeResourcePresetDtoSchema>;
export type LowCodeFieldDto = z.infer<typeof LowCodeFieldDtoSchema>;
export type LowCodeFormDto = z.infer<typeof LowCodeFormDtoSchema>;
export type LowCodeFormIssueDto = z.infer<typeof LowCodeFormIssueDtoSchema>;

export const LowCodeResourceMutationDtoSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("create"),
        fieldPath: z.string().trim().min(1),
        label: z.string().trim().min(1),
        slug: z.string().trim().min(1),
        content: z.string().optional(),
    }),
    z.object({
        type: z.literal("update"),
        fieldPath: z.string().trim().min(1),
        key: z.string().trim().min(1),
        label: z.string().trim().min(1).optional(),
        content: z.string().optional(),
    }),
    z.object({
        type: z.literal("rename"),
        fieldPath: z.string().trim().min(1),
        key: z.string().trim().min(1),
        label: z.string().trim().min(1),
        slug: z.string().trim().min(1),
    }),
    z.object({
        type: z.literal("remove"),
        fieldPath: z.string().trim().min(1),
        key: z.string().trim().min(1),
    }),
]);

export type LowCodeResourceMutationDto = z.infer<typeof LowCodeResourceMutationDtoSchema>;
