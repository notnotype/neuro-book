import {describe, expect, it} from "vitest";
import {createUserMessage} from "nbook/server/agent/messages/message-utils";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import {
    assemblePersistedProfilePromptMessages,
    assembleProfilePromptMessages,
} from "nbook/server/agent/profiles/prompt-order";

describe("profile prompt message order", () => {
    it("固定组装 History → ModelContext → AppendingSet → CurrentUserInput", () => {
        const messages = assembleProfilePromptMessages({
            history: [message("HISTORY")],
            modelContext: [message("MODEL_CONTEXT")],
            appending: [message("APPENDING")],
            currentUserInput: [message("CURRENT_USER_INPUT")],
        });

        expect(messages.map(testMessageText)).toEqual([
            "HISTORY",
            "MODEL_CONTEXT",
            "APPENDING",
            "CURRENT_USER_INPUT",
        ]);
    });

    it("从已持久化尾部把 ModelContext 插回 AppendingSet 之前", () => {
        const messages = assemblePersistedProfilePromptMessages({
            persistedMessages: [message("HISTORY"), message("MODEL_REMINDER"), message("APPENDING"), message("PROMPT")],
            modelContext: [message("RUNTIME_CONTEXT"), message("MODEL_ONLY")],
            appendingCount: 2,
            currentUserInputCount: 1,
        });

        expect(messages.map(testMessageText)).toEqual([
            "HISTORY",
            "RUNTIME_CONTEXT",
            "MODEL_ONLY",
            "MODEL_REMINDER",
            "APPENDING",
            "PROMPT",
        ]);
    });

    it("分区计数越界时拒绝静默错序", () => {
        expect(() => assemblePersistedProfilePromptMessages({
            persistedMessages: [message("PROMPT")],
            modelContext: [],
            appendingCount: 1,
            currentUserInputCount: 1,
        })).toThrow("Profile prompt 尾部分区越界");
    });
});

function message(text: string) {
    return createUserMessage({text});
}

function testMessageText(message: StoredAgentMessage): string {
    if (message.role !== "user") {
        return message.role;
    }
    return storedMessageText(message);
}
