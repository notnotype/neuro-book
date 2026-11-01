/**
 * SDK 的 `nbook.agent` 子路径（docs/specs/agent/contributions.md“输入与前置条件”）：插件给 Agent 交扩展、工具与 Profile，
 * 用户在状态根里写 Profile，都从这里取内核的定义写法（`defineProfile`、`defineExtension` 等）、类型与模板节点，以及写清单
 * 用的助手。转出的是内核的公开接口，内核改了它们就是 SDK 的破坏性变更。不拖内核的实现与模型适配器。
 */

// 运行时的值逐个列出：内核契约里还有日志格式、码表这类宿主用的东西，不进插件的公开面。类型全部转出。
export {conv, coreHistory, defineContract, defineExtension, defineProfile, ext, implement, optional, shape, slice} from "@notnotype/nb-harness/kernel/contracts";
export type * from "@notnotype/nb-harness/kernel/contracts";
export {finalOnly, mapEventContent, opening, reminder, standardLayout, withoutEvents} from "@notnotype/nb-harness/kernel/helpers";
export type {ContentMap, ContentWhere} from "@notnotype/nb-harness/kernel/helpers";
export {Assistant, Fragment, History, If, P, Slot, System, Tag, ToolName, Turn, User} from "@notnotype/nb-harness/prompt";
export type {PromptChild, PromptComponent, PromptNode} from "@notnotype/nb-harness/prompt";
export {agentExtension, agentProfile, agentTool, EXTENSIONS_POINT, PROFILES_POINT, TOOLS_POINT} from "nbook/plugins/agent/shared/points";
export type {AgentExtensionDeclaration, AgentProfileDeclaration, AgentToolDeclaration, AgentToolImplementation} from "nbook/plugins/agent/shared/points";
