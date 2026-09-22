// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {defineComponent, h, nextTick, ref, type Component, type Ref} from "vue";
import {mount, type VueWrapper} from "@vue/test-utils";
import {DragDropProvider, useDragDropManager} from "@dnd-kit/vue";
import {GridRenderer, type GridBranch, type GridGestureCommit, type GridLayoutResult, type GridLeaf, type GridNode} from "@notnotype/nb-ui/layout";
import type {DescriptorResult, WorkbenchCatalog, WorkbenchContext} from "nbook/app/utils/workbench/descriptors";
import {createWorkbenchRegistry} from "nbook/app/utils/workbench/descriptors";
import {
    resolveViewPresentation,
    SHELL_FILES_VIEW,
    type ContainerViewPresentation,
    type WorkbenchViewEntry,
    type WorkbenchViewPresentation,
} from "nbook/app/utils/workbench/product-catalog";
import {SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER, SHELL_RIGHT_CONTAINER} from "nbook/app/utils/workbench/containers";
import {useWorkbenchDrop, useWorkbenchDropGeometry, type WorkbenchDropPorts} from "nbook/app/composables/useWorkbenchDrop";
import type {WorkbenchDropContentRects} from "nbook/app/utils/workbench/workbench-drop";
import type {ViewPlacementsOutcome} from "nbook/app/utils/workbench/view-placements-session";
import type {ViewSizePatch} from "nbook/app/utils/workbench/view-placements";
import {VIEW_MIN_MAIN_SIZE_PX, VIEW_SIZE_BASE_PX} from "nbook/app/utils/workbench/view-container-layout";
import type {WorkbenchTitleActionsByView} from "nbook/app/utils/workbench/view-title-actions";
import WorkbenchTitleActions from "nbook/app/components/workbench/WorkbenchTitleActions.vue";
import WorkbenchViewHost, {type WorkbenchViewSizesEvent} from "nbook/app/components/workbench/WorkbenchViewHost.vue";
import WorkbenchViewInstances from "nbook/app/components/workbench/WorkbenchViewInstances.vue";

/**
 * dnd-kit 的 DOM 包在**模块初始化**时就要 `ResizeObserver`（拖放落点的尺寸观察）。
 * jsdom 不提供它，静态导入又早于本文件的顶层语句，因此用 `vi.hoisted` 抢在导入之前补上替身。
 */
vi.hoisted(() => {
    if (typeof (globalThis as {ResizeObserver?: unknown}).ResizeObserver === "undefined") {
        Object.assign(globalThis, {
            ResizeObserver: class {
                observe(): void {}
                unobserve(): void {}
                disconnect(): void {}
            },
        });
    }
});

/**
 * 容器内部宿主的行为：每个可见 View 一个 Section（标题 + 内容落点）排成竖向 Grid、把落点登记给实例层、
 * 渲染不出来的原因可见、尺寸与折叠意图只经 emits 交回宿主，标题动作按 **emits** 回传。
 *
 * 落点那一侧不止读属性：真实 `useWorkbenchDrop` 的几何登记由后代探针捕获，
 * 「内容盒 + 可见叶矩形」这一份（判定层算插入位、也算来源比例）直接按读法断言。
 *
 * 视图实例由相邻的 `WorkbenchViewInstances` 渲染（产品里也是这个关系），
 * 因此这里同时验证「宿主登记 → 实例搬进落点」这条通道；实例的生命周期细节在
 * `WorkbenchViewInstances.test.ts`。
 */

let probeInstances = 0;

function probeFor(viewId: string): Component {
    return defineComponent({
        name: `HostProbe${viewId}`,
        setup() {
            probeInstances += 1;
            const local = ref(`${viewId}-state`);
            return () => h("div", {"data-probe": viewId}, [
                h("span", {"data-local": ""}, local.value),
                h("button", {"data-mutate": true, onClick: () => { local.value = `${viewId}-changed`; }}, "改状态"),
            ]);
        },
    });
}

const FILES = SHELL_FILES_VIEW.id;
const OUTLINE = "nbook.outline";
const TERMINAL = "nbook.terminal";
const BROKEN = "nbook.broken";

const CATALOG: WorkbenchCatalog = {
    parts: [],
    containers: [SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER, SHELL_RIGHT_CONTAINER],
    views: [
        {...SHELL_FILES_VIEW, factoryKey: `lab.view.${FILES}`},
        {...SHELL_FILES_VIEW, id: OUTLINE, titleKey: `lab.view.${OUTLINE}`, order: 20, factoryKey: `lab.view.${OUTLINE}`},
        {...SHELL_FILES_VIEW, id: TERMINAL, titleKey: `lab.view.${TERMINAL}`, container: SHELL_PANEL_CONTAINER.id, order: 10, factoryKey: `lab.view.${TERMINAL}`},
        // 白名单里没有的 factoryKey：可见时的诊断必须落在自己的锚点里。
        {...SHELL_FILES_VIEW, id: BROKEN, titleKey: `lab.view.${BROKEN}`, order: 30, factoryKey: "lab.view.missing", when: {requires: ["user-assets"]}},
    ],
};

const FACTORIES: Record<string, Component> = {
    [`lab.view.${FILES}`]: probeFor(FILES),
    [`lab.view.${OUTLINE}`]: probeFor(OUTLINE),
    [`lab.view.${TERMINAL}`]: probeFor(TERMINAL),
};

const REGISTRY = (() => {
    const created = createWorkbenchRegistry(CATALOG);
    if (!created.ok) {
        throw new Error(created.reason);
    }
    return created.value;
})();

function contextOf(project: boolean, userAssets = false): WorkbenchContext {
    return {
        project,
        selection: false,
        "user-assets": userAssets,
        desktop: false,
        authorities: {project, session: false, job: false, files: project},
        projectRoot: project ? "/workspace/demo" : null,
    };
}

function presentationOf(project = true, userAssets = false): WorkbenchViewPresentation {
    return resolveViewPresentation({
        registry: REGISTRY,
        context: contextOf(project, userAssets),
        titleOf: (descriptor) => `t:${descriptor.titleKey}`,
    });
}

function sliceOf(presentation: WorkbenchViewPresentation, containerId: string): ContainerViewPresentation {
    const container = presentation.container(containerId);
    if (container === null) {
        throw new Error(`测试的容器切片不存在：${containerId}`);
    }
    return container;
}

// ── 模式与轴的场景目录 ───────────────────────────────────────────────────────

/**
 * 模式/轴用例用的最小目录（与上面的 CATALOG 无关，避免为了造 0→1→2→1 去改已有断言的可见性）：
 * 左容器 `mode-a` 恒可见、`mode-b` 只在 `user-assets` 下可见；Panel 容器两个都恒可见（左右排）。
 */
const MODE_A = "lab.mode-a";
const MODE_B = "lab.mode-b";
const PANEL_A = "lab.panel-a";
const PANEL_B = "lab.panel-b";

const MODE_CATALOG: WorkbenchCatalog = {
    parts: [],
    containers: [SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER],
    views: [
        {...SHELL_FILES_VIEW, id: MODE_A, titleKey: `lab.view.${MODE_A}`, container: SHELL_LEFT_CONTAINER.id, order: 10, factoryKey: `lab.view.${FILES}`},
        {...SHELL_FILES_VIEW, id: MODE_B, titleKey: `lab.view.${MODE_B}`, container: SHELL_LEFT_CONTAINER.id, order: 20, when: {requires: ["user-assets"]}, factoryKey: `lab.view.${OUTLINE}`},
        {...SHELL_FILES_VIEW, id: PANEL_A, titleKey: `lab.view.${PANEL_A}`, container: SHELL_PANEL_CONTAINER.id, order: 10, factoryKey: `lab.view.${TERMINAL}`},
        {...SHELL_FILES_VIEW, id: PANEL_B, titleKey: `lab.view.${PANEL_B}`, container: SHELL_PANEL_CONTAINER.id, order: 20, factoryKey: `lab.view.${OUTLINE}`},
    ],
};

const MODE_REGISTRY = (() => {
    const created = createWorkbenchRegistry(MODE_CATALOG);
    if (!created.ok) {
        throw new Error(created.reason);
    }
    return created.value;
})();

function modePresentation(userAssets = false): WorkbenchViewPresentation {
    return resolveViewPresentation({
        registry: MODE_REGISTRY,
        context: contextOf(true, userAssets),
        titleOf: (descriptor) => `t:${descriptor.titleKey}`,
    });
}

/** 宿主只吃**已求值**的展示项：这里给一份字面量，覆盖 primary / secondary / 禁用。 */
function actionsOf(viewId: string, generation = 1): WorkbenchTitleActionsByView {
    return {
        [viewId]: {
            target: {viewId, generation},
            primary: [{id: "refresh", label: "刷新", icon: "i-lucide-refresh-cw"}],
            secondary: [{id: "secondary-demo", label: "次要动作", icon: "i-lucide-wand-2"}],
        },
    };
}

/**
 * 某个容器在当前渲染里的单轴树与发布布局：按**分支 id** 找，不依赖容器在实例层里的顺序
 * （同一页面上多个容器都有渲染器，只按「第一个」取会读到别的容器）。
 *
 * `props()` 给的是 `any`，所以这里按领域类型接住再做运行期收窄，而不是就地断言一个形状。
 */
function gridOf(wrapper: VueWrapper, containerId: string): {node: GridBranch<WorkbenchViewEntry>; layout: GridLayoutResult} {
    for (const renderer of wrapper.findAllComponents(GridRenderer)) {
        // `GridRenderer` 的 props 是无泛型的（运行期才知道 ref 形状），这里按容器的领域类型接住。
        const node = renderer.props("node") as GridNode<WorkbenchViewEntry> | null;
        if (node === null || node.kind !== "branch" || node.id !== `container:${containerId}`) {
            continue;
        }
        const layout: GridLayoutResult = renderer.props("layout");
        return {node, layout};
    }
    throw new Error(`找不到容器 ${containerId} 的 Grid（渲染器里没有它的分支）`);
}

/** 容器里第 `index` 个叶（树序 = 呈现顺序）；不是叶就抛，失败时能看出是树的问题。 */
function leafOf(wrapper: VueWrapper, containerId: string, index = 0): GridLeaf<WorkbenchViewEntry> {
    const child = gridOf(wrapper, containerId).node.children[index];
    if (child === undefined || child.kind !== "leaf") {
        throw new Error(`容器 ${containerId} 的第 ${index} 个叶不存在或不是叶：${child === undefined ? "缺失" : child.kind}`);
    }
    return child;
}

type HostEvents = {
    moveView: (request: {viewId: string; sourceContainerId: string; targetContainerId: string}) => void;
    viewSizes: (payload: WorkbenchViewSizesEvent) => void;
    titleAction: (payload: {scope: string; actionId: string}) => void;
};

const mounted: VueWrapper[] = [];

/**
 * dnd-kit 的落点不产 DOM 属性：它登记进 manager 的注册表。要验证「本容器是个接受
 * `workbench-view` 的落点」，就得拿到 manager——走 `useDragDropManager`（`@dnd-kit/vue` 的公开入口），
 * 而不是 import 传递依赖 `@dnd-kit/dom`。
 */
type RegisteredDropTarget = {
    type?: string;
    data?: {kind?: string; containerId?: string; beforeViewId?: string};
    disabled?: boolean;
    accepts(draggable: {type?: string; data?: unknown}): boolean;
};

type RegisteredDraggable = {
    type?: string;
    data?: {kind?: string; viewId?: string; containerId?: string; location?: string; contextKey?: string};
    disabled?: boolean;
};

type DropRegistry = {
    registry: {
        droppables: {get(id: string): RegisteredDropTarget | undefined};
        draggables: {get(id: string): RegisteredDraggable | undefined};
    };
};

let dropRegistry: DropRegistry | null = null;

const RegistryProbe = defineComponent({
    name: "RegistryProbe",
    setup() {
        dropRegistry = useDragDropManager().value as unknown as DropRegistry;
        return () => null;
    },
});

function dropTargetOf(id: string): RegisteredDropTarget | undefined {
    return dropRegistry?.registry.droppables.get(id);
}

/** 宿主登记给几何层的内容几何读法（按容器）：登记表只有写入端，读法只能对 `registerContent` 做**保留原实现**的 spy 拿回来。 */
const contentReads = new Map<string, () => WorkbenchDropContentRects | null>();

const GeometryProbe = defineComponent({
    name: "ContentGeometryProbe",
    setup() {
        const geometry = useWorkbenchDropGeometry();
        if (geometry === null) {
            throw new Error("几何探针必须在 useWorkbenchDrop 的子树里");
        }
        const register = geometry.registerContent.bind(geometry);
        vi.spyOn(geometry, "registerContent").mockImplementation((containerId, read) => {
            const unregister = register(containerId, read);
            contentReads.set(containerId, read);
            return () => {
                unregister();
                if (contentReads.get(containerId) === read) {
                    contentReads.delete(containerId);
                }
            };
        });
        return () => null;
    },
});

function contentReadOf(containerId: string): () => WorkbenchDropContentRects | null {
    const read = contentReads.get(containerId);
    if (read === undefined) {
        throw new Error(`没有登记容器 ${containerId} 的内容几何读法`);
    }
    return read;
}

/** 提供者端口：这一层只登记几何与落点，不提交任何移动（拖动闭环归浏览器 smoke），四种动作一律拒绝。 */
const REFUSING_PORTS: WorkbenchDropPorts = {
    moveView: () => Promise.resolve<ViewPlacementsOutcome>({status: "rejected", diagnosis: "测试不提交移动"}),
    detachView: () => Promise.resolve<ViewPlacementsOutcome>({status: "rejected", diagnosis: "测试不提交移动"}),
    moveContainer: () => Promise.resolve<ViewPlacementsOutcome>({status: "rejected", diagnosis: "测试不提交移动"}),
    mergeContainer: () => Promise.resolve<ViewPlacementsOutcome>({status: "rejected", diagnosis: "测试不提交移动"}),
};

/**
 * jsdom 里所有盒子都是 0：给被测的 Grid 一个真实尺寸，布局与手势基线才有意义。
 *
 * 承载盒的**布局尺寸**走 `clientWidth/clientHeight`（`useLayoutExtent`），命中盒走 client rect，
 * 两者都要给值：只补一个会让「有尺寸」与「命中」互相对不上。
 */
function stubBoxes(width = 600, height = 600): void {
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(width);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(height);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const rect = {x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({})};
        return rect as DOMRect;
    });
}

/** 宿主 + 实例层：产品里宿主就是实例层的子树（落点登记走 provide 的通道）。 */
function mountHost(options: {
    containerId?: string;
    presentation?: Ref<WorkbenchViewPresentation>;
    viewSizes?: Ref<Readonly<Record<string, {width?: number; height?: number; collapsed?: boolean}>>>;
    contextKey?: string;
    actionsContextKey?: string;
    allowViewMove?: boolean;
    allowContainerMove?: boolean;
    moveLabel?: string;
    actionsByView?: WorkbenchTitleActionsByView;
    /** 真挂进 `document.body`：只有要读**可见矩形**的用例需要它（读法对断连元素一律给 `null`）。 */
    attach?: boolean;
    events?: Partial<HostEvents>;
}) {
    const containerId = options.containerId ?? SHELL_LEFT_CONTAINER.id;
    const presentation = options.presentation ?? ref(presentationOf());
    const viewSizes = options.viewSizes ?? ref({});

    const Root = defineComponent({
        name: "HostHarness",
        setup() {
            // 真实几何登记：宿主通过注入拿到它、在挂载时登记内容几何（探针就是在这里捕获的）。
            // 拖动会话不在 jsdom 里驱动（完整闭环归浏览器 smoke），因此只装上提供者本身。
            useWorkbenchDrop({
                presentation: () => presentation.value,
                contextKey: () => options.contextKey ?? "surface-1",
                ports: REFUSING_PORTS,
            });
            // 宿主是工具拖放的落点（`useDroppable`），必须在 `DragDropProvider` 子树里；
            // 产品页面同样如此，测试用空传感器（拖动源自带的传感器仍然生效）。
            return () => h(
                DragDropProvider,
                {sensors: []},
                {
                    default: () => h(
                        "div",
                        [
                            h(RegistryProbe),
                            h(GeometryProbe),
                            h(
                                WorkbenchViewInstances,
                                {
                                    views: presentation.value.entries,
                                    viewFactoryResolver: (factoryKey: string): DescriptorResult<Component> => {
                                        const component = FACTORIES[factoryKey];
                                        return component === undefined
                                            ? {ok: false, reason: `未登记的内置 factoryKey：${factoryKey}`}
                                            : {ok: true, value: component};
                                    },
                                },
                                {
                                    default: () => h(WorkbenchViewHost, {
                                        presentation: sliceOf(presentation.value, containerId),
                                        viewSizes: viewSizes.value,
                                        contextKey: options.contextKey ?? "surface-1",
                                        actionsContextKey: options.actionsContextKey ?? "panel-state-1",
                                        allowContainerMove: options.allowContainerMove ?? false,
                                        allowViewMove: options.allowViewMove ?? false,
                                        moveLabel: options.moveLabel ?? "",
                                        viewActionsLabel: "视图操作",
                                        actionsByView: options.actionsByView ?? {},
                                        onMoveView: options.events?.moveView,
                                        onViewSizes: options.events?.viewSizes,
                                        onTitleAction: options.events?.titleAction,
                                    }),
                                },
                            ),
                        ],
                    ),
                },
            );
        },
    });

    const wrapper = options.attach === true ? mount(Root, {attachTo: document.body}) : mount(Root);
    mounted.push(wrapper);
    return wrapper;
}

async function settle(): Promise<void> {
    for (let tick = 0; tick < 4; tick += 1) {
        await nextTick();
    }
}

/** 菜单浮层渲染在 body 上的 portal 里：按可读文本找菜单项。 */
function menuItem(text: string): HTMLElement | undefined {
    return [...document.body.querySelectorAll<HTMLElement>("[role=\"menuitem\"]")]
        .find((element) => element.textContent?.includes(text));
}

beforeEach(() => {
    probeInstances = 0;
    contentReads.clear();
    stubBoxes();
    vi.stubGlobal("ResizeObserver", class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    });
    // 菜单（reka-ui 的 Popper）在挂载时要观察遮挡：jsdom 不提供它。
    vi.stubGlobal("IntersectionObserver", class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
        takeRecords(): [] { return []; }
    });
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
        wrapper.unmount();
    }
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("WorkbenchViewHost", () => {
    it("每个可见视图一个 Section 行头 + 落点，实例由实例层搬进来", async () => {
        const wrapper = mountHost({});
        await settle();

        expect(wrapper.find(`[data-container-id="${SHELL_LEFT_CONTAINER.id}"]`).exists()).toBe(true);
        expect(wrapper.find(`[data-container-location="sidebar-left"]`).exists()).toBe(true);
        // 左栏容器内部上下排、两个可见 View：标签条与方向都由切片给，不在宿主里硬编码。
        expect(wrapper.find(`[data-container-id="${SHELL_LEFT_CONTAINER.id}"]`).attributes("data-container-orientation")).toBe("vertical");
        expect(wrapper.find(`[data-container-id="${SHELL_LEFT_CONTAINER.id}"]`).attributes("data-container-mode")).toBe("multiple");

        const sections = wrapper.findAll("[data-section]");
        expect(sections.map((section) => section.attributes("data-section"))).toEqual([FILES, OUTLINE]);
        expect(sections[0]!.text()).toContain(`t:${SHELL_FILES_VIEW.titleKey}`);
        expect(sections[0]!.attributes("data-view-id")).toBe(FILES);
        expect(wrapper.find(`[data-section="${FILES}"] [data-probe="${FILES}"]`).exists()).toBe(true);
        expect(wrapper.find(`[data-section="${OUTLINE}"] [data-probe="${OUTLINE}"]`).exists()).toBe(true);
        expect(probeInstances).toBe(2);

        // 叶与分支 id 各带 `view:` / `container:` 前缀，不与外壳的七个叶混用。
        expect(wrapper.find(`[data-leaf="view:${FILES}"]`).exists()).toBe(true);
        expect(wrapper.findComponent(GridRenderer).props("node")).toMatchObject({id: `container:${SHELL_LEFT_CONTAINER.id}`, orientation: "vertical"});
    });

    it("Section 标题是折叠入口：aria-expanded 与内容显隐跟着受控收起位", async () => {
        const viewSizes = ref<Record<string, {height?: number; collapsed?: boolean}>>({[FILES]: {collapsed: true}});
        const wrapper = mountHost({viewSizes});
        await settle();

        const toggle = wrapper.find(`[data-section="${FILES}"] [aria-controls="section-body-${FILES}"]`);
        expect(toggle.attributes("aria-expanded")).toBe("false");
        expect(wrapper.find(`[data-section="${FILES}"]`).attributes("data-collapsed")).toBe("true");
        expect(wrapper.find(`[data-section="${OUTLINE}"]`).attributes("data-collapsed")).toBe("false");
    });

    it("折叠按钮发出 view-sizes：一批只改这一个 View，带上容器与工作面", async () => {
        const viewSizes = vi.fn();
        const wrapper = mountHost({events: {viewSizes}});
        await settle();

        await wrapper.find(`[data-section="${FILES}"] [aria-controls="section-body-${FILES}"]`).trigger("click");
        expect(viewSizes).toHaveBeenCalledWith({
            containerId: SHELL_LEFT_CONTAINER.id,
            sourceLocation: "sidebar-left",
            contextKey: "surface-1",
            patches: [{viewId: FILES, collapsed: true}],
        });
    });

    it("不可见视图不进 DOM，空态给出 when 原因，并留下列表的空落点", async () => {
        const wrapper = mountHost({presentation: ref(presentationOf(false)), allowViewMove: true});
        await settle();

        expect(wrapper.find(`[data-view="${FILES}"]`).exists()).toBe(false);
        expect(wrapper.find("[data-probe]").exists()).toBe(false);
        expect(wrapper.text()).toContain("需要打开 Project");
        expect(wrapper.find(`[data-container-empty="${SHELL_LEFT_CONTAINER.id}"]`).exists()).toBe(true);
        // 逐容器只有一个内容落点，逐 Section 的落点一个都不存在。
        expect(dropTargetOf(`workbench-view-target:${SHELL_LEFT_CONTAINER.id}/before/${OUTLINE}`)).toBeUndefined();
    });

    it("factoryKey 不在白名单里：诊断落在该视图的锚点内，其它视图照常渲染", async () => {
        const wrapper = mountHost({presentation: ref(presentationOf(true, true))});
        await settle();

        const broken = wrapper.find(`[data-section="${BROKEN}"]`);
        expect(broken.exists()).toBe(true);
        expect(broken.text()).toContain("未登记的内置 factoryKey：lab.view.missing");
        expect(wrapper.find(`[data-section="${FILES}"] [data-probe="${FILES}"]`).exists()).toBe(true);
    });

    it("实例通道缺失（页面忘了包实例层）时给出诊断，而不是静默空白", async () => {
        const wrapper = mount(defineComponent({
            name: "HostWithoutInstances",
            setup() {
                return () => h(DragDropProvider, {sensors: []}, {
                    default: () => h(WorkbenchViewHost, {
                        presentation: sliceOf(presentationOf(), SHELL_LEFT_CONTAINER.id),
                    }),
                });
            },
        }));
        mounted.push(wrapper);
        await settle();

        expect(wrapper.find("[data-view-instance-channel=\"missing\"]").exists()).toBe(true);
        // 容器与落点照画，只是没有实例来接。
        expect(wrapper.find(`[data-view="${FILES}"]`).exists()).toBe(true);
    });

    it("View 动作点击带上**渲染时**捕获的 target；没有动作时不渲染这个组", async () => {
        const titleAction = vi.fn();
        const withActions = mountHost({actionsByView: actionsOf(FILES, 4), events: {titleAction}});
        await settle();

        const refresh = withActions.find(`[data-section="${FILES}"] [data-title-action="refresh"]`);
        expect(refresh.exists()).toBe(true);
        await refresh.trigger("click");

        expect(titleAction).toHaveBeenCalledWith({
            scope: "view",
            target: {viewId: FILES, generation: 4},
            actionId: "refresh",
        });

        const withoutActions = mountHost({});
        await settle();
        expect(withoutActions.find(`[data-section="${FILES}"] [data-title-actions]`).exists()).toBe(false);
        expect(withoutActions.findAll("[data-title-action=\"more\"]")).toHaveLength(0);
    });

    it("次要动作进「更多」：菜单项回传同一个 target", async () => {
        const titleAction = vi.fn();
        const wrapper = mountHost({actionsByView: actionsOf(FILES, 2), events: {titleAction}});
        await settle();

        await wrapper.find(`[data-section="${FILES}"] [data-title-action="more"]`).trigger("click");
        await settle();
        const item = menuItem("次要动作");
        expect(item).toBeTruthy();
        item!.click();
        await settle();

        expect(titleAction).toHaveBeenCalledWith({
            scope: "view",
            target: {viewId: FILES, generation: 2},
            actionId: "secondary-demo",
        });
    });

    it("移动入口：没开移动就没有「移动到」；开了以后菜单按切片的落点发出 move-view", async () => {
        const moveView = vi.fn();
        const withoutMove = mountHost({});
        await settle();
        expect(withoutMove.find(`[data-section="${FILES}"] [data-title-action="more"]`).exists()).toBe(false);

        const wrapper = mountHost({
            allowViewMove: true,
            moveLabel: "移动到",
            actionsByView: actionsOf(FILES),
            events: {moveView},
        });
        await settle();

        await wrapper.find(`[data-section="${FILES}"] [data-title-action="more"]`).trigger("click");
        await settle();
        const parent = menuItem("移动到");
        expect(parent).toBeTruthy();
        // 子菜单父项不执行：点它不会发出任何事件。
        parent!.click();
        await settle();
        expect(moveView).not.toHaveBeenCalled();

        const child = menuItem(`t:${SHELL_PANEL_CONTAINER.titleKey}`);
        expect(child).toBeTruthy();
        child!.click();
        await settle();

        expect(moveView).toHaveBeenCalledWith({
            viewId: FILES,
            sourceContainerId: SHELL_LEFT_CONTAINER.id,
            targetContainerId: SHELL_PANEL_CONTAINER.id,
        });
    });

    it("落点契约：一个容器只有**一个**内容落点（插入位交给几何求值）；只读宿主 disabled", async () => {
        mountHost({allowViewMove: true, allowContainerMove: true});
        await settle();

        const content = dropTargetOf(`workbench-container-content-target:${SHELL_LEFT_CONTAINER.id}`);
        expect(content?.disabled).toBe(false);
        expect(content?.data).toEqual({
            kind: "workbench-container-content-target",
            containerId: SHELL_LEFT_CONTAINER.id,
            location: "sidebar-left",
        });
        // 两种源都接：View 沿轴插到几何算出的位置，容器整组并入这一个容器。
        expect(content?.accepts({type: "workbench-view", data: {viewId: FILES}})).toBe(true);
        expect(content?.accepts({type: "workbench-container", data: {containerId: SHELL_PANEL_CONTAINER.id}})).toBe(true);
        expect(content?.accepts({type: "editor-tab"})).toBe(false);
        // 每个 Section 不再各注册一个落点：一屏几个 View 也只有一条内容落点。
        expect(dropTargetOf(`workbench-view-target:${SHELL_LEFT_CONTAINER.id}/end`)).toBeUndefined();

        dropRegistry = null;
        mountHost({});
        await settle();
        expect(dropTargetOf(`workbench-container-content-target:${SHELL_LEFT_CONTAINER.id}`)?.disabled).toBe(true);
    });

    it("内容几何登记：只给可见成员、按呈现顺序；成员一个都量不出来时整份几何作废", async () => {
        const wrapper = mountHost({attach: true});
        await settle();
        // jsdom 的根 client 盒与真实布局无关：给一个真实视口，可见矩形求交才有意义（真实浏览器由布局引擎给）。
        vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1600);
        vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(1300);
        const read = contentReadOf(SHELL_LEFT_CONTAINER.id);

        // 左容器登记了三个成员、两个可见（`nbook.broken` 的 when 不满足）：几何只给可见的那两个，顺序按呈现。
        const geometry = read();
        expect(geometry).not.toBeNull();
        expect(geometry!.containerId).toBe(SHELL_LEFT_CONTAINER.id);
        expect(geometry!.members.map((member) => member.id)).toEqual([FILES, OUTLINE]);
        expect(geometry!.rect.right).toBeGreaterThan(geometry!.rect.left);
        expect(geometry!.rect.bottom).toBeGreaterThan(geometry!.rect.top);

        // 可见成员一个都读不出可见矩形（`hidden` / 被裁掉 / 零尺寸都是这一档）：不能交一份空成员表出去——
        // 判定层会把它当成空容器（承诺"成为第一个视图"），比拒绝更糟。整份几何作废。
        wrapper.findAll("[data-section]").forEach((section) => section.element.setAttribute("hidden", ""));
        expect(read()).toBeNull();
    });

    it("落点按源类型独立受 allowViewMove / allowContainerMove 控制", async () => {
        mountHost({allowViewMove: true});
        await settle();
        let content = dropTargetOf(`workbench-container-content-target:${SHELL_LEFT_CONTAINER.id}`);
        expect(content?.accepts({type: "workbench-view", data: {viewId: FILES}})).toBe(true);
        expect(content?.accepts({type: "workbench-container", data: {containerId: SHELL_PANEL_CONTAINER.id}})).toBe(false);

        dropRegistry = null;
        mountHost({allowContainerMove: true});
        await settle();
        content = dropTargetOf(`workbench-container-content-target:${SHELL_LEFT_CONTAINER.id}`);
        expect(content?.accepts({type: "workbench-view", data: {viewId: FILES}})).toBe(false);
        expect(content?.accepts({type: "workbench-container", data: {containerId: SHELL_PANEL_CONTAINER.id}})).toBe(true);
    });

    it("拖动源：整标题一个源，载荷是当前 View 与来源容器，id 每个实例不同且稳定", async () => {
        const wrapper = mountHost({allowViewMove: true, contextKey: "surface-1"});
        await settle();

        const heads = wrapper.findAll("[data-workbench-drag-kind=\"view\"]");
        expect(heads).toHaveLength(2);

        const sources = [...(dropRegistry!.registry.draggables as unknown as Iterable<RegisteredDraggable & {id: string}>)]
            .filter((entry) => entry.type === "workbench-view");
        expect(sources).toHaveLength(2);
        expect(sources.map((entry) => entry.data?.viewId).sort()).toEqual([FILES, OUTLINE].sort());
        // 载荷冻结来源容器、生效落位与工作面代际：判定与记录层据此拒绝过期意图。
        expect(sources[0]!.data?.containerId).toBe(SHELL_LEFT_CONTAINER.id);
        expect(sources[0]!.data?.location).toBe("sidebar-left");
        expect(sources[0]!.data?.contextKey).toBe("surface-1");
        // 源 id 不是拿 viewId 拼出来的：两个实例的 id 互不相同，也不含载荷字面量。
        expect(new Set(sources.map((entry) => entry.id)).size).toBe(2);
        expect(sources.every((entry) => !entry.id.includes(FILES) && !entry.id.includes(OUTLINE))).toBe(true);

        // 没有拖动时源是启用的；不可移动的宿主不登记拖动源。
        expect(sources.every((entry) => entry.disabled === false)).toBe(true);
    });

    it("一场手势一次结算：整批 resizeBranches 后只把主动改变的叶折成一批 view-sizes", async () => {
        const viewSizes = vi.fn();
        const wrapper = mountHost({viewSizes: ref({}), events: {viewSizes}});
        await settle();

        const renderer = wrapper.findComponent(GridRenderer);
        const layout = renderer.props("layout") as {sizes: Record<string, {height: number}>};
        const revision = renderer.props("revision") as number;
        const baseline = {
            [`view:${FILES}`]: layout.sizes[`view:${FILES}`]!.height,
            [`view:${OUTLINE}`]: layout.sizes[`view:${OUTLINE}`]!.height,
        };
        const target = {
            [`view:${FILES}`]: baseline[`view:${FILES}`]! - 40,
            [`view:${OUTLINE}`]: baseline[`view:${OUTLINE}`]! + 40,
        };
        const commit: GridGestureCommit = {
            sessionId: "test-1",
            contextKey: "surface-1",
            source: "pointer",
            revision,
            extent: {width: 600, height: 600},
            changes: [{
                branchId: `container:${SHELL_LEFT_CONTAINER.id}`,
                axis: "height",
                baseline,
                extent: {width: 600, height: 600},
                target,
                active: [`view:${FILES}`, `view:${OUTLINE}`],
                compensated: [],
                collapsed: {},
            }],
        };

        const outcome = (renderer.props("onGestureCommit") as (commit: GridGestureCommit) => {ok: boolean})(commit);
        expect(outcome.ok).toBe(true);

        const events = wrapper.findComponent(WorkbenchViewHost).emitted("view-sizes") as unknown as [WorkbenchViewSizesEvent][];
        expect(events).toHaveLength(1);
        const [payload] = events[0]!;
        expect(payload.containerId).toBe(SHELL_LEFT_CONTAINER.id);
        expect(payload.contextKey).toBe("surface-1");
        const patches: readonly ViewSizePatch[] = payload.patches;
        expect(patches.map((patch) => patch.viewId).sort()).toEqual([FILES, OUTLINE].sort());
        const files = patches.find((patch) => patch.viewId === FILES)!;
        const outline = patches.find((patch) => patch.viewId === OUTLINE)!;
        expect(files.height).toBeLessThan(VIEW_SIZE_BASE_PX);
        expect(outline.height).toBeGreaterThan(VIEW_SIZE_BASE_PX);
        expect(outline.height).toBeGreaterThanOrEqual(VIEW_MIN_MAIN_SIZE_PX);

        // 同一次提交里已发布的布局跟上了新意图（受控发布，宿主据此释放预览）。
        await settle();
        const nextLayout = wrapper.findComponent(GridRenderer).props("layout") as {sizes: Record<string, {height: number}>};
        expect(Math.abs(nextLayout.sizes[`view:${FILES}`]!.height - target[`view:${FILES}`]!)).toBeLessThan(1);
    });

    it("手势里拖到收起：只把收起位写进记录，0 / 收起尺寸绝不写进高度意图", async () => {
        const viewSizes = vi.fn();
        const wrapper = mountHost({viewSizes: ref({}), events: {viewSizes}});
        await settle();

        const renderer = wrapper.findComponent(GridRenderer);
        const layout = renderer.props("layout") as {sizes: Record<string, {height: number}>};
        const revision = renderer.props("revision") as number;
        const baseline = {
            [`view:${FILES}`]: layout.sizes[`view:${FILES}`]!.height,
            [`view:${OUTLINE}`]: layout.sizes[`view:${OUTLINE}`]!.height,
        };
        const commit: GridGestureCommit = {
            sessionId: "test-collapse",
            contextKey: "surface-1",
            source: "pointer",
            revision,
            extent: {width: 600, height: 600},
            changes: [{
                branchId: `container:${SHELL_LEFT_CONTAINER.id}`,
                axis: "height",
                baseline,
                extent: {width: 600, height: 600},
                target: baseline,
                active: [`view:${FILES}`],
                compensated: [],
                collapsed: {[`view:${FILES}`]: true},
            }],
        };

        expect((renderer.props("onGestureCommit") as (commit: GridGestureCommit) => {ok: boolean})(commit).ok).toBe(true);

        const events = wrapper.findComponent(WorkbenchViewHost).emitted("view-sizes") as unknown as [WorkbenchViewSizesEvent][];
        expect(events).toHaveLength(1);
        const [payload] = events[0]!;
        expect(payload.patches).toEqual([{viewId: FILES, collapsed: true}]);

        // 呈现上叶高就是标题高（32px），但记录里没有 0 / 32 这样的「高度意图」。
        await settle();
        const nextLayout = wrapper.findComponent(GridRenderer).props("layout") as {sizes: Record<string, {height: number}>};
        expect(nextLayout.sizes[`view:${FILES}`]!.height).toBe(32);
    });

    it("工作面已经切走时的手势被拒绝：诊断可见、不改几何", async () => {
        const wrapper = mountHost({contextKey: "surface-1"});
        await settle();

        const renderer = wrapper.findComponent(GridRenderer);
        const revision = renderer.props("revision") as number;
        const outcome = (renderer.props("onGestureCommit") as (commit: GridGestureCommit) => {ok: boolean; reason?: string})({
            sessionId: "test-2",
            contextKey: "surface-2",
            source: "pointer",
            revision,
            extent: {width: 600, height: 600},
            changes: [],
        });

        expect(outcome.ok).toBe(false);
        expect(outcome.reason).toContain("工作面已切换");
    });

    it("single：不渲染重复标题、折叠意图保留但不应用，落点与实例照旧", async () => {
        // 只让 mode-a 可见：左容器进入 single。
        const viewSizes = ref<Record<string, {width?: number; height?: number; collapsed?: boolean}>>({[MODE_A]: {height: 400, collapsed: true}});
        const wrapper = mountHost({presentation: ref(modePresentation(false)), viewSizes});
        await settle();

        const host = wrapper.find(`[data-container-id="${SHELL_LEFT_CONTAINER.id}"]`);
        expect(host.attributes("data-container-mode")).toBe("single");
        expect(host.attributes("data-container-orientation")).toBe("vertical");

        const section = wrapper.find(`[data-section="${MODE_A}"]`);
        expect(section.exists()).toBe(true);
        // 标题不渲染：没有折叠入口、也没有 View 拖动面。
        expect(section.find("[aria-controls]").exists()).toBe(false);
        expect(section.find("[data-workbench-drag-kind=\"view\"]").exists()).toBe(false);
        // 已有的收起意图保留在记录里，但 single 不应用它：呈现为展开。
        expect(section.attributes("data-collapsed")).toBe("false");
        expect(wrapper.find(`[data-view="${MODE_A}"]`).exists()).toBe(true);
        expect(wrapper.find(`[data-probe="${FILES}"]`).exists()).toBe(true);

        // 树上只有这一个叶、且不带收起策略（没有可拖的缝，也没有第二个标题可收）。
        const branch = gridOf(wrapper, SHELL_LEFT_CONTAINER.id).node;
        expect(branch.children.map((child) => child.id)).toEqual([`view:${MODE_A}`]);
        expect(leafOf(wrapper, SHELL_LEFT_CONTAINER.id).collapse).toBeUndefined();
        expect(viewSizes.value[MODE_A]!.collapsed).toBe(true);
    });

    it("single ↔ multiple：模式变化不重挂实例，落点元素也不换", async () => {
        const presentation = ref(modePresentation(false));
        const wrapper = mountHost({presentation});
        await settle();

        const host = () => wrapper.find(`[data-container-id="${SHELL_LEFT_CONTAINER.id}"]`);
        expect(host().attributes("data-container-mode")).toBe("single");
        const target = wrapper.find(`[data-view="${MODE_A}"]`).element;
        const probe = wrapper.find(`[data-probe="${FILES}"]`).element;
        expect(wrapper.findAll(`[data-probe="${FILES}"]`)).toHaveLength(1);

        presentation.value = modePresentation(true);
        await settle();
        expect(host().attributes("data-container-mode")).toBe("multiple");
        expect(wrapper.findAll("[data-section]").map((section) => section.attributes("data-section"))).toEqual([MODE_A, MODE_B]);
        // 同一个落点、同一个实例：模式不是 key。
        expect(wrapper.find(`[data-view="${MODE_A}"]`).element).toBe(target);
        expect(wrapper.find(`[data-probe="${FILES}"]`).element).toBe(probe);
        expect(wrapper.findAll(`[data-probe="${FILES}"]`)).toHaveLength(1);

        presentation.value = modePresentation(false);
        await settle();
        expect(host().attributes("data-container-mode")).toBe("single");
        expect(wrapper.find(`[data-probe="${FILES}"]`).element).toBe(probe);
        expect(wrapper.findAll(`[data-probe="${FILES}"]`)).toHaveLength(1);
    });

    it("容器换 Part：轴跟着换、已保存的两轴意图不换算，实例不重挂", async () => {
        const presentation = ref(modePresentation(false));
        const wrapper = mountHost({
            presentation,
            viewSizes: ref<Record<string, {width?: number; height?: number; collapsed?: boolean}>>({[MODE_A]: {height: 400}}),
        });
        await settle();

        const host = () => wrapper.find(`[data-container-id="${SHELL_LEFT_CONTAINER.id}"]`);
        expect(host().attributes("data-container-orientation")).toBe("vertical");
        // 上下排的容器读高度意图：记录里的 400 就是这一场的主轴意图。
        expect(leafOf(wrapper, SHELL_LEFT_CONTAINER.id).size).toEqual({width: 0, height: 400});
        const target = wrapper.find(`[data-view="${MODE_A}"]`).element;
        const probe = wrapper.find(`[data-probe="${FILES}"]`).element;

        // 同一个容器搬到 Panel：内部方向变成左右排，保存的两个数一个都不换算。
        presentation.value = resolveViewPresentation({
            registry: MODE_REGISTRY,
            context: contextOf(true, false),
            containerOverrides: {
                [SHELL_LEFT_CONTAINER.id]: {
                    location: "panel",
                    order: 10,
                    defaultLocation: "sidebar-left",
                    defaultOrder: 10,
                },
            },
            titleOf: (descriptor) => `t:${descriptor.titleKey}`,
        });
        await settle();

        expect(host().attributes("data-container-location")).toBe("panel");
        expect(host().attributes("data-container-orientation")).toBe("horizontal");
        // 横向容器读宽度意图：没有保存宽度就用缺省 `240 * weight`，而不是把 400 当宽度。
        expect(leafOf(wrapper, SHELL_LEFT_CONTAINER.id).size).toEqual({width: VIEW_SIZE_BASE_PX, height: 0});
        // 实例与落点都没换（轴不是 key）。
        expect(wrapper.find(`[data-probe="${FILES}"]`).element).toBe(probe);
        expect(wrapper.find(`[data-view="${MODE_A}"]`).element).toBe(target);
    });

    it("horizontal 容器：收起是 32px 宽竖条，动作折进「更多」，展开按钮回传收起位", async () => {
        const viewSizes = vi.fn();
        const wrapper = mountHost({
            containerId: SHELL_PANEL_CONTAINER.id,
            presentation: ref(modePresentation(false)),
            viewSizes: ref<Record<string, {width?: number; height?: number; collapsed?: boolean}>>({[PANEL_A]: {collapsed: true}}),
            allowViewMove: true,
            moveLabel: "移动到",
            actionsByView: actionsOf(PANEL_A, 3),
            events: {viewSizes},
        });
        await settle();

        const host = wrapper.find(`[data-container-id="${SHELL_PANEL_CONTAINER.id}"]`);
        expect(host.attributes("data-container-orientation")).toBe("horizontal");
        expect(host.attributes("data-container-mode")).toBe("multiple");

        const strip = wrapper.find(`[data-section="${PANEL_A}"]`);
        expect(strip.attributes("data-strip")).toBe("true");
        expect(strip.attributes("data-collapsed")).toBe("true");
        const head = strip.find(".workbench-view-section__head").element;
        expect(head.firstElementChild?.classList.contains("workbench-view-section__toggle")).toBe(true);
        expect(head.lastElementChild?.classList.contains("workbench-view-section__actions")).toBe(true);
        // 竖条里 primary 动作没有独立按钮，全部进「更多」。
        expect(strip.find("[data-title-action=\"refresh\"]").exists()).toBe(false);
        await strip.find("[data-title-action=\"more\"]").trigger("click");
        await settle();
        expect(menuItem("刷新")).toBeTruthy();
        expect(menuItem("移动到")).toBeTruthy();

        // 叶的主轴占位在横向容器里是**宽度**，收起尺寸就是 32px。
        expect(gridOf(wrapper, SHELL_PANEL_CONTAINER.id).layout.sizes[`view:${PANEL_A}`]!.width).toBe(32);
        // 另一个叶照常展开（单个叶收起不改兄弟的状态）。
        expect(wrapper.find(`[data-section="${PANEL_B}"]`).attributes("data-strip")).toBeUndefined();

        await strip.find(`[aria-controls="section-body-${PANEL_A}"]`).trigger("click");
        expect(viewSizes).toHaveBeenCalledWith({
            containerId: SHELL_PANEL_CONTAINER.id,
            sourceLocation: "panel",
            contextKey: "surface-1",
            patches: [{viewId: PANEL_A, collapsed: false}],
        });
    });

    it("horizontal 容器的手势折成 width 补丁（不是 height），并只发一次", async () => {
        const viewSizes = vi.fn();
        const wrapper = mountHost({
            containerId: SHELL_PANEL_CONTAINER.id,
            presentation: ref(modePresentation(false)),
            viewSizes: ref({}),
            events: {viewSizes},
        });
        await settle();

        const renderer = wrapper.findComponent(GridRenderer);
        const layout = gridOf(wrapper, SHELL_PANEL_CONTAINER.id).layout;
        const revision: number = renderer.props("revision") ?? -1;
        const baseline = {
            [`view:${PANEL_A}`]: layout.sizes[`view:${PANEL_A}`]!.width,
            [`view:${PANEL_B}`]: layout.sizes[`view:${PANEL_B}`]!.width,
        };
        const target = {
            [`view:${PANEL_A}`]: baseline[`view:${PANEL_A}`]! + 60,
            [`view:${PANEL_B}`]: baseline[`view:${PANEL_B}`]! - 60,
        };
        const commit: GridGestureCommit = {
            sessionId: "test-width",
            contextKey: "surface-1",
            source: "pointer",
            revision,
            extent: {width: 600, height: 600},
            changes: [{
                branchId: `container:${SHELL_PANEL_CONTAINER.id}`,
                axis: "width",
                baseline,
                extent: {width: 600, height: 600},
                target,
                active: [`view:${PANEL_A}`, `view:${PANEL_B}`],
                compensated: [],
                collapsed: {},
            }],
        };

        expect((renderer.props("onGestureCommit") as (commit: GridGestureCommit) => {ok: boolean})(commit).ok).toBe(true);

        const events = wrapper.findComponent(WorkbenchViewHost).emitted("view-sizes") as unknown as [WorkbenchViewSizesEvent][];
        expect(events).toHaveLength(1);
        const [payload] = events[0]!;
        expect(payload.containerId).toBe(SHELL_PANEL_CONTAINER.id);
        expect(payload.contextKey).toBe("surface-1");
        const wider = payload.patches.find((patch) => patch.viewId === PANEL_A)!;
        const narrower = payload.patches.find((patch) => patch.viewId === PANEL_B)!;
        // 横向容器的意图字段是宽度；高度字段一个都不写（另一轴的意图留在记录里）。
        expect(wider.width).toBeGreaterThan(VIEW_SIZE_BASE_PX);
        expect(narrower.width).toBeLessThan(VIEW_SIZE_BASE_PX);
        expect(wider.height).toBeUndefined();
        expect(narrower.height).toBeUndefined();
    });

    it("菜单失效指纹取 actionsContextKey，会话键只进 view-sizes", async () => {
        const viewSizes = vi.fn();
        const wrapper = mountHost({
            actionsByView: actionsOf(FILES, 7),
            actionsContextKey: "panel-state-9",
            events: {viewSizes},
        });
        await settle();

        const actions = wrapper.findAllComponents(WorkbenchTitleActions);
        expect(actions.length).toBeGreaterThan(0);
        for (const group of actions) {
            expect(group.props("contextKey")).toContain("panel-state-9");
            expect(group.props("contextKey")).not.toContain("surface-1");
        }
        expect(actions[0]!.props("contextKey")).toContain(`${FILES}|7`);

        await wrapper.find(`[data-section="${FILES}"] [aria-controls="section-body-${FILES}"]`).trigger("click");
        // 会话/几何键仍然是 contextKey（补丁随它交给位置会话）。
        expect(viewSizes).toHaveBeenCalledWith(expect.objectContaining({contextKey: "surface-1"}));
    });
});
