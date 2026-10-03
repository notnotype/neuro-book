<script setup lang="ts">
const props = defineProps<{
    time: string;
    title: string;
    kind: string;
    summary: string;
    mutations: string;
    validationOk: boolean;
    validationMessage: string;
    canSubmit: boolean;
    saving: boolean;
    editingSliceId: string;
    actionLabel: string;
    showContinueAction: boolean;
    submitAction?: () => void | Promise<void>;
    submitAndContinueAction?: () => void | Promise<void>;
}>();

const emit = defineEmits<{
    (e: "update:time", value: string): void;
    (e: "update:title", value: string): void;
    (e: "update:kind", value: string): void;
    (e: "update:summary", value: string): void;
    (e: "update:mutations", value: string): void;
    (e: "submit"): void;
    (e: "submit-and-continue"): void;
}>();

/** 读取原生输入事件中的字符串值。 */
function inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLTextAreaElement).value;
}

/** 提交表单；真实 Dialog 优先走函数 prop，保留 emit 给旧入口。 */
function submitForm(): void {
    if (props.submitAction) {
        void props.submitAction();
        return;
    }
    emit("submit");
}

function submitAndContinueForm(): void {
    if (props.submitAndContinueAction) {
        void props.submitAndContinueAction();
        return;
    }
    emit("submit-and-continue");
}
</script>

<template>
    <!-- Slice 草稿表单 -->
    <div class="space-y-3">
        <div class="grid grid-cols-[180px_minmax(0,1fr)_120px] gap-2">
            <input :value="time" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-[13px] outline-none focus:border-[var(--accent-main)] disabled:opacity-60" :disabled="saving" placeholder="time" @input="emit('update:time', inputValue($event))">
            <input :value="title" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-[13px] outline-none focus:border-[var(--accent-main)] disabled:opacity-60" :disabled="saving" placeholder="title" @input="emit('update:title', inputValue($event))">
            <input :value="kind" class="h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-[13px] outline-none focus:border-[var(--accent-main)] disabled:opacity-60" :disabled="saving" placeholder="kind" @input="emit('update:kind', inputValue($event))">
        </div>
        <textarea :value="summary" class="min-h-16 w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-[13px] outline-none focus:border-[var(--accent-main)] disabled:opacity-60" :disabled="saving" placeholder="summary" @input="emit('update:summary', inputValue($event))"></textarea>

        <slot></slot>

        <textarea :value="mutations" class="min-h-[360px] w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 font-mono text-[12px] leading-5 text-[var(--text-main)] outline-none focus:border-[var(--accent-main)] disabled:opacity-60" :disabled="saving" spellcheck="false" @input="emit('update:mutations', inputValue($event))"></textarea>
        <div v-if="!validationOk" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[12px] text-[var(--status-danger)]">
            {{ validationMessage }}
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-4 text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="!canSubmit" @click="submitForm">
                <span :class="saving ? 'i-lucide-loader-2 animate-spin' : editingSliceId ? 'i-lucide-save' : 'i-lucide-send'" class="h-4 w-4"></span>
                {{ actionLabel }}
            </button>
            <button v-if="showContinueAction" type="button" class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--accent-main)]/40 px-4 text-[13px] text-[var(--accent-main)] hover:bg-[var(--accent-bg)] disabled:opacity-50" :disabled="!canSubmit" @click="submitAndContinueForm">
                <span :class="saving ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-forward'" class="h-4 w-4"></span>
                写入并继续下一步
            </button>
        </div>
    </div>
</template>
