// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, ref, type Ref} from "vue";
import DesktopTitleBar from "nbook/app/components/common/DesktopTitleBar.vue";
import {useTitleBarEditTarget} from "nbook/app/composables/useTitleBarEditTarget";
import {
    provideWorkbenchChrome,
    type WorkbenchChromeRegistration,
} from "nbook/app/composables/useWorkbenchChrome";
import type {DesktopMenuCommandId} from "@notnotype/neuro-book-contracts/desktop";

/**
 * 宿主的组件边界：**没有桌面 bridge 也画出标题栏**，应用动作走页面登记的回调，
 * 菜单能力与两条 Project 打开路径取自登记（URL 由页面路由给出）。
 *
 * 编辑目标按页面同样的接线驱动（`useTitleBarEditTarget` + 可注入的焦点来源），
 * 这样「键盘进标题栏后编辑动作仍可用」这条发生在真实页面里的行为在组件层可验证。
 *
 * 桌面 bridge 分支（`import.meta.client` 为真、`window.neuroBookDesktop` 在场）在 vitest 里不可达，
 * 由产品真实验收覆盖；这里只验证浏览器这条新增路径与登记契约。
 */

const mounted: VueWrapper[] = [];

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
        observe() {}
        disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(200);
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

type Harness = {
    wrapper: VueWrapper;
    invoked: DesktopMenuCommandId[];
    switched: (string | null)[];
    opened: string[];
    activeElement: Ref<Element | null>;
    surfaceActive: {value: boolean};
};

/** 焦点元素：不在元素上时直接失败，别让断言在后面对 undefined 下手。 */
function focusedElement(): HTMLElement {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) throw new Error("当前焦点不在元素上");
    return active;
}

function mountHost(): Harness {
    const invoked: DesktopMenuCommandId[] = [];
    const switched: (string | null)[] = [];
    const opened: string[] = [];
    const surfaceActive = ref(true);
    const activeElement = ref<Element | null>(null);
    const editSession = useTitleBarEditTarget({editorActive: () => false, activeElement});
    const registration: WorkbenchChromeRegistration = {
        title: () => "命定之诗 — NeuroBook",
        appearance: () => "light",
        surfaceActive: () => surfaceActive.value,
        currentProjectRoot: () => "novels/destiny-poem",
        projects: () => [
            {projectRoot: "novels/destiny-poem", title: "命定之诗"},
            {projectRoot: "novels/rain-and-tea", title: "雨与茶"},
        ],
        agentPanelOpen: () => false,
        openBookshelf: () => {
            opened.push("bookshelf");
        },
        switchProject: (projectRoot) => {
            switched.push(projectRoot);
        },
        toggleAgentPanel: () => undefined,
        invokeMenuCommand: (command: DesktopMenuCommandId) => {
            invoked.push(command);
        },
        editTarget: () => editSession.target.value,
        projectUrl: (projectRoot) => projectRoot === null ? "/" : `/?project=${projectRoot}`,
    };

    const wrapper = mount(defineComponent({
        setup() {
            provideWorkbenchChrome().register(registration);
            return () => h(DesktopTitleBar);
        },
    }), {attachTo: document.body});
    mounted.push(wrapper);
    return {wrapper, invoked, switched, opened, activeElement, surfaceActive};
}

function menuItem(label: string): HTMLButtonElement {
    const item = [...document.querySelectorAll<HTMLButtonElement>('[data-titlebar-menu-panel="group"] [role="menuitem"]')]
        .find((candidate) => candidate.textContent?.trim() === label);
    if (item === undefined) throw new Error(`菜单项不存在：${label}`);
    return item;
}

async function openMenu(wrapper: VueWrapper, label: string): Promise<void> {
    await wrapper.get(`[data-menu-button="${label}"]`).trigger("click");
    await wrapper.vm.$nextTick();
}

describe("DesktopTitleBar", () => {
    it("没有桌面 bridge 也画标题栏，并按页面的真实焦点决定编辑动作", async () => {
        const {wrapper, invoked, activeElement} = mountHost();

        expect(wrapper.find(".desktop-title-bar").exists()).toBe(true);

        await openMenu(wrapper, "File");
        expect([...document.querySelectorAll<HTMLElement>('[data-titlebar-menu-panel="group"] [role="menuitem"]')]
            .map((item) => item.textContent?.trim())).toEqual(["打开文件", "设置"]);

        menuItem("设置").dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail: 1}));
        await wrapper.vm.$nextTick();
        expect(invoked).toEqual(["file.settings"]);

        // 焦点在页面的非可编辑处：编辑动作画成禁用（菜单与执行共用同一份判定）。
        activeElement.value = document.body;
        await wrapper.vm.$nextTick();
        await openMenu(wrapper, "Edit");
        expect(menuItem("撤销").disabled).toBe(true);
        expect(menuItem("全选").disabled).toBe(true);
    });

    it("Project 列表两条路径各走各的：本标签切 Project，新标签只给链接", async () => {
        const {wrapper, switched, opened} = mountHost();

        await wrapper.get('[data-titlebar-action="project-switcher"]').trigger("click");
        await wrapper.vm.$nextTick();

        // 当前 Project 不重复打开。
        document.querySelector<HTMLButtonElement>('[data-project-root="novels/destiny-poem"]')!
            .dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail: 1}));
        await wrapper.vm.$nextTick();
        expect(switched).toEqual([]);

        await wrapper.get('[data-titlebar-action="project-switcher"]').trigger("click");
        await wrapper.vm.$nextTick();
        document.querySelector<HTMLButtonElement>('[data-project-root="novels/rain-and-tea"]')!
            .dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail: 1}));
        await wrapper.vm.$nextTick();
        expect(switched).toEqual(["novels/rain-and-tea"]);

        await wrapper.get('[data-titlebar-action="project-switcher"]').trigger("click");
        await wrapper.vm.$nextTick();
        const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-titlebar-action="open-project-new-tab"]')];
        expect(links.map((link) => link.getAttribute("href")))
            .toEqual(["/", "/?project=novels/destiny-poem", "/?project=novels/rain-and-tea"]);
        expect(links.map((link) => link.target)).toEqual(["_blank", "_blank", "_blank"]);

        // 书架链接同样只给 URL，不触发页面切换。
        expect(opened).toEqual([]);
    });

    it("键盘进标题栏后 Edit 六条仍可用，且激活后发的是同一条编辑命令", async () => {
        const {wrapper, invoked, activeElement} = mountHost();

        // 页面里的真实过程：焦点先在输入框（编辑可用），随后 Tab 进标题栏（焦点离开输入框）。
        const input = document.createElement("input");
        document.body.append(input);
        activeElement.value = input;
        input.focus();
        await wrapper.vm.$nextTick();

        const trigger = wrapper.get('[data-menu-button="Edit"]');
        if (!(trigger.element instanceof HTMLElement)) throw new Error("触发按钮不是元素");
        trigger.element.focus();
        activeElement.value = trigger.element;
        await wrapper.vm.$nextTick();

        await trigger.trigger("keydown", {key: "ArrowDown"});
        await wrapper.vm.$nextTick();

        expect([...document.querySelectorAll<HTMLButtonElement>('[data-titlebar-menu-panel="group"] [role="menuitem"]')]
            .map((item) => [item.textContent?.trim(), item.disabled])).toEqual([
            ["撤销", false],
            ["重做", false],
            ["剪切", false],
            ["复制", false],
            ["粘贴", true],
            ["全选", false],
        ]);
        expect(focusedElement().textContent?.trim()).toBe("撤销");

        focusedElement().dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail: 0}));
        await wrapper.vm.$nextTick();
        expect(invoked).toEqual(["edit.undo"]);
    });

    it("Agent 按钮跟着工作面的真实状态，不假装可用", async () => {
        const {wrapper, surfaceActive} = mountHost();

        const button = wrapper.get('[data-titlebar-action="toggle-agent-panel"]');
        expect(button.attributes("disabled")).toBeUndefined();

        surfaceActive.value = false;
        await wrapper.vm.$nextTick();
        expect(wrapper.get('[data-titlebar-action="toggle-agent-panel"]').attributes("disabled")).toBeDefined();
    });
});
