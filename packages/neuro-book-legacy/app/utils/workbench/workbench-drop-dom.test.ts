// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {CollisionPriority, CollisionType, type CollisionDetector} from "@dnd-kit/abstract";
import type {GridDropRect} from "@notnotype/nb-ui/layout";
import {readWorkbenchDropRect, workbenchPointerCollision} from "nbook/app/utils/workbench/workbench-drop-dom";

/**
 * DOM 适配层的两条合同：可见矩形与指针碰撞。
 *
 * jsdom 没有布局：矩形、client 盒、offset 与命中栈都由用例显式给；计算样式只覆盖本文件真正读的那几项，
 * 免得把 jsdom 的样式实现当成被测行为。断言的是"量到的矩形是什么""要不要产生碰撞"，
 * 不重述裁剪算术的内部步骤。
 */

const VIEWPORT = {width: 1024, height: 768};

/** 用例显式声明的计算样式：只覆盖被读到的那几个属性。 */
let styleOverrides = new WeakMap<Element, Record<string, string>>();
/** `elementsFromPoint` 的命中栈，顺序＝由最上层到最下层。 */
let hitStack: Element[] = [];

beforeEach(() => {
    styleOverrides = new WeakMap();
    hitStack = [];
    // jsdom 的 clientWidth / clientHeight 恒为 0：没有视口就没有可见区域可言。
    Object.defineProperty(document.documentElement, "clientWidth", {configurable: true, value: VIEWPORT.width});
    Object.defineProperty(document.documentElement, "clientHeight", {configurable: true, value: VIEWPORT.height});
    // jsdom 不实现 elementsFromPoint，命中栈由用例给。
    Object.defineProperty(document, "elementsFromPoint", {configurable: true, writable: true, value: () => hitStack});
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation(((element: Element) => {
        const base = computed(element);
        const overrides = styleOverrides.get(element);
        if (overrides === undefined) {
            return base;
        }
        return {
            display: base.display,
            visibility: base.visibility,
            overflow: base.overflow,
            overflowX: base.overflowX,
            overflowY: base.overflowY,
            transform: base.transform,
            ...overrides,
        } as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle);
});

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

/** 挂一个 div 到父元素下（默认挂在 body 上，因此是已连接的元素）。 */
function div(parent: Element = document.body): HTMLDivElement {
    const element = document.createElement("div");
    parent.append(element);
    return element;
}

/** jsdom 没有布局：bounding rect 由用例给，`width` / `height` 一并补上，免得量到 0。 */
function stubRect(element: Element, rect: GridDropRect): void {
    Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => ({...rect, width: rect.right - rect.left, height: rect.bottom - rect.top}),
    });
}

/** 元素度量：client 盒（扣掉边框与滚动条的内容盒）与 offset 尺寸，jsdom 恒为 0，由用例覆盖。 */
function stubMetrics(element: Element, metrics: Partial<Record<
    "clientLeft" | "clientTop" | "clientWidth" | "clientHeight" | "offsetWidth" | "offsetHeight",
    number
>>): void {
    for (const [name, value] of Object.entries(metrics)) {
        Object.defineProperty(element, name, {configurable: true, value});
    }
}

function setStyle(element: Element, overrides: Record<string, string>): void {
    styleOverrides.set(element, overrides);
}

/** 库的碰撞输入：这里只关心指针坐标、落点元素与拖动源元素。 */
function collisionInput(options: {element?: Element; x: number; y: number; source?: Element}): Parameters<CollisionDetector>[0] {
    return {
        droppable: {id: "drop:content", element: options.element},
        dragOperation: {
            position: {current: {x: options.x, y: options.y}},
            source: options.source === undefined ? null : {element: options.source},
        },
    } as unknown as Parameters<CollisionDetector>[0];
}

describe("readWorkbenchDropRect", () => {
    it("没有元素、已断连的元素都量不出来", () => {
        expect(readWorkbenchDropRect(null)).toBeNull();
        expect(readWorkbenchDropRect(undefined)).toBeNull();
        expect(readWorkbenchDropRect(document.createElement("div"))).toBeNull();
    });

    it("hidden / inert 子树里的元素不算可见，哪怕矩形还在", () => {
        const hidden = div();
        hidden.setAttribute("hidden", "");
        const insideHidden = div(hidden);
        stubRect(insideHidden, {left: 0, top: 0, right: 100, bottom: 100});
        expect(readWorkbenchDropRect(insideHidden)).toBeNull();

        const inert = div();
        inert.setAttribute("inert", "");
        const insideInert = div(inert);
        stubRect(insideInert, {left: 0, top: 0, right: 100, bottom: 100});
        expect(readWorkbenchDropRect(insideInert)).toBeNull();
    });

    it("display:none、visibility:hidden / collapse 都不算可见", () => {
        const none = div();
        stubRect(none, {left: 0, top: 0, right: 100, bottom: 100});
        setStyle(none, {display: "none"});
        expect(readWorkbenchDropRect(none)).toBeNull();

        const invisible = div();
        stubRect(invisible, {left: 0, top: 0, right: 100, bottom: 100});
        setStyle(invisible, {visibility: "hidden"});
        expect(readWorkbenchDropRect(invisible)).toBeNull();

        const collapsed = div();
        stubRect(collapsed, {left: 0, top: 0, right: 100, bottom: 100});
        setStyle(collapsed, {visibility: "collapse"});
        expect(readWorkbenchDropRect(collapsed)).toBeNull();
    });

    it("零尺寸、反向与非有限矩形都不算量出来", () => {
        const flat = div();
        stubRect(flat, {left: 10, top: 10, right: 10, bottom: 40});
        expect(readWorkbenchDropRect(flat)).toBeNull();

        const inverted = div();
        stubRect(inverted, {left: 40, top: 10, right: 10, bottom: 40});
        expect(readWorkbenchDropRect(inverted)).toBeNull();

        const broken = div();
        stubRect(broken, {left: Number.NaN, top: 0, right: 100, bottom: 100});
        expect(readWorkbenchDropRect(broken)).toBeNull();
    });

    it("被视口切掉的部分不算可见，整块在外面就是 null", () => {
        const straddling = div();
        stubRect(straddling, {left: -20, top: -10, right: 100, bottom: 50});
        expect(readWorkbenchDropRect(straddling)).toEqual({left: 0, top: 0, right: 100, bottom: 50});

        const outside = div();
        stubRect(outside, {left: -80, top: 0, right: -20, bottom: 50});
        expect(readWorkbenchDropRect(outside)).toBeNull();
    });

    it("overflow 祖先按自己的 client 盒裁，裁光就是 null", () => {
        const scroller = div();
        setStyle(scroller, {overflow: "hidden"});
        stubMetrics(scroller, {clientWidth: 100, clientHeight: 100});
        stubRect(scroller, {left: 40, top: 40, right: 140, bottom: 140});

        const child = div(scroller);
        stubRect(child, {left: 0, top: 0, right: 200, bottom: 200});
        expect(readWorkbenchDropRect(child)).toEqual({left: 40, top: 40, right: 140, bottom: 140});

        const far = div(scroller);
        stubRect(far, {left: 200, top: 200, right: 300, bottom: 300});
        expect(readWorkbenchDropRect(far)).toBeNull();
    });

    it("overflow:visible 与 display:contents 的祖先不裁剪", () => {
        const open = div();
        setStyle(open, {overflow: "visible"});
        stubMetrics(open, {clientWidth: 20, clientHeight: 20});
        stubRect(open, {left: 0, top: 0, right: 20, bottom: 20});
        const child = div(open);
        stubRect(child, {left: 0, top: 0, right: 300, bottom: 300});
        expect(readWorkbenchDropRect(child)).toEqual({left: 0, top: 0, right: 300, bottom: 300});

        const contents = div();
        setStyle(contents, {display: "contents", overflow: "hidden"});
        stubMetrics(contents, {clientWidth: 20, clientHeight: 20});
        stubRect(contents, {left: 0, top: 0, right: 20, bottom: 20});
        const inside = div(contents);
        stubRect(inside, {left: 0, top: 0, right: 300, bottom: 300});
        expect(readWorkbenchDropRect(inside)).toEqual({left: 0, top: 0, right: 300, bottom: 300});
    });

    it("裁剪用的是 client 盒：边框与滚动条占掉的部分不算可见", () => {
        const panel = div();
        setStyle(panel, {overflow: "auto"});
        stubMetrics(panel, {clientLeft: 1, clientTop: 1, clientWidth: 180, clientHeight: 190});
        stubRect(panel, {left: 0, top: 0, right: 200, bottom: 200});
        const child = div(panel);
        stubRect(child, {left: 0, top: 0, right: 300, bottom: 300});
        expect(readWorkbenchDropRect(child)).toEqual({left: 1, top: 1, right: 181, bottom: 191});
    });

    it("轴对齐缩放按 rect / offset 折回视口单位", () => {
        const stage = div();
        setStyle(stage, {overflow: "hidden", transform: "scale(2)"});
        stubMetrics(stage, {clientLeft: 1, clientTop: 1, clientWidth: 90, clientHeight: 90, offsetWidth: 100, offsetHeight: 100});
        stubRect(stage, {left: 100, top: 200, right: 300, bottom: 400});
        const child = div(stage);
        stubRect(child, {left: 0, top: 0, right: 500, bottom: 500});
        expect(readWorkbenchDropRect(child)).toEqual({left: 102, top: 202, right: 282, bottom: 382});
    });

    it("不缓存：同一元素下一次读取拿到新矩形", () => {
        const element = div();
        stubRect(element, {left: 0, top: 0, right: 100, bottom: 100});
        expect(readWorkbenchDropRect(element)).toEqual({left: 0, top: 0, right: 100, bottom: 100});

        stubRect(element, {left: 40, top: 50, right: 140, bottom: 150});
        expect(readWorkbenchDropRect(element)).toEqual({left: 40, top: 50, right: 140, bottom: 150});
    });
});

describe("workbenchPointerCollision", () => {
    it("指针落在可见矩形内、命中元素属于落点 → PointerIntersection", () => {
        const drop = div();
        stubRect(drop, {left: 100, top: 100, right: 300, bottom: 300});
        hitStack = [div(drop)];

        const collision = workbenchPointerCollision(collisionInput({element: drop, x: 150, y: 160}));
        if (collision === null) {
            throw new Error("指针在可见矩形内、命中元素属于落点时应当产生碰撞");
        }
        expect(collision.id).toBe("drop:content");
        expect(collision.type).toBe(CollisionType.PointerIntersection);
        expect(collision.priority).toBe(CollisionPriority.High);
        // `value` 与安装版一致：到落点中心的距离取倒数，同优先级的两条碰撞靠它排序。
        expect(collision.value).toBeCloseTo(1 / Math.hypot(50, 40));
    });

    it("矩形边界上算命中（与判定层同一套闭区间）", () => {
        const drop = div();
        stubRect(drop, {left: 100, top: 100, right: 300, bottom: 300});
        hitStack = [drop];
        expect(workbenchPointerCollision(collisionInput({element: drop, x: 300, y: 100}))).not.toBeNull();
    });

    it("指针不在矩形内 → 不产生碰撞（没有与被拖 shape 相交的兜底）", () => {
        const drop = div();
        stubRect(drop, {left: 100, top: 100, right: 300, bottom: 300});
        hitStack = [drop];
        expect(workbenchPointerCollision(collisionInput({element: drop, x: 400, y: 150}))).toBeNull();
    });

    it("被祖先裁掉的那部分不算命中", () => {
        const scroller = div();
        setStyle(scroller, {overflow: "hidden"});
        stubMetrics(scroller, {clientWidth: 100, clientHeight: 100});
        stubRect(scroller, {left: 0, top: 0, right: 100, bottom: 100});
        const drop = div(scroller);
        stubRect(drop, {left: 0, top: 0, right: 400, bottom: 400});
        hitStack = [drop];

        expect(workbenchPointerCollision(collisionInput({element: drop, x: 300, y: 300}))).toBeNull();
        expect(workbenchPointerCollision(collisionInput({element: drop, x: 50, y: 50}))).not.toBeNull();
    });

    it("被别的层盖住不算命中", () => {
        const drop = div();
        stubRect(drop, {left: 100, top: 100, right: 300, bottom: 300});
        hitStack = [div(), drop];
        expect(workbenchPointerCollision(collisionInput({element: drop, x: 150, y: 150}))).toBeNull();
    });

    it("拖动反馈不算遮挡：库标记的反馈元素与源元素子树都跳过", () => {
        const drop = div();
        stubRect(drop, {left: 100, top: 100, right: 300, bottom: 300});

        // 没配 overlay 时反馈元素就是源元素本身，配了 overlay 时是复制到根的副本——两者都带这个标记。
        const feedback = div();
        feedback.setAttribute("data-dnd-dragging", "true");
        hitStack = [feedback, drop];
        expect(workbenchPointerCollision(collisionInput({element: drop, x: 150, y: 150}))).not.toBeNull();

        const source = div(drop);
        hitStack = [div(source), drop];
        expect(workbenchPointerCollision(collisionInput({element: drop, x: 150, y: 150, source}))).not.toBeNull();
    });

    it("祖先画在后代之上不算遮挡：继续往下找到落点", () => {
        const frame = div();
        const drop = div(frame);
        stubRect(drop, {left: 100, top: 100, right: 300, bottom: 300});
        hitStack = [frame, drop];
        expect(workbenchPointerCollision(collisionInput({element: drop, x: 150, y: 150}))).not.toBeNull();
    });

    it("落点没有元素、指针坐标非有限 → 都不产生碰撞", () => {
        const drop = div();
        stubRect(drop, {left: 100, top: 100, right: 300, bottom: 300});
        hitStack = [drop];
        expect(workbenchPointerCollision(collisionInput({x: 150, y: 150}))).toBeNull();
        expect(workbenchPointerCollision(collisionInput({element: drop, x: Number.NaN, y: 150}))).toBeNull();
    });
});
