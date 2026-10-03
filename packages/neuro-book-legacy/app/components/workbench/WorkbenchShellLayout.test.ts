// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {nextTick} from "vue";
import {
    GridRenderer,
    type GridAxis,
    type GridBranchChange,
    type GridGestureCommit,
    type GridLayoutResult,
    type GridNode,
} from "@notnotype/nb-ui/layout";
import WorkbenchShellLayout from "nbook/app/components/workbench/WorkbenchShellLayout.vue";
import {
    SHELL_BODY_ID,
    SHELL_PANEL_COLLAPSED_HEIGHT,
    SHELL_PANEL_ID,
    SHELL_PANEL_STACK_ID,
    SHELL_PART_IDS,
    SHELL_ROOT_ID,
    SHELL_SIZE_DEFAULTS,
    type ShellLayoutFacts,
} from "nbook/app/utils/workbench/layout";
import type {WorkbenchPanelState} from "nbook/app/utils/workbench/panel-state";

/**
 * 纯布局组件的受控边界：槽位实例只创建一次、隐藏/最大化只停放不卸载、手势只在有效结束时提交一次。
 *
 * 一次用户手势对新合同就是**一份** `GridGestureCommit`：用例直接调用渲染器上的 `onGestureCommit`
 * 提交它（分界线的冻结、预览与取消在 nb-ui 的分界线会话里，由那边的用例覆盖），因此这里验证的是
 * 外壳怎么接纳、拒绝与发布。几何本身在 `app/utils/workbench/layout.test.ts` 用纯函数验证。
 */
let viewportWidth = 1440;
let viewportHeight = 900;
type Rect = {left: number; top: number; right: number; bottom: number};
/** 外壳与 Grid 各自会建 ResizeObserver：全部收下，由用例显式触发容器尺寸变化。 */
const resizeCallbacks: (() => void)[] = [];
/** 元素矩形桩：jsdom 没有布局引擎，命中判定只认识这里登记的几何。 */
let scopeRect: Rect = {left: 0, top: 0, right: 1440, bottom: 900};
let sashRects: Record<string, Rect> = {};
const wrappers: VueWrapper[] = [];

function domRect(rect: Rect): DOMRect {
    return {
        ...rect,
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        toJSON: () => rect,
    } as DOMRect;
}

beforeEach(() => {
    viewportWidth = 1440;
    viewportHeight = 900;
    resizeCallbacks.length = 0;
    scopeRect = {left: 0, top: 0, right: viewportWidth, bottom: viewportHeight};
    sashRects = {};
    vi.stubGlobal("ResizeObserver", class {
        constructor(callback: () => void) {
            resizeCallbacks.push(callback);
        }

        observe(): void {}
        disconnect(): void {}
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => viewportWidth);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => viewportHeight);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const sash = this.dataset.sash;
        if (sash !== undefined && sashRects[sash] !== undefined) {
            return domRect(sashRects[sash]!);
        }
        return this.dataset.gridScope === undefined ? domRect({left: 0, top: 0, right: 0, bottom: 0}) : domRect(scopeRect);
    });
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

/** 容器尺寸变化：外壳测量与 Grid 自身测量都要跑一遍。 */
function notifyResize(): void {
    for (const callback of [...resizeCallbacks]) {
        callback();
    }
}

/** 指针位移每帧求解一次：等这一帧的 rAF 与随之而来的渲染。 */
async function settleFrame(): Promise<void> {
    const {promise, resolve} = Promise.withResolvers<void>();
    requestAnimationFrame(() => resolve());
    await promise;
    await nextTick();
}

/** 真实指针事件：jsdom 没有 PointerEvent，实现只读 clientX/clientY/pointerId/button/isPrimary。 */
function pointerEvent(type: string, x: number, y: number): MouseEvent {
    return Object.assign(new MouseEvent(type, {bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0}), {
        isPrimary: true,
        pointerId: 1,
        pointerType: "mouse",
    });
}

const PANEL: WorkbenchPanelState = {position: "bottom", alignment: "center", hidden: false, collapsed: false, maximized: false};

function mountShell(overrides: {panel?: Partial<WorkbenchPanelState>; hiddenParts?: readonly string[]; contextKey?: string} = {}): VueWrapper {
    const wrapper = mount(WorkbenchShellLayout, {
        props: {
            sizes: SHELL_SIZE_DEFAULTS,
            panel: {...PANEL, ...overrides.panel},
            contextKey: overrides.contextKey ?? "fixture-1",
            hiddenParts: overrides.hiddenParts ?? [],
        },
        attachTo: document.body,
        slots: Object.fromEntries(SHELL_PART_IDS.map((id) => [id, `<span data-test-slot="${id}">${id}</span>`])),
    });
    wrappers.push(wrapper);
    return wrapper;
}

/** 渲染里唯一的公开 Grid：整棵外壳树的树、呈现与手势接纳回调都从它读。 */
function shellRenderer(wrapper: VueWrapper) {
    const renderer = wrapper.findComponent(GridRenderer);
    const accept = renderer.props("onGestureCommit") as ((commit: GridGestureCommit) => {ok: true} | {ok: false; reason: string}) | undefined;
    if (accept === undefined) {
        throw new Error("外壳没有接上手势接纳回调");
    }
    return {
        renderer,
        node: renderer.props("node") as GridNode<string> | null,
        layout: renderer.props("layout") as GridLayoutResult,
        accept,
    };
}

/** 树里某一分支的主轴与直接子节点 id（手势基线就是它们沿主轴的呈现 px）。 */
function branchView(node: GridNode<string> | null, branchId: string): {axis: GridAxis; children: readonly string[]} {
    const walk = (candidate: GridNode<string> | null): {axis: GridAxis; children: readonly string[]} | null => {
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
    const hit = walk(node);
    if (hit === null) {
        throw new Error(`渲染树里没有分支：${branchId}`);
    }
    return hit;
}

/** 节点的绝对矩形：sash 占用按呈现给出的流内尺寸累加。 */
function absoluteRect(layout: GridLayoutResult, node: GridNode<string> | null, targetId: string): Rect | null {
    const walk = (candidate: GridNode<string> | null, x: number, y: number): Rect | null => {
        if (candidate === null) {
            return null;
        }
        const size = layout.sizes[candidate.id] ?? {width: 0, height: 0};
        const rect = {left: x, top: y, right: x + size.width, bottom: y + size.height};
        if (candidate.id === targetId) {
            return rect;
        }
        if (candidate.kind !== "branch") {
            return null;
        }
        const horizontal = candidate.orientation === "horizontal";
        const sash = layout.sashSizes[candidate.id] ?? [];
        let cursor = horizontal ? x : y;
        for (const [index, child] of candidate.children.entries()) {
            const childSize = layout.sizes[child.id] ?? {width: 0, height: 0};
            const hit = walk(child, horizontal ? cursor : x, horizontal ? y : cursor);
            if (hit !== null) {
                return hit;
            }
            cursor += (horizontal ? childSize.width : childSize.height) + (sash[index] ?? 0);
        }
        return null;
    };
    return walk(node, 0, 0);
}

describe("WorkbenchShellLayout：稳定槽位与受控呈现", () => {
    it("七个 Part 各渲染一次，并落到自己的叶落点上", async () => {
        const wrapper = mountShell();
        await flush();
        for (const part of SHELL_PART_IDS) {
            expect(wrapper.findAll(`[data-test-slot="${part}"]`)).toHaveLength(1);
            const leaf = wrapper.find(`[data-leaf="${part}"]`);
            expect(leaf.exists()).toBe(true);
            expect(leaf.element.contains(wrapper.find(`[data-shell-slot="${part}"]`).element)).toBe(true);
        }
        // 全部落点都在场时停放区是空的：内容不该在停放区里留副本。
        expect(wrapper.find("[data-shell-parking]").element.children).toHaveLength(0);
    });

    it("换位置/对齐/隐藏与容器变化都保留同一个槽位实例", async () => {
        const wrapper = mountShell();
        await flush();
        const editor = wrapper.find('[data-test-slot="editor"]').element;
        const activity = wrapper.find('[data-test-slot="activity"]').element;

        await wrapper.setProps({panel: {...PANEL, position: "left", alignment: "left"}});
        await flush();
        expect(wrapper.find('[data-test-slot="editor"]').element).toBe(editor);

        await wrapper.setProps({hiddenParts: ["right"]});
        await flush();
        expect(wrapper.find('[data-test-slot="editor"]').element).toBe(editor);
        expect(wrapper.find('[data-test-slot="right"]').element).toBeDefined();

        viewportWidth = 700;
        notifyResize();
        await flush();
        expect(wrapper.attributes("data-shell-layout")).toBe("compact");
        expect(wrapper.find('[data-test-slot="editor"]').element).toBe(editor);
        expect(wrapper.find('[data-test-slot="activity"]').element).toBe(activity);

        viewportWidth = 1440;
        notifyResize();
        await flush();
        expect(wrapper.attributes("data-shell-layout")).toBe("split");
        expect(wrapper.find('[data-test-slot="editor"]').element).toBe(editor);
    });

    it("隐藏 Panel 只把内容停放到停放区，不卸载", async () => {
        const wrapper = mountShell();
        await flush();
        const panelSlot = wrapper.find('[data-shell-slot="panel"]').element;
        await wrapper.setProps({panel: {...PANEL, hidden: true}});
        await flush();
        expect(wrapper.find('[data-leaf="panel"]').exists()).toBe(false);
        expect(wrapper.find('[data-test-slot="panel"]').exists()).toBe(true);
        expect(wrapper.find("[data-shell-parking]").element.contains(panelSlot)).toBe(true);

        await wrapper.setProps({panel: {...PANEL, hidden: false}});
        await flush();
        expect(wrapper.find('[data-leaf="panel"]').element.contains(panelSlot)).toBe(true);
    });

    it("最大化只改呈现：Panel 占满编辑列，槽位仍在原地", async () => {
        const wrapper = mountShell({panel: {maximized: true}});
        await flush();
        const facts = wrapper.emitted("layout")?.at(-1)?.[0] as ShellLayoutFacts;
        expect(facts.effectivePanel.maximized).toBe(true);
        const {layout} = shellRenderer(wrapper);
        expect(layout.sizes.editor?.height).toBe(0);
        expect(wrapper.find('[data-test-slot="editor"]').exists()).toBe(true);
    });

    it("短容器只在呈现收起 Panel，并把事实交给宿主", async () => {
        viewportHeight = 260;
        const wrapper = mountShell();
        await flush();
        const facts = wrapper.emitted("layout")?.at(-1)?.[0] as ShellLayoutFacts;
        expect(facts.effectivePanel.collapsed).toBe(true);
        const {layout} = shellRenderer(wrapper);
        expect(layout.sizes[SHELL_PANEL_ID]?.height).toBe(SHELL_PANEL_COLLAPSED_HEIGHT);
        expect(wrapper.find('[data-test-slot="panel"]').exists()).toBe(true);
    });

    it("隐藏 Panel 把焦点交给宿主的显示入口，不留在停放区", async () => {
        const wrapper = mount(WorkbenchShellLayout, {
            props: {sizes: SHELL_SIZE_DEFAULTS, panel: {...PANEL}, contextKey: "focus", hiddenParts: []},
            attachTo: document.body,
            slots: {
                ...Object.fromEntries(SHELL_PART_IDS.map((id) => [id, `<span data-test-slot="${id}">${id}</span>`])),
                statusbar: `<button type="button" data-shell-focus-target="panel-toggle">显示面板</button>`,
                editor: `<span data-test-slot="editor" tabindex="0">editor</span>`,
            },
        });
        wrappers.push(wrapper);
        await flush();
        const editor = wrapper.find('[data-test-slot="editor"]').element as HTMLElement;
        editor.focus();
        expect(document.activeElement).toBe(editor);

        await wrapper.setProps({panel: {...PANEL, hidden: true}});
        await flush();
        const toggle = wrapper.find('[data-shell-focus-target="panel-toggle"]').element;
        expect(document.activeElement).toBe(toggle);
    });

    it("普通的换位置不抢焦点（焦点留在原节点上）", async () => {
        const wrapper = mount(WorkbenchShellLayout, {
            props: {sizes: SHELL_SIZE_DEFAULTS, panel: {...PANEL}, contextKey: "focus-keep", hiddenParts: []},
            attachTo: document.body,
            slots: {
                ...Object.fromEntries(SHELL_PART_IDS.map((id) => [id, `<span data-test-slot="${id}">${id}</span>`])),
                editor: `<span data-test-slot="editor" tabindex="0">editor</span>`,
            },
        });
        wrappers.push(wrapper);
        await flush();
        const editor = wrapper.find('[data-test-slot="editor"]').element as HTMLElement;
        editor.focus();
        await wrapper.setProps({panel: {...PANEL, position: "left"}});
        await flush();
        expect(document.activeElement).toBe(editor);
    });
});

describe("WorkbenchShellLayout：手势只在有效结束时提交一次", () => {
    /** 外壳把自己的代际键随 `resize` 回传；提交里带同样的键才被接纳。 */
    const GESTURE_CONTEXT = "fixture-1";

    /** 一条分支变化：基线取当前呈现 px，`move` 在分支内守恒地把 delta 挪给另一个子节点。 */
    function changeOf(wrapper: VueWrapper, branchId: string, move: {from: string; to: string; delta: number}, active: readonly string[]): GridBranchChange {
        const {node, layout} = shellRenderer(wrapper);
        const branch = branchView(node, branchId);
        const baseline: Record<string, number> = Object.fromEntries(branch.children.map((id) => [id, layout.sizes[id]?.[branch.axis] ?? 0]));
        return {
            branchId,
            axis: branch.axis,
            baseline,
            target: {...baseline, [move.from]: baseline[move.from]! - move.delta, [move.to]: baseline[move.to]! + move.delta},
            extent: layout.sizes[branchId] ?? {width: viewportWidth, height: viewportHeight},
            active,
            compensated: [],
            collapsed: {},
        };
    }

    function commitOf(changes: readonly GridBranchChange[], contextKey: string = GESTURE_CONTEXT): GridGestureCommit {
        return {sessionId: "pointer-1", contextKey, source: "pointer", revision: 1, extent: {width: viewportWidth, height: viewportHeight}, changes};
    }

    it("交汇处两条轴一起结算：只发一次 resize，补丁同时含侧栏宽度与 Panel 高度", async () => {
        const wrapper = mountShell();
        await flush();
        const {accept} = shellRenderer(wrapper);
        // 一次按下同时抓住 body 的竖线与 panel-stack 的横线：两条轴在同一份 changes 里。
        const bodyChange = changeOf(wrapper, SHELL_BODY_ID, {from: "left", to: SHELL_PANEL_STACK_ID, delta: 40}, ["left"]);
        const stackChange = changeOf(wrapper, SHELL_PANEL_STACK_ID, {from: "editor", to: SHELL_PANEL_ID, delta: 50}, [SHELL_PANEL_ID]);

        expect(accept(commitOf([bodyChange, stackChange]))).toEqual({ok: true});
        await flush();

        expect(wrapper.emitted("resize")).toEqual([[{
            contextKey: GESTURE_CONTEXT,
            patch: {
                leftPanelWidth: bodyChange.baseline.left! - 40,
                panelHeight: stackChange.baseline[SHELL_PANEL_ID]! + 50,
            },
        }]]);
        expect(wrapper.emitted("gesture-cancel")).toBeUndefined();
    });

    it("代际不匹配的提交被拒绝：不提交尺寸，拒绝原因留在壳上", async () => {
        const wrapper = mountShell();
        await flush();
        const {accept} = shellRenderer(wrapper);
        const change = changeOf(wrapper, SHELL_PANEL_STACK_ID, {from: "editor", to: SHELL_PANEL_ID, delta: 50}, [SHELL_PANEL_ID]);

        const settled = accept(commitOf([change], "fixture-2"));
        await flush();

        expect(settled.ok).toBe(false);
        expect(wrapper.emitted("resize")).toBeUndefined();
        expect(String(wrapper.attributes("data-layout-diagnostics") ?? "")).toContain("手势未落账");
        expect(String(wrapper.attributes("data-layout-diagnostics") ?? "")).toContain("工作面已切换");
    });

    it("不可结算分支的提交整批拒绝：补丁不产生，拒绝原因可见", async () => {
        const wrapper = mountShell();
        await flush();
        const {accept} = shellRenderer(wrapper);
        // 根分支只有刚性条与主体：直接子节点里没有可保存的叶。
        const change = changeOf(wrapper, SHELL_ROOT_ID, {from: "main", to: "titlebar", delta: 10}, ["titlebar"]);

        const settled = accept(commitOf([change]));
        await flush();

        expect(settled.ok).toBe(false);
        expect(wrapper.emitted("resize")).toBeUndefined();
        expect(String(wrapper.attributes("data-layout-diagnostics") ?? "")).toContain("不产生保存");
    });

    it("目标不守恒的提交被拒绝：不发 resize，呈现保持受控事实", async () => {
        const wrapper = mountShell();
        await flush();
        const {accept, layout} = shellRenderer(wrapper);
        const before = layout.sizes[SHELL_PANEL_ID]!.height;
        const change = changeOf(wrapper, SHELL_PANEL_STACK_ID, {from: "editor", to: SHELL_PANEL_ID, delta: 50}, [SHELL_PANEL_ID]);
        // 只把 Panel 加高、editor 不让位：总量不守恒，整批拒绝。
        const broken: GridBranchChange = {...change, target: {...change.baseline, [SHELL_PANEL_ID]: change.baseline[SHELL_PANEL_ID]! + 50}};

        const settled = accept(commitOf([broken]));
        await flush();

        expect(settled.ok).toBe(false);
        expect(wrapper.emitted("resize")).toBeUndefined();
        expect(shellRenderer(wrapper).layout.sizes[SHELL_PANEL_ID]!.height).toBe(before);
        expect(String(wrapper.attributes("data-layout-diagnostics") ?? "")).toContain("不守恒");
    });

    it("容器变化让面板退化后，旧基线的提交不落账", async () => {
        const wrapper = mountShell();
        await flush();
        const {accept} = shellRenderer(wrapper);
        const change = changeOf(wrapper, SHELL_PANEL_STACK_ID, {from: "editor", to: SHELL_PANEL_ID, delta: 50}, [SHELL_PANEL_ID]);

        // 容器高度变化：面板只在呈现退到 32px 标题头，按下时的基线随即作废。
        viewportHeight = 260;
        notifyResize();
        await flush();
        expect(shellRenderer(wrapper).layout.sizes[SHELL_PANEL_ID]?.height).toBe(SHELL_PANEL_COLLAPSED_HEIGHT);

        const settled = accept(commitOf([change]));
        await flush();

        expect(settled.ok).toBe(false);
        expect(wrapper.emitted("resize")).toBeUndefined();
        expect(String(wrapper.attributes("data-layout-diagnostics") ?? "")).toContain("基线已失效");
    });

    it("余量分支的手势不产生保存：不发 resize，也不产生取消", async () => {
        const wrapper = mountShell({panel: {position: "bottom", alignment: "left"}});
        await flush();
        const {accept} = shellRenderer(wrapper);
        // content-row 里只有 left 与 editor：动 editor 只是分走余量，没有可保存的字段。
        const change = changeOf(wrapper, "content-row", {from: "left", to: "editor", delta: 30}, ["editor"]);

        expect(accept(commitOf([change]))).toEqual({ok: true});
        await flush();

        expect(wrapper.emitted("resize")).toBeUndefined();
        expect(wrapper.emitted("gesture-cancel")).toBeUndefined();
        expect(String(wrapper.attributes("data-layout-diagnostics") ?? "")).toBe("");
    });

    it("渲染层取消一场手势：外壳只发可观察的取消，不提交尺寸", async () => {
        const wrapper = mountShell();
        await flush();
        shellRenderer(wrapper).renderer.vm.$emit("gesture-cancel", {reason: "context-changed", sashes: []});
        await flush();

        expect(wrapper.emitted("resize")).toBeUndefined();
        expect(wrapper.emitted("gesture-cancel")).toEqual([[{reason: "手势被取消：context-changed"}]]);
    });

    it("分界线上的指针拖动：一次手势只发一次 resize，带当前代际键", async () => {
        const wrapper = mountShell();
        await flush();
        const {node, layout} = shellRenderer(wrapper);
        const editor = absoluteRect(layout, node, "editor")!;
        const stack = absoluteRect(layout, node, SHELL_PANEL_STACK_ID)!;
        const panelBefore = layout.sizes[SHELL_PANEL_ID]!.height;
        const sashRect = {left: stack.left, top: editor.bottom, right: stack.right, bottom: editor.bottom + 1};
        sashRects["panel-stack:0"] = sashRect;

        const sash = wrapper.get<HTMLElement>('[data-sash="panel-stack:0"]');
        const x = sashRect.left + 20;
        const y = editor.bottom;
        // 向上拖：分隔线之上的 editor 让位给 Panel。
        sash.element.dispatchEvent(pointerEvent("pointerdown", x, y));
        sash.element.dispatchEvent(pointerEvent("pointermove", x, y - 40));
        await settleFrame();
        sash.element.dispatchEvent(pointerEvent("pointerup", x, y - 40));
        await flush();

        const resizes = wrapper.emitted("resize") as [{contextKey: string; patch: {panelHeight?: number}}][] | undefined;
        expect(resizes).toHaveLength(1);
        expect(resizes![0]![0].contextKey).toBe(GESTURE_CONTEXT);
        expect(resizes![0]![0].patch.panelHeight).toBeCloseTo(panelBefore + 40, 3);
        expect(wrapper.emitted("gesture-cancel")).toBeUndefined();
    });
});
