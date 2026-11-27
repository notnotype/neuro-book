<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";

import type {FieldRow} from "../../rows";
import {useCanonText} from "../../text";

const props = withDefaults(defineProps<{
    rows: readonly FieldRow[];
    /** 展开着来历的那个字段的路径；没有时不写。 */
    open?: string;
    /** 显示“改”按钮（可改的行）；默认 false。 */
    editing?: boolean;
    /** “改”不可用时的原因（按计划开着、世界只读……）；可用时不写。 */
    editReason?: string;
}>(), {open: undefined, editing: false, editReason: ""});

const emit = defineEmits<{
    /** 点了一个值：展开或收起它的来历。 */
    (event: "value", path: string): void;
    /** 点了“改”。 */
    (event: "edit", path: string): void;
    /** 列表：一个元素的“改”“去掉”，列表末尾的“添加”。 */
    (event: "edit-element", path: string, element: string): void;
    (event: "remove-element", path: string, element: string): void;
    (event: "add-element", path: string): void;
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
                <!-- 值不到 8rem 宽时换到标签下面一行（窄的编辑区里不挤成一列字），长的英文词也断开。 -->
                <span class="min-w-0 flex-1 basis-32">
                    <button
                        type="button"
                        class="canon-value max-w-full break-words text-left"
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
                <!-- 常显、与值按钮并列（输出 16）：悬停才出现的按钮在触屏上找不到。 -->
                <Button
                    v-if="props.editing && row.editable"
                    size="sm"
                    variant="ghost"
                    :data-edit="row.path"
                    :disabled="props.editReason !== ''"
                    :title="props.editReason !== '' ? props.editReason : undefined"
                    :aria-label="text('edit.label', {label: row.label})"
                    @click="emit('edit', row.path)"
                >{{ text("edit.button") }}</Button>
                <span v-if="row.mark !== null" class="shrink-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ row.mark }}</span>
            </div>
            <!-- 小缩进、不跟值那一列对齐：专门分页把字段表嵌在很窄的格子里，按视口算的 8rem 缩进会把“添加一项”挤出格子。 -->
            <ul v-if="props.editing && row.elementIds !== undefined" class="m-0 mt-1 list-none pl-4" :aria-label="text('list.elements', {label: row.label})" data-list-elements>
                <li v-for="(element, index) in row.elementIds" :key="element" class="flex flex-wrap items-center gap-1" :data-element="element">
                    <span class="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{{ row.items?.[index] ?? "" }}</span>
                    <Button size="sm" variant="ghost" :disabled="props.editReason !== ''" :title="props.editReason !== '' ? props.editReason : undefined" :aria-label="text('list.editElement', {item: row.items?.[index] ?? ''})" @click="emit('edit-element', row.path, element)">{{ text("edit.button") }}</Button>
                    <Button size="sm" variant="ghost" :disabled="props.editReason !== ''" :title="props.editReason !== '' ? props.editReason : undefined" :aria-label="text('list.removeElement', {item: row.items?.[index] ?? ''})" @click="emit('remove-element', row.path, element)">{{ text("list.remove") }}</Button>
                </li>
                <li><Button size="sm" variant="ghost" :disabled="props.editReason !== ''" :title="props.editReason !== '' ? props.editReason : undefined" :data-add-element="row.path" @click="emit('add-element', row.path)">{{ text("list.add") }}</Button></li>
            </ul>
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
