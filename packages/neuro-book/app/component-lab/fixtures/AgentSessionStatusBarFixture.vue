<script setup lang="ts">
import {computed} from "vue";
import AgentSessionStatusBar from "../../components/novel-ide/agent/panels/status/AgentSessionStatusBar.vue";
import type {AgentMode} from "nbook/shared/dto/agent-session.dto";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

const agentMode = computed<AgentMode>(() => props.scene === "discuss-mode" ? "discuss" : "normal");
const running = computed(() => props.scene === "running");
const connectionNeedsAction = computed(() => props.scene === "connection-issue");
const connectionStatusLabel = computed(() => props.scene === "connection-issue" ? "连接断开" : "");
</script>

<template>
    <div class="w-full p-4">
        <AgentSessionStatusBar
            data-lab-subject
            class="w-full"
            context-usage-exact-label="上下文用量：32,450 / 200,000"
            context-usage-compact-label="32.5k"
            context-percent-compact-label="16%"
            cumulative-usage-exact-label="累积统计：输入 120k / 输出 15k / 缓存 80k"
            cumulative-input-compact-label="120k"
            cumulative-output-compact-label="15k"
            cumulative-cache-compact-label="80k"
            cumulative-cache-write-compact-label="10k"
            cumulative-cache-hit-rate-label="66%"
            cumulative-cost-compact-label="¥0.42"
            :connection-status-label="connectionStatusLabel"
            :connection-needs-action="connectionNeedsAction"
            :running="running"
            run-phase-label="正在思考推理中..."
            :agent-mode="agentMode"
            @open-context-inspector="emitLabEvent('open-context-inspector')"
            @reconnect-events="emitLabEvent('reconnect-events')"
            @refresh-history="emitLabEvent('refresh-history')"
        />
    </div>
</template>
