/**
 * 编辑组与标签（docs/specs/workbench/editor.md 输出 1–5）：纯模型，不打开文档。标签的属性（地址、编辑器、preview、固定、光标、语言）在这里，标签在哪块面板、面板怎么排在工作台的布局文档里，
 * 经 `workbench/shared/editor-panels.ts` 的接缝改（docs/specs/ui/workbench-layout.md 输出 33）；活动组是最近获得焦点或执行过打开的组。打开文档与释放引用由控制器按这里的结果做，所以每个
 * 会让标签消失的动作都返回消失的标签。
 */

import {computed, shallowRef} from "@vue/reactivity";
import type {Ref, ShallowRef} from "@vue/reactivity";

import type {LayoutEdgeTarget, LayoutFloatRect} from "@notnotype/nb-layout";

import type {EditorPanels} from "nbook/plugins/workbench/shared/contracts";

import {isWithin, rebase} from "../documents/address";

import type {TabCursor} from "../../shared/contracts";

export type {TabCursor} from "../../shared/contracts";

/**
 * 标签 id 是随机串：合成一棵树之后它是两条记录（布局文档与 `editor.tabs`）之间的键，几个窗口各自新建也不能撞（docs/specs/ui/workbench-layout.md 输出 33）。
 */
const newTabId = (): string => `t-${crypto.randomUUID()}`;

/**
 * 打开文件的标签：`editor` 是编辑器 id（docs/specs/workbench/editor.md 输出 36）。标签按“地址 + 编辑器”区分，同一组里
 * 一个文件的源码标签与它的预览视图可以并存（输出 1）。
 */
export interface FileTab {
    readonly kind: "file";
    readonly id: string;
    readonly address: string;
    readonly editor: string;
    readonly preview: boolean;
    /** 上次的光标（输出 30），写法由编辑器声明的 `cursor` 决定。 */
    readonly cursor?: TabCursor;
    /** 选定的语言（输出 45）；没有时按文件识别。 */
    readonly language?: string;
    /** 固定（输出 50）：组里固定标签排在前面，固定的不是 preview。 */
    readonly pinned?: true;
}

/** 不对应文件的页面标签（输出 33）：地址是 `page://<页面 id>`，不进会话记录，没有编辑器与光标。 */
export interface PageTab {
    readonly kind: "page";
    readonly id: string;
    readonly address: string;
    readonly preview: false;
}

export type EditorTab = FileTab | PageTab;

const isPinned = (tab: EditorTab): boolean => tab.kind === "file" && tab.pinned === true;

/** 组里固定标签的个数：它们是 `tabs` 开头的连续一段。 */
const pinnedCount = (tabs: ReadonlyArray<EditorTab>): number => {
    const at = tabs.findIndex((tab) => !isPinned(tab));
    return at < 0 ? tabs.length : at;
};

/** 标签移到的位置：组、固定区或普通区、该区完整顺序里排在它前面的标签（null 为该区末尾）。 */
export interface TabPlace {
    readonly group: string;
    readonly partition: "pinned" | "normal";
    readonly before: string | null;
}

/** 编辑器记光标的写法（编辑器声明的 `cursor`）；没有就不记。 */
export type CursorKind = (editor: string) => "offset" | "line" | null;

function cursorFits(kind: "offset" | "line" | null, cursor: TabCursor): boolean {
    if (kind === null) return false;
    return kind === "offset" ? "offset" in cursor : "line" in cursor;
}

function sameCursor(left: TabCursor | undefined, right: TabCursor): boolean {
    if (left === undefined) return false;
    if ("offset" in left) return "offset" in right && left.offset === right.offset;
    return "line" in right && left.line === right.line && left.column === right.column;
}

export interface EditorGroup {
    readonly id: string;
    readonly tabs: ReadonlyArray<EditorTab>;
    /** 活动标签的 id；空组为 null。 */
    readonly active: string | null;
    /** 这一组是浮动窗。 */
    readonly floating: boolean;
}

/** 记录里的文件标签：地址、编辑器、preview、固定、上次的光标与语言。 */
export interface SavedFileTab {
    readonly address: string;
    readonly editor: string;
    readonly preview: boolean;
    readonly pinned?: true;
    readonly cursor?: TabCursor;
    readonly language?: string;
}

/**
 * 记录里的一项。页面标签也留一项：布局文档里有它，恢复时要分得清“页面不恢复”（输出 33，从文档里拿掉）和“这个标签的记录丢了”（显示原因，docs/specs/ui/workbench-layout.md 输出 34）。
 */
export type SavedTab = SavedFileTab | {readonly page: true};

/** 存进记录的形状（`editor.tabs`）：`tabId` → 属性。 */
export interface TabsSnapshot {
    readonly tabs: Readonly<Record<string, SavedTab>>;
}

/** 标签的记录丢了时的占位：是一个打不开的页面，所以能显示、能关闭，别的路径都不用为它分支。 */
export const LOST_TAB_ADDRESS = "page://nbook.editor.lost-tab";

export type SplitDirection = "right" | "down";

export interface EditorGroups {
    readonly groups: Readonly<Ref<ReadonlyArray<EditorGroup>>>;
    /** 画出来的组：拖动中可能是实时布局的预览。只有头读它（标签条）：别的都按 `groups`，预览没有副作用。 */
    readonly shown: Readonly<Ref<ReadonlyArray<EditorGroup>>>;
    readonly activeGroup: Readonly<Ref<string>>;
    /** 标签的属性，变了就要存（`snapshot`）。结构在布局文档里，由工作台存。 */
    readonly attributes: Readonly<ShallowRef<ReadonlyMap<string, EditorTab>>>;
    /** 活动组的活动标签。 */
    activeTab(): EditorTab | null;
    find(tabId: string): {readonly group: EditorGroup; readonly tab: EditorTab} | null;
    /**
     * 在组里打开文件（缺省活动组）：本组有 `reuse` 认可的标签就只激活它（`permanent` 时转正），缺省认可地址与编辑器都相同
     * 的；`preview` 替换本组已有的 preview 标签；否则插在活动标签之后。`replaced` 是被替换掉的 preview 标签。
     */
    open(address: string, options: {readonly mode: "preview" | "permanent"; readonly editor: string; readonly group?: string; readonly reuse?: (tab: FileTab) => boolean}): {readonly tab: FileTab; readonly replaced: EditorTab | null};
    /** 在活动组以正式标签打开页面；窗口里已开着的由调用方先找（同一页面只开一个）。 */
    openPage(address: string): PageTab;
    /** preview 转为 permanent。 */
    keep(tabId: string): void;
    /** 固定或取消固定（输出 50）：固定时转正、排到固定区末尾；取消时排到普通区开头。页面标签不能固定。 */
    setPinned(tabId: string, pinned: boolean): void;
    activate(tabId: string): void;
    focusGroup(groupId: string): void;
    /** 关闭标签：同组激活右侧的（没有时左侧）；组空了且还有别的组时组随之关闭。返回被关的标签。 */
    close(tabId: string): EditorTab | null;
    /** 在标签所在组的右侧或下方新建组、打开同一文档（permanent），新组成为活动组。页面标签不拆分（同一页面只开一个），返回 null。 */
    split(tabId: string, direction: SplitDirection): EditorTab | null;
    /**
     * “在侧边打开”的目标组（docs/specs/workbench/editor.md 输出 35）：活动组右侧相邻的组；右侧没有组时在活动组右侧新建一个
     * 空组（不带走活动标签）。返回组 id；只建组、不改活动组，打开时再切过去。
     */
    sideGroup(): string;
    /** 组右侧相邻的组；没有为 null。只查不建。 */
    rightOf(groupId: string): string | null;
    /** 同组里移动一位（键盘排序），不跨过固定区与普通区的分界。 */
    move(tabId: string, delta: -1 | 1): void;
    /**
     * 把标签移到 `place`（输出 49）：组内换位置或换组，成为那一组的活动标签、那一组成为活动组；移动了的 preview 转正，落在
     * 另一个区时随之固定或取消固定，源组空了随之关闭。原位、目标不存在、页面标签进固定区、目标组已有地址与编辑器都相同的
     * 标签（由控制器并掉）时不变，返回 null。只改结构，结算与绑定归控制器。
     */
    moveTab(tabId: string, place: TabPlace): {readonly tab: EditorTab; readonly droppedGroup: string | null} | null;
    /**
     * 把标签移到外缘（转正、不固定），它所在的组成为活动组。源组只有这一个标签时是同一块面板移动，`group` 还是它自己，视图不重建（docs/specs/ui/workbench-layout.md 输出 27）；
     * 否则拆出新组。放下去和现在一样时不变，返回 null。
     */
    moveToNewGroup(tabId: string, target: LayoutEdgeTarget): {readonly tab: EditorTab; readonly group: string} | null;
    /** 建一个空组（文件拖到外缘、没有落点的地方）：窗或组先有，文件再打开进去。不改活动组。 */
    openGroupAt(target: LayoutEdgeTarget): string | null;
    openFloatGroup(rect: LayoutFloatRect): string | null;
    /** 浮出来：和新组一样，preview 转正、固定取消，新的浮动组成为活动组。放不下时是 null。 */
    moveToFloat(tabId: string, rect: LayoutFloatRect): {readonly tab: EditorTab; readonly group: string} | null;
    /**
     * 用另一种编辑器打开同一标签，光标与语言随之丢掉（输出 39）。本组已有这个地址、这种编辑器的标签时切到它、关掉当前
     * 这个，返回被关的标签；否则为 null。
     */
    setEditor(tabId: string, editor: string): EditorTab | null;
    /** 记下标签选定的语言；null 回到按文件识别。 */
    setLanguage(tabId: string, language: string | null): void;
    /** 记下标签的光标；标签已关、写法与编辑器对不上或与记下的相同时不变。 */
    setCursor(tabId: string, cursor: TabCursor): void;
    /** 地址改名或移动：标签跟到新地址；`kept` 里的地址留在原处。 */
    rebind(from: string, to: string, kept?: ReadonlyArray<string>): void;
    /** 关闭这些地址及其后代的标签，返回被关的标签。 */
    closeWithin(addresses: ReadonlyArray<string>): ReadonlyArray<EditorTab>;
    snapshot(): TabsSnapshot;
}

/** 默认的光标写法：只认内置的两个编辑器（测试与没有编辑器目录的场合）。 */
const BUILTIN_CURSOR: CursorKind = (editor) => (editor === "nbook.editor.markdown" ? "offset" : editor === "nbook.editor.code" ? "line" : null);

/** 两份列表的项都是同一个对象吗。 */
const sameItems = <T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>): boolean => left.length === right.length && left.every((item, index) => item === right[index]);

/** `panels` 是结构的持有者；`initial` 是读到的 `editor.tabs`，两边靠 `tabId` 对上（`restoreTabs`）。 */
export function createEditorGroups(panels: EditorPanels, initial: TabsSnapshot | null = null, cursorKind: CursorKind = BUILTIN_CURSOR): EditorGroups {
    const {tabs: panelTabs, tree} = panels;
    /** 标签的属性。结构（标签在哪、活动的是谁）在接缝后面，两边只靠 id 对上。 */
    const attributes = shallowRef<ReadonlyMap<string, EditorTab>>(restoreTabs(panels, initial, cursorKind));

    /** 这个位置守不守固定分区（输出 50）：固定的排在普通的前面。`at` 是摘掉来源之后的位置。 */
    const fitsPartition = (tab: EditorTab, panel: string, at: number): boolean => {
        const others = (panelTabs.panels.value.find((entry) => entry.id === panel)?.tabs ?? []).filter((id) => id !== tab.id);
        const boundary = pinnedCount(others.flatMap((id) => attributes.value.get(id) ?? []));
        return isPinned(tab) ? at <= boundary : at >= boundary;
    };

    /**
     * 结构和属性合成的组。没变的组和标签保持同一个对象：光标一动属性就变，别的组不该跟着重新渲染。
     */
    const groups = computed<ReadonlyArray<EditorGroup>>((previous = []) => {
        const next = panelTabs.panels.value.map((panel): EditorGroup => {
            const tabs = panel.tabs.flatMap((id) => attributes.value.get(id) ?? []);
            const same = previous.find((group) => group.id === panel.id);
            return same !== undefined && same.active === panel.active && same.floating === panel.floating && sameItems(same.tabs, tabs) ? same : {id: panel.id, tabs, active: panel.active, floating: panel.floating};
        });
        return sameItems(previous, next) ? previous : next;
    });

    const shown = computed<ReadonlyArray<EditorGroup>>(() => panelTabs.shownPanels.value.map((panel): EditorGroup => ({id: panel.id, tabs: panel.tabs.flatMap((id) => attributes.value.get(id) ?? []), active: panel.active, floating: panel.floating})));

    const groupOf = (id: string): EditorGroup | undefined => groups.value.find((group) => group.id === id);
    const locate = (tabId: string): {group: EditorGroup; tab: EditorTab; index: number} | null => {
        for (const group of groups.value) {
            const index = group.tabs.findIndex((tab) => tab.id === tabId);
            if (index >= 0) return {group, tab: group.tabs[index] as EditorTab, index};
        }
        return null;
    };
    const setTab = (tab: EditorTab): void => {
        attributes.value = new Map(attributes.value).set(tab.id, tab);
    };
    const forgetTab = (tabId: string): void => {
        const next = new Map(attributes.value);
        next.delete(tabId);
        attributes.value = next;
    };

    /** 插在组的活动标签之后、但不插进固定区（新标签不固定），成为活动标签。属性先写：结构一变，读组的就要找得到它。 */
    const insert = (group: EditorGroup, tab: EditorTab): void => {
        const at = group.tabs.findIndex((candidate) => candidate.id === group.active);
        setTab(tab);
        panelTabs.insert(group.id, tab.id, at < 0 ? group.tabs.length : Math.max(at + 1, pinnedCount(group.tabs)));
    };

    /** 移动后的标签：preview 转正，按目标区固定或取消固定。 */
    const placed = (tab: EditorTab, pinned: boolean): EditorTab => {
        if (tab.kind === "page") return tab;
        const {pinned: _old, ...rest} = tab;
        return pinned ? {...rest, preview: false, pinned: true} : {...rest, preview: false};
    };

    /**
     * 同时改属性和位置。固定区的检查看的是新属性，所以属性先写；接缝不答应时写回去。`at` 是摘掉来源之后的位置。
     */
    const moveWith = (found: {readonly group: EditorGroup; readonly tab: EditorTab; readonly index: number}, tab: EditorTab, panel: string, at: number, options?: {readonly activate?: boolean}): boolean => {
        if (!fitsPartition(tab, panel, at)) return false;
        setTab(tab);
        const index = found.group.id === panel && at >= found.index ? at + 1 : at;
        if (panelTabs.move(tab.id, panel, index, options)) return true;
        setTab(found.tab);
        return false;
    };

    const remove = (tabId: string): EditorTab | null => {
        const found = locate(tabId);
        if (found === null) return null;
        panelTabs.remove(tabId);
        forgetTab(tabId);
        return found.tab;
    };

    /** 换一个位置但不动活动标签和活动组（固定与取消固定）。 */
    const repin = (found: {readonly group: EditorGroup; readonly tab: EditorTab; readonly index: number}, pinned: boolean): void => {
        // 固定区末尾与普通区开头是同一个位置：拿掉它之后的分界处。
        const rest = found.group.tabs.filter((tab) => tab.id !== found.tab.id);
        moveWith(found, placed(found.tab, pinned), found.group.id, pinnedCount(rest), {activate: false});
    };

    return {
        groups,
        shown,
        activeGroup: tree.current,
        attributes,
        activeTab: () => {
            const group = groupOf(tree.current.value);
            return group?.tabs.find((tab) => tab.id === group.active) ?? null;
        },
        find: (tabId) => {
            const found = locate(tabId);
            return found === null ? null : {group: found.group, tab: found.tab};
        },
        open: (address, options) => {
            const group = groupOf(options.group ?? tree.current.value) ?? (groups.value[0] as EditorGroup);
            tree.setCurrent(group.id);
            const reuse = options.reuse ?? ((tab: FileTab) => tab.editor === options.editor);
            const existing = group.tabs.find((tab): tab is FileTab => tab.kind === "file" && tab.address === address && reuse(tab));
            if (existing !== undefined) {
                const tab = options.mode === "permanent" && existing.preview ? {...existing, preview: false} : existing;
                if (tab !== existing) setTab(tab);
                panelTabs.activate(tab.id);
                return {tab, replaced: null};
            }
            const tab: FileTab = {kind: "file", id: newTabId(), address, editor: options.editor, preview: options.mode === "preview"};
            const preview = options.mode === "preview" ? group.tabs.find((candidate) => candidate.preview) : undefined;
            if (preview !== undefined) {
                setTab(tab);
                panelTabs.replace(preview.id, tab.id);
                panelTabs.activate(tab.id);
                forgetTab(preview.id);
                return {tab, replaced: preview};
            }
            insert(group, tab);
            return {tab, replaced: null};
        },
        openPage: (address) => {
            const group = groupOf(tree.current.value) ?? (groups.value[0] as EditorGroup);
            const tab: PageTab = {kind: "page", id: newTabId(), address, preview: false};
            insert(group, tab);
            return tab;
        },
        keep: (tabId) => {
            const found = locate(tabId);
            if (found === null || !found.tab.preview) return;
            setTab({...found.tab, preview: false});
        },
        setPinned: (tabId, pinned) => {
            const found = locate(tabId);
            if (found === null || found.tab.kind === "page" || isPinned(found.tab) === pinned) return;
            repin(found, pinned);
        },
        activate: (tabId) => {
            panelTabs.activate(tabId);
        },
        focusGroup: (groupId) => {
            tree.setCurrent(groupId);
        },
        close: (tabId) => remove(tabId),
        split: (tabId, direction) => {
            const found = locate(tabId);
            if (found === null || found.tab.kind === "page") return null;
            const id = tree.openAtEdge(found.group.id, direction === "right" ? "right" : "bottom");
            if (id === null) return null;
            // 新组的视图从原标签记下的光标开始，语言也跟过去（输出 30、45）。
            const source = found.tab;
            const tab: FileTab = {kind: "file", id: newTabId(), address: source.address, editor: source.editor, preview: false, ...(source.cursor === undefined ? {} : {cursor: source.cursor}), ...(source.language === undefined ? {} : {language: source.language})};
            setTab(tab);
            panelTabs.insert(id, tab.id, 0);
            return tab;
        },
        rightOf: (groupId) => tree.rightOf(groupId),
        sideGroup: () => tree.rightOf(tree.current.value) ?? tree.openAtEdge(tree.current.value, "right") ?? tree.current.value,
        move: (tabId, delta) => {
            const found = locate(tabId);
            if (found === null) return;
            const target = found.index + delta;
            const boundary = pinnedCount(found.group.tabs);
            const [low, high] = isPinned(found.tab) ? [0, boundary - 1] : [boundary, found.group.tabs.length - 1];
            if (target < low || target > high) return;
            moveWith(found, found.tab, found.group.id, target, {activate: false});
        },
        moveTab: (tabId, place) => {
            const found = locate(tabId);
            const target = groupOf(place.group);
            if (found === null || target === undefined) return null;
            if (place.partition === "pinned" && found.tab.kind === "page") return null;
            if (target.id !== found.group.id && target.tabs.some((tab) => tab.kind === "file" && found.tab.kind === "file" && tab.address === found.tab.address && tab.editor === found.tab.editor)) return null;
            // 目标组拿掉源标签之后的样子（同组时就是源组本身拿掉它）。
            const base = target.id === found.group.id ? target.tabs.filter((tab) => tab.id !== tabId) : target.tabs;
            const boundary = pinnedCount(base);
            let at: number;
            if (place.before === null) at = place.partition === "pinned" ? boundary : base.length;
            else {
                at = base.findIndex((tab) => tab.id === place.before);
                if (at < 0 || (place.partition === "pinned") !== (at < boundary)) return null;
            }
            const tab = placed(found.tab, place.partition === "pinned");
            // 原位：同组、同区、位置没变。
            if (target.id === found.group.id && at === found.index && isPinned(found.tab) === isPinned(tab)) return null;
            if (!moveWith(found, tab, target.id, at)) return null;
            return {tab, droppedGroup: groupOf(found.group.id) === undefined ? found.group.id : null};
        },
        moveToNewGroup: (tabId, target) => {
            const found = locate(tabId);
            if (found === null) return null;
            const tab = placed(found.tab, false);
            setTab(tab);
            const group = panelTabs.moveToEdge(tabId, target);
            if (group === null) {
                setTab(found.tab);
                return null;
            }
            // 接缝不改活动面板：单个标签的组是同一块面板移动，没有“拆出新面板”那一步。
            tree.setCurrent(group);
            return {tab, group};
        },
        openGroupAt: (target) => tree.openAt(target),
        openFloatGroup: (rect) => tree.openFloat(rect),
        moveToFloat: (tabId, rect) => {
            const found = locate(tabId);
            if (found === null) return null;
            const tab = placed(found.tab, false);
            setTab(tab);
            const group = panelTabs.float(tabId, rect);
            if (group === null) {
                setTab(found.tab);
                return null;
            }
            return {tab, group};
        },
        setEditor: (tabId, editor) => {
            const found = locate(tabId);
            if (found === null || found.tab.kind === "page" || found.tab.editor === editor) return null;
            const address = found.tab.address;
            const twin = found.group.tabs.find((tab) => tab.kind === "file" && tab.id !== tabId && tab.address === address && tab.editor === editor);
            if (twin !== undefined) {
                // 切到已有的那个，活动组不变：可能是在别的组的标签上点的。
                const current = tree.current.value;
                panelTabs.activate(twin.id);
                tree.setCurrent(current);
                const closed = remove(tabId);
                // 两个有一个固定就固定（输出 50）。
                if (isPinned(found.tab) && !isPinned(twin)) {
                    const located = locate(twin.id);
                    if (located !== null) repin(located, true);
                }
                return closed;
            }
            // 换编辑器丢掉光标与语言（输出 39），保留 preview 与固定。
            setTab({kind: "file", id: found.tab.id, address, editor, preview: found.tab.preview, ...(isPinned(found.tab) ? {pinned: true as const} : {})});
            return null;
        },
        setLanguage: (tabId, language) => {
            const found = locate(tabId);
            if (found === null || found.tab.kind === "page" || (found.tab.language ?? null) === language) return;
            const {language: _dropped, ...rest} = found.tab;
            setTab(language === null ? rest : {...rest, language});
        },
        setCursor: (tabId, cursor) => {
            const found = locate(tabId);
            if (found === null || found.tab.kind === "page" || !cursorFits(cursorKind(found.tab.editor), cursor) || sameCursor(found.tab.cursor, cursor)) return;
            setTab({...found.tab, cursor});
        },
        rebind: (from, to, kept = []) => {
            const follows = (address: string): boolean => isWithin(address, from) && !kept.includes(address);
            const next = new Map(attributes.value);
            for (const [id, tab] of attributes.value) if (follows(tab.address)) next.set(id, {...tab, address: rebase(tab.address, from, to)});
            attributes.value = next;
        },
        closeWithin: (addresses) => {
            const doomed = groups.value.flatMap((group) => group.tabs.filter((tab) => addresses.some((address) => isWithin(tab.address, address))));
            return doomed.flatMap((tab) => {
                const removed = remove(tab.id);
                return removed === null ? [] : [removed];
            });
        },
        snapshot: () => ({
            tabs: Object.fromEntries([...attributes.value].flatMap(([id, tab]): Array<[string, SavedTab]> => {
                // 丢了记录的占位不写：写成页面的话下次恢复就悄悄没了，原因只显示过一次。
                if (tab.address === LOST_TAB_ADDRESS) return [];
                if (tab.kind === "page") return [[id, {page: true}]];
                return [[id, {address: tab.address, editor: tab.editor, preview: tab.preview, ...(tab.pinned === true ? {pinned: true as const} : {}), ...(tab.cursor === undefined ? {} : {cursor: tab.cursor}), ...(tab.language === undefined ? {} : {language: tab.language})}]];
            })),
        }),
    };
}

/**
 * 按读到的记录恢复标签的属性（docs/specs/ui/workbench-layout.md 输出 34）。布局文档说了算：文档里没有的 `tabId` 不恢复；文档里有、记录里没有的显示占位；页面标签不恢复，从文档里拿掉。
 * 两条记录不是一次写的，崩在中间时固定与普通可能交错：按出现顺序把固定的排到前面。
 */
function restoreTabs(panels: EditorPanels, initial: TabsSnapshot | null, cursorKind: CursorKind): ReadonlyMap<string, EditorTab> {
    const attributes = new Map<string, EditorTab>();
    for (const panel of panels.tabs.panels.value) {
        for (const id of panel.tabs) {
            const saved = initial?.tabs[id];
            if (saved === undefined) attributes.set(id, {kind: "page", id, address: LOST_TAB_ADDRESS, preview: false});
            else if ("page" in saved) panels.tabs.remove(id);
            else attributes.set(id, restoredFile(id, saved, cursorKind));
        }
    }
    for (const panel of panels.tabs.panels.value) {
        const pinned = panel.tabs.filter((id) => {
            const tab = attributes.get(id);
            return tab !== undefined && isPinned(tab);
        });
        for (const [at, id] of pinned.entries()) panels.tabs.move(id, panel.id, at, {activate: false});
    }
    return attributes;
}

function restoredFile(id: string, saved: SavedFileTab, cursorKind: CursorKind): FileTab {
    // 固定的不是 preview：记录里两者都有时以固定为准。
    const tab: FileTab = {kind: "file", id, address: saved.address, editor: saved.editor, preview: saved.pinned === true ? false : saved.preview, ...(saved.pinned === true ? {pinned: true as const} : {}), ...(saved.language === undefined ? {} : {language: saved.language})};
    return saved.cursor !== undefined && cursorFits(cursorKind(saved.editor), saved.cursor) ? {...tab, cursor: saved.cursor} : tab;
}
