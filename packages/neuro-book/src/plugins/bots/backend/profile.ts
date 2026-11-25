/**
 * 岗位 Profile `nbook.bots.companion`（docs/specs/bots/bots.md 输出 3）：工具与 Agent 模式同主创，系统提示词只写岗位，不写人设（人设与
 * 记忆怎样进提示词归 t09）。工具要求取 `nbook.agent` 合同里主创的那份；模式在声明里按 id 引用 `nbook.agent.modes`（contributions.md 的“按需扩展”）。
 */

import {defineProfile} from "@notnotype/nb-harness/kernel";
import {Tag} from "@notnotype/nb-harness/prompt";

import {ADHOC_PROFILE, AGENT_MODES_EXTENSION, agentProfile, MAIN_PROFILE_TOOLS} from "nbook/plugins/agent/shared/contracts";
import type {AgentProfileImplementation} from "nbook/plugins/agent/shared/contracts";

import {COMPANION_PROFILE} from "../shared/contracts";

const NAME = "常驻助手";
const DESCRIPTION = "用户身边常驻的助手：在一条长期的对话里陪用户写作、整理想法、帮忙做事。";

/**
 * 不给人选：它只给 bot 的主对话用（contributions.md 输出 7 的 `hidden`）。可派的子代理同主创：工具清单里有派发工具，白名单空着时它在
 * 缺省配置下用不了。
 */
export const COMPANION = agentProfile(COMPANION_PROFILE, {name: NAME, description: DESCRIPTION, tools: MAIN_PROFILE_TOOLS, referencedExtensions: [AGENT_MODES_EXTENSION], icon: "i-lucide-sparkles", hidden: true, agents: {allowed: [ADHOC_PROFILE], recommended: [ADHOC_PROFILE]}});

const ROLE = `你是常驻在用户身边的助手，和用户在一条长期的对话里来回：陪用户写作、整理想法、查资料、帮忙做事。
对话会一直延续，较早的内容会被压缩成摘要；要紧的事写进文件，不只留在对话里。
这条对话不绑定某一本书，没有 project://：用户提到哪本书时，按 projects://<短名>/… 去读写那本书。中间产物放 session://。`;

const WORK = `- 先弄清用户要什么再动手；范围不清且猜错代价大时问一句。
- 改用户的文件时只改要求的部分，做完用几句话说改了什么。
- 不确定的事说不确定，不编。`;

export function companionProfile(): AgentProfileImplementation {
    return defineProfile({
        id: COMPANION_PROFILE,
        version: "2",
        name: NAME,
        description: DESCRIPTION,
        tools: MAIN_PROFILE_TOOLS,
        system: [Tag({name: "role", children: ROLE}), Tag({name: "work", children: WORK})],
    });
}
