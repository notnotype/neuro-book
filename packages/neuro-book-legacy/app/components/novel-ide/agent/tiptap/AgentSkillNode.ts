import {mergeAttributes, Node, type Editor, type NodeViewProps} from "@tiptap/core";
import type {MarkdownToken} from "@tiptap/core";
import {PluginKey} from "@tiptap/pm/state";
import {VueNodeViewRenderer} from "@tiptap/vue-3";
import {Suggestion, type SuggestionMatch} from "@tiptap/suggestion";
import type {Component} from "vue";
import type {
    AgentTriggerMenuContext,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {
    AgentSuggestionController,
} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import {
    createAgentSuggestionRenderer,
    flattenAgentSuggestionItems,
    insertAgentSuggestionItem,
} from "nbook/app/components/novel-ide/agent/tiptap/agent-suggestion";
import AgentSkillNodeView from "nbook/app/components/novel-ide/agent/tiptap/AgentSkillNodeView.vue";
import {findAgentTriggerMatch} from "nbook/shared/reference-trigger";

interface SkillToken extends MarkdownToken {
    name?: string;
}

interface AgentSkillOptions extends AgentSuggestionController {
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
}

const SKILL_PATTERN = /^(\$(?:([\p{L}_-][\p{L}\p{N}_-]*)|\{([\p{L}_-][\p{L}\p{N}_-]*)\}))/u;
const SKILL_START_PATTERN = /(?:^|[\s(])\$(?:[\p{L}_-]|\{[\p{L}_-])/u;

/**
 * Agent 输入器里的技能节点与技能 trigger。
 */
export const AgentSkill = Node.create<AgentSkillOptions>({
    name: "agentSkill",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    priority: 1150,

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

    addAttributes() {
        return {
            name: {
                default: "",
            },
        };
    },

    parseHTML() {
        return [{
            tag: "span[data-agent-skill-name]",
            getAttrs: (dom) => {
                const element = dom as HTMLElement;
                return {
                    name: element.dataset.agentSkillName ?? "",
                };
            },
        }];
    },

    renderHTML({HTMLAttributes}) {
        return ["span", mergeAttributes(HTMLAttributes, {
            "data-agent-skill-name": HTMLAttributes.name,
            contenteditable: "false",
        })];
    },

    addNodeView() {
        return VueNodeViewRenderer(AgentSkillNodeView as Component<NodeViewProps>);
    },

    markdownTokenizer: {
        name: "agentSkill",
        level: "inline",
        start(src: string) {
            const matched = SKILL_START_PATTERN.exec(src);
            if (!matched) {
                return -1;
            }
            return (matched.index ?? 0) + matched[0].lastIndexOf("$");
        },
        tokenize(src: string) {
            const matched = SKILL_PATTERN.exec(src);
            if (!matched) {
                return undefined;
            }

            return {
                type: "agentSkill",
                raw: matched[1],
                name: matched[2] ?? matched[3],
            };
        },
    },

    parseMarkdown: (token, helpers) => {
        const skillToken = token as SkillToken;
        return helpers.createNode("agentSkill", {
            name: skillToken.name ?? "",
        });
    },

    renderMarkdown: (node) => {
        const name = String(node.attrs?.name ?? "");
        return name ? `$${name}` : "";
    },

    addKeyboardShortcuts() {
        return {
            Backspace: () => this.editor.state.selection.empty
                && degradeAdjacentSkill(this.editor.state.selection.from, -1, this.editor),
            Delete: () => this.editor.state.selection.empty
                && degradeAdjacentSkill(this.editor.state.selection.from, 1, this.editor),
        };
    },

    addProseMirrorPlugins() {
        const pluginKey = new PluginKey("agent-skill-trigger");
        let currentMenuState: AgentTriggerMenuState | null = null;
        return [Suggestion({
            editor: this.editor,
            pluginKey,
            char: "$",
            allow: ({state, range}) => {
                if (!state.selection.empty) {
                    return false;
                }

                const skillNodeType = state.schema.nodes[this.name];
                if (!skillNodeType) {
                    return false;
                }

                const $from = state.doc.resolve(range.from);
                return !!$from.parent.type.contentMatch.matchType(skillNodeType);
            },
            findSuggestionMatch: ({$position}): SuggestionMatch => {
                const text = $position.nodeBefore?.isText ? $position.nodeBefore.text ?? "" : "";
                if (!text) {
                    return null;
                }

                const matched = findAgentTriggerMatch(text, "skill");
                if (!matched) {
                    return null;
                }

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
                    kind: "skill",
                    query,
                });
                return flattenAgentSuggestionItems(currentMenuState.sections);
            },
            render: createAgentSuggestionRenderer({
                pluginKey,
                controller: this.options,
                contextKind: "skill",
                resolveMenuState: (query) => {
                    if (!currentMenuState) {
                        currentMenuState = this.options.resolveMenu({
                            kind: "skill",
                            query,
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
                    skillNodeName: this.name,
                });
            },
        })];
    },
});

/**
 * 将紧邻光标的技能节点退化回 `$技能名` 文本。
 */
function degradeAdjacentSkill(position: number, direction: -1 | 1, editor: Editor): boolean {
    const resolved = editor.state.doc.resolve(position);
    const adjacentNode = direction < 0 ? resolved.nodeBefore : resolved.nodeAfter;
    if (!adjacentNode || adjacentNode.type?.name !== "agentSkill") {
        return false;
    }

    const degradedTrigger = `$${String(adjacentNode.attrs?.name ?? "")}`;
    const from = direction < 0 ? position - adjacentNode.nodeSize : position;
    const to = direction < 0 ? position : position + adjacentNode.nodeSize;

    editor.chain().focus().insertContentAt({from, to}, degradedTrigger).run();
    const nextPosition = direction < 0 ? from + degradedTrigger.length : from;
    editor.commands.setTextSelection(nextPosition);
    return true;
}
