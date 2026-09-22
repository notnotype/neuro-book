import {describe, expect, it} from "vitest";
import {
    GRID_MAX_DEPTH,
    GRID_MAX_NODES,
    GRID_SNAPSHOT_VERSION,
    createGrid,
    type GridAxis,
    type GridBranchInput,
    type GridExtent,
    type GridLeafInput,
    type GridNodeInput,
    type GridOrientation,
    type GridSnapshot,
} from "./grid";

/** 容器取「意图之和 + sash」，让呈现与意图一一对应：读测试时不必换算比例。 */
const CONTAINER: GridExtent = {width: 1000, height: 600};
const SASH = 1;
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

/** 只在 `axis` 上取值、另一轴留 0（或 `cross`）的宽高对。 */
function at(axis: GridAxis, along: number, cross = 0): GridExtent {
    return axis === "width" ? {width: along, height: cross} : {width: cross, height: along};
}

/**
 * 叶：`axis` 是**父分支主轴**，`intent` 是它在那根轴上的用户分配。
 * 交叉轴的约束默认「不小于 0、不限」——共享空间由父分支给定，叶不能用自己的上限压死它。
 */
function leaf(id: string, axis: GridAxis, intent: number, min = 0, max = UNBOUNDED): GridLeafInput<string> {
    return {kind: "leaf", id, ref: id, size: at(axis, intent), minimumSize: at(axis, min), maximumSize: at(axis, max, UNBOUNDED)};
}

/** 分支：`axis` 同样是**父分支主轴**，`intent` 是这一列（行）的外部分配；根节点由容器给定，传 0。 */
function branch(id: string, axis: GridAxis, orientation: GridOrientation, intent: number, children: GridNodeInput<string>[]): GridBranchInput<string> {
    return {kind: "branch", id, orientation, size: at(axis, intent), children};
}

/** 最小嵌套样例：root(横){ left, right(竖){ top, bottom } }。 */
function fixture(): GridBranchInput<string> {
    return branch("root", "width", "horizontal", 0, [
        leaf("left", "width", 300, 100, 800),
        branch("right", "width", "vertical", 699, [leaf("top", "height", 400, 100, 800), leaf("bottom", "height", 199, 100, 800)]),
    ]);
}

function extent(sizes: Record<string, GridExtent>, id: string): GridExtent {
    const value = sizes[id];
    if (!value) {
        throw new Error(`布局里没有节点 ${id}`);
    }
    return value;
}

describe("拆分树原语：两轴几何", () => {
    it("外层按主轴分配，分支的列宽不取内层叶高度之和", () => {
        const sizes = createGrid(fixture(), {sashSize: SASH}).layout(CONTAINER).sizes;

        expect(extent(sizes, "left")).toEqual({width: 300, height: 600});
        // right 竖排：宽 699 是外部分配，不是 top.height + bottom.height（599）
        expect(extent(sizes, "right")).toEqual({width: 699, height: 600});
        expect(extent(sizes, "top")).toEqual({width: 699, height: 400});
        expect(extent(sizes, "bottom")).toEqual({width: 699, height: 199});
        expect(extent(sizes, "root")).toEqual({width: 1000, height: 600});
    });

    it("交叉轴共享：竖直分支的子叶等宽，横排分支的子节点等高，且没有诊断", () => {
        const result = createGrid(fixture(), {sashSize: SASH}).layout(CONTAINER);

        expect(extent(result.sizes, "top").width).toBe(extent(result.sizes, "bottom").width);
        expect(extent(result.sizes, "left").height).toBe(extent(result.sizes, "right").height);
        expect(result.issues).toEqual([]);
    });

    it("两轴都计入 sash，容器总量守恒", () => {
        const sizes = createGrid(fixture(), {sashSize: SASH}).layout(CONTAINER).sizes;

        expect(extent(sizes, "root").width).toBe(extent(sizes, "left").width + extent(sizes, "right").width + SASH);
        expect(extent(sizes, "right").height).toBe(extent(sizes, "top").height + extent(sizes, "bottom").height + SASH);
    });

    it("调整外层 sash：叶与分支兄弟互相吸收，内层总高不变", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const applied = grid.resize("left", "width", -100);

        expect(applied).toEqual({ok: true, applied: -100});
        const sizes = grid.layout(CONTAINER).sizes;

        expect(extent(sizes, "left").width).toBe(200);
        expect(extent(sizes, "right").width).toBe(799);
        expect(extent(sizes, "right").height).toBe(600);
        expect(extent(sizes, "top")).toEqual({width: 799, height: 400});
        expect(extent(sizes, "bottom")).toEqual({width: 799, height: 199});
    });

    it("调整内层 sash：外层列宽与容器都不变", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});

        expect(grid.resize("top", "height", 50)).toEqual({ok: true, applied: 50});
        const sizes = grid.layout(CONTAINER).sizes;

        expect(extent(sizes, "top")).toEqual({width: 699, height: 450});
        expect(extent(sizes, "bottom")).toEqual({width: 699, height: 149});
        expect(extent(sizes, "right").width).toBe(699);
        expect(extent(sizes, "root")).toEqual({width: 1000, height: 600});
    });

    it("主动节点触界：只吸收兄弟可用空间，外层总量守恒", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});

        // left 下限 100：right 想要的 10000 只拿得到 200
        expect(grid.resize("right", "width", 10000)).toEqual({ok: true, applied: 200});
        const sizes = grid.layout(CONTAINER).sizes;

        expect(extent(sizes, "left").width).toBe(100);
        expect(extent(sizes, "right").width).toBe(899);
        expect(extent(sizes, "root").width).toBe(1000);
    });

    it("内层叶触界：外层列宽不变，内层总量守恒", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});

        // top 上限 800、bottom 下限 100：两者都触界后 top 停在 499
        expect(grid.resize("top", "height", 10000)).toEqual({ok: true, applied: 99});
        const sizes = grid.layout(CONTAINER).sizes;

        expect(extent(sizes, "top").height).toBe(499);
        expect(extent(sizes, "bottom").height).toBe(100);
        expect(extent(sizes, "right").height).toBe(600);
        expect(extent(sizes, "right").width).toBe(699);
    });

    it("布局是呈现：换更小容器再回来，序列化不变且原分配可恢复", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const saved = grid.serialize();

        const narrow = grid.layout({width: 500, height: 300}).sizes;
        expect(extent(narrow, "right").width).toBeLessThan(699);
        expect(grid.serialize()).toEqual(saved);

        const back = grid.layout(CONTAINER).sizes;
        expect(extent(back, "left").width).toBe(300);
        expect(extent(back, "right").width).toBe(699);
        expect(extent(back, "top").height).toBe(400);
    });

    it("三个节点以上的分支：意图比例决定分配，最小合计不超可用时不降级", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 200, 10, 1000),
            leaf("b", "width", 300, 10, 1000),
            leaf("c", "width", 500, 10, 1000),
        ]), {sashSize: SASH});
        // 3 个子节点 = 2 条 sash
        const sizes = grid.layout({width: 1002, height: 600}).sizes;

        expect(extent(sizes, "a").width).toBe(200);
        expect(extent(sizes, "b").width).toBe(300);
        expect(extent(sizes, "c").width).toBe(500);
    });

    it("可满足的混合上下界与兄弟顺序无关，分配不溢出", () => {
        const inputs = [
            leaf("a", "width", 60, 0, 50),
            leaf("b", "width", 30, 80, 1000),
            leaf("c", "width", 10, 0, 1000),
        ];
        for (const children of [inputs, [...inputs].reverse()]) {
            const result = createGrid(branch("root", "width", "horizontal", 0, children)).layout({width: 100, height: 20});
            expect(extent(result.sizes, "a").width).toBeCloseTo(17.142857, 5);
            expect(extent(result.sizes, "b").width).toBe(80);
            expect(extent(result.sizes, "c").width).toBeCloseTo(2.857143, 5);
            expect(extent(result.sizes, "root").width).toBeCloseTo(100, 6);
            expect(result.issues).toEqual([]);
        }
    });

    it("有 sash 的纵轴零权重分配仍满足下界并守恒", () => {
        const result = createGrid(branch("root", "height", "vertical", 0, [
            leaf("a", "height", 0, 0, 40),
            leaf("b", "height", 0, 30, 100),
            leaf("c", "height", 0, 0, 100),
        ]), {sashSize: 5}).layout({width: 20, height: 100});

        expect(extent(result.sizes, "b").height).toBe(30);
        expect(extent(result.sizes, "a").height).toBe(30);
        expect(extent(result.sizes, "c").height).toBe(30);
        expect(extent(result.sizes, "root").height).toBe(100);
        expect(result.issues).toEqual([]);
    });
});

describe("拆分树原语：不可满足与窄容器", () => {
    it("子节点最小尺寸合计超过可用空间：给诊断，尺寸有限非负且总量不溢出", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 300, 300),
            leaf("b", "width", 300, 300),
        ]), {sashSize: SASH});
        const result = grid.layout({width: 500, height: 600});

        expect(result.issues.join()).toContain("约束不可满足");
        expect(extent(result.sizes, "a").width).toBeCloseTo(249.5, 6);
        expect(extent(result.sizes, "b").width).toBeCloseTo(249.5, 6);
        // 总量守恒且留在容器内：1px sash + 2 × 249.5
        expect(extent(result.sizes, "root").width).toBeCloseTo(500, 6);
        for (const size of Object.values(result.sizes)) {
            expect(Number.isFinite(size.width) && Number.isFinite(size.height)).toBe(true);
            expect(size.width).toBeGreaterThanOrEqual(0);
            expect(size.height).toBeGreaterThanOrEqual(0);
            expect(size.width).toBeLessThanOrEqual(500);
        }
    });

    it("容器比 sash 总量还小：压缩分隔条与子节点，几何不超容器", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 100, 50),
            leaf("b", "width", 100, 50),
        ]), {sashSize: SASH});
        const result = grid.layout({width: 0.5, height: 10});

        expect(result.issues.join()).toContain("sash");
        expect(extent(result.sizes, "root").width).toBe(0.5);
        expect(extent(result.sizes, "a").width).toBe(0);
        expect(extent(result.sizes, "b").width).toBe(0);
    });

    it("实际 sash 尺寸随窄容器压缩，renderer 可按同一结果绘制", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 100, 50),
            leaf("b", "width", 100, 50),
        ]), {sashSize: SASH});

        expect(grid.layout({width: 0.5, height: 10}).sashSizes.root).toEqual([0.5]);
    });

    it("宿主可声明特定 sash 不占流内空间", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 100),
            leaf("b", "width", 100),
            leaf("c", "width", 100),
        ]), {sashSize: (_branchId, index) => index === 0 ? 0 : 1});

        const result = grid.layout({width: 301, height: 100});
        expect(result.sashSizes.root).toEqual([0, 1]);
        expect(extent(result.sizes, "root").width).toBe(301);
    });

    it("特殊字符串 id 安全写入所有呈现字典", () => {
        const result = createGrid(leaf("__proto__", "width", 100)).layout({width: 100, height: 50});

        expect(Object.hasOwn(result.sizes, "__proto__")).toBe(true);
        expect(result.sizes.__proto__).toEqual({width: 100, height: 50});
        expect(Object.hasOwn(result.constraints, "__proto__")).toBe(true);
    });

    it("单叶根违反自身约束时仍给诊断", () => {
        const result = createGrid({
            ...leaf("only", "width", 200, 200, 300),
            minimumSize: {width: 200, height: 0},
            maximumSize: {width: 300, height: 100},
        }).layout({width: 50, height: 100});

        expect(result.issues.join()).toContain("约束下限");
        expect(extent(result.sizes, "only")).toEqual({width: 50, height: 100});
    });

    it("分支显式上限与后代下限冲突时给诊断并保持有限几何", () => {
        const root = branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 100, 100),
            leaf("b", "width", 100, 100),
        ]);
        root.maximumSize = {width: 150, height: UNBOUNDED};
        const result = createGrid(root, {sashSize: SASH}).layout({width: 500, height: 100});

        expect(result.issues.join()).toContain("约束不相容");
        expect(result.constraints.root).toEqual({
            minimumSize: {width: 201, height: 0},
            maximumSize: {width: 201, height: UNBOUNDED},
        });
        expect(Object.values(result.sizes).every((size) => Number.isFinite(size.width) && size.width >= 0)).toBe(true);
    });

    it("交叉轴下限超过容器：按可用空间降级，不把容器顶破", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 100), minimumSize: {width: 0, height: 700}},
            leaf("b", "width", 100),
        ]), {sashSize: SASH});
        const result = grid.layout({width: 201, height: 600});

        expect(result.issues.join()).toContain("交叉轴");
        expect(extent(result.sizes, "root").height).toBe(600);
        expect(extent(result.sizes, "a").height).toBe(600);
        expect(extent(result.sizes, "a").width).toBe(100);
    });

    it("子节点上限全部触界：报「未被吸收」，不制造额外尺寸", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 300, 0, 300),
            leaf("b", "width", 300, 0, 300),
        ]), {sashSize: SASH});
        const result = grid.layout({width: 1000, height: 600});

        expect(result.issues.join()).toContain("未被任何子节点吸收");
        expect(extent(result.sizes, "root").width).toBe(601);
    });
});

describe("拆分树原语：resize 边界", () => {
    it("混合零权重在正权重全部触顶后吸收剩余空间，全零权重均分", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 100, 0, 20), leaf("b", "width", 0, 0, 100), leaf("c", "width", 0, 0, 10),
        ]));
        expect(grid.layout({width: 100, height: 20}).sizes).toMatchObject({a: {width: 20}, b: {width: 70}, c: {width: 10}});
        const zero = createGrid(branch("root", "height", "vertical", 0, [leaf("a", "height", 0), leaf("b", "height", 0)]));
        expect(zero.layout({width: 20, height: 100}).sizes).toMatchObject({a: {height: 50}, b: {height: 50}});
        expect(zero.resizeBranch("root", "height", {a: 50, b: 50}, {a: 60, b: 40}).ok).toBe(true);
        expect(zero.layout({width: 20, height: 100}).sizes).toMatchObject({a: {height: 60}, b: {height: 40}});
    });

    it("单节点 resize 的兄弟补偿也同时求上下界，整体意图守恒", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("active", "width", 100), leaf("a", "width", 80, 0, 20), leaf("b", "width", 15, 30, 100), leaf("c", "width", 5, 0, 10),
        ]));
        expect(grid.resize("active", "width", 10)).toEqual({ok: true, applied: 10});
        const root = grid.root();
        expect(root?.kind === "branch" ? root.children.map((child) => child.size.width) : []).toEqual([110, 20, 60, 10]);
    });

    it("下限触界的原意图不被 no-op 或另一侧手势夹取", () => {
        const grid = createGrid(branch("root", "height", "vertical", 0, [
            leaf("a", "height", 20, 100, 1000), leaf("b", "height", 100, 0, 1000), leaf("c", "height", 100, 0, 1000),
        ]));
        const saved = grid.serialize();
        const baseline = {a: 100, b: 50, c: 50};
        expect(grid.resizeBranch("root", "height", baseline, baseline).ok).toBe(true);
        expect(grid.serialize()).toEqual(saved);
        expect(grid.resizeBranch("root", "height", baseline, {a: 100, b: 60, c: 40})).toEqual({ok: true, sizes: {a: 20, b: 120, c: 80}});
        expect(grid.layout({width: 20, height: 200}).sizes).toMatchObject({a: {height: 100}, b: {height: 60}, c: {height: 40}});
    });

    it("原子手势拒绝过期基线与越界目标，失败不改快照", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 100, 100), leaf("b", "width", 100)]));
        const saved = grid.serialize();
        expect(grid.resizeBranch("root", "width", {a: 120, b: 80}, {a: 130, b: 70}).ok).toBe(false);
        expect(grid.resizeBranch("root", "width", {a: 100, b: 100}, {a: 90, b: 110}).ok).toBe(false);
        expect(grid.serialize()).toEqual(saved);
    });

    it.each(["width", "height"] as const)("%s 同时上下界必须重新释放过早触及的下限", (axis) => {
        const inputs = [leaf("a", axis, 80, 0, 20), leaf("b", axis, 15, 30, 100), leaf("c", axis, 5, 0, 10)];
        for (const children of [inputs, [...inputs].reverse()]) {
            const grid = createGrid(branch("root", axis, axis === "width" ? "horizontal" : "vertical", 0, children), {sashSize: 3});
            const result = grid.layout(at(axis, 106, 20));
            expect(extent(result.sizes, "a")[axis]).toBeCloseTo(20);
            expect(extent(result.sizes, "b")[axis]).toBeCloseTo(70);
            expect(extent(result.sizes, "c")[axis]).toBeCloseTo(10);
            expect(extent(result.sizes, "root")[axis]).toBeCloseTo(106);
            expect(result.issues).toEqual([]);
        }
    });

    it("触界兄弟不参与 viewport 的手势换算，目标呈现精确恢复", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 100, 0, 100), leaf("b", "width", 100, 0, 1000), leaf("c", "width", 100, 0, 1000),
        ]));
        expect(grid.layout({width: 600, height: 20}).sizes).toMatchObject({a: {width: 100}, b: {width: 250}, c: {width: 250}});
        expect(grid.resizeBranch("root", "width", {a: 100, b: 250, c: 250}, {a: 100, b: 270, c: 230})).toEqual({ok: true, sizes: {a: 100, b: 108, c: 92}});
        const sizes = grid.layout({width: 600, height: 20}).sizes;
        expect(extent(sizes, "b").width).toBeCloseTo(270);
        expect(extent(sizes, "c").width).toBeCloseTo(230);
    });

    it("触界且意图在当前约束外时 no-op 不改快照", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 200, 0, 100), leaf("b", "width", 100)]));
        const before = grid.serialize();
        expect(grid.resizeBranch("root", "width", {a: 100, b: 500}, {a: 100, b: 500}).ok).toBe(true);
        expect(grid.serialize()).toEqual(before);
    });

    it("未知节点、根节点、轴不符与非有限增量都返回失败", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});

        expect(grid.resize("nope", "width", 10).ok).toBe(false);
        expect(grid.resize("root", "width", 10).ok).toBe(false);
        // top 的父分支是竖直的：沿宽度调整不属于父分支主轴
        expect(grid.resize("top", "width", 10).ok).toBe(false);
        expect(grid.resize("top", "height", Number.NaN).ok).toBe(false);
        expect(grid.resize("top", "height", 0)).toEqual({ok: true, applied: 0});
    });
});

    it("viewport 缩放后三兄弟手势按当前呈现一次换回完整意图", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 200, 0, 1000),
            leaf("b", "width", 300, 0, 1000),
            leaf("c", "width", 500, 0, 1000),
        ]));
        const result = grid.resizeBranch("root", "width", {a: 100, b: 150, c: 250}, {a: 120, b: 130, c: 250});

        expect(result).toEqual({ok: true, sizes: {a: 240, b: 260, c: 500}});
        expect(grid.layout({width: 500, height: 20}).sizes).toMatchObject({
            a: {width: 120},
            b: {width: 130},
            c: {width: 250},
        });
    });

    it("原子分支调整拒绝缺节点、非有限值、总量变化与错误轴，失败前后意图不变", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const before = grid.serialize();

        expect(grid.resizeBranch("root", "height", {left: 300, right: 699}, {left: 250, right: 749}).ok).toBe(false);
        expect(grid.resizeBranch("root", "width", {left: 300}, {left: 250}).ok).toBe(false);
        expect(grid.resizeBranch("root", "width", {left: 300, right: 699}, {left: Number.NaN, right: 699}).ok).toBe(false);
        expect(grid.resizeBranch("root", "width", {left: 300, right: 699}, {left: 250, right: 700}).ok).toBe(false);
        expect(grid.serialize()).toEqual(before);
    });

describe("拆分树原语：结构", () => {
    it("addLeaf 到未知父返回失败而不是抛异常", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const result = grid.addLeaf("nope", 0, leaf("extra", "width", 50, 10, 100));

        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toContain("未知父节点");
    });

    it("moveLeaf 到自身（或自身子树）返回失败", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});

        expect(grid.moveLeaf("top", "top", 0).ok).toBe(false);
        expect(grid.moveLeaf("right", "top", 0).ok).toBe(false);
    });

    it("同一两叶分支内重排原子成功，不塌陷源分支或丢叶", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 100),
            leaf("b", "width", 100),
        ]));

        expect(grid.moveLeaf("a", "root", 2)).toEqual({ok: true});
        const root = grid.root();
        expect(root?.kind === "branch" ? root.children.map((child) => child.id) : []).toEqual(["b", "a"]);
    });

    it("removeLeaf 拒绝根分支且失败前后树不变", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const before = grid.serialize();

        expect(grid.removeLeaf("root")).toEqual({ok: false, reason: "只支持移除叶子节点：root"});
        expect(grid.serialize()).toEqual(before);
    });

    it("removeLeaf 删掉分支最后一个子节点时空分支塌陷", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});

        expect(grid.removeLeaf("bottom").ok).toBe(true);
        const collapsed = grid.root();
        expect(collapsed?.kind === "branch" ? collapsed.children.map((child) => child.id) : []).toEqual(["left", "top"]);
        expect(grid.removeLeaf("top").ok).toBe(true);
        expect(grid.root()?.kind).toBe("leaf");
        expect(grid.root()?.id).toBe("left");
    });

    it("空树合法：可以往空根加叶子，并按容器铺开", () => {
        const grid = createGrid<string>(null);

        expect(grid.serialize().root.kind).toBe("branch");
        expect(grid.restore({version: GRID_SNAPSHOT_VERSION, root: {kind: "branch", id: "root", orientation: "horizontal", size: {width: 0, height: 0}, children: []}}, (ref) => ({ref})).ok).toBe(true);
        expect(grid.addLeaf("root", 0, leaf("only", "width", 50, 10, 2000)).ok).toBe(true);
        expect(extent(grid.layout(CONTAINER).sizes, "only").width).toBe(1000);
    });

    it("单叶根合法：删掉它之后树为空", () => {
        const grid = createGrid<string>(leaf("only", "width", 50, 10, 100));

        expect(grid.removeLeaf("only").ok).toBe(true);
        expect(grid.root()).toBeNull();
        expect(grid.layout(CONTAINER).sizes).toEqual({});
    });

    it("删叶后同分支兄弟按现有意图比例吸收让出的空间", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 200, 10, 1000),
            leaf("b", "width", 300, 10, 1000),
            leaf("c", "width", 500, 10, 1000),
        ]), {sashSize: SASH});
        expect(extent(grid.layout({width: 1002, height: 600}).sizes, "root").width).toBe(1002);

        expect(grid.removeLeaf("b").ok).toBe(true);
        // 让出的 300 按 a:c = 200:500 分掉；2 个子节点只剩 1 条 sash，容器取 1001
        const sizes = grid.layout({width: 1001, height: 600}).sizes;

        expect(extent(sizes, "a").width).toBeCloseTo(285.71, 1);
        expect(extent(sizes, "c").width).toBeCloseTo(714.29, 1);
        expect(extent(sizes, "a").width + extent(sizes, "c").width).toBeCloseTo(1000, 5);
    });

    it("分支塌陷时幸存者继承该列的外部分配，外层另一列不动", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("left", "width", 300, 10, 1000),
            branch("pair", "width", "vertical", 400, [leaf("alpha", "height", 100, 10, 1000), leaf("beta", "height", 300, 10, 1000)]),
        ]), {sashSize: SASH});

        expect(grid.removeLeaf("alpha").ok).toBe(true);
        const sizes = grid.layout({width: 701, height: 600}).sizes;

        expect(extent(sizes, "beta").width).toBe(400);
        expect(extent(sizes, "left").width).toBe(300);
    });
});

describe("拆分树原语：拆分叶", () => {
    it("目标在新轴没有分配时两端取同一权重均分", () => {
        const grid = createGrid<string>(leaf("only", "width", 0), {sashSize: SASH});

        expect(grid.splitLeaf("only", {branchId: "pair", orientation: "horizontal", side: "after", leaf: {kind: "leaf", id: "added", ref: "added"}})).toEqual({ok: true});
        const root = grid.root();
        expect(root?.kind === "branch" ? root.children.map((child) => child.id) : []).toEqual(["only", "added"]);
        const sizes = grid.layout({width: 1001, height: 600}).sizes;

        expect(extent(sizes, "only").width).toBeCloseTo(500);
        expect(extent(sizes, "added").width).toBeCloseTo(500);
    });

    it("side=before 把新叶放在前，两半按 ratio 分掉目标原本的分配", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("left", "width", 300), leaf("editor", "width", 700),
        ]), {sashSize: SASH});

        expect(grid.splitLeaf("editor", {branchId: "pair", orientation: "horizontal", side: "before", ratio: 0.25, leaf: {kind: "leaf", id: "added", ref: "added"}}).ok).toBe(true);
        const pair = grid.find("pair");
        expect(pair?.kind === "branch" ? pair.children.map((child) => child.id) : []).toEqual(["added", "editor"]);
        const sizes = grid.layout({width: 1001, height: 600}).sizes;

        expect(extent(sizes, "left").width).toBe(300);
        // pair 拿到 700，扣掉内层 1px sash 后按 175:525 权重分
        expect(extent(sizes, "added").width).toBeCloseTo(174.75);
        expect(extent(sizes, "editor").width).toBeCloseTo(524.25);
    });

    it("垂直拆分只分掉目标列的高度，外层另一列宽度不变", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("left", "width", 300), leaf("editor", "width", 700),
        ]), {sashSize: SASH});

        expect(grid.splitLeaf("editor", {branchId: "stack", orientation: "vertical", side: "after", leaf: {kind: "leaf", id: "below", ref: "below"}}).ok).toBe(true);
        const sizes = grid.layout({width: 1001, height: 601}).sizes;

        expect(extent(sizes, "left").width).toBe(300);
        expect(extent(sizes, "editor").width).toBe(700);
        expect(extent(sizes, "editor").height).toBe(300);
        expect(extent(sizes, "below").height).toBe(300);
    });

    it("重复身份、非叶目标、非法比例与未知目标都失败且不改树", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const before = grid.serialize();
        const added = {kind: "leaf", id: "added", ref: "added"} as const;
        const split = {branchId: "pair", orientation: "horizontal", side: "after"} as const;

        expect(grid.splitLeaf("nope", {...split, leaf: added}).ok).toBe(false);
        expect(grid.splitLeaf("root", {...split, leaf: added}).ok).toBe(false);
        expect(grid.splitLeaf("left", {...split, leaf: {kind: "leaf", id: "left", ref: "left"}}).ok).toBe(false);
        expect(grid.splitLeaf("left", {...split, branchId: "left", leaf: added}).ok).toBe(false);
        expect(grid.splitLeaf("left", {...split, ratio: 0, leaf: added}).ok).toBe(false);
        expect(grid.splitLeaf("left", {...split, ratio: 1, leaf: added}).ok).toBe(false);
        expect(grid.splitLeaf("left", {...split, ratio: Number.NaN, leaf: added}).ok).toBe(false);
        expect(grid.serialize()).toEqual(before);
    });

    it("拆分后的树可按快照往返，新边界继续参与原子调整", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("left", "width", 300), leaf("editor", "width", 700),
        ]), {sashSize: SASH});
        expect(grid.splitLeaf("editor", {branchId: "pair", orientation: "horizontal", side: "after", leaf: {kind: "leaf", id: "added", ref: "added"}}).ok).toBe(true);

        const restored = createGrid<string>(null, {sashSize: SASH});
        expect(restored.restore(grid.serialize(), (ref) => ({ref})).ok).toBe(true);
        expect(extent(restored.layout({width: 1001, height: 600}).sizes, "added").width).toBeCloseTo(349.5);
        expect(restored.resizeBranch("pair", "width", {editor: 349.5, added: 349.5}, {editor: 300, added: 399}).ok).toBe(true);
        expect(extent(restored.layout({width: 1001, height: 600}).sizes, "added").width).toBeCloseTo(399);
    });

    it("节点数与深度上限在结构操作阶段就拒绝", () => {
        const many = createGrid(branch("root", "width", "horizontal", 0, Array.from({length: GRID_MAX_NODES - 2}, (_, index) => leaf(`n${index}`, "width", 1))));
        expect(many.addLeaf("root", 0, leaf("extra", "width", 1)).ok).toBe(true);
        expect(many.addLeaf("root", 0, leaf("extra2", "width", 1)).ok).toBe(false);
        const crowded = many.splitLeaf("n0", {branchId: "pair", orientation: "horizontal", side: "after", leaf: {kind: "leaf", id: "added", ref: "added"}});
        expect(crowded.ok).toBe(false);
        expect(crowded.ok === false && crowded.reason).toContain("节点数");

        let deep: GridNodeInput<string> = leaf("deep-end", "width", 1);
        for (let index = GRID_MAX_DEPTH - 1; index >= 1; index -= 1) {
            deep = branch(`d${index}`, "width", "horizontal", 0, [deep]);
        }
        const nested = createGrid(deep).splitLeaf("deep-end", {branchId: "pair", orientation: "horizontal", side: "after", leaf: {kind: "leaf", id: "added", ref: "added"}});
        expect(nested.ok).toBe(false);
        expect(nested.ok === false && nested.reason).toContain("嵌套深度");
    });
});

describe("拆分树原语：快照", () => {
    const resolvable = (ref: string) => ({ref});

    it("版本 1 明确拒绝，并说明无法推导两轴", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const result = grid.restore({version: 1, root: {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 600}}}, resolvable);

        expect(result.ok).toBe(false);
        expect(result.reason).toContain("版本 1");
        expect(extent(grid.layout(CONTAINER).sizes, "left").width).toBe(300);
    });

    it("不认识的版本号拒绝并保持原树不动", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const result = grid.restore({version: 99, root: {}}, resolvable);

        expect(result.ok).toBe(false);
        expect(result.reason).toContain("版本 99");
        expect(extent(grid.layout(CONTAINER).sizes, "bottom").height).toBe(199);
    });

    it("重复节点 id 整体拒绝", () => {
        const grid = createGrid<string>(null);
        const duplicate = {
            version: GRID_SNAPSHOT_VERSION,
            root: {kind: "branch", id: "root", orientation: "horizontal", size: {width: 0, height: 0}, children: [
                leaf("same", "width", 50, 10, 100),
                {...leaf("same", "width", 50, 10, 100), ref: "other"},
            ]},
        };

        const result = grid.restore(duplicate, resolvable);

        expect(result.ok).toBe(false);
        expect(result.reason).toContain("重复节点 id");
    });

    it("非法方向、非法 children、非有限尺寸与缺分支尺寸整体拒绝", () => {
        const grid = createGrid<string>(null);
        const root = {kind: "branch", id: "root", orientation: "horizontal", size: {width: 0, height: 0}, children: []};

        expect(grid.restore({version: GRID_SNAPSHOT_VERSION, root: {...root, orientation: "diagonal"}}, resolvable).ok).toBe(false);
        expect(grid.restore({version: GRID_SNAPSHOT_VERSION, root: {...root, children: "nope"}}, resolvable).ok).toBe(false);
        expect(grid.restore({version: GRID_SNAPSHOT_VERSION, root: {...root, size: {width: 0}}}, resolvable).ok).toBe(false);
        expect(grid.restore({version: GRID_SNAPSHOT_VERSION, root: {...root, children: [leaf("a", "width", Number.NaN, 10, 100)]}}, resolvable).ok).toBe(false);
        expect(grid.restore({version: GRID_SNAPSHOT_VERSION, root: {...root, children: [leaf("a", "width", -5, 10, 100)]}}, resolvable).ok).toBe(false);
        expect(grid.restore({version: GRID_SNAPSHOT_VERSION, root: {...root, children: [{kind: "branch", id: "b", orientation: "vertical", children: []}]}}, resolvable).ok).toBe(false);
    });

    it("深度超过上限整体拒绝", () => {
        let nested: GridNodeInput<string> = leaf("deep", "width", 50, 10, 100);
        for (let depth = 0; depth <= GRID_MAX_DEPTH; depth += 1) {
            nested = branch(`level-${depth}`, "width", "vertical", 0, [nested]);
        }
        const grid = createGrid<string>(null);
        const result = grid.restore({version: GRID_SNAPSHOT_VERSION, root: JSON.parse(JSON.stringify(nested))}, resolvable);

        expect(result.ok).toBe(false);
        expect(result.reason).toContain("深度");
    });

    it("节点数超过上限整体拒绝，且不进入超限子树解析引用", () => {
        const grid = createGrid<string>(null);
        let resolverCalls = 0;
        const snapshot = {
            version: GRID_SNAPSHOT_VERSION,
            root: {kind: "branch", id: "root", orientation: "horizontal", size: {width: 0, height: 0},
                children: Array.from({length: GRID_MAX_NODES + 1}, (_, index) => leaf(`leaf-${index}`, "width", 50, 10, 100))},
        };
        const result = grid.restore(snapshot, (ref) => {
            resolverCalls += 1;
            return {ref};
        });

        expect(result.ok).toBe(false);
        expect(result.reason).toContain(`超过 ${GRID_MAX_NODES}`);
        // 规模判定在递归之前：超限快照不会先把每个节点的引用都解析一遍
        expect(resolverCalls).toBe(0);
    });

    it("未知引用被过滤并独立报告，所在分支的外部分配意图保留", () => {
        const grid = createGrid<string>(null);
        const result = grid.restore({
            version: GRID_SNAPSHOT_VERSION,
            root: branch("root", "width", "horizontal", 0, [
                leaf("left", "width", 300, 10, 800),
                {
                    kind: "branch", id: "right", orientation: "vertical",
                    size: {width: 699, height: 0},
                    minimumSize: {width: 400, height: 0},
                    children: [leaf("top", "height", 400, 10, 800), {...leaf("ghost", "height", 100), ref: "ghost"}],
                },
            ]),
        }, (ref) => (ref === "ghost" ? null : {ref}));

        expect(result.ok).toBe(true);
        expect(result.dropped).toEqual([{ref: "ghost", reason: "未知 ref"}]);
        const snapshot = grid.serialize();
        const right = snapshot.root.kind === "branch" ? snapshot.root.children[1] : null;
        expect(right?.kind === "branch" ? right.size.width : null).toBe(699);
        expect(right?.kind === "branch" ? right.children.map((child) => child.id) : []).toEqual(["top"]);
        // 分支声明的约束是运行期的：不进快照
        expect(JSON.stringify(snapshot)).not.toContain("minimumSize");
    });

    it("恢复以当前宿主约束为准：意图保留，呈现夹取", () => {
        const grid = createGrid<string>(null);
        const result = grid.restore(
            {version: GRID_SNAPSHOT_VERSION, root: branch("root", "width", "horizontal", 0, [leaf("left", "width", 5000, 10, 100)])},
            (ref) => ({ref, minimumSize: {width: 100, height: 0}, maximumSize: {width: 320, height: 900}}),
        );

        expect(result.ok).toBe(true);
        expect(result.clamped).toEqual(["left"]);
        // 意图不被夹取改写，只有呈现被当前约束限制
        const layout = grid.layout({width: 5000, height: 600});
        expect(extent(layout.sizes, "left").width).toBe(320);
        expect(layout.issues.join()).toContain("未被任何子节点吸收");
    });

    it("恢复失败时不留下半棵树，原意图不变", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const before = grid.serialize();
        const result = grid.restore({version: GRID_SNAPSHOT_VERSION, root: branch("root", "width", "horizontal", 0, [
            leaf("x", "width", 1),
            leaf("x", "width", 1),
        ])}, resolvable);

        expect(result.ok).toBe(false);
        expect(grid.serialize()).toEqual(before);
        expect(extent(grid.layout(CONTAINER).sizes, "top").height).toBe(400);
    });

    it("快照往返：分支与叶的尺寸意图都进快照，恢复后分配一致", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        grid.resize("right", "width", 50);
        const saved = grid.serialize();
        const right = saved.root.kind === "branch" ? saved.root.children[1] : null;

        expect(right?.kind === "branch" ? right.size : null).toEqual({width: 749, height: 0});

        const restored = createGrid<string>(null, {sashSize: SASH});
        expect(restored.restore(saved, (ref) => ({ref})).ok).toBe(true);
        const sizes = restored.layout(CONTAINER).sizes;

        expect(extent(sizes, "left").width).toBe(250);
        expect(extent(sizes, "right").width).toBe(749);
    });

    it("对象 ref 由宿主稳定编码，两个不同对象可分别往返", () => {
        type Ref = {key: string};
        const refs = [{key: "left"}, {key: "right"}] satisfies Ref[];
        const grid = createGrid<Ref>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: refs.map((ref) => ({kind: "leaf" as const, id: ref.key, ref, size: {width: 50, height: 0}})),
        }, {encodeRef: (ref) => ref.key});

        const saved = grid.serialize();
        expect(saved.root.kind === "branch" ? saved.root.children.map((child) => child.kind === "leaf" ? child.ref : "") : []).toEqual(["left", "right"]);

        const restored = createGrid<Ref>(null, {encodeRef: (ref) => ref.key});
        expect(restored.restore(saved, (ref) => {
            const value = refs.find((candidate) => candidate.key === ref);
            return value ? {ref: value} : null;
        }).ok).toBe(true);
        const children = restored.root();
        expect(children?.kind === "branch" ? children.children.map((child) => child.kind === "leaf" ? child.ref : null) : []).toEqual(refs);
    });

    it("序列化只含结构、引用与尺寸意图，且不含运行期约束", () => {
        const keys = new Set<string>();
        const walk = (value: unknown) => {
            if (Array.isArray(value)) {
                value.forEach(walk);
            } else if (value && typeof value === "object") {
                for (const [key, child] of Object.entries(value)) {
                    keys.add(key);
                    walk(child);
                }
            }
        };
        const serialized: GridSnapshot = createGrid(fixture(), {sashSize: SASH}).serialize();
        walk(serialized);
        expect([...keys].sort()).toEqual(["children", "height", "id", "kind", "orientation", "ref", "root", "size", "version", "width"]);
        expect(JSON.stringify(serialized)).not.toContain("maximumSize");
    });
});

/** 可收起侧栏 + 编辑区：外壳主行的形状（fixed 侧栏保留像素，编辑区吸收余量）。 */
function shellRow(): GridBranchInput<string> {
    return {
        kind: "branch",
        id: "body",
        orientation: "horizontal",
        size: {width: 0, height: 0},
        children: [
            {
                kind: "leaf",
                id: "left",
                ref: "left",
                size: {width: 340, height: 0},
                minimumSize: {width: 280, height: 0},
                maximumSize: {width: 560, height: UNBOUNDED},
                sizing: "fixed",
                collapse: {collapsedSize: 0, restoreSize: 340, collapseThreshold: 24, expandThreshold: 24, collapsed: false},
            },
            {kind: "leaf", id: "editor", ref: "editor", size: {width: 700, height: 0}, minimumSize: {width: 120, height: 0}},
        ],
    };
}

describe("拆分树原语：批量原子调整与收起", () => {
    it("fixed 侧栏保留像素宽度，编辑区吸收容器变化", () => {
        const grid = createGrid(shellRow(), {sashSize: SASH});
        const wide = grid.layout({width: 1480, height: 600}).sizes;
        expect(extent(wide, "left").width).toBe(340);
        expect(extent(wide, "editor").width).toBe(1139);

        const narrow = grid.layout({width: 900, height: 600}).sizes;
        expect(extent(narrow, "left").width).toBe(340);
        expect(extent(narrow, "editor").width).toBe(559);
    });

    it("批量提交：父分支与子分支在同一场手势里一起成功", () => {
        const grid = createGrid({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            size: {width: 0, height: 0},
            children: [leaf("left", "width", 300), branch("side", "width", "vertical", 699, [leaf("top", "height", 400), leaf("bottom", "height", 299)])],
        }, {sashSize: SASH});
        const before = grid.layout(CONTAINER).sizes;
        const sideBaseline = {top: extent(before, "top").height, bottom: extent(before, "bottom").height};

        const result = grid.resizeBranches([
            {branchId: "root", axis: "width", baseline: {left: 300, side: 699}, target: {left: 250, side: 749}},
            {
                branchId: "side",
                axis: "height",
                baseline: sideBaseline,
                target: {top: sideBaseline.top + 60, bottom: sideBaseline.bottom - 60},
            },
        ]);

        expect(result.ok).toBe(true);
        const sizes = grid.layout(CONTAINER).sizes;
        expect(extent(sizes, "left").width).toBe(250);
        expect(extent(sizes, "top").height).toBeCloseTo(sideBaseline.top + 60, 6);
        expect(extent(sizes, "bottom").height).toBeCloseTo(sideBaseline.bottom - 60, 6);
        expect(extent(sizes, "root").width).toBe(1000);
    });

    it("任一项不通过时整批不落账", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const before = grid.serialize();
        const result = grid.resizeBranches([
            {branchId: "root", axis: "width", baseline: {left: 300, right: 699}, target: {left: 250, right: 749}},
            {branchId: "right", axis: "height", baseline: {top: 400, bottom: 199}, target: {top: 500, bottom: 199}},
        ]);

        expect(result.ok).toBe(false);
        expect(grid.serialize()).toEqual(before);
    });

    it("基线失效或目标不守恒都拒绝，不改树", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const before = grid.serialize();
        expect(grid.resizeBranches([{branchId: "root", axis: "width", baseline: {left: 1, right: 1}, target: {left: 2, right: 0}}]).ok).toBe(false);
        expect(grid.resizeBranches([{branchId: "root", axis: "width", baseline: {left: 300, right: 699}, target: {left: 400, right: 699}}]).ok).toBe(false);
        expect(grid.resizeBranches([{branchId: "ghost", axis: "width", baseline: {}, target: {}}]).ok).toBe(false);
        expect(grid.serialize()).toEqual(before);
    });

    it("收起随批量一起落账，呈现为 0 占用而意图仍是展开尺寸", () => {
        const grid = createGrid(shellRow(), {sashSize: SASH});
        const baseline = grid.layout({width: 1480, height: 600}).sizes;
        const result = grid.resizeBranches([{
            branchId: "body",
            axis: "width",
            baseline: {left: extent(baseline, "left").width, editor: extent(baseline, "editor").width},
            target: {left: 0, editor: 1139 + 340},
            collapsed: {left: true},
        }]);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.collapsed).toEqual({left: true});
            // 意图保留展开宽度，绝不写 0
            expect(extent(result.intents, "left").width).toBe(340);
        }
        const sizes = grid.layout({width: 1480, height: 600}).sizes;
        expect(extent(sizes, "left").width).toBe(0);
        expect(extent(sizes, "editor").width).toBe(1479);
    });

    it("收起清掉后收起节点的最小尺寸不再撑开分配", () => {
        const grid = createGrid(shellRow(), {sashSize: SASH});
        const baseline = grid.layout({width: 1480, height: 600}).sizes;
        grid.resizeBranches([{
            branchId: "body",
            axis: "width",
            baseline: {left: extent(baseline, "left").width, editor: extent(baseline, "editor").width},
            target: {left: 0, editor: 1479},
            collapsed: {left: true},
        }]);

        // 容器缩到 400：收起的 left 不占位，editor 拿到全部宽度
        const sizes = grid.layout({width: 400, height: 600}).sizes;
        expect(extent(sizes, "left").width).toBe(0);
        expect(extent(sizes, "editor").width).toBe(399);
    });

    it("不可收起的节点不能被标记收起", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const result = grid.resizeBranches([{branchId: "root", axis: "width", baseline: {left: 300, right: 699}, target: {left: 250, right: 749}, collapsed: {left: true}}]);
        expect(result.ok).toBe(false);
        expect(extent(grid.layout(CONTAINER).sizes, "left").width).toBe(300);
    });
});
