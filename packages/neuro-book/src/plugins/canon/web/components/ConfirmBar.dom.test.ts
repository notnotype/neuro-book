/**
 * ConfirmBar（同名 .md，docs/specs/canon/author-ui.md 输出 16、29、30、51）：按字段的种类给输入控件、挂上时焦点进去；意图写成落点、
 * 只有一项时不显示；选着剧情里变了时有“发生了什么”；有别的变化才写一条提示；保存什么时候可用；回车、Ctrl+回车、Escape 与取消；“再查一次”。
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
    it("数用数字输入、带单位，挂上时焦点进去；改值发 update:value；页顶的确认条写回哪里、没有别的变化时不列变化，编辑卡里都不写；预览回来以后保存可用", async () => {
        const wrapper = bar({preview: {route: "改最初的值", impact: []}});
        await wrapper.vm.$nextTick();
        expect(document.activeElement).toBe(wrapper.get("input").element);
        expect(wrapper.text()).toContain("元");
        await wrapper.get("input").setValue("800");
        expect(wrapper.emitted("update:value")?.at(-1)).toEqual(["800"]);
        expect(wrapper.find("[data-edit-impact]").exists()).toBe(false);
        expect(wrapper.get("[data-confirm-preview]").text()).toBe("改最初的值");
        expect(wrapper.attributes("data-previewed")).toBe("");
        const card = bar({variant: "inline", preview: {route: "改最初的值", impact: []}});
        expect(card.text()).not.toContain("改最初的值");
        expect(card.find("[data-edit-impact]").exists()).toBe(false);
        expect(button(card, "保存").attributes("aria-label")).toBe("保存");
        expect(button(wrapper, "保存").attributes("disabled")).toBeUndefined();
        await button(wrapper, "保存").trigger("click");
        expect(wrapper.emitted("save")).toHaveLength(1);
    });

    it("没有预览、预览中、保存中、锁住时保存不可用；原因不锁保存", () => {
        expect(button(bar(), "保存").attributes("disabled")).toBeDefined();
        expect(button(bar({preview: {route: "改最初的值", impact: []}, previewing: true}), "保存").attributes("disabled")).toBeDefined();
        expect(button(bar({preview: {route: "改最初的值", impact: []}, locked: true, error: "这个数是几笔累出来的"}), "保存").attributes("disabled")).toBeDefined();
        const conflict = bar({preview: {route: "改最初的值", impact: []}, error: "这个值刚刚变了"});
        expect(conflict.get("[role='alert']").text()).toBe("这个值刚刚变了");
        expect(button(conflict, "保存").attributes("disabled")).toBeUndefined();
    });

    it("意图只有一项时不显示；文字用多行输入；Escape 与取消发 cancel；结局不明时有“再查一次”", async () => {
        const wrapper = bar({kind: "text", value: "黑发", intents: ["creative"], error: "不确定这次改动有没有写进去", recheck: true});
        expect(wrapper.find("textarea").exists()).toBe(true);
        expect(wrapper.find("[data-edit-intent]").exists()).toBe(false);
        await wrapper.get("[data-confirm-bar]").trigger("keydown", {key: "Escape"});
        await button(wrapper, "取消").trigger("click");
        expect(wrapper.emitted("cancel")).toHaveLength(2);
        await button(wrapper, "再查一次").trigger("click");
        expect(wrapper.emitted("recheck")).toHaveLength(1);
    });

    it("意图写成宿主给的落点，选另一项发 update:intent；没给时是“改设定”“剧情里变了”", async () => {
        const wrapper = bar({variant: "inline", intentLabels: {creative: "从最初起", story: "从第 3 章起"}});
        const segments = wrapper.get("[data-edit-intent]").findAll("button");
        expect(segments.map((item) => item.text())).toEqual(["从最初起", "从第 3 章起"]);
        await segments[1]!.trigger("click");
        expect(wrapper.emitted("update:intent")).toEqual([["story"]]);
        expect(bar().get("[data-edit-intent]").findAll("button").map((item) => item.text())).toEqual(["改设定", "剧情里变了"]);
    });

    it("选着剧情里变了时多一行“发生了什么”，占位写不填时的那一句，打字发 update:note；改设定时没有这一行；宿主不给（null）时也没有", async () => {
        const story = bar({variant: "inline", intent: "story", note: "", noteFallback: "存款变成 800 元"});
        const note = story.get("[data-edit-note] input");
        expect(note.attributes("placeholder")).toBe("发生了什么（选填，不填就写“存款变成 800 元”）");
        await note.setValue("交了学费");
        expect(story.emitted("update:note")).toEqual([["交了学费"]]);
        expect(bar({variant: "inline", intent: "creative", note: ""}).find("[data-edit-note]").exists()).toBe(false);
        expect(bar({variant: "inline", intent: "story"}).find("[data-edit-note]").exists()).toBe(false);
    });

    it("有别的变化才写一条提示，多于一条收成“还有 N 项”、整句在悬停提示里；有原因时只写原因；“再查一次”在按钮那一行", async () => {
        const impact = ["少了 1 条待处理", "魔力跟着变成 3,000", "等级跟着变成 4"];
        const more = bar({variant: "inline", preview: {route: "改第 2 章那一笔", impact}});
        expect(more.find("[data-confirm-bar]").exists()).toBe(false);
        expect(more.get("[data-edit-impact]").text()).toBe("少了 1 条待处理，还有 2 项");
        expect(more.get("[data-edit-impact]").attributes("title")).toBe(impact.join("\n"));
        expect(more.text()).not.toContain("改第 2 章那一笔");

        const conflict = bar({variant: "inline", preview: {route: "改最初的值", impact}, error: "这个值刚刚变了"});
        expect(conflict.find("[data-edit-impact]").exists()).toBe(false);
        expect(conflict.get("[role='alert']").text()).toBe("这个值刚刚变了");
        expect(button(conflict, "保存").attributes("disabled")).toBeUndefined();

        const unknown = bar({variant: "inline", error: "不确定这次改动有没有写进去", recheck: true});
        expect(unknown.get("[role='alert']").text()).toBe("不确定这次改动有没有写进去");
        await button(unknown, "再查一次").trigger("click");
        expect(unknown.emitted("recheck")).toHaveLength(1);
    });

    it("就地改的单行输入：回车就是保存，预览还在等时也发出（宿主等预览回来再定存不存，输出 51）；保存在途、锁着时不发；多行的文字回车不保存、Ctrl+回车保存", async () => {
        const single = bar({variant: "inline", rows: 1, kind: "text", value: "十七", preview: {route: "改最初的值", impact: []}});
        expect(single.find("textarea").exists()).toBe(false);
        await single.get("input").trigger("keydown", {key: "Enter"});
        expect(single.emitted("save")).toHaveLength(1);
        await single.setProps({previewing: true, preview: null});
        await single.get("input").trigger("keydown", {key: "Enter"});
        expect(single.emitted("save")).toHaveLength(2);
        await single.setProps({saving: true});
        await single.get("input").trigger("keydown", {key: "Enter"});
        await single.setProps({saving: false, locked: true});
        await single.get("input").trigger("keydown", {key: "Enter"});
        expect(single.emitted("save")).toHaveLength(2);

        const passage = bar({variant: "inline", kind: "text", value: "嘴硬心软", preview: {route: "改最初的值", impact: []}});
        await passage.get("textarea").trigger("keydown", {key: "Enter"});
        expect(passage.emitted("save")).toBeUndefined();
        // 成段的文字：Ctrl（或 ⌘）加回车保存。
        await passage.get("textarea").trigger("keydown", {key: "Enter", ctrlKey: true});
        await passage.get("textarea").trigger("keydown", {key: "Enter", metaKey: true});
        expect(passage.emitted("save")).toHaveLength(2);
    });
});
