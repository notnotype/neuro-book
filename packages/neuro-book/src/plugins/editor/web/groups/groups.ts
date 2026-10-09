/**
 * 编辑组与标签（docs/specs/workbench/editor.md 输出 1–5）：纯模型，不打开文档。组按 nb-ui 的 grid 排列（叶的引用是组
 * id），每组一列标签与活动标签；活动组是最近获得焦点或执行过打开的组。打开文档与释放引用由控制器按这里的结果做，
 * 所以每个会让标签消失的动作都返回消失的标签。
 */

import {shallowRef} from "@vue/reactivity";
import type {ShallowRef} from "@vue/reactivity";

import {createGrid} from "@notnotype/nb-ui/layout";
import type {Grid, GridNode, GridSnapshot} from "@notnotype/nb-ui/layout";

import {isWithin, rebase} from "../documents/address";

export type EditorKind = "markdown" | "code";

export interface EditorTab {
    readonly id: string;
    readonly address: string;
    readonly editor: EditorKind;
    readonly preview: boolean;
}

export interface EditorGroup {
    readonly id: string;
    readonly tabs: ReadonlyArray<EditorTab>;
    /** 活动标签的 id；空组为 null。 */
    readonly active: string | null;
}

/** 存进记录的形状：布局是 grid 快照，标签只有地址、编辑器与 preview。 */
export interface GroupsSnapshot {
    readonly layout: GridSnapshot;
    readonly groups: ReadonlyArray<{readonly id: string; readonly tabs: ReadonlyArray<{readonly address: string; readonly editor: EditorKind; readonly preview: boolean}>; readonly active: number | null}>;
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
     * 在组里打开（缺省活动组）：已在本组的只激活（`permanent` 时转正）；`preview` 替换本组已有的 preview 标签；否则插在
     * 活动标签之后。`replaced` 是被替换掉的 preview 标签。
     */
    open(address: string, options: {readonly mode: "preview" | "permanent"; readonly editor: EditorKind; readonly group?: string}): {readonly tab: EditorTab; readonly replaced: EditorTab | null};
    /** preview 转为 permanent。 */
    pin(tabId: string): void;
    activate(tabId: string): void;
    focusGroup(groupId: string): void;
    /** 关闭标签：同组激活右侧的（没有时左侧）；组空了且还有别的组时组随之关闭。返回被关的标签。 */
    close(tabId: string): EditorTab | null;
    closeOthers(tabId: string): ReadonlyArray<EditorTab>;
    /** 在标签所在组的右侧或下方新建组、打开同一文档（permanent），新组成为活动组。 */
    split(tabId: string, direction: SplitDirection): EditorTab | null;
    /** 同组里移动一位（键盘排序）。 */
    move(tabId: string, delta: -1 | 1): void;
    /** 用另一种编辑器打开同一标签。 */
    setEditor(tabId: string, editor: EditorKind): void;
    /** 地址改名或移动：标签跟到新地址。 */
    rebind(from: string, to: string): void;
    /** 关闭这些地址及其后代的标签，返回被关的标签。 */
    closeWithin(addresses: ReadonlyArray<string>): ReadonlyArray<EditorTab>;
    snapshot(): GroupsSnapshot;
}

/** 至少一组；记录坏了或组不对应布局时从一个空组开始。 */
export function createEditorGroups(initial: GroupsSnapshot | null = null): EditorGroups {
    let nextId = 0;
    /** 新的组、分支与标签 id：跳过恢复出来的布局里已有的。 */
    const newId = (prefix: string): string => {
        for (;;) {
            nextId += 1;
            const id = `${prefix}${String(nextId)}`;
            if (restored === null || restored.grid.find(id) === null) return id;
        }
    };
    const restored = initial === null ? null : restore(initial);
    const grid = restored?.grid ?? createGrid<string>({kind: "leaf", id: "g0", ref: "g0"});
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
            const existing = group.tabs.find((tab) => tab.address === address);
            if (existing !== undefined) {
                const tab = options.mode === "permanent" && existing.preview ? {...existing, preview: false} : existing;
                replace({...group, tabs: group.tabs.map((candidate) => (candidate.id === existing.id ? tab : candidate)), active: tab.id});
                return {tab, replaced: null};
            }
            const tab: EditorTab = {id: newId("t"), address, editor: options.editor, preview: options.mode === "preview"};
            const preview = options.mode === "preview" ? group.tabs.find((candidate) => candidate.preview) : undefined;
            if (preview !== undefined) {
                replace({...group, tabs: group.tabs.map((candidate) => (candidate.id === preview.id ? tab : candidate)), active: tab.id});
                return {tab, replaced: preview};
            }
            const at = group.tabs.findIndex((candidate) => candidate.id === group.active);
            const tabs = [...group.tabs];
            tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab);
            replace({...group, tabs, active: tab.id});
            return {tab, replaced: null};
        },
        pin: (tabId) => {
            const found = locate(tabId);
            if (found === null || !found.tab.preview) return;
            replace({...found.group, tabs: found.group.tabs.map((tab) => (tab.id === tabId ? {...tab, preview: false} : tab))});
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
        closeOthers: (tabId) => {
            const found = locate(tabId);
            if (found === null) return [];
            const closed = found.group.tabs.filter((tab) => tab.id !== tabId);
            replace({...found.group, tabs: [found.tab], active: tabId});
            return closed;
        },
        split: (tabId, direction) => {
            const found = locate(tabId);
            if (found === null) return null;
            const id = newId("g");
            const result = grid.splitLeaf(found.group.id, {branchId: newId("b"), orientation: direction === "right" ? "horizontal" : "vertical", side: "after", leaf: {kind: "leaf", id, ref: id}});
            if (!result.ok) return null;
            const tab: EditorTab = {id: newId("t"), address: found.tab.address, editor: found.tab.editor, preview: false};
            const index = groups.value.findIndex((group) => group.id === found.group.id);
            const next = [...groups.value];
            next.splice(index + 1, 0, {id, tabs: [tab], active: tab.id});
            groups.value = next;
            activeGroup.value = id;
            layoutVersion.value += 1;
            return tab;
        },
        move: (tabId, delta) => {
            const found = locate(tabId);
            if (found === null) return;
            const target = found.index + delta;
            if (target < 0 || target >= found.group.tabs.length) return;
            const tabs = [...found.group.tabs];
            tabs.splice(found.index, 1);
            tabs.splice(target, 0, found.tab);
            replace({...found.group, tabs});
        },
        setEditor: (tabId, editor) => {
            const found = locate(tabId);
            if (found === null || found.tab.editor === editor) return;
            replace({...found.group, tabs: found.group.tabs.map((tab) => (tab.id === tabId ? {...tab, editor} : tab))});
        },
        rebind: (from, to) => {
            groups.value = groups.value.map((group) => (group.tabs.some((tab) => isWithin(tab.address, from))
                ? {...group, tabs: group.tabs.map((tab) => (isWithin(tab.address, from) ? {...tab, address: rebase(tab.address, from, to)} : tab))}
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
                tabs: group.tabs.map((tab) => ({address: tab.address, editor: tab.editor, preview: tab.preview})),
                active: group.active === null ? null : group.tabs.findIndex((tab) => tab.id === group.active),
            })),
            activeGroup: activeGroup.value,
        }),
    };
}

/** 从记录恢复：布局的叶与组一一对应、活动组存在才接受；否则返回 null，从一个空组开始。 */
function restore(snapshot: GroupsSnapshot): {grid: Grid<string>; groups: EditorGroup[]; activeGroup: string} | null {
    const ids = new Set(snapshot.groups.map((group) => group.id));
    if (ids.size !== snapshot.groups.length || ids.size === 0 || !ids.has(snapshot.activeGroup)) return null;
    const grid = createGrid<string>(null);
    const restored = grid.restore(snapshot.layout, (ref) => (ids.has(ref) ? {ref} : null));
    if (!restored.ok || restored.dropped.length > 0) return null;
    const leaves = leavesOf(grid.root());
    if (leaves.length !== ids.size || leaves.some((leaf) => !ids.has(leaf))) return null;
    let tab = 0;
    const groups = snapshot.groups.map((group): EditorGroup => {
        const tabs = group.tabs.map((saved): EditorTab => {
            tab += 1;
            return {id: `r${String(tab)}`, address: saved.address, editor: saved.editor, preview: saved.preview};
        });
        const active = group.active === null ? null : (tabs[group.active]?.id ?? tabs[0]?.id ?? null);
        return {id: group.id, tabs, active};
    });
    return {grid, groups, activeGroup: snapshot.activeGroup};
}

function leavesOf(node: GridNode<string> | null): string[] {
    if (node === null) return [];
    if (node.kind === "leaf") return [node.ref];
    return node.children.flatMap(leavesOf);
}
