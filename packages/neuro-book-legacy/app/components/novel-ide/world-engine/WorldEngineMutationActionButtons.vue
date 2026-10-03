<script setup lang="ts">
const props = defineProps<{
    canUseSelectedMutation: boolean;
    disabled?: boolean;
    addMutationAction?: (mode: "append" | "replace") => void;
    deleteSelectedMutationAction?: () => void;
    duplicateSelectedMutationAction?: () => void;
    insertAfterSelectedMutationAction?: () => void;
    replaceSelectedMutationAction?: () => void;
}>();

const emit = defineEmits<{
    (e: "add-mutation", mode: "append" | "replace"): void;
    (e: "insert-after-selected-mutation"): void;
    (e: "duplicate-selected-mutation"): void;
    (e: "replace-selected-mutation"): void;
    (e: "delete-selected-mutation"): void;
}>();

/** 执行按钮动作；优先走函数 prop，避免嵌套组件事件在真实 Dialog 中丢失。 */
function runAddMutation(mode: "append" | "replace"): void {
    if (props.addMutationAction) {
        props.addMutationAction(mode);
        return;
    }
    emit("add-mutation", mode);
}

function runReplaceSelectedMutation(): void {
    if (props.replaceSelectedMutationAction) {
        props.replaceSelectedMutationAction();
        return;
    }
    emit("replace-selected-mutation");
}

function runInsertAfterSelectedMutation(): void {
    if (props.insertAfterSelectedMutationAction) {
        props.insertAfterSelectedMutationAction();
        return;
    }
    emit("insert-after-selected-mutation");
}

function runDuplicateSelectedMutation(): void {
    if (props.duplicateSelectedMutationAction) {
        props.duplicateSelectedMutationAction();
        return;
    }
    emit("duplicate-selected-mutation");
}

function runDeleteSelectedMutation(): void {
    if (props.deleteSelectedMutationAction) {
        props.deleteSelectedMutationAction();
        return;
    }
    emit("delete-selected-mutation");
}
</script>

<template>
    <!-- Mutation 列表写入动作 -->
    <div class="mt-2 flex flex-wrap gap-2">
        <button type="button" class="inline-flex h-8 min-w-[86px] flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="props.disabled" @click="runAddMutation('append')">
            <span class="i-lucide-list-plus h-3.5 w-3.5"></span>
            追加
        </button>
        <button type="button" class="inline-flex h-8 min-w-[86px] flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="props.disabled || !canUseSelectedMutation" title="用 Builder 当前内容替换所选 mutation" @click="runReplaceSelectedMutation">
            <span class="i-lucide-square-pen h-3.5 w-3.5"></span>
            替换所选
        </button>
        <button type="button" class="inline-flex h-8 min-w-[86px] flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="props.disabled || !canUseSelectedMutation" title="在所选 mutation 后插入 Builder 当前内容" @click="runInsertAfterSelectedMutation">
            <span class="i-lucide-corner-down-right h-3.5 w-3.5"></span>
            插入其后
        </button>
        <button type="button" class="inline-flex h-8 min-w-[86px] flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="props.disabled || !canUseSelectedMutation" title="复制所选 mutation 到下一位" @click="runDuplicateSelectedMutation">
            <span class="i-lucide-copy-plus h-3.5 w-3.5"></span>
            复制所选
        </button>
        <button type="button" class="inline-flex h-8 min-w-[86px] flex-1 items-center justify-center gap-1 rounded-md border border-[var(--status-danger-border)] px-2 text-[12px] text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] disabled:opacity-50" :disabled="props.disabled || !canUseSelectedMutation" title="删除所选 mutation" @click="runDeleteSelectedMutation">
            <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
            删除所选
        </button>
        <button type="button" class="inline-flex h-8 min-w-[86px] flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-main)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="props.disabled" @click="runAddMutation('replace')">
            <span class="i-lucide-refresh-ccw h-3.5 w-3.5"></span>
            替换全部
        </button>
    </div>
</template>
