import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {describe, expect, it} from "vitest";

import type {SessionTreeView} from "../../types";
import AgentSessionTree from "./AgentSessionTree.vue";

const tree: SessionTreeView = {
    state: "ready",
    nodes: [
        {id: "u1", parent: null, type: "input", label: "开头"},
        {id: "a1", parent: "u1", type: "assistant", label: "回复"},
        {id: "u2", parent: "a1", type: "input", label: "分支甲"},
        {id: "u3", parent: "a1", type: "input", label: "分支乙"},
        {id: "a3", parent: "u3", type: "assistant", label: "乙的回复"},
    ],
    activePath: ["u1", "a1", "u2"],
};
const show = (props: Partial<{tree: SessionTreeView; canActivate: boolean}> = {}) => mount(AgentSessionTree, {attachTo: document.body, props: {tree, canActivate: true, ...props}});
const toGraph = async (view: ReturnType<typeof show>) => {
    await view.findAll("[data-tree-modes] button").at(-1)!.trigger("click");
    await nextTick();
};

describe("AgentSessionTree", () => {
    it("读取中与读不到各有说明", () => {
        expect(show({tree: {state: "loading", loaded: 2000}}).text()).toContain("2000");
        expect(show({tree: {state: "unavailable", reason: "读不到"}}).get("[data-tree-unavailable]").text()).toBe("读不到");
    });

    it("列表：写节点数与分叉数；选别的分支才能切换；当前路径上的不能切", async () => {
        const view = show();
        expect(view.get("[data-tree-count]").text()).toContain("5");
        expect(view.get("[data-tree-count]").text()).toContain("1 处分叉");
        expect(view.get("[data-tree-row='a1'] [data-tree-fork]").text()).toContain("2");
        const button = view.get("[data-tree-activate]");
        expect(button.attributes("disabled")).toBeDefined();
        await view.get("[data-tree-row='a1']").trigger("click");
        expect(view.get("[data-tree-activate]").attributes("disabled")).toBeDefined();
        await view.get("[data-tree-row='a3']").trigger("click");
        await view.get("[data-tree-activate]").trigger("click");
        expect(view.emitted("activate")).toEqual([["a3"]]);
    });

    it("运行中不能切换", async () => {
        const view = show({canActivate: false});
        await view.get("[data-tree-row='a3']").trigger("click");
        expect(view.get("[data-tree-activate]").attributes("disabled")).toBeDefined();
    });

    it("列表的键盘：上下选，左收起，右展开，回车切换；收起时写藏了几行", async () => {
        const view = show();
        const body = view.get("[data-tree-body]");
        await view.get("[data-tree-row='u3']").trigger("click");
        await body.trigger("keydown", {key: "ArrowLeft"});
        expect(view.find("[data-tree-row='a3']").exists()).toBe(false);
        expect(view.get("[data-tree-row='u3']").text()).toContain("已收起 1");
        await body.trigger("keydown", {key: "ArrowRight"});
        expect(view.find("[data-tree-row='a3']").exists()).toBe(true);
        await body.trigger("keydown", {key: "ArrowDown"});
        await body.trigger("keydown", {key: "Enter"});
        expect(view.emitted("activate")).toEqual([["a3"]]);
    });

    it("树里按钮上的回车不算切换；选中的节点被收起后不再算选中；缩进线有上限", async () => {
        const view = show();
        await view.get("[data-tree-row='a3']").trigger("click");
        await view.get("[data-tree-row='u3'] [data-tree-fold]").trigger("keydown", {key: "Enter"});
        expect(view.emitted("activate")).toBeUndefined();
        await view.get("[data-tree-row='u3'] [data-tree-fold]").trigger("click");
        expect(view.get("[data-tree-selected-label]").text()).toBe("选中一个节点");
        expect(view.get("[data-tree-activate]").attributes("disabled")).toBeDefined();
        const body = view.get("[data-tree-body]");
        await body.trigger("keydown", {key: "End"});
        expect(view.findAll("[data-tree-row]").at(-1)!.attributes("aria-selected")).toBe("true");
        expect(body.attributes("aria-activedescendant")).toBe(`tree-item-${String(view.findAll("[data-tree-row]").at(-1)!.attributes("data-tree-row"))}`);

        const nodes: {id: string; parent: string | null; type: string; label: string}[] = [{id: "t0", parent: null, type: "input", label: "根"}];
        const path = ["t0"];
        for (let depth = 1; depth < 12; depth += 1) {
            nodes.push({id: `t${String(depth)}`, parent: `t${String(depth - 1)}`, type: "input", label: "主干"}, {id: `b${String(depth)}`, parent: `t${String(depth - 1)}`, type: "assistant", label: "支线"});
            path.push(`t${String(depth)}`);
        }
        const deep = show({tree: {state: "ready", nodes, activePath: path}});
        expect(deep.get("[data-tree-row='t11']").findAll(".acv-tree__guide")).toHaveLength(6);
        expect(deep.get("[data-tree-row='t11'] .acv-tree__deeper").text()).toBe("+5");
    });

    it("搜索与过滤", async () => {
        const view = show();
        await view.get("[data-tree-search] input, input[data-tree-search]").setValue("乙的");
        expect(view.findAll("[data-tree-row]")).toHaveLength(1);
        await view.get("[data-tree-search] input, input[data-tree-search]").setValue("没有这个");
        expect(view.text()).toContain("没有匹配的节点");
        await view.get("[data-tree-search] input, input[data-tree-search]").setValue("");
        await view.findAll("[data-tree-filter] button")[2]!.trigger("click");
        expect(view.findAll("[data-tree-row]").map((row) => row.attributes("data-tree-row"))).toEqual(["u1", "u2", "u3"]);
    });

    it("图：缺省从上往下，可换方向；分叉上的切换器换选中，换完才能切过去", async () => {
        const view = show();
        expect(view.find("[data-tree-direction]").exists()).toBe(false);
        await toGraph(view);
        expect(view.get("[data-tree-canvas]").attributes("data-direction")).toBe("down");
        const a1 = view.get<HTMLElement>("[data-tree-node='a1']").element.style;
        const u2 = view.get<HTMLElement>("[data-tree-node='u2']").element.style;
        expect(a1.left).toBe(u2.left);
        expect(parseFloat(u2.top)).toBeGreaterThan(parseFloat(a1.top));
        await view.get("[data-tree-direction='right']").trigger("click");
        expect(view.get("[data-tree-canvas]").attributes("data-direction")).toBe("right");
        const rightA1 = view.get<HTMLElement>("[data-tree-node='a1']").element.style;
        const rightU2 = view.get<HTMLElement>("[data-tree-node='u2']").element.style;
        expect(rightA1.top).toBe(rightU2.top);
        expect(parseFloat(rightU2.left)).toBeGreaterThan(parseFloat(rightA1.left));

        const fork = view.get("[data-tree-node='a1'] [data-tree-switch]");
        expect(fork.text()).toContain("1/2");
        await fork.findAll("button")[1]!.trigger("click");
        expect(view.get("[data-tree-node='a1'] [data-tree-switch]").text()).toContain("2/2");
        await view.get("[data-tree-activate]").trigger("click");
        expect(view.emitted("activate")).toEqual([["u3"]]);
    });

    it("底部的节点 id 能复制", async () => {
        const view = show();
        await view.get("[data-tree-row='a1']").trigger("click");
        await view.get("[data-tree-copy]").trigger("click");
        expect(view.emitted("copy")).toEqual([["a1"]]);
    });
});
