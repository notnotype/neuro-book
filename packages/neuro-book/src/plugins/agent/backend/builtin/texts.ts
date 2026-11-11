/**
 * 内置工具说明里属于 NeuroBook 的事实（docs/specs/agent/builtin-tools.md）：地址的例子、工作目录、环境变量、全文存在哪里。
 * 工具说明进 Profile 哈希与会话快照，这里的文字改一个字都是行为变化。
 */

import type {BuiltinToolTexts} from "@notnotype/nb-harness/kit/tools";

export const BUILTIN_TOOL_TEXTS: BuiltinToolTexts = {
    pathParameter: "资源地址，例如 project://正文/第一章.md、session://plan.md",
    editNote: "\n\n路径都是资源地址（例如 project://正文/第一章.md），不接受裸路径。只改已存在的文件，新建用 write；不删除、不移动文件。",
    shell: "执行 shell 命令（内嵌的 bash 兼容 shell）。缺省在前台等它结束；async 为 true 时转后台，立即交回任务 id 与输出文件，用 wait 取结果、kill 停掉（跑得久的构建、长任务才用）。工作目录有主项目时是项目，没有时是会话工作区。命令里直接写出的资源地址（project://a.md、session://x 等）会换成真实路径，虚拟地址在执行前报错；heredoc、变量拼接、命令替换里的地址不保证替换。环境变量 $NBOOK_PROJECT、$NBOOK_SESSION 是项目与会话工作区的真实路径。输出过长时只交回开头与结尾，全文存进 session://artifacts/，用 read 分页读。",
};
