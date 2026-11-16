/**
 * 日期输入（同名 .md 的“交互”与“数据”）：值是 `YYYY-MM-DD` 或 null；段里显示这一天，日历里选一天发出新值并关上，
 * 清掉一段发出 null；不合格的字符串按没有值显示、不改它。段的打字细节与日历的方向键来自 reka-ui，在 Lab 里看。
 */

import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import DateInput from "./DateInput.vue";

const mounted: VueWrapper[] = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

/** 受控挂载：像真实的父组件一样把发出的值写回 `modelValue`（reka 在受控值变了之后才关日历）。 */
async function mountDate(props: Record<string, unknown> = {}): Promise<VueWrapper> {
    const wrapper: VueWrapper = mount(DateInput, {
        props: {modelValue: "2025-12-21", ...props, "onUpdate:modelValue": (value: string | null) => wrapper.setProps({modelValue: value})},
        attachTo: document.body,
    });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

const segment = (wrapper: VueWrapper, part: "year" | "month" | "day") => wrapper.get(`[data-reka-date-field-segment='${part}']`);
const shown = (wrapper: VueWrapper) => (["year", "month", "day"] as const).map((part) => segment(wrapper, part).text());
const trigger = (wrapper: VueWrapper) => wrapper.find("button[aria-label='选择日期']");
const emitted = (wrapper: VueWrapper) => (wrapper.emitted("update:modelValue") ?? []).map(([value]) => value);

describe("DateInput", () => {
    it("段里显示这一天", async () => {
        const wrapper = await mountDate();
        expect(shown(wrapper)).toEqual(["2025", "12", "21"]);
    });

    it("不合格的日期按没有值显示，不发出修改", async () => {
        const wrapper = await mountDate({modelValue: "2025-02-30"});
        expect(segment(wrapper, "day").attributes("data-placeholder")).toBeDefined();
        expect(emitted(wrapper)).toEqual([]);
    });

    it("打开日历、点另一天：发出新的日期并关上", async () => {
        const wrapper = await mountDate();
        await trigger(wrapper).trigger("click");
        await flushPromises();
        const selected = document.querySelector("[data-reka-calendar-cell-trigger][data-selected]");
        expect(selected?.getAttribute("data-value")).toBe("2025-12-21");
        document.querySelector<HTMLElement>("[data-reka-calendar-cell-trigger][data-value='2025-12-24']")?.click();
        await flushPromises();
        expect(emitted(wrapper)).toEqual(["2025-12-24"]);
        expect(document.querySelector("[data-reka-calendar-cell-trigger]")).toBeNull();
    });

    it("清掉一段：发出 null", async () => {
        const wrapper = await mountDate();
        await segment(wrapper, "day").trigger("keydown", {key: "Backspace"});
        await segment(wrapper, "day").trigger("keydown", {key: "Backspace"});
        await flushPromises();
        expect(emitted(wrapper).at(-1)).toBeNull();
    });

    it("只读：没有日历按钮", async () => {
        const wrapper = await mountDate({readonly: true});
        expect(trigger(wrapper).exists()).toBe(false);
        expect(shown(wrapper)).toEqual(["2025", "12", "21"]);
    });
});
