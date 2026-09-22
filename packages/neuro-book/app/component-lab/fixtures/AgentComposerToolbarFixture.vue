<script setup lang="ts">
import AgentComposerToolbar from "../../components/novel-ide/agent/composer/AgentComposerToolbar.vue";
import type {AgentMode} from "nbook/shared/dto/agent-session.dto";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

const composerExpanded = ref(false);

const agentMode = computed<AgentMode>(() => {
    if (props.scene === "discuss-mode") return "discuss";
    if (props.scene === "plan-mode") return "plan";
    return "normal";
});

const running = computed(() => props.scene === "running");
const composerReadonly = computed(() => props.scene === "disabled");
const sendDisabled = computed(() => props.scene === "disabled");
const sendButtonTitle = computed(() => running.value ? "停止当前运行" : "发送消息");
const sendIconClass = computed(() => running.value ? "i-lucide-square" : "i-lucide-send");
</script>

<template>
    <div class="w-full p-4">
        <AgentComposerToolbar
            data-lab-subject
            class="w-full"
            :composer-expanded="composerExpanded"
            :composer-readonly="composerReadonly"
            :running="running"
            :can-register-images="!composerReadonly"
            :agent-mode="agentMode"
            :send-disabled="sendDisabled"
            :send-button-title="sendButtonTitle"
            :send-icon-class="sendIconClass"
            @toggle-expand="composerExpanded = !composerExpanded; emitLabEvent('toggle-expand')"
            @cycle-mode="emitLabEvent('cycle-mode')"
            @select-images="emitLabEvent('select-images')"
            @submit="emitLabEvent('submit', $event)"
        >
            <template #model-controls>
                <div class="flex h-7 items-center rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-secondary)]">
                    Claude 3.7 Sonnet
                </div>
            </template>
        </AgentComposerToolbar>
    </div>
</template>
