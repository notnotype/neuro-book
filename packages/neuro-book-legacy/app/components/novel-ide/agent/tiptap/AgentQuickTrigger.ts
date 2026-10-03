import {Extension} from "@tiptap/core";
import {PluginKey} from "@tiptap/pm/state";
import {Suggestion, type SuggestionMatch} from "@tiptap/suggestion";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {AgentSuggestionController} from "./agent-suggestion";
import {
    createAgentSuggestionRenderer,
    flattenAgentSuggestionItems,
    insertAgentSuggestionItem,
} from "./agent-suggestion";
import {findAgentTriggerMatch} from "nbook/shared/reference-trigger";

type QuickTriggerKind = Extract<AgentTriggerMenuContext["kind"], "command">;

interface QuickTriggerOption {
    kind: QuickTriggerKind;
    char: string;
    pluginKey: PluginKey;
}

interface AgentQuickTriggerOptions extends AgentSuggestionController {
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    suggestions: QuickTriggerOption[];
}

/**
 * 纯文本命令 trigger。
 */
export const AgentQuickTrigger = Extension.create<AgentQuickTriggerOptions>({
    name: "agentQuickTrigger",

    addOptions() {
        return {
            resolveMenu: () => ({
                title: "",
                prefix: "",
                sections: [],
            }),
            onMenuStateChange: () => {},
            getMenuState: () => null,
            getActiveIndex: () => 0,
            setActiveIndex: () => {},
            suggestions: [
                {
                    kind: "command",
                    char: "/",
                    pluginKey: new PluginKey("agent-command-trigger"),
                },
            ],
        };
    },

    addProseMirrorPlugins() {
        return this.options.suggestions.map((suggestion) => {
            let currentMenuState: AgentTriggerMenuState | null = null;
            let hasPlainTextBeforeTrigger = false;
            return Suggestion({
                editor: this.editor,
                pluginKey: suggestion.pluginKey,
                char: suggestion.char,
                allow: ({state}) => state.selection.empty,
                findSuggestionMatch: ({$position}): SuggestionMatch => {
                    const text = $position.nodeBefore?.isText ? $position.nodeBefore.text ?? "" : "";
                    if (!text) {
                        return null;
                    }

                    const matched = findAgentTriggerMatch(text, suggestion.kind);
                    if (!matched) {
                        return null;
                    }

                    hasPlainTextBeforeTrigger = matched.hasPlainTextBeforeTrigger;
                    const textStart = $position.pos - text.length;
                    return {
                        range: {
                            from: textStart + matched.from,
                            to: textStart + matched.to,
                        },
                        query: matched.query,
                        text: matched.text,
                    };
                },
                items: ({query}) => {
                    currentMenuState = this.options.resolveMenu({
                        kind: suggestion.kind,
                        query,
                        hasPlainTextBeforeTrigger,
                    });
                    return flattenAgentSuggestionItems(currentMenuState.sections);
                },
                render: createAgentSuggestionRenderer({
                    pluginKey: suggestion.pluginKey,
                    controller: this.options,
                    contextKind: suggestion.kind,
                    resolveContext: (query) => ({
                        kind: suggestion.kind,
                        query,
                        hasPlainTextBeforeTrigger,
                    }),
                    resolveMenuState: (query) => {
                        if (!currentMenuState) {
                            currentMenuState = this.options.resolveMenu({
                                kind: suggestion.kind,
                                query,
                                hasPlainTextBeforeTrigger,
                            });
                        }
                        return currentMenuState;
                    },
                }),
                command: ({editor, range, props}) => {
                    insertAgentSuggestionItem({
                        editor,
                        range,
                        item: props,
                    });
                },
            });
        });
    },
});
