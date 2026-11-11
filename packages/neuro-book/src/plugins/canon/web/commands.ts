/**
 * `nbook.canon` 浏览器入口的命令（docs/specs/canon/author-ui.md 的“输入与前置条件”的命令表）。标题省略，登记时补成约定键
 * `commands.<本地 id>.title`（`locales/`，本地 id 是去掉插件 id 前缀的命令 id）。
 */

import {Type} from "typebox";

import type {CommandImplementation, CommandResult, CommandService, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {OPEN_PAGE_COMMAND} from "nbook/plugins/editor/shared/contracts";
import {OPEN_VIEW_COMMAND} from "nbook/plugins/workbench/shared/contracts";

import {canonText} from "../shared/text";

export const OPEN_ENTRY_COMMAND = "nbook.canon.open-entry";
export const OPEN_RECEIPT_COMMAND = "nbook.canon.open-receipt";
export const OPEN_CHANGE_COMMAND = "nbook.canon.open-change";
export const NEW_ENTRY_COMMAND = "nbook.canon.new-entry";
/** 编辑器打开一个文件的命令（workbench/editor.md 的命令表）：变更详情页的“打开这一章”。 */
export const EDITOR_OPEN_COMMAND = "nbook.editor.open";
/** 设定视图（命令打开对话框前先显示它）。与 `plugin.ts` 的 `ENTRIES_VIEW_ID` 是同一个，这里写字面量免得成环。 */
const ENTRIES_VIEW = "nbook.canon.entries";
/** 条目页、回执页、变更详情页（author-ui.md 输出 6、20、21）。 */
export const ENTRY_PAGE = "nbook.canon.entry";
export const RECEIPT_PAGE = "nbook.canon.receipt";
export const CHANGE_PAGE = "nbook.canon.change";

const ID_ARGS = Type.Object({id: Type.String({minLength: 1})}, {additionalProperties: false});
const OPEN_RECEIPT_ARGS = Type.Object({revision: Type.String({minLength: 1})}, {additionalProperties: false});
const NEW_ENTRY_ARGS = Type.Object({parent: Type.Optional(Type.String({minLength: 1}))}, {additionalProperties: false});

export const CANON_COMMAND_DECLARATIONS: Readonly<Record<string, WrittenCommandDeclaration>> = {
    [OPEN_ENTRY_COMMAND]: {category: canonText("commands.category"), description: "Open the entry page of a lore entry by its id; an entry page already open in the window is activated instead of opened twice.", args: ID_ARGS, effect: "read"},
    [OPEN_RECEIPT_COMMAND]: {category: canonText("commands.category"), description: "Open the receipt page of one world revision by its id: what it changed, what followed from it, and a way to revert it.", args: OPEN_RECEIPT_ARGS, effect: "read"},
    [OPEN_CHANGE_COMMAND]: {category: canonText("commands.category"), description: "Open the detail page of one story change by its id: its text, placement, quotes, involved entries and each change it makes.", args: ID_ARGS, effect: "read"},
    // 只打开对话框，写入在作者确认以后；不给 Agent（它新建条目走世界服务的写入）。
    [NEW_ENTRY_COMMAND]: {category: canonText("commands.category"), description: "Show the Lore view and open the new-entry dialog, optionally under a parent entry.", args: NEW_ENTRY_ARGS, effect: "read", expose: {agent: "never"}},
};

/**
 * `commands` 为 null 时（窗口里没有命令服务，只在只装世界客户端的测试窗口里）命令照样登记，执行得到 `unavailable`：声明了的
 * 贡献必须交实现。
 */
export function canonCommands(commands: Pick<CommandService, "execute"> | null, newEntry: (parent: string | null) => void): Record<string, CommandImplementation> {
    const missing: CommandResult<unknown> = {ok: false, code: "unavailable", reason: "no command service in this window"};
    return {
        [OPEN_ENTRY_COMMAND]: {
            run: async (args): Promise<CommandResult<unknown>> => (commands === null ? missing : commands.execute(OPEN_PAGE_COMMAND, {id: ENTRY_PAGE, arg: (args as {id: string}).id})),
        },
        [OPEN_RECEIPT_COMMAND]: {
            run: async (args): Promise<CommandResult<unknown>> => (commands === null ? missing : commands.execute(OPEN_PAGE_COMMAND, {id: RECEIPT_PAGE, arg: (args as {revision: string}).revision})),
        },
        [OPEN_CHANGE_COMMAND]: {
            run: async (args): Promise<CommandResult<unknown>> => (commands === null ? missing : commands.execute(OPEN_PAGE_COMMAND, {id: CHANGE_PAGE, arg: (args as {id: string}).id})),
        },
        [NEW_ENTRY_COMMAND]: {
            run: async (args): Promise<CommandResult<unknown>> => {
                if (commands === null) return missing;
                newEntry((args as {parent?: string}).parent ?? null);
                return commands.execute(OPEN_VIEW_COMMAND, {viewId: ENTRIES_VIEW});
            },
        },
    };
}
