import {describe, expect, it} from "vitest";
import type {Grid} from "@notnotype/nb-ui/layout";
import {createEditorGrid} from "nbook/app/utils/editor-workbench/editor-groups";
import {
    activateTab,
    createEditorSession,
    editorSessionGroupIds,
    editorSessionLeafIds,
    editorSessionPathReferenced,
    editorSessionTabsForPath,
    findEditorSessionTab,
    openTabInGroup,
    removeTab,
    restoreEditorSession,
    reorderTab,
    serializeEditorSession,
    splitTabToNewGroup,
    transferTab,
    updateTabInstance,
    validateEditorSession,
    type EditorSessionState,
} from "nbook/app/utils/editor-workbench/editor-session";

const clean: {canEvictPreview: () => boolean} = {canEvictPreview: () => true};
const keepAll: {canEvictPreview: () => boolean} = {canEvictPreview: () => false};

function open(state: EditorSessionState, groupId: string, path: string, mode: "preview" | "permanent" = "permanent"): EditorSessionState {
    const result = openTabInGroup(state, {groupId, path, title: path, mode}, clean);
    if (!result.ok) throw new Error(result.reason);
    return result.state;
}

function must(result: ReturnType<typeof openTabInGroup>): EditorSessionState {
    if (!result.ok) throw new Error(result.reason);
    return result.state;
}

describe("编辑会话事务", () => {
    it("preview 只在本组顶替，脏标签转常驻而不是被丢弃", () => {
        let state = createEditorSession(createEditorGrid("main"));
        state = must(openTabInGroup(state, {groupId: "main", path: "a.md", title: "a", mode: "preview"}, clean));
        state = must(openTabInGroup(state, {groupId: "main", path: "b.md", title: "b", mode: "preview"}, keepAll));

        expect(state.groups[0]!.tabs.map((tab) => [tab.path, tab.preview])).toEqual([["a.md", false], ["b.md", true]]);
        expect(state.groups[0]!.activePath).toBe("b.md");

        const replaced = openTabInGroup(state, {groupId: "main", path: "c.md", title: "c", mode: "preview"}, clean);
        expect(replaced.ok).toBe(true);
        if (!replaced.ok) return;
        expect(replaced.state.groups[0]!.tabs.map((tab) => tab.path)).toEqual(["a.md", "c.md"]);
        // a.md 被转为常驻，b.md 被顶替；被顶替的是"最后一次引用"。
        expect(replaced.evicted).toEqual(["b.md"]);
    });

    it("分屏复制把新组排在目标组左侧，且不产生额外引用释放", () => {
        const grid = createEditorGrid("main");
        let state = createEditorSession(grid);
        state = open(state, "main", "a.md");
        const result = splitTabToNewGroup(grid, state, {
            sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "left", mode: "copy",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(editorSessionGroupIds(result.state)).toEqual(["g2", "main"]);
        expect(result.state.activeGroupId).toBe("g2");
        expect(result.evicted).toEqual([]);
        expect(findEditorSessionTab(result.state, "g2", "a.md")?.preview).toBe(false);
        expect(editorSessionPathReferenced(result.state, "a.md")).toBe(true);
    });

    it("唯一标签搬到新组后源组塌陷，活动组落到新组", () => {
        const grid = createEditorGrid("main");
        let state = createEditorSession(grid);
        state = open(state, "main", "a.md");
        const result = splitTabToNewGroup(grid, state, {
            sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "move",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(editorSessionGroupIds(result.state)).toEqual(["g2"]);
        expect(result.state.activeGroupId).toBe("g2");
        // 移动不释放文档身份：路径仍被引用。
        expect(result.evicted).toEqual([]);
        expect(validateEditorSession(result.state, grid)).toEqual({ok: true});
    });

    it("跨组移动遇到目标已有同路径时只激活目标标签并删除来源引用", () => {
        const grid = createEditorGrid("main");
        let state = createEditorSession(grid);
        state = open(state, "main", "a.md");
        const split = splitTabToNewGroup(grid, state, {
            sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy",
        });
        if (!split.ok) throw new Error(split.reason);
        state = split.state;
        state = must(updateTabInstance(state, "g2", "a.md", {editorId: "markdown", pinned: true}));

        const moved = transferTab(grid, state, {sourceGroupId: "main", targetGroupId: "g2", path: "a.md"});
        expect(moved.ok).toBe(true);
        if (!moved.ok) return;
        expect(findEditorSessionTab(moved.state, "g2", "a.md")).toMatchObject({editorId: "markdown", pinned: true, preview: false});
        expect(findEditorSessionTab(moved.state, "main", "a.md")).toBeNull();
        expect(moved.evicted).toEqual([]);
    });

    it("最后引用移除才上报释放，别组仍引用时保留", () => {
        const grid = createEditorGrid("main");
        let state = createEditorSession(grid);
        state = open(state, "main", "a.md");
        state = open(state, "main", "b.md");
        const split = splitTabToNewGroup(grid, state, {
            sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy",
        });
        if (!split.ok) throw new Error(split.reason);
        state = split.state;

        const removedCopy = removeTab(grid, state, "g2", "a.md");
        expect(removedCopy.ok).toBe(true);
        if (!removedCopy.ok) return;
        expect(removedCopy.evicted).toEqual([]);

        const removedLast = removeTab(grid, removedCopy.state, "main", "a.md");
        expect(removedLast.ok).toBe(true);
        if (!removedLast.ok) return;
        expect(removedLast.evicted).toEqual(["a.md"]);
    });

    it("移除组内最后一个标签后空组塌陷，活动组回落到相邻组", () => {
        const grid = createEditorGrid("main");
        let state = createEditorSession(grid);
        state = open(state, "main", "a.md");
        const split = splitTabToNewGroup(grid, state, {
            sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy",
        });
        if (!split.ok) throw new Error(split.reason);
        state = split.state;

        const closed = removeTab(grid, state, "g2", "a.md");
        expect(closed.ok).toBe(true);
        if (!closed.ok) return;
        expect(editorSessionGroupIds(closed.state)).toEqual(["main"]);
        expect(closed.state.activeGroupId).toBe("main");
        expect(validateEditorSession(closed.state, grid)).toEqual({ok: true});
    });

    it("组内重排把标签放进目标分区并收敛 preview", () => {
        let state = createEditorSession(createEditorGrid("main"));
        state = open(state, "main", "a.md");
        state = open(state, "main", "b.md");
        state = open(state, "main", "c.md", "preview");

        const reordered = reorderTab(state, "main", "c.md", "a.md", false, "before");
        expect(reordered.ok).toBe(true);
        if (!reordered.ok) return;
        expect(reordered.state.groups[0]!.tabs.map((tab) => tab.path)).toEqual(["c.md", "a.md", "b.md"]);
        expect(reordered.state.groups[0]!.tabs[0]!.preview).toBe(false);
    });

    it("未知组与重复组 id 在命令边界被拒绝且不改状态", () => {
        const grid = createEditorGrid("main");
        const state = createEditorSession(grid);
        expect(openTabInGroup(state, {groupId: "other", path: "a.md", title: "a", mode: "permanent"}, clean)).toEqual({
            ok: false, reason: "未知编辑组：other",
        });
        expect(splitTabToNewGroup(grid, state, {
            sourceGroupId: "main", targetGroupId: "main", newGroupId: "main", path: "a.md", direction: "right", mode: "copy",
        })).toEqual({ok: false, reason: "编辑组已存在：main"});
        expect(editorSessionGroupIds(state)).toEqual(["main"]);
    });

    it("校验能认出叶与组不一致、组内重复路径与越界活动标签", () => {
        const grid = createEditorGrid("main");
        let state = createEditorSession(grid);
        state = open(state, "main", "a.md");
        const tampered: EditorSessionState = {
            activeGroupId: "main",
            groups: [{id: "main", activePath: "zz.md", tabs: [
                {path: "a.md", title: "a", editorId: null, pinned: false, preview: false},
                {path: "a.md", title: "a2", editorId: null, pinned: false, preview: true},
            ]}],
        };
        const verdict = validateEditorSession(tampered, grid);
        expect(verdict.ok).toBe(false);
        if (verdict.ok) return;
        expect(verdict.issues.join(" | ")).toContain("重复路径");
        expect(verdict.issues.join(" | ")).toContain("活动标签不属于该组");
    });

    it("序列化与恢复往返保住组、标签与活动组，并过滤未知组", () => {
        const grid = createEditorGrid("main");
        let state = createEditorSession(grid);
        state = open(state, "main", "a.md");
        state = must(updateTabInstance(state, "main", "a.md", {editorId: "markdown", pinned: true}));
        state = open(state, "main", "b.md", "preview");

        const record = serializeEditorSession(state, grid);
        const restored = restoreEditorSession({
            ...record,
            groups: [...record.groups, {id: "ghost", activePath: "", tabs: [{path: "x.md", editorId: null, pinned: false, preview: false}]}],
            activeGroupId: "ghost",
        });
        expect(restored.ok).toBe(true);
        if (!restored.ok) return;
        expect(restored.state.groups.map((group) => group.id)).toEqual(["main"]);
        expect(restored.state.groups[0]!.tabs.map((tab) => [tab.path, tab.editorId, tab.pinned, tab.preview])).toEqual([
            ["a.md", "markdown", true, false], ["b.md", null, false, true],
        ]);
        expect(restored.state.activeGroupId).toBe("main");
        expect(restored.issues.join(" | ")).toContain("布局叶之外的组");
        expect(validateEditorSession(restored.state, restored.grid)).toEqual({ok: true});
    });

    it("恢复时多个 preview 收敛为最后一个，活动标签越界时回落", () => {
        const record = {
            grid: {version: 2, root: {kind: "leaf" as const, id: "main", ref: "main", size: {width: 800, height: 600}}},
            groups: [{id: "main", activePath: "missing.md", tabs: [
                {path: "a.md", editorId: null, pinned: false, preview: true},
                {path: "b.md", editorId: null, pinned: false, preview: true},
            ]}],
            activeGroupId: "main",
        };
        const restored = restoreEditorSession(record);
        expect(restored.ok).toBe(true);
        if (!restored.ok) return;
        expect(restored.state.groups[0]!.tabs.map((tab) => tab.preview)).toEqual([false, true]);
        expect(restored.state.groups[0]!.activePath).toBe("a.md");
        expect(restored.issues.join(" | ")).toContain("多个 preview");
        expect(restored.issues.join(" | ")).toContain("活动标签不在组内");
    });

    it("布局快照无法恢复时整体拒绝，不产出半棵会话", () => {
        const restored = restoreEditorSession({
            grid: {version: 1, root: {kind: "leaf", id: "main", ref: "main", size: {width: 1, height: 0}}},
            groups: [{id: "main", activePath: "", tabs: []}],
            activeGroupId: "main",
        });
        expect(restored.ok).toBe(false);
    });

    it("三标签边缘分屏 move：只移除被选中的实例，源组其余标签与顺序不变", () => {
        const grid = createEditorGrid("main");
        let state = createEditorSession(grid);
        state = open(state, "main", "a.md");
        state = open(state, "main", "b.md");
        state = open(state, "main", "c.md");
        state = must(activateTab(state, "main", "b.md"));

        const moved = splitTabToNewGroup(grid, state, {
            sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "b.md", direction: "right", mode: "move",
        });
        expect(moved.ok).toBe(true);
        if (!moved.ok) return;

        expect(editorSessionGroupIds(moved.state)).toEqual(["main", "g2"]);
        expect(moved.state.groups[0]!.tabs.map((tab) => tab.path)).toEqual(["a.md", "c.md"]);
        expect(moved.state.groups[1]!.tabs.map((tab) => tab.path)).toEqual(["b.md"]);
        // 被搬走的正好是活动标签：源组回落到剩余的第一个，活动组落到新组。
        expect(moved.state.groups[0]!.activePath).toBe("a.md");
        expect(moved.state.activeGroupId).toBe("g2");
        // b.md 只剩新组那一份实例；a.md/c.md 既没被顺带删掉也没被复制。
        expect(editorSessionTabsForPath(moved.state, "b.md")).toHaveLength(1);
        expect(editorSessionTabsForPath(moved.state, "a.md")).toHaveLength(1);
        expect(editorSessionTabsForPath(moved.state, "c.md")).toHaveLength(1);
        expect(moved.evicted).toEqual([]);
        expect(validateEditorSession(moved.state, grid)).toEqual({ok: true});
    });

    it("三标签边缘分屏 copy：源组保留全部实例，新组只多一个视图", () => {
        const grid = createEditorGrid("main");
        let state = createEditorSession(grid);
        state = open(state, "main", "a.md");
        state = open(state, "main", "b.md");
        state = open(state, "main", "c.md");

        const copied = splitTabToNewGroup(grid, state, {
            sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "b.md", direction: "left", mode: "copy",
        });
        expect(copied.ok).toBe(true);
        if (!copied.ok) return;

        // 方向 left：新组排在目标组之前；源组的标签、活动标签与顺序一格不动。
        expect(editorSessionGroupIds(copied.state)).toEqual(["g2", "main"]);
        expect(copied.state.groups[1]!.tabs.map((tab) => tab.path)).toEqual(["a.md", "b.md", "c.md"]);
        expect(copied.state.groups[1]!.activePath).toBe("c.md");
        expect(copied.state.groups[0]!.tabs.map((tab) => tab.path)).toEqual(["b.md"]);
        expect(editorSessionTabsForPath(copied.state, "b.md")).toHaveLength(2);
        expect(copied.state.activeGroupId).toBe("g2");
        expect(copied.evicted).toEqual([]);
        expect(validateEditorSession(copied.state, grid)).toEqual({ok: true});
    });

    it("分屏几何失败（目标组不在树里）整体拒绝：树与状态都不留半份", () => {
        const grid = createEditorGrid("main");
        const state: EditorSessionState = {
            groups: [
                {id: "main", activePath: "a.md", tabs: [{path: "a.md", title: "a", editorId: null, pinned: false, preview: false}]},
                {id: "ghost", activePath: "", tabs: []},
            ],
            activeGroupId: "main",
        };
        const before = JSON.stringify(state);

        const result = splitTabToNewGroup(grid, state, {
            sourceGroupId: "main", targetGroupId: "ghost", newGroupId: "g2", path: "a.md", direction: "right", mode: "move",
        });

        expect(result.ok).toBe(false);
        // 几何原语本身原子：新叶没进来，源叶也没被先删掉再恢复。
        expect(editorSessionLeafIds(grid)).toEqual(["main"]);
        expect(JSON.stringify(state)).toBe(before);
    });

    it("三标签跨组转移命中目标已有 path：不产生重复实例，源组只丢一个引用", () => {
        const grid = createEditorGrid("main");
        let state = createEditorSession(grid);
        state = open(state, "main", "a.md");
        state = open(state, "main", "b.md");
        state = open(state, "main", "c.md");
        const split = splitTabToNewGroup(grid, state, {
            sourceGroupId: "main", targetGroupId: "main", newGroupId: "g2", path: "a.md", direction: "right", mode: "copy",
        });
        if (!split.ok) throw new Error(split.reason);
        state = split.state;

        const moved = transferTab(grid, state, {sourceGroupId: "g2", targetGroupId: "main", path: "a.md", targetPath: "b.md", position: "after"});
        expect(moved.ok).toBe(true);
        if (!moved.ok) return;

        // 来源组因此清空 → 塌陷；目标组只保留原有的那一个 a.md 实例，位置也不跳。
        expect(editorSessionGroupIds(moved.state)).toEqual(["main"]);
        expect(moved.state.groups[0]!.tabs.map((tab) => tab.path)).toEqual(["a.md", "b.md", "c.md"]);
        expect(editorSessionTabsForPath(moved.state, "a.md")).toHaveLength(1);
        expect(moved.state.groups[0]!.activePath).toBe("a.md");
        expect(moved.state.activeGroupId).toBe("main");
        expect(moved.evicted).toEqual([]);
        expect(validateEditorSession(moved.state, grid)).toEqual({ok: true});
    });
});
