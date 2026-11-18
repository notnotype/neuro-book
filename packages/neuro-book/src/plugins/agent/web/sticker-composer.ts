/**
 * Agent 输入框里的表情（docs/specs/agent/stickers.md 输出 39 到 45）：`:` 的补全菜单、`+` 后面的表情按钮（弹层里是表情包插件交出的
 * 选择器面板），以及“只有表情的消息不画气泡”的判断。都建在表情包插件的选择器服务上；没装表情包插件时宿主不调这里。
 */

import type {AgentViewContribution, PromptBarenessPort, ToolbarPopoverProps, TriggerMenu} from "@notnotype/nb-agent-ui";
import {defineComponent, h, markRaw} from "vue";
import type {Component, PropType} from "vue";

import type {StickerPicker, StickerPickerItem} from "nbook/plugins/stickers/shared/contracts";

import {agentText} from "../shared/text";

/** 补全至多列这么多项（输出 42）。 */
const MENU_LIMIT = 8;

/**
 * `:` 的补全菜单：同步交回（`resolveTriggerMenu` 的约定），选择器服务背后是响应式状态，拼音库、目录到了编辑器重取。没有匹配时不显示
 * （`hideWhenEmpty`），回车照常发送；表情项不补空格。选了哪一项由会话宿主经 `menu.selected` 记进最近用过。
 */
export function stickerMenu(picker: StickerPicker, query: string): TriggerMenu {
    return {
        hideWhenEmpty: true,
        items: picker.search(query, MENU_LIMIT).map((item) => ({id: item.raw, label: item.name, description: item.packTitle, imageUrl: item.url, insertText: item.raw, appendSpace: false})),
    };
}

/**
 * 输入框的登记：触发字符 `:` 与 `+` 后面的表情按钮。按钮的弹层第一次打开时才加载面板的代码；面板选了表情就插进编辑器、记进最近用过，
 * 按住 Shift 选的不关。另交回“只有表情”的判断（nb-markdown 的 `stickerOnlyMessage`，只认得出的写法算）。
 */
export async function stickersContribution(picker: StickerPicker, report: (message: string, error: unknown) => void): Promise<{contribution: AgentViewContribution; bareness: PromptBarenessPort}> {
    const {stickerOnlyMessage} = await import("@notnotype/nb-markdown/prompt");
    const popover = async (): Promise<Component<ToolbarPopoverProps>> => {
        const Panel = await picker.loadPanel().catch((error: unknown) => {
            report("loading the sticker picker failed", error);
            throw error;
        });
        return markRaw(defineComponent({
            name: "AgentStickerPopover",
            props: {
                insert: {type: Function as PropType<ToolbarPopoverProps["insert"]>, required: true},
                close: {type: Function as PropType<ToolbarPopoverProps["close"]>, required: true},
            },
            setup: (props) => () => h(Panel, {
                onPick: (item: StickerPickerItem, keepOpen: boolean) => {
                    props.insert(item.raw);
                    picker.used(item);
                    if (!keepOpen) props.close();
                },
                // Esc 时焦点回编辑器；焦点离开面板时已在别处，不抢。
                onClose: (reason: "escape" | "blur") => props.close({restoreFocus: reason === "escape"}),
            }),
        }));
    };
    return {
        contribution: {
            source: "nbook.stickers",
            triggers: [{id: "sticker", order: 40, char: ":"}],
            toolbarButtons: [{id: "stickers", icon: "i-lucide-smile-plus", label: agentText("conversation.stickers.button"), placement: "after-add", popover}],
        },
        bareness: (texts) => stickerOnlyMessage(texts, (raw) => picker.known(raw)),
    };
}
