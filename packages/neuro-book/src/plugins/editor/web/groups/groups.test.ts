/**
 * 编辑组与标签（docs/specs/workbench/editor.md 输出 1–5）：纯模型；布局用真实的 nb-ui grid。
 */

import {describe, expect, it} from "bun:test";

import {createEditorGroups} from "./groups";
import type {EditorGroups} from "./groups";

const md = {editor: "markdown"} as const;
const addresses = (groups: EditorGroups, index = 0): string[] => (groups.groups.value[index]?.tabs ?? []).map((tab) => `${tab.address}${tab.preview ? "*" : ""}`);
const active = (groups: EditorGroups): string | undefined => groups.activeTab()?.address;

describe("Spec workbench.editor 输出 1：preview 与 permanent", () => {
    it("单击替换本组的 preview；已在本组只激活；permanent 打开或 pin 转正；转正后不再被替换", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "preview", ...md});
        const second = groups.open("project://b.md", {mode: "preview", ...md});
        expect(second.replaced?.address).toBe("project://a.md");
        expect(addresses(groups)).toEqual(["project://b.md*"]);
        groups.open("project://b.md", {mode: "permanent", ...md});
        expect(addresses(groups)).toEqual(["project://b.md"]);
        expect(groups.open("project://a.md", {mode: "preview", ...md}).replaced).toBeNull();
        expect(addresses(groups)).toEqual(["project://b.md", "project://a.md*"]);
        const tab = groups.groups.value[0]?.tabs[1];
        groups.pin(tab?.id ?? "");
        groups.open("project://c.md", {mode: "preview", ...md});
        expect(addresses(groups)).toEqual(["project://b.md", "project://a.md", "project://c.md*"]);
        const again = groups.open("project://b.md", {mode: "preview", ...md});
        expect(again.replaced).toBeNull();
        expect(active(groups)).toBe("project://b.md");
        expect(addresses(groups)).toEqual(["project://b.md", "project://a.md", "project://c.md*"]);
    });

    it("新标签插在活动标签之后", () => {
        const groups = createEditorGroups();
        for (const name of ["a", "b", "c"]) groups.open(`project://${name}.md`, {mode: "permanent", ...md});
        groups.activate(groups.groups.value[0]?.tabs[0]?.id ?? "");
        groups.open("project://d.md", {mode: "permanent", ...md});
        expect(addresses(groups)).toEqual(["project://a.md", "project://d.md", "project://b.md", "project://c.md"]);
    });
});

describe("Spec workbench.editor 输出 2–3：拆分与关闭", () => {
    it("拆分在右侧新建组打开同一文档并成为活动组；打开在活动组；关闭激活右侧（没有时左侧）；组空了随之关闭，活动组换到相邻组", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        const b = groups.open("project://b.md", {mode: "permanent", ...md}).tab;
        const split = groups.split(b.id, "right");
        expect(split?.address).toBe("project://b.md");
        expect(groups.groups.value).toHaveLength(2);
        expect(groups.activeGroup.value).toBe(groups.groups.value[1]?.id);
        expect(groups.grid.root()).toMatchObject({kind: "branch", orientation: "horizontal"});
        groups.open("project://c.md", {mode: "preview", ...md});
        expect(addresses(groups, 1)).toEqual(["project://b.md", "project://c.md*"]);
        expect(addresses(groups, 0)).toEqual(["project://a.md", "project://b.md"]);

        groups.activate(groups.groups.value[0]?.tabs[0]?.id ?? "");
        groups.close(groups.groups.value[0]?.tabs[0]?.id ?? "");
        expect(active(groups)).toBe("project://b.md");
        // 关掉活动组里的全部标签：组随之关闭，活动组换到相邻的组。
        const second = groups.groups.value[1];
        groups.activate(second?.tabs[0]?.id ?? "");
        for (const tab of second?.tabs ?? []) groups.close(tab.id);
        expect(active(groups)).toBe("project://b.md");
        expect(groups.groups.value).toHaveLength(1);
        expect(groups.grid.root()).toMatchObject({kind: "leaf"});
        expect(groups.activeGroup.value).toBe(groups.groups.value[0]?.id);

        // 只剩一组时关掉最后一个标签，组留着。
        groups.close(groups.groups.value[0]?.tabs[0]?.id ?? "");
        expect(groups.groups.value).toHaveLength(1);
        expect(groups.groups.value[0]?.active).toBeNull();
    });

    it("关闭中间的活动标签激活它右侧的；关闭最右的激活左侧的", () => {
        const groups = createEditorGroups();
        for (const name of ["a", "b", "c"]) groups.open(`project://${name}.md`, {mode: "permanent", ...md});
        groups.activate(groups.groups.value[0]?.tabs[1]?.id ?? "");
        groups.close(groups.groups.value[0]?.tabs[1]?.id ?? "");
        expect(active(groups)).toBe("project://c.md");
        groups.close(groups.groups.value[0]?.tabs[1]?.id ?? "");
        expect(active(groups)).toBe("project://a.md");
    });

    it("关闭其它、同组移动、换编辑器", () => {
        const groups = createEditorGroups();
        for (const name of ["a", "b", "c"]) groups.open(`project://${name}.md`, {mode: "permanent", ...md});
        const b = groups.groups.value[0]?.tabs[1];
        groups.move(b?.id ?? "", 1);
        expect(addresses(groups)).toEqual(["project://a.md", "project://c.md", "project://b.md"]);
        groups.move(b?.id ?? "", 1);
        expect(addresses(groups)).toEqual(["project://a.md", "project://c.md", "project://b.md"]);
        groups.setEditor(b?.id ?? "", "code");
        expect(groups.find(b?.id ?? "")?.tab.editor).toBe("code");
        expect(groups.closeOthers(b?.id ?? "").map((tab) => tab.address)).toEqual(["project://a.md", "project://c.md"]);
        expect(addresses(groups)).toEqual(["project://b.md"]);
    });

    it("改名把标签跟到新地址；关闭某个目录下的全部标签", () => {
        const groups = createEditorGroups();
        groups.open("project://dir/a.md", {mode: "permanent", ...md});
        const split = groups.split(groups.activeTab()?.id ?? "", "down");
        groups.open("project://dir/b.md", {mode: "permanent", ...md});
        groups.open("project://other.md", {mode: "permanent", ...md});
        groups.rebind("project://dir", "project://moved");
        expect(addresses(groups, 0)).toEqual(["project://moved/a.md"]);
        expect(addresses(groups, 1)).toEqual(["project://moved/a.md", "project://moved/b.md", "project://other.md"]);
        expect(split).not.toBeNull();
        expect(groups.closeWithin(["project://moved"]).map((tab) => tab.address)).toEqual(["project://moved/a.md", "project://moved/a.md", "project://moved/b.md"]);
        expect(groups.groups.value).toHaveLength(1);
        expect(addresses(groups)).toEqual(["project://other.md"]);
    });
});

describe("Spec workbench.editor 输出 5：会话快照", () => {
    it("快照恢复出同样的组、布局、标签与活动项；新建的组不与恢复的 id 冲突", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        groups.open("project://b.md", {mode: "preview", ...md});
        groups.split(groups.activeTab()?.id ?? "", "right");
        groups.open("user://u.md", {mode: "permanent", editor: "code"});
        const snapshot = groups.snapshot();
        const restored = createEditorGroups(JSON.parse(JSON.stringify(snapshot)));
        expect(restored.snapshot()).toEqual(snapshot);
        expect(active(restored)).toBe("user://u.md");
        // 让记录里的组与分支恰好用上新计数会先给出的 id：新拆出的组与分支仍不冲突。
        const renamed = JSON.parse(JSON.stringify(snapshot).replaceAll(`"${snapshot.activeGroup}"`, "\"g1\"").replace(/"id":"b\d+"/u, "\"id\":\"b2\""));
        const colliding = createEditorGroups(renamed);
        expect(colliding.groups.value.map((group) => group.id)).toEqual(["g0", "g1"]);
        const split = colliding.split(colliding.activeTab()?.id ?? "", "down");
        expect(split).not.toBeNull();
        expect(new Set(colliding.groups.value.map((group) => group.id)).size).toBe(3);
    });

    it("布局与组对不上、活动组不存在或快照损坏：从一个空组开始", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        const snapshot = groups.snapshot();
        for (const broken of [
            {...snapshot, activeGroup: "nope"},
            {...snapshot, groups: [...snapshot.groups, {id: "extra", tabs: [], active: null}]},
            {...snapshot, layout: {version: 1, root: null}},
        ]) {
            const restored = createEditorGroups(broken as never);
            expect(restored.groups.value).toEqual([{id: "g0", tabs: [], active: null}]);
        }
    });
});
