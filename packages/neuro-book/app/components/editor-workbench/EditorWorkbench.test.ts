// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, nextTick, ref, type Ref} from "vue";
import type {MenubarMenuData} from "@notnotype/nb-ui/components";
import EditorWorkbench from "nbook/app/components/editor-workbench/EditorWorkbench.vue";
import type {EditorTabPresentation} from "nbook/app/components/editor-workbench/editor-view.types";

/**
 * 编辑器工作区外壳的组合边界：受控 props 决定画什么，用户操作只往宿主发意图；
 * 忙碌与打开方式诊断期间正文（default 槽）始终留在 DOM 里，错误给“重试 / 以源码打开”两个出口。
 *
 * 视图实例的创建与释放、保存与关闭决策由 useEditorWorkbench / EditorViewHost 的测试覆盖；
 * 这里用一个受控宿主替身复现“父层接受或拒绝”的反馈。
 */

const mounted: VueWrapper[] = [];

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
    const wrapper = mount(defineComponent({
        name: "EditorWorkbenchHost",
        setup() {
            return () => h(EditorWorkbench, {
                tabs: tabs.value,
                activePath: activePath.value,
                menus: options.menus ?? [],
                busy: busy.value,
                diagnosis: diagnosis.value,
                onCloseTab: (path: string) => {
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
        expect(wrapper.find('[role="menubar"]').exists()).toBe(true);
    });

    it("单根 section 承载外壳，外部 attrs 由它原样透传", () => {
        const wrapper = mount(EditorWorkbench, {
            props: {tabs: [], activePath: ""},
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

    it("没有文档时画欢迎页：关闭最后一个标签后焦点交给欢迎区主动作", async () => {
        // 干净标签的关闭路径：宿主在同一事件里接受，标签随即消失（脏标签要等保存/放弃决策，另见 useEditorWorkbench 测试）。
        const {wrapper, emitted} = mountShell({tabs: [tab("only.md")], activePath: "only.md", menus: FILE_MENUS});
        expect(wrapper.find("[data-welcome]").exists()).toBe(false);

        wrapper.get<HTMLButtonElement>(".editor-tab-close").element.click();
        await flushPromises();
        await nextTick();

        expect(emitted("close-tab")).toEqual([["only.md"]]);
        expect(wrapper.find('[role="tabpanel"]').exists()).toBe(false);
        const welcome = wrapper.get("[data-welcome]").element;
        expect(document.activeElement).toBe(welcome);
        // 全部关掉后菜单仍要可达，用户不能被困在空白里。
        expect(wrapper.find('[role="menubar"]').exists()).toBe(true);
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
        expect(emitted("close-tab")).toEqual([["only.md"]]);
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

    it("菜单叶项只转发为 select-menu，外壳不自行执行命令", async () => {
        const {wrapper, emitted} = mountShell({tabs: [tab("a.md")], activePath: "a.md", menus: FILE_MENUS});
        const trigger = wrapper.get<HTMLButtonElement>('[data-value="file"]').element;
        trigger.focus();
        trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
        await flushPromises();

        const save = document.querySelector<HTMLElement>('[role="menu"] [role="menuitem"]');
        if (!save) {
            throw new Error("文件菜单没有展开");
        }
        save.click();
        await flushPromises();

        expect(emitted("select-menu")).toEqual([[{value: "save", label: "保存", shortcut: "Ctrl+S"}]]);
        // 外壳把命令原样交给宿主：没有替它关标签，也没有换活动标签。
        expect(emitted("close-tab")).toBeUndefined();
        expect(wrapper.get('[role="tab"][aria-selected="true"]').element.textContent?.trim()).toBe("a.md");
    });
});
