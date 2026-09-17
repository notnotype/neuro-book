// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import type {MenubarMenuData} from "@notnotype/nb-ui/components";
import EditorToolbar from "nbook/app/components/editor-workbench/EditorToolbar.vue";

/**
 * 顶部菜单工具栏的交互边界：跑的是真实 nb-ui Menubar（reka-ui）而不是替身，
 * 覆盖键盘展开/选择/关闭、“叶项 value 与菜单 id”两个命名空间互不串味，
 * 以及勾选态的展示后缀不污染回传宿主的原始叶项。
 *
 * 宿主如何把菜单意图接到保存/切换上由 useEditorWorkbench 的测试覆盖；
 * 这里只验证用户在菜单里的操作产生什么载荷、菜单状态如何变化。
 */

const mounted: VueWrapper[] = [];

beforeEach(() => {
    // 组件按 Nuxt 自动导入使用 useI18n；vitest 不跑自动导入，这里补上同名全局。
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

function mountToolbar(menus: MenubarMenuData[]): VueWrapper {
    const wrapper = mount(EditorToolbar, {props: {menus}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

/** 更多操作按钮 */
function moreActionsTrigger(wrapper: VueWrapper): HTMLButtonElement {
    return wrapper.get<HTMLButtonElement>("button.editor-toolbar-more-btn").element;
}

/** 展开更多操作下拉菜单 */
async function openMoreActions(wrapper: VueWrapper): Promise<HTMLButtonElement> {
    const trigger = moreActionsTrigger(wrapper);
    trigger.click();
    await flushPromises();
    return trigger;
}

/** 当前展开菜单里的菜单项（Dropdown 的浮层传送出组件，按语义角色查 DOM）。 */
function menuItems(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
}

function menuItem(label: string): HTMLElement {
    const item = menuItems().find((candidate) => candidate.textContent?.includes(label) === true);
    if (!item) {
        throw new Error(`菜单里没有「${label}」：${menuItems().map((candidate) => candidate.textContent).join(" / ")}`);
    }
    return item;
}

describe("EditorToolbar 更多操作工具栏 (VS Code 风格)", () => {
    const MENUS: MenubarMenuData[] = [
        {id: "file", label: "文件", items: [
            {value: "save", label: "保存", shortcut: "Ctrl+S"},
            {value: "close", label: "关闭"},
        ]},
        {id: "view-actions", label: "当前视图操作", items: [
            {value: "action:markdown.comments", label: "批注"},
        ]},
    ];

    it("根是导航地标，更多操作按钮具备无障碍标签与紧凑图标", () => {
        const wrapper = mountToolbar(MENUS);

        expect(wrapper.element.tagName).toBe("NAV");
        const trigger = moreActionsTrigger(wrapper);
        expect(trigger).not.toBeNull();
        expect(trigger.getAttribute("aria-label")).toBe("editorWorkbench.moreActions");
        expect(trigger.querySelector(".i-lucide-more-horizontal")).not.toBeNull();
    });

    it("展开下拉菜单后选择叶项：select 携带完整叶项并展示快捷键", async () => {
        const wrapper = mountToolbar(MENUS);
        await openMoreActions(wrapper);

        // 快捷键提示来自数据
        expect(menuItem("保存").textContent).toContain("Ctrl+S");

        const saveItem = menuItem("保存");
        saveItem.click();
        await flushPromises();

        expect(wrapper.emitted("select")).toEqual([[{value: "save", label: "保存", shortcut: "Ctrl+S"}]]);
    });

    it("checked 叶项显示已选后缀，select 仍回传宿主给的原始叶项", async () => {
        const wrapper = mountToolbar([{id: "open-with", label: "打开方式", items: [
            {value: "editor:code", label: "源码", type: "checkbox", checked: true},
            {value: "editor:markdown", label: "富文本", type: "checkbox", checked: false},
        ]}]);
        await openMoreActions(wrapper);

        expect(menuItem("源码").textContent).toContain("editorWorkbench.selected");
        expect(menuItem("富文本").textContent).not.toContain("editorWorkbench.selected");

        menuItem("源码").click();
        await flushPromises();
        expect(wrapper.emitted("select")).toEqual([[{value: "editor:code", label: "源码", type: "checkbox", checked: true}]]);
    });

    it("禁用叶项不可选择，可用叶项照常发出 select", async () => {
        const wrapper = mountToolbar([{id: "file", label: "文件", items: [
            {value: "save", label: "保存", disabled: true},
            {value: "close", label: "关闭"},
        ]}]);
        await openMoreActions(wrapper);

        const disabled = menuItem("保存");
        expect(disabled.getAttribute("data-disabled")).not.toBeNull();
        disabled.click();
        await flushPromises();
        expect(wrapper.emitted("select")).toBeUndefined();

        menuItem("关闭").click();
        await flushPromises();
        expect(wrapper.emitted("select")).toEqual([[{value: "close", label: "关闭"}]]);
    });

    it("菜单为空时不渲染多余操作按钮", () => {
        const wrapper = mountToolbar([]);
        expect(wrapper.find("button.editor-toolbar-more-btn").exists()).toBe(false);
    });
});
