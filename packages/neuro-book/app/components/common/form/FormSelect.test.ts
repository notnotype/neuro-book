// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {mount, type VueWrapper} from "@vue/test-utils";
import FormSelect, {type SelectOption, type SelectSize} from "./FormSelect.vue";

const mounted: VueWrapper[] = [];

beforeEach(() => {
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

describe("common/form/FormSelect 代理桥接", () => {
    const options: SelectOption[] = [
        {label: "选项 A", value: "a"},
        {label: "选项 B", value: "b"},
        {label: "选项 C (禁用)", value: "c", disabled: true},
    ];

    it("正确渲染选中项文本并传递 props", () => {
        const wrapper = mount(FormSelect, {
            props: {
                modelValue: "a",
                options,
                size: "sm" as SelectSize,
                placeholder: "请选择",
            },
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const button = wrapper.find("button");
        expect(button.exists()).toBe(true);
        expect(button.text()).toContain("选项 A");
        expect(button.classes()).toContain("nb-ui-control-h-sm");
    });

    it("空值时显示 placeholder", () => {
        const wrapper = mount(FormSelect, {
            props: {
                modelValue: "",
                options,
                placeholder: "请选择选项",
            },
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const button = wrapper.find("button");
        expect(button.exists()).toBe(true);
        expect(button.text()).toContain("请选择选项");
    });

    it("禁用态下按钮包含 disabled 属性", () => {
        const wrapper = mount(FormSelect, {
            props: {
                modelValue: "a",
                options,
                disabled: true,
            },
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const button = wrapper.find("button");
        expect(button.attributes("disabled")).toBeDefined();
    });

    it("透传额外 class 与 attributes 到触发按钮", () => {
        const wrapper = mount(FormSelect, {
            props: {
                modelValue: "a",
                options,
            },
            attrs: {
                class: "custom-width-class w-48",
                "data-testid": "my-select",
            },
            attachTo: document.body,
        });
        mounted.push(wrapper);

        const button = wrapper.find("button");
        expect(button.attributes("data-testid")).toBe("my-select");
        expect(button.classes()).toContain("custom-width-class");
    });
});
