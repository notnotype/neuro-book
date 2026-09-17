<script setup lang="ts">
import type {MarkdownInlineCommentItem} from "nbook/app/components/markdown-studio/markdown-editor.types";

const props = defineProps<{
    comments: MarkdownInlineCommentItem[];
    activeIndex: number | null;
}>();

const emit = defineEmits<{
    (e: "select", index: number): void;
    (e: "update", index: number, body: string): void;
    (e: "delete", index: number): void;
    (e: "close"): void;
}>();
const {t} = useI18n();

const editingIndex = ref<number | null>(null);
const editingBody = ref("");

function startEditing(comment: MarkdownInlineCommentItem): void {
    editingIndex.value = comment.index;
    editingBody.value = comment.body;
}

function cancelEditing(): void {
    editingIndex.value = null;
    editingBody.value = "";
}

function saveEditing(): void {
    if (editingIndex.value === null) {
        return;
    }
    emit("update", editingIndex.value, editingBody.value.trim());
    cancelEditing();
}

function snippet(comment: MarkdownInlineCommentItem): string {
    return comment.text.trim() || t("markdownStudio.comments.emptyText");
}
</script>

<template>
    <aside class="comment-flow-panel flex h-full w-[360px] shrink-0 flex-col border-l border-[var(--border-color)] bg-[var(--page-surface)]">
        <header class="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border-color)] px-4">
            <div class="flex min-w-0 items-center gap-2">
                <span class="i-lucide-message-square-text h-4 w-4 text-[var(--accent-main)]"></span>
                <div class="truncate text-sm font-semibold text-[var(--text-main)]">{{ t("markdownStudio.comments.title") }}</div>
                <span class="rounded-full border border-[var(--border-accent)] bg-[var(--accent-bg)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--accent-text)]">{{ props.comments.length }}</span>
            </div>
            <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('markdownStudio.comments.close')" @click="emit('close')">
                <span class="i-lucide-x h-4 w-4"></span>
            </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-4 custom-scrollbar">
            <div v-if="props.comments.length === 0" class="flex h-full min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-color)] text-center text-xs text-[var(--text-muted)]">
                <span class="i-lucide-message-square h-6 w-6"></span>
                <div class="mt-2">{{ t("markdownStudio.comments.empty") }}</div>
            </div>

            <div v-else class="space-y-3">
                <article
                    v-for="comment in props.comments"
                    :key="`${comment.index}:${comment.from}:${comment.to}`"
                    class="group cursor-pointer rounded-lg border bg-[var(--bg-panel)] p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[var(--border-accent)] hover:bg-[var(--bg-hover)] hover:shadow-md"
                    :class="comment.index === props.activeIndex ? 'border-[var(--border-accent)] bg-[var(--accent-bg)] shadow-md ring-2 ring-[var(--border-accent)]' : 'border-[var(--border-color)]'"
                    @click="emit('select', comment.index)"
                >
                    <div class="block w-full text-left">
                        <div class="flex items-start justify-between gap-3">
                            <div class="flex min-w-0 items-start gap-2">
                                <span
                                    class="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[11px] font-semibold leading-none"
                                    :class="comment.index === props.activeIndex ? 'border-[var(--accent-main)] bg-[var(--accent-main)] text-[var(--text-inverse)]' : 'border-[var(--border-accent)] bg-[var(--page-surface)] text-[var(--accent-text)]'"
                                >{{ comment.index }}</span>
                                <div class="min-w-0">
                                    <div class="truncate text-xs font-medium text-[var(--text-main)]">{{ t("markdownStudio.comments.original", {text: snippet(comment)}) }}</div>
                                </div>
                            </div>
                            <div class="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                                <button type="button" class="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('markdownStudio.comments.edit')" @click.stop="startEditing(comment)">
                                    <span class="i-lucide-pencil h-3.5 w-3.5"></span>
                                </button>
                                <button type="button" class="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" :title="t('markdownStudio.comments.delete')" @click.stop="emit('delete', comment.index)">
                                    <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div v-if="editingIndex === comment.index" class="mt-3">
                        <textarea
                            v-model="editingBody"
                            rows="4"
                            class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-xs leading-5 text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]"
                            @click.stop
                            @keydown.ctrl.enter.prevent="saveEditing"
                            @keydown.meta.enter.prevent="saveEditing"
                        ></textarea>
                        <div class="mt-2 flex items-center gap-2">
                            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--accent-main)] px-3 text-xs font-medium text-[var(--text-inverse)] hover:opacity-90" @click.stop="saveEditing">
                                <span class="i-lucide-check h-3.5 w-3.5"></span>
                                <span>{{ t("markdownStudio.comments.save") }}</span>
                            </button>
                            <button type="button" class="inline-flex h-7 items-center gap-1 rounded-md px-3 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click.stop="cancelEditing">
                                <span class="i-lucide-x h-3.5 w-3.5"></span>
                                <span>{{ t("markdownStudio.comments.cancel") }}</span>
                            </button>
                        </div>
                    </div>
                    <div v-else class="mt-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]">
                        {{ comment.body || t("markdownStudio.comments.noBody") }}
                    </div>
                </article>
            </div>
        </div>
    </aside>
</template>
