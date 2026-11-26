import {describe, expect, it} from "bun:test";
import {GRID_DROP_INDICATOR_PX, resolveGridEdgeDrop, resolveListInsertion, type GridDropMember, type GridDropRect, type GridListInsertion} from "./grid-drop";

/**
 * 落点几何合同：列表插入位（一个插入位一条线）与叶的四边落点。
 * 空容器、间隙、裁剪与非法几何沿用保守规则。
 */

const CONTAINER: GridDropRect = {left: 0, top: 0, right: 200, bottom: 100};
const THIN_CONTAINER: GridDropRect = {left: 0, top: 0, right: 1, bottom: 100};

function column(id: string, left: number, right: number, top = 0, bottom = 100): GridDropMember {
    return {id, rect: {left, top, right, bottom}};
}

function row(id: string, top: number, bottom: number, left = 0, right = 200): GridDropMember {
    return {id, rect: {left, top, right, bottom}};
}

const TWO_COLUMNS: readonly GridDropMember[] = [column("a", 0, 100), column("b", 100, 200)];
const INSET_ROWS: readonly GridDropMember[] = [row("top", 0, 50, 50, 150), row("bottom", 50, 100, 50, 150)];

describe("resolveListInsertion", () => {
    /**
     * 列表锚点的判据：插入位是权威，指针在哪个区间不该改变画出来的线。接受的落点必须画得出来
     * （两轴正面积）且夹在内容盒里，否则预览就会画到容器外。
     */
    function clampedIndicator(insertion: GridListInsertion | null, container: GridDropRect = CONTAINER): GridDropRect {
        if (insertion === null) {
            throw new Error("这份几何必须给出落点");
        }
        const indicator = insertion.indicator;
        expect(indicator.right - indicator.left).toBeGreaterThan(0);
        expect(indicator.bottom - indicator.top).toBeGreaterThan(0);
        expect(indicator.left).toBeGreaterThanOrEqual(container.left);
        expect(indicator.top).toBeGreaterThanOrEqual(container.top);
        expect(indicator.right).toBeLessThanOrEqual(container.right);
        expect(indicator.bottom).toBeLessThanOrEqual(container.bottom);
        return indicator;
    }

    /** 有间隙的两条：`a` 只占上带、`b` 占满下半，用来区分「锚到前一成员」还是「锚到后一成员」。 */
    const MIXED_SPANS: readonly GridDropMember[] = [
        {id: "a", rect: {left: 0, top: 0, right: 60, bottom: 40}},
        {id: "b", rect: {left: 140, top: 20, right: 200, bottom: 100}},
    ];

    it("前一成员后半、间隙、后一成员前半：同一锚点、同一坐标", () => {
        const container: GridDropRect = {left: 0, top: 0, right: 400, bottom: 100};
        const trailing = resolveListInsertion({orientation: "horizontal", point: {x: 50, y: 50}, containerRect: container, members: MIXED_SPANS});
        const gap = resolveListInsertion({orientation: "horizontal", point: {x: 100, y: 50}, containerRect: container, members: MIXED_SPANS});
        const leading = resolveListInsertion({orientation: "horizontal", point: {x: 150, y: 50}, containerRect: container, members: MIXED_SPANS});
        for (const insertion of [trailing, gap, leading]) {
            expect(insertion?.beforeId).toBe("b");
        }
        // 插入线中心位于两成员之间，交叉轴仍取后一成员的可见跨度。
        const indicator = clampedIndicator(trailing, container);
        expect(indicator).toEqual({left: 99, top: 20, right: 101, bottom: 100});
        expect(indicator.left - MIXED_SPANS[0]!.rect.right).toBe(MIXED_SPANS[1]!.rect.left - indicator.right);
        expect(gap?.indicator).toEqual(indicator);
        expect(leading?.indicator).toEqual(indicator);
    });

    it("竖直列表的窄间隙也给插入线两侧留白，不改变目标成员", () => {
        const members = [row("a", 0, 40), row("b", 44, 100)];
        const insertion = resolveListInsertion({orientation: "vertical", point: {x: 20, y: 43}, containerRect: CONTAINER, members});
        expect(insertion?.beforeId).toBe("b");
        const indicator = clampedIndicator(insertion);
        expect(indicator.top - 40).toBe(1);
        expect(44 - indicator.bottom).toBe(1);
    });

    it("追加贴末成员后缘，不跳到容器尽头的空白；末成员后半与带末尾同坐标", () => {
        const container: GridDropRect = {left: 0, top: 0, right: 400, bottom: 100};
        const trailingHalf = resolveListInsertion({orientation: "horizontal", point: {x: 190, y: 50}, containerRect: container, members: MIXED_SPANS});
        const blankTail = resolveListInsertion({orientation: "horizontal", point: {x: 380, y: 50}, containerRect: container, members: MIXED_SPANS});
        expect(trailingHalf?.beforeId).toBeNull();
        expect(blankTail?.beforeId).toBeNull();
        const indicator = clampedIndicator(blankTail, container);
        expect(indicator).toEqual({left: 200, top: 20, right: 200 + GRID_DROP_INDICATOR_PX, bottom: 100});
        expect(trailingHalf?.indicator).toEqual(indicator);
    });

    it("edgeGap 只退让首条外侧线：线尾离首个可用成员前缘正好一个退让量", () => {
        const line = clampedIndicator(resolveListInsertion({orientation: "horizontal", point: {x: 10, y: 50}, containerRect: CONTAINER, members: [column("a", 40, 100)], edgeGap: 4}));
        expect(line).toEqual({left: 34, top: 0, right: 34 + GRID_DROP_INDICATOR_PX, bottom: 100});
        expect(40 - line.right).toBe(4);
        // 首条外侧线只看首个**可用**成员：前面的零尺寸成员不算成员，退让照样算在 `a` 上。
        expect(clampedIndicator(resolveListInsertion({orientation: "horizontal", point: {x: 10, y: 50}, containerRect: CONTAINER, members: [column("empty", 20, 20), column("a", 40, 100)], edgeGap: 4}))).toEqual(line);

        // 竖直列表同一套几何：只看 y，交叉轴仍取成员的可见跨度。
        const verticalLine = clampedIndicator(resolveListInsertion({orientation: "vertical", point: {x: 10, y: 25}, containerRect: CONTAINER, members: [row("a", 20, 100)], edgeGap: 4}));
        expect(verticalLine).toEqual({left: 0, top: 14, right: 200, bottom: 14 + GRID_DROP_INDICATOR_PX});
        expect(20 - verticalLine.bottom).toBe(4);
    });

    it("edgeGap 只退让末条外侧线：尾线起点是末个可用成员可见后缘加退让量", () => {
        const line = clampedIndicator(resolveListInsertion({orientation: "horizontal", point: {x: 150, y: 50}, containerRect: CONTAINER, members: [column("a", 0, 100)], edgeGap: 4}));
        expect(line).toEqual({left: 104, top: 0, right: 104 + GRID_DROP_INDICATOR_PX, bottom: 100});
        expect(line.left - 100).toBe(4);
        // 末条外侧线只看末个**可用**成员：后面那个落在容器外的成员不往后推线。
        expect(clampedIndicator(resolveListInsertion({
            orientation: "horizontal",
            point: {x: 150, y: 50},
            containerRect: CONTAINER,
            members: [column("a", 0, 100), column("dead", 300, 400)],
            edgeGap: 4,
        }))).toEqual(line);

        const verticalLine = clampedIndicator(resolveListInsertion({orientation: "vertical", point: {x: 10, y: 90}, containerRect: CONTAINER, members: [row("a", 0, 60)], edgeGap: 4}));
        expect(verticalLine).toEqual({left: 0, top: 64, right: 200, bottom: 64 + GRID_DROP_INDICATOR_PX});
        expect(verticalLine.top - 60).toBe(4);
    });

    it("edgeGap 不碰首尾之外的插入位：成员之间的线仍居中或贴后一成员前缘", () => {
        const gapped: readonly GridDropMember[] = [column("a", 0, 60), column("b", 140, 200)];
        const centered = clampedIndicator(resolveListInsertion({orientation: "horizontal", point: {x: 100, y: 50}, containerRect: CONTAINER, members: gapped, edgeGap: 4}));
        expect(centered).toEqual({left: 99, top: 0, right: 99 + GRID_DROP_INDICATOR_PX, bottom: 100});
        expect(centered.left - 60).toBe(140 - centered.right);

        // 共边的第二个插入位：间隙本来就放不下线，edgeGap 不能把它撑成第二段留白。
        const shared = clampedIndicator(resolveListInsertion({orientation: "horizontal", point: {x: 70, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS, edgeGap: 4}));
        expect(shared).toEqual({left: 100, top: 0, right: 100 + GRID_DROP_INDICATOR_PX, bottom: 100});
    });

    it("空间不够时先吃掉 edgeGap，线最终夹在内容盒边界上", () => {
        // 首个可用成员前缘离内容盒起点只剩 3px：退让被吃到 1px，线夹回内容盒起点。
        const tightLeading = [column("a", 3, 100)];
        const leading = clampedIndicator(resolveListInsertion({orientation: "horizontal", point: {x: 1, y: 50}, containerRect: CONTAINER, members: tightLeading, edgeGap: 4}));
        expect(leading).toEqual({left: 0, top: 0, right: GRID_DROP_INDICATOR_PX, bottom: 100});
        expect(3 - leading.right).toBe(1);
        // 不给退让就是既有行为：线贴成员前缘，压住成员最前面那 2px。
        expect(clampedIndicator(resolveListInsertion({orientation: "horizontal", point: {x: 1, y: 50}, containerRect: CONTAINER, members: tightLeading}))).toEqual({left: 3, top: 0, right: 3 + GRID_DROP_INDICATOR_PX, bottom: 100});
        // 越界成员的可见前缘已经在盒起点：退让无处可退，线只能贴盒。
        expect(clampedIndicator(resolveListInsertion({orientation: "horizontal", point: {x: 10, y: 50}, containerRect: CONTAINER, members: [column("bleed", -50, 60)], edgeGap: 4}))).toEqual({left: 0, top: 0, right: GRID_DROP_INDICATOR_PX, bottom: 100});

        // 末个可用成员后缘离内容盒终点只剩 3px：尾线退让同样被吃到 1px。
        const trailing = clampedIndicator(resolveListInsertion({orientation: "horizontal", point: {x: 150, y: 50}, containerRect: CONTAINER, members: [column("a", 0, 197)], edgeGap: 4}));
        expect(trailing).toEqual({left: 198, top: 0, right: 200, bottom: 100});
        expect(trailing.left - 197).toBe(1);

        // 内容盒比线还薄：退让再好也只剩盒子本身。
        const thin = resolveListInsertion({orientation: "horizontal", point: {x: 0.25, y: 50}, containerRect: THIN_CONTAINER, members: [column("slim", 0, 1)], edgeGap: 4});
        expect(thin?.beforeId).toBe("slim");
        expect(clampedIndicator(thin, THIN_CONTAINER)).toEqual(THIN_CONTAINER);
    });

    it("缺失、0、负数与非有限 edgeGap 等价：默认 0 不改动任何既有结果", () => {
        const leading = (edgeGap?: number) => resolveListInsertion({orientation: "horizontal", point: {x: 10, y: 50}, containerRect: CONTAINER, members: [column("a", 40, 100)], edgeGap});
        const append = (edgeGap?: number) => resolveListInsertion({orientation: "vertical", point: {x: 10, y: 90}, containerRect: CONTAINER, members: INSET_ROWS, edgeGap});
        const leadingBaseline = leading();
        const appendBaseline = append();
        expect(leadingBaseline).toEqual({beforeId: "a", indicator: {left: 40, top: 0, right: 40 + GRID_DROP_INDICATOR_PX, bottom: 100}});
        expect(appendBaseline?.indicator).toEqual({left: 50, top: 100 - GRID_DROP_INDICATOR_PX, right: 150, bottom: 100});
        for (const edgeGap of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
            expect(leading(edgeGap)).toEqual(leadingBaseline);
            expect(append(edgeGap)).toEqual(appendBaseline);
        }

        // 空列表没有成员可退让：edgeGap 连前缘线都不动。
        const empty = resolveListInsertion({orientation: "horizontal", point: {x: 120, y: 50}, containerRect: CONTAINER, members: [], edgeGap: 6});
        expect(empty).toEqual({beforeId: null, indicator: {left: 0, top: 0, right: GRID_DROP_INDICATOR_PX, bottom: 100}});
    });

    it("空列表只剩追加位：线贴内容盒前缘、跨度取整盒", () => {
        const horizontal = resolveListInsertion({orientation: "horizontal", point: {x: 120, y: 50}, containerRect: CONTAINER, members: []});
        expect(horizontal?.beforeId).toBeNull();
        expect(clampedIndicator(horizontal)).toEqual({left: 0, top: 0, right: GRID_DROP_INDICATOR_PX, bottom: 100});

        const vertical = resolveListInsertion({orientation: "vertical", point: {x: 120, y: 50}, containerRect: CONTAINER, members: []});
        expect(vertical?.beforeId).toBeNull();
        expect(clampedIndicator(vertical)).toEqual({left: 0, top: 0, right: 200, bottom: GRID_DROP_INDICATOR_PX});
    });

    it("竖直列表只看 y：交叉轴取成员可见跨度，追加夹在内容盒后缘内侧", () => {
        const leading = resolveListInsertion({orientation: "vertical", point: {x: 5, y: 20}, containerRect: CONTAINER, members: INSET_ROWS});
        expect(leading?.beforeId).toBe("top");
        expect(clampedIndicator(leading)).toEqual({left: 50, top: 0, right: 150, bottom: GRID_DROP_INDICATOR_PX});

        const append = resolveListInsertion({orientation: "vertical", point: {x: 195, y: 90}, containerRect: CONTAINER, members: INSET_ROWS});
        expect(append?.beforeId).toBeNull();
        expect(clampedIndicator(append)).toEqual({left: 50, top: 100 - GRID_DROP_INDICATOR_PX, right: 150, bottom: 100});
    });

    it("成员越界先夹进内容盒：可见跨度与边界都不画到容器外", () => {
        const bleeding: readonly GridDropMember[] = [
            {id: "leading", rect: {left: -50, top: -20, right: 60, bottom: 40}},
            {id: "trailing", rect: {left: 100, top: 60, right: 300, bottom: 160}},
        ];
        const before = resolveListInsertion({orientation: "horizontal", point: {x: 10, y: 50}, containerRect: CONTAINER, members: bleeding});
        expect(before?.beforeId).toBe("leading");
        expect(clampedIndicator(before)).toEqual({left: 0, top: 0, right: GRID_DROP_INDICATOR_PX, bottom: 40});

        const append = resolveListInsertion({orientation: "horizontal", point: {x: 180, y: 50}, containerRect: CONTAINER, members: bleeding});
        expect(append?.beforeId).toBeNull();
        expect(clampedIndicator(append)).toEqual({left: 200 - GRID_DROP_INDICATOR_PX, top: 60, right: 200, bottom: 100});
    });

    /**
     * 会滚动的列表：过了最后一个看得见的成员，放下的位置要和线一致。线画在最后一个看得见的后缘，
     * 后面还有滚出去的成员时，插到第一个滚出去的前面，而不是追加到所有滚出去的之后。
     */
    it("越过最后一个看得见的、后面有沿主轴滚出去的：插到第一个滚出去的前面，线照旧贴最后一个看得见的后缘", () => {
        const scrolled: readonly GridDropMember[] = [
            column("off-start", -90, -10),
            column("a", -10, 90),
            column("b", 90, 180),
            column("empty", 180, 180),
            column("c", 210, 300),
            column("d", 300, 390),
        ];
        const horizontal = resolveListInsertion({orientation: "horizontal", point: {x: 150, y: 50}, containerRect: CONTAINER, members: scrolled});
        expect(horizontal?.beforeId).toBe("c");
        expect(clampedIndicator(horizontal)).toEqual({left: 180, top: 0, right: 180 + GRID_DROP_INDICATOR_PX, bottom: 100});
        // 线与只有看得见的成员时的追加线逐值相同：变的只是插到谁前面。
        const visibleOnly = resolveListInsertion({orientation: "horizontal", point: {x: 150, y: 50}, containerRect: CONTAINER, members: scrolled.slice(0, 3)});
        expect(visibleOnly).toEqual({beforeId: null, indicator: {left: 180, top: 0, right: 180 + GRID_DROP_INDICATOR_PX, bottom: 100}});
        // 退让量照旧作用在这条外侧线上。
        expect(resolveListInsertion({orientation: "horizontal", point: {x: 150, y: 50}, containerRect: CONTAINER, members: scrolled, edgeGap: 4})).toEqual({
            beforeId: "c",
            indicator: {left: 184, top: 0, right: 184 + GRID_DROP_INDICATOR_PX, bottom: 100},
        });
        // 前端滚出去的不影响：指针在首个看得见的前半，插到它前面。
        expect(resolveListInsertion({orientation: "horizontal", point: {x: 5, y: 50}, containerRect: CONTAINER, members: scrolled})).toEqual({
            beforeId: "a",
            indicator: {left: 0, top: 0, right: GRID_DROP_INDICATOR_PX, bottom: 100},
        });

        const rows: readonly GridDropMember[] = [row("top", 0, 40), row("middle", 40, 80), row("below", 100, 140), row("further", 140, 180)];
        const vertical = resolveListInsertion({orientation: "vertical", point: {x: 20, y: 70}, containerRect: CONTAINER, members: rows});
        expect(vertical?.beforeId).toBe("below");
        expect(clampedIndicator(vertical)).toEqual({left: 0, top: 80, right: 200, bottom: 80 + GRID_DROP_INDICATOR_PX});
    });

    it("紧跟最后一个看得见的只在交叉轴被裁掉、在前端之外，或后面只有无效矩形：照旧追加", () => {
        const visible: readonly GridDropMember[] = [column("a", 0, 90), column("b", 90, 180)];
        const append = {beforeId: null, indicator: {left: 180, top: 0, right: 180 + GRID_DROP_INDICATOR_PX, bottom: 100}};
        const at = (members: readonly GridDropMember[]) => resolveListInsertion({orientation: "horizontal", point: {x: 150, y: 50}, containerRect: CONTAINER, members});
        // 换行到下一行（主轴上还在盒里、交叉轴上在盒下面）：哪一行接哪一行是调用方的事；更后面滚出去的也不越过它去认。
        expect(at([...visible, column("wrapped", 0, 90, 100, 200), column("beyond", 210, 300)])).toEqual(append);
        // 主轴前端之外。
        expect(at([...visible, column("before-start", -100, -10)])).toEqual(append);
        // 后面只有无效矩形、零尺寸的。
        expect(at([...visible, column("zero", 210, 210), {id: "nan", rect: {left: Number.NaN, top: 0, right: 300, bottom: 100}}])).toEqual(append);
        // 竖向同理：在盒子右边裁掉的不算后继。
        const rows: readonly GridDropMember[] = [row("top", 0, 40), row("middle", 40, 80), row("aside", 40, 80, 200, 300)];
        expect(resolveListInsertion({orientation: "vertical", point: {x: 20, y: 70}, containerRect: CONTAINER, members: rows})?.beforeId).toBeNull();
    });

    it("内容盒比插入线还薄时线退化成盒子本身，不越界", () => {
        const insertion = resolveListInsertion({orientation: "horizontal", point: {x: 0.25, y: 50}, containerRect: THIN_CONTAINER, members: [column("slim", 0, 1)]});
        expect(insertion?.beforeId).toBe("slim");
        expect(clampedIndicator(insertion, THIN_CONTAINER)).toEqual(THIN_CONTAINER);
    });

    it("零尺寸成员不改变锚点，声明的成员全都量不出来时拒绝", () => {
        const withEmpty: readonly GridDropMember[] = [
            {id: "a", rect: {left: 0, top: 0, right: 100, bottom: 100}},
            column("empty", 100, 100),
            {id: "b", rect: {left: 100, top: 0, right: 200, bottom: 100}},
        ];
        const anchor = resolveListInsertion({orientation: "horizontal", point: {x: 80, y: 50}, containerRect: CONTAINER, members: withEmpty});
        expect(anchor?.beforeId).toBe("b");
        expect(clampedIndicator(anchor)).toEqual({left: 100, top: 0, right: 100 + GRID_DROP_INDICATOR_PX, bottom: 100});

        const dead: readonly GridDropMember[] = [
            column("zero", 50, 50),
            {id: "nan", rect: {left: Number.NaN, top: 0, right: 100, bottom: 100}},
            column("outside", 300, 400),
        ];
        expect(resolveListInsertion({orientation: "horizontal", point: {x: 50, y: 50}, containerRect: CONTAINER, members: dead})).toBeNull();
    });

    it("容器外、非有限坐标与零尺寸容器都不给落点", () => {
        expect(resolveListInsertion({orientation: "horizontal", point: {x: 400, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS})).toBeNull();
        expect(resolveListInsertion({orientation: "horizontal", point: {x: Number.NaN, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS})).toBeNull();
        expect(resolveListInsertion({
            orientation: "horizontal",
            point: {x: 0, y: 0},
            containerRect: {left: 0, top: 0, right: 0, bottom: 0},
            members: TWO_COLUMNS,
        })).toBeNull();
    });
});

describe("resolveGridEdgeDrop", () => {
    it("左右优先于上下，中心兜底", () => {
        expect(resolveGridEdgeDrop({point: {x: 5, y: 5}, rect: CONTAINER})).toBe("left");
        expect(resolveGridEdgeDrop({point: {x: 195, y: 5}, rect: CONTAINER})).toBe("right");
        expect(resolveGridEdgeDrop({point: {x: 100, y: 5}, rect: CONTAINER})).toBe("top");
        expect(resolveGridEdgeDrop({point: {x: 100, y: 95}, rect: CONTAINER})).toBe("bottom");
        expect(resolveGridEdgeDrop({point: {x: 100, y: 50}, rect: CONTAINER})).toBe("center");
    });

    it("非法比例、越界指针与零尺寸矩形都拒绝", () => {
        expect(resolveGridEdgeDrop({point: {x: 5, y: 5}, rect: CONTAINER, edgeRatio: 0.5})).toBeNull();
        expect(resolveGridEdgeDrop({point: {x: 5, y: 5}, rect: CONTAINER, edgeRatio: 0})).toBeNull();
        expect(resolveGridEdgeDrop({point: {x: -1, y: 5}, rect: CONTAINER})).toBeNull();
        expect(resolveGridEdgeDrop({point: {x: 5, y: 5}, rect: {left: 0, top: 0, right: 0, bottom: 10}})).toBeNull();
    });
});
