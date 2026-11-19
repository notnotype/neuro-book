import {afterEach, describe, expect, it, onTestFinished, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {h, nextTick} from "vue";
import NestedGrid from "./NestedGrid.vue";
import {createGrid, type Grid, type GridFailure, type GridIssue, type GridLayoutResult, type GridNode} from "../grid";
import {createGridGestureSession, type GridGestureCommit, type GridGesturePreview, type GridGestureSession} from "../grid-gesture";

/**
 * 递归渲染层的行为用例：树 → 面板 px + 叶插槽 + 一次会话的指针/键盘提交。
 *
 * happy-dom 没有布局引擎（矩形全为 0，命中判定会落空）：用例只给真正读到的元素注入矩形，
 * 命中、求解、预览与提交都走真实实现；真实浏览器几何由 e2e 覆盖。
 */

const CONTAINER = {width: 1000, height: 600};
/** 宿主接纳提交后按当前容器重新求值的呈现（比拖动时更窄）。 */
const PUBLISH_CONTAINER = {width: 900, height: 600};
const SASH = 1;

const wrappers: VueWrapper[] = [];
const containers: HTMLElement[] = [];

function attachContainer(): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);
    return container;
}

afterEach(() => {
    for (const wrapper of wrappers.splice(0)) {
        if (wrapper.exists()) wrapper.unmount();
    }
    for (const container of containers.splice(0)) container.remove();
});

function nestedGrid(): Grid<string> {
    return createGrid<string>({
        kind: "branch",
        id: "root",
        orientation: "horizontal",
        children: [
            {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}},
            {
                kind: "branch",
                id: "right",
                orientation: "vertical",
                size: {width: 699, height: 0},
                children: [
                    {kind: "leaf", id: "top", ref: "top", size: {width: 0, height: 100}},
                    {kind: "leaf", id: "bottom", ref: "bottom", size: {width: 0, height: 100}},
                ],
            },
        ],
    }, {sashSize: SASH});
}

type StubRect = {left: number; top: number; right: number; bottom: number};

/** 按元素注入矩形：其余元素保持零矩形，命中判定只认识这里登记的几何。 */
function stubRect(element: Element, rect: StubRect): void {
    (element as HTMLElement).getBoundingClientRect = () => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        toJSON: () => rect,
    }) as DOMRect;
}

/**
 * 几何桩：scope 根盒（会话的根 extent）＋ 外层竖线（x=300）与内层横线（y=300）。
 * 必须在挂载后的第一拍测量前注入。
 */
function stubLayout(wrapper: VueWrapper): void {
    const scope = wrapper.get<HTMLElement>("[data-grid-scope]").element;
    stubRect(scope, {left: 0, top: 0, right: CONTAINER.width, bottom: CONTAINER.height});
    // 会话根盒读的是**布局盒**（clientWidth/clientHeight），不是可能被祖先 transform 缩放的 rect：
    // 两个都要桩，否则根 extent 会是 0。
    Object.defineProperty(scope, "clientWidth", {value: CONTAINER.width, configurable: true});
    Object.defineProperty(scope, "clientHeight", {value: CONTAINER.height, configurable: true});
    stubRect(wrapper.get<HTMLElement>('[data-sash="root:0"]').element, {left: 300, top: 0, right: 301, bottom: 600});
    stubRect(wrapper.get<HTMLElement>('[data-sash="right:0"]').element, {left: 300, top: 300, right: 1000, bottom: 301});
}

/** 实现只读 clientX/clientY/pointerId/pointerType/button/isPrimary：普通 MouseEvent 补字段即可。 */
function pointerEvent(type: string, x: number, y: number): MouseEvent {
    return Object.assign(new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0}), {
        isPrimary: true,
        pointerId: 1,
        pointerType: "mouse",
    });
}

/** 指针位移每帧求解一次：等这一帧的 rAF 与随之而来的渲染。 */
async function settleFrame(): Promise<void> {
    const {promise, resolve} = Promise.withResolvers<void>();
    requestAnimationFrame(() => resolve());
    await promise;
    await nextTick();
}

/** 叶外框的矩形（相对 grid 根，已按设备像素取整）。 */
function frameRect(wrapper: VueWrapper, id: string): {x: number; y: number; width: number; height: number} {
    const {style} = wrapper.get<HTMLElement>(`[data-leaf="${id}"]`).element;
    return {x: Number.parseFloat(style.left), y: Number.parseFloat(style.top), width: Number.parseFloat(style.width), height: Number.parseFloat(style.height)};
}

type RendererOptions = {
    disabled?: boolean;
    onGestureCommit?: (commit: GridGestureCommit) => {readonly ok: true} | GridFailure;
    /** 事件监听（`onGestureUpdate`、`onGestureCancel`、`onIssues`），测宿主回调抛出时的收尾。 */
    listeners?: Readonly<Record<string, (...args: never[]) => void>>;
};

function mountRenderer(node: GridNode<string> | null, layout: GridLayoutResult, options: RendererOptions = {}): VueWrapper {
    const wrapper = mount(NestedGrid, {
        attachTo: attachContainer(),
        props: {
            node,
            layout,
            disabled: options.disabled ?? false,
            ...(options.onGestureCommit === undefined ? {} : {onGestureCommit: options.onGestureCommit}),
            ...options.listeners,
        },
        slots: {
            leaf: (scope: {node: {id: string}}) => h("div", {class: "leaf-body"}, scope.node.id),
            empty: () => h("div", {class: "empty-body"}, "empty"),
        },
    });
    wrappers.push(wrapper);
    return wrapper;
}

describe("NestedGrid 按矩形摆放", () => {
    it("单叶根直接交给叶插槽", () => {
        const grid = createGrid<string>({kind: "leaf", id: "only", ref: "only", size: {width: 0, height: 0}}, {sashSize: SASH});
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));

        expect(wrapper.find("[data-leaf='only']").text()).toBe("only");
    });

    it("空树交给 empty 插槽", () => {
        const grid = createGrid<string>(null, {sashSize: SASH});
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));

        expect(wrapper.find(".empty-body").text()).toBe("empty");
        expect(wrapper.find("[data-leaf]").exists()).toBe(false);
    });

    it("叶与分隔线都是根的直接子元素，按树序交替，叶插槽收到各自节点", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));
        await nextTick();

        const children = [...wrapper.get("[data-grid-scope]").element.children] as HTMLElement[];
        expect(children.map((element) => element.dataset.leaf ?? element.dataset.sash)).toEqual(["left", "root:0", "top", "right:0", "bottom"]);
        expect(wrapper.find("[data-leaf='top']").text()).toBe("top");
    });

    it("外框的矩形来自同一份布局，按设备像素取整，分隔线的 aria 取有效约束", async () => {
        const grid = nestedGrid();
        const layout = grid.layout(CONTAINER);
        const wrapper = mountRenderer(grid.root(), layout);
        stubLayout(wrapper);
        await nextTick();

        // 面板空间不含 sash：根分支 300 / 699，内层纵向各 299.5，取整后前一块多半个像素，缝宽不变
        expect(layout.sizes.top!.height).toBeCloseTo(299.5, 6);
        expect(frameRect(wrapper, "left")).toEqual({x: 0, y: 0, width: 300, height: 600});
        expect(frameRect(wrapper, "top")).toEqual({x: 301, y: 0, width: 699, height: 300});
        expect(frameRect(wrapper, "bottom")).toEqual({x: 301, y: 301, width: 699, height: 299});

        const sash = wrapper.get('[data-sash="root:0"]');
        expect(sash.attributes("aria-valuenow")).toBe("300");
        expect(sash.attributes("aria-valuemin")).toBe(String(layout.constraints.left!.minimumSize.width));
        expect(sash.attributes("aria-controls")).toBe(wrapper.get('[data-leaf="left"]').attributes("id"));
    });

    it("内容容器与外框一样大，Teleport 的目标带部件 id", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));
        stubLayout(wrapper);
        await nextTick();

        const {style} = wrapper.get<HTMLElement>('[data-leaf="top"] > [data-leaf-content="top"]').element;
        expect([style.width, style.height]).toEqual(["699px", "300px"]);
    });
});

describe("分界线上的手势", () => {
    it("内层分界线的一次拖动只提交该分支，提交同时发给事件与宿主", async () => {
        const grid = nestedGrid();
        const commits: GridGestureCommit[] = [];
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {
            onGestureCommit: (commit) => {
                commits.push(commit);
                return {ok: true};
            },
        });
        stubLayout(wrapper);
        await nextTick();

        const innerSash = wrapper.get<HTMLElement>('[data-sash="right:0"]').element;
        // (600, 300) 只在内层横线的命中带内：外层竖线离得足够远，不参与这次手势
        innerSash.dispatchEvent(pointerEvent("pointerdown", 600, 300));
        innerSash.dispatchEvent(pointerEvent("pointermove", 600, 340));
        await settleFrame();
        innerSash.dispatchEvent(pointerEvent("pointerup", 600, 340));
        await nextTick();

        const starts = wrapper.emitted("gesture-start");
        expect(starts).toHaveLength(1);
        expect(starts![0]![0]).toMatchObject({source: "pointer", sashes: [{branchId: "right", index: 0, axis: "height"}]});
        const ended = wrapper.emitted("gesture-end");
        expect(ended).toHaveLength(1);
        const commit = ended![0]![0] as GridGestureCommit;
        expect(commit).toBe(commits[0]);
        expect(commit.source).toBe("pointer");
        expect(commit.extent).toEqual(CONTAINER);
        expect(commit.changes).toHaveLength(1);
        const change = commit.changes[0]!;
        expect(change.branchId).toBe("right");
        expect(change.target.top! - change.baseline.top!).toBeCloseTo(40, 6);
        expect(change.target.bottom! - change.baseline.bottom!).toBeCloseTo(-40, 6);
        expect(change.active).toEqual(["top", "bottom"]);
        expect(wrapper.emitted("gesture-cancel")).toBeUndefined();
    });

    it("分界线上的方向键走同一场会话，提交来源为键盘", async () => {
        const grid = nestedGrid();
        const commits: GridGestureCommit[] = [];
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {
            onGestureCommit: (commit) => {
                commits.push(commit);
                return {ok: true};
            },
        });
        stubLayout(wrapper);
        await nextTick();

        const innerSash = wrapper.get<HTMLElement>('[data-sash="right:0"]').element;
        innerSash.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
        await nextTick();
        innerSash.dispatchEvent(new KeyboardEvent("keyup", {key: "ArrowDown", bubbles: true, cancelable: true}));
        await nextTick();

        expect(commits).toHaveLength(1);
        expect(commits[0]!.source).toBe("keyboard");
        expect(commits[0]!.changes).toHaveLength(1);
        const change = commits[0]!.changes[0]!;
        expect(change.branchId).toBe("right");
        expect(change.target.top! - change.baseline.top!).toBeCloseTo(10, 6);
        expect(change.active).toEqual(["top", "bottom"]);
        expect(wrapper.emitted("gesture-end")).toHaveLength(1);
    });
});

describe("命中结果映射到分界线的状态", () => {
    it("竖线与横线的命中带交叠时两条一起标记，离开即清空", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));
        stubLayout(wrapper);
        await nextTick();

        const rootSash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        const innerSash = wrapper.get<HTMLElement>('[data-sash="right:0"]').element;
        // 指针事件从叶内容冒泡：命中判定不依赖「事件目标恰好是 separator」
        const leaf = wrapper.get<HTMLElement>("[data-leaf='top']").element;

        // 只在外层竖线的 5px 命中带内（离内层横线 200px 以上）
        leaf.dispatchEvent(pointerEvent("pointermove", 304, 100));
        await nextTick();
        expect(rootSash.getAttribute("data-sash-hover")).toBe("true");
        expect(rootSash.hasAttribute("data-sash-cross")).toBe(false);
        expect(innerSash.hasAttribute("data-sash-hover")).toBe(false);

        // 只在内层横线的命中带内
        leaf.dispatchEvent(pointerEvent("pointermove", 600, 302));
        await nextTick();
        expect(innerSash.getAttribute("data-sash-hover")).toBe("true");
        expect(rootSash.hasAttribute("data-sash-hover")).toBe(false);

        // 交点：两条命中带同时包含指针
        leaf.dispatchEvent(pointerEvent("pointermove", 302, 302));
        await nextTick();
        expect(rootSash.getAttribute("data-sash-cross")).toBe("true");
        expect(innerSash.getAttribute("data-sash-cross")).toBe("true");

        // 离开所有分界线：状态清空
        leaf.dispatchEvent(pointerEvent("pointermove", 500, 500));
        await nextTick();
        expect(wrapper.findAll("[data-sash-hover]")).toHaveLength(0);
        expect(wrapper.findAll("[data-sash-cross]")).toHaveLength(0);
    });

    it("禁用与 0px 接缝不进入命中，也不标记", async () => {
        // 同一个点：可用时命中
        const liveGrid = nestedGrid();
        const live = mountRenderer(liveGrid.root(), liveGrid.layout(CONTAINER));
        stubLayout(live);
        await nextTick();
        const liveSash = live.get<HTMLElement>('[data-sash="root:0"]').element;
        live.get<HTMLElement>("[data-leaf='top']").element.dispatchEvent(pointerEvent("pointermove", 303, 100));
        await nextTick();
        expect(liveSash.getAttribute("data-sash-hover")).toBe("true");

        // 整棵渲染器被禁用：几何上仍可命中，但分隔线不参与交互，也不标记
        const disabledGrid = nestedGrid();
        const disabled = mountRenderer(disabledGrid.root(), disabledGrid.layout(CONTAINER), {disabled: true});
        stubLayout(disabled);
        await nextTick();
        const disabledSash = disabled.get<HTMLElement>('[data-sash="root:0"]').element;
        disabled.get<HTMLElement>("[data-leaf='top']").element.dispatchEvent(pointerEvent("pointermove", 303, 100));
        await nextTick();
        expect(disabledSash.getAttribute("aria-disabled")).toBe("true");
        expect(disabledSash.getAttribute("tabindex")).toBe("-1");
        expect(disabledSash.hasAttribute("data-sash-hover")).toBe(false);

        // 0px 接缝不占布局、不参与命中
        const zeroGrid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "a", ref: "a", size: {width: 300, height: 0}},
                {kind: "leaf", id: "b", ref: "b", size: {width: 300, height: 0}},
            ],
        }, {sashSize: 0});
        const zero = mountRenderer(zeroGrid.root(), zeroGrid.layout({width: 601, height: 400}));
        await nextTick();
        const zeroSash = zero.get<HTMLElement>('[data-sash="root:0"]').element;
        expect(zeroSash.getAttribute("data-disabled")).toBe("true");
        zero.get<HTMLElement>("[data-leaf='a']").element.dispatchEvent(pointerEvent("pointermove", 300, 200));
        await nextTick();
        expect(zeroSash.hasAttribute("data-sash-hover")).toBe(false);
    });

    it("宿主让某条分隔线不能拖（`sashDisabled`）：只这一条不进命中、不可聚焦，线照画；别的照常", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));
        stubLayout(wrapper);
        await nextTick();
        const sash = () => wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        const hover = async () => {
            wrapper.get<HTMLElement>("[data-leaf='top']").element.dispatchEvent(pointerEvent("pointermove", 303, 100));
            await nextTick();
        };
        await hover();
        expect([sash().hasAttribute("aria-disabled"), sash().getAttribute("data-sash-hover")]).toEqual([false, "true"]);
        await wrapper.setProps({sashDisabled: (ref: {branch: string}) => ref.branch === "root"});
        await hover();
        expect([sash().getAttribute("aria-disabled"), sash().getAttribute("tabindex"), sash().hasAttribute("data-sash-hover")]).toEqual(["true", "-1", false]);
        expect(sash().querySelector(".sash-seam")).not.toBeNull();
        const others = [...(wrapper.element as HTMLElement).querySelectorAll<HTMLElement>("[data-sash]")].filter((item) => !item.dataset.sash?.startsWith("root:"));
        expect(others.length).toBeGreaterThan(0);
        expect(others.every((item) => item.getAttribute("aria-disabled") !== "true")).toBe(true);
    });

    it("宿主给分隔线写样式（`sashStyle`）：按所在分支与两侧节点写到那一条分隔线上；同名的属性以网格的位置为准", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));
        stubLayout(wrapper);
        await nextTick();
        const sash = (key: string) => wrapper.get<HTMLElement>(`[data-sash="${key}"]`).element;
        const placed = {left: sash("root:0").style.left, position: sash("root:0").style.position};
        await wrapper.setProps({
            sashStyle: (ref: {branch: string; before: string; after: string}) => (ref.branch === "root" && ref.before === "left" && ref.after === "right"
                ? {"--sash-fill": "red", left: "-999px", position: "static"}
                : undefined),
        });
        await nextTick();
        expect(sash("root:0").style.getPropertyValue("--sash-fill")).toBe("red");
        expect({left: sash("root:0").style.left, position: sash("root:0").style.position}).toEqual(placed);
        expect(sash("right:0").style.getPropertyValue("--sash-fill")).toBe("");
    });

    it("收起为零的分支里，叶之间的分隔线长度为零：不可聚焦、不进命中、键盘不调整；展开后恢复", async () => {
        // docs/specs/ui/nested-grid.md 的“分支的收起”：一列三片叶，收起策略配在这一列上。
        const column = (collapsed: boolean): Grid<string> => createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {
                    kind: "branch",
                    id: "side",
                    orientation: "vertical",
                    size: {width: 300, height: 0},
                    sizing: "fixed",
                    collapse: {collapsedSize: 0, restoreSize: 300, collapseThreshold: 24, expandThreshold: 24, collapsed},
                    children: ["s1", "s2", "s3"].map((id) => ({kind: "leaf" as const, id, ref: id, size: {width: 0, height: 100}, minimumSize: {width: 160, height: 80}})),
                },
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 699, height: 0}},
            ],
        }, {sashSize: SASH});
        const sashOf = (wrapper: VueWrapper, key: string): HTMLElement => wrapper.get<HTMLElement>(`[data-sash="${key}"]`).element;
        const pressArrow = async (element: HTMLElement): Promise<void> => {
            element.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
            await nextTick();
            element.dispatchEvent(new KeyboardEvent("keyup", {key: "ArrowDown", bubbles: true, cancelable: true}));
            await nextTick();
        };

        const closed = column(true);
        const commits: GridGestureCommit[] = [];
        const wrapper = mountRenderer(closed.root(), closed.layout(CONTAINER), {
            onGestureCommit: (commit) => {
                commits.push(commit);
                return {ok: true};
            },
        });
        const scope = wrapper.get<HTMLElement>("[data-grid-scope]").element;
        stubRect(scope, {left: 0, top: 0, right: CONTAINER.width, bottom: CONTAINER.height});
        Object.defineProperty(scope, "clientWidth", {value: CONTAINER.width, configurable: true});
        Object.defineProperty(scope, "clientHeight", {value: CONTAINER.height, configurable: true});
        // 零宽的一列：它和编辑区之间的线贴在左边；里面叶之间的线在浏览器里是 0×1 的矩形（长度为零，粗细还在）。
        stubRect(sashOf(wrapper, "root:0"), {left: 0, top: 0, right: 1, bottom: 600});
        stubRect(sashOf(wrapper, "side:0"), {left: 0, top: 200, right: 0, bottom: 201});
        stubRect(sashOf(wrapper, "side:1"), {left: 0, top: 400, right: 0, bottom: 401});
        await nextTick();

        for (const key of ["side:0", "side:1"]) {
            expect(sashOf(wrapper, key).getAttribute("tabindex"), key).toBe("-1");
            expect(sashOf(wrapper, key).getAttribute("aria-disabled"), key).toBe("true");
        }
        expect(sashOf(wrapper, "root:0").getAttribute("tabindex")).toBe("0");
        // 一侧收到了零：那一侧没有东西，静止接缝不画（平铺主题里它会贴在窗口边或条上）；命中照旧，见下。
        expect(sashOf(wrapper, "root:0").querySelector(".sash-seam")?.getAttribute("data-beside-zero")).toBe("true");

        // 指针在那一列的外边界上、正对着里面一条线的高度：只命中外边界，不是两根轴一起调。
        wrapper.get<HTMLElement>("[data-leaf='editor']").element.dispatchEvent(pointerEvent("pointermove", 2, 200));
        await nextTick();
        expect(sashOf(wrapper, "root:0").getAttribute("data-sash-hover")).toBe("true");
        expect(sashOf(wrapper, "root:0").hasAttribute("data-sash-cross")).toBe(false);
        expect(sashOf(wrapper, "side:0").hasAttribute("data-sash-hover")).toBe(false);

        // 焦点早就在这条线上时（它是后来才变成零长度的），方向键也不调整看不见的叶。
        await pressArrow(sashOf(wrapper, "side:0"));
        expect(commits).toHaveLength(0);

        const open = column(false);
        await wrapper.setProps({node: open.root(), layout: open.layout(CONTAINER)});
        stubRect(sashOf(wrapper, "root:0"), {left: 300, top: 0, right: 301, bottom: 600});
        stubRect(sashOf(wrapper, "side:0"), {left: 0, top: 200, right: 300, bottom: 201});
        await nextTick();
        expect(sashOf(wrapper, "side:0").getAttribute("tabindex")).toBe("0");
        expect(sashOf(wrapper, "side:0").hasAttribute("aria-disabled")).toBe(false);
        expect(sashOf(wrapper, "root:0").querySelector(".sash-seam")?.hasAttribute("data-beside-zero")).toBe(false);
        wrapper.get<HTMLElement>("[data-leaf='editor']").element.dispatchEvent(pointerEvent("pointermove", 150, 202));
        await nextTick();
        expect(sashOf(wrapper, "side:0").getAttribute("data-sash-hover")).toBe("true");
        await pressArrow(sashOf(wrapper, "side:0"));
        expect(commits).toHaveLength(1);
        expect(commits[0]!.changes[0]!.branchId).toBe("side");
    });

    it("悬停线的两端：交汇处两条一起亮时，横线挨着竖线的一端连着；只亮横线时两端都按自由端缩进", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {onGestureCommit: () => ({ok: true})});
        stubLayout(wrapper);
        await nextTick();
        const ends = (key: string) => {
            const line = wrapper.get<HTMLElement>(`[data-sash="${key}"] > .sash-line`).element;
            return {start: line.dataset.joinedStart === "true", end: line.dataset.joinedEnd === "true"};
        };
        const innerSash = wrapper.get<HTMLElement>('[data-sash="right:0"]').element;

        // 交点按下：两根轴进同一场手势，同时亮
        innerSash.dispatchEvent(pointerEvent("pointerdown", 302, 302));
        await nextTick();
        expect(ends("right:0")).toEqual({start: true, end: false});
        expect(ends("root:0")).toEqual({start: false, end: false});
        innerSash.dispatchEvent(pointerEvent("pointerup", 302, 302));
        await nextTick();

        // 只按横线：竖线没亮，横线左端也是自由端
        innerSash.dispatchEvent(pointerEvent("pointerdown", 600, 300));
        await nextTick();
        expect(innerSash.getAttribute("data-sash-active")).toBe("true");
        expect(ends("right:0")).toEqual({start: false, end: false});
        innerSash.dispatchEvent(pointerEvent("pointerup", 600, 300));
    });
});

describe("拖动期间的预览布局", () => {
    it("预览沿父盒实时重投影且与 DOM 同源，松手后回到宿主发布的布局", async () => {
        const grid = nestedGrid();
        const commits: GridGestureCommit[] = [];
        let published = grid.layout(CONTAINER);
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {
            onGestureCommit: (commit) => {
                commits.push(commit);
                const applied = grid.resizeBranches(commit.changes);
                if (!applied.ok) {
                    return applied;
                }
                // 宿主接纳后按当前容器重新求值再发布
                published = grid.layout(PUBLISH_CONTAINER);
                return {ok: true};
            },
        });
        stubLayout(wrapper);
        await nextTick();

        const rootSash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        rootSash.dispatchEvent(pointerEvent("pointerdown", 300, 80));
        rootSash.dispatchEvent(pointerEvent("pointermove", 420, 80));
        await settleFrame();

        // 外层竖线右移 120px：左面板 300 → 420，右分支 699 → 579
        const preview = wrapper.emitted("gesture-update")!.at(-1)![0] as GridGesturePreview<string>;
        expect(preview.layout.sizes.left!.width).toBeCloseTo(420, 6);
        expect(preview.layout.sizes.right!.width).toBeCloseTo(579, 6);
        // 同时刻 DOM 就是预览 px：不要求松手后才更新
        expect(frameRect(wrapper, "left").width).toBe(420);
        expect(frameRect(wrapper, "top")).toMatchObject({x: 421, width: 579});
        // 嵌套分支的盒跟着当前父盒重投影：交叉轴就是现在的父面板 px，而不是按下时的 699
        expect(preview.layout.sizes.top!.width).toBeCloseTo(579, 6);
        // 内层主轴不受外层拖动影响
        expect(preview.layout.sizes.top!.height).toBeCloseTo(299.5, 6);

        rootSash.dispatchEvent(pointerEvent("pointerup", 420, 80));
        await nextTick();
        expect(commits).toHaveLength(1);
        expect(published.sizes.left!.width).not.toBeCloseTo(420, 6);

        // 宿主发布新布局即成为受控事实，预览与之无关
        await wrapper.setProps({layout: published});
        await nextTick();
        expect(frameRect(wrapper, "left").width).toBe(Math.round(published.sizes.left!.width));
        expect(frameRect(wrapper, "top").width).toBe(Math.round(published.sizes.top!.width));
        expect(wrapper.emitted("gesture-cancel")).toBeUndefined();
    });
});

/** 这一场发出的诊断：只比码与参数，带 `ok` 的是被拒的提交（Spec 输出 139）。 */
function emittedIssues(wrapper: VueWrapper): Record<string, unknown>[] {
    return ((wrapper.emitted("issues") ?? []).flat(2) as (GridIssue | GridFailure)[])
        .map((issue) => ({code: issue.code, ...("ok" in issue ? {ok: issue.ok} : {}), ...issue.params}));
}

describe("提交被拒的码（Spec ui/nested-grid 失败 6、输出 139）", () => {
    /** 拖一下外层竖线再松手；返回这次发出的诊断。 */
    async function dragOnce(wrapper: VueWrapper): Promise<Record<string, unknown>[]> {
        stubLayout(wrapper);
        await nextTick();
        const rootSash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        rootSash.dispatchEvent(pointerEvent("pointerdown", 300, 80));
        rootSash.dispatchEvent(pointerEvent("pointermove", 420, 80));
        await settleFrame();
        rootSash.dispatchEvent(pointerEvent("pointerup", 420, 80));
        await nextTick();
        return emittedIssues(wrapper);
    }

    it("宿主没接 onGestureCommit：只发一条 handler-missing（带 ok: false），预览回到已发布的布局", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));
        expect(await dragOnce(wrapper)).toEqual([{code: "handler-missing", ok: false}]);
        expect(frameRect(wrapper, "left").width).toBe(300);
    });

    it("宿主用自己的码拒绝：码集合开放，码原样进诊断，预览回到已发布的布局", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {
            onGestureCommit: () => ({ok: false, code: "layout-locked", message: "The layout is locked"}),
        });
        expect(await dragOnce(wrapper)).toEqual([{code: "layout-locked", ok: false}]);
        expect(frameRect(wrapper, "left").width).toBe(300);
    });

    it("宿主的提交回调抛出：handler-threw，预览回到已发布的布局", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {
            onGestureCommit: () => {
                throw new Error("boom");
            },
        });
        expect(await dragOnce(wrapper)).toEqual([{code: "handler-threw", ok: false}]);
        expect(frameRect(wrapper, "left").width).toBe(300);
    });

    it("宿主接纳了但没有发布匹配的布局：下一个 tick 发 not-published，回到已发布的布局", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {onGestureCommit: () => ({ok: true})});
        await dragOnce(wrapper);
        await nextTick();
        expect(emittedIssues(wrapper)).toEqual([{code: "not-published"}]);
        expect(frameRect(wrapper, "left").width).toBe(300);
    });
});

describe("手势的诊断只发新增（Spec 输出 140）", () => {
    it("一场拖动里同一条诊断只发一次，下一场再发", async () => {
        // 两侧的最小宽度合计超过容器：窄容器已降级，拖外层竖线时每一帧都是 range-overflow。
        const wide = {width: 600, height: 0};
        const grid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}, minimumSize: wide},
                {
                    kind: "branch",
                    id: "right",
                    orientation: "vertical",
                    size: {width: 699, height: 0},
                    children: [
                        {kind: "leaf", id: "top", ref: "top", size: {width: 0, height: 100}, minimumSize: wide},
                        {kind: "leaf", id: "bottom", ref: "bottom", size: {width: 0, height: 100}, minimumSize: wide},
                    ],
                },
            ],
        }, {sashSize: SASH});
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {onGestureCommit: () => ({ok: true})});
        stubLayout(wrapper);
        await nextTick();
        const rootSash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        const ranges = (): number => emittedIssues(wrapper).filter((issue) => issue.cause === "range-overflow").length;
        const drag = async (): Promise<void> => {
            rootSash.dispatchEvent(pointerEvent("pointerdown", 300, 80));
            for (const x of [320, 340, 360]) {
                rootSash.dispatchEvent(pointerEvent("pointermove", x, 80));
                await settleFrame();
            }
            rootSash.dispatchEvent(pointerEvent("pointerup", 360, 80));
            await nextTick();
        };

        await drag();
        expect(emittedIssues(wrapper).filter((issue) => issue.cause === "range-overflow")).toEqual([{code: "over-constrained", cause: "range-overflow", id: "root", axis: "width", total: 999, min: 1200, max: expect.any(Number)}]);
        await drag();
        expect(ranges()).toBe(2);
    });
});

describe("键盘的诊断（Spec 输出 139）", () => {
    it("Enter 恢复空间不够：没有预览，照样发 no-room-to-restore", async () => {
        const grid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "a", ref: "a", size: {width: 950, height: 0}, minimumSize: {width: 900, height: 0}, collapse: {collapsed: true, collapsedSize: 0, restoreSize: 950, collapseThreshold: 24, expandThreshold: 24}},
                {kind: "leaf", id: "b", ref: "b", size: {width: 500, height: 0}, minimumSize: {width: 150, height: 0}},
            ],
        }, {sashSize: SASH});
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));
        // 键盘不经命中判定，只要根盒的尺寸（会话按它冻结）。
        const root = wrapper.get<HTMLElement>("[data-grid-scope]").element;
        stubRect(root, {left: 0, top: 0, right: CONTAINER.width, bottom: CONTAINER.height});
        Object.defineProperty(root, "clientWidth", {value: CONTAINER.width, configurable: true});
        Object.defineProperty(root, "clientHeight", {value: CONTAINER.height, configurable: true});
        await nextTick();
        const sash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        sash.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        sash.dispatchEvent(new KeyboardEvent("keyup", {key: "Enter", bubbles: true, cancelable: true}));
        await nextTick();
        expect(emittedIssues(wrapper)).toContainEqual({code: "no-room-to-restore", id: "a", available: 849, required: 900});
    });
});

describe("宿主回调抛出时手势照样收尾（Spec 输出 140）", () => {
    const sashActive = (wrapper: VueWrapper): boolean => wrapper.find("[data-sash-active]").exists();

    async function pressAndMove(wrapper: VueWrapper, toX: number): Promise<HTMLElement> {
        stubLayout(wrapper);
        await nextTick();
        const rootSash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        rootSash.dispatchEvent(pointerEvent("pointerdown", 300, 80));
        rootSash.dispatchEvent(pointerEvent("pointermove", toX, 80));
        return rootSash;
    }

    it("gesture-update 的监听在松手补的最后一帧里抛出：手势结束、提交照常", async () => {
        const grid = nestedGrid();
        const commits: GridGestureCommit[] = [];
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {
            onGestureCommit: (commit) => {
                commits.push(commit);
                return {ok: true};
            },
            listeners: {onGestureUpdate: () => {
                throw new Error("gesture-update listener threw");
            }},
        });
        const rootSash = await pressAndMove(wrapper, 420);
        // 不等 rAF 就松手：最后一帧在 pointerup 里补，宿主的监听在那里抛出；异常照常冒出去，手势照样收尾。
        expect(() => rootSash.dispatchEvent(pointerEvent("pointerup", 420, 80))).toThrow("gesture-update listener threw");
        await nextTick();
        expect(commits).toHaveLength(1);
        expect(sashActive(wrapper)).toBe(false);
    });

    it("issues 的监听在被拒的提交那里抛出：手势已经结束", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {
            onGestureCommit: () => ({ok: false, code: "layout-locked", message: "The layout is locked"}),
            listeners: {onIssues: () => {
                throw new Error("issues listener threw");
            }},
        });
        const rootSash = await pressAndMove(wrapper, 420);
        await settleFrame();
        expect(() => rootSash.dispatchEvent(pointerEvent("pointerup", 420, 80))).toThrow("issues listener threw");
        await nextTick();
        expect(sashActive(wrapper)).toBe(false);
        expect(frameRect(wrapper, "left").width).toBe(300);
    });

    it("gesture-cancel 的监听在没有变化的松手里抛出：手势已经结束", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {
            listeners: {onGestureCancel: () => {
                throw new Error("gesture-cancel listener threw");
            }},
        });
        const rootSash = await pressAndMove(wrapper, 300);
        await settleFrame();
        expect(() => rootSash.dispatchEvent(pointerEvent("pointerup", 300, 80))).toThrow("gesture-cancel listener threw");
        await nextTick();
        expect(sashActive(wrapper)).toBe(false);
    });

    it("卸载时 gesture-cancel 的监听抛出：取消先收尾、后调回调，光标照样释放（不然整页的分隔线光标失效到刷新）", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {
            listeners: {onGestureCancel: () => {
                throw new Error("gesture-cancel listener threw");
            }},
        });
        await pressAndMove(wrapper, 420);
        await settleFrame();
        expect(document.documentElement.hasAttribute("data-nb-sash-cursor")).toBe(true);
        expect(() => wrapper.unmount()).toThrow("gesture-cancel listener threw");
        expect(document.documentElement.hasAttribute("data-nb-sash-cursor")).toBe(false);
    });
});

describe("预览撤回也通知宿主", () => {
    it("拖出去再拖回按下点：几何回到已发布的布局时同样发一次 gesture-update（changes 为空），宿主据此撤掉依赖预览的状态", async () => {
        const grid = nestedGrid();
        const published = grid.layout(CONTAINER);
        const wrapper = mountRenderer(grid.root(), published, {onGestureCommit: () => ({ok: true})});
        stubLayout(wrapper);
        await nextTick();
        const rootSash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        rootSash.dispatchEvent(pointerEvent("pointerdown", 300, 80));
        rootSash.dispatchEvent(pointerEvent("pointermove", 420, 80));
        await settleFrame();
        expect((wrapper.emitted("gesture-update")!.at(-1)![0] as GridGesturePreview<string>).changes).not.toHaveLength(0);

        rootSash.dispatchEvent(pointerEvent("pointermove", 300, 80));
        await settleFrame();
        const back = wrapper.emitted("gesture-update")!.at(-1)![0] as GridGesturePreview<string>;
        expect(back.changes).toHaveLength(0);
        expect(back.layout.sizes.left!.width).toBeCloseTo(published.sizes.left!.width, 6);
        expect(frameRect(wrapper, "left").width).toBe(Math.round(published.sizes.left!.width));
        const count = wrapper.emitted("gesture-update")!.length;

        // 已经在基线上时不重复发
        rootSash.dispatchEvent(pointerEvent("pointerup", 300, 80));
        await nextTick();
        expect(wrapper.emitted("gesture-update")).toHaveLength(count);
    });
});

/**
 * 会话层：拖动落地收起、显式恢复与提交的收口规则（不经过 DOM）。
 * 左栏固定 200（minimum 150），收起保留 32，记忆尺寸 200。
 */
describe("Grid 手势会话的收起与显式恢复", () => {
    const SESSION_EXTENT = {width: 700, height: 600};

    function collapsibleGrid(): Grid<string> {
        return createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {
                    kind: "leaf",
                    id: "left",
                    ref: "left",
                    size: {width: 200, height: 0},
                    minimumSize: {width: 150, height: 0},
                    sizing: "fixed",
                    collapse: {collapsedSize: 32, restoreSize: 200, collapseThreshold: 24, expandThreshold: 24, collapsed: false},
                },
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 499, height: 0}},
            ],
        }, {sashSize: SASH});
    }

    function openSession(grid: Grid<string>): GridGestureSession<string> {
        return createGridGestureSession<string>({
            sessionId: "session-1",
            contextKey: "grid-session",
            source: "pointer",
            revision: 2,
            root: grid.root(),
            extent: SESSION_EXTENT,
            layout: grid.layout(SESSION_EXTENT),
            sashSize: SASH,
            sashes: [{branchId: "root", index: 0, axis: "width"}],
        });
    }

    it("拖动越过收起阈值：预览与提交都带上面板的收起状态", () => {
        const session = openSession(collapsibleGrid());
        const preview = session.update({x: -160, y: 0});
        expect(preview?.changes[0]).toMatchObject({
            target: {left: 32, editor: 667},
            collapsed: {left: true},
            active: ["left", "editor"],
        });

        const commit = session.finish();
        expect(commit?.changes[0]).toMatchObject({target: {left: 32, editor: 667}, collapsed: {left: true}});
    });

    it("Enter 显式恢复提交记忆尺寸，不被最后一次位移重解覆盖", () => {
        const session = openSession(collapsibleGrid());
        expect(session.update({x: -160, y: 0})).not.toBeNull();

        // 显式恢复回到记忆尺寸 200；按 −160 重解会再次收起到 32
        expect(session.toggleCollapsed()?.changes[0]).toMatchObject({target: {left: 200, editor: 499}, collapsed: {left: false}});
        expect(session.finish()?.changes[0]).toMatchObject({target: {left: 200, editor: 499}, collapsed: {left: false}});
    });

    it("没有真实变化的手势不产生提交", () => {
        const session = openSession(collapsibleGrid());
        expect(session.update({x: -20, y: 0})).not.toBeNull();
        // 回到按下基线：净变化为零
        expect(session.update({x: 0, y: 0})).toBeNull();
        expect(session.finish()).toBeNull();
    });
});

/**
 * 吸收余量的叶（`sizing` 为缺省的 weight）同样能带收起意图：工作台用它把“面板拖到顶”做成编辑器拖到零。
 * 纵向分支：编辑器 600（minimum 120，收起到 0），面板固定 200、没有上限，中间 1px。
 */
describe("余量叶的收起", () => {
    const EXTENT = {width: 700, height: 801};

    function column(editorCollapsed: boolean): Grid<string> {
        return createGrid<string>({
            kind: "branch",
            id: "column",
            orientation: "vertical",
            children: [
                {
                    kind: "leaf",
                    id: "editor",
                    ref: "editor",
                    size: {width: 700, height: editorCollapsed ? 0 : 600},
                    minimumSize: {width: 0, height: 120},
                    collapse: {collapsedSize: 0, restoreSize: 600, collapseThreshold: 24, expandThreshold: 24, collapsed: editorCollapsed},
                },
                {kind: "leaf", id: "panel", ref: "panel", size: {width: 700, height: editorCollapsed ? 800 : 200}, minimumSize: {width: 0, height: 80}, sizing: "fixed"},
            ],
        }, {sashSize: SASH});
    }

    function open(grid: Grid<string>): GridGestureSession<string> {
        return createGridGestureSession<string>({
            sessionId: "session-weight",
            contextKey: "grid-weight",
            source: "pointer",
            revision: 1,
            root: grid.root(),
            extent: EXTENT,
            layout: grid.layout(EXTENT),
            sashSize: SASH,
            sashes: [{branchId: "column", index: 0, axis: "height"}],
        });
    }

    it("往上拖到编辑器低于 minimum − 阈值时吸附成 0，面板占满；拖回 minimum 以上又展开", () => {
        const session = open(column(false));
        expect(session.update({x: 0, y: -400})?.changes[0]).toMatchObject({target: {editor: 200, panel: 600}});
        // 理想高度 80 < 120 − 24：吸附
        expect(session.update({x: 0, y: -520})?.changes[0]).toMatchObject({target: {editor: 0, panel: 800}, collapsed: {editor: true}});
        // 理想高度 100 仍在阈值内：保持收起，几何不变
        expect(session.update({x: 0, y: -500})?.changes[0]).toMatchObject({target: {editor: 0, panel: 800}, collapsed: {editor: true}});
        // 回到 minimum 以上：展开，跟着指针
        const back = session.update({x: 0, y: -440})?.changes[0];
        expect(back).toMatchObject({target: {editor: 160, panel: 640}});
        expect(back?.collapsed).toEqual({});
        expect(session.finish()?.changes[0]).toMatchObject({target: {editor: 160, panel: 640}});
    });

    it("两侧都可收起时，Enter 跳过标了只经拖动的余量叶，恢复另一侧拖到零的面板", () => {
        const grid = createGrid<string>({
            kind: "branch",
            id: "column",
            orientation: "vertical",
            children: [
                {
                    kind: "leaf",
                    id: "editor",
                    ref: "editor",
                    size: {width: 700, height: 800},
                    minimumSize: {width: 0, height: 120},
                    collapse: {collapsedSize: 0, restoreSize: 600, collapseThreshold: 24, expandThreshold: 24, collapsed: false, toggleable: false},
                },
                {
                    kind: "leaf",
                    id: "panel",
                    ref: "panel",
                    size: {width: 700, height: 200},
                    minimumSize: {width: 0, height: 80},
                    sizing: "fixed",
                    collapse: {collapsedSize: 0, restoreSize: 200, collapseThreshold: 24, expandThreshold: 24, collapsed: true},
                },
            ],
        }, {sashSize: SASH});
        const session = open(grid);
        expect(session.toggleCollapsed()?.changes[0]).toMatchObject({target: {editor: 600, panel: 200}, collapsed: {panel: false}});
    });

    it("两侧都可收起、同一帧里一侧要展开另一侧要收起：一次求解就到位，同一位移重复输入结果不变", () => {
        // 面板拖到零（0），编辑器 800：一次往上 800，面板要展开、编辑器要收起
        const fromZero = (): Grid<string> => createGrid<string>({
            kind: "branch",
            id: "column",
            orientation: "vertical",
            children: [
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 700, height: 800}, minimumSize: {width: 0, height: 120}, collapse: {collapsedSize: 0, restoreSize: 600, collapseThreshold: 24, expandThreshold: 24, collapsed: false, toggleable: false}},
                {kind: "leaf", id: "panel", ref: "panel", size: {width: 700, height: 200}, minimumSize: {width: 0, height: 80}, sizing: "fixed", collapse: {collapsedSize: 0, restoreSize: 200, collapseThreshold: 24, expandThreshold: 24, collapsed: true}},
            ],
        }, {sashSize: SASH});
        const up = open(fromZero());
        const first = up.update({x: 0, y: -800})?.changes[0];
        expect(first).toMatchObject({target: {editor: 0, panel: 800}, collapsed: {editor: true, panel: false}});
        expect(up.update({x: 0, y: -800})?.changes[0]).toMatchObject({target: first!.target, collapsed: first!.collapsed});

        // 反过来：编辑器收着（最大化）、面板 800，一次往下 800，编辑器要展开、面板要收起
        const maximized = (): Grid<string> => createGrid<string>({
            kind: "branch",
            id: "column",
            orientation: "vertical",
            children: [
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 700, height: 0}, minimumSize: {width: 0, height: 120}, collapse: {collapsedSize: 0, restoreSize: 600, collapseThreshold: 24, expandThreshold: 24, collapsed: true, toggleable: false}},
                {kind: "leaf", id: "panel", ref: "panel", size: {width: 700, height: 800}, minimumSize: {width: 0, height: 80}, sizing: "fixed", collapse: {collapsedSize: 0, restoreSize: 200, collapseThreshold: 24, expandThreshold: 24, collapsed: false}},
            ],
        }, {sashSize: SASH});
        const down = open(maximized());
        expect(down.update({x: 0, y: 800})?.changes[0]).toMatchObject({target: {editor: 800, panel: 0}, collapsed: {editor: false, panel: true}});
    });

    it("从收起的编辑器往下拖：不到 minimum 保持收起，越过就展开并提交展开", () => {
        const session = open(column(true));
        expect(session.update({x: 0, y: 60})).toBeNull();
        const expanded = session.update({x: 0, y: 150})?.changes[0];
        expect(expanded).toMatchObject({target: {editor: 150, panel: 650}, collapsed: {editor: false}});
        expect(session.finish()?.changes[0]).toMatchObject({target: {editor: 150, panel: 650}, collapsed: {editor: false}});
    });
});

/**
 * 键盘层把 Enter 与方向/Home/End 拆成两场互不混用的会话：一场只做一件事，抬起才提交一次，
 * 期间另一类键不参与（否则 Enter 的显式恢复会被随后的绝对位移重新收回，或反之）。
 */
describe("键盘会话：Enter 与方向键互不混用", () => {
    function keyboardEvent(element: HTMLElement, type: "keydown" | "keyup", key: string): void {
        element.dispatchEvent(new KeyboardEvent(type, {key, bubbles: true, cancelable: true}));
    }

    /** 单接缝几何桩：scope 根盒读布局盒，root:0 给一条真实矩形，否则命中判定落空。 */
    function stubSingleSash(wrapper: VueWrapper): void {
        const scope = wrapper.get<HTMLElement>("[data-grid-scope]").element;
        stubRect(scope, {left: 0, top: 0, right: CONTAINER.width, bottom: CONTAINER.height});
        Object.defineProperty(scope, "clientWidth", {value: CONTAINER.width, configurable: true});
        Object.defineProperty(scope, "clientHeight", {value: CONTAINER.height, configurable: true});
        stubRect(wrapper.get<HTMLElement>('[data-sash="root:0"]').element, {left: 200, top: 0, right: 201, bottom: CONTAINER.height});
    }

    function collapsibleRoot(): Grid<string> {
        return createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {
                    kind: "leaf",
                    id: "left",
                    ref: "left",
                    size: {width: 200, height: 0},
                    minimumSize: {width: 150, height: 0},
                    sizing: "fixed",
                    collapse: {collapsedSize: 32, restoreSize: 200, collapseThreshold: 24, expandThreshold: 24, collapsed: false},
                },
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 499, height: 0}},
            ],
        }, {sashSize: SASH});
    }

    it("Enter 一场会话只翻一次：重复按下与方向键都不参与，抬起提交一次", async () => {
        const grid = collapsibleRoot();
        const commits: GridGestureCommit[] = [];
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {
            onGestureCommit: (commit) => {
                commits.push(commit);
                return {ok: true};
            },
        });
        stubSingleSash(wrapper);
        await nextTick();
        const sash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;

        keyboardEvent(sash, "keydown", "Enter");
        await nextTick();
        const updates = wrapper.emitted("gesture-update")!;
        expect(updates).toHaveLength(1);
        expect((updates[0]![0] as GridGesturePreview<string>).changes[0]).toMatchObject({collapsed: {left: true}});

        // 自动重复的 Enter 不再翻，也不重发预览
        keyboardEvent(sash, "keydown", "Enter");
        await nextTick();
        expect(wrapper.emitted("gesture-update")).toHaveLength(1);

        // Enter 会话期间方向键不参与：不把绝对位移喂进这场会话
        keyboardEvent(sash, "keydown", "ArrowRight");
        await nextTick();
        expect(wrapper.emitted("gesture-update")).toHaveLength(1);

        keyboardEvent(sash, "keyup", "Enter");
        await nextTick();
        expect(commits).toHaveLength(1);
        expect(commits[0]!.source).toBe("keyboard");
        expect(commits[0]!.changes[0]).toMatchObject({collapsed: {left: true}});
    });

    it("方向会话期间 Enter 不参与，抬起只提交一次方向位移", async () => {
        const grid = collapsibleRoot();
        const commits: GridGestureCommit[] = [];
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {
            onGestureCommit: (commit) => {
                commits.push(commit);
                return {ok: true};
            },
        });
        stubSingleSash(wrapper);
        await nextTick();
        const sash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;

        keyboardEvent(sash, "keydown", "ArrowRight");
        await nextTick();
        expect(wrapper.emitted("gesture-update")).toHaveLength(1);

        // 方向会话期间按下并抬起 Enter：既不翻收起状态，也不提前结算别人的会话
        keyboardEvent(sash, "keydown", "Enter");
        keyboardEvent(sash, "keyup", "Enter");
        await nextTick();
        expect(wrapper.emitted("gesture-update")).toHaveLength(1);
        expect(wrapper.emitted("gesture-end")).toBeUndefined();

        keyboardEvent(sash, "keyup", "ArrowRight");
        await nextTick();
        expect(commits).toHaveLength(1);
        expect(commits[0]!.changes[0]!.collapsed).toEqual({});
    });
});

describe("NestedGrid 内容层", () => {
    const CONTENT_GRID = () => createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
        {kind: "leaf", id: "a", ref: "a", size: {width: 500, height: 0}},
        {kind: "leaf", id: "b", ref: "b", size: {width: 500, height: 0}},
    ]}, {sashSize: SASH});

    function mountContents(contents: ReadonlyArray<{key: string; leaf: string; insetTop: number; active: boolean}>) {
        const grid = CONTENT_GRID();
        const wrapper = mount(NestedGrid, {
            attachTo: attachContainer(),
            props: {node: grid.root(), layout: grid.layout(CONTAINER), contents},
            slots: {content: ({contentKey}: {contentKey: string}) => h("button", {"data-inside": contentKey}, contentKey)},
        });
        wrappers.push(wrapper);
        return wrapper;
    }

    it("内容和外框是同一父元素的子元素；换叶不重建内容，不换父元素", async () => {
        const wrapper = mountContents([{key: "x", leaf: "a", insetTop: 32, active: true}]);
        const element = wrapper.get("[data-content='x']").element;
        expect(element.parentElement).toBe(wrapper.get("[data-leaf='a']").element.parentElement);
        expect(element.getAttribute("data-content-leaf")).toBe("a");
        const button = wrapper.get("[data-inside='x']").element;
        await wrapper.setProps({contents: [{key: "x", leaf: "b", insetTop: 32, active: true}]});
        expect(wrapper.get("[data-content='x']").element).toBe(element);
        expect(wrapper.get("[data-inside='x']").element).toBe(button);
        expect(element.getAttribute("data-content-leaf")).toBe("b");
    });

    it("不活动的、叶找不到的按停放处理：不卸载，隐藏且 inert", async () => {
        const wrapper = mountContents([{key: "x", leaf: "a", insetTop: 32, active: false}, {key: "y", leaf: "gone", insetTop: 32, active: true}]);
        for (const key of ["x", "y"]) {
            const element = wrapper.get(`[data-content='${key}']`).element as HTMLElement;
            expect(element.style.visibility).toBe("hidden");
            expect(element.hasAttribute("inert")).toBe(true);
            expect(wrapper.find(`[data-inside='${key}']`).exists()).toBe(true);
        }
    });

    it("内容要被停放而焦点在里面时发 content-parked，这时焦点还在；焦点在别处不发", async () => {
        const wrapper = mountContents([{key: "x", leaf: "a", insetTop: 32, active: true}, {key: "y", leaf: "b", insetTop: 32, active: true}]);
        (wrapper.get("[data-inside='x']").element as HTMLElement).focus();
        await wrapper.setProps({contents: [{key: "x", leaf: "a", insetTop: 32, active: false}, {key: "y", leaf: "b", insetTop: 32, active: false}]});
        expect(wrapper.emitted("content-parked")).toEqual([["x"]]);
    });

    it("拿起的内容项：矩形直接写在元素上，无关的重渲染不跳回去；放下回到叶的矩形", async () => {
        const wrapper = mountContents([{key: "x", leaf: "a", insetTop: 32, active: true}]);
        const element = wrapper.get("[data-content='x']").element as HTMLElement;
        const grid = wrapper.vm as unknown as {placeLifted(rect: {x: number; y: number; width: number; height: number}): void};
        // 挂上之后才量到容器，叶的矩形这时才定。
        await wrapper.setProps({revision: 1});
        const before = {left: element.style.left, top: element.style.top};
        expect(element.style.transform).toBe("");
        grid.placeLifted({x: 11, y: 22, width: 33, height: 44});
        await wrapper.setProps({lifted: {key: "x"}});
        expect(element.hasAttribute("data-lifted")).toBe(true);
        // 跟手的位置在 transform 上，left/top 归零。
        expect(element.style.transform).toBe("translate(11px, 22px)");
        expect([element.style.left, element.style.top]).toEqual(["0px", "0px"]);
        grid.placeLifted({x: 15, y: 25, width: 33, height: 44});
        expect(element.style.transform).toBe("translate(15px, 25px)");
        expect(element.style.width).toBe("33px");
        // 内层不写尺寸，按样式撑满卡片（跟着卡片重排）；放下时一次写回叶的尺寸。
        const body = element.querySelector<HTMLElement>(".nb-grid-content__body");
        expect([body?.style.width, body?.style.height]).toEqual(["", ""]);
        await wrapper.setProps({revision: 2});
        expect(element.style.transform).toBe("translate(15px, 25px)");
        await wrapper.setProps({lifted: null});
        expect(element.style.transform).toBe("");
        expect({left: element.style.left, top: element.style.top}).toEqual(before);
        expect(body?.style.width).toMatch(/^[1-9][0-9]*(\.[0-9]+)?px$/u);
    });

    it("拿起的内容项并进已有的叶：那块叶刚才显示着的内容留在落地的卡片下面、不可交互，过渡结束才隐藏", async () => {
        const wrapper = mountContents([{key: "x", leaf: "a", insetTop: 32, active: true}, {key: "y", leaf: "b", insetTop: 32, active: true}]);
        wrapper.element.style.setProperty("--motion-layout", "30ms");
        const grid = wrapper.vm as unknown as {placeLifted(rect: {x: number; y: number; width: number; height: number}): void};
        await wrapper.setProps({revision: 1});
        grid.placeLifted({x: 11, y: 22, width: 33, height: 44});
        await wrapper.setProps({lifted: {key: "y"}});
        // 放下：撤卡片与提交在同一次更新里，y 进了 a、成为活动的，x 不再活动。
        await wrapper.setProps({lifted: null, contents: [{key: "x", leaf: "a", insetTop: 32, active: false}, {key: "y", leaf: "a", insetTop: 32, active: true}]});
        const kept = wrapper.get("[data-content='x']").element as HTMLElement;
        expect(kept.style.visibility).toBe("");
        expect(kept.hasAttribute("inert")).toBe(true);
        expect(wrapper.get("[data-content='y']").attributes("data-flying")).toBeDefined();
        await vi.waitFor(() => expect(kept.style.visibility).toBe("hidden"));
    });

    it("宿主把一片叶降到零（不是手势）：它停放、不可交互，过渡结束前头与内容还画着，跟着外框缩回去，结束才隐藏", async () => {
        // 宿主把隐藏的区域按拖到零画：收起是程序改的，过渡里不能先变成一张空卡片缩回去。
        // happy-dom 没有布局引擎，量到的容器是 0、矩形全为 0，判不出过渡：按仓库既有做法（`useGridLayout.dom.test.ts`）桩掉布局盒。
        // test-lint-allow spy: 只桩布局盒给出容器尺寸，不断言调用；happy-dom 没有布局引擎
        const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => CONTAINER.width);
        // test-lint-allow spy: 同上，桩布局盒的高
        const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => CONTAINER.height);
        onTestFinished(() => {
            width.mockRestore();
            height.mockRestore();
        });
        const side = (collapsed: boolean): Grid<string> => createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
            {kind: "leaf", id: "a", ref: "a", size: {width: 300, height: 0}, sizing: "fixed", collapse: {collapsedSize: 0, restoreSize: 300, collapseThreshold: 24, expandThreshold: 24, collapsed}},
            {kind: "leaf", id: "b", ref: "b", size: {width: 699, height: 0}},
        ]}, {sashSize: SASH});
        const open = side(false);
        const wrapper = mount(NestedGrid, {
            attachTo: attachContainer(),
            props: {node: open.root(), layout: open.layout(CONTAINER), contents: [{key: "x", leaf: "a", insetTop: 32, active: true}]},
            slots: {leaf: ({node}: {node: {id: string}}) => h("span", {"data-head": node.id}), content: ({contentKey}: {contentKey: string}) => h("button", {"data-inside": contentKey}, contentKey)},
        });
        wrappers.push(wrapper);
        wrapper.element.style.setProperty("--motion-layout", "30ms");
        // 第一次布局回调只记下尺寸、不过渡：先发布一次同样的布局。
        const again = side(false);
        await wrapper.setProps({node: again.root(), layout: again.layout(CONTAINER)});
        const closed = side(true);
        await wrapper.setProps({node: closed.root(), layout: closed.layout(CONTAINER)});

        const content = wrapper.get("[data-content='x']").element as HTMLElement;
        const head = wrapper.get("[data-leaf-content='a']").element as HTMLElement;
        expect(content.style.visibility).toBe("");
        expect(content.hasAttribute("inert")).toBe(true);
        expect(head.style.visibility).toBe("");
        expect(wrapper.get("[data-leaf='a']").attributes("inert")).toBeDefined();
        // 离开的叶才带 `data-leaving`：这片叶还在树里。
        expect(wrapper.get("[data-leaf='a']").attributes("data-leaving")).toBeUndefined();
        await vi.waitFor(() => expect(content.style.visibility).toBe("hidden"));
        expect(head.style.visibility).toBe("hidden");
    });

    it("分隔线的 aria-controls 列外框与活动内容", () => {
        const wrapper = mountContents([{key: "x", leaf: "a", insetTop: 32, active: true}]);
        const controls = wrapper.get("[data-sash]").attributes("aria-controls")?.split(" ") ?? [];
        expect(controls).toContain(wrapper.get("[data-leaf='a']").attributes("id"));
        expect(controls).toContain(wrapper.get("[data-content='x']").attributes("id"));
    });

    it("外框和内容都不接焦点：点空白时焦点落在它们上面会打断内部滚动区的键盘滚动", () => {
        const wrapper = mountContents([{key: "x", leaf: "a", insetTop: 32, active: true}]);
        expect(wrapper.get("[data-leaf='a']").attributes("tabindex")).toBeUndefined();
        expect(wrapper.get("[data-content='x']").attributes("tabindex")).toBeUndefined();
    });

    it("开局就收成标题行（内容矩形从第一帧就是零高）：停放，不进 Tab 顺序", () => {
        const wrapper = mountContents([{key: "x", leaf: "a", insetTop: CONTAINER.height, active: true}]);
        const element = wrapper.get("[data-content='x']").element as HTMLElement;
        expect(element.style.visibility).toBe("hidden");
        expect(element.hasAttribute("inert")).toBe(true);
    });

    it("Shadow DOM 里也发 content-parked", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const shadow = host.attachShadow({mode: "open"});
        const mountPoint = document.createElement("div");
        shadow.append(mountPoint);
        const grid = CONTENT_GRID();
        const wrapper = mount(NestedGrid, {
            attachTo: mountPoint,
            props: {node: grid.root(), layout: grid.layout(CONTAINER), contents: [{key: "x", leaf: "a", insetTop: 32, active: true}]},
            slots: {content: () => h("button", {"data-inside": "x"}, "x")},
        });
        wrappers.push(wrapper);
        (shadow.querySelector("[data-inside='x']") as HTMLElement).focus();
        await wrapper.setProps({contents: [{key: "x", leaf: "a", insetTop: 32, active: false}]});
        expect(wrapper.emitted("content-parked")).toEqual([["x"]]);
        host.remove();
    });

    it("不传内容时没有内容层", () => {
        const grid = CONTENT_GRID();
        const wrapper = mount(NestedGrid, {attachTo: attachContainer(), props: {node: grid.root(), layout: grid.layout(CONTAINER)}});
        wrappers.push(wrapper);
        expect(wrapper.find("[data-content]").exists()).toBe(false);
    });
});

describe("NestedGrid 浮动窗", () => {
    const grid = () => createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
        {kind: "leaf", id: "a", ref: "a", size: {width: 500, height: 0}},
        {kind: "leaf", id: "b", ref: "b", size: {width: 499, height: 0}},
    ]}, {sashSize: SASH});
    const FLOAT = {id: "f", rect: {x: 100, y: 50, width: 300, height: 200}};

    function mountFloats(props: Record<string, unknown>) {
        const g = grid();
        const wrapper = mount(NestedGrid, {
            attachTo: attachContainer(),
            props: {node: g.root(), layout: g.layout(CONTAINER), contents: [{key: "x", leaf: "f", insetTop: 32, active: true}], floats: [FLOAT], ...props},
            slots: {
                leaf: ({node}: {node: {id: string}}) => h("div", {class: "leaf-body"}, node.id),
                content: ({contentKey}: {contentKey: string}) => h("div", {class: "content-body"}, contentKey),
                "float-chrome": ({id}: {id: string}) => h("div", {class: "chrome-body"}, id),
                empty: () => null,
            },
        });
        wrappers.push(wrapper);
        return wrapper;
    }

    it("窗是一块叶：矩形是给的，内容减去头归它；手柄是网格根的直接子元素，叠在内容上面", () => {
        const wrapper = mountFloats({});
        const frame = wrapper.get("[data-leaf=\"f\"]").element as HTMLElement;
        expect(frame.hasAttribute("data-float")).toBe(true);
        expect([frame.style.left, frame.style.top]).toEqual(["100px", "50px"]);
        expect(frame.style.width).toBe("300px");
        const content = wrapper.get("[data-content=\"x\"]").element as HTMLElement;
        expect(content.getAttribute("data-content-leaf")).toBe("f");
        expect(content.hasAttribute("data-float")).toBe(true);
        expect([content.style.left, content.style.top]).toEqual(["100px", "82px"]);
        const chrome = wrapper.get("[data-float-chrome=\"f\"]").element as HTMLElement;
        expect(chrome.parentElement).toBe(wrapper.element);
        expect(Number(chrome.style.zIndex)).toBeGreaterThan(Number(content.style.zIndex));
        expect(Number(content.style.zIndex)).toBeGreaterThan(Number(frame.style.zIndex));
    });

    it("拖动中挪窗：外框、内容、手柄一起挪，矩形不变；重渲染不丢，null 回到原处", async () => {
        const wrapper = mountFloats({});
        const grid = wrapper.vm as unknown as {placeFloat(id: string, offset: {x: number; y: number} | null): void};
        const parts = ["[data-leaf=\"f\"]", "[data-content=\"x\"]", "[data-float-chrome=\"f\"]"].map((selector) => wrapper.get(selector).element as HTMLElement);
        grid.placeFloat("f", {x: 7, y: 9});
        for (const part of parts) expect(part.style.translate).toBe("7px 9px");
        expect([parts[0]?.style.left, parts[0]?.style.top]).toEqual(["100px", "50px"]);
        await wrapper.setProps({revision: 1});
        for (const part of parts) expect(part.style.translate).toBe("7px 9px");
        grid.placeFloat("f", null);
        for (const part of parts) expect(part.style.translate).toBe("");
    });

    it("后面的压在前面的上面：换次序只改层级，不搬节点", async () => {
        const other = {id: "g", rect: {x: 0, y: 0, width: 100, height: 100}};
        const wrapper = mountFloats({floats: [FLOAT, other], contents: []});
        const frame = wrapper.get("[data-leaf=\"f\"]").element as HTMLElement;
        const below = Number(frame.style.zIndex);
        expect(Number((wrapper.get("[data-leaf=\"g\"]").element as HTMLElement).style.zIndex)).toBeGreaterThan(below);
        await wrapper.setProps({floats: [other, FLOAT]});
        expect(wrapper.get("[data-leaf=\"f\"]").element).toBe(frame);
        expect(Number(frame.style.zIndex)).toBeGreaterThan(below);
    });

    it("最大化：窗不算被盖住，别的叶才算", () => {
        const wrapper = mountFloats({maximized: {leaf: "a", exclude: []}});
        expect(wrapper.get("[data-leaf=\"f\"]").attributes("inert")).toBeUndefined();
        expect(wrapper.get("[data-leaf=\"b\"]").attributes("inert")).toBeDefined();
        expect(wrapper.get("[data-content=\"x\"]").attributes("inert")).toBeUndefined();
    });

    it("只有窗的矩形变了不过渡；窗在移动时不接指针的标记写在外框与内容上", async () => {
        const wrapper = mountFloats({});
        wrapper.element.style.setProperty("--motion-layout", "470ms");
        await wrapper.setProps({floats: [{...FLOAT, rect: {...FLOAT.rect, x: 400}, gesture: "move"}]});
        await nextTick();
        expect(wrapper.findAll("[data-moving]")).toHaveLength(0);
        expect(wrapper.get("[data-leaf=\"f\"]").attributes("data-float-gesture")).toBe("move");
        expect(wrapper.get("[data-content=\"x\"]").attributes("data-float-gesture")).toBe("move");
    });
});

describe("NestedGrid 交换", () => {
    /** 侧栏一列放一组叶（A 两块，B 一块），右边是主区；每块叶一个内容项。 */
    const column = (group: readonly string[]): Grid<string> => createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
        group.length === 1
            ? {kind: "leaf", id: group[0] as string, ref: group[0] as string, size: {width: 300, height: 0}}
            : {kind: "branch", id: "side", orientation: "vertical", size: {width: 300, height: 0}, children: group.map((id) => ({kind: "leaf" as const, id, ref: id, size: {width: 0, height: 300}}))},
        {kind: "leaf", id: "main", ref: "main", size: {width: 699, height: 0}},
    ]}, {sashSize: SASH});
    const A = ["a1", "a2"];
    const B = ["b1"];
    const contents = [...A, ...B, "main"].map((leaf) => ({key: `view-${leaf}`, leaf, insetTop: 32, active: true}));
    const swap = (token: number, leaving: string[], entering: string[]) => ({token, leaving, entering, axis: "height" as const, direction: 1 as const, gap: 8});

    async function mountColumn(motion = "30ms", extraSlots: Record<string, (props: never) => unknown> = {}) {
        // happy-dom 没有布局引擎：按仓库既有做法（`useGridLayout.dom.test.ts`）桩掉布局盒，给出容器尺寸。
        // test-lint-allow spy: 只桩布局盒给出容器尺寸，不断言调用；happy-dom 没有布局引擎
        const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => CONTAINER.width);
        // test-lint-allow spy: 同上，桩布局盒的高
        const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => CONTAINER.height);
        onTestFinished(() => {
            width.mockRestore();
            height.mockRestore();
        });
        const start = column(A);
        const wrapper = mount(NestedGrid, {
            attachTo: attachContainer(),
            props: {node: start.root(), layout: start.layout(CONTAINER), contents},
            slots: {content: ({contentKey}: {contentKey: string}) => h("button", {"data-inside": contentKey}, contentKey), ...extraSlots},
        });
        wrappers.push(wrapper);
        wrapper.element.style.setProperty("--motion-layout", motion);
        // 第一次布局回调只记下尺寸、不过渡：先发布一次同样的布局。
        const again = column(A);
        await wrapper.setProps({node: again.root(), layout: again.layout(CONTAINER)});
        return wrapper;
    }
    const toB = () => {
        const next = column(B);
        return {node: next.root(), layout: next.layout(CONTAINER)};
    };

    it("离开的一组提交那一刻停放、焦点交出，过渡结束前还画着；组里的分隔线留着、不能拖；换上来的标 in", async () => {
        const wrapper = await mountColumn();
        (wrapper.get("[data-inside='view-a1']").element as HTMLElement).focus();
        await wrapper.setProps({swap: swap(1, A, B), ...toB()});
        expect(wrapper.emitted("content-parked")).toEqual([["view-a1"]]);
        const leaving = wrapper.get("[data-leaf='a1']");
        expect(leaving.attributes("data-swap")).toBe("out");
        expect(leaving.attributes("inert")).toBeDefined();
        const content = wrapper.get("[data-content='view-a1']").element as HTMLElement;
        expect(content.hasAttribute("inert")).toBe(true);
        expect(content.style.visibility).toBe("");
        expect(wrapper.get("[data-leaf='b1']").attributes("data-swap")).toBe("in");
        expect(wrapper.get("[data-content='view-b1']").attributes("data-swap")).toBe("in");
        const sash = wrapper.findAll(".nb-grid-sash").find((item) => item.attributes("data-swap") === "out");
        expect(sash?.attributes("aria-disabled")).toBe("true");
        expect(sash?.attributes("data-leaving")).toBeDefined();
        // 主区不在带上。
        expect(wrapper.get("[data-leaf='main']").attributes("data-swap")).toBeUndefined();
        const exposed = wrapper.vm as unknown as {swappingLeaves: ReadonlySet<string>};
        expect([...exposed.swappingLeaves].sort()).toEqual(["a1", "a2", "b1"]);
        await vi.waitFor(() => expect(wrapper.find("[data-leaf='a1']").exists()).toBe(false));
        expect(wrapper.find("[data-swap]").exists()).toBe(false);
        expect(exposed.swappingLeaves.size).toBe(0);
    });

    it("静止的底：交换进行中在所有外框下面、铺满两组外框的外接矩形，拿到裁切窗的内缩与圆角；交换结束就摘掉", async () => {
        const wrapper = await mountColumn("30ms", {
            "swap-backdrop": (({inset, radius}: {inset: readonly number[]; radius: readonly string[] | null}) => h("i", {"data-backdrop-inset": inset.join(","), "data-backdrop-radius": radius?.join(",") ?? ""})) as (props: never) => unknown,
        });
        expect(wrapper.find("[data-swap-backdrop]").exists()).toBe(false);
        const radius = ["0px", "12px", "12px", "0px"] as const;
        await wrapper.setProps({swap: {...swap(1, A, B), window: {inset: [4, 2, 4, 0], radius}}, ...toB()});
        const backdrop = wrapper.get("[data-swap-backdrop]");
        const style = (backdrop.element as HTMLElement).style;
        expect({left: style.left, top: style.top, width: style.width, height: style.height}).toEqual({left: "0px", top: "0px", width: "300px", height: `${String(CONTAINER.height)}px`});
        expect(backdrop.get("[data-backdrop-inset]").attributes()).toMatchObject({"data-backdrop-inset": "4,2,4,0", "data-backdrop-radius": radius.join(",")});
        // 在所有外框之前（外框按 DOM 序叠在它上面）。
        const order = [...wrapper.element.children].filter((element) => element.matches("[data-swap-backdrop], .nb-grid-frame"));
        expect(order[0]?.hasAttribute("data-swap-backdrop")).toBe(true);
        await vi.waitFor(() => expect(wrapper.find("[data-leaf='a1']").exists()).toBe(false));
        expect(wrapper.find("[data-swap-backdrop]").exists()).toBe(false);
    });

    it("`moving`：过渡在走时为真、结束为假；时长为 0（减少动态效果）时一轮过渡都不开，一直为假", async () => {
        const wrapper = await mountColumn();
        const exposed = wrapper.vm as unknown as {moving: boolean};
        expect(exposed.moving).toBe(false);
        await wrapper.setProps({swap: swap(1, A, B), ...toB()});
        expect(exposed.moving).toBe(true);
        await vi.waitFor(() => expect(exposed.moving).toBe(false));

        const still = await mountColumn("0ms");
        const stillExposed = still.vm as unknown as {moving: boolean};
        await still.setProps({swap: swap(1, A, B), ...toB()});
        expect(stillExposed.moving).toBe(false);
        expect(still.find("[data-leaf='a1']").exists()).toBe(false);
    });

    it("给了交换但这一轮没有布局变化：作废，后面的布局变化照常过渡，不滑", async () => {
        const wrapper = await mountColumn();
        await wrapper.setProps({swap: swap(1, A, B)});
        await nextTick();
        await wrapper.setProps(toB());
        expect(wrapper.find("[data-swap]").exists()).toBe(false);
        // 照常过渡：被顶替的旧叶立即消失，不留着。
        expect(wrapper.find("[data-leaf='a1']").exists()).toBe(false);
        expect(wrapper.emitted("issues")).toBeUndefined();
    });

    it("宿主列的叶对不上呈现、忽略之后为空：照常过渡，经 issues 交回原因", async () => {
        const wrapper = await mountColumn();
        await wrapper.setProps({swap: swap(1, ["hidden"], B), ...toB()});
        expect(wrapper.find("[data-swap]").exists()).toBe(false);
        expect(emittedIssues(wrapper)).toEqual([{code: "swap-skipped", cause: "no-leaving"}]);
    });

    it("滑到一半点回去：同一分支同一序号的线一条滑出去、一条回来，回来的那条照样能拖；滑出去的线对读屏隐藏", async () => {
        const wrapper = await mountColumn();
        const C = ["c1", "c2"];
        const toC = column(C);
        // A 与 C 的分节都在分支 side 里：两条线都是 side:0。
        await wrapper.setProps({swap: swap(1, A, C), node: toC.root(), layout: toC.layout(CONTAINER)});
        const out = wrapper.findAll(".nb-grid-sash").find((item) => item.attributes("data-swap") === "out");
        expect(out?.attributes("aria-hidden")).toBe("true");
        expect(out?.attributes("inert")).toBeDefined();
        const back = column(A);
        await wrapper.setProps({swap: {...swap(2, C, A), direction: -1}, node: back.root(), layout: back.layout(CONTAINER)});
        await vi.waitFor(() => expect(wrapper.find("[data-swap]").exists()).toBe(false));
        const scope = wrapper.get<HTMLElement>("[data-grid-scope]").element;
        stubRect(scope, {left: 0, top: 0, right: CONTAINER.width, bottom: CONTAINER.height});
        const live = wrapper.get<HTMLElement>('[data-sash="side:0"]').element;
        stubRect(live, {left: 0, top: 299, right: 300, bottom: 300});
        live.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
        await nextTick();
        expect(wrapper.emitted("gesture-start")).toBeDefined();
    });

    it("减少动态效果：直接换，不交换", async () => {
        const wrapper = await mountColumn("0ms");
        await wrapper.setProps({swap: swap(1, A, B), ...toB()});
        expect(wrapper.find("[data-swap]").exists()).toBe(false);
        expect(wrapper.find("[data-leaf='a1']").exists()).toBe(false);
    });
});
