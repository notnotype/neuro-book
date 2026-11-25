/**
 * IDE 工具窗示例的模型（`examples/ide/src/model.ts`）：点按钮的结果、跨条移动后两边的状态、没有按钮的区、最大化、
 * 存档与读档的判据。界面上的行为在 `e2e/ide.e2e.ts`。测试放在这里而不放进示例目录：第三方拷走的目录里不带测试。
 */

import {describe, expect, it} from "bun:test";

import {dropKey, resolveDrop, type StripGeometry} from "../examples/ide/src/drop";
import {BACKUP_KEY, IdeLayout, loadLayout, saveLayout, STORAGE_KEY, type LayoutStorage, type Zone} from "../examples/ide/src/model";
import {createGridGestureSession} from "./grid-gesture";
import {branchSashPanels} from "./grid-geometry";
import {solveSashDrag} from "./sash-drag";

const WIDE = {width: 1440, height: 860};

/** 内存里的一份存储：与 `localStorage` 同样的两个方法。 */
function memoryStorage(initial: Record<string, string> = {}): LayoutStorage & {readonly items: Map<string, string>} {
    const items = new Map(Object.entries(initial));
    return {items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value)};
}

/** 区此刻展开后的主轴尺寸：按布局读，不读意图。 */
function presented(layout: IdeLayout, zone: "left" | "right" | "bottom"): number {
    const size = layout.grid.layout(WIDE).sizes[zone]!;
    return zone === "bottom" ? size.height : size.width;
}

/** 右区与中列之间的分隔线（main 的第 2 条）上的一场手势，与 `NestedGrid` 同一条路径：真实的会话、按当前布局取基线。 */
function session(layout: IdeLayout) {
    return createGridGestureSession<string>({contextKey: "ide", revision: 1, root: layout.grid.root(), extent: WIDE, layout: layout.grid.layout(WIDE), sashSize: 4, sessionId: "locked", source: "keyboard", sashes: [{branchId: "main", index: 2, axis: "width"}]});
}

describe("点按钮", () => {
    it("区收着：展开并显示它；区显示着别的：换成它；已经显示它：收起，显示的留着", () => {
        const layout = IdeLayout.createDefault();
        expect(layout.isOpen("project")).toBe(true);
        expect(layout.toggleTool("structure").ok).toBe(true);
        expect(layout.shown.left).toBe("structure");
        expect(layout.isOpen("structure")).toBe(true);
        expect(layout.isOpen("project")).toBe(false);
        expect(layout.toggleTool("structure").ok).toBe(true);
        expect(layout.isCollapsed("left")).toBe(true);
        expect(layout.shown.left).toBe("structure");
        // 再点一次：展开，显示的还是它。
        layout.toggleTool("structure");
        expect(layout.isCollapsed("left")).toBe(false);
        expect(layout.isOpen("structure")).toBe(true);
        // 收着的右区：点它的按钮展开并显示它。
        expect(layout.isCollapsed("right")).toBe(true);
        layout.toggleTool("outline");
        expect(layout.isCollapsed("right")).toBe(false);
        expect(layout.shown.right).toBe("outline");
    });

    it("展开回到拖宽之后的宽度：收起不改意图", () => {
        const layout = IdeLayout.createDefault();
        layout.grid.setSize("left", 333);
        layout.toggleTool("project");
        expect(presented(layout, "left")).toBe(0);
        layout.toggleTool("project");
        expect(presented(layout, "left")).toBe(333);
    });

    it("不认识的工具窗交回失败、模型不变", () => {
        const layout = IdeLayout.createDefault();
        const before = JSON.stringify(layout.toSaved());
        const result = layout.toggleTool("nope");
        expect(result.ok ? null : result.code).toBe("unknown-tool");
        expect(JSON.stringify(layout.toSaved())).toBe(before);
    });
});

describe("按钮条之间的移动", () => {
    it("同一条里换位置：次序变，区不动", () => {
        const layout = IdeLayout.createDefault();
        expect(layout.moveTool("project", "left", "bookmarks").ok).toBe(true);
        expect(layout.strips.left).toEqual(["structure", "project", "bookmarks"]);
        expect(layout.moveTool("project", "left", null).ok).toBe(true);
        expect(layout.strips.left).toEqual(["structure", "bookmarks", "project"]);
        expect(layout.shown.left).toBe("project");
        expect(layout.isCollapsed("left")).toBe(false);
    });

    it("拖到另一条：成为那个区显示的、区展开；来源显示的是它就换成剩下的第一个", () => {
        const layout = IdeLayout.createDefault();
        expect(layout.moveTool("project", "right", "outline").ok).toBe(true);
        expect(layout.strips.right).toEqual(["project", "outline"]);
        expect(layout.shown.right).toBe("project");
        expect(layout.isCollapsed("right")).toBe(false);
        expect(layout.strips.left).toEqual(["structure", "bookmarks"]);
        expect(layout.shown.left).toBe("structure");
        expect(layout.isCollapsed("left")).toBe(false);
    });

    it("拖走的不是来源区显示的：来源区不变", () => {
        const layout = IdeLayout.createDefault();
        layout.moveTool("bookmarks", "bottom", null);
        expect(layout.shown.left).toBe("project");
        expect(layout.isCollapsed("left")).toBe(false);
        expect(layout.shown.bottom).toBe("bookmarks");
        expect(layout.isCollapsed("bottom")).toBe(false);
    });

    it("拖走来源条上的最后一个：来源区收起、不再显示任何一个", () => {
        const layout = IdeLayout.createDefault();
        layout.toggleTool("outline");
        expect(layout.isCollapsed("right")).toBe(false);
        layout.moveTool("outline", "left", null);
        expect(layout.strips.right).toEqual([]);
        expect(layout.isCollapsed("right")).toBe(true);
        expect(layout.shown.right).toBeNull();
        expect(layout.shown.left).toBe("outline");
    });

    it("来源区收着、拖走它显示的：显示的换成剩下的第一个，区仍收着", () => {
        const layout = IdeLayout.createDefault();
        layout.toggleTool("project");
        layout.moveTool("project", "bottom", null);
        expect(layout.shown.left).toBe("structure");
        expect(layout.isCollapsed("left")).toBe(true);
    });

    it("插入位不在目标条上时交回失败、模型不变，不悄悄排到最后", () => {
        const layout = IdeLayout.createDefault();
        const before = JSON.stringify(layout.toSaved());
        const missing = layout.moveTool("project", "bottom", "outline");
        expect(missing.ok ? null : missing.code).toBe("bad-position");
        const self = layout.moveTool("project", "left", "project");
        expect(self.ok ? null : self.code).toBe("bad-position");
        expect(JSON.stringify(layout.toSaved())).toBe(before);
    });
});

describe("按钮条的厚度", () => {
    /** 三个区都展开：条最容易被挤的状态。 */
    const allOpen = () => {
        const layout = IdeLayout.createDefault();
        layout.toggleTool("outline");
        layout.toggleTool("terminal");
        return layout;
    };
    const thicknesses = (layout: IdeLayout, size: {width: number; height: number}) => {
        const {sizes} = layout.grid.layout(size);
        return [sizes["left-stripe"]!.width, sizes["right-stripe"]!.width, sizes["bottom-stripe"]!.height];
    };

    it("缺省布局里左右条宽 28、下条高 24", () => {
        expect(thicknesses(IdeLayout.createDefault(), WIDE)).toEqual([28, 28, 24]);
    });

    it("拖左区与中列之间的分隔线到头：位移由近到远传给兄弟，右条仍是 28", () => {
        const layout = allOpen();
        const main = layout.grid.find("main");
        if (main?.kind !== "branch") throw new Error("main is not a branch");
        const ids = main.children.map((child) => child.id);
        const root = layout.grid.layout(WIDE);
        const baseline = Object.fromEntries(ids.map((id) => [id, root.sizes[id]!.width]));
        // 与分隔线手势同一条路径：求解器给出目标尺寸，再经 resizeBranches 落账。
        const solved = solveSashDrag({panels: branchSashPanels(main, 4), baselinePx: ids.map((id) => baseline[id]!), sashIndex: 1, deltaPx: 900, snapState: null});
        expect(solved).not.toBeNull();
        const target = Object.fromEntries(ids.map((id, index) => [id, solved!.sizesPx[index]!]));
        expect(layout.grid.resizeBranches([{branchId: "main", axis: "width", baseline, target, collapsed: solved!.collapsed}]).ok).toBe(true);
        expect(thicknesses(layout, WIDE)).toEqual([28, 28, 24]);
        expect(layout.grid.find("right-stripe")?.size.width).toBe(28);
    });

    it("窄窗口、三区全开：区与编辑区让出空间，条仍是 28 与 24；窄到放不下时条最后才让", () => {
        const layout = allOpen();
        // 684 是三区都展开时各最小尺寸（编辑区 300、两个区各 160、两条 28、区旁的两条分隔线各 4，条旁的分隔线是 0）的总和。
        // 再窄就是库的 over-constrained：区与编辑区按比例一起压，刚性的条最后才让（见 README 的已知限制）。
        for (const width of [900, 800, 700, 684, 600]) expect(thicknesses(layout, {width, height: 500})).toEqual([28, 28, 24]);
        const narrow = layout.grid.layout({width: 600, height: 500});
        expect(narrow.issues.map((issue) => `${issue.code}/${String(issue.params?.cause)}/${String(issue.params?.id)}`)).toContain("over-constrained/min-total/main");
        expect(narrow.sizes.left!.width).toBeLessThan(160);
    });
});

describe("没有按钮的区", () => {
    const emptied = () => {
        const layout = IdeLayout.createDefault();
        layout.moveTool("outline", "left", null);
        return layout;
    };

    it("条旁的分隔线宽 0（库按不可交互画），只留区旁的那一条；有按钮的区的分隔线能拖", () => {
        const layout = IdeLayout.createDefault();
        expect(layout.grid.layout(WIDE).sashSizes).toMatchObject({root: [0], main: [0, 4, 4, 0], center: [4]});
        expect(layout.sashLocked("left", "center")).toBe(false);
        expect(layout.sashLocked("center", "right")).toBe(false);
        expect(layout.sashLocked("editor", "bottom")).toBe(false);
    });

    it("条上没有按钮的区，挨着它的分隔线不能拖", () => {
        const layout = emptied();
        expect(layout.sashLocked("center", "right")).toBe(true);
        expect(layout.sashLocked("left", "center")).toBe(false);
    });

    it("区锁住：拖它的分隔线拉不开，分隔线上的 Enter 也展不开", () => {
        const layout = emptied();
        expect(layout.grid.find("right")?.collapse).toMatchObject({collapsed: true, locked: true});
        // 往左拉过展开阈值（区的最小尺寸 160 加 24）很远：锁住的区留在收起尺寸 0，同侧只剩刚性的条，没有能动的，这场手势不提交。
        const drag = session(layout);
        const preview = drag.update({x: -400, y: 0});
        expect(preview?.layout.sizes.right?.width ?? 0).toBe(0);
        expect(drag.finish()).toBeNull();
        // Enter 跳过锁住的那一侧，另一侧是中列（没有收起策略），什么也不切换。
        const enter = session(layout);
        enter.toggleCollapsed();
        expect(enter.finish()).toBeNull();
        expect(layout.isCollapsed("right")).toBe(true);
        expect(presented(layout, "right")).toBe(0);
    });

    it("收着、什么也没显示的区，条被搬空：同样锁住", () => {
        const layout = IdeLayout.createDefault();
        expect(layout.isCollapsed("right")).toBe(true);
        expect(layout.shown.right).toBeNull();
        layout.moveTool("outline", "left", null);
        expect(layout.grid.find("right")?.collapse).toMatchObject({collapsed: true, locked: true});
        // 搬回来：区展开、解锁。
        layout.moveTool("outline", "right", null);
        expect(layout.isCollapsed("right")).toBe(false);
        expect(layout.grid.find("right")?.collapse).not.toHaveProperty("locked");
    });

    it("读档时条上没有按钮的区锁住", () => {
        const storage = memoryStorage();
        saveLayout(storage, emptied());
        const {layout} = loadLayout(storage);
        expect(layout.strips.right).toEqual([]);
        expect(layout.grid.find("right")?.collapse).toMatchObject({collapsed: true, locked: true});
        expect(layout.grid.find("left")?.collapse).not.toHaveProperty("locked");
    });
});

describe("分隔线展开区之后", () => {
    it("显示为空的区补上这条上的第一个", () => {
        const layout = IdeLayout.createDefault();
        expect(layout.shown.bottom).toBeNull();
        layout.grid.setCollapsed("bottom", false);
        layout.reconcile();
        expect(layout.shown.bottom).toBe("terminal");
        expect(layout.isOpen("terminal")).toBe(true);
    });

    it("已经有显示的不换；收着的区不碰", () => {
        const layout = IdeLayout.createDefault();
        layout.toggleTool("problems");
        layout.toggleTool("problems");
        layout.grid.setCollapsed("bottom", false);
        layout.reconcile();
        expect(layout.shown.bottom).toBe("problems");
        const fresh = IdeLayout.createDefault();
        fresh.reconcile();
        expect(fresh.shown.right).toBeNull();
    });
});

describe("最大化编辑区", () => {
    it("只在内存：开关之后存档不变", () => {
        const layout = IdeLayout.createDefault();
        const before = JSON.stringify(layout.toSaved());
        layout.toggleMaximized();
        expect(layout.maximized).toBe(true);
        expect(JSON.stringify(layout.toSaved())).toBe(before);
        layout.toggleMaximized();
        expect(layout.maximized).toBe(false);
    });

    it("点按钮、快捷键开关、把按钮拖走：先退出最大化，再照常做", () => {
        const layout = IdeLayout.createDefault();
        layout.toggleMaximized();
        layout.toggleTool("structure");
        expect(layout.maximized).toBe(false);
        expect(layout.isOpen("structure")).toBe(true);

        layout.toggleMaximized();
        layout.moveTool("terminal", "left", null);
        expect(layout.maximized).toBe(false);
        expect(layout.strips.left).toContain("terminal");
        expect(layout.isOpen("terminal")).toBe(true);
    });

    it("操作被拒时不退出最大化", () => {
        const layout = IdeLayout.createDefault();
        layout.toggleMaximized();
        expect(layout.moveTool("terminal", "left", "outline").ok).toBe(false);
        expect(layout.toggleTool("nope").ok).toBe(false);
        expect(layout.maximized).toBe(true);
    });
});

describe("存档与读档", () => {
    it("存了再读：尺寸、收起、显示的、各条上的次序与归属都还原", () => {
        const layout = IdeLayout.createDefault();
        layout.moveTool("problems", "left", "structure");
        layout.moveTool("outline", "bottom", "terminal");
        layout.grid.setSize("left", 320);
        layout.grid.setSize("bottom", 150);
        layout.toggleTool("problems");
        const storage = memoryStorage();
        expect(saveLayout(storage, layout)).toBeNull();
        const {layout: loaded, notice} = loadLayout(storage);
        expect(notice).toBeNull();
        expect(loaded.toSaved()).toEqual(layout.toSaved());
        expect(loaded.strips).toEqual(layout.strips);
        expect(loaded.isCollapsed("left")).toBe(true);
        expect(loaded.isOpen("outline")).toBe(true);
        // 收起着存档的区，展开之后回到收起前的宽度。
        loaded.toggleTool("problems");
        expect(presented(loaded, "left")).toBe(320);
        expect(presented(loaded, "bottom")).toBe(150);
    });

    it("收起着存档的区，展开回到收起前的宽度", () => {
        const layout = IdeLayout.createDefault();
        layout.grid.setSize("left", 333);
        layout.toggleTool("project");
        const storage = memoryStorage();
        saveLayout(storage, layout);
        const {layout: loaded} = loadLayout(storage);
        expect(loaded.isCollapsed("left")).toBe(true);
        expect(presented(loaded, "left")).toBe(0);
        // 按钮展开回到意图；分隔线上的 Enter 也回到它，那条路在 e2e 里测。
        loaded.toggleTool("project");
        expect(presented(loaded, "left")).toBe(333);
    });

    it("存档只存尺寸意图与收起", () => {
        const saved = IdeLayout.createDefault().toSaved();
        expect(Object.keys(saved.zones.left).sort()).toEqual(["collapsed", "size"]);
    });

    it("拖到最小尺寸以下收起（分隔线手势的落账）后存档：存的是收起前的尺寸，不是 0", () => {
        const layout = IdeLayout.createDefault();
        layout.grid.setSize("left", 300);
        const root = layout.grid.layout(WIDE);
        const baseline = Object.fromEntries(["left-stripe", "left", "center", "right", "right-stripe"].map((id) => [id, root.sizes[id]!.width]));
        const target = {...baseline, left: 0, center: baseline.center! + baseline.left!};
        const result = layout.grid.resizeBranches([{branchId: "main", axis: "width", baseline, target, collapsed: {left: true}}]);
        expect(result.ok).toBe(true);
        expect(layout.isCollapsed("left")).toBe(true);
        const saved = layout.toSaved();
        expect(saved.zones.left).toEqual({collapsed: true, size: 300});
    });

    const saved = () => JSON.parse(JSON.stringify(IdeLayout.createDefault().toSaved())) as Record<string, any>;
    /** 每例写明它要命中的那一支：`fromSaved` 交回的码与说明里的一句话。 */
    const broken: ReadonlyArray<readonly [string, () => string, string, string]> = [
        ["版本不认识", () => JSON.stringify({...saved(), version: 2}), "bad-shape", "Unrecognised"],
        ["形状不对", () => JSON.stringify({...saved(), zones: {left: {size: "wide"}}}), "bad-shape", "Unrecognised"],
        ["尺寸不是数", () => { const value = saved(); value.zones.left.size = null; return JSON.stringify(value); }, "bad-shape", "Unrecognised"],
        // JSON 里的 1e999 解析成 Infinity：它是数，形状判得过，要靠有限数那一支拒绝。
        ["尺寸不是有限数", () => JSON.stringify(saved()).replace('"left":{"size":260', '"left":{"size":1e999'), "bad-size", "out of range"],
        ["尺寸小于最小尺寸", () => { const value = saved(); value.zones.left.size = 50; return JSON.stringify(value); }, "bad-size", "out of range"],
        ["工具窗少一个", () => { const value = saved(); value.strips.bottom = ["terminal"]; return JSON.stringify(value); }, "bad-tools", "exactly the six"],
        ["工具窗不认识", () => { const value = saved(); value.strips.bottom = ["terminal", "debugger"]; return JSON.stringify(value); }, "bad-tools", "exactly the six"],
        ["同一个工具窗在两条上", () => { const value = saved(); value.strips.bottom = ["terminal", "project"]; return JSON.stringify(value); }, "bad-tools", "exactly the six"],
        ["显示的不在它那条上", () => { const value = saved(); value.shown.left = "terminal"; return JSON.stringify(value); }, "bad-shown", "not on its strip"],
        ["展开的区没有显示任何一个", () => { const value = saved(); value.shown.left = null; return JSON.stringify(value); }, "bad-shown", "shows nothing"],
    ];
    it.each(broken)("存档坏（%s）：交回原因，用缺省布局、原件原样搬到备份键", (_name, make, code, part) => {
        const raw = make();
        const failed = IdeLayout.fromSaved(JSON.parse(raw));
        expect(failed.ok ? null : failed.code).toBe(code);
        expect(failed.ok ? "" : failed.message).toContain(part);
        const storage = memoryStorage({[STORAGE_KEY]: raw});
        const {layout, notice, keep} = loadLayout(storage);
        expect(notice).toContain("the original is kept as a backup");
        expect(keep).toBe(true);
        expect(layout.toSaved()).toEqual(IdeLayout.createDefault().toSaved());
        expect(storage.items.get(BACKUP_KEY)).toBe(raw);
    });

    it("JSON 坏：用缺省布局、原件原样搬到备份键", () => {
        const storage = memoryStorage({[STORAGE_KEY]: "{not json"});
        const {layout, notice, keep} = loadLayout(storage);
        expect(notice).toContain("not valid JSON");
        expect(keep).toBe(true);
        expect(layout.toSaved()).toEqual(IdeLayout.createDefault().toSaved());
        expect(storage.items.get(BACKUP_KEY)).toBe("{not json");
    });

    it("尺寸很大的存档照常读：上限没有，意图由库按约束压缩", () => {
        const value = saved();
        value.zones.right.size = 9000;
        const loaded = IdeLayout.fromSaved(value);
        expect(loaded.ok).toBe(true);
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
        expect(saveLayout(full, IdeLayout.createDefault())).toBe("Saving the layout failed");
    });
});

describe("落点（drop.ts）", () => {
    const rect = (left: number, top: number, right: number, bottom: number) => ({left, top, right, bottom});
    /**
     * 三条按钮条的几何，视口坐标：左条在 x 0 到 28，三个按钮各高 60（y 0 到 180），条整条到 y 400；
     * 右条在 x 800 到 828、空；下条在 y 420 到 444，两个按钮各宽 100（x 0 到 200），条整条到 x 400。
     */
    const geometry = (right: readonly string[] = []): StripGeometry[] => [
        {strip: "left", rect: rect(0, 0, 28, 400), buttons: ["project", "structure", "bookmarks"].map((id, index) => ({id, rect: rect(0, index * 60, 28, index * 60 + 60)}))},
        {strip: "right", rect: rect(800, 0, 828, 400), buttons: right.map((id, index) => ({id, rect: rect(800, index * 60, 828, index * 60 + 60)}))},
        {strip: "bottom", rect: rect(0, 420, 400, 444), buttons: ["terminal", "problems"].map((id, index) => ({id, rect: rect(index * 100, 420, index * 100 + 100, 444)}))},
    ];
    const LEFT = {strip: "left" as Zone, order: ["project", "structure", "bookmarks"]};
    const BOTTOM = {strip: "bottom" as Zone, order: ["terminal", "problems"]};
    const key = (drop: ReturnType<typeof resolveDrop>) => (drop === null ? "none" : dropKey(drop));

    it("竖向的左条：插在按钮前面，条尾是 end", () => {
        expect(key(resolveDrop("bookmarks", LEFT, {x: 14, y: 5}, geometry()))).toBe("move:left:project");
        expect(key(resolveDrop("bookmarks", LEFT, {x: 14, y: 65}, geometry()))).toBe("move:left:structure");
        // 最后一个按钮之后、条的外框里：排到最后。
        expect(key(resolveDrop("project", LEFT, {x: 14, y: 300}, geometry()))).toBe("move:left:end");
    });

    it("横向的下条：用横轴判，插在按钮前面，条尾是 end", () => {
        expect(key(resolveDrop("problems", BOTTOM, {x: 5, y: 432}, geometry()))).toBe("move:bottom:terminal");
        expect(key(resolveDrop("terminal", BOTTOM, {x: 305, y: 432}, geometry()))).toBe("move:bottom:end");
        // 同一个横坐标落在竖向的条里就是别的结果：证明横条没有按竖轴判。
        expect(key(resolveDrop("terminal", BOTTOM, {x: 105, y: 432}, geometry()))).toBe("none");
        expect(key(resolveDrop("project", LEFT, {x: 105, y: 432}, geometry()))).toBe("move:bottom:problems");
    });

    it("原位不是落点：插在自己前面、插在自己后面那个前面，都是 none；最后一个拖到自己条尾也是", () => {
        // 竖向：structure 的上半是它前面，下半是 bookmarks 前面。
        expect(key(resolveDrop("structure", LEFT, {x: 14, y: 65}, geometry()))).toBe("none");
        expect(key(resolveDrop("structure", LEFT, {x: 14, y: 115}, geometry()))).toBe("none");
        // 别处仍是落点：插在 project 前面，或者排到最后。
        expect(key(resolveDrop("structure", LEFT, {x: 14, y: 5}, geometry()))).toBe("move:left:project");
        expect(key(resolveDrop("structure", LEFT, {x: 14, y: 175}, geometry()))).toBe("move:left:end");
        // 最后一个：自己的后半与条尾都是原位，前半是插在自己前面，也是原位。
        expect(key(resolveDrop("bookmarks", LEFT, {x: 14, y: 175}, geometry()))).toBe("none");
        expect(key(resolveDrop("bookmarks", LEFT, {x: 14, y: 300}, geometry()))).toBe("none");
        // 横向同样。
        expect(key(resolveDrop("terminal", BOTTOM, {x: 5, y: 432}, geometry()))).toBe("none");
        expect(key(resolveDrop("terminal", BOTTOM, {x: 95, y: 432}, geometry()))).toBe("none");
        expect(key(resolveDrop("problems", BOTTOM, {x: 395, y: 432}, geometry()))).toBe("none");
    });

    it("别的条上同样的位置是落点：原位只对来源自己的那条而言", () => {
        expect(key(resolveDrop("structure", LEFT, {x: 14, y: 65}, geometry().map((each) => (each.strip === "left" ? {...each, strip: "right" as Zone} : each.strip === "right" ? {...each, strip: "left" as Zone} : each))))).toBe("move:right:structure");
    });

    it("空条整条都是落点，排到最后", () => {
        expect(key(resolveDrop("project", LEFT, {x: 814, y: 200}, geometry()))).toBe("move:right:end");
    });

    it("条的外面不是落点：编辑区、条之间、整个界面之外", () => {
        expect(key(resolveDrop("project", LEFT, {x: 400, y: 200}, geometry()))).toBe("none");
        expect(key(resolveDrop("project", LEFT, {x: 14, y: 410}, geometry()))).toBe("none");
        expect(key(resolveDrop("project", LEFT, {x: -50, y: -50}, geometry()))).toBe("none");
    });
});
