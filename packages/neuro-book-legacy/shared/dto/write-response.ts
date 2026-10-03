import {z} from "zod";

export const ContentDiagnosticsDtoSchema = z.object({
    warnings: z.array(z.string()),
    notes: z.array(z.string()),
});

export type ContentDiagnosticsDto = z.infer<typeof ContentDiagnosticsDtoSchema>;

/**
 * 给写接口 DTO 追加可选 diagnostics。
 */
export function withWriteDiagnosticsSchema<TShape extends z.ZodRawShape>(schema: z.ZodObject<TShape>) {
    return schema.extend({
        diagnostics: ContentDiagnosticsDtoSchema.optional(),
    });
}
