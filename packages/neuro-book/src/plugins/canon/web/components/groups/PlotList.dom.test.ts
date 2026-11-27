/**
 * PlotList（同名 .md，docs/specs/canon/author-ui.md 输出 15）：每行的位置、文字、标记与改动；点文字发 open；“再显示”发 more；
 * 空与读取中。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {canonCatalogs} from "../../text";
import PlotList from "./PlotList.vue";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});
const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

const plot = (props: Record<string, unknown>) => {
    const wrapper = mount(PlotList, {props: {rows: [], ...props}, global: {provide: provideText(port)}});
    mounted.push(wrapper);
    return wrapper;
};

describe("PlotList", () => {
    it("每行写位置、文字、标记与对这个条目的改动；点文字发 open，“再显示”发 more", async () => {
        const wrapper = plot({remaining: 4, rows: [
            {id: "c2", where: "第 3 章", text: "她会离开学院", flags: ["plan"], patches: []},
            {id: "c1", where: "第 2 章", text: "买了书", flags: ["held"], patches: ["存款 −300"]},
        ]});
        const rows = wrapper.findAll("[data-change]");
        expect(rows.map((row) => row.text())).toEqual(["第 3 章她会离开学院计划", "第 2 章买了书待定存款 −300"]);
        await rows[1]!.get("button").trigger("click");
        expect(wrapper.emitted("open")).toEqual([["c1"]]);
        await wrapper.findAll("button").at(-1)!.trigger("click");
        expect(wrapper.emitted("more")).toHaveLength(1);
        expect(wrapper.findAll("button").at(-1)!.text()).toBe("再显示（还有 4 项）");
    });

    it("还没读到时“读取中…”；一条也没有时写一句", () => {
        expect(plot({loading: true}).text()).toBe("读取中…");
        expect(plot({}).text()).toBe("还没有涉及它的情节");
    });
});
