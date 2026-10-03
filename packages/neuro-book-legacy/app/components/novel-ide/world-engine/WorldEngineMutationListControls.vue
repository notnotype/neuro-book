<script setup lang="ts">
const props = defineProps<{
    disabled?: boolean;
    selectedSubjectTypeLabel: string;
    mutationLoadOptions: Array<{label: string; value: string}>;
    mutationLoadIndex: string;
}>();

const emit = defineEmits<{
    (e: "update-mutation-load-index", value: string): void;
    (e: "load-mutation", index: number): void;
    (e: "move-selected-mutation", direction: "up" | "down"): void;
}>();

/** 读取原生 select 事件里的字符串值。 */
function inputValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
}
</script>

<template>
    <!-- Mutation 列表选择与顺序控制 -->
    <div class="flex min-w-0 items-center gap-2">
        <div class="truncate text-[11px] text-[var(--text-muted)]">{{ selectedSubjectTypeLabel }}</div>
        <select :value="mutationLoadIndex" class="h-7 max-w-[150px] rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent-main)] disabled:opacity-50" :disabled="props.disabled || !mutationLoadOptions.length" title="选择要从 mutations JSON 载入的 mutation" @change="emit('update-mutation-load-index', inputValue($event))">
            <option v-for="option in mutationLoadOptions" :key="`builder-load:${option.value}`" :value="option.value">{{ option.label }}</option>
        </select>
        <button type="button" class="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="props.disabled || !mutationLoadOptions.length" title="从 mutations JSON 载入所选 mutation" @click="emit('load-mutation', Number(mutationLoadIndex))">
            <span class="i-lucide-arrow-up-from-line h-3.5 w-3.5"></span>
            载入
        </button>
        <button type="button" class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="props.disabled || !mutationLoadOptions.length" title="上移所选 mutation" @click="emit('move-selected-mutation', 'up')">
            <span class="i-lucide-arrow-up h-3.5 w-3.5"></span>
        </button>
        <button type="button" class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="props.disabled || !mutationLoadOptions.length" title="下移所选 mutation" @click="emit('move-selected-mutation', 'down')">
            <span class="i-lucide-arrow-down h-3.5 w-3.5"></span>
        </button>
    </div>
</template>
