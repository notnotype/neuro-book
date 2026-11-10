/**
 * 内置工具说明里属于 NeuroBook 的事实（docs/specs/agent/builtin-tools.md）：地址的例子、工作目录、环境变量、全文存在哪里。
 * 工具说明进 Profile 哈希与会话快照，这里的文字改一个字都是行为变化。
 */

import type {BuiltinToolTexts} from "@notnotype/nb-harness/kit/tools";

export const BUILTIN_TOOL_TEXTS: BuiltinToolTexts = {
    pathParameter: "资源地址，例如 project://正文/第一章.md、session://plan.md",
    editNote: "\n\n路径都是资源地址（例如 project://正文/第一章.md），不接受裸路径。只改已存在的文件，新建用 write；不删除、不移动文件。",
};
