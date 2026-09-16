import {describe, expect, it, vi} from "vitest";
import type {WorkbenchContext} from "nbook/app/utils/workbench/descriptors";
import {
    layoutContractOfViews,
    productWorkbenchRegistry,
    resolveContainerViews,
    SHELL_FILES_VIEW,
} from "nbook/app/utils/workbench/product-catalog";
import {resolveWorkbenchViewFactory} from "nbook/app/utils/workbench/view-factories";
import {SHELL_LEFT_CONTAINER} from "nbook/app/utils/workbench/containers";

/**
 * L1 内置注册路径的声明闭环：产品清单能构造注册表，`files` 视图落在左容器上，
 * 其 `factoryKey` 能在第一方白名单里求值，可见性按上下文求值、内容区合同跟着视图走。
 *
 * 渲染与交互在 `WorkbenchViewHost.test.ts`（组件层），这里只验证声明与求值。
 * 「factoryKey 能求值」这条要读真实的 `view-factories.ts`（也就是真实的视图组件），
 * 所以只把组件链里跑不进 vitest 的产品 store 换成替身（它在模块作用域调用 Nuxt 自动导入的
 * `defineStore`，与本次契约无关）。
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

    it("未登记的内置 factoryKey 求值失败，不静默返回 undefined", () => {
        const resolved = resolveWorkbenchViewFactory("nbook.view.ghost");
        expect(resolved.ok).toBe(false);
        expect(resolved.ok ? "" : resolved.reason).toContain("未登记的内置 factoryKey");
    });
});

describe("resolveContainerViews", () => {
    it("Project 打开时 files 视图可见；未打开时给出可见性原因", () => {
        const registry = productWorkbenchRegistry();
        if (!registry.ok) {
            throw new Error(registry.reason);
        }

        const opened = resolveContainerViews(registry.value, SHELL_LEFT_CONTAINER.id, contextOf());
        expect(opened.views.map((view) => view.id)).toEqual([SHELL_FILES_VIEW.id]);
        expect(opened.hidden).toEqual([]);
        expect(opened.problems).toEqual([]);

        const idle = resolveContainerViews(registry.value, SHELL_LEFT_CONTAINER.id, contextOf({project: false}));
        expect(idle.views).toEqual([]);
        expect(idle.problems).toEqual([]);
        expect(idle.hidden).toEqual([{id: SHELL_FILES_VIEW.id, reasons: ["需要打开 Project"]}]);
    });

    it("未登记的容器 id 求值失败，原因交给调用方显示", () => {
        const registry = productWorkbenchRegistry();
        if (!registry.ok) {
            throw new Error(registry.reason);
        }

        const resolved = resolveContainerViews(registry.value, "nbook.ghost", contextOf());
        expect(resolved.views).toEqual([]);
        expect(resolved.problems.join("")).toContain("容器 id 未登记");
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
