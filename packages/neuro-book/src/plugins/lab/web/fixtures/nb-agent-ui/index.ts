/**
 * nb-agent-ui 渲染层的场景（组件树里 `nb-agent-ui` 一组，docs/specs/ui/agent-conversation-view.md）。场景数据迁自
 * 旧应用的 Lab（归档提交 865c9f593）。对话视图经公开入口 `@notnotype/nb-agent-ui/vue` 取，内部零件经只给 Lab 的
 * `@notnotype/nb-agent-ui/lab` 取；`parts.scenes.ts` 要在顶层用 `buildTurns` 算轮次样例，所以 `./lab` 与其中的零件随 Lab
 * 一起加载。要注入 Markdown 与编辑器的零件经 `host.ts` 包一层，`host.ts` 引用了 Markdown 插件的组件，只在选中场景时动态加载。
 */

import type {AgentConversationView, AgentModelCatalog, AgentSessionList, AgentSessionPanel} from "@notnotype/nb-agent-ui/vue";
import type {
    AgentChainSummary,
    AgentCommandDetail,
    AgentConversationComposer,
    AgentConversationTurn,
    AgentDeliveryNotice,
    AgentFileChanges,
    AgentFileContentDetail,
    AgentMarkdown,
    AgentMessageActions,
    AgentContextInspector,
    AgentSessionTree,
    AgentMessageEditor,
    AgentModelPicker,
    AgentRoleModelPicker,
    AgentApprovalWizard,
    AgentQuestionWizard,
    AgentModeSwitchWizard,
    AgentCompactionDetail,
    AgentQueuedMessages,
    AgentStatusBar,
    AgentWizard,
    AgentWizardFrame,
    PlainForm,
    AgentRawView,
    AgentTaskList,
    AgentTaskListNode,
    AgentToolDetail,
    AgentTurnBlock,
    AgentUserContent,
    PlainMarkdown,
    PlainPromptEditor,
    PlainPromptTextView,
} from "@notnotype/nb-agent-ui/lab";
import type {Component} from "vue";

import {defineLabFixture} from "../index";
import type {LabFixture} from "../index";
import {defineSubjectFixture} from "../subject-fixture";
import {agentApprovalWizardScenes, agentCompactionDetailScenes, agentModeSwitchWizardScenes, agentQuestionWizardScenes, agentStatusBarScenes, agentWizardFrameScenes, agentWizardScenes} from "./wizard.scenes";
import {agentModelCatalogScenes} from "./catalog.scenes";
import {agentSessionListScenes, agentSessionPanelScenes} from "./session-list.scenes";
import {agentContextInspectorScenes, agentConversationComposerScenes, agentMessageEditorScenes, agentModelPickerScenes, agentQueuedMessagesScenes, agentRoleModelPickerScenes, agentSessionTreeScenes} from "./composer.scenes";
import {
    agentChainSummaryScenes,
    agentCommandDetailScenes,
    agentConversationTurnScenes,
    agentDeliveryNoticeScenes,
    agentFileChangesScenes,
    agentFileContentDetailScenes,
    agentMarkdownScenes,
    agentMessageActionsScenes,
    agentRawViewScenes,
    agentTaskListNodeScenes,
    agentTaskListScenes,
    agentToolDetailScenes,
    agentTurnBlockScenes,
    agentUserContentScenes,
} from "./parts.scenes";
import {agentConversationViewScenes} from "./view.scenes";

type SubjectName = Parameters<typeof import("./host")["agentSubject"]>[0];

/** 渲染层的公开组件，包上 Lab 的宿主（翻译端口、Markdown 与编辑器）。 */
function agentSubject(name: SubjectName): () => Promise<{default: Component}> {
    return async () => (await import("./host")).agentSubject(name);
}

export const nbAgentUiFixtures: LabFixture[] = [
    defineLabFixture<typeof AgentConversationView>({
        component: "AgentConversationView", scenes: agentConversationViewScenes,
        load: async () => (await import("./AgentConversationViewFixture.vue")).default,
    }),
    // 会话列表挂在视图之外，从公开入口取，不经 host.ts 的包装；只套一层按场景 `locale` 建的翻译端口（`agent-text.ts`）。
    defineSubjectFixture<typeof AgentSessionList>({
        component: "AgentSessionList", scenes: agentSessionListScenes, class: "h-[480px] w-[280px]",
        subject: async () => ({default: (await import("./agent-text")).withAgentSceneText((await import("@notnotype/nb-agent-ui/vue")).AgentSessionList)}),
        events: ["action"],
    }),
    defineSubjectFixture<typeof AgentSessionPanel>({
        component: "AgentSessionPanel", scenes: agentSessionPanelScenes, class: "h-[480px] w-[360px]",
        subject: async () => ({default: (await import("./agent-text")).withAgentSceneText((await import("@notnotype/nb-agent-ui/vue")).AgentSessionPanel)}),
        events: ["action", "update:query", "update:scope", "toggle-profile", "update:show-archived"],
    }),
    // 目录对话框同样从公开入口取、套一层场景的翻译端口；它渲染到 body，根是传送门。
    defineSubjectFixture<typeof AgentModelCatalog>({
        component: "AgentModelCatalog", scenes: agentModelCatalogScenes, rootless: true,
        subject: async () => ({default: (await import("./agent-text")).withAgentSceneText((await import("@notnotype/nb-agent-ui/vue")).AgentModelCatalog)}),
        events: ["update:open", "pick", "add-provider"],
        writeBack: {"update:open": {layer: "model", key: "open"}},
    }),
    defineLabFixture<typeof AgentConversationComposer>({
        component: "AgentConversationComposer", scenes: agentConversationComposerScenes,
        load: async () => (await import("./AgentConversationComposerFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentConversationTurn>({
        component: "AgentConversationTurn", scenes: agentConversationTurnScenes,
        load: async () => (await import("./AgentConversationTurnFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentTurnBlock>({
        component: "AgentTurnBlock", scenes: agentTurnBlockScenes,
        load: async () => (await import("./AgentTurnBlockFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentMarkdown>({
        component: "AgentMarkdown", scenes: agentMarkdownScenes,
        load: async () => (await import("./AgentMarkdownFixture.vue")).default,
    }),
    defineSubjectFixture<typeof AgentChainSummary>({
        component: "AgentChainSummary", scenes: agentChainSummaryScenes, subject: agentSubject("AgentChainSummary"),
        events: ["update:expanded"], writeBack: {"update:expanded": {layer: "model", key: "expanded"}}, class: "w-full",
    }),
    defineSubjectFixture<typeof AgentTaskList>({component: "AgentTaskList", scenes: agentTaskListScenes, subject: agentSubject("AgentTaskList")}),
    defineSubjectFixture<typeof AgentTaskListNode>({component: "AgentTaskListNode", scenes: agentTaskListNodeScenes, subject: agentSubject("AgentTaskListNode"), runtimeProps: async () => ({services: (await import("./host")).labAgentServices()})}),
    defineSubjectFixture<typeof AgentToolDetail>({
        component: "AgentToolDetail", scenes: agentToolDetailScenes, subject: agentSubject("AgentToolDetail"), class: "w-full",
        events: ["action"],
        runtimeProps: async () => {
            const host = await import("./host");
            return {registry: host.labAgentRegistry(), services: host.labAgentServices()};
        },
    }),
    defineSubjectFixture<typeof AgentFileContentDetail>({component: "AgentFileContentDetail", scenes: agentFileContentDetailScenes, subject: agentSubject("AgentFileContentDetail"), class: "w-full", runtimeProps: async () => ({services: (await import("./host")).labAgentServices()})}),
    defineSubjectFixture<typeof AgentCommandDetail>({component: "AgentCommandDetail", scenes: agentCommandDetailScenes, subject: agentSubject("AgentCommandDetail"), class: "w-full", runtimeProps: async () => ({services: (await import("./host")).labAgentServices()})}),
    defineSubjectFixture<typeof AgentMessageActions>({component: "AgentMessageActions", scenes: agentMessageActionsScenes, subject: agentSubject("AgentMessageActions"), events: ["select", "branch"]}),
    defineSubjectFixture<typeof AgentFileChanges>({component: "AgentFileChanges", scenes: agentFileChangesScenes, subject: agentSubject("AgentFileChanges"), events: ["open"]}),
    defineSubjectFixture<typeof AgentUserContent>({
        component: "AgentUserContent", scenes: agentUserContentScenes, subject: agentSubject("AgentUserContent"),
        events: ["action"],
        runtimeProps: async () => {
            const services = (await import("./host")).labAgentServices();
            return {resolveAttachmentUrl: services.resolveAttachmentUrl};
        },
    }),
    defineSubjectFixture<typeof AgentModelPicker>({
        component: "AgentModelPicker", scenes: agentModelPickerScenes, subject: agentSubject("AgentModelPicker"),
        events: ["select-model", "select-thinking", "manage"],
        writeBack: {"select-model": {layer: "props", key: "modelKey"}, "select-thinking": {layer: "props", key: "thinking"}},
    }),
    defineSubjectFixture<typeof AgentContextInspector>({
        component: "AgentContextInspector", scenes: agentContextInspectorScenes, subject: agentSubject("AgentContextInspector"),
        events: ["load-system-prompt"],
    }),
    defineSubjectFixture<typeof AgentMessageEditor>({
        component: "AgentMessageEditor", scenes: agentMessageEditorScenes, subject: agentSubject("AgentMessageEditor"),
        events: ["submit", "cancel"],
    }),
    defineSubjectFixture<typeof AgentSessionTree>({
        component: "AgentSessionTree", scenes: agentSessionTreeScenes, subject: agentSubject("AgentSessionTree"),
        events: ["activate", "copy"],
    }),
    defineSubjectFixture<typeof AgentRoleModelPicker>({
        component: "AgentRoleModelPicker", scenes: agentRoleModelPickerScenes, subject: agentSubject("AgentRoleModelPicker"),
        events: ["select-model", "select-thinking", "manage"],
        writeBack: {"select-model": {layer: "props", key: "modelKey"}, "select-thinking": {layer: "props", key: "thinking"}},
    }),
    defineLabFixture<typeof AgentStatusBar>({component: "AgentStatusBar", scenes: agentStatusBarScenes, load: async () => (await import("./AgentStatusBarFixture.vue")).default}),
    defineSubjectFixture<typeof AgentWizard>({component: "AgentWizard", scenes: agentWizardScenes, subject: agentSubject("AgentWizard"), events: ["action"], class: "w-full"}),
    defineSubjectFixture<typeof AgentWizardFrame>({component: "AgentWizardFrame", scenes: agentWizardFrameScenes, subject: agentSubject("AgentWizardFrame"), slotPresets: {default: () => "内容区", foot: () => "按钮"}, events: ["collapse"], class: "w-full"}),
    defineSubjectFixture<typeof AgentApprovalWizard>({component: "AgentApprovalWizard", scenes: agentApprovalWizardScenes, subject: agentSubject("AgentApprovalWizard"), events: ["update:state", "submit", "denyAll", "collapse"], class: "w-full"}),
    defineSubjectFixture<typeof AgentModeSwitchWizard>({component: "AgentModeSwitchWizard", scenes: agentModeSwitchWizardScenes, subject: agentSubject("AgentModeSwitchWizard"), events: ["update:state", "answer", "collapse"], class: "w-full"}),
    defineSubjectFixture<typeof AgentCompactionDetail>({component: "AgentCompactionDetail", scenes: agentCompactionDetailScenes, subject: agentSubject("AgentCompactionDetail"), class: "w-full"}),
    defineSubjectFixture<typeof AgentQuestionWizard>({component: "AgentQuestionWizard", scenes: agentQuestionWizardScenes, subject: agentSubject("AgentQuestionWizard"), events: ["update:state", "submit", "stop", "collapse"], class: "w-full"}),
    defineSubjectFixture<typeof PlainForm>({component: "PlainForm", scenes: [{id: "empty", label: "JSON 文本框", input: {props: {schema: {type: "object"}}, model: {modelValue: {name: "苏晴"}}}}], subject: agentSubject("PlainForm"), events: ["update:modelValue", "update:valid"], class: "w-full"}),
    defineSubjectFixture<typeof AgentQueuedMessages>({component: "AgentQueuedMessages", scenes: agentQueuedMessagesScenes, subject: agentSubject("AgentQueuedMessages"), class: "w-full"}),
    defineSubjectFixture<typeof AgentDeliveryNotice>({
        component: "AgentDeliveryNotice", noInput: "只有“重新发送”“移除”两个事件，没有数据 prop", scenes: agentDeliveryNoticeScenes,
        subject: agentSubject("AgentDeliveryNotice"), events: ["resend", "dismiss"],
    }),
    defineSubjectFixture<typeof AgentRawView>({
        component: "AgentRawView", scenes: agentRawViewScenes, subject: agentSubject("AgentRawView"), events: ["action"], class: "w-full",
        runtimeProps: async () => {
            const host = await import("./host");
            return {registry: host.labAgentRegistry(), services: host.labAgentServices()};
        },
    }),
    defineSubjectFixture<typeof PlainMarkdown>({
        component: "PlainMarkdown", subject: agentSubject("PlainMarkdown"), class: "w-full",
        scenes: [{id: "text", label: "纯文字", input: {props: {text: "**加粗**不会生效，\n换行照常保留。", locale: "zh-CN"}}}],
    }),
    defineSubjectFixture<typeof PlainPromptTextView>({
        component: "PlainPromptTextView", subject: agentSubject("PlainPromptTextView"), class: "w-full",
        scenes: [{id: "text", label: "文字写法原样显示", input: {props: {text: "先读 [第三章 雨夜](/正文/第三章 雨夜.md)，再用 $reviewer 检查。", locale: "zh-CN"}}}],
    }),
    defineSubjectFixture<typeof PlainPromptEditor>({
        component: "PlainPromptEditor", subject: agentSubject("PlainPromptEditor"), class: "w-full",
        events: ["change", "submit", "escape", "shift-tab"],
        scenes: [
            {id: "empty", label: "空", input: {props: {draft: {text: "", version: 1}, locale: "zh-CN", placeholder: "给 Agent 写点什么"}}},
            {id: "draft", label: "带草稿，只读", input: {props: {draft: {text: "保留雨夜那段对话。", version: 1}, locale: "zh-CN", readonly: true}}},
        ],
    }),
];

