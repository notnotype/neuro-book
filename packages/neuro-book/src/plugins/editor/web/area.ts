/**
 * 一个窗口的编辑器区（docs/specs/workbench/editor.md）：组与标签模型、文档模型、每个标签的视图绑定与视图状态、加载进度、
 * 关闭询问与会话记录。组件只渲染这里的状态、把用户动作交回来；命令经它执行。
 *
 * 三层寿命：控件每个标签一个，由组件持有，切走时隐藏，最久没用的卸载（`mountedControls`）；视图状态与控件留下的实例每
 * “标签 × 编辑器”一份，存在这里的槽里，跟着标签走，换组不动，卸载控件也不动，只在标签关闭、换编辑器时释放；文档在文档模型
 * 里，按打开引用计数。
 */

import {computed, shallowRef, watch} from "@vue/reactivity";
import type {ComputedRef, Ref, ShallowRef} from "@vue/reactivity";

import type {LayoutEdgeTarget} from "@notnotype/nb-layout";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {FilesResult, FilesService, Listing} from "nbook/plugins/files/shared/contracts";
import type {EditorPanels} from "nbook/plugins/workbench/shared/contracts";
import type {DisplayText} from "nbook/shared/localized-text";

import {CODE_EDITOR} from "../shared/contracts";
import {editorText} from "../shared/text";
import type {BytesEditorBinding, EditorBinding, EditorControlHandle, TextEditorBinding, ViewStateSlot} from "../shared/contracts";
import {createDocumentStore} from "./documents/store";
import type {DocumentReference, DocumentStore, TextDocument} from "./documents/store";
import {BINARY_TAB_EDITOR, BUILTIN_CATALOG, editorRefusal, previewEditorFor, resolveEditor} from "./editors";
import type {EditorCatalog} from "./editors";
import {createEditorGroups} from "./groups/groups";
import {pageAddress, pageIdOf} from "./pages";
import type {EditorGroups, EditorTab, FileTab, SplitDirection, TabPlace, TabsSnapshot} from "./groups/groups";

export type {BytesEditorBinding, EditorBinding, EditorControlHandle, TextEditorBinding, ViewStateSlot} from "../shared/contracts";

/** 打开后这么久正文还没就绪才显示进度条（files-explorer 的“打开与切换”）。 */
export const PROGRESS_DELAY_MS = 800;

/** 每种编辑器最多留这么多个控件；多出来的卸载，视图状态还在（docs/specs/workbench/editor.md 术语“视图”）。 */
export const MOUNTED_CONTROLS_PER_EDITOR = 20;

export type CloseChoice = "save" | "discard" | "cancel";

export interface CloseDialog {
    readonly address: string;
    /** 能不能选“保存”：这个视图写不出时不能（输出 61），只有“不保存”与“取消”。 */
    readonly saveable: boolean;
}

export interface EditorAreaOptions {
    readonly files: FilesService;
    readonly clock: RuntimeClock;
    readonly workspaceKey: string;
    readonly generation: number;
    /** 编辑组的结构：工作台的布局文档持有（docs/specs/ui/workbench-layout.md 输出 33）。 */
    readonly panels: EditorPanels;
    /** 读到的标签属性；没有为 null。 */
    readonly initial: TabsSnapshot | null;
    /** 标签的属性变化时调用；未绑定项目的窗口不给。结构由工作台存。 */
    readonly persist?: (snapshot: TabsSnapshot) => void;
    /** 打开了一个地址（输出 31 的最近打开）；未绑定项目的窗口不给。 */
    readonly opened?: (address: string) => void;
    readonly report: (error: unknown) => void;
    /** 已接受的编辑器声明（docs/specs/workbench/editor.md 输出 36–40）；缺省只有内置的两个。 */
    readonly editors?: EditorCatalog;
    /** 同一级有两个 default 编辑器命中同一个文件时（输出 37）。 */
    readonly conflict?: (address: string, editors: ReadonlyArray<string>) => void;
    /** 设置“预览标签页”（输出 52）：为假时单击打开也是常驻标签，已有的 preview 标签转正。缺省为真。 */
    readonly enablePreview?: () => boolean;
    /** 每种编辑器留几个控件；缺省 `MOUNTED_CONTROLS_PER_EDITOR`。只有测试与 Lab 给：验证回收不用真开 21 个标签。 */
    readonly mountedControlsPerEditor?: number;
}

/**
 * 动作的结果。`reason` 是文字值（多为 `nbook.editor` 目录里的文字引用），由显示它的一方（菜单、通知）经翻译端口按当前语言
 * 翻译：编辑器区是纯 TS、测试直接创建，不收翻译器。
 */
export type ActionResult = {readonly ok: true} | {readonly ok: false; readonly reason: DisplayText};

/** 批量关闭的结果（输出 51）：`closed` 是关掉的个数，停下时 `reason` 写明停在哪个文件、为什么。 */
export type BatchCloseResult = {readonly ok: true; readonly closed: number} | {readonly ok: false; readonly closed: number; readonly reason: DisplayText};

/** 打开成功时给出标签 id：继续写作的定位绑定到这个标签。 */
export type OpenResult = {readonly ok: true; readonly tabId: string} | {readonly ok: false; readonly reason: DisplayText};

export interface MoveOptions {
    /** 移动后把焦点交给活动视图；缺省交。键盘拖放由手势把焦点还给标签，不交。 */
    readonly focusView?: boolean;
}

export interface EditorArea {
    readonly documents: DocumentStore;
    readonly groups: EditorGroups;
    /** 已接受的编辑器声明（标签的标题、预览编辑器的判断要用）。 */
    readonly editors: EditorCatalog;
    /** 组的活动标签的绑定（文本或字节）；没有活动的文件标签、文档还没就绪为 null。给没挂控件的读者用（测试、Lab 夹具）：产品里控件取 `tabBinding`，命令取 `documentOf`、`handleOf`。 */
    binding(groupId: string): EditorBinding | null;
    /**
     * 一个标签的绑定：每个标签一份，换组、切走都不换。页面、“不能在这里打开”的标签、文档还没就绪为 null。第一次调用会打开
     * 标签的文档，所以只为留着控件的标签调（`mountedControls`）：恢复出来、没活动过的标签不读。
     */
    tabBinding(tabId: string): EditorBinding | null;
    /** 组的活动标签的文档（有文本引用的那种）；字节标签与页面为 null。 */
    documentOf(groupId: string): TextDocument | null;
    /** 组的活动文件标签的文件条目，文本与字节标签都有（删除、订阅结束的提示用它）；页面为 null。 */
    fileOf(groupId: string): TextDocument | null;
    /** 活动标签的视图能不能输入：文本编辑器、不是预览视图、文档可写（docs/specs/workbench/editor.md 输出 48）。 */
    viewWritable(groupId: string): boolean;
    /** 这个标签的视图能不能输入（同上）；控件按它自己的标签取，不按组的活动标签。 */
    tabWritable(tabId: string): boolean;
    /**
     * 每个标签每种编辑器一个的槽：控件把编辑器实例存在这里，卸载之后重挂时接着用，撤销历史与编辑状态不丢（输出 10）。
     * 标签关闭或换编辑器时释放。
     */
    tabControlSlot(tabId: string, editor: string): ViewStateSlot;
    /** 留着控件的标签：各组的活动标签，加上每种编辑器最近用过的几个。没活动过的标签不在里面。 */
    readonly mountedControls: ComputedRef<ReadonlySet<string>>;
    /** 组顶部的进度条：活动文档 800 ms 后仍在读取。 */
    progress(groupId: string): boolean;
    /** 活动组的活动文档。 */
    readonly activeDocument: ComputedRef<TextDocument | null>;
    /** 本窗口打开着的文档，按文档去重：同一文件在几个组里打开只算一份。 */
    readonly openDocuments: ComputedRef<ReadonlyArray<TextDocument>>;
    readonly activeHandle: ComputedRef<EditorControlHandle | null>;
    /** 组的活动标签的控件句柄（面包屑按组读大纲，输出 60）；没有为 null。响应式。 */
    handleOf(groupId: string): EditorControlHandle | null;
    /** 列出目录（面包屑的下拉）：经文件服务，`signal` 中止时结果作废。 */
    list(address: string, signal?: AbortSignal): Promise<FilesResult<Listing>>;
    /** 请求聚焦某组的面包屑（命令 `focus-breadcrumbs`）：组件看到 `seq` 变了就聚焦，组 id 对不上的不理。 */
    readonly breadcrumbFocus: Readonly<ShallowRef<{readonly group: string; readonly seq: number} | null>>;
    focusBreadcrumbs(): ActionResult;
    readonly focused: ShallowRef<boolean>;
    readonly dialog: Readonly<ShallowRef<CloseDialog | null>>;
    /** 组顶部的一行提示（例如换文档前有未裁决输入）；没有为 null。文字值，显示时经翻译端口翻译。 */
    readonly notice: Readonly<ShallowRef<DisplayText | null>>;
    /**
     * `reveal`：文档就绪、控件交出句柄后聚焦这个视图，`"end"` 还把光标放到末尾（输出 29）；在此之前切走即取消。
     * `group`：编辑组 id，或 `"side"`（活动组右侧的组，没有就向右新建一个）；缺省活动组（docs/specs/workbench/editor.md 输出 35）。
     */
    open(address: string, options: {readonly mode: "preview" | "permanent"; readonly editor?: string; readonly reveal?: "end" | "cursor"; readonly group?: string}): OpenResult;
    /** 打开一个页面（输出 33）：窗口里已经开着就切过去（连同它所在的组），否则在活动组开一个正式标签。 */
    openPage(id: string): OpenResult;
    activate(tabId: string): ActionResult;
    /** preview 转为 permanent（双击标签）。 */
    keep(tabId: string): void;
    /** 固定或取消固定（输出 50）。 */
    setPinned(tabId: string, pinned: boolean): ActionResult;
    /** 把标签移到组内另一位置或别的组（输出 49）；目标组已有同一标签时并掉，可能要问，问完之前 Promise 不结束。 */
    moveTab(tabId: string, place: TabPlace, options?: MoveOptions): Promise<ActionResult>;
    /** 把标签移到外缘（输出 49；docs/specs/ui/workbench-layout.md 输出 25、27）：单个标签的组整块移动，视图不重建。 */
    moveToNewGroup(tabId: string, target: LayoutEdgeTarget, options?: MoveOptions): ActionResult;
    focusGroup(groupId: string): void;
    /** 关闭标签；文档最后一个标签且需要结算时先问，问的结果出来之前 Promise 不结束。 */
    close(tabId: string): Promise<"closed" | "cancelled">;
    /** 批量关闭（输出 51）：标签所在组里除它以外的、它右侧的、不需要保存的标签；都跳过固定标签。 */
    closeOthers(tabId: string): Promise<BatchCloseResult>;
    closeToRight(tabId: string): Promise<BatchCloseResult>;
    closeSaved(tabId: string): Promise<BatchCloseResult>;
    answer(choice: CloseChoice): void;
    /** 拆分标签（缺省活动标签）所在的组，打开同一文档。 */
    split(direction: SplitDirection, tabId?: string): ActionResult;
    reopenWith(editor: string): ActionResult;
    /** 活动标签的文件能打开的预览编辑器；活动的是页面、预览视图或没有预览编辑器时为 null（输出 46）。 */
    previewEditor(): string | null;
    /** 打开活动标签的文件的预览：当前组，或 `side` 时活动组右侧的组（输出 46）。 */
    openPreview(side: boolean): OpenResult;
    /** 编辑器不在了的标签（输出 40）：按选择顺序重选，不再选这个编辑器。 */
    reopenWithDefault(): ActionResult;
    save(): Promise<ActionResult>;
    saveAll(): Promise<ActionResult>;
    revert(): Promise<ActionResult>;
    overwrite(): Promise<ActionResult>;
    resolve(groupId: string, choice: "adopt-current" | "keep-view"): void;
    /** 写不出的视图（输出 61）：定位到写不出的那一块。 */
    locate(groupId: string): void;
    /** 写不出的视图选了“采用当前正文”：丢弃这个视图的输入，控件按文档的正文重载。 */
    unblock(groupId: string): void;
    /** 焦点落到了编辑器区之外（用户去了资源管理器等）：撤销还在等控件就绪的焦点交接。 */
    focusLeft(): void;
    /** 控件交出（或撤回）句柄。 */
    registerTabHandle(tabId: string, editor: string, handle: EditorControlHandle | null): void;
    dismissNotice(): void;
    /** 在组顶部显示一行提示（例如地址参数指向的不是项目里的资源）。 */
    notify(text: DisplayText): void;
    /** 离开页面前：结算全部视图输入，有需要结算的文档时为真。 */
    needsLeaveConfirm(): boolean;
    dispose(): void;
}

export function createEditorArea(options: EditorAreaOptions): EditorArea {
    const catalog = options.editors ?? BUILTIN_CATALOG;
    const documents = createDocumentStore({files: options.files, workspaceKey: options.workspaceKey, generation: options.generation, report: options.report});
    const groups = createEditorGroups(options.panels, options.initial, (editor) => catalog.declaration(editor)?.cursor ?? null);
    /** 预览编辑器（`role: "preview"`）的标签不算这个文件“已经打开”的那一个（输出 1）。声明已不在的编辑器不算预览编辑器。 */
    const isPreview = (editor: string): boolean => catalog.declaration(editor)?.role === "preview";
    /**
     * 文件标签取文本引用还是字节引用（输出 41）：“不能在这里打开”的标签、按字节显示的编辑器取字节引用，不读正文；声明已
     * 不在的编辑器也不读，用户换成默认编辑器之后才读。
     */
    const readsText = (tab: FileTab): boolean => tab.editor !== BINARY_TAB_EDITOR && catalog.declaration(tab.editor)?.input === "text";
    /** 能编辑这份文档的标签：文本编辑器、不是预览视图（输出 4）。 */
    const editable = (tab: EditorTab): boolean => tab.kind === "file" && readsText(tab) && !isPreview(tab.editor);
    const references = new Map<string, DocumentReference>();
    /** 视图状态、控件留下的实例与句柄都按 `slotKey` 存：跟着标签走，换组不换。 */
    const slots = new Map<string, ViewStateSlot>();
    const controlSlots = new Map<string, ViewStateSlot>();
    const handles = shallowRef(new Map<string, EditorControlHandle>());
    const dialog = shallowRef<CloseDialog | null>(null);
    const notice = shallowRef<DisplayText | null>(null);
    const focused = shallowRef(false);
    let answerDialog: ((choice: CloseChoice) => void) | null = null;
    let nextToken = 0;
    let disposed = false;
    const stops: Array<() => void> = [];

    const slotKey = (tabId: string, editor: string): string => `${tabId}|${editor}`;

    /** 标签的文档引用：恢复出来的标签第一次成为活动标签时才打开文档。 */
    const referenceOf = (tab: FileTab): DocumentReference => {
        let reference = references.get(tab.id);
        if (reference === undefined) {
            reference = documents.acquire(tab.address, {text: readsText(tab)});
            references.set(tab.id, reference);
        }
        return reference;
    };

    /**
     * 放掉一个引用之前调用：同一地址还有恢复出来、还没读到的标签时，它们没有引用，先替它们拿上，正文才不会随这次释放丢掉
     * （“别处还有能编辑的标签”的判断按标签算，这里让引用与它一致）。
     */
    const adoptOrphans = (address: string): void => {
        for (const group of groups.groups.value) {
            for (const other of group.tabs) {
                if (other.kind === "file" && other.address === address && !references.has(other.id)) references.set(other.id, documents.acquire(other.address, {text: readsText(other)}));
            }
        }
    };

    const disposeSlot = (slot: ViewStateSlot | undefined): void => {
        try {
            slot?.dispose?.();
        } catch (error) {
            options.report(error);
        }
    };
    /** 换下一种编辑器：它的视图状态与实例不再用，换回来从头建。 */
    const dropEditorState = (tabId: string, editor: string): void => {
        // 绑定拿着这个槽：留着的话，渲染之前又换回来会接着用已释放的槽。
        if (bindings.get(tabId)?.binding.editor === editor) bindings.delete(tabId);
        const key = slotKey(tabId, editor);
        for (const store of [slots, controlSlots]) {
            const slot = store.get(key);
            store.delete(key);
            disposeSlot(slot);
        }
    };
    /** 标签不在了：放掉它的绑定、视图状态与实例。 */
    const dropTabState = (tabId: string): void => {
        bindings.delete(tabId);
        const prefix = slotKey(tabId, "");
        for (const store of [slots, controlSlots]) {
            for (const [key, slot] of [...store]) {
                if (!key.startsWith(prefix)) continue;
                store.delete(key);
                disposeSlot(slot);
            }
        }
    };

    /** 标签已从组模型移除之后调用：释放它的状态与文档引用。 */
    const releaseTab = (tab: EditorTab): void => {
        dropTabState(tab.id);
        const reference = references.get(tab.id);
        if (reference === undefined || tab.kind === "page") return;
        references.delete(tab.id);
        adoptOrphans(tab.address);
        reference.release();
    };

    /** 标签交给控件的绑定与它背后的文档（文档只在编辑器区里用，不交给控件）。 */
    interface Bound {
        readonly binding: EditorBinding;
        readonly document: TextDocument;
    }
    const bindings = new Map<string, Bound>();
    /** 组件的计算值会反复调它：建好之后原样返回，重复调用没有别的效果。 */
    const tabBinding = (tabId: string): EditorBinding | null => {
        const tab = groups.find(tabId)?.tab;
        // 页面标签与“不能在这里打开”的标签没有控件，也就没有绑定。
        if (tab === undefined || tab.kind === "page" || tab.editor === BINARY_TAB_EDITOR) return null;
        const document = referenceOf(tab).document;
        const status = document.status.value;
        if (status !== "ready" && status !== "deleted") return null;
        const existing = bindings.get(tabId);
        // 标签对象随光标、语言变化换新：同一编辑器、同一文档仍是同一个绑定。
        if (existing !== undefined && existing.binding.editor === tab.editor && existing.document === document) return existing.binding;
        const key = slotKey(tabId, tab.editor);
        let slot = slots.get(key);
        if (slot === undefined) {
            slot = {state: null, dispose: null};
            slots.set(key, slot);
        }
        nextToken += 1;
        const token = `v${String(nextToken)}`;
        // 换下的绑定（关闭标签、换编辑器）不再改变任何文档：换下之前，这两条路径已经结算过它的输入（`closeOne`、`leave`），
        // 之后迟到的回调一律当作过时。
        const address = computed(() => groups.find(tabId)?.tab.address ?? tab.address);
        if (!readsText(tab)) {
            const bytes: BytesEditorBinding = {kind: "bytes", token, tabId, editor: tab.editor, address, url: computed(() => options.files.rawUrl(address.value)), version: document.version, slot};
            bindings.set(tabId, {binding: bytes, document});
            return bytes;
        }
        const current = (): boolean => bindings.get(tabId)?.binding === created;
        const created: TextEditorBinding = {
            kind: "text",
            token,
            tabId,
            editor: tab.editor,
            address,
            text: document.text,
            revision: document.revision,
            slot,
            commit: (baseRevision, text) => {
                if (!current()) return {status: "stale"};
                const result = documents.commit(document, token, baseRevision, text);
                // 在 preview 标签里编辑即转正（输出 1）：只看真正改了正文的输入。
                if (result.status === "accepted" && result.revision > baseRevision && groups.find(tabId)?.tab.preview === true) groups.keep(tabId);
                return result;
            },
            attach: (flush) => (current() ? documents.attachView(document, flush) : () => undefined),
            unresolved: () => document.unresolved.value.includes(token),
            block: (input) => {
                if (current()) documents.block(document, token, input);
            },
            blocked: () => document.blocked.value.has(token),
            cursor: tab.cursor ?? null,
            remember: (cursor) => groups.setCursor(tabId, cursor),
            language: computed(() => {
                const found = groups.find(tabId)?.tab;
                return found === undefined || found.kind === "page" ? null : found.language ?? null;
            }),
        };
        bindings.set(tabId, {binding: created, document});
        return created;
    };
    const activeTabIdOf = (groupId: string): string | null => groups.groups.value.find((candidate) => candidate.id === groupId)?.active ?? null;
    const binding = (groupId: string): EditorBinding | null => {
        const tabId = activeTabIdOf(groupId);
        return tabId === null ? null : tabBinding(tabId);
    };
    /** 组的活动标签的绑定，已经建好的才算：这里只问它有没有要结算的输入，不为此打开文档。 */
    const activeBound = (groupId: string): Bound | undefined => bindings.get(activeTabIdOf(groupId) ?? "");

    /**
     * 留着控件的标签，最近用的在前。掉出去的不再回来，除非又活动一次：名额空出来也不回填，没有人在看它，不在后台重建编辑器。
     * 活动标签排在最前、不受上限：组比上限还多时用户也正看着它们。
     */
    const keptTabs = shallowRef<ReadonlyArray<string>>([]);
    const controlLimit = options.mountedControlsPerEditor ?? MOUNTED_CONTROLS_PER_EDITOR;
    stops.push(watch(() => groups.groups.value, () => {
        const list = groups.groups.value;
        const tabs = new Map(list.flatMap((group) => group.tabs.map((tab) => [tab.id, tab] as const)));
        const active = list.flatMap((group) => (group.active === null ? [] : [group.active]));
        const counts = new Map<string, number>();
        const next = [...active, ...keptTabs.value.filter((id) => !active.includes(id))].filter((id) => {
            const tab = tabs.get(id);
            if (tab === undefined || tab.kind === "page" || tab.editor === BINARY_TAB_EDITOR) return false;
            const count = (counts.get(tab.editor) ?? 0) + 1;
            counts.set(tab.editor, count);
            return count <= controlLimit || active.includes(id);
        });
        if (next.length !== keptTabs.value.length || next.some((id, index) => id !== keptTabs.value[index])) keptTabs.value = next;
    }, {immediate: true}));
    const mountedControls = computed((): ReadonlySet<string> => new Set([...keptTabs.value, ...groups.groups.value.flatMap((group) => (group.active === null ? [] : [group.active]))]));

    const activeFileTab = (groupId: string): FileTab | null => {
        const group = groups.groups.value.find((candidate) => candidate.id === groupId);
        const tab = group?.tabs.find((candidate) => candidate.id === group.active);
        return tab === undefined || tab.kind === "page" ? null : tab;
    };
    const documentOf = (groupId: string): TextDocument | null => {
        const tab = activeFileTab(groupId);
        return tab === null || !readsText(tab) ? null : referenceOf(tab).document;
    };
    const fileOf = (groupId: string): TextDocument | null => {
        const tab = activeFileTab(groupId);
        return tab === null ? null : referenceOf(tab).document;
    };

    // 进度条：活动文档还在读取时计时，800 ms 后仍在读取才显示；换标签或读完时撤掉。
    const progress = shallowRef(new Set<string>());
    const timers = new Map<string, {readonly document: TextDocument; readonly cancel: () => void}>();
    const setProgress = (groupId: string, shown: boolean): void => {
        if (progress.value.has(groupId) === shown) return;
        const next = new Set(progress.value);
        if (shown) next.add(groupId);
        else next.delete(groupId);
        progress.value = next;
    };
    type GroupLoad = readonly [string, TextDocument | null, string | undefined];
    stops.push(watch((): GroupLoad[] => groups.groups.value.map((group): GroupLoad => {
        const document = documentOf(group.id);
        return [group.id, document, document?.status.value];
    }), (entries: GroupLoad[]) => {
        const live = new Set(entries.map(([id]) => id));
        for (const [id, timer] of [...timers]) {
            const entry = entries.find(([candidate]) => candidate === id);
            if (!live.has(id) || entry?.[1] !== timer.document || entry[2] !== "loading") {
                timer.cancel();
                timers.delete(id);
                setProgress(id, false);
            }
        }
        for (const [id, document, status] of entries) {
            if (document === null || status !== "loading" || timers.has(id)) continue;
            timers.set(id, {document, cancel: options.clock.schedule(() => setProgress(id, true), PROGRESS_DELAY_MS)});
        }
        for (const id of progress.value) if (!live.has(id)) setProgress(id, false);
    }, {immediate: true}));

    // 文档模型改了地址或关闭了文档：标签随之改地址或关闭。
    stops.push(documents.subscribe((event) => {
        if (event.kind === "rebound") {
            groups.rebind(event.from, event.to, event.kept);
            return;
        }
        for (const group of groups.groups.value) {
            for (const tab of group.tabs) {
                if (tab.kind === "page" || !event.addresses.includes(tab.address)) continue;
                references.delete(tab.id);
            }
        }
        for (const tab of groups.closeWithin(event.addresses)) dropTabState(tab.id);
    }));

    if (options.persist !== undefined) {
        const persist = options.persist;
        stops.push(watch(() => groups.attributes.value, () => persist(groups.snapshot())));
    }

    const activeDocument = computed(() => documentOf(groups.activeGroup.value));
    // 文档在标签打开时同步取得（`acquire`），所以跟着组与标签的变化重算就够了。
    const openDocuments = computed(() => {
        const open = new Set<TextDocument>();
        for (const group of groups.groups.value) {
            for (const tab of group.tabs) {
                if (tab.kind === "page" || !readsText(tab)) continue;
                const document = documents.get(tab.address);
                if (document !== null) open.add(document);
            }
        }
        return [...open];
    });
    const handleOf = (groupId: string): EditorControlHandle | null => {
        const group = groups.groups.value.find((candidate) => candidate.id === groupId);
        const tab = group?.tabs.find((candidate) => candidate.id === group.active);
        return tab === undefined || tab.kind === "page" ? null : handles.value.get(slotKey(tab.id, tab.editor)) ?? null;
    };
    const activeHandle = computed(() => handleOf(groups.activeGroup.value));
    const breadcrumbFocus = shallowRef<{readonly group: string; readonly seq: number} | null>(null);

    /**
     * 继续写作的定位（输出 29）：打开时记下标签与组，等它的文档就绪、它的控件交出句柄再定位；在此之前用户切到别的
     * 标签或组、标签关闭、焦点移出编辑器区（`focusLeft`）都取消，读取失败在组顶部提示。定位本身推到下一个时钟刻：文档就绪时
     * 控件要在它自己的 watch 里先装上正文，内容项也可能还停放着（`inert`，`focus()` 静默失败），都要等这一轮渲染；到了那一刻再
     * 核对一次标签与句柄仍是活动的。
     * 恢复会话（输出 30）与把焦点交给活动视图（`focusActive`）走同一条路，只聚焦：光标由控件按标签记下的位置放好；读取失败时
     * 内容区自己说明，不另提示。
     */
    const pendingReveal = shallowRef<{readonly tabId: string; readonly address: string; readonly reveal: "end" | "cursor"} | null>(null);
    const focusActive = (): void => {
        const tab = groups.activeTab();
        // 这个标签已经在等定位（继续写作）：定位时会聚焦，不把它降成只聚焦。
        if (tab === null || pendingReveal.value?.tabId !== tab.id) pendingReveal.value = tab === null ? null : {tabId: tab.id, address: tab.address, reveal: "cursor"};
    };
    /** 焦点移出编辑器区的次数：已经排进时钟的定位据此知道用户在这期间离开过（清空 `pendingReveal` 撤不回它）。 */
    let leaves = 0;
    type RevealState =
        | {readonly outcome: "cancelled"}
        | {readonly outcome: "failed"; readonly address: string; readonly reveal: "end" | "cursor"}
        | {readonly outcome: "ready"; readonly tabId: string; readonly handle: EditorControlHandle; readonly reveal: "end" | "cursor"};
    stops.push(watch((): RevealState | null => {
        const pending = pendingReveal.value;
        if (pending === null) return null;
        // 按标签找组，不记组：等待期间标签可能换了组（移动之后焦点也该在那边）。
        const found = groups.find(pending.tabId);
        if (found === null || found.tab.kind === "page" || found.group.active !== found.tab.id || groups.activeGroup.value !== found.group.id) return {outcome: "cancelled"};
        const {tab} = found;
        const status = referenceOf(tab).document.status.value;
        if (status === "failed") return {outcome: "failed", address: pending.address, reveal: pending.reveal};
        if (status !== "ready" && status !== "deleted") return null;
        const handle = handles.value.get(slotKey(tab.id, tab.editor));
        return handle === undefined ? null : {outcome: "ready", tabId: tab.id, handle, reveal: pending.reveal};
    }, (state) => {
        if (state === null) return;
        pendingReveal.value = null;
        if (state.outcome === "failed" && state.reveal === "end") notice.value = editorText("notice.lastEditMissing", {address: state.address});
        if (state.outcome !== "ready") return;
        const leavesAtReady = leaves;
        options.clock.schedule(() => {
            if (disposed || leaves !== leavesAtReady) return;
            // 就绪与这一刻之间用户可能已切走：标签仍是它所在组与活动组的活动标签、句柄仍是活动视图的，才定位。
            const found = groups.find(state.tabId);
            if (found === null || found.group.active !== state.tabId || groups.activeGroup.value !== found.group.id || activeHandle.value !== state.handle) return;
            if (state.reveal === "end") state.handle.revealEnd?.();
            state.handle.focus();
        }, 0);
    }));

    // 恢复出来的会话：活动组的活动标签就绪后聚焦，光标在它记下的位置（输出 30）。
    const restoredTab = options.initial === null ? null : groups.activeTab();
    if (restoredTab !== null) pendingReveal.value = {tabId: restoredTab.id, address: restoredTab.address, reveal: "cursor"};

    /** 组的活动视图为什么不能换下（输出 9、49、61）：有未裁决输入、写不出；能换下为 null。 */
    const holding = (groupId: string): "unresolved" | "unrepresentable" | null => {
        const current = activeBound(groupId);
        if (current === undefined) return null;
        if (current.document.unresolved.value.includes(current.binding.token)) return "unresolved";
        if (current.document.blocked.value.has(current.binding.token)) return "unrepresentable";
        return null;
    };
    /** `leave` 不让换时给调用方的理由：`who` 是不让换的那一组相对这次动作的位置。 */
    const refusal = (groupId: string, who: "current" | "target"): DisplayText => {
        const unrepresentable = holding(groupId) === "unrepresentable";
        if (who === "current") return editorText(unrepresentable ? "refusal.currentUnrepresentable" : "refusal.currentUnresolved");
        return editorText(unrepresentable ? "refusal.targetUnrepresentable" : "refusal.targetUnresolved");
    };

    /** 换文档前结算活动视图的输入；它有未裁决输入或写不出时不换。 */
    const leave = (groupId: string): boolean => {
        const current = activeBound(groupId);
        if (current === undefined) return true;
        documents.settle(current.document);
        const held = holding(groupId);
        if (held === "unresolved") notice.value = editorText("notice.unresolved");
        if (held === "unrepresentable") notice.value = editorText("notice.unrepresentable");
        return held === null;
    };

    const needsSettle = (document: TextDocument): boolean => document.dirty.value || document.unresolved.value.length > 0 || document.blocked.value.size > 0 || document.saving.value;

    /**
     * 换编辑器（输出 39）：文本与字节之间换了，标签的引用随之换一份（先取新的再放旧的，条目不会因此被丢掉）。从文本换到
     * 字节、而这是这份文档最后一个能编辑的标签、它又需要结算时拒绝：放掉最后一个文本引用会丢掉没保存的正文。
     */
    const changeEditor = (tab: FileTab, editor: string): ActionResult => {
        // 释放之后组模型还在：不再为它取新的文件引用（会开出没人释放的订阅）。
        if (disposed) return {ok: false, reason: editorText("refusal.disposed")};
        const before = readsText(tab);
        const after = editor !== BINARY_TAB_EDITOR && catalog.declaration(editor)?.input === "text";
        const reference = references.get(tab.id);
        if (before && !after && reference !== undefined) {
            documents.settle(reference.document);
            const others = groups.groups.value.some((group) => group.tabs.some((other) => other.id !== tab.id && other.address === tab.address && editable(other)));
            if (!others && needsSettle(reference.document)) return {ok: false, reason: editorText("refusal.unsavedBeforeBytes")};
        }
        const closed = groups.setEditor(tab.id, editor);
        if (closed !== null) {
            releaseTab(closed);
            return {ok: true};
        }
        if (tab.editor !== editor) dropEditorState(tab.id, tab.editor);
        if (before !== after && reference !== undefined) {
            references.delete(tab.id);
            const changed = groups.find(tab.id)?.tab;
            if (changed !== undefined && changed.kind === "file") referenceOf(changed);
            adoptOrphans(tab.address);
            reference.release();
        }
        return {ok: true};
    };

    const ask = (address: string, saveable: boolean): Promise<CloseChoice> => new Promise<CloseChoice>((resolve) => {
        answerDialog?.("cancel");
        dialog.value = {address, saveable};
        answerDialog = resolve;
    });

    /**
     * 关闭一个标签（输出 3、4、13、14）。同一文件还有别的标签（包括恢复出来、还没读到的）时文档留给它们，只问这个视图
     * 自己的未裁决输入；否则文档需要结算时问。选“保存”后保存期间还能输入：保存完回到开头再结算、再看要不要问，直到没有
     * 要结算的东西或用户取消。
     */
    const closeOne = async (tabId: string): Promise<"closed" | "cancelled" | "failed" | "gone"> => {
        const hadFocus = focused.value;
        /** 选了“不保存”、又没有别的能编辑的标签时要还原的文档。 */
        let discarded: TextDocument | null = null;
        for (;;) {
            const found = groups.find(tabId);
            if (found === null) return "gone";
            const document = references.get(tabId)?.document ?? null;
            if (document === null) break;
            documents.settle(document);
            const shown = bindings.get(tabId)?.binding;
            const own = shown?.kind === "text" ? shown : null;
            const ownInput = own !== null && (own.unresolved() || own.blocked());
            // 只剩预览视图或只读的编辑器时照常问：它们改不了正文（输出 4）。
            const shared = groups.groups.value.some((group) => group.tabs.some((tab) => tab.id !== tabId && tab.address === found.tab.address && editable(tab)));
            if (shared ? !ownInput : !needsSettle(document)) break;
            // 这个视图写不出时没有“保存”（输出 61）：它的输入交不出去，保存只会保存别的视图的正文。
            const choice = await ask(found.tab.address, own === null || !own.blocked());
            if (choice === "cancel") return "cancelled";
            // 等用户回答期间别处可能新开、关掉或换掉了另一个能编辑的标签，这个标签也可能换了组或编辑器：回答按此刻的状态
            // 执行。“保存”在任何状态下都照做；“不保存”丢弃的范围取决于还有没有别的能编辑的标签，状态变了就重新问，不按
            // 询问前的判断丢掉修改。
            const now = groups.find(tabId);
            if (now === null) return "gone";
            if (references.get(tabId)?.document !== document) continue;
            const nowShown = bindings.get(tabId)?.binding;
            const nowOwn = nowShown?.kind === "text" ? nowShown : null;
            if (choice === "discard") {
                const nowShared = groups.groups.value.some((group) => group.tabs.some((tab) => tab.id !== tabId && tab.address === now.tab.address && editable(tab)));
                if (nowShared !== shared || nowOwn?.token !== own?.token) continue;
                // 文档还有别的能编辑的标签时只丢这个视图的未裁决输入。没有时整份修改都不要了：只剩这个标签的引用，释放时
                // 整份文档连同输入一起丢弃；预览视图这类只读标签还持有正文时释放丢不掉，关闭后按磁盘还原。
                if (own !== null) documents.discardInput(document, own.token);
                if (!shared) discarded = document;
                break;
            }
            // 保存这个视图看到的内容：它的未裁决输入先成为正文。
            if (nowOwn !== null && nowOwn.unresolved()) documents.resolve(document, nowOwn.token, "keep-view");
            const saved = await documents.save(document);
            if (!saved.ok) return "failed";
        }
        const current = groups.find(tabId);
        if (current === null) return "closed";
        groups.close(tabId);
        releaseTab(current.tab);
        if (discarded !== null && documents.get(current.tab.address) === discarded) await documents.revert(discarded);
        // 开始关闭时焦点在编辑器区：交给关闭后的活动视图，键盘用户不至于落到页面根（输出 3）。不看此刻的 `focused`：
        // 被关的标签按钮、询问对话框都会先把它置假。
        if (hadFocus) focusActive();
        return "closed";
    };
    const closeTab = async (tabId: string): Promise<"closed" | "cancelled"> => ((await closeOne(tabId)) === "closed" ? "closed" : "cancelled");

    /**
     * 批量关闭（输出 51）：开始时定下要关的标签，逐个按 `closeOne` 关；用户取消或保存失败就停，已关的不恢复。同一时刻只有
     * 一批：两批交错时询问对话框会互相顶掉，结果说不清是谁取消的。
     */
    let batchRunning = false;
    const unpinned = (tab: EditorTab): boolean => !(tab.kind === "file" && tab.pinned === true);
    const closeBatch = async (tabId: string, pick: (group: {readonly id: string; readonly tabs: ReadonlyArray<EditorTab>}, index: number) => ReadonlyArray<EditorTab>, eligible: (tab: EditorTab) => boolean = unpinned): Promise<BatchCloseResult> => {
        if (batchRunning) return {ok: false, closed: 0, reason: editorText("refusal.batchRunning")};
        const found = groups.find(tabId);
        if (found === null) return {ok: false, closed: 0, reason: editorText("refusal.tabClosed")};
        const groupId = found.group.id;
        const targets = pick(found.group, found.group.tabs.findIndex((tab) => tab.id === tabId)).filter(eligible).map((tab) => tab.id);
        batchRunning = true;
        let closed = 0;
        try {
            for (const id of targets) {
                const where = groups.find(id);
                // 定下之后可能被移走、固定或又有了修改：按此刻的状态再看一次，不合格的跳过、不停下。
                if (where === null || where.group.id !== groupId || !eligible(where.tab)) continue;
                const outcome = await closeOne(id);
                if (outcome === "closed") closed += 1;
                else if (outcome === "cancelled") return {ok: false, closed, reason: editorText("refusal.batchCancelled", {count: closed, address: where.tab.address})};
                else if (outcome === "failed") return {ok: false, closed, reason: editorText("refusal.batchSaveFailed", {count: closed, address: where.tab.address})};
            }
            return {ok: true, closed};
        } finally {
            batchRunning = false;
        }
    };
    /** 不需要保存的标签：页面、按字节的、还没读到的都算；有文档的先结算视图输入再看（输出 51）。 */
    const saved = (tab: EditorTab): boolean => {
        if (tab.kind === "page" || !readsText(tab)) return true;
        // 恢复出来、还没读到的标签没有自己的引用，但同一地址的文档可能已在别的组打开并改过：按地址找。
        const document = references.get(tab.id)?.document ?? documents.get(tab.address);
        if (document === null) return true;
        documents.settle(document);
        return !needsSettle(document) && document.conflict.value === null;
    };

    /**
     * 移动标签（输出 49）。绑定、视图状态与控件都跟着标签走，移动只改结构：先结算活动标签会变的组，有未裁决输入就不动。
     */
    const moveTab = async (tabId: string, place: TabPlace, moveOptions: MoveOptions = {}): Promise<ActionResult> => {
        const focusAfterMove = (): void => {
            if (moveOptions.focusView !== false) focusActive();
        };
        if (disposed) return {ok: false, reason: editorText("refusal.disposed")};
        const found = groups.find(tabId);
        if (found === null) return {ok: false, reason: editorText("refusal.tabClosed")};
        const target = groups.groups.value.find((group) => group.id === place.group);
        if (target === undefined) return {ok: false, reason: editorText("refusal.groupClosed")};
        const moving = found.tab;
        const twin = target.id === found.group.id || moving.kind !== "file" ? undefined : target.tabs.find((tab) => tab.kind === "file" && tab.address === moving.address && tab.editor === moving.editor);
        if (twin !== undefined) {
            // 目标组已有同一标签：激活它，再按关闭的规则关掉被移动的这个（只问它自己的未裁决输入）。
            if (target.active !== twin.id && !leave(target.id)) return {ok: false, reason: refusal(target.id, "target")};
            groups.activate(twin.id);
            const outcome = await closeOne(tabId);
            if (outcome !== "closed" && outcome !== "gone") return {ok: false, reason: editorText(outcome === "failed" ? "refusal.saveFailed" : "refusal.cancelled")};
            // 关掉之后再把留下的那个放到落点（位置与固定区）；它已经在那里时不动。
            if (groups.find(twin.id)?.group.id === target.id) groups.moveTab(twin.id, place);
            focusAfterMove();
            return {ok: true};
        }
        if (found.group.active === tabId && target.id !== found.group.id && !leave(found.group.id)) return {ok: false, reason: refusal(found.group.id, "current")};
        if (target.active !== tabId && !leave(target.id)) return {ok: false, reason: refusal(target.id, "target")};
        const moved = groups.moveTab(tabId, place);
        if (moved === null) return {ok: false, reason: editorText("refusal.samePlace")};
        focusAfterMove();
        return {ok: true};
    };

    /**
     * preview 打开会换掉本组的 preview 标签。它是文档最后一个能编辑的标签、文档又要结算时（例如别处的正式标签改过之后
     * 关掉，关的时候因为还有它而没问），先把它转正，不让替换静默丢掉修改（输出 4）。
     */
    const keepUnsettledPreview = (groupId: string, address: string): void => {
        const preview = groups.groups.value.find((group) => group.id === groupId)?.tabs.find((tab) => tab.preview);
        if (preview === undefined || preview.kind !== "file" || preview.address === address) return;
        const document = documents.get(preview.address);
        if (document === null || !needsSettle(document)) return;
        const others = groups.groups.value.some((group) => group.tabs.some((tab) => tab.id !== preview.id && tab.address === preview.address && editable(tab)));
        if (!others) groups.keep(preview.id);
    };

    const previewEnabled = (): boolean => options.enablePreview?.() ?? true;
    // 关掉“预览标签页”时现有的 preview 标签都转正（输出 52），恢复出来的会话同样。
    stops.push(watch(() => previewEnabled() ? [] : groups.groups.value.flatMap((group) => group.tabs.filter((tab) => tab.preview).map((tab) => tab.id)), (ids) => {
        for (const id of ids) groups.keep(id);
    }, {immediate: true}));

    const open: EditorArea["open"] = (address, given) => {
        if (disposed) return {ok: false, reason: editorText("refusal.disposed")};
        const request = given.mode === "preview" && !previewEnabled() ? {...given, mode: "permanent" as const} : given;
        if (pageIdOf(address) !== null) return {ok: false, reason: editorText("refusal.pageAddress")};
        if (request.group !== undefined && request.group !== "side" && !groups.groups.value.some((candidate) => candidate.id === request.group)) return {ok: false, reason: editorText("refusal.groupClosed")};
        // 只结算活动标签要换掉的那一组（同 `activate`）：目标组；侧边还没有组时要新建，没有要结算的。
        const target = request.group === "side" ? groups.rightOf(groups.activeGroup.value) : (request.group ?? groups.activeGroup.value);
        if (target !== null && !leave(target)) return {ok: false, reason: refusal(target, target === groups.activeGroup.value ? "current" : "target")};
        if (request.editor !== undefined) {
            const refusal = editorRefusal(catalog, request.editor, address);
            if (refusal !== null) return {ok: false, reason: refusal};
        }
        // 不指定编辑器：本组有这个文件、不是预览视图的标签就激活它，不管它用哪种编辑器（输出 1）；没有才按顺序选。
        const resolved = request.editor ?? (() => {
            const resolution = resolveEditor(catalog, address, (ids) => options.conflict?.(address, ids));
            return resolution.kind === "binary" ? BINARY_TAB_EDITOR : resolution.editor;
        })();
        const reuse = request.editor === undefined ? (tab: FileTab) => !isPreview(tab.editor) : undefined;
        const group = target ?? groups.sideGroup();
        if (request.mode === "preview") keepUnsettledPreview(group, address);
        // 文档在标签成为活动标签、第一次被读到时打开（`referenceOf`）：新开的标签就是活动标签。
        const {tab, replaced} = groups.open(address, {mode: request.mode, editor: resolved, group, ...(reuse === undefined ? {} : {reuse})});
        if (replaced !== null) releaseTab(replaced);
        pendingReveal.value = request.reveal === undefined ? null : {tabId: tab.id, address, reveal: request.reveal};
        options.opened?.(address);
        return {ok: true, tabId: tab.id};
    };

    const previewEditor = (): string | null => {
        const tab = groups.activeTab();
        if (tab === null || tab.kind === "page" || isPreview(tab.editor)) return null;
        return previewEditorFor(catalog, tab.address);
    };

    return {
        documents,
        groups,
        editors: catalog,
        previewEditor,
        openPreview: (side) => {
            const tab = groups.activeTab();
            const editor = previewEditor();
            if (tab === null || editor === null) return {ok: false, reason: editorText("refusal.noPreview")};
            // 经普通的打开：本组（或右侧的组）已有它的预览视图时激活它。
            return open(tab.address, {mode: "permanent", editor, ...(side ? {group: "side"} : {})});
        },
        binding,
        tabBinding,
        documentOf,
        fileOf,
        viewWritable: (groupId) => {
            const tab = activeFileTab(groupId);
            return tab !== null && editable(tab) && documentOf(groupId)?.writable.value === true;
        },
        tabWritable: (tabId) => {
            const tab = groups.find(tabId)?.tab;
            return tab !== undefined && tab.kind === "file" && editable(tab) && referenceOf(tab).document.writable.value;
        },
        tabControlSlot: (tabId, editor) => {
            const key = slotKey(tabId, editor);
            let slot = controlSlots.get(key);
            if (slot === undefined) {
                slot = {state: null, dispose: null};
                controlSlots.set(key, slot);
            }
            return slot;
        },
        mountedControls,
        progress: (groupId) => progress.value.has(groupId),
        activeDocument,
        openDocuments,
        activeHandle,
        handleOf,
        list: (address, signal) => options.files.list(address, signal === undefined ? {} : {signal}),
        breadcrumbFocus,
        focusBreadcrumbs: () => {
            const tab = groups.activeTab();
            if (tab === null || tab.kind === "page") return {ok: false, reason: editorText("refusal.notFileTab")};
            breadcrumbFocus.value = {group: groups.activeGroup.value, seq: (breadcrumbFocus.value?.seq ?? 0) + 1};
            return {ok: true};
        },
        focused,
        dialog,
        notice,
        open,
        openPage: (id) => {
            if (disposed) return {ok: false, reason: editorText("refusal.disposed")};
            const address = pageAddress(id);
            const existing = groups.groups.value.flatMap((group) => group.tabs).find((tab) => tab.address === address);
            if (existing !== undefined) {
                const found = groups.find(existing.id);
                if (found !== null && found.group.active !== existing.id && !leave(found.group.id)) return {ok: false, reason: refusal(found.group.id, "current")};
                groups.activate(existing.id);
                return {ok: true, tabId: existing.id};
            }
            if (!leave(groups.activeGroup.value)) return {ok: false, reason: refusal(groups.activeGroup.value, "current")};
            pendingReveal.value = null;
            const tab = groups.openPage(address);
            return {ok: true, tabId: tab.id};
        },
        activate: (tabId) => {
            const found = groups.find(tabId);
            if (found === null) return {ok: false, reason: editorText("refusal.tabClosed")};
            if (found.group.active !== tabId && !leave(found.group.id)) return {ok: false, reason: refusal(found.group.id, "current")};
            groups.activate(tabId);
            return {ok: true};
        },
        keep: (tabId) => groups.keep(tabId),
        setPinned: (tabId, pinned) => {
            const found = groups.find(tabId);
            if (found === null) return {ok: false, reason: editorText("refusal.tabClosed")};
            if (found.tab.kind === "page") return {ok: false, reason: editorText("refusal.pagePin")};
            groups.setPinned(tabId, pinned);
            return {ok: true};
        },
        moveTab,
        moveToNewGroup: (tabId, target, moveOptions = {}) => {
            if (disposed) return {ok: false, reason: editorText("refusal.disposed")};
            const found = groups.find(tabId);
            if (found === null) return {ok: false, reason: editorText("refusal.tabClosed")};
            // 单个标签的组是同一块面板移动，活动标签不变，没有要结算的；只有拆出新组时源组的活动标签才换。
            if (found.group.tabs.length > 1 && found.group.active === tabId && !leave(found.group.id)) return {ok: false, reason: refusal(found.group.id, "current")};
            const moved = groups.moveToNewGroup(tabId, target);
            if (moved === null) return {ok: false, reason: editorText("refusal.cannotSplit")};
            if (moveOptions.focusView !== false) focusActive();
            return {ok: true};
        },
        focusGroup: (groupId) => groups.focusGroup(groupId),
        close: closeTab,
        closeOthers: (tabId) => closeBatch(tabId, (group) => group.tabs.filter((tab) => tab.id !== tabId)),
        closeToRight: (tabId) => closeBatch(tabId, (group, index) => group.tabs.slice(index + 1)),
        closeSaved: (tabId) => closeBatch(tabId, (group) => group.tabs, (tab) => unpinned(tab) && saved(tab)),
        answer: (choice) => {
            const resolve = answerDialog;
            answerDialog = null;
            dialog.value = null;
            resolve?.(choice);
        },
        split: (direction, tabId) => {
            const active = groups.activeTab();
            const tab = tabId === undefined ? active : groups.find(tabId)?.tab ?? null;
            if (tab === null) return {ok: false, reason: editorText(tabId === undefined ? "refusal.noActiveTab" : "refusal.tabClosed")};
            if (tab.kind === "page") return {ok: false, reason: editorText("refusal.pageSplit")};
            const hadFocus = focused.value;
            // 控件在光标停下 1 秒或失焦时才交出光标：先让它交出这一刻的，拆出的标签才带着它。
            if (tab === active) activeHandle.value?.rememberCursor?.();
            const created = groups.split(tab.id, direction);
            if (created === null) return {ok: false, reason: editorText("refusal.cannotSplit")};
            // 焦点在编辑器区时交给新组（新组是活动组）。
            if (hadFocus) focusActive();
            return {ok: true};
        },
        reopenWith: (editor) => {
            const group = groups.activeGroup.value;
            const tab = groups.activeTab();
            if (tab === null) return {ok: false, reason: editorText("refusal.noActiveTab")};
            if (tab.kind === "page") return {ok: false, reason: editorText("refusal.pageEditor")};
            const unusable = editorRefusal(catalog, editor, tab.address);
            if (unusable !== null) return {ok: false, reason: unusable};
            if (!leave(group)) return {ok: false, reason: refusal(group, "current")};
            // 换成的编辑器在本组已有这个文件的标签：切过去，当前这个关掉并释放。
            return changeEditor(tab, editor);
        },
        reopenWithDefault: () => {
            const tab = groups.activeTab();
            if (tab === null || tab.kind === "page") return {ok: false, reason: editorText("refusal.noActiveFileTab")};
            const resolution = resolveEditor(catalog, tab.address);
            const editor = resolution.kind === "binary" ? BINARY_TAB_EDITOR : resolution.editor === tab.editor ? CODE_EDITOR : resolution.editor;
            return changeEditor(tab, editor);
        },
        save: async () => {
            const document = activeDocument.value;
            if (document === null) return {ok: false, reason: editorText("refusal.noActiveDocument")};
            const result = await documents.save(document);
            if (result.ok) return {ok: true};
            // 写不出（输出 61）：保存不发出写入，说明原因。
            return {ok: false, reason: result.code === "unrepresentable" ? editorText("refusal.saveUnrepresentable") : result.code};
        },
        saveAll: async () => {
            const results = await documents.coordinator.save(["project://", "user://"]);
            const failed = results.filter((result) => !result.ok);
            return failed.length === 0 ? {ok: true} : {ok: false, reason: failed.map((result) => `${result.address}：${result.code ?? ""}`).join("；")};
        },
        revert: async () => {
            const document = activeDocument.value;
            if (document === null) return {ok: false, reason: editorText("refusal.noActiveDocument")};
            await documents.revert(document);
            return {ok: true};
        },
        overwrite: async () => {
            const document = activeDocument.value;
            if (document === null) return {ok: false, reason: editorText("refusal.noActiveDocument")};
            const result = await documents.overwrite(document);
            return result.ok ? {ok: true} : {ok: false, reason: result.code};
        },
        resolve: (groupId, choice) => {
            const current = activeBound(groupId);
            if (current === undefined) return;
            documents.resolve(current.document, current.binding.token, choice);
            if (notice.value !== null) notice.value = null;
        },
        locate: (groupId) => {
            const current = activeBound(groupId);
            const input = current?.document.blocked.value.get(current.binding.token);
            if (input !== undefined) handleOf(groupId)?.revealRange?.(input.from, input.to);
        },
        unblock: (groupId) => {
            const current = activeBound(groupId);
            if (current === undefined) return;
            documents.unblock(current.document, current.binding.token);
            if (notice.value !== null) notice.value = null;
        },
        focusLeft: () => {
            leaves += 1;
            focused.value = false;
            // 用户已去了别处：继续写作迟到的就绪不把焦点抢回来。
            pendingReveal.value = null;
        },
        registerTabHandle: (tabId, editor, handle) => {
            const key = slotKey(tabId, editor);
            const next = new Map(handles.value);
            if (handle === null) next.delete(key);
            else next.set(key, handle);
            handles.value = next;
        },
        dismissNotice: () => {
            notice.value = null;
        },
        notify: (text) => {
            notice.value = text;
        },
        needsLeaveConfirm: () => {
            let needed = false;
            for (const reference of new Set(references.values())) {
                documents.settle(reference.document);
                if (needsSettle(reference.document) || reference.document.conflict.value !== null) needed = true;
            }
            return needed;
        },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            answerDialog?.("cancel");
            for (const stop of stops.splice(0)) stop();
            for (const timer of timers.values()) timer.cancel();
            for (const slot of [...slots.values(), ...controlSlots.values()]) disposeSlot(slot);
            slots.clear();
            controlSlots.clear();
            documents.dispose();
        },
    };
}
