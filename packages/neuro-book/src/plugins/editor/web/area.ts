/**
 * 一个窗口的编辑器区（docs/specs/workbench/editor.md）：组与标签模型、文档模型、每组的视图绑定与视图状态、加载进度、
 * 关闭询问与会话记录。组件只渲染这里的状态、把用户动作交回来；命令经它执行。
 *
 * 三层寿命（沿旧应用的切换设计）：控件每组每种编辑器一个，由组件持有；视图状态每“组 × 编辑器 × 文档”一份，存在这里的
 * 槽里，控件换文档时存进去、换回来时取出；文档在文档模型里，按打开引用计数。只淘汰确定 clean 的非活动视图状态。
 */

import {computed, shallowRef, watch} from "@vue/reactivity";
import type {ComputedRef, Ref, ShallowRef} from "@vue/reactivity";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {FilesService} from "nbook/plugins/files/shared/contracts";

import {createDocumentStore} from "./documents/store";
import type {CommitResult, DocumentReference, DocumentStore, TextDocument} from "./documents/store";
import {createEditorGroups} from "./groups/groups";
import type {EditorGroups, EditorKind, EditorTab, GroupsSnapshot, SplitDirection} from "./groups/groups";

/** 打开后这么久正文还没就绪才显示进度条（files-explorer 的“打开与切换”）。 */
export const PROGRESS_DELAY_MS = 800;

/** 每组每种编辑器最多保留这么多份非活动的视图状态。 */
export const RETAINED_VIEWS = 3;

/** 视图状态的槽：控件放自己的状态（Monaco 的模型、富文本的编辑状态、滚动位置）；淘汰时调 `dispose`。 */
export interface ViewStateSlot {
    state: unknown;
    dispose: (() => void) | null;
}

/** 一个组此刻交给控件的绑定：换文档、换编辑器、换标签都是新的绑定（新的 token）。 */
export interface ViewBinding {
    readonly token: string;
    readonly tabId: string;
    readonly kind: EditorKind;
    readonly document: TextDocument;
    readonly slot: ViewStateSlot;
    /** 输入回执；被接受的输入把 preview 标签转正。 */
    commit(baseRevision: number, text: string): CommitResult;
    /** 控件登记自己的结算函数（交出还没交出的输入）；切换、保存与资源管理器的操作之前同步调用。 */
    attach(flush: () => void): () => void;
    /** 这个绑定有没有未裁决输入。 */
    unresolved(): boolean;
}

/** 控件交出的句柄：命令（聚焦、撤销、重做、跳转到行）作用于活动组的活动控件。 */
export interface EditorControlHandle {
    focus(): void;
    undo?(): void;
    redo?(): void;
    /** 把还没交出的输入交给文档。 */
    flushPendingChange(): void;
    /**
     * 光标位置：选区活动端的行号与列号，都从 1 起（docs/specs/workbench/editor.md 输出 28）。只有能给出源文件行列的
     * 控件提供（源码编辑器）；Markdown 富文本里的段落位置不是源文件的行号，不提供。没有绑定文档时为 null。
     */
    readonly position?: Readonly<Ref<{readonly line: number; readonly column: number} | null>>;
    navigation?: {
        getLineCount(): number | null;
        revealLine(line: number): {ok: true; value: {line: number}} | {ok: false; reason: string};
    };
    /** 把光标放到文档末尾并聚焦（继续写作，输出 29）：源码编辑器是最后一行行尾，Markdown 编辑器是文档末尾。 */
    revealEnd?(): void;
}

export type CloseChoice = "save" | "discard" | "cancel";

export interface CloseDialog {
    readonly address: string;
}

export interface EditorAreaOptions {
    readonly files: FilesService;
    readonly clock: RuntimeClock;
    readonly workspaceKey: string;
    readonly generation: number;
    /** 恢复的会话；没有为 null。 */
    readonly initial: GroupsSnapshot | null;
    /** 会话变化时调用（组、标签、活动项、布局）；未绑定项目的窗口不给。 */
    readonly persist?: (snapshot: GroupsSnapshot) => void;
    readonly report: (error: unknown) => void;
}

export type ActionResult = {readonly ok: true} | {readonly ok: false; readonly reason: string};

/** 打开成功时给出标签 id：继续写作的定位绑定到这个标签。 */
export type OpenResult = {readonly ok: true; readonly tabId: string} | {readonly ok: false; readonly reason: string};

export interface EditorArea {
    readonly documents: DocumentStore;
    readonly groups: EditorGroups;
    /** 组的当前绑定；没有活动标签或文档还没就绪为 null。 */
    binding(groupId: string): ViewBinding | null;
    /** 组的活动标签的文档；没有为 null。 */
    documentOf(groupId: string): TextDocument | null;
    /**
     * 每组每种编辑器一个、活到组关闭的槽：控件把编辑器实例存在这里，布局变化（拆分、关闭相邻组）让组件重挂时接着用，
     * 撤销历史与编辑状态不丢（输出 2、10）。
     */
    controlSlot(groupId: string, kind: EditorKind): ViewStateSlot;
    /** 组顶部的进度条：活动文档 800 ms 后仍在读取。 */
    progress(groupId: string): boolean;
    /** 活动组的活动文档。 */
    readonly activeDocument: ComputedRef<TextDocument | null>;
    /** 本窗口打开着的文档，按文档去重：同一文件在几个组里打开只算一份。 */
    readonly openDocuments: ComputedRef<ReadonlyArray<TextDocument>>;
    readonly activeHandle: ComputedRef<EditorControlHandle | null>;
    readonly focused: ShallowRef<boolean>;
    readonly dialog: Readonly<ShallowRef<CloseDialog | null>>;
    /** 组顶部的一行提示（例如换文档前有未裁决输入）；没有为 null。 */
    readonly notice: Readonly<ShallowRef<string | null>>;
    /** `reveal: "end"`：文档就绪、控件交出句柄后把光标放到末尾（输出 29）；在此之前切走即取消。 */
    open(address: string, options: {readonly mode: "preview" | "permanent"; readonly editor?: EditorKind; readonly reveal?: "end"}): OpenResult;
    activate(tabId: string): ActionResult;
    pin(tabId: string): void;
    focusGroup(groupId: string): void;
    /** 关闭标签；文档最后一个标签且需要结算时先问，问的结果出来之前 Promise 不结束。 */
    close(tabId: string): Promise<"closed" | "cancelled">;
    closeOthers(tabId: string): Promise<void>;
    answer(choice: CloseChoice): void;
    split(direction: SplitDirection): ActionResult;
    reopenWith(editor: EditorKind): ActionResult;
    save(): Promise<ActionResult>;
    saveAll(): Promise<ActionResult>;
    revert(): Promise<ActionResult>;
    overwrite(): Promise<ActionResult>;
    resolve(groupId: string, choice: "adopt-current" | "keep-view"): void;
    /** 焦点落到了编辑器区之外（用户去了资源管理器等）：撤销还在等控件就绪的焦点交接。 */
    focusLeft(): void;
    /** 控件交出（或撤回）句柄。 */
    registerHandle(groupId: string, kind: EditorKind, handle: EditorControlHandle | null): void;
    dismissNotice(): void;
    /** 在组顶部显示一行提示（例如地址参数指向的不是项目里的资源）。 */
    notify(text: string): void;
    /** 离开页面前：结算全部视图输入，有需要结算的文档时为真。 */
    needsLeaveConfirm(): boolean;
    /** 布局尺寸变了（拖动分隔条）：记下会话。 */
    layoutChanged(): void;
    dispose(): void;
}

/** `.md` 用 Markdown 富文本，其余可编辑文本用源码编辑器。 */
export function defaultEditor(address: string): EditorKind {
    return address.toLowerCase().endsWith(".md") ? "markdown" : "code";
}

export function createEditorArea(options: EditorAreaOptions): EditorArea {
    const documents = createDocumentStore({files: options.files, workspaceKey: options.workspaceKey, generation: options.generation, report: options.report});
    const groups = createEditorGroups(options.initial);
    const references = new Map<string, DocumentReference>();
    const slots = new Map<string, ViewStateSlot>();
    /** 每组每种编辑器的非活动视图状态，最近用过的在后。 */
    const recent = new Map<string, string[]>();
    const handles = shallowRef(new Map<string, EditorControlHandle>());
    const dialog = shallowRef<CloseDialog | null>(null);
    const notice = shallowRef<string | null>(null);
    const focused = shallowRef(false);
    let answerDialog: ((choice: CloseChoice) => void) | null = null;
    let nextToken = 0;
    let disposed = false;
    const stops: Array<() => void> = [];

    const slotKey = (groupId: string, kind: EditorKind, document: TextDocument): string => `${groupId}|${kind}|${document.target.value.documentId}`;

    /** 标签的文档引用：恢复出来的标签第一次成为活动标签时才打开文档。 */
    const referenceOf = (tab: EditorTab): DocumentReference => {
        let reference = references.get(tab.id);
        if (reference === undefined) {
            reference = documents.acquire(tab.address);
            references.set(tab.id, reference);
        }
        return reference;
    };

    /** 标签已从组模型移除之后调用：释放它的文档引用。 */
    const releaseTab = (tab: EditorTab, groupId: string): void => {
        const reference = references.get(tab.id);
        if (reference === undefined) return;
        references.delete(tab.id);
        // 同一地址还有恢复出来、还没读到的标签：它们没有引用，先替它们拿上，正文才不会随这次释放丢掉。
        for (const group of groups.groups.value) {
            for (const other of group.tabs) {
                if (other.address === tab.address && !references.has(other.id)) references.set(other.id, documents.acquire(other.address));
            }
        }
        const key = slotKey(groupId, tab.editor, reference.document);
        const stillShown = groups.groups.value.some((group) => group.id === groupId && group.tabs.some((other) => other.editor === tab.editor && references.get(other.id)?.document === reference.document));
        if (!stillShown) dropSlot(key);
        reference.release();
    };

    const dropSlot = (key: string): void => {
        // 先从最近列表里摘掉：淘汰循环靠它让列表变短，槽已经不在时也要摘。
        for (const list of recent.values()) {
            const index = list.indexOf(key);
            if (index >= 0) list.splice(index, 1);
        }
        const slot = slots.get(key);
        if (slot === undefined) return;
        slots.delete(key);
        try {
            slot.dispose?.();
        } catch (error) {
            options.report(error);
        }
    };

    /** 换下来的视图状态进最近列表；超出上限时淘汰最早的、确定 clean 的那一份。 */
    const retire = (groupId: string, kind: EditorKind, key: string): void => {
        // 换下的绑定的槽可能已经随标签释放（preview 被替换）：没有槽就没有可保留的视图状态。
        if (!slots.has(key)) return;
        const listKey = `${groupId}|${kind}`;
        const list = recent.get(listKey) ?? [];
        const at = list.indexOf(key);
        if (at >= 0) list.splice(at, 1);
        list.push(key);
        recent.set(listKey, list);
        while (list.length > RETAINED_VIEWS) {
            const victim = list.find((candidate) => {
                const documentId = candidate.split("|")[2];
                for (const reference of references.values()) {
                    const document = reference.document;
                    if (document.target.value.documentId === documentId && (document.dirty.value || document.saving.value || document.unresolved.value.length > 0 || document.conflict.value !== null)) return false;
                }
                return true;
            });
            if (victim === undefined) break;
            dropSlot(victim);
        }
    };

    const controlSlots = new Map<string, ViewStateSlot>();
    const dropControlSlot = (key: string): void => {
        const slot = controlSlots.get(key);
        if (slot === undefined) return;
        controlSlots.delete(key);
        try {
            slot.dispose?.();
        } catch (error) {
            options.report(error);
        }
    };
    stops.push(watch(() => groups.groups.value.map((group) => group.id), (live) => {
        for (const key of [...controlSlots.keys()]) if (!live.includes(key.slice(0, key.indexOf("|")))) dropControlSlot(key);
    }));

    const bindings = new Map<string, ViewBinding>();
    const binding = (groupId: string): ViewBinding | null => {
        const group = groups.groups.value.find((candidate) => candidate.id === groupId);
        const tab = group?.tabs.find((candidate) => candidate.id === group.active);
        if (group === undefined || tab === undefined) return null;
        const document = referenceOf(tab).document;
        const status = document.status.value;
        if (status !== "ready" && status !== "deleted") return null;
        const key = slotKey(groupId, tab.editor, document);
        const existing = bindings.get(groupId);
        if (existing !== undefined && existing.tabId === tab.id && existing.kind === tab.editor && existing.document === document) return existing;
        if (existing !== undefined) retire(groupId, existing.kind, slotKey(groupId, existing.kind, existing.document));
        let slot = slots.get(key);
        if (slot === undefined) {
            slot = {state: null, dispose: null};
            slots.set(key, slot);
        }
        const listKey = `${groupId}|${tab.editor}`;
        const list = recent.get(listKey);
        if (list !== undefined) {
            const at = list.indexOf(key);
            if (at >= 0) list.splice(at, 1);
        }
        nextToken += 1;
        const token = `v${String(nextToken)}`;
        // 换下的绑定（换文档、关闭标签、换编辑器）不再改变任何文档：换下之前，切换的路径已经结算过它的输入（`leave`、
        // `closeTab`），之后迟到的回调一律当作过时。
        const current = (): boolean => bindings.get(groupId) === created;
        const created: ViewBinding = {
            token,
            tabId: tab.id,
            kind: tab.editor,
            document,
            slot,
            commit: (baseRevision, text) => {
                if (!current()) return {status: "stale"};
                const result = documents.commit(document, token, baseRevision, text);
                // 在 preview 标签里编辑即转正（输出 1）：只看真正改了正文的输入。
                if (result.status === "accepted" && result.revision > baseRevision && groups.find(tab.id)?.tab.preview === true) groups.pin(tab.id);
                return result;
            },
            attach: (flush) => (current() ? documents.attachView(document, flush) : () => undefined),
            unresolved: () => document.unresolved.value.includes(token),
        };
        bindings.set(groupId, created);
        return created;
    };

    const documentOf = (groupId: string): TextDocument | null => {
        const group = groups.groups.value.find((candidate) => candidate.id === groupId);
        const tab = group?.tabs.find((candidate) => candidate.id === group.active);
        return tab === undefined ? null : referenceOf(tab).document;
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
                if (!event.addresses.includes(tab.address)) continue;
                const reference = references.get(tab.id);
                references.delete(tab.id);
                if (reference !== undefined) dropSlot(slotKey(group.id, tab.editor, reference.document));
            }
        }
        groups.closeWithin(event.addresses);
    }));

    if (options.persist !== undefined) {
        const persist = options.persist;
        stops.push(watch(() => [groups.groups.value, groups.activeGroup.value, groups.layoutVersion.value], () => persist(groups.snapshot())));
    }

    const activeDocument = computed(() => documentOf(groups.activeGroup.value));
    // 文档在标签打开时同步取得（`acquire`），所以跟着组与标签的变化重算就够了。
    const openDocuments = computed(() => {
        const open = new Set<TextDocument>();
        for (const group of groups.groups.value) {
            for (const tab of group.tabs) {
                const document = documents.get(tab.address);
                if (document !== null) open.add(document);
            }
        }
        return [...open];
    });
    /**
     * 把焦点交给活动视图。布局变化（关闭组、拆分）会让 grid 重挂控件：现在聚焦的可能是马上被拿下的那个 DOM，所以活动视图
     * 的控件在同一个任务里重新登记时再聚焦一次；控件还没挂上（例如换了一种编辑器、Monaco 还在加载）就等它登记。只聚焦
     * 活动视图：其它组的控件重挂不抢焦点，也就不会把活动组改掉。等待中的交接在用户把焦点移出编辑器区时撤销（`focusLeft`），
     * 迟到的控件不把焦点抢回来。
     */
    let focusWhenReady = false;
    let refocusOnRemount = false;
    const focusActive = (): void => {
        const handle = activeHandle.value;
        if (handle !== null) handle.focus();
        else focusWhenReady = groups.activeTab() !== null;
        refocusOnRemount = true;
        options.clock.schedule(() => {
            refocusOnRemount = false;
        }, 0);
    };
    const activeHandle = computed(() => {
        const group = groups.groups.value.find((candidate) => candidate.id === groups.activeGroup.value);
        const tab = group?.tabs.find((candidate) => candidate.id === group.active);
        return tab === undefined ? null : handles.value.get(`${groups.activeGroup.value}|${tab.editor}`) ?? null;
    });

    /**
     * 继续写作的定位（输出 29）：打开时记下标签与组，等它的文档就绪、它所在组的控件交出句柄再定位；在此之前用户切到别的
     * 标签或组、标签关闭都取消，读取失败在组顶部提示。定位本身推到下一个时钟刻：文档就绪时控件要在它自己的 watch 里先装上
     * 正文，这里的 watch 是同步的，不能抢在它前面。
     */
    const pendingReveal = shallowRef<{readonly groupId: string; readonly tabId: string; readonly address: string} | null>(null);
    type RevealState = {readonly outcome: "cancelled"} | {readonly outcome: "failed"; readonly address: string} | {readonly outcome: "ready"; readonly handle: EditorControlHandle};
    stops.push(watch((): RevealState | null => {
        const pending = pendingReveal.value;
        if (pending === null) return null;
        const group = groups.groups.value.find((candidate) => candidate.id === pending.groupId);
        const tab = group?.tabs.find((candidate) => candidate.id === pending.tabId);
        if (group === undefined || tab === undefined || group.active !== tab.id || groups.activeGroup.value !== group.id) return {outcome: "cancelled"};
        const status = referenceOf(tab).document.status.value;
        if (status === "failed") return {outcome: "failed", address: pending.address};
        if (status !== "ready" && status !== "deleted") return null;
        const handle = handles.value.get(`${group.id}|${tab.editor}`);
        return handle === undefined ? null : {outcome: "ready", handle};
    }, (state) => {
        if (state === null) return;
        pendingReveal.value = null;
        if (state.outcome === "failed") notice.value = `上次编辑的片段已不在原处：${state.address}`;
        if (state.outcome !== "ready") return;
        options.clock.schedule(() => {
            if (disposed) return;
            state.handle.revealEnd?.();
            state.handle.focus();
        }, 0);
    }));

    /** 换文档前结算活动视图的输入；它有未裁决输入时不换。 */
    const leave = (groupId: string): boolean => {
        const current = bindings.get(groupId);
        if (current === undefined) return true;
        documents.settle(current.document);
        if (current.document.unresolved.value.includes(current.token)) {
            notice.value = "有未裁决的输入：先在组顶部选择采用当前正文或保留本视图的内容";
            return false;
        }
        return true;
    };

    const needsSettle = (document: TextDocument): boolean => document.dirty.value || document.unresolved.value.length > 0 || document.saving.value;

    const ask = (address: string): Promise<CloseChoice> => new Promise<CloseChoice>((resolve) => {
        answerDialog?.("cancel");
        dialog.value = {address};
        answerDialog = resolve;
    });

    /**
     * 关闭一个标签（输出 3、4、13、14）。同一文件还有别的标签（包括恢复出来、还没读到的）时文档留给它们，只问这个视图
     * 自己的未裁决输入；否则文档需要结算时问。选“保存”后保存期间还能输入：保存完回到开头再结算、再看要不要问，直到没有
     * 要结算的东西或用户取消。
     */
    const closeTab = async (tabId: string): Promise<"closed" | "cancelled"> => {
        const hadFocus = focused.value;
        for (;;) {
            const found = groups.find(tabId);
            if (found === null) return "cancelled";
            const document = references.get(tabId)?.document ?? null;
            if (document === null) break;
            documents.settle(document);
            const shown = bindings.get(found.group.id);
            const own = shown !== undefined && shown.tabId === tabId ? shown : null;
            const ownInput = own !== null && own.unresolved();
            const shared = groups.groups.value.some((group) => group.tabs.some((tab) => tab.id !== tabId && tab.address === found.tab.address));
            if (shared ? !ownInput : !needsSettle(document)) break;
            const choice = await ask(found.tab.address);
            if (choice === "cancel") return "cancelled";
            if (choice === "discard") {
                // 文档还有别的标签时只丢这个视图的未裁决输入；否则最后一个引用释放时整份文档连同输入一起丢弃。
                if (own !== null) documents.discardInput(document, own.token);
                break;
            }
            // 保存这个视图看到的内容：它的未裁决输入先成为正文。
            if (own !== null && ownInput) documents.resolve(document, own.token, "keep-view");
            const saved = await documents.save(document);
            if (!saved.ok) return "cancelled";
        }
        const current = groups.find(tabId);
        if (current === null) return "closed";
        // 只换下这个标签自己的绑定：关同组里别的标签不动活动视图的绑定与它的未裁决输入。
        if (bindings.get(current.group.id)?.tabId === tabId) bindings.delete(current.group.id);
        groups.close(tabId);
        releaseTab(current.tab, current.group.id);
        // 开始关闭时焦点在编辑器区：交给关闭后的活动视图，键盘用户不至于落到页面根（输出 3）。不看此刻的 `focused`：
        // 被关的标签按钮、询问对话框都会先把它置假。
        if (hadFocus) focusActive();
        return "closed";
    };

    return {
        documents,
        groups,
        binding,
        documentOf,
        controlSlot: (groupId, kind) => {
            const key = `${groupId}|${kind}`;
            let slot = controlSlots.get(key);
            if (slot === undefined) {
                slot = {state: null, dispose: null};
                controlSlots.set(key, slot);
            }
            return slot;
        },
        progress: (groupId) => progress.value.has(groupId),
        activeDocument,
        openDocuments,
        activeHandle,
        focused,
        dialog,
        notice,
        open: (address, open) => {
            if (disposed) return {ok: false, reason: "编辑器已关闭"};
            if (!leave(groups.activeGroup.value)) return {ok: false, reason: "当前视图有未裁决的输入"};
            const editor = open.editor ?? defaultEditor(address);
            const group = groups.activeGroup.value;
            // 文档在标签成为活动标签、第一次被读到时打开（`referenceOf`）：新开的标签就是活动标签。
            const {tab, replaced} = groups.open(address, {mode: open.mode, editor});
            if (replaced !== null) releaseTab(replaced, group);
            pendingReveal.value = open.reveal === "end" ? {groupId: group, tabId: tab.id, address} : null;
            return {ok: true, tabId: tab.id};
        },
        activate: (tabId) => {
            const found = groups.find(tabId);
            if (found === null) return {ok: false, reason: "标签已关闭"};
            if (found.group.active !== tabId && !leave(found.group.id)) return {ok: false, reason: "当前视图有未裁决的输入"};
            groups.activate(tabId);
            return {ok: true};
        },
        pin: (tabId) => groups.pin(tabId),
        focusGroup: (groupId) => groups.focusGroup(groupId),
        close: closeTab,
        closeOthers: async (tabId) => {
            const found = groups.find(tabId);
            if (found === null) return;
            for (const tab of found.group.tabs) {
                if (tab.id === tabId) continue;
                if ((await closeTab(tab.id)) === "cancelled") return;
            }
        },
        answer: (choice) => {
            const resolve = answerDialog;
            answerDialog = null;
            dialog.value = null;
            resolve?.(choice);
        },
        split: (direction) => {
            const tab = groups.activeTab();
            if (tab === null) return {ok: false, reason: "没有活动标签"};
            const hadFocus = focused.value;
            const created = groups.split(tab.id, direction);
            if (created === null) return {ok: false, reason: "不能再拆分"};
            // 焦点在编辑器区时交给新组（新组是活动组）。
            if (hadFocus) focusActive();
            return {ok: true};
        },
        reopenWith: (editor) => {
            const group = groups.activeGroup.value;
            const tab = groups.activeTab();
            if (tab === null) return {ok: false, reason: "没有活动标签"};
            if (!leave(group)) return {ok: false, reason: "当前视图有未裁决的输入"};
            groups.setEditor(tab.id, editor);
            return {ok: true};
        },
        save: async () => {
            const document = activeDocument.value;
            if (document === null) return {ok: false, reason: "没有活动文档"};
            const result = await documents.save(document);
            return result.ok ? {ok: true} : {ok: false, reason: result.code};
        },
        saveAll: async () => {
            const results = await documents.coordinator.save(["project://", "user://"]);
            const failed = results.filter((result) => !result.ok);
            return failed.length === 0 ? {ok: true} : {ok: false, reason: failed.map((result) => `${result.address}：${result.code ?? ""}`).join("；")};
        },
        revert: async () => {
            const document = activeDocument.value;
            if (document === null) return {ok: false, reason: "没有活动文档"};
            await documents.revert(document);
            return {ok: true};
        },
        overwrite: async () => {
            const document = activeDocument.value;
            if (document === null) return {ok: false, reason: "没有活动文档"};
            const result = await documents.overwrite(document);
            return result.ok ? {ok: true} : {ok: false, reason: result.code};
        },
        resolve: (groupId, choice) => {
            const current = bindings.get(groupId);
            if (current === undefined) return;
            documents.resolve(current.document, current.token, choice);
            if (notice.value !== null) notice.value = null;
        },
        focusLeft: () => {
            focused.value = false;
            focusWhenReady = false;
            refocusOnRemount = false;
        },
        registerHandle: (groupId, kind, handle) => {
            const next = new Map(handles.value);
            if (handle === null) next.delete(`${groupId}|${kind}`);
            else next.set(`${groupId}|${kind}`, handle);
            handles.value = next;
            if ((focusWhenReady || refocusOnRemount) && handle !== null && activeHandle.value === handle) {
                focusWhenReady = false;
                handle.focus();
            }
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
        layoutChanged: () => {
            if (options.persist !== undefined) options.persist(groups.snapshot());
        },
        dispose: () => {
            if (disposed) return;
            disposed = true;
            answerDialog?.("cancel");
            for (const stop of stops.splice(0)) stop();
            for (const timer of timers.values()) timer.cancel();
            for (const key of [...slots.keys()]) dropSlot(key);
            for (const key of [...controlSlots.keys()]) dropControlSlot(key);
            documents.dispose();
        },
    };
}
