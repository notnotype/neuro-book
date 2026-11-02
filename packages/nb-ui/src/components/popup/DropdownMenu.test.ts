import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {h, nextTick} from "vue";
import DropdownMenu from "./DropdownMenu.vue";

/**
 * DropdownMenu 的行为面：菜单项执行、子菜单展开、radio/checkbox 受控勾选、
 * 禁用不执行、受控展开与关闭后的焦点归还。断言全部落在真实 DOM 与原语行为上，
 * 不钉组件内部实现。
 */

async function flush(times = 8): Promise<void> {
    for (let index = 0; index < times; index += 1) {
        await nextTick();
    }
}

function menuItems(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemradio], [role=menuitemcheckbox]"));
}

describe("DropdownMenu", () => {
    const wrappers: VueWrapper[] = [];

    function mountDropdownMenu(props: Record<string, unknown>): VueWrapper {
        const wrapper = mount(DropdownMenu, {
            attachTo: document.body,
            props: {
                items: [],
                ...props,
            },
            slots: {
                default: "<button class=\"test-trigger\">打开菜单</button>",
            },
        });
        wrappers.push(wrapper);
        return wrapper;
    }

    /** 与用户从触发器按下 ArrowDown 的路径一致：触发器先拿到焦点，再展开菜单并把焦点交给第一项。 */
    async function open(wrapper: VueWrapper): Promise<void> {
        const trigger = wrapper.get(".test-trigger");
        (trigger.element as HTMLButtonElement).focus();
        await trigger.trigger("keydown", {key: "ArrowDown"});
        await flush();
    }

    afterEach(() => {
        for (const wrapper of wrappers.splice(0)) {
            wrapper.unmount();
        }
    });

    it("扁平项：分隔线渲染、禁用项不执行、选中项只发 id", async () => {
        const wrapper = mountDropdownMenu({
            items: [
                {label: "保存", id: "save"},
                {label: "", id: "sep-1", separator: true},
                {label: "删除", id: "delete", disabled: true, tone: "danger"},
            ],
        });
        await open(wrapper);

        expect(document.querySelectorAll("[role=separator]")).toHaveLength(1);
        const items = menuItems();
        expect(items.map((item) => item.textContent?.trim())).toEqual(["保存", "删除"]);

        items[1]!.click();
        await flush();
        expect(wrapper.emitted("select")).toBeUndefined();

        items[0]!.click();
        await flush();
        expect(wrapper.emitted("select")).toEqual([["save"]]);
    });

    it("子菜单：父项不执行，键盘展开后选中子项", async () => {
        const wrapper = mountDropdownMenu({
            items: [
                {
                    label: "面板位置",
                    id: "position",
                    children: [
                        {label: "底部", id: "bottom", type: "radio", group: "position", checked: true},
                        {label: "顶部", id: "top", type: "radio", group: "position"},
                    ],
                },
                {label: "隐藏面板", id: "hide"},
            ],
        });
        await open(wrapper);

        const parent = document.querySelector<HTMLElement>("[role=menuitem][aria-haspopup=menu]");
        expect(parent?.textContent?.trim()).toBe("面板位置");

        parent!.focus();
        parent!.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
        await flush();
        expect(parent!.getAttribute("aria-expanded")).toBe("true");
        expect(wrapper.emitted("select")).toBeUndefined();

        const radios = Array.from(document.querySelectorAll<HTMLElement>("[role=menuitemradio]"));
        expect(radios.map((radio) => radio.textContent?.trim())).toEqual(["底部", "顶部"]);
        expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false"]);

        radios[1]!.focus();
        radios[1]!.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
        radios[1]!.click();
        await flush();
        expect(wrapper.emitted("select")).toEqual([["top"]]);
    });

    it("子菜单的键盘：展开后焦点进第一项，上下移动，左方向键收起回到父项；在子项上按下指针菜单不关，选中后整个菜单收起", async () => {
        const wrapper = mountDropdownMenu({
            items: [
                {label: "视图", id: "group:view", children: [{label: "侧栏", id: "sidebar"}, {label: "面板", id: "panel"}]},
                {label: "帮助", id: "help"},
            ],
        });
        await open(wrapper);
        const parent = document.querySelector<HTMLElement>("[role=menuitem][aria-haspopup=menu]")!;
        parent.focus();
        parent.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
        await flush();
        const leaves = () => Array.from(document.querySelectorAll<HTMLElement>(".nb-menu-level [role=menuitem]"));
        expect(leaves().map((leaf) => leaf.textContent?.trim())).toEqual(["侧栏", "面板"]);
        expect(document.activeElement).toBe(leaves()[0]);
        leaves()[0]!.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}));
        expect(document.activeElement).toBe(leaves()[1]);
        leaves()[1]!.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true, cancelable: true}));
        await flush();
        expect(document.activeElement).toBe(parent);
        expect(leaves()).toHaveLength(0);

        // 再展开，按下指针（Reka 看来是菜单内容之外）后点击子项：菜单还在、选中生效，然后整个菜单收起
        parent.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true}));
        await flush();
        const target = leaves()[1]!;
        target.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, cancelable: true, pointerType: "mouse", button: 0}));
        await flush();
        expect(document.querySelector("[role=menu]")).not.toBeNull();
        target.click();
        await flush();
        expect(wrapper.emitted("select")).toEqual([["panel"]]);
        expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    });

    it("父项上按 Enter 或空格展开子菜单，焦点进它的第一项；子菜单里的父项按 Enter 同样", async () => {
        for (const key of ["Enter", " "]) {
            const wrapper = mountDropdownMenu({
                items: [
                    {label: "视图", id: "group:view", children: [
                        {label: "布局", id: "group:layout", children: [{label: "单栏", id: "single"}, {label: "双栏", id: "double"}]},
                        {label: "面板", id: "panel"},
                    ]},
                    {label: "帮助", id: "help"},
                ],
            });
            await open(wrapper);
            const parent = document.querySelector<HTMLElement>("[role=menuitem][aria-haspopup=menu]")!;
            parent.focus();
            parent.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
            await flush();
            expect(document.activeElement?.textContent?.trim(), `按 ${JSON.stringify(key)}`).toBe("布局");
            expect(wrapper.emitted("select")).toBeUndefined();
            // 子菜单按父项量好了位置（父项元素没取到时面板没有定位，停在文档流的位置上）。
            expect(document.querySelector<HTMLElement>(".nb-menu-level")?.style.top).toMatch(/px$/);

            // 手工级联里的父项是普通按钮：Enter 先发 keydown，再由浏览器补一次 click。
            const nested = document.activeElement as HTMLButtonElement;
            nested.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true}));
            nested.click();
            await flush();
            expect(document.activeElement?.textContent?.trim()).toBe("单栏");
            expect(wrapper.emitted("select")).toBeUndefined();
            wrapper.unmount();
            wrappers.length = 0;
        }
    });

    it("radio/checkbox 的勾选态只读宿主的 checked，组件不代为切换", async () => {
        const wrapper = mountDropdownMenu({
            items: [
                {label: "居中", id: "center", type: "radio", group: "alignment", checked: true},
                {label: "左对齐", id: "left", type: "radio", group: "alignment"},
                {label: "跟随窗口", id: "follow", type: "checkbox", checked: false},
            ],
        });
        await open(wrapper);

        const checkedRadio = document.querySelector<HTMLElement>("[role=menuitemradio][aria-checked=true]");
        expect(checkedRadio?.textContent?.trim()).toBe("居中");

        menuItems()[1]!.click();
        await flush();
        expect(wrapper.emitted("select")).toEqual([["left"]]);

        await open(wrapper);
        const stillChecked = document.querySelector<HTMLElement>("[role=menuitemradio][aria-checked=true]");
        expect(stillChecked?.textContent?.trim()).toBe("居中");

        const checkbox = document.querySelector<HTMLElement>("[role=menuitemcheckbox]");
        expect(checkbox?.getAttribute("aria-checked")).toBe("false");
        checkbox!.click();
        await flush();
        expect(wrapper.emitted("select")).toEqual([["left"], ["follow"]]);
        expect(checkbox!.getAttribute("aria-checked")).toBe("false");
    });

    it("任意层级的 children 都继续展开，不再降成普通项", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const wrapper = mountDropdownMenu({
            items: [
                {label: "孤例", id: "lonely", type: "radio", checked: true},
                {
                    label: "外层",
                    id: "outer",
                    children: [{label: "内层", id: "inner", children: [{label: "更深", id: "deeper"}]}],
                },
            ],
        });
        await open(wrapper);

        const radios = Array.from(document.querySelectorAll<HTMLElement>("[role=menuitemradio]"));
        expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true"]);

        vi.useFakeTimers();
        document.querySelector<HTMLElement>("[role=menuitem][aria-haspopup=menu]")!.dispatchEvent(new PointerEvent("pointerenter", {bubbles: true}));
        await vi.advanceTimersByTimeAsync(300);
        await flush();
        document.querySelectorAll<HTMLElement>("[role=menuitem][aria-haspopup=menu]")[1]!.dispatchEvent(new PointerEvent("pointerenter", {bubbles: true}));
        await vi.advanceTimersByTimeAsync(300);
        await flush();
        vi.useRealTimers();
        expect(Array.from(document.querySelectorAll<HTMLElement>("[role=menuitem]")).map((item) => item.textContent?.trim())).toContain("更深");

        expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
            expect.stringContaining("缺少 group"),
        ]);
        warn.mockRestore();
    });

    it("受控展开：宿主不改 open 就不会展开，update:open 照常上报", async () => {
        const wrapper = mountDropdownMenu({
            items: [{label: "保存", id: "save"}],
            open: false,
        });

        await wrapper.get(".test-trigger").trigger("click");
        await flush();
        expect(wrapper.emitted("update:open")).toEqual([[true]]);
        expect(document.querySelector("[role=menu]")).toBeNull();

        wrapper.setProps({open: true});
        await flush();
        expect(document.querySelector("[role=menu]")).not.toBeNull();
    });

    it("Escape 关闭后焦点还给触发器", async () => {
        vi.useFakeTimers();
        try {
            const wrapper = mountDropdownMenu({
                items: [
                    {label: "保存", id: "save"},
                    {label: "另存为", id: "save-as"},
                ],
            });
            await open(wrapper);
            const menu = document.querySelector<HTMLElement>("[role=menu]");
            expect(menu).not.toBeNull();
            expect(menu!.contains(document.activeElement)).toBe(true);

            document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
            await flush();
            vi.runAllTimers();
            await flush();

            expect(document.querySelector("[role=menu]")).toBeNull();
            expect(document.activeElement).toBe(wrapper.get(".test-trigger").element);
        } finally {
            vi.useRealTimers();
        }
    });

    it("支持通过 contentProps 透传属性与 #item 自定义槽位", async () => {
        const wrapper = mount(DropdownMenu, {
            attachTo: document.body,
            props: {
                items: [{label: "自定义项", id: "custom-1"}],
                contentProps: {"data-test-panel": "custom-panel"},
            },
            slots: {
                default: "<button class=\"test-trigger\">打开</button>",
                item: ({item}: {item: {label: string}}) => h("span", {class: "custom-slot-label"}, `${item.label} (Custom)`),
            },
        });
        const trigger = wrapper.get(".test-trigger");
        (trigger.element as HTMLButtonElement).focus();
        await trigger.trigger("keydown", {key: "ArrowDown"});
        await flush();

        const menu = document.querySelector<HTMLElement>("[data-test-panel='custom-panel']");
        expect(menu).not.toBeNull();
        expect(menu?.querySelector(".custom-slot-label")?.textContent).toBe("自定义项 (Custom)");
        wrapper.unmount();
    });
});
