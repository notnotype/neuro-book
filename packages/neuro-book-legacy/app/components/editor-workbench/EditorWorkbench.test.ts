// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, nextTick, ref, type Ref} from "vue";
import type {MenubarMenuData} from "@notnotype/nb-ui/components";
import {GridRenderer} from "@notnotype/nb-ui/layout";
import type {GridBranchChange, GridGestureCommit} from "@notnotype/nb-ui/layout";
import EditorWorkbench from "nbook/app/components/editor-workbench/EditorWorkbench.vue";
import type {EditorGroupState, EditorTabPresentation} from "nbook/app/components/editor-workbench/editor-view.types";
import {applyEditorGesture, createEditorGrid, splitEditorGroup} from "nbook/app/utils/editor-workbench/editor-groups";

vi.hoisted(() => {
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

/**
 * 编辑器工作区外壳的组合边界：受控 props 决定画什么，用户操作只往宿主发意图；
 * 忙碌与打开方式诊断期间正文（default 槽）始终留在 DOM 里，错误给“重试 / 以源码打开”两个出口。
 *
 * 视图实例的创建与释放、保存与关闭决策由 useEditorWorkbench / EditorViewHost 的测试覆盖；
 * 这里用一个受控宿主替身复现“父层接受或拒绝”的反馈。
 */

const mounted: VueWrapper[] = [];

/** 布局夹具：与产品同源的树（公共助手搭出来），单组 / 左右两组 / 主区上下三组。 */
function editorFixture(kind: "single" | "split" | "triple") {
    const grid = createEditorGrid("main");
    if (kind !== "single") {
        expect(splitEditorGroup(grid, "main", "side", "right").ok).toBe(true);
    }
    if (kind === "triple") {
        expect(splitEditorGroup(grid, "side", "bottom", "bottom").ok).toBe(true);
    }
    return {grid, tree: grid.root(), layout: grid.layout({width: 800, height: 600})};
}

/** 真实 Splitter 需要布局引擎；多组用例只验渲染与事件接线，用面板插槽桩替代。 */
const SplitterStub = defineComponent({
    name: "Splitter",
    props: ["branchId", "direction", "panels", "sashSizes", "sizesPx", "disabled"],
    emits: ["layout", "gesture-start", "gesture-update", "gesture-end", "gesture-cancel"],
    template: "<div><slot v-for='panel in panels' :name='`panel-${panel.id}`'/></div>",
});

// jsdom 不实现滚动；标签栏用它把活动标签滚入可见。
Element.prototype.scrollIntoView = vi.fn();

const FILE_MENUS: MenubarMenuData[] = [{id: "file", label: "文件", items: [
    {value: "save", label: "保存", shortcut: "Ctrl+S"},
    {value: "close", label: "关闭"},
]}];

beforeEach(() => {
    vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
    vi.stubGlobal("ResizeObserver", class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    });
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
        wrapper.unmount();
    }
    document.body.replaceChildren();
    vi.unstubAllGlobals();
});


function tab(path: string, overrides: Partial<Omit<EditorTabPresentation, "path">> = {}): EditorTabPresentation {
    return {path, title: path, pinned: false, preview: false, dirty: false, iconClass: "i-lucide-file-text", ...overrides};
}

type ShellState = {
    wrapper: VueWrapper;
    activePath: Ref<string>;
    busy: Ref<boolean>;
    diagnosis: Ref<string | null>;
    emitted: (event: string) => unknown[][] | undefined;
    settleClose: () => void;
};

/**
 * 受控宿主替身：默认在同一事件里同步接受关闭（等价于无脏标签的真实路径）；
 * `deferClose` 模拟真实宿主先等保存/放弃决策、稍后才清空标签的延迟反馈。
 */
function mountShell(options: {
    tabs?: EditorTabPresentation[];
    activePath?: string;
    menus?: MenubarMenuData[];
    busy?: boolean;
    diagnosis?: string | null;
    deferClose?: boolean;
    allowSplit?: boolean;
} = {}): ShellState {
    const tabs = ref<EditorTabPresentation[]>(options.tabs ?? []);
    const activePath = ref(options.activePath ?? "");
    const busy = ref(options.busy ?? false);
    const diagnosis = ref<string | null>(options.diagnosis ?? null);
    let pendingClose: string | null = null;
    function closeNow(path: string): void {
        tabs.value = tabs.value.filter((item) => item.path !== path);
        if (activePath.value === path) {
            activePath.value = tabs.value[0]?.path ?? "";
        }
    }
    function settleClose(): void {
        if (pendingClose === null) {
            throw new Error("没有待结算的关闭请求");
        }
        const path = pendingClose;
        pendingClose = null;
        closeNow(path);
    }
    const {tree, layout} = editorFixture("single");
    const wrapper = mount(defineComponent({
        name: "EditorWorkbenchHost",
        setup() {
            const groups = (): EditorGroupState[] => [{
                id: "main",
                tabs: tabs.value,
                activePath: activePath.value,
                menus: options.menus ?? [],
                busy: busy.value,
                diagnosis: diagnosis.value,
            }];
            return () => h(EditorWorkbench, {
                groups: groups(),
                tree,
                layout,
                activeGroupId: "main",
                allowSplit: options.allowSplit ?? false,
                onCloseTab: (_groupId: string, path: string) => {
                    if (options.deferClose === true) {
                        pendingClose = path;
                        return;
                    }
                    closeNow(path);
                },
            }, {
                default: () => h("div", {"data-body": "true"}, "正文内容"),
                empty: () => h("button", {type: "button", "data-welcome": "true"}, "新建章节"),
                status: () => h("span", {"data-status": "true"}, "已保存"),
            });
        },
    }), {attachTo: document.body});
    mounted.push(wrapper);
    const workbench = wrapper.findComponent(EditorWorkbench);
    return {
        wrapper,
        activePath,
        busy,
        diagnosis,
        emitted: (event: string) => workbench.emitted(event),
        settleClose,
    };
}

function alertAction(wrapper: VueWrapper, label: string): HTMLButtonElement {
    const button = wrapper.get('[role="alert"]').findAll("button")
        .map((candidate) => candidate.element)
        .find((element) => element.textContent?.trim() === label);
    if (!button) {
        throw new Error(`错误提示条里没有「${label}」操作`);
    }
    return button;
}

describe("EditorWorkbench 受控外壳", () => {
    it("有文档时正文落在 tabpanel 里，ARIA 关系指向活动标签，状态与菜单同排可用", () => {
        const {wrapper} = mountShell({
            tabs: [tab("manuscript/chapter-01.md"), tab("data.json")],
            activePath: "manuscript/chapter-01.md",
            menus: FILE_MENUS,
        });

        const panel = wrapper.get('[role="tabpanel"]');
        const activeTab = wrapper.get('[role="tab"][aria-selected="true"]');
        expect(panel.attributes("id")).toBe(activeTab.attributes("aria-controls"));
        expect(panel.attributes("aria-labelledby")).toBe(activeTab.attributes("id"));

        expect(panel.find("[data-body]").exists()).toBe(true);
        // 有正文时不画欢迎页，两者不会同时出现。
        expect(panel.find("[data-welcome]").exists()).toBe(false);
        expect(wrapper.find("[data-status]").exists()).toBe(true);
        expect(wrapper.find(".editor-toolbar-more-btn").exists()).toBe(true);
    });

    it("单根 section 承载外壳，外部 attrs 由它原样透传", () => {
        const {tree, layout} = editorFixture("single");
        const wrapper = mount(EditorWorkbench, {
            props: {groups: [{id: "main", tabs: [], activePath: ""}], tree, layout, activeGroupId: "main"},
            attrs: {"data-shell": "editor"},
            attachTo: document.body,
        });
        mounted.push(wrapper);

        expect(wrapper.element.tagName).toBe("SECTION");
        expect(wrapper.element.getAttribute("data-shell")).toBe("editor");
    });

    it("busy 只加遮罩与 aria-busy，正文实例始终留在 DOM 里", async () => {
        const {wrapper, busy} = mountShell({tabs: [tab("a.md")], activePath: "a.md"});
        const bodyBefore = wrapper.get("[data-body]").element;

        busy.value = true;
        await nextTick();
        expect(wrapper.get('[role="tabpanel"]').attributes("aria-busy")).toBe("true");
        expect(wrapper.get('[role="status"]').attributes("aria-live")).toBe("polite");
        // 同一个 DOM 节点还在：忙碌不能卸载、重建用户正在看的正文。
        expect(wrapper.get("[data-body]").element).toBe(bodyBefore);

        busy.value = false;
        await nextTick();
        expect(wrapper.find('[role="status"]').exists()).toBe(false);
        expect(wrapper.get("[data-body]").element).toBe(bodyBefore);
    });

    it("打开方式出错时正文保留，重试/以源码打开把决定交还宿主", async () => {
        const {wrapper, diagnosis, emitted} = mountShell({
            tabs: [tab("page.html")],
            activePath: "page.html",
            diagnosis: "未知的打开方式「html.preview」。",
        });
        const bodyBefore = wrapper.get("[data-body]").element;

        expect(wrapper.get('[role="alert"]').text()).toContain("html.preview");
        expect(wrapper.get("[data-body]").element).toBe(bodyBefore);

        alertAction(wrapper, "editorWorkbench.retry").click();
        alertAction(wrapper, "editorWorkbench.openAsCode").click();
        await nextTick();
        expect(emitted("retry")).toHaveLength(1);
        expect(emitted("open-as-code")).toHaveLength(1);

        diagnosis.value = null;
        await nextTick();
        expect(wrapper.find('[role="alert"]').exists()).toBe(false);
        expect(wrapper.get("[data-body]").element).toBe(bodyBefore);
    });

    it("没有文档时画欢迎页：关闭最后一个标签后焦点交给欢迎区主动作，且不渲染多余顶栏", async () => {
        // 干净标签的关闭路径：宿主在同一事件里接受，标签随即消失（脏标签要等保存/放弃决策，另见 useEditorWorkbench 测试）。
        const {wrapper, emitted} = mountShell({tabs: [tab("only.md")], activePath: "only.md", menus: FILE_MENUS});
        expect(wrapper.find("[data-welcome]").exists()).toBe(false);

        wrapper.get<HTMLButtonElement>(".editor-tab-close").element.click();
        await flushPromises();
        await nextTick();

        expect(emitted("close-tab")).toEqual([["main", "only.md"]]);
        expect(wrapper.find('[role="tabpanel"]').exists()).toBe(false);
        const welcome = wrapper.get("[data-welcome]").element;
        expect(document.activeElement).toBe(welcome);
        // 对齐 VS Code：全部关掉后工作区全高通透，不渲染突兀的占位顶栏。
        expect(wrapper.find(".editor-workbench-header").exists()).toBe(false);
    });

    it("宿主延迟接受最后一个标签的关闭时，焦点仍旧交给欢迎区主动作", async () => {
        // 脏标签路径：宿主先等保存/放弃决策，稍后才真的清空标签。
        const {wrapper, emitted, settleClose} = mountShell({
            tabs: [tab("only.md")],
            activePath: "only.md",
            menus: FILE_MENUS,
            deferClose: true,
        });

        wrapper.get<HTMLButtonElement>(".editor-tab-close").element.click();
        await nextTick();
        expect(emitted("close-tab")).toEqual([["main", "only.md"]]);
        // 还没裁决：标签与正文都必须在位，空白页不能提前顶掉正文。
        expect(wrapper.find('[role="tabpanel"]').exists()).toBe(true);
        expect(wrapper.find("[data-welcome]").exists()).toBe(false);

        settleClose();
        await flushPromises();
        await nextTick();

        expect(wrapper.find('[role="tabpanel"]').exists()).toBe(false);
        const welcome = wrapper.get("[data-welcome]").element;
        expect(document.activeElement).toBe(welcome);
    });

    it("更多操作菜单叶项只转发为 select-menu，外壳不自行执行命令", async () => {
        const {wrapper, emitted} = mountShell({tabs: [tab("a.md")], activePath: "a.md", menus: FILE_MENUS});
        const trigger = wrapper.get<HTMLButtonElement>(".editor-toolbar-more-btn").element;
        trigger.click();
        await flushPromises();

        const menuItems = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
        const save = menuItems.find((el) => el.textContent?.includes("保存"));
        if (!save) {
            throw new Error("更多操作菜单里没有保存项");
        }
        save.click();
        await flushPromises();

        expect(emitted("select-menu")).toEqual([["main", {value: "save", label: "保存", shortcut: "Ctrl+S"}]]);
        // 外壳把命令原样交给宿主：没有替它关标签，也没有换活动标签。
        expect(emitted("close-tab")).toBeUndefined();
        expect(wrapper.get('[role="tab"][aria-selected="true"]').element.textContent?.trim()).toBe("a.md");
    });

    it("有活动文档时渲染面包屑导航栏", () => {
        const {wrapper} = mountShell({tabs: [tab("src/draft/note-01.md")], activePath: "src/draft/note-01.md"});
        const breadcrumbs = wrapper.findComponent({name: "EditorBreadcrumbs"});
        expect(breadcrumbs.exists()).toBe(true);
        expect(breadcrumbs.text()).toContain("draft");
        expect(breadcrumbs.text()).toContain("note-01.md");
    });


    it("分屏模式下两个组各自渲染标签栏与面包屑，选择标签带自己的组 id", async () => {
        const {tree, layout} = editorFixture("split");
        const wrapper = mount(EditorWorkbench, {
            props: {
                groups: [
                    {id: "main", tabs: [tab("doc1.md")], activePath: "doc1.md"},
                    {id: "side", tabs: [tab("doc2.md")], activePath: "doc2.md"},
                ],
                tree,
                layout,
                activeGroupId: "main",
            },
            attachTo: document.body,
            global: {stubs: {Splitter: SplitterStub}},
        });
        mounted.push(wrapper);

        const tabBars = wrapper.findAllComponents({name: "EditorTabBar"});
        expect(tabBars).toHaveLength(2);
        expect(tabBars[0]!.text()).toContain("doc1.md");
        expect(tabBars[1]!.text()).toContain("doc2.md");
        expect(wrapper.findAllComponents({name: "EditorBreadcrumbs"})).toHaveLength(2);

        // 同一个外壳事件协变：组 id 在前，宿主据此路由
        await tabBars[1]!.find('[role="tab"]').trigger("click");
        expect(wrapper.emitted("select-tab")).toEqual([["side", "doc2.md"]]);
    });


    it("二次分屏：三个组按树的顺序渲染，split-tab 带来源组 id", async () => {
        const {tree, layout} = editorFixture("triple");
        const wrapper = mount(EditorWorkbench, {
            props: {
                groups: [
                    {id: "main", tabs: [tab("doc1.md")], activePath: "doc1.md"},
                    {id: "side", tabs: [tab("doc2.md")], activePath: "doc2.md"},
                    {id: "bottom", tabs: [tab("doc3.md")], activePath: "doc3.md"},
                ],
                tree,
                layout,
                activeGroupId: "side",
            },
            attachTo: document.body,
            global: {stubs: {Splitter: SplitterStub}},
        });
        mounted.push(wrapper);

        const groups = wrapper.findAllComponents({name: "EditorGroup"});
        expect(groups.map((group) => group.props("group").id)).toEqual(["main", "side", "bottom"]);
        // 分屏入口按能力开关，宿主关闭时组内不出现分屏项。
        expect(groups.every((group) => group.props("allowSplit") === false)).toBe(true);

        groups[2]!.vm.$emit("split-tab", {sourceGroupId: "bottom", targetGroupId: "bottom", path: "doc3.md", direction: "bottom", mode: "copy"});
        await nextTick();
        expect(wrapper.emitted("split-tab")).toEqual([[{
            sourceGroupId: "bottom", targetGroupId: "bottom", path: "doc3.md", direction: "bottom", mode: "copy",
        }]]);
    });
});

describe("EditorWorkbench 的分栏手势口径", () => {
    it("一场手势一次落账：提交原样交给宿主接纳回调，结束事件只作观察", async () => {
        const {grid, tree, layout} = editorFixture("triple");
        /** 宿主侧接纳：整批变化一次落账，返回回收据就是渲染层用来决定回滚与否的那份。 */
        const accept = vi.fn((commit: GridGestureCommit) => applyEditorGesture(grid, commit));
        const wrapper = mount(EditorWorkbench, {
            props: {
                groups: [
                    {id: "main", tabs: [tab("doc1.md")], activePath: "doc1.md"},
                    {id: "side", tabs: [tab("doc2.md")], activePath: "doc2.md"},
                    {id: "bottom", tabs: [tab("doc3.md")], activePath: "doc3.md"},
                ],
                tree,
                layout,
                activeGroupId: "main",
                contextKey: "workspace:A",
                revision: 7,
                onGestureCommit: accept,
            },
            attachTo: document.body,
            global: {stubs: {Splitter: SplitterStub}},
        });
        mounted.push(wrapper);

        // 外部事实原样透传给渲染层：跨上下文的手势由渲染层作废，宿主不另存基线。
        const renderer = wrapper.findComponent(GridRenderer);
        expect(renderer.props("contextKey")).toBe("workspace:A");
        expect(renderer.props("revision")).toBe(7);
        const acceptViaShell = renderer.props("onGestureCommit") as unknown as (commit: GridGestureCommit) => {ok: true} | {ok: false; reason: string};
        expect(acceptViaShell).toBeTypeOf("function");

        const changes: GridBranchChange[] = [
            {branchId: "branch-side", axis: "width", baseline: {main: 399.5, "branch-bottom": 399.5}, target: {main: 300, "branch-bottom": 499}, extent: {width: 800, height: 600}, active: ["main"], compensated: [], collapsed: {}},
            {branchId: "branch-bottom", axis: "height", baseline: {side: 299.5, bottom: 299.5}, target: {side: 200, bottom: 399}, extent: {width: 399.5, height: 600}, active: ["side"], compensated: [], collapsed: {}},
        ];
        const commit: GridGestureCommit = {sessionId: "session-1", contextKey: "workspace:A", source: "pointer", revision: 7, extent: {width: 800, height: 600}, changes};

        // 预览与结束事件都原样上抛（观察用），但事件路径不落账：一次提交不会既发事件又调回调。
        renderer.vm.$emit("gesture-update", {layout, tree, changes, issues: []});
        renderer.vm.$emit("gesture-end", commit);
        await nextTick();
        expect(wrapper.emitted("gesture-update")?.length).toBe(1);
        expect(wrapper.emitted("gesture-end")).toEqual([[commit]]);
        expect(accept).not.toHaveBeenCalled();

        // 渲染层在会话结束时就地调用同一个回调：两根轴一起落账，只调用一次。
        expect(acceptViaShell(commit)).toEqual({ok: true});
        expect(accept).toHaveBeenCalledTimes(1);
        expect(accept.mock.calls[0]?.[0]).toBe(commit);
        const sizes = grid.layout({width: 800, height: 600}).sizes;
        expect(sizes.main?.width).toBeCloseTo(300);
        expect(sizes.side?.height).toBeCloseTo(200);
        expect(sizes.bottom?.height).toBeCloseTo(399);
    });
});



