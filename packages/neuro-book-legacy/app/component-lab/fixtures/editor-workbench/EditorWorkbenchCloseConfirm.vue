<script setup lang="ts">
import {onMounted, onUnmounted, ref} from "vue";
import type {EditorTabPresentation} from "nbook/app/components/editor-workbench/editor-view.types";

const props = defineProps<{
    tab: EditorTabPresentation;
}>();

const emit = defineEmits<{
    (e: "cancel"): void;
    (e: "discard"): void;
    (e: "save"): void;
}>();

const cancelBtnRef = ref<HTMLButtonElement | null>(null);

function handleKeydown(event: KeyboardEvent): void {
    // 上层浮层（例如 S4 命令面板）消费过的 Escape 不再取消这个确认层
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        emit("cancel");
    }
}

onMounted(() => {
    cancelBtnRef.value?.focus();
    // 冒泡阶段：让真正贴着焦点的浮层先消费按键，这里只接管没被上层处理过的 Escape
    window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
    window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
    <div
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="`confirm-title-${tab.path}`"
        :aria-describedby="`confirm-desc-${tab.path}`"
        class="absolute inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-main)_75%,transparent)] backdrop-blur-xs p-4 select-none"
        @click.self="emit('cancel')"
    >
        <div class="flex w-full max-w-sm flex-col gap-3 rounded-[var(--radius-panel)] border border-[var(--divider)] bg-[var(--panel-surface)] p-4 shadow-xl">
            <div :id="`confirm-title-${tab.path}`" class="flex items-center gap-2 text-sm font-semibold text-[var(--text-main)]">
                <span class="i-lucide-alert-circle text-[var(--status-warning)] h-4 w-4 shrink-0" aria-hidden="true" />
                <span>关闭未保存的文件</span>
            </div>
            <p :id="`confirm-desc-${tab.path}`" class="text-xs text-[var(--text-secondary)] leading-5">
                文件「<span class="font-medium text-[var(--text-main)]">{{ tab.title }}</span>」包含未保存的修改。关闭前要保存吗？
            </p>
            <div class="mt-2 flex items-center justify-end gap-2 text-xs">
                <button
                    ref="cancelBtnRef"
                    type="button"
                    class="rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-1.5 font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-main)]"
                    @click="emit('cancel')"
                >
                    取消
                </button>
                <button
                    type="button"
                    class="rounded-[var(--radius-control)] border border-[var(--status-danger)]/30 bg-[var(--bg-panel)] px-3 py-1.5 font-medium text-[var(--status-danger)] hover:bg-[color-mix(in_srgb,var(--status-danger)_12%,transparent)] cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--status-danger)]"
                    @click="emit('discard')"
                >
                    放弃更改并关闭
                </button>
                <button
                    type="button"
                    class="rounded-[var(--radius-control)] bg-[var(--accent-main)] px-3 py-1.5 font-medium text-white hover:opacity-90 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-main)]"
                    @click="emit('save')"
                >
                    保存并关闭
                </button>
            </div>
        </div>
    </div>
</template>
