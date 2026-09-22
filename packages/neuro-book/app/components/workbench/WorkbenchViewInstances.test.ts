// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {defineComponent, h, inject, nextTick, onBeforeUnmount, ref, watch, type Component} from "vue";
import {mount, type VueWrapper} from "@vue/test-utils";
import type {DescriptorResult} from "nbook/app/utils/workbench/descriptors";
import type {WorkbenchViewEntry} from "nbook/app/utils/workbench/product-catalog";
import {SHELL_FILES_VIEW} from "nbook/app/utils/workbench/product-catalog";
import type {ViewActionTarget, ViewTitleActionState, WorkbenchViewActionHandle} from "nbook/app/utils/workbench/view-title-actions";
import WorkbenchViewInstances, {VIEW_TARGET_REGISTRY} from "nbook/app/components/workbench/WorkbenchViewInstances.vue";

/**
 * 默认 factory 解析器会拉进产品叶（`WorkspaceFilePanel` → Pinia store），本测试只验证实例层，
 * 因此把白名单换成失败替身：注入解析器的路径不受影响，产品映射由 `product-catalog.test.ts` 覆盖。
 */
vi.mock("nbook/app/utils/workbench/view-factories", () => ({
    resolveWorkbenchViewFactory: (factoryKey: string) => ({ok: false, reason: `测试未登记：${factoryKey}`}),
}));

/**
 * 实例层的行为：每个视图唯一实例、Teleport 只搬 DOM、落点缺失时保留实例、
 * 上下文不可见才释放、authority 缺失只显示原因。
 *
 * 断言的是"实例在不在、是不是同一个 DOM 节点、状态有没有丢"，不是内部 map 的形状。
 */

/**
 * 探针：每个视图一份（按 id 命名），setup 记一次自增计数，并带一段可变的本地状态——
 * 用来证明实例没有被重建（重建会清零）。
 */
let probeInstances = 0;
const PROBES: Record<string, Component> = {};

function probeFor(viewId: string): Component {
    PROBES[viewId] ??= defineComponent({
        name: `ProbeView${viewId}`,
        setup() {
            probeInstances += 1;
            const local = ref(`${viewId}-state`);
            return () => h("div", {"data-probe": viewId}, [
                h("span", {"data-local": ""}, local.value),
                h("button", {"data-mutate": true, onClick: () => { local.value = `${viewId}-changed`; }}, "改状态"),
            ]);
        },
    });
    return PROBES[viewId]!;
}

function resolverOf(factories: Record<string, Component>) {
    return (factoryKey: string): DescriptorResult<Component> => {
        const component = factories[factoryKey];
        return component === undefined
            ? {ok: false, reason: `未登记的内置 factoryKey：${factoryKey}`}
            : {ok: true, value: component};
    };
}

function entryOf(viewId: string, overrides: Partial<WorkbenchViewEntry> = {}): WorkbenchViewEntry {
    return {
        view: {...SHELL_FILES_VIEW, id: viewId, factoryKey: `lab.view.${viewId}`, titleKey: `lab.view.${viewId}`},
        title: viewId,
        containerId: "nbook.tools",
        order: 10,
        source: "default",
        visible: true,
        visibilityReasons: [],
        actionable: true,
        authorityReasons: [],
        ...overrides,
    };
}

/**
 * 落点宿主的替身：把 anchor 元素登记进实例层（与 `WorkbenchViewSection` 走同一个通道），
 * 卸载时按**元素身份**反登记——产品里的宿主也是这么做的。
 */
const AnchorHost = defineComponent({
    name: "AnchorHost",
    props: {viewId: {type: String, required: true}, show: {type: Boolean, default: true}},
    setup(props) {
        const targets = inject(VIEW_TARGET_REGISTRY, null);
        let registered: HTMLElement | null = null;
        onBeforeUnmount(() => {
            if (targets !== null && registered !== null) {
                targets.unregister(props.viewId, registered);
            }
        });
        return () => props.show
            ? h("div", {
                "data-anchor": props.viewId,
                ref: (element) => {
                    if (targets === null) {
                        return;
                    }
                    if (element instanceof HTMLElement) {
                        registered = element;
                        targets.register(props.viewId, element);
                        return;
                    }
                    if (registered !== null) {
                        targets.unregister(props.viewId, registered);
                        registered = null;
                    }
                },
            })
            : null;
    },
});

const mounted: VueWrapper[] = [];

/** 视图模型与落点都由测试驱动：换呈现就是换 props，不重挂示例。 */
type AnchorSpec = {readonly key: string; readonly viewId: string; readonly show: boolean};

function mountInstances(options: {
    views: () => readonly WorkbenchViewEntry[];
    factories?: Record<string, Component>;
    anchors: () => readonly AnchorSpec[];
    events?: {
        viewActions?: (target: ViewActionTarget, states: readonly ViewTitleActionState[]) => void;
        viewHandleReady?: (target: ViewActionTarget, handle: WorkbenchViewActionHandle | null) => void;
    };
}) {
    const factories = options.factories ?? Object.fromEntries(
        options.views().map((entry) => [entry.view.factoryKey, probeFor(entry.view.id)]),
    );
    const Root = defineComponent({
        name: "InstancesHarness",
        setup() {
            return () => h(
                WorkbenchViewInstances,
                {
                    views: options.views(),
                    viewFactoryResolver: resolverOf(factories),
                    ...(options.events?.viewActions === undefined ? {} : {onViewActions: options.events.viewActions}),
                    ...(options.events?.viewHandleReady === undefined ? {} : {onViewHandleReady: options.events.viewHandleReady}),
                },
                {default: () => options.anchors().map((anchor) => h(AnchorHost, {key: anchor.key, viewId: anchor.viewId, show: anchor.show}))},
            );
        },
    });
    const wrapper = mount(Root);
    mounted.push(wrapper);
    return wrapper;
}

/** 登记 → nextTick 发布 → 实例再渲染一次，才搬进落点（四拍覆盖这两次微任务队列）。 */
async function settle(): Promise<void> {
    for (let tick = 0; tick < 4; tick += 1) {
        await nextTick();
    }
}

beforeEach(() => {
    probeInstances = 0;
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
        wrapper.unmount();
    }
    vi.unstubAllGlobals();
});

describe("WorkbenchViewInstances", () => {
    it("每个视图一个实例，实例被搬进宿主登记的落点里", async () => {
        const wrapper = mountInstances({
            views: () => [entryOf("nbook.files"), entryOf("nbook.outline")],
            anchors: () => [{key: "files", viewId: "nbook.files", show: true}, {key: "outline", viewId: "nbook.outline", show: true}],
        });

        await settle();

        expect(wrapper.findAll("[data-probe]")).toHaveLength(2);
        expect(wrapper.find("[data-anchor=\"nbook.files\"] [data-probe=\"nbook.files\"]").exists()).toBe(true);
        expect(wrapper.find("[data-anchor=\"nbook.outline\"] [data-probe=\"nbook.outline\"]").exists()).toBe(true);
        expect(probeInstances).toBe(2);
    });

    it("落点短暂撤销（宿主重排）保留同一个实例，重新登记后搬回去且本地状态不丢", async () => {
        const anchors = ref<AnchorSpec[]>([{key: "files", viewId: "nbook.files", show: true}]);
        const wrapper = mountInstances({
            views: () => [entryOf("nbook.files")],
            anchors: () => anchors.value,
        });
        await settle();

        const before = wrapper.find("[data-probe=\"nbook.files\"]");
        expect(before.exists()).toBe(true);
        const instanceElement = before.element;
        await before.find("[data-mutate]").trigger("click");
        expect(before.find("[data-local]").text()).toBe("nbook.files-changed");

        // 落点撤销：宿主（叶子重排）暂时不再渲染 anchor——实例必须留在原地，不能被销毁。
        anchors.value = [{key: "files", viewId: "nbook.files", show: false}];
        await settle();
        expect(probeInstances).toBe(1);

        // 重新登记：同一个 DOM 节点搬回新落点，本地状态仍在（不是重建的空实例）。
        anchors.value = [{key: "files", viewId: "nbook.files", show: true}];
        await settle();
        const after = wrapper.find("[data-probe=\"nbook.files\"]");
        expect(after.element).toBe(instanceElement);
        expect(after.find("[data-local]").text()).toBe("nbook.files-changed");
        expect(probeInstances).toBe(1);
    });

    it("暂失落点（宿主卸载）时实例停在 parking，重新登记后搬回；实例不销毁、状态不丢", async () => {
        const anchors = ref<AnchorSpec[]>([{key: "files", viewId: "nbook.files", show: true}]);
        const wrapper = mountInstances({
            views: () => [entryOf("nbook.files")],
            anchors: () => anchors.value,
        });
        await settle();

        const instanceElement = wrapper.find("[data-probe=\"nbook.files\"]").element;
        await wrapper.find("[data-probe=\"nbook.files\"] [data-mutate]").trigger("click");

        // 宿主卸载：反登记之后实例改停 parking（`hidden inert`），不留在已断开的旧元素里。
        anchors.value = [];
        await settle();
        const parking = wrapper.find("[data-view-parking]");
        expect(parking.exists()).toBe(true);
        expect(parking.attributes("hidden")).toBeDefined();
        expect(parking.attributes("inert")).toBeDefined();
        expect(wrapper.find("[data-anchor=\"nbook.files\"]").exists()).toBe(false);
        expect(parking.find("[data-view-parking-target=\"nbook.files\"] [data-probe=\"nbook.files\"]").exists()).toBe(true);
        expect(parking.find("[data-local]").text()).toBe("nbook.files-changed");
        expect(probeInstances).toBe(1);

        // 新宿主登记：同一个实例搬回去，本地状态仍在。
        anchors.value = [{key: "files-again", viewId: "nbook.files", show: true}];
        await settle();
        const restored = wrapper.find("[data-anchor=\"nbook.files\"] [data-probe=\"nbook.files\"]");
        expect(restored.element).toBe(instanceElement);
        expect(restored.find("[data-local]").text()).toBe("nbook.files-changed");
        expect(probeInstances).toBe(1);
    });

    it("视图在容器之间移动：同一个实例被搬到新落点，不复制", async () => {
        const anchors = ref<AnchorSpec[]>([
            {key: "left", viewId: "nbook.files", show: true},
            {key: "outline", viewId: "nbook.outline", show: true},
        ]);
        const views = ref([entryOf("nbook.files"), entryOf("nbook.outline")]);
        const wrapper = mountInstances({views: () => views.value, anchors: () => anchors.value});
        await settle();

        const leftAnchor = wrapper.find("[data-anchor=\"nbook.files\"]").element;
        const element = wrapper.find("[data-probe=\"nbook.files\"]").element as HTMLElement;
        await wrapper.find("[data-probe=\"nbook.files\"] [data-mutate]").trigger("click");

        // 文件视图改由另一个容器承载：旧落点消失、底部落点接管同一个实例。
        views.value = [entryOf("nbook.files", {containerId: "nbook.panel"}), entryOf("nbook.outline")];
        anchors.value = [
            {key: "outline", viewId: "nbook.outline", show: true},
            {key: "panel", viewId: "nbook.files", show: true},
        ];
        await settle();

        const moved = wrapper.find("[data-probe=\"nbook.files\"]");
        expect(wrapper.find("[data-anchor=\"nbook.files\"]").element).not.toBe(leftAnchor);
        expect(moved.element).toBe(element);
        expect(moved.find("[data-local]").text()).toBe("nbook.files-changed");
        expect(wrapper.findAll("[data-probe=\"nbook.files\"]")).toHaveLength(1);
        expect(probeInstances).toBe(2);
    });

    it("上下文不可见才释放实例：重新可见时是新实例（没有复活旧状态）", async () => {
        const views = ref([entryOf("nbook.files")]);
        const wrapper = mountInstances({
            views: () => views.value,
            anchors: () => [{key: "files", viewId: "nbook.files", show: true}],
        });
        await settle();
        expect(wrapper.find("[data-probe=\"nbook.files\"]").exists()).toBe(true);

        views.value = [entryOf("nbook.files", {visible: false, visibilityReasons: ["需要打开 Project"]})];
        await settle();
        expect(wrapper.find("[data-probe=\"nbook.files\"]").exists()).toBe(false);

        views.value = [entryOf("nbook.files")];
        await settle();
        expect(wrapper.find("[data-probe=\"nbook.files\"]").exists()).toBe(true);
        expect(probeInstances).toBe(2);
    });

    it("factoryKey 解析失败的诊断显示在落点里，不静默空白", async () => {
        const wrapper = mountInstances({
            views: () => [entryOf("nbook.files")],
            factories: {},
            anchors: () => [{key: "files", viewId: "nbook.files", show: true}],
        });

        await settle();

        expect(wrapper.find("[data-anchor=\"nbook.files\"]").text()).toContain("未登记的内置 factoryKey");
    });

    it("authority 缺失时视图仍在，只显示受限原因", async () => {
        const wrapper = mountInstances({
            views: () => [entryOf("nbook.files", {actionable: false, authorityReasons: ["需要工作区文件 authority"]})],
            anchors: () => [{key: "files", viewId: "nbook.files", show: true}],
        });

        await settle();

        const anchor = wrapper.find("[data-anchor=\"nbook.files\"]");
        expect(anchor.find("[data-probe=\"nbook.files\"]").exists()).toBe(true);
        expect(anchor.text()).toContain("需要工作区文件 authority");
    });

    it("没有落点时不创建实例（懒实例化）", async () => {
        const wrapper = mountInstances({
            views: () => [entryOf("nbook.files")],
            anchors: () => [],
        });

        await settle();
        expect(wrapper.find("[data-probe]").exists()).toBe(false);
        expect(probeInstances).toBe(0);
    });
});


/**
 * 标题动作的实例事件：代际由实例层分配，句柄 / 状态与代际一起转发；
 * 跨容器搬 DOM 不变代际，真释放（不可见）后重新可见才是新代际。
 */
const ActionProbe = defineComponent({
    name: "ActionProbeView",
    emits: ["actions-change", "action-handle-ready"],
    setup(_, {emit}) {
        probeInstances += 1;
        const handle = {runAction: async () => ({ok: true, value: null} as const)};
        const states = ref<readonly ViewTitleActionState[]>([{id: "refresh", enabled: true}]);
        // 真实叶（WorkspaceFilePanel）也是在实例就绪时上报句柄与状态，这里保持同序。
        emit("action-handle-ready", handle);
        watch(states, () => emit("actions-change", states.value), {immediate: true});
        onBeforeUnmount(() => emit("action-handle-ready", null));
        return () => h("div", {"data-probe": "actions"}, [
            h("button", {"data-announce": true, onClick: () => {
                emit("action-handle-ready", handle);
                emit("actions-change", states.value);
            }}, "再次上报"),
        ]);
    },
});

function actionEntries(): readonly WorkbenchViewEntry[] {
    return [entryOf("nbook.actions")];
}

describe("WorkbenchViewInstances 的标题动作转发", () => {
    it("句柄与状态都带同一个代际；跨位置搬 DOM 后仍是同一个实例、同一个代际", async () => {
        const viewHandleReady = vi.fn();
        const viewActions = vi.fn();
        const anchors = ref<AnchorSpec[]>([{key: "left", viewId: "nbook.actions", show: true}]);
        const wrapper = mountInstances({
            views: actionEntries,
            factories: {"lab.view.nbook.actions": ActionProbe},
            anchors: () => anchors.value,
            events: {viewHandleReady, viewActions},
        });
        await settle();

        expect(viewHandleReady).toHaveBeenCalledWith(
            {viewId: "nbook.actions", generation: 1},
            expect.objectContaining({runAction: expect.any(Function)}),
        );
        expect(viewActions).toHaveBeenCalledWith({viewId: "nbook.actions", generation: 1}, [{id: "refresh", enabled: true}]);

        // 换落点（视图像素级搬走）：同一个实例，再次上报仍是同一代际。
        anchors.value = [{key: "panel", viewId: "nbook.actions", show: true}];
        await settle();
        expect(probeInstances).toBe(1);
        viewHandleReady.mockClear();
        await wrapper.find("[data-probe=\"actions\"] [data-announce]").trigger("click");
        await settle();

        expect(viewHandleReady).toHaveBeenCalledTimes(1);
        expect(viewHandleReady.mock.calls[0]![0]).toEqual({viewId: "nbook.actions", generation: 1});
    });

    it("真释放才换代际：不可见后重新可见拿到更大的代际（新实例）", async () => {
        const viewHandleReady = vi.fn();
        const views = ref<readonly WorkbenchViewEntry[]>(actionEntries());
        const wrapper = mountInstances({
            views: () => views.value,
            factories: {"lab.view.nbook.actions": ActionProbe},
            anchors: () => [{key: "left", viewId: "nbook.actions", show: true}],
            events: {viewHandleReady},
        });
        await settle();
        expect(viewHandleReady.mock.calls[0]![0]).toEqual({viewId: "nbook.actions", generation: 1});

        views.value = [entryOf("nbook.actions", {visible: false, visibilityReasons: ["需要打开 Project"]})];
        await settle();
        expect(wrapper.find("[data-probe=\"actions\"]").exists()).toBe(false);
        // 真释放：实例卸载时上报 null（把句柄交回），而不是让宿主继续拿着旧句柄。
        expect(viewHandleReady.mock.calls.at(-1)).toEqual([{viewId: "nbook.actions", generation: 1}, null]);

        views.value = actionEntries();
        await settle();
        expect(probeInstances).toBe(2);
        const revived = viewHandleReady.mock.calls.at(-1)!;
        expect(revived[0]).toEqual({viewId: "nbook.actions", generation: 2});
        expect(revived[1]).toMatchObject({runAction: expect.any(Function)});
    });
});
