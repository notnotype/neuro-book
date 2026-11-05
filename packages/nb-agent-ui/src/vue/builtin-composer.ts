/**
 * 内置的输入框触发字符与命令。命令沿用旧输入框的那一套；视图只负责识别并发出 `command.run`，
 * 能不能执行、怎么执行由宿主决定。
 */
import type {AgentViewContribution, ComposerCommandEntry, ComposerTriggerEntry} from "../registry";
import {agentRef} from "../text";
import type {AgentTextKey} from "../text";

const triggers: ComposerTriggerEntry[] = [
    {id: "reference", order: 10, char: "@"},
    {id: "skill", order: 20, char: "$"},
    {id: "command", order: 30, char: "/"},
];

type CommandName = "new" | "plan" | "mode" | "model" | "compact" | "rename" | "summarize" | "fork" | "clear";
type CommandWithArgs = "mode" | "model" | "compact" | "rename";

function command(order: number, name: CommandName, argsKey?: `command.${CommandWithArgs}Args`): ComposerCommandEntry {
    const description: AgentTextKey = `command.${name}`;
    // 宿主声明了自己支持哪些命令时只显示那些：菜单里列着、发出去被丢弃的命令是死入口。
    return {id: name, order, name, description: agentRef(description), when: (ctx) => ctx.interaction.commands === undefined || ctx.interaction.commands.includes(name), ...(argsKey === undefined ? {} : {argsHint: agentRef(argsKey)})};
}

const commands: ComposerCommandEntry[] = [
    command(10, "new"),
    command(20, "plan"),
    command(30, "mode", "command.modeArgs"),
    command(40, "model", "command.modelArgs"),
    command(50, "compact", "command.compactArgs"),
    command(60, "rename", "command.renameArgs"),
    command(70, "summarize"),
    command(80, "fork"),
    command(90, "clear"),
];

export const builtinComposerContribution: AgentViewContribution = {source: "builtin:composer", triggers, commands};
