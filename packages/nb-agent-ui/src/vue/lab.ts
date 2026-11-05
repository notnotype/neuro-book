/**
 * 只给应用的 Component Lab 用的入口：单独挂载内部零件、交出渲染组件与翻译端口、算出轮次样例。不是宿主接口，形状随时会变；
 * 宿主只挂 `AgentConversationView`（`@notnotype/nb-agent-ui/vue`）。
 *
 * 这些零件有同名 `.md` 与 Lab 场景，但不经 `docs:check` 的受管组件机检（只认 `/vue` 入口），标签靠人审。Lab 的场景登记在顶层
 * 用 `buildTurns` 算样例，所以本入口与其中的零件随 Lab 一起加载。
 */

export {default as AgentConversationComposer} from "./composer/AgentConversationComposer.vue";
export {default as AgentModelPicker} from "./composer/AgentModelPicker.vue";
export {default as AgentQueuedMessages} from "./composer/AgentQueuedMessages.vue";
export {default as AgentStatusBar} from "./composer/AgentStatusBar.vue";
export {default as AgentWizard} from "./wizard/AgentWizard.vue";
export {default as AgentWizardFrame} from "./wizard/AgentWizardFrame.vue";
export {default as AgentApprovalWizard} from "./wizard/AgentApprovalWizard.vue";
export {default as AgentQuestionWizard} from "./wizard/AgentQuestionWizard.vue";
export {default as PlainForm} from "./fallback/PlainForm.vue";
export {default as AgentMarkdown} from "./parts/AgentMarkdown.vue";
export {default as OriginalImagePreviewDialog} from "./parts/OriginalImagePreviewDialog.vue";
export {default as AgentChainSummary} from "./stream/AgentChainSummary.vue";
export {default as AgentConversationTurn} from "./stream/AgentConversationTurn.vue";
export {default as AgentDeliveryNotice} from "./stream/AgentDeliveryNotice.vue";
export {default as AgentFileChanges} from "./stream/AgentFileChanges.vue";
export {default as AgentMessageActions} from "./stream/AgentMessageActions.vue";
export {default as AgentRawView} from "./stream/AgentRawView.vue";
export {default as AgentTurnBlock} from "./stream/AgentTurnBlock.vue";
export {default as AgentUserContent} from "./stream/AgentUserContent.vue";
export {default as AgentCommandDetail} from "./tools/AgentCommandDetail.vue";
export {default as AgentFileContentDetail} from "./tools/AgentFileContentDetail.vue";
export {default as AgentTaskList} from "./tools/AgentTaskList.vue";
export {default as AgentTaskListNode} from "./tools/AgentTaskListNode.vue";
export {default as AgentToolDetail} from "./tools/AgentToolDetail.vue";
export {default as PlainMarkdown} from "./fallback/PlainMarkdown.vue";
export {default as PlainPromptEditor} from "./fallback/PlainPromptEditor.vue";
export {default as PlainPromptTextView} from "./fallback/PlainPromptTextView.vue";

export {provideAgentView, useAgentRenderers, useAgentText} from "./host";
export type {AgentTextApi, ResolvedRenderers} from "./host";
export type {PreviewImageRequest, ViewAction} from "./view-action";
export {buildTurns} from "../conversation-turns";
export type {BuildTurnsInput, ChainBlock, ConversationTurn, TurnBlock, TurnMetrics, TurnStatus} from "../conversation-turns";
export type {TaskChange, TaskItemView, TaskListView, TaskStatus} from "../task-list";
