import YAML from "yaml";
import type {
    FormAnnotationKindDto,
    FormAnnotationRequestDto,
    FormAnnotationResponseDto,
    JsonValue,
} from "nbook/shared/dto/ai-form-annotation.dto";
import {FORM_ANNOTATION_REGISTRY} from "nbook/server/ai/form-annotation/form-annotation.registry";

/**
 * AI 表单批注服务。
 * 当前版本只负责产出 schema metadata 与 YAML 工作副本，不执行真实 patch。
 */
export class FormAnnotationService {
    /**
     * 处理一次表单批注请求。
     */
    annotate(input: FormAnnotationRequestDto): FormAnnotationResponseDto {
        const registryItem = this.getRegistryItem(input.formKind);
        const parseResult = registryItem.schema.safeParse(input.draft);
        if (!parseResult.success) {
            throw createError({
                statusCode: 400,
                message: `draft 不符合 ${input.formKind} schema：${parseResult.error.issues[0]?.message ?? "未知错误"}`,
            });
        }

        const nextDraft = this.normalizeDraft(parseResult.data);
        const editableDraft = this.pickEditableDraft(input.formKind, nextDraft);
        return {
            status: "stub",
            nextDraft,
            schema: registryItem.meta,
            editableDraft,
            workingDraftYaml: YAML.stringify({
                formKind: input.formKind,
                instruction: input.instruction,
                context: input.context ?? {},
                editableDraft,
            }),
            notes: [
                "当前为 stub 模式，尚未调用真实 AI patch provider。",
                `可编辑字段 ${String(registryItem.meta.fields.filter((field) => field.aiEditable).length)} 个。`,
            ],
        };
    }

    /**
     * 按 formKind 读取注册表项。
     */
    private getRegistryItem(formKind: FormAnnotationKindDto) {
        const registryItem = FORM_ANNOTATION_REGISTRY[formKind];
        if (!registryItem) {
            throw createError({
                statusCode: 400,
                message: `不支持的 formKind：${formKind}`,
            });
        }

        return registryItem;
    }

    /**
     * 从草稿中提取允许 AI 修改的字段。
     */
    private pickEditableDraft(formKind: FormAnnotationKindDto, draft: Record<string, JsonValue>): Record<string, JsonValue> {
        const registryItem = this.getRegistryItem(formKind);
        const editableEntries = registryItem.meta.fields
            .filter((field) => field.aiEditable)
            .flatMap((field) => {
                const value = draft[field.key];
                return value === undefined ? [] : [[field.key, value] as const];
            });

        return Object.fromEntries(editableEntries);
    }

    /**
     * 去掉 zod parse 后仍可能保留的 undefined 字段，确保结果符合通用 JSON 草稿约束。
     */
    private normalizeDraft(draft: Record<string, JsonValue | undefined>): Record<string, JsonValue> {
        return Object.fromEntries(
            Object.entries(draft).flatMap(([key, value]) => value === undefined ? [] : [[key, value] as const]),
        );
    }
}
