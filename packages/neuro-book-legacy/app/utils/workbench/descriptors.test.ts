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
        expect(registry.resolvePart("editor-zone")).toEqual({ok: false, reason: "Part id 未登记：editor-zone"});
        expect(registry.viewsOf("nbook.ghost")).toEqual({ok: false, reason: "容器 id 未登记：nbook.ghost"});
    });

    it("未登记取值与悬空引用让校验失败，且一次性给全所有问题", () => {
        const broken = {
            parts: [{id: "editor-zone", titleKey: "workbench.part.editorZone", canToggleVisibility: false}],
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
            "Part id 未登记：editor-zone",
            "容器 nbook.panel：未登记的容器位置：sidebar-top",
            "视图 nbook.ghost 的 container 未求值：nbook.missing",
            "视图 nbook.fixed 的 layout 未登记：fixed",
            "视图 nbook.device 的 stateScope 未登记：device",
            "视图 nbook.billing 的 requiredAuthority 未登记：billing",
            "视图 id 未命名空间化：NBook.Files",
            "视图 id 重复：nbook.files",
        ]) {
            expect(reason).toContain(problem);
        }
        // 未登记 when 键的诊断要能定位到拥有者与键（文案本身不是合同）。
        expect(reason).toContain("nbook.offline");
        expect(reason).toContain("offline");
    });
});

describe("View 的尺寸约束声明", () => {
    it("合法声明进注册表：不改写声明值，也不补默认", () => {
        const registry = registryOf({
            ...catalog,
            views: [view({id: "nbook.files", minimumSize: {height: 120}, maximumSize: {height: 900, width: 600}})],
        });

        expect(registry.resolveView("nbook.files")).toEqual({
            ok: true,
            value: expect.objectContaining({
                minimumSize: {height: 120},
                maximumSize: {height: 900, width: 600},
            }),
        });
    });

    it("声明值必须正有限：0 / 负 / NaN / Infinity 都不是「不限」，注册期逐一拒绝", () => {
        const result = createWorkbenchRegistry({
            ...catalog,
            views: [view({
                id: "nbook.files",
                minimumSize: {height: 0} as never,
                maximumSize: {width: Number.NaN, height: Number.POSITIVE_INFINITY} as never,
            })],
        });

        expect(result.ok).toBe(false);
        const reason = result.ok ? "" : result.reason;
        expect(reason).toContain("minimumSize.height 不是正有限数");
        expect(reason).toContain("maximumSize.width 不是正有限数");
        expect(reason).toContain("maximumSize.height 不是正有限数");
    });

    it("声明的上限不得低于该轴的有效最小尺寸：低于 64 直接注册失败，而不是呈现时静默丢掉", () => {
        const belowDefault = createWorkbenchRegistry({
            ...catalog,
            views: [view({id: "nbook.files", maximumSize: {height: 50}})],
        });
        const belowFloor = createWorkbenchRegistry({
            ...catalog,
            views: [view({id: "nbook.files", minimumSize: {height: 10}, maximumSize: {height: 32}})],
        });
        const legalFloor = createWorkbenchRegistry({
            ...catalog,
            views: [view({id: "nbook.files", minimumSize: {height: 10}, maximumSize: {height: 33}})],
        });

        expect(belowDefault.ok).toBe(false);
        expect(belowDefault.ok ? "" : belowDefault.reason).toContain("maximumSize.height（50）低于有效最小尺寸 64");
        expect(belowFloor.ok).toBe(false);
        expect(belowFloor.ok ? "" : belowFloor.reason).toContain("maximumSize.height（32）低于有效最小尺寸 33");
        // 33 = 收起标题 32 + 1：正好等于它的上限是合法的，不比它低就行。
        expect(legalFloor.ok).toBe(true);
    });
});

describe("evaluateWhen", () => {
    it("缺一个需求即不可见，原因按缺失项给出", () => {
        const missing = evaluateWhen({requires: ["project", "selection"]}, context);

        expect(missing.ok).toBe(true);
        if (missing.ok) {
            expect(missing.value.visible).toBe(false);
            // 只钉「缺失项各产生一条原因」的行为，不钉具体中文措辞。
            expect(missing.value.reasons).toHaveLength(1);
        }
        expect(evaluateWhen({requires: ["desktop"]}, context)).toEqual({ok: true, value: {visible: true, reasons: []}});
    });

    it("未登记的 when 取值返回失败，而不是当作可见", () => {
        const when = {requires: ["offline"]} as unknown as ViewWhen;
        const result = evaluateWhen(when, context);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain("offline");
        }
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
    it("user / project 层可直接求值；session 不属于 Storage scope", () => {
        expect(resolveViewStateLayer("user", context)).toEqual({ok: true, value: {scope: "user"}});
        expect(resolveViewStateLayer("project", context)).toEqual({ok: true, value: {scope: "project", projectRoot: "/workspace/novel"}});
        expect(resolveViewStateLayer("session", context)).toEqual({ok: false, reason: "未登记的 stateScope 取值：session"});
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

describe("View 的标题动作声明", () => {
    it("合法贡献进注册表：声明原样保留，不复制成第二份字段", () => {
        const registry = registryOf({
            ...catalog,
            views: [view({
                id: "nbook.files",
                titleActions: [{id: "refresh", commandId: "nbook.view.refresh-files", placement: "primary", order: 10}],
            })],
        });

        expect(registry.resolveView("nbook.files")).toEqual({
            ok: true,
            value: expect.objectContaining({
                titleActions: [{id: "refresh", commandId: "nbook.view.refresh-files", placement: "primary", order: 10}],
            }),
        });
    });

    it("空 id / 重复 id / 非法 placement / 非有限 order / 未登记 when / 空 commandId 都在注册期拒绝", () => {
        const result = createWorkbenchRegistry({
            ...catalog,
            views: [view({
                id: "nbook.files",
                titleActions: [
                    {id: "  ", commandId: "nbook.view.refresh-files", placement: "primary", order: 10},
                    {id: "dup", commandId: "nbook.view.refresh-files", placement: "primary", order: 10},
                    {id: "dup", commandId: "", placement: "top", order: Number.NaN, when: {requires: ["nope"]}},
                ] as never,
            })],
        });

        expect(result.ok).toBe(false);
        const reason = result.ok ? "" : result.reason;
        for (const problem of [
            "视图 nbook.files 的标题动作 id 不能为空",
            "视图 nbook.files 的标题动作 id 重复：dup",
            "placement 必须是 primary 或 secondary",
            "order 不是有限数",
            "when 取值未登记：nope",
            "的 commandId 不能为空",
        ]) {
            expect(reason).toContain(problem);
        }
    });
});
