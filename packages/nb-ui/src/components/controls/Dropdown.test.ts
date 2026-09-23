import {mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {h, nextTick} from "vue";
import Dropdown from "./Dropdown.vue";

/**
 * Dropdown 的行为面：菜单项执行、子菜单展开、radio/checkbox 受控勾选、
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

describe("Dropdown", () => {
    const wrappers: VueWrapper[] = [];

    function mountDropdown(props: Record<string, unknown>): VueWrapper {
        const wrapper = mount(Dropdown, {
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

    it("扁平项：分隔线渲染、禁用项不执行、选中项只发 value", async () => {
        const wrapper = mountDropdown({
            items: [
                {label: "保存", value: "save"},
                {label: "", value: "sep-1", separator: true},
                {label: "删除", value: "delete", disabled: true, tone: "danger"},
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
        const wrapper = mountDropdown({
            items: [
                {
                    label: "面板位置",
                    value: "position",
                    children: [
                        {label: "底部", value: "bottom", type: "radio", group: "position", checked: true},
                        {label: "顶部", value: "top", type: "radio", group: "position"},
                    ],
                },
                {label: "隐藏面板", value: "hide"},
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

    it("radio/checkbox 的勾选态只读宿主的 checked，组件不代为切换", async () => {
        const wrapper = mountDropdown({
            items: [
                {label: "居中", value: "center", type: "radio", group: "alignment", checked: true},
                {label: "左对齐", value: "left", type: "radio", group: "alignment"},
                {label: "跟随窗口", value: "follow", type: "checkbox", checked: false},
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
        const wrapper = mountDropdown({
            items: [
                {label: "孤例", value: "lonely", type: "radio", checked: true},
                {
                    label: "外层",
                    value: "outer",
                    children: [{label: "内层", value: "inner", children: [{label: "更深", value: "deeper"}]}],
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
        const wrapper = mountDropdown({
            items: [{label: "保存", value: "save"}],
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
            const wrapper = mountDropdown({
                items: [
                    {label: "保存", value: "save"},
                    {label: "另存为", value: "save-as"},
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
        const wrapper = mount(Dropdown, {
            attachTo: document.body,
            props: {
                items: [{label: "自定义项", value: "custom-1"}],
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
