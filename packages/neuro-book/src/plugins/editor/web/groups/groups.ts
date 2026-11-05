/**
 * 编辑组与标签（docs/specs/workbench/editor.md 输出 1–5）：纯模型，不打开文档。组按 nb-ui 的 grid 排列（叶的引用是组
 * id），每组一列标签与活动标签；活动组是最近获得焦点或执行过打开的组。打开文档与释放引用由控制器按这里的结果做，
 * 所以每个会让标签消失的动作都返回消失的标签。
 */

import {shallowRef} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

// 只要 grid 的结构与快照，不要渲染器：`./grid` 不依赖 Vue 与 DOM，插件激活时就能用、Bun 里也能测。
import {createGrid} from "@notnotype/nb-layout";
import type {Grid, GridLeafInput, GridNode, GridSnapshot} from "@notnotype/nb-layout";

import {isWithin, rebase} from "../documents/address";

import type {TabCursor} from "../../shared/contracts";

export type {TabCursor} from "../../shared/contracts";

/**
 * 组与组之间的分隔线占 1px（与工作台的分隔线相同）。nb-ui 把 0px 的分隔线当作不可交互的接缝：不画线、不能拖，
 * 所以这里不能取 0。
 */
const GROUP_SASH_PX = 1;
/** 编辑组的最小尺寸：再窄放不下一个截断的标签与标题动作的“⋯”。 */
const GROUP_MIN_SIZE = {width: 220, height: 120} as const;

function groupLeaf(id: string): GridLeafInput<string> {
    return {kind: "leaf", id, ref: id, minimumSize: GROUP_MIN_SIZE};
}

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

export type GroupEdge = "left" | "right" | "top" | "bottom";

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
    readonly groups: Readonly<ShallowRef<ReadonlyArray<EditorGroup>>>;
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

/** 至少一组；记录坏了或组不对应布局时从一个空组开始。 */
export function createEditorGroups(initial: GroupsSnapshot | null = null, cursorKind: CursorKind = BUILTIN_CURSOR): EditorGroups {
    let nextId = 0;
    /** 新的组、分支与标签 id：跳过恢复出来的布局里已有的。 */
    const newId = (prefix: string): string => {
        for (;;) {
            nextId += 1;
            const id = `${prefix}${String(nextId)}`;
            if (restored === null || restored.grid.find(id) === null) return id;
        }
    };
    const restored = initial === null ? null : restore(initial, cursorKind);
    const grid = restored?.grid ?? createGrid<string>(groupLeaf("g0"), {sashSize: GROUP_SASH_PX});
    const groups = shallowRef<ReadonlyArray<EditorGroup>>(restored?.groups ?? [{id: "g0", tabs: [], active: null}]);
    const activeGroup = shallowRef(restored?.activeGroup ?? groups.value[0]?.id ?? "g0");
    const layoutVersion = shallowRef(0);

    const groupOf = (id: string): EditorGroup | undefined => groups.value.find((group) => group.id === id);
    const replace = (group: EditorGroup): void => {
        groups.value = groups.value.map((candidate) => (candidate.id === group.id ? group : candidate));
    };
    const locate = (tabId: string): {group: EditorGroup; tab: EditorTab; index: number} | null => {
        for (const group of groups.value) {
            const index = group.tabs.findIndex((tab) => tab.id === tabId);
            if (index >= 0) return {group, tab: group.tabs[index] as EditorTab, index};
        }
        return null;
    };

    /** 组空了且还有别的组：从布局与列表里去掉，活动组换到列表里的相邻组。 */
    const dropIfEmpty = (group: EditorGroup): void => {
        if (group.tabs.length > 0 || groups.value.length <= 1) return;
        const index = groups.value.findIndex((candidate) => candidate.id === group.id);
        const removed = grid.removeLeaf(group.id);
        if (!removed.ok) return;
        groups.value = groups.value.filter((candidate) => candidate.id !== group.id);
        layoutVersion.value += 1;
        if (activeGroup.value === group.id) activeGroup.value = (groups.value[Math.min(index, groups.value.length - 1)] as EditorGroup).id;
    };

    /** 插在组的活动标签之后、但不插进固定区（新标签不固定），成为活动标签。 */
    const insert = (group: EditorGroup, tab: EditorTab): void => {
        const at = group.tabs.findIndex((candidate) => candidate.id === group.active);
        const tabs = [...group.tabs];
        tabs.splice(at < 0 ? tabs.length : Math.max(at + 1, pinnedCount(tabs)), 0, tab);
        replace({...group, tabs, active: tab.id});
    };

    /** 从组里拿掉一个标签后的组（活动标签被拿掉时同 `remove` 换到相邻的），不落库。 */
    const without = (group: EditorGroup, index: number): EditorGroup => {
        const removed = group.tabs[index] as EditorTab;
        const tabs = group.tabs.filter((_, at) => at !== index);
        const active = group.active === removed.id ? ((tabs[index] ?? tabs[index - 1])?.id ?? null) : group.active;
        return {...group, tabs, active};
    };

    /** 移动后的标签：preview 转正，按目标区固定或取消固定。 */
    const placed = (tab: EditorTab, pinned: boolean): EditorTab => {
        if (tab.kind === "page") return tab;
        const {pinned: _old, ...rest} = tab;
        return pinned ? {...rest, preview: false, pinned: true} : {...rest, preview: false};
    };

    const remove = (tabId: string): EditorTab | null => {
        const found = locate(tabId);
        if (found === null) return null;
        const tabs = found.group.tabs.filter((tab) => tab.id !== tabId);
        let active = found.group.active;
        if (active === tabId) active = (tabs[found.index] ?? tabs[found.index - 1])?.id ?? null;
        const next = {...found.group, tabs, active};
        replace(next);
        dropIfEmpty(next);
        return found.tab;
    };

    return {
        groups,
        activeGroup,
        grid,
        layoutVersion,
        activeTab: () => {
            const group = groupOf(activeGroup.value);
            return group?.tabs.find((tab) => tab.id === group.active) ?? null;
        },
        find: (tabId) => {
            const found = locate(tabId);
            return found === null ? null : {group: found.group, tab: found.tab};
        },
        open: (address, options) => {
            const group = groupOf(options.group ?? activeGroup.value) ?? (groups.value[0] as EditorGroup);
            activeGroup.value = group.id;
            const reuse = options.reuse ?? ((tab: FileTab) => tab.editor === options.editor);
            const existing = group.tabs.find((tab): tab is FileTab => tab.kind === "file" && tab.address === address && reuse(tab));
            if (existing !== undefined) {
                const tab = options.mode === "permanent" && existing.preview ? {...existing, preview: false} : existing;
                replace({...group, tabs: group.tabs.map((candidate) => (candidate.id === existing.id ? tab : candidate)), active: tab.id});
                return {tab, replaced: null};
            }
            const tab: FileTab = {kind: "file", id: newId("t"), address, editor: options.editor, preview: options.mode === "preview"};
            const preview = options.mode === "preview" ? group.tabs.find((candidate) => candidate.preview) : undefined;
            if (preview !== undefined) {
                replace({...group, tabs: group.tabs.map((candidate) => (candidate.id === preview.id ? tab : candidate)), active: tab.id});
                return {tab, replaced: preview};
            }
            insert(group, tab);
            return {tab, replaced: null};
        },
        openPage: (address) => {
            const group = groupOf(activeGroup.value) ?? (groups.value[0] as EditorGroup);
            activeGroup.value = group.id;
            const tab: PageTab = {kind: "page", id: newId("t"), address, preview: false};
            insert(group, tab);
            return tab;
        },
        keep: (tabId) => {
            const found = locate(tabId);
            if (found === null || !found.tab.preview) return;
            replace({...found.group, tabs: found.group.tabs.map((tab) => (tab.id === tabId ? {...tab, preview: false} : tab))});
        },
        setPinned: (tabId, pinned) => {
            const found = locate(tabId);
            if (found === null || found.tab.kind === "page" || isPinned(found.tab) === pinned) return;
            const rest = found.group.tabs.filter((tab) => tab.id !== tabId);
            const tabs = [...rest];
            // 固定区末尾与普通区开头是同一个位置：拿掉它之后的分界处。
            tabs.splice(pinnedCount(rest), 0, placed(found.tab, pinned));
            replace({...found.group, tabs});
        },
        activate: (tabId) => {
            const found = locate(tabId);
            if (found === null) return;
            activeGroup.value = found.group.id;
            if (found.group.active !== tabId) replace({...found.group, active: tabId});
        },
        focusGroup: (groupId) => {
            if (groupOf(groupId) !== undefined) activeGroup.value = groupId;
        },
        close: (tabId) => remove(tabId),
        split: (tabId, direction) => {
            const found = locate(tabId);
            if (found === null || found.tab.kind === "page") return null;
            const id = newId("g");
            const result = grid.splitLeaf(found.group.id, {branchId: newId("b"), orientation: direction === "right" ? "horizontal" : "vertical", side: "after", leaf: groupLeaf(id)});
            if (!result.ok) return null;
            // 新组的视图从原标签记下的光标开始，语言也跟过去（输出 30、45）。
            const source = found.tab;
            const tab: FileTab = {kind: "file", id: newId("t"), address: source.address, editor: source.editor, preview: false, ...(source.cursor === undefined ? {} : {cursor: source.cursor}), ...(source.language === undefined ? {} : {language: source.language})};
            const index = groups.value.findIndex((group) => group.id === found.group.id);
            const next = [...groups.value];
            next.splice(index + 1, 0, {id, tabs: [tab], active: tab.id});
            groups.value = next;
            activeGroup.value = id;
            layoutVersion.value += 1;
            return tab;
        },
        rightOf: (groupId) => {
            const right = rightNeighbor(grid.root(), groupId);
            return right !== null && groupOf(right) !== undefined ? right : null;
        },
        sideGroup: () => {
            const right = rightNeighbor(grid.root(), activeGroup.value);
            if (right !== null && groupOf(right) !== undefined) return right;
            const id = newId("g");
            const result = grid.splitLeaf(activeGroup.value, {branchId: newId("b"), orientation: "horizontal", side: "after", leaf: groupLeaf(id)});
            if (!result.ok) return activeGroup.value;
            const index = groups.value.findIndex((group) => group.id === activeGroup.value);
            const next = [...groups.value];
            next.splice(index + 1, 0, {id, tabs: [], active: null});
            groups.value = next;
            layoutVersion.value += 1;
            return id;
        },
        move: (tabId, delta) => {
            const found = locate(tabId);
            if (found === null) return;
            const target = found.index + delta;
            const boundary = pinnedCount(found.group.tabs);
            const [low, high] = isPinned(found.tab) ? [0, boundary - 1] : [boundary, found.group.tabs.length - 1];
            if (target < low || target > high) return;
            const tabs = [...found.group.tabs];
            tabs.splice(found.index, 1);
            tabs.splice(target, 0, found.tab);
            replace({...found.group, tabs});
        },
        moveTab: (tabId, place) => {
            const found = locate(tabId);
            const target = groupOf(place.group);
            if (found === null || target === undefined) return null;
            if (place.partition === "pinned" && found.tab.kind === "page") return null;
            if (target.id !== found.group.id && target.tabs.some((tab) => tab.kind === "file" && found.tab.kind === "file" && tab.address === found.tab.address && tab.editor === found.tab.editor)) return null;
            // 目标组拿掉源标签之后的样子（同组时就是源组本身拿掉它）。
            const base = target.id === found.group.id ? without(found.group, found.index) : target;
            const boundary = pinnedCount(base.tabs);
            let at: number;
            if (place.before === null) at = place.partition === "pinned" ? boundary : base.tabs.length;
            else {
                at = base.tabs.findIndex((tab) => tab.id === place.before);
                if (at < 0 || (place.partition === "pinned") !== (at < boundary)) return null;
            }
            const tab = placed(found.tab, place.partition === "pinned");
            // 原位：同组、同区、位置没变。
            if (target.id === found.group.id && at === found.index && isPinned(found.tab) === isPinned(tab)) return null;
            const tabs = [...base.tabs];
            tabs.splice(at, 0, tab);
            const moved = {...base, tabs, active: tab.id};
            activeGroup.value = target.id;
            if (target.id === found.group.id) {
                replace(moved);
                return {tab, droppedGroup: null};
            }
            const source = without(found.group, found.index);
            replace(source);
            replace(moved);
            const before = groups.value.length;
            dropIfEmpty(source);
            return {tab, droppedGroup: groups.value.length < before ? source.id : null};
        },
        moveToNewGroup: (tabId, groupId, edge) => {
            const found = locate(tabId);
            if (found === null || groupOf(groupId) === undefined) return null;
            if (found.group.id === groupId && found.group.tabs.length === 1) return null;
            const id = newId("g");
            const result = grid.splitLeaf(groupId, {branchId: newId("b"), orientation: edge === "left" || edge === "right" ? "horizontal" : "vertical", side: edge === "left" || edge === "top" ? "before" : "after", leaf: groupLeaf(id)});
            if (!result.ok) return null;
            const tab = placed(found.tab, false);
            const source = without(found.group, found.index);
            replace(source);
            const index = groups.value.findIndex((group) => group.id === groupId);
            const next = [...groups.value];
            next.splice(edge === "left" || edge === "top" ? index : index + 1, 0, {id, tabs: [tab], active: tab.id});
            groups.value = next;
            activeGroup.value = id;
            layoutVersion.value += 1;
            const before = groups.value.length;
            dropIfEmpty(source);
            return {tab, group: id, droppedGroup: groups.value.length < before ? source.id : null};
        },
        setEditor: (tabId, editor) => {
            const found = locate(tabId);
            if (found === null || found.tab.kind === "page" || found.tab.editor === editor) return null;
            const address = found.tab.address;
            const twin = found.group.tabs.find((tab) => tab.kind === "file" && tab.id !== tabId && tab.address === address && tab.editor === editor);
            if (twin !== undefined) {
                replace({...found.group, active: twin.id});
                const closed = remove(tabId);
                // 两个有一个固定就固定（输出 50）。
                if (isPinned(found.tab) && !isPinned(twin)) {
                    const group = locate(twin.id)?.group;
                    if (group !== undefined) {
                        const rest = group.tabs.filter((tab) => tab.id !== twin.id);
                        const tabs = [...rest];
                        tabs.splice(pinnedCount(rest), 0, placed(twin, true));
                        replace({...group, tabs});
                    }
                }
                return closed;
            }
            // 换编辑器丢掉光标与语言（输出 39），保留 preview 与固定。
            replace({...found.group, tabs: found.group.tabs.map((tab): EditorTab => (tab.id === tabId ? {kind: "file", id: tab.id, address, editor, preview: tab.preview, ...(isPinned(tab) ? {pinned: true as const} : {})} : tab))});
            return null;
        },
        setLanguage: (tabId, language) => {
            const found = locate(tabId);
            if (found === null || found.tab.kind === "page" || (found.tab.language ?? null) === language) return;
            replace({...found.group, tabs: found.group.tabs.map((tab): EditorTab => {
                if (tab.id !== tabId || tab.kind === "page") return tab;
                const {language: _dropped, ...rest} = tab;
                return language === null ? rest : {...rest, language};
            })});
        },
        setCursor: (tabId, cursor) => {
            const found = locate(tabId);
            if (found === null || found.tab.kind === "page" || !cursorFits(cursorKind(found.tab.editor), cursor) || sameCursor(found.tab.cursor, cursor)) return;
            replace({...found.group, tabs: found.group.tabs.map((tab) => (tab.id === tabId ? {...tab, cursor} : tab))});
        },
        rebind: (from, to, kept = []) => {
            const follows = (address: string): boolean => isWithin(address, from) && !kept.includes(address);
            groups.value = groups.value.map((group) => (group.tabs.some((tab) => follows(tab.address))
                ? {...group, tabs: group.tabs.map((tab) => (follows(tab.address) ? {...tab, address: rebase(tab.address, from, to)} : tab))}
                : group));
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
            activeGroup: activeGroup.value,
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

/**
 * 叶 `id` 右侧相邻的叶：自下而上找第一个横向分支里它后面还有兄弟的祖先，再从那个兄弟里取最左（横向取第一个、纵向取第一个）
 * 的叶。没有右侧的组时为 null。
 */
function rightNeighbor(root: GridNode<string> | null, id: string): string | null {
    const path: GridNode<string>[] = [];
    const walk = (node: GridNode<string>): boolean => {
        path.push(node);
        if (node.kind === "leaf" ? node.id === id : node.children.some(walk)) return true;
        path.pop();
        return false;
    };
    if (root === null || !walk(root)) return null;
    for (let at = path.length - 2; at >= 0; at -= 1) {
        const branch = path[at] as GridNode<string>;
        if (branch.kind !== "branch" || branch.orientation !== "horizontal") continue;
        const index = branch.children.indexOf(path[at + 1] as GridNode<string>);
        let next = branch.children[index + 1];
        if (next === undefined) continue;
        while (next.kind === "branch") next = next.children[0] as GridNode<string>;
        return next.id;
    }
    return null;
}

/** 从记录恢复：布局的叶与组一一对应、活动组存在才接受；否则返回 null，从一个空组开始。 */
function restore(snapshot: GroupsSnapshot, cursorKind: CursorKind): {grid: Grid<string>; groups: EditorGroup[]; activeGroup: string} | null {
    const ids = new Set(snapshot.groups.map((group) => group.id));
    if (ids.size !== snapshot.groups.length || ids.size === 0 || !ids.has(snapshot.activeGroup)) return null;
    const grid = createGrid<string>(null, {sashSize: GROUP_SASH_PX});
    const restored = grid.restore(snapshot.layout, (ref) => (ids.has(ref) ? {ref, minimumSize: GROUP_MIN_SIZE} : null));
    if (!restored.ok || restored.dropped.length > 0) return null;
    // 渲染按叶的 id 找组：叶的 id 与 ref 不一致的记录同样当作坏了。
    const leaves = leafNodesOf(grid.root());
    if (leaves.length !== ids.size || leaves.some((leaf) => leaf.id !== leaf.ref || !ids.has(leaf.ref))) return null;
    let tab = 0;
    const groups = snapshot.groups.map((group): EditorGroup => {
        const all = group.tabs.map((saved): EditorTab => {
            tab += 1;
            // 固定的不是 preview：记录里两者都有时以固定为准。
            const restored: FileTab = {kind: "file", id: `r${String(tab)}`, address: saved.address, editor: saved.editor, preview: saved.pinned === true ? false : saved.preview, ...(saved.pinned === true ? {pinned: true as const} : {}), ...(saved.language === undefined ? {} : {language: saved.language})};
            return saved.cursor !== undefined && cursorFits(cursorKind(saved.editor), saved.cursor) ? {...restored, cursor: saved.cursor} : restored;
        });
        // 记录里固定与普通交错时，按出现顺序把固定的排到前面；活动项按标签身份找，不受换位影响。
        const tabs = [...all.filter(isPinned), ...all.filter((candidate) => !isPinned(candidate))];
        const active = group.active === null ? null : (all[group.active]?.id ?? tabs[0]?.id ?? null);
        return {id: group.id, tabs, active};
    });
    return {grid, groups, activeGroup: snapshot.activeGroup};
}

function leafNodesOf(node: GridNode<string> | null): Array<{readonly id: string; readonly ref: string}> {
    if (node === null) return [];
    if (node.kind === "leaf") return [{id: node.id, ref: node.ref}];
    return node.children.flatMap(leafNodesOf);
}
