/**
 * 标签编组示例的模型（`examples/tabbed-panels/src/model.ts`）：操作的后置条件、试拆、读档的判据。界面上的行为在
 * `e2e/tabbed-panels.e2e.ts`。测试放在这里而不放进示例目录：第三方拷走的目录里不带测试。
 */

import {describe, expect, it} from "bun:test";

import {BACKUP_KEY, loadLayout, saveLayout, STORAGE_KEY, TabbedLayout, type LayoutStorage} from "../examples/tabbed-panels/src/model";

const WIDE = {width: 1440, height: 860};
/** 此刻的快照格式版本：从示例自己存出来的取，不写死。 */
const SNAPSHOT_VERSION = TabbedLayout.createDefault().toSaved().grid.version;

/** 内存里的一份存储：与 `localStorage` 同样的两个方法。 */
function memoryStorage(initial: Record<string, string> = {}): LayoutStorage & {readonly items: Map<string, string>} {
    const items = new Map(Object.entries(initial));
    return {items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value)};
}

const tabsOf = (layout: TabbedLayout, group: string) => layout.groups.get(group)?.tabs;
const activeOf = (layout: TabbedLayout, group: string) => layout.groups.get(group)?.active;

describe("标签编组的操作", () => {
    it("挪进别的编组：插在给的标签前面、成为选中；来源拿走的是选中时选右邻", () => {
        const layout = TabbedLayout.createDefault();
        expect(layout.moveTab("README.md", "group-2", "todo.txt").ok).toBe(true);
        expect(tabsOf(layout, "group-2")).toEqual(["notes.txt", "README.md", "todo.txt"]);
        expect(activeOf(layout, "group-2")).toBe("README.md");
        expect(activeOf(layout, "group-1")).toBe("main.ts");
    });

    it("拿走最右边的选中标签时选左邻", () => {
        const layout = TabbedLayout.createDefault();
        layout.activate("model.ts");
        layout.moveTab("model.ts", "group-2", null);
        expect(activeOf(layout, "group-1")).toBe("App.vue");
    });

    it("插入位不在目标编组里时交回失败、模型不变，不悄悄排到最后", () => {
        const layout = TabbedLayout.createDefault();
        const before = JSON.stringify(layout.toSaved());
        const missing = layout.moveTab("README.md", "group-2", "styles.css");
        expect(missing.ok ? null : missing.code).toBe("bad-position");
        const self = layout.moveTab("main.ts", "group-1", "main.ts");
        expect(self.ok ? null : self.code).toBe("bad-position");
        expect(JSON.stringify(layout.toSaved())).toBe(before);
    });

    it("来源编组空了连叶一起删", () => {
        const layout = TabbedLayout.createDefault();
        layout.moveTab("styles.css", "group-2", null);
        layout.moveTab("index.html", "group-2", null);
        expect(layout.groups.has("group-3")).toBe(false);
        expect(layout.grid.find("group-3")).toBeNull();
        expect(layout.groupIds()).toEqual(["group-1", "group-2"]);
    });

    it("最后一个编组的最后一个标签不能关", () => {
        const layout = TabbedLayout.createDefault();
        for (const tab of ["notes.txt", "todo.txt", "styles.css", "index.html", "README.md", "main.ts", "App.vue"]) expect(layout.closeTab(tab).ok).toBe(true);
        const last = layout.closeTab("model.ts");
        expect(last.ok ? null : last.code).toBe("last-tab");
        expect(tabsOf(layout, "group-1")).toEqual(["model.ts"]);
    });

    it("拆分：新编组在目标的那一边，id 不与已有的撞；单标签的来源消失", () => {
        const layout = TabbedLayout.createDefault();
        layout.moveTab("styles.css", "group-2", null);
        expect(layout.splitWithTab("index.html", "group-2", "right").ok).toBe(true);
        expect(layout.groupIds()).toEqual(["group-1", "group-2", "group-4"]);
        expect(tabsOf(layout, "group-4")).toEqual(["index.html"]);
        expect(layout.groups.has("group-3")).toBe(false);
    });

    it("单标签编组不能拿自己的标签拆自己", () => {
        const layout = TabbedLayout.createDefault();
        layout.moveTab("styles.css", "group-2", null);
        const result = layout.splitWithTab("index.html", "group-3", "left");
        expect(result.ok ? null : result.code).toBe("self");
        expect(tabsOf(layout, "group-3")).toEqual(["index.html"]);
    });

    it("拆分被库拒绝时模型一点没动", () => {
        // 读一份很深的存档：每层一个编组加下一层，层数一直加到最深的那块再拆就被库按深度上限拒绝。
        const deep = (levels: number) => {
            const groups: Record<string, {tabs: string[]; active: string}> = {};
            let node: Record<string, unknown> = {kind: "leaf", id: "group-1", ref: "group-1", size: {width: 1, height: 1}};
            groups["group-1"] = {tabs: ["a", "b"], active: "a"};
            for (let level = 2; level <= levels; level += 1) {
                groups[`group-${level}`] = {tabs: [`t${level}`], active: `t${level}`};
                node = {kind: "branch", id: `split-${level}`, orientation: level % 2 === 0 ? "horizontal" : "vertical", size: {width: 1, height: 1}, children: [{kind: "leaf", id: `group-${level}`, ref: `group-${level}`, size: {width: 1, height: 1}}, node]};
            }
            const root = {kind: "branch", id: "root", orientation: "horizontal", size: {width: 1, height: 1}, children: [{kind: "leaf", id: "explorer", ref: "explorer", size: {width: 240, height: 1}}, node]};
            return TabbedLayout.fromSaved({version: 1, grid: {version: SNAPSHOT_VERSION, root}, groups, explorer: {collapsed: false}});
        };
        let checked = false;
        for (let levels = 8; levels <= 24 && !checked; levels += 1) {
            const loaded = deep(levels);
            if (!loaded.ok) continue;
            const layout = loaded.layout;
            const before = JSON.stringify(layout.toSaved());
            const result = layout.splitWithTab("b", "group-1", "bottom");
            if (result.ok) continue;
            expect(result.code).toBe("limit-exceeded");
            expect(JSON.stringify(layout.toSaved())).toBe(before);
            const trial = layout.canSplit("b", "group-1", "bottom", WIDE);
            expect(trial.ok ? null : trial.message).toBe("Too deeply nested");
            checked = true;
        }
        expect(checked).toBe(true);
    });

    it("试拆：放得下时能拆；拆到放不下时判 no-room，且照做之后库的布局确实报 over-constrained", () => {
        const layout = TabbedLayout.createDefault();
        let splits = 0;
        for (; splits < 10; splits += 1) {
            const source = [...layout.groups].find(([, group]) => group.tabs.length >= 2)![0];
            const tab = layout.groups.get(source)!.tabs.at(-1)!;
            const target = layout.groupIds().at(-1)!;
            const trial = layout.canSplit(tab, target, "right", WIDE);
            if (!trial.ok) {
                expect(trial.code).toBe("no-room");
                expect(layout.splitWithTab(tab, target, "right").ok).toBe(true);
                expect(layout.grid.layout(WIDE).issues.some((issue) => issue.code === "over-constrained")).toBe(true);
                break;
            }
            expect(layout.splitWithTab(tab, target, "right").ok).toBe(true);
            expect(layout.grid.layout(WIDE).issues.some((issue) => issue.code === "over-constrained")).toBe(false);
        }
        expect(splits).toBeGreaterThanOrEqual(2);
        expect(splits).toBeLessThan(10);
    });

    it("试拆不改原来的模型", () => {
        const layout = TabbedLayout.createDefault();
        const before = JSON.stringify(layout.toSaved());
        layout.canSplit("main.ts", "group-3", "right", WIDE);
        expect(JSON.stringify(layout.toSaved())).toBe(before);
    });
});

describe("存档与读档", () => {
    it("存了再读：编组、树、侧栏的收起都还原；读回来之后新 id 不撞", () => {
        const layout = TabbedLayout.createDefault();
        layout.splitWithTab("model.ts", "group-3", "right");
        layout.grid.setCollapsed("explorer", true);
        const storage = memoryStorage();
        expect(saveLayout(storage, layout)).toBeNull();
        const {layout: loaded, notice} = loadLayout(storage);
        expect(notice).toBeNull();
        expect(loaded.toSaved()).toEqual(layout.toSaved());
        expect(loaded.explorerState()).toEqual({collapsed: true});
        expect(loaded.splitWithTab("App.vue", "group-4", "bottom").ok).toBe(true);
        expect(loaded.groups.has("group-5")).toBe(true);
    });

    it("以前的存档里侧栏还带着收起前的宽度 `restoreSize`：照样读，不看它；展开回到快照里的宽度，新存档不再写它", () => {
        const layout = TabbedLayout.createDefault();
        layout.grid.setCollapsed("explorer", true);
        const old = {...layout.toSaved(), explorer: {collapsed: true, restoreSize: 9999}};
        const {layout: loaded, notice} = loadLayout(memoryStorage({[STORAGE_KEY]: JSON.stringify(old)}));
        expect(notice).toBeNull();
        expect(loaded.explorerState()).toEqual({collapsed: true});
        expect(loaded.toSaved().explorer).toEqual({collapsed: true});
        loaded.grid.setCollapsed("explorer", false);
        expect(loaded.grid.find("explorer")?.size.width).toBe(240);
    });

    const saved = () => JSON.parse(JSON.stringify(TabbedLayout.createDefault().toSaved())) as Record<string, any>;
    const broken: ReadonlyArray<readonly [string, () => string]> = [
        ["JSON 坏", () => "{not json"],
        ["版本不认识", () => JSON.stringify({...saved(), version: 2})],
        ["形状不对", () => JSON.stringify({...saved(), explorer: {collapsed: "no"}})],
        ["快照坏", () => JSON.stringify({...saved(), grid: {version: SNAPSHOT_VERSION, root: {kind: "leaf"}}})],
        ["树里有不认识的叶", () => JSON.stringify((({groups, ...rest}) => ({...rest, groups: Object.fromEntries(Object.entries(groups).filter(([id]) => id !== "group-2"))}))(saved()))],
        ["编组表里有树里没有的编组", () => JSON.stringify((({groups, ...rest}) => ({...rest, groups: {...groups, "group-9": {tabs: ["x"], active: "x"}}}))(saved()))],
        ["同一个标签在两个编组", () => { const value = saved(); value.groups["group-2"].tabs.push("README.md"); return JSON.stringify(value); }],
        ["选中的不在标签里", () => { const value = saved(); value.groups["group-2"].active = "nope"; return JSON.stringify(value); }],
        ["编组没有标签", () => { const value = saved(); value.groups["group-2"] = {tabs: [], active: ""}; return JSON.stringify(value); }],
        ["没有侧栏", () => { const value = saved(); value.grid.root.children = value.grid.root.children.filter((child: {id: string}) => child.id !== "explorer"); return JSON.stringify(value); }],
        ["侧栏不在最外层那一排", () => { const value = saved(); const [explorer, ...groups] = value.grid.root.children; value.grid.root.children = [{kind: "branch", id: "split-1", orientation: "vertical", size: {width: 1, height: 1}, children: [explorer, groups[0]]}, ...groups.slice(1)]; return JSON.stringify(value); }],
    ];
    it.each(broken)("存档坏（%s）：用缺省布局、说明原因、原件原样搬到备份键", (_name, make) => {
        const raw = make();
        const storage = memoryStorage({[STORAGE_KEY]: raw});
        const {layout, notice} = loadLayout(storage);
        expect(notice).toContain("the original is kept as a backup");
        expect(loadLayout(memoryStorage({[STORAGE_KEY]: raw})).keep).toBe(true);
        expect(layout.toSaved()).toEqual(TabbedLayout.createDefault().toSaved());
        expect(storage.items.get(BACKUP_KEY)).toBe(raw);
    });

    it("存档坏、备份也写不进去：用缺省布局，这一页不再保存，原件留在主键", () => {
        const raw = "{not json";
        const storage: LayoutStorage = {getItem: () => raw, setItem: () => { throw new Error("quota"); }};
        const loaded = loadLayout(storage);
        expect(loaded.keep).toBe(false);
        expect(loaded.notice).toContain("the original stays untouched");
    });

    it("读存储抛错与存储不可用：用缺省布局并说明", () => {
        const throwing: LayoutStorage = {getItem: () => { throw new Error("denied"); }, setItem: () => undefined};
        expect(loadLayout(throwing).notice).toContain("unavailable");
        expect(loadLayout(null).notice).toContain("unavailable");
    });

    it("保存抛错：交回原因，不往外抛", () => {
        const full: LayoutStorage = {getItem: () => null, setItem: () => { throw new Error("quota"); }};
        expect(saveLayout(full, TabbedLayout.createDefault())).toBe("Saving the layout failed");
    });
});
