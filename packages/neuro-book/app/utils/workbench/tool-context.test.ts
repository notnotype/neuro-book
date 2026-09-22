import {describe, expect, it} from "vitest";
import type {WorkbenchContext} from "nbook/app/utils/workbench/descriptors";
import {createWorkbenchRegistry} from "nbook/app/utils/workbench/descriptors";
import {
    productWorkbenchRegistry,
    resolveViewPresentation,
    SHELL_FILES_VIEW,
} from "nbook/app/utils/workbench/product-catalog";
import {
    SHELL_LEFT_CONTAINER,
    SHELL_PANEL_CONTAINER,
    SHELL_RIGHT_CONTAINER,
} from "nbook/app/utils/workbench/containers";
import {
    clientPanelOfToolView,
    clientToolPanels,
    clientToolViewIdOf,
    resolveActiveToolView,
    resolveClientActivePanel,
    sameToolFocus,
} from "nbook/app/utils/workbench/tool-context";
import type {ContainerPlacementRecord} from "nbook/shared/storage/workbench-views";

/**
 * 工具焦点 → Agent 客户端上下文的唯一映射，以及"什么才算真实可见的工具"。
 *
 * 这里只跑纯函数：注册表是产品的真实清单，真实可见性由 `resolveViewPresentation` 求值后传进来，
 * 页面侧的发布/清空（store 写回）在 `index.vue`，不在这里重复。
 */

/** 左栏里再加一个容器：用来验证"View 在，但它的容器不是活动容器"时不算焦点。 */
const SECOND_LEFT_CONTAINER = {...SHELL_LEFT_CONTAINER, id: "nbook.tools.secondary", order: 40};

function contextOf(overrides: Partial<WorkbenchContext> = {}): WorkbenchContext {
    const project = overrides.project ?? true;
    return {
        project,
        selection: false,
        "user-assets": false,
        desktop: true,
        authorities: {project, session: false, job: false, files: project},
        projectRoot: project ? "/workspace/demo" : null,
        ...overrides,
    };
}

function presentationOf(options: {
    readonly context?: WorkbenchContext;
    readonly secondLeftContainer?: boolean;
    readonly containerOverrides?: Readonly<Record<string, ContainerPlacementRecord>>;
    readonly activeContainerByPart?: Readonly<Record<string, string>>;
} = {}) {
    const catalog = {
        parts: [],
        containers: [
            SHELL_LEFT_CONTAINER,
            SHELL_RIGHT_CONTAINER,
            SHELL_PANEL_CONTAINER,
            ...(options.secondLeftContainer === true ? [SECOND_LEFT_CONTAINER] : []),
        ],
        views: [
            SHELL_FILES_VIEW,
            ...(options.secondLeftContainer === true
                ? [{...SHELL_FILES_VIEW, id: "lab.secondary-tool", container: SECOND_LEFT_CONTAINER.id}]
                : []),
        ],
    };
    const registry = createWorkbenchRegistry(catalog);
    if (!registry.ok) {
        throw new Error(registry.reason);
    }
    return resolveViewPresentation({
        registry: registry.value,
        context: options.context ?? contextOf(),
        ...(options.containerOverrides === undefined ? {} : {containerOverrides: options.containerOverrides}),
        ...(options.activeContainerByPart === undefined ? {} : {activeContainerByPart: options.activeContainerByPart}),
    });
}

describe("客户端工具映射", () => {
    it("只认登记表里的 View：nbook.files 映射成 files，未接入的 View 是 null", () => {
        expect(resolveClientActivePanel({partId: "left", viewId: SHELL_FILES_VIEW.id})).toBe("files");
        expect(resolveClientActivePanel({partId: "panel", viewId: SHELL_FILES_VIEW.id})).toBe("files");

        // 旧页签词表里的名字没有对应 View：不靠静态表谎报它们可用。
        expect(resolveClientActivePanel({partId: "left", viewId: "nbook.characters"})).toBeNull();
        expect(resolveClientActivePanel({partId: "left", viewId: "nbook.plot"})).toBeNull();
        expect(resolveClientActivePanel(null)).toBeNull();
    });

    it("能力口径与反查同源：可揭示的页签来自登记表，没有接入的页签反查为 null", () => {
        expect(clientToolPanels()).toEqual(["files"]);
        expect(clientToolViewIdOf("files")).toBe(SHELL_FILES_VIEW.id);
        expect(clientToolViewIdOf("characters")).toBeNull();
        expect(clientToolViewIdOf("plot")).toBeNull();
        expect(clientPanelOfToolView(SHELL_FILES_VIEW.id)).toBe("files");
        expect(clientPanelOfToolView("nbook.plot")).toBeNull();
    });

    it("焦点相等按 Part + View 比较，null 只等于 null", () => {
        expect(sameToolFocus({partId: "left", viewId: "nbook.files"}, {partId: "left", viewId: "nbook.files"})).toBe(true);
        expect(sameToolFocus({partId: "left", viewId: "nbook.files"}, {partId: "panel", viewId: "nbook.files"})).toBe(false);
        expect(sameToolFocus(null, null)).toBe(true);
        expect(sameToolFocus({partId: "left", viewId: "nbook.files"}, null)).toBe(false);
    });
});

describe("真实可见的工具焦点", () => {
    it("Project 打开时是左栏活动容器里的文件工具；不看它落在哪个 Part", () => {
        expect(resolveActiveToolView({presentation: presentationOf()})).toEqual({partId: "left", viewId: SHELL_FILES_VIEW.id});

        const moved = presentationOf({
            containerOverrides: {
                [SHELL_LEFT_CONTAINER.id]: {
                    // 搬进底部面板时排在面板容器前面：它就成了这个 Part 的活动容器。
                    location: "panel",
                    order: SHELL_PANEL_CONTAINER.order - 10,
                    defaultLocation: SHELL_LEFT_CONTAINER.location,
                    defaultOrder: SHELL_LEFT_CONTAINER.order,
                },
            },
        });
        expect(resolveActiveToolView({presentation: moved})).toEqual({partId: "panel", viewId: SHELL_FILES_VIEW.id});
    });

    it("View 被 when 藏起来（没有 Project）时没有焦点，不拿旧页签凑一个", () => {
        const presentation = presentationOf({context: contextOf({project: false})});
        expect(presentation.entries.every((entry) => !entry.visible)).toBe(true);
        expect(resolveActiveToolView({presentation})).toBeNull();
    });

    it("View 的容器不是该 Part 的活动容器时不算可见：屏幕上显示的是另一个容器", () => {
        const presentation = presentationOf({
            secondLeftContainer: true,
            activeContainerByPart: {left: SECOND_LEFT_CONTAINER.id},
        });
        expect(presentation.part("left").activeContainerId).toBe(SECOND_LEFT_CONTAINER.id);
        expect(presentation.container(SHELL_LEFT_CONTAINER.id)?.views).toHaveLength(1);
        expect(resolveActiveToolView({presentation})).toBeNull();
    });

    it("Part 内容不在屏幕上（书架遮罩 / 显式隐藏 / 拖收起）时不算可见", () => {
        const presentation = presentationOf();
        expect(resolveActiveToolView({presentation, unavailableParts: ["left"]})).toBeNull();
        expect(resolveActiveToolView({presentation, unavailableParts: ["right", "panel"]})).toEqual({partId: "left", viewId: SHELL_FILES_VIEW.id});
    });

    it("呈现不可用时没有焦点", () => {
        const registry = productWorkbenchRegistry();
        expect(registry.ok).toBe(true);
        expect(resolveActiveToolView({presentation: null})).toBeNull();
    });
});
