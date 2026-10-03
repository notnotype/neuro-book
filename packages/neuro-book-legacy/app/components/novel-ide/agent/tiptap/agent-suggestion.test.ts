import {PluginKey} from "@tiptap/pm/state";
import {describe, expect, it} from "vitest";
import {createAgentSuggestionRenderer, type AgentSuggestionMenuState} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import type {AgentTriggerMenuItem} from "nbook/app/components/novel-ide/agent/trigger-menu";

describe("createAgentSuggestionRenderer", () => {
    it("保留 command trigger 的前置文本状态", () => {
        let menuState: AgentSuggestionMenuState | null = null;
        const readMenuState = (): AgentSuggestionMenuState | null => menuState;
        const item: AgentTriggerMenuItem = {
            id: "command:plan",
            label: "plan",
            description: "切换 Plan Mode。",
            iconClass: "i-lucide-clipboard-list",
            insertText: "/plan",
        };
        const renderer = createAgentSuggestionRenderer({
            pluginKey: new PluginKey("test-command-trigger"),
            contextKind: "command",
            controller: {
                onMenuStateChange: (state) => {
                    menuState = state;
                },
                getMenuState: () => menuState,
                getActiveIndex: () => 0,
                setActiveIndex: () => {},
            },
            resolveMenuState: () => ({
                title: "执行命令",
                prefix: "/",
                sections: [{id: "command", items: [item]}],
            }),
            resolveContext: (query) => ({
                kind: "command",
                query,
                hasPlainTextBeforeTrigger: true,
            }),
        })();

        renderer.onStart?.({
            query: "pl",
            items: [item],
            command: () => {},
            clientRect: () => null,
        } as never);

        const currentMenuState = readMenuState();
        assertMenuState(currentMenuState);
        expect(currentMenuState.contextKind).toBe("command");
        expect(currentMenuState.query).toBe("pl");
        expect(currentMenuState.hasPlainTextBeforeTrigger).toBe(true);
    });
});

function assertMenuState(value: AgentSuggestionMenuState | null): asserts value is AgentSuggestionMenuState {
    expect(value).not.toBeNull();
    if (!value) {
        throw new Error("menu state missing");
    }
}
