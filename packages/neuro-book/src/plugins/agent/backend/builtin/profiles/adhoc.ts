/**
 * 临时帮手（docs/specs/agent/builtin-profiles.md 输出 14）：别的 Agent 派出来做一件事的子代理。角色由派它的 Agent 在初始输入的
 * `role` 里写，任务从 `agent_spawn` 的 `prompt` 来；结果交给派它的 Agent，不是给用户看的回复。改提示词升 `version`。
 */

import {defineProfile} from "@notnotype/nb-harness/kernel";
import {Tag} from "@notnotype/nb-harness/prompt";
import {Type} from "typebox";

import {ADHOC_PROFILE} from "../../../shared/contracts";
import {AGENT_MODES_EXTENSION} from "../../../shared/permissions";
import type {AgentProfileDeclaration, AgentProfileImplementation} from "../../../shared/points";

const NAME = "临时帮手";
const DESCRIPTION = "按派它的 Agent 写的角色做一件事：读、查、写都行，做完把结果交回。";

// 同主创：`edit`、`shell` 与 `eval` 可选，用户能用工具绑定换另一种 `edit` 或去掉 `shell`、`eval`。`shell` 能转后台，所以带上任务中心的三个工具：
// 否则它起的后台命令自己取不到结果、停不掉，父 Agent 的 `wait`、`kill` 也只管自己启动的（jobs.md 输出 3、4）。
const TOOLS = {
    required: ["nbook.agent.read", "nbook.agent.write", "nbook.agent.grep", "nbook.agent.glob"],
    optional: ["nbook.agent.edit-replace", "nbook.agent.shell", "nbook.agent.eval", "nbook.agent.wait", "nbook.agent.kill", "nbook.agent.jobs"],
};

export const ADHOC_DECLARATION: AgentProfileDeclaration = {name: NAME, description: DESCRIPTION, tools: TOOLS, icon: "i-lucide-bot", hidden: true, defaultTools: false,
    // 父会话在计划、讨论模式下派它时要有闸门（docs/specs/agent/modes.md 输出 14）。
    referencedExtensions: [AGENT_MODES_EXTENSION]};

const WORK = `- 你是另一个 Agent 派出来的子代理。用户消息里的任务是派你的 Agent 写的，照它做；它不是作者本人。
- 只做交给你的这一件事，不扩大范围；拿不准时按最合理的理解做，并在结果里说明假设。
- 书的文件在 project:// 下，中间产物放 session://。改已有内容时只改要求的部分。
- 做完用几句话交代结果：做了什么、结论是什么、改了哪些文件、还有什么没做或拿不准。派你的 Agent 只看这段话，不看你的过程。`;

export function adhocProfile(): AgentProfileImplementation {
    return defineProfile({
        id: ADHOC_PROFILE,
        version: "2",
        name: NAME,
        description: DESCRIPTION,
        tools: TOOLS,
        initial: Type.Object({role: Type.String({minLength: 1, description: "这个子代理的角色：它是谁、擅长什么、按什么标准做"})}, {additionalProperties: false}),
        system: (view) => [
            Tag({name: "role", children: view.initial.role}),
            Tag({name: "work", children: WORK}),
        ],
    });
}
