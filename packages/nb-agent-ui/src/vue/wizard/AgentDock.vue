<script setup lang="ts">
/**
 * 停靠区（见同名 `.md`）：不阻塞的等用户事项一次一个，借三种向导画内容，外框经注入换成停靠的标题行（`dock-frame.ts`）。
 *
 * 界面状态（展开与否、看到第几个、填了一半的答案）在这里，每次变化经 `dock.state` 交给宿主、宿主经 `ctx.dockState` 放回，同同步向导。
 * 不移动焦点：它不替换输入框，用户可能正在打字。
 */
import {computed, provide, ref} from "vue";
import {IconButton} from "@notnotype/nb-ui/components";

import type {InputResolution, JsonValue, PendingInputView} from "../../types";
import {approvalResolution, isApproval, isModeSwitch, isQuestions, questionResolution, readDockState} from "../../wizard";
import type {DockState, WizardState} from "../../wizard";
import {useAgentText} from "../host";
import type {ViewAction} from "../view-action";
import AgentApprovalWizard from "./AgentApprovalWizard.vue";
import AgentModeSwitchWizard from "./AgentModeSwitchWizard.vue";
import AgentQuestionWizard from "./AgentQuestionWizard.vue";
import {dockFrameKey} from "./dock-frame";
import type {DockFrame} from "./dock-frame";

const props = defineProps<{
    items: readonly PendingInputView[];
    state?: JsonValue | undefined;
    /** 同步向导在：收成一条、不能展开。 */
    held?: boolean;
}>();

const emit = defineEmits<{action: [action: ViewAction]}>();

const {t} = useAgentText();
const state = ref<DockState>(readDockState(props.state));
/** 看到的那个事项的 id：前面的答完消失时还是它，它自己消失时停在原来的位置。 */
const seenId = ref<string | null>(null);

const index = computed(() => {
    const byId = seenId.value === null ? -1 : props.items.findIndex((item) => item.id === seenId.value);
    return byId >= 0 ? byId : Math.min(state.value.index, props.items.length - 1);
});
const item = computed(() => props.items[Math.max(0, index.value)]);
const collapsed = computed(() => props.held === true || state.value.collapsed);

function setState(next: DockState): void {
    state.value = next;
    emit("action", {type: "dock.state", state: next as unknown as JsonValue});
}

function go(to: number): void {
    seenId.value = props.items[to]?.id ?? null;
    setState({...state.value, index: to});
}

function setWizard(wizard: WizardState): void {
    setState({...state.value, wizard});
}

function setCollapsed(value: boolean): void {
    setState({...state.value, collapsed: value});
}

function submit(resolutions: InputResolution): void {
    const current = item.value;
    if (current === undefined) return;
    emit("action", {type: "input.submit", batchKey: current.id, resolutions, ...(current.source === undefined ? {} : {sessionId: current.source.sessionId})});
}

function submitApproval(): void {
    const current = item.value;
    const choice = current === undefined ? undefined : state.value.wizard.approvals[current.id];
    if (choice !== undefined) submit(approvalResolution(choice));
}

function submitQuestions(): void {
    const current = item.value;
    if (current === undefined || !isQuestions(current)) return;
    submit(questionResolution(current.questions, state.value.wizard.answers[current.id] ?? [], {other: t("wizard.question.otherLabel"), form: t("wizard.question.formLabel")}));
}

const frame = computed((): DockFrame => {
    const total = props.items.length;
    const at = index.value;
    const source = item.value?.source;
    return {
        ...(source === undefined ? {} : {source, open: () => emit("action", {type: "session.select", sessionId: source.sessionId})}),
        ...(total > 1 ? {count: t("wizard.count", {index: at + 1, total})} : {}),
        ...(at > 0 ? {previous: () => go(at - 1)} : {}),
        ...(at < total - 1 ? {next: () => go(at + 1)} : {}),
    };
});
provide(dockFrameKey, frame);

/** 收起的小条写第一个的前半句：来源与它在等什么。 */
const summary = computed(() => {
    const first = props.items[0];
    if (first === undefined) return "";
    const what = isApproval(first) ? t("dock.what.approval", {tool: first.tool}) : isModeSwitch(first) ? t("dock.what.modeSwitch", {mode: first.toLabel}) : first.questions[0]?.question ?? "";
    return first.source === undefined ? what : t("dock.fromSubagent", {name: first.source.name, what});
});
</script>

<template>
    <div v-if="item !== undefined" class="acv-dock" role="group" :aria-label="t('dock.label', {count: props.items.length})" data-agent-dock data-stream-scroll-ignore>
        <div v-if="collapsed" class="acv-dock__bar nb-ui-popover-surface" data-dock-collapsed>
            <span class="acv-dock__dot" aria-hidden="true" />
            <b>{{ t("dock.pending", {count: props.items.length}) }}</b>
            <span class="acv-dock__what">{{ summary }}</span>
            <span class="acv-dock__spacer" />
            <IconButton v-if="!props.held" icon-class="i-lucide-chevron-up" size="sm" :title="t('wizard.expand')" :aria-label="t('wizard.expand')" data-dock-expand @click="setCollapsed(false)" />
        </div>
        <AgentApprovalWizard
            v-else-if="isApproval(item)"
            :key="item.id"
            :items="[item]"
            :state="state.wizard"
            @update:state="setWizard"
            @submit="submitApproval"
            @collapse="setCollapsed(true)"
        />
        <AgentModeSwitchWizard
            v-else-if="isModeSwitch(item)"
            :key="item.id"
            :item="item"
            :state="state.wizard"
            @update:state="setWizard"
            @answer="submit({kind: 'mode-switch', answer: $event})"
            @collapse="setCollapsed(true)"
        />
        <AgentQuestionWizard
            v-else-if="isQuestions(item)"
            :key="item.id"
            :item="item"
            :state="state.wizard"
            :stoppable="false"
            @update:state="setWizard"
            @submit="submitQuestions"
            @collapse="setCollapsed(true)"
        />
    </div>
</template>

<style scoped>
/* 限高相对视图根节点（尺寸容器）：贴着输入框，不挤掉消息流。 */
.acv-dock {
    display: flex;
    flex-shrink: 0;
    flex-direction: column;
    max-height: 40cqh;
    margin: 0 12px 6px;
}

.acv-dock > :deep(.acv-wizard-frame) {
    flex: 0 1 auto;
}

/* 同向导收起的小条：停靠的轻阴影，圆角同输入框。 */
.acv-dock__bar {
    --nb-popover-pad: 3px;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 6px 0 12px;
    border-radius: var(--radius-panel);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--shadow-color) 10%, transparent);
    font-size: var(--text-xs);
}

.acv-dock__bar b {
    flex-shrink: 0;
    color: var(--accent-text);
    font-weight: var(--weight-medium);
}

.acv-dock__dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-main);
}

.acv-dock__what {
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-dock__spacer {
    flex: 1;
}
</style>
