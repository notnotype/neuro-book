<script setup lang="ts">
import {Banner, Dialog, Field, Input} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref, watch} from "vue";

import {FOLDER_NAME} from "../../shared/contracts";
import {useStickersPageText} from "../text";

/** 新建表情包与改包名的对话框（同名 .md）。 */
const props = withDefaults(defineProps<{
    open: boolean;
    mode: "create" | "rename";
    current?: string;
    busy?: boolean;
    status?: string;
    usage?: readonly string[] | null;
}>(), {current: "", busy: false, status: "", usage: undefined});

const emit = defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "submit", value: {folder: string; title: string}): void;
    (e: "edit"): void;
}>();

const text = useStickersPageText();
const folder = ref("");
const title = ref("");
const attempted = ref(false);
watch(() => props.open, (open) => {
    if (!open) return;
    folder.value = props.mode === "rename" ? props.current : "";
    title.value = "";
    attempted.value = false;
}, {immediate: true});

const field = ref<HTMLElement | null>(null);
watch(() => props.status, (status) => {
    if (status !== "") void nextTick(() => field.value?.querySelector<HTMLInputElement>("[data-sticker-folder]")?.focus());
});

const trimmed = computed(() => folder.value.trim());
const valid = computed(() => FOLDER_NAME.test(trimmed.value));
const error = computed(() => (attempted.value && !valid.value ? text("error.folder-invalid") : ""));
const confirmLabel = computed(() => (props.mode === "create" ? text("dialog.create.confirm") : text("dialog.rename.confirm", {name: trimmed.value || props.current})));
const usageText = computed(() => {
    if (props.usage === undefined) return text("dialog.rename.usageLoading");
    if (props.usage === null) return text("dialog.rename.usageGeneric");
    return props.usage.length === 0 ? "" : text("dialog.rename.usageList", {names: props.usage.join("、")});
});

function submit(): void {
    if (props.busy) return;
    attempted.value = true;
    if (valid.value) emit("submit", {folder: trimmed.value, title: title.value});
}
</script>

<template>
    <Dialog
        :open="open"
        size="sm"
        :title="mode === 'create' ? text('dialog.create.title') : text('dialog.rename.title')"
        closable
        :confirm-label="confirmLabel"
        :cancel-label="text('dialog.cancel')"
        :show-cancel="true"
        :busy="busy"
        :status="error === '' ? status : error"
        data-sticker-name-dialog
        @update:open="(value: boolean) => emit('update:open', value)"
        @confirm="submit"
    >
        <div ref="field" class="name-dialog">
            <Field v-if="mode === 'create'" :label="text('dialog.create.displayName')">
                <Input v-model="title" size="sm" autofocus data-sticker-title @update:model-value="emit('edit')" @keydown.enter.prevent="submit" />
            </Field>
            <Field :label="mode === 'create' ? text('dialog.create.folder') : text('dialog.rename.newName')" :error="error || status">
                <Input v-model="folder" size="sm" :autofocus="mode === 'rename'" data-sticker-folder @update:model-value="emit('edit')" @keydown.enter.prevent="submit" />
            </Field>
            <p v-if="mode === 'create'" class="name-dialog__hint">{{ text("dialog.create.hint", {syntax: `:${trimmed || "cat"}/…:`}) }}</p>
            <template v-else>
                <Banner tone="warning" :title="text('dialog.rename.warnTitle')" :message="text('dialog.rename.warnMessage', {example: `:${current}/…:`})" />
                <p v-if="usageText !== ''" class="name-dialog__hint" data-sticker-usage>{{ usageText }}</p>
            </template>
        </div>
    </Dialog>
</template>

<style scoped>
.name-dialog {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.name-dialog__hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
}
</style>
