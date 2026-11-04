/**
 * `nbook.agent` 自己贡献的内置工具（docs/specs/agent/builtin-tools.md）：同样经 `agent.tools`，没有内部登记表（ADR 0027）。
 * 提供方是接收者所在的入口：入口活着时实现就已发布，不需要写 `onAgentTool` 激活事件。
 */

import type {ContributionDeclaration} from "@notnotype/nb-runtime/plugins";

import {TOOLS_POINT} from "../../shared/points";
import type {AgentToolDeclaration, AgentToolImplementation} from "../../shared/points";

import {SessionEditStores} from "./common";
import {hashlineDeclaration, hashlineTool, replaceDeclaration, replaceTool} from "./edit";
import {readDeclaration, readTool} from "./read";
import {globDeclaration, globTool, grepDeclaration, grepTool} from "./search";
import {writeDeclaration, writeTool} from "./write";

const DECLARATIONS: Readonly<Record<string, AgentToolDeclaration>> = {
    "nbook.agent.read": {...readDeclaration, providerName: "read"},
    "nbook.agent.write": {...writeDeclaration, providerName: "write"},
    // 给模型的名字相同：Profile 只绑一条，同一会话绑了两条按 harness/runtime.md 输出 15 处理。
    "nbook.agent.edit": {...hashlineDeclaration, providerName: "edit"},
    "nbook.agent.edit-replace": {...replaceDeclaration, providerName: "edit"},
    "nbook.agent.grep": {...grepDeclaration, providerName: "grep"},
    "nbook.agent.glob": {...globDeclaration, providerName: "glob"},
};

export const BUILTIN_TOOL_CONTRIBUTIONS: ReadonlyArray<ContributionDeclaration<AgentToolDeclaration>> = Object.entries(DECLARATIONS).map(([id, declaration]) => ({capability: TOOLS_POINT, id, declaration}));

/** 每次激活一套：行锚快照跟着入口这一代。 */
export function builtinTools(): Readonly<Record<string, AgentToolImplementation>> {
    const stores = new SessionEditStores();
    return {
        "nbook.agent.read": readTool(stores),
        "nbook.agent.write": writeTool(stores),
        "nbook.agent.edit": hashlineTool(stores),
        "nbook.agent.edit-replace": replaceTool(stores),
        "nbook.agent.grep": grepTool,
        "nbook.agent.glob": globTool,
    };
}
