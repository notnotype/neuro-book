<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import {apiFetch} from "nbook/app/utils/api-fetch";
import type {
    FormAnnotationKindDto,
    FormAnnotationResponseDto,
    JsonObject,
} from "nbook/shared/dto/ai-form-annotation.dto";

const props = defineProps<{
    modelValue: boolean;
    title: string;
    formKind: FormAnnotationKindDto;
    draft: JsonObject;
    context?: JsonObject;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "applied", value: JsonObject): void;
}>();

const instruction = ref("");
const loading = ref(false);
const error = ref("");
const response = ref<FormAnnotationResponseDto | null>(null);

/**
 * 关闭对话框。
 */
function closeDialog(): void {
    emit("update:modelValue", false);
}

/**
 * 调用 AI 表单批注 stub 接口。
 */
async function runAnnotation(): Promise<void> {
    if (!instruction.value.trim() || loading.value) {
        return;
    }

    loading.value = true;
    error.value = "";

    try {
        response.value = await apiFetch<FormAnnotationResponseDto>("/api/ai/form-annotation", {
            method: "POST",
            body: {
                formKind: props.formKind,
                draft: props.draft,
                instruction: instruction.value.trim(),
                context: props.context ?? {},
            },
            notify: false,
        });
    } catch (caughtError) {
        error.value = caughtError instanceof Error ? caughtError.message : "AI 批注请求失败";
    } finally {
        loading.value = false;
    }
}

/**
 * 应用 nextDraft 到当前表单草稿。
 */
function applyDraft(): void {
    if (!response.value) {
        return;
    }

    emit("applied", response.value.nextDraft);
    closeDialog();
}

watch(() => props.modelValue, (visible) => {
    if (!visible) {
        instruction.value = "";
        error.value = "";
        response.value = null;
    }
});
</script>

<template>
    <!-- AI 表单批注对话框 -->
    <Dialog
        :model-value="props.modelValue"
        :title="props.title"
        width="760px"
        show-cancel
        overlay-type="opaque"
        :busy="loading"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <div class="space-y-4">
            <div class="space-y-1">
                <label class="text-xs font-medium text-[var(--text-secondary)]">批注指令</label>
                <textarea
                    v-model="instruction"
                    rows="4"
                    class="w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20"
                    placeholder="输入你希望 AI 如何修改这个表单草稿..."
                ></textarea>
            </div>

            <div v-if="error" class="rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger)]">
                {{ error }}
            </div>

            <div v-if="response" class="grid grid-cols-2 gap-3">
                <section class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/20 p-3">
                    <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Schema 字段</div>
                    <div class="mt-2 space-y-2 text-xs">
                        <div v-for="field in response.schema.fields" :key="field.key" class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2">
                            <div class="font-medium text-[var(--text-main)]">{{ field.label }}</div>
                            <div class="mt-1 text-[var(--text-secondary)]">{{ field.description || "无额外说明" }}</div>
                            <div class="mt-1 flex gap-2 text-[10px] text-[var(--text-muted)]">
                                <span>{{ field.aiEditable ? "AI 可编辑" : "AI 只读" }}</span>
                                <span>{{ field.inlineAnnotation ? "支持 inline 批注" : "不支持 inline 批注" }}</span>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/20 p-3">
                    <div class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">YAML Working Draft</div>
                    <pre class="mt-2 max-h-[320px] overflow-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 text-[11px] leading-5 text-[var(--text-main)]">{{ response.workingDraftYaml }}</pre>
                </section>
            </div>
        </div>

        <template #footer="{ cancel }">
            <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50" :disabled="loading" @click="cancel">取消</button>
            <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50" :disabled="loading || !instruction.trim()" @click="runAnnotation">
                {{ loading ? "处理中..." : "运行 AI 批注" }}
            </button>
            <button class="inline-flex items-center justify-center h-8 px-4 rounded-md text-[13px] font-medium cursor-pointer border border-transparent bg-[var(--accent-main)] text-[var(--text-inverse)] transition-all duration-200 hover:opacity-90 hover:shadow-md active:scale-95 disabled:opacity-50" :disabled="!response" @click="applyDraft">
                应用草稿
            </button>
        </template>
    </Dialog>
</template>
