// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {createPinia, setActivePinia} from "pinia";
import {defineComponent, nextTick, ref} from "vue";
import {createGrid, type GridExtent, type GridLayoutResult} from "@notnotype/nb-ui/components";
import WorkbenchBranch from "nbook/app/components/workbench/WorkbenchBranch.vue";
import WorkbenchShell from "nbook/app/components/workbench/WorkbenchShell.vue";
import WorkbenchSpike from "nbook/app/components/workbench-spike/WorkbenchSpike.vue";
import {useNovelIdeStore} from "nbook/app/stores/novel-ide";

vi.mock("nbook/app/stores/novel-ide", async () => {
    const {defineStore} = await import("pinia");
    return {useNovelIdeStore: defineStore("grid-consumer", {state: () => ({leftPanelWidth: 340, agentPanelWidth: 400})})};
});

const SplitterStub = defineComponent({
    name: "Splitter",
    props: ["panels", "sashSizes"],
    emits: ["gesture-start", "gesture-end", "gesture-cancel"],
    template: "<div><slot v-for='panel in panels' :name='`panel-${panel.id}`'/></div>",
});

const wrappers: VueWrapper[] = [];

function sizeOf(layout: GridLayoutResult, id: string): GridExtent {
    const size = layout.sizes[id];
    if (!size) throw new Error(`测试布局缺少节点：${id}`);
    return size;
}

beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal("useWindowSize", () => ({width: ref(1000)}));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
});
afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("工作台真实组件的 grid 消费", () => {
    it.each([
        {orientation: "horizontal", sashSize: 0},
        {orientation: "horizontal", sashSize: 1},
        {orientation: "vertical", sashSize: 0},
        {orientation: "vertical", sashSize: 1},
    ] as const)("$orientation 两叶 max100 在 500px 容器保留留白，sash=$sashSize", async ({orientation, sashSize}) => {
        const horizontal = orientation === "horizontal";
        const container = horizontal ? {width: 500, height: 300} : {width: 300, height: 500};
        const maximumSize = horizontal ? {width: 100, height: 150} : {width: 150, height: 100};
        const grid = createGrid({kind: "branch", id: "root", orientation, children: [
            {kind: "leaf", id: "a", ref: "a", size: {width: 100, height: 100}, maximumSize},
            {kind: "leaf", id: "b", ref: "b", size: {width: 100, height: 100}, maximumSize},
        ]}, {sashSize});
        const root = grid.root();
        if (root?.kind !== "branch") throw new Error("需要分支");
        const layout = grid.layout(container);
        const expected = horizontal ? {width: 200 + sashSize, height: 150} : {width: 150, height: 200 + sashSize};
        expect(layout.sizes.root).toEqual(expected);
        expect(layout.issues.join()).toContain("未被任何子节点吸收");
        const wrapper = mount(WorkbenchBranch, {props: {node: root, layout, onResizeBranch: vi.fn()}, global: {stubs: {Splitter: SplitterStub}}});
        wrappers.push(wrapper);
        const element = wrapper.get<HTMLElement>("[data-branch='root']").element;
        expect(element.style.width).toBe(`${expected.width}px`);
        expect(element.style.height).toBe(`${expected.height}px`);
        const splitter = wrapper.findComponent(SplitterStub);
        expect(splitter.props("sashSizes")).toEqual([sashSize]);
        expect(splitter.props("panels")).toEqual([
            {id: "a", defaultSize: 50, minSize: 50, maxSize: 50},
            {id: "b", defaultSize: 50, minSize: 50, maxSize: 50},
        ]);
        // 容器变窄后重新消费原语尺寸，不能把首次触顶的 200px 固化为渲染尺寸。
        await wrapper.setProps({layout: grid.layout(horizontal ? {width: 150, height: 300} : {width: 300, height: 150})});
        expect(element.style.width).toBe("150px");
        expect(element.style.height).toBe("150px");
    });

    it("Spike 的可见树带当前约束，并把分支手势写回快照", async () => {
        const wrapper = mount(WorkbenchSpike, {global: {stubs: {Splitter: SplitterStub, WorkbenchSurface: true, DiagnosticsRail: true}}});
        wrappers.push(wrapper);
        await nextTick();
        const main = wrapper.findAllComponents(WorkbenchBranch).find((branch) => branch.props("node").id === "main");
        if (!main) throw new Error("需要主分支");
        const node = main.props("node");
        expect(node.children.find((child) => child.id === "sidebar-left")?.minimumSize.width).toBe(180);
        const before = main.props("layout");
        const targetCenter = sizeOf(before, "center").width - 20;
        const targetRight = sizeOf(before, "sidebar-right").width + 20;
        const target = [sizeOf(before, "activity").width, sizeOf(before, "sidebar-left").width, targetCenter, targetRight];
        const total = target.reduce((sum, size) => sum + size, 0);
        const splitter = main.findComponent(SplitterStub);
        splitter.vm.$emit("gesture-start");
        splitter.vm.$emit("gesture-end", {source: "keyboard", active: ["center", "sidebar-right"], sizes: target.map((size) => size * 100 / total)});
        await nextTick();
        expect(sizeOf(main.props("layout"), "sidebar-right").width).toBeCloseTo(targetRight);
        expect(sizeOf(main.props("layout"), "center").width).toBeCloseTo(targetCenter);
    });

    it("窄容器把降级后的约束传给 Splitter，过期与取消手势不提交", async () => {
        const grid = createGrid({kind: "branch", id: "root", orientation: "horizontal", children: [
            {kind: "leaf", id: "a", ref: "a", size: {width: 300, height: 0}, minimumSize: {width: 300, height: 0}},
            {kind: "leaf", id: "b", ref: "b", size: {width: 300, height: 0}, minimumSize: {width: 300, height: 0}},
        ]}, {sashSize: 1});
        const root = grid.root();
        if (root?.kind !== "branch") throw new Error("需要分支");
        const onResizeBranch = vi.fn();
        const wrapper = mount(WorkbenchBranch, {props: {node: root, layout: grid.layout({width: 501, height: 100}), onResizeBranch}, global: {stubs: {Splitter: SplitterStub}}});
        wrappers.push(wrapper);
        const splitter = wrapper.findComponent(SplitterStub);
        expect(splitter.props("panels")).toEqual([
            {id: "a", defaultSize: 50, minSize: 50, maxSize: 50},
            {id: "b", defaultSize: 50, minSize: 50, maxSize: 50},
        ]);
        splitter.vm.$emit("gesture-start");
        await wrapper.setProps({layout: grid.layout({width: 401, height: 100})});
        splitter.vm.$emit("gesture-end", {sizes: [40, 60]});
        expect(onResizeBranch).not.toHaveBeenCalled();
        splitter.vm.$emit("gesture-start");
        splitter.vm.$emit("gesture-cancel");
        splitter.vm.$emit("gesture-end", {sizes: [40, 60]});
        expect(onResizeBranch).not.toHaveBeenCalled();
    });

    it("受限 viewport 的 editor/right 调整不回弹，也不改写未动左栏的偏好", async () => {
        const store = useNovelIdeStore();
        store.leftPanelWidth = 560;
        store.agentPanelWidth = 450;
        const wrapper = mount(WorkbenchShell, {global: {stubs: {Splitter: SplitterStub}}});
        wrappers.push(wrapper);
        await nextTick();
        const main = wrapper.findAllComponents(WorkbenchBranch).find((branch) => branch.props("node").id === "main");
        if (!main) throw new Error("需要主分支");
        const splitter = main.findComponent(SplitterStub);
        const before = main.props("layout");
        const targetRight = sizeOf(before, "right").width - 20;
        const panelSpace = 998;
        const sizes = [sizeOf(before, "activity").width, sizeOf(before, "left").width, 20, targetRight].map((size) => size * 100 / panelSpace);
        splitter.vm.$emit("gesture-start");
        splitter.vm.$emit("gesture-end", {source: "pointer", sash: "editor~right", active: ["editor", "right"], compensated: [], sizes});
        await nextTick();
        expect(store.leftPanelWidth).toBe(560);
        expect(store.agentPanelWidth).toBeCloseTo(targetRight);
        expect(sizeOf(main.props("layout"), "right").width).toBeCloseTo(targetRight);
        expect(sizeOf(main.props("layout"), "editor").width).toBeCloseTo(20);
        expect(sizeOf(main.props("layout"), "left").width).toBeCloseTo(sizeOf(before, "left").width);
    });
});
