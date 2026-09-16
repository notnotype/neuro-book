// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import {defineComponent, h, ref, type Ref} from "vue";
import DesktopTitleBarChrome from "nbook/app/components/common/DesktopTitleBarChrome.vue";
import {SHELL_TITLEBAR_HEIGHT} from "nbook/app/utils/workbench/layout";
import type {TitleBarHostCapabilities} from "nbook/app/utils/workbench-chrome";

/**
 * chrome 的组件边界：菜单按宿主能力裁剪、下拉层传送出标题栏、键盘与焦点归还、Project 的两条打开路径。
 *
 * 能力映射本身（哪些动作在什么能力下可用）在 `app/utils/workbench-chrome.test.ts` 用纯函数验证；
 * 这里只验证组件把它们画成了什么、点了之后发出什么。
 */

const mounted: VueWrapper[] = [];

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class {
        observe() {}
        disconnect() {}
    });
    // jsdom 里所有元素量出来都是 0，菜单会一直判成紧凑档；这里给量测一个「宽到放得下」的视口。
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(200);
});

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

type Mounted = {
    wrapper: VueWrapper;
    openMenu: Ref<string | null>;
    capabilities: Ref<TitleBarHostCapabilities>;
    invoked: string[];
    selected: (string | null)[];
};

function mountChrome(): Mounted {
    const openMenu = ref<string | null>(null);
    const capabilities = ref<TitleBarHostCapabilities>({desktop: false, surfaceActive: true, editTarget: "native"});
    const invoked: string[] = [];
    const selected: (string | null)[] = [];
    const wrapper = mount(defineComponent({
        setup() {
            return () => h(DesktopTitleBarChrome, {
                openMenu: openMenu.value,
                "onUpdate:openMenu": (value: string | null) => {
                    openMenu.value = value;
                },
                title: "命定之诗 — NeuroBook",
                projects: [{projectRoot: "novels/destiny-poem", title: "命定之诗"}],
                currentProjectRoot: "novels/destiny-poem",
                capabilities: capabilities.value,
                projectUrl: (projectRoot: string | null) => projectRoot === null ? "/" : `/?project=${projectRoot}`,
                agentPanelAvailable: true,
                agentPanelOpen: false,
                rendererMenus: true,
                customWindowControls: false,
                connection: null,
                "onInvokeCommand": (command: string) => {
                    invoked.push(command);
                },
                "onSelectProject": (projectRoot: string | null) => {
                    selected.push(projectRoot);
                },
                "onWindowCommand": () => undefined,
            });
        },
    }), {attachTo: document.body});
    mounted.push(wrapper);
    return {wrapper, openMenu, capabilities, invoked, selected};
}

function panel(name: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-titlebar-menu-panel="${name}"]`);
}

/** 当前聚焦的菜单项：焦点不在元素上时直接失败，别让断言在后面对 undefined 下手。 */
function activeMenuItem(): HTMLElement {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) throw new Error("当前焦点不在元素上");
    return active;
}

function itemLabels(scope: ParentNode): string[] {
    return [...scope.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => item.textContent?.trim() ?? "");
}

/** 先打开一组菜单：点击触发按钮，再等一帧让 Teleport 的内容挂上。 */
async function openGroup(wrapper: VueWrapper, label: string): Promise<HTMLElement> {
    await wrapper.get(`[data-menu-button="${label}"]`).trigger("click");
    await wrapper.vm.$nextTick();
    const group = panel("group");
    if (group === null) throw new Error(`菜单没有展开：${label}`);
    return group;
}

describe("DesktopTitleBarChrome", () => {
    it("没有桌面能力时：不画退出应用与桌面缩放，菜单项仍可用", async () => {
        const {wrapper} = mountChrome();

        expect(itemLabels(await openGroup(wrapper, "File"))).toEqual(["打开文件", "设置"]);
        expect(itemLabels(await openGroup(wrapper, "View"))).toEqual(["重新载入"]);
    });

    it("有桌面能力时同一组菜单补回桌面动作", async () => {
        const {wrapper, capabilities} = mountChrome();
        capabilities.value = {desktop: true, surfaceActive: true, editTarget: "native"};

        expect(itemLabels(await openGroup(wrapper, "File"))).toEqual(["打开文件", "设置", "退出应用"]);
        expect(itemLabels(await openGroup(wrapper, "View"))).toEqual(["重新载入", "放大", "缩小", "重置缩放"]);
    });

    it("浏览器里的粘贴画成禁用并说明改用 Ctrl+V，撤销照常可点", async () => {
        const {wrapper} = mountChrome();
        const edit = await openGroup(wrapper, "Edit");

        const items = [...edit.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
        const paste = items.find((item) => item.textContent?.trim() === "粘贴");
        const undo = items.find((item) => item.textContent?.trim() === "撤销");

        expect(paste?.disabled).toBe(true);
        expect(paste?.title).toContain("Ctrl+V");
        expect(undo?.disabled).toBe(false);
    });

    it("下拉层传送出标题栏（不被祖先裁剪），点外部收起", async () => {
        const {wrapper, openMenu} = mountChrome();
        const group = await openGroup(wrapper, "File");

        expect(group.parentElement).toBe(document.body);
        expect(wrapper.find('[data-titlebar-menu-panel="group"]').exists()).toBe(false);

        document.body.dispatchEvent(new MouseEvent("pointerdown", {bubbles: true}));
        await wrapper.vm.$nextTick();

        expect(openMenu.value).toBeNull();
        expect(panel("group")).toBeNull();
    });

    it("键盘：ArrowDown 进首项、循环跳过禁用项、Escape 关菜单并把焦点还给触发按钮", async () => {
        const {wrapper} = mountChrome();

        const trigger = wrapper.get('[data-menu-button="Edit"]');
        await trigger.trigger("keydown", {key: "ArrowDown"});
        await wrapper.vm.$nextTick();

        expect(document.activeElement?.textContent?.trim()).toBe("撤销");

        // 走到「复制」（撤销 → 重做 → 剪切 → 复制）。
        for (let step = 0; step < 3; step += 1) {
            activeMenuItem().dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
            await wrapper.vm.$nextTick();
        }
        expect(document.activeElement?.textContent?.trim()).toBe("复制");

        // 粘贴在浏览器里禁用：再往下一项必须是「全选」，不能停在禁用项上。
        activeMenuItem().dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
        await wrapper.vm.$nextTick();
        expect(document.activeElement?.textContent?.trim()).toBe("全选");

        activeMenuItem().dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await wrapper.vm.$nextTick();

        expect(panel("group")).toBeNull();
        expect(document.activeElement).toBe(trigger.element);
    });

    it("键盘：ArrowRight 换组时浮层跟着换锚点与内容", async () => {
        const {wrapper} = mountChrome();

        await wrapper.get('[data-menu-button="File"]').trigger("keydown", {key: "ArrowDown"});
        await wrapper.vm.$nextTick();

        const firstItem = activeMenuItem();
        firstItem.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
        await wrapper.vm.$nextTick();

        expect(itemLabels(panel("group")!)).toEqual(["撤销", "重做", "剪切", "复制", "粘贴", "全选"]);
        expect(document.activeElement?.textContent?.trim()).toBe("撤销");
    });

    it("宿主直接给 openMenu（受控用法）时，下拉层照样贴在触发按钮下方", async () => {
        const {wrapper} = mountChrome();
        // jsdom 里量不到真实矩形，但定位口径是可断言的：fixed + 触发按钮下沿 + 视口左边距。
        await wrapper.setProps({openMenu: "View"});
        await wrapper.vm.$nextTick();

        const view = panel("group");
        expect(view).not.toBeNull();
        const style = view!.getAttribute("style") ?? "";
        expect(style).toContain("position: fixed");
        expect(style).toContain("top: 6px");
        expect(style).toContain("left: 8px");
        expect(itemLabels(view!)).toEqual(["重新载入"]);

        // Project 菜单也挂同一个钩子：受控展开时同样贴着触发按钮。
        await wrapper.setProps({openMenu: "project"});
        await wrapper.vm.$nextTick();
        const project = panel("project");
        expect(project).not.toBeNull();
        expect(project!.getAttribute("style")).toContain("position: fixed");
        expect(project!.getAttribute("style")).toContain("top: 6px");
    });

    it("Escape 在焦点不在面板里时也关菜单，并把焦点还给触发按钮", async () => {
        const {wrapper} = mountChrome();
        const trigger = wrapper.get('[data-menu-button="File"]');
        await trigger.trigger("click");
        await wrapper.vm.$nextTick();
        expect(panel("group")).not.toBeNull();

        // 鼠标点开不抢焦点：焦点这时不在面板里，Escape 仍必须能关掉菜单。
        document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await wrapper.vm.$nextTick();

        expect(panel("group")).toBeNull();
        expect(document.activeElement).toBe(trigger.element);
    });

    it("Project 列表：本标签打开只发意图，新标签打开是标准 Project URL 的链接", async () => {
        const {wrapper, invoked, selected} = mountChrome();

        await wrapper.get('[data-titlebar-action="project-switcher"]').trigger("click");
        await wrapper.vm.$nextTick();
        const project = panel("project");
        if (project === null) throw new Error("Project 菜单没有展开");

        const current = project.querySelector<HTMLButtonElement>('[data-project-root="novels/destiny-poem"]');
        const rows = [...project.querySelectorAll<HTMLElement>(".desktop-title-bar__project-row")];
        expect(rows.map((row) => row.querySelector('[role="menuitem"]')?.textContent?.trim()))
            .toEqual(["我的书架", "命定之诗"]);

        current!.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail: 1}));
        await wrapper.vm.$nextTick();
        expect(selected).toEqual(["novels/destiny-poem"]);
        expect(invoked).toEqual([]);

        await wrapper.get('[data-titlebar-action="project-switcher"]').trigger("click");
        await wrapper.vm.$nextTick();
        const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-titlebar-action="open-project-new-tab"]')];
        expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/?project=novels/destiny-poem"]);
        expect(links.map((link) => link.target)).toEqual(["_blank", "_blank"]);
        expect(links.map((link) => link.getAttribute("aria-label")))
            .toEqual(["在新标签打开：我的书架", "在新标签打开：命定之诗"]);
        expect(links.every((link) => link.rel.includes("noopener"))).toBe(true);

        // 点链接只收起菜单，不改当前标签的 Project（新标签自己跑 open / presence）。
        links[1]!.addEventListener("click", (event) => event.preventDefault(), {once: true});
        links[1]!.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, detail: 0}));
        await wrapper.vm.$nextTick();

        expect(selected).toEqual(["novels/destiny-poem"]);
        expect(panel("project")).toBeNull();
    });

    it("标题栏高度来自产品几何常量（CSS 变量是唯一入口）", async () => {
        const {wrapper, capabilities} = mountChrome();

        expect(wrapper.get(".desktop-title-bar").attributes("style")).toContain(`--workbench-titlebar-height: ${String(SHELL_TITLEBAR_HEIGHT)}px`);

        capabilities.value = {desktop: true, surfaceActive: false, editTarget: "none"};
        await wrapper.vm.$nextTick();
        expect(wrapper.get('[data-titlebar-action="toggle-agent-panel"]').attributes("disabled")).toBeDefined();
    });
});
