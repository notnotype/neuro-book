/**
 * 桌面示例的模型（`examples/desktop/src/model.ts`）：状态表里每一格、平铺的树操作、缩放写回、试平铺、读档的判据。
 * 界面上的行为在 `e2e/desktop.e2e.ts`。测试放在这里而不放进示例目录：第三方拷走的目录里不带测试。
 */

import {describe, expect, it} from "bun:test";

import {
    BACKUP_KEY,
    DesktopLayout,
    DESKTOP,
    loadLayout,
    roundRect,
    saveLayout,
    STORAGE_KEY,
    WINDOW_IDS,
    type LayoutStorage,
    type Mode,
    type Result,
    type WindowId,
} from "../examples/desktop/src/model";

const WIDE = {width: 1440, height: 860};
const NARROW = {width: 700, height: 600};
/** 此刻的快照格式版本：从示例自己存出来的取，不写死。 */
const SNAPSHOT_VERSION = DesktopLayout.createDefault().toSaved().grid.version;

/** 内存里的一份存储：与 `localStorage` 同样的两个方法。 */
function memoryStorage(initial: Record<string, string> = {}): LayoutStorage & {readonly items: Map<string, string>} {
    const items = new Map(Object.entries(initial));
    return {items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value)};
}

const code = (result: Result) => (result.ok ? null : result.code);
const snapshotOf = (layout: DesktopLayout) => JSON.stringify(layout.toSaved());
const treeLeaves = (layout: DesktopLayout): string[] => {
    const out: string[] = [];
    const visit = (node: ReturnType<DesktopLayout["grid"]["root"]>): void => {
        if (node === null) return;
        if (node.kind === "leaf") out.push(node.id);
        else node.children.forEach(visit);
    };
    visit(layout.grid.root());
    return out;
};

/** 把一扇窗弄成某个模式。 */
function inMode(mode: Mode): DesktopLayout {
    const layout = DesktopLayout.createDefault();
    const id: WindowId = "notes";
    switch (mode) {
        case "floating": break;
        case "maximized": layout.toggleMaximize(id); break;
        case "tiled-left": layout.tile(id, "left", WIDE); break;
        case "tiled-right": layout.tile(id, "right", WIDE); break;
        case "minimized": layout.minimize(id); break;
        case "closed": layout.close(id); break;
    }
    expect(layout.mode(id)).toBe(mode);
    return layout;
}

describe("状态表：每个模式能做的和不能做的", () => {
    type Op = readonly [name: string, run: (layout: DesktopLayout) => Result];
    const ops: readonly Op[] = [
        ["move", (layout) => layout.move("notes", 100, 100)],
        ["resize", (layout) => layout.resize("notes", {x: 10, y: 10, width: 300, height: 200}, {width: 1, height: 1})],
        ["raise", (layout) => layout.raise("notes")],
        ["toggleMaximize", (layout) => layout.toggleMaximize("notes")],
        ["minimize", (layout) => layout.minimize("notes")],
        ["close", (layout) => layout.close("notes")],
        ["untile", (layout) => layout.untile("notes")],
        ["tile", (layout) => layout.tile("notes", "left", WIDE)],
    ];
    /** 每个模式下哪些操作做得成；不在表里的格子都得失败（`wrong-mode`）、模型一点不变。 */
    const allowed: Readonly<Record<Mode, readonly string[]>> = {
        floating: ["move", "resize", "raise", "toggleMaximize", "minimize", "close", "tile"],
        maximized: ["raise", "toggleMaximize", "minimize", "close"],
        "tiled-left": ["minimize", "close", "untile"],
        "tiled-right": ["minimize", "close", "untile"],
        minimized: [],
        closed: [],
    };
    const cells = (Object.keys(allowed) as Mode[]).flatMap((mode) => ops.map(([name, run]) => [mode, name, run] as const));
    it.each(cells)("%s 时 %s", (mode, name, run) => {
        const layout = inMode(mode);
        const before = snapshotOf(layout);
        const result = run(layout);
        if (allowed[mode].includes(name)) {
            expect(result.ok).toBe(true);
            return;
        }
        expect(code(result)).toBe("wrong-mode");
        expect(snapshotOf(layout)).toBe(before);
    });

    it("浮动的只写 x、y，宽高不动", () => {
        const layout = DesktopLayout.createDefault();
        layout.move("notes", 5, 6);
        expect(layout.windows.get("notes")!.floatRect).toEqual({x: 5, y: 6, width: 420, height: 300});
    });

    it("最大化再恢复回到原矩形；最小化记着来自哪个模式，点底栏回到它", () => {
        const layout = DesktopLayout.createDefault();
        const rect = layout.windows.get("notes")!.floatRect;
        layout.toggleMaximize("notes");
        layout.minimize("notes");
        expect(layout.windows.get("notes")!.before).toBe("maximized");
        expect(layout.dockClick("notes", WIDE).ok).toBe(true);
        expect(layout.mode("notes")).toBe("maximized");
        layout.toggleMaximize("notes");
        expect(layout.windows.get("notes")!.floatRect).toEqual(rect);
        layout.minimize("notes");
        layout.dockClick("notes", WIDE);
        expect(layout.mode("notes")).toBe("floating");
    });

    it("关闭后点底栏重新打开：浮动在记着的矩形，在最上面", () => {
        const layout = DesktopLayout.createDefault();
        layout.move("notes", 77, 88);
        layout.close("notes");
        layout.dockClick("notes", WIDE);
        expect(layout.mode("notes")).toBe("floating");
        expect(layout.windows.get("notes")!.floatRect.x).toBe(77);
        expect(layout.stack().at(-1)).toBe("notes");
    });

    it("点浮动窗的底栏按钮把它挪到最上面；平铺的什么都不改", () => {
        const layout = DesktopLayout.createDefault();
        layout.dockClick("notes", WIDE);
        expect(layout.stack().at(-1)).toBe("notes");
        layout.tile("calc", "left", WIDE);
        const before = snapshotOf(layout);
        expect(layout.dockClick("calc", WIDE).ok).toBe(true);
        expect(snapshotOf(layout)).toBe(before);
    });
});

describe("平铺的树操作", () => {
    it("桌面叶的父是竖向的根：拆桌面叶，窗在桌面的那一侧", () => {
        const layout = DesktopLayout.createDefault();
        expect(layout.tile("notes", "left", WIDE).ok).toBe(true);
        expect(treeLeaves(layout)).toEqual(["notes", DESKTOP, "dock"]);
        expect(layout.mode("notes")).toBe("tiled-left");
        const other = DesktopLayout.createDefault();
        other.tile("notes", "right", WIDE);
        expect(treeLeaves(other)).toEqual([DESKTOP, "notes", "dock"]);
    });

    it("第二扇在桌面叶另一侧，三块平分", () => {
        const layout = DesktopLayout.createDefault();
        layout.tile("notes", "left", WIDE);
        expect(layout.tile("calc", "right", WIDE).ok).toBe(true);
        expect(treeLeaves(layout)).toEqual(["notes", DESKTOP, "calc", "dock"]);
        const sizes = layout.grid.layout(WIDE).sizes;
        const widths = ["notes", DESKTOP, "calc"].map((id) => sizes[id]!.width);
        for (const width of widths) expect(Math.abs(width - widths[0]!)).toBeLessThanOrEqual(1);
    });

    it("只剩一扇时在同一侧换窗：先加后删，分支不丢，被换下的回到它的浮动矩形、在最上面", () => {
        const layout = DesktopLayout.createDefault();
        layout.tile("notes", "left", WIDE);
        const rect = layout.windows.get("notes")!.floatRect;
        expect(layout.tile("calc", "left", WIDE).ok).toBe(true);
        expect(treeLeaves(layout)).toEqual(["calc", DESKTOP, "dock"]);
        expect(layout.mode("calc")).toBe("tiled-left");
        expect(layout.mode("notes")).toBe("floating");
        expect(layout.windows.get("notes")!.floatRect).toEqual(rect);
        expect(layout.stack().at(-1)).toBe("notes");
        // 换下之后对侧还能再贴。
        expect(layout.tile("clock", "right", WIDE).ok).toBe(true);
        expect(treeLeaves(layout)).toEqual(["calc", DESKTOP, "clock", "dock"]);
    });

    it("取消平铺、最小化、关闭平铺的窗都出树；最后一扇出树后桌面回到根下，再贴照样成", () => {
        for (const leave of [(layout: DesktopLayout) => layout.untile("notes"), (layout: DesktopLayout) => layout.minimize("notes"), (layout: DesktopLayout) => layout.close("notes")]) {
            const layout = DesktopLayout.createDefault();
            layout.tile("notes", "left", WIDE);
            expect(leave(layout).ok).toBe(true);
            expect(treeLeaves(layout)).toEqual([DESKTOP, "dock"]);
            expect(layout.tile("calc", "right", WIDE).ok).toBe(true);
            expect(treeLeaves(layout)).toEqual([DESKTOP, "calc", "dock"]);
        }
    });

    it("取消平铺：浮动在最后一次浮动的矩形、在最上面", () => {
        const layout = DesktopLayout.createDefault();
        const rect = layout.windows.get("calc")!.floatRect;
        layout.tile("calc", "right", WIDE);
        layout.untile("calc");
        expect(layout.mode("calc")).toBe("floating");
        expect(layout.windows.get("calc")!.floatRect).toEqual(rect);
        expect(layout.stack().at(-1)).toBe("calc");
    });

    it("最小化的平铺窗点底栏回到原来那一侧；那一侧被占了就浮动在记着的矩形", () => {
        const layout = DesktopLayout.createDefault();
        layout.tile("notes", "left", WIDE);
        layout.minimize("notes");
        expect(layout.windows.get("notes")!.before).toBe("tiled-left");
        expect(layout.dockClick("notes", WIDE).ok).toBe(true);
        expect(layout.mode("notes")).toBe("tiled-left");
        expect(treeLeaves(layout)).toEqual(["notes", DESKTOP, "dock"]);

        layout.minimize("notes");
        layout.tile("calc", "left", WIDE);
        expect(layout.dockClick("notes", WIDE).ok).toBe(true);
        expect(layout.mode("notes")).toBe("floating");
        expect(layout.mode("calc")).toBe("tiled-left");
    });

    it("最小化的平铺窗点底栏，那一侧空着但此刻平铺不下：浮动在记着的矩形，不留在最小化里", () => {
        const layout = DesktopLayout.createDefault();
        layout.tile("notes", "left", WIDE);
        layout.tile("calc", "right", WIDE);
        layout.minimize("notes");
        const rect = layout.windows.get("notes")!.floatRect;
        // 窄到三块放不下（三个最小宽度加分隔线超过 700），而桌面加 calc 两块放得下。
        expect(code(layout.canTile("clock", "left", NARROW))).toBe("no-room");
        expect(layout.dockClick("notes", NARROW).ok).toBe(true);
        expect(layout.mode("notes")).toBe("floating");
        expect(layout.windows.get("notes")!.floatRect).toEqual(rect);
        expect(layout.windows.get("notes")!.before).toBeNull();
        expect(layout.stack().at(-1)).toBe("notes");
        expect(treeLeaves(layout)).toEqual([DESKTOP, "calc", "dock"]);
    });

    it("读了存档再平铺：新分支的 id 不撞", () => {
        const layout = DesktopLayout.createDefault();
        layout.tile("notes", "left", WIDE);
        layout.untile("notes");
        layout.tile("notes", "left", WIDE);
        const storage = memoryStorage();
        saveLayout(storage, layout);
        const loaded = loadLayout(storage).layout;
        loaded.untile("notes");
        expect(loaded.tile("calc", "right", WIDE).ok).toBe(true);
    });
});

describe("试平铺", () => {
    it("放得下时能平铺，区域是新叶的矩形；第二扇时区域是三分之一，不是半屏", () => {
        const layout = DesktopLayout.createDefault();
        const first = layout.previewTile("notes", "left", WIDE, 1);
        expect(first.result.ok).toBe(true);
        expect(first.area!.x).toBe(0);
        expect(Math.abs(first.area!.width - 718)).toBeLessThanOrEqual(1);
        layout.tile("notes", "left", WIDE);
        const second = layout.previewTile("calc", "right", WIDE, 1);
        expect(second.result.ok).toBe(true);
        expect(Math.abs(second.area!.width - 477)).toBeLessThanOrEqual(1);
    });

    it("窄到放不下时判 no-room，照做之后库的布局确实报 over-constrained", () => {
        const layout = DesktopLayout.createDefault();
        layout.tile("notes", "left", NARROW);
        expect(layout.grid.layout(NARROW).issues.some((issue) => issue.code === "over-constrained")).toBe(false);
        const preview = layout.previewTile("calc", "right", NARROW, 1);
        expect(code(preview.result)).toBe("no-room");
        expect(code(layout.canTile("calc", "right", NARROW))).toBe("no-room");
        // tile 同样先试：放不下就不动树。
        const before = snapshotOf(layout);
        expect(code(layout.tile("calc", "right", NARROW))).toBe("no-room");
        expect(snapshotOf(layout)).toBe(before);
        const trial = layout.clone();
        expect(trial.tile("calc", "right", WIDE).ok).toBe(true);
        expect(trial.grid.layout(NARROW).issues.some((issue) => issue.code === "over-constrained")).toBe(true);
    });

    it("同一侧换窗不占新地方：已经满了也放得下", () => {
        const layout = DesktopLayout.createDefault();
        layout.tile("notes", "left", NARROW);
        expect(layout.canTile("calc", "left", NARROW).ok).toBe(true);
    });

    it("原来就放不下（窗口太窄）的不算这次平铺的错", () => {
        const layout = DesktopLayout.createDefault();
        const tiny = {width: 200, height: 600};
        expect(layout.grid.layout(tiny).issues.some((issue) => issue.code === "over-constrained")).toBe(true);
        expect(layout.canTile("notes", "left", tiny).ok).toBe(true);
    });

    it("试平铺不改原来的模型", () => {
        const layout = DesktopLayout.createDefault();
        const before = snapshotOf(layout);
        layout.previewTile("notes", "left", WIDE, 1);
        layout.canTile("notes", "right", NARROW);
        expect(snapshotOf(layout)).toBe(before);
    });
});

describe("缩放写回与取整", () => {
    it("resize 把宽高夹到最小尺寸以上再写：写出的存档读得回来", () => {
        const layout = DesktopLayout.createDefault();
        expect(layout.resize("notes", {x: 5, y: 6, width: 150, height: 100}, {width: 1, height: 1}).ok).toBe(true);
        expect(layout.windows.get("notes")!.floatRect).toEqual({x: 5, y: 6, width: 240, height: 160});
        // 够大的矩形原样写。
        layout.resize("notes", {x: 5, y: 6, width: 300, height: 200}, {width: 1, height: 1});
        expect(layout.windows.get("notes")!.floatRect).toEqual({x: 5, y: 6, width: 300, height: 200});
        layout.resize("notes", {x: 0, y: 0, width: 10, height: 10}, {width: 1, height: 1});
        const storage = memoryStorage();
        saveLayout(storage, layout);
        const loaded = loadLayout(storage);
        expect(loaded.notice).toBeNull();
        expect(loaded.layout.windows.get("notes")!.floatRect).toEqual({x: 0, y: 0, width: 240, height: 160});
    });

    it("resize 只写这次动了的那一轴：窗被桌面夹着时，没动的那一轴留着记录里的值", () => {
        const layout = DesktopLayout.createDefault();
        // 窗口变矮时画出来的高是夹过的 250，拖的是右边：高不能被写成 250，视口变回去后要回到 300。
        layout.resize("notes", {x: 40, y: 40, width: 500, height: 250}, {width: 1, height: 0});
        expect(layout.windows.get("notes")!.floatRect).toEqual({x: 40, y: 40, width: 500, height: 300});
        // 拖的是上边：x 与宽留着记录里的值。
        layout.resize("notes", {x: 0, y: 10, width: 300, height: 330}, {width: 0, height: -1});
        expect(layout.windows.get("notes")!.floatRect).toEqual({x: 40, y: 10, width: 500, height: 330});
    });

    it("roundRect 按边取整", () => {
        expect(roundRect({x: 10.4, y: 0.5, width: 100.4, height: 50})).toEqual({x: 10, y: 1, width: 101, height: 50});
    });
});

describe("存档与读档", () => {
    it("存了再读：模式、矩形、最小化之前的模式、层叠次序、树都还原", () => {
        const layout = DesktopLayout.createDefault();
        layout.move("notes", 77, 66);
        layout.tile("calc", "left", WIDE);
        layout.tile("clock", "right", WIDE);
        layout.minimize("clock");
        layout.toggleMaximize("files");
        layout.raise("notes");
        const storage = memoryStorage();
        expect(saveLayout(storage, layout)).toBeNull();
        const {layout: loaded, notice, keep} = loadLayout(storage);
        expect(notice).toBeNull();
        expect(keep).toBe(true);
        expect(loaded.toSaved()).toEqual(layout.toSaved());
        expect(treeLeaves(loaded)).toEqual(["calc", DESKTOP, "dock"]);
        expect(loaded.stack()).toEqual(layout.stack());
    });

    it("读档之后每块叶的最小尺寸与保留像素都在：桌面叶、平铺窗叶、底栏", () => {
        const layout = DesktopLayout.createDefault();
        layout.tile("notes", "left", WIDE);
        const storage = memoryStorage();
        saveLayout(storage, layout);
        const loaded = loadLayout(storage).layout;
        // 约束不在快照里，是读档时按 ref 给回去的：读档前后同一块叶的约束一样，而且就是策略规定的那几个数。
        const constraints = loaded.grid.layout(WIDE).constraints;
        expect(constraints).toEqual(layout.grid.layout(WIDE).constraints);
        for (const id of ["notes", DESKTOP]) expect(constraints[id]!.minimumSize).toEqual({width: 240, height: 160});
        expect(constraints.dock!.minimumSize.height).toBe(56);
        expect(loaded.grid.layout(WIDE).sizes.dock!.height).toBe(56);
        // 能区分“给了策略”与“没给”：窄到放不下时，读回来的树也像原来的树一样报 over-constrained（没有最小尺寸的叶放得下，不会报）。
        const narrow = {width: 400, height: 600};
        const squeezed = loaded.grid.layout(narrow);
        expect(squeezed.issues.some((issue) => issue.code === "over-constrained")).toBe(true);
        expect(squeezed.sizes).toEqual(layout.grid.layout(narrow).sizes);
    });

    const saved = () => JSON.parse(JSON.stringify(DesktopLayout.createDefault().toSaved())) as Record<string, any>;
    /** 一份有一扇平铺窗的存档，坏法在它上面改。 */
    const tiled = () => {
        const layout = DesktopLayout.createDefault();
        layout.tile("notes", "left", WIDE);
        return JSON.parse(JSON.stringify(layout.toSaved())) as Record<string, any>;
    };
    const leaf = (id: string, size = {width: 1, height: 1}) => ({kind: "leaf", id, ref: id, size});
    const rootOf = (children: unknown[], orientation = "vertical") => ({kind: "branch", id: "root", orientation, size: {width: 1, height: 1}, children});
    const withRoot = (root: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({...saved(), ...extra, grid: {version: SNAPSHOT_VERSION, root}});
    const branch = (id: string, children: unknown[], orientation = "horizontal") => ({kind: "branch", id, orientation, size: {width: 1, height: 1}, children});

    const broken: ReadonlyArray<readonly [string, () => string]> = [
        ["JSON 坏", () => "{not json"],
        ["版本不认识", () => JSON.stringify({...saved(), version: 2})],
        ["窗不是四扇", () => { const value = saved(); delete value.windows.clock; return JSON.stringify(value); }],
        ["窗的 id 不认识", () => { const value = saved(); value.windows.extra = value.windows.clock; delete value.windows.clock; return JSON.stringify(value); }],
        ["模式不认识", () => { const value = saved(); value.windows.notes.mode = "hidden"; return JSON.stringify(value); }],
        ["最小化没有来时的模式", () => { const value = saved(); value.windows.notes.mode = "minimized"; return JSON.stringify(value); }],
        ["来时的模式不是四种之一", () => { const value = saved(); value.windows.notes.mode = "minimized"; value.windows.notes.before = "closed"; return JSON.stringify(value); }],
        ["层叠次序不是排列", () => JSON.stringify({...saved(), order: ["notes", "notes", "clock", "files"]})],
        ["矩形不是有限数", () => { const value = saved(); value.windows.notes.floatRect.x = null; return JSON.stringify(value); }],
        ["矩形比最小尺寸小", () => { const value = saved(); value.windows.notes.floatRect.width = 100; return JSON.stringify(value); }],
        ["快照坏", () => JSON.stringify({...saved(), grid: {version: SNAPSHOT_VERSION, root: {kind: "leaf"}}})],
        ["树里有不认识的叶", () => withRoot(rootOf([leaf("desktop"), leaf("stranger"), leaf("dock", {width: 0, height: 56})]))],
        ["叶的 id 与 ref 不同", () => withRoot(rootOf([{...leaf("desktop"), ref: "notes"}, leaf("dock", {width: 0, height: 56})]))],
        ["底栏的高度不是 56", () => withRoot(rootOf([leaf("desktop"), leaf("dock", {width: 0, height: 300})]))],
        ["没有桌面", () => withRoot(rootOf([leaf("notes"), leaf("dock", {width: 0, height: 56})]), {})],
        ["没有底栏", () => withRoot(rootOf([leaf("desktop"), leaf("notes")]))],
        ["底栏不是最后一行", () => withRoot(rootOf([leaf("dock", {width: 0, height: 56}), leaf("desktop")]))],
        ["根是横向", () => withRoot(rootOf([leaf("desktop"), leaf("dock", {width: 0, height: 56})], "horizontal"))],
        ["树里有窗的叶而模式不是平铺", () => withRoot(rootOf([branch("tile-1", [leaf("notes"), leaf("desktop")]), leaf("dock", {width: 0, height: 56})]))],
        ["模式是平铺而树里没有那一叶", () => { const value = saved(); value.windows.notes.mode = "tiled-left"; return JSON.stringify(value); }],
        ["平铺窗不在桌面叶所在的分支里", () => { const value = tiled(); value.grid.root = rootOf([branch("tile-1", [leaf("desktop"), branch("tile-2", [leaf("notes"), leaf("calc")], "vertical")]), leaf("dock", {width: 0, height: 56})]); return JSON.stringify(value); }],
        ["平铺窗在竖向的分支里", () => { const value = tiled(); value.grid.root = rootOf([branch("tile-1", [leaf("notes"), leaf("desktop")], "vertical"), leaf("dock", {width: 0, height: 56})]); return JSON.stringify(value); }],
        ["tiled-left 的窗在桌面右边", () => { const value = tiled(); value.windows.notes.mode = "tiled-right"; return JSON.stringify(value); }],
        ["同一侧两扇平铺窗", () => {
            const value = tiled();
            value.windows.calc.mode = "tiled-left";
            value.grid.root = rootOf([branch("tile-1", [leaf("notes"), leaf("calc"), leaf("desktop")]), leaf("dock", {width: 0, height: 56})]);
            return JSON.stringify(value);
        }],
    ];
    it.each(broken)("存档坏（%s）：用缺省布局、说明原因、原件原样搬到备份键", (_name, make) => {
        const raw = make();
        const storage = memoryStorage({[STORAGE_KEY]: raw});
        const {layout, notice, keep} = loadLayout(storage);
        expect(notice).toContain("the original is kept as a backup");
        expect(keep).toBe(true);
        expect(layout.toSaved()).toEqual(DesktopLayout.createDefault().toSaved());
        expect(storage.items.get(BACKUP_KEY)).toBe(raw);
    });

    it("窗状态里多出来的字段不收，也不会写回", () => {
        const value = tiled();
        value.windows.notes.junk = "x";
        value.windows.notes.floatRect.extra = 1;
        const loaded = DesktopLayout.fromSaved(value);
        expect(loaded.ok).toBe(true);
        if (!loaded.ok) return;
        const state = loaded.layout.toSaved().windows.notes;
        expect(Object.keys(state).sort()).toEqual(["before", "floatRect", "mode"]);
        expect(Object.keys(state.floatRect).sort()).toEqual(["height", "width", "x", "y"]);
        expect(JSON.stringify(loaded.layout.toSaved())).not.toContain("junk");
    });

    it("上面几份坏档的底本是好的：没改坏时读得进去", () => {
        expect(DesktopLayout.fromSaved(saved()).ok).toBe(true);
        expect(DesktopLayout.fromSaved(tiled()).ok).toBe(true);
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
        expect(saveLayout(full, DesktopLayout.createDefault())).toBe("Saving the layout failed");
    });

    it("四扇窗的 id 都在缺省布局里", () => {
        expect([...DesktopLayout.createDefault().windows.keys()]).toEqual([...WINDOW_IDS]);
    });
});
