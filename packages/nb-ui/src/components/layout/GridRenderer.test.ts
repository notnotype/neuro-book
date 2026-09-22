import {afterEach, describe, expect, it} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {h, nextTick} from "vue";
import GridRenderer from "./GridRenderer.vue";
import Splitter, {type SplitterPanelConfig} from "./Splitter.vue";
import {createGrid, type Grid, type GridLayoutResult, type GridNode} from "./grid";
import {createGridGestureSession, type GridGestureCommit, type GridGesturePreview, type GridGestureSession} from "./grid-gesture";

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

/** 面板沿主轴的内联 px（交叉轴由 flex 拉伸，不写尺寸）。 */
function panelMainPx(wrapper: VueWrapper, id: string): number {
    const style = wrapper.get<HTMLElement>(`[data-panel-id="${id}"]`).element.style;
    const value = style.width || style.height;
    return value === "" ? Number.NaN : Number.parseFloat(value);
}

type RendererOptions = {
    disabled?: boolean;
    onGestureCommit?: (commit: GridGestureCommit) => {ok: true} | {ok: false; reason: string};
};

function mountRenderer(node: GridNode<string> | null, layout: GridLayoutResult, options: RendererOptions = {}): VueWrapper {
    const wrapper = mount(GridRenderer, {
        attachTo: attachContainer(),
        props: {
            node,
            layout,
            disabled: options.disabled ?? false,
            ...(options.onGestureCommit === undefined ? {} : {onGestureCommit: options.onGestureCommit}),
        },
        slots: {
            leaf: (scope: {node: {id: string}}) => h("div", {class: "leaf-body"}, scope.node.id),
            empty: () => h("div", {class: "empty-body"}, "empty"),
        },
    });
    wrappers.push(wrapper);
    return wrapper;
}

describe("GridRenderer 递归渲染", () => {
    it("单叶根直接交给叶插槽，不挂 Splitter", () => {
        const grid = createGrid<string>({kind: "leaf", id: "only", ref: "only", size: {width: 0, height: 0}}, {sashSize: SASH});
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));

        expect(wrapper.find("[data-splitter]").exists()).toBe(false);
        expect(wrapper.find("[data-leaf='only']").text()).toBe("only");
    });

    it("空树交给 empty 插槽", () => {
        const grid = createGrid<string>(null, {sashSize: SASH});
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));

        expect(wrapper.find(".empty-body").text()).toBe("empty");
        expect(wrapper.find("[data-splitter]").exists()).toBe(false);
    });

    it("分支递归成每层一个 Splitter，叶插槽收到各自节点", async () => {
        const grid = nestedGrid();
        const wrapper = mountRenderer(grid.root(), grid.layout(CONTAINER));
        await nextTick();

        expect(wrapper.findAll("[data-splitter]").map((node) => node.attributes("data-splitter"))).toEqual(["root", "right"]);
        expect(wrapper.findAll("[data-panel-id]").map((node) => node.attributes("data-panel-id"))).toEqual(["left", "right", "top", "bottom"]);
        expect(wrapper.findAll("[data-leaf]").map((node) => node.attributes("data-leaf"))).toEqual(["left", "top", "bottom"]);
    });

    it("面板 px 与 Splitter 配置来自同一份 grid 呈现", async () => {
        const grid = nestedGrid();
        const layout = grid.layout(CONTAINER);
        const wrapper = mountRenderer(grid.root(), layout);
        await nextTick();

        // 面板空间不含 sash：根分支 300 / 699，内层纵向各 299.5
        expect(layout.sizes.left!.width).toBeCloseTo(300, 6);
        expect(layout.sizes.right!.width).toBeCloseTo(699, 6);
        expect(layout.sizes.top!.height).toBeCloseTo(299.5, 6);
        expect(panelMainPx(wrapper, "left")).toBeCloseTo(layout.sizes.left!.width, 6);
        expect(panelMainPx(wrapper, "right")).toBeCloseTo(layout.sizes.right!.width, 6);
        expect(panelMainPx(wrapper, "top")).toBeCloseTo(layout.sizes.top!.height, 6);
        expect(panelMainPx(wrapper, "bottom")).toBeCloseTo(layout.sizes.bottom!.height, 6);

        const outer = wrapper.findAllComponents(Splitter)[0]!;
        const panels = outer.props("panels") as SplitterPanelConfig[];
        expect(panels.map((panel) => panel.id)).toEqual(["left", "right"]);
        expect(panels.map((panel) => panel.defaultSizePx)).toEqual([layout.sizes.left!.width, layout.sizes.right!.width]);
        expect(outer.props("sizesPx")).toEqual([layout.sizes.left!.width, layout.sizes.right!.width]);
        expect(panels[0]!.maxSizePx).toBe(layout.constraints.left!.maximumSize.width);
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
                    return {ok: false, reason: applied.reason};
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
        expect(panelMainPx(wrapper, "left")).toBeCloseTo(preview.layout.sizes.left!.width, 6);
        expect(panelMainPx(wrapper, "right")).toBeCloseTo(preview.layout.sizes.right!.width, 6);
        // 嵌套分支的盒跟着当前父盒重投影：交叉轴就是现在的父面板 px，而不是按下时的 699
        expect(preview.layout.sizes.top!.width).toBeCloseTo(579, 6);
        expect(panelMainPx(wrapper, "top")).toBeCloseTo(preview.layout.sizes.top!.height, 6);
        // 内层主轴不受外层拖动影响
        expect(preview.layout.sizes.top!.height).toBeCloseTo(299.5, 6);

        rootSash.dispatchEvent(pointerEvent("pointerup", 420, 80));
        await nextTick();
        expect(commits).toHaveLength(1);
        expect(published.sizes.left!.width).not.toBeCloseTo(420, 6);

        // 宿主发布新布局即成为受控事实，预览与之无关
        await wrapper.setProps({layout: published});
        await nextTick();
        expect(panelMainPx(wrapper, "left")).toBeCloseTo(published.sizes.left!.width, 6);
        expect(panelMainPx(wrapper, "right")).toBeCloseTo(published.sizes.right!.width, 6);
        expect(wrapper.emitted("gesture-cancel")).toBeUndefined();
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
