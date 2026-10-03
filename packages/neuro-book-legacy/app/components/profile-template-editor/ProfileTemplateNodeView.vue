<script setup lang="ts">
import {CollisionPriority} from "@dnd-kit/abstract";
import {useDroppable} from "@dnd-kit/vue";
import {useSortable} from "@dnd-kit/vue/sortable";
import AgentMarkdownContent from "nbook/app/components/novel-ide/agent/bubbles/base/AgentMarkdownContent.vue";
import type {ProfileTemplateNodeDto, ProfileTemplateNodeType, ProfileTemplatePropValue} from "nbook/shared/dto/profile-template.dto";

const props = defineProps<{
    node: ProfileTemplateNodeDto;
    selectedId: string;
    depth: number;
    index: number;
    parentId: string;
    canHaveChildren: boolean;
    disabledDropNodeIds: string[];
}>();

const emit = defineEmits<{
    (e: "select", id: string): void;
    (e: "prepareDrag", id: string): void;
    (e: "duplicate", id: string): void;
    (e: "delete", id: string): void;
}>();

const collapsed = ref(false);
const elementRef = ref<HTMLElement | null>(null);
const handleRef = ref<HTMLElement | null>(null);
const targetRef = ref<HTMLElement | null>(null);
const beforeDropRef = ref<HTMLElement | null>(null);
const afterDropRef = ref<HTMLElement | null>(null);
const insideDropRef = ref<HTMLElement | null>(null);
const dropDisabled = computed(() => props.disabledDropNodeIds.includes(props.node.id));
const hasChildrenPanel = computed(() => props.canHaveChildren && (!collapsed.value || props.node.children.length === 0));

const {isDragging} = useSortable({
    id: computed(() => props.node.id),
    index: computed(() => props.index),
    group: computed(() => props.parentId),
    type: "profile-template-node",
    accept: "profile-template-node",
    data: computed(() => ({
        kind: "profile-template-node" as const,
        nodeId: props.node.id,
        parentId: props.parentId,
    })),
    element: elementRef,
    handle: handleRef,
    target: targetRef,
    transition: null,
    disabled: computed(() => props.node.type === "ProfilePrompt"),
});

useDroppable({
    id: computed(() => `drop-before-${props.node.id}`),
    type: "profile-template-drop-zone",
    accept: ["profile-template-node", "library-node"],
    data: computed(() => ({
        kind: "profile-template-drop" as const,
        parentId: props.parentId,
        targetId: props.node.id,
        position: "before" as const,
    })),
    element: beforeDropRef,
    collisionPriority: CollisionPriority.Highest,
    disabled: dropDisabled,
});

useDroppable({
    id: computed(() => `drop-after-${props.node.id}`),
    type: "profile-template-drop-zone",
    accept: ["profile-template-node", "library-node"],
    data: computed(() => ({
        kind: "profile-template-drop" as const,
        parentId: props.parentId,
        targetId: props.node.id,
        position: "after" as const,
    })),
    element: afterDropRef,
    collisionPriority: CollisionPriority.Highest,
    disabled: dropDisabled,
});

useDroppable({
    id: computed(() => `drop-inside-${props.node.id}`),
    type: "profile-template-drop-zone",
    accept: ["profile-template-node", "library-node"],
    data: computed(() => ({
        kind: "profile-template-drop" as const,
        parentId: props.node.id,
        targetId: null,
        position: "inside" as const,
    })),
    element: insideDropRef,
    collisionPriority: CollisionPriority.Highest,
    disabled: computed(() => !hasChildrenPanel.value || dropDisabled.value),
});

const nodeIconMap: Record<ProfileTemplateNodeType, string> = {
    ProfilePrompt: "i-lucide-code-2",
    System: "i-lucide-terminal-square",
    HistorySet: "i-lucide-archive",
    ModelContext: "i-lucide-panel-top",
    AppendingSet: "i-lucide-panel-bottom",
    FileChangeNotice: "i-lucide-file-diff",
    Compaction: "i-lucide-archive-restore",
    CompactionPrompt: "i-lucide-file-text",
    CompactionSummaryPrefix: "i-lucide-text-quote",
    Text: "i-lucide-type",
    Message: "i-lucide-message-square",
    AIMessage: "i-lucide-sparkles",
    ToolCall: "i-lucide-wrench",
    ToolResult: "i-lucide-check-circle",
    Reminder: "i-lucide-bell-ring",
    Watch: "i-lucide-eye",
    If: "i-lucide-git-branch",
    SystemReminder: "i-lucide-badge-alert",
    LinkedAgentsSummary: "i-lucide-git-merge",
    LinkedAgentsReminder: "i-lucide-network",
    WorkspaceFocusReminder: "i-lucide-folder-kanban",
    ModeAvailabilityReminder: "i-lucide-clipboard-plus",
    TaskReminder: "i-lucide-list-checks",
    ModeReminder: "i-lucide-clipboard-check",
    ModeSlot: "i-lucide-file-text",
    MentionedSkillsReminder: "i-lucide-at-sign",
    AgentCatalog: "i-lucide-bot",
    SkillCatalog: "i-lucide-library",
    WorkflowCatalog: "i-lucide-workflow",
    ActivatedSkills: "i-lucide-sparkles",
    SqlSchemaSummary: "i-lucide-database",
    Import: "i-lucide-file-input",
};

/**
 * 返回节点展示标题。
 */
function nodeTitle(node: ProfileTemplateNodeDto): string {
    if (node.type === "Text") {
        return "Text";
    }
    if (node.type === "Message" || node.type === "AIMessage") {
        return node.type;
    }
    if (node.type === "ToolCall") {
        return "ToolCall";
    }
    return node.type;
}

/**
 * 返回节点的短属性摘要。
 */
function nodeMeta(node: ProfileTemplateNodeDto): string {
    if (node.type === "Message") {
        return `role: ${String(node.props.role ?? "user")}`;
    }
    if (node.type === "Text") {
        return node.textKind === "source" ? "source" : "text";
    }
    if (node.type === "AIMessage") {
        return "role: assistant";
    }
    if (node.type === "ToolCall") {
        return `tool: ${String(node.props.name ?? "tool")}`;
    }
    if (node.type === "ToolResult") {
        return `tool: ${String(node.props.toolName ?? "tool")}`;
    }
    if (node.type === "Reminder" || node.type === "WorkspaceFocusReminder" || node.type === "ModeAvailabilityReminder" || node.type === "TaskReminder" || node.type === "ModeReminder") {
        return ["id", "watchPath", "watchValue", "repeatEveryTurns"]
            .filter((key) => node.props[key] !== undefined && node.props[key] !== "")
            .map((key) => `${key}: ${formatPropValue(node.props[key])}`)
            .join(" · ");
    }
    if (node.type === "Watch") {
        return `path: ${String(node.props.path ?? "")}`;
    }
    if (node.type === "Import") {
        return `path: ${String(node.props.path ?? "")}`;
    }
    if (node.type === "Compaction") {
        return ["triggerPercent", "triggerTokens", "keepRecentPercent", "keepRecentTokens", "reserveTokens"]
            .filter((key) => node.props[key] !== undefined && node.props[key] !== "")
            .map((key) => `${key}: ${formatPropValue(node.props[key])}`)
            .join(" · ");
    }
    if (node.type === "If") {
        const condition = node.props.condition;
        return `condition: ${typeof condition === "object" && condition !== null && "kind" in condition && condition.kind === "expression" ? condition.code : String(condition ?? "true")}`;
    }
    return node.id;
}

/**
 * 将属性值转成适合节点标题行显示的短文本。
 */
function formatPropValue(value: ProfileTemplatePropValue | undefined): string {
    if (typeof value === "object" && value !== null && "kind" in value && value.kind === "expression") {
        return value.code;
    }
    return String(value ?? "");
}

/**
 * 返回节点说明或正文预览。
 */
function nodeSummary(node: ProfileTemplateNodeDto): string {
    if (node.text) {
        return node.text.replace(/\s+/g, " ").slice(0, 160);
    }
    if (node.type === "HistorySet") {
        return "长期记忆上下文，进长期历史。";
    }
    if (node.type === "System") {
        return "Provider systemPrompt，不写入 session。";
    }
    if (node.type === "ModelContext") {
        return "本轮临时上下文，仅用于模型。";
    }
    if (node.type === "AppendingSet") {
        return "输出追加集合，写入历史尾部。";
    }
    if (node.type === "Compaction") {
        return "Profile 级上下文压缩策略。";
    }
    if (node.type === "CompactionPrompt") {
        return "压缩摘要调用的 systemPrompt。";
    }
    if (node.type === "CompactionSummaryPrefix") {
        return "摘要注入后续上下文的前缀。";
    }
    if (node.type === "ActivatedSkills") {
        return String(node.props.text ?? "${activatedSkillsText}");
    }
    if (node.type === "AgentCatalog") {
        return String(node.props.text ?? "${agentCatalogText}");
    }
    if (node.type === "SkillCatalog") {
        return String(node.props.text ?? "${skillCatalogText}");
    }
    if (node.type === "SqlSchemaSummary") {
        return String(node.props.text ?? "${sqlSchemaSummaryText}");
    }
    if (node.type === "Import") {
        const heading = node.props.heading ? `#${String(node.props.heading)}` : "";
        return `Import ${String(node.props.path ?? "")}${heading}`;
    }
    if (node.type === "LinkedAgentsReminder" || node.type === "LinkedAgentsSummary") {
        return "Linked agents summary.";
    }
    if (node.type === "WorkspaceFocusReminder") {
        return "File scope and workspace focus reminder.";
    }
    if (node.type === "ModeAvailabilityReminder") {
        return "switch_mode availability reminder in normal mode.";
    }
    if (node.type === "TaskReminder") {
        return "Task list reminder from agent.tasks.";
    }
    if (node.type === "ModeReminder") {
        return "Agent mode lifecycle reminder.";
    }
    if (node.type === "ModeSlot") {
        return `Custom mode reminder slot: ${String(node.props.kind ?? "")}`;
    }
    if (node.type === "MentionedSkillsReminder") {
        return "Reminder for explicit $skill mentions.";
    }
    if (node.type === "FileChangeNotice") {
        return `Workspace file changes · mode: ${String(node.props.mode ?? "minimal")}`;
    }
    return "";
}

/**
 * 判断是否显示节点正文摘要。
 */
function shouldShowSummary(node: ProfileTemplateNodeDto): boolean {
    return node.type !== "ProfilePrompt" && node.type !== "Text";
}

/**
 * 选择当前节点。
 */
function selectNode(): void {
    emit("select", props.node.id);
}

/**
 * 开始拖拽前先同步选中状态。
 */
function prepareDrag(): void {
    emit("prepareDrag", props.node.id);
}

</script>

<template>
    <div ref="elementRef" class="node-wrap" :data-dragging="isDragging || undefined" :style="{ marginLeft: `${props.depth === 0 ? 0 : 6}px` }">
        <article
            class="node-card"
            :class="[{ selected: props.selectedId === props.node.id }, `node-${props.node.type}`]"
            :data-dragging="isDragging || undefined"
            @click.stop="selectNode"
        >
            <div ref="beforeDropRef" class="node-edge-drop node-edge-drop-before"></div>
            <div ref="targetRef" class="node-sort-target">
                <button ref="handleRef" type="button" class="node-drag-handle mt-1" title="拖拽排序" @pointerdown="prepareDrag" @click.stop>
                    <span class="i-lucide-grip-vertical h-4 w-4"></span>
                </button>

                <button v-if="props.node.children.length > 0" type="button" class="node-icon-btn mt-1" title="折叠/展开" @click.stop="collapsed = !collapsed">
                    <span :class="collapsed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="h-3.5 w-3.5"></span>
                </button>

                <div class="node-icon mt-0.5">
                    <span :class="nodeIconMap[props.node.type]" class="h-3.5 w-3.5"></span>
                </div>

                <div class="node-main">
                    <div class="node-title-row">
                        <span class="truncate text-sm font-semibold text-[var(--text-main)]">{{ nodeTitle(props.node) }}</span>
                        <span class="node-meta" :class="{ 'condition-meta': props.node.type === 'If' }">{{ nodeMeta(props.node) }}</span>
                    </div>
                    <div v-if="props.node.type === 'Message' && (props.node.text ?? '').trim()" class="node-message-body mt-2">
                        <pre v-if="props.node.textKind === 'source'" class="node-source-body">{{ props.node.text }}</pre>
                        <AgentMarkdownContent v-else :content="props.node.text ?? ''" />
                    </div>
                    <div v-else-if="shouldShowSummary(props.node) && nodeSummary(props.node)" class="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">
                        {{ nodeSummary(props.node) }}
                    </div>
                </div>

                <div v-if="props.depth > 0" class="node-actions">
                    <button type="button" class="node-action-btn" title="复制" @click.stop="emit('duplicate', props.node.id)">
                        <span class="i-lucide-copy h-3.5 w-3.5"></span>
                    </button>
                    <button type="button" class="node-action-btn danger" title="删除" @click.stop="emit('delete', props.node.id)">
                        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                    </button>
                </div>
                <div v-if="props.node.type === 'Text' && (props.node.text ?? '').trim()" class="node-message-body node-text-body-row" @click.stop="selectNode">
                    <pre v-if="props.node.textKind === 'source'" class="node-source-body">{{ props.node.text }}</pre>
                    <AgentMarkdownContent v-else :content="props.node.text ?? ''" />
                </div>
            </div>

            <div v-if="hasChildrenPanel" class="node-children" :data-empty="props.node.children.length === 0 || undefined">
                <ProfileTemplateNodeView
                    v-if="props.node.children.length > 0"
                    v-for="(child, childIndex) in props.node.children"
                    :key="child.id"
                    :node="child"
                    :selected-id="props.selectedId"
                    :depth="props.depth + 1"
                    :index="childIndex"
                    :parent-id="props.node.id"
                    :can-have-children="!['Text', 'ToolCall', 'ToolResult', 'AgentCatalog', 'SkillCatalog', 'WorkflowCatalog', 'ActivatedSkills', 'SqlSchemaSummary', 'Import', 'LinkedAgentsSummary', 'LinkedAgentsReminder', 'WorkspaceFocusReminder', 'ModeAvailabilityReminder', 'TaskReminder', 'MentionedSkillsReminder', 'FileChangeNotice'].includes(child.type)"
                    :disabled-drop-node-ids="props.disabledDropNodeIds"
                    @select="emit('select', $event)"
                    @prepare-drag="emit('prepareDrag', $event)"
                    @duplicate="emit('duplicate', $event)"
                    @delete="emit('delete', $event)"
                />
                <div ref="insideDropRef" class="node-inside-drop"></div>
            </div>
            <div ref="afterDropRef" class="node-edge-drop node-edge-drop-after"></div>
        </article>
    </div>
</template>

<style scoped>
.node-wrap {
    padding-bottom: 10px;
}

.node-card {
    --profile-node-accent: var(--accent-main);
    --profile-node-bg: color-mix(in srgb, var(--profile-node-accent) 8%, var(--bg-panel));
    --profile-node-bg-strong: color-mix(in srgb, var(--profile-node-accent) 17%, var(--bg-panel));
    --profile-node-border: color-mix(in srgb, var(--profile-node-accent) 34%, var(--border-color));
    --profile-node-icon-bg: color-mix(in srgb, var(--profile-node-accent) 22%, var(--bg-panel));
    --profile-node-icon-color: color-mix(in srgb, var(--profile-node-accent) 80%, var(--text-main));
    position: relative;
    border: 1px solid var(--profile-node-border, var(--border-color));
    border-radius: 8px;
    background: var(--profile-node-bg, var(--bg-input));
    padding: 10px 10px 10px 8px;
    text-align: left;
    transition: border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
}

.node-edge-drop {
    position: absolute;
    left: 8px;
    right: 8px;
    z-index: 3;
    height: 10px;
    pointer-events: auto;
}

.node-edge-drop-before {
    top: -5px;
}

.node-edge-drop-after {
    bottom: -5px;
}

.node-sort-target {
    display: grid;
    grid-template-columns: 28px auto 24px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: start;
    min-height: 34px;
}

.node-main {
    min-width: 0;
    grid-column: 4;
}

.node-title-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
}

.node-meta {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: 11px;
}

.condition-meta {
    border: 1px solid color-mix(in srgb, var(--profile-node-accent) 42%, var(--border-color));
    border-radius: 6px;
    background: color-mix(in srgb, var(--profile-node-accent) 14%, var(--bg-panel));
    color: color-mix(in srgb, var(--profile-node-accent) 86%, var(--text-main));
    padding: 2px 7px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-weight: 700;
}

.node-inside-drop {
    position: relative;
    height: 14px;
    margin-top: 2px;
    border-radius: 999px;
    pointer-events: none;
}

:deep(.node-wrap[data-dnd-placeholder]) {
    visibility: visible !important;
    opacity: 1 !important;
}

:deep(.node-wrap[data-dnd-placeholder] .node-card) {
    border: 1px dashed color-mix(in srgb, var(--accent-main) 68%, var(--border-color));
    background: color-mix(in srgb, var(--accent-bg) 44%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bg-panel) 76%, transparent);
}

:deep(.node-wrap[data-dnd-placeholder] .node-card > *) {
    visibility: hidden;
}

:deep(.node-wrap[data-dnd-placeholder] .node-card::before) {
    display: none;
}

.node-card::before {
    position: absolute;
    bottom: 10px;
    left: 0;
    top: 10px;
    width: 3px;
    border-radius: 0 999px 999px 0;
    background: var(--accent-main);
    content: "";
    opacity: 0.58;
}

.node-card:hover {
    border-color: color-mix(in srgb, var(--profile-node-accent) 48%, var(--border-color));
    background: var(--profile-node-bg-strong, var(--bg-panel));
}

.node-card.selected {
    border-color: color-mix(in srgb, var(--profile-node-accent) 70%, var(--accent-main));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--profile-node-accent) 36%, transparent);
}

.node-wrap[data-dragging="true"] .node-card {
    opacity: 0.9;
    transform: rotate(0.15deg);
}

.node-wrap[data-dragging="true"] .node-actions,
.node-wrap[data-dragging="true"] .node-children {
    pointer-events: none;
}

:deep(.node-card[data-dnd-dragging="true"]) {
    border: 1px dashed color-mix(in srgb, var(--accent-main) 68%, var(--border-color));
    background: color-mix(in srgb, var(--accent-bg) 44%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bg-panel) 76%, transparent);
    opacity: 1;
}

:deep(.node-card[data-dnd-dragging="true"] > *) {
    visibility: hidden;
}

:deep(.node-card[data-dnd-dragging="true"]::before) {
    display: none;
}

.node-ProfilePrompt::before,
.node-System::before,
.node-HistorySet::before,
.node-ModelContext::before,
.node-AppendingSet::before,
.node-Compaction::before,
.node-CompactionPrompt::before,
.node-CompactionSummaryPrefix::before,
.node-Message::before,
.node-AIMessage::before,
.node-ToolCall::before,
.node-ToolResult::before,
.node-Reminder::before,
.node-Watch::before,
.node-If::before,
.node-SystemReminder::before,
.node-LinkedAgentsSummary::before,
.node-LinkedAgentsReminder::before,
.node-WorkspaceFocusReminder::before,
.node-ModeAvailabilityReminder::before,
.node-TaskReminder::before,
.node-ModeReminder::before,
.node-ModeSlot::before,
.node-MentionedSkillsReminder::before,
.node-FileChangeNotice::before,
.node-AgentCatalog::before,
.node-ActivatedSkills::before,
.node-SkillCatalog::before,
.node-Import::before {
    background: var(--profile-node-accent);
}

.node-ProfilePrompt {
    --profile-node-accent: var(--accent-main);
}

.node-HistorySet {
    --profile-node-accent: #3f7f72;
}

.node-System {
    --profile-node-accent: #5f70a5;
}

.node-ModelContext {
    --profile-node-accent: #47799a;
}

.node-AppendingSet {
    --profile-node-accent: #6f6aa8;
}

.node-Compaction,
.node-CompactionPrompt,
.node-CompactionSummaryPrefix {
    --profile-node-accent: #7a7f4e;
}

.node-Message {
    --profile-node-accent: #c2693c;
}

.node-AIMessage {
    --profile-node-accent: #7b68b3;
}

.node-ToolCall {
    --profile-node-accent: #4f8c8f;
}

.node-ToolResult {
    --profile-node-accent: #4b9272;
}

.node-Reminder {
    --profile-node-accent: #b65f5b;
}

.node-Watch {
    --profile-node-accent: #b1843e;
}

.node-If {
    --profile-node-accent: #64895f;
}

.node-SystemReminder,
.node-LinkedAgentsReminder {
    --profile-node-accent: #b65f5b;
}

.node-LinkedAgentsSummary {
    --profile-node-accent: #4f8c8f;
}

.node-WorkspaceFocusReminder,
.node-ModeAvailabilityReminder {
    --profile-node-accent: #b65f5b;
}

.node-TaskReminder,
.node-ModeReminder,
.node-ModeSlot {
    --profile-node-accent: #8a639e;
}

.node-MentionedSkillsReminder {
    --profile-node-accent: #b1843e;
}

.node-FileChangeNotice {
    --profile-node-accent: #4f8c8f;
}

.node-ActivatedSkills {
    --profile-node-accent: #8a639e;
}

.node-AgentCatalog {
    --profile-node-accent: #4e7f9f;
}

.node-SkillCatalog {
    --profile-node-accent: #5f70a5;
}

.node-Import {
    --profile-node-accent: #5c7f67;
}

.node-HistorySet,
.node-ModelContext,
.node-AppendingSet,
.node-Compaction {
    padding: 10px;
}

.node-icon {
    display: flex;
    height: 24px;
    width: 24px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--profile-node-icon-bg);
    color: var(--profile-node-icon-color);
}

.node-icon-btn,
.node-drag-handle,
.node-action-btn {
    display: inline-flex;
    height: 24px;
    width: 24px;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    color: var(--text-muted);
    transition: background-color 0.18s ease, color 0.18s ease;
}

.node-icon-btn:hover,
.node-drag-handle:hover,
.node-action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-main);
}

.node-drag-handle {
    cursor: grab;
    opacity: 0.7;
    width: 28px;
    background: color-mix(in srgb, var(--bg-input) 70%, transparent);
}

.node-drag-handle:active {
    cursor: grabbing;
}

.node-action-btn.danger:hover {
    color: var(--status-danger);
}

.node-actions {
    display: flex;
    flex-shrink: 0;
    gap: 2px;
    opacity: 0;
    position: relative;
    z-index: 4;
    transition: opacity 0.18s ease;
}

.node-card:hover .node-actions,
.node-card.selected .node-actions {
    opacity: 1;
}

.node-children {
    margin-top: 8px;
    border-left: 1px dashed var(--border-color);
    padding-left: 6px;
}

.node-children[data-empty="true"] {
    min-height: 24px;
}

.node-message-body {
    width: 100%;
    max-height: 180px;
    overflow: auto;
    border: 1px solid color-mix(in srgb, var(--profile-node-accent) 24%, var(--border-color));
    border-radius: 6px;
    background: color-mix(in srgb, var(--profile-node-accent) 6%, var(--bg-panel));
    padding: 8px 9px;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.55;
}

.node-text-body-row {
    grid-column: 2 / -1;
    max-height: 280px;
    margin-top: 6px;
    border: 0;
    background: color-mix(in srgb, var(--profile-node-accent) 4%, var(--bg-panel));
    padding: 10px 12px;
    font-size: 13px;
    line-height: 1.68;
    user-select: text;
}

.node-text-body-row :deep(.agent-markdown) {
    font-size: 14px;
    line-height: 1.72;
}

.node-text-body-row :deep(pre) {
    font-size: 12.5px;
    line-height: 1.62;
}

.node-text-body-row :deep(code) {
    font-size: 12.5px;
}

.node-source-body {
    margin: 0;
    overflow: visible;
    color: var(--text-secondary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.45;
    white-space: pre-wrap;
}
</style>
