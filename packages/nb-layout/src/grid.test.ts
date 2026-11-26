import {describe, expect, it} from "bun:test";
import {
    GRID_MAX_DEPTH,
    GRID_MAX_NODES,
    GRID_SNAPSHOT_VERSION,
    createGrid,
    restoreGrid,
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

/** 单分支的 `resizeBranches`：取回该轴上的意图（节点 id → 意图），失败原样返回，用例只关心一支。 */
function resizeOne(
    grid: ReturnType<typeof createGrid<string>>,
    branchId: string,
    axis: GridAxis,
    baseline: Readonly<Record<string, number>>,
    target: Readonly<Record<string, number>>,
) {
    const result = grid.resizeBranches([{branchId, axis, baseline, target}]);
    if (!result.ok) return result;
    return {ok: true as const, sizes: Object.fromEntries(Object.entries(result.intents).map(([id, size]) => [id, size[axis]]))};
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

    it("分支在交叉轴上的上限取子节点里最大的（Spec 输出 30）：一列全收成 32px 标题行时它放不满、下面留空，同一行的兄弟叶照样拿到这一行的满高", () => {
        const heading = (id: string): GridLeafInput<string> => ({...leaf(id, "height", 200), collapse: {collapsed: true, collapsedSize: 32, collapseThreshold: 24, expandThreshold: 24}});
        // 外面再套一层竖排：这一行在高度上的上限要是取了最小的子节点，外层只肯给它三个标题行高。
        const grid = createGrid(branch("outer", "width", "vertical", 0, [
            branch("row", "height", "horizontal", 400, [
                branch("column", "width", "vertical", 300, [heading("s1"), heading("s2"), heading("s3")]),
                {...leaf("editor", "width", 699), maximumSize: {width: UNBOUNDED, height: 300}},
            ]),
            leaf("panel", "height", 199),
        ]), {sashSize: SASH});
        const result = grid.layout(CONTAINER);

        expect(result.constraints.column!.maximumSize.height).toBe(3 * 32 + 2 * SASH);
        expect(result.constraints.row!.maximumSize.height).toBe(300);
        expect(extent(result.sizes, "row").height).toBe(300);
        expect(extent(result.sizes, "editor").height).toBe(300);
        expect(extent(result.sizes, "column").height).toBe(3 * 32 + 2 * SASH);
    });

    it("两轴都计入 sash，容器总量守恒", () => {
        const sizes = createGrid(fixture(), {sashSize: SASH}).layout(CONTAINER).sizes;

        expect(extent(sizes, "root").width).toBe(extent(sizes, "left").width + extent(sizes, "right").width + SASH);
        expect(extent(sizes, "right").height).toBe(extent(sizes, "top").height + extent(sizes, "bottom").height + SASH);
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
            collapse: {collapsed: true, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24},
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
            {...leaf("a", "width", 250, 200), collapse: {collapsed: true, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24}},
            leaf("b", "width", 300, 150),
        ]), {sashSize: SASH});
        const keyboard = session(grid, {width: 301, height: 100}, "keyboard", [{branchId: "root", index: 0, axis: "width"}]);
        expect(keyboard.toggleCollapsed()).toBeNull();
        expect(facts(keyboard.issues)).toContainEqual({code: "no-room-to-restore", id: "a", available: 150, required: 200});
    });

    it("先拖再折叠没有变化：前面的位移照常提交", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 200, 50), collapse: {collapsed: false, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24}},
            leaf("b", "width", 200, 100, 230),
        ]), {sashSize: SASH});
        const pointer = session(grid, {width: 401, height: 100}, "pointer", [{branchId: "root", index: 0, axis: "width"}]);
        expect(pointer.update({x: -30, y: 0})).not.toBeNull();
        // b 已到上限 230，吸收不了 a 收起让出的空间：这次折叠不成立，只留一条诊断。
        pointer.toggleCollapsed();
        expect(facts(pointer.issues).map((issue) => issue.code)).toContain("no-room-to-collapse");
        expect(pointer.finish()?.changes[0]?.target).toMatchObject({a: 170, b: 230});
    });

    it("交叉处的会话里折叠只作用于发起它的那根轴：另一根轴没有收起策略也不报 no-collapse-policy", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("left", "width", 300, 100), collapse: {collapsed: false, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24}},
            branch("right", "width", "vertical", 699, [leaf("top", "height", 400, 100), leaf("bottom", "height", 199, 100)]),
        ]), {sashSize: SASH});
        const cross = createGridGestureSession<string>({contextKey: "test", revision: 1, root: grid.root(), extent: CONTAINER, layout: grid.layout(CONTAINER), sashSize: SASH, sessionId: "cross-collapse", source: "pointer", sashes: [{branchId: "root", index: 0, axis: "width"}, {branchId: "right", index: 0, axis: "height"}]});
        const preview = cross.toggleCollapsed();
        expect(preview?.changes.find((change) => change.branchId === "root")?.collapsed).toEqual({left: true});
        expect(facts(cross.issues).filter((issue) => issue.code === "no-collapse-policy")).toEqual([]);
    });

    it("折叠没有变化、拖动求解又报了同一条：会话的快照里同一个键只有一条", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 250, 200), collapse: {collapsed: true, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24}},
            leaf("b", "width", 300, 150),
        ]), {sashSize: SASH});
        const pointer = session(grid, {width: 301, height: 100}, "pointer", [{branchId: "root", index: 0, axis: "width"}]);
        // 拖过展开阈值（下限 200），能给的只有 150：拖动求解报 no-room-to-restore；折叠也报同一条。
        pointer.update({x: 250, y: 0});
        expect(facts(pointer.issues).filter((issue) => issue.code === "no-room-to-restore")).toHaveLength(1);
        pointer.toggleCollapsed();
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

describe("拆分树原语：单分支调整边界", () => {
    it("混合零权重在正权重全部触顶后吸收剩余空间，全零权重均分", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 100, 0, 20), leaf("b", "width", 0, 0, 100), leaf("c", "width", 0, 0, 10),
        ]));
        expect(grid.layout({width: 100, height: 20}).sizes).toMatchObject({a: {width: 20}, b: {width: 70}, c: {width: 10}});
        const zero = createGrid(branch("root", "height", "vertical", 0, [leaf("a", "height", 0), leaf("b", "height", 0)]));
        expect(zero.layout({width: 20, height: 100}).sizes).toMatchObject({a: {height: 50}, b: {height: 50}});
        expect(resizeOne(zero, "root", "height", {a: 50, b: 50}, {a: 60, b: 40}).ok).toBe(true);
        expect(zero.layout({width: 20, height: 100}).sizes).toMatchObject({a: {height: 60}, b: {height: 40}});
    });

    it("下限触界的原意图不被 no-op 或另一侧手势夹取", () => {
        const grid = createGrid(branch("root", "height", "vertical", 0, [
            leaf("a", "height", 20, 100, 1000), leaf("b", "height", 100, 0, 1000), leaf("c", "height", 100, 0, 1000),
        ]));
        const saved = grid.serialize();
        const baseline = {a: 100, b: 50, c: 50};
        expect(resizeOne(grid, "root", "height", baseline, baseline).ok).toBe(true);
        expect(grid.serialize()).toEqual(saved);
        expect(resizeOne(grid, "root", "height", baseline, {a: 100, b: 60, c: 40})).toEqual({ok: true, sizes: {a: 20, b: 120, c: 80}});
        expect(grid.layout({width: 20, height: 200}).sizes).toMatchObject({a: {height: 100}, b: {height: 60}, c: {height: 40}});
    });

    it("原子手势拒绝过期基线与越界目标，失败不改快照", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 100, 100), leaf("b", "width", 100)]));
        const saved = grid.serialize();
        expect(resizeOne(grid, "root", "width", {a: 120, b: 80}, {a: 130, b: 70}).ok).toBe(false);
        expect(resizeOne(grid, "root", "width", {a: 100, b: 100}, {a: 90, b: 110}).ok).toBe(false);
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
        expect(resizeOne(grid, "root", "width", {a: 100, b: 250, c: 250}, {a: 100, b: 270, c: 230})).toEqual({ok: true, sizes: {a: 100, b: 108, c: 92}});
        const sizes = grid.layout({width: 600, height: 20}).sizes;
        expect(extent(sizes, "b").width).toBeCloseTo(270);
        expect(extent(sizes, "c").width).toBeCloseTo(230);
    });

    it("触界且意图在当前约束外时 no-op 不改快照", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 200, 0, 100), leaf("b", "width", 100)]));
        const before = grid.serialize();
        expect(resizeOne(grid, "root", "width", {a: 100, b: 500}, {a: 100, b: 500}).ok).toBe(true);
        expect(grid.serialize()).toEqual(before);
    });

});

    it("viewport 缩放后三兄弟手势按当前呈现一次换回完整意图", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 200, 0, 1000),
            leaf("b", "width", 300, 0, 1000),
            leaf("c", "width", 500, 0, 1000),
        ]));
        const result = resizeOne(grid, "root", "width", {a: 100, b: 150, c: 250}, {a: 120, b: 130, c: 250});

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

        expect(resizeOne(grid, "root", "height", {left: 300, right: 699}, {left: 250, right: 749}).ok).toBe(false);
        expect(resizeOne(grid, "root", "width", {left: 300}, {left: 250}).ok).toBe(false);
        expect(resizeOne(grid, "root", "width", {left: 300, right: 699}, {left: Number.NaN, right: 699}).ok).toBe(false);
        expect(resizeOne(grid, "root", "width", {left: 300, right: 699}, {left: 250, right: 700}).ok).toBe(false);
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

    it("根只剩一块保留像素或可收起的节点时不展平：根分支留着，保留像素的照旧呈现，余下留白（Spec 输出 163）", () => {
        const pinned = createGrid(branch("root", "width", "horizontal", 0, [{...leaf("explorer", "width", 240), sizing: "fixed"}, leaf("group", "width", 1)]));
        expect(pinned.removeLeaf("group").ok).toBe(true);
        expect(pinned.root()?.kind).toBe("branch");
        expect(pinned.find("root")).not.toBeNull();
        const layout = pinned.layout({width: 1200, height: 600});
        expect(extent(layout.sizes, "explorer").width).toBe(240);
        expect(facts(layout.issues)).toContainEqual(expect.objectContaining({code: "unabsorbed-space", id: "root", axis: "width"}));

        const folding = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("side", "width", 300), collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: false}},
            leaf("group", "width", 700),
        ]));
        expect(folding.removeLeaf("group").ok).toBe(true);
        expect(folding.find("root")?.kind).toBe("branch");
        expect(folding.setCollapsed("side", true)).toMatchObject({ok: true, changed: true});
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

describe("拆分树原语：结构操作不改兄弟的意图（Spec ui/nested-grid 输出 153）", () => {
    const ROW: GridExtent = {width: 1200, height: 400};
    const fixed = {sizing: "fixed" as const};
    const folded = () => ({collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: true}});
    const bare = (id: string): GridLeafInput<string> => ({kind: "leaf", id, ref: id});
    type TestGrid = ReturnType<typeof createGrid<string>>;
    const widthsOf = (grid: TestGrid, ids: readonly string[], container: GridExtent = ROW): number[] =>
        ids.map((id) => Math.round(extent(grid.layout(container).sizes, id).width * 100) / 100);
    const intents = (grid: TestGrid, ids: readonly string[], axis: GridAxis = "width"): number[] => ids.map((id) => grid.find(id)?.size[axis] ?? Number.NaN);

    it("插进、拿走一块：保留像素的兄弟意图与呈现都不变，按比例分的兄弟意图不变、份额重分", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("nav", "width", 188, 150, 300), ...fixed},
            leaf("main", "width", 600, 100),
        ]));
        expect(grid.addLeaf("root", 2, bare("x")).ok).toBe(true);
        expect(intents(grid, ["nav", "main", "x"])).toEqual([188, 600, 600]);
        expect(widthsOf(grid, ["nav", "main", "x"])).toEqual([188, 506, 506]);

        expect(grid.addLeaf("root", 3, {...leaf("drawer", "width", 320), ...fixed}).ok).toBe(true);
        expect(intents(grid, ["nav", "main", "x", "drawer"])).toEqual([188, 600, 600, 320]);
        expect(widthsOf(grid, ["nav", "main", "x", "drawer"])).toEqual([188, 346, 346, 320]);

        expect(grid.removeLeaf("x").ok).toBe(true);
        expect(intents(grid, ["nav", "main", "drawer"])).toEqual([188, 600, 320]);
        expect(widthsOf(grid, ["nav", "main", "drawer"])).toEqual([188, 692, 320]);
    });

    it("按比例分的新叶不给意图：取平均一份；兄弟全 0 时取 0 一起均分；兄弟全收起时取它们的平均，展开后不被压扁；只有保留像素的兄弟时取 1", () => {
        const pair = createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 1), leaf("b", "width", 1)]));
        expect(pair.addLeaf("root", 2, bare("c")).ok).toBe(true);
        expect(widthsOf(pair, ["a", "b", "c"])).toEqual([400, 400, 400]);

        const zeros = createGrid(branch("root", "width", "horizontal", 0, [leaf("p", "width", 0), leaf("q", "width", 0), leaf("r", "width", 0)]));
        expect(zeros.addLeaf("root", 3, bare("s")).ok).toBe(true);
        expect(intents(zeros, ["s"])).toEqual([0]);
        expect(widthsOf(zeros, ["p", "q", "r", "s"])).toEqual([300, 300, 300, 300]);

        const folding = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("nav", "width", 188), ...fixed},
            {...leaf("a", "width", 400), ...folded()},
            {...leaf("b", "width", 400), ...folded()},
        ]));
        expect(folding.addLeaf("root", 3, bare("x")).ok).toBe(true);
        expect(intents(folding, ["a", "b", "x"])).toEqual([400, 400, 400]);
        expect(widthsOf(folding, ["nav", "a", "b", "x"])).toEqual([188, 0, 0, 1012]);
        folding.setCollapsed("a", false);
        folding.setCollapsed("b", false);
        expect(widthsOf(folding, ["nav", "a", "b", "x"])).toEqual([188, 337.33, 337.33, 337.33]);

        const rails = createGrid(branch("root", "width", "horizontal", 0, [{...leaf("nav", "width", 188), ...fixed}, {...leaf("drawer", "width", 320), ...fixed}]));
        expect(rails.addLeaf("root", 1, bare("x")).ok).toBe(true);
        expect(intents(rails, ["x"])).toEqual([1]);
        expect(widthsOf(rails, ["nav", "x", "drawer"])).toEqual([188, 692, 320]);
    });

    it("给了意图就照用，单位同兄弟：兄弟 600、新叶 400，新叶拿 40%", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [{...leaf("nav", "width", 188), ...fixed}, leaf("editor", "width", 600)]));
        expect(grid.addLeaf("root", 2, leaf("x", "width", 400)).ok).toBe(true);
        expect(widthsOf(grid, ["nav", "editor", "x"])).toEqual([188, 607.2, 404.8]);
    });

    it("收起中的兄弟：增删前后意图不变，展开回到原来的份额", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 600), {...leaf("side", "width", 300), ...folded()}, leaf("b", "width", 600)]));
        expect(grid.addLeaf("root", 3, bare("x")).ok).toBe(true);
        expect(grid.removeLeaf("b").ok).toBe(true);
        expect(intents(grid, ["a", "side", "x"])).toEqual([600, 300, 500]);
        grid.setCollapsed("side", false);
        expect(widthsOf(grid, ["a", "side", "x"])).toEqual([514.29, 257.14, 428.57]);
    });

    it("moveLeaf：按比例分的节点跨分支重取目标分支的平均；保留像素的节点同向跨分支意图不变；两边的兄弟意图都不变", () => {
        const weighted = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 600),
            leaf("b", "width", 600),
            branch("col", "width", "vertical", 400, [leaf("t", "height", 1), leaf("u", "height", 1)]),
        ]));
        expect(weighted.moveLeaf("a", "col", 2).ok).toBe(true);
        expect(intents(weighted, ["b", "col"])).toEqual([600, 400]);
        expect(intents(weighted, ["t", "u", "a"], "height")).toEqual([1, 1, 1]);
        const placed = weighted.layout({width: 1600, height: 600}).sizes;
        expect(["b", "col"].map((id) => extent(placed, id).width)).toEqual([960, 640]);
        expect(["t", "u", "a"].map((id) => extent(placed, id).height)).toEqual([200, 200, 200]);

        // 目标分支同向时也重取：来源的 600 在目标分支里是另一套单位。
        const sameAxis = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 600),
            leaf("b", "width", 600),
            branch("grp", "width", "horizontal", 400, [leaf("c", "width", 300), leaf("d", "width", 100)]),
        ]));
        expect(sameAxis.moveLeaf("a", "grp", 0).ok).toBe(true);
        expect(intents(sameAxis, ["a", "c", "d"])).toEqual([200, 300, 100]);

        const rows = createGrid(branch("root", "height", "vertical", 0, [
            branch("top", "height", "horizontal", 300, [{...leaf("nav", "width", 188), ...fixed}, leaf("main", "width", 600), leaf("side", "width", 300)]),
            branch("bottom", "height", "horizontal", 300, [leaf("x", "width", 1), leaf("y", "width", 1)]),
        ]));
        expect(rows.moveLeaf("nav", "bottom", 0).ok).toBe(true);
        expect(intents(rows, ["nav", "main", "side", "x", "y"])).toEqual([188, 600, 300, 1, 1]);
        expect(widthsOf(rows, ["main", "side", "nav", "x", "y"], {width: 1200, height: 600})).toEqual([800, 400, 188, 506, 506]);
    });

    it("moveLeaf：保留像素的节点移到方向不同的分支失败、树不变；父节点不存在时报 not-found", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("nav", "width", 188), ...fixed},
            leaf("main", "width", 600),
            branch("col", "width", "vertical", 400, [leaf("t", "height", 1), leaf("u", "height", 1)]),
        ]));
        const before = grid.serialize();
        expect(codeOf(grid.moveLeaf("nav", "ghost", 0))).toEqual({code: "not-found", params: {id: "ghost"}});
        expect(codeOf(grid.moveLeaf("nav", "col", 0))).toEqual({code: "invalid-argument", params: {field: "fixed-cross-axis", id: "nav"}});
        expect(grid.serialize()).toEqual(before);
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

    it("新建分支时 side=before 把新叶放在前，两半按 ratio 分掉目标原本的分配", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("left", "width", 300), {...leaf("editor", "width", 700), size: {width: 700, height: 400}},
        ]), {sashSize: SASH});

        expect(grid.splitLeaf("editor", {branchId: "pair", orientation: "vertical", side: "before", ratio: 0.25, leaf: {kind: "leaf", id: "added", ref: "added"}}).ok).toBe(true);
        const pair = grid.find("pair");
        expect(pair?.kind === "branch" ? pair.children.map((child) => child.id) : []).toEqual(["added", "editor"]);
        // 目标在新轴上的 400 按 ratio 分成 100 与 300；pair 继承目标在外层的 700。
        expect([grid.find("added")?.size.height, grid.find("editor")?.size.height, pair?.size.width]).toEqual([100, 300, 700]);
        const sizes = grid.layout({width: 1001, height: 401}).sizes;

        expect(extent(sizes, "left").width).toBe(300);
        expect(extent(sizes, "added").height).toBe(100);
        expect(extent(sizes, "editor").height).toBe(300);
        expect(extent(sizes, "editor").width).toBe(700);
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
        expect(grid.splitLeaf("editor", {branchId: "pair", orientation: "vertical", side: "after", leaf: {kind: "leaf", id: "added", ref: "added"}}).ok).toBe(true);

        const restored = createGrid<string>(null, {sashSize: SASH});
        expect(restored.restore(grid.serialize(), (ref) => ({ref})).ok).toBe(true);
        expect(extent(restored.layout({width: 1001, height: 601}).sizes, "added").height).toBe(300);
        expect(resizeOne(restored, "pair", "height", {editor: 300, added: 300}, {editor: 250, added: 350}).ok).toBe(true);
        expect(extent(restored.layout({width: 1001, height: 601}).sizes, "added").height).toBeCloseTo(350);
        expect(extent(restored.layout({width: 1001, height: 601}).sizes, "left").width).toBe(300);
    });

    it("节点数与深度上限在结构操作阶段就拒绝", () => {
        const nodesLimit = {ok: false, code: "limit-exceeded", params: {limit: "nodes", max: GRID_MAX_NODES}};
        const added = (id: string) => ({kind: "leaf", id, ref: id}) as const;
        // 255 个节点：新建分支加 2 个（257）被拒，并入加 1 个（256）成功，之后插入与并入都被拒。
        const many = createGrid(branch("root", "width", "horizontal", 0, Array.from({length: GRID_MAX_NODES - 2}, (_, index) => leaf(`n${index}`, "width", 1))));
        expect(many.splitLeaf("n0", {branchId: "pair", orientation: "vertical", side: "after", leaf: added("added")})).toMatchObject(nodesLimit);
        expect(many.splitLeaf("n0", {branchId: "pair", orientation: "horizontal", side: "after", leaf: added("added")}).ok).toBe(true);
        expect(many.addLeaf("root", 0, leaf("extra", "width", 1))).toMatchObject(nodesLimit);
        expect(many.splitLeaf("n1", {branchId: "pair-2", orientation: "horizontal", side: "after", leaf: added("added-2")})).toMatchObject(nodesLimit);

        // 第 16 层的叶：竖着拆要新建分支、新叶落到第 17 层，被拒；横着拆并进第 15 层的横向分支，层数不变，成功。
        let deep: GridNodeInput<string> = leaf("deep-end", "width", 1);
        for (let index = GRID_MAX_DEPTH - 1; index >= 1; index -= 1) {
            deep = branch(`d${index}`, "width", "horizontal", 0, [deep]);
        }
        const nested = createGrid(deep);
        expect(nested.splitLeaf("deep-end", {branchId: "pair", orientation: "vertical", side: "after", leaf: added("added")}))
            .toMatchObject({ok: false, code: "limit-exceeded", params: {limit: "depth", max: GRID_MAX_DEPTH}});
        expect(nested.splitLeaf("deep-end", {branchId: "pair", orientation: "horizontal", side: "after", leaf: added("added")}).ok).toBe(true);

        // 移动同样受深度限制：把叶移进第 16 层的空分支会得到 17 层，树不变。
        let chain: GridNodeInput<string> = branch(`c${GRID_MAX_DEPTH}`, "width", "horizontal", 0, []);
        for (let index = GRID_MAX_DEPTH - 1; index >= 1; index -= 1) {
            chain = branch(`c${index}`, "width", "horizontal", 0, index === 1 ? [leaf("mover", "width", 1), chain] : [chain]);
        }
        const moving = createGrid(chain);
        const before = moving.serialize();
        expect(codeOf(moving.moveLeaf("mover", `c${GRID_MAX_DEPTH}`, 0))).toEqual({code: "limit-exceeded", params: {limit: "depth", max: GRID_MAX_DEPTH}});
        expect(moving.serialize()).toEqual(before);
        expect(moving.moveLeaf("mover", `c${GRID_MAX_DEPTH - 1}`, 0).ok).toBe(true);
    });

    it("经 createGrid 建的树已经超深：浅处的插入与移动照常成功，深处的拆分照旧被拒", () => {
        // e1 到 e16 一层套一层，底下的叶在第 17 层；e1 里另有一块浅的叶。createGrid 不查规模。
        let chain: GridNodeInput<string> = leaf("bottom", "width", 1);
        for (let index = GRID_MAX_DEPTH; index >= 2; index -= 1) {
            chain = branch(`e${index}`, "width", "horizontal", 0, [chain]);
        }
        const grid = createGrid(branch("e1", "width", "horizontal", 0, [leaf("shallow", "width", 1), chain]));
        const depthLimit = {ok: false, code: "limit-exceeded", params: {limit: "depth", max: GRID_MAX_DEPTH}};

        expect(grid.addLeaf("e1", 0, leaf("x", "width", 1)).ok).toBe(true);
        expect(grid.moveLeaf("x", "e2", 0).ok).toBe(true);
        const before = grid.serialize();
        expect(grid.splitLeaf("bottom", {branchId: "pair", orientation: "vertical", side: "after", leaf: {kind: "leaf", id: "added", ref: "added"}})).toMatchObject(depthLimit);
        expect(grid.splitLeaf("bottom", {branchId: "pair", orientation: "horizontal", side: "after", leaf: {kind: "leaf", id: "added", ref: "added"}})).toMatchObject(depthLimit);
        expect(grid.serialize()).toEqual(before);
    });
});

describe("拆分树原语：拆分叶的同向并入（Spec ui/nested-grid 输出 160、161、162）", () => {
    const added = {kind: "leaf", id: "added", ref: "added"} as const;
    const childIds = (grid: ReturnType<typeof createGrid<string>>, id = "root") => {
        const node = grid.find(id);
        return node?.kind === "branch" ? node.children.map((child) => child.id) : [];
    };

    it("横排里横着拆：新叶并进这一排、挨着目标，不新建分支；按 ratio 分掉目标的意图，兄弟不变", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [leaf("left", "width", 300), leaf("editor", "width", 700)]), {sashSize: SASH});

        expect(grid.splitLeaf("editor", {branchId: "pair", orientation: "horizontal", side: "before", ratio: 0.25, leaf: added})).toEqual({ok: true});
        expect(childIds(grid)).toEqual(["left", "added", "editor"]);
        expect(grid.find("pair")).toBeNull();
        expect(["left", "added", "editor"].map((id) => grid.find(id)?.size.width)).toEqual([300, 175, 525]);
        const sizes = grid.layout({width: 1002, height: 600}).sizes;
        expect(["left", "added", "editor"].map((id) => extent(sizes, id).width)).toEqual([300, 175, 525]);

        expect(grid.splitLeaf("left", {branchId: "pair-2", orientation: "horizontal", side: "after", leaf: {kind: "leaf", id: "next", ref: "next"}}).ok).toBe(true);
        expect(childIds(grid)).toEqual(["left", "next", "added", "editor"]);
    });

    it("并入不加深：同向连拆 20 次都成功，树一直只有根这一层分支", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 1), leaf("b", "width", 1)]));
        for (let index = 0; index < 20; index += 1) {
            const target = index === 0 ? "b" : `n${index - 1}`;
            expect(grid.splitLeaf(target, {branchId: `s${index}`, orientation: "horizontal", side: "after", leaf: {kind: "leaf", id: `n${index}`, ref: `n${index}`}})).toEqual({ok: true});
        }
        const root = grid.root();
        expect(root?.kind === "branch" ? root.children.every((child) => child.kind === "leaf") : false).toBe(true);
        expect(childIds(grid)).toHaveLength(22);
    });

    it("并入时 branchId 照样查重：与已有节点同 id 报 duplicate-id，树不变", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [leaf("left", "width", 300), leaf("editor", "width", 700)]));
        const before = grid.serialize();
        expect(codeOf(grid.splitLeaf("editor", {branchId: "left", orientation: "horizontal", side: "after", leaf: added}))).toEqual({code: "duplicate-id", params: {id: "left", with: "existing"}});
        expect(grid.serialize()).toEqual(before);
    });

    it("底数：这一支全是 0 时两块都取 0、和兄弟一起均分；目标为 0 而兄弟为正时按平均一份拆", () => {
        const zeros = createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 0), leaf("b", "width", 0)]), {sashSize: SASH});
        expect(zeros.splitLeaf("b", {branchId: "pair", orientation: "horizontal", side: "after", ratio: 0.25, leaf: added}).ok).toBe(true);
        expect(["a", "b", "added"].map((id) => zeros.find(id)?.size.width)).toEqual([0, 0, 0]);
        const even = zeros.layout({width: 1202, height: 600}).sizes;
        expect(["a", "b", "added"].map((id) => extent(even, id).width)).toEqual([400, 400, 400]);

        const empty = createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 300), leaf("c", "width", 300), leaf("t", "width", 0)]), {sashSize: SASH});
        expect(empty.splitLeaf("t", {branchId: "pair", orientation: "horizontal", side: "after", leaf: added}).ok).toBe(true);
        expect(["a", "c", "t", "added"].map((id) => empty.find(id)?.size.width)).toEqual([300, 300, 150, 150]);
        const shared = empty.layout({width: 903, height: 600}).sizes;
        expect(["a", "c", "t", "added"].map((id) => extent(shared, id).width)).toEqual([300, 300, 150, 150]);
    });

    it("`ratio: \"even\"`：并入时新叶取这一支的平均一份、目标意图不变；新建分支时等于 0.5", () => {
        const row = createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 1), leaf("b", "width", 1)]), {sashSize: SASH});
        expect(row.splitLeaf("b", {branchId: "pair", orientation: "horizontal", side: "after", ratio: "even", leaf: added}).ok).toBe(true);
        expect(["a", "b", "added"].map((id) => row.find(id)?.size.width)).toEqual([1, 1, 1]);
        const thirds = row.layout({width: 1202, height: 600}).sizes;
        expect(["a", "b", "added"].map((id) => extent(thirds, id).width)).toEqual([400, 400, 400]);

        const nest = (ratio: number | "even") => {
            const grid = createGrid(branch("root", "width", "horizontal", 0, [leaf("left", "width", 300), leaf("editor", "width", 700)]), {sashSize: SASH});
            expect(grid.splitLeaf("editor", {branchId: "stack", orientation: "vertical", side: "after", ratio, leaf: added}).ok).toBe(true);
            return grid;
        };
        const halves = nest("even");
        expect(halves.serialize()).toEqual(nest(0.5).serialize());
        const sizes = halves.layout({width: 1001, height: 601}).sizes;
        expect([extent(sizes, "editor").height, extent(sizes, "added").height]).toEqual([300, 300]);
    });

    it("保留像素的目标：同向与异向都报 wrong-sizing（expected: weight），树不变", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [{...leaf("nav", "width", 188), sizing: "fixed"}, leaf("main", "width", 600)]));
        const before = grid.serialize();
        for (const orientation of ["horizontal", "vertical"] as const) {
            expect(codeOf(grid.splitLeaf("nav", {branchId: "pair", orientation, side: "after", leaf: added}))).toEqual({code: "wrong-sizing", params: {id: "nav", expected: "weight"}});
        }
        expect(grid.serialize()).toEqual(before);
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

    it("深度超过上限整体拒绝：根算第 1 层，16 层能恢复，17、18 层被拒", () => {
        /** `levels` 层的快照：一串单孩子的分支，最底下一块叶，叶也算一层。 */
        const snapshotOf = (levels: number) => {
            let nested: GridNodeInput<string> = leaf("deep", "width", 50, 10, 100);
            for (let depth = 1; depth < levels; depth += 1) {
                nested = branch(`level-${depth}`, "width", "vertical", 0, [nested]);
            }
            return {version: GRID_SNAPSHOT_VERSION, root: JSON.parse(JSON.stringify(nested))};
        };
        const depthLimit = {ok: false, code: "limit-exceeded", params: {limit: "depth", max: GRID_MAX_DEPTH}};

        expect(createGrid<string>(null).restore(snapshotOf(GRID_MAX_DEPTH), resolvable).ok).toBe(true);
        expect(createGrid<string>(null).restore(snapshotOf(GRID_MAX_DEPTH + 1), resolvable)).toMatchObject(depthLimit);
        expect(createGrid<string>(null).restore(snapshotOf(GRID_MAX_DEPTH + 2), resolvable)).toMatchObject(depthLimit);
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
        expect(grid.resizeBranches([{branchId: "root", axis: "width", baseline: {left: 300, right: 699}, target: {left: 250, right: 749}}]).ok).toBe(true);
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
                collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: false},
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

    it("同一次提交里收起保留像素的面板并拖另一个：收起不改它的意图、被拖的两块按目标呈现、意图守恒（输出 166）", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100), sizing: "fixed", collapse: {collapsed: false, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24}},
            leaf("b", "width", 400, 100),
            leaf("c", "width", 300, 100),
        ]), {sashSize: SASH});
        const wide: GridExtent = {width: 1000, height: 400};
        const before = grid.layout(wide).sizes;
        const baseline = {a: extent(before, "a").width, b: extent(before, "b").width, c: extent(before, "c").width};
        expect(baseline.a).toBe(300);

        // a 让出 300：b 多得 250、c 多得 50，目标合计与基线相同。
        const target = {a: 0, b: baseline.b + 250, c: baseline.c + 50};
        const result = grid.resizeBranches([{branchId: "root", axis: "width", baseline, target, collapsed: {a: true}}]);

        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.message);
        expect(result.collapsed).toEqual({a: true});
        // 保留像素的面板：意图仍是 300，不被 0 覆盖；展开回到它。
        expect(extent(result.intents, "a").width).toBe(300);
        expect(grid.find("a")?.collapse?.collapsed).toBe(true);
        const after = grid.layout(wide);
        expect(after.issues).toEqual([]);
        expect(extent(after.sizes, "a").width).toBe(0);
        expect(extent(after.sizes, "b").width).toBeCloseTo(target.b, 4);
        expect(extent(after.sizes, "c").width).toBeCloseTo(target.c, 4);
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
    const POLICY = {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24};
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

    it("手势会话对“子节点是分支”的边界：指针拖过阈值收起、从零跟着指针拉回，Enter 收起与展开回到意图；提交里收起的是这个分支", () => {
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

        // 展开回到这一列的意图 300（输出 166）。
        const enterOut = open(true, "keyboard");
        expect(widthsIn(enterOut, enterOut.toggleCollapsed())[0]).toBe(300);
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

/** 分隔条上的 Enter 翻标记后按意图重排：三块按比例分的兄弟按份额吸收与让出，和 `setCollapsed` 相同（Spec 输出 20、166、167）。 */
describe("拆分树原语：手势会话里按比例分的叶的显式收起与展开", () => {
    const WIDE: GridExtent = {width: 1208, height: 400};
    const row = (collapsed: boolean): GridBranchInput<string> => branch("root", "width", "horizontal", 0, [
        leaf("a", "width", 300, 80),
        leaf("b", "width", 300, 80),
        {...leaf("c", "width", 300, 120), collapse: {collapsed, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24}},
    ]);
    const intents = (grid: ReturnType<typeof createGrid<string>>): number[] => ["a", "b", "c"].map((id) => grid.find(id)?.size.width ?? Number.NaN);
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

    it("收起时 a、b 按份额吸收（不只是隔着分隔条的 b），展开回到份额；连按几轮不漂，意图逐值不变（输出 20、166、167）", () => {
        const grid = createGrid(row(false), {sashSize: 4});
        expect(["a", "b", "c"].map((id) => extent(grid.layout(WIDE).sizes, id).width)).toEqual([400, 400, 400]);
        for (let round = 0; round < 3; round += 1) {
            expect(enter(grid)).toEqual([600, 600, 0]);
            expect(intents(grid)).toEqual([300, 300, 300]);
            expect(enter(grid)).toEqual([400, 400, 400]);
            expect(intents(grid)).toEqual([300, 300, 300]);
        }
        // 与 `setCollapsed` 翻同一个标记的布局相同。
        const byEntry = createGrid(row(false), {sashSize: 4});
        byEntry.setCollapsed("c", true);
        expect(["a", "b", "c"].map((id) => Math.round(extent(byEntry.layout(WIDE).sizes, id).width))).toEqual([600, 600, 0]);
    });

    it("从收起状态建树：Enter 展开回到意图的份额（输出 166）", () => {
        const grid = createGrid(row(true), {sashSize: 4});
        expect(enter(grid)).toEqual([400, 400, 400]);
    });
});

/** 收起与展开的入口，展开回到意图（Spec 输出 147、166、167）。容器取意图之和加分隔条，呈现与意图一一对应。 */
describe("拆分树原语：收起与展开的入口", () => {
    const POLICY = {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24};
    const collapsible = (collapsed = false) => ({collapse: {...POLICY, collapsed}});
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
            {...leaf("a", "width", 200, 100), ...fixed, ...collapsible(collapsed)},
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
            {...leaf("a", "width", 500, 100), ...collapsible()},
            {...leaf("b", "width", 500, 100), ...collapsible()},
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
            {...leaf("a", "width", 300, 100, 300), ...collapsible()},
            {...leaf("b", "width", 200, 100, 200), ...fixed},
        ]), {sashSize: 4});
        expect(capped.setCollapsed("a", true)).toMatchObject({ok: true, changed: true});
        expect(widths(capped, {width: 504, height: 400}, ["a", "b"])).toEqual([0, 200]);
    });

    it("按比例分的面板：拖到 600 再经 Enter 收起，经 `setCollapsed` 与经 Enter 展开都回到 600（输出 20、166）", () => {
        const ROW: GridExtent = {width: 1004, height: 400};
        const draggedThenCollapsed = (): ReturnType<typeof createGrid<string>> => {
            const grid = createGrid(branch("root", "width", "horizontal", 0, [
                {...leaf("a", "width", 500, 100), ...collapsible()},
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
        expect(widths(byEntry, ROW, ["a", "b"])).toEqual([600, 400]);

        const byEnter = draggedThenCollapsed();
        const enter = session(byEnter, ROW, 0, "keyboard");
        enter.toggleCollapsed();
        commit(byEnter, enter);
        expect(widths(byEnter, ROW, ["a", "b"])).toEqual([600, 400]);
    });

    it("保留像素的面板：旧的输入里还带着与意图不一致的 `restoreSize` 时不报错、不进节点，`setCollapsed(false)` 与 Enter 都回到意图，Enter 落账不改意图（输出 166）", () => {
        // 意图 400、旧字段写 333、建树就收着：只有意图这一个来源。旧字段经变量传入，模拟没有类型检查的宿主。
        const legacy = {...POLICY, restoreSize: 333, restoreToShare: true, collapsed: true};
        const tree = (): GridBranchInput<string> => branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 600),
            {...leaf("c", "width", 400, 100), ...fixed, collapse: legacy},
        ]);
        const ROW: GridExtent = {width: 1004, height: 400};
        const byEntry = createGrid(tree(), {sashSize: 4});
        expect(byEntry.find("c")?.collapse).toEqual({...POLICY, collapsed: true});
        byEntry.setCollapsed("c", false);
        expect(widths(byEntry, ROW, ["a", "c"])).toEqual([600, 400]);

        const byEnter = createGrid(tree(), {sashSize: 4});
        const enter = session(byEnter, ROW, 0, "keyboard");
        expect(enter.toggleCollapsed()?.changes[0]?.target).toMatchObject({a: 600, c: 400});
        commit(byEnter, enter);
        expect(widths(byEnter, ROW, ["a", "c"])).toEqual([600, 400]);
        expect(byEnter.find("c")?.size.width).toBe(400);
    });

    it("收起不改意图：保留像素的经 Enter 收起意图不变；按比例分的拖到零，兄弟的意图也不变，展开回到收起前的份额（输出 166、167）", () => {
        const ROW: GridExtent = {width: 1004, height: 400};
        const pinned = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100), ...fixed, ...collapsible()},
            leaf("b", "width", 700, 100),
        ]), {sashSize: 4});
        const enter = session(pinned, ROW, 0, "keyboard");
        enter.toggleCollapsed();
        commit(pinned, enter);
        expect(pinned.find("a")?.size.width).toBe(300);
        expect(pinned.find("a")?.collapse).toEqual({...POLICY, collapsed: true});

        // 两块按比例分各 500，拖到把 b 收起：a 呈现 1000，意图仍是 500（目标就是翻标记后按意图分配的结果）。
        const dragged = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 500, 100),
            {...leaf("b", "width", 500, 100), ...collapsible()},
        ]), {sashSize: 4});
        const drag = session(dragged, ROW, 0, "pointer");
        drag.update({x: 600, y: 0});
        commit(dragged, drag);
        expect(widths(dragged, ROW, ["a", "b"])).toEqual([1000, 0]);
        expect(["a", "b"].map((id) => dragged.find(id)?.size.width)).toEqual([500, 500]);
        dragged.setCollapsed("b", false);
        expect(widths(dragged, ROW, ["a", "b"])).toEqual([500, 500]);

        // 收起策略不写快照：恢复时解析结果不给 `collapse`，沿用当前树的收起状态。
        const restored = pinned.restore(pinned.serialize(), (ref) => ({ref}));
        expect(restored.ok).toBe(true);
        expect(pinned.find("a")?.collapse?.collapsed).toBe(true);
        expect(pinned.find("a")?.size.width).toBe(300);
    });

    it("拖动收起后反解了兄弟的意图：展开着的按比例分的兄弟按同一倍数缩回原来的和，呈现不变，收起的那块展开拿回收起前的份额（输出 167）", () => {
        // 三块意图各 300、呈现各 400，拖 b｜c 把 c 收起：反解给 a、b 的是 300、600，缩回和 600 是 200、400。
        const WIDE: GridExtent = {width: 1208, height: 400};
        const build = (): ReturnType<typeof createGrid<string>> => createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 300, 80),
            leaf("b", "width", 300, 80),
            {...leaf("c", "width", 300, 120), ...collapsible()},
        ]), {sashSize: 4});
        const dragCollapse = (grid: ReturnType<typeof createGrid<string>>): void => {
            const drag = session(grid, WIDE, 1, "pointer");
            drag.update({x: 500, y: 0});
            commit(grid, drag);
        };
        const byEntry = build();
        dragCollapse(byEntry);
        expect(widths(byEntry, WIDE, ["a", "b", "c"])).toEqual([400, 800, 0]);
        expect(["a", "b", "c"].map((id) => byEntry.find(id)?.size.width)).toEqual([200, 400, 300]);
        byEntry.setCollapsed("c", false);
        expect(widths(byEntry, WIDE, ["a", "b", "c"])).toEqual([266.67, 533.33, 400]);

        const byEnter = build();
        dragCollapse(byEnter);
        const enter = session(byEnter, WIDE, 1, "keyboard");
        enter.toggleCollapsed();
        commit(byEnter, enter);
        expect(widths(byEnter, WIDE, ["a", "b", "c"])).toEqual([266.67, 533.33, 400]);
    });

    it("窄窗口里 Enter 收起与展开：落账只翻标记，被压缩的保留像素兄弟的意图逐值不变，放宽后回到原宽（输出 20、167）", () => {
        // a、c 保留 300，b 按比例分、最小 100；508 宽里三块只放得下 [200, 100, 200]。
        const NARROW: GridExtent = {width: 508, height: 400};
        const WIDE: GridExtent = {width: 1004, height: 400};
        const tree = (collapsed: boolean): GridBranchInput<string> => branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100), ...fixed, ...collapsible(collapsed)},
            leaf("b", "width", 100, 100),
            {...leaf("c", "width", 300, 100), ...fixed},
        ]);
        const intents = (grid: ReturnType<typeof createGrid<string>>): number[] => ["a", "b", "c"].map((id) => grid.find(id)?.size.width ?? Number.NaN);

        // 收起 a：预览与 `setCollapsed` 翻标记后的布局相同（b 吸收，c 回到 300），落账后意图不变。
        const folding = createGrid(tree(false), {sashSize: 4});
        expect(widths(folding, NARROW, ["a", "b", "c"])).toEqual([200, 100, 200]);
        const fold = session(folding, NARROW, 0, "keyboard");
        const folded = fold.toggleCollapsed();
        expect(["a", "b", "c"].map((id) => extent(folded?.layout.sizes ?? {}, id).width)).toEqual(widths(createGrid(tree(true), {sashSize: 4}), NARROW, ["a", "b", "c"]));
        commit(folding, fold);
        expect(widths(folding, NARROW, ["a", "b", "c"])).toEqual([0, 200, 300]);
        expect(intents(folding)).toEqual([300, 100, 300]);
        folding.setCollapsed("a", false);
        expect(widths(folding, WIDE, ["a", "b", "c"])).toEqual([300, 396, 300]);

        // 展开 a：翻了之后保留像素的兄弟被压（`fixed-overflow`），照常展开，和 `setCollapsed(false)` 相同；落账后意图不变。
        const unfolding = createGrid(tree(true), {sashSize: 4});
        const unfold = session(unfolding, NARROW, 0, "keyboard");
        expect(unfold.toggleCollapsed()?.changes[0]?.target).toMatchObject({a: 200, b: 100, c: 200});
        commit(unfolding, unfold);
        expect(intents(unfolding)).toEqual([300, 100, 300]);
        expect(widths(unfolding, WIDE, ["a", "b", "c"])).toEqual([300, 396, 300]);
    });

    it("结果里的 `collapse` 是副本：改它不改树（输出 147）", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 250, 100), ...fixed, ...collapsible()},
            leaf("b", "width", 500, 100),
        ]), {sashSize: 4});
        const result = grid.setCollapsed("a", true);
        if (!result.ok) throw new Error(result.message);
        (result.collapse as {collapsedSize: number}).collapsedSize = 999;
        expect(grid.find("a")?.collapse?.collapsedSize).toBe(0);
        const unchanged = grid.setCollapsed("a", true);
        if (!unchanged.ok) throw new Error(unchanged.message);
        (unchanged.collapse as {collapsed: boolean}).collapsed = false;
        expect(grid.find("a")?.collapse?.collapsed).toBe(true);
    });

    it("只动收起标记：变了之后意图（快照）不变；已收起再收起 `changed` 为假、策略不变；`toggleable: false` 照样收（输出 147）", () => {
        const ROW: GridExtent = {width: 1208, height: 400};
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100), collapse: {...POLICY, collapsed: false, toggleable: false}},
            leaf("b", "width", 300, 100),
            leaf("c", "width", 600, 100),
        ]), {sashSize: 4});
        const intents = grid.serialize();
        expect(grid.setCollapsed("a", true)).toMatchObject({ok: true, changed: true});
        expect(grid.serialize()).toEqual(intents);
        expect(widths(grid, ROW, ["a", "b", "c"])).toEqual([0, 400, 800]);

        const policy = {...grid.find("a")!.collapse!};
        expect(grid.setCollapsed("a", true)).toMatchObject({ok: true, changed: false});
        expect(grid.find("a")?.collapse).toEqual(policy);
    });

    it("竖直分支里保留像素的面板：收起不改高度意图，展开回到它；收起策略不写快照（输出 147、166）", () => {
        const COLUMN: GridExtent = {width: 400, height: 584};
        const grid = createGrid(branch("root", "height", "vertical", 0, [
            leaf("top", "height", 400, 100),
            {...leaf("bottom", "height", 180, 100), ...fixed, ...collapsible()},
        ]), {sashSize: 4});
        expect(grid.setCollapsed("bottom", true)).toMatchObject({ok: true, collapse: {collapsed: true}});
        expect(grid.find("bottom")?.size.height).toBe(180);
        grid.setCollapsed("bottom", false);
        expect(extent(grid.layout(COLUMN).sizes, "bottom").height).toBe(180);
        const snapshot = JSON.stringify(grid.serialize());
        expect(snapshot).not.toContain("collapse");
    });

    it("分隔条上的 Enter：唯一的兄弟已经收起时也吸收不了，不收（输出 20）", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100), ...collapsible()},
            {...leaf("b", "width", 300, 100), ...collapsible(true)},
        ]), {sashSize: 4});
        const enter = session(grid, {width: 604, height: 400}, 0, "keyboard");
        enter.toggleCollapsed();
        expect(enter.issues.map((issue) => issue.code)).toContain("no-room-to-collapse");
        expect(enter.finish()).toBeNull();
    });

    it("失败：`id` 不存在、是根、没有收起策略（输出 147）", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 500), leaf("b", "width", 499)]), {sashSize: SASH});
        expect(codeOf(grid.setCollapsed("missing", true))).toEqual({code: "not-found", params: {id: "missing"}});
        expect(codeOf(grid.setCollapsed("root", true))).toEqual({code: "invalid-argument", params: {field: "root", id: "root"}});
        expect(codeOf(grid.setCollapsed("a", true))).toEqual({code: "not-collapsible", params: {id: "a", branch: "root"}});
    });

    it("分隔条上的 Enter：另一侧吸收不了时不收，给 `no-room-to-collapse`，没有提交（输出 20）", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100, 300), ...collapsible()},
            {...leaf("b", "width", 200, 100, 200), ...fixed},
        ]), {sashSize: 4});
        const enter = session(grid, {width: 504, height: 400}, 0, "keyboard");
        enter.toggleCollapsed();
        expect(enter.issues.map((issue) => issue.code)).toContain("no-room-to-collapse");
        expect(enter.finish()).toBeNull();
        expect(grid.find("a")?.collapse?.collapsed).toBe(false);
    });

    it("setSize：设保留像素节点的意图，兄弟不动；越界夹进它自己的约束；没变时 `changed` 为假、树不变（输出 154）", () => {
        const ROW: GridExtent = {width: 1204, height: 400};
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("nav", "width", 188, 150, 300), ...fixed},
            leaf("main", "width", 600, 100),
        ]), {sashSize: 4});
        const set = grid.setSize("nav", 240);
        expect(set).toEqual({ok: true, changed: true, size: 240});
        expect(widths(grid, ROW, ["nav", "main"])).toEqual([240, 960]);
        expect(grid.find("main")?.size.width).toBe(600);

        const before = grid.serialize();
        expect(grid.setSize("nav", 240)).toEqual({ok: true, changed: false, size: 240});
        expect(grid.serialize()).toEqual(before);

        expect(grid.setSize("nav", 500)).toMatchObject({ok: true, size: 300});
        expect(grid.setSize("nav", 100)).toMatchObject({ok: true, size: 150});
        expect(grid.find("nav")?.size.width).toBe(150);
    });

    it("setSize 收起中的面板：只改意图，`changed` 只看意图；`setCollapsed(false)` 与 Enter 都回到新宽度（输出 154、166）", () => {
        const ROW: GridExtent = {width: 1204, height: 400};
        const tree = (): GridBranchInput<string> => branch("root", "width", "horizontal", 0, [
            {...leaf("nav", "width", 188, 150, 300), ...fixed, ...collapsible(true)},
            leaf("main", "width", 600, 100),
        ]);
        const byEntry = createGrid(tree(), {sashSize: 4});
        const policy = {...byEntry.find("nav")!.collapse!};
        expect(byEntry.setSize("nav", 260)).toMatchObject({ok: true, changed: true, size: 260, collapse: policy});
        expect(byEntry.find("nav")?.collapse).toEqual(policy);
        expect(widths(byEntry, ROW, ["nav", "main"])).toEqual([0, 1200]);
        expect(byEntry.setSize("nav", 260)).toMatchObject({ok: true, changed: false, size: 260});
        byEntry.setCollapsed("nav", false);
        expect(widths(byEntry, ROW, ["nav", "main"])).toEqual([260, 940]);

        const byEnter = createGrid(tree(), {sashSize: 4});
        byEnter.setSize("nav", 260);
        const enter = session(byEnter, ROW, 0, "keyboard");
        enter.toggleCollapsed();
        commit(byEnter, enter);
        expect(widths(byEnter, ROW, ["nav", "main"])).toEqual([260, 940]);

        // 结果里的 `collapse` 是副本，改它不动树。
        const result = byEnter.setSize("nav", 200);
        if (!result.ok || result.collapse === undefined) throw new Error("应当带 collapse");
        (result.collapse as {collapsed: boolean}).collapsed = true;
        expect(byEnter.find("nav")?.collapse?.collapsed).toBe(false);
    });

    it("setSize 也设保留像素的分支；没有收起策略时结果里没有 `collapse`", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...branch("col", "width", "vertical", 240, [leaf("t", "height", 1), leaf("u", "height", 1)]), ...fixed},
            leaf("main", "width", 600),
        ]), {sashSize: 4});
        const result = grid.setSize("col", 320);
        expect(result).toEqual({ok: true, changed: true, size: 320});
        expect(widths(grid, {width: 1204, height: 400}, ["col", "main"])).toEqual([320, 880]);
    });
});

/** 失败只比码与参数；`message` 是给日志看的英文（Spec 失败 5），只核对它是可打印的 ASCII，不断言文字。 */
function codeOf(result: {ok: boolean; code?: string; message?: string; params?: unknown}): {code: string | undefined; params: unknown} | null {
    if (!result.ok) expect(result.message).toMatch(/^[\x20-\x7e]+$/u);
    return result.ok ? null : {code: result.code, params: result.params};
}

/** 三层失败码的全集：新增码不列进来时下面的类型检查不过。 */
const FAILURE_CODES = [
    "not-found", "wrong-node-kind", "wrong-axis", "not-finite", "invalid-argument", "limit-exceeded", "duplicate-id", "into-own-subtree", "not-conserved", "stale-baseline", "not-collapsible", "collapse-locked", "wrong-sizing",
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

/** 锁住收起状态（Spec 输出 168、失败 5）：手势收不了、拉不开、Enter 跳过、按分支调整要翻它时整批失败；只有宿主经 `setCollapsed` 翻。 */
describe("拆分树原语：锁住收起状态", () => {
    const ROW: GridExtent = {width: 1004, height: 400};
    const policy = (collapsed: boolean, locked = true) => ({collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed, ...(locked ? {locked: true} : {})}});
    const widths = (grid: ReturnType<typeof createGrid<string>>, ids: readonly string[], container: GridExtent = ROW): number[] =>
        ids.map((id) => Math.round(extent(grid.layout(container).sizes, id).width * 100) / 100);
    const session = (grid: ReturnType<typeof createGrid<string>>, sashIndex: number, source: "keyboard" | "pointer", container: GridExtent = ROW): GridGestureSession<string> =>
        createGridGestureSession<string>({contextKey: "test", revision: 1, root: grid.root(), extent: container, layout: grid.layout(container), sashSize: 4, sessionId: "s", source, sashes: [{branchId: "root", index: sashIndex, axis: "width"}]});
    const commit = (grid: ReturnType<typeof createGrid<string>>, gesture: GridGestureSession<string>): void => {
        const finished = gesture.finish();
        if (finished === null) throw new Error("手势没有产生提交");
        const applied = grid.resizeBranches(finished.changes);
        if (!applied.ok) throw new Error(applied.message);
    };

    it("拖动不越过阈值收起锁住的：拖到最小尺寸就停，提交后仍展开；不锁的同一段拖动会收起", () => {
        const build = (locked: boolean) => createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100), ...policy(false, locked)},
            leaf("b", "width", 700, 100),
        ]), {sashSize: 4});
        const lockedGrid = build(true);
        const drag = session(lockedGrid, 0, "pointer");
        drag.update({x: -290, y: 0});
        commit(lockedGrid, drag);
        expect(widths(lockedGrid, ["a", "b"])).toEqual([100, 900]);
        expect(lockedGrid.find("a")?.collapse).toMatchObject({collapsed: false, locked: true});

        const free = build(false);
        const freeDrag = session(free, 0, "pointer");
        freeDrag.update({x: -290, y: 0});
        commit(free, freeDrag);
        expect(free.find("a")?.collapse?.collapsed).toBe(true);
    });

    it("拉不开收着的锁住的：它照旧是收起尺寸，位移照级联规则传给同侧的兄弟", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            leaf("x", "width", 300, 100),
            {...leaf("a", "width", 300, 100), ...policy(true)},
            leaf("b", "width", 400, 100),
        ]), {sashSize: 4});
        const before = widths(grid, ["x", "a", "b"], {width: 1008, height: 400});
        const drag = session(grid, 1, "pointer", {width: 1008, height: 400});
        drag.update({x: 200, y: 0});
        commit(grid, drag);
        const after = widths(grid, ["x", "a", "b"], {width: 1008, height: 400});
        expect(after[1]).toBe(0);
        expect(grid.find("a")?.collapse).toMatchObject({collapsed: true, locked: true});
        expect(after[0]).toBeCloseTo(before[0]! + 200, 5);
        expect(after[2]).toBeCloseTo(before[2]! - 200, 5);
    });

    it("分隔条上的 Enter 跳过锁住的：作用于另一侧可收起的；两侧都只有锁住的时什么也不做", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100), ...policy(false)},
            {...leaf("b", "width", 700, 100), ...policy(false, false)},
        ]), {sashSize: 4});
        const enter = session(grid, 0, "keyboard");
        enter.toggleCollapsed();
        commit(grid, enter);
        expect(widths(grid, ["a", "b"])).toEqual([1000, 0]);
        expect(grid.find("a")?.collapse?.collapsed).toBe(false);

        const only = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100), ...policy(false)},
            leaf("b", "width", 700, 100),
        ]), {sashSize: 4});
        const skipped = session(only, 0, "keyboard");
        expect(skipped.toggleCollapsed()).toBeNull();
        expect(skipped.finish()).toBeNull();
    });

    it("`resizeBranches` 要翻锁住的标记时整批失败，给 `collapse-locked`，树不变；标记本来就是目标时照常通过", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100), ...policy(false)},
            leaf("b", "width", 700, 100),
        ]), {sashSize: 4});
        const before = grid.serialize();
        const flipped = grid.resizeBranches([{branchId: "root", axis: "width", baseline: {a: 300, b: 700}, target: {a: 0, b: 1000}, collapsed: {a: true}}]);
        expect(flipped.ok ? null : {code: flipped.code, params: flipped.params}).toEqual({code: "collapse-locked", params: {id: "a", branch: "root"}});
        expect(grid.serialize()).toEqual(before);
        expect(grid.find("a")?.collapse?.collapsed).toBe(false);

        const same = grid.resizeBranches([{branchId: "root", axis: "width", baseline: {a: 300, b: 700}, target: {a: 400, b: 600}, collapsed: {a: false}}]);
        expect(same.ok).toBe(true);
        expect(widths(grid, ["a", "b"])).toEqual([400, 600]);
    });

    it("宿主经 `setCollapsed` 照常翻锁住的；`options.locked` 同时改锁，不给时锁不变；`changed` 是标记或锁有没有变", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100), ...policy(false, false)},
            leaf("b", "width", 700, 100),
        ]), {sashSize: 4});
        expect(grid.setCollapsed("a", false, {locked: true})).toMatchObject({ok: true, changed: true, collapse: {collapsed: false, locked: true}});
        expect(grid.setCollapsed("a", false, {locked: true})).toMatchObject({ok: true, changed: false});
        expect(grid.setCollapsed("a", true)).toMatchObject({ok: true, changed: true, collapse: {collapsed: true, locked: true}});
        expect(widths(grid, ["a", "b"])).toEqual([0, 1000]);
        const unlocked = grid.setCollapsed("a", true, {locked: false});
        expect(unlocked).toMatchObject({ok: true, changed: true});
        expect(unlocked.ok && unlocked.collapse).toEqual({collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: true});
        expect(grid.setCollapsed("a", true, {locked: false})).toMatchObject({ok: true, changed: false});
    });

    it("锁随建树、复制与恢复的策略走：`locked: false` 不写进节点，恢复时以解析结果为准", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("a", "width", 300, 100), ...policy(true)},
            {...leaf("b", "width", 700, 100), collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: false, locked: false}},
        ]), {sashSize: 4});
        expect(grid.find("a")?.collapse?.locked).toBe(true);
        expect(grid.find("b")?.collapse).not.toHaveProperty("locked");
        expect(grid.clone().find("a")?.collapse?.locked).toBe(true);
        expect(JSON.stringify(grid.serialize())).not.toContain("locked");

        const restored = grid.restore(grid.serialize(), (ref) => ({ref, ...(ref === "b" ? policy(false) : {})}));
        expect(restored.ok).toBe(true);
        expect(grid.find("b")?.collapse?.locked).toBe(true);
        expect(grid.find("a")?.collapse?.locked).toBe(true);
    });
});

/** 刚性（Spec 输出 169）：保留像素的节点标 `rigid` 时沿父分支主轴钉在意图上，拖动的级联补偿不改它，最小尺寸之和放不下时最后才让。 */
describe("拆分树原语：刚性的节点", () => {
    const ROW: GridExtent = {width: 1008, height: 400};
    const NARROW: GridExtent = {width: 608, height: 400};
    const pinned = (id: string, intent: number, min = 0, max = UNBOUNDED, rigid = true): GridLeafInput<string> =>
        ({...leaf(id, "width", intent, min, max), sizing: "fixed", ...(rigid ? {rigid: true} : {})});
    const widths = (grid: ReturnType<typeof createGrid<string>>, ids: readonly string[], container: GridExtent = ROW): number[] =>
        ids.map((id) => Math.round(extent(grid.layout(container).sizes, id).width * 100) / 100);
    const dragSash = (grid: ReturnType<typeof createGrid<string>>, sashIndex: number, dx: number): void => {
        const gesture = createGridGestureSession<string>({
            contextKey: "test", revision: 1, root: grid.root(), extent: ROW, layout: grid.layout(ROW), sashSize: 4, sessionId: "s", source: "pointer",
            sashes: [{branchId: "root", index: sashIndex, axis: "width"}],
        });
        gesture.update({x: dx, y: 0});
        const finished = gesture.finish();
        if (finished === null) throw new Error("手势没有产生提交");
        const applied = grid.resizeBranches(finished.changes);
        if (!applied.ok) throw new Error(applied.message);
    };

    it("拖动的级联补偿不改刚性的：推过它时位移传给更远的兄弟，意图不变；不标刚性的同一段拖动先把它压到最小", () => {
        const build = (rigid: boolean) => createGrid(branch("root", "width", "horizontal", 0, [
            leaf("x", "width", 300, 100),
            pinned("r", 200, 40, UNBOUNDED, rigid),
            leaf("b", "width", 500, 100),
        ]), {sashSize: 4});
        const rigidGrid = build(true);
        dragSash(rigidGrid, 0, 250);
        expect(widths(rigidGrid, ["x", "r", "b"])).toEqual([550, 200, 250]);
        expect(rigidGrid.find("r")?.size.width).toBe(200);

        const free = build(false);
        dragSash(free, 0, 250);
        expect(widths(free, ["x", "r", "b"])).toEqual([550, 40, 410]);
    });

    it("最小尺寸之和放不下：先按比例压别的，刚性的最后才让；诊断照旧是 `min-total`，度量不变", () => {
        const build = (middle: GridLeafInput<string>) => createGrid(branch("root", "width", "horizontal", 0, [
            leaf("a", "width", 1, 400),
            middle,
            leaf("b", "width", 1, 400),
        ]), {sashSize: 4});
        const result = build(pinned("r", 300)).layout(NARROW);
        expect(["a", "r", "b"].map((id) => extent(result.sizes, id).width)).toEqual([150, 300, 150]);
        expect(facts(result.issues)).toContainEqual({code: "over-constrained", cause: "min-total", id: "root", axis: "width", available: 600, required: 1100});
        // 只认标记：最小等于最大、不标刚性的，和别的一起按最小值比例压。
        const declaredOnly = build(pinned("r", 300, 300, 300, false));
        expect(widths(declaredOnly, ["a", "r", "b"], NARROW)).toEqual([218.18, 163.64, 218.18]);
        expect(facts(declaredOnly.layout(NARROW).issues)).toContainEqual({code: "over-constrained", cause: "min-total", id: "root", axis: "width", available: 600, required: 1100});
    });

    it("刚性的之和也放不下：只在刚性的之间按比例压，别的为 0", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            pinned("r1", 400),
            leaf("a", "width", 1, 100),
            pinned("r2", 200),
        ]), {sashSize: 4});
        const result = grid.layout(NARROW);
        expect(["r1", "a", "r2"].map((id) => extent(result.sizes, id).width)).toEqual([400, 0, 200]);
        expect(widths(grid, ["r1", "a", "r2"], {width: 458, height: 400})).toEqual([300, 0, 150]);
    });

    it("刚性的范围是夹进声明最小与最大的意图；`setSize` 照样能改它的厚度，夹进声明的范围，布局跟着新意图", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            pinned("r", 500, 100, 300),
            leaf("b", "width", 1, 100),
        ]), {sashSize: 4});
        const before = grid.layout(ROW);
        expect(before.constraints.r?.minimumSize.width).toBe(300);
        expect(before.constraints.r?.maximumSize.width).toBe(300);
        expect(widths(grid, ["r", "b"])).toEqual([300, 704]);

        expect(grid.setSize("r", 260)).toMatchObject({ok: true, changed: true, size: 260});
        expect(widths(grid, ["r", "b"])).toEqual([260, 744]);
        expect(grid.setSize("r", 50)).toMatchObject({ok: true, changed: true, size: 100});
        expect(widths(grid, ["r", "b"])).toEqual([100, 904]);
    });

    it("交叉轴不受影响；按比例分的节点标了不起作用", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            pinned("r", 200),
            {...leaf("w", "width", 1), rigid: true},
            leaf("b", "width", 1),
        ]), {sashSize: 4});
        const result = grid.layout(ROW);
        expect(result.constraints.r?.minimumSize.height).toBe(0);
        expect(result.constraints.r?.maximumSize.height).toBe(UNBOUNDED);
        expect(extent(result.sizes, "r").height).toBe(400);
        expect(grid.find("w")).not.toHaveProperty("rigid");
        expect(widths(grid, ["r", "w", "b"])).toEqual([200, 400, 400]);
        // 按比例分的跟着容器变宽，标的刚性不把它钉住。
        expect(widths(grid, ["r", "w", "b"], {width: 1408, height: 400})).toEqual([200, 600, 600]);
    });

    it("刚性随建树与复制走、不进快照；恢复时解析结果优先（`false` 也算给了），其次当前树；分支只能从当前树取", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            pinned("r", 200),
            pinned("s", 200, 0, UNBOUNDED, false),
            {...branch("col", "width", "vertical", 200, [leaf("top", "height", 1), leaf("bottom", "height", 1)]), sizing: "fixed", rigid: true},
            leaf("w", "width", 1),
        ]), {sashSize: 4});
        expect(grid.find("r")?.rigid).toBe(true);
        expect(grid.find("s")).not.toHaveProperty("rigid");
        expect(grid.clone().find("r")?.rigid).toBe(true);
        expect(grid.clone().find("col")?.rigid).toBe(true);
        expect(JSON.stringify(grid.serialize())).not.toContain("rigid");

        const snapshot = grid.serialize();
        const restored = grid.restore(snapshot, (ref) => ({ref, ...(ref === "s" || ref === "w" ? {rigid: true} : {})}));
        expect(restored.ok).toBe(true);
        expect(grid.find("r")?.rigid).toBe(true);
        expect(grid.find("s")?.rigid).toBe(true);
        expect(grid.find("col")?.rigid).toBe(true);
        expect(grid.find("w")).not.toHaveProperty("rigid");

        expect(grid.restore(snapshot, (ref) => ({ref, ...(ref === "r" ? {rigid: false} : {})})).ok).toBe(true);
        expect(grid.find("r")).not.toHaveProperty("rigid");
        expect(grid.find("s")?.rigid).toBe(true);

        // 新网格没有当前树可回落：刚性只来自解析结果，且要解析成保留像素。
        const fresh = restoreGrid(snapshot, (ref) => ({ref, ...(ref === "s" ? {sizing: "fixed" as const, rigid: true} : {rigid: true})}));
        expect(fresh.ok).toBe(true);
        if (!fresh.ok) return;
        expect(fresh.grid.find("s")?.rigid).toBe(true);
        expect(fresh.grid.find("r")).not.toHaveProperty("rigid");
    });
});

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

    it("诊断的 params 的值只有字符串与有限数（输出 139）：布局重算与手势会话产出的每一条", () => {
        const fixedLeaf = (id: string, size: number): GridLeafInput<string> => ({...leaf(id, "width", size), sizing: "fixed"});
        const collapsible = {collapseThreshold: 24, expandThreshold: 24};
        const layouts = [
            // min-total
            createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 300, 300), leaf("b", "width", 300, 300)]), {sashSize: SASH}).layout({width: 500.3333, height: 600}),
            // sash-overflow
            createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 100, 50), leaf("b", "width", 100, 50)]), {sashSize: SASH}).layout({width: 0.5, height: 10}),
            // leaf-min
            createGrid({...leaf("only", "width", 200, 200, 300), maximumSize: {width: 300, height: 100}}).layout({width: 50, height: 100}),
            // conflicting-bounds
            createGrid({...branch("root", "width", "horizontal", 0, [leaf("a", "width", 100, 100), leaf("b", "width", 100, 100)]), maximumSize: {width: 150, height: UNBOUNDED}}, {sashSize: SASH}).layout({width: 500, height: 100}),
            // cross-min
            createGrid(branch("root", "width", "horizontal", 0, [{...leaf("a", "width", 100), minimumSize: {width: 0, height: 700}}, leaf("b", "width", 100)]), {sashSize: SASH}).layout({width: 201, height: 600}),
            // unabsorbed-space：capped 与 no-weight
            createGrid(branch("root", "width", "horizontal", 0, [leaf("a", "width", 300, 0, 300), leaf("b", "width", 300, 0, 300)]), {sashSize: SASH}).layout({width: 1000, height: 600}),
            createGrid(branch("root", "width", "horizontal", 0, [fixedLeaf("a", 100), fixedLeaf("b", 100)]), {sashSize: SASH}).layout({width: 600, height: 100}),
            // fixed-overflow
            createGrid(branch("root", "width", "horizontal", 0, [{...leaf("a", "width", 200, 100, 400), sizing: "fixed"}, leaf("b", "width", 100, 150), {...leaf("c", "width", 200, 100, 400), sizing: "fixed"}]), {sashSize: 0}).layout({width: 500, height: 100}),
        ];
        const gesture = (root: GridBranchInput<string>, extentOf: GridExtent, sashes: {branchId: string; index: number; axis: GridAxis}[]) => {
            const grid = createGrid(root, {sashSize: SASH});
            return createGridGestureSession<string>({contextKey: "test", revision: 1, root: grid.root(), extent: extentOf, layout: grid.layout(extentOf), sashSize: SASH, sessionId: "params", source: "pointer", sashes});
        };
        // range-overflow：两根轴都装不下，一根有上限、一根没有（`max` 只在都有上限时给）。
        const wide = (id: string, axis: GridAxis, max = UNBOUNDED): GridLeafInput<string> => ({...leaf(id, axis, 300, 0, max), minimumSize: {width: 500, height: 300}});
        const ranges = gesture(branch("root", "width", "horizontal", 0, [wide("left", "width", 600), branch("right", "width", "vertical", 500, [wide("top", "height"), wide("bottom", "height")])]), {width: 900, height: 500}, [{branchId: "root", index: 0, axis: "width"}, {branchId: "right", index: 0, axis: "height"}]);
        ranges.update({x: 10, y: 10});
        // no-room-to-restore
        const restore = gesture(branch("root", "width", "horizontal", 0, [{...leaf("a", "width", 250, 200), collapse: {collapsed: true, collapsedSize: 0, ...collapsible}}, leaf("b", "width", 300, 150)]), {width: 301, height: 100}, [{branchId: "root", index: 0, axis: "width"}]);
        restore.toggleCollapsed();
        // no-room-to-collapse
        const collapse = gesture(branch("root", "width", "horizontal", 0, [{...leaf("a", "width", 300, 100, 300), collapse: {collapsed: false, collapsedSize: 0, ...collapsible}}, {...leaf("b", "width", 200, 100, 200), sizing: "fixed"}]), {width: 501, height: 400}, [{branchId: "root", index: 0, axis: "width"}]);
        collapse.toggleCollapsed();

        const issues = [...layouts.flatMap((result) => result.issues), ...ranges.issues, ...restore.issues, ...collapse.issues];
        const causes = new Set(issues.map((issue) => `${issue.code}/${String(issue.params?.cause ?? "")}`));
        expect([...causes].sort()).toEqual([
            "conflicting-bounds/", "no-room-to-collapse/", "no-room-to-restore/",
            "over-constrained/cross-min", "over-constrained/fixed-overflow", "over-constrained/leaf-min", "over-constrained/min-total", "over-constrained/range-overflow", "over-constrained/sash-overflow",
            "unabsorbed-space/capped", "unabsorbed-space/no-weight",
        ]);
        const offending = issues.flatMap((issue) => Object.entries(issue.params ?? {})
            .filter(([, value]) => !(typeof value === "string" || (typeof value === "number" && Number.isFinite(value))))
            .map(([key, value]) => `${issue.code}.${key}=${String(value)}`));
        expect(offending).toEqual([]);
    });
});

describe("拆分树原语：失败的码（Spec ui/nested-grid 失败 5、7）", () => {
    const split = (over: Record<string, unknown> = {}) => ({branchId: "pair", orientation: "horizontal", side: "after", leaf: {kind: "leaf", id: "added", ref: "added"}, ...over}) as Parameters<ReturnType<typeof createGrid<string>>["splitLeaf"]>[1];

    it("按分支调整：不在与不是分支分开报，错轴、尺寸没覆盖、尺寸不合法、不守恒、基线失效、目标换不成意图", () => {
        const grid = createGrid(fixture(), {sashSize: SASH});
        const before = grid.serialize();
        const base = {left: 300, right: 699};
        expect(codeOf(resizeOne(grid, "ghost", "width", base, base))).toEqual({code: "not-found", params: {id: "ghost"}});
        expect(codeOf(resizeOne(grid, "left", "width", base, base))).toEqual({code: "wrong-node-kind", params: {id: "left", expected: "branch"}});
        expect(codeOf(resizeOne(grid, "root", "height", base, base))).toEqual({code: "wrong-axis", params: {id: "root", orientation: "horizontal"}});
        expect(codeOf(resizeOne(grid, "root", "width", {left: 300}, {left: 300}))).toEqual({code: "invalid-argument", params: {field: "sizes-cover", id: "root"}});
        expect(codeOf(resizeOne(grid, "root", "width", {left: Number.NaN, right: 699}, base)))
            .toEqual({code: "not-finite", params: {field: "size", side: "baseline", id: "left"}});
        expect(codeOf(resizeOne(grid, "root", "width", base, {left: -1, right: 1000})))
            .toEqual({code: "invalid-argument", params: {field: "size-negative", side: "target", id: "left"}});
        // 同一个子节点两侧都不合法时报基线那一侧。
        expect(codeOf(resizeOne(grid, "root", "width", {left: -1, right: 1000}, {left: Number.NaN, right: 699})))
            .toEqual({code: "invalid-argument", params: {field: "size-negative", side: "baseline", id: "left"}});
        expect(codeOf(resizeOne(grid, "root", "width", base, {left: 400, right: 699}))).toEqual({code: "not-conserved", params: {id: "root", target: 1099, baseline: 999}});
        expect(codeOf(resizeOne(grid, "root", "width", {left: 1, right: 998}, {left: 2, right: 997}))).toEqual({code: "stale-baseline", params: {id: "root"}});
        // left 最大 800：目标 900 呈现不出来，换不成能复现目标的意图。
        expect(codeOf(resizeOne(grid, "root", "width", base, {left: 900, right: 99}))).toEqual({code: "not-finite", params: {field: "intent", id: "root"}});
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
        expect(codeOf(grid.splitLeaf("left", split({ratio: "half"})))).toEqual({code: "not-finite", params: {field: "ratio", value: "half"}});

        expect(codeOf(grid.removeLeaf("ghost"))).toEqual({code: "not-found", params: {id: "ghost"}});

        expect(codeOf(grid.moveLeaf("ghost", "root", 0))).toEqual({code: "not-found", params: {id: "ghost"}});
        expect(codeOf(grid.moveLeaf("right", "root", 0))).toEqual({code: "wrong-node-kind", params: {id: "right", expected: "leaf"}});
        expect(codeOf(grid.moveLeaf("top", "top", 0))).toEqual({code: "into-own-subtree", params: {id: "top", parent: "top"}});
        expect(codeOf(grid.moveLeaf("top", "ghost", 0))).toEqual({code: "not-found", params: {id: "ghost"}});
        expect(codeOf(grid.moveLeaf("top", "left", 0))).toEqual({code: "wrong-node-kind", params: {id: "left", expected: "branch"}});
        expect(grid.serialize()).toEqual(before);
    });

    it("设尺寸与保留像素的移动：不在、根节点、按比例分、非有限、负数按这个先后判；跨方向移动报 fixed-cross-axis（Spec 失败 5）", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [
            {...leaf("nav", "width", 188), sizing: "fixed"},
            leaf("main", "width", 600),
            branch("col", "width", "vertical", 400, [leaf("t", "height", 1), leaf("u", "height", 1)]),
        ]));
        const before = grid.serialize();
        expect(codeOf(grid.setSize("ghost", 10))).toEqual({code: "not-found", params: {id: "ghost"}});
        expect(codeOf(grid.setSize("root", 10))).toEqual({code: "invalid-argument", params: {field: "root", id: "root"}});
        expect(codeOf(grid.setSize("main", Number.NaN))).toEqual({code: "wrong-sizing", params: {id: "main", expected: "fixed"}});
        expect(codeOf(grid.setSize("nav", Number.POSITIVE_INFINITY))).toEqual({code: "not-finite", params: {field: "px", id: "nav"}});
        expect(codeOf(grid.setSize("nav", Number.NEGATIVE_INFINITY))).toEqual({code: "not-finite", params: {field: "px", id: "nav"}});
        expect(codeOf(grid.setSize("nav", -1))).toEqual({code: "invalid-argument", params: {field: "px-negative", id: "nav"}});
        expect(codeOf(grid.moveLeaf("nav", "col", 0))).toEqual({code: "invalid-argument", params: {field: "fixed-cross-axis", id: "nav"}});
        expect(grid.serialize()).toEqual(before);
    });

    it("拆分保留像素的叶：wrong-sizing 先于方向、位置与身份的检查（Spec 失败 5）", () => {
        const grid = createGrid(branch("root", "width", "horizontal", 0, [{...leaf("nav", "width", 188), sizing: "fixed"}, leaf("main", "width", 600)]));
        const before = grid.serialize();
        expect(codeOf(grid.splitLeaf("nav", split()))).toEqual({code: "wrong-sizing", params: {id: "nav", expected: "weight"}});
        expect(codeOf(grid.splitLeaf("nav", split({orientation: "diagonal", branchId: "main"})))).toEqual({code: "wrong-sizing", params: {id: "nav", expected: "weight"}});
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

    it("每种恢复失败都带 dropped 与 clamped 两个数组（失败 7）", () => {
        const grid = createGrid<string>(null);
        const pair = (second: GridNodeInput<string>) => ({version: GRID_SNAPSHOT_VERSION, root: branch("root", "width", "horizontal", 0, [leaf("same", "width", 50, 10, 100), second])});
        const failures = {
            "invalid-snapshot": grid.restore(null, (ref) => ({ref})),
            "unsupported-version": grid.restore({version: 99, root: {}}, (ref) => ({ref})),
            "unresolved-root": grid.restore({version: GRID_SNAPSHOT_VERSION, root: {kind: "leaf", id: "a", ref: "ghost", size: {width: 1, height: 1}}}, () => null),
            "duplicate-id": grid.restore(pair({...leaf("same", "width", 50, 10, 100), ref: "other"}), (ref) => ({ref})),
        };
        for (const [code, result] of Object.entries(failures)) {
            expect(result.ok ? null : (result.code as string), code).toBe(code);
            expect([Array.isArray(result.dropped), Array.isArray(result.clamped)], code).toEqual([true, true]);
        }
    });
});

describe("拆分树原语：复制网格与从快照建网格（Spec ui/nested-grid 输出 164、165）", () => {
    const folding = {collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: false}};
    /** 带保留像素、最小尺寸与收起策略的一排，sash 1px：复制要把这些都带过去。 */
    const policyRow = () => createGrid(branch("root", "width", "horizontal", 0, [
        {...leaf("side", "width", 240, 160, 400), sizing: "fixed", ...folding},
        leaf("editor", "width", 700, 200),
        branch("col", "width", "vertical", 300, [leaf("top", "height", 1, 50), leaf("bottom", "height", 1, 50)]),
    ]), {sashSize: SASH});
    const ROW: GridExtent = {width: 1242, height: 600};

    it("clone：树、快照与布局（含 sash 宽度）都与原来相等；叶的 ref 是同一个对象", () => {
        const grid = policyRow();
        const copy = grid.clone();
        expect(copy.root()).toEqual(grid.root());
        expect(copy.serialize()).toEqual(grid.serialize());
        expect(copy.layout(ROW)).toEqual(grid.layout(ROW));
        expect(copy.layout(ROW).sashSizes["root"]).toEqual([SASH, SASH]);

        type Ref = {key: string};
        const refs: Ref[] = [{key: "a"}, {key: "b"}];
        const objects = createGrid<Ref>({kind: "branch", id: "root", orientation: "horizontal", children: refs.map((ref) => ({kind: "leaf" as const, id: ref.key, ref}))}, {encodeRef: (ref) => ref.key});
        const objectCopy = objects.clone();
        expect(objectCopy.serialize()).toEqual(objects.serialize());
        const leafRef = (target: typeof objects, id: string) => {
            const node = target.find(id);
            return node?.kind === "leaf" ? node.ref : null;
        };
        expect(leafRef(objectCopy, "a")).toBe(refs[0]!);
        expect(leafRef(objectCopy, "b")).toBe(refs[1]!);

        // 建完网格后调用方改了自己的选项对象：副本仍照建网格时的选项，与原网格一致。
        const options: {sashSize: number; encodeRef: (ref: Ref) => string} = {sashSize: SASH, encodeRef: (ref) => `old:${ref.key}`};
        const kept = createGrid<Ref>({kind: "branch", id: "root", orientation: "horizontal", children: refs.map((ref) => ({kind: "leaf" as const, id: ref.key, ref}))}, options);
        options.sashSize = 12;
        options.encodeRef = (ref) => `new:${ref.key}`;
        const keptCopy = kept.clone();
        expect(keptCopy.layout(ROW).sashSizes["root"]).toEqual([SASH]);
        expect(keptCopy.serialize()).toEqual(kept.serialize());
    });

    it("clone：改副本不改原来，改原来也不改副本（结构、意图、收起状态）", () => {
        const grid = policyRow();
        const original = structuredClone(grid.root());
        const copy = grid.clone();
        const copied = structuredClone(copy.root());

        expect(copy.splitLeaf("editor", {branchId: "pair", orientation: "horizontal", side: "after", leaf: {kind: "leaf", id: "added", ref: "added"}}).ok).toBe(true);
        expect(copy.setCollapsed("side", true)).toMatchObject({ok: true, changed: true});
        expect(copy.setSize("side", 300)).toMatchObject({ok: true, changed: true});
        expect(copy.removeLeaf("bottom").ok).toBe(true);
        expect(grid.root()).toEqual(original);

        const second = grid.clone();
        expect(grid.setSize("side", 180).ok).toBe(true);
        expect(grid.addLeaf("col", 0, leaf("extra", "height", 1)).ok).toBe(true);
        expect(grid.setCollapsed("side", true).ok).toBe(true);
        expect(second.root()).toEqual(copied);
    });

    it("restoreGrid 成功：交回带 sash 宽度的新网格与 dropped、clamped；约束只来自解析结果", () => {
        const saved = policyRow().serialize();
        const restored = restoreGrid<string>(saved, (ref) => (ref === "bottom" ? null : {ref, ...(ref === "side" ? {sizing: "fixed" as const, minimumSize: {width: 160, height: 0}} : {})}), {sashSize: SASH});
        expect(restored.ok).toBe(true);
        if (!restored.ok) return;
        expect(restored.dropped).toEqual([{ref: "bottom", code: "unknown-ref"}]);
        expect(restored.clamped).toEqual([]);
        expect(restored.grid.find("side")).toMatchObject({sizing: "fixed", minimumSize: {width: 160, height: 0}});
        // 只给了 {ref} 的叶：按比例分、没有最小尺寸，新网格没有当前树可回落。
        expect(restored.grid.find("editor")).toMatchObject({sizing: "weight", minimumSize: {width: 0, height: 0}});
        expect(restored.grid.layout(ROW).sashSizes["root"]).toEqual([SASH, SASH]);

        // 对照：原地的 restore 回落到当前树，editor 的最小尺寸还在。
        const inPlace = policyRow();
        expect(inPlace.restore(saved, (ref) => ({ref})).ok).toBe(true);
        expect(inPlace.find("editor")?.minimumSize.width).toBe(200);
    });

    it("restoreGrid 失败：没有 grid，带 dropped 与 clamped；失败分支读不到 grid（类型）", () => {
        const failures = [
            restoreGrid<string>(null, (ref) => ({ref})),
            restoreGrid<string>({version: 99, root: {}}, (ref) => ({ref})),
            restoreGrid<string>({version: GRID_SNAPSHOT_VERSION, root: {kind: "leaf", id: "a", ref: "ghost", size: {width: 1, height: 1}}}, () => null),
        ];
        expect(failures.map((result) => (result.ok ? null : result.code))).toEqual(["invalid-snapshot", "unsupported-version", "unresolved-root"]);
        for (const result of failures) {
            expect("grid" in result).toBe(false);
            expect([Array.isArray(result.dropped), Array.isArray(result.clamped)]).toEqual([true, true]);
            if (!result.ok) {
                // @ts-expect-error 失败的结果没有 grid：宿主不看结果就拿不到网格。
                expect(result.grid).toBeUndefined();
            }
        }
    });
});

describe("拆分树原语：实例之间（Spec ui/nested-grid 副作用与数据）", () => {
    it("两个 Grid 互不影响：同一份输入建两个实例，改一个，另一个的快照与布局都不变，输入也不被改", () => {
        const input = fixture();
        const inputBefore = JSON.stringify(input);
        const changed = createGrid(input, {sashSize: SASH});
        const untouched = createGrid(input, {sashSize: SASH});
        const snapshot = untouched.serialize();
        const layout = untouched.layout(CONTAINER);

        expect(changed.resizeBranches([{branchId: "root", axis: "width", baseline: {left: 300, right: 699}, target: {left: 200, right: 799}}]).ok).toBe(true);
        expect(changed.addLeaf("right", 0, leaf("added", "height", 50)).ok).toBe(true);
        expect(changed.removeLeaf("bottom").ok).toBe(true);

        expect(changed.serialize()).not.toEqual(snapshot);
        expect(untouched.serialize()).toEqual(snapshot);
        expect(untouched.layout(CONTAINER)).toEqual(layout);
        expect(JSON.stringify(input)).toBe(inputBefore);
    });
});
