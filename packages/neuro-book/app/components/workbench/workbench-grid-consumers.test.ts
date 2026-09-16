// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, nextTick, ref} from "vue";
import {createGrid, type GridExtent, type GridLayoutResult} from "@notnotype/nb-ui/components";
import WorkbenchBranch from "nbook/app/components/workbench/WorkbenchBranch.vue";
import WorkbenchShell from "nbook/app/components/workbench/WorkbenchShell.vue";
import WorkbenchSpike from "nbook/app/components/workbench-spike/WorkbenchSpike.vue";
import type {WorkbenchLayoutNotice} from "nbook/app/utils/workbench/layout-session";

/**
 * 外壳组件与会话、原语的接线。
 *
 * 会话本身（首读门禁、提交语义、工作面归属）在 `app/utils/workbench/layout-session.test.ts` 用真实记录验证；
 * 这里只验证组件边界：读数来自会话、手势**原样**转发一次、提示条给出口、程序布局不触发提交。
 */
const fakeSession = vi.hoisted(() => {
    return {
        preferences: null as unknown,
        publication: null as unknown,
        state: null as unknown,
        calls: {
            enterSurface: [] as unknown[],
            gestureStart: [] as unknown[],
            gestureEnd: [] as unknown[],
            gestureCancel: [] as unknown[],
            retry: 0,
            abandon: 0,
            retryMigration: 0,
            setContainer: [] as unknown[],
        },
    };
});

vi.mock("nbook/app/utils/workbench/layout-session", async () => {
    const {computed, ref} = await import("vue");
    const preferences = ref({leftPanelWidth: 340, agentPanelWidth: 400});
    const publication = ref(0);
    const state = ref({
        surface: "idle",
        pendingSurface: null,
        loading: false,
        notice: null,
        migration: null,
        issues: [],
    });
    fakeSession.preferences = preferences;
    fakeSession.publication = publication;
    fakeSession.state = state;
    const session = {
        state: computed(() => state.value),
        preferences: computed(() => preferences.value),
        publication: computed(() => publication.value),
        async enterSurface(surface: unknown) {
            fakeSession.calls.enterSurface.push(surface);
        },
        setContainer(extent: unknown) {
            fakeSession.calls.setContainer.push(extent);
        },
        gestureStart(gesture: unknown) {
            fakeSession.calls.gestureStart.push(gesture);
            return "started";
        },
        async gestureEnd(gesture: unknown) {
            fakeSession.calls.gestureEnd.push(gesture);
            return "saved";
        },
        gestureCancel() {
            fakeSession.calls.gestureCancel.push(true);
        },
        async retry() {
            fakeSession.calls.retry += 1;
        },
        abandon() {
            fakeSession.calls.abandon += 1;
        },
        async retryMigration() {
            fakeSession.calls.retryMigration += 1;
        },
        async release() {},
    };
    return {createWorkbenchLayoutSession: () => session};
});

vi.mock("nbook/app/composables/useNotification", () => ({
    useNotification: () => ({
        notify: vi.fn(),
        success: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        remove: vi.fn(),
        clear: vi.fn(),
        notifications: [],
    }),
}));

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

function mainBranch(wrapper: VueWrapper) {
    const branch = wrapper.findAllComponents(WorkbenchBranch).find((candidate) => candidate.props("node").id === "main");
    if (!branch) throw new Error("需要主分支");
    return branch;
}

function branchById(wrapper: VueWrapper, id: string) {
    const branch = wrapper.findAllComponents(WorkbenchBranch).find((candidate) => candidate.props("node").id === id);
    if (!branch) throw new Error(`需要分支：${id}`);
    return branch;
}

function resetSessionCalls(): void {
    fakeSession.calls.enterSurface.length = 0;
    fakeSession.calls.gestureStart.length = 0;
    fakeSession.calls.gestureEnd.length = 0;
    fakeSession.calls.gestureCancel.length = 0;
    fakeSession.calls.setContainer.length = 0;
    fakeSession.calls.retry = 0;
    fakeSession.calls.abandon = 0;
    fakeSession.calls.retryMigration = 0;
}

beforeEach(() => {
    const preferences = fakeSession.preferences as {value: {leftPanelWidth: number; agentPanelWidth: number}};
    preferences.value = {leftPanelWidth: 340, agentPanelWidth: 400};
    (fakeSession.state as {value: Record<string, unknown>}).value = {
        surface: "idle",
        pendingSurface: null,
        loading: false,
        notice: null,
        migration: null,
        issues: [],
    };
    resetSessionCalls();
    vi.stubGlobal("useWindowSize", () => ({width: ref(1000)}));
    vi.stubGlobal("useI18n", () => ({
        t: (key: string, params?: {diagnosis?: string}) => (params?.diagnosis ? `${key}:${params.diagnosis}` : key),
    }));
    vi.stubGlobal("ResizeObserver", class {
        observe() {}
        disconnect() {}
    });
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
        const wrapper = mount(WorkbenchBranch, {
            props: {node: root, layout, onGestureStart: vi.fn(), onGestureEnd: vi.fn(), onGestureCancel: vi.fn()},
            global: {stubs: {Splitter: SplitterStub}},
        });
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
        const main = mainBranch(wrapper);
        const node = main.props("node");
        expect(node.children.find((child: {id: string}) => child.id === "sidebar-left")?.minimumSize.width).toBe(180);
        const before = main.props("layout");
        const targetCenter = sizeOf(before, "center").width - 20;
        const targetRight = sizeOf(before, "sidebar-right").width + 20;
        const target = [sizeOf(before, "activity").width, sizeOf(before, "sidebar-left").width, targetCenter, targetRight];
        const total = target.reduce((sum, size) => sum + size, 0);
        const splitter = main.findComponent(SplitterStub);
        splitter.vm.$emit("gesture-start", {sizes: target.map((size) => size * 100 / total)});
        splitter.vm.$emit("gesture-end", {source: "keyboard", active: ["center", "sidebar-right"], sizes: target.map((size) => size * 100 / total)});
        await nextTick();
        expect(sizeOf(main.props("layout"), "sidebar-right").width).toBeCloseTo(targetRight);
        expect(sizeOf(main.props("layout"), "center").width).toBeCloseTo(targetCenter);
    });

    it("分支把 Splitter 的原始手势状态原样转发一次，窄容器约束照旧投影", async () => {
        const grid = createGrid({kind: "branch", id: "root", orientation: "horizontal", children: [
            {kind: "leaf", id: "a", ref: "a", size: {width: 300, height: 0}, minimumSize: {width: 300, height: 0}},
            {kind: "leaf", id: "b", ref: "b", size: {width: 300, height: 0}, minimumSize: {width: 300, height: 0}},
        ]}, {sashSize: 1});
        const root = grid.root();
        if (root?.kind !== "branch") throw new Error("需要分支");
        const onGestureStart = vi.fn();
        const onGestureEnd = vi.fn();
        const onGestureCancel = vi.fn();
        const wrapper = mount(WorkbenchBranch, {
            props: {node: root, layout: grid.layout({width: 501, height: 100}), onGestureStart, onGestureEnd, onGestureCancel},
            global: {stubs: {Splitter: SplitterStub}},
        });
        wrappers.push(wrapper);
        const splitter = wrapper.findComponent(SplitterStub);
        expect(splitter.props("panels")).toEqual([
            {id: "a", defaultSize: 50, minSize: 50, maxSize: 50},
            {id: "b", defaultSize: 50, minSize: 50, maxSize: 50},
        ]);

        const state = {source: "pointer", sash: "a~b", active: ["b"], compensated: [], sizes: [40, 60]};
        splitter.vm.$emit("gesture-start", state);
        splitter.vm.$emit("gesture-end", state);
        splitter.vm.$emit("gesture-cancel", {source: "pointer", sash: "a~b", reason: "escape"});

        expect(onGestureStart).toHaveBeenCalledTimes(1);
        expect(onGestureStart).toHaveBeenCalledWith("root", state);
        expect(onGestureEnd).toHaveBeenCalledTimes(1);
        expect(onGestureEnd).toHaveBeenCalledWith("root", state);
        expect(onGestureCancel).toHaveBeenCalledTimes(1);
        expect(onGestureCancel).toHaveBeenCalledWith("root");
    });

    it("外壳：读数来自会话，程序布局不提交，手势原样转发一次", async () => {
        const wrapper = mount(WorkbenchShell, {
            props: {surface: {kind: "idle"}},
            global: {stubs: {Splitter: SplitterStub}},
            slots: {
                activity: "<span data-test-leaf='activity'>activity</span>",
                editor: "<span data-test-leaf='editor'>editor</span>",
            },
        });
        wrappers.push(wrapper);
        await nextTick();

        expect(fakeSession.calls.enterSurface).toEqual([{kind: "idle"}]);
        // 叶内容按叶 id 转发（页面给 #activity/#editor…），外壳不重命名插槽。
        expect(wrapper.find("[data-test-leaf='activity']").exists()).toBe(true);
        expect(wrapper.find("[data-test-leaf='editor']").exists()).toBe(true);
        const main = mainBranch(wrapper);
        expect(sizeOf(main.props("layout"), "left").width).toBe(340);
        expect(sizeOf(main.props("layout"), "right").width).toBe(400);
        expect(fakeSession.calls.gestureStart).toHaveLength(0);
        expect(fakeSession.calls.gestureEnd).toHaveLength(0);

        // 容器测量与显隐都是程序布局：只更新呈现，不产生提交。
        expect(fakeSession.calls.setContainer.length).toBeGreaterThan(0);
        wrapper.vm.setLeafVisible("right", false);
        await nextTick();
        expect(fakeSession.calls.gestureStart).toHaveLength(0);
        expect(fakeSession.calls.gestureEnd).toHaveLength(0);
        wrapper.vm.setLeafVisible("right", true);
        await nextTick();

        // 会话重新发布呈现（恢复 / 放弃）：按新偏好重建，仍不提交。
        (fakeSession.preferences as {value: {leftPanelWidth: number; agentPanelWidth: number}}).value = {leftPanelWidth: 520, agentPanelWidth: 400};
        (fakeSession.publication as {value: number}).value += 1;
        await nextTick();
        expect(sizeOf(mainBranch(wrapper).props("layout"), "left").width).toBe(520);
        expect(fakeSession.calls.gestureEnd).toHaveLength(0);

        // 一次手势：起始与结束各转发一次，携带原始状态（分支 id + 主动节点 + 百分比）。
        const sizes = [60, 520, 18, 400].map((size) => size * 100 / 998);
        const splitter = mainBranch(wrapper).findComponent(SplitterStub);
        splitter.vm.$emit("gesture-start", {source: "pointer", sash: "left~editor", active: [], compensated: [], sizes});
        splitter.vm.$emit("gesture-end", {source: "pointer", sash: "left~editor", active: ["left"], compensated: [], sizes});
        await nextTick();

        expect(fakeSession.calls.gestureStart).toEqual([{branchId: "main", sizes}]);
        expect(fakeSession.calls.gestureEnd).toEqual([{branchId: "main", active: ["left"], sizes}]);

        // 非主区手势不属于产品偏好：不转发。
        const rootSplitter = branchById(wrapper, "root").findComponent(SplitterStub);
        rootSplitter.vm.$emit("gesture-start", {source: "pointer", sash: "titlebar~main", active: [], compensated: [], sizes: [4, 96]});
        await nextTick();
        expect(fakeSession.calls.gestureStart).toHaveLength(1);
    });

    it("外壳：未保存/切换被挡/迁移阻断的提示条给出重试与放弃入口", async () => {
        const wrapper = mount(WorkbenchShell, {
            props: {surface: {kind: "idle"}},
            global: {stubs: {Splitter: SplitterStub}},
        });
        wrappers.push(wrapper);
        await nextTick();
        expect(wrapper.find("[data-layout-notice]").exists()).toBe(false);

        const notice: WorkbenchLayoutNotice = {kind: "unsaved", surface: "idle", diagnosis: "后端不可达", retryable: true};
        (fakeSession.state as {value: Record<string, unknown>}).value = {
            surface: "idle",
            pendingSurface: null,
            loading: false,
            notice,
            migration: null,
            issues: [],
        };
        await nextTick();

        const strip = wrapper.get("[data-layout-notice]");
        expect(strip.text()).toContain("ide.workbench.layout.unsaved");
        expect(strip.text()).toContain("后端不可达");
        const buttons = strip.findAll("button");
        expect(buttons).toHaveLength(2);
        await buttons[0]!.trigger("click");
        expect(fakeSession.calls.retry).toBe(1);
        await buttons[1]!.trigger("click");
        expect(fakeSession.calls.abandon).toBe(1);

        // 迁移阻断的重试走 t47 的控制器入口。
        (fakeSession.state as {value: Record<string, unknown>}).value = {
            surface: "idle",
            pendingSurface: null,
            loading: false,
            notice: {kind: "migration-blocked", surface: "idle", diagnosis: "后端不可达", retryable: true},
            migration: {phase: "blocked", blocked: "backend-unreachable", diagnosis: "后端不可达", retryable: true},
            issues: [],
        };
        await nextTick();
        await wrapper.get("[data-layout-notice]").findAll("button")[0]!.trigger("click");
        expect(fakeSession.calls.retryMigration).toBe(1);
    });
});
