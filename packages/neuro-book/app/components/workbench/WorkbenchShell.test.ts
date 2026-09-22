// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {nextTick} from "vue";
import {GridRenderer, type GridBranchChange, type GridGestureCommit, type GridLayoutResult, type GridNode} from "@notnotype/nb-ui/layout";
import WorkbenchShell from "nbook/app/components/workbench/WorkbenchShell.vue";
import {SHELL_PANEL_ID, SHELL_PANEL_STACK_ID, SHELL_PART_IDS, type ShellLayoutFacts} from "nbook/app/utils/workbench/layout";

/**
 * 产品外壳包装层：把纯布局接到会话上。
 *
 * 这里只验证**接线**——读数来自会话、程序布局不提交、一次有效手势只提交一次、叶显隐收窄到四个 Part、
 * 失效的瞬时最大化回传清除、提示条给出出口。几何与槽位实例在 `WorkbenchShellLayout.test.ts` 验证；
 * 会话自身的首读门禁、CAS 与字段路由在 `app/utils/workbench/layout-session.test.ts` 验证。
 *
 * 手势按新合同驱动：一次手势 = 一份 `GridGestureCommit`，交给渲染器的 `onGestureCommit` 同步接纳；
 * 外壳只把它换算成一次 `commitSizes` 调用。
 */

const fakeSession = vi.hoisted(() => ({
    contextKey: null as unknown,
    preferences: null as unknown,
    panelSize: null as unknown,
    publication: null as unknown,
    state: null as unknown,
    calls: {
        enterSurface: [] as unknown[],
        commitSizes: [] as unknown[],
        retry: 0,
        abandon: 0,
        retryMigration: 0,
        release: 0,
    },
}));

vi.mock("nbook/app/utils/workbench/layout-session", async () => {
    const {computed, ref} = await import("vue");
    const contextKey = ref("project:/tmp/demo");
    const preferences = ref({leftPanelWidth: 340, agentPanelWidth: 400});
    const panelSize = ref({height: 200, width: 320});
    const publication = ref(0);
    const state = ref({
        surface: "idle",
        pendingSurface: null,
        loading: false,
        notice: null,
        migration: null,
        issues: [],
    });
    fakeSession.contextKey = contextKey;
    fakeSession.preferences = preferences;
    fakeSession.panelSize = panelSize;
    fakeSession.publication = publication;
    fakeSession.state = state;
    const session = {
        state: computed(() => state.value),
        contextKey: computed(() => contextKey.value),
        preferences: computed(() => preferences.value),
        panelSize: computed(() => panelSize.value),
        publication: computed(() => publication.value),
        async enterSurface(surface: unknown) {
            fakeSession.calls.enterSurface.push(surface);
        },
        async commitSizes(input: unknown) {
            fakeSession.calls.commitSizes.push(input);
            return {status: "saved", records: {widths: "saved", panel: "saved"}};
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
        async release() {
            fakeSession.calls.release += 1;
        },
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

const PANEL = {position: "bottom", alignment: "center", hidden: false, collapsed: false} as const;

const wrappers: VueWrapper[] = [];

function resetSession(): void {
    (fakeSession.contextKey as {value: string}).value = "project:/tmp/demo";
    (fakeSession.preferences as {value: {leftPanelWidth: number; agentPanelWidth: number}}).value = {leftPanelWidth: 340, agentPanelWidth: 400};
    (fakeSession.panelSize as {value: {height: number; width: number}}).value = {height: 200, width: 320};
    fakeSession.calls.enterSurface.length = 0;
    fakeSession.calls.commitSizes.length = 0;
    fakeSession.calls.retry = 0;
    fakeSession.calls.abandon = 0;
    fakeSession.calls.retryMigration = 0;
    fakeSession.calls.release = 0;
}

beforeEach(() => {
    resetSession();
    vi.stubGlobal("useI18n", () => ({t: (key: string, params?: {diagnosis?: string}) => (params?.diagnosis ? `${key}:${params.diagnosis}` : key)}));
    vi.stubGlobal("ResizeObserver", class {
        observe(): void {}
        disconnect(): void {}
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1440);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
});

afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
    await nextTick();
    await nextTick();
    await nextTick();
}

function mountShell(props: {maximized?: boolean; panel?: Record<string, unknown>} = {}): VueWrapper {
    const wrapper = mount(WorkbenchShell, {
        props: {
            surface: {kind: "idle"},
            panel: {...PANEL, ...props.panel},
            ...(props.maximized === undefined ? {} : {maximized: props.maximized}),
        },
        attachTo: document.body,
        slots: Object.fromEntries(SHELL_PART_IDS.map((id) => [id, `<span data-test-slot="${id}">${id}</span>`])),
    });
    wrappers.push(wrapper);
    return wrapper;
}

/**
 * 外壳暴露面的测试视图：`defineExpose` 的成员在 `VueWrapper` 上不参与类型推导，
 * 这里给测试一处显式形状（运行期就是 `vm` 本身）。
 */
type ShellExposed = {
    setLeafVisible(id: string, visible: boolean): void;
    hidden: string[];
    facts: ShellLayoutFacts | null;
};

function shellVm(wrapper: VueWrapper): ShellExposed {
    return wrapper.vm as unknown as ShellExposed;
}

/**
 * 渲染里唯一的公开 Grid：整棵外壳树的呈现与手势接纳回调都从它读
 * （一次手势在新合同里就是一份 `GridGestureCommit`，由渲染器交给宿主接纳）。
 */
function shellRenderer(wrapper: VueWrapper) {
    const renderer = wrapper.findComponent(GridRenderer);
    const accept = renderer.props("onGestureCommit") as ((commit: GridGestureCommit) => {ok: true} | {ok: false; reason: string}) | undefined;
    if (accept === undefined) {
        throw new Error("外壳没有接上手势接纳回调");
    }
    return {
        node: renderer.props("node") as GridNode<string> | null,
        layout: renderer.props("layout") as GridLayoutResult,
        accept,
    };
}

/** 一条分支变化：基线取当前呈现 px，把 delta 从 `from` 守恒地挪给 `to`。 */
function changeOf(wrapper: VueWrapper, branchId: string, move: {from: string; to: string; delta: number}, active: readonly string[]): GridBranchChange {
    const {node, layout} = shellRenderer(wrapper);
    const walk = (candidate: GridNode<string> | null): {axis: "width" | "height"; children: readonly string[]} | null => {
        if (candidate === null || candidate.kind !== "branch") {
            return null;
        }
        if (candidate.id === branchId) {
            return {axis: candidate.orientation === "horizontal" ? "width" : "height", children: candidate.children.map((child) => child.id)};
        }
        for (const child of candidate.children) {
            const hit = walk(child);
            if (hit !== null) {
                return hit;
            }
        }
        return null;
    };
    const branch = walk(node);
    if (branch === null) {
        throw new Error(`渲染树里没有分支：${branchId}`);
    }
    const baseline: Record<string, number> = Object.fromEntries(branch.children.map((id) => [id, layout.sizes[id]?.[branch.axis] ?? 0]));
    return {
        branchId,
        axis: branch.axis,
        baseline,
        target: {...baseline, [move.from]: baseline[move.from]! - move.delta, [move.to]: baseline[move.to]! + move.delta},
        extent: layout.sizes[branchId] ?? {width: 1440, height: 900},
        active,
        compensated: [],
        collapsed: {},
    };
}

/** 一次手势的完整提交：会话只会看到 `resize` 换来的 `commitSizes`。 */
function commitOf(changes: readonly GridBranchChange[]): GridGestureCommit {
    return {sessionId: "pointer-1", contextKey: "project:/tmp/demo", source: "pointer", revision: 1, extent: {width: 1440, height: 900}, changes};
}

describe("WorkbenchShell：会话接线", () => {
    it("读数来自会话，程序布局不产生提交", async () => {
        const wrapper = mountShell();
        await flush();
        expect(fakeSession.calls.enterSurface).toEqual([{kind: "idle"}]);
        const layout = shellRenderer(wrapper).layout;
        expect(layout.sizes.left?.width).toBe(340);
        expect(layout.sizes.right?.width).toBe(400);
        expect(layout.sizes[SHELL_PANEL_ID]?.height).toBe(200);
        expect(fakeSession.calls.commitSizes).toHaveLength(0);

        // 叶显隐与容器变化都是程序布局：只更新呈现。
        shellVm(wrapper).setLeafVisible("right", false);
        await flush();
        expect(wrapper.find('[data-leaf="right"]').exists()).toBe(false);
        expect(fakeSession.calls.commitSizes).toHaveLength(0);

        shellVm(wrapper).setLeafVisible("right", true);
        await flush();

        // 会话重新发布（恢复 / 放弃）：按新偏好重建，仍不提交。
        (fakeSession.preferences as {value: {leftPanelWidth: number; agentPanelWidth: number}}).value = {leftPanelWidth: 520, agentPanelWidth: 400};
        (fakeSession.publication as {value: number}).value += 1;
        await flush();
        expect(shellRenderer(wrapper).layout.sizes.left?.width).toBe(520);
        expect(fakeSession.calls.commitSizes).toHaveLength(0);
    });

    it("一次有效手势只提交一次，且带当前代际键与主动轴补丁", async () => {
        const wrapper = mountShell();
        await flush();
        const {accept} = shellRenderer(wrapper);
        const change = changeOf(wrapper, SHELL_PANEL_STACK_ID, {from: "editor", to: SHELL_PANEL_ID, delta: 50}, [SHELL_PANEL_ID]);

        // 一次手势 = 一份提交：外壳只把它换算成一次 commitSizes。
        expect(accept(commitOf([change]))).toEqual({ok: true});
        await flush();
        expect(fakeSession.calls.commitSizes).toEqual([{
            contextKey: "project:/tmp/demo",
            patch: {panelHeight: change.baseline[SHELL_PANEL_ID]! + 50},
        }]);
    });

    it("叶显隐只接受登记的 Part，其余进诊断", async () => {
        const wrapper = mountShell();
        await flush();
        shellVm(wrapper).setLeafVisible("editor", false);
        await flush();
        expect(wrapper.find('[data-leaf="editor"]').exists()).toBe(true);
        expect(String(wrapper.find("[data-workbench-shell]").attributes("data-session-diagnostics"))).toContain("未登记的叶：editor");

        shellVm(wrapper).setLeafVisible("titlebar", false);
        await flush();
        expect(wrapper.find('[data-leaf="titlebar"]').exists()).toBe(false);
    });

    it("失效的瞬时最大化回传给宿主清除，不写存储", async () => {
        const wrapper = mountShell({maximized: true, panel: {hidden: true}});
        await flush();
        expect(wrapper.emitted("update:maximized")).toEqual([[false]]);
        expect(fakeSession.calls.commitSizes).toHaveLength(0);
    });

    it("呈现事实带上 mode 与生效面板状态", async () => {
        const wrapper = mountShell();
        await flush();
        const facts = shellVm(wrapper).facts;
        expect(facts?.mode).toBe("split");
        expect(facts?.effectivePanel).toMatchObject({position: "bottom", alignment: "center", collapsed: false});
    });

    it("提示条给出重试与放弃出口", async () => {
        const wrapper = mountShell();
        await flush();
        expect(wrapper.find("[data-layout-notice]").exists()).toBe(false);

        (fakeSession.state as {value: Record<string, unknown>}).value = {
            surface: "idle",
            pendingSurface: null,
            loading: false,
            notice: {kind: "unsaved", surface: "idle", diagnosis: "后端不可达", retryable: true},
            migration: null,
            issues: [],
        };
        await flush();
        const strip = wrapper.get("[data-layout-notice]");
        expect(strip.text()).toContain("ide.workbench.layout.unsaved");
        expect(strip.text()).toContain("后端不可达");
        const buttons = strip.findAll("button");
        expect(buttons).toHaveLength(2);
        await buttons[0]!.trigger("click");
        expect(fakeSession.calls.retry).toBe(1);
        await buttons[1]!.trigger("click");
        expect(fakeSession.calls.abandon).toBe(1);

        (fakeSession.state as {value: Record<string, unknown>}).value = {
            surface: "idle",
            pendingSurface: null,
            loading: false,
            notice: {kind: "migration-blocked", surface: "idle", diagnosis: "后端不可达", retryable: true},
            migration: {phase: "blocked", blocked: "backend-unreachable", diagnosis: "后端不可达", retryable: true},
            issues: [],
        };
        await flush();
        await wrapper.get("[data-layout-notice]").findAll("button")[0]!.trigger("click");
        expect(fakeSession.calls.retryMigration).toBe(1);
    });
});
