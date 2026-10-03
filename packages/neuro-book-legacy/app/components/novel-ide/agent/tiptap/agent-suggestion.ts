import type {Editor, Range} from "@tiptap/core";
import type {PluginKey} from "@tiptap/pm/state";
import {exitSuggestion, type SuggestionOptions, type SuggestionProps} from "@tiptap/suggestion";
import type {
    AgentTriggerMenuItem,
    AgentTriggerMenuContext,
    AgentTriggerMenuSection,
    AgentTriggerMenuState,
} from "nbook/app/components/novel-ide/agent/trigger-menu";

export interface AgentSuggestionMenuState extends AgentTriggerMenuState {
    contextKind: AgentTriggerMenuContext["kind"];
    query: string;
    hasPlainTextBeforeTrigger?: boolean;
    items: AgentTriggerMenuItem[];
    command: (item: AgentTriggerMenuItem) => void;
    anchorRect: DOMRect | null;
}

export interface AgentSuggestionController {
    onMenuStateChange: (state: AgentSuggestionMenuState | null) => void;
    getMenuState: () => AgentSuggestionMenuState | null;
    getActiveIndex: () => number;
    setActiveIndex: (index: number) => void;
}

interface CreateAgentSuggestionRendererOptions {
    pluginKey: PluginKey;
    controller: AgentSuggestionController;
    resolveMenuState: (query: string) => AgentTriggerMenuState;
    resolveContext?: (query: string) => AgentTriggerMenuContext;
    contextKind: AgentTriggerMenuContext["kind"];
}

/**
 * 将菜单分组拍平成 Suggestion 需要的 items。
 */
export function flattenAgentSuggestionItems(sections: AgentTriggerMenuSection[]): AgentTriggerMenuItem[] {
    return sections.flatMap((section) => section.items);
}

/**
 * 计算下一个可执行菜单项索引，disabled 项只展示不参与键盘选择。
 */
function nextSelectableIndex(items: AgentTriggerMenuItem[], currentIndex: number, direction: 1 | -1): number {
    if (items.length === 0 || items.every((item) => item.disabled)) {
        return 0;
    }
    let nextIndex = currentIndex;
    for (let count = 0; count < items.length; count += 1) {
        nextIndex = (nextIndex + direction + items.length) % items.length;
        if (!items[nextIndex]?.disabled) {
            return nextIndex;
        }
    }
    return 0;
}

/**
 * 将当前索引收敛到可执行菜单项。
 */
function normalizeSelectableIndex(items: AgentTriggerMenuItem[], currentIndex: number): number {
    if (items.length === 0 || items.every((item) => item.disabled)) {
        return 0;
    }
    const safeIndex = Math.min(Math.max(currentIndex, 0), items.length - 1);
    if (!items[safeIndex]?.disabled) {
        return safeIndex;
    }
    return nextSelectableIndex(items, safeIndex, 1);
}

/**
 * 生成 Agent 输入器菜单的统一 renderer。
 */
export function createAgentSuggestionRenderer(
    options: CreateAgentSuggestionRendererOptions,
): NonNullable<SuggestionOptions<AgentTriggerMenuItem, AgentTriggerMenuItem>["render"]> {
    return () => {
        const syncMenuState = (props: SuggestionProps<AgentTriggerMenuItem, AgentTriggerMenuItem>): void => {
            const menuState = options.resolveMenuState(props.query);
            if (props.items.length === 0) {
                options.controller.setActiveIndex(0);
                options.controller.onMenuStateChange(null);
                return;
            }

            const activeIndex = normalizeSelectableIndex(props.items, options.controller.getActiveIndex());
            options.controller.setActiveIndex(activeIndex);
            const context = options.resolveContext?.(props.query);
            options.controller.onMenuStateChange({
                contextKind: context?.kind ?? options.contextKind,
                query: context?.query ?? props.query,
                hasPlainTextBeforeTrigger: context?.hasPlainTextBeforeTrigger,
                title: menuState.title,
                prefix: menuState.prefix,
                sections: menuState.sections,
                items: props.items,
                command: props.command,
                anchorRect: props.clientRect?.() ?? null,
            });
        };

        return {
            onStart: (props) => {
                options.controller.setActiveIndex(0);
                syncMenuState(props);
            },
            onUpdate: (props) => {
                syncMenuState(props);
            },
            onExit: () => {
                options.controller.setActiveIndex(0);
                options.controller.onMenuStateChange(null);
            },
            onKeyDown: ({view, event}) => {
                const currentState = options.controller.getMenuState();
                if (!currentState) {
                    return false;
                }

                if (event.key === "ArrowDown") {
                    event.preventDefault();
                    options.controller.setActiveIndex(nextSelectableIndex(currentState.items, options.controller.getActiveIndex(), 1));
                    return true;
                }

                if (event.key === "ArrowUp") {
                    event.preventDefault();
                    options.controller.setActiveIndex(nextSelectableIndex(currentState.items, options.controller.getActiveIndex(), -1));
                    return true;
                }

                if ((event.key === "Enter" || event.key === "Tab") && currentState.items.length > 0) {
                    event.preventDefault();
                    const targetItem = currentState.items[options.controller.getActiveIndex()];
                    if (targetItem && !targetItem.disabled) {
                        currentState.command(targetItem);
                    }
                    return true;
                }

                if (event.key === "Escape") {
                    event.preventDefault();
                    exitSuggestion(view, options.pluginKey);
                    return true;
                }

                return false;
            },
        };
    };
}

/**
 * 插入建议项前，吞掉光标后的已有空格，避免产生双空格。
 */
export function expandSuggestionRange(editor: Editor, range: Range, trailingSpace: boolean): Range {
    const nextRange = {
        from: range.from,
        to: range.to,
    };
    if (!trailingSpace) {
        return nextRange;
    }

    const nodeAfter = editor.view.state.selection.$to.nodeAfter;
    if (nodeAfter?.text?.startsWith(" ")) {
        nextRange.to += 1;
    }
    return nextRange;
}

interface InsertAgentSuggestionItemOptions {
    editor: Editor;
    range: Range;
    item: AgentTriggerMenuItem;
    referenceNodeName?: string;
    skillNodeName?: string;
}

/**
 * 把 suggestion 菜单项写回编辑器。
 */
export function insertAgentSuggestionItem(options: InsertAgentSuggestionItemOptions): void {
    if (options.item.disabled) {
        return;
    }
    if (options.item.action) {
        const nextRange = expandSuggestionRange(options.editor, options.range, false);
        options.editor.chain().focus().deleteRange(nextRange).setTextSelection(nextRange.from).run();
        void options.item.action({position: nextRange.from});
        return;
    }
    const trailingSpace = Boolean(options.item.reference) || Boolean(options.item.skill) || options.item.trailingSpace !== false;
    const nextRange = expandSuggestionRange(options.editor, options.range, trailingSpace);

    if (options.item.reference && options.referenceNodeName) {
        options.editor.chain().focus().insertContentAt(nextRange, [
            {
                type: options.referenceNodeName,
                attrs: {
                    kind: options.item.reference.kind,
                    targetId: options.item.reference.targetId,
                    label: options.item.reference.title,
                },
            },
            {
                type: "text",
                text: " ",
            },
        ]).run();
        return;
    }

    if (options.item.skill && options.skillNodeName) {
        options.editor.chain().focus().insertContentAt(nextRange, [
            {
                type: options.skillNodeName,
                attrs: {
                    name: options.item.skill.name,
                },
            },
            {
                type: "text",
                text: " ",
            },
        ]).run();
        return;
    }

    if (!options.item.insertText) {
        return;
    }

    const text = `${options.item.insertText}${options.item.trailingSpace === false ? "" : " "}`;
    options.editor.chain().focus().insertContentAt(nextRange, text).run();
}
