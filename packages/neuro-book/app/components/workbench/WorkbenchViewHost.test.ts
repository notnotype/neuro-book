// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import type {WorkbenchContext, WorkbenchCatalog} from "nbook/app/utils/workbench/descriptors";
import {createWorkbenchRegistry} from "nbook/app/utils/workbench/descriptors";
import {SHELL_LEFT_CONTAINER} from "nbook/app/utils/workbench/containers";
import WorkbenchViewHost from "nbook/app/components/workbench/WorkbenchViewHost.vue";

/**
 * 视图宿主的组件边界：渲染的是注册表求值的结果，不是写死的 `v-if`。
 *
 * - 可见视图经 `factoryKey` 解析后渲染（这里用探针组件，产品映射在 `product-catalog.test.ts` 验证）；
 * - 不可见视图不进 DOM，容器内容区退回默认合同（scroll）；
 * - factory 解析失败与注册表失败都显示出来，不静默变空白。
 */

vi.mock("nbook/app/utils/workbench/view-factories", async () => {
    const {defineComponent} = await import("vue");
    const FilesProbe = defineComponent({name: "FilesViewProbe", template: "<p data-probe=\"files\">files-view</p>"});
    const SelectionProbe = defineComponent({name: "SelectionViewProbe", template: "<p data-probe=\"selection\">selection-view</p>"});
    return {
        resolveWorkbenchViewFactory: (factoryKey: string) => {
            if (factoryKey === "nbook.view.files") {
                return {ok: true, value: FilesProbe};
            }
            if (factoryKey === "nbook.view.selection") {
                return {ok: true, value: SelectionProbe};
            }
            return {ok: false, reason: `未登记的内置 factoryKey：${factoryKey}`};
        },
    };
});

const TEST_CATALOG: WorkbenchCatalog = {
    parts: [],
    containers: [SHELL_LEFT_CONTAINER],
    views: [
        {
            id: "nbook.files",
            titleKey: "ide.toolPanel.files",
            icon: "i-lucide-files",
            container: SHELL_LEFT_CONTAINER.id,
            layout: "fill",
            when: {requires: ["project"]},
            requiredAuthority: ["files"],
            order: 10,
            weight: 1,
            canToggleVisibility: false,
            canMoveView: false,
            factoryKey: "nbook.view.files",
            stateScope: "user",
        },
        {
            id: "nbook.selection",
            titleKey: "ide.toolPanel.outline",
            icon: "i-lucide-list-tree",
            container: SHELL_LEFT_CONTAINER.id,
            layout: "scroll",
            when: {requires: ["selection"]},
            order: 20,
            weight: 1,
            canToggleVisibility: false,
            canMoveView: false,
            factoryKey: "nbook.view.selection",
            stateScope: "user",
        },
        {
            id: "nbook.broken",
            titleKey: "ide.toolPanel.outline",
            icon: "i-lucide-unplug",
            container: SHELL_LEFT_CONTAINER.id,
            layout: "scroll",
            when: {requires: ["project"]},
            order: 30,
            weight: 1,
            canToggleVisibility: false,
            canMoveView: false,
            factoryKey: "nbook.view.ghost",
            stateScope: "user",
        },
    ],
};

function registryOf(catalog: WorkbenchCatalog) {
    const created = createWorkbenchRegistry(catalog);
    if (!created.ok) {
        throw new Error(created.reason);
    }
    return created.value;
}

function contextOf(project: boolean, selection = false): WorkbenchContext {
    return {
        project,
        selection,
        "user-assets": false,
        desktop: false,
        authorities: {project, session: false, job: false, files: project},
        projectRoot: project ? "/workspace/demo" : null,
    };
}

const mounted: VueWrapper[] = [];

function mountHost(context: WorkbenchContext, catalog: WorkbenchCatalog = TEST_CATALOG) {
    const wrapper = mount(WorkbenchViewHost, {
        props: {
            container: SHELL_LEFT_CONTAINER,
            containerTitle: "工具",
            context,
            registry: registryOf(catalog),
        },
    });
    mounted.push(wrapper);
    return wrapper;
}

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
        observe() {}
        disconnect() {}
    });
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
        wrapper.unmount();
    }
    vi.unstubAllGlobals();
});

describe("WorkbenchViewHost", () => {
    it("Project 态渲染可见视图，内容区按该视图的 layout 呈现", () => {
        const wrapper = mountHost(contextOf(true));

        expect(wrapper.find("[data-container=\"nbook.tools\"]").exists()).toBe(true);
        expect(wrapper.find("[data-container-layout=\"fill\"]").exists()).toBe(true);
        expect(wrapper.find("[data-view=\"nbook.files\"]").exists()).toBe(true);
        expect(wrapper.find("[data-probe=\"files\"]").text()).toBe("files-view");
        // 不可见视图（selection）与解析失败的视图都不进 DOM。
        expect(wrapper.find("[data-view=\"nbook.selection\"]").exists()).toBe(false);
    });

    it("未打开 Project 时不渲染文件视图，容器说明可见性原因并退回默认合同", () => {
        const wrapper = mountHost(contextOf(false));

        expect(wrapper.find("[data-view=\"nbook.files\"]").exists()).toBe(false);
        expect(wrapper.find("[data-container-layout=\"scroll\"]").exists()).toBe(true);
        expect(wrapper.text()).toContain("需要打开 Project");
    });

    it("factoryKey 解析失败时在容器内显示诊断，不静默空白", () => {
        const wrapper = mountHost(contextOf(true));

        expect(wrapper.text()).toContain("未登记的内置 factoryKey：nbook.view.ghost");
        expect(wrapper.find("[data-view=\"nbook.broken\"]").exists()).toBe(true);
    });

    it("多个可见视图各自渲染", () => {
        const wrapper = mountHost(contextOf(true, true));

        expect(wrapper.find("[data-probe=\"files\"]").exists()).toBe(true);
        expect(wrapper.find("[data-probe=\"selection\"]").exists()).toBe(true);
    });

    it("容器未登记时显示注册表诊断，不静默空白", () => {
        const wrapper = mount(WorkbenchViewHost, {
            props: {
                container: {...SHELL_LEFT_CONTAINER, id: "nbook.ghost"},
                containerTitle: "工具",
                context: contextOf(true),
                registry: registryOf(TEST_CATALOG),
            },
        });
        mounted.push(wrapper);

        expect(wrapper.text()).toContain("容器 id 未登记");
    });
});
