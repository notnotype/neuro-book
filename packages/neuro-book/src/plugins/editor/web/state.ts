/**
 * 编辑器的公开状态（docs/specs/workbench/editor.md 的“输入与前置条件”）：只有命令 `when` 要读的布尔键，对应命令目录
 * 第一批的 `editor-focus`、`editor-active`、`editor-writable`、`editor-line-navigation`，另加 `dirty`。
 */

import {computed} from "@vue/reactivity";
import type {ComputedRef, ShallowRef} from "@vue/reactivity";

import {definePublicState} from "nbook/shared/store/public";

import type {EditorArea} from "./area";
import type {TextDocument} from "./documents/store";

const reason = (zh: string, en: string) => ({"zh-CN": zh, "en-US": en});

export const editorState = definePublicState("nbook.editor", {
    focused: {type: "boolean", unready: false, reason: reason("编辑区没有焦点", "The editor does not have focus")},
    active: {type: "boolean", unready: false, reason: reason("没有活动的编辑器", "There is no active editor")},
    writable: {type: "boolean", unready: false, reason: reason("活动的编辑器是只读的", "The active editor is read-only")},
    lineNavigation: {type: "boolean", unready: false, reason: reason("活动的编辑器不支持跳转到行", "The active editor cannot go to a line")},
    dirty: {type: "boolean", unready: false, reason: reason("活动文档没有未保存的修改", "The active document has no unsaved changes")},
    hasUnsavedDocuments: {type: "boolean", unready: false, reason: reason("没有需要保存的文档", "No document needs saving")},
    hasCursorPosition: {type: "boolean", unready: false, reason: reason("活动的编辑器不给出光标位置", "The active editor does not report a cursor position")},
});

/** 文档需要保存：dirty 或有未裁决输入（与关闭时询问的判据相同，输出 4、26）。 */
export function needsSaving(document: TextDocument): boolean {
    return document.dirty.value || document.unresolved.value.length > 0;
}

/** 各公开键此刻的值；编辑器区还没建立时都为假。 */
export function editorStateValues(area: Readonly<ShallowRef<EditorArea | null>>): Record<keyof typeof editorState.declarations, ComputedRef<boolean>> {
    const document = computed(() => area.value?.activeDocument.value ?? null);
    const handle = computed(() => area.value?.activeHandle.value ?? null);
    return {
        focused: computed(() => area.value?.focused.value === true),
        active: computed(() => handle.value !== null && document.value !== null),
        writable: computed(() => handle.value !== null && document.value?.writable.value === true),
        lineNavigation: computed(() => handle.value?.navigation !== undefined),
        dirty: computed(() => document.value?.dirty.value === true),
        hasUnsavedDocuments: computed(() => area.value?.openDocuments.value.some(needsSaving) === true),
        hasCursorPosition: computed(() => handle.value?.position?.value != null),
    };
}
