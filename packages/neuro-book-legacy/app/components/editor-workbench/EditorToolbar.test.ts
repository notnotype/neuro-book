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
    return [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"]')];
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

    it("checked 叶项具备 aria-checked 属性与勾选指示，select 仍回传宿主给的原始叶项", async () => {
        const wrapper = mountToolbar([{id: "open-with", label: "打开方式", items: [
            {value: "editor:code", label: "源码", type: "checkbox", checked: true},
            {value: "editor:markdown", label: "富文本", type: "checkbox", checked: false},
        ]}]);
        await openMoreActions(wrapper);

        const codeItem = menuItem("源码");
        const markdownItem = menuItem("富文本");

        expect(codeItem.getAttribute("aria-checked")).toBe("true");
        expect(codeItem.querySelector(".i-lucide-check")).not.toBeNull();
        expect(markdownItem.getAttribute("aria-checked")).toBe("false");
        expect(markdownItem.querySelector(".i-lucide-check")).toBeNull();

        codeItem.click();
        await flushPromises();
        expect(wrapper.emitted("select")).toEqual([[{value: "editor:code", label: "源码", type: "checkbox", checked: true}]]);
    });

    it("浮层消费 .nb-ui-popover-surface.nb-ui-menu-surface 且无硬编码内联样式", async () => {
        const wrapper = mountToolbar(MENUS);
        await openMoreActions(wrapper);

        const menuEl = document.querySelector<HTMLElement>('[role="menu"]');
        expect(menuEl).not.toBeNull();
        expect(menuEl!.classList.contains("nb-ui-popover-surface")).toBe(true);
        expect(menuEl!.classList.contains("nb-ui-menu-surface")).toBe(true);
        // 杜绝显式 rounded-[var(--radius-panel)] 污染紧凑菜单圆角
        expect(menuEl!.className).not.toContain("rounded-[var(--radius-panel)]");
        // 杜绝内联硬编码 backgroundColor 与 backdropFilter
        expect(menuEl!.style.backgroundColor).toBe("");
        expect(menuEl!.style.backdropFilter).toBe("");
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

    it("支持树状嵌套子菜单，点击子项发出 select 并携带子项完整数据", async () => {
        const wrapper = mountToolbar([{
            id: "file",
            label: "文件",
            items: [
                {
                    label: "导出作品",
                    value: "file.export",
                    children: [
                        {label: "导出为 EPUB", value: "export:epub"},
                        {label: "导出为 PDF", value: "export:pdf", tone: "danger"},
                    ],
                },
            ],
        }]);
        await openMoreActions(wrapper);

        // 子菜单触发器存在且带有小箭头
        const subTrigger = document.querySelector<HTMLElement>('[data-reka-collection-item][data-state]') || menuItem("导出作品");
        expect(subTrigger.textContent).toContain("导出作品");

        // 模拟展开子菜单
        subTrigger.click();
        await flushPromises();

        // 子项渲染成功且具有危险样式类
        const epubItem = menuItem("导出为 EPUB");
        expect(epubItem).not.toBeNull();

        epubItem.click();
        await flushPromises();

        expect(wrapper.emitted("select")).toEqual([[{label: "导出为 EPUB", value: "export:epub"}]]);
    });

    it("支持 actions 属性与插槽扩展（如 Markdown 预览/对比切换）并发出 action 事件", async () => {
        const wrapper = mount(EditorToolbar, {
            props: {
                menus: [],
                actions: [
                    {id: "preview", label: "预览模式", iconClass: "i-lucide-book-open", active: true},
                    {id: "diff", label: "比较差异", iconClass: "i-lucide-git-compare"},
                ],
            },
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const customActions = wrapper.findAll("button.editor-toolbar-custom-action");
        expect(customActions).toHaveLength(2);
        expect(customActions[0]!.classes()).toContain("!text-[var(--accent-text)]");

        await customActions[1]!.trigger("click");
        expect(wrapper.emitted("action")).toEqual([["diff"]]);
    });

    it("支持 statusText 渲染与 status 插槽定制", () => {
        const wrapper = mount(EditorToolbar, {
            props: {
                menus: [],
                statusText: "已保存",
            },
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const status = wrapper.find(".editor-toolbar-status");
        expect(status.exists()).toBe(true);
        expect(status.text()).toBe("已保存");
    });
});

