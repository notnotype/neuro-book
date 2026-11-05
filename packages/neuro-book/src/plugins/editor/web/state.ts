/**
 * 编辑器的公开状态（docs/specs/workbench/editor.md 的“输入与前置条件”）：命令 `when` 要读的布尔键，对应命令目录第一批
 * 的 `editor-focus`、`editor-active`、`editor-writable`、`editor-line-navigation`，另加 `dirty`；以及资源管理器揭示活动文件
 * 要读的 `ready` 与 `activeDocument`。
 */

import {computed} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import {definePublicState} from "nbook/shared/store/public";
import type {PublicBindings} from "nbook/shared/store/public";

import {editorText} from "../shared/text";
import type {EditorArea} from "./area";
import type {TextDocument} from "./documents/store";

export const editorState = definePublicState("nbook.editor", {
    focused: {type: "boolean", unready: false, reason: editorText("state.focused.reason")},
    active: {type: "boolean", unready: false, reason: editorText("state.active.reason")},
    writable: {type: "boolean", unready: false, reason: editorText("state.writable.reason")},
    lineNavigation: {type: "boolean", unready: false, reason: editorText("state.lineNavigation.reason")},
    dirty: {type: "boolean", unready: false, reason: editorText("state.dirty.reason")},
    hasUnsavedDocuments: {type: "boolean", unready: false, reason: editorText("state.hasUnsavedDocuments.reason")},
    hasCursorPosition: {type: "boolean", unready: false, reason: editorText("state.hasCursorPosition.reason")},
    // 编辑器区建好了（绑定项目的窗口读完会话记录之后）与活动标签的地址：资源管理器在打开作品时揭示恢复出的活动文件
    // （docs/specs/workbench/files-explorer.md）。地址取标签的，文档还没读到也有。
    ready: {type: "boolean", unready: false, reason: editorText("state.ready.reason")},
    activeDocument: {type: "string", unready: ""},
    // 活动标签有文本文档（字数要它）；与 `active` 分开：图片这类字节标签是活动的编辑器，但没有正文（输出 41）。
    hasDocument: {type: "boolean", unready: false, reason: editorText("state.hasDocument.reason")},
    // 活动标签的编辑器 id（输出 36）；页面或空组为空串。
    activeEditor: {type: "string", unready: ""},
    // 活动标签的文件有预览编辑器、它本身不是预览视图（输出 46）：“打开预览”据此可用。
    hasPreview: {type: "boolean", unready: false, reason: editorText("state.hasPreview.reason")},
    // 活动控件交出了一行状态（输出 42）：状态栏的编辑器状态条目据此显示。
    hasEditorStatus: {type: "boolean", unready: false, reason: editorText("state.hasEditorStatus.reason")},
    // 活动控件分语言（源码编辑器，输出 45）：状态栏的语言条目与“更改语言模式”据此可用。
    hasLanguage: {type: "boolean", unready: false, reason: editorText("state.hasLanguage.reason")},
    // Markdown 的编辑动作（docs/specs/workbench/markdown-editing.md）。粗粒度的可用性供命令的 `when`，勾选状态供菜单项的 `toggled`。
    canFormat: {type: "boolean", unready: false, reason: editorText("state.canFormat.reason")},
    canConvertBlock: {type: "boolean", unready: false, reason: editorText("state.canConvertBlock.reason")},
    hasSelection: {type: "boolean", unready: false, reason: editorText("state.hasSelection.reason")},
    formatBold: {type: "boolean", unready: false},
    formatItalic: {type: "boolean", unready: false},
    formatStrike: {type: "boolean", unready: false},
    formatCode: {type: "boolean", unready: false},
    formatSuperscript: {type: "boolean", unready: false},
    formatSubscript: {type: "boolean", unready: false},
    formatHeading1: {type: "boolean", unready: false},
    formatHeading2: {type: "boolean", unready: false},
    formatHeading3: {type: "boolean", unready: false},
    formatBulletList: {type: "boolean", unready: false},
    formatOrderedList: {type: "boolean", unready: false},
    formatTaskList: {type: "boolean", unready: false},
    formatQuote: {type: "boolean", unready: false},
    formatCallout: {type: "boolean", unready: false},
    formatCodeBlock: {type: "boolean", unready: false},
});

/** 文档需要保存：dirty、有未裁决输入或有视图写不出（与关闭时询问的判据相同，输出 4、26、61）。 */
export function needsSaving(document: TextDocument): boolean {
    return document.dirty.value || document.unresolved.value.length > 0 || document.blocked.value.size > 0;
}

/** 各公开键此刻的值；编辑器区还没建立时都为假。 */
export function editorStateValues(area: Readonly<ShallowRef<EditorArea | null>>): PublicBindings<typeof editorState.declarations> {
    const document = computed(() => area.value?.activeDocument.value ?? null);
    const handle = computed(() => area.value?.activeHandle.value ?? null);
    const fileTab = computed(() => {
        const tab = area.value?.groups.activeTab() ?? null;
        return tab === null || tab.kind === "page" ? null : tab;
    });
    const active = (action: string) => computed(() => handle.value?.editing?.active(action) === true);
    return {
        focused: computed(() => area.value?.focused.value === true),
        // 有活动的文件标签、控件交出了句柄；不要求文本文档，字节标签上关闭、拆分照常可用（输出 41）。
        active: computed(() => handle.value !== null && fileTab.value !== null),
        // 视图能不能输入：预览视图与只读文档都不行（输出 48），撤销、重做随之不可用。
        writable: computed(() => handle.value !== null && area.value?.viewWritable(area.value.groups.activeGroup.value) === true),
        lineNavigation: computed(() => handle.value?.navigation !== undefined),
        dirty: computed(() => document.value?.dirty.value === true),
        hasUnsavedDocuments: computed(() => area.value?.openDocuments.value.some(needsSaving) === true),
        hasCursorPosition: computed(() => handle.value?.position?.value != null),
        ready: computed(() => area.value !== null),
        // 页面标签（欢迎页这类）不是文件，没有可揭示的地址。
        activeDocument: computed(() => fileTab.value?.address ?? ""),
        hasDocument: computed(() => document.value !== null),
        activeEditor: computed(() => fileTab.value?.editor ?? ""),
        hasPreview: computed(() => area.value?.previewEditor() != null),
        hasEditorStatus: computed(() => fileTab.value !== null && handle.value?.status?.value != null),
        hasLanguage: computed(() => fileTab.value !== null && handle.value?.language?.value != null),
        canFormat: computed(() => handle.value?.editing?.enabled("bold") === true),
        canConvertBlock: computed(() => handle.value?.editing?.enabled("paragraph") === true),
        hasSelection: computed(() => handle.value?.editing?.hasSelection.value === true),
        formatBold: active("bold"),
        formatItalic: active("italic"),
        formatStrike: active("strike"),
        formatCode: active("code"),
        formatSuperscript: active("superscript"),
        formatSubscript: active("subscript"),
        formatHeading1: active("heading-1"),
        formatHeading2: active("heading-2"),
        formatHeading3: active("heading-3"),
        formatBulletList: active("bullet-list"),
        formatOrderedList: active("ordered-list"),
        formatTaskList: active("task-list"),
        formatQuote: active("quote"),
        formatCallout: active("callout"),
        formatCodeBlock: active("code-block"),
    };
}
