<script setup lang="ts">
/**
 * AgentSessionHeader 的 Component Lab 规范夹具。
 *
 * 规范原则：
 * 1. 纯粹交付：一个 Tab 一个组件，不套多余外壳大卡片与假边框；
 * 2. 居中呈现：通过 flex items-center justify-center 将组件置于画布中央，自适应视口；
 * 3. 零件标定：核心被测组件标记 data-lab-subject，供 Lab 探针直接聚焦；
 * 4. 控件下放：所有交互调试控件包裹在 LabFixtureControls 内部挂载到底部抽屉栏；
 * 5. 契约同步：使用 useLabEventSink 记录事件，使用 useLabDataSink 同步状态。
 */
import {ref, watch} from "vue";
import AgentSessionHeader from "nbook/app/components/novel-ide/agent/panels/header/AgentSessionHeader.vue";
import type {SummarizerStatus} from "nbook/app/components/novel-ide/agent/panels/header/AgentSessionHeader.vue";
import type {DropdownItem} from "@notnotype/nb-ui/components";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

const profileItems: DropdownItem[] = [
    {value: "default", label: "默认写作 Agent"},
    {value: "planner", label: "大纲与设定 Agent"},
    {value: "critic", label: "审稿与润色 Agent"},
];

const sampleSummarizerStatus: SummarizerStatus = {
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    title: "摘要已由后台模型自动更新",
    icon: "i-lucide-check-circle-2",
    spinning: false,
    label: "已更新",
};

const attachmentOpen = ref(false);
const linkedOpen = ref(false);
const systemPromptOpen = ref(false);
const canChooseProfile = ref(false);
const summarizerStatus = ref<SummarizerStatus | null>(null);
const attachmentTotal = ref(0);
const linkedCount = ref(0);

function applyScene(sceneId: string, customData?: unknown): void {
    const rawData = (customData ?? {}) as Record<string, unknown>;

    attachmentOpen.value = typeof rawData.attachmentOpen === "boolean" ? rawData.attachmentOpen : false;
    linkedOpen.value = typeof rawData.linkedOpen === "boolean" ? rawData.linkedOpen : false;
    systemPromptOpen.value = typeof rawData.systemPromptOpen === "boolean" ? rawData.systemPromptOpen : false;

    if (sceneId === "with-dropdown") {
        canChooseProfile.value = typeof rawData.canChooseProfile === "boolean" ? rawData.canChooseProfile : true;
        summarizerStatus.value = null;
        attachmentTotal.value = 0;
        linkedCount.value = 0;
    } else if (sceneId === "with-badges") {
        canChooseProfile.value = typeof rawData.canChooseProfile === "boolean" ? rawData.canChooseProfile : true;
        summarizerStatus.value = sampleSummarizerStatus;
        attachmentTotal.value = typeof rawData.attachmentTotal === "number" ? rawData.attachmentTotal : 3;
        linkedCount.value = typeof rawData.linkedCount === "number" ? rawData.linkedCount : 2;
    } else {
        // default 基础活跃会话标题栏
        canChooseProfile.value = typeof rawData.canChooseProfile === "boolean" ? rawData.canChooseProfile : false;
        summarizerStatus.value = null;
        attachmentTotal.value = 0;
        linkedCount.value = 0;
    }

    syncSink();
}

watch(
    () => [props.scene, props.data],
    () => applyScene(props.scene, props.data),
    {immediate: true, deep: true},
);

function syncSink(): void {
    syncLabData({
        scene: props.scene,
        canChooseProfile: canChooseProfile.value,
        hasSummarizer: summarizerStatus.value !== null,
        attachmentTotal: attachmentTotal.value,
        linkedCount: linkedCount.value,
        attachmentOpen: attachmentOpen.value,
        linkedOpen: linkedOpen.value,
        systemPromptOpen: systemPromptOpen.value,
    });
}

function handleCreateSession(profileKey?: string): void {
    emitLabEvent("create-session", {profileKey: profileKey ?? "default"});
}

function handleToggleAttachment(): void {
    attachmentOpen.value = !attachmentOpen.value;
    emitLabEvent("toggle-attachment-panel", {open: attachmentOpen.value});
    syncSink();
}

function handleToggleLinked(): void {
    linkedOpen.value = !linkedOpen.value;
    emitLabEvent("toggle-linked-agent-panel", {open: linkedOpen.value});
    syncSink();
}

function handleToggleSystemPrompt(): void {
    systemPromptOpen.value = !systemPromptOpen.value;
    emitLabEvent("toggle-system-prompt", {open: systemPromptOpen.value});
    syncSink();
}

function handleOpenSessionTree(): void {
    emitLabEvent("open-session-tree");
}

function handleOpenSessionDialog(): void {
    emitLabEvent("open-session-dialog");
}

function handleClose(): void {
    emitLabEvent("close");
}
</script>

<template>
    <div class="w-full">
        <AgentSessionHeader
            data-lab-subject
            class="w-full"
            drawer-icon-class="i-lucide-sparkles text-[var(--accent-main)]"
            active-session-title="第一卷：青云宗试炼（分支A）"
            active-drawer-title="长篇小说"
            active-session-summary-text="主角林渊在试炼塔击败了第三层傀儡，正在探索密室隐藏机关"
            :active-session-id="101"
            :can-choose-create-profile="canChooseProfile"
            :create-profile-dropdown-items="profileItems"
            :summarizer-status="summarizerStatus"
            :attachment-panel-open="attachmentOpen"
            :session-attachment-unique-total="attachmentTotal"
            :linked-agent-panel-open="linkedOpen"
            :linked-agent-count="linkedCount"
            :can-mutate-history="true"
            :system-prompt-panel-open="systemPromptOpen"
            @create-session="handleCreateSession"
            @toggle-attachment-panel="handleToggleAttachment"
            @toggle-linked-agent-panel="handleToggleLinked"
            @open-session-tree="handleOpenSessionTree"
            @toggle-system-prompt="handleToggleSystemPrompt"
            @open-session-dialog="handleOpenSessionDialog"
            @close="handleClose"
        />
    </div>

    <!-- 调试控制条：下放至底部抽屉栏 -->
    <LabFixtureControls>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
            <span class="text-[var(--text-secondary)]">AgentSessionHeader 调试</span>
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="handleToggleAttachment"
                >
                    {{ attachmentOpen ? "收起附件" : "展开附件" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="handleToggleLinked"
                >
                    {{ linkedOpen ? "收起关联" : "展开关联" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="handleToggleSystemPrompt"
                >
                    {{ systemPromptOpen ? "收起Prompt" : "展开Prompt" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="() => {
                        canChooseProfile = !canChooseProfile;
                        syncSink();
                    }"
                >
                    {{ canChooseProfile ? "隐藏下拉菜单" : "开启下拉菜单" }}
                </button>
            </div>
        </div>
    </LabFixtureControls>
</template>
