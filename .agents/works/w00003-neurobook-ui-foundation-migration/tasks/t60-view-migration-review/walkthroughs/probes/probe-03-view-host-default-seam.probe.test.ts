// @vitest-environment jsdom
/**
 * 探针 03 —— 试图证伪的声明（t57 自述 + `WorkbenchViewHost.md`）：
 *
 *   「两处注入是测试缝隙，**产品页面两个都不传**，因此缺省路径与注入前行为一致」。
 *
 * 关键点是**缺省路径本身没有任何测试覆盖**：`WorkbenchViewHost.test.ts` 用
 * `vi.mock("nbook/app/utils/workbench/view-factories")` 把整个解析器换掉，并且每个用例都传
 * `registry`；`product-catalog.test.ts` 只在模块层验证注册表与白名单，不挂宿主。
 * 这里只替换**叶组件**（`WorkspaceFilePanel.vue`，它是产品 store 的宿主，跑不进 vitest），
 * 两个注入缝隙一个都不传，看缺省路径是否真的走「产品注册表 + 产品白名单」。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import type {WorkbenchCatalog, WorkbenchContext} from "nbook/app/utils/workbench/descriptors";
import {createWorkbenchRegistry} from "nbook/app/utils/workbench/descriptors";
import {SHELL_LEFT_CONTAINER} from "nbook/app/utils/workbench/containers";
import WorkbenchViewHost from "nbook/app/components/workbench/WorkbenchViewHost.vue";

/** 只换叶组件：它 import 的是产品 store（模块作用域里的 Nuxt 自动导入），与宿主契约无关。 */
vi.mock("nbook/app/components/novel-ide/workspace/WorkspaceFilePanel.vue", async () => {
    const {defineComponent} = await import("vue");
    return {
        default: defineComponent({
            name: "WorkspaceFilePanelProbe",
            template: "<p data-probe=\"files-leaf\">files-leaf</p>",
        }),
    };
});

function contextOf(project: boolean): WorkbenchContext {
    return {
        project,
        selection: false,
        "user-assets": false,
        desktop: false,
        authorities: {project, session: false, job: false, files: project},
        projectRoot: project ? "/workspace/demo" : null,
    };
}

const GHOST_CATALOG: WorkbenchCatalog = {
    parts: [],
    containers: [SHELL_LEFT_CONTAINER],
    views: [{
        id: "nbook.ghost",
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
        factoryKey: "nbook.view.ghost",
        stateScope: "user",
    }],
};

const mounted: VueWrapper[] = [];

function mountHost(props: Record<string, unknown>): VueWrapper {
    const wrapper = mount(WorkbenchViewHost, {
        props: {container: SHELL_LEFT_CONTAINER, containerTitle: "工具", ...props},
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

describe("探针 03：缺省注入路径（产品注册表 + 产品白名单）", () => {
    it("两个缝隙都不传：产品注册表把 nbook.files 解析到产品白名单里的组件", () => {
        const wrapper = mountHost({context: contextOf(true)});

        // eslint-disable-next-line no-console
        console.log("[probe-03/default] 视图容器 =", wrapper.find("[data-view=\"nbook.files\"]").exists(),
            "| 叶渲染 =", wrapper.find("[data-probe=\"files-leaf\"]").exists(),
            "| 文本 =", JSON.stringify(wrapper.text().trim()));

        expect(wrapper.find("[data-view=\"nbook.files\"]").exists()).toBe(true);
        expect(wrapper.find("[data-probe=\"files-leaf\"]").exists()).toBe(true);
        expect(wrapper.find("[data-container-layout=\"fill\"]").exists()).toBe(true);
    });

    it("两个缝隙都不传：未打开 Project 时不可见，并给出 when 的原因", () => {
        const wrapper = mountHost({context: contextOf(false)});

        expect(wrapper.find("[data-view=\"nbook.files\"]").exists()).toBe(false);
        expect(wrapper.text()).toContain("需要打开 Project");
        expect(wrapper.find("[data-container-layout=\"scroll\"]").exists()).toBe(true);
    });

    it("只传 registry、不传 resolver：未知 factoryKey 走产品白名单的失败原因（可见）", () => {
        const registry = createWorkbenchRegistry(GHOST_CATALOG);
        expect(registry.ok).toBe(true);
        const wrapper = mountHost({
            context: contextOf(true),
            registry: registry.ok ? registry.value : null,
        });

        // eslint-disable-next-line no-console
        console.log("[probe-03/ghost] 文本 =", JSON.stringify(wrapper.text().trim()));

        expect(wrapper.find("[data-view=\"nbook.ghost\"]").exists()).toBe(true);
        expect(wrapper.text()).toContain("未登记的内置 factoryKey：nbook.view.ghost");
    });

    it("传了 resolver：注入者胜出（缝隙确实生效，不是被产品白名单抢先）", () => {
        const registry = createWorkbenchRegistry(GHOST_CATALOG);
        expect(registry.ok).toBe(true);
        const wrapper = mountHost({
            context: contextOf(true),
            registry: registry.ok ? registry.value : null,
            viewFactoryResolver: (factoryKey: string) => ({ok: true, value: {template: `<p data-injected="${factoryKey}">injected</p>`}}),
        });

        expect(wrapper.find("[data-injected=\"nbook.view.ghost\"]").exists()).toBe(true);
        expect(wrapper.text()).not.toContain("未登记的内置 factoryKey");
    });

    it("两个缝隙都不传 + 容器未登记：产品注册表的诊断可见", () => {
        const wrapper = mountHost({container: {...SHELL_LEFT_CONTAINER, id: "nbook.nowhere"}, context: contextOf(true)});

        expect(wrapper.text()).toContain("容器 id 未登记");
    });
});

/**
 * 追加用例（Q8）：`WorkbenchViewHost.md:14` 声明「宿主负责把这三类**都画出来**，不吞任何一类」。
 * 实现里 `hidden` 只进空态文案，且空态仅在「没有可见视图且没有 problems」时渲染。
 */
const MIXED_CATALOG: WorkbenchCatalog = {
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
            requiredAuthority: [],
            order: 20,
            weight: 1,
            canToggleVisibility: false,
            canMoveView: false,
            factoryKey: "nbook.view.files",
            stateScope: "user",
        },
    ],
};

describe("探针 03：文档声明「三类都画出来」的边界", () => {
    it("有可见视图时，不可见视图的 when 原因不进 DOM（只有空态才画 hidden）", () => {
        const registry = createWorkbenchRegistry(MIXED_CATALOG);
        expect(registry.ok).toBe(true);
        const wrapper = mountHost({
            context: contextOf(true),
            registry: registry.ok ? registry.value : null,
        });

        const text = wrapper.text();
        // eslint-disable-next-line no-console
        console.log("[probe-03/hidden] 文本 =", JSON.stringify(text.trim()),
            "| 含隐藏原因 =", text.includes("需要先选中一个条目"));

        expect(wrapper.find("[data-probe=\"files-leaf\"]").exists()).toBe(true);
        expect(text.includes("需要先选中一个条目")).toBe(false);
    });
});
