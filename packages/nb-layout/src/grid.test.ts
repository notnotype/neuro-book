import {describe, expect, it} from "bun:test";
import {
    GRID_MAX_DEPTH,
    GRID_MAX_NODES,
    GRID_SNAPSHOT_VERSION,
    createGrid,
    type GridAxis,
    type GridBranchInput,
    type GridCommitFailureCode,
    type GridExtent,
    type GridFailureCode,
    type GridHostIssueCode,
    type GridIssue,
    type GridIssueCode,
    type GridLeafInput,
    type GridNodeInput,
    type GridOrientation,
    type GridRestoreFailureCode,
    type GridSnapshot,
} from "./grid";
import {createGridGestureSession, type GridGestureSession} from "./grid-gesture";

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

/** 诊断只比码与参数（Spec 输出 139）：`message` 是给日志看的英文，不断言文字。 */
function facts(issues: readonly GridIssue[]): Record<string, unknown>[] {
    return issues.map((issue) => ({code: issue.code, ...issue.params}));
}

describe("拆分树原语：不可满足与窄容器", () => {
    it("子节点最小尺寸合计超过可用空间：给诊断，尺寸有限非负且总量不溢出", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 300, 300),
            leaf("b", "width", 300, 300),
        ]), {sashSize: SASH});
        const result = grid.layout({width: 500, height: 600});

        expect(facts(result.issues)).toContainEqual({code: "over-constrained", cause: "min-total", id: "root", axis: "width", available: 499, required: 600});
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

    it("度量取两位小数，和 message 里的数一致（Spec 输出 139）", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 300, 300),
            leaf("b", "width", 300, 300),
        ]), {sashSize: SASH});
        const result = grid.layout({width: 500.3333, height: 600});
        expect(facts(result.issues)).toContainEqual({code: "over-constrained", cause: "min-total", id: "root", axis: "width", available: 499.33, required: 600});
    });

    it("容器比 sash 总量还小：压缩分隔条与子节点，几何不超容器", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 100, 50),
            leaf("b", "width", 100, 50),
        ]), {sashSize: SASH});
        const result = grid.layout({width: 0.5, height: 10});

        expect(facts(result.issues)).toContainEqual({code: "over-constrained", cause: "sash-overflow", id: "root", axis: "width", available: 0.5, required: 1});
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

        expect(facts(result.issues)).toEqual([{code: "over-constrained", cause: "leaf-min", id: "only", axis: "width", available: 50, required: 200}]);
        expect(extent(result.sizes, "only")).toEqual({width: 50, height: 100});
    });

    it("分支显式上限与后代下限冲突时给诊断并保持有限几何", () => {
        const root = branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 100, 100),
            leaf("b", "width", 100, 100),
        ]);
        root.maximumSize = {width: 150, height: UNBOUNDED};
        const result = createGrid(root, {sashSize: SASH}).layout({width: 500, height: 100});

        expect(facts(result.issues)).toContainEqual({code: "conflicting-bounds", id: "root", axis: "width", min: 201, max: 150});
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

        expect(facts(result.issues)).toContainEqual({code: "over-constrained", cause: "cross-min", id: "root", axis: "height", available: 600, required: 700});
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

        expect(facts(result.issues)).toEqual([{code: "unabsorbed-space", cause: "capped", id: "root", axis: "width", rest: 399}]);
        expect(extent(result.sizes, "root").width).toBe(601);
    });

    it("没有按比例分的子节点：一个分支只有一条 unabsorbed-space（no-weight），下限等于上限的按比例叶不算按比例分", () => {
        const fixed = (id: string, size: number): GridLeafInput<string> => ({...leaf(id, "width", size), sizing: "fixed"});
        const twoFixed = createGrid(branch("root", "width", "horizontal", 0, [fixed("a", 100), fixed("b", 100)]), {sashSize: SASH}).layout({width: 600, height: 100});
        expect(facts(twoFixed.issues)).toEqual([{code: "unabsorbed-space", cause: "no-weight", id: "root", axis: "width", rest: 399}]);
        const rigidWeight = createGrid(branch("root", "width", "horizontal", 0, [fixed("a", 200), leaf("b", "width", 100, 100, 100)]), {sashSize: SASH}).layout({width: 600, height: 100});
        expect(facts(rigidWeight.issues)).toEqual([{code: "unabsorbed-space", cause: "no-weight", id: "root", axis: "width", rest: 299}]);
    });

    it("固定尺寸装不下留给它们的预算：available 是预算，required 是压缩前的合计", () => {
        const result = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 200, 100, 400), sizing: "fixed"},
            leaf("b", "width", 100, 150),
            {...leaf("c", "width", 200, 100, 400), sizing: "fixed"},
        ]), {sashSize: 0}).layout({width: 500, height: 100});
        expect(facts(result.issues)).toContainEqual({code: "over-constrained", cause: "fixed-overflow", id: "root", axis: "width", available: 350, required: 400});
    });

    it("祖先沿主轴收起为零时，里面的分支留空不报 unabsorbed-space", () => {
        const side: GridBranchInput<string> = {
            ...branch("side", "width", "vertical", 300, [{...leaf("x", "height", 50), sizing: "fixed"}, {...leaf("y", "height", 50), sizing: "fixed"}]),
            collapse: {collapsed: true, collapsedSize: 0, restoreSize: 300, collapseThreshold: 24, expandThreshold: 24},
        };
        const result = createGrid(branch("root", "width", "horizontal", 0, [side, leaf("editor", "width", 699)]), {sashSize: SASH}).layout(CONTAINER);
        expect(facts(result.issues).filter((issue) => issue.code === "unabsorbed-space")).toEqual([]);
    });
});

describe("拆分树原语：手势会话的诊断（Spec 输出 139、140）", () => {
    const session = (grid: ReturnType<typeof createGrid<string>>, extentOf: GridExtent, source: "pointer" | "keyboard", sashes: {branchId: string; index: number; axis: GridAxis}[]) =>
        createGridGestureSession<string>({contextKey: "test", revision: 1, root: grid.root(), extent: extentOf, layout: grid.layout(extentOf), sashSize: SASH, sessionId: "issues", source, sashes});

    it("Enter 恢复空间不够：会话的诊断里有 no-room-to-restore，不被拖动求解盖掉", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 250, 200), collapse: {collapsed: true, collapsedSize: 0, restoreSize: 250, collapseThreshold: 24, expandThreshold: 24}},
            leaf("b", "width", 300, 150),
        ]), {sashSize: SASH});
        const keyboard = session(grid, {width: 301, height: 100}, "keyboard", [{branchId: "root", index: 0, axis: "width"}]);
        expect(keyboard.toggleCollapsed()).toBeNull();
        expect(facts(keyboard.issues)).toContainEqual({code: "no-room-to-restore", id: "a", available: 150, required: 200});
    });

    it("先拖再折叠没有变化：前面的位移照常提交", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 200, 50), collapse: {collapsed: false, collapsedSize: 0, restoreSize: 200, collapseThreshold: 24, expandThreshold: 24}},
            leaf("b", "width", 200, 100),
        ]), {sashSize: SASH});
        const pointer = session(grid, {width: 401, height: 100}, "pointer", [{branchId: "root", index: 0, axis: "width"}]);
        expect(pointer.update({x: -30, y: 0})).not.toBeNull();
        pointer.setCollapsed(false);
        expect(pointer.finish()?.changes[0]?.target).toMatchObject({a: 170, b: 230});
    });

    it("交叉处的会话里折叠只作用于发起它的那根轴：另一根轴没有收起策略也不报 no-collapse-policy", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("left", "width", 300, 100), collapse: {collapsed: false, collapsedSize: 0, restoreSize: 300, collapseThreshold: 24, expandThreshold: 24}},
            branch("right", "width", "vertical", 699, [leaf("top", "height", 400, 100), leaf("bottom", "height", 199, 100)]),
        ]), {sashSize: SASH});
        const cross = createGridGestureSession<string>({contextKey: "test", revision: 1, root: grid.root(), extent: CONTAINER, layout: grid.layout(CONTAINER), sashSize: SASH, sessionId: "cross-collapse", source: "pointer", sashes: [{branchId: "root", index: 0, axis: "width"}, {branchId: "right", index: 0, axis: "height"}]});
        const preview = cross.toggleCollapsed();
        expect(preview?.changes.find((change) => change.branchId === "root")?.collapsed).toEqual({left: true});
        expect(facts(cross.issues).filter((issue) => issue.code === "no-collapse-policy")).toEqual([]);
    });

    it("折叠没有变化、拖动求解又报了同一条：会话的快照里同一个键只有一条", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 250, 200), collapse: {collapsed: true, collapsedSize: 0, restoreSize: 250, collapseThreshold: 24, expandThreshold: 24}},
            leaf("b", "width", 300, 150),
        ]), {sashSize: SASH});
        const pointer = session(grid, {width: 301, height: 100}, "pointer", [{branchId: "root", index: 0, axis: "width"}]);
        // 拖过展开阈值（下限 200），能给的只有 150：拖动求解报 no-room-to-restore；折叠也报同一条。
        pointer.update({x: 250, y: 0});
        expect(facts(pointer.issues).filter((issue) => issue.code === "no-room-to-restore")).toHaveLength(1);
        pointer.setCollapsed(false);
        expect(facts(pointer.issues).filter((issue) => issue.code === "no-room-to-restore")).toHaveLength(1);
    });

    it("交叉处两根轴都装不下：各有一条 range-overflow，id 与轴不同", () => {
        // 两根轴的最小值合计都超过容器：窄容器已降级，拖动不改几何，两根轴各说一次。
        const wide = (id: string, axis: GridAxis): GridLeafInput<string> => ({...leaf(id, axis, 300), minimumSize: {width: 500, height: 300}});
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            wide("left", "width"),
            branch("right", "width", "vertical", 500, [wide("top", "height"), wide("bottom", "height")]),
        ]), {sashSize: SASH});
        const layout = grid.layout({width: 900, height: 500});
        const cross = createGridGestureSession<string>({contextKey: "test", revision: 1, root: grid.root(), extent: {width: 900, height: 500}, layout, sashSize: SASH, sessionId: "cross", source: "pointer", sashes: [{branchId: "root", index: 0, axis: "width"}, {branchId: "right", index: 0, axis: "height"}]});
        cross.update({x: 10, y: 10});
        const ranges = facts(cross.issues).filter((issue) => issue.cause === "range-overflow");
        expect(ranges.map((issue) => [issue.id, issue.axis])).toEqual([["root", "width"], ["right", "height"]]);
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

        expect(result).toMatchObject({ok: false, code: "not-found", params: {id: "nope"}});
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

        expect(grid.removeLeaf("root")).toMatchObject({ok: false, code: "wrong-node-kind", params: {id: "root", expected: "leaf"}});
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
        expect(crowded).toMatchObject({ok: false, code: "limit-exceeded", params: {limit: "nodes", max: GRID_MAX_NODES}});

        let deep: GridNodeInput<string> = leaf("deep-end", "width", 1);
        for (let index = GRID_MAX_DEPTH - 1; index >= 1; index -= 1) {
            deep = branch(`d${index}`, "width", "horizontal", 0, [deep]);
        }
        const nested = createGrid(deep).splitLeaf("deep-end", {branchId: "pair", orientation: "horizontal", side: "after", leaf: {kind: "leaf", id: "added", ref: "added"}});
        expect(nested).toMatchObject({ok: false, code: "limit-exceeded", params: {limit: "depth", max: GRID_MAX_DEPTH}});
    });
});

describe("拆分树原语：快照", () => {
    const resolvable = (ref: string) => ({ref});

    it("版本 1 明确拒绝，并说明无法推导两轴", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const result = grid.restore({version: 1, root: {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 600}}}, resolvable);

        expect(result).toMatchObject({ok: false, code: "unsupported-version", params: {version: "1"}});
        expect(extent(grid.layout(CONTAINER).sizes, "left").width).toBe(300);
    });

    it("不认识的版本号拒绝并保持原树不动", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const result = grid.restore({version: 99, root: {}}, resolvable);

        expect(result).toMatchObject({ok: false, code: "unsupported-version", params: {version: "99"}});
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

        expect(result).toMatchObject({ok: false, code: "duplicate-id", params: {id: "same", with: "existing"}});
    });

    it("非法方向、非法 children、非有限尺寸与缺分支尺寸整体拒绝", () => {
        const grid = createGrid<string>(null);
        const root = {kind: "branch", id: "root", orientation: "horizontal", size: {width: 0, height: 0}, children: []};

        const invalid = (snapshotRoot: unknown) => grid.restore({version: GRID_SNAPSHOT_VERSION, root: snapshotRoot}, resolvable);
        expect(invalid({...root, orientation: "diagonal"})).toMatchObject({ok: false, code: "invalid-snapshot", params: {field: "orientation", id: "root"}});
        expect(invalid({...root, children: "nope"})).toMatchObject({ok: false, code: "invalid-snapshot", params: {field: "children", id: "root"}});
        expect(invalid({...root, size: {width: 0}})).toMatchObject({ok: false, code: "invalid-snapshot", params: {field: "size", id: "root"}});
        expect(invalid({...root, children: [leaf("a", "width", Number.NaN, 10, 100)]})).toMatchObject({ok: false, code: "invalid-snapshot", params: {field: "size", id: "a"}});
        expect(invalid({...root, children: [leaf("a", "width", -5, 10, 100)]})).toMatchObject({ok: false, code: "invalid-snapshot", params: {field: "size", id: "a"}});
        expect(invalid({...root, children: [{kind: "branch", id: "b", orientation: "vertical", children: []}]})).toMatchObject({ok: false, code: "invalid-snapshot", params: {field: "size", id: "b"}});
    });

    it("深度超过上限整体拒绝", () => {
        let nested: GridNodeInput<string> = leaf("deep", "width", 50, 10, 100);
        for (let depth = 0; depth <= GRID_MAX_DEPTH; depth += 1) {
            nested = branch(`level-${depth}`, "width", "vertical", 0, [nested]);
        }
        const grid = createGrid<string>(null);
        const result = grid.restore({version: GRID_SNAPSHOT_VERSION, root: JSON.parse(JSON.stringify(nested))}, resolvable);

        expect(result).toMatchObject({ok: false, code: "limit-exceeded", params: {limit: "depth", max: GRID_MAX_DEPTH}});
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

        expect(result).toMatchObject({ok: false, code: "limit-exceeded", params: {limit: "nodes", max: GRID_MAX_NODES}});
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
        expect(result.dropped).toEqual([{ref: "ghost", code: "unknown-ref"}]);
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
        expect(facts(layout.issues)).toContainEqual(expect.objectContaining({code: "unabsorbed-space", id: "root", axis: "width"}));
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

/** 分支的收起（docs/specs/ui/nested-grid.md 的“分支的收起”）：一列里上下两块，下面那块又左右拆开；收起策略配在这一列上。 */
describe("拆分树原语：分支的收起", () => {
    const POLICY = {collapsedSize: 0, restoreSize: 300, collapseThreshold: 24, expandThreshold: 24};
    const column = (collapsed: boolean, collapsedSize = POLICY.collapsedSize): GridBranchInput<string> => branch("root", "width", "horizontal", 0, [
        {
            ...branch("side", "width", "vertical", 300, [
                {...leaf("top", "height", 300, 80), minimumSize: {width: 160, height: 80}},
                branch("pair", "height", "horizontal", 299, [
                    {...leaf("a", "width", 150, 100), minimumSize: {width: 100, height: 80}},
                    {...leaf("b", "width", 149, 100), minimumSize: {width: 100, height: 80}},
                ]),
            ]),
            sizing: "fixed",
            collapse: {...POLICY, collapsedSize, collapsed},
        },
        leaf("editor", "width", 699, 120),
    ]);

    it("收起的分支在父分支主轴上是 collapsedSize，里面的节点在这一轴上都取这个尺寸，另一轴的分配不变；不报诊断", () => {
        const open = createGrid(column(false), {sashSize: SASH}).layout(CONTAINER);
        const closed = createGrid(column(true), {sashSize: SASH}).layout(CONTAINER);
        expect(open.issues).toEqual([]);
        expect(closed.issues).toEqual([]);
        expect(["side", "top", "pair", "a", "b"].map((id) => extent(closed.sizes, id).width)).toEqual([0, 0, 0, 0, 0]);
        expect(["top", "pair"].map((id) => extent(closed.sizes, id).height)).toEqual(["top", "pair"].map((id) => extent(open.sizes, id).height));
        expect(extent(closed.sizes, "editor").width).toBe(999);
    });

    it("收起为零的分支在另一根轴上也不占最小尺寸：父分支的下限不算它，里面放不下不报诊断；收成一条的还看得见，照常报", () => {
        const short: GridExtent = {width: 1000, height: 100};
        const open = createGrid(column(false), {sashSize: SASH}).layout(short);
        expect(open.issues.length).toBeGreaterThan(0);
        expect(open.constraints.root?.minimumSize.height).toBe(161);

        const zero = createGrid(column(true), {sashSize: SASH}).layout(short);
        expect(zero.issues).toEqual([]);
        expect(zero.constraints.root?.minimumSize.height).toBe(0);
        // 它自己展开后的约束不变，分支内部沿自己那一轴照常分。
        expect(zero.constraints.side?.minimumSize.height).toBe(161);
        expect(["top", "pair"].map((id) => extent(zero.sizes, id).height)).toEqual(["top", "pair"].map((id) => extent(open.sizes, id).height));

        const strip = createGrid(column(true, 30), {sashSize: SASH}).layout(short);
        expect(extent(strip.sizes, "side").width).toBe(30);
        expect(strip.constraints.root?.minimumSize.height).toBe(161);
        expect(strip.issues).toEqual(open.issues);
    });

    it("同一行里别的节点的最小尺寸照算：收起为零的那一列不再把这一行撑高，也不压低它", () => {
        const withTallEditor = (collapsed: boolean): GridBranchInput<string> => {
            const root = column(collapsed);
            return {...root, children: root.children.map((child) => (child.id === "editor" ? {...child, minimumSize: {width: 120, height: 90}} : child))};
        };
        const zero = createGrid(withTallEditor(true), {sashSize: SASH}).layout({width: 1000, height: 100});
        expect(zero.constraints.root?.minimumSize.height).toBe(90);
        expect(zero.issues).toEqual([]);
        const tooShort = createGrid(withTallEditor(true), {sashSize: SASH}).layout({width: 1000, height: 60});
        const ids = facts(tooShort.issues).map((issue) => issue.id);
        expect(ids).toContain("editor");
        expect(ids.filter((id) => id === "side" || id === "top" || id === "pair")).toEqual([]);
    });

    it("拖过阈值收起、从零拉回：都随批量落账，意图保留展开宽度，里面各块回到收起前的尺寸", () => {
        const grid = createGrid(column(false), {sashSize: SASH});
        const open = grid.layout(CONTAINER).sizes;
        const closed = grid.resizeBranches([{branchId: "root", axis: "width", baseline: {side: 300, editor: 699}, target: {side: 0, editor: 999}, collapsed: {side: true}}]);
        if (!closed.ok) throw new Error(closed.message);
        expect(closed.collapsed).toEqual({side: true});
        expect(extent(closed.intents, "side").width).toBe(300);
        expect(extent(grid.layout(CONTAINER).sizes, "side").width).toBe(0);

        const back = grid.resizeBranches([{branchId: "root", axis: "width", baseline: {side: 0, editor: 999}, target: {side: 260, editor: 739}, collapsed: {side: false}}]);
        if (!back.ok) throw new Error(back.message);
        expect(back.collapsed).toEqual({side: false});
        const reopened = grid.layout(CONTAINER);
        expect(reopened.issues).toEqual([]);
        expect(extent(reopened.sizes, "side").width).toBe(260);
        expect(["top", "pair"].map((id) => extent(reopened.sizes, id).height)).toEqual(["top", "pair"].map((id) => extent(open, id).height));
    });

    it("手势会话对“子节点是分支”的边界：指针拖过阈值收起、从零跟着指针拉回，Enter 收起与恢复到记忆宽度；提交里收起的是这个分支", () => {
        const open = (collapsed: boolean, source: "pointer" | "keyboard"): GridGestureSession<string> => {
            const grid = createGrid(column(collapsed), {sashSize: SASH});
            return createGridGestureSession<string>({contextKey: "test", revision: 1, root: grid.root(), extent: CONTAINER, layout: grid.layout(CONTAINER), sashSize: SASH, sessionId: "branch-collapse", source, sashes: [{branchId: "root", index: 0, axis: "width"}]});
        };
        const widthsIn = (session: GridGestureSession<string>, preview: ReturnType<GridGestureSession<string>["update"]>): number[] => {
            expect(session.issues).toEqual([]);
            return ["side", "top", "a", "b", "editor"].map((id) => extent(preview?.layout.sizes ?? {}, id).width);
        };

        // 展开最小宽度是 a、b 各 100 加一条缝；再往里拖过 24 才收起。
        const dragIn = open(false, "pointer");
        expect(dragIn.update({x: -90, y: 0})?.changes[0]?.collapsed).toEqual({});
        const closed = dragIn.update({x: -200, y: 0});
        expect(widthsIn(dragIn, closed)).toEqual([0, 0, 0, 0, 999]);
        expect(dragIn.finish()?.changes[0]).toMatchObject({branchId: "root", target: {side: 0, editor: 999}, collapsed: {side: true}});

        const dragOut = open(true, "pointer");
        expect(dragOut.update({x: 150, y: 0})).toBeNull();
        const pulled = dragOut.update({x: 250, y: 0});
        expect(widthsIn(dragOut, pulled)[0]).toBe(250);
        expect(dragOut.finish()?.changes[0]).toMatchObject({target: {side: 250, editor: 749}, collapsed: {side: false}});

        const enterIn = open(false, "keyboard");
        expect(widthsIn(enterIn, enterIn.toggleCollapsed())).toEqual([0, 0, 0, 0, 999]);
        expect(enterIn.finish()?.changes[0]?.collapsed).toEqual({side: true});

        const enterOut = open(true, "keyboard");
        expect(widthsIn(enterOut, enterOut.toggleCollapsed())[0]).toBe(POLICY.restoreSize);
        expect(enterOut.finish()?.changes[0]).toMatchObject({target: {side: 300, editor: 699}, collapsed: {side: false}});
    });
});

/** 编辑区三组并排：拖一条边界把隔壁的组推开，掉头往回拖。 */
describe("拆分树原语：手势会话里被推开的兄弟", () => {
    const ROW: GridExtent = {width: 902, height: 400};
    const row = (): GridBranchInput<string> => branch("root", "width", "horizontal", 0, [
        leaf("a", "width", 300, 100),
        leaf("b", "width", 300, 100),
        leaf("c", "width", 300, 100),
    ]);
    const widths = (sizes: Record<string, GridExtent>): number[] => ["a", "b", "c"].map((id) => extent(sizes, id).width);

    it("b 到最小宽度后把 a 推开，往回拖时 a|b 不动、b 先长回来；提交与落账都是最后看到的样子", () => {
        const grid = createGrid(row(), {sashSize: SASH});
        const session = createGridGestureSession<string>({contextKey: "test", revision: 1, root: grid.root(), extent: ROW, layout: grid.layout(ROW), sashSize: SASH, sessionId: "push", source: "pointer", sashes: [{branchId: "root", index: 1, axis: "width"}]});
        expect(widths(session.update({x: -250, y: 0})?.layout.sizes ?? {})).toEqual([250, 100, 550]);
        expect(widths(session.update({x: -150, y: 0})?.layout.sizes ?? {})).toEqual([250, 200, 450]);
        const commit = session.finish();
        if (commit === null) throw new Error("拖动没有产生提交");
        expect(commit.changes[0]).toMatchObject({target: {a: 250, b: 200, c: 450}, active: ["b", "c"], compensated: ["a"]});
        const applied = grid.resizeBranches(commit.changes);
        if (!applied.ok) throw new Error(applied.message);
        expect(widths(grid.layout(ROW).sizes)).toEqual([250, 200, 450]);
    });
});

/** 显式恢复回到哪：缺省是记忆的 `restoreSize`；`restoreToShare` 是按权重该得的那一份。 */
describe("拆分树原语：手势会话里按比例分的叶的显式恢复", () => {
    const WIDE: GridExtent = {width: 1208, height: 400};
    const row = (restoreToShare: boolean): GridBranchInput<string> => branch("root", "width", "horizontal", 0, [
        leaf("a", "width", 300, 80),
        leaf("b", "width", 300, 80),
        {...leaf("c", "width", 300, 120), collapse: {collapsed: false, collapsedSize: 0, restoreSize: 200, collapseThreshold: 24, expandThreshold: 24, ...(restoreToShare ? {restoreToShare: true} : {})}},
    ]);
    /** 在 b、c 之间的边界上按一次 Enter，提交落到 grid 上；返回落账后三块的宽度。 */
    const enter = (grid: ReturnType<typeof createGrid<string>>): number[] => {
        const session = createGridGestureSession<string>({contextKey: "test", revision: 1, root: grid.root(), extent: WIDE, layout: grid.layout(WIDE), sashSize: 4, sessionId: "enter", source: "keyboard", sashes: [{branchId: "root", index: 1, axis: "width"}]});
        session.toggleCollapsed();
        const commit = session.finish();
        if (commit === null) throw new Error("Enter 没有产生提交");
        const applied = grid.resizeBranches(commit.changes);
        if (!applied.ok) throw new Error(applied.message);
        const sizes = grid.layout(WIDE).sizes;
        return ["a", "b", "c"].map((id) => Math.round(extent(sizes, id).width));
    };

    it("缺省：收起时记下收起前的宽度，恢复回到它，连按几轮不漂（输出 20、148）", () => {
        const grid = createGrid(row(false), {sashSize: 4});
        expect(["a", "b", "c"].map((id) => extent(grid.layout(WIDE).sizes, id).width)).toEqual([400, 400, 400]);
        for (let round = 0; round < 3; round += 1) {
            expect(enter(grid)).toEqual([400, 800, 0]);
            expect(enter(grid)).toEqual([400, 400, 400]);
        }
    });

    it("缺省：从收起状态建树，恢复读宿主给的 `restoreSize`（输出 20）", () => {
        const collapsedRow = branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 300, 80),
            leaf("b", "width", 300, 80),
            {...leaf("c", "width", 300, 120), collapse: {collapsed: true, collapsedSize: 0, restoreSize: 200, collapseThreshold: 24, expandThreshold: 24}},
        ]);
        const grid = createGrid(collapsedRow, {sashSize: 4});
        expect(enter(grid)[2]).toBe(200);
    });

    it("`restoreToShare`：恢复到按权重此刻该得的那一份，不读 `restoreSize`；让位的是挨着边界的兄弟", () => {
        const grid = createGrid(row(true), {sashSize: 4});
        expect(enter(grid)).toEqual([400, 800, 0]);
        // `resizeBranches` 落账后三块的权重是 300、600、300：c 的份额是 1200 的四分之一。
        expect(enter(grid)).toEqual([400, 500, 300]);
    });
});

/** 收起与展开的入口、恢复尺寸谁记（Spec 输出 147、148）。容器取意图之和加分隔条，呈现与意图一一对应。 */
describe("拆分树原语：收起与展开的入口", () => {
    const POLICY = {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24};
    const collapsible = (restoreSize: number, collapsed = false) => ({collapse: {...POLICY, restoreSize, collapsed}});
    const fixed = {sizing: "fixed" as const};
    const widths = (grid: ReturnType<typeof createGrid<string>>, container: GridExtent, ids: readonly string[]): number[] =>
        ids.map((id) => Math.round(extent(grid.layout(container).sizes, id).width * 100) / 100);
    const session = (grid: ReturnType<typeof createGrid<string>>, container: GridExtent, sashIndex: number, source: "keyboard" | "pointer"): GridGestureSession<string> =>
        createGridGestureSession<string>({contextKey: "test", revision: 1, root: grid.root(), extent: container, layout: grid.layout(container), sashSize: 4, sessionId: "s", source, sashes: [{branchId: "root", index: sashIndex, axis: "width"}]});
    const commit = (grid: ReturnType<typeof createGrid<string>>, gesture: GridGestureSession<string>): void => {
        const finished = gesture.finish();
        if (finished === null) throw new Error("手势没有产生提交");
        const applied = grid.resizeBranches(finished.changes);
        if (!applied.ok) throw new Error(applied.message);
    };

    it("只翻标记：收起后的布局和把同一棵树的标记翻了再建相同，保留像素的兄弟不变、按比例分的吸收；展开回到意图", () => {
        const ROW: GridExtent = {width: 808, height: 400};
        const tree = (collapsed: boolean): GridBranchInput<string> => branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 200, 100), ...fixed, ...collapsible(200, collapsed)},
            {...leaf("b", "width", 200, 100), ...fixed},
            leaf("c", "width", 400, 100),
        ]);
        const grid = createGrid(tree(false), {sashSize: 4});
        expect(widths(grid, ROW, ["a", "b", "c"])).toEqual([200, 200, 400]);

        const collapsed = grid.setCollapsed("a", true);
        expect(collapsed).toMatchObject({ok: true, changed: true, collapse: {collapsed: true}});
        expect(widths(grid, ROW, ["a", "b", "c"])).toEqual([0, 200, 600]);
        expect(widths(grid, ROW, ["a", "b", "c"])).toEqual(widths(createGrid(tree(true), {sashSize: 4}), ROW, ["a", "b", "c"]));

        expect(grid.setCollapsed("a", false)).toMatchObject({ok: true, changed: true, collapse: {collapsed: false}});
        expect(widths(grid, ROW, ["a", "b", "c"])).toEqual([200, 200, 400]);
    });

    it("已经是那个状态：`changed` 为假、树不变；兄弟到上限、全部收起都照样成功（全部收起时整行留白、没有诊断）", () => {
        const ROW: GridExtent = {width: 1004, height: 400};
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 500, 100), ...collapsible(500)},
            {...leaf("b", "width", 500, 100), ...collapsible(500)},
        ]), {sashSize: 4});
        const before = grid.serialize();
        expect(grid.setCollapsed("a", false)).toMatchObject({ok: true, changed: false});
        expect(grid.serialize()).toEqual(before);

        expect(grid.setCollapsed("a", true)).toMatchObject({ok: true, changed: true});
        expect(widths(grid, ROW, ["a", "b"])).toEqual([0, 1000]);
        expect(grid.setCollapsed("b", true)).toMatchObject({ok: true, changed: true});
        expect(widths(grid, ROW, ["a", "b"])).toEqual([0, 0]);
        expect(grid.layout(ROW).issues).toEqual([]);

        const capped = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100, 300), ...collapsible(300)},
            {...leaf("b", "width", 200, 100, 200), ...fixed},
        ]), {sashSize: 4});
        expect(capped.setCollapsed("a", true)).toMatchObject({ok: true, changed: true});
        expect(widths(capped, {width: 504, height: 400}, ["a", "b"])).toEqual([0, 200]);
    });

    it("按比例分的面板：经 `setCollapsed` 展开按权重分，经 Enter 展开回到收起前记下的宽度，两者不同（输出 147 的不承诺）", () => {
        const ROW: GridExtent = {width: 1004, height: 400};
        const draggedThenCollapsed = (): ReturnType<typeof createGrid<string>> => {
            const grid = createGrid(branch("root", "width", "horizontal", 0, [
                {...leaf("a", "width", 500, 100), ...collapsible(500)},
                leaf("b", "width", 500, 100),
            ]), {sashSize: 4});
            const drag = session(grid, ROW, 0, "pointer");
            drag.update({x: 100, y: 0});
            commit(grid, drag);
            expect(widths(grid, ROW, ["a", "b"])).toEqual([600, 400]);
            const enter = session(grid, ROW, 0, "keyboard");
            enter.toggleCollapsed();
            commit(grid, enter);
            expect(widths(grid, ROW, ["a", "b"])).toEqual([0, 1000]);
            return grid;
        };
        const byEntry = draggedThenCollapsed();
        byEntry.setCollapsed("a", false);
        expect(widths(byEntry, ROW, ["a", "b"])).toEqual([375, 625]);

        const byEnter = draggedThenCollapsed();
        const enter = session(byEnter, ROW, 0, "keyboard");
        enter.toggleCollapsed();
        commit(byEnter, enter);
        expect(widths(byEnter, ROW, ["a", "b"])).toEqual([600, 400]);
    });

    it("恢复尺寸谁收起谁记：保留像素的面板记意图（被压缩时也是）；按比例分的面板拖动收起记收起前的宽度，经 `setCollapsed` 不改（输出 148）", () => {
        // 窄窗口：a、c 保留 300，被压到 200；经 Enter 收起 a，记的是意图 300。
        const squeezed = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100), ...fixed, ...collapsible(100)},
            leaf("b", "width", 100, 100),
            {...leaf("c", "width", 300, 100), ...fixed},
        ]), {sashSize: 4});
        const NARROW: GridExtent = {width: 508, height: 400};
        expect(widths(squeezed, NARROW, ["a", "b", "c"])).toEqual([200, 100, 200]);
        const enter = session(squeezed, NARROW, 0, "keyboard");
        enter.toggleCollapsed();
        commit(squeezed, enter);
        expect(squeezed.find("a")?.collapse?.restoreSize).toBe(300);

        // 按比例分的面板拖到零：记按下时的宽度 500。
        const ROW: GridExtent = {width: 1004, height: 400};
        const dragged = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 500, 100), ...collapsible(123)},
            leaf("b", "width", 500, 100),
        ]), {sashSize: 4});
        const drag = session(dragged, ROW, 0, "pointer");
        drag.update({x: -600, y: 0});
        commit(dragged, drag);
        expect(dragged.find("a")?.collapse).toMatchObject({collapsed: true, restoreSize: 500});

        // `setCollapsed`：保留像素的记意图，按比例分的不改（没有布局可读）。
        const entry = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 250, 100), ...fixed, ...collapsible(100)},
            {...leaf("b", "width", 500, 100), ...collapsible(123)},
            leaf("c", "width", 500, 100),
        ]), {sashSize: 4});
        expect(entry.setCollapsed("a", true)).toMatchObject({ok: true, collapse: {collapsed: true, restoreSize: 250}});
        expect(entry.setCollapsed("b", true)).toMatchObject({ok: true, collapse: {collapsed: true, restoreSize: 123}});

        // 收起策略不写快照：恢复时解析结果不给 `collapse`，沿用当前树的，记下的值还在。
        const restored = entry.restore(entry.serialize(), (ref) => ({ref}));
        expect(restored.ok).toBe(true);
        expect(entry.find("a")?.collapse).toMatchObject({collapsed: true, restoreSize: 250});
    });

    it("失败：`id` 不存在、是根、没有收起策略（输出 147）", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 500), leaf("b", "width", 499)]), {sashSize: SASH});
        expect(codeOf(grid.setCollapsed("missing", true))).toEqual({code: "not-found", params: {id: "missing"}});
        expect(codeOf(grid.setCollapsed("root", true))).toEqual({code: "invalid-argument", params: {field: "root", id: "root"}});
        expect(codeOf(grid.setCollapsed("a", true))).toEqual({code: "not-collapsible", params: {id: "a", branch: "root"}});
    });

    it("分隔条上的 Enter：另一侧吸收不了时不收，给 `no-room-to-collapse`，没有提交（输出 20）", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100, 300), ...collapsible(300)},
            {...leaf("b", "width", 200, 100, 200), ...fixed},
        ]), {sashSize: 4});
        const enter = session(grid, {width: 504, height: 400}, 0, "keyboard");
        enter.toggleCollapsed();
        expect(enter.issues.map((issue) => issue.code)).toContain("no-room-to-collapse");
        expect(enter.finish()).toBeNull();
        expect(grid.find("a")?.collapse?.collapsed).toBe(false);
    });
});

/** 失败只比码与参数；`message` 是给日志看的英文（Spec 失败 5），只核对它是可打印的 ASCII，不断言文字。 */
function codeOf(result: {ok: boolean; code?: string; message?: string; params?: unknown}): {code: string | undefined; params: unknown} | null {
    if (!result.ok) expect(result.message).toMatch(/^[\x20-\x7e]+$/u);
    return result.ok ? null : {code: result.code, params: result.params};
}

/** 三层失败码的全集：新增码不列进来时下面的类型检查不过。 */
const FAILURE_CODES = [
    "not-found", "wrong-node-kind", "wrong-axis", "not-finite", "invalid-argument", "limit-exceeded", "duplicate-id", "into-own-subtree", "not-conserved", "stale-baseline", "not-collapsible",
    "invalid-snapshot", "unsupported-version", "unresolved-root",
    "not-ready", "stale-context", "stale-revision", "stale-size", "handler-missing", "handler-threw",
] as const satisfies readonly (GridFailureCode | GridRestoreFailureCode | GridCommitFailureCode)[];
type UnlistedCode = Exclude<GridFailureCode | GridRestoreFailureCode | GridCommitFailureCode, (typeof FAILURE_CODES)[number]>;
const everyCodeListed: [UnlistedCode] extends [never] ? true : UnlistedCode = true;

/** 诊断码的全集（Spec 输出 139）：新增码不列进来时类型检查不过。 */
const ISSUE_CODES = [
    "over-constrained", "unabsorbed-space", "conflicting-bounds", "no-collapse-policy", "no-room-to-collapse", "no-room-to-restore", "swap-skipped",
    "not-published", "notify-failed",
] as const satisfies readonly (GridIssueCode | GridHostIssueCode)[];
type UnlistedIssueCode = Exclude<GridIssueCode | GridHostIssueCode, (typeof ISSUE_CODES)[number]>;
const everyIssueCodeListed: [UnlistedIssueCode] extends [never] ? true : UnlistedIssueCode = true;
/** 诊断码与失败码不相交：同一个码不会一会儿是“已回滚的失败”、一会儿是“已降级的诊断”。 */
type SharedCode = Extract<GridFailureCode | GridRestoreFailureCode | GridCommitFailureCode, GridIssueCode | GridHostIssueCode>;
const codesDisjoint: [SharedCode] extends [never] ? true : SharedCode = true;

describe("失败码与诊断码的写法（Spec ui/nested-grid 边界与兼容、输出 139）", () => {
    it("同 ui/i18n 的开放错误域：小写短横线，不含冒号、点与空白，不超过 64 个字符", () => {
        expect(everyCodeListed).toBe(true);
        expect(everyIssueCodeListed).toBe(true);
        for (const code of [...FAILURE_CODES, ...ISSUE_CODES]) {
            expect(code).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
            expect(code.length).toBeLessThanOrEqual(64);
        }
    });

    it("诊断码与失败码不相交", () => {
        expect(codesDisjoint).toBe(true);
        expect(FAILURE_CODES.filter((code) => (ISSUE_CODES as readonly string[]).includes(code))).toEqual([]);
    });
});

describe("拆分树原语：失败的码（Spec ui/nested-grid 失败 5、7）", () => {
    const split = (over: Record<string, unknown> = {}) => ({branchId: "pair", orientation: "horizontal", side: "after", leaf: {kind: "leaf", id: "added", ref: "added"}, ...over}) as Parameters<ReturnType<typeof createGrid<string>>["splitLeaf"]>[1];

    it("单节点调整：不在、根节点、错轴、非有限的调整量", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        expect(codeOf(grid.resize("ghost", "width", 10))).toEqual({code: "not-found", params: {id: "ghost"}});
        expect(codeOf(grid.resize("root", "width", 10))).toEqual({code: "invalid-argument", params: {field: "root", id: "root"}});
        expect(codeOf(grid.resize("left", "height", 10))).toEqual({code: "wrong-axis", params: {id: "left", parent: "root", orientation: "horizontal"}});
        expect(codeOf(grid.resize("left", "width", Number.NaN))).toEqual({code: "not-finite", params: {field: "delta", value: "NaN"}});
    });

    it("按分支调整：不在与不是分支分开报，错轴、尺寸没覆盖、尺寸不合法、不守恒、基线失效、目标换不成意图", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const before = grid.serialize();
        const base = {left: 300, right: 699};
        expect(codeOf(grid.resizeBranch("ghost", "width", base, base))).toEqual({code: "not-found", params: {id: "ghost"}});
        expect(codeOf(grid.resizeBranch("left", "width", base, base))).toEqual({code: "wrong-node-kind", params: {id: "left", expected: "branch"}});
        expect(codeOf(grid.resizeBranch("root", "height", base, base))).toEqual({code: "wrong-axis", params: {id: "root", orientation: "horizontal"}});
        expect(codeOf(grid.resizeBranch("root", "width", {left: 300}, {left: 300}))).toEqual({code: "invalid-argument", params: {field: "sizes-cover", id: "root"}});
        expect(codeOf(grid.resizeBranch("root", "width", {left: Number.NaN, right: 699}, base)))
            .toEqual({code: "not-finite", params: {field: "size", side: "baseline", id: "left"}});
        expect(codeOf(grid.resizeBranch("root", "width", base, {left: -1, right: 1000})))
            .toEqual({code: "invalid-argument", params: {field: "size-negative", side: "target", id: "left"}});
        // 同一个子节点两侧都不合法时报基线那一侧。
        expect(codeOf(grid.resizeBranch("root", "width", {left: -1, right: 1000}, {left: Number.NaN, right: 699})))
            .toEqual({code: "invalid-argument", params: {field: "size-negative", side: "baseline", id: "left"}});
        expect(codeOf(grid.resizeBranch("root", "width", base, {left: 400, right: 699}))).toEqual({code: "not-conserved", params: {id: "root", target: 1099, baseline: 999}});
        expect(codeOf(grid.resizeBranch("root", "width", {left: 1, right: 998}, {left: 2, right: 997}))).toEqual({code: "stale-baseline", params: {id: "root"}});
        // left 最大 800：目标 900 呈现不出来，换不成能复现目标的意图。
        expect(codeOf(grid.resizeBranch("root", "width", base, {left: 900, right: 99}))).toEqual({code: "not-finite", params: {field: "intent", id: "root"}});
        expect(grid.serialize()).toEqual(before);
    });

    it("批量调整：不在与不是分支分开报，收起的子节点不在与不可收起分开报", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const base = {left: 300, right: 699};
        expect(codeOf(grid.resizeBranches([{branchId: "ghost", axis: "width", baseline: base, target: base}]))).toEqual({code: "not-found", params: {id: "ghost"}});
        expect(codeOf(grid.resizeBranches([{branchId: "left", axis: "width", baseline: base, target: base}])))
            .toEqual({code: "wrong-node-kind", params: {id: "left", expected: "branch"}});
        expect(codeOf(grid.resizeBranches([{branchId: "root", axis: "width", baseline: base, target: base, collapsed: {ghost: true}}])))
            .toEqual({code: "not-found", params: {id: "ghost"}});
        expect(codeOf(grid.resizeBranches([{branchId: "root", axis: "width", baseline: base, target: base, collapsed: {left: true}}])))
            .toEqual({code: "not-collapsible", params: {id: "left", branch: "root"}});
    });

    it("插入、拆分、移除、移动", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const before = grid.serialize();
        expect(codeOf(grid.addLeaf("left", 0, leaf("x", "width", 10)))).toEqual({code: "wrong-node-kind", params: {id: "left", expected: "branch"}});
        expect(codeOf(grid.addLeaf("root", 0, leaf("top", "width", 10)))).toEqual({code: "duplicate-id", params: {id: "top", with: "existing"}});

        expect(codeOf(grid.splitLeaf("ghost", split()))).toEqual({code: "not-found", params: {id: "ghost"}});
        expect(codeOf(grid.splitLeaf("right", split()))).toEqual({code: "wrong-node-kind", params: {id: "right", expected: "leaf"}});
        expect(codeOf(grid.splitLeaf("left", split({orientation: "diagonal"})))).toEqual({code: "invalid-argument", params: {field: "orientation", value: "diagonal"}});
        expect(codeOf(grid.splitLeaf("left", split({side: "middle"})))).toEqual({code: "invalid-argument", params: {field: "side", value: "middle"}});
        expect(codeOf(grid.splitLeaf("left", split({branchId: "added"})))).toEqual({code: "duplicate-id", params: {id: "added", with: "new-leaf"}});
        expect(codeOf(grid.splitLeaf("left", split({branchId: "top"})))).toEqual({code: "duplicate-id", params: {id: "top", with: "existing"}});
        expect(codeOf(grid.splitLeaf("left", split({ratio: Number.NaN})))).toEqual({code: "not-finite", params: {field: "ratio", value: "NaN"}});
        expect(codeOf(grid.splitLeaf("left", split({ratio: 1})))).toEqual({code: "invalid-argument", params: {field: "ratio-range", value: "1"}});

        expect(codeOf(grid.removeLeaf("ghost"))).toEqual({code: "not-found", params: {id: "ghost"}});

        expect(codeOf(grid.moveLeaf("ghost", "root", 0))).toEqual({code: "not-found", params: {id: "ghost"}});
        expect(codeOf(grid.moveLeaf("right", "root", 0))).toEqual({code: "wrong-node-kind", params: {id: "right", expected: "leaf"}});
        expect(codeOf(grid.moveLeaf("top", "top", 0))).toEqual({code: "into-own-subtree", params: {id: "top", parent: "top"}});
        expect(codeOf(grid.moveLeaf("top", "ghost", 0))).toEqual({code: "not-found", params: {id: "ghost"}});
        expect(codeOf(grid.moveLeaf("top", "left", 0))).toEqual({code: "wrong-node-kind", params: {id: "left", expected: "branch"}});
        expect(grid.serialize()).toEqual(before);
    });

    it("快照恢复：外壳、缺 id、ref 不是字符串、kind 不认识各报 invalid-snapshot；根引用解析不了报 unresolved-root 并带 dropped", () => {
        const grid = createGrid<string>(null);
        const restore = (root: unknown, resolve: (ref: string) => {ref: string} | null = (ref) => ({ref})) => grid.restore({version: GRID_SNAPSHOT_VERSION, root}, resolve);
        expect(codeOf(grid.restore(null, (ref) => ({ref})))).toEqual({code: "invalid-snapshot", params: {field: "envelope"}});
        expect(codeOf(restore("leaf"))).toEqual({code: "invalid-snapshot", params: {field: "node"}});
        expect(codeOf(restore({kind: "leaf", ref: "a", size: {width: 1, height: 1}}))).toEqual({code: "invalid-snapshot", params: {field: "id"}});
        expect(codeOf(restore({kind: "leaf", id: "a", ref: 5, size: {width: 1, height: 1}}))).toEqual({code: "invalid-snapshot", params: {field: "ref", id: "a"}});
        expect(codeOf(restore({kind: "pane", id: "a"}))).toEqual({code: "invalid-snapshot", params: {field: "kind", id: "a"}});

        const unresolved = restore({kind: "leaf", id: "a", ref: "ghost", size: {width: 1, height: 1}}, () => null);
        expect(codeOf(unresolved)).toEqual({code: "unresolved-root", params: undefined});
        expect(unresolved.dropped).toEqual([{ref: "ghost", code: "unknown-ref"}]);
    });
});
