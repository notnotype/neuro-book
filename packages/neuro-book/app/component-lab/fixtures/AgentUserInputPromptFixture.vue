<script setup lang="ts">
import AgentUserInputPrompt from "../../components/novel-ide/agent/composer/AgentUserInputPrompt.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentUserInputPrompt>(() => props.input, ["submit","cancel","resync"]);
import LabFixtureControls from "../LabFixtureControls.vue";
import {createAgentPendingResolutionDraft} from "../../components/novel-ide/agent/agent-pending-resolution";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "../../components/novel-ide/agent/trigger-menu";
const resolveMenu = (_context: AgentTriggerMenuContext): AgentTriggerMenuState => ({title: "快捷指令", prefix: "/", sections: []});
function toggleBlocked(): void { subject.write("props", "canResolve", !subject.bindings.value.canResolve); }
function toggleSubmitting(): void { subject.write("props", "submitting", !subject.bindings.value.submitting); }
function toggleIssue(): void {
    subject.write("props", "submissionIssue", subject.bindings.value.submissionIssue ? null : {kind: "unknown", message: "提交结果暂时无法确认，需手动同步。"});
}
function resetDraft(): void { subject.write("model", "draft", createAgentPendingResolutionDraft(subject.bindings.value.sessions)); }
</script>
<template>
    <div class="w-full"><AgentUserInputPrompt data-lab-subject class="w-full" v-bind="subject.bindings.value" :resolve-menu="resolveMenu" /></div>
    <!-- 交互调试控制条：下放至 Lab 底部抽屉栏 -->
    <LabFixtureControls>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
            <span class="text-[var(--text-secondary)]">用户输入向导 · 交互调试</span>
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="() => { toggleBlocked(); }"
                >
                    {{ !subject.bindings.value.canResolve ? "解除阻断" : "模拟阻断" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="() => { toggleSubmitting(); }"
                >
                    {{ subject.bindings.value.submitting ? "取消提交中" : "切为提交中" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="() => {
                        toggleIssue();
                    }"
                >
                    {{ subject.bindings.value.submissionIssue ? "清除异常" : "模拟同步异常" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="resetDraft"
                >
                    重置草稿
                </button>
            </div>
        </div>
    </LabFixtureControls>
</template>
