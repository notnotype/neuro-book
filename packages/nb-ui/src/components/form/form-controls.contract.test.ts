import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {describe, expect, it} from "vitest";
import Checkbox from "./Checkbox.vue";
import Input from "./Input.vue";
import NumberInput from "./NumberInput.vue";
import Select from "../popup/Select.vue";

describe("phase 2 form control contracts", () => {
    it("keeps Input numeric attributes, prefix slot and focus event", async () => {
        const wrapper = mount(Input, {
            props: {
                modelValue: "12",
                type: "number",
                min: "0",
                max: "20",
                step: "0.5",
            },
            slots: {prefix: "<span data-prefix>¥</span>"},
        });
        const input = wrapper.get("input");
        expect(wrapper.get("[data-prefix]").text()).toBe("¥");
        expect(input.attributes("min")).toBe("0");
        expect(input.attributes("max")).toBe("20");
        expect(input.attributes("step")).toBe("0.5");
        await input.trigger("focus");
        expect(wrapper.emitted("focus")).toHaveLength(1);
    });

    it("marks every Input native branch without changing its model contract", async () => {
        const bare = mount(Input, {props: {modelValue: "bare"}});
        const wrapped = mount(Input, {
            props: {modelValue: "wrapped"},
            slots: {prefix: "<span>@</span>"},
        });

        expect(bare.get("input").classes()).toContain("nb-ui-native-input");
        expect(wrapped.get("input").classes()).toContain("nb-ui-native-input");
        await bare.get("input").setValue("updated");
        expect(bare.emitted("update:modelValue")?.at(-1)).toEqual(["updated"]);
    });

    it("scopes every native search and number pseudo-element selector to the marker", () => {
        const css = readFileSync(resolve(import.meta.dirname, "../../styles.css"), "utf8");
        const style = document.createElement("style");
        style.textContent = css;
        document.head.append(style);
        const selectors = [...(style.sheet?.cssRules ?? [])]
            .flatMap((rule) => "selectorText" in rule ? String(rule.selectorText).split(",") : [])
            .map((selector) => selector.trim());
        style.remove();

        const nativeDecorationSelectors = selectors.filter((selector) => /webkit-(?:search|inner-spin|outer-spin)|input\[type="number"\]/u.test(selector));
        expect(nativeDecorationSelectors.length).toBeGreaterThan(0);
        expect(nativeDecorationSelectors.every((selector) => selector.includes("input.nb-ui-native-input"))).toBe(true);
    });

    it("preserves NumberInput editing states and applies bounded stepping", async () => {
        const wrapper = mount(NumberInput, {
            props: {modelValue: "-", min: "0", max: "2", step: "0.5"},
        });
        const input = wrapper.get("input");
        await input.setValue("1.");
        expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["1."]);

        await wrapper.setProps({modelValue: "1.5"});
        await wrapper.get("button[aria-label='增加']").trigger("click");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["2"]);

        await wrapper.setProps({modelValue: "2"});
        await wrapper.get("button[aria-label='增加']").trigger("click");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["2"]);

        await input.trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("submit")).toHaveLength(1);
    });

    it("renders Select placeholder, rich options and compact direction contract", async () => {
        const wrapper = mount(Select, {
            props: {
                modelValue: "",
                placeholder: "选择格式",
                size: "sm",
                dropdownDirection: "up",
                options: [
                    {label: "Markdown", value: "md", description: "纯文本标记", iconClass: "i-lucide-file-text"},
                    {label: "PDF", value: "pdf", description: "暂不可用", disabled: true, tone: "danger"},
                ],
            },
            attachTo: document.body,
        });
        const trigger = wrapper.get("[role='combobox']");
        expect(trigger.text()).toContain("选择格式");
        expect(trigger.classes()).toContain("nb-ui-control-h-sm");
        await trigger.trigger("focus");
        expect(wrapper.emitted("focus")).toHaveLength(1);
        await trigger.trigger("keydown", {key: "Enter"});
        await nextTick();
        await nextTick();

        expect(document.body.textContent).toContain("纯文本标记");
        expect(document.body.textContent).toContain("暂不可用");
        const pdfOption = Array.from(document.querySelectorAll("[role='option']")).find((option) => option.textContent?.includes("暂不可用"));
        expect(pdfOption?.querySelector(".rounded-full")?.classList.contains("bg-[var(--status-danger)]")).toBe(true);
        expect(document.querySelector("[role='listbox']")?.getAttribute("data-side")).toBe("top");
        wrapper.unmount();
    });

    it("forwards class and attributes to the Select trigger and drops the conflicting default width", () => {
        // SelectRoot 是多根组件，Vue 不自动继承；不显式转发的话宽度与 aria-label 会被静默丢弃
        const wrapper = mount(Select, {
            props: {modelValue: "md", options: [{label: "Markdown", value: "md"}]},
            attrs: {"class": "w-[170px]", "aria-label": "导出格式", "data-testid": "format"},
        });
        const trigger = wrapper.get("[role='combobox']");
        expect(trigger.attributes("aria-label")).toBe("导出格式");
        expect(trigger.attributes("data-testid")).toBe("format");
        expect(trigger.classes()).toContain("w-[170px]");
        // 两条都留下的话谁生效取决于样式表先后，必须在类名层就去掉默认宽
        expect(trigger.classes()).not.toContain("w-full");
        wrapper.unmount();
    });

    it("keeps the Select default full width when no width class is passed", () => {
        const wrapper = mount(Select, {
            props: {modelValue: "md", options: [{label: "Markdown", value: "md"}]},
        });
        expect(wrapper.get("[role='combobox']").classes()).toContain("w-full");
        wrapper.unmount();
    });

    it("gives Checkbox an optional label fallback and forwards focus", async () => {
        const wrapper = mount(Checkbox, {props: {modelValue: false}});
        const input = wrapper.get("input");

        expect(wrapper.text()).toContain("false");
        await wrapper.setProps({modelValue: true});
        expect(wrapper.text()).toContain("true");
        await input.trigger("focus");
        expect(wrapper.emitted("focus")).toHaveLength(1);
    });

    it("uses a literal black endpoint and restores the keyboard focus ring on the visual checkbox", () => {
        const wrapper = mount(Checkbox, {props: {modelValue: true}});
        const visual = wrapper.get("input + span");

        expect(visual.classes().some((className) => className.includes("#000000"))).toBe(true);
        expect(visual.classes()).toContain("peer-focus-visible:border-[color:var(--focus-outline)]");
        expect(visual.classes()).toContain("peer-focus-visible:shadow-[var(--focus-ring)]");
    });
});
