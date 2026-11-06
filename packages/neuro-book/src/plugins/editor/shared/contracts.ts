/**
 * `nbook.editor` 对其它插件公开的合同（docs/specs/workbench/editor.md 的“输入与前置条件”）：文档协调服务，资源管理器
 * 在复制、移动、改名与删除前经它结算未保存的修改；页面贡献点 `editor.pages`（输出 33），欢迎页这类不对应文件的标签；编辑区标题的
 * 菜单位置 `editor.title`（输出 34）。其它插件在运行时只引用本文件。
 */

import {defineDropKind} from "@notnotype/nb-layout";
import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import type {Ref} from "@vue/reactivity";
import type {InjectionKey} from "vue";
import type {languages as MonacoLanguages} from "monaco-editor/esm/vs/editor/editor.api.js";

import type {EditingActionId, EditorEditing} from "./editing";

/** 文件拖到编辑组：编辑组登记这个落点，拖动方查到组 id 后执行带 `group` 的 `nbook.editor.open`（docs/specs/workbench/editor.md 输出 35）。 */
export const EDITOR_GROUP_FILE = defineDropKind<{readonly group: string}>("nbook.editor.group.file");

export {EDITING_ACTIONS} from "./editing";
export type {EditingActionId, EditorEditing} from "./editing";
import type {Component} from "vue";

import type {ContributionDescriptor} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import {MENU_BUTTON, MENU_EXTENSIONS, menuItemValidator, menuLocation} from "nbook/plugins/commands/shared/contracts";
import type {MenuEntry, MenuItemDeclaration} from "nbook/plugins/commands/shared/contracts";
import {conventionCompleter} from "nbook/shared/convention-keys";
import {TextSchema} from "nbook/shared/text";
import type {DisplayLocale, DisplayText, LocalizedText} from "nbook/shared/localized-text";

/** 需要结算的文档此刻的状态：dirty、在保存、有未裁决输入、有视图写不出（输出 61）、磁盘冲突。 */
export type SettleState = "dirty" | "saving" | "unresolved" | "unrepresentable" | "conflict";

export interface AffectedDocument {
    readonly address: string;
    readonly state: SettleState;
}

/** 文件操作期间挡住受影响文档的新保存（保存排队、输入照常）。 */
export interface DocumentLease {
    /**
     * 操作结束：`done` 时成功移动的项按实际目标改地址，租约释放；`unknown`（结果未知）时租约保持，资源管理器核对或
     * 放弃后再以 `done` 结束。重复结束无效。
     */
    end(result: {readonly kind: "done"; readonly moved?: ReadonlyArray<{readonly from: string; readonly to: string}>} | {readonly kind: "unknown"}): void;
}

export type LeaseResult =
    | {readonly ok: true; readonly lease: DocumentLease}
    | {readonly ok: false; readonly reason: "blocked"; readonly documents: ReadonlyArray<AffectedDocument>};

export interface DocumentCoordinator {
    /** 地址本身或其后代里需要结算的文档。 */
    affected(addresses: ReadonlyArray<string>): ReadonlyArray<AffectedDocument>;
    /** 结算这些文档的视图输入、等在途保存，再挡住它们的新保存；有未裁决输入、写不出的视图或磁盘冲突时为 blocked，不取租约。 */
    begin(addresses: ReadonlyArray<string>): Promise<LeaseResult>;
    /** 保存这些地址下的 dirty 文档，逐项结果；有未裁决输入、写不出的视图或磁盘冲突的项不保存、为失败。 */
    save(addresses: ReadonlyArray<string>): Promise<ReadonlyArray<{readonly address: string; readonly ok: boolean; readonly code?: string}>>;
    /** 本窗口的保存形成了从 `token` 起的目录项身份链时返回链尾的令牌，否则原样返回。 */
    translate(address: string, token: string): string;
    /** 用户确认删除并删除成功后：关闭这些地址及其后代的文档与标签、丢弃正文。 */
    close(addresses: ReadonlyArray<string>): void;
}

export const documentCoordinatorKey: ServiceKey<DocumentCoordinator> = defineServiceKey<DocumentCoordinator>("nbook.editor/documents");

export const EDITOR_PAGES_POINT = "editor.pages";

/**
 * 编辑区标题的菜单位置（docs/specs/workbench/editor.md 输出 34，菜单项的共同规则见 docs/specs/workbench/menus.md）：活动编辑组
 * 标签条右侧的按钮与“⋯”。当前文件是活动组的活动标签（是文件时），`context: "resource"` 的项执行时收到 `{address}`。
 */
export const EDITOR_TITLE_POINT = "editor.title";

export type EditorTitleItemDeclaration = MenuItemDeclaration;

export const editorTitleLocation = menuLocation(EDITOR_TITLE_POINT, {...MENU_BUTTON, ...MENU_EXTENSIONS}, {contexts: ["resource"], buttons: true});

export const validateEditorTitleItem = menuItemValidator(editorTitleLocation);

/**
 * 编辑器标签右键的菜单位置（docs/specs/workbench/editor.md 输出 57）：当前文件是被右击的文件标签（页面标签没有），
 * `context: "resource"` 的项执行时收到 `{address}`。
 */
export const EDITOR_TAB_CONTEXT_POINT = "editor.tab-context";

export type EditorTabContextItemDeclaration = MenuItemDeclaration;

export const editorTabContextLocation = menuLocation(EDITOR_TAB_CONTEXT_POINT, {...MENU_EXTENSIONS}, {contexts: ["resource"]});

export const validateEditorTabContextItem = menuItemValidator(editorTabContextLocation);

/**
 * Markdown 编辑器的五个菜单位置（docs/specs/workbench/markdown-editing.md）：`context: "resource"` 的项执行时收到 `{address}`；
 * 只有工具栏分按钮与“⋯”。
 */
export const EDITOR_TOOLBAR_POINT = "editor.toolbar";
export const EDITOR_SELECTION_POINT = "editor.selection";
export const EDITOR_SLASH_POINT = "editor.slash";
export const EDITOR_BLOCK_POINT = "editor.block";
export const EDITOR_BODY_CONTEXT_POINT = "editor.body-context";

export const editorToolbarLocation = menuLocation(EDITOR_TOOLBAR_POINT, {...MENU_BUTTON}, {contexts: ["resource"], buttons: true});
const MENU_ICON = {icon: MENU_BUTTON.icon};
export const editorSelectionLocation = menuLocation(EDITOR_SELECTION_POINT, MENU_ICON, {contexts: ["resource"]});
export const editorSlashLocation = menuLocation(EDITOR_SLASH_POINT, MENU_ICON, {contexts: ["resource"]});
export const editorBlockLocation = menuLocation(EDITOR_BLOCK_POINT, MENU_ICON, {contexts: ["resource"]});
export const editorBodyContextLocation = menuLocation(EDITOR_BODY_CONTEXT_POINT, MENU_ICON, {contexts: ["resource"]});

export const validateEditorToolbarItem = menuItemValidator(editorToolbarLocation);
export const validateEditorSelectionItem = menuItemValidator(editorSelectionLocation);
export const validateEditorSlashItem = menuItemValidator(editorSlashLocation);
export const validateEditorBlockItem = menuItemValidator(editorBlockLocation);
export const validateEditorBodyContextItem = menuItemValidator(editorBodyContextLocation);

/** 固定工具栏放在哪里：`full` 面包屑下面通栏，`merged` 并入面包屑那一行，`bottom` 编辑区底部的浮条。 */
export type EditorToolbarPlacement = "full" | "merged" | "bottom";

/** 编辑组面包屑那一行右侧留给控件的位置（`merged` 时工具栏传送到这里）：每组一个。值是元素；这个文件也进后端的类型检查，写不了 DOM 类型。 */
export const editorToolbarSlotKey: InjectionKey<Readonly<Ref<object | null>>> = Symbol("nbook.editor/toolbar-slot");

/** 编辑器区交给控件的菜单（`provide`）：控件画内置项，命令、贡献项、文字都从这里取。响应式：在渲染函数或 computed 里读。 */
export interface EditorMenus {
    /** 动作的显示标题。 */
    title(action: string): string;
    /** 菜单自己的文字（`menus.<key>`）。 */
    label(key: string): string;
    /** 按平台写好的快捷键，没有为 null。 */
    shortcut(action: EditingActionId): string | null;
    /** 这条命令此刻在目录里：t09 登记 `nbook.edit.link` 之前，链接按钮不出现。 */
    has(command: string): boolean;
    /** 经命令服务执行编辑动作。 */
    run(action: EditingActionId, args?: Readonly<Record<string, unknown>>): void;
    /** 执行不在目录表里的命令（撤销、重做、链接）。 */
    execute(command: string, args?: Readonly<Record<string, unknown>>): void;
    /** 位置上此刻显示的贡献项，按节分好。 */
    contributed(point: string): ReadonlyArray<ReadonlyArray<MenuEntry>>;
    /** 点了贡献项：执行时按活动标签给 `{address}`。 */
    runContributed(point: string, id: string): void;
    readonly toolbarVisible: Readonly<Ref<boolean>>;
    readonly toolbarPlacement: Readonly<Ref<EditorToolbarPlacement>>;
    /** 键位写法按平台写好（剪贴板这类不是命令的动作用）。 */
    keyLabel(keybinding: string): string;
    /** 给用户看的一条通知（`menus.<key>`）。 */
    notify(key: string): void;
    reportError(error: unknown): void;
}

export const editorMenusKey: InjectionKey<EditorMenus> = Symbol("nbook.editor/menus");

/** 按 id 打开一个页面（同一页面在窗口里只开一个，已开就切过去）。 */
export const OPEN_PAGE_COMMAND = "nbook.editor.open-page";

/**
 * 页面的声明。页面标签不进会话记录，刷新后不恢复；`openOnFirstVisit` 的页面在这部作品第一次在本窗口打开（还没有编辑器
 * 会话记录）时自动打开。实现（`load()`）与页面组件收到的上下文在 `web/pages.ts`。
 */
export const EditorPageDeclarationSchema = Type.Object({
    title: TextSchema,
    icon: Type.String({pattern: "\\S"}),
    openOnFirstVisit: Type.Optional(Type.Boolean()),
    /** 铺主题的场景图（docs/specs/theme/skins.md 输出 4）：欢迎页这类内容少的页面才写；表单页不写，字不能叠在图上。 */
    scene: Type.Optional(Type.Boolean()),
}, {additionalProperties: false});

export type EditorPageDeclaration = Static<typeof EditorPageDeclarationSchema>;

/** `editor.pages` 的补全：没写 `title` 时补约定键 `editorPages.<本地 id>.title`（docs/specs/workbench/editor.md 的“约定键”）。 */
export const completeEditorPageDeclaration = conventionCompleter({name: "editorPages", fields: ["title"]});

const PAGE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u;

/** 页面 id 的前缀由内核按贡献点的 `idPrefix` 核对（同视图），这里只看形状与声明。 */
export function validateEditorPageContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${EDITOR_PAGES_POINT} only accepts contributions from browser entries`;
    if (!PAGE_ID.test(descriptor.id)) return `Page id must be dot-separated lowercase segments: ${descriptor.id}`;
    if (!Value.Check(EditorPageDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(EditorPageDeclarationSchema, descriptor.declaration)][0];
        return `Page ${descriptor.id} has an invalid declaration: ${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}: ${first.message}`}`;
    }
    return null;
}

/**
 * 编辑器贡献点（docs/specs/workbench/editor.md 输出 36–42）：一种打开文件的方式。贡献 id 就是编辑器 id，记在标签上；
 * 规则与页面 id 相同。实现（`load()`）与控件合同在下面。
 */
export const EDITOR_EDITORS_POINT = "editor.editors";

/** 内置的两个编辑器：Markdown 富文本，与源码编辑器（也是默认的文本编辑器，没有 selector）。 */
export const MARKDOWN_EDITOR = "nbook.editor.markdown";
export const CODE_EDITOR = "nbook.editor.code";

const EXTENSION = Type.String({pattern: "^[a-z0-9]+(?:\\.[a-z0-9]+)*$"});

export const EditorDeclarationSchema = Type.Object({
    title: TextSchema,
    selector: Type.Optional(Type.Object({
        /** 不带点的小写后缀，可以多段（`d.ts`）。 */
        extensions: Type.Optional(Type.Array(EXTENSION, {minItems: 1})),
        /** 完整文件名，不区分大小写。 */
        filenames: Type.Optional(Type.Array(Type.String({minLength: 1, pattern: "^[^/\\\\]+$"}), {minItems: 1})),
    }, {additionalProperties: false})),
    priority: Type.Union([Type.Literal("default"), Type.Literal("option")]),
    /** `text` 收到文档的绑定；`bytes` 只收到读字节的地址，不读正文。 */
    input: Type.Union([Type.Literal("text"), Type.Literal("bytes")]),
    /** 预览编辑器：从“打开预览”打开，不被不指定编辑器的打开当成这个文件的标签（输出 1、46）。 */
    role: Type.Optional(Type.Literal("preview")),
    /** 这种编辑器记光标的写法（输出 30）；没有就不记。 */
    cursor: Type.Optional(Type.Union([Type.Literal("offset"), Type.Literal("line")])),
}, {additionalProperties: false});

export type EditorDeclaration = Static<typeof EditorDeclarationSchema>;

/** `editor.editors` 的补全：没写 `title` 时补约定键 `editors.<本地 id>.title`。 */
export const completeEditorDeclaration = conventionCompleter({name: "editors", fields: ["title"]});

export function validateEditorContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${EDITOR_EDITORS_POINT} only accepts contributions from browser entries`;
    if (!PAGE_ID.test(descriptor.id)) return `Editor id must be dot-separated lowercase segments: ${descriptor.id}`;
    if (!Value.Check(EditorDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(EditorDeclarationSchema, descriptor.declaration)][0];
        return `Editor ${descriptor.id} has an invalid declaration: ${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}: ${first.message}`}`;
    }
    const declaration = descriptor.declaration as EditorDeclaration;
    if (declaration.input === "bytes" && declaration.selector === undefined) return `Editor ${descriptor.id} takes bytes and must declare which files it claims (selector)`;
    return null;
}

/** 编辑器的实现：只取得组件定义；组件按下面的控件合同接收绑定。 */
export interface EditorImplementation {
    load(): Promise<Component>;
}

/**
 * 语言贡献点（docs/specs/workbench/editor.md 输出 43–45）：源码编辑器给文本着色与提供编辑规则的方式。贡献 id 是语言 id，
 * 跨编辑器共用（例如 `python`），不要求带插件前缀；两个插件登记同一 id 时两条都被拒（运行时的 `duplicate-contribution`）。
 */
export const EDITOR_LANGUAGES_POINT = "editor.languages";

/** 语言 id 的写法；长度与标签记录的 `language` 字段一致（`web/tabs-record.ts` 引用它）。 */
export const LANGUAGE_ID_PATTERN = "^[a-z][a-z0-9_.-]{0,63}$";
const LANGUAGE_ID = new RegExp(LANGUAGE_ID_PATTERN, "u");

/** 源码编辑器自带的语言：纯文本（Monaco 的缺省）与 JSON（Monaco 的语言服务，带校验与格式化）。 */
export const SOURCE_EDITOR_LANGUAGE_IDS: ReadonlyArray<string> = ["plaintext", "json"];

/** 与 Monaco 的语言登记同一套字段；扩展名的写法与 `editor.editors` 相同（不带点、小写）。 */
export const LanguageDeclarationSchema = Type.Object({
    /** 第一个是显示的名字；其余（连同第一个）也是 Markdown 代码块、HTML 嵌入这类按名字找语言时认的名字。 */
    aliases: Type.Array(Type.String({minLength: 1}), {minItems: 1}),
    extensions: Type.Optional(Type.Array(EXTENSION, {minItems: 1})),
    filenames: Type.Optional(Type.Array(Type.String({minLength: 1, pattern: "^[^/\\\\]+$"}), {minItems: 1})),
    /** 首行匹配的正则（例如 `#!` 行）。 */
    firstLine: Type.Optional(Type.String({minLength: 1})),
    /** HTML 的 `<script type>`、`<style>` 这类按 mimetype 嵌入时认的类型。 */
    mimetypes: Type.Optional(Type.Array(Type.String({minLength: 1}), {minItems: 1})),
}, {additionalProperties: false});

export type LanguageDeclaration = Static<typeof LanguageDeclarationSchema>;

export function validateLanguageContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${EDITOR_LANGUAGES_POINT} only accepts contributions from browser entries`;
    if (!LANGUAGE_ID.test(descriptor.id)) return `Language id must start with a letter, use only lowercase letters, digits, ".", "_" and "-", and be at most 64 characters: ${descriptor.id}`;
    if (SOURCE_EDITOR_LANGUAGE_IDS.includes(descriptor.id)) return `Language ${descriptor.id} is built into the source editor and cannot be contributed`;
    if (!Value.Check(LanguageDeclarationSchema, descriptor.declaration)) {
        const first = [...Value.Errors(LanguageDeclarationSchema, descriptor.declaration)][0];
        return `Language ${descriptor.id} has an invalid declaration: ${first === undefined ? "" : `${first.instancePath === "" ? "/" : first.instancePath}: ${first.message}`}`;
    }
    const firstLine = (descriptor.declaration as LanguageDeclaration).firstLine;
    if (firstLine !== undefined) {
        try {
            new RegExp(firstLine);
        } catch {
            return `Language ${descriptor.id} has a firstLine that is not a valid regular expression: ${firstLine}`;
        }
    }
    return null;
}

/**
 * 语言的规则。`format` 这期只有 `monarch`（TextMate 留给第三方插件的 Work）：`language` 是 Monarch 分词规则，`configuration`
 * 是括号、注释、自动闭合与缩进规则，形状分别是 Monaco 的 `IMonarchLanguage` 与 `LanguageConfiguration`。
 */
type MonarchLanguage = MonacoLanguages.IMonarchLanguage;
type MonarchLanguageConfiguration = MonacoLanguages.LanguageConfiguration;

export interface LanguageDefinition {
    readonly format: "monarch";
    readonly language: MonarchLanguage;
    readonly configuration: MonarchLanguageConfiguration;
}

/** 语言的实现：第一次遇到这门语言时才调用。 */
export interface LanguageImplementation {
    load(): Promise<LanguageDefinition>;
}

/** 视图状态的槽：控件放自己的状态（模型、编辑状态、滚动位置）；淘汰时编辑器区调 `dispose`。 */
export interface ViewStateSlot {
    state: unknown;
    dispose: (() => void) | null;
}

export type TabCursor = {readonly offset: number} | {readonly line: number; readonly column: number};

/**
 * 文本编辑器（`input: "text"`）收到的绑定：文档的只读视图加输入回执。换文档、换编辑器、换标签都是新的绑定（新的
 * `token`）；换下的绑定之后的调用一律当作过时（`commit` 为 `stale`）。
 */
export interface TextEditorBinding {
    readonly kind: "text";
    readonly token: string;
    readonly tabId: string;
    readonly editor: string;
    /** 文件的地址；改名后随之变化。 */
    readonly address: Readonly<Ref<string>>;
    readonly text: Readonly<Ref<string>>;
    /** 正文修订：每次接受输入或换成磁盘内容加一。 */
    readonly revision: Readonly<Ref<number>>;
    readonly slot: ViewStateSlot;
    /** 输入回执：`baseRevision` 是视图看到的修订。 */
    commit(baseRevision: number, text: string): {readonly status: "accepted" | "conflict"; readonly revision: number} | {readonly status: "stale"};
    /** 登记结算函数（交出还没交出的输入）；切换、保存与资源管理器的操作之前同步调用。 */
    attach(flush: () => void): () => void;
    /** 这个绑定有没有未裁决输入。 */
    unresolved(): boolean;
    /**
     * 写不出（输出 61，Markdown 编辑器用）：这次输入没有交出，`from`–`to` 是写不出的那一块在控件文档里的位置（`index`、`excerpt`
     * 是给人看的第几块与开头几个字），`fallback` 是终态页
     * 抢救用的正文。每次写不出都再调用一次（按视图此刻的内容更新）；之后这个视图的一次输入交出成功时自动解除。
     */
    block(input: {readonly reason: string; readonly from: number; readonly to: number; readonly index: number; readonly excerpt: string; readonly fallback: string}): void;
    /** 这个绑定是不是写不出。 */
    blocked(): boolean;
    /** 标签记下的光标：第一次为这份文档建视图状态时放回去。 */
    readonly cursor: TabCursor | null;
    remember(cursor: TabCursor): void;
    /** 标签记下的语言（输出 45）；没有为 null。换语言不换绑定：控件看着它换模型的语言。 */
    readonly language: Readonly<Ref<string | null>>;
}

/**
 * 字节编辑器（`input: "bytes"`）收到的绑定：`url` 读文件字节（docs/specs/workspace/files.md 的“按地址读取字节”），没有
 * 绑定项目时为 null；`version` 在文件每次变化时加一，控件据此重新取。
 */
export interface BytesEditorBinding {
    readonly kind: "bytes";
    readonly token: string;
    readonly tabId: string;
    readonly editor: string;
    readonly address: Readonly<Ref<string>>;
    readonly url: Readonly<Ref<string | null>>;
    readonly version: Readonly<Ref<number>>;
    readonly slot: ViewStateSlot;
}

export type EditorBinding = TextEditorBinding | BytesEditorBinding;

/** 控件交出的句柄：命令（聚焦、撤销、重做、跳转到行）作用于活动组的活动控件。 */
export interface EditorControlHandle {
    focus(): void;
    undo?(): void;
    redo?(): void;
    /** 把还没交出的输入交给文档。 */
    flushPendingChange(): void;
    /** 马上把当前光标交给标签，不等光标停下（拆分要带着拆分这一刻的光标，输出 30）。 */
    rememberCursor?(): void;
    /** 光标位置：选区活动端的行号与列号，都从 1 起（输出 28）；只有能给出源文件行列的控件提供。 */
    readonly position?: Readonly<Ref<{readonly line: number; readonly column: number} | null>>;
    navigation?: {
        getLineCount(): number | null;
        /** 失败的 `reason` 是文字值（控件给文字引用即可，不必收翻译器），由显示命令结果的一方翻译。 */
        revealLine(line: number): {ok: true; value: {line: number}} | {ok: false; reason: DisplayText};
    };
    /** 把光标放到文档末尾并聚焦（继续写作，输出 29）。 */
    revealEnd?(): void;
    /** 状态栏的编辑器状态条目显示的一行（输出 42）；没有为 null。 */
    readonly status?: Readonly<Ref<LocalizedText | string | null>>;
    /** 视图此刻用的语言 id（输出 44、45）：标签记着的，或按文件识别出的；只有分语言的控件（源码编辑器）提供。 */
    readonly language?: Readonly<Ref<string | null>>;
    /** 按标题组织的控件（Markdown 富文本）交出的大纲，面包屑用（输出 60）；换绑定、没有绑定、卸载时为 null。 */
    readonly outline?: Readonly<Ref<EditorOutline | null>>;
    /** 跳到大纲里的一个标题：`binding`、`version` 与此刻的大纲对不上为 `stale`，不移动光标。 */
    revealHeading?(binding: string, version: number, id: string): "ok" | "stale";
    /** 选中 `from`–`to` 并滚过去、聚焦（写不出时的“定位”，输出 61）：位置是控件交给 `binding.block` 的那一对，超出时夹到文档里。 */
    revealRange?(from: number, to: number): void;
    /** 控件提供的编辑动作（docs/specs/workbench/markdown-editing.md）；只有 Markdown 控件提供。 */
    readonly editing?: EditorEditing;
}

/** 大纲（docs/specs/workbench/editor.md 的控件合同）：`binding` 是当前绑定的 token，正文每变一次 `version` 加一；`id` 按位置给，同名标题不冲突。 */
export interface EditorOutline {
    readonly binding: string;
    readonly version: number;
    readonly items: ReadonlyArray<{readonly id: string; readonly level: number; readonly text: string}>;
    /** 光标所在的标题（它之前最近的那一个）；在第一个标题之前为 null。 */
    readonly current: string | null;
}

/** 控件的属性与事件（`binding` 的类型按编辑器的 `input`）。 */
export interface EditorControlProps<B> {
    readonly binding: B | null;
    /** 组 × 编辑器的实例槽：重挂时接着用存在这里的编辑器实例。 */
    readonly host: ViewStateSlot;
    readonly readonly: boolean;
    readonly visible: boolean;
    readonly label: string;
    /** 界面语言：控件自己显示的说明（读取失败之类）按它取。 */
    readonly locale: DisplayLocale;
}
