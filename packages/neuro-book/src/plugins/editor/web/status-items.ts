/**
 * 编辑器贡献给状态栏的三个条目（docs/specs/workbench/editor.md 输出 26–28）：未保存数、活动文档的字数、光标位置。
 * 显示与否由声明的 `when`（本插件的公开键）决定；文字由本插件从自己的编辑器区算出，外壳只渲染。
 */

import type {ComputedRef, ShallowRef} from "@vue/reactivity";

import type {ItemDeclaration} from "nbook/plugins/workbench/shared/contracts";
import type {ItemImplementation} from "nbook/plugins/workbench/web/contracts";
import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";
import {countWords} from "nbook/shared/word-count";

import type {EditorArea} from "./area";
import {SAVE_ALL_COMMAND} from "./commands";
import {editorState, needsSaving} from "./state";

export const UNSAVED_ITEM = "nbook.editor.unsaved";
export const WORD_COUNT_ITEM = "nbook.editor.word-count";
export const CURSOR_ITEM = "nbook.editor.cursor";

export const EDITOR_STATUS_ITEMS: Readonly<Record<string, ItemDeclaration>> = {
    [UNSAVED_ITEM]: {title: {"zh-CN": "未保存的文档", "en-US": "Unsaved documents"}, alignment: "right", order: 10, priority: 30, command: {id: SAVE_ALL_COMMAND}, when: {requires: [editorState.key("hasUnsavedDocuments")]}},
    [WORD_COUNT_ITEM]: {title: {"zh-CN": "字数", "en-US": "Word count"}, alignment: "right", order: 20, priority: 20, when: {requires: [editorState.key("active")]}},
    [CURSOR_ITEM]: {title: {"zh-CN": "光标位置", "en-US": "Cursor position"}, alignment: "right", order: 30, priority: 10, when: {requires: [editorState.key("hasCursorPosition")]}},
};

const TEXT = {
    unsaved: {"zh-CN": "未保存 {count} 个", "en-US": "{count} unsaved"},
    saving: {"zh-CN": "正在保存", "en-US": "Saving"},
    failed: {"zh-CN": "保存失败：{path}（{reason}）", "en-US": "Save failed: {path} ({reason})"},
    more: {"zh-CN": "等 {count} 个", "en-US": "and {count} more"},
    words: {"zh-CN": "{count} 字", "en-US": "{count} words"},
    cursor: {"zh-CN": "第 {line} 行，第 {column} 列", "en-US": "Ln {line}, Col {column}"},
} satisfies Record<string, LocalizedText>;

/** 提示里至多列出的文件数。 */
const LISTED = 5;

/** 提示里给人看的路径：去掉 `project://`、`user://` 这类方案前缀。 */
const shown = (address: string): string => address.replace(/^[a-z]+:\/\//u, "");

export function editorStatusItems(area: Readonly<ShallowRef<EditorArea | null>>, locale: Readonly<ComputedRef<DisplayLocale>>): Readonly<Record<string, ItemImplementation>> {
    const text = (value: LocalizedText): string => localize(value, locale.value);
    const unsaved = () => area.value?.openDocuments.value.filter(needsSaving) ?? [];
    const failures = () => unsaved().filter((document) => document.saveProblem.value !== null);
    const number = (count: number): string => new Intl.NumberFormat(locale.value).format(count);
    return {
        [UNSAVED_ITEM]: {
            text: () => text(formatText(TEXT.unsaved, {count: number(unsaved().length)})),
            tooltip: () => {
                const documents = unsaved();
                const lines = [
                    ...failures().map((document) => text(formatText(TEXT.failed, {path: shown(document.target.value.path), reason: document.saveProblem.value?.detail ?? ""}))),
                    ...(documents.some((document) => document.saving.value) ? [text(TEXT.saving)] : []),
                    ...documents.slice(0, LISTED).map((document) => shown(document.target.value.path)),
                    ...(documents.length > LISTED ? [text(formatText(TEXT.more, {count: number(documents.length - LISTED)}))] : []),
                ];
                return lines.join("\n");
            },
            state: () => (failures().length > 0 ? "error" : "normal"),
        },
        [WORD_COUNT_ITEM]: {
            text: () => text(formatText(TEXT.words, {count: number(countWords(area.value?.activeDocument.value?.text.value ?? ""))})),
        },
        [CURSOR_ITEM]: {
            text: () => {
                const position = area.value?.activeHandle.value?.position?.value ?? null;
                return position === null ? "" : text(formatText(TEXT.cursor, {line: number(position.line), column: number(position.column)}));
            },
        },
    };
}
