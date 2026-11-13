<script setup lang="ts">
/** 编辑器区级的东西（同名 .md）：无布局，工作台挂一次。关闭询问、标签的拖动，以及看焦点有没有离开编辑器区。组的键位、提示条在 `EditorGroup`。 */
import {Button, Dialog} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, onBeforeUnmount, onMounted} from "vue";

import type {EditorTabDrag} from "nbook/plugins/workbench/web/contracts";

import type {EditorArea} from "../area";
import {nameOf} from "../documents/address";
import type {EditorPageSource} from "../pages";
import {createEditorTabDrag} from "../tab-drag";
import {useEditorText} from "../text";
import {EDITOR_GROUP_ROOTS} from "./useEditorGroupRoot";

const props = withDefaults(defineProps<{
    area: EditorArea;
    pages?: EditorPageSource | null;
    /** 多行标签（设置 `nbook.editor/wrapTabs`，输出 54）：变了标签条的分区就变了，拖动要取消。 */
    wrapTabs?: boolean;
    /** 工作台的拖动手势要的标签条问题（`EditorAreaHostProps`）。 */
    attachTabDrag?: ((drag: EditorTabDrag | null) => void) | null;
}>(), {pages: null, wrapTabs: true, attachTabDrag: null});
const t = useEditorText();
const port = useText();

onMounted(() => props.attachTabDrag?.(createEditorTabDrag({area: () => props.area, pages: () => props.pages, wrapTabs: () => props.wrapTabs, text: port})));
onBeforeUnmount(() => props.attachTabDrag?.(null));

// 新焦点落在编辑器区之外才算用户离开：控件重挂时焦点暂时落到页面根，页面根不触发 focusin，不撤销等待中的焦点交接。
// 焦点也可能从页面根直接去资源管理器（关闭标签拿下了原来的焦点），编辑组收不到 focusout，所以在 document 上看。
const onDocumentFocusIn = (event: FocusEvent): void => {
    if (event.target instanceof Element && event.target.closest(EDITOR_GROUP_ROOTS) === null) props.area.focusLeft();
};
onMounted(() => document.addEventListener("focusin", onDocumentFocusIn));
onBeforeUnmount(() => document.removeEventListener("focusin", onDocumentFocusIn));

const dialog = computed(() => props.area.dialog.value);
// 桌面窗口关闭前的询问（输出 66）：与关标签的询问分开，两者不会同时开着（关窗询问开始时先收掉关标签的）。
const windowDialog = computed(() => props.area.windowDialog.value);
const shownPath = (path: string): string => path.replace(/^[a-z]+:\/\//u, "");
</script>

<template>
    <Dialog
        :open="dialog !== null"
        :title="t(dialog?.saveable === false ? 'closeDialog.titleUnrepresentable' : 'closeDialog.title', {name: dialog === null ? '' : nameOf(dialog.address)})"
        size="sm"
        @request-close="area.answer('cancel')"
    >
        <p class="text-sm" data-editor-close-dialog>{{ t(dialog?.saveable === false ? "closeDialog.bodyUnrepresentable" : "closeDialog.body") }}</p>
        <template #footer>
            <div class="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="sm" data-editor-close-cancel @click="area.answer('cancel')">{{ t("closeDialog.cancel") }}</Button>
                <Button variant="secondary" size="sm" data-editor-close-discard @click="area.answer('discard')">{{ t("closeDialog.discard") }}</Button>
                <Button v-if="dialog?.saveable !== false" variant="primary" size="sm" data-editor-close-save @click="area.answer('save')">{{ t("closeDialog.save") }}</Button>
            </div>
        </template>
    </Dialog>
    <Dialog
        :open="windowDialog !== null"
        :title="t(windowDialog?.kind === 'failed' ? 'windowCloseDialog.failedTitle' : 'windowCloseDialog.title')"
        size="sm"
        initial-focus="[data-editor-window-close-cancel]"
        @request-close="area.answerWindow('cancel')"
    >
        <p class="text-sm" data-editor-window-close-dialog>{{ t(windowDialog?.kind === "failed" ? "windowCloseDialog.failedBody" : "windowCloseDialog.body") }}</p>
        <ul class="mt-2 text-sm" data-editor-window-close-files>
            <li v-for="document in windowDialog?.documents ?? []" :key="document.path" class="truncate">
                {{ document.conflict ? t("windowCloseDialog.conflict", {path: shownPath(document.path)}) : document.problem === null ? shownPath(document.path) : t("status.failed", {path: shownPath(document.path), reason: document.problem}) }}
            </li>
            <li v-if="(windowDialog?.more ?? 0) > 0" class="text-[var(--text-muted)]">{{ t("status.more", {count: windowDialog?.more ?? 0}) }}</li>
        </ul>
        <template #footer>
            <div v-if="windowDialog?.kind === 'failed'" class="flex justify-end">
                <Button variant="primary" size="sm" data-editor-window-close-cancel @click="area.answerWindow('cancel')">{{ t("windowCloseDialog.ok") }}</Button>
            </div>
            <div v-else class="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="sm" data-editor-window-close-cancel @click="area.answerWindow('cancel')">{{ t("windowCloseDialog.cancel") }}</Button>
                <Button variant="secondary" size="sm" data-editor-window-close-discard @click="area.answerWindow('discard')">{{ t("windowCloseDialog.discard") }}</Button>
                <Button v-if="windowDialog?.saveable !== false" variant="primary" size="sm" data-editor-window-close-save @click="area.answerWindow('save')">{{ t("windowCloseDialog.saveAll") }}</Button>
            </div>
        </template>
    </Dialog>
</template>
