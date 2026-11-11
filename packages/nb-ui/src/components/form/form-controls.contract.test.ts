import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {describe, expect, it} from "vitest";
import Checkbox from "./Checkbox.vue";
import Input from "./Input.vue";
import NumberInput from "./NumberInput.vue";
import Select from "../popup/Select.vue";
import Textarea from "./Textarea.vue";

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

    // 外框与聚焦光晕都出自表单控件基座 `.nb-ui-control`（styles.css）；happy-dom 不算分层样式，外观在浏览器里看，这里只守来源。
    it("variant bare 的两个分支都不挂字段外框、没有左右内边距（文字与容器的内边距对齐），出错时仍报给读屏", async () => {
        const plain = mount(Input, {props: {modelValue: "zhù yīn", variant: "bare", invalid: true}});
        const small = mount(Input, {props: {modelValue: "", variant: "bare", size: "sm"}});
        const decorated = mount(Input, {props: {modelValue: "", variant: "bare", clearable: true}, slots: {suffix: "<span>✓</span>"}});
        const framed = mount(Input, {props: {modelValue: ""}});
        expect(framed.classes()).toContain("nb-ui-control");
        expect(framed.classes()).toContain("nb-ui-control-px");
        for (const root of [plain, small, decorated]) {
            expect(root.classes()).not.toContain("nb-ui-control");
            expect(root.classes()).not.toContain("border");
            expect(root.classes().filter((name) => name === "nb-ui-control-px" || name.startsWith("px-"))).toEqual([]);
        }
        expect(plain.get("input").attributes("aria-invalid")).toBe("true");
        await plain.get("input").setValue("lín xī");
        expect(plain.emitted("update:modelValue")?.at(-1)).toEqual(["lín xī"]);
    });

    // 高度怎么随内容变要在浏览器里看（happy-dom 没有排版，`scrollHeight` 恒为 0）；这里守来源：外框与拖拽把手、值的往返。
    it("Textarea 的 variant bare 不挂字段外框与内边距、不可拖拽缩放；autosize 也去掉拖拽把手并把高度交给内容", async () => {
        const framed = mount(Textarea, {props: {modelValue: "一"}});
        const bare = mount(Textarea, {props: {modelValue: "二", variant: "bare", invalid: true}});
        const auto = mount(Textarea, {props: {modelValue: "三", autosize: true}});
        expect(framed.classes()).toEqual(expect.arrayContaining(["nb-ui-control", "border", "resize-y"]));
        expect(bare.classes()).not.toContain("nb-ui-control");
        expect(bare.classes()).not.toContain("border");
        expect(bare.classes()).toContain("resize-none");
        expect(bare.classes().filter((name) => name.startsWith("px-") || name.startsWith("py-"))).toEqual([]);
        expect(bare.attributes("aria-invalid")).toBe("true");
        expect(auto.classes()).toContain("resize-none");
        expect(auto.element.style.height).not.toBe("");
        await bare.setValue("改过");
        expect(bare.emitted("update:modelValue")?.at(-1)).toEqual(["改过"]);
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

describe("Input 的透传属性", () => {
    it("带图标、清除按钮时读屏属性落在输入框上，data-* 与 class 留在外层控件上；没有装饰时全落在输入框上", () => {
        const decorated = mount(Input, {props: {modelValue: "", iconClass: "i-lucide-search", clearable: true}, attrs: {"aria-label": "搜索作品", "data-search": "", "class": "search-box"}});
        const input = decorated.get("input");
        expect(input.attributes("aria-label")).toBe("搜索作品");
        expect(decorated.attributes("aria-label")).toBeUndefined();
        expect(decorated.attributes("data-search")).toBe("");
        expect(decorated.classes()).toContain("search-box");

        const bare = mount(Input, {props: {modelValue: ""}, attrs: {"aria-label": "书名", "data-title": ""}});
        expect(bare.element.tagName).toBe("INPUT");
        expect(bare.attributes("aria-label")).toBe("书名");
        expect(bare.attributes("data-title")).toBe("");
    });
});
