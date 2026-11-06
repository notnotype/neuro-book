/**
 * 编辑组与标签（docs/specs/workbench/editor.md 输出 1–5）：纯模型，不打开文档。标签的属性（地址、编辑器、preview、固定、光标、语言）在这里，标签在哪块面板、面板怎么排经
 * `panels.ts` 的接缝；活动组是最近获得焦点或执行过打开的组。打开文档与释放引用由控制器按这里的结果做，所以每个会让标签消失的动作都返回消失的标签。
 */

import {computed, shallowRef} from "@vue/reactivity";
import type {Ref, ShallowRef} from "@vue/reactivity";

import type {Grid, GridDropRect, GridSnapshot} from "@notnotype/nb-layout";

import {isWithin, rebase} from "../documents/address";
import {createLocalPanels, restorePanelGrid} from "./panels";
import type {LocalPanelsSeed, PanelCanInsert, PanelEdge} from "./panels";

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

export type GroupEdge = PanelEdge;

/** 差不到这么多算贴着：组之间的分隔线 1px 加取整。 */
const EDGE_TOLERANCE_PX = 2;

/**
 * 只有一个标签的 `source` 组移到 `target` 组的 `edge` 边上，结果还是现在的样子吗（docs/specs/workbench/editor.md 输出 55 的原位）：它已经紧贴
 * 这条边，交叉轴也一样长。交叉轴不一样长时，新组只占目标那一段，结果不同，不算。矩形是这一刻量出来的。
 */
export function sitsAtEdge(target: GridDropRect, source: GridDropRect, edge: GroupEdge): boolean {
    const near = (left: number, right: number): boolean => Math.abs(left - right) <= EDGE_TOLERANCE_PX;
    if (edge === "left" || edge === "right") {
        const touching = edge === "right" ? near(source.left, target.right) : near(source.right, target.left);
        return touching && near(source.top, target.top) && near(source.bottom, target.bottom);
    }
    const touching = edge === "bottom" ? near(source.top, target.bottom) : near(source.bottom, target.top);
    return touching && near(source.left, target.left) && near(source.right, target.right);
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
}

/** 存进记录的形状：布局是 grid 快照，标签只有地址、编辑器、preview、固定、上次的光标与语言。 */
export interface GroupsSnapshot {
    readonly layout: GridSnapshot;
    readonly groups: ReadonlyArray<{readonly id: string; readonly tabs: ReadonlyArray<{readonly address: string; readonly editor: string; readonly preview: boolean; readonly pinned?: true; readonly cursor?: TabCursor; readonly language?: string}>; readonly active: number | null}>;
    readonly activeGroup: string;
}

export type SplitDirection = "right" | "down";

export interface EditorGroups {
    readonly groups: Readonly<Ref<ReadonlyArray<EditorGroup>>>;
    readonly activeGroup: Readonly<ShallowRef<string>>;
    /** 布局的 grid；结构变化时 `layoutVersion` 加一。 */
    readonly grid: Grid<string>;
    readonly layoutVersion: Readonly<ShallowRef<number>>;
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
    /** 在 `group` 的一边拆出新组并把标签移过去（转正、不固定）。源组只有这一个标签且就是 `group` 时不变，返回 null。 */
    moveToNewGroup(tabId: string, group: string, edge: GroupEdge): {readonly tab: EditorTab; readonly group: string; readonly droppedGroup: string | null} | null;
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
    snapshot(): GroupsSnapshot;
}

/** 默认的光标写法：只认内置的两个编辑器（测试与没有编辑器目录的场合）。 */
const BUILTIN_CURSOR: CursorKind = (editor) => (editor === "nbook.editor.markdown" ? "offset" : editor === "nbook.editor.code" ? "line" : null);

/** 两份列表的项都是同一个对象吗。 */
const sameItems = <T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>): boolean => left.length === right.length && left.every((item, index) => item === right[index]);

/** 至少一组；记录坏了或组不对应布局时从一个空组开始。 */
export function createEditorGroups(initial: GroupsSnapshot | null = null, cursorKind: CursorKind = BUILTIN_CURSOR): EditorGroups {
    const restored = initial === null ? null : restore(initial, cursorKind);
    /** 标签的属性。结构（标签在哪、活动的是谁）在接缝后面，两边只靠 id 对上。 */
    const attributes = shallowRef<ReadonlyMap<string, EditorTab>>(restored?.attributes ?? new Map());
    const pinnedIn = (ids: ReadonlyArray<string>): number => pinnedCount(ids.flatMap((id) => attributes.value.get(id) ?? []));

    /** 固定的排在普通的前面（输出 50）。 */
    const canInsert: PanelCanInsert = (tabId, panel, at) => {
        const tab = attributes.value.get(tabId);
        if (tab === undefined) return false;
        const boundary = pinnedIn(panel.tabs.filter((id) => id !== tabId));
        return isPinned(tab) ? at <= boundary : at >= boundary;
    };
    const {tabs: panelTabs, tree, grid, layoutVersion} = createLocalPanels(restored?.seed ?? null, canInsert);

    /**
     * 结构和属性合成的组。没变的组和标签保持同一个对象：光标一动属性就变，别的组不该跟着重新渲染。
     */
    let joined: ReadonlyArray<EditorGroup> = [];
    const groups = computed<ReadonlyArray<EditorGroup>>(() => {
        const next = panelTabs.panels.value.map((panel): EditorGroup => {
            const tabs = panel.tabs.flatMap((id) => attributes.value.get(id) ?? []);
            const previous = joined.find((group) => group.id === panel.id);
            return previous !== undefined && previous.active === panel.active && sameItems(previous.tabs, tabs) ? previous : {id: panel.id, tabs, active: panel.active};
        });
        if (!sameItems(joined, next)) joined = next;
        return joined;
    });

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
        activeGroup: tree.current,
        grid,
        layoutVersion,
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
        moveToNewGroup: (tabId, groupId, edge) => {
            const found = locate(tabId);
            if (found === null || groupOf(groupId) === undefined) return null;
            if (found.group.id === groupId && found.group.tabs.length === 1) return null;
            const id = tree.openAtEdge(groupId, edge);
            if (id === null) return null;
            const tab = placed(found.tab, false);
            if (!moveWith(found, tab, id, 0)) return null;
            return {tab, group: id, droppedGroup: groupOf(found.group.id) === undefined ? found.group.id : null};
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
            layout: grid.serialize(),
            groups: groups.value.map((group) => ({
                id: group.id,
                tabs: filesOf(group).map((tab) => ({address: tab.address, editor: tab.editor, preview: tab.preview, ...(tab.pinned === true ? {pinned: true as const} : {}), ...(tab.cursor === undefined ? {} : {cursor: tab.cursor}), ...(tab.language === undefined ? {} : {language: tab.language})})),
                active: activeFileIndex(group),
            })),
            activeGroup: tree.current.value,
        }),
    };
}

/** 组里打开文件的标签：页面标签不进会话记录（输出 33）。 */
function filesOf(group: EditorGroup): FileTab[] {
    return group.tabs.filter((tab): tab is FileTab => tab.kind === "file");
}

/** 记录里的活动项：活动的是页面时取它左边最近的文件标签，没有就取右边的；组里没有文件标签为 null。 */
function activeFileIndex(group: EditorGroup): number | null {
    const files = filesOf(group);
    const at = group.tabs.findIndex((tab) => tab.id === group.active);
    if (at < 0) return null;
    const nearest = [...group.tabs.slice(0, at + 1)].reverse().find((tab) => tab.kind === "file") ?? group.tabs.slice(at).find((tab) => tab.kind === "file");
    return nearest === undefined ? null : files.findIndex((tab) => tab.id === nearest.id);
}

/** 从记录恢复：布局的叶与组一一对应、活动组存在才接受；否则返回 null，从一个空组开始。 */
function restore(snapshot: GroupsSnapshot, cursorKind: CursorKind): {readonly seed: LocalPanelsSeed; readonly attributes: ReadonlyMap<string, EditorTab>} | null {
    const ids = new Set(snapshot.groups.map((group) => group.id));
    if (ids.size !== snapshot.groups.length || ids.size === 0 || !ids.has(snapshot.activeGroup)) return null;
    const grid = restorePanelGrid(snapshot.layout, ids);
    if (grid === null) return null;
    const attributes = new Map<string, EditorTab>();
    const panels = snapshot.groups.map((group) => {
        const all = group.tabs.map((saved): EditorTab => {
            // 固定的不是 preview：记录里两者都有时以固定为准。
            const tab: FileTab = {kind: "file", id: newTabId(), address: saved.address, editor: saved.editor, preview: saved.pinned === true ? false : saved.preview, ...(saved.pinned === true ? {pinned: true as const} : {}), ...(saved.language === undefined ? {} : {language: saved.language})};
            return saved.cursor !== undefined && cursorFits(cursorKind(saved.editor), saved.cursor) ? {...tab, cursor: saved.cursor} : tab;
        });
        // 记录里固定与普通交错时，按出现顺序把固定的排到前面；活动项按标签身份找，不受换位影响。
        const tabs = [...all.filter(isPinned), ...all.filter((candidate) => !isPinned(candidate))];
        for (const tab of tabs) attributes.set(tab.id, tab);
        return {id: group.id, tabs: tabs.map((tab) => tab.id), active: group.active === null ? null : (all[group.active]?.id ?? tabs[0]?.id ?? null)};
    });
    return {seed: {grid, panels, current: snapshot.activeGroup}, attributes};
}
