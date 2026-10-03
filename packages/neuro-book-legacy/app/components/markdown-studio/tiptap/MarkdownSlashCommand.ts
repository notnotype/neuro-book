import {Extension, type Editor, type Range} from "@tiptap/core";
import {PluginKey} from "@tiptap/pm/state";
import {Suggestion, type SuggestionMatch} from "@tiptap/suggestion";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuItem,
    AgentTriggerMenuState,
    MarkdownCommandKind,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {AgentSuggestionController} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import {
    createAgentSuggestionRenderer,
    expandSuggestionRange,
    flattenAgentSuggestionItems,
} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";

interface MarkdownSlashCommandOptions extends AgentSuggestionController {
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
}

const slashCommandPluginKey = new PluginKey("markdown-slash-command");

/**
 * Markdown Studio 的 / 命令入口。
 */
export const MarkdownSlashCommand = Extension.create<MarkdownSlashCommandOptions>({
    name: "markdownSlashCommand",

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
        };
    },

    addProseMirrorPlugins() {
        let currentMenuState: AgentTriggerMenuState | null = null;
        return [Suggestion({
            editor: this.editor,
            pluginKey: slashCommandPluginKey,
            char: "/",
            allow: ({state}) => state.selection.empty,
            findSuggestionMatch: ({$position}): SuggestionMatch => {
                const text = $position.nodeBefore?.isText ? $position.nodeBefore.text ?? "" : "";
                if (!text) {
                    return null;
                }
                const matched = /(?:^|[\s(])(\/[^\s)]*)$/u.exec(text);
                const raw = matched?.[1];
                if (!raw) {
                    return null;
                }
                const textStart = $position.pos - text.length;
                const from = textStart + text.length - raw.length;
                return {
                    range: {
                        from,
                        to: $position.pos,
                    },
                    query: raw.slice(1),
                    text: raw,
                };
            },
            items: ({query}) => {
                currentMenuState = this.options.resolveMenu({
                    kind: "command",
                    query,
                });
                return flattenAgentSuggestionItems(currentMenuState.sections);
            },
            render: createAgentSuggestionRenderer({
                pluginKey: slashCommandPluginKey,
                controller: this.options,
                contextKind: "command",
                resolveMenuState: (query) => {
                    if (!currentMenuState) {
                        currentMenuState = this.options.resolveMenu({
                            kind: "command",
                            query,
                        });
                    }
                    return currentMenuState;
                },
            }),
            command: ({editor, range, props}) => {
                applyMarkdownCommand(editor, range, props);
            },
        })];
    },
});

/**
 * 执行 slash command 菜单项。
 */
function applyMarkdownCommand(editor: Editor, range: Range, item: AgentTriggerMenuItem): void {
    if (item.disabled) {
        return;
    }
    const nextRange = expandSuggestionRange(editor, range, false);
    if (item.markdownCommand) {
        runEditorCommand(editor, nextRange, item.markdownCommand);
        return;
    }
    if (item.insertText) {
        editor.chain().focus().insertContentAt(nextRange, `${item.insertText}${item.trailingSpace === false ? "" : " "}`).run();
    }
}

/**
 * 将命令映射到 Tiptap chain 操作。
 */
function runEditorCommand(editor: Editor, range: Range, command: MarkdownCommandKind): void {
    const chain = editor.chain().focus().deleteRange(range);
    if (command === "paragraph") {
        chain.setParagraph().run();
        return;
    }
    if (command === "heading-1" || command === "heading-2" || command === "heading-3") {
        chain.toggleHeading({level: Number(command.slice(-1)) as 1 | 2 | 3}).run();
        return;
    }
    if (command === "bullet-list") {
        chain.toggleBulletList().run();
        return;
    }
    if (command === "ordered-list") {
        chain.toggleOrderedList().run();
        return;
    }
    if (command === "blockquote") {
        chain.toggleBlockquote().run();
        return;
    }
    if (command === "code-block") {
        chain.toggleCodeBlock().run();
        return;
    }
    if (command === "horizontal-rule") {
        chain.setHorizontalRule().run();
        return;
    }
    if (command === "reference") {
        chain.insertContent("@").run();
        return;
    }
    if (command === "comment") {
        chain.insertContent(`<comment body="评论">comment</comment>`, {contentType: "markdown"}).run();
    }
}
