<script setup lang="ts">
import AgentSessionHeader from "nbook/app/components/novel-ide/agent/panels/header/AgentSessionHeader.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentSessionHeader>(() => props.input, ["create-session","toggle-attachment-panel","toggle-linked-agent-panel","open-session-tree","toggle-system-prompt","open-session-dialog","close"]);
import LabFixtureControls from "../LabFixtureControls.vue";
function handleToggleAttachment(): void { subject.write("props", "attachmentPanelOpen", !subject.bindings.value.attachmentPanelOpen); }
function handleToggleLinked(): void { subject.write("props", "linkedAgentPanelOpen", !subject.bindings.value.linkedAgentPanelOpen); }
function handleToggleSystemPrompt(): void { subject.write("props", "systemPromptPanelOpen", !subject.bindings.value.systemPromptPanelOpen); }
function handleToggleProfile(): void { subject.write("props", "canChooseCreateProfile", !subject.bindings.value.canChooseCreateProfile); }
</script>
<template>
    <div class="w-full"><AgentSessionHeader data-lab-subject class="w-full" v-bind="subject.bindings.value" @toggle-attachment-panel="handleToggleAttachment" @toggle-linked-agent-panel="handleToggleLinked" @toggle-system-prompt="handleToggleSystemPrompt" /></div>
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
                    {{ subject.bindings.value.attachmentPanelOpen ? "收起附件" : "展开附件" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="handleToggleLinked"
                >
                    {{ subject.bindings.value.linkedAgentPanelOpen ? "收起关联" : "展开关联" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="handleToggleSystemPrompt"
                >
                    {{ subject.bindings.value.systemPromptPanelOpen ? "收起Prompt" : "展开Prompt" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="handleToggleProfile"
                >
                    {{ subject.bindings.value.canChooseCreateProfile ? "隐藏下拉菜单" : "开启下拉菜单" }}
                </button>
            </div>
        </div>
    </LabFixtureControls>
</template>
