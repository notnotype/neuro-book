/**
 * nb-agent-ui 的 Vue 渲染层入口：宿主挂 `AgentConversationView` 与（可选的）`AgentSessionList`、`AgentModelCatalog`、`AgentRequestTrace`，注册表用内置登记加自己的。这里导出的组件是受管组件，
 * 同名 `.md` 必有（`docs:check`）。内部零件只经 `./lab` 给 Component Lab。
 */

export {default as AgentConversationView} from "./AgentConversationView.vue";
export {default as AgentSessionList} from "./AgentSessionList.vue";
// 设置页预览状态栏用同一个组件（显隐、次序与窄时收起都是它自己的算法）。
export {default as AgentStatusBar} from "./composer/AgentStatusBar.vue";
export {default as AgentSessionPanel} from "./AgentSessionPanel.vue";
export {default as AgentMessages} from "./messages/AgentMessages.vue";
export {default as AgentMessagesList} from "./messages/AgentMessagesList.vue";
export {default as AgentMessagesSegment} from "./messages/AgentMessagesSegment.vue";
export type {MessagesSegmentPlacement} from "./messages/placement";
export {default as AgentModelCatalog} from "./catalog/AgentModelCatalog.vue";
export {default as AgentRequestTrace} from "./requests/AgentRequestTrace.vue";

export type {AgentViewRenderers} from "./host";
export {builtinContributions} from "./builtins";
export {builtinComposerContribution} from "./builtin-composer";
export {builtinMessageActionsContribution} from "./builtin-message-actions";
export {builtinRolesContribution} from "./builtin-roles";
export {builtinToolsContribution} from "./builtin-tools";
