<script setup lang="ts">
/**
 * “添加一组设定”的对话框（同名 .md，docs/specs/canon/author-ui.md 输出 38）：`ComponentChecklist` 加页脚。受控：开关、列哪些、
 * 写入在途与失败都由宿主给；勾着的几组是自己的，每次打开清空。
 */
import {computed, shallowRef, watch} from "vue";

import {Button, Dialog} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";
import ComponentChecklist from "./ComponentChecklist.vue";
import type {ChecklistItem, ChecklistPreset} from "./component-checklist";

const props = withDefaults(defineProps<{
    open: boolean;
    items: readonly ChecklistItem[];
    kind?: string;
    presets?: readonly ChecklistPreset[];
    busy?: boolean;
    /** 写入失败的原因，写在状态行。 */
    error?: string;
}>(), {kind: "", presets: () => [], busy: false, error: ""});

const emit = defineEmits<{
    (event: "update:open", value: boolean): void;
    (event: "add", types: readonly string[]): void;
    (event: "show", type: string): void;
    /** 关上、内容卸载并把焦点还回去以后（nb-ui `Dialog` 的 `closed`）。 */
    (event: "closed"): void;
}>();

const text = useCanonText();
const checked = shallowRef<readonly string[]>([]);
watch(() => props.open, (open) => {
    if (open) checked.value = [];
});
// 开着的时候别处加上了勾着的一组（加的失败多半就是这个）：重读回来它成了已添加的，从勾选里去掉，再点“添加”不再撞同一处。
watch(() => props.items, (items) => {
    const present = new Set(items.filter((item) => item.present).map((item) => item.value));
    if (checked.value.some((type) => present.has(type))) checked.value = checked.value.filter((type) => !present.has(type));
});
const submitLabel = computed(() => (checked.value.length === 0 ? text("entry.addGroup.submitNone") : text("entry.addGroup.submit", {count: checked.value.length})));
/** Mac 上写 ⌘，别处写 Ctrl（两个都认），同确认条的保存键。 */
const SHORTCUT = `${typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform) ? "⌘" : "Ctrl"} ↵`;
const submit = (): void => {
    if (checked.value.length === 0 || props.busy) return;
    emit("add", checked.value);
};
const show = (type: string): void => {
    if (props.busy) return;
    emit("show", type);
    emit("update:open", false);
};
</script>

<template>
    <Dialog
        :open="props.open"
        size="md"
        :title="text('entry.addGroup.title')"
        :busy="props.busy"
        :close-on-request="!props.busy"
        :status="props.error"
        initial-focus="[data-component-checklist] input"
        @update:open="(value: boolean) => emit('update:open', value)"
        @closed="emit('closed')"
    >
        <ComponentChecklist
            v-model="checked"
            :items="props.items"
            :kind="props.kind"
            :presets="props.presets"
            max-height="22rem"
            data-add-component-dialog
            @present="show"
            @submit="submit"
        />
        <template #footer="{cancel}">
            <Button variant="ghost" :disabled="props.busy" @click="cancel()">{{ text("edit.cancel") }}</Button>
            <Button class="add-component-dialog__submit" :disabled="checked.length === 0 || props.busy" :aria-label="submitLabel" :data-shortcut="SHORTCUT" data-add-submit @click="submit">{{ submitLabel }}</Button>
        </template>
    </Dialog>
</template>

<style scoped>
/* 快捷键写在按钮字后面、淡一些；画在伪元素里，读屏名由 aria-label 给（不含快捷键）。 */
.add-component-dialog__submit[data-shortcut]::after {
    content: attr(data-shortcut);
    margin-left: 0.5em;
    font-size: var(--text-xs);
    opacity: 0.7;
}
</style>
