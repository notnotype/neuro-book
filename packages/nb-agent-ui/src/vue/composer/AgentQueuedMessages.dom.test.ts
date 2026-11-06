import {mount} from "@vue/test-utils";
import {describe, expect, it} from "vitest";

import AgentQueuedMessages from "./AgentQueuedMessages.vue";

describe("AgentQueuedMessages", () => {
    it("每行能删，能取出来改", async () => {
        const view = mount(AgentQueuedMessages, {props: {queued: [{id: "a", text: "排着的", delivery: "followup"}]}});
        await view.get("[data-queued-edit]").trigger("click");
        await view.get("[data-queued-remove]").trigger("click");
        expect(view.emitted("edit")).toEqual([["a"]]);
        expect(view.emitted("remove")).toEqual([["a"]]);
    });
});
