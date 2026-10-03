import {describe, expect, it} from "vitest";
import {createAssistantTextMessage} from "nbook/server/agent/messages/message-utils";
import {sanitizeProviderAssistant} from "nbook/server/agent/harness/turn-failure";

describe("sanitizeProviderAssistant toolCall identity", () => {
    it("完整保留 512-byte ID，并拒绝空或超长 ID", () => {
        const valid = createAssistantTextMessage({text: ""});
        const validId = "x".repeat(512);
        valid.content = [{type: "toolCall", id: validId, name: "read", arguments: {path: "a.md"}}];
        expect(sanitizeProviderAssistant(valid).content[0]).toEqual(expect.objectContaining({id: validId}));

        for (const id of ["", `${validId}a`, `${validId}b`, "界".repeat(171)]) {
            const invalid = createAssistantTextMessage({text: ""});
            invalid.content = [{type: "toolCall", id, name: "read", arguments: {path: "a.md"}}];
            expect(() => sanitizeProviderAssistant(invalid)).toThrow("provider_tool_call_id_invalid");
        }
    });
});
