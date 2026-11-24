/**
 * IDE 工具窗示例的模型（`examples/ide/src/model.ts`）：点按钮的结果、跨条移动后两边的状态、没有按钮的区、最大化、
 * 存档与读档的判据。界面上的行为在 `e2e/ide.e2e.ts`。测试放在这里而不放进示例目录：第三方拷走的目录里不带测试。
 */

import {describe, expect, it} from "bun:test";

import {BACKUP_KEY, IdeLayout, loadLayout, saveLayout, STORAGE_KEY, type LayoutStorage} from "../examples/ide/src/model";

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

describe("没有按钮的区", () => {
    const emptied = () => {
        const layout = IdeLayout.createDefault();
        layout.moveTool("outline", "left", null);
        return layout;
    };

    it("条旁的分隔线不能拖；有按钮的区的分隔线能拖", () => {
        const layout = IdeLayout.createDefault();
        expect(layout.sashLocked("left-stripe", "left")).toBe(true);
        expect(layout.sashLocked("right", "right-stripe")).toBe(true);
        expect(layout.sashLocked("main", "bottom-stripe")).toBe(true);
        expect(layout.sashLocked("left", "center")).toBe(false);
        expect(layout.sashLocked("center", "right")).toBe(false);
        expect(layout.sashLocked("editor", "bottom")).toBe(false);
    });

    it("条上没有按钮的区，挨着它的分隔线不能拖", () => {
        const layout = emptied();
        expect(layout.sashLocked("center", "right")).toBe(true);
        expect(layout.sashLocked("left", "center")).toBe(false);
    });

    it("分隔线把它展开了也收回去，不留下收不起来的空区", () => {
        const layout = emptied();
        layout.grid.setCollapsed("right", false);
        expect(layout.reconcile()).toBe(true);
        expect(layout.isCollapsed("right")).toBe(true);
        expect(layout.shown.right).toBeNull();
    });
});

describe("分隔线展开区之后", () => {
    it("显示为空的区补上这条上的第一个", () => {
        const layout = IdeLayout.createDefault();
        expect(layout.shown.bottom).toBeNull();
        layout.grid.setCollapsed("bottom", false);
        expect(layout.reconcile()).toBe(false);
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

    it("重新载入后恢复尺寸还在：收着存档的区它是收起前的尺寸，意图也是", () => {
        const layout = IdeLayout.createDefault();
        layout.grid.setSize("left", 333);
        layout.toggleTool("project");
        const storage = memoryStorage();
        saveLayout(storage, layout);
        const {layout: loaded} = loadLayout(storage);
        const left = loaded.grid.find("left");
        expect(left?.kind === "leaf" ? left.collapse : undefined).toMatchObject({collapsed: true, restoreSize: 333});
        expect(loaded.grid.find("left")?.size.width).toBe(333);
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
        expect(saved.zones.left).toMatchObject({collapsed: true, size: 300, restoreSize: 300});
    });

    const saved = () => JSON.parse(JSON.stringify(IdeLayout.createDefault().toSaved())) as Record<string, any>;
    const broken: ReadonlyArray<readonly [string, () => string]> = [
        ["JSON 坏", () => "{not json"],
        ["版本不认识", () => JSON.stringify({...saved(), version: 2})],
        ["形状不对", () => JSON.stringify({...saved(), zones: {left: {size: "wide"}}})],
        ["尺寸不是有限数", () => { const value = saved(); value.zones.left.size = null; return JSON.stringify(value); }],
        ["尺寸小于最小尺寸", () => { const value = saved(); value.zones.left.size = 50; return JSON.stringify(value); }],
        ["恢复尺寸小于最小尺寸", () => { const value = saved(); value.zones.bottom.restoreSize = 10; return JSON.stringify(value); }],
        ["尺寸大得不合理", () => { const value = saved(); value.zones.right.size = 1e9; return JSON.stringify(value); }],
        ["工具窗少一个", () => { const value = saved(); value.strips.bottom = ["terminal"]; return JSON.stringify(value); }],
        ["工具窗不认识", () => { const value = saved(); value.strips.bottom = ["terminal", "debugger"]; return JSON.stringify(value); }],
        ["同一个工具窗在两条上", () => { const value = saved(); value.strips.bottom = ["terminal", "project"]; return JSON.stringify(value); }],
        ["显示的不在它那条上", () => { const value = saved(); value.shown.left = "terminal"; return JSON.stringify(value); }],
        ["展开的区没有显示任何一个", () => { const value = saved(); value.shown.left = null; return JSON.stringify(value); }],
        ["展开的区没有按钮", () => { const value = saved(); value.zones.right.collapsed = false; value.strips.left.push("outline"); value.strips.right = []; value.shown.right = null; return JSON.stringify(value); }],
    ];
    it.each(broken)("存档坏（%s）：用缺省布局、说明原因、原件原样搬到备份键", (_name, make) => {
        const raw = make();
        const storage = memoryStorage({[STORAGE_KEY]: raw});
        const {layout, notice, keep} = loadLayout(storage);
        expect(notice).toContain("the original is kept as a backup");
        expect(keep).toBe(true);
        expect(layout.toSaved()).toEqual(IdeLayout.createDefault().toSaved());
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
        expect(saveLayout(full, IdeLayout.createDefault())).toBe("Saving the layout failed");
    });
});
