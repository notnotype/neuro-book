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

/** 菜单标题按钮：reka-ui 把菜单 id 放在 data-value 上。 */
function triggerFor(wrapper: VueWrapper, menuId: string): HTMLButtonElement {
    return wrapper.get<HTMLButtonElement>(`[data-value="${menuId}"]`).element;
}

/** 用键盘展开某个菜单：焦点在菜单标题上按 ArrowDown，这是文档写明的操作路径。 */
async function openMenu(wrapper: VueWrapper, menuId: string): Promise<HTMLButtonElement> {
    const trigger = triggerFor(wrapper, menuId);
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
    await flushPromises();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    return trigger;
}

/** 当前展开菜单里的菜单项（Menubar 的浮层传送出组件，按语义角色查 DOM）。 */
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

describe("EditorToolbar 菜单操作", () => {
    const MENUS: MenubarMenuData[] = [
        {id: "file", label: "文件", items: [
            {value: "save", label: "保存", shortcut: "Ctrl+S"},
            {value: "close", label: "关闭"},
        ]},
        {id: "view-actions", label: "当前视图操作", items: [
            {value: "action:markdown.comments", label: "批注"},
        ]},
    ];

    it("根是导航地标，菜单标题按 menubar 语义暴露收起状态", () => {
        const wrapper = mountToolbar(MENUS);

        expect(wrapper.element.tagName).toBe("NAV");
        expect(wrapper.find('[role="menubar"]').exists()).toBe(true);
        const trigger = triggerFor(wrapper, "file");
        expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });

    it("键盘展开菜单后选择叶项：select 携带完整叶项，菜单随即关闭", async () => {
        const wrapper = mountToolbar(MENUS);
        await openMenu(wrapper, "file");
        // 菜单项把快捷键提示一起画出来（数据来自 menus，不是写死的文案）。
        expect(menuItem("保存").textContent).toContain("Ctrl+S");

        const saveItem = menuItem("保存");
        saveItem.focus();
        expect(document.activeElement).toBe(saveItem);
        saveItem.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await flushPromises();

        expect(wrapper.emitted("select")).toEqual([[{value: "save", label: "保存", shortcut: "Ctrl+S"}]]);
        expect(triggerFor(wrapper, "file").getAttribute("aria-expanded")).toBe("false");
        expect(document.querySelector('[role="menu"]')).toBeNull();
    });

    it("checked 叶项显示可读的已选后缀，select 仍回传宿主给的原始叶项", async () => {
        const wrapper = mountToolbar([{id: "open-with", label: "打开方式", items: [
            {value: "editor:code", label: "源码", type: "checkbox", checked: true},
            {value: "editor:markdown", label: "富文本", type: "checkbox", checked: false},
        ]}]);
        await openMenu(wrapper, "open-with");

        // 已选项的标签带上可读的已选后缀，未选项没有。
        expect(menuItem("源码").textContent).toContain("editorWorkbench.selected");
        expect(menuItem("富文本").textContent).not.toContain("editorWorkbench.selected");

        menuItem("源码").click();
        await flushPromises();
        // 后缀只是展示层：回传的仍是宿主给的原始叶项，label 与 checked 都没被改写。
        expect(wrapper.emitted("select")).toEqual([[{value: "editor:code", label: "源码", type: "checkbox", checked: true}]]);
    });

    it("叶项的值不会被当成打开的菜单 id：值与菜单同名时另一个菜单仍保持收起", async () => {
        const wrapper = mountToolbar([
            {id: "file", label: "文件", items: [{value: "view-actions", label: "另存为"}]},
            {id: "view-actions", label: "当前视图操作", items: [{value: "action:markdown.comments", label: "批注"}]},
        ]);
        await openMenu(wrapper, "file");

        menuItem("另存为").click();
        await flushPromises();

        expect(wrapper.emitted("select")).toEqual([[{value: "view-actions", label: "另存为"}]]);
        // 「view-actions」这次是叶值，不是要展开的菜单。
        expect(triggerFor(wrapper, "view-actions").getAttribute("aria-expanded")).toBe("false");
        expect(document.querySelector('[role="menu"]')).toBeNull();

        // 状态没有被叶值顶替：该菜单仍能由用户自己打开并展示自己的叶项。
        await openMenu(wrapper, "view-actions");
        expect(menuItems().map((item) => item.textContent?.trim())).toEqual(["批注"]);
    });

    it("禁用叶项不可选择，可用叶项照常发出 select", async () => {
        const wrapper = mountToolbar([{id: "file", label: "文件", items: [
            {value: "save", label: "保存", disabled: true},
            {value: "close", label: "关闭"},
        ]}]);
        await openMenu(wrapper, "file");

        const disabled = menuItem("保存");
        expect(disabled.getAttribute("aria-disabled")).toBe("true");
        disabled.click();
        await flushPromises();
        expect(wrapper.emitted("select")).toBeUndefined();

        menuItem("关闭").click();
        await flushPromises();
        expect(wrapper.emitted("select")).toEqual([[{value: "close", label: "关闭"}]]);
    });

    it("Escape 关闭菜单并把焦点交回菜单标题", async () => {
        const wrapper = mountToolbar(MENUS);
        const trigger = await openMenu(wrapper, "file");
        expect(document.querySelector('[role="menu"]')).not.toBeNull();

        const focused = document.activeElement;
        const target = focused instanceof HTMLElement ? focused : document.body;
        target.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await flushPromises();

        expect(document.querySelector('[role="menu"]')).toBeNull();
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(trigger);
    });
});
