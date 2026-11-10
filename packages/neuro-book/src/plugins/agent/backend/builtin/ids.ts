/**
 * NeuroBook 内置工具的贡献 id 里，压缩要认的那几个（shake 的占位、放回找“最近读过或改过的文件”）。与 `builtin/index.ts` 的贡献
 * 用同一组字面量：改 id 时两处一起改，否则压缩认不出这些调用。
 */

import type {BuiltinToolIds} from "@notnotype/nb-harness/kit/compaction";

export const BUILTIN_TOOL_IDS: BuiltinToolIds = {
    read: "nbook.agent.read",
    write: "nbook.agent.write",
    edits: ["nbook.agent.edit", "nbook.agent.edit-replace"],
    search: ["nbook.agent.grep", "nbook.agent.glob"],
    shell: "nbook.agent.shell",
};
