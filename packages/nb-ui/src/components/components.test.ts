import {flushPromises, mount} from "@vue/test-utils";
import {describe, expect, it, vi} from "vitest";
import {defineComponent, h, nextTick, ref} from "vue";
import Button from "./controls/Button.vue";
import IconButton from "./controls/IconButton.vue";
import SegmentedControl from "./controls/SegmentedControl.vue";
import Switch from "./controls/Switch.vue";
import Tabs from "./controls/Tabs.vue";
import ToggleGroup from "./controls/ToggleGroup.vue";
import Toolbar from "./controls/Toolbar.vue";
import Badge from "./display/Badge.vue";
import CodeBlock from "./display/CodeBlock.vue";
import Kbd from "./display/Kbd.vue";
import Progress from "./display/Progress.vue";
import Table from "./display/Table.vue";
import AlertDialog from "./feedback/AlertDialog.vue";
import Banner from "./feedback/Banner.vue";
import Dialog from "./feedback/Dialog.vue";
import Drawer from "./feedback/Drawer.vue";
import Notification from "./feedback/Notification.vue";
import NotificationStack from "./feedback/NotificationStack.vue";
import Popover from "./feedback/Popover.vue";
import Tooltip from "./feedback/Tooltip.vue";
import ContextMenu from "./popup/ContextMenu.vue";
import {clampMenuPosition, computeCascadePosition} from "../utils/popup-geometry";
import Checkbox from "./form/Checkbox.vue";
import Field from "./form/Field.vue";
import Input from "./form/Input.vue";
import NumberInput from "./form/NumberInput.vue";
import Select from "./popup/Select.vue";
import RadioGroup from "./form/RadioGroup.vue";
import Slider from "./form/Slider.vue";
import Collapsible from "./layout/Collapsible.vue";
import CollapsibleCard from "./layout/CollapsibleCard.vue";
import CollapsibleRow from "./layout/CollapsibleRow.vue";
import ScrollArea from "./layout/ScrollArea.vue";
import Separator from "./layout/Separator.vue";
import Splitter from "./layout/Splitter.vue";
import type {SplitterGestureState} from "./layout/splitter-gesture";
import Breadcrumb from "./navigation/Breadcrumb.vue";
import Menubar from "./popup/Menubar.vue";
import CheckboxGroup from "./form/CheckboxGroup.vue";
import Tree from "./navigation/Tree.vue";
import {useNotification} from "../composables/useNotification";

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

    it("passes common input attributes to the native input", () => {
        const wrapper = mount(Input, {
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
            mount(Input, {props: {modelValue: "abc"}}),
            mount(NumberInput, {props: {modelValue: "3"}}),
            mount(Select, {props: {modelValue: "md", options: [{label: "Markdown", value: "md"}]}}),
        ];

        for (const wrapper of wrappers) {
            const control = wrapper.get(".nb-ui-control");
            expect(control.classes()).toContain("nb-ui-control-h-md");
            expect(control.classes()).toContain("nb-ui-control-px");
            wrapper.unmount();
        }
    });

    it("renders the required mark; an error keeps the layout: the description stays and the reason is only for assistive tech", () => {
        const wrapper = mount({
            components: {Field, Input},
            data: () => ({value: ""}),
            template: `
                <Field label="用户名" description="公开显示" required error="已被占用">
                    <Input v-model="value" name="username" />
                </Field>
            `,
        });

        expect(wrapper.text()).toContain("用户名");
        expect(wrapper.text()).toContain("*");
        const description = wrapper.get("[id$='-description']");
        const error = wrapper.get("[id$='-error']");
        expect(description.classes()).not.toContain("sr-only");
        expect(error.text()).toBe("已被占用");
        expect(error.classes()).toContain("sr-only");
        expect(wrapper.get("input").attributes("aria-describedby")).toBe(`${error.attributes("id")} ${description.attributes("id")}`);
    });

    it("connects form field semantics to nested inputs", () => {
        const wrapper = mount({
            components: {Field, Input},
            data: () => ({value: ""}),
            template: `
                <Field label="用户名" description="公开显示" required>
                    <Input v-model="value" name="username" />
                </Field>
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

    it("draws an outer focus ring by default and an inset line on request; IconButton xs is a 24px square", () => {
        const outer = mount(IconButton, {props: {title: "刷新"}}).get("button");
        const inset = mount(IconButton, {props: {title: "刷新", size: "xs", focusRing: "inset"}}).get("button");
        const button = mount(Button, {props: {focusRing: "inset"}, slots: {default: "未保存 2 个"}});

        expect(outer.classes()).toContain("nb-ui-focus-ring");
        expect(outer.classes()).not.toContain("nb-ui-focus-ring-inset");
        expect(inset.classes()).toEqual(expect.arrayContaining(["nb-ui-focus-ring-inset", "h-[24px]", "w-[24px]"]));
        expect(inset.classes()).not.toContain("nb-ui-focus-ring");
        expect(button.classes()).toContain("nb-ui-focus-ring-inset");
        expect(button.classes()).not.toContain("nb-ui-focus-ring");
    });

    it("tabs fill their strip, so their focus is an inset line", async () => {
        const tabs = mount(Tabs, {props: {modelValue: "a", items: [{label: "文档", value: "a"}, {label: "大纲", value: "b"}]}});
        await nextTick();

        for (const tab of tabs.findAll("[role='tab']")) expect(tab.classes()).toContain("nb-ui-focus-ring-inset");
        tabs.unmount();
    });

    it("clips collapsible content only while its height animation runs", async () => {
        const wrapper = mount(Collapsible, {
            props: {defaultOpen: true},
            slots: {trigger: "<button>折叠开关</button>", default: "<div class='inner'>折叠详细说明</div>"},
        });
        await nextTick();
        const content = wrapper.get(".nb-collapsible-content");

        expect(content.classes()).not.toContain("overflow-hidden");
        expect(content.attributes("data-animating")).toBeUndefined();
        content.element.dispatchEvent(new Event("animationstart"));
        expect(content.attributes("data-animating")).toBe("");
        // 里面子元素的动画事件冒上来不算。
        wrapper.get(".inner").element.dispatchEvent(new Event("animationend", {bubbles: true}));
        expect(content.attributes("data-animating")).toBe("");
        content.element.dispatchEvent(new Event("animationend"));
        expect(content.attributes("data-animating")).toBeUndefined();
        wrapper.unmount();
    });

    it("collapsible row: only expandable rows are buttons; toggle asks for the opposite state; content shows only when expanded", async () => {
        const fixed = mount(CollapsibleRow, {props: {icon: "i-lucide-file", label: "读取", detail: "第三章.md"}, slots: {default: "<p class='inner'>内容</p>"}});
        expect(fixed.find("button").exists()).toBe(false);
        expect(fixed.find(".inner").exists()).toBe(false);

        const row = mount(CollapsibleRow, {props: {icon: "i-lucide-file", label: "读取", expanded: false}, slots: {default: "<p class='inner'>内容</p>"}});
        expect(row.get("button").attributes("aria-expanded")).toBe("false");
        // 行常常填满所在的列表，焦点画成内嵌线。
        expect(row.get("button").classes()).toContain("nb-ui-focus-ring-inset");
        await row.get("button").trigger("click");
        expect(row.emitted("update:expanded")).toEqual([[true]]);
        expect(row.find(".inner").exists()).toBe(false);
        await row.setProps({expanded: true});
        expect(row.get(".inner").text()).toBe("内容");
    });

    it("collapsible row: a zero side is hidden when the other side changed; the spinner takes the given label", () => {
        const stat = (added: number | null, removed: number | null) => mount(CollapsibleRow, {props: {icon: "i-lucide-file-pen", label: "改", stat: {added, removed}}}).text();
        expect(stat(3, 0)).toContain("+3");
        expect(stat(3, 0)).not.toContain("-0");
        expect(stat(0, 0)).toContain("+0");
        expect(stat(0, 0)).toContain("-0");
        expect(stat(null, 2)).toBe("改-2");
        const running = mount(CollapsibleRow, {props: {icon: "i-lucide-file", label: "读取", status: "running", runningLabel: "Running"}});
        expect(running.get("[role=status]").attributes("aria-label")).toBe("Running");
        const fallback = mount(CollapsibleRow, {props: {icon: "i-lucide-file", label: "读取", status: "running"}});
        expect(fallback.get("[role=status]").attributes("aria-label")).toBe("加载中");
    });

    it("collapsible card: the head toggles, actions do not; the body is always shown when not collapsible", async () => {
        const card = mount(CollapsibleCard, {
            props: {icon: "i-lucide-terminal", title: "运行命令", subtitle: "ls", expanded: false},
            slots: {default: "<p class='body'>输出</p>", actions: "<button class='copy'>复制</button>"},
        });
        await card.get(".copy").trigger("click");
        expect(card.emitted("update:expanded")).toBeUndefined();
        expect(card.get("button[aria-expanded]").classes()).toContain("nb-ui-focus-ring-inset");
        await card.get("button[aria-expanded]").trigger("click");
        expect(card.emitted("update:expanded")).toEqual([[true]]);
        expect(card.find(".body").exists()).toBe(false);

        const open = mount(CollapsibleCard, {props: {icon: "i-lucide-terminal", title: "运行命令"}, slots: {default: "<p class='body'>输出</p>"}});
        expect(open.find("button").exists()).toBe(false);
        expect(open.get(".body").text()).toBe("输出");
    });

    it("code block: marks added and removed lines, numbers from startLine, and shows the given empty and truncated texts", () => {
        const block = mount(CodeBlock, {props: {lines: [{text: "a"}, {text: "b", tone: "added"}, {text: "c", tone: "removed"}], startLine: 10, truncated: true, truncatedText: "Partial"}});
        const lines = block.findAll(".nb-code-block__line").map((line) => line.text());
        expect(lines).toEqual(["10a", "11+b", "12-c"]);
        expect(block.get(".nb-code-block__note").text()).toBe("Partial");
        expect(mount(CodeBlock, {props: {lines: [], emptyText: "Empty"}}).text()).toBe("Empty");
    });

    it("renders segmented control as a labelled radio group: one item checked, no toggle-button state", () => {
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
        const group = wrapper.get("[role='radiogroup']");

        expect(group.attributes("aria-label")).toBe("视图");
        const items = wrapper.findAll("button");
        expect(items.map((item) => [item.attributes("role"), item.attributes("aria-checked")])).toEqual([["radio", "true"], ["radio", "false"]]);
        expect(items.some((item) => item.attributes("aria-pressed") !== undefined)).toBe(false);
    });

    it("segmented control without a matching value still has one tab stop and arrows start from the ends", async () => {
        const options = [
            {label: "随窗口", value: "free"},
            {label: "平板", value: "tablet"},
            {label: "手机", value: "phone"},
        ];
        const wrapper = mount(SegmentedControl, {props: {modelValue: null, options}});
        const buttons = wrapper.findAll("button");

        expect(buttons.map((button) => button.attributes("aria-checked"))).toEqual(["false", "false", "false"]);
        expect(buttons.map((button) => button.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);

        await buttons[0]!.trigger("keydown", {key: "ArrowLeft"});
        await buttons[0]!.trigger("keydown", {key: "ArrowRight"});
        expect(wrapper.emitted("update:modelValue")).toEqual([["phone"], ["free"]]);
        wrapper.unmount();
    });

    it("segmented control: 上下键与左右键一样移动，Home、End 到首末项，跳过停用项并循环", async () => {
        const options = [
            {label: "随窗口", value: "free"},
            {label: "平板", value: "tablet", disabled: true},
            {label: "手机", value: "phone"},
            {label: "桌面", value: "desktop"},
        ];
        const wrapper = mount(SegmentedControl, {props: {modelValue: "free", options}});
        const root = wrapper.get("[role='radiogroup']");
        for (const key of ["ArrowDown", "ArrowRight", "ArrowUp", "End", "Home", "ArrowLeft"]) {
            await root.trigger("keydown", {key});
            await wrapper.setProps({modelValue: wrapper.emitted<[string]>("update:modelValue")!.at(-1)![0]});
        }
        expect(wrapper.emitted("update:modelValue")).toEqual([["phone"], ["desktop"], ["phone"], ["desktop"], ["free"], ["desktop"]]);
        wrapper.unmount();
    });

    it("segmented control takes icon-only options named by title", () => {
        const wrapper = mount(SegmentedControl, {
            props: {modelValue: "tree", options: [{value: "text", iconClass: "i-lucide-file-json-2", title: "文本"}, {value: "tree", iconClass: "i-lucide-git-branch", title: "树形"}]},
        });
        const buttons = wrapper.findAll("button");

        expect(buttons.map((button) => button.attributes("aria-label"))).toEqual(["文本", "树形"]);
        expect(buttons.map((button) => button.text())).toEqual(["", ""]);
        expect(buttons[1]!.attributes("aria-checked")).toBe("true");
        wrapper.unmount();
    });

    it("banner: actions slot holds several buttons, error is announced as alert, icon can be replaced, dismiss only emits", async () => {
        const wrapper = mount(Banner, {
            props: {tone: "danger", message: "磁盘上的文件已被修改。", iconClass: "i-lucide-refresh-cw", dismissible: true, closeLabel: "知道了"},
            slots: {actions: "<button data-a>重新载入</button><button data-b>覆盖</button>"},
        });

        expect(wrapper.attributes("role")).toBe("alert");
        expect(wrapper.find("[data-a]").exists()).toBe(true);
        expect(wrapper.find("[data-b]").exists()).toBe(true);
        expect(wrapper.find(".i-lucide-refresh-cw").exists()).toBe(true);
        expect(wrapper.find(".i-lucide-circle-x").exists()).toBe(false);

        await wrapper.get("[aria-label='知道了']").trigger("click");
        expect(wrapper.emitted("dismiss")).toHaveLength(1);
        expect(wrapper.exists()).toBe(true);
        wrapper.unmount();
    });

    it("banner without actions or close button renders only the message as status", () => {
        const wrapper = mount(Banner, {props: {tone: "warning", message: "已与服务端断开。"}});

        expect(wrapper.attributes("role")).toBe("status");
        expect(wrapper.text()).toBe("已与服务端断开。");
        expect(wrapper.findAll("button")).toHaveLength(0);
        expect(wrapper.find(".i-lucide-alert-triangle").exists()).toBe(true);
        wrapper.unmount();
    });

    it("renders notifications with theme tone classes", () => {
        const notification = useNotification();
        const id = notification.success("保存成功");
        const wrapper = mount(NotificationStack, {
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
        const wrapper = mount(Checkbox, {
            props: {modelValue: false, label: "接收通知"},
        });
        const input = wrapper.get("input");

        expect(input.classes()).toContain("peer");
        await input.setValue(true);
        expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([true]);
    });

    it("passes form field semantics to checkboxes", () => {
        const wrapper = mount({
            components: {Checkbox, Field},
            data: () => ({value: false}),
            template: `
                <Field label="许可" description="用于测试" required>
                    <Checkbox v-model="value" label="同意" name="agree" />
                </Field>
            `,
        });
        const input = wrapper.get("input");
        const description = wrapper.get("[id$='-description']");

        expect(input.attributes("required")).toBeDefined();
        expect(input.attributes("aria-describedby")).toBe(description.attributes("id"));
    });

    it("shows danger border on inputs inside an errored form field", () => {
        const wrapper = mount({
            components: {Field, Input},
            data: () => ({value: ""}),
            template: `
                <Field label="用户名" error="必填">
                    <Input v-model="value" name="username" />
                </Field>
            `,
        });
        const input = wrapper.get("input");

        expect(input.attributes("aria-invalid")).toBe("true");
        expect(input.classes()).toContain("nb-ui-control-invalid");
    });

    /*
     * Select 从原生 <select> 换成 Reka Select 原语（Task 146 批 4）。
     * 原生 select 的弹出列表由操作系统绘制，任何 CSS 都够不着，主题只能做到控件本身为止。
     *
     * 换实现最容易悄悄丢掉的是**契约**，所以这几条盯的都是契约不是外观：
     * 触发器仍然接 Field 的 id / describedby / invalid，仍然吐 update:modelValue，
     * 且弹出层必须是页面内的 DOM——那正是原生实现做不到的那件事。
     */
    describe("form select", () => {
        it("no longer renders a native select the theme cannot reach into", () => {
            const wrapper = mount(Select, {
                props: {modelValue: "md", options: [{label: "Markdown", value: "md"}]},
            });

            expect(wrapper.find("select").exists()).toBe(false);
            // 触发器仍是可聚焦的按钮语义，键盘用户拿得到
            expect(wrapper.get("[role='combobox']").attributes("aria-expanded")).toBeDefined();
        });

        it("shows the label of the current value rather than the raw value", () => {
            const wrapper = mount(Select, {
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
            const wrapper = mount(Select, {
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

        it("打开后键入首字母，焦点跳到以它开头的选项（reka 靠名称格的 SelectItemText 登记文字）", async () => {
            const wrapper = mount(Select, {
                props: {
                    modelValue: "md",
                    options: [
                        {label: "Markdown", value: "md"},
                        {label: "Text", value: "txt"},
                        {label: "PDF", value: "pdf"},
                    ],
                },
                attachTo: document.body,
            });
            await wrapper.get("[role='combobox']").trigger("keydown", {key: "Enter"});
            await flushPromises();
            const focusedBefore = document.activeElement?.getAttribute("role");
            document.querySelector("[role='listbox']")?.dispatchEvent(new KeyboardEvent("keydown", {key: "p", bubbles: true, cancelable: true}));
            await flushPromises();
            expect([focusedBefore, document.activeElement?.textContent?.trim()]).toEqual(["option", "PDF"]);
            wrapper.unmount();
        });

        it("takes every item's corner radius from the popover registry, not from an atom class", async () => {
            /*
             * 用户的原话是「他的宽度和圆角没有对齐」。根因是**同心不成立**：
             * 项写死 rounded-md（6px），而外框在 nbook 下是 20px、内边距 6px——
             * 直边上项与框之间有 6px 留白，绕到角上只剩不到 1px，两条弧线根本不平行。
             *
             * 所以这条盯的不是「圆角等于几」（那是主题的事），而是**取值从哪来**：
             * 项必须挂 .nb-ui-menu-item，由它从 --nb-popover-inner-radius 推出来。
             * 谁把 rounded-* 加回模板，这条就红——那类原子类还会被排在 utilities 之后的
             * .nb-ui-menu-item 压掉，写了也不生效，是一处「看代码以为改了其实没改」。
             *
             * 禁用项一起验：用户正是指着「PDF（暂不可用）」这一行说的，它和普通项走同一套几何。
             */
            const wrapper = mount(Select, {
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
                expect([...option.classList], option.textContent ?? "").toContain("nb-ui-menu-item");
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
            const wrapper = mount(Select, {
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
                components: {Field, Select},
                data: () => ({value: "md"}),
                template: `
                    <Field label="导出格式" error="必填">
                        <Select v-model="value" name="format" :options="[{label: 'Markdown', value: 'md'}]" />
                    </Field>
                `,
            });
            const trigger = wrapper.get("[role='combobox']");

            expect(trigger.attributes("aria-invalid")).toBe("true");
            expect(trigger.classes()).toContain("nb-ui-control-invalid");
            expect(trigger.attributes("id")).toBe(wrapper.get("label").attributes("for"));
        });

        it("emits a string when the value changes, never undefined", async () => {
            const wrapper = mount(Select, {
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

describe("nb-ui new primitives", () => {
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

    it("tabs: 左方向键在首个标签上回绕到最后一个可用标签，Home、End 到首末可用标签", async () => {
        const wrapper = mount(Tabs, {
            props: {modelValue: "a", items: [{value: "a", label: "A"}, {value: "b", label: "B"}, {value: "c", label: "C", disabled: true}]},
            attachTo: document.body,
        });
        const tablist = wrapper.get("[role='tablist']");
        await tablist.trigger("keydown", {key: "ArrowLeft"});
        await tablist.trigger("keydown", {key: "End"});
        await tablist.trigger("keydown", {key: "Home"});
        expect(wrapper.emitted("update:modelValue")).toEqual([["b"], ["b"], ["a"]]);
        wrapper.unmount();
    });

    it("当前值不对应任何标签时，右方向键选第一个可用标签、左方向键选最后一个", async () => {
        const wrapper = mount(Tabs, {
            props: {modelValue: "", items: [{value: "a", label: "A"}, {value: "b", label: "B"}, {value: "c", label: "C", disabled: true}]},
            attachTo: document.body,
        });
        const tablist = wrapper.get("[role='tablist']");
        await tablist.trigger("keydown", {key: "ArrowRight"});
        await tablist.trigger("keydown", {key: "ArrowLeft"});
        expect(wrapper.emitted("update:modelValue")).toEqual([["a"], ["b"]]);
        wrapper.unmount();
    });

    it("writes per-tab attrs without overriding the attributes the component owns", () => {
        const wrapper = mount(Tabs, {
            props: {
                modelValue: "a",
                items: [
                    {value: "a", label: "A", attrs: {"data-drag": "a", role: "button"}},
                    {value: "b", label: "B"},
                ],
            },
            attachTo: document.body,
        });
        const tabs = wrapper.findAll("[role='tab']");
        // 组件自己管的属性不被覆盖。
        expect(tabs[0]?.attributes("data-drag")).toBe("a");
        expect(tabs[0]?.attributes("role")).toBe("tab");
        expect(tabs[1]?.attributes("data-drag")).toBeUndefined();
        wrapper.unmount();
    });

    it("draws the tabs baseline unless baseline is false; the selected indicator stays either way", () => {
        const items = [{value: "a", label: "A"}, {value: "b", label: "B"}];
        const lined = mount(Tabs, {props: {modelValue: "a", items}});
        const bare = mount(Tabs, {props: {modelValue: "a", items, baseline: false}});
        expect(lined.get("[role='tablist']").classes()).toContain("border-b-[length:var(--border-w)]");
        expect(bare.get("[role='tablist']").classes()).not.toContain("border-b-[length:var(--border-w)]");
        expect(bare.get("[role='tab']").classes().filter((name) => name.startsWith("after:"))).toEqual(lined.get("[role='tab']").classes().filter((name) => name.startsWith("after:")));
        lined.unmount();
        bare.unmount();
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
        // mount 无法从 props 推断泛型 Row，用宿主模板组件挂载（与本文件 Field 测试同风格）
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

    it("aligns the first child with its parent and leaves a gap", () => {
        const anchor = {top: 100, left: 300, right: 480, bottom: 132};
        expect(computeCascadePosition(anchor, {width: 180, height: 200}, viewport)).toEqual({x: 486, y: 100});
    });

    it("flips the submenu to the left on right overflow", () => {
        const anchor = {top: 100, left: 700, right: 880, bottom: 132};
        expect(computeCascadePosition(anchor, {width: 180, height: 200}, viewport)).toEqual({x: 514, y: 100});
    });

    it("clamps the submenu when neither side fits", () => {
        const anchor = {top: 700, left: 300, right: 480, bottom: 732};
        expect(computeCascadePosition(anchor, {width: 180, height: 200}, viewport)).toEqual({x: 486, y: 592});
    });
    it("opens a third-level context menu and runs its action", async () => {
        const action = vi.fn();
        const wrapper = mount(ContextMenu, {
            attachTo: document.body,
            props: {
                visible: true,
                x: 20,
                y: 20,
                items: [{label: "一级", children: [{label: "二级", children: [{label: "三级", action}]}]}],
            },
        });
        await nextTick();
        vi.useFakeTimers();
        document.querySelector<HTMLElement>("[role=menuitem]")!.dispatchEvent(new MouseEvent("mouseenter", {bubbles: true}));
        await vi.advanceTimersByTimeAsync(300);
        await nextTick();
        [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.includes("二级"))!.dispatchEvent(new MouseEvent("mouseenter", {bubbles: true}));
        await vi.advanceTimersByTimeAsync(300);
        await nextTick();
        vi.useRealTimers();
        const leaf = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent?.includes("三级"));
        expect(leaf).toBeTruthy();
        leaf!.click();
        expect(action).toHaveBeenCalledOnce();
        expect(wrapper.emitted("close")).toHaveLength(1);
        wrapper.unmount();
    });
});

describe("nb-ui a11y round", () => {
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

describe("nb-ui dialog window (Dialog modal=false)", () => {
    function mountWindow(props: Record<string, unknown> = {}, header?: string) {
        return mount(Dialog, {
            props: {
                modelValue: true,
                modal: false,
                closable: true,
                showFooter: false,
                title: "浮动窗口",
                teleportTarget: false,
                ...props,
            },
            slots: {
                ...(header === undefined ? {} : {header}),
                default: "<button>窗口内容</button>",
            },
            attachTo: document.body,
        });
    }

    it("renders as a non-modal dialog without an overlay and labels the default title", async () => {
        const wrapper = mountWindow();
        try {
            await nextTick();

            const dialog = wrapper.get("[role='dialog']");
            const titleId = dialog.attributes("aria-labelledby");
            expect(titleId).toBeTruthy();
            expect(wrapper.find("[data-dialog-overlay]").exists()).toBe(false);
            expect(wrapper.find(".i-lucide-grip-vertical").exists()).toBe(false);
            expect(dialog.text()).toContain("窗口内容");
        } finally {
            wrapper.unmount();
        }
    });

    it("shows a window mounted already open and teleported to body, and again after reopening", async () => {
        // 传送到 body 时 reka 的 Teleport 挂载后才渲染内容：面板比“打开”晚一拍出现，定位要等到面板挂上。
        const wrapper = mountWindow({teleportTarget: undefined});
        const visibility = (): string | undefined => document.querySelector<HTMLElement>("[data-dialog-surface]")?.style.visibility;
        try {
            await flushPromises();
            expect(visibility()).toBe("");
            await wrapper.setProps({modelValue: false});
            await flushPromises();
            await wrapper.setProps({modelValue: true});
            await flushPromises();
            expect(visibility()).toBe("");
        } finally {
            wrapper.unmount();
        }
    });

    it("keeps the title left aligned with no centering placeholder", async () => {
        const wrapper = mountWindow({}, "<span>Agent Profile 设置</span>");
        try {
            await nextTick();
            const titleWrapper = wrapper.get("[role='dialog']").element.querySelector(".cursor-move");
            expect(titleWrapper?.className).not.toContain("text-center");
            // 左对齐不再为居中放占位块：标题栏第一个子元素就是可拖动区
            const titleBar = titleWrapper?.parentElement;
            expect(titleBar?.firstElementChild).toBe(titleWrapper);
        } finally {
            wrapper.unmount();
        }
    });

    it("keeps a custom header accessible through DialogTitle", async () => {
        const wrapper = mountWindow({}, "<span>自定义标题</span>");
        try {
            await nextTick();

            const dialog = wrapper.get("[role='dialog']");
            const titleId = dialog.attributes("aria-labelledby");
            expect(document.getElementById(titleId ?? "")?.textContent).toContain("自定义标题");
        } finally {
            wrapper.unmount();
        }
    });

    it("takes an explicit CSS width and height as given", async () => {
        // 预设与数字宽度都写成 min(…, calc(100cqw - 32px))，happy-dom 解析不了 cqw，会整条丢掉；
        // 它们按容器收窄在真实浏览器里验（lab-nb-ui.e2e.ts）。这里只验显式的 CSS 长度原样落到面板上。
        const wrapper = mountWindow({width: "480px", height: "400px"});
        await nextTick();
        const style = (wrapper.get("[data-dialog-window]").element as HTMLElement).style;
        expect({width: style.width, height: style.height}).toEqual({width: "480px", height: "400px"});
        wrapper.unmount();
    });

    it("does not close from outside interaction in non-modal mode", async () => {
        const wrapper = mountWindow();
        try {
            await nextTick();

            document.body.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true}));
            expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        } finally {
            wrapper.unmount();
        }
    });

    it("exposes edge and corner resize handles and updates width from keyboard", async () => {
        const wrapper = mountWindow({resizable: true, width: 560, minWidth: 320});
        try {
            await nextTick();

            expect(wrapper.findAll("[data-dialog-resize]").map((handle) => handle.attributes("data-dialog-resize"))).toEqual([
                "right",
                "bottom",
                "bottom-right",
                "bottom-left",
                "top-right",
                "top-left",
            ]);
            const handle = wrapper.get("[data-dialog-resize='right']");
            await handle.trigger("keydown", {key: "ArrowRight"});
            expect(wrapper.emitted("update:width")?.at(-1)).toEqual([570]);
        } finally {
            wrapper.unmount();
        }
    });
    it("updates height from the bottom handle keyboard and respects the minimum", async () => {
        const wrapper = mountWindow({resizable: true, height: "240px", minHeight: 240});
        try {
            await nextTick();

            const handle = wrapper.get("[data-dialog-resize='bottom']");
            await handle.trigger("keydown", {key: "ArrowUp"});
            expect(wrapper.emitted("update:height")).toBeUndefined();
            await handle.trigger("keydown", {key: "ArrowDown"});
            expect(wrapper.emitted("update:height")?.at(-1)).toEqual([250]);
        } finally {
            wrapper.unmount();
        }
    });

    it("updates width and height from pointer resize and commits on pointerup", async () => {
        const wrapper = mountWindow({resizable: true, width: 560, height: "400px"});
        try {
            await nextTick();

            const handle = wrapper.get("[data-dialog-resize='bottom-right']").element;
            handle.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, clientX: 100, clientY: 100, pointerId: 1}));
            handle.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, clientX: 140, clientY: 130, pointerId: 1}));
            handle.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, clientX: 140, clientY: 130, pointerId: 1}));

            expect(wrapper.emitted("update:width")?.at(-1)).toEqual([600]);
            expect(wrapper.emitted("update:height")?.at(-1)).toEqual([430]);
        } finally {
            wrapper.unmount();
        }
    });

    it("grows upwards and leftwards when dragging the top-left corner", async () => {
        const wrapper = mountWindow({resizable: true, width: 560, height: "400px", minWidth: 320, minHeight: 240});
        try {
            await nextTick();
            const windowElement = wrapper.get("[data-dialog-window]").element as HTMLElement;
            const startLeft = Number.parseFloat(windowElement.style.left);
            const startTop = Number.parseFloat(windowElement.style.top);

            const handle = wrapper.get("[data-dialog-resize='top-left']").element;
            handle.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, clientX: 300, clientY: 300, pointerId: 1}));
            handle.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, clientX: 260, clientY: 270, pointerId: 1}));
            handle.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, clientX: 260, clientY: 270, pointerId: 1}));

            // 左上角拖动：尺寸变大，同时窗口的 left / top 跟着边界走
            expect(wrapper.emitted("update:width")?.at(-1)).toEqual([600]);
            expect(wrapper.emitted("update:height")?.at(-1)).toEqual([430]);
            await nextTick();
            expect(Number.parseFloat(windowElement.style.left)).toBeLessThan(startLeft);
            expect(Number.parseFloat(windowElement.style.top)).toBeLessThan(startTop);
        } finally {
            wrapper.unmount();
        }
    });

    it("clamps a top-left drag at the minimum size without drifting the position", async () => {
        const wrapper = mountWindow({resizable: true, width: 360, height: "300px", minWidth: 320, minHeight: 240});
        try {
            await nextTick();
            const windowElement = wrapper.get("[data-dialog-window]").element as HTMLElement;
            const startLeft = Number.parseFloat(windowElement.style.left);
            const startTop = Number.parseFloat(windowElement.style.top);

            const handle = wrapper.get("[data-dialog-resize='top-left']").element;
            handle.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, clientX: 300, clientY: 300, pointerId: 1}));
            handle.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, clientX: 900, clientY: 300, pointerId: 1}));
            handle.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, clientX: 900, clientY: 300, pointerId: 1}));

            // 远超出最小尺寸的拖动停在 minWidth，不会继续变小，位置也只走这一段
            expect(wrapper.emitted("update:width")?.at(-1)).toEqual([320]);
            await nextTick();
            expect(Number.parseFloat(windowElement.style.left)).toBe(startLeft + 40);
            expect(Number.parseFloat(windowElement.style.top)).toBe(startTop);
        } finally {
            wrapper.unmount();
        }
    });

    /** 在 `target` 上按下、移动 (dx, dy)、松开，返回窗口的位移；按下与移动都是冒泡的真实 pointer 事件。 */
    async function dragFrom(wrapper: ReturnType<typeof mountWindow>, target: Element, dx: number, dy: number): Promise<{dx: number; dy: number}> {
        const windowElement = wrapper.get("[data-dialog-window]").element as HTMLElement;
        const before = {left: Number.parseFloat(windowElement.style.left), top: Number.parseFloat(windowElement.style.top)};
        target.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, button: 0, clientX: 200, clientY: 200, pointerId: 1}));
        windowElement.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, clientX: 200 + dx, clientY: 200 + dy, pointerId: 1}));
        windowElement.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, clientX: 200 + dx, clientY: 200 + dy, pointerId: 1}));
        await nextTick();
        return {dx: Number.parseFloat(windowElement.style.left) - before.left, dy: Number.parseFloat(windowElement.style.top) - before.top};
    }

    it("drags from the panel's blank space, the whole title bar and marked content regions", async () => {
        const wrapper = mount(Dialog, {
            props: {modelValue: true, modal: false, closable: true, showFooter: false, title: "浮动窗口", teleportTarget: false},
            slots: {
                "header-extra": "<span data-test-header-blank>头部空白</span>",
                default: "<div data-dialog-drag><span data-test-region-text>可拖的标题</span></div><p data-test-plain>正文</p>",
            },
            attachTo: document.body,
        });
        try {
            await nextTick();
            const panel = wrapper.get("[data-dialog-window]").element;
            expect(await dragFrom(wrapper, panel, 30, 20)).toEqual({dx: 30, dy: 20});
            expect(await dragFrom(wrapper, wrapper.get("[data-dialog-body]").element, 5, 5)).toEqual({dx: 5, dy: 5});
            expect(await dragFrom(wrapper, wrapper.get("[data-test-header-blank]").element, 10, 10)).toEqual({dx: 10, dy: 10});
            expect(await dragFrom(wrapper, wrapper.get("[data-test-region-text]").element, -15, 5)).toEqual({dx: -15, dy: 5});
            // 正文里没标的地方照常选字、点击，不拖
            expect(await dragFrom(wrapper, wrapper.get("[data-test-plain]").element, 40, 40)).toEqual({dx: 0, dy: 0});
        } finally {
            wrapper.unmount();
        }
    });

    it("does not drag from buttons, inputs and role=button inside a drag region, nor below the 3px threshold", async () => {
        const wrapper = mount(Dialog, {
            props: {modelValue: true, modal: false, closable: true, showFooter: false, title: "浮动窗口", teleportTarget: false},
            slots: {default: "<div data-dialog-drag><span data-test-blank>空白</span><button data-test-button>操作</button><input data-test-input /><span role=\"button\" data-test-role-button>自画的按钮</span></div>"},
            attachTo: document.body,
        });
        try {
            await nextTick();
            expect(await dragFrom(wrapper, wrapper.get("[data-test-button]").element, 30, 30)).toEqual({dx: 0, dy: 0});
            expect(await dragFrom(wrapper, wrapper.get("[data-test-input]").element, 30, 30)).toEqual({dx: 0, dy: 0});
            expect(await dragFrom(wrapper, wrapper.get("[aria-label='关闭']").element, 30, 30)).toEqual({dx: 0, dy: 0});
            expect(await dragFrom(wrapper, wrapper.get("[data-test-role-button]").element, 30, 30)).toEqual({dx: 0, dy: 0});
            // 没超过 3px 的移动是一次点击，窗口不动
            expect(await dragFrom(wrapper, wrapper.get("[data-test-blank]").element, 2, 0)).toEqual({dx: 0, dy: 0});
            expect(await dragFrom(wrapper, wrapper.get("[data-test-blank]").element, 4, 0)).toEqual({dx: 4, dy: 0});
        } finally {
            wrapper.unmount();
        }
    });

    it("puts the close button in the corner when there is no title bar and keeps the title as the accessible name", async () => {
        const wrapper = mountWindow({showHeader: false});
        try {
            await nextTick();
            const dialog = wrapper.get("[role='dialog']");
            expect(wrapper.find("header").exists()).toBe(false);
            expect(document.getElementById(dialog.attributes("aria-labelledby") ?? "")?.textContent).toBe("浮动窗口");
            await wrapper.get("[aria-label='关闭']").trigger("click");
            expect(wrapper.emitted("request-close")).toEqual([["close-button"]]);
        } finally {
            wrapper.unmount();
        }
    });

    it("does not resize or close while busy", async () => {
        const wrapper = mountWindow({busy: true, resizable: true});
        try {
            await nextTick();

            await wrapper.get("[data-dialog-resize='right']").trigger("keydown", {key: "ArrowRight"});
            await wrapper.get("[aria-label='关闭']").trigger("click");
            expect(wrapper.emitted("update:width")).toBeUndefined();
            expect(wrapper.emitted("request-close")).toBeUndefined();
            expect(wrapper.emitted("update:modelValue")).toBeUndefined();
        } finally {
            wrapper.unmount();
        }
    });
    it("raises Select popovers above the window surface", async () => {
        const wrapper = mount(Dialog, {
            props: {modelValue: true, modal: false, showFooter: false, title: "设置", teleportTarget: false},
            slots: {
                default: () => h(Select, {
                    modelValue: "one",
                    options: [{label: "第一项", value: "one"}, {label: "第二项", value: "two"}],
                }),
            },
            attachTo: document.body,
        });
        try {
            await nextTick();
            await wrapper.get("[role='combobox']").trigger("keydown", {key: "Enter"});
            await nextTick();
            await nextTick();

            expect(document.querySelector(".nb-ui-menu-surface")?.getAttribute("style")).toContain("z-index: 8991");
        } finally {
            wrapper.unmount();
        }
    });

    it("stacks a window opened from a window above it, popovers included", async () => {
        const wrapper = mount(Dialog, {
            props: {modelValue: true, modal: false, showFooter: false, title: "设置", teleportTarget: false},
            slots: {
                default: () => h(Dialog, {
                    modelValue: true,
                    modal: false,
                    showFooter: false,
                    title: "编辑模型",
                    teleportTarget: false,
                    width: 600,
                }, {
                    default: () => h(Select, {
                        modelValue: "one",
                        options: [{label: "第一项", value: "one"}, {label: "第二项", value: "two"}],
                    }),
                }),
            },
            attachTo: document.body,
        });
        try {
            await nextTick();

            const surfaces = wrapper.findAll("[data-dialog-surface]").map((node) => node.attributes("style") ?? "");
            expect(surfaces).toHaveLength(2);
            expect(surfaces[0]).toContain("z-index: 8990");
            expect(surfaces[1]).toContain("z-index: 8992");

            // 内层窗口自己的下拉必须压过内层窗口本体，否则下拉会被同层的下拉遮住
            await wrapper.get("[role='combobox']").trigger("keydown", {key: "Enter"});
            await nextTick();
            await nextTick();

            expect(document.querySelector(".nb-ui-menu-surface")?.getAttribute("style")).toContain("z-index: 8993");
        } finally {
            wrapper.unmount();
        }
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
        expect(rows[0]?.classes()).toContain("data-[selected]:[font-weight:var(--weight-medium)]");
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

    it("leaves node semantics to the caller instead of drawing folder icons", async () => {
        // 泛型树不认文件系统：有子节点不等于文件夹，叶子不等于文件。
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
        // 有子节点的行才有箭头；展开与收起是两个图标，不是把同一个转 90°
        expect(wrapper.findAll(".i-lucide-chevron-down")).toHaveLength(1);
        expect(wrapper.findAll(".i-lucide-chevron-right")).toHaveLength(0);

        await wrapper.setProps({expanded: []});
        expect(wrapper.findAll(".i-lucide-chevron-right")).toHaveLength(1);
        expect(wrapper.findAll(".i-lucide-chevron-down")).toHaveLength(0);
        wrapper.unmount();
    });

    it("renders popover triggers cleanly", () => {
        const popoverWrapper = mount(Popover, {
            slots: {
                trigger: "<button>打开气泡</button>",
                default: "<div>气泡内容</div>",
            },
        });
        expect(popoverWrapper.text()).toContain("打开气泡");
        popoverWrapper.unmount();
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
            const content = document.querySelector(".nb-ui-tooltip-surface");
            expect(content).toBeDefined();
            expect(content?.querySelector("svg")).toBeNull();
            expect(content?.getAttribute("data-side")).toBeTruthy();

            // disableClosingTrigger：说明性提示不被左键点击打断
            await wrapper.get("button").trigger("click");
            await nextTick();
            expect(document.body.textContent).toContain("悬停提示内容");
            wrapper.unmount();
        } finally {
            vi.useRealTimers();
        }
    });

    it("closes when it becomes disabled and stays closed while disabled", async () => {
        const wrapper = mount(Tooltip, {
            props: {text: "旁边开了面板"},
            slots: {default: "<button type='button'>自定义</button>"},
            attachTo: document.body,
        });

        await wrapper.get("button").trigger("focus");
        await nextTick();
        await nextTick();
        expect(document.body.textContent).toContain("旁边开了面板");

        await wrapper.setProps({disabled: true});
        await nextTick();
        await nextTick();
        expect(document.body.textContent).not.toContain("旁边开了面板");
        await wrapper.get("button").trigger("blur");
        await wrapper.get("button").trigger("focus");
        await nextTick();
        await nextTick();
        expect(document.body.textContent).not.toContain("旁边开了面板");
        wrapper.unmount();
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

    describe("Tooltip forceOpen", () => {
        const TEXT = "强制显示的提示";
        const mountTooltip = (forceOpen: boolean) => mount(Tooltip, {
            props: {text: TEXT, forceOpen, delay: 0},
            slots: {default: "<button type='button'>触发器</button>"},
            attachTo: document.body,
        });
        const settle = async (): Promise<void> => {
            await nextTick();
            await nextTick();
        };
        const pressEscape = (): void => {
            document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        };

        it("shows without hover or focus, and keeps showing after the pointer leaves", async () => {
            const wrapper = mountTooltip(true);
            await settle();
            expect(document.body.textContent).toContain(TEXT);

            await wrapper.get("button").trigger("pointermove");
            await wrapper.get("button").trigger("pointerleave");
            await wrapper.get("button").trigger("focus");
            await wrapper.get("button").trigger("blur");
            await settle();
            expect(document.body.textContent).toContain(TEXT);
            wrapper.unmount();
        });

        it("closes on Escape and stays closed until forceOpen turns false and true again", async () => {
            const wrapper = mountTooltip(true);
            await settle();
            expect(document.body.textContent).toContain(TEXT);

            pressEscape();
            await settle();
            expect(document.body.textContent).not.toContain(TEXT);

            // 条件一直成立时不会自己再冒出来，指针离开也不会把它带回
            await wrapper.get("button").trigger("pointerleave");
            await settle();
            expect(document.body.textContent).not.toContain(TEXT);

            await wrapper.setProps({forceOpen: false});
            await settle();
            expect(document.body.textContent).not.toContain(TEXT);

            await wrapper.setProps({forceOpen: true});
            await settle();
            expect(document.body.textContent).toContain(TEXT);
            wrapper.unmount();
        });

        it("Escape on a hover or focus opened tooltip does not swallow a later forced show", async () => {
            const wrapper = mountTooltip(false);
            await wrapper.get("button").trigger("focus");
            await settle();
            expect(document.body.textContent).toContain(TEXT);

            pressEscape();
            await settle();
            expect(document.body.textContent).not.toContain(TEXT);

            await wrapper.get("button").trigger("blur");
            await wrapper.setProps({forceOpen: true});
            await settle();
            expect(document.body.textContent).toContain(TEXT);
            wrapper.unmount();
        });

        it("keeps hover and focus behaviour when not forced", async () => {
            const wrapper = mountTooltip(false);
            await settle();
            expect(document.body.textContent).not.toContain(TEXT);

            await wrapper.get("button").trigger("focus");
            await settle();
            expect(document.body.textContent).toContain(TEXT);
            await wrapper.get("button").trigger("blur");
            await settle();
            expect(document.body.textContent).not.toContain(TEXT);

            await wrapper.get("button").trigger("pointermove");
            await vi.waitFor(() => expect(document.body.textContent).toContain(TEXT));
            wrapper.unmount();
        });

        it("does not show while disabled even if forced", async () => {
            const wrapper = mount(Tooltip, {
                props: {text: TEXT, forceOpen: true, disabled: true},
                slots: {default: "<button type='button'>触发器</button>"},
                attachTo: document.body,
            });
            await settle();
            expect(document.body.textContent).not.toContain(TEXT);
            wrapper.unmount();
        });
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

    it("toggle group toggles one item at a time and always emits the pressed values as an array", async () => {
        const options = [
            {value: "bold", label: "B", title: "加粗"},
            {value: "italic", label: "I", title: "斜体"},
        ];
        const wrapper = mount(ToggleGroup, {props: {modelValue: ["bold"], options}});
        const items = wrapper.findAll("button");

        await items[1]!.trigger("click");
        await wrapper.setProps({modelValue: ["bold", "italic"]});
        await items[0]!.trigger("click");
        await wrapper.setProps({modelValue: ["italic"]});
        await items[1]!.trigger("click");

        expect(wrapper.emitted("update:modelValue")).toEqual([[["bold", "italic"]], [["italic"]], [[]]]);
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

    it("renders splitter panels in px with separator semantics", async () => {
        const wrapper = mount(Splitter, {
            props: {
                direction: "horizontal",
                panels: [
                    {id: "sidebar", defaultSizePx: 240},
                    {id: "editor", defaultSizePx: 760},
                ],
            },
            slots: {
                "panel-sidebar": "<div>侧边栏内容</div>",
                "panel-editor": "<div>正文内容</div>",
            },
        });
        await nextTick();

        expect(wrapper.text()).toContain("侧边栏内容");
        expect(wrapper.text()).toContain("正文内容");

        // 容器测不到尺寸（happy-dom 没有布局引擎）：按声明的 px 分配，1px sash 之外的面板空间是 999px
        const panels = wrapper.findAll("[data-panel-id]");
        expect(wrapper.attributes("data-splitter")).toBe("panels");
        expect(panels.map((panel) => panel.attributes("data-panel-id"))).toEqual(["sidebar", "editor"]);
        expect(panels.map((panel) => panel.attributes("data-state"))).toEqual(["expanded", "expanded"]);
        const widths = panels.map((panel) => Number.parseFloat((panel.element as HTMLElement).style.width));
        expect(widths[0]!).toBeCloseTo(239.76, 2);
        expect(widths[1]!).toBeCloseTo(759.24, 2);

        // 分隔线用 px 发布可访问范围，且 aria-controls 指向前侧面板
        const sash = wrapper.get("[data-sash='panels:0']");
        expect(sash.attributes("role")).toBe("separator");
        expect(sash.attributes("aria-orientation")).toBe("vertical");
        expect(sash.attributes("aria-controls")).toBe(panels[0]!.attributes("id"));
        expect(sash.attributes("aria-valuenow")).toBe("240");
        expect(sash.attributes("aria-valuemax")).toBe("1000");
        expect(sash.attributes("aria-valuetext")).toBe("240 像素");

        // 键盘调整走同一 px 口径：一次 ArrowRight 提交 10px
        await sash.trigger("keydown", {key: "ArrowRight"});
        await sash.trigger("keyup", {key: "ArrowRight"});
        await nextTick();
        const gesture = wrapper.emitted("gesture-end")?.at(-1)?.[0] as SplitterGestureState;
        expect(gesture.source).toBe("keyboard");
        expect(gesture.active).toEqual(["sidebar", "editor"]);
        expect(gesture.sizesPx[0]! - 239.76).toBeCloseTo(10, 5);
        expect(Number.parseFloat((panels[0]!.element as HTMLElement).style.width)).toBeCloseTo(249.76, 2);
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

    it("keeps drawer popovers above the drawer and stacks a later modal above it", async () => {
        const drawer = mount(Drawer, {
            props: {open: true, title: "设定详情"},
            slots: {
                default: () => h(Select, {
                    modelValue: "one",
                    options: [{label: "第一项", value: "one"}, {label: "第二项", value: "two"}],
                }),
            },
            attachTo: document.body,
        });
        const alert = mount(AlertDialog, {props: {open: false, title: "删除设定？"}, attachTo: document.body});
        try {
            await nextTick();
            const zIndexOf = (element: Element | null) => Number((element as HTMLElement | null)?.style.zIndex);
            const drawerZ = zIndexOf(document.querySelector(".nb-ui-dialog-surface"));
            expect(drawerZ).toBeGreaterThanOrEqual(9000);

            // 抽屉里的下拉传送到 body，与抽屉在同一层比较；它要压过抽屉，否则打开后看不见
            document.querySelector<HTMLElement>("[role='combobox']")!.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
            await nextTick();
            await nextTick();
            expect(zIndexOf(document.querySelector(".nb-ui-menu-surface"))).toBeGreaterThan(drawerZ);

            // 从抽屉里打开的确认框压在抽屉上面，靠打开顺序而不是 DOM 顺序
            await alert.setProps({open: true});
            await nextTick();
            expect(zIndexOf(document.querySelector("[role='alertdialog']"))).toBeGreaterThan(drawerZ);
        } finally {
            alert.unmount();
            drawer.unmount();
        }
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

    it("renders and opens an alert dialog trigger slot", async () => {
        const wrapper = mount(AlertDialog, {
            attachTo: document.body,
            props: {
                title: "删除章节确认",
                description: "此操作无法恢复",
                confirmLabel: "确认删除",
            },
            slots: {
                trigger: "<button>删除章节</button>",
            },
        });

        try {
            const trigger = document.body.querySelector<HTMLButtonElement>("[aria-haspopup='dialog']");
            expect(trigger).not.toBeNull();
            trigger?.click();
            await nextTick();
            await nextTick();
            expect(document.body.querySelector('[role="alertdialog"][data-state="open"]')).not.toBeNull();

            const cancel = [...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
                .find((button) => button.textContent?.trim() === "取消");
            expect(cancel).not.toBeUndefined();
            cancel?.click();
            await nextTick();
            expect(wrapper.emitted("cancel")).toHaveLength(1);
            expect(wrapper.emitted("update:open")).toContainEqual([false]);
            expect(document.body.querySelector('[role="alertdialog"][data-state="open"]')).toBeNull();
        } finally {
            wrapper.unmount();
            document.body.replaceChildren();
        }
    });

    it("supports a controlled alert dialog without a trigger slot", async () => {
        const open = ref(true);
        const Harness = defineComponent({
            setup() {
                return () => h(AlertDialog, {
                    open: open.value,
                    title: "受控确认",
                    description: "请确认",
                    confirmLabel: "确认",
                    "onUpdate:open": (value: boolean) => { open.value = value; },
                });
            },
        });
        const wrapper = mount(Harness, {attachTo: document.body});

        try {
            await nextTick();
            await nextTick();

            const dialog = document.body.querySelector('[role="alertdialog"]');
            expect(dialog).not.toBeNull();
            expect(dialog?.querySelectorAll("button")).toHaveLength(2);
            expect(document.body.querySelector('[aria-haspopup="dialog"]')).toBeNull();
            const confirm = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
                .find((button) => button.textContent?.trim() === "确认");
            expect(confirm).not.toBeUndefined();
            confirm?.click();
            await nextTick();
            await nextTick();
            expect(open.value).toBe(false);
            expect(document.body.querySelector('[role="alertdialog"][data-state="open"]')).toBeNull();
        } finally {
            wrapper.unmount();
            document.body.replaceChildren();
        }
    });


    it("emits closed once after the alert dialog content is gone and focus is back", async () => {
        const wrapper = mount(AlertDialog, {
            attachTo: document.body,
            props: {
                title: "删除章节确认",
                description: "此操作无法恢复",
                confirmLabel: "确认删除",
            },
            slots: {
                trigger: "<button>删除章节</button>",
            },
        });
        vi.useFakeTimers();
        try {
            const trigger = document.body.querySelector<HTMLButtonElement>("[aria-haspopup='dialog']");
            expect(trigger).not.toBeNull();
            trigger?.focus();
            trigger?.click();
            await nextTick();
            await nextTick();
            expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull();

            const cancel = [...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
                .find((button) => button.textContent?.trim() === "取消");
            expect(cancel).not.toBeUndefined();
            cancel?.click();
            // 关闭交接是「微任务 → 下一宏任务」：排在 Reka FocusScope 卸载清理之后
            await nextTick();
            await vi.advanceTimersByTimeAsync(0);
            await nextTick();

            expect(wrapper.emitted("closed")).toHaveLength(1);
            expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
            expect(document.activeElement).toBe(trigger);

            await nextTick();
            await vi.advanceTimersByTimeAsync(0);
            expect(wrapper.emitted("closed")).toHaveLength(1);
        } finally {
            vi.useRealTimers();
            wrapper.unmount();
            document.body.replaceChildren();
        }
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
