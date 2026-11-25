/**
 * ConfirmBar（同名 .md，docs/specs/canon/author-ui.md 输出 16、29、30）：按字段的种类给输入控件、挂上时焦点进去；意图只有一项
 * 时不显示；预览两句；保存什么时候可用；Escape 与取消；“再查一次”。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../text";
import ConfirmBar from "./ConfirmBar.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

const base = {label: "存款", kind: "number" as const, unit: "元", value: "900", intents: ["creative", "story"] as const, intent: "creative" as const};
function bar(props: Record<string, unknown> = {}) {
    const wrapper = mount(ConfirmBar, {props: {...base, ...props}, global: {provide: provideText(port)}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}
const button = (wrapper: ReturnType<typeof mount>, label: string) => wrapper.findAll("button").find((item) => item.text() === label)!;

describe("ConfirmBar", () => {
    it("数用数字输入、带单位，挂上时焦点进去；改值发 update:value；预览两句；预览回来以后保存可用", async () => {
        const wrapper = bar({preview: {route: "改初值", impact: ["别的都不变"]}});
        await wrapper.vm.$nextTick();
        expect(document.activeElement).toBe(wrapper.get("input").element);
        expect(wrapper.text()).toContain("元");
        await wrapper.get("input").setValue("800");
        expect(wrapper.emitted("update:value")?.at(-1)).toEqual(["800"]);
        expect(wrapper.get("[data-confirm-preview]").text()).toBe("改初值别的都不变");
        expect(button(wrapper, "保存").attributes("disabled")).toBeUndefined();
        await button(wrapper, "保存").trigger("click");
        expect(wrapper.emitted("save")).toHaveLength(1);
    });

    it("没有预览、预览中、保存中、锁住时保存不可用；原因不锁保存", () => {
        expect(button(bar(), "保存").attributes("disabled")).toBeDefined();
        expect(button(bar({preview: {route: "改初值", impact: []}, previewing: true}), "保存").attributes("disabled")).toBeDefined();
        expect(button(bar({preview: {route: "改初值", impact: []}, locked: true, error: "这个数是几笔累出来的"}), "保存").attributes("disabled")).toBeDefined();
        const conflict = bar({preview: {route: "改初值", impact: []}, error: "这个值刚刚变了"});
        expect(conflict.get("[role='alert']").text()).toBe("这个值刚刚变了");
        expect(button(conflict, "保存").attributes("disabled")).toBeUndefined();
    });

    it("意图只有一项时不显示；文字用多行输入；Escape 与取消发 cancel；结局不明时有“再查一次”", async () => {
        const wrapper = bar({kind: "text", value: "黑发", intents: ["creative"], error: "不确定这次改动有没有写进去", recheck: true});
        expect(wrapper.find("textarea").exists()).toBe(true);
        expect(wrapper.text()).not.toContain("这是");
        await wrapper.get("[data-confirm-bar]").trigger("keydown", {key: "Escape"});
        await button(wrapper, "取消").trigger("click");
        expect(wrapper.emitted("cancel")).toHaveLength(2);
        await button(wrapper, "再查一次").trigger("click");
        expect(wrapper.emitted("recheck")).toHaveLength(1);
    });

    it("就地改（inline）：预览与原因共用两行，先原因、再写回哪里；变化多于一条时收成“还有 N 项”，整句在悬停提示里；“再查一次”在按钮那一行", async () => {
        const lines = (wrapper: ReturnType<typeof bar>) => wrapper.get("[data-confirm-preview]").findAll("p").map((line) => line.text());
        const impact = ["少了 1 条待处理", "魔力跟着变成 3,000", "等级跟着变成 4"];
        const more = bar({variant: "inline", preview: {route: "改第 2 章那一笔", impact}});
        expect(more.find("[data-confirm-bar]").exists()).toBe(false);
        expect(lines(more)).toEqual(["改第 2 章那一笔", "少了 1 条待处理，还有 2 项"]);
        expect(more.get("[data-confirm-preview]").findAll("p")[1]!.attributes("title")).toBe(impact.join("\n"));

        const conflict = bar({variant: "inline", preview: {route: "改初值", impact: ["别的都不变"]}, error: "这个值刚刚变了"});
        expect(lines(conflict)).toEqual(["这个值刚刚变了", "改初值"]);
        expect(conflict.get("[role='alert']").text()).toBe("这个值刚刚变了");
        expect(button(conflict, "保存").attributes("disabled")).toBeUndefined();

        const unknown = bar({variant: "inline", error: "不确定这次改动有没有写进去", recheck: true});
        expect(lines(unknown)).toEqual(["不确定这次改动有没有写进去"]);
        expect(unknown.get("[data-confirm-preview]").find("button").exists()).toBe(false);
        await button(unknown, "再查一次").trigger("click");
        expect(unknown.emitted("recheck")).toHaveLength(1);
    });
});
