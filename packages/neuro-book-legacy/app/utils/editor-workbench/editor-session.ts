/**
 * 编辑工作台的**会话操作边界**：组集合、标签实例与布局树的一致状态。
 *
 * 与 `editor-groups.ts` 的分工：那里只有几何词汇（方向 → 轴/侧、分屏与关闭原语、手势落账），
 * 这里持有产品会话——"哪个组开着哪些标签、哪个是活动标签、哪个组是活动组"——并把
 * **结构操作与标签操作合成一次原子提交**。宿主（Store）只保存本模块返回的状态，
 * 不另存可独立修改的树副本或零散 ref。
 *
 * 三条不变量（`validateEditorSession` 逐条检查，恢复记录时也走它）：
 * 1. 组 id 唯一，且与布局树叶一一对应（顺序即深度优先渲染顺序）；
 * 2. 组内 `path` 唯一；不同组可以显示同一文档（同一份正文缓冲，两个标签实例）；
 * 3. `activePath` 属于该组或为空串；`activeGroupId` 属于组集合。
 *
 * 标签实例身份是 `(groupId, path)`：`editorId`（用哪个视图呈现）、`pinned`、`preview` 逐实例拥有；
 * **dirty 不在这里**——它从共用正文缓冲投影，见 Store 的 `workspaceTabs`。
 *
 * 所有操作都是纯函数：先在候选上校验，失败返回原因且不改任何东西；成功返回新状态与
 * `evicted`（本次操作后**再没有任何标签引用**的路径），由宿主决定释放 documentId / 缓冲。
 * 布局树是可变实例（nb-ui 原语的合同是单次原子操作），结构变化只发生在这些事务内部，
 * 失败时原语自身保证不改树。
 */

import {
    createGrid,
    type Grid,
    type GridNode,
    type GridSnapshot,
} from "@notnotype/nb-ui/layout";
import {
    createEditorGrid,
    editorGroupIds,
    removeEditorGroup,
    splitEditorGroup,
} from "nbook/app/utils/editor-workbench/editor-groups";
import type {EditorSplitDirection} from "nbook/app/components/editor-workbench/editor-view.types";

/** 一个标签实例；同一 (group,path) 在组内最多一项。 */
export type EditorSessionTab = {
    path: string;
    title: string;
    editorId: string | null;
    pinned: boolean;
    preview: boolean;
};

/** 一个编辑组；`tabs` 的顺序就是该组的呈现顺序（pin 分区由顺序表达）。 */
export type EditorSessionGroup = {
    id: string;
    activePath: string;
    tabs: EditorSessionTab[];
};

export type EditorSessionState = {
    groups: EditorSessionGroup[];
    activeGroupId: string;
};

/**
 * 事务需要的宿主事实。
 *
 * `canEvictPreview`：被 preview 顶替的标签能否直接丢弃。dirty 或有未解决输入的标签不能，
 * 只能转为常驻（这条规则属于宿主，不在纯模块里猜）。
 */
export type EditorSessionContext = {
    canEvictPreview(path: string): boolean;
};

export type EditorSessionOutcome =
    | {ok: true; state: EditorSessionState; evicted: readonly string[]}
    | {ok: false; reason: string};

function succeed(state: EditorSessionState, evicted: readonly string[] = []): EditorSessionOutcome {
    return {ok: true, state, evicted};
}

function fail(reason: string): EditorSessionOutcome {
    return {ok: false, reason};
}

function cloneTab(tab: EditorSessionTab): EditorSessionTab {
    return {...tab};
}

function cloneGroup(group: EditorSessionGroup): EditorSessionGroup {
    return {id: group.id, activePath: group.activePath, tabs: group.tabs.map(cloneTab)};
}

/** 状态的可变副本：事务在副本上改，成功后整体发布（调用方看到的是新对象）。 */
function draft(state: EditorSessionState): EditorSessionState {
    return {groups: state.groups.map(cloneGroup), activeGroupId: state.activeGroupId};
}

/** 新建会话：组集合来自布局树叶，活动组是第一片叶。 */
export function createEditorSession(grid: Grid<string>): EditorSessionState {
    const ids = editorGroupIds(grid);
    return {groups: ids.map((id) => ({id, activePath: "", tabs: []})), activeGroupId: ids[0] ?? ""};
}

/** 组集合（深度优先，与渲染顺序一致）。 */
export function editorSessionGroupIds(state: EditorSessionState): string[] {
    return state.groups.map((group) => group.id);
}

export function findEditorSessionGroup(state: EditorSessionState, groupId: string): EditorSessionGroup | null {
    return state.groups.find((group) => group.id === groupId) ?? null;
}

export function findEditorSessionTab(state: EditorSessionState, groupId: string, path: string): EditorSessionTab | null {
    return findEditorSessionGroup(state, groupId)?.tabs.find((tab) => tab.path === path) ?? null;
}

/** 引用某路径的全部标签实例（跨组）。 */
export function editorSessionTabsForPath(state: EditorSessionState, path: string): readonly EditorSessionTab[] {
    return state.groups.flatMap((group) => group.tabs.filter((tab) => tab.path === path));
}

/** 某路径是否还有其它标签实例（用于"最后引用才释放缓冲"）。 */
export function editorSessionPathReferenced(state: EditorSessionState, path: string): boolean {
    return state.groups.some((group) => group.tabs.some((tab) => tab.path === path));
}

/** 候选状态里某路径的引用计数（事务内部用；发布前先算 evicted）。 */
function referencedIn(state: EditorSessionState, path: string): boolean {
    return editorSessionPathReferenced(state, path);
}

function evictedAfter(before: EditorSessionState, after: EditorSessionState, candidates: readonly string[]): string[] {
    const evicted: string[] = [];
    for (const path of new Set(candidates)) {
        if (referencedIn(before, path) && !referencedIn(after, path)) {
            evicted.push(path);
        }
    }
    return evicted;
}

/**
 * 组集合的顺序**必须等于布局树的叶序**（渲染顺序、后续记录恢复都按它对齐）。
 * 组装完候选组集合后统一过这一道，而不是在每个事务里手算插入位置。
 */
function syncGroupOrder(grid: Grid<string>, groups: readonly EditorSessionGroup[]): EditorSessionGroup[] {
    return editorGroupIds(grid)
        .map((id) => groups.find((group) => group.id === id))
        .filter((group): group is EditorSessionGroup => group !== undefined);
}

/**
 * 在目标组打开（或激活）一个标签。
 *
 * - 组内已有同路径：更新标题/编辑器选择并激活，preview 按本次打开模式收口；
 * - 新标签：`mode='preview'` 时顶替**本组内**可丢弃的 preview（跨组不受影响），
 *   不可丢弃的 preview 转为常驻；
 * - 不同组之间的同路径是两件标签实例，各自独立。
 */
export function openTabInGroup(
    state: EditorSessionState,
    input: Readonly<{groupId: string; path: string; title: string; editorId?: string | null; mode: "preview" | "permanent"}>,
    context: EditorSessionContext,
): EditorSessionOutcome {
    const group = findEditorSessionGroup(state, input.groupId);
    if (!group) {
        return fail(`未知编辑组：${input.groupId}`);
    }
    if (!input.path) {
        return fail("空路径不能打开标签");
    }
    const next = draft(state);
    const target = next.groups.find((item) => item.id === input.groupId)!;
    const existing = target.tabs.find((tab) => tab.path === input.path);
    const evictedCandidates: string[] = [];
    if (existing) {
        existing.title = input.title || existing.title;
        if (input.editorId !== undefined) {
            existing.editorId = input.editorId;
        }
        existing.preview = input.mode === "preview" ? existing.pinned ? false : existing.preview : false;
        target.activePath = input.path;
        return succeed(next, evictedAfter(state, next, evictedCandidates));
    }

    const preview = input.mode === "preview";
    if (preview) {
        for (const tab of target.tabs) {
            if (!tab.preview || tab.path === input.path) {
                continue;
            }
            if (context.canEvictPreview(tab.path)) {
                evictedCandidates.push(tab.path);
                target.tabs = target.tabs.filter((item) => item !== tab);
            } else {
                // dirty 或有未解决输入：不能作为"干净 preview"被顶替，转常驻。
                tab.preview = false;
            }
        }
    }
    const instance: EditorSessionTab = {
        path: input.path,
        title: input.title || input.path,
        editorId: input.editorId ?? null,
        pinned: false,
        preview,
    };
    // 与既有交互一致：新标签追加到组内末尾（pin 分区在组内是前缀，末尾即普通分区末尾）。
    target.tabs.push(instance);
    target.activePath = input.path;
    return succeed(next, evictedAfter(state, next, evictedCandidates));
}

/** 激活组内标签；目标不存在时拒绝（调用方先打开）。 */
export function activateTab(state: EditorSessionState, groupId: string, path: string): EditorSessionOutcome {
    const group = findEditorSessionGroup(state, groupId);
    if (!group) {
        return fail(`未知编辑组：${groupId}`);
    }
    if (!group.tabs.some((tab) => tab.path === path)) {
        return fail(`组 ${groupId} 没有标签：${path}`);
    }
    const next = draft(state);
    next.groups.find((item) => item.id === groupId)!.activePath = path;
    return succeed(next);
}

/** 更新标签实例字段（编辑器选择 / 固定 / preview 收口 / 标题）。 */
export function updateTabInstance(
    state: EditorSessionState,
    groupId: string,
    path: string,
    patch: Readonly<Partial<Pick<EditorSessionTab, "title" | "editorId" | "pinned" | "preview">>>,
): EditorSessionOutcome {
    const group = findEditorSessionGroup(state, groupId);
    if (!group?.tabs.some((tab) => tab.path === path)) {
        return fail(`组 ${groupId} 没有标签：${path}`);
    }
    const next = draft(state);
    const tab = next.groups.find((item) => item.id === groupId)!.tabs.find((item) => item.path === path)!;
    Object.assign(tab, patch);
    if (tab.pinned) {
        tab.preview = false;
    }
    return succeed(next);
}

/**
 * 组内重排。`targetPath` 为空表示投放到目标分区末尾；`targetPinned` 决定 pin 分区归属
 * （拖到 pin 区外侧即"加入 pin 分区"，与既有交互一致）。
 */
export function reorderTab(
    state: EditorSessionState,
    groupId: string,
    path: string,
    targetPath: string | null,
    targetPinned: boolean,
    position: "before" | "after",
): EditorSessionOutcome {
    const group = findEditorSessionGroup(state, groupId);
    if (!group) {
        return fail(`未知编辑组：${groupId}`);
    }
    if (!group.tabs.some((tab) => tab.path === path)) {
        return fail(`组 ${groupId} 没有标签：${path}`);
    }
    const next = draft(state);
    const target = next.groups.find((item) => item.id === groupId)!;
    const moving = target.tabs.find((tab) => tab.path === path)!;
    const rest = target.tabs.filter((tab) => tab.path !== path);
    moving.pinned = targetPinned;
    // 拖动是"我就要它在这个位置"的明确动作：preview 因此转常驻，与 VS Code 的拖放语义一致。
    moving.preview = false;
    const targetIndex = targetPath ? rest.findIndex((tab) => tab.path === targetPath) : -1;
    if (targetIndex >= 0) {
        rest.splice(position === "before" ? targetIndex : targetIndex + 1, 0, moving);
    } else {
        const lastPartition = rest.reduce((lastIndex, tab, index) => tab.pinned === targetPinned ? index : lastIndex, -1);
        rest.splice(lastPartition + 1, 0, moving);
    }
    target.tabs = rest;
    return succeed(next);
}

/**
 * 移除一个标签实例；组空且还有别组时塌陷该叶（几何原语负责把幸存者顶替上去）。
 * `evicted` 是"移除后再无引用"的路径；dirty 文档是否保留缓冲由宿主的既有规则决定。
 */
export function removeTab(
    grid: Grid<string>,
    state: EditorSessionState,
    groupId: string,
    path: string,
): EditorSessionOutcome {
    const group = findEditorSessionGroup(state, groupId);
    if (!group?.tabs.some((tab) => tab.path === path)) {
        return fail(`组 ${groupId} 没有标签：${path}`);
    }
    const next = draft(state);
    const target = next.groups.find((item) => item.id === groupId)!;
    target.tabs = target.tabs.filter((tab) => tab.path !== path);
    if (target.activePath === path) {
        target.activePath = target.tabs[Math.max(0, target.tabs.length - 1)]?.path ?? "";
    }
    const collapsed = collapseIfEmpty(grid, next, groupId);
    const synced = {groups: syncGroupOrder(grid, collapsed.state.groups), activeGroupId: collapsed.state.activeGroupId};
    return succeed(synced, evictedAfter(state, synced, [path]));
}

/** 空组塌陷：几何叶移除 + 组集合同步；活动组落到相邻组。 */
function collapseIfEmpty(
    grid: Grid<string>,
    state: EditorSessionState,
    groupId: string,
): {state: EditorSessionState; collapsed: boolean} {
    const group = findEditorSessionGroup(state, groupId);
    if (!group || group.tabs.length > 0 || state.groups.length <= 1) {
        return {state, collapsed: false};
    }
    const before = editorSessionGroupIds(state);
    const index = before.indexOf(groupId);
    const removed = removeEditorGroup(grid, groupId);
    if (!removed.ok) {
        return {state, collapsed: false};
    }
    const groups = state.groups.filter((item) => item.id !== groupId);
    const fallback = groups[Math.min(Math.max(index - 1, 0), groups.length - 1)]?.id ?? "";
    return {
        state: {
            groups,
            activeGroupId: state.activeGroupId === groupId ? fallback : state.activeGroupId,
        },
        collapsed: true,
    };
}

/** 选择活动组；未知组拒绝。 */
export function selectActiveGroup(state: EditorSessionState, groupId: string): EditorSessionOutcome {
    if (!findEditorSessionGroup(state, groupId)) {
        return fail(`未知编辑组：${groupId}`);
    }
    return succeed({groups: state.groups.map(cloneGroup), activeGroupId: groupId});
}

/**
 * 分屏：把 `path` 以 `copy`（复制视图）或 `move`（搬走标签）放到目标组旁的新组。
 *
 * 工具栏分屏是 `sourceGroupId === targetGroupId && mode === 'copy'`；把标签拖到组边缘是
 * `mode === 'move'`，源组若因此为空则塌陷。几何失败（未知目标、上限、重复 id）不产生任何变更。
 */
export function splitTabToNewGroup(
    grid: Grid<string>,
    state: EditorSessionState,
    input: Readonly<{
        sourceGroupId: string;
        targetGroupId: string;
        newGroupId: string;
        path: string;
        direction: EditorSplitDirection;
        mode: "copy" | "move";
    }>,
): EditorSessionOutcome {
    const source = findEditorSessionGroup(state, input.sourceGroupId);
    const target = findEditorSessionGroup(state, input.targetGroupId);
    if (!source || !target) {
        return fail(`未知编辑组：${input.sourceGroupId} / ${input.targetGroupId}`);
    }
    if (state.groups.some((group) => group.id === input.newGroupId)) {
        return fail(`编辑组已存在：${input.newGroupId}`);
    }
    const tab = source.tabs.find((item) => item.path === input.path);
    if (!tab) {
        return fail(`组 ${input.sourceGroupId} 没有标签：${input.path}`);
    }

    const geometry = splitEditorGroup(grid, input.targetGroupId, input.newGroupId, input.direction);
    if (!geometry.ok) {
        return fail(geometry.reason);
    }

    const next = draft(state);
    // 复制视图：正文同一份，实例选择沿用来源；复制出来的是常驻标签，避免两个 preview 互相顶替。
    const placed: EditorSessionTab = {...cloneTab(tab), preview: false};
    next.groups.push({id: input.newGroupId, activePath: input.path, tabs: [placed]});

    if (input.mode === "move") {
        const sourceGroup = next.groups.find((group) => group.id === input.sourceGroupId)!;
        sourceGroup.tabs = sourceGroup.tabs.filter((item) => item.path !== input.path);
        if (sourceGroup.activePath === input.path) {
            sourceGroup.activePath = sourceGroup.tabs[0]?.path ?? "";
        }
        const collapsed = collapseIfEmpty(grid, {groups: next.groups, activeGroupId: next.activeGroupId}, input.sourceGroupId);
        next.groups = collapsed.state.groups;
        next.activeGroupId = input.newGroupId;
    } else {
        next.activeGroupId = input.newGroupId;
    }
    next.groups = syncGroupOrder(grid, next.groups);
    return succeed(next, evictedAfter(state, next, input.mode === "move" ? [input.path] : []));
}

/**
 * 跨组移动（拖到目标组标签栏/正文中心）。目标组已有同路径时**不创建重复实例**：
 * 激活目标已有标签并删除来源引用，保留目标的 editorId/pinned/preview 状态。
 */
export function transferTab(
    grid: Grid<string>,
    state: EditorSessionState,
    input: Readonly<{
        sourceGroupId: string;
        targetGroupId: string;
        path: string;
        targetPath?: string | null;
        targetPinned?: boolean;
        position?: "before" | "after";
    }>,
): EditorSessionOutcome {
    const source = findEditorSessionGroup(state, input.sourceGroupId);
    const target = findEditorSessionGroup(state, input.targetGroupId);
    if (!source || !target) {
        return fail(`未知编辑组：${input.sourceGroupId} / ${input.targetGroupId}`);
    }
    const tab = source.tabs.find((item) => item.path === input.path);
    if (!tab) {
        return fail(`组 ${input.sourceGroupId} 没有标签：${input.path}`);
    }
    if (input.sourceGroupId === input.targetGroupId) {
        return fail("同组投放不是跨组移动（同组重排走 reorderTab）");
    }

    const next = draft(state);
    const sourceGroup = next.groups.find((group) => group.id === input.sourceGroupId)!;
    const targetGroup = next.groups.find((group) => group.id === input.targetGroupId)!;
    sourceGroup.tabs = sourceGroup.tabs.filter((item) => item.path !== input.path);
    if (sourceGroup.activePath === input.path) {
        sourceGroup.activePath = sourceGroup.tabs[0]?.path ?? "";
    }

    const existing = targetGroup.tabs.find((item) => item.path === input.path);
    if (existing) {
        existing.preview = false;
        targetGroup.activePath = input.path;
    } else {
        const moving = {...cloneTab(tab), preview: false, pinned: input.targetPinned ?? false};
        const targetIndex = input.targetPath ? targetGroup.tabs.findIndex((item) => item.path === input.targetPath) : -1;
        if (targetIndex >= 0) {
            const position = input.position ?? "after";
            targetGroup.tabs.splice(position === "before" ? targetIndex : targetIndex + 1, 0, moving);
        } else {
            const lastPartition = targetGroup.tabs.reduce(
                (lastIndex, item, index) => item.pinned === moving.pinned ? index : lastIndex,
                -1,
            );
            targetGroup.tabs.splice(lastPartition + 1, 0, moving);
        }
        targetGroup.activePath = input.path;
    }

    const collapsed = collapseIfEmpty(grid, next, input.sourceGroupId);
    const synced = {groups: syncGroupOrder(grid, collapsed.state.groups), activeGroupId: input.targetGroupId};
    return succeed(synced, evictedAfter(state, synced, [input.path]));
}

export type EditorSessionValidation = {ok: true} | {ok: false; issues: readonly string[]};

/** 逐条检查文件头的三条不变量。恢复记录与调试断言共用这一份判据。 */
export function validateEditorSession(state: EditorSessionState, grid: Grid<string>): EditorSessionValidation {
    const issues: string[] = [];
    const leaves = editorGroupIds(grid);
    const ids = editorSessionGroupIds(state);
    if (leaves.length !== ids.length || leaves.some((id, index) => id !== ids[index])) {
        issues.push(`布局叶与组集合不一致：叶 [${leaves.join(", ")}] / 组 [${ids.join(", ")}]`);
    }
    if (new Set(ids).size !== ids.length) {
        issues.push("组 id 重复");
    }
    if (!ids.includes(state.activeGroupId)) {
        issues.push(`活动组不在组集合里：${state.activeGroupId}`);
    }
    for (const group of state.groups) {
        const paths = group.tabs.map((tab) => tab.path);
        if (new Set(paths).size !== paths.length) {
            issues.push(`组 ${group.id} 内有重复路径`);
        }
        if (paths.filter((path) => group.tabs.find((tab) => tab.path === path)?.preview).length > 1) {
            issues.push(`组 ${group.id} 有多个 preview 标签`);
        }
        if (group.activePath && !paths.includes(group.activePath)) {
            issues.push(`组 ${group.id} 的活动标签不属于该组：${group.activePath}`);
        }
        for (const tab of group.tabs) {
            if (tab.preview && tab.pinned) {
                issues.push(`组 ${group.id} 的标签同时 preview 与 pinned：${tab.path}`);
            }
        }
    }
    return issues.length === 0 ? {ok: true} : {ok: false, issues};
}

/** 记录形状（与 `shared/storage/workbench-editor.ts` 同形）；序列化只保留需要持久化的字段。 */
export type EditorSessionRecord = {
    version: 1;
    grid: GridSnapshot;
    groups: Array<{id: string; activePath: string; tabs: Array<Pick<EditorSessionTab, "path" | "editorId" | "pinned" | "preview">>}>;
    activeGroupId: string;
};

export function serializeEditorSession(state: EditorSessionState, grid: Grid<string>): EditorSessionRecord {
    return {
        version: 1,
        grid: grid.serialize(),
        groups: state.groups.map((group) => ({
            id: group.id,
            activePath: group.activePath,
            tabs: group.tabs.map((tab) => ({path: tab.path, editorId: tab.editorId, pinned: tab.pinned, preview: tab.preview})),
        })),
        activeGroupId: state.activeGroupId,
    };
}

export type EditorSessionRestoreResult =
    | {ok: true; state: EditorSessionState; grid: Grid<string>; issues: readonly string[]}
    | {ok: false; reason: string; issues: readonly string[]};

/**
 * 从记录恢复会话。
 *
 * 树先由 nb-ui 的 `restore` 解析（未知 ref、上限、旧版本都由它分类），随后按**组集合**过滤：
 * 叶里没有的组被丢弃并记 issue（呈现过滤，不改原件）；组集合为空或树解析失败时整体拒绝，
 * 由调用方决定保留原件并显示默认布局。
 */
export function restoreEditorSession(record: Readonly<{
    grid: unknown;
    groups: readonly Readonly<{id: string; activePath: string; tabs: readonly Readonly<{path: string; editorId: string | null; pinned: boolean; preview: boolean}>[]}>[];
    activeGroupId: string;
}>): EditorSessionRestoreResult {
    const grid = createGrid<string>(null, {sashSize: 1});
    const restored = grid.restore(record.grid, (ref) => ({ref}));
    const issues: string[] = restored.dropped.map((item) => `布局引用无法解析：${item.ref}（${item.reason}）`);
    if (!restored.ok) {
        return {ok: false, reason: restored.reason ?? "布局快照无法恢复", issues};
    }
    const leaves = editorGroupIds(grid);
    if (leaves.length === 0) {
        return {ok: false, reason: "布局快照没有叶", issues};
    }
    const byId = new Map(record.groups.map((group) => [group.id, group]));
    const groups: EditorSessionGroup[] = leaves.map((id) => {
        const stored = byId.get(id);
        if (!stored) {
            issues.push(`布局叶没有对应组记录，按空组呈现：${id}`);
            return {id, activePath: "", tabs: []};
        }
        const seen = new Set<string>();
        const tabs: EditorSessionTab[] = [];
        for (const tab of stored.tabs) {
            if (!tab.path || seen.has(tab.path)) {
                issues.push(`组 ${id} 的标签路径非法或重复，已过滤：${tab.path}`);
                continue;
            }
            seen.add(tab.path);
            tabs.push({path: tab.path, title: tab.path, editorId: tab.editorId, pinned: tab.pinned, preview: tab.pinned ? false : tab.preview});
        }
        const previews = tabs.filter((tab) => tab.preview);
        if (previews.length > 1) {
            issues.push(`组 ${id} 有多个 preview，已收敛为最后一个：${previews.map((tab) => tab.path).join(", ")}`);
            for (const tab of previews.slice(0, -1)) {
                tab.preview = false;
            }
        }
        const activePath = stored.activePath && seen.has(stored.activePath) ? stored.activePath : tabs[0]?.path ?? "";
        if (stored.activePath && !seen.has(stored.activePath)) {
            issues.push(`组 ${id} 的活动标签不在组内，已回落到第一个标签：${stored.activePath}`);
        }
        return {id, activePath, tabs};
    });
    const extra = record.groups.filter((group) => !leaves.includes(group.id));
    for (const group of extra) {
        issues.push(`记录里有布局叶之外的组，已过滤：${group.id}`);
    }
    const activeGroupId = leaves.includes(record.activeGroupId) ? record.activeGroupId : leaves[0]!;
    if (activeGroupId !== record.activeGroupId) {
        issues.push(`活动组不在布局里，已回落到第一片叶：${record.activeGroupId}`);
    }
    return {ok: true, state: {groups, activeGroupId}, grid, issues};
}

/** 树的叶 id 序（渲染顺序）；恢复后重建组顺序时用。 */
export function editorSessionLeafIds(grid: Grid<string>): string[] {
    return editorGroupIds(grid);
}

/** 供调用方按分组顺序遍历树节点（调试与测试用；不参与事务）。 */
export function editorSessionRoot(grid: Grid<string>): GridNode<string> | null {
    return grid.root();
}
