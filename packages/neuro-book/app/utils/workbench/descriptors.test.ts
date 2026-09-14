import {describe, expect, it} from "vitest";
import {
    createWorkbenchRegistry,
    evaluateAuthorities,
    evaluateWhen,
    resolveLocationPart,
    resolveViewLayout,
    resolveViewStateLayer,
    type DescriptorResult,
    type ViewDescriptor,
    type ViewWhen,
    type WorkbenchCatalog,
    type WorkbenchContext,
} from "nbook/app/utils/workbench/descriptors";

const context: WorkbenchContext = {
    project: true,
    selection: false,
    "user-assets": false,
    desktop: true,
    authorities: {project: true, session: false, job: false, files: true},
    projectRoot: "/workspace/novel",
    sessionId: null,
};

function view(overrides: Partial<ViewDescriptor> & {id: string}): ViewDescriptor {
    return {
        titleKey: `workbench.view.${overrides.id}`,
        icon: "i-lucide-file-text",
        container: "nbook.explorer",
        layout: "scroll",
        order: 10,
        canToggleVisibility: true,
        canMoveView: true,
        factoryKey: `nbook.view.${overrides.id}`,
        stateScope: "user",
        ...overrides,
    };
}

function valueOf<T>(result: DescriptorResult<T>): T {
    if (!result.ok) {
        throw new Error(result.reason);
    }
    return result.value;
}

function registryOf(catalog: WorkbenchCatalog) {
    return valueOf(createWorkbenchRegistry(catalog));
}

const catalog: WorkbenchCatalog = {
    parts: [
        {id: "activity", titleKey: "workbench.part.activity", canToggleVisibility: false},
        {id: "titlebar", titleKey: "workbench.part.titlebar", canToggleVisibility: false, when: {requires: ["desktop"]}},
    ],
    containers: [
        {id: "nbook.explorer", titleKey: "workbench.container.explorer", icon: "i-lucide-files", location: "sidebar-left", order: 10},
        {id: "nbook.inspector", titleKey: "workbench.container.inspector", icon: "i-lucide-panel-right", location: "sidebar-right", order: 20},
    ],
    views: [
        view({id: "nbook.files", order: 20}),
        view({id: "nbook.outline", order: 10}),
        view({id: "nbook.search", order: 10}),
        view({id: "nbook.characters", order: 10, layout: "fill", container: "nbook.inspector", when: {requires: ["project", "selection"]}, requiredAuthority: ["files"]}),
    ],
};

describe("createWorkbenchRegistry", () => {
    it("合法声明可用：按 id 求值，容器内按 order 升序、同值按 id 稳定排序", () => {
        const registry = registryOf(catalog);

        expect(valueOf(registry.resolveView("nbook.files")).container).toBe("nbook.explorer");
        expect(valueOf(registry.resolveContainer("nbook.inspector")).location).toBe("sidebar-right");
        expect(valueOf(registry.resolvePart("titlebar")).when).toEqual({requires: ["desktop"]});
        expect(valueOf(registry.viewsOf("nbook.explorer")).map((item) => item.id)).toEqual(["nbook.outline", "nbook.search", "nbook.files"]);
    });

    it("未登记 id 的求值返回失败，不返回 undefined", () => {
        const registry = registryOf(catalog);

        expect(registry.resolveView("nbook.ghost")).toEqual({ok: false, reason: "视图 id 未登记：nbook.ghost"});
        expect(registry.resolveContainer("nbook.ghost")).toEqual({ok: false, reason: "容器 id 未登记：nbook.ghost"});
        expect(registry.resolvePart("statusbar")).toEqual({ok: false, reason: "Part id 未登记：statusbar"});
        expect(registry.viewsOf("nbook.ghost")).toEqual({ok: false, reason: "容器 id 未登记：nbook.ghost"});
    });

    it("未登记取值与悬空引用让校验失败，且一次性给全所有问题", () => {
        const broken = {
            parts: [{id: "statusbar", titleKey: "workbench.part.statusbar", canToggleVisibility: false}],
            containers: [
                {id: "nbook.explorer", titleKey: "workbench.container.explorer", icon: "i-lucide-files", location: "sidebar-left", order: 10},
                {id: "nbook.panel", titleKey: "workbench.container.panel", icon: "i-lucide-alert-triangle", location: "sidebar-top", order: 20},
            ],
            views: [
                {id: "nbook.ghost", container: "nbook.missing"},
                {id: "nbook.fixed", container: "nbook.explorer", layout: "fixed"},
                {id: "nbook.device", container: "nbook.explorer", stateScope: "device"},
                {id: "nbook.offline", container: "nbook.explorer", when: {requires: ["offline"]}},
                {id: "nbook.billing", container: "nbook.explorer", requiredAuthority: ["billing"]},
                {id: "NBook.Files", container: "nbook.explorer"},
                {id: "nbook.files", container: "nbook.explorer"},
                {id: "nbook.files", container: "nbook.explorer"},
            ],
        } as unknown as WorkbenchCatalog;

        const result = createWorkbenchRegistry(broken);

        expect(result.ok).toBe(false);
        const reason = result.ok ? "" : result.reason;
        for (const problem of [
            "Part id 未登记：statusbar",
            "容器 nbook.panel：未登记的容器位置：sidebar-top",
            "视图 nbook.ghost 的 container 未求值：nbook.missing",
            "视图 nbook.fixed 的 layout 未登记：fixed",
            "视图 nbook.device 的 stateScope 未登记：device",
            "视图 nbook.offline 的 when 取值未登记：offline",
            "视图 nbook.billing 的 requiredAuthority 未登记：billing",
            "视图 id 未命名空间化：NBook.Files",
            "视图 id 重复：nbook.files",
        ]) {
            expect(reason).toContain(problem);
        }
    });
});

describe("evaluateWhen", () => {
    it("缺一个需求即不可见，原因按缺失项给出", () => {
        expect(evaluateWhen({requires: ["project", "selection"]}, context)).toEqual({
            ok: true,
            value: {visible: false, reasons: ["需要先选中一个条目"]},
        });
        expect(evaluateWhen({requires: ["desktop"]}, context)).toEqual({ok: true, value: {visible: true, reasons: []}});
    });

    it("未登记的 when 取值返回失败，而不是当作可见", () => {
        const when = {requires: ["offline"]} as unknown as ViewWhen;

        expect(evaluateWhen(when, context)).toEqual({ok: false, reason: "未登记的 when 取值：offline"});
    });
});

describe("evaluateAuthorities", () => {
    it("多个 authority 是 allOf：缺失的全部上报，视图仍可见只是动作不可执行", () => {
        expect(evaluateAuthorities(["session", "job", "files"], context)).toEqual({
            ok: true,
            value: {actionable: false, reasons: ["需要活动会话", "需要任务 authority 可用"]},
        });
        expect(evaluateAuthorities(["project", "files"], context)).toEqual({ok: true, value: {actionable: true, reasons: []}});
    });

    it("未登记的 requiredAuthority 取值返回失败", () => {
        expect(evaluateAuthorities(["billing"], context)).toEqual({ok: false, reason: "未登记的 requiredAuthority 取值：billing"});
    });
});

describe("resolveViewStateLayer", () => {
    it("user / project 层可直接求值；缺会话实例身份时失败", () => {
        expect(resolveViewStateLayer("user", context)).toEqual({ok: true, value: {scope: "user"}});
        expect(resolveViewStateLayer("project", context)).toEqual({ok: true, value: {scope: "project", projectRoot: "/workspace/novel"}});
        expect(resolveViewStateLayer("session", context)).toEqual({ok: false, reason: "stateScope=session 需要活动会话 id"});
        expect(resolveViewStateLayer("session", {...context, sessionId: "session-1"})).toEqual({ok: true, value: {scope: "session", sessionId: "session-1"}});
    });

    it("未登记的 stateScope 取值返回失败", () => {
        expect(resolveViewStateLayer("device", context)).toEqual({ok: false, reason: "未登记的 stateScope 取值：device"});
    });
});

describe("容器位置与 layout 合同", () => {
    it("容器位置映射到 Part；window 是预留值，求值失败而不是落到既有位置", () => {
        expect(resolveLocationPart("sidebar-left")).toEqual({ok: true, value: "left"});
        expect(resolveLocationPart("sidebar-right")).toEqual({ok: true, value: "right"});
        expect(resolveLocationPart("panel")).toEqual({ok: true, value: "panel"});
        expect(resolveLocationPart("window")).toEqual({ok: false, reason: "容器位置 window 是预留值：第一版未验证其行为，不落位"});
        expect(resolveLocationPart("top")).toEqual({ok: false, reason: "未登记的容器位置：top"});
    });

    it("layout 合同沿用设置外壳的口径：scroll 外壳给内边距并拥有滚动，fill 视图自己占满", () => {
        expect(resolveViewLayout("scroll")).toEqual({ok: true, value: {mode: "scroll", shellPadsContent: true, shellOwnsScroll: true}});
        expect(resolveViewLayout("fill")).toEqual({ok: true, value: {mode: "fill", shellPadsContent: false, shellOwnsScroll: false}});
        expect(resolveViewLayout("fixed")).toEqual({ok: false, reason: "未登记的 layout 取值：fixed"});
    });
});
