import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import type {AgentSessionListItem} from "../types";
import AgentSessionPanel from "./AgentSessionPanel.vue";

const now = new Date(2026, 9, 20, 13, 30).getTime();
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();
const items: AgentSessionListItem[] = [
    {id: "a", title: "今天的", updatedAt: at(20), status: "running", icon: "i-lucide-feather", iconTitle: "写作助手"},
    {id: "b", title: "", description: "说明", updatedAt: at(20), status: "waiting"},
    {id: "c", title: "昨天的", updatedAt: at(19), status: "interrupted"},
    {id: "d", title: "更早的", updatedAt: at(3), status: "idle", archived: true},
];

const panel = (props: Partial<InstanceType<typeof AgentSessionPanel>["$props"]> = {}) => mount(AgentSessionPanel, {props: {items, selectedId: "a", now, locale: "zh-CN", ...props}});

describe("AgentSessionPanel", () => {
    it("按今天、昨天、更早分组；图标写 Profile 名字；状态写明；未命名有占位", () => {
        const view = panel();
        expect(view.findAll(".acv-panel__group").map((node) => node.text())).toEqual(["今天", "昨天", "更早"]);
        expect(view.findAll(".acv-panel__state").map((node) => node.text())).toEqual(["运行中", "等你处理", "已中断"]);
        expect(view.get(".acv-panel__icon").attributes("title")).toBe("写作助手");
        expect(view.findAll(".acv-panel__title").map((node) => node.text())).toContain("未命名会话");
        expect(view.findAll(".acv-panel__row.is-current")).toHaveLength(1);
        expect(view.findAll(".acv-panel__row.is-archived")).toHaveLength(1);
    });

    it("选中、新建发 action；搜索发 update:query", async () => {
        const view = panel();
        await view.findAll("[data-panel-row]")[2]!.trigger("click");
        await view.get("[data-panel-create]").trigger("click");
        expect(view.emitted("action")).toEqual([[{type: "session.select", sessionId: "c"}], [{type: "session.create"}]]);
        await view.get("[data-panel-search] input, input[data-panel-search]").setValue("钟声");
        expect(view.emitted("update:query")).toEqual([["钟声"]]);
    });

    it("选了的过滤条件显示成可去掉的标签", async () => {
        const view = panel({profiles: [{id: "writer", label: "写作助手", active: true}, {id: "qa", label: "问答", active: false}], showArchived: true});
        const tags = view.findAll("[data-panel-tag]");
        expect(tags.map((tag) => tag.text())).toEqual(["写作助手", "已归档"]);
        await tags[0]!.trigger("click");
        await tags[1]!.trigger("click");
        expect(view.emitted("toggle-profile")).toEqual([["writer"]]);
        expect(view.emitted("update:show-archived")).toEqual([[false]]);
    });

    it("没打开作品时没有范围按钮；空与出错写明", () => {
        expect(panel().find("[data-panel-scope]").exists()).toBe(false);
        expect(panel({scope: {value: "all"}}).get("[data-panel-scope]").text()).toBe("全部作品");
        expect(panel({items: []}).text()).toContain("没有会话");
        expect(panel({items: [], error: "取不到"}).get("[role='alert']").text()).toBe("取不到");
    });
});
