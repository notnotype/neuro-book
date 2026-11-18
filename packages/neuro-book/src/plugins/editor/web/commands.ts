/**
 * 编辑器的命令（docs/specs/workbench/editor.md 的命令表，docs/specs/workbench/commands.md 的第一批编辑器命令）：作用于
 * 活动编辑组的活动标签。编辑器区还没建立时为 `unavailable`，不静默成功。键位不写进声明：由编辑器区在自己有焦点时
 * 处理并执行同一条命令，命令面板里这些命令始终可选。
 */

import {Type} from "typebox";
import type {Static} from "typebox";
import type {ShallowRef} from "@vue/reactivity";

import type {CommandImplementation, CommandResult, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {FilesService} from "nbook/plugins/files/shared/contracts";
import type {QuickPick} from "nbook/plugins/workbench/shared/contracts";
import type {DisplayText} from "nbook/shared/localized-text";

import {OPEN_PAGE_COMMAND, PAGE_ARG_MAX_LENGTH} from "../shared/contracts";
import {editorText} from "../shared/text";
import type {ActionResult, BatchCloseResult, EditorArea} from "./area";
import type {EditorTab} from "./groups/groups";
import {resourceOf} from "./documents/address";
import {candidatesFor} from "./editors";
import type {EditorCatalog} from "./editors";
import type {LanguageRegistry} from "./code/languages";
import type {EditorPageRegistry} from "./pages";
import {editorState} from "./state";

export const OPEN_COMMAND = "nbook.editor.open";
export const SAVE_COMMAND = "nbook.editor.save";
export const SAVE_ALL_COMMAND = "nbook.editor.save-all";
export const REVERT_COMMAND = "nbook.editor.revert";
export const CLOSE_COMMAND = "nbook.editor.close";
export const CLOSE_OTHERS_COMMAND = "nbook.editor.close-others";
export const CLOSE_TO_RIGHT_COMMAND = "nbook.editor.close-to-right";
export const CLOSE_SAVED_COMMAND = "nbook.editor.close-saved";
export const PIN_TAB_COMMAND = "nbook.editor.pin-tab";
export const UNPIN_TAB_COMMAND = "nbook.editor.unpin-tab";
export const COPY_PATH_COMMAND = "nbook.editor.copy-path";
export const FOCUS_BREADCRUMBS_COMMAND = "nbook.editor.focus-breadcrumbs";
export const COPY_RELATIVE_PATH_COMMAND = "nbook.editor.copy-relative-path";
export const SPLIT_RIGHT_COMMAND = "nbook.editor.split-right";
export const SPLIT_DOWN_COMMAND = "nbook.editor.split-down";
export const REOPEN_WITH_COMMAND = "nbook.editor.reopen-with";
export const OPEN_PREVIEW_COMMAND = "nbook.editor.open-preview";
export const CHANGE_LANGUAGE_COMMAND = "nbook.editor.change-language";
export const FOCUS_COMMAND = "nbook.editor.focus";
export const UNDO_COMMAND = "nbook.edit.undo";
export const REDO_COMMAND = "nbook.edit.redo";
export const GO_TO_LINE_COMMAND = "nbook.editor.go-to-line";

const EDITOR = editorText("categories.editor");
const EDIT = editorText("categories.edit");
const NO_ARGS = Type.Object({}, {additionalProperties: false});
const when = (...names: ReadonlyArray<keyof typeof editorState.declarations & string>) => ({requires: names.map((name) => editorState.key(name))});

const OPEN_ARGS = Type.Object({
    address: Type.String(),
    mode: Type.Union([Type.Literal("preview"), Type.Literal("permanent")]),
    /** 编辑器 id（docs/specs/workbench/editor.md 输出 38）；缺省按输出 37 的顺序选。 */
    editor: Type.Optional(Type.String({minLength: 1})),
    /** 打开后把光标放到末尾（docs/specs/workbench/editor.md 输出 29）。 */
    reveal: Type.Optional(Type.Literal("end")),
    /** 在哪一组打开：组 id，或 `side`（活动组右侧）；缺省活动组（输出 35）。 */
    group: Type.Optional(Type.String({minLength: 1})),
}, {additionalProperties: false});

/** `arg`：带参数的页面（声明了 `instances`）必须给，别的页面不能给；长度在这里查，要不要给在执行时对着声明查。 */
const OPEN_PAGE_ARGS = Type.Object({id: Type.String({minLength: 1}), arg: Type.Optional(Type.String({minLength: 1, maxLength: PAGE_ARG_MAX_LENGTH}))}, {additionalProperties: false});
/** 作用于哪个标签：标签的右键菜单给被右击的那个（docs/specs/workbench/editor.md 输出 57），缺省活动组的活动标签。 */
const TAB_ARGS = Type.Object({tabId: Type.Optional(Type.String({minLength: 1}))}, {additionalProperties: false});

/** 不给 `editor` 时弹出选择（输出 39），命令面板里不必手写参数。 */
const REOPEN_ARGS = Type.Object({editor: Type.Optional(Type.String({minLength: 1}))}, {additionalProperties: false});

/** `side` 为真时在活动组右侧的组打开（docs/specs/workbench/editor.md 输出 46）。 */
const OPEN_PREVIEW_ARGS = Type.Object({side: Type.Optional(Type.Boolean())}, {additionalProperties: false});

/** 不给 `language` 时弹出选择（输出 45）。 */
const CHANGE_LANGUAGE_ARGS = Type.Object({language: Type.Optional(Type.String({minLength: 1}))}, {additionalProperties: false});

const GO_TO_LINE_ARGS = Type.Object({
    target: Type.Object({
        workspaceKey: Type.String(),
        generation: Type.Integer({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}),
        documentId: Type.String(),
        path: Type.String(),
    }, {additionalProperties: false}),
    line: Type.Integer({minimum: 1, maximum: Number.MAX_SAFE_INTEGER}),
}, {additionalProperties: false});

export const EDITOR_COMMAND_DECLARATIONS: Readonly<Record<string, WrittenCommandDeclaration>> = {
    [OPEN_COMMAND]: {category: EDITOR, description: "Open a resource address in the active editor group, or in the group given by id, or with group \"side\" in the group to the right of the active one (split right when there is none); preview tabs are replaced by the next preview open.", args: OPEN_ARGS, effect: "read", expose: {human: false, agent: "auto"}},
    // 要参数、不进命令面板：用户经各页面自己的命令打开（例如“帮助 > 欢迎”）。
    [OPEN_PAGE_COMMAND]: {category: EDITOR, description: "Open an editor page (a tab that is not a file, such as the welcome page) by its contribution id; a page already open in the window is activated instead of opened twice.", args: OPEN_PAGE_ARGS, effect: "read", expose: {human: false, agent: "auto"}},
    [SAVE_COMMAND]: {category: EDITOR, description: "Save the active document against its disk baseline; a changed disk is reported as a conflict, never overwritten.", args: NO_ARGS, effect: "write", when: when("dirty"), expose: {agent: "confirm"}},
    [SAVE_ALL_COMMAND]: {category: EDITOR, description: "Save every open document with unsaved changes.", args: NO_ARGS, effect: "write", expose: {agent: "confirm"}},
    [REVERT_COMMAND]: {category: EDITOR, description: "Discard the active document's unsaved changes and reload it from disk.", args: NO_ARGS, effect: "write", when: when("active"), expose: {agent: "never", hints: {destructive: true}}},
    [CLOSE_COMMAND]: {category: EDITOR, description: "Close a tab (the active one unless tabId is given); asks first when its document has unsaved changes.", args: TAB_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [CLOSE_OTHERS_COMMAND]: {category: EDITOR, description: "Close the other tabs in the tab's group (the active tab unless tabId is given), keeping pinned tabs; stops when the user cancels a prompt or a save fails.", args: TAB_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [CLOSE_TO_RIGHT_COMMAND]: {category: EDITOR, description: "Close the tabs to the right of the tab (the active tab unless tabId is given), keeping pinned tabs; stops when the user cancels a prompt or a save fails.", args: TAB_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [CLOSE_SAVED_COMMAND]: {category: EDITOR, description: "Close the tabs in the tab's group (the active tab unless tabId is given) that have nothing to save, keeping pinned tabs.", args: TAB_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [PIN_TAB_COMMAND]: {category: EDITOR, description: "Pin a file tab (the active one unless tabId is given): pinned tabs stay at the start of the group and are kept by close others and close to the right.", args: TAB_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [UNPIN_TAB_COMMAND]: {category: EDITOR, description: "Unpin a tab (the active one unless tabId is given).", args: TAB_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    // 写系统剪贴板：Agent 不调用（与资源管理器的复制路径相同）。
    [COPY_PATH_COMMAND]: {category: EDITOR, description: "Copy the absolute path (on the server machine) of a file tab (the active one unless tabId is given) to the system clipboard.", args: TAB_ARGS, effect: "read", when: when("active"), expose: {agent: "never"}},
    [COPY_RELATIVE_PATH_COMMAND]: {category: EDITOR, description: "Copy the path of a file tab (the active one unless tabId is given) relative to its root to the system clipboard.", args: TAB_ARGS, effect: "read", when: when("active"), expose: {agent: "never"}},
    [SPLIT_RIGHT_COMMAND]: {category: EDITOR, description: "Open the tab's document (the active tab unless tabId is given) in a new group to the right.", args: TAB_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [SPLIT_DOWN_COMMAND]: {category: EDITOR, description: "Open the tab's document (the active tab unless tabId is given) in a new group below.", args: TAB_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [REOPEN_WITH_COMMAND]: {category: EDITOR, description: "Reopen the active tab with another editor, given by id; without an editor, pick one from the editors that can open the file.", args: REOPEN_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [OPEN_PREVIEW_COMMAND]: {category: EDITOR, description: "Open the preview of the active file (for example an HTML page) in the active group, or with side true in the group to the right.", args: OPEN_PREVIEW_ARGS, effect: "read", when: when("hasPreview"), expose: {agent: "auto"}},
    [CHANGE_LANGUAGE_COMMAND]: {category: EDITOR, description: "Change the language (syntax highlighting and editing rules) of the active source editor, given by language id; without a language, pick one from the registered languages. The choice is remembered on the tab.", args: CHANGE_LANGUAGE_ARGS, effect: "read", when: when("hasLanguage"), expose: {agent: "auto"}},
    // 只移动键盘焦点：Agent 不需要。
    [FOCUS_BREADCRUMBS_COMMAND]: {category: EDITOR, description: "Move keyboard focus to the breadcrumbs of the active editor group.", args: NO_ARGS, effect: "read", when: when("breadcrumbs"), expose: {agent: "never"}},
    [FOCUS_COMMAND]: {category: EDITOR, description: "Focus the active editor.", args: NO_ARGS, effect: "read", when: when("active"), expose: {agent: "auto"}},
    [UNDO_COMMAND]: {category: EDIT, description: "Undo the latest edit in the active editor.", args: NO_ARGS, effect: "write", when: when("active", "writable"), expose: {agent: "confirm"}},
    [REDO_COMMAND]: {category: EDIT, description: "Redo the latest undone edit in the active editor.", args: NO_ARGS, effect: "write", when: when("active", "writable"), expose: {agent: "never"}},
    // 参数由面板的 `:N` 合成，不在候选里摆一个要手写 JSON 的半成品动作。
    [GO_TO_LINE_COMMAND]: {category: EDITOR, description: "Move the caret to a one-based line in the specified active document.", args: GO_TO_LINE_ARGS, effect: "read", when: when("active", "lineNavigation"), expose: {human: false, agent: "auto"}},
};

const unavailable = (reason: DisplayText): CommandResult<unknown> => ({ok: false, code: "unavailable", reason});
/** 参数的形状对、对着此刻的声明不对（例如给不带参数的页面带了参数）。 */
const invalidArgs = (reason: DisplayText): CommandResult<unknown> => ({ok: false, code: "invalid-args", reason});
/** 把文件标签的路径写进剪贴板（docs/specs/workbench/editor.md 输出 57）：绝对路径取自 Files 的 `realPath`，相对路径是相对所在根的路径。 */
export async function copyTabPath(sources: Pick<EditorCommandSources, "files" | "clipboard">, tab: EditorTab, relative: boolean): Promise<ActionResult> {
    if (tab.kind === "page") return {ok: false, reason: editorText("refusal.pageNoPath")};
    if (sources.clipboard === null) return {ok: false, reason: editorText("refusal.noClipboard")};
    let text = resourceOf(tab.address).path;
    if (!relative) {
        const real = await sources.files.realPath(tab.address);
        if (!real.ok) return {ok: false, reason: editorText("refusal.realPathFailed", {address: tab.address, code: real.code})};
        text = real.value;
    }
    try {
        await sources.clipboard.writeText(text);
    } catch (error) {
        return {ok: false, reason: editorText("refusal.clipboardFailed", {message: error instanceof Error ? error.message : String(error)})};
    }
    return {ok: true};
}

const fromAction = (result: ActionResult): CommandResult<unknown> => (result.ok ? {ok: true, value: null} : unavailable(result.reason));
const fromBatch = (result: BatchCloseResult): CommandResult<unknown> => (result.ok ? {ok: true, value: {closed: result.closed}} : unavailable(result.reason));

export interface EditorCommandSources {
    readonly pages: Pick<EditorPageRegistry, "available" | "declaration">;
    readonly editors: EditorCatalog;
    /** 已登记的语言（输出 43）。 */
    readonly languages: Pick<LanguageRegistry, "has" | "list" | "name">;
    /** 工作台的选择服务（“用其它编辑器重新打开”“更改语言模式”不带参数时）；没有为 null。 */
    readonly pick: QuickPick | null;
    /** 复制路径：绝对路径取自 Files 的 `realPath`。 */
    readonly files: Pick<FilesService, "realPath">;
    /** 系统剪贴板；浏览器不给时为 null，复制路径为 `unavailable`。 */
    readonly clipboard: {writeText(text: string): Promise<void>} | null;
}

/** 命令的实现：执行时才问编辑器区，不在登记时捕获。 */
export function editorCommands(area: Readonly<ShallowRef<EditorArea | null>>, sources: EditorCommandSources): Record<string, CommandImplementation> {
    const {pages} = sources;
    const run = (action: (current: EditorArea, args: unknown) => CommandResult<unknown> | Promise<CommandResult<unknown>>): CommandImplementation => ({
        run: (args) => {
            const current = area.value;
            if (current === null) return unavailable(editorText("refusal.notReady"));
            return action(current, args);
        },
    });
    /** 命令作用的标签：给了 `tabId` 就是它（已关为 null），否则活动组的活动标签。 */
    const targetOf = (current: EditorArea, args: unknown): EditorTab | null => {
        const {tabId} = args as Static<typeof TAB_ARGS>;
        return tabId === undefined ? current.groups.activeTab() : current.groups.find(tabId)?.tab ?? null;
    };
    const onTab = (action: (current: EditorArea, tab: EditorTab) => CommandResult<unknown> | Promise<CommandResult<unknown>>): CommandImplementation => run((current, args) => {
        const tab = targetOf(current, args);
        return tab === null ? unavailable(editorText((args as Static<typeof TAB_ARGS>).tabId === undefined ? "refusal.noActiveTab" : "refusal.tabClosed")) : action(current, tab);
    });
    const copyPath = async (tab: EditorTab, relative: boolean): Promise<CommandResult<unknown>> => fromAction(await copyTabPath(sources, tab, relative));
    /** 写入类动作前后各交出一次缓冲输入：文档立刻看到撤销后的正文，而不是等编辑器自己的防抖。 */
    const edit = (current: EditorArea, name: "undo" | "redo"): CommandResult<unknown> => {
        const handle = current.activeHandle.value;
        const method = handle?.[name];
        if (handle === null || method === undefined) return unavailable(editorText(name === "undo" ? "refusal.undoUnsupported" : "refusal.redoUnsupported"));
        handle.flushPendingChange();
        method.call(handle);
        handle.flushPendingChange();
        return {ok: true, value: null};
    };
    return {
        [OPEN_COMMAND]: run((current, args) => {
            const {address, mode, editor, reveal, group} = args as Static<typeof OPEN_ARGS>;
            return fromAction(current.open(address, {mode, ...(editor === undefined ? {} : {editor}), ...(reveal === undefined ? {} : {reveal}), ...(group === undefined ? {} : {group})}));
        }),
        [OPEN_PAGE_COMMAND]: run((current, args) => {
            const {id, arg} = args as Static<typeof OPEN_PAGE_ARGS>;
            if (!pages.available(id)) return unavailable(editorText("refusal.noPage", {id}));
            const declaration = pages.declaration(id);
            if ((declaration?.instances === true) !== (arg !== undefined)) return invalidArgs(editorText(arg === undefined ? "refusal.pageArgRequired" : "refusal.pageArgUnexpected", {id}));
            return fromAction(current.openPage(id, {...(arg === undefined ? {} : {arg}), restore: declaration?.restore === true}));
        }),
        [SAVE_COMMAND]: run(async (current) => fromAction(await current.save())),
        [SAVE_ALL_COMMAND]: run(async (current) => fromAction(await current.saveAll())),
        [REVERT_COMMAND]: run(async (current) => fromAction(await current.revert())),
        [CLOSE_COMMAND]: onTab(async (current, tab) => ((await current.close(tab.id)) === "closed" ? {ok: true, value: null} : unavailable(editorText("refusal.closeCancelled")))),
        [CLOSE_OTHERS_COMMAND]: onTab(async (current, tab) => fromBatch(await current.closeOthers(tab.id))),
        [CLOSE_TO_RIGHT_COMMAND]: onTab(async (current, tab) => fromBatch(await current.closeToRight(tab.id))),
        [CLOSE_SAVED_COMMAND]: onTab(async (current, tab) => fromBatch(await current.closeSaved(tab.id))),
        [PIN_TAB_COMMAND]: onTab((current, tab) => fromAction(current.setPinned(tab.id, true))),
        [UNPIN_TAB_COMMAND]: onTab((current, tab) => fromAction(current.setPinned(tab.id, false))),
        [COPY_PATH_COMMAND]: onTab((_current, tab) => copyPath(tab, false)),
        [COPY_RELATIVE_PATH_COMMAND]: onTab((_current, tab) => copyPath(tab, true)),
        [SPLIT_RIGHT_COMMAND]: onTab((current, tab) => fromAction(current.split("right", tab.id))),
        [SPLIT_DOWN_COMMAND]: onTab((current, tab) => fromAction(current.split("down", tab.id))),
        [REOPEN_WITH_COMMAND]: run(async (current, args) => {
            const given = (args as Static<typeof REOPEN_ARGS>).editor;
            const tab = current.groups.activeTab();
            if (tab === null || tab.kind === "page") return unavailable(editorText("refusal.noActiveFileTab"));
            if (given !== undefined) return fromAction(current.reopenWith(given));
            if (sources.pick === null) return unavailable(editorText("refusal.noPicker", {arg: "editor"}));
            // 当前的那个也列出（标“当前”），选它等于不换。
            const ids = candidatesFor(sources.editors, tab.address);
            const picked = await sources.pick.pick({
                title: editorText("quickPick.reopenWith.title"),
                placeholder: editorText("quickPick.reopenWith.placeholder"),
                items: ids.map((id) => ({id, label: sources.editors.declaration(id)?.title ?? id, ...(id === tab.editor ? {detail: editorText("quickPick.reopenWith.current")} : {})})),
            });
            if (picked.kind === "unavailable") return unavailable(picked.reason);
            if (picked.kind !== "item") return {ok: true, value: null};
            // 选择期间编辑器区可能已经换了（窗口换绑项目）、活动标签可能已经换了：只对发起时的那个标签生效。
            if (area.value !== current) return {ok: false, code: "stale-target", reason: editorText("refusal.areaChanged")};
            const still = current.groups.activeTab();
            if (still?.id !== tab.id || still.kind === "page" || still.editor !== tab.editor) return {ok: false, code: "stale-target", reason: editorText("refusal.tabChanged")};
            return fromAction(picked.id === tab.editor ? {ok: true} : current.reopenWith(picked.id));
        }),
        [CHANGE_LANGUAGE_COMMAND]: run(async (current, args) => {
            const given = (args as Static<typeof CHANGE_LANGUAGE_ARGS>).language;
            const tab = current.groups.activeTab();
            const shown = current.activeHandle.value?.language?.value ?? null;
            if (tab === null || tab.kind === "page" || shown === null) return unavailable(editorText("refusal.noLanguage"));
            if (given !== undefined) {
                if (!sources.languages.has(given)) return unavailable(editorText("refusal.unknownLanguage", {language: given}));
                current.groups.setLanguage(tab.id, given);
                return {ok: true, value: null};
            }
            if (sources.pick === null) return unavailable(editorText("refusal.noPicker", {arg: "language"}));
            const picked = await sources.pick.pick({
                title: editorText("quickPick.changeLanguage.title"),
                placeholder: editorText("quickPick.changeLanguage.placeholder"),
                items: sources.languages.list().map((id) => ({id, label: sources.languages.name(id), detail: id === shown ? editorText("quickPick.changeLanguage.current", {id}) : id})),
            });
            if (picked.kind === "unavailable") return unavailable(picked.reason);
            if (picked.kind !== "item") return {ok: true, value: null};
            // 选择期间编辑器区可能已经换了（窗口换绑项目）、活动标签可能已经换了：只对发起时的那个标签生效。
            if (area.value !== current) return {ok: false, code: "stale-target", reason: editorText("refusal.areaChanged")};
            const still = current.groups.activeTab();
            if (still?.id !== tab.id || still.kind === "page" || still.editor !== tab.editor) return {ok: false, code: "stale-target", reason: editorText("refusal.tabChanged")};
            current.groups.setLanguage(tab.id, picked.id);
            return {ok: true, value: null};
        }),
        [OPEN_PREVIEW_COMMAND]: run((current, args) => fromAction(current.openPreview((args as Static<typeof OPEN_PREVIEW_ARGS>).side === true))),
        [FOCUS_BREADCRUMBS_COMMAND]: run((current) => fromAction(current.focusBreadcrumbs())),
        [FOCUS_COMMAND]: run((current) => {
            const handle = current.activeHandle.value;
            if (handle === null) return unavailable(editorText("refusal.nothingToFocus"));
            handle.focus();
            return {ok: true, value: null};
        }),
        [UNDO_COMMAND]: run((current) => edit(current, "undo")),
        [REDO_COMMAND]: run((current) => edit(current, "redo")),
        [GO_TO_LINE_COMMAND]: run((current, args) => {
            const {target, line} = args as Static<typeof GO_TO_LINE_ARGS>;
            const document = current.activeDocument.value;
            const handle = current.activeHandle.value;
            if (document === null || handle === null) return unavailable(editorText("refusal.noActiveEditor"));
            const active = document.target.value;
            if (active.workspaceKey !== target.workspaceKey || active.generation !== target.generation || active.documentId !== target.documentId || active.path !== target.path) return {ok: false, code: "stale-target", reason: editorText("refusal.targetChanged")};
            const navigation = handle.navigation;
            if (navigation === undefined) return unavailable(editorText("refusal.lineUnsupported"));
            const total = navigation.getLineCount();
            if (total === null) return unavailable(editorText("refusal.notReady"));
            if (line > total) return {ok: false, code: "invalid-args", reason: editorText("refusal.lineOutOfRangeOf", {line, total})};
            const revealed = navigation.revealLine(line);
            return revealed.ok ? {ok: true, value: revealed.value} : unavailable(revealed.reason);
        }),
    };
}
