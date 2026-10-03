<script setup lang="ts">
type BuilderValueMode = "hidden" | "number" | "boolean" | "enum" | "ref" | "object" | "json" | "text";
type ObjectBuilderRow = {
    key: string;
    value: string;
    enabled: boolean;
};

const props = defineProps<{
    builderValue: string;
    objectBuilderRows: ObjectBuilderRow[];
    objectHasFixedFields: boolean;
    objectFieldValueMode: (rowKey: string) => BuilderValueMode;
    objectFieldEnumOptions: (rowKey: string) => Array<{label: string; value: string}>;
    objectFieldRefOptions: (rowKey: string) => Array<{label: string; value: string}>;
}>();

const emit = defineEmits<{
    (e: "update-object-row", index: number, patch: Partial<ObjectBuilderRow>): void;
    (e: "add-object-row"): void;
    (e: "remove-object-row", index: number): void;
}>();

/** 读取原生输入事件里的字符串值。 */
function inputValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
}

/** 读取 checkbox 事件里的布尔值。 */
function checkedValue(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
}
</script>

<template>
    <!-- Object value / fixed fields 输入区 -->
    <div class="col-span-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2">
        <div class="mb-2 flex items-center justify-between gap-2">
            <span class="text-[11px] font-medium text-[var(--text-secondary)]">{{ objectHasFixedFields ? "Object Fields" : "Object Value" }}</span>
            <button v-if="!objectHasFixedFields" type="button" class="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-color)] px-2 text-[11px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="emit('add-object-row')">
                <span class="i-lucide-plus h-3.5 w-3.5"></span>
                字段
            </button>
        </div>
        <div class="space-y-1.5">
            <div v-for="(row, index) in objectBuilderRows" :key="`object-builder-row:${index}`" class="grid gap-1.5" :class="objectHasFixedFields ? 'grid-cols-[24px_minmax(0,0.7fr)_minmax(0,1fr)]' : 'grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_28px]'">
                <input v-if="objectHasFixedFields" :checked="row.enabled" type="checkbox" class="mt-2 h-4 w-4 accent-[var(--accent-main)]" title="启用字段" @change="emit('update-object-row', index, {enabled: checkedValue($event)})">
                <input :value="row.key" class="h-8 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 font-mono text-[12px] outline-none focus:border-[var(--accent-main)] disabled:opacity-80" :disabled="objectHasFixedFields" placeholder="key" @input="emit('update-object-row', index, {key: inputValue($event)})">
                <input v-if="objectFieldValueMode(row.key) === 'number'" :value="row.value" type="number" class="h-8 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)] disabled:opacity-50" :disabled="objectHasFixedFields && !row.enabled" placeholder="value" @input="emit('update-object-row', index, {value: inputValue($event)})">
                <select v-else-if="objectFieldValueMode(row.key) === 'boolean'" :value="row.value" class="h-8 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)] disabled:opacity-50" :disabled="objectHasFixedFields && !row.enabled" @change="emit('update-object-row', index, {value: inputValue($event)})">
                    <option value="true">true</option>
                    <option value="false">false</option>
                </select>
                <select v-else-if="objectFieldValueMode(row.key) === 'enum'" :value="row.value" class="h-8 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)] disabled:opacity-50" :disabled="objectHasFixedFields && !row.enabled" @change="emit('update-object-row', index, {value: inputValue($event)})">
                    <option v-for="option in objectFieldEnumOptions(row.key)" :key="`object-field-enum:${row.key}:${option.value}`" :value="option.value">{{ option.label }}</option>
                </select>
                <select v-else-if="objectFieldValueMode(row.key) === 'ref' && objectFieldRefOptions(row.key).length" :value="row.value" class="h-8 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)] disabled:opacity-50" :disabled="objectHasFixedFields && !row.enabled" @change="emit('update-object-row', index, {value: inputValue($event)})">
                    <option v-for="option in objectFieldRefOptions(row.key)" :key="`object-field-ref:${row.key}:${option.value}`" :value="option.value">{{ option.label }}</option>
                </select>
                <textarea v-else-if="objectFieldValueMode(row.key) === 'json'" :value="row.value" rows="3" class="min-h-[72px] min-w-0 resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1.5 font-mono text-[12px] leading-5 outline-none focus:border-[var(--accent-main)] disabled:opacity-50" :disabled="objectHasFixedFields && !row.enabled" placeholder="{&quot;key&quot;: &quot;value&quot;}" title="嵌套 object 字段需要填写 JSON 对象" @input="emit('update-object-row', index, {value: inputValue($event)})"></textarea>
                <input v-else :value="row.value" class="h-8 min-w-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 text-[12px] outline-none focus:border-[var(--accent-main)] disabled:opacity-50" :disabled="objectHasFixedFields && !row.enabled" placeholder="value / JSON" @input="emit('update-object-row', index, {value: inputValue($event)})">
                <button v-if="!objectHasFixedFields" type="button" class="inline-flex h-8 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" title="删除字段" @click="emit('remove-object-row', index)">
                    <span class="i-lucide-x h-3.5 w-3.5"></span>
                </button>
            </div>
        </div>
        <pre class="mt-2 max-h-24 overflow-auto rounded bg-[var(--bg-panel)] p-2 text-[11px] leading-5 text-[var(--text-secondary)]">{{ builderValue }}</pre>
    </div>
</template>
