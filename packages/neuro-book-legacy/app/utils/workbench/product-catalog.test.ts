import {describe, expect, it, vi} from "vitest";
import type {WorkbenchCatalog, WorkbenchContext} from "nbook/app/utils/workbench/descriptors";
import {createWorkbenchRegistry} from "nbook/app/utils/workbench/descriptors";
import {
    layoutContractOfViews,
    productWorkbenchRegistry,
    resolveViewPresentation,
    SHELL_FILES_VIEW,
} from "nbook/app/utils/workbench/product-catalog";
import {resolveWorkbenchViewFactory} from "nbook/app/utils/workbench/view-factories";
import {SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER, SHELL_RIGHT_CONTAINER} from "nbook/app/utils/workbench/containers";
import type {ContainerPlacementRecord, WorkbenchViewPlacementRecord} from "nbook/shared/storage/workbench-views";

/**
 * L1 内置注册路径的声明闭环：产品清单能构造注册表，`files` 视图默认落在左容器上、
 * 可以跨容器移动，`factoryKey` 能在第一方白名单里求值；呈现求值把容器落位、视图位置、
 * 可见性与动作可用性一次算成 Part / 容器切片，覆盖被过滤时只影响那一个对象。
 *
 * 渲染与交互在组件层（`WorkbenchViewHost.test.ts` / `WorkbenchViewInstances.test.ts`），
 * 这里只验证声明与求值。「factoryKey 能求值」这条要读真实的 `view-factories.ts`
 * （也就是真实的视图组件），所以只把组件链里跑不进 vitest 的产品 store 换成替身
 * （它在模块作用域调用 Nuxt 自动导入的 `defineStore`，与本次契约无关）。
 */

vi.mock("nbook/app/stores/novel-ide", () => ({useNovelIdeStore: () => ({})}));

function contextOf(overrides: Partial<WorkbenchContext> = {}): WorkbenchContext {
    const project = overrides.project ?? true;
    return {
        project,
        selection: false,
        "user-assets": false,
        desktop: false,
        authorities: {project, session: false, job: false, files: project},
        projectRoot: project ? "/workspace/demo" : null,
        ...overrides,
    };
}

function productPresentation(context: WorkbenchContext = contextOf(), options: Record<string, unknown> = {}) {
    const registry = productWorkbenchRegistry();
    if (!registry.ok) {
        throw new Error(registry.reason);
    }
    return resolveViewPresentation({
        registry: registry.value,
        context,
        ...options,
    });
}

function placementOf(viewId: string, containerId: string, order: number, fingerprint?: {containerId: string; order: number}): WorkbenchViewPlacementRecord {
    const basedOn = fingerprint ?? {containerId: SHELL_LEFT_CONTAINER.id, order: SHELL_FILES_VIEW.order};
    return {
        containerId,
        order,
        defaultContainerId: basedOn.containerId,
        defaultOrder: basedOn.order,
        ...(viewId.length === 0 ? {} : {}),
    };
}

function containerPlacementOf(
    descriptor: {readonly location: string; readonly order: number},
    location: string,
    order: number,
): ContainerPlacementRecord {
    return {location, order, defaultLocation: descriptor.location, defaultOrder: descriptor.order};
}

/** 同一容器里两个可见视图：容器内排序与空态都用它验证。 */
const TWO_VIEW_CATALOG: WorkbenchCatalog = {
    parts: [],
    containers: [SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER, SHELL_RIGHT_CONTAINER],
    views: [
        SHELL_FILES_VIEW,
        {...SHELL_FILES_VIEW, id: "nbook.outline", titleKey: "ide.toolPanel.outline", order: 20},
    ],
};

/**
 * 左容器两个视图 + 面板容器一个视图：跨 Part 的容器落位、resident 与"空容器没有入口"都用它
 * （右容器一直没有成员，正好当空容器的样本）。
 */
const CROSS_PART_CATALOG: WorkbenchCatalog = {
    parts: [],
    containers: [SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER, SHELL_RIGHT_CONTAINER],
    views: [
        SHELL_FILES_VIEW,
        {...SHELL_FILES_VIEW, id: "nbook.outline", titleKey: "ide.toolPanel.outline", order: 20},
        {
            ...SHELL_FILES_VIEW,
            id: "nbook.terminal",
            titleKey: "ide.toolPanel.terminal",
            container: SHELL_PANEL_CONTAINER.id,
            order: 10,
        },
    ],
};

function presentationOfCatalog(catalog: WorkbenchCatalog, options: Record<string, unknown> = {}) {
    const registry = createWorkbenchRegistry(catalog);
    if (!registry.ok) {
        throw new Error(registry.reason);
    }
    return resolveViewPresentation({registry: registry.value, context: contextOf(), ...options});
}

describe("productWorkbenchRegistry", () => {
    it("产品清单合法，且每个登记视图的 factoryKey 都能在白名单里求值", () => {
        const registry = productWorkbenchRegistry();
        expect(registry.ok).toBe(true);
        if (!registry.ok) {
            return;
        }

        expect(registry.value.resolveView(SHELL_FILES_VIEW.id).ok).toBe(true);
        expect(registry.value.viewsOf(SHELL_LEFT_CONTAINER.id).ok).toBe(true);
        for (const view of registry.value.views()) {
            expect(resolveWorkbenchViewFactory(view.factoryKey)).toMatchObject({ok: true});
        }
    });

    it("文件树可以跨容器移动；底部面板是登记过的可移动容器", () => {
        const registry = productWorkbenchRegistry();
        if (!registry.ok) {
            throw new Error(registry.reason);
        }

        const files = registry.value.resolveView(SHELL_FILES_VIEW.id);
        expect(files.ok && files.value.canMoveView).toBe(true);
        expect(registry.value.resolveContainer(SHELL_PANEL_CONTAINER.id)).toEqual({
            ok: true,
            value: SHELL_PANEL_CONTAINER,
        });
        expect(SHELL_PANEL_CONTAINER).toMatchObject({location: "panel", id: "nbook.panel"});
    });

    it("未登记的内置 factoryKey 求值失败，不静默返回 undefined", () => {
        const resolved = resolveWorkbenchViewFactory("nbook.view.ghost");
        expect(resolved.ok).toBe(false);
        expect(resolved.ok ? "" : resolved.reason).toContain("未登记的内置 factoryKey");
    });
});

describe("resolveViewPresentation：容器落位与 Part 切片", () => {
    it("三个 Part 各拿到自己的容器：只有还有成员的容器才有入口，左栏是文件树容器", () => {
        const presentation = productPresentation();
        const left = presentation.part("left");

        expect(left.partId).toBe("left");
        expect(left.problems).toEqual([]);
        expect(left.containers.map((container) => container.containerId)).toEqual([SHELL_LEFT_CONTAINER.id]);
        expect(left.activeContainerId).toBe(SHELL_LEFT_CONTAINER.id);
        // 右栏与面板在产品清单里还没有视图：实际成员数为 0，因此没有入口（该区域是空 Switcher）。
        expect(presentation.part("right").containers).toEqual([]);
        expect(presentation.part("right").activeContainerId).toBeNull();
        expect(presentation.part("panel").containers).toEqual([]);
        // 定义与记录原件都还在：查得到，只是没有入口。
        expect(presentation.container(SHELL_PANEL_CONTAINER.id)?.memberViewIds).toEqual([]);
    });

    it("容器切片带标题、图标、生效落位与两份落点清单", () => {
        const left = productPresentation().part("left").containers[0]!;

        expect(left).toMatchObject({
            containerId: SHELL_LEFT_CONTAINER.id,
            // 标签跟随**第一个可见 View**（Activity Bar / 标签带 / 左栏标题同源），不是 descriptor 的标题。
            title: SHELL_FILES_VIEW.titleKey,
            icon: SHELL_FILES_VIEW.icon,
            location: "sidebar-left",
            partId: "left",
            order: SHELL_LEFT_CONTAINER.order,
            problems: [],
        });
        expect(left.views.map((entry) => entry.view.id)).toEqual([SHELL_FILES_VIEW.id]);
        expect(left.hidden).toEqual([]);
        expect(left.moveTargets.map((target) => target.containerId)).toEqual([
            SHELL_RIGHT_CONTAINER.id,
            SHELL_PANEL_CONTAINER.id,
        ]);
        expect(left.containerMoveTargets.map((target) => target.location)).toEqual(["sidebar-right", "panel"]);
    });

    it("落位覆盖把容器搬到别的 Part：源 Part 不再列出它，目标 Part 按顺序列出", () => {
        const presentation = presentationOfCatalog(CROSS_PART_CATALOG, {
            containerOverrides: {[SHELL_PANEL_CONTAINER.id]: containerPlacementOf(SHELL_PANEL_CONTAINER, "sidebar-left", 5)},
        });

        expect(presentation.part("panel").containers).toEqual([]);
        expect(presentation.part("left").containers.map((container) => container.containerId))
            .toEqual([SHELL_PANEL_CONTAINER.id, SHELL_LEFT_CONTAINER.id]);
    });

    it("容器落位覆盖被过滤（指纹不符 / 不可落位）时回到默认落位，原因进该容器的 problems", () => {
        const stale = presentationOfCatalog(CROSS_PART_CATALOG, {
            containerOverrides: {
                [SHELL_PANEL_CONTAINER.id]: {location: "sidebar-left", order: 5, defaultLocation: "panel", defaultOrder: 99},
            },
        });
        const windowed = presentationOfCatalog(CROSS_PART_CATALOG, {
            containerOverrides: {[SHELL_PANEL_CONTAINER.id]: containerPlacementOf(SHELL_PANEL_CONTAINER, "window", 5)},
        });

        expect(stale.part("panel").containers.map((container) => container.containerId)).toEqual([SHELL_PANEL_CONTAINER.id]);
        expect(stale.part("panel").containers[0]!.problems.join("")).toContain("默认落位已变");
        // 落位不可呈现只过滤这一个覆盖：容器回到默认落位，仍然有入口（它还有成员）。
        expect(windowed.part("panel").containers[0]!.problems.join("")).toContain("不可落位的位置 window");
        expect(windowed.issues.join("")).toContain("不可落位的位置 window");
    });

    it("活动容器：记录的选择生效；无效的选择（未登记 / 不在这个 Part）回落排序第一项且不写回", () => {
        const chosen = productPresentation(contextOf(), {activeContainerByPart: {left: SHELL_LEFT_CONTAINER.id}});
        const invalid = productPresentation(contextOf(), {activeContainerByPart: {left: "nbook.ghost"}});
        const wrongPart = productPresentation(contextOf(), {activeContainerByPart: {left: SHELL_RIGHT_CONTAINER.id}});

        expect(chosen.part("left").activeContainerId).toBe(SHELL_LEFT_CONTAINER.id);
        expect(invalid.part("left").activeContainerId).toBe(SHELL_LEFT_CONTAINER.id);
        expect(wrongPart.part("left").activeContainerId).toBe(SHELL_LEFT_CONTAINER.id);
    });

    it("没有容器的 Part 是空清单与 null 活动容器（不是错误）", () => {
        const registry = createWorkbenchRegistry({...TWO_VIEW_CATALOG, containers: [SHELL_LEFT_CONTAINER, SHELL_RIGHT_CONTAINER]});
        if (!registry.ok) {
            throw new Error(registry.reason);
        }
        const presentation = resolveViewPresentation({registry: registry.value, context: contextOf()});
        const panel = presentation.part("panel");

        expect(panel.containers).toEqual([]);
        expect(panel.activeContainerId).toBeNull();
        expect(panel.problems).toEqual([]);
    });

    it("未登记的 Part 返回带诊断的空切片，不静默空白", () => {
        const part = productPresentation().part("editor" as never);

        expect(part.containers).toEqual([]);
        expect(part.activeContainerId).toBeNull();
        expect(part.problems.join("")).toContain("未登记的工具 Part");
    });

    it("按 id 取容器切片：未登记的容器返回 null，调用方必须显式处理", () => {
        const presentation = productPresentation();

        expect(presentation.container(SHELL_FILES_VIEW.container)?.containerId).toBe(SHELL_LEFT_CONTAINER.id);
        expect(presentation.container("nbook.ghost")).toBeNull();
    });
});

describe("resolveViewPresentation：视图位置与可见性", () => {
    it("Project 打开时文件视图出现在左容器切片里，容器内可见视图带标题", () => {
        const presentation = productPresentation({
            ...contextOf(),
        }, {titleOf: undefined});
        const left = presentation.part("left");

        expect(left.containers[0]!.views.map((entry) => entry.view.id)).toEqual([SHELL_FILES_VIEW.id]);
        expect(left.containers[0]!.views[0]!.title).toBe(SHELL_FILES_VIEW.titleKey);
        expect(presentation.issues).toEqual([]);
    });

    it("未打开 Project 时文件视图不可见：切片里没有可见视图，原因在 hidden 上", () => {
        const presentation = productPresentation(contextOf({project: false}));
        const left = presentation.part("left").containers[0]!;

        expect(left.views).toEqual([]);
        expect(left.hidden).toEqual([
            expect.objectContaining({view: SHELL_FILES_VIEW, visible: false, visibilityReasons: ["需要打开 Project"]}),
        ]);
        // 成员只是不可见不构成空容器：容器照旧在导航里（模板是 empty，快照仍带着它）。
        expect(left.mode).toBe("empty");
        expect(left.memberViewIds).toEqual([SHELL_FILES_VIEW.id]);
        // 面板容器一个成员都没有：它的入口已经移除，查切片仍是空表（底部空态不是错误）。
        expect(presentation.part("panel").containers).toEqual([]);
        expect(presentation.container(SHELL_PANEL_CONTAINER.id)?.problems).toEqual([]);
    });

    it("覆盖把文件视图移到右栏：左容器只剩另一个视图，右栏切片有它，位置问题为空", () => {
        const presentation = presentationOfCatalog(CROSS_PART_CATALOG, {
            overrides: {
                [SHELL_FILES_VIEW.id]: placementOf(SHELL_FILES_VIEW.id, SHELL_RIGHT_CONTAINER.id, 5),
            },
        });

        expect(presentation.part("left").containers[0]!.views.map((entry) => entry.view.id)).toEqual(["nbook.outline"]);
        expect(presentation.part("right").containers[0]!.views.map((entry) => entry.view.id))
            .toEqual([SHELL_FILES_VIEW.id]);
        expect(presentation.issues).toEqual([]);
    });

    it("默认指纹不符：覆盖被过滤、视图回默认容器，原因进该容器的 problems", () => {
        const presentation = presentationOfCatalog(CROSS_PART_CATALOG, {
            overrides: {
                [SHELL_FILES_VIEW.id]: {
                    containerId: SHELL_RIGHT_CONTAINER.id,
                    order: 5,
                    defaultContainerId: SHELL_LEFT_CONTAINER.id,
                    defaultOrder: 999,
                },
            },
        });
        const left = presentation.part("left").containers[0]!;

        // 覆盖被过滤:右栏里没有它，而那个容器也没有别的成员，因此没有入口。
        expect(presentation.part("right").containers).toEqual([]);
        expect(presentation.container(SHELL_RIGHT_CONTAINER.id)?.views).toEqual([]);
        expect(left.views.map((entry) => entry.view.id)).toEqual([SHELL_FILES_VIEW.id, "nbook.outline"]);
        expect(left.problems.join("")).toContain("默认位置已变");
        expect(presentation.issues.join("")).toContain("默认位置已变");
    });

    it("记录里的未登记视图只进 issues，已登记视图的呈现不受影响", () => {
        const presentation = productPresentation(contextOf(), {
            overrides: {[`nbook.ghost`]: placementOf("nbook.ghost", SHELL_PANEL_CONTAINER.id, 1)},
        });

        expect(presentation.part("left").containers[0]!.views.map((entry) => entry.view.id))
            .toEqual([SHELL_FILES_VIEW.id]);
        expect(presentation.issues.join("")).toContain("未登记视图 nbook.ghost");
    });

    it("容器内多个视图按 (order, id) 排好，落点标题按 titleOf 解析", () => {
        const presentation = presentationOfCatalog(CROSS_PART_CATALOG, {
            titleOf: (descriptor: {readonly titleKey: string}) => `t:${descriptor.titleKey}`,
            containerOverrides: {[SHELL_RIGHT_CONTAINER.id]: containerPlacementOf(SHELL_RIGHT_CONTAINER, "sidebar-left", 20)},
        });
        const left = presentation.part("left");

        // 右栏那个容器一个成员都没有：它落在左栏也不进导航（没有可选的入口）。
        expect(left.containers.map((container) => container.containerId)).toEqual([SHELL_LEFT_CONTAINER.id]);
        expect(left.containers[0]!.views.map((entry) => entry.view.id))
            .toEqual([SHELL_FILES_VIEW.id, "nbook.outline"]);
        expect(left.containers[0]!.views[0]!.title).toBe(`t:${SHELL_FILES_VIEW.titleKey}`);
        expect(left.containers[0]!.moveTargets.map((target) => target.title))
            .toEqual([`t:${SHELL_RIGHT_CONTAINER.titleKey}`, `t:${SHELL_PANEL_CONTAINER.titleKey}`]);
    });

    it("Part 标题解析可注入：容器落点标题不发明 i18n key", () => {
        const presentation = productPresentation(contextOf(), {
            partTitleOf: (partId: string) => `p:${partId}`,
        });
        const left = presentation.part("left").containers[0]!;

        expect(left.containerMoveTargets.map((target) => target.title)).toEqual(["p:right", "p:panel"]);
    });

    it("动作可用性跟 authority 走：不可用时视图仍可见，原因挂在条目上", () => {
        const presentation = productPresentation(contextOf({authorities: {project: true, session: false, job: false, files: false}}));
        const entry = presentation.part("left").containers[0]!.views[0]!;

        expect(entry.visible).toBe(true);
        expect(entry.actionable).toBe(false);
        expect(entry.authorityReasons).toEqual(["需要工作区文件 authority"]);
    });
});

describe("layoutContractOfViews", () => {
    it("内容区合同取第一个可见视图：files 是 fill（视图自占满、自管滚动）", () => {
        expect(layoutContractOfViews([SHELL_FILES_VIEW])).toEqual({
            mode: "fill",
            shellPadsContent: false,
            shellOwnsScroll: false,
        });
    });

    it("没有可见视图时退回默认合同（外壳给留白、拥有滚动）", () => {
        expect(layoutContractOfViews([]).mode).toBe("scroll");
    });
});

describe("resolveViewPresentation：容器模式、方向与成员快照", () => {
    function twoViewPresentation(options: Record<string, unknown> = {}) {
        const registry = createWorkbenchRegistry(TWO_VIEW_CATALOG);
        if (!registry.ok) {
            throw new Error(registry.reason);
        }
        return resolveViewPresentation({registry: registry.value, context: contextOf(), ...options});
    }

    it("Part 决定容器内部方向：左右栏上下排、底部面板左右排", () => {
        const presentation = presentationOfCatalog(CROSS_PART_CATALOG);

        expect(presentation.part("left").containers[0]!.orientation).toBe("vertical");
        expect(presentation.part("panel").containers[0]!.orientation).toBe("horizontal");
        // 右栏那个容器没有成员：没有入口，也就没有方向可呈现。
        expect(presentation.part("right").containers).toEqual([]);
    });

    it("可见成员数决定模板：1 个是 single 并给出上提目标，2 个是 multiple 且不上提", () => {
        const single = productPresentation().part("left").containers[0]!;
        expect(single.mode).toBe("single");
        expect(single.singleViewId).toBe(SHELL_FILES_VIEW.id);

        const multiple = twoViewPresentation().part("left").containers[0]!;
        expect(multiple.views.map((entry) => entry.view.id)).toEqual([SHELL_FILES_VIEW.id, "nbook.outline"]);
        expect(multiple.mode).toBe("multiple");
        expect(multiple.singleViewId).toBeNull();
    });

    it("没有可见成员是 empty：模板按可见数，成员快照仍保留隐藏成员与顺序", () => {
        const empty = productPresentation(contextOf({project: false})).part("left").containers[0]!;
        expect(empty.views).toEqual([]);
        expect(empty.mode).toBe("empty");
        expect(empty.singleViewId).toBeNull();
        expect(empty.memberViewIds).toEqual([SHELL_FILES_VIEW.id]);
        // 没有可见成员时才回落到 descriptor 自己的标题/图标。
        expect({title: empty.title, icon: empty.icon}).toEqual({title: SHELL_LEFT_CONTAINER.titleKey, icon: SHELL_LEFT_CONTAINER.icon});

        // 模板只数可见成员，快照是全部已登记生效成员：隐藏不该从拖动源里消失。
        const hiddenPair = twoViewPresentation({context: contextOf({project: false})}).part("left").containers[0]!;
        expect(hiddenPair.mode).toBe("empty");
        expect(hiddenPair.memberViewIds).toEqual([SHELL_FILES_VIEW.id, "nbook.outline"]);
    });

    it("residentContainers 只列**还有成员**的可落位容器：落位换了也照旧泊车，空容器不在这里", () => {
        const presentation = presentationOfCatalog(CROSS_PART_CATALOG, {
            containerOverrides: {[SHELL_PANEL_CONTAINER.id]: containerPlacementOf(SHELL_PANEL_CONTAINER, "sidebar-left", 5)},
        });

        expect(presentation.part("panel").containers).toEqual([]);
        expect([...presentation.residentContainers].map((slice) => slice.containerId).sort()).toEqual([
            SHELL_LEFT_CONTAINER.id,
            SHELL_PANEL_CONTAINER.id,
        ].sort());
        // 空容器（右栏）的定义还在：查得到切片，只是没有实例要泊车。
        expect(presentation.container(SHELL_RIGHT_CONTAINER.id)?.memberViewIds).toEqual([]);
    });

    it("切片如实带出容器可移动性：未声明即可移动，声明 false 就不能当重排锚点", () => {
        expect(productPresentation().part("left").containers[0]!.canMoveContainer).toBe(true);

        const locked = createWorkbenchRegistry({
            ...CROSS_PART_CATALOG,
            containers: [SHELL_LEFT_CONTAINER, {...SHELL_PANEL_CONTAINER, canMoveContainer: false}],
        });
        if (!locked.ok) {
            throw new Error(locked.reason);
        }
        const presentation = resolveViewPresentation({registry: locked.value, context: contextOf()});

        expect(presentation.part("panel").containers[0]!.canMoveContainer).toBe(false);
        // 不可移动不改变它能接收 View：落点清单照旧。
        expect(presentation.part("left").containers[0]!.moveTargets.map((target) => target.containerId)).toContain(SHELL_PANEL_CONTAINER.id);
    });

    it("被抑制的源容器不进导航、落点与 resident：它的成员已经一个不剩", () => {
        // 两个成员都并进 Panel，左容器被标记抑制：呈现求值必须和写者同一口径。
        const presentation = twoViewPresentation({
            overrides: {
                [SHELL_FILES_VIEW.id]: placementOf(SHELL_FILES_VIEW.id, SHELL_PANEL_CONTAINER.id, 11),
                "nbook.outline": placementOf("nbook.outline", SHELL_PANEL_CONTAINER.id, 12, {
                    containerId: SHELL_LEFT_CONTAINER.id,
                    order: 20,
                }),
            },
            suppressedContainers: {[SHELL_LEFT_CONTAINER.id]: true},
        });

        expect(presentation.part("left")).toEqual({partId: "left", containers: [], activeContainerId: null, problems: []});
        expect(presentation.container(SHELL_LEFT_CONTAINER.id)).toBeNull();
        // 落点清单与写者同口径：并入后不能再把 View 拖回一个不呈现的容器。
        expect(presentation.part("panel").containers[0]!.moveTargets.map((target) => target.containerId))
            .toEqual([SHELL_RIGHT_CONTAINER.id]);

        // 它一个成员都不剩：没有导航入口，也没有实例要泊车（定义与记录原件都还在）。
        expect(presentation.residentContainers.some((slice) => slice.containerId === SHELL_LEFT_CONTAINER.id)).toBe(false);
    });
});

describe("resolveViewPresentation：自建容器、空容器与尺寸意图", () => {
    const CUSTOM = "nbook.custom.1";

    /** 把 `files` 搬进一个自建容器：整条记录与呈现都用同一份事实（与写者的合成同构）。 */
    const intoCustomContainer = (options: Record<string, unknown> = {}) => presentationOfCatalog(CROSS_PART_CATALOG, {
        customContainers: {[CUSTOM]: {originViewId: SHELL_FILES_VIEW.id, location: "sidebar-left", order: 5}},
        overrides: {[SHELL_FILES_VIEW.id]: placementOf(SHELL_FILES_VIEW.id, CUSTOM, 10)},
        ...options,
    });

    it("自建容器进导航与 resident：标题/图标跟随可见成员，可移动、方向按落位", () => {
        const presentation = intoCustomContainer();
        const left = presentation.part("left");

        expect(left.containers.map((container) => container.containerId)).toEqual([CUSTOM, SHELL_LEFT_CONTAINER.id]);
        expect(left.activeContainerId).toBe(CUSTOM);
        const custom = left.containers[0]!;
        expect(custom).toMatchObject({
            containerId: CUSTOM,
            title: SHELL_FILES_VIEW.titleKey,
            icon: SHELL_FILES_VIEW.icon,
            location: "sidebar-left",
            partId: "left",
            order: 5,
            canMoveContainer: true,
            orientation: "vertical",
            mode: "single",
            singleViewId: SHELL_FILES_VIEW.id,
        });
        // 自建容器也进 resident（它还有成员），落点清单里也是可投递的容器。
        expect(presentation.residentContainers.some((slice) => slice.containerId === CUSTOM)).toBe(true);
        expect(left.containers[1]!.moveTargets.map((target) => target.containerId)).toContain(CUSTOM);
        expect(left.containers[1]!.moveTargets.find((target) => target.containerId === CUSTOM)?.title)
            .toBe(SHELL_FILES_VIEW.titleKey);
    });

    it("自建容器没有可见成员时，标题/图标按创建它的那个 View 回落", () => {
        const presentation = presentationOfCatalog(CROSS_PART_CATALOG, {
            customContainers: {[CUSTOM]: {originViewId: "nbook.outline", location: "sidebar-left", order: 5}},
            // 默认指纹是 outline 自己的 descriptor 落位（左容器 #20），不然这条覆盖会被过滤。
            overrides: {["nbook.outline"]: placementOf("nbook.outline", CUSTOM, 10, {containerId: SHELL_LEFT_CONTAINER.id, order: 20})},
            context: contextOf({project: false}),
        });
        const custom = presentation.part("left").containers[0]!;

        expect(custom.containerId).toBe(CUSTOM);
        expect(custom.mode).toBe("empty");
        expect(custom.memberViewIds).toEqual(["nbook.outline"]);
        // 隐藏（或暂不可见）成员仍是成员：容器照旧有入口，回落标题取 origin View。
        expect({title: custom.title, icon: custom.icon}).toEqual({
            title: "ide.toolPanel.outline",
            icon: SHELL_FILES_VIEW.icon,
        });
    });

    it("自建容器的落位不可呈现（预留的 window）：只登记事实，既不进导航也不进 resident", () => {
        const presentation = presentationOfCatalog(CROSS_PART_CATALOG, {
            customContainers: {[CUSTOM]: {originViewId: SHELL_FILES_VIEW.id, location: "window", order: 5}},
            overrides: {[SHELL_FILES_VIEW.id]: placementOf(SHELL_FILES_VIEW.id, CUSTOM, 10)},
        });

        // 覆盖指向不可落位的容器：整条按默认回落（与静态容器的口径一致）。
        expect(presentation.part("left").containers.map((container) => container.containerId)).toEqual([SHELL_LEFT_CONTAINER.id]);
        expect(presentation.container(CUSTOM)).toBeNull();
        expect(presentation.issues.join("")).toContain("不可落位的容器");
    });

    it("容器里的视图全被搬走（实际成员归零）：入口与 resident 一起消失，成员回来时自动出现", () => {
        const emptied = presentationOfCatalog(CROSS_PART_CATALOG, {
            customContainers: {[CUSTOM]: {originViewId: SHELL_FILES_VIEW.id, location: "sidebar-left", order: 5}},
            overrides: {[SHELL_FILES_VIEW.id]: placementOf(SHELL_FILES_VIEW.id, SHELL_PANEL_CONTAINER.id, 40)},
        });

        // 自建容器一个成员都没有：不进导航、不进 resident；静态的右容器同样如此。
        expect(emptied.part("left").containers.map((container) => container.containerId)).toEqual([SHELL_LEFT_CONTAINER.id]);
        expect(emptied.part("right").containers).toEqual([]);
        expect(emptied.container(CUSTOM)?.memberViewIds).toEqual([]);
        expect(emptied.residentContainers.some((slice) => slice.containerId === CUSTOM)).toBe(false);
        // 选择指向空容器时按排序第一项回落，记录原件不动。
        expect(emptied.part("left").activeContainerId).toBe(SHELL_LEFT_CONTAINER.id);
    });

    it("sizeIntents 给可见成员的当前轴展开意图：记录里有就用它，缺省 240 * weight，隐藏成员不在里面", () => {
        const presentation = presentationOfCatalog(CROSS_PART_CATALOG, {
            viewSizes: {[SHELL_FILES_VIEW.id]: {height: 320}},
        });
        const left = presentation.part("left").containers[0]!;
        const panel = presentation.part("panel").containers[0]!;

        // 左栏是上下排（height）：文件树用记录里的 320，另一个没有意图 → 240 * weight(1)。
        expect(left.sizeIntents).toEqual({[SHELL_FILES_VIEW.id]: 320, "nbook.outline": 240});
        // 面板是左右排（width）：记录里的 height 意图不参与，按缺省给 width。
        expect(panel.sizeIntents).toEqual({["nbook.terminal"]: 240});
        // 成员只是不可见（这两个视图都要求 Project）时没有当前几何，也就不在表里。
        const hidden = presentationOfCatalog(CROSS_PART_CATALOG, {
            context: contextOf({project: false}),
            viewSizes: {[SHELL_FILES_VIEW.id]: {height: 320}},
        }).part("left").containers[0]!;
        expect(hidden.views).toEqual([]);
        expect(hidden.memberViewIds).toEqual([SHELL_FILES_VIEW.id, "nbook.outline"]);
        expect(hidden.sizeIntents).toEqual({});
    });
});
