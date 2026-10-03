import {describe, expect, it} from "vitest";
import {fauxAssistantMessage} from "@earendil-works/pi-ai";
import {createFauxModels} from "nbook/server/agent/test-utils/faux-models";

describe("createFauxModels", () => {
    it("并行 suite 的 response queue 不会互相消费", async () => {
        const left = createFauxModels({provider: "left"});
        const right = createFauxModels({provider: "right"});
        left.setResponses([fauxAssistantMessage("left response")]);
        right.setResponses([fauxAssistantMessage("right response")]);

        const [leftMessage, rightMessage] = await Promise.all([
            left.runtime.completeSimple(left.getModel(), {messages: []}),
            right.runtime.completeSimple(right.getModel(), {messages: []}),
        ]);

        expect(leftMessage.content).toEqual([{type: "text", text: "left response"}]);
        expect(rightMessage.content).toEqual([{type: "text", text: "right response"}]);
        expect(left.getPendingResponseCount()).toBe(0);
        expect(right.getPendingResponseCount()).toBe(0);
    });
});
