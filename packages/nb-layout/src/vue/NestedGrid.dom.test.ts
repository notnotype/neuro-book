import {afterEach, describe, expect, it, onTestFinished, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {h, nextTick, ref} from "vue";
import NestedGrid from "./NestedGrid.vue";
import LeavingHost from "./test-fixtures/LeavingHost.vue";
import {moveGridFocus} from "./grid-focus";
import {LAYOUT_TEXT_KEY, layoutCatalogTranslate} from "./text";
import {createGrid, type Grid, type GridFailure, type GridIssue, type GridLayoutResult, type GridNode} from "../grid";
import {createGridGestureSession, type GridGestureCommit, type GridGesturePreview, type GridGestureSession} from "../grid-gesture";
import type {GridLeafShape} from "../grid-rects";

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
        // 没有注入文字：读屏名称用自带的源语言（英文）目录（输出 143）。
        expect(sash.attributes("aria-label")).toMatch(/^Resize width between left and \S+$/u);
    });

    it("文字（输出 143）：宿主经 LAYOUT_TEXT_KEY 注入时，分隔线的读屏名称与值的文字用宿主的", async () => {
        const grid = nestedGrid();
        const wrapper = mount(NestedGrid, {
            attachTo: attachContainer(),
            props: {node: grid.root(), layout: grid.layout(CONTAINER)},
            global: {provide: {[LAYOUT_TEXT_KEY as symbol]: layoutCatalogTranslate("zh-CN")}},
        });
        wrappers.push(wrapper);
        await nextTick();
        expect(wrapper.get('[data-sash="root:0"]').attributes("aria-label")).toBe("调整 left 与 right 的宽度");
        expect(wrapper.get('[data-sash="right:0"]').attributes("aria-label")).toBe("调整 top 与 bottom 的高度");
        expect(wrapper.get('[data-sash="root:0"]').attributes("aria-valuetext")).toBe("300 像素");
    });

    it("分隔线的显示名（输出 152）：读屏名称用 paneLabel 给的名字，挨着分支时问分支 id；没给、返回 undefined 或空串时用节点 id", async () => {
        const grid = nestedGrid();
        const names: Record<string, string> = {left: "导航", right: "右侧", top: ""};
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {listeners: {paneLabel: (id: string) => names[id]}});
        await nextTick();
        expect(wrapper.get('[data-sash="root:0"]').attributes("aria-label")).toBe("Resize width between 导航 and 右侧");
        // top 给的是空串、bottom 没给：都用 id。
        expect(wrapper.get('[data-sash="right:0"]').attributes("aria-label")).toBe("Resize height between top and bottom");
    });

    it("分隔线的显示名跟着宿主的语言变（输出 152）：paneLabel 是同一个函数、读宿主的语言，换语言后读屏名称跟着变", async () => {
        const grid = nestedGrid();
        const locale = ref<"zh" | "en">("zh");
        const names = {zh: {left: "导航"}, en: {left: "Navigation"}} as const;
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {listeners: {paneLabel: (id: string) => (names[locale.value] as Record<string, string>)[id]}});
        await nextTick();
        expect(wrapper.get('[data-sash="root:0"]').attributes("aria-label")).toBe("Resize width between 导航 and right");
        locale.value = "en";
        await nextTick();
        expect(wrapper.get('[data-sash="root:0"]').attributes("aria-label")).toBe("Resize width between Navigation and right");
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

    it.each([
        ["contextKey", () => ({contextKey: "other"})],
        ["revision", () => ({revision: 1})],
        ["node（节点撤销）", () => ({node: nestedGrid().root()})],
    ] as const)("手势进行中 %s 变了：取消（context-changed），不提交，之后的松手也不结算（输出 9，状态表“调整中 → 上下文失效”）", async (_label, change) => {
        for (const source of ["keyboard", "pointer"] as const) {
            const grid = nestedGrid();
            const commits: GridGestureCommit[] = [];
            const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {onGestureCommit: (commit) => {
                commits.push(commit);
                return {ok: true};
            }});
            stubLayout(wrapper);
            await nextTick();
            const innerSash = wrapper.get<HTMLElement>('[data-sash="right:0"]').element;
            if (source === "keyboard") {
                innerSash.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
            } else {
                innerSash.dispatchEvent(pointerEvent("pointerdown", 600, 300));
                innerSash.dispatchEvent(pointerEvent("pointermove", 600, 340));
                await settleFrame();
            }
            await nextTick();
            expect(wrapper.emitted("gesture-update"), source).toBeDefined();

            await wrapper.setProps(change());
            await nextTick();
            expect(wrapper.emitted("gesture-cancel")?.map((event) => (event[0] as {reason: string}).reason), source).toEqual(["context-changed"]);

            innerSash.dispatchEvent(source === "keyboard" ? new KeyboardEvent("keyup", {key: "ArrowDown", bubbles: true, cancelable: true}) : pointerEvent("pointerup", 600, 340));
            await nextTick();
            expect(wrapper.emitted("gesture-end"), source).toBeUndefined();
            expect(commits, source).toEqual([]);
            wrapper.unmount();
        }
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
        // 有效悬停立即给光标（输出 12）：宽度轴 ew-resize。
        const cursor = () => document.documentElement.getAttribute("data-nb-sash-cursor");
        expect(cursor()).toBe("ew-resize");

        // 只在内层横线的命中带内
        leaf.dispatchEvent(pointerEvent("pointermove", 600, 302));
        await nextTick();
        expect(innerSash.getAttribute("data-sash-hover")).toBe("true");
        expect(rootSash.hasAttribute("data-sash-hover")).toBe(false);
        expect(cursor()).toBe("ns-resize");

        // 交点：两条命中带同时包含指针
        leaf.dispatchEvent(pointerEvent("pointermove", 302, 302));
        await nextTick();
        expect(rootSash.getAttribute("data-sash-cross")).toBe("true");
        expect(innerSash.getAttribute("data-sash-cross")).toBe("true");
        // 同 scope 双轴：move。
        expect(cursor()).toBe("move");

        // 离开所有分界线：状态清空
        leaf.dispatchEvent(pointerEvent("pointermove", 500, 500));
        await nextTick();
        expect(wrapper.findAll("[data-sash-hover]")).toHaveLength(0);
        expect(wrapper.findAll("[data-sash-cross]")).toHaveLength(0);
        expect(cursor()).toBeNull();
    });

    it("交汇处增减命中不重置停留计时（输出 13）：竖线上停 150ms 再移到交点停 100ms，满 250ms 就显现，中途不闪", async () => {
        // test-lint-allow fake-timer: 停留计时用窗口的 setTimeout，没有注入时钟的入口；同 splitter.dom.test.ts 的悬停用例
        vi.useFakeTimers({toFake: ["setTimeout", "clearTimeout"]});
        onTestFinished(() => void vi.useRealTimers());
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));
        stubLayout(wrapper);
        await nextTick();
        const rootSash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        const innerSash = wrapper.get<HTMLElement>('[data-sash="right:0"]').element;
        const leaf = wrapper.get<HTMLElement>("[data-leaf='top']").element;

        leaf.dispatchEvent(pointerEvent("pointermove", 302, 100));
        await nextTick();
        await vi.advanceTimersByTimeAsync(150);
        // 移到交点：命中多了横线，计时接着走。
        leaf.dispatchEvent(pointerEvent("pointermove", 302, 302));
        await nextTick();
        await vi.advanceTimersByTimeAsync(99);
        expect(rootSash.hasAttribute("data-sash-revealed")).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await nextTick();
        expect([rootSash.getAttribute("data-sash-revealed"), innerSash.getAttribute("data-sash-revealed")]).toEqual(["true", "true"]);

        // 从交点退回竖线（命中少了横线）：已显现的竖线不淡出、不重新等。
        leaf.dispatchEvent(pointerEvent("pointermove", 302, 100));
        await nextTick();
        expect(rootSash.getAttribute("data-sash-revealed")).toBe("true");
        expect(innerSash.hasAttribute("data-sash-revealed")).toBe(false);
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

    it("最大化时被盖住的分隔线不能拖（输出 99）：按下拖动不开始手势，方向键也不提交；还原后照常", async () => {
        // 还原要按量到的容器重新摆放：桩布局盒给出容器尺寸（同“降到零”那条）。
        // test-lint-allow spy: 只桩布局盒给出容器尺寸，不断言调用；happy-dom 没有布局引擎
        const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => CONTAINER.width);
        // test-lint-allow spy: 同上，桩布局盒的高
        const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => CONTAINER.height);
        onTestFinished(() => {
            width.mockRestore();
            height.mockRestore();
        });
        const grid = nestedGrid();
        const commits: GridGestureCommit[] = [];
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {onGestureCommit: (commit) => {
            commits.push(commit);
            return {ok: true};
        }});
        await wrapper.setProps({maximized: {leaf: "top", exclude: []}});
        stubLayout(wrapper);
        await nextTick();
        const rootSash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        const innerSash = wrapper.get<HTMLElement>('[data-sash="right:0"]').element;
        expect(rootSash.hasAttribute("data-obscured")).toBe(true);

        rootSash.dispatchEvent(pointerEvent("pointerdown", 300, 80));
        rootSash.dispatchEvent(pointerEvent("pointermove", 420, 80));
        await settleFrame();
        rootSash.dispatchEvent(pointerEvent("pointerup", 420, 80));
        innerSash.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
        innerSash.dispatchEvent(new KeyboardEvent("keyup", {key: "ArrowDown", bubbles: true, cancelable: true}));
        await nextTick();
        expect(wrapper.emitted("gesture-start")).toBeUndefined();
        expect(commits).toEqual([]);

        await wrapper.setProps({maximized: null});
        await nextTick();
        innerSash.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
        innerSash.dispatchEvent(new KeyboardEvent("keyup", {key: "ArrowDown", bubbles: true, cancelable: true}));
        await nextTick();
        expect(commits).toHaveLength(1);
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
                    collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed},
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

describe("嵌套的 NestedGrid（输出 24、25、131）", () => {
    /** 外层是 `nestedGrid()`；`top` 那块叶里再挂一个 NestedGrid（内层两块 i1、i2，中间一条线 inner:0）。每块叶一个按钮。 */
    function mountNested(innerDisabled = false) {
        const inner = createGrid<string>({kind: "branch", id: "inner", orientation: "horizontal", children: [
            {kind: "leaf", id: "i1", ref: "i1", size: {width: 349, height: 0}},
            {kind: "leaf", id: "i2", ref: "i2", size: {width: 349, height: 0}},
        ]}, {sashSize: SASH});
        const disabled = ref(innerDisabled);
        const innerEvents: string[] = [];
        const outer = nestedGrid();
        const button = (id: string) => h("button", {"data-button": id}, id);
        const wrapper = mount(NestedGrid, {
            attachTo: attachContainer(),
            props: {node: outer.root(), layout: outer.layout(CONTAINER), onGestureCommit: () => ({ok: true})},
            slots: {
                leaf: ({node}: {node: {id: string}}) => (node.id !== "top" ? button(node.id) : h(NestedGrid, {
                    node: inner.root(),
                    layout: inner.layout({width: 699, height: 300}),
                    disabled: disabled.value,
                    onGestureCommit: () => ({ok: true} as const),
                    onGestureStart: () => void innerEvents.push("gesture-start"),
                    onGestureEnd: () => void innerEvents.push("gesture-end"),
                    onGestureCancel: () => void innerEvents.push("gesture-cancel"),
                }, {leaf: ({node: child}: {node: {id: string}}) => button(child.id)})),
            },
        });
        wrappers.push(wrapper);
        stubLayout(wrapper);
        const innerRoot = wrapper.get<HTMLElement>("[data-leaf='top'] [data-grid-scope]").element;
        stubRect(innerRoot, {left: 301, top: 0, right: 1000, bottom: 300});
        Object.defineProperty(innerRoot, "clientWidth", {value: 699, configurable: true});
        Object.defineProperty(innerRoot, "clientHeight", {value: 300, configurable: true});
        const innerSash = wrapper.get<HTMLElement>("[data-leaf='top'] [data-sash='inner:0']").element;
        const outerEvents = (): string[] => (["gesture-start", "gesture-update", "gesture-end", "gesture-cancel"] as const).filter((name) => wrapper.emitted(name) !== undefined);
        return {wrapper, innerRoot, innerSash, innerEvents, outerEvents, disabled};
    }

    it("内层是自己的 scope（输出 24）：在内层分隔线上拖动，内层开始与结束，外层一个手势事件也没有", async () => {
        const {innerSash, innerEvents, outerEvents} = mountNested();
        stubRect(innerSash, {left: 650, top: 0, right: 651, bottom: 300});
        await nextTick();
        innerSash.dispatchEvent(pointerEvent("pointerdown", 650, 150));
        innerSash.dispatchEvent(pointerEvent("pointermove", 690, 150));
        await settleFrame();
        innerSash.dispatchEvent(pointerEvent("pointerup", 690, 150));
        await nextTick();
        expect(innerEvents).toEqual(["gesture-start", "gesture-end"]);
        expect(outerEvents()).toEqual([]);
    });

    it("内外两条线的命中带重合（输出 25）：内层赢，悬停与按下都归内层；内层禁用后才让外层", async () => {
        // 内层的线贴着外层竖线（x=300）：303 同时落在两条线的命中带里。
        const {wrapper, innerSash, innerEvents, outerEvents, disabled} = mountNested();
        stubRect(innerSash, {left: 304, top: 0, right: 305, bottom: 300});
        await nextTick();
        const outerSash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        const innerLeaf = wrapper.get<HTMLElement>("[data-leaf='i1']").element;
        innerLeaf.dispatchEvent(pointerEvent("pointermove", 303, 100));
        await nextTick();
        expect([innerSash.getAttribute("data-sash-hover"), outerSash.hasAttribute("data-sash-hover")]).toEqual(["true", false]);
        innerLeaf.dispatchEvent(pointerEvent("pointerdown", 303, 100));
        innerLeaf.dispatchEvent(pointerEvent("pointerup", 303, 100));
        await nextTick();
        expect(innerEvents).toContain("gesture-start");
        expect(outerEvents()).toEqual([]);

        disabled.value = true;
        await nextTick();
        innerLeaf.dispatchEvent(pointerEvent("pointermove", 303, 110));
        await nextTick();
        expect([innerSash.hasAttribute("data-sash-hover"), outerSash.getAttribute("data-sash-hover")]).toEqual([false, "true"]);
        innerLeaf.dispatchEvent(pointerEvent("pointerdown", 303, 110));
        innerLeaf.dispatchEvent(pointerEvent("pointerup", 303, 110));
        await nextTick();
        expect(outerEvents()).toContain("gesture-start");
    });

    it("moveGridFocus 嵌套时内层先走，走到头交给外层，最外层绕回（输出 131）", async () => {
        const {wrapper} = mountNested();
        await nextTick();
        const root = wrapper.element as HTMLElement;
        const focusOn = (id: string) => root.querySelector<HTMLElement>(`[data-button='${id}']`)?.focus();
        const focused = () => document.activeElement?.getAttribute("data-button");
        focusOn("i1");
        expect(moveGridFocus(root, "next")).toBe(true);
        expect(focused()).toBe("i2");
        expect(moveGridFocus(root, "next")).toBe(true);
        expect(focused()).toBe("bottom");
        expect(moveGridFocus(root, "next")).toBe(true);
        expect(focused()).toBe("left");
        // 往前走：从外层的 left 绕到最后一块 bottom，再进内层时落在内层那一块上次的焦点（i2）。
        expect(moveGridFocus(root, "previous")).toBe(true);
        expect(focused()).toBe("bottom");
        expect(moveGridFocus(root, "previous")).toBe(true);
        expect(root.querySelector("[data-leaf='top']")?.contains(document.activeElement)).toBe(true);
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
        // 失败 6：message 带异常的文字。
        expect(((wrapper.emitted("issues") ?? []).flat(2) as GridFailure[])[0]?.message).toContain("boom");
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

    it("not-published 每发生一次发一条（输出 140）：同样的两场各发一次，不按只发新增去重", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {onGestureCommit: () => ({ok: true})});
        await dragOnce(wrapper);
        await nextTick();
        await dragOnce(wrapper);
        await nextTick();
        expect(emittedIssues(wrapper)).toEqual([{code: "not-published"}, {code: "not-published"}]);
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
        expect(emittedIssues(wrapper).filter((issue) => issue.cause === "range-overflow")).toEqual([{code: "over-constrained", cause: "range-overflow", id: "root", axis: "width", total: 999, min: 1200}]);
        await drag();
        expect(ranges()).toBe(2);
    });

    it("gesture-update 的载荷是这一次求解的全部（输出 140）：每一帧的 `issues` 都带着，`layout.issues` 是预览布局自己的那份", async () => {
        // 交点上拖：宽这根轴能动、有预览；高这根轴两块的最小高度合计超过容器，每一帧都是 range-overflow。
        const tall = {width: 0, height: 400};
        const grid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}},
                {kind: "branch", id: "right", orientation: "vertical", size: {width: 699, height: 0}, children: [
                    {kind: "leaf", id: "top", ref: "top", size: {width: 0, height: 100}, minimumSize: tall},
                    {kind: "leaf", id: "bottom", ref: "bottom", size: {width: 0, height: 100}, minimumSize: tall},
                ]},
            ],
        }, {sashSize: SASH});
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {onGestureCommit: () => ({ok: true})});
        stubLayout(wrapper);
        await nextTick();
        const innerSash = wrapper.get<HTMLElement>('[data-sash="right:0"]').element;
        innerSash.dispatchEvent(pointerEvent("pointerdown", 302, 302));
        for (const step of [20, 40]) {
            innerSash.dispatchEvent(pointerEvent("pointermove", 302 + step, 302 + step));
            await settleFrame();
        }
        const updates = (wrapper.emitted("gesture-update") ?? []).map((event) => event[0] as GridGesturePreview<string>);
        expect(updates).toHaveLength(2);
        // 通知只发了一次，载荷每一帧都有：通知与快照是两回事。
        expect(emittedIssues(wrapper).filter((issue) => issue.cause === "range-overflow")).toHaveLength(1);
        for (const preview of updates) {
            expect(preview.issues.map((issue) => ({code: issue.code, ...issue.params}))).toContainEqual({code: "over-constrained", cause: "range-overflow", id: "right", axis: "height", total: 599, min: 800});
            // 预览布局自己的诊断：重算出来的降级（min-total），不是会话的 range-overflow。
            expect(preview.layout.issues.map((issue) => ({code: issue.code, ...issue.params}))).toContainEqual({code: "over-constrained", cause: "min-total", id: "right", axis: "height", available: 599, required: 800});
            expect(preview.layout.issues.some((issue) => issue.params?.cause === "range-overflow")).toBe(false);
        }
        innerSash.dispatchEvent(pointerEvent("pointerup", 342, 342));
        await nextTick();
    });

    it("按住方向键不放算一场（输出 140）：连发几次 keydown、一次 keyup，range-overflow 只发一次", async () => {
        const wide = {width: 600, height: 0};
        const grid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "left", ref: "left", size: {width: 300, height: 0}, minimumSize: wide},
                {kind: "leaf", id: "right", ref: "right", size: {width: 699, height: 0}, minimumSize: wide},
            ],
        }, {sashSize: SASH});
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {onGestureCommit: () => ({ok: true})});
        // 键盘不经命中判定，只要根盒的尺寸（会话按它冻结）。
        const scope = wrapper.get<HTMLElement>("[data-grid-scope]").element;
        stubRect(scope, {left: 0, top: 0, right: CONTAINER.width, bottom: CONTAINER.height});
        Object.defineProperty(scope, "clientWidth", {value: CONTAINER.width, configurable: true});
        Object.defineProperty(scope, "clientHeight", {value: CONTAINER.height, configurable: true});
        await nextTick();
        const sash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        for (let repeat = 0; repeat < 3; repeat += 1) sash.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true, repeat: repeat > 0}));
        sash.dispatchEvent(new KeyboardEvent("keyup", {key: "ArrowRight", bubbles: true, cancelable: true}));
        await nextTick();
        expect(wrapper.emitted("gesture-start")).toHaveLength(1);
        expect(emittedIssues(wrapper).filter((issue) => issue.cause === "range-overflow")).toHaveLength(1);
    });

    it("拖动途中某一帧里 gesture-update 的监听抛出（输出 140）：手势照常进行，继续移动、松手照样提交一次", async () => {
        const grid = nestedGrid();
        const commits: GridGestureCommit[] = [];
        let throws = 1;
        const errors: unknown[] = [];
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER), {
            onGestureCommit: (commit) => {
                commits.push(commit);
                return {ok: true};
            },
            listeners: {onGestureUpdate: () => {
                if (throws > 0) {
                    throws -= 1;
                    throw new Error("first frame listener threw");
                }
            }},
        });
        // 帧回调里抛出的异常不经 dispatchEvent 回来：浏览器报告它、接着跑后面的帧。happy-dom 会把它变成进程级的未处理错误，
        // 这里像浏览器那样在帧回调外面收下它，确认它照常冒出了库的回调。
        const frame = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback) => frame.call(window, (time) => {
            try {
                callback(time);
            } catch (error) {
                errors.push(error);
            }
        });
        onTestFinished(() => {
            window.requestAnimationFrame = frame;
        });
        stubLayout(wrapper);
        await nextTick();
        const rootSash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        rootSash.dispatchEvent(pointerEvent("pointerdown", 300, 80));
        rootSash.dispatchEvent(pointerEvent("pointermove", 360, 80));
        await settleFrame();
        expect(throws).toBe(0);
        rootSash.dispatchEvent(pointerEvent("pointermove", 420, 80));
        await settleFrame();
        expect(frameRect(wrapper, "left").width).toBe(420);
        rootSash.dispatchEvent(pointerEvent("pointerup", 420, 80));
        await nextTick();
        expect(commits).toHaveLength(1);
        expect(commits[0]!.changes[0]!.target.left! - commits[0]!.changes[0]!.baseline.left!).toBeCloseTo(120, 6);
        expect(errors.map((error) => String(error))).toEqual(["Error: first frame listener threw"]);
    });

    it("被拒的提交每次都发；键盘每按一次键是一场手势", async () => {
        const wide = {width: 600, height: 0};
        const grid = createGrid<string>({
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
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));
        stubLayout(wrapper);
        await nextTick();
        const rootSash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;
        for (let round = 0; round < 2; round += 1) {
            rootSash.dispatchEvent(pointerEvent("pointerdown", 300, 80));
            rootSash.dispatchEvent(pointerEvent("pointermove", 340, 80));
            await settleFrame();
            rootSash.dispatchEvent(pointerEvent("pointerup", 340, 80));
            await nextTick();
        }
        expect(emittedIssues(wrapper).filter((issue) => issue.code === "handler-missing")).toHaveLength(2);

        // 两侧的最小宽度合计超过容器：每按一次方向键都是一场新手势，range-overflow 各发一次。
        const degraded = createGrid<string>({
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
        const keyboard = mountRenderer(degraded.root(), degraded.layout(CONTAINER), {onGestureCommit: () => ({ok: true})});
        stubLayout(keyboard);
        await nextTick();
        const sash = keyboard.get<HTMLElement>('[data-sash="root:0"]').element;
        for (let press = 0; press < 2; press += 1) {
            sash.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
            sash.dispatchEvent(new KeyboardEvent("keyup", {key: "ArrowRight", bubbles: true, cancelable: true}));
            await nextTick();
        }
        expect(emittedIssues(keyboard).filter((issue) => issue.cause === "range-overflow")).toHaveLength(2);
    });
});

describe("键盘的诊断（Spec 输出 139）", () => {
    it("Enter 恢复空间不够：没有预览，照样发 no-room-to-restore", async () => {
        const grid = createGrid<string>({
            kind: "branch",
            id: "root",
            orientation: "horizontal",
            children: [
                {kind: "leaf", id: "a", ref: "a", size: {width: 950, height: 0}, minimumSize: {width: 900, height: 0}, collapse: {collapsed: true, collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24}},
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
                    collapse: {collapsedSize: 32, collapseThreshold: 24, expandThreshold: 24, collapsed: false},
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
                    collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: editorCollapsed},
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
                    collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: false, toggleable: false},
                },
                {
                    kind: "leaf",
                    id: "panel",
                    ref: "panel",
                    size: {width: 700, height: 200},
                    minimumSize: {width: 0, height: 80},
                    sizing: "fixed",
                    collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: true},
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
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 700, height: 800}, minimumSize: {width: 0, height: 120}, collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: false, toggleable: false}},
                {kind: "leaf", id: "panel", ref: "panel", size: {width: 700, height: 200}, minimumSize: {width: 0, height: 80}, sizing: "fixed", collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: true}},
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
                {kind: "leaf", id: "editor", ref: "editor", size: {width: 700, height: 0}, minimumSize: {width: 0, height: 120}, collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: true, toggleable: false}},
                {kind: "leaf", id: "panel", ref: "panel", size: {width: 700, height: 800}, minimumSize: {width: 0, height: 80}, sizing: "fixed", collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed: false}},
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
                    collapse: {collapsedSize: 32, collapseThreshold: 24, expandThreshold: 24, collapsed: false},
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

    it("方向会话里 Escape 回滚，下一场从发布的几何开始（状态表“键盘方向/Home/End”）", async () => {
        const grid = collapsibleRoot();
        const published = grid.layout(CONTAINER);
        const commits: GridGestureCommit[] = [];
        const wrapper = mountRenderer(grid.root(), published, {
            onGestureCommit: (commit) => {
                commits.push(commit);
                return {ok: true};
            },
        });
        stubSingleSash(wrapper);
        await nextTick();
        const sash = wrapper.get<HTMLElement>('[data-sash="root:0"]').element;

        keyboardEvent(sash, "keydown", "ArrowRight");
        keyboardEvent(sash, "keydown", "ArrowRight");
        await nextTick();
        expect(frameRect(wrapper, "left").width).toBe(220);
        keyboardEvent(sash, "keydown", "Escape");
        await nextTick();
        expect(wrapper.emitted("gesture-cancel")?.at(-1)?.[0]).toMatchObject({reason: "escape"});
        expect(frameRect(wrapper, "left").width).toBe(200);

        keyboardEvent(sash, "keyup", "ArrowRight");
        keyboardEvent(sash, "keydown", "ArrowRight");
        keyboardEvent(sash, "keyup", "ArrowRight");
        await nextTick();
        expect(commits).toHaveLength(1);
        const change = commits[0]!.changes[0]!;
        expect(change.baseline.left).toBeCloseTo(published.sizes.left!.width, 6);
        expect(change.target.left! - change.baseline.left!).toBeCloseTo(10, 6);
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

    it("拿起的内容项这一轮不在 contents 里（宿主的预览摘掉了来源）：网格留住它，实例不卸载；放下后按新的 contents 落到新的叶，不在了就卸载", async () => {
        const both = [{key: "x", leaf: "a", insetTop: 32, active: true}, {key: "y", leaf: "b", insetTop: 32, active: true}];
        const wrapper = mountContents(both);
        await wrapper.setProps({revision: 1});
        const inside = wrapper.get("[data-inside='x']").element;
        // 拿起与摘掉在同一次更新里：网格第一次看到 `lifted` 时这一轮已经没有 x 了。
        await wrapper.setProps({lifted: {key: "x"}, contents: [both[1]!]});
        expect(wrapper.get("[data-inside='x']").element).toBe(inside);
        expect(wrapper.get("[data-content='x']").attributes("data-lifted")).toBeDefined();
        await wrapper.setProps({revision: 2});
        expect(wrapper.get("[data-inside='x']").element).toBe(inside);
        // 预览先把它摆到 b、再摘掉：留住的是拿起那一刻的那一项（叶 a），不是中途摆到的 b。
        await wrapper.setProps({contents: [{key: "x", leaf: "b", insetTop: 32, active: true}, both[1]!]});
        await wrapper.setProps({contents: [both[1]!]});
        expect(wrapper.get("[data-content='x']").attributes("data-content-leaf")).toBe("a");
        // 放下：x 进了 b。
        await wrapper.setProps({lifted: null, contents: [{key: "x", leaf: "b", insetTop: 32, active: true}, {key: "y", leaf: "b", insetTop: 32, active: false}]});
        expect(wrapper.get("[data-inside='x']").element).toBe(inside);
        expect(wrapper.get("[data-content='x']").attributes("data-content-leaf")).toBe("b");
        // 再拿起、放下时它已经不在 contents 里：卸载。
        await wrapper.setProps({lifted: {key: "x"}, contents: [both[1]!]});
        expect(wrapper.get("[data-inside='x']").element).toBe(inside);
        await wrapper.setProps({lifted: null});
        await vi.waitFor(() => expect(wrapper.find("[data-inside='x']").exists()).toBe(false));
    });

    it("拿起的内容项（输出 89、90）：placeLifted 直接写元素、不引起重渲染（插槽不重跑）；过渡在走时它也不带过渡标记，不算停放", async () => {
        // test-lint-allow spy: 只桩布局盒给出容器尺寸，不断言调用；happy-dom 没有布局引擎
        const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => CONTAINER.width);
        // test-lint-allow spy: 同上，桩布局盒的高
        const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => CONTAINER.height);
        onTestFinished(() => {
            width.mockRestore();
            height.mockRestore();
        });
        const pair = (left: number): Grid<string> => createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
            {kind: "leaf", id: "a", ref: "a", size: {width: left, height: 0}, sizing: "fixed"},
            {kind: "leaf", id: "b", ref: "b", size: {width: 999 - left, height: 0}},
        ]}, {sashSize: SASH});
        const renders = new Map<string, number>();
        const start = pair(500);
        const wrapper = mount(NestedGrid, {
            attachTo: attachContainer(),
            props: {node: start.root(), layout: start.layout(CONTAINER), contents: [{key: "x", leaf: "a", insetTop: 32, active: true}, {key: "y", leaf: "b", insetTop: 32, active: true}]},
            slots: {content: ({contentKey}: {contentKey: string}) => {
                renders.set(contentKey, (renders.get(contentKey) ?? 0) + 1);
                return h("button", {"data-inside": contentKey}, contentKey);
            }},
        });
        wrappers.push(wrapper);
        wrapper.element.style.setProperty("--nb-layout-motion-layout", "10s");
        const exposed = wrapper.vm as unknown as {placeLifted(rect: {x: number; y: number; width: number; height: number}): void; moving: boolean};
        // 第一次布局回调只记下尺寸、不过渡：先发布一次同样的布局，再由程序改宽，让过渡走起来。
        const again = pair(500);
        await wrapper.setProps({node: again.root(), layout: again.layout(CONTAINER)});
        const wider = pair(300);
        await wrapper.setProps({node: wider.root(), layout: wider.layout(CONTAINER)});
        exposed.placeLifted({x: 11, y: 22, width: 33, height: 44});
        await wrapper.setProps({lifted: {key: "x"}});
        await nextTick();
        const lifted = wrapper.get("[data-content='x']").element as HTMLElement;
        expect(exposed.moving).toBe(true);
        expect(wrapper.get("[data-content='y']").attributes("data-moving")).toBeDefined();
        expect(lifted.hasAttribute("data-lifted")).toBe(true);
        expect([lifted.hasAttribute("data-moving"), lifted.hasAttribute("inert"), lifted.style.visibility]).toEqual([false, false, ""]);

        const before = new Map(renders);
        exposed.placeLifted({x: 15, y: 25, width: 40, height: 50});
        exposed.placeLifted({x: 18, y: 28, width: 45, height: 55});
        await nextTick();
        expect(lifted.style.transform).toBe("translate(18px, 28px)");
        expect([lifted.style.width, lifted.style.height]).toEqual(["45px", "55px"]);
        expect(renders).toEqual(before);
    });

    it("拿起的内容项并进已有的叶：那块叶刚才显示着的内容留在落地的卡片下面、不可交互，过渡结束才隐藏", async () => {
        const wrapper = mountContents([{key: "x", leaf: "a", insetTop: 32, active: true}, {key: "y", leaf: "b", insetTop: 32, active: true}]);
        wrapper.element.style.setProperty("--nb-layout-motion-layout", "30ms");
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
            {kind: "leaf", id: "a", ref: "a", size: {width: 300, height: 0}, sizing: "fixed", collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed}},
            {kind: "leaf", id: "b", ref: "b", size: {width: 699, height: 0}},
        ]}, {sashSize: SASH});
        const open = side(false);
        const wrapper = mount(NestedGrid, {
            attachTo: attachContainer(),
            props: {node: open.root(), layout: open.layout(CONTAINER), contents: [{key: "x", leaf: "a", insetTop: 32, active: true}]},
            slots: {leaf: ({node}: {node: {id: string}}) => h("span", {"data-head": node.id}), content: ({contentKey}: {contentKey: string}) => h("button", {"data-inside": contentKey}, contentKey)},
        });
        wrappers.push(wrapper);
        wrapper.element.style.setProperty("--nb-layout-motion-layout", "30ms");
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

    describe("卡片形状（输出 51 到 56）", () => {
        const SHAPE = {inset: ["4px", "6px", "8px", "2px"], radius: ["10px", "11px", "12px", "13px"]} as const;
        type Exposed = {shapedLeaves: ReadonlySet<string>; moving: boolean};

        /** 同“降到零”那条：宿主把 a 收起为零，a 的内容不跟外框；`motion` 是过渡时长。 */
        async function collapseWithShape(shape: (leaf: string) => GridLeafShape | undefined, motion = "30ms") {
            // test-lint-allow spy: 只桩布局盒给出容器尺寸，不断言调用；happy-dom 没有布局引擎
            const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => CONTAINER.width);
            // test-lint-allow spy: 同上，桩布局盒的高
            const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => CONTAINER.height);
            onTestFinished(() => {
                width.mockRestore();
                height.mockRestore();
            });
            const side = (collapsed: boolean): Grid<string> => createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
                {kind: "leaf", id: "a", ref: "a", size: {width: 300, height: 0}, sizing: "fixed", collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed}},
                {kind: "leaf", id: "b", ref: "b", size: {width: 699, height: 0}},
            ]}, {sashSize: SASH});
            const open = side(false);
            const wrapper = mount(NestedGrid, {
                attachTo: attachContainer(),
                props: {node: open.root(), layout: open.layout(CONTAINER), contents: [{key: "x", leaf: "a", insetTop: 32, active: true}, {key: "y", leaf: "b", insetTop: 32, active: true}], leafShape: shape},
                slots: {content: ({contentKey}: {contentKey: string}) => h("button", {"data-inside": contentKey}, contentKey)},
            });
            wrappers.push(wrapper);
            wrapper.element.style.setProperty("--nb-layout-motion-layout", motion);
            const again = side(false);
            await wrapper.setProps({node: again.root(), layout: again.layout(CONTAINER)});
            const closed = side(true);
            await wrapper.setProps({node: closed.root(), layout: closed.layout(CONTAINER)});
            return {wrapper, exposed: wrapper.vm as unknown as Exposed, frame: (id: string) => wrapper.get(`[data-leaf='${id}']`).element as HTMLElement, content: (key: string) => wrapper.get(`[data-content='${key}']`).element as HTMLElement};
        }

        it("过渡中外框与内容外层都按形状裁，内容外层另外裁掉面板头、只圆下面两个角；跟着外框的叶不裁；过渡结束摘掉（输出 51、52）", async () => {
            const {exposed, frame, content} = await collapseWithShape(() => SHAPE);
            expect(exposed.moving).toBe(true);
            expect(frame("a").style.clipPath).toBe("inset(4px 6px 8px 2px round 10px 11px 12px 13px)");
            expect(content("x").style.clipPath).toBe("inset(32px 6px 8px 2px round 0 0 12px 13px)");
            // 没有伸出去的颜色时不画投影、不压到别的外框下面。
            expect([frame("a").style.boxShadow, frame("a").style.zIndex]).toEqual(["", ""]);
            // b 的内容跟着外框：外框不按形状裁。
            expect(frame("b").style.clipPath).toBe("");
            await vi.waitFor(() => expect(exposed.moving).toBe(false));
            // 结束：外框不再裁，宿主画在外框里的投影露出来（输出 52）。
            expect(frame("a").style.clipPath).toBe("");
        });

        it("形状伸出外框（负内缩加 fill）：伸出去的部分用外框的投影画成 fill 的颜色，这块外框压到别的外框下面（输出 53、54）", async () => {
            const {frame} = await collapseWithShape(() => ({inset: ["0px", "-6px", "0px", "0px"], radius: ["0px", "8px", "8px", "0px"], fill: "rgb(1, 2, 3)"}));
            expect(frame("a").style.boxShadow).toContain("rgb(1, 2, 3)");
            expect(frame("a").style.boxShadow).toContain("calc(-1 * (-6px))");
            expect(frame("a").style.zIndex).toBe("-1");
            // 邻居是 `z-index: auto`、按 DOM 序叠的那一档：-1 在它下面。
            expect(frame("b").style.zIndex).toBe("");
        });

        it("`shapedLeaves`：过渡中是按形状裁的叶，结束为空；插槽渲染时读到的是这一轮的；减少动态效果时一直为空（输出 56，时序“moving、shapedLeaves、swappingLeaves”）", async () => {
            const {exposed} = await collapseWithShape(() => SHAPE);
            expect([...exposed.shapedLeaves]).toEqual(["a"]);
            await vi.waitFor(() => expect(exposed.shapedLeaves.size).toBe(0));

            const still = await collapseWithShape(() => SHAPE, "0ms");
            expect(still.exposed.shapedLeaves.size).toBe(0);
            expect(still.frame("a").style.clipPath).toBe("");
        });

        it("插槽在形状开始的那一次渲染里就读到这一轮的 `shapedLeaves`（时序“moving、shapedLeaves、swappingLeaves”）", async () => {
            // test-lint-allow spy: 只桩布局盒给出容器尺寸，不断言调用；happy-dom 没有布局引擎
            const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => CONTAINER.width);
            // test-lint-allow spy: 同上，桩布局盒的高
            const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => CONTAINER.height);
            onTestFinished(() => {
                width.mockRestore();
                height.mockRestore();
            });
            const side = (collapsed: boolean): Grid<string> => createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
                {kind: "leaf", id: "a", ref: "a", size: {width: 300, height: 0}, sizing: "fixed", collapse: {collapsedSize: 0, collapseThreshold: 24, expandThreshold: 24, collapsed}},
                {kind: "leaf", id: "b", ref: "b", size: {width: 699, height: 0}},
            ]}, {sashSize: SASH});
            const seen: string[] = [];
            let exposed: Exposed | null = null;
            const open = side(false);
            const wrapper = mount(NestedGrid, {
                attachTo: attachContainer(),
                props: {node: open.root(), layout: open.layout(CONTAINER), contents: [{key: "x", leaf: "a", insetTop: 32, active: true}], leafShape: () => SHAPE},
                slots: {leaf: ({node}: {node: {id: string}}) => {
                    seen.push(`${node.id}|${exposed === null ? "" : [...exposed.shapedLeaves].join(",")}`);
                    return h("span", {"data-head": node.id});
                }},
            });
            wrappers.push(wrapper);
            exposed = wrapper.vm as unknown as Exposed;
            wrapper.element.style.setProperty("--nb-layout-motion-layout", "30ms");
            const again = side(false);
            await wrapper.setProps({node: again.root(), layout: again.layout(CONTAINER)});
            seen.length = 0;
            const closed = side(true);
            await wrapper.setProps({node: closed.root(), layout: closed.layout(CONTAINER)});
            expect(seen.length).toBeGreaterThan(0);
            expect(seen.every((entry) => entry.endsWith("|a"))).toBe(true);
        });
    });

    it("分隔线的 aria-controls 列外框与活动内容", () => {
        const wrapper = mountContents([{key: "x", leaf: "a", insetTop: 32, active: true}]);
        const controls = wrapper.get("[data-sash]").attributes("aria-controls")?.split(" ") ?? [];
        expect(controls).toContain(wrapper.get("[data-leaf='a']").attributes("id"));
        expect(controls).toContain(wrapper.get("[data-content='x']").attributes("id"));
    });

    it("分隔线的 aria-controls 只列活动的内容（输出 95）：同一块叶里不活动的内容不在里面", () => {
        const wrapper = mountContents([{key: "x", leaf: "a", insetTop: 32, active: false}, {key: "y", leaf: "a", insetTop: 32, active: true}]);
        const controls = wrapper.get("[data-sash]").attributes("aria-controls")?.split(" ") ?? [];
        expect(controls).toEqual([wrapper.get("[data-leaf='a']").attributes("id"), wrapper.get("[data-content='y']").attributes("id")]);
        expect(controls).not.toContain(wrapper.get("[data-content='x']").attributes("id"));
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
        // 手柄的矩形同窗（输出 113）。
        expect([chrome.style.left, chrome.style.top, chrome.style.width, chrome.style.height]).toEqual(["100px", "50px", "300px", "200px"]);
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

    it("浮动窗不按卡片形状裁（输出 55）：新开的窗在过渡里，外框没有 clip-path，也不在 `shapedLeaves` 里", async () => {
        // test-lint-allow spy: 只桩布局盒给出容器尺寸，不断言调用；happy-dom 没有布局引擎
        const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => CONTAINER.width);
        // test-lint-allow spy: 同上，桩布局盒的高
        const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => CONTAINER.height);
        onTestFinished(() => {
            width.mockRestore();
            height.mockRestore();
        });
        const shape = {inset: ["4px", "4px", "4px", "4px"], radius: ["8px", "8px", "8px", "8px"]} as const;
        const wrapper = mountFloats({floats: [], leafShape: () => shape});
        wrapper.element.style.setProperty("--nb-layout-motion-layout", "30ms");
        await wrapper.setProps({revision: 1});
        await wrapper.setProps({floats: [FLOAT]});
        const exposed = wrapper.vm as unknown as {moving: boolean; shapedLeaves: ReadonlySet<string>};
        expect(exposed.moving).toBe(true);
        expect((wrapper.get("[data-leaf=\"f\"]").element as HTMLElement).style.clipPath).toBe("");
        expect(exposed.shapedLeaves.has("f")).toBe(false);
    });

    it("窗排在树的后面（输出 101）：DOM 序与树序不一致时，aria-owns 先按树序列树里的，末尾是窗的外框与内容", async () => {
        const wrapper = mountFloats({});
        const swapped = createGrid<string>({kind: "branch", id: "root", orientation: "horizontal", children: [
            {kind: "leaf", id: "b", ref: "b", size: {width: 499, height: 0}},
            {kind: "leaf", id: "a", ref: "a", size: {width: 500, height: 0}},
        ]}, {sashSize: SASH});
        await wrapper.setProps({node: swapped.root(), layout: swapped.layout(CONTAINER)});
        const idOf = (selector: string) => wrapper.get(selector).attributes("id");
        const owns = wrapper.element.getAttribute("aria-owns")?.split(" ") ?? [];
        expect(owns).toEqual([idOf("[data-leaf=\"b\"]"), idOf("[data-sash]"), idOf("[data-leaf=\"a\"]"), idOf("[data-leaf=\"f\"]"), idOf("[data-content=\"x\"]")]);
    });

    it("最大化：窗不算被盖住，别的叶才算", () => {
        const wrapper = mountFloats({maximized: {leaf: "a", exclude: []}});
        expect(wrapper.get("[data-leaf=\"f\"]").attributes("inert")).toBeUndefined();
        expect(wrapper.get("[data-leaf=\"b\"]").attributes("inert")).toBeDefined();
        expect(wrapper.get("[data-content=\"x\"]").attributes("inert")).toBeUndefined();
    });

    it("只有窗的矩形变了不过渡；窗在移动时不接指针的标记写在外框与内容上", async () => {
        const wrapper = mountFloats({});
        wrapper.element.style.setProperty("--nb-layout-motion-layout", "470ms");
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
        wrapper.element.style.setProperty("--nb-layout-motion-layout", motion);
        // 第一次布局回调只记下尺寸、不过渡：先发布一次同样的布局。
        const again = column(A);
        await wrapper.setProps({node: again.root(), layout: again.layout(CONTAINER)});
        return wrapper;
    }
    const toB = () => {
        const next = column(B);
        return {node: next.root(), layout: next.layout(CONTAINER)};
    };

    it("滑出去的分隔线用离开前最后一次的显示名（输出 152）：宿主那时已经答不出离开的节点叫什么", async () => {
        const wrapper = await mountColumn();
        await wrapper.setProps({paneLabel: (id: string) => ({a1: "甲一", a2: "甲二"})[id]});
        const sashOfA = () => wrapper.get('[data-sash="side:0"]');
        expect(sashOfA().attributes("aria-label")).toBe("Resize height between 甲一 and 甲二");
        await wrapper.setProps({swap: swap(1, A, B), ...toB(), paneLabel: (id: string) => ({b1: "乙一", main: "主区"})[id]});
        const leaving = wrapper.findAll(".nb-grid-sash").find((item) => item.attributes("data-swap") === "out");
        expect(leaving?.attributes("aria-label")).toBe("Resize height between 甲一 and 甲二");
    });

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
        // 输出 75：离开的一组的内容也带 out。
        expect(content.getAttribute("data-swap")).toBe("out");
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

    it("token 没变不算新的交换（时序“swap”）：同一个 token 再给一次、配一次布局变化，照常过渡、不滑", async () => {
        const wrapper = await mountColumn();
        await wrapper.setProps({swap: swap(1, A, B), ...toB()});
        expect(wrapper.find("[data-swap]").exists()).toBe(true);
        await vi.waitFor(() => expect(wrapper.find("[data-swap]").exists()).toBe(false));
        const back = column(A);
        // 新对象、同一个 token：宿主只是重建了这份描述。
        await wrapper.setProps({swap: {...swap(1, B, A), direction: -1}, node: back.root(), layout: back.layout(CONTAINER)});
        expect(wrapper.find("[data-swap]").exists()).toBe(false);
        expect(wrapper.find("[data-leaf='b1']").exists()).toBe(false);
        expect(wrapper.emitted("issues")).toBeUndefined();
    });

    it("插槽在交换提交那一次渲染里读到的就是这一轮的 `swappingLeaves` 与 `moving`；滑出去的叶的面板头照常渲染（时序“moving、shapedLeaves、swappingLeaves”，输出 156）", async () => {
        const seen: string[] = [];
        let exposed: {swappingLeaves: ReadonlySet<string>; moving: boolean} | null = null;
        const wrapper = await mountColumn("30ms", {
            leaf: (({node}: {node: {id: string}}) => {
                const swapping = exposed === null ? "" : [...exposed.swappingLeaves].sort().join(",");
                seen.push(`${node.id}|${swapping}|${String(exposed?.moving ?? false)}`);
                return h("span", {"data-head": node.id});
            }) as (props: never) => unknown,
        });
        exposed = wrapper.vm as unknown as {swappingLeaves: ReadonlySet<string>; moving: boolean};
        seen.length = 0;
        await wrapper.setProps({swap: swap(1, A, B), ...toB()});
        expect(wrapper.get("[data-leaf='a1']").attributes("data-swap")).toBe("out");
        // 交换提交后的每一次插槽调用都已经是新值：没有先按旧值渲染一遍再补。
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every((entry) => entry.endsWith("|a1,a2,b1|true"))).toBe(true);
        // 滑出去的叶照常调插槽（宿主还有它们）。
        expect(seen.some((entry) => entry.startsWith("a1|"))).toBe(true);
        expect(seen.some((entry) => entry.startsWith("b1|"))).toBe(true);
    });

    it("宿主列的叶对不上呈现、忽略之后为空：照常过渡，经 issues 交回原因", async () => {
        const wrapper = await mountColumn();
        await wrapper.setProps({swap: swap(1, ["hidden"], B), ...toB()});
        expect(wrapper.find("[data-swap]").exists()).toBe(false);
        expect(emittedIssues(wrapper)).toEqual([{code: "swap-skipped", cause: "no-leaving"}]);
    });

    it("swap-skipped 每发生一次发一条（输出 140）：同样不成立的交换给两次，两条", async () => {
        const wrapper = await mountColumn();
        await wrapper.setProps({swap: swap(1, ["hidden"], B), ...toB()});
        const back = column(A);
        await wrapper.setProps({swap: swap(2, ["hidden"], A), node: back.root(), layout: back.layout(CONTAINER)});
        expect(emittedIssues(wrapper)).toEqual([{code: "swap-skipped", cause: "no-leaving"}, {code: "swap-skipped", cause: "no-leaving"}]);
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

describe("NestedGrid 发出承载盒的尺寸（Spec 输出 144）", () => {
    /** 观察器的替身：happy-dom 的 `ResizeObserver` 不会回调。`trigger` 模拟浏览器在尺寸变了之后回调。 */
    class ResizeObserverProbe {
        static instances: ResizeObserverProbe[] = [];
        constructor(private readonly callback: ResizeObserverCallback) {
            ResizeObserverProbe.instances.push(this);
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
        trigger(): void {
            this.callback([], this as unknown as ResizeObserver);
        }
    }

    it("挂载后量到就发；尺寸变了，观察器的回调返回时监听已经拿到新值（同步发）；两轴不变不再发", async () => {
        const box = {...CONTAINER};
        ResizeObserverProbe.instances = [];
        vi.stubGlobal("ResizeObserver", ResizeObserverProbe);
        // test-lint-allow spy: 只桩布局盒给出承载盒尺寸，不断言调用；happy-dom 没有布局引擎
        const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => box.width);
        // test-lint-allow spy: 同上，桩布局盒的高
        const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => box.height);
        onTestFinished(() => {
            width.mockRestore();
            height.mockRestore();
            vi.unstubAllGlobals();
        });
        const seen: Array<{width: number; height: number} | null> = [];
        const grid = nestedGrid();
        mountRenderer(grid.root(), grid.layout(CONTAINER), {listeners: {onExtent: (extent: {width: number; height: number} | null) => void seen.push(extent)}});
        await nextTick();
        expect(seen).toEqual([{width: 1000, height: 600}]);

        const fire = (): void => {
            for (const probe of ResizeObserverProbe.instances) probe.trigger();
        };
        fire();
        expect(seen).toHaveLength(1);

        box.width = 800;
        fire();
        expect(seen).toEqual([{width: 1000, height: 600}, {width: 800, height: 600}]);

        box.height = 500;
        fire();
        expect(seen).toEqual([{width: 1000, height: 600}, {width: 800, height: 600}, {width: 800, height: 500}]);
    });
});

describe("离开的内容由库留到过渡结束（Spec ui/nested-grid 输出 155、156）", () => {
    type Host = {refresh(): void; close(id: string): void; reopen(id: string, at: number): void; swapContent(leaf: string, content: string): void; collapseAndDrop(id: string): void; hide(id: string): void; closeColumn(): void; resizeTo(width: number): void; log: string[]};

    /** 真实 NestedGrid 加 SFC 编译的插槽（`test-fixtures/LeavingHost.vue`）。happy-dom 没有布局引擎：桩布局盒（同“降到零”那条），过渡用真实计时。 */
    async function mountHost(retain: boolean, byKeyInChildSlot = false, motion = true, errorHandler?: (error: unknown) => void) {
        // test-lint-allow spy: 只桩布局盒给出容器尺寸，不断言调用；happy-dom 没有布局引擎
        const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => 1000);
        // test-lint-allow spy: 同上，桩布局盒的高
        const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => 600);
        onTestFinished(() => {
            width.mockRestore();
            height.mockRestore();
        });
        const wrapper = mount(LeavingHost, {attachTo: attachContainer(), props: {retain, byKeyInChildSlot}, ...(errorHandler === undefined ? {} : {global: {config: {errorHandler}}})});
        wrappers.push(wrapper);
        if (motion) (wrapper.element as HTMLElement).style.setProperty("--nb-layout-motion-layout", "40ms");
        const host = wrapper.vm as unknown as Host;
        host.refresh();
        await nextTick();
        host.log.length = 0;
        return {wrapper, host};
    }

    function stateOf(wrapper: VueWrapper, id: string) {
        const root = wrapper.element as HTMLElement;
        const frame = root.querySelector<HTMLElement>(`[data-leaf='${id}']`);
        const content = root.querySelector<HTMLElement>(`[data-content='${id}']`);
        return {
            frame: frame === null ? null : {leaving: frame.hasAttribute("data-leaving"), inert: frame.hasAttribute("inert"), head: frame.querySelector("[data-head]")?.textContent ?? null},
            content: content === null ? null : {leaving: content.hasAttribute("data-content-leaving"), inert: content.hasAttribute("inert"), visibility: content.style.visibility, body: content.querySelector("[data-body]")?.textContent?.replace(/\s+/gu, " ").trim() ?? null},
        };
    }

    const gone = (wrapper: VueWrapper, id: string): Promise<void> => vi.waitFor(() => expect(stateOf(wrapper, id)).toEqual({frame: null, content: null}));

    it("叶与标了留住的内容同一轮被删：两者都留着缩回去，面板头与内容停在删之前的样子，宿主的插槽不再被调；过渡结束才卸载", async () => {
        const {wrapper, host} = await mountHost(true);
        host.close("y");
        await nextTick();
        expect(stateOf(wrapper, "y")).toEqual({
            frame: {leaving: true, inert: true, head: "hy"},
            content: {leaving: true, inert: true, visibility: "", body: "Ymanyy1y2Yt"},
        });
        expect(host.log.filter((entry) => entry.endsWith(":y"))).toEqual([]);
        await gone(wrapper, "y");
    });

    it("没标留住：当即卸载，叶也不留着（下面没有挂着的内容）", async () => {
        const {wrapper, host} = await mountHost(false);
        host.close("y");
        await nextTick();
        expect(stateOf(wrapper, "y")).toEqual({frame: null, content: null});
    });

    it("减少动态效果（过渡时长 0）：标了留住的也当即卸载", async () => {
        const {wrapper, host} = await mountHost(true, false, false);
        host.close("y");
        await nextTick();
        expect(stateOf(wrapper, "y")).toEqual({frame: null, content: null});
    });

    it("过渡中宿主又给回同一个 key：沿用同一个元素，回到照常渲染", async () => {
        const {wrapper, host} = await mountHost(true);
        host.close("y");
        await nextTick();
        const kept = wrapper.element.querySelector("[data-content='y']");
        host.reopen("y", 1);
        await nextTick();
        expect(wrapper.element.querySelector("[data-content='y']")).toBe(kept);
        expect(wrapper.element.querySelectorAll("[data-content='y']")).toHaveLength(1);
        expect(stateOf(wrapper, "y").content).toMatchObject({leaving: false, inert: false});
        expect(host.log).toEqual(expect.arrayContaining(["head:y", "slot:y"]));
    });

    it("叶不动、只是内容被换掉：旧内容当即卸载，同一轮别处有过渡也一样", async () => {
        const {wrapper, host} = await mountHost(true);
        host.close("x");
        host.swapContent("y", "w");
        await nextTick();
        expect(stateOf(wrapper, "y").content).toBeNull();
        expect(wrapper.element.querySelector("[data-content='w']")).not.toBeNull();
    });

    it("过渡中又关一张：上一轮留下的接着留，这一轮的也留", async () => {
        const {wrapper, host} = await mountHost(true);
        host.close("y");
        await nextTick();
        host.close("x");
        await nextTick();
        expect(stateOf(wrapper, "y").content).toMatchObject({leaving: true});
        expect(stateOf(wrapper, "x").content).toMatchObject({leaving: true});
        await gone(wrapper, "y");
        await gone(wrapper, "x");
    });

    it("叶收起到 0（还在树里）且内容同一轮被去掉：内容留到过渡结束，看得见、不可交互", async () => {
        const {wrapper, host} = await mountHost(true);
        host.collapseAndDrop("y");
        await nextTick();
        expect(stateOf(wrapper, "y").content).toEqual({leaving: true, inert: true, visibility: "", body: "Ymanyy1y2Yt"});
        await vi.waitFor(() => expect(stateOf(wrapper, "y").content).toBeNull());
        expect(stateOf(wrapper, "y").frame).not.toBeNull();
    });

    it("焦点在留着的内容里：发 content-parked，key 是宿主刚去掉的那个", async () => {
        const {wrapper, host} = await mountHost(true);
        (wrapper.element as HTMLElement).querySelector<HTMLElement>("[data-focus='y']")?.focus();
        host.close("y");
        await nextTick();
        expect(wrapper.emitted("parked")).toEqual([["y"]]);
    });

    it("整列关掉、只有一块叶带着留着的内容：同列的叶一起留着，两块的面板头都停在关之前的样子", async () => {
        const {wrapper, host} = await mountHost(true);
        host.closeColumn();
        await nextTick();
        expect(stateOf(wrapper, "p")).toMatchObject({frame: {leaving: true, head: "hp"}, content: {leaving: true}});
        expect(stateOf(wrapper, "q").frame).toEqual({leaving: true, inert: true, head: "hq"});
        expect(host.log.filter((entry) => entry === "head:p" || entry === "head:q")).toEqual([]);
        await gone(wrapper, "q");
    });

    it("过渡中容器尺寸变了（过渡送到终点）：留着的内容当即卸载，不等计时", async () => {
        const {wrapper, host} = await mountHost(true);
        host.close("y");
        await nextTick();
        expect(stateOf(wrapper, "y").content).toMatchObject({leaving: true});
        host.resizeTo(900);
        await nextTick();
        expect(stateOf(wrapper, "y")).toEqual({frame: null, content: null});
    });

    it("留着的内容不是 F6 的落点：从左边那张往后走，跳过它落到右边那张", async () => {
        const {wrapper, host} = await mountHost(true);
        const root = wrapper.element as HTMLElement;
        root.querySelector<HTMLElement>("[data-focus='x']")?.focus();
        host.close("y");
        await nextTick();
        expect(moveGridFocus(root.parentElement, "next")).toBe(true);
        expect(document.activeElement?.getAttribute("data-focus")).toBe("z");
    });

    it("留着的内容不进 aria-owns（输出 155）：它的叶离开后 DOM 序与树序不一致，读屏顺序里有别的内容，没有它", async () => {
        const {wrapper, host} = await mountHost(true);
        const root = wrapper.element as HTMLElement;
        const idOf = (key: string) => root.querySelector(`[data-content='${key}']`)?.id;
        const kept = idOf("y");
        host.close("y");
        await nextTick();
        expect(stateOf(wrapper, "y").content).toMatchObject({leaving: true});
        const owns = root.getAttribute("aria-owns")?.split(" ") ?? [];
        expect(owns).toContain(idOf("x"));
        expect(owns).toContain(idOf("z"));
        expect(owns).not.toContain(kept);
    });

    it("离开的叶没带着留着的内容（区域隐藏，宿主数据都在）：面板头照常渲染，读得到这一轮的", async () => {
        const {wrapper, host} = await mountHost(true);
        host.hide("y");
        await nextTick();
        expect(stateOf(wrapper, "y").frame).toMatchObject({leaving: true});
        expect(host.log).toContain("head:y");
    });

    it("合同的限制：交给子组件的插槽里按 key 查已删的数据会抛错，库补一条说明原因的报错，原错误照常往上传", async () => {
        // test-lint-allow spy: 断言库补的那条报错；Vue 的警告同时收走，不弄脏输出
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        // test-lint-allow spy: 同上，收走 Vue 的警告
        const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        onTestFinished(() => {
            errors.mockRestore();
            warnings.mockRestore();
        });
        // 原错误交到宿主的错误处理（应用的 errorHandler），库不吞掉它。
        const caught: unknown[] = [];
        const {host} = await mountHost(true, true, true, (error) => void caught.push(error));
        host.close("y");
        await vi.waitFor(() => expect(caught.some((error) => error instanceof TypeError)).toBe(true));
        expect(errors.mock.calls.map((call) => String(call[0]))).toEqual(expect.arrayContaining([expect.stringContaining("[nb-layout/NestedGrid] content y is kept until the transition ends")]));
    });
});
