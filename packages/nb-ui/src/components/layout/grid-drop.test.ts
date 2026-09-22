import {describe, expect, it} from "vitest";
import {GRID_DROP_INDICATOR_PX, resolveGridEdgeDrop, resolveGridInsertion, resolveListInsertion, type GridDropMember, type GridDropRect, type GridInsertion, type GridListInsertion} from "./grid-drop";

/**
 * 落点几何合同：边缘 20% 返回插入位与插入线，中央 60% 返回整叶保持布局结果。
 * 空容器、间隙、裁剪与非法几何仍沿用原有保守规则。
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
const TWO_ROWS: readonly GridDropMember[] = [row("top", 0, 50), row("bottom", 50, 100)];
const GAPPED: readonly GridDropMember[] = [column("a", 0, 60), column("b", 140, 200)];
const INSET_ROWS: readonly GridDropMember[] = [row("top", 0, 50, 50, 150), row("bottom", 50, 100, 50, 150)];

function insertionAt(input: Parameters<typeof resolveGridInsertion>[0]): Exclude<GridInsertion, {kind: "keep"}> {
    const insertion = resolveGridInsertion(input);
    if (insertion === null || insertion.kind !== "insert") throw new Error("期望插入落点");
    const shapes = insertion.halfRect === null
        ? [insertion.areaRect, insertion.indicator]
        : [insertion.areaRect, insertion.indicator, insertion.halfRect];
    for (const rect of shapes) {
        expect(rect.right - rect.left).toBeGreaterThan(0);
        expect(rect.bottom - rect.top).toBeGreaterThan(0);
        expect(rect.left).toBeGreaterThanOrEqual(input.containerRect.left);
        expect(rect.top).toBeGreaterThanOrEqual(input.containerRect.top);
        expect(rect.right).toBeLessThanOrEqual(input.containerRect.right);
        expect(rect.bottom).toBeLessThanOrEqual(input.containerRect.bottom);
    }
    return insertion;
}

describe("resolveGridInsertion", () => {
    it("水平首叶前 20% 插入，中央 60% 保持布局，末叶后 20% 追加", () => {
        const leading = insertionAt({orientation: "horizontal", point: {x: 10, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS});
        expect(leading).toMatchObject({kind: "insert", beforeId: "a", areaRect: {left: 0, right: 20}, indicator: {left: 0, right: GRID_DROP_INDICATOR_PX}});
        // 半区与命中带是两件事：带是 20% 的命中范围，半区是承诺并入的那一半（前缘带取命中叶的前半）。
        expect(leading.targetId).toBe("a");
        expect(leading.halfRect).toEqual({left: 0, top: 0, right: 50, bottom: 100});

        const keep = resolveGridInsertion({orientation: "horizontal", point: {x: 50, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS});
        expect(keep).toEqual({kind: "keep", areaRect: {left: 0, top: 0, right: 100, bottom: 100}});

        const trailing = insertionAt({orientation: "horizontal", point: {x: 190, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS});
        expect(trailing).toMatchObject({kind: "insert", beforeId: null, areaRect: {left: 180, right: 200}, indicator: {left: 198, right: 200}});
        // 越过末叶是追加：命中叶仍是末叶，半区是它的后半。
        expect(trailing.targetId).toBe("b");
        expect(trailing.halfRect).toEqual({left: 150, top: 0, right: 200, bottom: 100});
    });

    it("20% 边界属于插入带，中央端点仍保持布局", () => {
        const leadingEdge = insertionAt({orientation: "horizontal", point: {x: 20, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS});
        expect(leadingEdge).toMatchObject({beforeId: "a", areaRect: {left: 0, right: 20}, indicator: {left: 0, right: GRID_DROP_INDICATOR_PX}});
        expect(leadingEdge.halfRect).toEqual({left: 0, top: 0, right: 50, bottom: 100});
        // 后缘带属于它自己那一叶：反馈带与半区都是 a 的，锚点才是下一叶 b。
        const trailingEdge = insertionAt({orientation: "horizontal", point: {x: 80, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS});
        expect(trailingEdge).toMatchObject({beforeId: "b", areaRect: {left: 80, right: 100}, indicator: {left: 100, right: 102}});
        expect(trailingEdge.targetId).toBe("a");
        expect(trailingEdge.halfRect).toEqual({left: 50, top: 0, right: 100, bottom: 100});
        expect(resolveGridInsertion({orientation: "horizontal", point: {x: 21, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS})).toEqual({kind: "keep", areaRect: {left: 0, top: 0, right: 100, bottom: 100}});
    });

    it("候选叶按真实末端查找：中间叶的后缘带归它自己，中央两半都保持布局", () => {
        const box: GridDropRect = {left: 0, top: 0, right: 300, bottom: 100};
        const tall: GridDropRect = {left: 0, top: 0, right: 300, bottom: 300};
        const columns: readonly GridDropMember[] = [column("a", 0, 100), column("b", 100, 200), column("c", 200, 300)];
        const rows: readonly GridDropMember[] = [row("a", 0, 100), row("b", 100, 200), row("c", 200, 300)];
        const middle = {left: 100, top: 0, right: 200, bottom: 100};

        // 前缘带锚到自己，后缘带锚到下一叶——两者都贴中间叶自己的边缘；中点命中会把 x=190 算成 c 的前缘带。
        expect(insertionAt({orientation: "horizontal", point: {x: 110, y: 50}, containerRect: box, members: columns}))
            .toMatchObject({beforeId: "b", targetId: "b", areaRect: {left: 100, right: 120}, halfRect: {left: 100, right: 150}, indicator: {left: 100, right: 102}});
        expect(insertionAt({orientation: "horizontal", point: {x: 190, y: 50}, containerRect: box, members: columns}))
            .toMatchObject({beforeId: "c", targetId: "b", areaRect: {left: 180, right: 200}, halfRect: {left: 150, right: 200}, indicator: {left: 200, right: 202}});
        expect(insertionAt({orientation: "vertical", point: {x: 150, y: 190}, containerRect: tall, members: rows}))
            .toMatchObject({beforeId: "c", targetId: "b", areaRect: {top: 180, bottom: 200}, halfRect: {top: 150, bottom: 200}, indicator: {top: 200, bottom: 202}});

        // 中央 60% 的前后两半是同一个 keep：整片中间叶，没有锚点也没有插入线。
        for (const x of [130, 150, 170]) {
            expect(resolveGridInsertion({orientation: "horizontal", point: {x, y: 50}, containerRect: box, members: columns}))
                .toEqual({kind: "keep", areaRect: middle});
        }
        for (const y of [130, 150, 170]) {
            expect(resolveGridInsertion({orientation: "vertical", point: {x: 150, y}, containerRect: tall, members: rows}))
                .toEqual({kind: "keep", areaRect: {left: 0, top: 100, right: 200, bottom: 200}});
        }
    });

    it("成员间隙仍锚定下一叶前缘，且中央只沿目标轴判定", () => {
        const gap = insertionAt({orientation: "horizontal", point: {x: 100, y: 50}, containerRect: CONTAINER, members: GAPPED});
        expect(gap).toMatchObject({beforeId: "b", areaRect: {left: 140, right: 152}, indicator: {left: 140, right: 142}});

        const left = resolveGridInsertion({orientation: "vertical", point: {x: 5, y: 25}, containerRect: CONTAINER, members: INSET_ROWS});
        const right = resolveGridInsertion({orientation: "vertical", point: {x: 195, y: 25}, containerRect: CONTAINER, members: INSET_ROWS});
        expect(left).toEqual(right);
        expect(left).toEqual({kind: "keep", areaRect: {left: 50, top: 0, right: 150, bottom: 50}});
    });

    it("垂直行前后边缘使用 20% 带和可见跨度", () => {
        const leading = insertionAt({orientation: "vertical", point: {x: 5, y: 5}, containerRect: CONTAINER, members: TWO_ROWS});
        expect(leading).toMatchObject({beforeId: "top", areaRect: {top: 0, bottom: 10}, indicator: {top: 0, bottom: GRID_DROP_INDICATOR_PX}});
        expect(leading.halfRect).toEqual({left: 0, top: 0, right: 200, bottom: 25});
        const trailing = insertionAt({orientation: "vertical", point: {x: 5, y: 95}, containerRect: CONTAINER, members: TWO_ROWS});
        expect(trailing).toMatchObject({beforeId: null, areaRect: {top: 90, bottom: 100}, indicator: {top: 98, bottom: 100}});
        // 命中叶是末行（不是越界的那片空白），半区是它的后半。
        expect(trailing.targetId).toBe("bottom");
        expect(trailing.halfRect).toEqual({left: 0, top: 75, right: 200, bottom: 100});
    });

    it("空容器整盒接收，薄盒的插入线退化为盒子", () => {
        const empty = insertionAt({orientation: "horizontal", point: {x: 20, y: 50}, containerRect: CONTAINER, members: []});
        // 没有候选叶可命中：整盒接收，命中叶与半区都不存在（调用方据此不承诺任何半区并入）。
        expect(empty).toEqual({
            kind: "insert",
            beforeId: null,
            areaRect: CONTAINER,
            indicator: {left: 0, top: 0, right: GRID_DROP_INDICATOR_PX, bottom: 100},
            targetId: null,
            halfRect: null,
        });
        const thin = insertionAt({orientation: "horizontal", point: {x: 0.1, y: 50}, containerRect: THIN_CONTAINER, members: [column("slim", 0, 1)]});
        expect(thin.areaRect).toEqual({left: 0, top: 0, right: 0.2, bottom: 100});
        expect(thin.indicator).toEqual(THIN_CONTAINER);
    });

    it("源叶仍参与几何，零尺寸与越界成员跳过", () => {
        const source = insertionAt({orientation: "horizontal", point: {x: 10, y: 50}, containerRect: CONTAINER, members: [column("empty", 50, 50), ...TWO_COLUMNS]});
        expect(source.beforeId).toBe("a");
        expect(source.areaRect).toEqual({left: 0, top: 0, right: 20, bottom: 100});
        expect(resolveGridInsertion({orientation: "horizontal", point: {x: 50, y: 50}, containerRect: CONTAINER, members: [column("outside", 300, 400)]})).toBeNull();
        expect(resolveGridInsertion({orientation: "horizontal", point: {x: 50, y: 50}, containerRect: CONTAINER, members: [column("zero", 50, 50)]})).toBeNull();
    });

    it("成员越界先裁剪，容器外或非法坐标不产生落点", () => {
        const clipped = insertionAt({orientation: "horizontal", point: {x: 10, y: 50}, containerRect: CONTAINER, members: [column("bleed", -50, 100)]});
        expect(clipped.areaRect).toEqual({left: 0, top: 0, right: 20, bottom: 100});
        // 半区同样只看**可见**几何：越界的那一半不参与，前一半从内容盒起点量起。
        expect(clipped.targetId).toBe("bleed");
        expect(clipped.halfRect).toEqual({left: 0, top: 0, right: 50, bottom: 100});
        expect(resolveGridInsertion({orientation: "horizontal", point: {x: 400, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS})).toBeNull();
        expect(resolveGridInsertion({orientation: "horizontal", point: {x: Number.NaN, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS})).toBeNull();
    });

    it("调用方可扩大边缘命中带，非法比例拒绝且默认 20% 不变", () => {
        const wider = insertionAt({orientation: "horizontal", point: {x: 25, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS, edgeRatio: 0.3});
        expect(wider).toMatchObject({beforeId: "a", areaRect: {left: 0, right: 30}});
        expect(resolveGridInsertion({orientation: "horizontal", point: {x: 25, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS})).toEqual({kind: "keep", areaRect: {left: 0, top: 0, right: 100, bottom: 100}});
        expect(resolveGridInsertion({orientation: "horizontal", point: {x: 25, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS, edgeRatio: 0.51})).toBeNull();
        const halves = insertionAt({orientation: "horizontal", point: {x: 50, y: 50}, containerRect: CONTAINER, members: TWO_COLUMNS, edgeRatio: 0.5});
        expect(halves).toMatchObject({beforeId: "b", targetId: "a", halfRect: {left: 50, right: 100}});
    });
});

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
