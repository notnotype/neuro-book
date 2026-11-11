<script setup lang="ts">
import type {FieldRow} from "../rows";
import {useCanonText} from "../text";

const props = withDefaults(defineProps<{
    rows: readonly FieldRow[];
    /** 展开着来历的那个字段的路径；没有时不写。 */
    open?: string;
}>(), {open: undefined});

const emit = defineEmits<{
    /** 点了一个值：展开或收起它的来历。 */
    (event: "value", path: string): void;
}>();

defineSlots<{
    /** 展开着的那个字段下面的来历。 */
    origin?(props: {path: string}): unknown;
}>();

const text = useCanonText();
</script>

<template>
    <div class="min-w-0 text-[length:var(--text-sm)]" data-field-table>
        <p v-if="props.rows.length === 0" class="py-2 text-[var(--text-muted)]">{{ text("fields.empty") }}</p>
        <div v-for="row in props.rows" :key="row.path" class="border-b border-[var(--divider)] py-2" :data-field="row.path">
            <div class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span class="w-28 shrink-0 text-[var(--text-secondary)]">{{ row.label }}</span>
                <span class="min-w-0 flex-1">
                    <button
                        type="button"
                        class="canon-value max-w-full text-left"
                        :class="[row.unknown || row.incomplete ? 'text-[var(--status-warning)]' : 'text-[var(--text-main)]', props.open === row.path ? 'canon-value-open' : '']"
                        :aria-expanded="props.open === row.path"
                        :aria-label="text('value.label', {label: row.label, value: row.items !== undefined ? row.items.join(text('value.listSeparator')) : row.display})"
                        @click="emit('value', row.path)"
                    >
                        <template v-if="row.items !== undefined">
                            <span v-for="(item, index) in row.items" :key="index" class="block">{{ item }}</span>
                        </template>
                        <template v-else>{{ row.display }}</template>
                    </button>
                    <span v-if="row.incomplete" class="ml-1 text-[length:var(--text-xs)] text-[var(--status-warning)]">{{ text("value.incomplete") }}</span>
                </span>
                <span v-if="row.mark !== null" class="shrink-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ row.mark }}</span>
            </div>
            <ol v-if="(row.notes?.length ?? 0) > 0 || (row.notesEarlier ?? 0) > 0 || row.notReduced" class="m-0 mt-1 list-none pl-32 text-[length:var(--text-xs)] text-[var(--text-secondary)] max-[480px]:pl-0">
                <li v-if="(row.notesEarlier ?? 0) > 0" class="text-[var(--text-muted)]">{{ text("fields.notesMore", {count: row.notesEarlier ?? 0}) }}</li>
                <li v-for="(note, index) in row.notes" :key="index"><span class="mr-2 text-[var(--text-muted)]">{{ note.where }}</span>{{ note.text }}</li>
                <li v-if="row.notReduced" class="text-[var(--text-muted)]">{{ text("fields.notReduced") }}</li>
            </ol>
            <div v-if="props.open === row.path" class="mt-2 rounded-[var(--radius-control)] bg-[var(--bg-subtle)] px-3 py-2">
                <slot name="origin" :path="row.path" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.canon-value {
    border-bottom: 1px dotted var(--accent-main);
    cursor: pointer;
}
.canon-value:hover,
.canon-value-open {
    background: var(--bg-hover);
    border-radius: 3px;
}
.canon-value:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
}
</style>
