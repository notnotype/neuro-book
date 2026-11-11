/**
 * `nbook.canon` 浏览器入口的命令（docs/specs/canon/author-ui.md 的“输入与前置条件”的命令表）。标题省略，登记时补成约定键
 * `commands.<本地 id>.title`（`locales/`，本地 id 是去掉插件 id 前缀的命令 id）。
 */

import {Type} from "typebox";

import type {CommandImplementation, CommandResult, CommandService, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {OPEN_PAGE_COMMAND} from "nbook/plugins/editor/shared/contracts";

import {canonText} from "../shared/text";

export const OPEN_ENTRY_COMMAND = "nbook.canon.open-entry";
/** 条目页（author-ui.md 输出 6 起；页面在第一批的条目页一片登记）。 */
export const ENTRY_PAGE = "nbook.canon.entry";

const OPEN_ENTRY_ARGS = Type.Object({id: Type.String({minLength: 1})}, {additionalProperties: false});

export const CANON_COMMAND_DECLARATIONS: Readonly<Record<string, WrittenCommandDeclaration>> = {
    [OPEN_ENTRY_COMMAND]: {category: canonText("commands.category"), description: "Open the entry page of a lore entry by its id; an entry page already open in the window is activated instead of opened twice.", args: OPEN_ENTRY_ARGS, effect: "read"},
};

/**
 * `commands` 为 null 时（窗口里没有命令服务，只在只装世界客户端的测试窗口里）命令照样登记，执行得到 `unavailable`：声明了的
 * 贡献必须交实现。
 */
export function canonCommands(commands: Pick<CommandService, "execute"> | null): Record<string, CommandImplementation> {
    const missing: CommandResult<unknown> = {ok: false, code: "unavailable", reason: "no command service in this window"};
    return {
        [OPEN_ENTRY_COMMAND]: {
            run: async (args): Promise<CommandResult<unknown>> => (commands === null ? missing : commands.execute(OPEN_PAGE_COMMAND, {id: ENTRY_PAGE, arg: (args as {id: string}).id})),
        },
    };
}
