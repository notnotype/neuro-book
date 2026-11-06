/**
 * 编辑组与标签（docs/specs/workbench/editor.md 输出 1–5）：纯模型；布局用真实的 nb-ui grid。
 */

import {describe, expect, it} from "bun:test";

import {createEditorGroups, sitsAtEdge} from "./groups";
import type {EditorGroups} from "./groups";
import {CODE_EDITOR, MARKDOWN_EDITOR} from "../../shared/contracts";

const md = {editor: MARKDOWN_EDITOR} as const;
const addresses = (groups: EditorGroups, index = 0): string[] => (groups.groups.value[index]?.tabs ?? []).map((tab) => `${tab.address}${tab.preview ? "*" : ""}`);
const active = (groups: EditorGroups): string | undefined => groups.activeTab()?.address;

describe("Spec workbench.editor 输出 1：preview 与 permanent", () => {
    it("单击替换本组的 preview；已在本组只激活；permanent 打开或 keep 转正；转正后不再被替换", () => {
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
        groups.keep(tab?.id ?? "");
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

describe("Spec workbench.editor 输出 1、39：同一文件的几个标签", () => {
    it("按地址加编辑器区分：同一组里源码与预览视图并存；reuse 决定哪个算已打开；换成本组已有的那种编辑器时切过去并关掉当前这个", () => {
        const groups = createEditorGroups();
        const source = groups.open("project://a.html", {mode: "permanent", editor: CODE_EDITOR}).tab;
        const preview = groups.open("project://a.html", {mode: "permanent", editor: "test.html.preview"}).tab;
        expect(addresses(groups)).toEqual(["project://a.html", "project://a.html"]);
        expect(preview.id).not.toBe(source.id);
        // 不指定编辑器的打开由调用方给 reuse：认可非预览的那一个。
        expect(groups.open("project://a.html", {mode: "permanent", editor: CODE_EDITOR, reuse: (tab) => tab.editor !== "test.html.preview"}).tab.id).toBe(source.id);
        expect(groups.setEditor(preview.id, CODE_EDITOR)?.id).toBe(preview.id);
        expect(groups.groups.value[0]?.tabs.map((tab) => tab.id)).toEqual([source.id]);
        expect(groups.activeTab()?.id).toBe(source.id);
    });

    it("语言随拆分复制，换编辑器时与光标一起丢掉；快照往返保留语言", () => {
        const groups = createEditorGroups();
        const tab = groups.open("project://a.txt", {mode: "permanent", editor: CODE_EDITOR}).tab;
        groups.setLanguage(tab.id, "python");
        groups.setCursor(tab.id, {line: 2, column: 1});
        const split = groups.split(tab.id, "right");
        expect(split).toMatchObject({language: "python", cursor: {line: 2, column: 1}});
        expect(createEditorGroups(JSON.parse(JSON.stringify(groups.snapshot()))).groups.value.map((group) => group.tabs[0])).toMatchObject([{language: "python"}, {language: "python"}]);
        groups.setEditor(tab.id, MARKDOWN_EDITOR);
        const changed = groups.find(tab.id)?.tab;
        expect(changed?.kind === "file" ? [changed.language, changed.cursor] : null).toEqual([undefined, undefined]);
        groups.setLanguage(split!.id, null);
        const cleared = groups.find(split!.id)?.tab;
        expect(cleared?.kind === "file" ? cleared.language : null).toBeUndefined();
    });

    it("光标写法按编辑器的声明：没有声明的编辑器不记光标", () => {
        const groups = createEditorGroups(null, (editor) => (editor === "test.viewer" ? null : "line"));
        const viewer = groups.open("project://a.png", {mode: "permanent", editor: "test.viewer"}).tab;
        groups.setCursor(viewer.id, {line: 1, column: 1});
        const tab = groups.find(viewer.id)?.tab;
        expect(tab?.kind === "file" ? tab.cursor : null).toBeUndefined();
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

    it("同组移动、换编辑器", () => {
        const groups = createEditorGroups();
        for (const name of ["a", "b", "c"]) groups.open(`project://${name}.md`, {mode: "permanent", ...md});
        const b = groups.groups.value[0]?.tabs[1];
        groups.move(b?.id ?? "", 1);
        expect(addresses(groups)).toEqual(["project://a.md", "project://c.md", "project://b.md"]);
        groups.move(b?.id ?? "", 1);
        expect(addresses(groups)).toEqual(["project://a.md", "project://c.md", "project://b.md"]);
        groups.setEditor(b?.id ?? "", CODE_EDITOR);
        expect(groups.find(b?.id ?? "")?.tab).toMatchObject({kind: "file", editor: CODE_EDITOR});
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

    it("改名时留在原处的地址（目标上有一份要保留的文档）不跟过去", () => {
        const groups = createEditorGroups();
        groups.open("project://dir/a.md", {mode: "permanent", ...md});
        groups.open("project://dir/b.md", {mode: "permanent", ...md});
        groups.rebind("project://dir", "project://moved", ["project://dir/b.md"]);
        expect(addresses(groups)).toEqual(["project://moved/a.md", "project://dir/b.md"]);
    });
});

/** 组里标签的地址，固定的带 `^`、preview 带 `*`。 */
const tabsOf = (groups: EditorGroups, index = 0): string[] => (groups.groups.value[index]?.tabs ?? []).map((tab) => `${tab.address.replace("project://", "")}${tab.kind === "file" && tab.pinned === true ? "^" : ""}${tab.preview ? "*" : ""}`);
const idOf = (groups: EditorGroups, address: string): string => groups.groups.value.flatMap((group) => group.tabs).find((tab) => tab.address === `project://${address}`)?.id ?? "";

describe("Spec workbench.editor 输出 50：固定标签", () => {
    it("固定的排到固定区末尾并转正，取消的排到普通区开头；新标签不插进固定区；Alt+方向键不跨区；preview 替换只找普通区", () => {
        const groups = createEditorGroups();
        for (const name of ["a", "b", "c"]) groups.open(`project://${name}.md`, {mode: "permanent", ...md});
        groups.open("project://p.md", {mode: "preview", ...md});
        groups.setPinned(idOf(groups, "c.md"), true);
        groups.setPinned(idOf(groups, "p.md"), true);
        expect(tabsOf(groups)).toEqual(["c.md^", "p.md^", "a.md", "b.md"]);
        // 活动标签是固定的：新标签插在普通区开头。
        groups.activate(idOf(groups, "c.md"));
        groups.open("project://d.md", {mode: "preview", ...md});
        expect(tabsOf(groups)).toEqual(["c.md^", "p.md^", "d.md*", "a.md", "b.md"]);
        groups.open("project://e.md", {mode: "preview", ...md});
        expect(tabsOf(groups)).toEqual(["c.md^", "p.md^", "e.md*", "a.md", "b.md"]);
        groups.move(idOf(groups, "p.md"), 1);
        groups.move(idOf(groups, "e.md"), -1);
        expect(tabsOf(groups)).toEqual(["c.md^", "p.md^", "e.md*", "a.md", "b.md"]);
        groups.move(idOf(groups, "c.md"), 1);
        expect(tabsOf(groups)).toEqual(["p.md^", "c.md^", "e.md*", "a.md", "b.md"]);
        groups.setPinned(idOf(groups, "p.md"), false);
        expect(tabsOf(groups)).toEqual(["c.md^", "p.md", "e.md*", "a.md", "b.md"]);
    });

    it("换编辑器保留固定，并到同组的同编辑器标签时两者有一个固定就固定；拆分出的不固定；改名保留；删除照常关闭；页面不能固定", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        groups.open("project://a.md", {mode: "permanent", editor: CODE_EDITOR});
        groups.open("project://b.md", {mode: "permanent", ...md});
        const markdown = groups.groups.value[0]?.tabs[0]?.id ?? "";
        groups.setPinned(markdown, true);
        groups.setPinned(idOf(groups, "b.md"), true);
        expect(groups.setEditor(idOf(groups, "b.md"), CODE_EDITOR)).toBeNull();
        expect(groups.find(idOf(groups, "b.md"))?.tab).toMatchObject({editor: CODE_EDITOR, pinned: true});
        // a.md 的 Markdown 标签固定、源码标签不固定：换成源码时并过去，留下的那个固定。
        expect(groups.setEditor(markdown, CODE_EDITOR)?.id).toBe(markdown);
        expect(tabsOf(groups)).toEqual(["b.md^", "a.md^"]);
        const split = groups.split(idOf(groups, "a.md"), "right");
        expect(split?.kind === "file" ? split.pinned : "page").toBeUndefined();
        groups.rebind("project://b.md", "project://c.md");
        expect(tabsOf(groups)).toEqual(["c.md^", "a.md^"]);
        expect(groups.closeWithin(["project://c.md"]).map((tab) => tab.address)).toEqual(["project://c.md"]);
        const page = groups.openPage("page://welcome");
        groups.setPinned(page.id, true);
        expect(groups.find(page.id)?.tab).toMatchObject({kind: "page"});
        // 页面开在拆出的活动组里。
        expect(tabsOf(groups, 1)).toEqual(["a.md", "page://welcome"]);
    });

    it("固定随快照往返；旧记录没有这一项时不固定；记录里两类交错时固定的排到前面，活动项不变；固定的不会恢复成 preview", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        groups.open("project://b.md", {mode: "permanent", ...md});
        groups.setPinned(idOf(groups, "b.md"), true);
        expect(tabsOf(createEditorGroups(groups.snapshot()))).toEqual(["b.md^", "a.md"]);
        const snapshot = groups.snapshot();
        const group = snapshot.groups[0];
        if (group === undefined) throw new Error("没有组");
        const mixed = {...snapshot, groups: [{...group, tabs: [{address: "project://x.md", editor: MARKDOWN_EDITOR, preview: false}, {address: "project://y.md", editor: MARKDOWN_EDITOR, preview: true, pinned: true as const}], active: 0}]};
        const restored = createEditorGroups(mixed);
        expect(tabsOf(restored)).toEqual(["y.md^", "x.md"]);
        expect(restored.activeTab()?.address).toBe("project://x.md");
    });
});

describe("Spec workbench.editor 输出 49：移动标签", () => {
    /** 左组 a、b、c（b 是 preview），右组 d。 */
    const twoGroups = (): EditorGroups => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        groups.open("project://b.md", {mode: "permanent", ...md});
        groups.open("project://c.md", {mode: "preview", ...md});
        const right = groups.sideGroup();
        groups.open("project://d.md", {mode: "permanent", group: right, ...md});
        return groups;
    };
    const groupIds = (groups: EditorGroups): string[] => groups.groups.value.map((group) => group.id);

    it("组内换位置：成为活动标签；preview 转正；原位不变；落在固定区随之固定", () => {
        const groups = twoGroups();
        const [left = ""] = groupIds(groups);
        expect(groups.moveTab(idOf(groups, "c.md"), {group: left, partition: "normal", before: idOf(groups, "a.md")})).not.toBeNull();
        expect(tabsOf(groups)).toEqual(["c.md", "a.md", "b.md"]);
        expect(groups.activeTab()?.address).toBe("project://c.md");
        // 放回它自己前面、或它后继的前面：原位。
        expect(groups.moveTab(idOf(groups, "c.md"), {group: left, partition: "normal", before: idOf(groups, "a.md")})).toBeNull();
        expect(groups.moveTab(idOf(groups, "b.md"), {group: left, partition: "normal", before: null})).toBeNull();
        groups.moveTab(idOf(groups, "b.md"), {group: left, partition: "pinned", before: null});
        expect(tabsOf(groups)).toEqual(["b.md^", "c.md", "a.md"]);
        // before 不在所说的区里：不变。
        expect(groups.moveTab(idOf(groups, "a.md"), {group: left, partition: "pinned", before: idOf(groups, "c.md")})).toBeNull();
    });

    it("换组：插在给定位置并成为那一组的活动标签、那一组成为活动组；源组空了随之关闭；目标组已有同一标签时不动", () => {
        const groups = twoGroups();
        const [left = "", right = ""] = groupIds(groups);
        groups.moveTab(idOf(groups, "c.md"), {group: right, partition: "normal", before: idOf(groups, "d.md")});
        expect(tabsOf(groups, 1)).toEqual(["c.md", "d.md"]);
        expect(groups.activeGroup.value).toBe(right);
        expect(groups.activeTab()?.address).toBe("project://c.md");
        expect(tabsOf(groups, 0)).toEqual(["a.md", "b.md"]);
        groups.open("project://a.md", {mode: "permanent", group: right, ...md});
        expect(groups.moveTab(groups.groups.value[0]?.tabs[0]?.id ?? "", {group: right, partition: "normal", before: null})).toBeNull();
        const leftTabs = groups.groups.value[0]?.tabs ?? [];
        for (const tab of leftTabs.slice(1)) groups.moveTab(tab.id, {group: right, partition: "normal", before: null});
        const last = groups.moveTab(leftTabs[0]?.id ?? "", {group: right, partition: "normal", before: null});
        // a.md 右组已有：不动；左组仍在。
        expect(last).toBeNull();
        groups.close(groups.find(leftTabs[0]?.id ?? "")?.tab.id ?? "");
        expect(groupIds(groups)).toEqual([right]);
        expect(groupIds(groups)).not.toContain(left);
    });

    it("拖到边缘：在目标组的那一边拆出新组并移过去，转正、不固定；源组只有它且就是目标组时不变；源组空了随之关闭", () => {
        const groups = twoGroups();
        const [left = "", right = ""] = groupIds(groups);
        groups.setPinned(idOf(groups, "a.md"), true);
        const moved = groups.moveToNewGroup(idOf(groups, "a.md"), right, "bottom");
        if (moved === null) throw new Error("没有拆出新组");
        expect(moved.droppedGroup).toBeNull();
        expect(groupIds(groups)).toEqual([left, right, moved.group]);
        expect(tabsOf(groups, 2)).toEqual(["a.md"]);
        expect(groups.activeGroup.value).toBe(moved.group);
        expect(groups.moveToNewGroup(idOf(groups, "a.md"), moved.group, "top")).toBeNull();
        const left2 = groups.moveToNewGroup(idOf(groups, "d.md"), left, "left");
        if (left2 === null) throw new Error("没有拆出新组");
        expect(left2.droppedGroup).toBe(right);
        expect(groupIds(groups)).toEqual([left2.group, left, moved.group]);
        expect(groups.grid.find(right)).toBeNull();
    });
});

describe("Spec workbench.editor 输出 35：在侧边打开", () => {
    it("右侧没有组时在活动组右侧新建一个空组、不带走活动标签；有了以后再“侧边”就是它；在它里面打开后它成为活动组；从右边的组再侧边又新建", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        const side = groups.sideGroup();
        expect(groups.groups.value.map((group) => group.id)).toEqual([groups.groups.value[0]?.id, side]);
        expect(addresses(groups, 1)).toEqual([]);
        expect(addresses(groups, 0)).toEqual(["project://a.md"]);
        groups.open("project://b.md", {mode: "permanent", ...md, group: side});
        expect(groups.activeGroup.value).toBe(side);
        expect(addresses(groups, 1)).toEqual(["project://b.md"]);
        // 回到左边的组：再侧边仍是同一个右侧组，不再新建。
        groups.focusGroup(groups.groups.value[0]?.id as string);
        expect(groups.sideGroup()).toBe(side);
        expect(groups.groups.value).toHaveLength(2);
        // 活动的是最右的组：再侧边在它右侧新建。
        groups.focusGroup(side);
        const third = groups.sideGroup();
        expect(third).not.toBe(side);
        expect(groups.groups.value.map((group) => group.id)).toEqual([groups.groups.value[0]?.id, side, third]);
    });

    it("右侧的是一列上下拆开的组：取那一列最上面的组", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        const left = groups.activeGroup.value;
        groups.split(groups.activeTab()?.id as string, "right");
        const top = groups.activeGroup.value;
        groups.split(groups.activeTab()?.id as string, "down");
        groups.focusGroup(left);
        expect(groups.sideGroup()).toBe(top);
    });
});

describe("Spec workbench.editor 输出 5：会话快照", () => {
    it("快照恢复出同样的组、布局、标签与活动项；新建的组不与恢复的 id 冲突", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        groups.open("project://b.md", {mode: "preview", ...md});
        groups.split(groups.activeTab()?.id ?? "", "right");
        groups.open("user://u.md", {mode: "permanent", editor: CODE_EDITOR});
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

    it("上次的光标随快照往返；写法与编辑器对不上的（Markdown 记着行列、源码记着位置）恢复时丢掉（输出 30）", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        groups.open("project://c.json", {mode: "permanent", editor: CODE_EDITOR});
        const [a, c] = groups.groups.value[0]!.tabs;
        groups.setCursor(a!.id, {offset: 4});
        groups.setCursor(c!.id, {line: 2, column: 3});
        groups.setCursor(c!.id, {offset: 9});
        const snapshot = groups.snapshot();
        expect(snapshot.groups[0]?.tabs.map((tab) => tab.cursor)).toEqual([{offset: 4}, {line: 2, column: 3}]);
        expect(createEditorGroups(JSON.parse(JSON.stringify(snapshot))).snapshot()).toEqual(snapshot);
        const crossed = {...snapshot, groups: snapshot.groups.map((group) => ({...group, tabs: [{...group.tabs[0]!, cursor: {line: 1, column: 1}}, {...group.tabs[1]!, cursor: {offset: 2}}]}))};
        expect(createEditorGroups(crossed).groups.value[0]?.tabs.map((tab) => (tab.kind === "file" ? tab.cursor : null))).toEqual([undefined, undefined]);
    });

    it("页面标签（输出 33）不进快照：活动的是页面时记它左边最近的文件标签；页面不拆分、不换编辑器", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        groups.openPage("page://nbook.test.welcome");
        groups.open("project://b.md", {mode: "permanent", ...md});
        const page = groups.groups.value[0]!.tabs[1]!;
        groups.activate(page.id);
        const snapshot = groups.snapshot();
        expect(snapshot.groups[0]?.tabs.map((tab) => tab.address)).toEqual(["project://a.md", "project://b.md"]);
        expect(snapshot.groups[0]?.active).toBe(0);
        expect(groups.split(page.id, "right")).toBeNull();
        expect(groups.setEditor(page.id, CODE_EDITOR)).toBeNull();
        expect(groups.find(page.id)?.tab.kind).toBe("page");

        const only = createEditorGroups();
        only.openPage("page://nbook.test.welcome");
        expect(only.snapshot().groups[0]).toMatchObject({tabs: [], active: null});
    });

    it("布局与组对不上、活动组不存在或快照损坏：从一个空组开始", () => {
        const groups = createEditorGroups();
        groups.open("project://a.md", {mode: "permanent", ...md});
        const snapshot = groups.snapshot();
        for (const broken of [
            {...snapshot, activeGroup: "nope"},
            {...snapshot, groups: [...snapshot.groups, {id: "extra", tabs: [], active: null}]},
            {...snapshot, layout: {version: 1, root: null}},
            // 叶的 id 与组的 ref 不一致：渲染按叶的 id 找组，会找不到这些标签。
            JSON.parse(JSON.stringify(snapshot).replace(/"kind":"leaf","id":"[^"]+"/u, '"kind":"leaf","id":"alien"')),
        ]) {
            const restored = createEditorGroups(broken as never);
            expect(restored.groups.value).toEqual([{id: "g0", tabs: [], active: null}]);
        }
    });
});

describe("组已经紧贴目标的这条边：放下去还是现在的样子", () => {
    const left = {left: 0, top: 0, right: 400, bottom: 800};
    const right = {left: 401, top: 0, right: 800, bottom: 800};
    const upper = {left: 0, top: 0, right: 400, bottom: 400};
    const lower = {left: 0, top: 401, right: 400, bottom: 800};

    it("紧贴且交叉轴一样长：四条边都算", () => {
        expect(sitsAtEdge(left, right, "right")).toBe(true);
        expect(sitsAtEdge(right, left, "left")).toBe(true);
        expect(sitsAtEdge(upper, lower, "bottom")).toBe(true);
        expect(sitsAtEdge(lower, upper, "top")).toBe(true);
    });

    it("紧贴着，但放的是另一条边：不算，那是真的换位置", () => {
        expect(sitsAtEdge(right, left, "right")).toBe(false);
        expect(sitsAtEdge(left, right, "left")).toBe(false);
        expect(sitsAtEdge(left, right, "bottom")).toBe(false);
    });

    it("交叉轴不一样长：新组只占目标那一段，结果不同，不算", () => {
        expect(sitsAtEdge(upper, right, "right")).toBe(false);
        expect(sitsAtEdge(right, upper, "left")).toBe(false);
    });

    it("中间隔着别的组：不算", () => {
        expect(sitsAtEdge(left, {left: 802, top: 0, right: 1200, bottom: 800}, "right")).toBe(false);
    });
});
