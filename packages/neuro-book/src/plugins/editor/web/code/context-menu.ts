/**
 * 源码编辑器正文右键的内置项（docs/specs/workbench/editor.md 输出 64）：哪些项、此刻显示哪些、每项怎样交给 Monaco 执行。
 *
 * 这张表是封闭的：不读 Monaco 自己的菜单登记（内部模块，条件要用它内部的服务求值）。以后语言贡献带来新的动作
 * （转到定义、重命名）要在这里加行才会出现。
 */

/// <reference path="./monaco-modules.d.ts" />

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import {readClipboardText} from "nbook/shared/clipboard-read";
import type {ClipboardTextReader, PasteFailure} from "nbook/shared/clipboard-read";

/** 菜单打开那一刻的状态：聚焦之后取一次，菜单开着期间不重算。 */
export interface CodeMenuSnapshot {
    readonly readonly: boolean;
    readonly hasSelection: boolean;
    /** 这门语言有文档格式化（现在只有 JSON）。 */
    readonly canFormat: boolean;
    readonly canFormatSelection: boolean;
}

/**
 * 交给 Monaco 的方式。Monaco 里“命令”与“动作”是两套登记：剪贴板、全选是命令，只能 `trigger`，`getAction` 取不到；
 * 查找、格式化是动作。粘贴要自己读剪贴板（独立版的粘贴动作缺内部服务，执行不了）。
 */
export type CodeMenuRun =
    | {readonly kind: "command"; readonly id: string}
    | {readonly kind: "action"; readonly id: string}
    | {readonly kind: "paste"};

export interface CodeMenuItem {
    /** 也是文字的键（`menus.<id>`）。 */
    readonly id: "cut" | "copy" | "paste" | "selectAll" | "find" | "replace" | "changeAll" | "formatDocument" | "formatSelection";
    readonly icon?: string;
    /** 菜单上标出的快捷键。只给各平台一致的几项：替换、格式化在 Linux 与 macOS 上键位不同，应用只分两档平台。 */
    readonly keybinding?: string;
    readonly run: CodeMenuRun;
}

/** `EditorOption.emptySelectionClipboard`：没选区时复制整行。枚举在运行时的 API 对象上，这个模块只引类型，写数值。 */
const EMPTY_SELECTION_CLIPBOARD = 45 satisfies Monaco.editor.EditorOption.emptySelectionClipboard;

const FORMAT_DOCUMENT = "editor.action.formatDocument";
const FORMAT_SELECTION = "editor.action.formatSelection";

/** 此刻显示的内置项，按节分好；空的节不出现。 */
export function codeMenuSections(snapshot: CodeMenuSnapshot): ReadonlyArray<ReadonlyArray<CodeMenuItem>> {
    const writable = !snapshot.readonly;
    const sections: ReadonlyArray<ReadonlyArray<CodeMenuItem | null>> = [
        [
            writable ? {id: "cut", icon: "i-lucide-scissors", keybinding: "Mod+X", run: {kind: "command", id: "editor.action.clipboardCutAction"}} : null,
            {id: "copy", icon: "i-lucide-copy", keybinding: "Mod+C", run: {kind: "command", id: "editor.action.clipboardCopyAction"}},
            writable ? {id: "paste", icon: "i-lucide-clipboard", keybinding: "Mod+V", run: {kind: "paste"}} : null,
        ],
        [
            {id: "selectAll", keybinding: "Mod+A", run: {kind: "command", id: "editor.action.selectAll"}},
        ],
        [
            {id: "find", icon: "i-lucide-search", keybinding: "Mod+F", run: {kind: "action", id: "actions.find"}},
            writable ? {id: "replace", icon: "i-lucide-replace", run: {kind: "action", id: "editor.action.startFindReplaceAction"}} : null,
            writable ? {id: "changeAll", run: {kind: "action", id: "editor.action.changeAll"}} : null,
            writable && snapshot.canFormat ? {id: "formatDocument", run: {kind: "action", id: FORMAT_DOCUMENT}} : null,
            writable && snapshot.hasSelection && snapshot.canFormatSelection ? {id: "formatSelection", run: {kind: "action", id: FORMAT_SELECTION}} : null,
        ],
    ];
    return sections.map((section) => section.filter((item): item is CodeMenuItem => item !== null)).filter((section) => section.length > 0);
}

/**
 * 取快照。调用前编辑器要已经聚焦：动作的可用条件里有的含“文字区有焦点”。`isSupported()` 只用来问这门语言有没有
 * 格式化，别的项不问它。
 */
export function codeMenuSnapshot(editor: Monaco.editor.IStandaloneCodeEditor, readonly: boolean): CodeMenuSnapshot {
    const selection = editor.getSelection();
    return {
        readonly,
        hasSelection: selection !== null && !selection.isEmpty(),
        canFormat: editor.getAction(FORMAT_DOCUMENT)?.isSupported() === true,
        canFormatSelection: editor.getAction(FORMAT_SELECTION)?.isSupported() === true,
    };
}

/**
 * 执行一项。先聚焦：菜单开着时焦点在菜单上，Monaco 的动作在文字区没有焦点时静默不执行。粘贴读不到剪贴板时返回原因，
 * 正文不变。
 */
export async function runCodeMenuItem(editor: Monaco.editor.IStandaloneCodeEditor, run: CodeMenuRun, clipboard: ClipboardTextReader | undefined): Promise<PasteFailure | null> {
    editor.focus();
    if (run.kind === "command") {
        editor.trigger("nbook", run.id, null);
        return null;
    }
    if (run.kind === "action") {
        await editor.getAction(run.id)?.run();
        return null;
    }
    const read = await readClipboardText(clipboard);
    if (!read.ok) return read.failure;
    // 读剪贴板是异步的，这期间焦点可能去了别处。
    editor.focus();
    // 与 Monaco 自己在网页上的粘贴同一段逻辑：文字就是上一次在 Monaco 里复制的那段时，带上“整行复制”“多光标各段”，
    // 否则整行复制后从菜单粘贴会插在行中间，和 Ctrl+V 不一样。
    const {InMemoryClipboardMetadataManager} = await import("monaco-editor/esm/vs/editor/browser/controller/editContext/clipboardUtils.js");
    const metadata = InMemoryClipboardMetadataManager.INSTANCE.get(read.text);
    editor.trigger("nbook", "paste", {
        text: read.text,
        pasteOnNewLine: metadata?.isFromEmptySelection === true && editor.getOption(EMPTY_SELECTION_CLIPBOARD),
        multicursorText: metadata?.multicursorText ?? null,
        mode: metadata?.mode ?? null,
    });
    return null;
}
