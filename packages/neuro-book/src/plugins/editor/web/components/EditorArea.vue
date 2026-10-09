<script setup lang="ts">
/** 编辑器区的根（同名 .md）：按 grid 排列编辑组，承载关闭询问与编辑器区内的键位。 */
import {Button, Dialog} from "@notnotype/nb-ui/components";
import {useGridLayout, useLayoutExtent} from "@notnotype/nb-ui/composables";
import {GridRenderer} from "@notnotype/nb-ui/layout";
import {computed, ref, watch} from "vue";
import type {Component} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import type {EditorArea} from "../area";
import type {EditorKind} from "../groups/groups";
import {editorText, nameOf} from "../messages";
import EditorGroup from "./EditorGroup.vue";

/** 编辑器区内的键位对应的意图：宿主把它换成命令执行（组件不认识命令）。 */
export type EditorIntent = "save" | "close" | "split-right";

const props = defineProps<{area: EditorArea; locale: DisplayLocale; control: (kind: EditorKind) => Component}>();
const emit = defineEmits<{(event: "intent", intent: EditorIntent): void}>();

const root = ref<HTMLElement | null>(null);
const extent = useLayoutExtent(root);
const grid = computed(() => props.area.groups.grid);
const host = useGridLayout({grid, extent, contextKey: () => "editor", onApplied: () => props.area.layoutChanged()});
// 组模型原地改了树（拆分、关闭组）：重算布局。
watch(() => props.area.groups.layoutVersion.value, () => host.invalidate());

/** 编辑器区内的键位：只在编辑器区有焦点时处理，交给宿主执行同一条命令（命令声明里不写全局键位）。 */
const plain = (event: KeyboardEvent): boolean => (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
const KEYS: ReadonlyArray<{readonly test: (event: KeyboardEvent) => boolean; readonly intent: EditorIntent}> = [
    {test: (event) => plain(event) && event.key.toLowerCase() === "s", intent: "save"},
    {test: (event) => plain(event) && event.key.toLowerCase() === "w", intent: "close"},
    {test: (event) => plain(event) && event.key === "\\", intent: "split-right"},
];

const onKeydown = (event: KeyboardEvent): void => {
    const match = KEYS.find((key) => key.test(event));
    if (match === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    emit("intent", match.intent);
};

const onFocusOut = (event: FocusEvent): void => {
    if (root.value !== null && !root.value.contains(event.relatedTarget as Node | null)) props.area.focused.value = false;
};

const dialog = computed(() => props.area.dialog.value);
</script>

<template>
    <div
        ref="root"
        class="h-full min-h-0 w-full min-w-0 overflow-hidden bg-[var(--bg-main)]"
        data-editor-area
        @keydown="onKeydown"
        @focusin="area.focused.value = true"
        @focusout="onFocusOut"
    >
        <p v-if="area.notice.value !== null" class="flex items-center gap-2 border-b border-[color:var(--divider)] px-3 py-1.5 text-xs text-[var(--status-warning)]" role="status" data-editor-notice>
            <span class="min-w-0 flex-1">{{ area.notice.value }}</span>
            <Button size="sm" variant="ghost" @click="area.dismissNotice()">{{ editorText(locale, "dismiss") }}</Button>
        </p>
        <GridRenderer
            v-if="host.node.value !== null"
            :node="host.node.value"
            :layout="host.layout.value"
            :disabled="extent === null"
            context-key="editor"
            :revision="host.revision.value"
            :on-gesture-commit="host.onGestureCommit"
        >
            <template #leaf="{node}">
                <EditorGroup :area="area" :group-id="node.id" :locale="locale" :control="control" />
            </template>
        </GridRenderer>
        <Dialog
            :model-value="dialog !== null"
            :title="editorText(locale, 'closeTitle', {name: dialog === null ? '' : nameOf(dialog.address)})"
            size="sm"
            @request-close="area.answer('cancel')"
        >
            <p class="text-sm" data-editor-close-dialog>{{ editorText(locale, "closeBody") }}</p>
            <template #footer>
                <div class="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" size="sm" data-editor-close-cancel @click="area.answer('cancel')">{{ editorText(locale, "cancel") }}</Button>
                    <Button variant="secondary" size="sm" data-editor-close-discard @click="area.answer('discard')">{{ editorText(locale, "discard") }}</Button>
                    <Button variant="primary" size="sm" data-editor-close-save @click="area.answer('save')">{{ editorText(locale, "save") }}</Button>
                </div>
            </template>
        </Dialog>
    </div>
</template>
