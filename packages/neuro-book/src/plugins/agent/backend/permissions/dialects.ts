/**
 * 方言表（docs/specs/agent/permissions.md 的“命令与方言”）：第一版只有 `bash`。形状就是将来贡献点的形状。
 */

import type {ToolEffect} from "@notnotype/nb-harness/kernel/contracts";

import {createBashDialect} from "./bash-dialect";
import type {CommandDialect} from "./bash-dialect";

export type Dialects = (id: string) => CommandDialect | undefined;

/** 追加的只读命令来自设置，每次取：改了下一次调用就生效。 */
export const createDialects = (readOnlyCommands: () => readonly string[]): Dialects => (id) => (id === "bash" ? createBashDialect({extraReadOnly: readOnlyCommands()}) : undefined);

/** 一段命令的等级：全部只读且没有写重定向才是读（输出 17）。解析抛错按看不懂算。 */
export function commandEffect(dialect: CommandDialect | undefined, text: string): ToolEffect {
    if (dialect === undefined) return "exec";
    try {
        const parsed = dialect.parse(text);
        return !("opaque" in parsed) && parsed.commands.every((command) => dialect.readOnly(command)) ? "read" : "exec";
    } catch {
        return "exec";
    }
}
