import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";
import {defineComponent, h} from "vue";

import {provideAgentView} from "../host";
import AgentQueuedMessages from "./AgentQueuedMessages.vue";

type Props = InstanceType<typeof AgentQueuedMessages>["$props"];

/** 排队区要视图提供的语言：包一层只做 provide 的父组件。 */
function mountQueued(props: Props) {
    const Host = defineComponent({
        setup() {
            provideAgentView({locale: () => "zh-CN", renderers: () => ({})});
            return () => h(AgentQueuedMessages, props);
        },
    });
    const host = mount(Host);
    return {host, view: host.findComponent(AgentQueuedMessages)};
}

const ready = (id: string) => ({id, text: `就绪 ${id}`, delivery: "followup" as const});
const held = (id: string, reason: string) => ({id, text: `留着 ${id}\n第二行`, delivery: "followup" as const, held: {reason}});

describe("AgentQueuedMessages", () => {
    it("每行能删，能取出来改；不是自己排的只能删", async () => {
        const {view} = mountQueued({queued: [ready("a"), {id: "b", text: "别人排的", delivery: "followup", author: {label: "日程", icon: "i-lucide-clock"}, editable: false}]});
        const rows = view.findAll("li[data-queued]");
        await rows[0]!.get("[data-queued-edit]").trigger("click");
        await rows[0]!.get("[data-queued-remove]").trigger("click");
        expect(rows[1]!.find("[data-queued-edit]").exists()).toBe(false);
        expect(rows[1]!.get(".acv-queued__tag-label").text()).toBe("日程");
        await rows[1]!.get("[data-queued-remove]").trigger("click");
        expect(view.emitted("edit")).toEqual([["a"]]);
        expect(view.emitted("remove")).toEqual([["a"], ["b"]]);
    });

    it("留着的条目：头行写条数与第一条的原因（不止一种加“等”），留着的行不受 3 条限制；继续发出 continue", async () => {
        const {view} = mountQueued({queued: [held("h1", "运行出错"), ready("r1"), ready("r2"), ready("r3"), ready("r4"), held("h2", "你停止了运行")]});
        const head = view.get("[data-queued-head]");
        expect(head.text()).toContain("已暂停 2 条");
        expect(head.get(".acv-queued__head-reason").text()).toBe("运行出错等");
        expect(view.get("[role='status']").text()).toContain("已暂停 2 条");
        // 留着的两条都在，就绪的只显示 3 条，第 4 条收起。
        const shown = view.findAll("li[data-queued]").map((row) => row.attributes("data-held"));
        expect(shown).toEqual(["true", "false", "false", "false", "true"]);
        expect(view.findAll("li[data-queued]")[0]!.attributes("aria-label")).toBe("已暂停：留着 h1");
        expect(view.get("[data-queued-more]").text()).toBe("还有 1 条");
        await view.get("[data-queued-more]").trigger("click");
        expect(view.findAll("li[data-queued]")).toHaveLength(6);
        await view.get("[data-queued-continue]").trigger("click");
        expect(view.emitted("continue")).toEqual([[]]);
    });

    it("原因只有一种时不加“等”；continueDisabled 有值时继续不可用并写原因；没有留着的就没有头行", async () => {
        const one = mountQueued({queued: [held("h1", "运行出错"), held("h2", "运行出错")], continueDisabled: "正在停止"});
        expect(one.view.get(".acv-queued__head-reason").text()).toBe("运行出错");
        const button = one.view.get("[data-queued-continue]");
        expect(button.attributes("disabled")).toBeDefined();
        expect(button.attributes("title")).toBe("正在停止");
        await button.trigger("click");
        expect(one.view.emitted("continue")).toBeUndefined();

        const none = mountQueued({queued: [ready("a")]});
        expect(none.view.find("[data-queued-head]").exists()).toBe(false);
        expect(none.view.get("[role='status']").text()).toBe("");
    });
});
