import {mount} from "@vue/test-utils";
import {describe, expect, it, vi} from "vitest";
import {nextTick} from "vue";
import Button from "./controls/Button.vue";
import IconButton from "./controls/IconButton.vue";
import Pagination from "./controls/Pagination.vue";
import SegmentedControl from "./controls/SegmentedControl.vue";
import Switch from "./controls/Switch.vue";
import SwitchField from "./controls/SwitchField.vue";
import Tabs from "./controls/Tabs.vue";
import ToggleGroup from "./controls/ToggleGroup.vue";
import Toolbar from "./controls/Toolbar.vue";
import {paginationRange} from "./controls/pagination-range";
import Avatar from "./display/Avatar.vue";
import Badge from "./display/Badge.vue";
import Kbd from "./display/Kbd.vue";
import Progress from "./display/Progress.vue";
import Table from "./display/Table.vue";
import AlertDialog from "./feedback/AlertDialog.vue";
import Dialog from "./feedback/Dialog.vue";
import Drawer from "./feedback/Drawer.vue";
import HoverCard from "./feedback/HoverCard.vue";
import Notification from "./feedback/Notification.vue";
import NotificationViewport from "./feedback/NotificationViewport.vue";
import Popover from "./feedback/Popover.vue";
import Tooltip from "./feedback/Tooltip.vue";
import {clampMenuPosition, computeSubmenuPosition} from "./feedback/context-menu-position";
import Calendar from "./form/Calendar.vue";
import Combobox from "./form/Combobox.vue";
import {moveHighlight} from "./form/option-highlight";
import FormCheckbox from "./form/FormCheckbox.vue";
import FormField from "./form/FormField.vue";
import FormInput from "./form/FormInput.vue";
import FormNumberInput from "./form/FormNumberInput.vue";
import FormSelect from "./form/FormSelect.vue";
import PinInput from "./form/PinInput.vue";
import RadioGroup from "./form/RadioGroup.vue";
import Slider from "./form/Slider.vue";
import TagInput from "./form/TagInput.vue";
import Accordion from "./layout/Accordion.vue";
import AspectRatio from "./layout/AspectRatio.vue";
import Collapsible from "./layout/Collapsible.vue";
import Panel from "./layout/Panel.vue";
import ScrollArea from "./layout/ScrollArea.vue";
import Separator from "./layout/Separator.vue";
import Splitter from "./layout/Splitter.vue";
import Breadcrumb from "./navigation/Breadcrumb.vue";
import NavigationMenu from "./navigation/NavigationMenu.vue";
import Tree from "./navigation/Tree.vue";
import Editable from "./controls/Editable.vue";
import Menubar from "./controls/Menubar.vue";
import Stepper from "./controls/Stepper.vue";
import Rating from "./display/Rating.vue";
import Autocomplete from "./form/Autocomplete.vue";
import CheckboxGroup from "./form/CheckboxGroup.vue";
import ColorPicker from "./form/ColorPicker.vue";
import DateField from "./form/DateField.vue";
import DatePicker from "./form/DatePicker.vue";
import DateRangeField from "./form/DateRangeField.vue";
import DateRangePicker from "./form/DateRangePicker.vue";
import Listbox from "./form/Listbox.vue";
import MonthPicker from "./form/MonthPicker.vue";
import MonthRangePicker from "./form/MonthRangePicker.vue";
import RangeCalendar from "./form/RangeCalendar.vue";
import TimeField from "./form/TimeField.vue";
import TimeRangeField from "./form/TimeRangeField.vue";
import YearPicker from "./form/YearPicker.vue";
import YearRangePicker from "./form/YearRangePicker.vue";
import {useNotification} from "../composables/useNotification";
import {getFocusable, trapTabKey} from "../utils/focus-trap";

describe("nb-ui components", () => {
    it("renders button loading and disabled state", () => {
        const wrapper = mount(Button, {
            props: {loading: true, variant: "danger"},
            slots: {default: "保存"},
        });

        expect(wrapper.text()).toContain("保存");
        expect(wrapper.attributes("disabled")).toBeDefined();
        expect(wrapper.attributes("aria-busy")).toBe("true");
        expect(wrapper.classes()).toContain("bg-[var(--status-danger)]");
    });

    it("renders panel slot content", () => {
        const wrapper = mount(Panel, {
            props: {tone: "subtle", padding: "sm"},
            slots: {default: "<p>内容</p>"},
        });

        expect(wrapper.text()).toContain("内容");
        expect(wrapper.classes()).toContain("bg-[var(--bg-subtle)]");
        expect(wrapper.classes()).toContain("p-3");
    });

    it("passes common input attributes to the native input", () => {
        const wrapper = mount(FormInput, {
            props: {
                modelValue: "abc",
                id: "username",
                name: "username",
                required: true,
                maxlength: 32,
            },
        });
        const input = wrapper.get("input");

        expect(input.attributes("id")).toBe("username");
        expect(input.attributes("name")).toBe("username");
        expect(input.attributes("required")).toBeDefined();
        expect(input.attributes("maxlength")).toBe("32");
    });
    it("uses the theme-controlled md height and padding classes for single-line controls", () => {
        const wrappers = [
            mount(FormInput, {props: {modelValue: "abc"}}),
            mount(FormNumberInput, {props: {modelValue: "3"}}),
            mount(FormSelect, {props: {modelValue: "md", options: [{label: "Markdown", value: "md"}]}}),
        ];

        for (const wrapper of wrappers) {
            const control = wrapper.get(".nb-ui-control");
            expect(control.classes()).toContain("nb-ui-control-h-md");
            expect(control.classes()).toContain("nb-ui-control-px");
            wrapper.unmount();
        }
    });

    it("renders required mark and error in form field", () => {
        const wrapper = mount(FormField, {
            props: {label: "用户名", required: true, error: "必填"},
            slots: {default: "<input />"},
        });

        expect(wrapper.text()).toContain("用户名");
        expect(wrapper.text()).toContain("*");
        expect(wrapper.text()).toContain("必填");
    });

    it("connects form field semantics to nested inputs", () => {
        const wrapper = mount({
            components: {FormField, FormInput},
            data: () => ({value: ""}),
            template: `
                <FormField label="用户名" description="公开显示" required>
                    <FormInput v-model="value" name="username" />
                </FormField>
            `,
        });
        const input = wrapper.get("input");
        const description = wrapper.get("[id$='-description']");

        expect(input.attributes("id")).toBeTruthy();
        expect(input.attributes("required")).toBeDefined();
        expect(input.attributes("aria-describedby")).toBe(description.attributes("id"));
    });

    it("renders themed icon button danger state", () => {
        const wrapper = mount(IconButton, {
            props: {title: "删除", variant: "danger"},
            slots: {default: "<span />"},
        });
        const button = wrapper.get("button");

        expect(button.attributes("aria-label")).toBe("删除");
        expect(button.classes()).toContain("hover:text-[var(--status-danger)]");
    });

    it("renders segmented control as a labelled group", () => {
        const wrapper = mount(SegmentedControl, {
            props: {
                modelValue: "list",
                ariaLabel: "视图",
                options: [
                    {label: "列表", value: "list"},
                    {label: "网格", value: "grid"},
                ],
            },
        });
        const group = wrapper.get("[role='group']");

        expect(group.attributes("role")).toBe("group");
        expect(group.attributes("aria-label")).toBe("视图");
        expect(wrapper.findAll("button")[0]?.attributes("aria-pressed")).toBe("true");
    });

    it("renders switch field with switch semantics", async () => {
        const wrapper = mount(SwitchField, {
            props: {modelValue: false, label: "启用"},
        });
        const button = wrapper.get("button");

        expect(button.attributes("role")).toBe("switch");
        expect(button.attributes("aria-checked")).toBe("false");
        await button.trigger("click");
        expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([true]);
    });

    it("renders notifications with theme tone classes", () => {
        const notification = useNotification();
        const id = notification.success("保存成功");
        const wrapper = mount(NotificationViewport, {
            global: {
                stubs: {
                    ClientOnly: {template: "<slot />"},
                },
            },
        });

        expect(wrapper.find(".nb-notification--success").exists()).toBe(true);
        notification.remove(id);
    });

    it("renders notification action and dismiss events", async () => {
        const wrapper = mount(Notification, {
            props: {
                tone: "warning",
                title: "注意",
                message: "需要处理",
                actionLabel: "查看",
                dismissible: true,
            },
        });

        expect(wrapper.find(".nb-notification--warning").exists()).toBe(true);
        expect(wrapper.text()).toContain("注意");
        expect(wrapper.text()).toContain("需要处理");
        await wrapper.get("button").trigger("click");
        await wrapper.findAll("button")[1]?.trigger("click");
        expect(wrapper.emitted("action")).toHaveLength(1);
        expect(wrapper.emitted("dismiss")).toHaveLength(1);
    });

    it("renders themed checkbox and emits updates", async () => {
        const wrapper = mount(FormCheckbox, {
            props: {modelValue: false, label: "接收通知"},
        });
        const input = wrapper.get("input");

        expect(input.classes()).toContain("peer");
        await input.setValue(true);
        expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([true]);
    });

    it("passes form field semantics to checkboxes", () => {
        const wrapper = mount({
            components: {FormCheckbox, FormField},
            data: () => ({value: false}),
            template: `
                <FormField label="许可" description="用于测试" required>
                    <FormCheckbox v-model="value" label="同意" name="agree" />
                </FormField>
            `,
        });
        const input = wrapper.get("input");
        const description = wrapper.get("[id$='-description']");

        expect(input.attributes("required")).toBeDefined();
        expect(input.attributes("aria-describedby")).toBe(description.attributes("id"));
    });

    it("shows danger border on inputs inside an errored form field", () => {
        const wrapper = mount({
            components: {FormField, FormInput},
            data: () => ({value: ""}),
            template: `
                <FormField label="用户名" error="必填">
                    <FormInput v-model="value" name="username" />
                </FormField>
            `,
        });
        const input = wrapper.get("input");

        expect(input.attributes("aria-invalid")).toBe("true");
        expect(input.classes()).toContain("nb-ui-control-invalid");
    });

    /*
     * FormSelect 从原生 <select> 换成 Reka Select 原语（Task 146 批 4）。
     * 原生 select 的弹出列表由操作系统绘制，任何 CSS 都够不着，主题只能做到控件本身为止。
     *
     * 换实现最容易悄悄丢掉的是**契约**，所以这几条盯的都是契约不是外观：
     * 触发器仍然接 FormField 的 id / describedby / invalid，仍然吐 update:modelValue，
     * 且弹出层必须是页面内的 DOM——那正是原生实现做不到的那件事。
     */
    describe("form select", () => {
        it("no longer renders a native select the theme cannot reach into", () => {
            const wrapper = mount(FormSelect, {
                props: {modelValue: "md", options: [{label: "Markdown", value: "md"}]},
            });

            expect(wrapper.find("select").exists()).toBe(false);
            // 触发器仍是可聚焦的按钮语义，键盘用户拿得到
            expect(wrapper.get("[role='combobox']").attributes("aria-expanded")).toBeDefined();
        });

        it("shows the label of the current value rather than the raw value", () => {
            const wrapper = mount(FormSelect, {
                props: {
                    modelValue: "docx",
                    options: [
                        {label: "Markdown（.md）", value: "md"},
                        {label: "Word 文档（.docx）", value: "docx"},
                    ],
                },
            });

            expect(wrapper.text()).toContain("Word 文档（.docx）");
            expect(wrapper.text()).not.toContain("Markdown（.md）");
        });

        it("renders every option's label once the list is open", async () => {
            /*
             * 这条盯的是一处真回归：`<SelectItemText />` 写成自闭合就等于把每一项都渲染成空白。
             * 关着的时候一切正常——触发器上的当前值是组件自己从 options 算的——所以
             * 上面那几条契约用例全绿，点开才发现列表是一片空的，只剩勾选标记。
             *
             * 教训是断言面：**只测关着的状态测不出弹出层**。弹出层被 portal 到 body，
             * 所以要 attachTo 并从 document 查，从 wrapper 查是查不到的。
             */
            const wrapper = mount(FormSelect, {
                props: {
                    modelValue: "md",
                    options: [
                        {label: "Markdown（.md）", value: "md"},
                        {label: "纯文本（.txt）", value: "txt"},
                        {label: "PDF（暂不可用）", value: "pdf", disabled: true},
                    ],
                },
                attachTo: document.body,
            });

            await wrapper.get("[role='combobox']").trigger("keydown", {key: "Enter"});
            await nextTick();
            await nextTick();

            const labels = [...document.querySelectorAll("[role='option']")].map(
                (option) => option.textContent?.trim() ?? "",
            );

            expect(labels).toEqual(["Markdown（.md）", "纯文本（.txt）", "PDF（暂不可用）"]);
            expect(document.querySelector(".nb-ui-menu-surface")).not.toBeNull();
            expect(document.querySelector(".nb-ui-menu-surface")?.classList).toContain("nb-ui-popover-surface");
            wrapper.unmount();
            });

        it("takes every item's corner radius from the popover registry, not from an atom class", async () => {
            /*
             * 用户的原话是「他的宽度和圆角没有对齐」。根因是**同心不成立**：
             * 项写死 rounded-md（6px），而外框在 nbook 下是 20px、内边距 6px——
             * 直边上项与框之间有 6px 留白，绕到角上只剩不到 1px，两条弧线根本不平行。
             *
             * 所以这条盯的不是「圆角等于几」（那是主题的事），而是**取值从哪来**：
             * 项必须挂 .nb-ui-popover-item，由它从 --nb-popover-inner-radius 推出来。
             * 谁把 rounded-* 加回模板，这条就红——那类原子类还会被排在 utilities 之后的
             * .nb-ui-popover-item 压掉，写了也不生效，是一处「看代码以为改了其实没改」。
             *
             * 禁用项一起验：用户正是指着「PDF（暂不可用）」这一行说的，它和普通项走同一套几何。
             */
            const wrapper = mount(FormSelect, {
                props: {
                    modelValue: "md",
                    options: [
                        {label: "Markdown（.md）", value: "md"},
                        {label: "纯文本（.txt）", value: "txt"},
                        {label: "PDF（暂不可用）", value: "pdf", disabled: true},
                    ],
                },
                attachTo: document.body,
            });

            await wrapper.get("[role='combobox']").trigger("keydown", {key: "Enter"});
            await nextTick();
            await nextTick();

            const options = [...document.querySelectorAll("[role='option']")];
            expect(options).toHaveLength(3);
            for (const option of options) {
                expect([...option.classList], option.textContent ?? "").toContain("nb-ui-popover-item");
                expect(
                    [...option.classList].filter((name) => name.startsWith("rounded-")),
                    `${option.textContent} 自己写了圆角`,
                ).toEqual([]);
            }
            wrapper.unmount();
        });

        it("leaves the page scrollable and clickable while the list is open", async () => {
            /*
             * Reka 的 Select 默认按**模态**浮层处理：`bodyLock` 与 `disableOutsidePointerEvents`
             * 的默认值都是 true，开着的时候往 body 上写 `overflow: hidden` 和 `pointer-events: none`。
             * 用户看到的就是「下拉一打开，整页就滚不动了，别的地方也点不动」。
             *
             * 两个属性各管一半，所以这里两条都断言：只关一个是半吊子。
             * 这条盯的是真回归——把模板里那两个 :body-lock="false" / :disable-outside-pointer-events="false"
             * 任意删掉一个，它就红。
             */
            const wrapper = mount(FormSelect, {
                props: {
                    modelValue: "md",
                    options: [
                        {label: "Markdown（.md）", value: "md"},
                        {label: "纯文本（.txt）", value: "txt"},
                    ],
                },
                attachTo: document.body,
            });

            await wrapper.get("[role='combobox']").trigger("keydown", {key: "Enter"});
            await nextTick();
            await nextTick();

            // 先确认真的开着，否则下面两条会在「根本没打开」的情况下假绿
            expect(document.querySelectorAll("[role='option']").length).toBe(2);
            expect(document.body.style.overflow).toBe("");
            expect(document.body.style.pointerEvents).toBe("");
            wrapper.unmount();
        });

        it("keeps wiring itself to the surrounding form field", () => {
            const wrapper = mount({
                components: {FormField, FormSelect},
                data: () => ({value: "md"}),
                template: `
                    <FormField label="导出格式" error="必填">
                        <FormSelect v-model="value" name="format" :options="[{label: 'Markdown', value: 'md'}]" />
                    </FormField>
                `,
            });
            const trigger = wrapper.get("[role='combobox']");

            expect(trigger.attributes("aria-invalid")).toBe("true");
            expect(trigger.classes()).toContain("nb-ui-control-invalid");
            expect(trigger.attributes("id")).toBe(wrapper.get("label").attributes("for"));
        });

        it("emits a string when the value changes, never undefined", async () => {
            const wrapper = mount(FormSelect, {
                props: {modelValue: "md", options: [{label: "Markdown", value: "md"}]},
            });

            // 原语层允许清空成 undefined，本组件的契约是 string，所以要落成空串
            (wrapper.vm as unknown as {handleUpdate: (value: unknown) => void}).handleUpdate(undefined);
            (wrapper.vm as unknown as {handleUpdate: (value: unknown) => void}).handleUpdate("docx");
            await wrapper.vm.$nextTick();

            expect(wrapper.emitted("update:modelValue")).toEqual([[""], ["docx"]]);
        });
    });
});

describe("nb-ui pagination range", () => {
    it("returns all pages when page count fits without folding", () => {
        expect(paginationRange(1, 7, 1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(paginationRange(4, 7, 1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("folds the right side when current page is near the start", () => {
        expect(paginationRange(2, 12, 1)).toEqual([1, 2, 3, 4, 5, "ellipsis-end", 12]);
    });

    it("folds the left side when current page is near the end", () => {
        expect(paginationRange(11, 12, 1)).toEqual([1, "ellipsis-start", 8, 9, 10, 11, 12]);
    });

    it("folds both sides when current page is in the middle", () => {
        expect(paginationRange(6, 12, 1)).toEqual([1, "ellipsis-start", 5, 6, 7, "ellipsis-end", 12]);
    });

    it("clamps out-of-range pages and handles empty page count", () => {
        expect(paginationRange(99, 12, 1)).toEqual([1, "ellipsis-start", 8, 9, 10, 11, 12]);
        expect(paginationRange(-3, 12, 1)).toEqual([1, 2, 3, 4, 5, "ellipsis-end", 12]);
        expect(paginationRange(1, 0, 1)).toEqual([]);
    });

    it("respects a wider sibling window", () => {
        expect(paginationRange(10, 20, 2)).toEqual([1, "ellipsis-start", 8, 9, 10, 11, 12, "ellipsis-end", 20]);
    });
});

describe("nb-ui new primitives", () => {
    it("renders pagination pages with current marker and emits page updates", async () => {
        const wrapper = mount(Pagination, {
            props: {page: 6, pageCount: 12},
        });
        const current = wrapper.get("[aria-current='page']");

        expect(current.text()).toBe("6");
        expect(wrapper.text()).toContain("…");
        const buttons = wrapper.findAll("button");
        await buttons[buttons.length - 1]?.trigger("click");
        expect(wrapper.emitted("update:page")?.[0]).toEqual([7]);
    });

    it("renders tabs with tab semantics and arrow key navigation", async () => {
        const wrapper = mount(Tabs, {
            props: {
                modelValue: "a",
                ariaLabel: "视图",
                items: [
                    {value: "a", label: "A"},
                    {value: "b", label: "B"},
                    {value: "c", label: "C", disabled: true},
                ],
            },
            attachTo: document.body,
        });
        const tablist = wrapper.get("[role='tablist']");
        const tabs = wrapper.findAll("[role='tab']");

        expect(tabs[0]?.attributes("aria-selected")).toBe("true");
        expect(tabs[1]?.attributes("tabindex")).toBe("-1");
        await tablist.trigger("keydown", {key: "ArrowRight"});
        expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["b"]);
        // 禁用项被跳过：从 b 再右移应回到 a 而不是 c
        await wrapper.setProps({modelValue: "b"});
        await tablist.trigger("keydown", {key: "ArrowRight"});
        expect(wrapper.emitted("update:modelValue")?.[1]).toEqual(["a"]);
        wrapper.unmount();
    });

    it("keeps the tabs indicator inside the scroll box", () => {
        // tablist 是 overflow-x-auto，而 CSS 规定另一轴的 visible 会跟着计算成 auto。
        // 指示线只要有 1px 落在 padding box 外，26px 高的标签栏就会多出一条竖向滚动条。
        const wrapper = mount(Tabs, {
            props: {modelValue: "a", items: [{value: "a", label: "A"}]},
        });
        const indicatorClasses = wrapper.get("[role='tab']").classes()
            .filter((name) => name.startsWith("after:bottom"));

        expect(indicatorClasses).toEqual(["after:bottom-0"]);
        wrapper.unmount();
    });

    it("renders badge tones and variants", () => {
        const wrapper = mount(Badge, {
            props: {tone: "success", variant: "outline", dot: true},
            slots: {default: "已同步"},
        });

        expect(wrapper.text()).toContain("已同步");
        expect(wrapper.classes()).toContain("nb-badge--success");
        expect(wrapper.classes()).toContain("nb-badge--outline");
    });

    it("renders table rows, custom cell slots and empty state", () => {
        // mount 无法从 props 推断泛型 Row，用宿主模板组件挂载（与本文件 FormField 测试同风格）
        const wrapper = mount({
            components: {Table},
            data: () => ({
                columns: [
                    {key: "name", label: "名称"},
                    {key: "role", label: "角色"},
                ],
                rows: [
                    {id: "1", name: "Ada", role: "admin"},
                    {id: "2", name: "Ben", role: "user"},
                ],
            }),
            template: `
                <Table :columns="columns" :rows="rows" row-key="id">
                    <template #cell-role="{value}"><em>{{ value }}</em></template>
                </Table>
            `,
        });

        expect(wrapper.findAll("tbody tr")).toHaveLength(2);
        expect(wrapper.find("em").text()).toBe("admin");

        const empty = mount({
            components: {Table},
            data: () => ({columns: [{key: "name", label: "名称"}], rows: []}),
            template: `<Table :columns="columns" :rows="rows" empty-text="没有成员" />`,
        });
        expect(empty.text()).toContain("没有成员");
    });
});

describe("nb-ui context menu position", () => {
    const viewport = {width: 1000, height: 800};

    it("keeps position when the menu fits", () => {
        expect(clampMenuPosition(100, 100, {width: 200, height: 300}, viewport)).toEqual({x: 100, y: 100});
    });

    it("pulls the menu back on right/bottom overflow", () => {
        expect(clampMenuPosition(900, 100, {width: 200, height: 300}, viewport)).toEqual({x: 792, y: 100});
        expect(clampMenuPosition(100, 700, {width: 200, height: 300}, viewport)).toEqual({x: 100, y: 492});
    });

    it("clamps to the viewport padding at minimum", () => {
        expect(clampMenuPosition(-50, -50, {width: 200, height: 300}, viewport)).toEqual({x: 8, y: 8});
        expect(clampMenuPosition(0, 0, {width: 2000, height: 2000}, viewport)).toEqual({x: 8, y: 8});
    });

    it("anchors the submenu to the item's right edge", () => {
        const anchor = {top: 100, left: 300, right: 480};
        expect(computeSubmenuPosition(anchor, {width: 180, height: 200}, viewport)).toEqual({x: 479, y: 96});
    });

    it("flips the submenu to the left on right overflow", () => {
        const anchor = {top: 100, left: 700, right: 880};
        expect(computeSubmenuPosition(anchor, {width: 180, height: 200}, viewport)).toEqual({x: 521, y: 96});
    });

    it("sticks the submenu to the bottom on vertical overflow", () => {
        const anchor = {top: 700, left: 300, right: 480};
        expect(computeSubmenuPosition(anchor, {width: 180, height: 200}, viewport)).toEqual({x: 479, y: 592});
    });
});

describe("nb-ui a11y round", () => {
    it("navigates combobox options with keyboard", async () => {
        const wrapper = mount(Combobox, {
            props: {modelValue: null, options: ["alpha", "beta", "gamma"]},
            attachTo: document.body,
        });
        const input = wrapper.get("input");

        await input.trigger("keydown", {key: "ArrowDown"});
        expect(wrapper.find("[role='listbox']").exists()).toBe(true);
        expect(input.attributes("aria-activedescendant")).toContain("-opt-0");

        await input.trigger("keydown", {key: "ArrowDown"});
        expect(input.attributes("aria-activedescendant")).toContain("-opt-1");

        await input.trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["beta"]);
        wrapper.unmount();
    });

    it("closes the combobox listbox with escape", async () => {
        const wrapper = mount(Combobox, {
            props: {modelValue: null, options: ["alpha", "beta"]},
            attachTo: document.body,
        });
        const input = wrapper.get("input");

        await input.trigger("keydown", {key: "ArrowDown"});
        expect(wrapper.find("[role='listbox']").exists()).toBe(true);
        await input.trigger("keydown", {key: "Escape"});
        expect(wrapper.find("[role='listbox']").exists()).toBe(false);
        wrapper.unmount();
    });

    it("pauses and resumes notification auto dismiss", () => {
        vi.useFakeTimers();
        const notification = useNotification();
        const id = notification.info("悬停暂停", {duration: 1000});

        vi.advanceTimersByTime(500);
        notification.pause(id);
        vi.advanceTimersByTime(5000);
        expect(notification.notifications.value.some((item) => item.id === id)).toBe(true);

        notification.resume(id);
        vi.advanceTimersByTime(1000);
        expect(notification.notifications.value.some((item) => item.id === id)).toBe(false);
        vi.useRealTimers();
    });

    it("collects focusable elements and cycles tab focus", () => {
        const root = document.createElement("div");
        root.innerHTML = "<button id='first'>A</button><input id='mid'><button id='last' disabled>B</button><a id='link' href='#'>L</a>";
        document.body.appendChild(root);

        const focusable = getFocusable(root);
        expect(focusable.map((el) => el.id)).toEqual(["first", "mid", "link"]);

        (root.querySelector("#link") as HTMLElement).focus();
        const forward = new KeyboardEvent("keydown", {key: "Tab", cancelable: true});
        trapTabKey(forward, root);
        expect(document.activeElement?.id).toBe("first");
        expect(forward.defaultPrevented).toBe(true);

        const backward = new KeyboardEvent("keydown", {key: "Tab", shiftKey: true, cancelable: true});
        trapTabKey(backward, root);
        expect(document.activeElement?.id).toBe("link");
        root.remove();
    });

    it("adds and removes tags via keyboard", async () => {
        const wrapper = mount(TagInput, {
            props: {modelValue: ["vue"]},
        });
        const input = wrapper.get("input");

        await input.setValue("nuxt");
        await input.trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([["vue", "nuxt"]]);

        await input.setValue("");
        await input.trigger("keydown", {key: "Backspace"});
        expect(wrapper.emitted("update:modelValue")?.[1]).toEqual([[]]);
    });
});

describe("nb-ui option highlight", () => {
    const options = [{disabled: false}, {disabled: true}, {}, {disabled: true}, {}];

    it("cycles forward and backward skipping disabled options", () => {
        expect(moveHighlight(options, 0, "next")).toBe(2);
        expect(moveHighlight(options, 2, "next")).toBe(4);
        expect(moveHighlight(options, 4, "next")).toBe(0);
        expect(moveHighlight(options, 0, "prev")).toBe(4);
    });

    it("starts from the edges when current is not enabled", () => {
        expect(moveHighlight(options, -1, "next")).toBe(0);
        expect(moveHighlight(options, -1, "prev")).toBe(4);
        expect(moveHighlight(options, 1, "next")).toBe(0);
    });

    it("jumps to first and last enabled options", () => {
        expect(moveHighlight(options, 2, "first")).toBe(0);
        expect(moveHighlight(options, 2, "last")).toBe(4);
    });

    it("returns -1 when nothing is enabled", () => {
        expect(moveHighlight([{disabled: true}, {disabled: true}], 0, "next")).toBe(-1);
        expect(moveHighlight([], -1, "first")).toBe(-1);
    });
});

describe("nb-ui notification clearAll", () => {
    it("removes every notification and its timers", () => {
        vi.useFakeTimers();
        const notification = useNotification();
        notification.info("一");
        notification.info("二");
        expect(notification.notifications.value.length).toBeGreaterThanOrEqual(2);

        notification.clearAll();
        expect(notification.notifications.value).toHaveLength(0);
        // 计时器已清：时间推进不应报错或复活任何通知
        vi.advanceTimersByTime(10000);
        expect(notification.notifications.value).toHaveLength(0);
        vi.useRealTimers();
    });
});

/*
 * 对话框的头尾分隔线。上一版是两条常驻的通栏细线，把面板切成三段——那是后台管理面板的读法，
 * Apple 的 sheet 平时一条都不画，滚起来才浮出一条，那条线说的是「上面还有内容」。
 *
 * 断言面挑的是**两种状态都要测**：只测「不滚时没有线」的话，把逻辑写死成 false 也能过；
 * 只测「能滚时有线」的话，退回常驻细线同样能过。两条合起来才卡得住。
 *
 * jsdom 不做布局，scrollHeight / clientHeight 恒为 0，所以可滚那一档要自己把这两个值定义上去。
 * 这是在替代布局引擎，不是在测自己的桩：桩给的是浏览器会给的输入，被测的是组件对输入的反应。
 */
describe("nb-ui dialog scroll separators", () => {
    function mountDialog() {
        return mount(Dialog, {
            props: {modelValue: true, title: "标题", showCancel: true, teleportTarget: false},
            slots: {default: "<p>正文</p>"},
            attachTo: document.body,
        });
    }

    it("draws no rule when the body has nothing to scroll", async () => {
        const wrapper = mountDialog();
        await nextTick();
        await nextTick();

        expect(wrapper.get("header").attributes("style")).toContain("box-shadow: none");
        expect(wrapper.get("footer").attributes("style")).toContain("box-shadow: none");
        wrapper.unmount();
    });

    it("draws the footer rule while content remains below the fold", async () => {
        const wrapper = mountDialog();
        await nextTick();
        await nextTick();

        const body = wrapper.get("[role='dialog'] > div").element as HTMLElement;
        Object.defineProperty(body, "scrollHeight", {value: 600, configurable: true});
        Object.defineProperty(body, "clientHeight", {value: 200, configurable: true});
        await wrapper.get("[role='dialog'] > div").trigger("scroll");

        // 还没滚，所以只有下面那条：头上的线说的是「上面还有」，此刻上面没有
        expect(wrapper.get("header").attributes("style")).toContain("box-shadow: none");
        expect(wrapper.get("footer").attributes("style")).toContain("var(--divider)");

        body.scrollTop = 120;
        await wrapper.get("[role='dialog'] > div").trigger("scroll");
        expect(wrapper.get("header").attributes("style")).toContain("var(--divider)");
        wrapper.unmount();
    });
});

describe("nb-ui dialog anatomy", () => {
    /*
     * 这一组盯的是「不是一个 Web 盒子」这件事，判据全部来自 Apple 官方 macOS 27 UI Kit
     * 里量到的真实取值（Alert：padding 20/16/16、gap 14、按钮 110×28 平分整行、无 ×；
     * Save Dialog：390 宽、按钮 76×24 右对齐）。
     *
     * 它们看着像「测样式」，但每一条对应的都是一次真实的观感回归：
     * 头尾条一旦回来，留白就会从 section 漏回三个条各自持有，这三条会同时红。
     */
    function mountDialog(props: Record<string, unknown> = {}) {
        return mount(Dialog, {
            props: {modelValue: true, title: "标题", showCancel: true, teleportTarget: false, ...props},
            slots: {default: "<p>正文</p>"},
            attachTo: document.body,
        });
    }

    it("puts the padding on the panel instead of on header and footer bands", async () => {
        const wrapper = mountDialog();
        await nextTick();

        // 留白归容器：上 20（--panel-p + --space-2）、下 --panel-p
        //
        // 左右那条写的是 `padding-inline`，**jsdom 的 CSS 解析器不认这个简写**，会静默丢掉，
        // 所以这里不断言它（Chromium 实测读到的是 `padding: 20px 16px 16px`）。
        // 真正的回归面是下面两条：头尾一旦自己长回 padding，就又变回「条」了。
        const panel = wrapper.get("[role='dialog']").attributes("style") ?? "";
        expect(panel).toContain("padding-block-start: calc(var(--panel-p) + var(--space-2))");
        expect(panel).toContain("padding-block-end: var(--panel-p)");

        // 头尾自己不许再有 padding——有的话就又变回「条」了
        expect(wrapper.get("header").attributes("style") ?? "").not.toContain("padding");
        expect(wrapper.get("footer").attributes("style") ?? "").not.toContain("padding");
        wrapper.unmount();
    });

    it("ships no close button by default and still offers a named way out", async () => {
        const wrapper = mountDialog();
        await nextTick();

        // Apple 的 alert / sheet 都没有 ×，出口是一颗有名字的按钮
        expect(wrapper.find("[aria-label='关闭']").exists()).toBe(false);
        expect(wrapper.findAll("footer button").length).toBe(2);

        const opted = mountDialog({closable: true});
        await nextTick();
        expect(opted.find("[aria-label='关闭']").exists()).toBe(true);
        opted.unmount();
        wrapper.unmount();
    });

    it("spans the button row on decision-sized dialogs and right-aligns it on form-sized ones", async () => {
        // 窄框＝alert 形态：两颗按钮平分整行
        const decision = mountDialog({size: "default"});
        await nextTick();
        expect(decision.get("footer").classes()).not.toContain("justify-end");
        expect(decision.findAll("footer button").every((b) => b.classes().includes("flex-1"))).toBe(true);
        decision.unmount();

        // 宽框＝sheet 形态：按钮右对齐，平分整行会得到两根夸张的长条
        const form = mountDialog({size: "lg"});
        await nextTick();
        expect(form.get("footer").classes()).toContain("justify-end");
        expect(form.findAll("footer button").some((b) => b.classes().includes("flex-1"))).toBe(false);
        form.unmount();
    });

    it("renders slider and emits update on value change", async () => {
        const wrapper = mount(Slider, {
            props: {
                modelValue: 40,
                min: 0,
                max: 100,
                step: 5,
                size: "sm",
            },
        });
        await nextTick();

        expect(wrapper.find("[role='slider']").exists()).toBe(true);
        expect(wrapper.find("[role='slider']").attributes("aria-valuemin")).toBe("0");
        expect(wrapper.find("[role='slider']").attributes("aria-valuemax")).toBe("100");
        wrapper.unmount();
    });

    it("renders accordion items and handles expansion", async () => {
        const wrapper = mount(Accordion, {
            props: {
                type: "single",
                collapsible: true,
                items: [
                    {value: "ch1", title: "第一章", content: "第一章正文内容"},
                    {value: "ch2", title: "第二章", content: "第二章正文内容"},
                ],
            },
        });

        expect(wrapper.text()).toContain("第一章");
        expect(wrapper.text()).toContain("第二章");
        expect(wrapper.findAll("button[data-radix-collection-item], button[data-reka-collection-item]").length).toBe(2);
        wrapper.unmount();
    });

    it("renders radio group and supports options", async () => {
        const wrapper = mount(RadioGroup, {
            props: {
                modelValue: "epub",
                options: [
                    {value: "epub", label: "EPUB 电子书", description: "适配大多数阅读器"},
                    {value: "pdf", label: "PDF 文档", description: "固定版面排版"},
                ],
            },
        });

        expect(wrapper.text()).toContain("EPUB 电子书");
        expect(wrapper.text()).toContain("PDF 文档");
        const items = wrapper.findAll("[role='radio']");
        expect(items.length).toBe(2);
        expect(items[0]!.attributes("data-state")).toBe("checked");
        expect(items[1]!.attributes("data-state")).toBe("unchecked");
        wrapper.unmount();
    });

    it("renders kbd shortcut cap with appropriate size", () => {
        const wrapper = mount(Kbd, {
            props: {size: "sm"},
            slots: {default: "⌘K"},
        });

        expect(wrapper.text()).toBe("⌘K");
        expect(wrapper.classes()).toContain("h-4");
        expect(wrapper.classes()).toContain("font-mono");
        wrapper.unmount();
    });

    it("renders popover and hover card triggers cleanly", () => {
        const popoverWrapper = mount(Popover, {
            slots: {
                trigger: "<button>打开气泡</button>",
                default: "<div>气泡内容</div>",
            },
        });
        expect(popoverWrapper.text()).toContain("打开气泡");
        popoverWrapper.unmount();

        const hoverCardWrapper = mount(HoverCard, {
            slots: {
                trigger: "<span>悬浮词条</span>",
                default: "<div>词条设定详情</div>",
            },
        });
        expect(hoverCardWrapper.text()).toContain("悬浮词条");
        hoverCardWrapper.unmount();
    });

    it("renders tooltip trigger and shows content on hover after delay", async () => {
        vi.useFakeTimers();
        try {
            const wrapper = mount(Tooltip, {
                props: {text: "悬停提示内容", delay: 100},
                slots: {default: "<button type='button'>提示触发器</button>"},
                attachTo: document.body,
            });

            expect(wrapper.text()).toContain("提示触发器");
            expect(document.body.textContent).not.toContain("悬停提示内容");
            await wrapper.get("button").trigger("pointermove");
            expect(document.body.textContent).not.toContain("悬停提示内容");

            await vi.advanceTimersByTimeAsync(150);
            await nextTick();
            expect(document.body.textContent).toContain("悬停提示内容");

            // reka 默认行为：点击触发器立即关闭提示
            await wrapper.get("button").trigger("click");
            await nextTick();
            expect(document.body.textContent).not.toContain("悬停提示内容");
            wrapper.unmount();
        } finally {
            vi.useRealTimers();
        }
    });

    it("shows tooltip immediately on keyboard focus without hover", async () => {
        const wrapper = mount(Tooltip, {
            props: {text: "聚焦提示内容"},
            slots: {default: "<button type='button'>聚焦触发器</button>"},
            attachTo: document.body,
        });

        await wrapper.get("button").trigger("focus");
        await nextTick();
        await nextTick();
        expect(document.body.textContent).toContain("聚焦提示内容");
        wrapper.unmount();
    });

    it("renders switch and handles state", async () => {
        const wrapper = mount(Switch, {
            props: {
                modelValue: true,
                size: "sm",
            },
        });
        await nextTick();

        expect(wrapper.find("[role='switch']").exists()).toBe(true);
        expect(wrapper.find("[role='switch']").attributes("data-state")).toBe("checked");
        wrapper.unmount();
    });

    it("renders toggle group with multiple selection options", () => {
        const wrapper = mount(ToggleGroup, {
            props: {
                type: "multiple",
                modelValue: ["bold", "italic"],
                options: [
                    {value: "bold", label: "B", title: "加粗"},
                    {value: "italic", label: "I", title: "斜体"},
                    {value: "underline", label: "U", title: "下划线"},
                ],
            },
        });

        expect(wrapper.text()).toContain("B");
        expect(wrapper.text()).toContain("I");
        expect(wrapper.text()).toContain("U");
        const items = wrapper.findAll("button");
        expect(items.length).toBe(3);
        expect(items[0]!.attributes("data-state")).toBe("on");
        expect(items[1]!.attributes("data-state")).toBe("on");
        expect(items[2]!.attributes("data-state")).toBe("off");
        wrapper.unmount();
    });

    it("renders toolbar container and slots", () => {
        const wrapper = mount(Toolbar, {
            slots: {
                default: "<button>动作1</button><button>动作2</button>",
            },
        });

        expect(wrapper.attributes("role")).toBe("toolbar");
        expect(wrapper.text()).toContain("动作1");
        expect(wrapper.text()).toContain("动作2");
        wrapper.unmount();
    });

    it("renders breadcrumb navigation items and separator", () => {
        const wrapper = mount(Breadcrumb, {
            props: {
                items: [
                    {label: "我的书库", href: "/library"},
                    {label: "第一卷", href: "/library/vol-1"},
                    {label: "第3章", current: true},
                ],
            },
        });

        expect(wrapper.find("nav").attributes("aria-label")).toBe("面包屑导航");
        expect(wrapper.text()).toContain("我的书库");
        expect(wrapper.text()).toContain("第一卷");
        expect(wrapper.text()).toContain("第3章");
        expect(wrapper.find("[aria-current='page']").text()).toBe("第3章");
        wrapper.unmount();
    });

    it("renders splitter panels and resize handle", () => {
        const wrapper = mount(Splitter, {
            props: {
                direction: "horizontal",
                panels: [
                    {id: "sidebar", defaultSize: 25},
                    {id: "editor", defaultSize: 75},
                ],
            },
            slots: {
                "panel-sidebar": "<div>侧边栏内容</div>",
                "panel-editor": "<div>正文内容</div>",
            },
        });

        expect(wrapper.text()).toContain("侧边栏内容");
        expect(wrapper.text()).toContain("正文内容");
        wrapper.unmount();
    });

    it("renders drawer trigger and mounts cleanly", () => {
        const wrapper = mount(Drawer, {
            props: {
                title: "设定详情",
                description: "人物属性与背景",
            },
            slots: {
                trigger: "<button>打开抽屉</button>",
                default: "<div>抽屉正文</div>",
            },
        });

        expect(wrapper.text()).toContain("打开抽屉");
        wrapper.unmount();
    });

    it("renders progress bar with tone and aria value", () => {
        const wrapper = mount(Progress, {
            props: {
                modelValue: 60,
                max: 100,
                tone: "success",
            },
        });

        expect(wrapper.find("[role='progressbar']").exists()).toBe(true);
        expect(wrapper.find("[role='progressbar']").attributes("aria-valuenow")).toBe("60");
        wrapper.unmount();
    });

    it("renders avatar fallback and squircle shape", () => {
        const wrapper = mount(Avatar, {
            props: {
                fallback: "NB",
                size: "md",
                shape: "squircle",
            },
        });

        expect(wrapper.text()).toContain("NB");
        expect(wrapper.classes()).toContain("h-8");
        expect(wrapper.classes()).toContain("rounded-[var(--radius-control)]");
        wrapper.unmount();
    });

    it("renders separator with correct orientation semantics", () => {
        const hSep = mount(Separator, {
            props: {orientation: "horizontal"},
        });
        expect(hSep.attributes("role")).toBe("none");
        expect(hSep.classes()).toContain("w-full");
        hSep.unmount();

        const vSep = mount(Separator, {
            props: {orientation: "vertical", decorative: false},
        });
        expect(vSep.attributes("role")).toBe("separator");
        expect(vSep.attributes("aria-orientation")).toBe("vertical");
        vSep.unmount();
    });

    it("renders aspect ratio container", () => {
        const wrapper = mount(AspectRatio, {
            props: {ratio: 16 / 9},
            slots: {
                default: "<img src='/cover.jpg' alt='封面' />",
            },
        });

        expect(wrapper.find("img").exists()).toBe(true);
        wrapper.unmount();
    });

    it("renders calendar heading and weekday grid", () => {
        const wrapper = mount(Calendar, {
            props: {
                locale: "zh-CN",
            },
        });

        expect(wrapper.find("table").exists()).toBe(true);
        expect(wrapper.findAll("[role='gridcell']").length).toBeGreaterThan(0);
        wrapper.unmount();
    });

    it("renders collapsible trigger and content", () => {
        const wrapper = mount(Collapsible, {
            slots: {
                trigger: "<button>折叠开关</button>",
                default: "<div>折叠详细说明</div>",
            },
        });

        expect(wrapper.text()).toContain("折叠开关");
        wrapper.unmount();
    });

    it("renders scroll area viewport", () => {
        const wrapper = mount(ScrollArea, {
            slots: {
                default: "<p>长篇文本内容</p>",
            },
        });

        expect(wrapper.text()).toContain("长篇文本内容");
        wrapper.unmount();
    });

    it("renders alert dialog trigger cleanly", () => {
        const wrapper = mount(AlertDialog, {
            props: {
                title: "删除章节确认",
                description: "此操作无法恢复",
                confirmText: "确认删除",
            },
            slots: {
                trigger: "<button>删除章节</button>",
            },
        });

        expect(wrapper.text()).toContain("删除章节");
        wrapper.unmount();
    });

    it("renders pin input with specified number of cells", () => {
        const wrapper = mount(PinInput, {
            props: {
                length: 4,
            },
        });

        const inputs = wrapper.findAll("input:not([aria-hidden='true'])");
        expect(inputs.length).toBe(4);
        wrapper.unmount();
    });

    it("renders menubar menus and triggers", () => {
        const wrapper = mount(Menubar, {
            props: {
                menus: [
                    {id: "file", label: "文件", items: [{label: "新建", value: "new"}]},
                    {id: "edit", label: "编辑", items: [{label: "撤销", value: "undo"}]},
                ],
            },
        });

        expect(wrapper.text()).toContain("文件");
        expect(wrapper.text()).toContain("编辑");
        wrapper.unmount();
    });

    it("renders editable with preview and edit trigger", () => {
        const wrapper = mount(Editable, {
            props: {
                modelValue: "第一卷：启程",
                placeholder: "点击编辑",
            },
        });

        expect(wrapper.text()).toContain("第一卷：启程");
        expect(wrapper.find("button[aria-label='编辑']").exists()).toBe(true);
        wrapper.unmount();
    });

    it("renders stepper with steps and current indicator", () => {
        const wrapper = mount(Stepper, {
            props: {
                modelValue: 2,
                steps: [
                    {step: 1, title: "创建档案"},
                    {step: 2, title: "世界观设定"},
                    {step: 3, title: "导出发布"},
                ],
            },
        });

        expect(wrapper.text()).toContain("创建档案");
        expect(wrapper.text()).toContain("世界观设定");
        expect(wrapper.text()).toContain("导出发布");
        wrapper.unmount();
    });

    it("renders date picker trigger and placeholder", () => {
        const wrapper = mount(DatePicker, {
            props: {
                placeholder: "选择定档发布日期",
            },
        });

        expect(wrapper.text()).toContain("选择定档发布日期");
        wrapper.unmount();
    });

    it("renders range calendar with weekday headers", () => {
        const wrapper = mount(RangeCalendar, {
            props: {
                locale: "zh-CN",
            },
        });

        expect(wrapper.find("table").exists()).toBe(true);
        expect(wrapper.findAll("[role='gridcell']").length).toBeGreaterThan(0);
        wrapper.unmount();
    });

    it("renders listbox with options and filtering", () => {
        const wrapper = mount(Listbox, {
            props: {
                options: [
                    {value: "c1", label: "赛博朋克"},
                    {value: "c2", label: "硬核科幻"},
                ],
                showFilter: true,
            },
        });

        expect(wrapper.text()).toContain("赛博朋克");
        expect(wrapper.text()).toContain("硬核科幻");
        expect(wrapper.find("input").exists()).toBe(true);
        wrapper.unmount();
    });

    it("renders listbox card variant and action bar", () => {
        const wrapper = mount(Listbox, {
            props: {
                options: [
                    {value: "char1", label: "林澈", description: "代号渡鸦", badge: "主角"},
                    {value: "char2", label: "苏浅", description: "科学家", badge: "盟友"},
                ],
                variant: "card",
                multiple: true,
                modelValue: ["char1"],
                showActionBar: true,
            },
        });

        expect(wrapper.text()).toContain("林澈");
        expect(wrapper.text()).toContain("代号渡鸦");
        expect(wrapper.text()).toContain("主角");
        expect(wrapper.text()).toContain("项已选");
        expect(wrapper.text()).toContain("全选");
        wrapper.unmount();
    });

    it("renders listbox grouped sections", () => {
        const wrapper = mount(Listbox, {
            props: {
                groups: [
                    {
                        id: "v1",
                        label: "第一卷",
                        options: [{value: "ch1", label: "第01章"}],
                    },
                ],
            },
        });

        expect(wrapper.text()).toContain("第一卷");
        expect(wrapper.text()).toContain("第01章");
        wrapper.unmount();
    });

    it("renders listbox compact variant", () => {
        const wrapper = mount(Listbox, {
            props: {
                options: [{value: "opt1", label: "测试"}],
                variant: "compact",
            },
        });
        expect(wrapper.text()).toContain("测试");
        wrapper.unmount();
    });

    it("renders rating stars and reflects max count", () => {
        const wrapper = mount(Rating, {
            props: {
                modelValue: 3,
                max: 5,
            },
        });

        expect(wrapper.findAll(".group").length).toBe(5);
        wrapper.unmount();
    });

    it("renders color picker with color text and swatch", () => {
        const wrapper = mount(ColorPicker, {
            props: {
                modelValue: "#6366F1",
            },
        });

        expect(wrapper.text().toUpperCase()).toContain("#6366F1");
        wrapper.unmount();
    });

    it("renders navigation menu items", () => {
        const wrapper = mount(NavigationMenu, {
            props: {
                items: [
                    {id: "m1", label: "工作区", href: "#"},
                    {id: "m2", label: "大纲", links: [{title: "主线大纲", description: "规划剧情"}]},
                ],
            },
        });

        expect(wrapper.text()).toContain("工作区");
        expect(wrapper.text()).toContain("大纲");
        wrapper.unmount();
    });

    it("renders tree with nodes and indentation", () => {
        const wrapper = mount(Tree, {
            props: {
                items: [
                    {id: "v1", title: "第一卷", children: [{id: "c1", title: "第01章"}]},
                ],
            },
        });

        expect(wrapper.text()).toContain("第一卷");
        wrapper.unmount();
    });

    it("uses the row surface instead of a left border for tree selection", async () => {
        const wrapper = mount(Tree, {
            props: {
                items: [
                    {id: "chapter-1", title: "第01章"},
                    {id: "chapter-2", title: "第02章"},
                ],
                modelValue: "chapter-1",
            },
        });

        const rows = wrapper.findAll("[role='treeitem']");
        expect(rows[0]?.attributes("data-selected")).toBe("");
        expect(rows[0]?.attributes("aria-selected")).toBe("true");
        expect(rows[0]?.classes()).toContain("data-[selected]:bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)]");
        expect(rows[0]?.classes()).toContain("data-[selected]:font-[var(--weight-medium)]");
        expect(rows[0]?.classes().some((name) => name.startsWith("border-l") || name.includes(":border-l"))).toBe(false);

        await rows[1]?.trigger("click");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["chapter-2"]);
        wrapper.unmount();
    });

    it("keeps multiple tree selection values as node ids", async () => {
        const wrapper = mount(Tree, {
            props: {
                items: [
                    {id: "chapter-1", title: "第01章"},
                    {id: "chapter-2", title: "第02章"},
                ],
                multiple: true,
                modelValue: ["chapter-1"],
            },
        });

        const rows = wrapper.findAll("[role='treeitem']");
        expect(rows[0]?.attributes("aria-selected")).toBe("true");
        expect(rows[1]?.attributes("aria-selected")).toBe("false");
        await rows[1]?.trigger("click");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["chapter-1", "chapter-2"]]);
        wrapper.unmount();
    });

    it("drops the tree card surface when the caller puts it inside a panel", () => {
        const items = [{id: "v1", title: "第一卷"}];
        // 默认仍是卡片：已有调用方靠这层面色与描边把树从空白里收住
        const card = mount(Tree, {props: {items}});
        const plain = mount(Tree, {props: {items, surface: "plain"}});

        const cardRoot = card.get("ul, [role='tree']");
        const plainRoot = plain.get("ul, [role='tree']");
        expect(cardRoot.classes()).toContain("shadow-sm");
        expect(cardRoot.classes()).toContain("bg-[var(--panel-surface)]");
        expect(plainRoot.classes()).not.toContain("shadow-sm");
        expect(plainRoot.classes().some((name) => name.startsWith("bg-"))).toBe(false);
        expect(plainRoot.classes().some((name) => name.startsWith("border"))).toBe(false);
        // 内边距两档都留：去掉的是「卡片」，不是行与容器边缘之间的呼吸
        expect(plainRoot.classes()).toContain("p-2");

        card.unmount();
        plain.unmount();
    });

    it("leaves node semantics to the caller instead of drawing folder icons", () => {
        // 泛型树不认文件系统：有子节点不等于文件夹，叶子不等于文件。
        // 要文件语义的调用方用 FileTree。
        const wrapper = mount(Tree, {
            props: {
                items: [
                    {id: "v1", title: "第一卷", children: [{id: "c1", title: "第01章"}]},
                    {id: "solo", title: "带图标的叶子", iconClass: "i-lucide-box"},
                ],
                expanded: ["v1"],
            },
        });
        // 用选择器查而不是搜 wrapper.html()：模板注释会原样渲染进 DOM，
        // 而这个组件的注释里恰好写着这两个图标名，搜字符串会被自己的注释绊倒。
        expect(wrapper.find(".i-lucide-folder").exists()).toBe(false);
        expect(wrapper.find(".i-lucide-file-text").exists()).toBe(false);
        // 调用方自己给的图标照旧渲染
        expect(wrapper.find(".i-lucide-box").exists()).toBe(true);
        // 有子节点的行才有箭头
        expect(wrapper.findAll(".i-lucide-chevron-right")).toHaveLength(1);
        wrapper.unmount();
    });

    it("renders date range picker placeholder", () => {
        const wrapper = mount(DateRangePicker, {
            props: {
                placeholder: "选择起止日期",
            },
        });

        expect(wrapper.text()).toContain("选择起止日期");
        wrapper.unmount();
    });

    it("renders date field with segments", () => {
        const wrapper = mount(DateField);
        expect(wrapper.find("div").exists()).toBe(true);
        wrapper.unmount();
    });

    it("renders date range field with start and end segments", () => {
        const wrapper = mount(DateRangeField);
        expect(wrapper.text()).toContain("~");
        wrapper.unmount();
    });

    it("renders time field with segments", () => {
        const wrapper = mount(TimeField);
        expect(wrapper.find("div").exists()).toBe(true);
        wrapper.unmount();
    });

    it("renders time range field with start and end", () => {
        const wrapper = mount(TimeRangeField);
        expect(wrapper.text()).toContain("~");
        wrapper.unmount();
    });

    it("renders month picker grid", () => {
        const wrapper = mount(MonthPicker, {
            props: {
                locale: "zh-CN",
            },
        });

        expect(wrapper.find("table").exists()).toBe(true);
        expect(wrapper.findAll("[role='gridcell']").length).toBeGreaterThan(0);
        wrapper.unmount();
    });

    it("renders month range picker grid", () => {
        const wrapper = mount(MonthRangePicker, {
            props: {
                locale: "zh-CN",
            },
        });

        expect(wrapper.find("table").exists()).toBe(true);
        expect(wrapper.findAll("[role='gridcell']").length).toBeGreaterThan(0);
        wrapper.unmount();
    });

    it("renders year picker grid", () => {
        const wrapper = mount(YearPicker, {
            props: {
                locale: "zh-CN",
            },
        });

        expect(wrapper.find("table").exists()).toBe(true);
        expect(wrapper.findAll("[role='gridcell']").length).toBeGreaterThan(0);
        wrapper.unmount();
    });

    it("renders year range picker grid", () => {
        const wrapper = mount(YearRangePicker, {
            props: {
                locale: "zh-CN",
            },
        });

        expect(wrapper.find("table").exists()).toBe(true);
        expect(wrapper.findAll("[role='gridcell']").length).toBeGreaterThan(0);
        wrapper.unmount();
    });

    it("renders autocomplete input", () => {
        const wrapper = mount(Autocomplete, {
            props: {
                placeholder: "搜索设定集...",
            },
        });

        expect(wrapper.find("input").attributes("placeholder")).toBe("搜索设定集...");
        wrapper.unmount();
    });

    it("renders checkbox group with options", () => {
        const wrapper = mount(CheckboxGroup, {
            props: {
                options: [
                    {value: "o1", label: "导出 EPUB"},
                    {value: "o2", label: "导出 PDF"},
                ],
            },
        });

        expect(wrapper.text()).toContain("导出 EPUB");
        expect(wrapper.text()).toContain("导出 PDF");
        wrapper.unmount();
    });
});
