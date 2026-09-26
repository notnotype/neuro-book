import type FixtureExample from "../FixtureExample.vue";
import type {Component} from "vue";
import type {LabInputOf, LabJsonPropOf, LabSlotOf, LabSubjectProps} from "../lab-subject";
import type ModelPickerContent from "../../components/novel-ide/model-picker/ModelPickerContent.vue";
import type ModelPickerPopover from "../../components/novel-ide/model-picker/ModelPickerPopover.vue";
import {modelPickerContentScenes, modelPickerPopoverScenes} from "./ModelPicker.scenes";
import type WorkbenchShellLayout from "../../components/workbench/WorkbenchShellLayout.vue";
import {WORKBENCH_SHELL_LAYOUT_SCENES} from "./WorkbenchShellLayout.scenes";
import type WorkbenchActivityBar from "../../components/workbench/WorkbenchActivityBar.vue";
import type WorkbenchContainerSection from "../../components/workbench/WorkbenchContainerSection.vue";
import type WorkbenchContainerSurface from "../../components/workbench/WorkbenchContainerSurface.vue";
import type WorkbenchPanelSurface from "../../components/workbench/WorkbenchPanelSurface.vue";
import type WorkbenchPanelTab from "../../components/workbench/WorkbenchPanelTab.vue";
import type WorkbenchStatusBar from "../../components/workbench/WorkbenchStatusBar.vue";
import type WorkbenchStatusBarItem from "../../components/workbench/WorkbenchStatusBarItem.vue";
import type WorkbenchTitleActions from "../../components/workbench/WorkbenchTitleActions.vue";
import {workbenchActivityBarScenes, workbenchContainerSectionScenes, workbenchContainerSurfaceScenes, workbenchPanelSurfaceScenes, workbenchPanelTabScenes, workbenchStatusBarScenes, workbenchStatusBarItemScenes, workbenchTitleActionsScenes} from "./WorkbenchWidgets.scenes";
import type CodeEditorView from "../../components/editor-workbench/CodeEditorView.vue";
import type MarkdownEditorView from "../../components/editor-workbench/MarkdownEditorView.vue";
import type EditorViewHost from "../../components/editor-workbench/EditorViewHost.vue";
import type EditorBreadcrumbs from "../../components/editor-workbench/EditorBreadcrumbs.vue";
import type EditorTabItem from "../../components/editor-workbench/EditorTabItem.vue";
import type EditorToolbar from "../../components/editor-workbench/EditorToolbar.vue";
import {codeEditorViewScenes} from "./CodeEditorView.scenes";
import {markdownEditorViewScenes} from "./MarkdownEditorView.scenes";
import {editorViewHostScenes} from "./EditorViewHost.scenes";
import {editorBreadcrumbsScenes} from "./EditorBreadcrumbs.scenes";
import {editorTabItemScenes} from "./EditorTabItem.scenes";
import {editorToolbarScenes} from "./EditorToolbar.scenes";
import type AgentProfileIdentitySection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileIdentitySection.vue";
import type AgentProfileModelSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileModelSection.vue";
import type AgentProfileCustomSettingsSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileCustomSettingsSection.vue";
import type AgentProfileRuntimeSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileRuntimeSection.vue";
import type AgentProfileDefaultProfileSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileDefaultProfileSection.vue";
import type AgentProfileDefaultModelSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileDefaultModelSection.vue";
import type AgentProfileDefaultRuntimeSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileDefaultRuntimeSection.vue";
import {agentProfileIdentitySectionScenes, agentProfileModelSectionScenes, agentProfileCustomSettingsSectionScenes, agentProfileRuntimeSectionScenes, agentProfileDefaultProfileSectionScenes, agentProfileDefaultModelSectionScenes, agentProfileDefaultRuntimeSectionScenes} from "./AgentProfileSections.scenes";
import type EditorTabBar from "../../components/editor-workbench/EditorTabBar.vue";
import type EditorWelcome from "../../components/editor-workbench/EditorWelcome.vue";
import {editorTabBarScenes} from "./EditorTabBar.scenes";
import {editorWelcomeScenes} from "./EditorWelcome.scenes";
import type CollapsibleSidePanel from "../CollapsibleSidePanel.vue";
import type ViewportCanvas from "../ViewportCanvas.vue";
import type MarkdownView from "../MarkdownView.vue";
import type EventLogPanel from "../EventLogPanel.vue";
import type HighlightBox from "../HighlightBox.vue";
import type JsonViewer from "../../components/common/JsonViewer.vue";
import type SurfaceTierDemo from "../SurfaceTierDemo.vue";
import type DesktopTitleBarChrome from "../../components/common/DesktopTitleBarChrome.vue";
import {desktopTitleBarChromeScenes} from "./DesktopTitleBarChrome.scenes";
import type AgentSidebarView from "../../components/novel-ide/agent/AgentSidebarView.vue";
import {agentSidebarViewScenes} from "./AgentSidebarView.scenes";
import type ContextMenu from "../../components/common/ContextMenu.vue";
import type Dialog from "../../components/common/Dialog.vue";
import type Dropdown from "../../components/common/Dropdown.vue";
import type IconButton from "../../components/common/IconButton.vue";
import type LucideIconPickerDialog from "../../components/common/LucideIconPickerDialog.vue";
import type ReferenceChip from "../../components/common/ReferenceChip.vue";
import type SideDetailPanel from "../../components/common/SideDetailPanel.vue";
import type SkillChip from "../../components/common/SkillChip.vue";
import type Tooltip from "../../components/common/Tooltip.vue";
import type TagInput from "../../components/common/form/TagInput.vue";
import type LowCodeFieldShell from "../../components/common/low-code-form/LowCodeFieldShell.vue";
import type LowCodeNumberField from "../../components/common/low-code-form/LowCodeNumberField.vue";
import type LowCodeRadioField from "../../components/common/low-code-form/LowCodeRadioField.vue";
import type LowCodeResourcePresetField from "../../components/common/low-code-form/LowCodeResourcePresetField.vue";
import type LowCodeSelectField from "../../components/common/low-code-form/LowCodeSelectField.vue";
import type LowCodeSwitchField from "../../components/common/low-code-form/LowCodeSwitchField.vue";
import type LowCodeTextareaField from "../../components/common/low-code-form/LowCodeTextareaField.vue";
import type LowCodeTextField from "../../components/common/low-code-form/LowCodeTextField.vue";
import type FormCheckbox from "../../components/common/form/FormCheckbox.vue";
import type FormField from "../../components/common/form/FormField.vue";
import type FormInput from "../../components/common/form/FormInput.vue";
import type FormNumberInput from "../../components/common/form/FormNumberInput.vue";
import type FormTextarea from "../../components/common/form/FormTextarea.vue";
import type StructuredTextEditor from "../../components/common/form/StructuredTextEditor.vue";
import type ReferencePlainTextEditor from "../../components/common/form/ReferencePlainTextEditor.vue";
import type ReferenceSelectorPopover from "../../components/common/form/ReferenceSelectorPopover.vue";
import type SegmentedControl from "../../components/common/form/SegmentedControl.vue";
import type DiffWorkbench from "../../components/common/diff/DiffWorkbench.vue";
import type DiffWorkbenchDialog from "../../components/common/diff/DiffWorkbenchDialog.vue";
import type SharedDiffEditor from "../../components/common/diff/SharedDiffEditor.vue";
import type SharedMergeEditor from "../../components/common/diff/SharedMergeEditor.vue";
import type Combobox from "../../components/common/form/Combobox.vue";
import type FormColorField from "../../components/common/form/FormColorField.vue";
import type FormSelect from "../../components/common/form/FormSelect.vue";
import type LowCodeCheckboxField from "../../components/common/low-code-form/LowCodeCheckboxField.vue";
import type LowCodeComboboxField from "../../components/common/low-code-form/LowCodeComboboxField.vue";
import type LowCodeForm from "../../components/common/low-code-form/LowCodeForm.vue";
import {contextMenuScenes, dialogScenes, dropdownScenes, iconButtonScenes, lucideIconPickerDialogScenes, referenceChipScenes, sideDetailPanelScenes, skillChipScenes, tooltipScenes, tagInputScenes, lowCodeFieldShellScenes, lowCodeNumberFieldScenes, lowCodeRadioFieldScenes, lowCodeResourcePresetFieldScenes, lowCodeSelectFieldScenes, lowCodeSwitchFieldScenes, lowCodeTextareaFieldScenes, lowCodeTextFieldScenes, formCheckboxScenes, formFieldScenes, formInputScenes, formNumberInputScenes, formTextareaScenes, structuredTextEditorScenes, referencePlainTextEditorScenes, referenceSelectorPopoverScenes, segmentedControlScenes, diffWorkbenchScenes, diffWorkbenchDialogScenes, sharedDiffEditorScenes, sharedMergeEditorScenes, comboboxScenes, formColorFieldScenes, formSelectScenes, lowCodeCheckboxFieldScenes, lowCodeComboboxFieldScenes, lowCodeFormScenes} from "./CommonPrimitives.scenes";

import type EditorWorkbench from "../../components/editor-workbench/EditorWorkbench.vue";
import type MonacoCodeEditor from "../../components/editor-workbench/MonacoCodeEditor.vue";
import type NovelIdeActivityBar from "../../components/novel-ide/NovelIdeActivityBar.vue";
import {editorWorkbenchScenes, monacoCodeEditorScenes, novelIdeActivityBarScenes} from "./EditorWorkbenchExtras.scenes";

import type AgentSystemPromptPanel from "../../components/novel-ide/agent/panels/system-prompt/AgentSystemPromptPanel.vue";
import type AgentLinkedAgentPanel from "../../components/novel-ide/agent/panels/linked-agents/AgentLinkedAgentPanel.vue";
import type WorkbenchCommandPalette from "../../components/workbench/WorkbenchCommandPalette.vue";
import type WorkbenchViewInstances from "../../components/workbench/WorkbenchViewInstances.vue";
import {agentSystemPromptPanelScenes, agentLinkedAgentPanelScenes, workbenchCommandPaletteScenes, workbenchViewInstancesScenes} from "./AgentExtraPanels.scenes";

import type AgentChatFlow from "../../components/novel-ide/agent/flow/AgentChatFlow.vue";
import type AgentChatEmptyState from "../../components/novel-ide/agent/flow/AgentChatEmptyState.vue";
import type AgentChatHistoryLoader from "../../components/novel-ide/agent/flow/AgentChatHistoryLoader.vue";
import type AgentUserBubble from "../../components/novel-ide/agent/bubbles/text/AgentUserBubble.vue";
import type AgentAssistantBubble from "../../components/novel-ide/agent/bubbles/text/AgentAssistantBubble.vue";
import type AgentThinkingCollapsible from "../../components/novel-ide/agent/bubbles/base/AgentThinkingCollapsible.vue";
import type AgentMessageActionBar from "../../components/novel-ide/agent/bubbles/base/AgentMessageActionBar.vue";
import type AgentSystemBubble from "../../components/novel-ide/agent/bubbles/text/AgentSystemBubble.vue";
import type AgentTextBubble from "../../components/novel-ide/agent/bubbles/text/AgentTextBubble.vue";
import type AgentToolBubble from "../../components/novel-ide/agent/bubbles/tools/AgentToolBubble.vue";
import type AgentToolNode from "../../components/novel-ide/agent/bubbles/tools/AgentToolNode.vue";
import type AgentEditFileBubble from "../../components/novel-ide/agent/bubbles/tools/AgentEditFileBubble.vue";
import type AgentWriteFileBubble from "../../components/novel-ide/agent/bubbles/tools/AgentWriteFileBubble.vue";
import type AgentApplyPatchBubble from "../../components/novel-ide/agent/bubbles/tools/AgentApplyPatchBubble.vue";
import type AgentSwitchModeBubble from "../../components/novel-ide/agent/bubbles/interactive/AgentSwitchModeBubble.vue";
import type AgentTaskBubble from "../../components/novel-ide/agent/bubbles/tools/AgentTaskBubble.vue";
import type AgentRequestUserInputCard from "../../components/novel-ide/agent/bubbles/interactive/AgentRequestUserInputCard.vue";
import type AgentQueuedMessageList from "../../components/novel-ide/agent/composer/AgentQueuedMessageList.vue";
import type AgentComposer from "../../components/novel-ide/agent/composer/AgentComposer.vue";
import type AgentComposerAvailabilityBanner from "../../components/novel-ide/agent/composer/AgentComposerAvailabilityBanner.vue";
import type AgentComposerImageBar from "../../components/novel-ide/agent/composer/AgentComposerImageBar.vue";
import type AgentComposerToolbar from "../../components/novel-ide/agent/composer/AgentComposerToolbar.vue";
import type AgentSessionStatusBar from "../../components/novel-ide/agent/panels/status/AgentSessionStatusBar.vue";
import type AgentComposerInput from "../../components/novel-ide/agent/composer/AgentComposerInput.vue";
import type AgentSessionModelControls from "../../components/novel-ide/agent/panels/header/AgentSessionModelControls.vue";
import type AgentUserInputPrompt from "../../components/novel-ide/agent/composer/AgentUserInputPrompt.vue";
import type AgentSessionHeader from "../../components/novel-ide/agent/panels/header/AgentSessionHeader.vue";
import {agentChatFlowScenes, agentChatEmptyStateScenes, agentChatHistoryLoaderScenes, agentUserBubbleScenes, agentAssistantBubbleScenes, agentThinkingCollapsibleScenes, agentMessageActionBarScenes, agentSystemBubbleScenes, agentTextBubbleScenes, agentToolBubbleScenes, agentToolNodeScenes, agentEditFileBubbleScenes, agentWriteFileBubbleScenes, agentApplyPatchBubbleScenes, agentSwitchModeBubbleScenes, agentTaskBubbleScenes, agentRequestUserInputCardScenes, agentQueuedMessageListScenes, agentComposerScenes, agentComposerAvailabilityBannerScenes, agentComposerImageBarScenes, agentComposerToolbarScenes, agentSessionStatusBarScenes, agentComposerInputScenes, agentSessionModelControlsScenes, agentUserInputPromptScenes, agentSessionHeaderScenes} from "./AgentConversation.scenes";

import type AgentProfileNavList from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileNavList.vue";
import type AgentProfileSettingsView from "../../components/novel-ide/settings/sections/agent-profile/AgentProfileSettingsView.vue";
import type NovelIdeSettingsView from "../../components/novel-ide/settings/sections/NovelIdeSettingsView.vue";
import type FrontendSettingsView from "../../components/novel-ide/settings/sections/frontend/FrontendSettingsView.vue";
import type SettingsLoadState from "../../components/novel-ide/settings/sections/components/SettingsLoadState.vue";
import type WebSettingsView from "../../components/novel-ide/settings/sections/web/WebSettingsView.vue";
import type EmbeddingSettingsView from "../../components/novel-ide/settings/sections/embedding/EmbeddingSettingsView.vue";
import type CostSettingsView from "../../components/novel-ide/settings/sections/cost/CostSettingsView.vue";
import type ObservabilitySettingsView from "../../components/novel-ide/settings/sections/observability/ObservabilitySettingsView.vue";
import type EditorSettingsView from "../../components/novel-ide/settings/sections/editor/EditorSettingsView.vue";
import type DesktopSettingsView from "../../components/novel-ide/settings/sections/desktop/DesktopSettingsView.vue";
import type SecuritySettingsView from "../../components/novel-ide/settings/sections/security/SecuritySettingsView.vue";
import type ProviderSettingsView from "../../components/novel-ide/settings/sections/providers/ProviderSettingsView.vue";
import type RolesSettingsView from "../../components/novel-ide/settings/sections/roles/RolesSettingsView.vue";
import type NovelIdeModelEditDialog from "../../components/novel-ide/settings/sections/providers/components/NovelIdeModelEditDialog.vue";
import type ModelDiscoveryDialog from "../../components/novel-ide/settings/sections/providers/components/ModelDiscoveryDialog.vue";
import type ModelLibraryDialog from "../../components/novel-ide/settings/sections/providers/components/ModelLibraryDialog.vue";
import type ProjectPickerView from "../../components/novel-ide/project-picker/ProjectPickerView.vue";
import type ProjectPickerHeader from "../../components/novel-ide/project-picker/components/ProjectPickerHeader.vue";
import type ProjectPickerEmptyState from "../../components/novel-ide/project-picker/components/ProjectPickerEmptyState.vue";
import type ProjectCard from "../../components/novel-ide/project-picker/components/ProjectCard.vue";
import type ProjectCreateCoverPreview from "../../components/novel-ide/project-picker/components/ProjectCreateCoverPreview.vue";
import type ProjectCreateForm from "../../components/novel-ide/project-picker/components/ProjectCreateForm.vue";
import type ProjectCreateDialog from "../../components/novel-ide/project-picker/components/ProjectCreateDialog.vue";
import type ProjectCoverDialog from "../../components/novel-ide/project-picker/components/ProjectCoverDialog.vue";
import {agentProfileNavListScenes, agentProfileSettingsViewScenes, novelIdeSettingsViewScenes, frontendSettingsViewScenes, settingsLoadStateScenes, webSettingsViewScenes, embeddingSettingsViewScenes, costSettingsViewScenes, observabilitySettingsViewScenes, editorSettingsViewScenes, desktopSettingsViewScenes, securitySettingsViewScenes, providerSettingsViewScenes, rolesSettingsViewScenes, novelIdeModelEditDialogScenes, modelDiscoveryDialogScenes, modelLibraryDialogScenes, projectPickerViewScenes, projectPickerHeaderScenes, projectPickerEmptyStateScenes, projectCardScenes, projectCreateCoverPreviewScenes, projectCreateFormScenes, projectCreateDialogScenes, projectCoverDialogScenes} from "./SettingsProject.scenes";

/**
 * 场景登记。这不是第二份组件清单——组件清单由 component-index 扫文档得到，
 * 这里只补文档里没有的东西：一个组件可以摆出哪几个场景。两者按组件名对上。
 */
export type LabScene = {
    id: string;
    label: string;
    /** 运行时消费的宽化输入；登记入口负责把它约束到组件类型。 */
    input?: {props?: Record<string, unknown>; model?: Record<string, unknown>; slots?: Record<string, boolean>};
};

declare const LAB_FIXTURE_BRAND: unique symbol;

export type LabFixture = {
    /** 与组件文档同名 */
    component: string;
    scenes: LabScene[];
    /** 无输入组件的显式理由；有 props 的组件不能借此跳过输入登记。 */
    noInput?: string;
    /** fixture 为哪些插槽备了预设内容。 */
    slots?: readonly string[];
    load: () => Promise<Component>;
    readonly [LAB_FIXTURE_BRAND]: true;
};

export type LabFixtureDefinition<C> = {
    component: string;
    load: () => Promise<Component>;
} & (
    | {
        noInput?: never;
        slots?: readonly LabSlotOf<C>[];
        scenes: Array<{id: string; label: string; input: LabInputOf<C>}>;
    }
    | ([LabJsonPropOf<C>] extends [never] ? {
        noInput: string;
        slots?: never;
        scenes: Array<{id: string; label: string; input?: never}>;
    } : never)
);

/** 唯一的类型化 fixture 登记入口；运行时只返回登记对象，不加载组件或推导签名。 */
export function defineLabFixture<C = never>(
    definition: [C] extends [never] ? never : [LabSubjectProps<C>] extends [never] ? never : LabFixtureDefinition<C>,
): LabFixture {
    // 类型检查发生在入口参数；消费方需要的宽化 registry 类型在此处擦除一次。
    return definition as unknown as LabFixture;
}

/**
 * fixture 在被检视的那个零件上加 `data-lab-subject`，Lab 据此画常亮描边。
 *
 * 没有它 Lab 分不出哪块是零件、哪块是 fixture 自己搭的台子——多数 fixture 都带工具栏
 * 和说明文字。零件是单根节点时直接写在标签上即可，Vue 会把它落到根 DOM 节点。
 * 不标也能检查，只是无法把复合 fixture 的主要零件作为优先定位目标。
 */
// Lab 场景在选择时才加载：避免一次导入所有产品组件和纯内存 fixture。

export const labFixtures: LabFixture[] = [
    defineLabFixture<typeof CollapsibleSidePanel>({
        component: "CollapsibleSidePanel", slots: ["default", "actions"],
        scenes: [
            {id: "default", label: "展开", input: {props: {title: "示例侧栏", collapsedWidth: 40, side: "left", layer: "nav"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
            {id: "collapsed", label: "收起", input: {props: {title: "示例侧栏", collapsedWidth: 40, side: "left", layer: "nav"}, model: {collapsed: true}, slots: {default: true, actions: true}}},
            {id: "right", label: "靠右", input: {props: {title: "检视", collapsedWidth: 40, side: "right", layer: "nav"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
            {id: "content", label: "内容层", input: {props: {title: "检视", collapsedWidth: 40, side: "left", layer: "content"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
            {id: "long", label: "长内容", input: {props: {title: "很长的一列条目", collapsedWidth: 40, side: "left", layer: "nav"}, model: {collapsed: false}, slots: {default: true, actions: true}}},
        ],
        load: async () => (await import("./CollapsibleSidePanelFixture.vue")).default,
    }),
    defineLabFixture<typeof ViewportCanvas>({
        component: "ViewportCanvas", slots: ["default"],
        scenes: [
            {id: "phone", label: "手机 390×844", input: {props: {minSize: 200, showSize: true}, model: {width: 390, height: 844}, slots: {default: true}}},
            {id: "tablet", label: "平板 768×1024", input: {props: {minSize: 200, showSize: true}, model: {width: 768, height: 1024}, slots: {default: true}}},
            {id: "free", label: "不限尺寸", input: {props: {minSize: 200, showSize: true}, model: {width: 0, height: 0}, slots: {default: true}}},
        ],
        load: async () => (await import("./ViewportCanvasFixture.vue")).default,
    }),
    defineLabFixture<typeof MarkdownView>({
        component: "MarkdownView", scenes: [
            {id: "prose", label: "常规正文", input: {props: {source: "## 小标题\n\n一段普通正文，里面有 **粗体**、*斜体* 和 `行内代码`。\n\n- 列表第一项\n- 列表第二项\n\n> 引用块\n\n[外部链接](https://example.com)"}}},
            {id: "table", label: "表格与代码", input: {props: {source: "| 列 A | 列 B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst answer: number = 42;\n```"}}},
            {id: "html", label: "内嵌 HTML（会被净化）", input: {props: {source: "下面这行的脚本会被净化掉，什么都不会发生：\n\n<script>alert(1)<\/script>\n\n<b>这个粗体标签是允许的</b>"}}},
            {id: "empty", label: "空文本", input: {props: {source: ""}}},
        ], load: async () => (await import("./MarkdownViewFixture.vue")).default,
    }),
    defineLabFixture<typeof EventLogPanel>({
        component: "EventLogPanel", scenes: [
            {id: "mixed", label: "有负载与无负载混排", input: {props: {emptyText: "还没有事件", entries: [{id: "click-1", name: "click", payload: {count: 1}}, {id: "update-1", name: "update:modelValue"}]}}},
            {id: "empty", label: "空列表", input: {props: {emptyText: "还没有事件", entries: []}}},
        ], load: async () => (await import("./EventLogPanelFixture.vue")).default,
    }),
    defineLabFixture<typeof HighlightBox>({
        component: "HighlightBox", scenes: [
            {id: "subject", label: "零件档（实线）", input: {props: {label: "EventLogPanel  320 × 180", tone: "subject", rect: {top: 80, left: 80, width: 260, height: 120}}}},
            {id: "probe", label: "探针档（虚线）", input: {props: {label: "div.flex.items-center  296 × 28", tone: "probe", rect: {top: 80, left: 80, width: 296, height: 28}}}},
            {id: "no-label", label: "只画框不带标签", input: {props: {label: "", tone: "subject", rect: {top: 80, left: 80, width: 200, height: 200}}}},
            {id: "none", label: "没有要框的东西", input: {props: {label: "看不见我", tone: "subject", rect: null}}},
        ], load: async () => (await import("./HighlightBoxFixture.vue")).default,
    }),
    defineLabFixture<typeof FixtureExample>({
        component: "FixtureExample",
        slots: ["extra"],
        scenes: [
            {
                id: "default",
                label: "默认受控卡片（居中与标准材质示范）",
                input: {
                    props: {
                        title: "章节大纲智能体编排",
                        description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                        status: "ready",
                        count: 12,
                        active: false,
                        disabled: false,
                    },
                    slots: {extra: true},
                },
            },
            {
                id: "active",
                label: "激活态与高亮外框",
                input: {
                    props: {
                        title: "章节大纲智能体编排",
                        description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                        status: "ready",
                        count: 12,
                        active: true,
                        disabled: false,
                    },
                    slots: {extra: true},
                },
            },
            {
                id: "busy",
                label: "忙碌呼吸状态",
                input: {
                    props: {
                        title: "正在生成第三卷剧情推演",
                        description: "后台正在计算角色动机转移概率矩阵与未回收伏笔拓扑图...",
                        status: "busy",
                        count: 99,
                        active: true,
                        disabled: false,
                    },
                    slots: {extra: true},
                },
            },
            {
                id: "warning",
                label: "警告冲突状态",
                input: {
                    props: {
                        title: "检测到人物性格设定冲突",
                        description: "角色「沈屿」在第二章的对话用词与素材库口吻约定存在 2 处偏差。",
                        status: "warning",
                        count: 2,
                        active: false,
                        disabled: false,
                    },
                    slots: {extra: false},
                },
            },
            {
                id: "disabled",
                label: "禁用态",
                input: {
                    props: {
                        title: "章节大纲智能体编排",
                        description: "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。",
                        status: "ready",
                        count: 12,
                        active: false,
                        disabled: true,
                    },
                    slots: {extra: false},
                },
            },
        ],
        load: async () => (await import("./FixtureExampleFixture.vue")).default,
    }),
    defineLabFixture<typeof JsonViewer>({
        component: "JsonViewer", scenes: [
            {id: "object", label: "对象", input: {props: {readOnly: false, maxHeight: 320}, model: {value: {id: "chapter-01", title: "第一章", wordCount: 3182, tags: ["草稿", "待审"], meta: {createdAt: "2026-08-01T10:00:00Z", author: null, pinned: false}}}}},
            {id: "array", label: "数组", input: {props: {readOnly: false, maxHeight: 320}, model: {value: [{tool: "read_file", ok: true, ms: 12}, {tool: "write_file", ok: false, ms: 340}, {tool: "list_dir", ok: true, ms: 3}]}}},
            {id: "text", label: "未写完的字符串", input: {props: {readOnly: false, maxHeight: 320}, model: {value: '{\n  "unfinished": tru'}}},
            {id: "empty", label: "空对象", input: {props: {readOnly: false, maxHeight: 320}, model: {value: {}}}},
        ], load: async () => (await import("./JsonViewerFixture.vue")).default,
    }),
    defineLabFixture<typeof SurfaceTierDemo>({
        component: "SurfaceTierDemo", noInput: "该组件没有可编辑输入",
        scenes: [{id: "default", label: "5 档对照"}],
        load: async () => (await import("./SurfaceTierDemoFixture.vue")).default,
    }),
    defineLabFixture<typeof DesktopTitleBarChrome>({
        component: "DesktopTitleBarChrome", scenes: desktopTitleBarChromeScenes,
        load: async () => (await import("./DesktopTitleBarChromeFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentProfileIdentitySection>({
        component: "AgentProfileIdentitySection", scenes: agentProfileIdentitySectionScenes,
        load: async () => (await import("./AgentProfileIdentitySectionFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentProfileModelSection>({
        component: "AgentProfileModelSection", scenes: agentProfileModelSectionScenes,
        load: async () => (await import("./AgentProfileModelSectionFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentProfileCustomSettingsSection>({
        component: "AgentProfileCustomSettingsSection", scenes: agentProfileCustomSettingsSectionScenes,
        load: async () => (await import("./AgentProfileCustomSettingsSectionFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentProfileRuntimeSection>({
        component: "AgentProfileRuntimeSection", scenes: agentProfileRuntimeSectionScenes,
        load: async () => (await import("./AgentProfileRuntimeSectionFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentProfileDefaultProfileSection>({
        component: "AgentProfileDefaultProfileSection", scenes: agentProfileDefaultProfileSectionScenes,
        load: async () => (await import("./AgentProfileDefaultProfileSectionFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentProfileDefaultModelSection>({
        component: "AgentProfileDefaultModelSection", scenes: agentProfileDefaultModelSectionScenes,
        load: async () => (await import("./AgentProfileDefaultModelSectionFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentProfileDefaultRuntimeSection>({
        component: "AgentProfileDefaultRuntimeSection", scenes: agentProfileDefaultRuntimeSectionScenes,
        load: async () => (await import("./AgentProfileDefaultRuntimeSectionFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentProfileNavList>({component: "AgentProfileNavList", scenes: agentProfileNavListScenes, load: async () => (await import("./AgentProfileNavListFixture.vue")).default}),
    defineLabFixture<typeof AgentProfileSettingsView>({component: "AgentProfileSettingsView", scenes: agentProfileSettingsViewScenes, load: async () => (await import("./AgentProfileSettingsViewFixture.vue")).default}),
    defineLabFixture<typeof NovelIdeSettingsView>({component: "NovelIdeSettingsView", scenes: novelIdeSettingsViewScenes, load: async () => (await import("./NovelIdeSettingsViewFixture.vue")).default}),
    defineLabFixture<typeof FrontendSettingsView>({component: "FrontendSettingsView", scenes: frontendSettingsViewScenes, load: async () => (await import("./FrontendSettingsViewFixture.vue")).default}),
    defineLabFixture<typeof SettingsLoadState>({component: "SettingsLoadState", scenes: settingsLoadStateScenes, load: async () => (await import("./SettingsLoadStateFixture.vue")).default}),
    defineLabFixture<typeof WebSettingsView>({component: "WebSettingsView", scenes: webSettingsViewScenes, load: async () => (await import("./WebSettingsViewFixture.vue")).default}),
    defineLabFixture<typeof EmbeddingSettingsView>({component: "EmbeddingSettingsView", scenes: embeddingSettingsViewScenes, load: async () => (await import("./EmbeddingSettingsViewFixture.vue")).default}),
    defineLabFixture<typeof CostSettingsView>({component: "CostSettingsView", scenes: costSettingsViewScenes, load: async () => (await import("./CostSettingsViewFixture.vue")).default}),
    defineLabFixture<typeof ObservabilitySettingsView>({component: "ObservabilitySettingsView", scenes: observabilitySettingsViewScenes, load: async () => (await import("./ObservabilitySettingsViewFixture.vue")).default}),
    defineLabFixture<typeof EditorSettingsView>({component: "EditorSettingsView", scenes: editorSettingsViewScenes, load: async () => (await import("./EditorSettingsViewFixture.vue")).default}),
    defineLabFixture<typeof DesktopSettingsView>({component: "DesktopSettingsView", scenes: desktopSettingsViewScenes, load: async () => (await import("./DesktopSettingsViewFixture.vue")).default}),
    defineLabFixture<typeof SecuritySettingsView>({component: "SecuritySettingsView", scenes: securitySettingsViewScenes, load: async () => (await import("./SecuritySettingsViewFixture.vue")).default}),
    defineLabFixture<typeof ProviderSettingsView>({component: "ProviderSettingsView", scenes: providerSettingsViewScenes, load: async () => (await import("./ProviderSettingsViewFixture.vue")).default}),
    defineLabFixture<typeof RolesSettingsView>({component: "RolesSettingsView", scenes: rolesSettingsViewScenes, load: async () => (await import("./RolesSettingsViewFixture.vue")).default}),
    defineLabFixture<typeof NovelIdeModelEditDialog>({component: "NovelIdeModelEditDialog", scenes: novelIdeModelEditDialogScenes, load: async () => (await import("./NovelIdeModelEditDialogFixture.vue")).default}),
    defineLabFixture<typeof ModelDiscoveryDialog>({component: "ModelDiscoveryDialog", scenes: modelDiscoveryDialogScenes, load: async () => (await import("./ModelDiscoveryDialogFixture.vue")).default}),
    defineLabFixture<typeof ModelLibraryDialog>({component: "ModelLibraryDialog", scenes: modelLibraryDialogScenes, load: async () => (await import("./ModelLibraryDialogFixture.vue")).default}),
    defineLabFixture<typeof ProjectPickerView>({component: "ProjectPickerView", scenes: projectPickerViewScenes, load: async () => (await import("./ProjectPickerViewFixture.vue")).default}),
    defineLabFixture<typeof ProjectPickerHeader>({component: "ProjectPickerHeader", scenes: projectPickerHeaderScenes, load: async () => (await import("./ProjectPickerHeaderFixture.vue")).default}),
    defineLabFixture<typeof ProjectPickerEmptyState>({component: "ProjectPickerEmptyState", noInput: "该组件没有可编辑的 JSON 输入", scenes: projectPickerEmptyStateScenes, load: async () => (await import("./ProjectPickerEmptyStateFixture.vue")).default}),
    defineLabFixture<typeof ProjectCard>({component: "ProjectCard", scenes: projectCardScenes, load: async () => (await import("./ProjectCardFixture.vue")).default}),
    defineLabFixture<typeof ProjectCreateCoverPreview>({component: "ProjectCreateCoverPreview", scenes: projectCreateCoverPreviewScenes, load: async () => (await import("./ProjectCreateCoverPreviewFixture.vue")).default}),
    defineLabFixture<typeof ProjectCreateForm>({component: "ProjectCreateForm", scenes: projectCreateFormScenes, load: async () => (await import("./ProjectCreateFormFixture.vue")).default}),
    defineLabFixture<typeof ProjectCreateDialog>({component: "ProjectCreateDialog", scenes: projectCreateDialogScenes, load: async () => (await import("./ProjectCreateDialogFixture.vue")).default}),
    defineLabFixture<typeof ProjectCoverDialog>({component: "ProjectCoverDialog", scenes: projectCoverDialogScenes, load: async () => (await import("./ProjectCoverDialogFixture.vue")).default}),
    defineLabFixture<typeof WorkbenchContainerSurface>({
        component: "WorkbenchContainerSurface", scenes: workbenchContainerSurfaceScenes,
        slots: ["default", "head", "content", "actions"],
        load: async () => (await import("./WorkbenchContainerSurfaceFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchContainerSection>({
        component: "WorkbenchContainerSection", scenes: workbenchContainerSectionScenes,
        slots: ["default", "actions", "context"],
        load: async () => (await import("./WorkbenchContainerSectionFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchPanelSurface>({
        component: "WorkbenchPanelSurface", scenes: workbenchPanelSurfaceScenes,
        slots: ["tabs", "actions", "content"],
        load: async () => (await import("./WorkbenchPanelSurfaceFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchStatusBar>({
        component: "WorkbenchStatusBar", scenes: workbenchStatusBarScenes,
        slots: ["left", "right"],
        load: async () => (await import("./WorkbenchStatusBarFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchActivityBar>({
        component: "WorkbenchActivityBar", scenes: workbenchActivityBarScenes,
        load: async () => (await import("./WorkbenchActivityBarFixture.vue")).default,
    }),
    defineLabFixture<typeof NovelIdeActivityBar>({component: "NovelIdeActivityBar", scenes: novelIdeActivityBarScenes, load: async () => (await import("./NovelIdeActivityBarFixture.vue")).default}),
    defineLabFixture<typeof EditorWorkbench>({component: "EditorWorkbench", scenes: editorWorkbenchScenes, load: async () => (await import("./EditorWorkbenchFixture.vue")).default}),
    defineLabFixture<typeof CodeEditorView>({
        component: "CodeEditorView", scenes: codeEditorViewScenes,
        load: async () => (await import("./CodeEditorViewFixture.vue")).default,
    }),
    defineLabFixture<typeof MonacoCodeEditor>({component: "MonacoCodeEditor", scenes: monacoCodeEditorScenes, load: async () => (await import("./MonacoCodeEditorFixture.vue")).default}),
    defineLabFixture<typeof MarkdownEditorView>({
        component: "MarkdownEditorView", scenes: markdownEditorViewScenes,
        load: async () => (await import("./MarkdownEditorViewFixture.vue")).default,
    }),
    defineLabFixture<typeof EditorViewHost>({
        component: "EditorViewHost", scenes: editorViewHostScenes,
        load: async () => (await import("./EditorViewHostFixture.vue")).default,
    }),
    defineLabFixture<typeof EditorTabBar>({
        component: "EditorTabBar", scenes: editorTabBarScenes,
        slots: ["trailing"],
        load: async () => (await import("./EditorTabBarFixture.vue")).default,
    }),
    defineLabFixture<typeof EditorToolbar>({
        component: "EditorToolbar", scenes: editorToolbarScenes,
        load: async () => (await import("./EditorToolbarFixture.vue")).default,
    }),
    defineLabFixture<typeof EditorWelcome>({
        component: "EditorWelcome", scenes: editorWelcomeScenes,
        load: async () => (await import("./EditorWelcomeFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentChatFlow>({component: "AgentChatFlow", scenes: agentChatFlowScenes, load: async () => (await import("./AgentChatFlowFixture.vue")).default}),
    defineLabFixture<typeof AgentChatEmptyState>({component: "AgentChatEmptyState", scenes: agentChatEmptyStateScenes, load: async () => (await import("./AgentChatEmptyStateFixture.vue")).default}),
    defineLabFixture<typeof AgentChatHistoryLoader>({component: "AgentChatHistoryLoader", scenes: agentChatHistoryLoaderScenes, load: async () => (await import("./AgentChatHistoryLoaderFixture.vue")).default}),
    defineLabFixture<typeof AgentUserBubble>({component: "AgentUserBubble", scenes: agentUserBubbleScenes, load: async () => (await import("./AgentUserBubbleFixture.vue")).default}),
    defineLabFixture<typeof AgentAssistantBubble>({component: "AgentAssistantBubble", scenes: agentAssistantBubbleScenes, load: async () => (await import("./AgentAssistantBubbleFixture.vue")).default}),
    defineLabFixture<typeof AgentThinkingCollapsible>({component: "AgentThinkingCollapsible", scenes: agentThinkingCollapsibleScenes, load: async () => (await import("./AgentThinkingCollapsibleFixture.vue")).default}),
    defineLabFixture<typeof AgentMessageActionBar>({component: "AgentMessageActionBar", scenes: agentMessageActionBarScenes, load: async () => (await import("./AgentMessageActionBarFixture.vue")).default}),
    defineLabFixture<typeof AgentSystemBubble>({component: "AgentSystemBubble", scenes: agentSystemBubbleScenes, load: async () => (await import("./AgentSystemBubbleFixture.vue")).default}),
    defineLabFixture<typeof AgentTextBubble>({component: "AgentTextBubble", scenes: agentTextBubbleScenes, load: async () => (await import("./AgentTextBubbleFixture.vue")).default}),
    defineLabFixture<typeof AgentToolBubble>({component: "AgentToolBubble", scenes: agentToolBubbleScenes, load: async () => (await import("./AgentToolBubbleFixture.vue")).default}),
    defineLabFixture<typeof AgentToolNode>({component: "AgentToolNode", scenes: agentToolNodeScenes, load: async () => (await import("./AgentToolNodeFixture.vue")).default}),
    defineLabFixture<typeof AgentEditFileBubble>({component: "AgentEditFileBubble", scenes: agentEditFileBubbleScenes, load: async () => (await import("./AgentEditFileBubbleFixture.vue")).default}),
    defineLabFixture<typeof AgentWriteFileBubble>({component: "AgentWriteFileBubble", scenes: agentWriteFileBubbleScenes, load: async () => (await import("./AgentWriteFileBubbleFixture.vue")).default}),
    defineLabFixture<typeof AgentApplyPatchBubble>({component: "AgentApplyPatchBubble", scenes: agentApplyPatchBubbleScenes, load: async () => (await import("./AgentApplyPatchBubbleFixture.vue")).default}),
    defineLabFixture<typeof AgentSwitchModeBubble>({component: "AgentSwitchModeBubble", scenes: agentSwitchModeBubbleScenes, load: async () => (await import("./AgentSwitchModeBubbleFixture.vue")).default}),
    defineLabFixture<typeof AgentTaskBubble>({component: "AgentTaskBubble", scenes: agentTaskBubbleScenes, load: async () => (await import("./AgentTaskBubbleFixture.vue")).default}),
    defineLabFixture<typeof AgentRequestUserInputCard>({component: "AgentRequestUserInputCard", scenes: agentRequestUserInputCardScenes, load: async () => (await import("./AgentRequestUserInputCardFixture.vue")).default}),
    defineLabFixture<typeof AgentQueuedMessageList>({component: "AgentQueuedMessageList", scenes: agentQueuedMessageListScenes, load: async () => (await import("./AgentQueuedMessageListFixture.vue")).default}),
    defineLabFixture<typeof AgentComposer>({component: "AgentComposer", scenes: agentComposerScenes, load: async () => (await import("./AgentComposerFixture.vue")).default}),
    defineLabFixture<typeof AgentComposerAvailabilityBanner>({component: "AgentComposerAvailabilityBanner", scenes: agentComposerAvailabilityBannerScenes, load: async () => (await import("./AgentComposerAvailabilityBannerFixture.vue")).default}),
    defineLabFixture<typeof AgentComposerImageBar>({component: "AgentComposerImageBar", scenes: agentComposerImageBarScenes, load: async () => (await import("./AgentComposerImageBarFixture.vue")).default}),
    defineLabFixture<typeof AgentComposerToolbar>({component: "AgentComposerToolbar", slots: ["model-controls"], scenes: agentComposerToolbarScenes, load: async () => (await import("./AgentComposerToolbarFixture.vue")).default}),
    defineLabFixture<typeof AgentSessionStatusBar>({component: "AgentSessionStatusBar", scenes: agentSessionStatusBarScenes, load: async () => (await import("./AgentSessionStatusBarFixture.vue")).default}),
    defineLabFixture<typeof AgentComposerInput>({component: "AgentComposerInput", scenes: agentComposerInputScenes, load: async () => (await import("./AgentComposerInputFixture.vue")).default}),
    defineLabFixture<typeof AgentSessionModelControls>({component: "AgentSessionModelControls", scenes: agentSessionModelControlsScenes, load: async () => (await import("./AgentSessionModelControlsFixture.vue")).default}),
    defineLabFixture<typeof ModelPickerContent>({
        component: "ModelPickerContent",
        scenes: modelPickerContentScenes,
        load: async () => (await import("./ModelPickerContentFixture.vue")).default,
    }),
    defineLabFixture<typeof ModelPickerPopover>({
        component: "ModelPickerPopover",
        scenes: modelPickerPopoverScenes,
        load: async () => (await import("./ModelPickerPopoverFixture.vue")).default,
    }),
    defineLabFixture<typeof AgentUserInputPrompt>({component: "AgentUserInputPrompt", scenes: agentUserInputPromptScenes, load: async () => (await import("./AgentUserInputPromptFixture.vue")).default}),
    defineLabFixture<typeof AgentSessionHeader>({component: "AgentSessionHeader", scenes: agentSessionHeaderScenes, load: async () => (await import("./AgentSessionHeaderFixture.vue")).default}),
    defineLabFixture<typeof AgentSystemPromptPanel>({component: "AgentSystemPromptPanel", scenes: agentSystemPromptPanelScenes, load: async () => (await import("./AgentSystemPromptPanelFixture.vue")).default}),
    defineLabFixture<typeof AgentLinkedAgentPanel>({component: "AgentLinkedAgentPanel", scenes: agentLinkedAgentPanelScenes, load: async () => (await import("./AgentLinkedAgentPanelFixture.vue")).default}),
    defineLabFixture<typeof AgentSidebarView>({
        component: "AgentSidebarView", scenes: agentSidebarViewScenes,
        load: async () => (await import("./AgentSidebarViewFixture.vue")).default,
    }),
    defineLabFixture<typeof EditorTabItem>({
        component: "EditorTabItem", scenes: editorTabItemScenes,
        load: async () => (await import("./EditorTabItemFixture.vue")).default,
    }),
    defineLabFixture<typeof EditorBreadcrumbs>({
        component: "EditorBreadcrumbs", scenes: editorBreadcrumbsScenes,
        slots: ["trailing"],
        load: async () => (await import("./EditorBreadcrumbsFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchCommandPalette>({component: "WorkbenchCommandPalette", noInput: "命令面板由 Lab 命令宿主驱动，没有可登记的 JSON 输入", scenes: workbenchCommandPaletteScenes, load: async () => (await import("./WorkbenchCommandPaletteFixture.vue")).default}),
    defineLabFixture<typeof WorkbenchTitleActions>({
        component: "WorkbenchTitleActions", scenes: workbenchTitleActionsScenes,
        load: async () => (await import("./WorkbenchTitleActionsFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchShellLayout>({
        component: "WorkbenchShellLayout",
        scenes: WORKBENCH_SHELL_LAYOUT_SCENES,
        load: async () => (await import("./WorkbenchShellLayoutFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchPanelTab>({
        component: "WorkbenchPanelTab", scenes: workbenchPanelTabScenes,
        load: async () => (await import("./WorkbenchPanelTabFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchStatusBarItem>({
        component: "WorkbenchStatusBarItem", scenes: workbenchStatusBarItemScenes,
        load: async () => (await import("./WorkbenchStatusBarItemFixture.vue")).default,
    }),
    defineLabFixture<typeof WorkbenchViewInstances>({component: "WorkbenchViewInstances", scenes: workbenchViewInstancesScenes, load: async () => (await import("./WorkbenchViewInstancesFixture.vue")).default}),
    defineLabFixture<typeof ContextMenu>({component: "ContextMenu", scenes: contextMenuScenes, load: async () => (await import("./ContextMenuFixture.vue")).default}),
    defineLabFixture<typeof Dialog>({component: "Dialog", scenes: dialogScenes, slots: ["default", "header-extra", "footer"], load: async () => (await import("./DialogFixture.vue")).default}),
    defineLabFixture<typeof Dropdown>({component: "Dropdown", scenes: dropdownScenes, slots: ["default"], load: async () => (await import("./DropdownFixture.vue")).default}),
    defineLabFixture<typeof IconButton>({component: "IconButton", scenes: iconButtonScenes, slots: ["default"], load: async () => (await import("./IconButtonFixture.vue")).default}),
    defineLabFixture<typeof LucideIconPickerDialog>({component: "LucideIconPickerDialog", scenes: lucideIconPickerDialogScenes, load: async () => (await import("./LucideIconPickerDialogFixture.vue")).default}),
    defineLabFixture<typeof ReferenceChip>({component: "ReferenceChip", scenes: referenceChipScenes, load: async () => (await import("./ReferenceChipFixture.vue")).default}),
    defineLabFixture<typeof SideDetailPanel>({component: "SideDetailPanel", scenes: sideDetailPanelScenes, slots: ["header", "actions", "default"], load: async () => (await import("./SideDetailPanelFixture.vue")).default}),
    defineLabFixture<typeof SkillChip>({component: "SkillChip", scenes: skillChipScenes, load: async () => (await import("./SkillChipFixture.vue")).default}),
    defineLabFixture<typeof Tooltip>({component: "Tooltip", scenes: tooltipScenes, load: async () => (await import("./TooltipFixture.vue")).default}),
    defineLabFixture<typeof TagInput>({component: "TagInput", scenes: tagInputScenes, load: async () => (await import("./TagInputFixture.vue")).default}),
    defineLabFixture<typeof LowCodeFieldShell>({component: "LowCodeFieldShell", scenes: lowCodeFieldShellScenes, slots: ["default", "actions"], load: async () => (await import("./LowCodeFieldShellFixture.vue")).default}),
    defineLabFixture<typeof LowCodeNumberField>({component: "LowCodeNumberField", scenes: lowCodeNumberFieldScenes, load: async () => (await import("./LowCodeNumberFieldFixture.vue")).default}),
    defineLabFixture<typeof LowCodeRadioField>({component: "LowCodeRadioField", scenes: lowCodeRadioFieldScenes, load: async () => (await import("./LowCodeRadioFieldFixture.vue")).default}),
    defineLabFixture<typeof LowCodeResourcePresetField>({component: "LowCodeResourcePresetField", scenes: lowCodeResourcePresetFieldScenes, load: async () => (await import("./LowCodeResourcePresetFieldFixture.vue")).default}),
    defineLabFixture<typeof LowCodeSelectField>({component: "LowCodeSelectField", scenes: lowCodeSelectFieldScenes, load: async () => (await import("./LowCodeSelectFieldFixture.vue")).default}),
    defineLabFixture<typeof LowCodeSwitchField>({component: "LowCodeSwitchField", scenes: lowCodeSwitchFieldScenes, load: async () => (await import("./LowCodeSwitchFieldFixture.vue")).default}),
    defineLabFixture<typeof LowCodeTextareaField>({component: "LowCodeTextareaField", scenes: lowCodeTextareaFieldScenes, load: async () => (await import("./LowCodeTextareaFieldFixture.vue")).default}),
    defineLabFixture<typeof LowCodeTextField>({component: "LowCodeTextField", scenes: lowCodeTextFieldScenes, load: async () => (await import("./LowCodeTextFieldFixture.vue")).default}),
    defineLabFixture<typeof FormCheckbox>({component: "FormCheckbox", scenes: formCheckboxScenes, load: async () => (await import("./FormCheckboxFixture.vue")).default}),
    defineLabFixture<typeof FormField>({component: "FormField", scenes: formFieldScenes, slots: ["default"], load: async () => (await import("./FormFieldFixture.vue")).default}),
    defineLabFixture<typeof FormInput>({component: "FormInput", scenes: formInputScenes, slots: ["prefix"], load: async () => (await import("./FormInputFixture.vue")).default}),
    defineLabFixture<typeof FormNumberInput>({component: "FormNumberInput", scenes: formNumberInputScenes, load: async () => (await import("./FormNumberInputFixture.vue")).default}),
    defineLabFixture<typeof FormTextarea>({component: "FormTextarea", scenes: formTextareaScenes, load: async () => (await import("./FormTextareaFixture.vue")).default}),
    defineLabFixture<typeof StructuredTextEditor>({component: "StructuredTextEditor", scenes: structuredTextEditorScenes, load: async () => (await import("./StructuredTextEditorFixture.vue")).default}),
    defineLabFixture<typeof ReferencePlainTextEditor>({component: "ReferencePlainTextEditor", scenes: referencePlainTextEditorScenes, load: async () => (await import("./ReferencePlainTextEditorFixture.vue")).default}),
    defineLabFixture<typeof ReferenceSelectorPopover>({component: "ReferenceSelectorPopover", scenes: referenceSelectorPopoverScenes, load: async () => (await import("./ReferenceSelectorPopoverFixture.vue")).default}),
    defineLabFixture<typeof SegmentedControl>({component: "SegmentedControl", scenes: segmentedControlScenes, load: async () => (await import("./SegmentedControlFixture.vue")).default}),
    defineLabFixture<typeof DiffWorkbench>({component: "DiffWorkbench", scenes: diffWorkbenchScenes, load: async () => (await import("./DiffWorkbenchFixture.vue")).default}),
    defineLabFixture<typeof DiffWorkbenchDialog>({component: "DiffWorkbenchDialog", scenes: diffWorkbenchDialogScenes, load: async () => (await import("./DiffWorkbenchDialogFixture.vue")).default}),
    defineLabFixture<typeof SharedDiffEditor>({component: "SharedDiffEditor", scenes: sharedDiffEditorScenes, load: async () => (await import("./SharedDiffEditorFixture.vue")).default}),
    defineLabFixture<typeof SharedMergeEditor>({component: "SharedMergeEditor", scenes: sharedMergeEditorScenes, load: async () => (await import("./SharedMergeEditorFixture.vue")).default}),
    defineLabFixture<typeof Combobox>({component: "Combobox", scenes: comboboxScenes, load: async () => (await import("./ComboboxFixture.vue")).default}),
    defineLabFixture<typeof FormColorField>({component: "FormColorField", scenes: formColorFieldScenes, load: async () => (await import("./FormColorFieldFixture.vue")).default}),
    defineLabFixture<typeof FormSelect>({component: "FormSelect", scenes: formSelectScenes, load: async () => (await import("./FormSelectFixture.vue")).default}),
    defineLabFixture<typeof LowCodeCheckboxField>({component: "LowCodeCheckboxField", scenes: lowCodeCheckboxFieldScenes, load: async () => (await import("./LowCodeCheckboxFieldFixture.vue")).default}),
    defineLabFixture<typeof LowCodeComboboxField>({component: "LowCodeComboboxField", scenes: lowCodeComboboxFieldScenes, load: async () => (await import("./LowCodeComboboxFieldFixture.vue")).default}),
    defineLabFixture<typeof LowCodeForm>({component: "LowCodeForm", scenes: lowCodeFormScenes, load: async () => (await import("./LowCodeFormFixture.vue")).default}),
];

export function findLabFixture(component: string): LabFixture | null {
    return labFixtures.find((fixture) => fixture.component === component) ?? null;
}
