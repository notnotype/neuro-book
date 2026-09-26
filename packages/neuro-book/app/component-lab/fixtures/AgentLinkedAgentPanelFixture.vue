<script setup lang="ts">
/**
 * AgentLinkedAgentPanel 的 Component Lab 规范夹具。
 *
 * 规范原则：
 * 1. 纯粹交付：一个 Tab 一个组件，不套多余外壳大卡片与假边框；
 * 2. 居中呈现：通过 flex items-center justify-center 将组件置于画布中央，自适应视口；
 * 3. 零件标定：核心被测组件标记 data-lab-subject，供 Lab 探针直接聚焦；
 * 4. 控件下放：所有交互调试控件包裹在 LabFixtureControls 内部挂载到底部抽屉栏；
 * 5. 契约同步：使用 useLabEventSink 记录事件，使用 useLabDataSink 同步状态；
 * 6. 场景驱动：通过切换 scene 展示各个不同状态，绝不在一个 Tab 平铺多个副本。
 */
import {computed, onBeforeUnmount, watch} from "vue";
import AgentLinkedAgentPanel from "nbook/app/components/novel-ide/agent/panels/linked-agents/AgentLinkedAgentPanel.vue";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {linkedByAgents as defaultLinkedByAgents, ownedLinkedAgents as defaultOwnedAgents} from "./AgentExtraPanels.scenes";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentLinkedAgentPanel>(() => props.input, ["select", "refresh", "close"]);
const syncLabData = useLabDataSink();
const emitLabEvent = useLabEventSink();
const sessionId = computed(() => subject.bindings.value.sessionId);
const ownedAgents = computed(() => subject.bindings.value.ownedAgents);
const linkedByAgents = computed(() => subject.bindings.value.linkedByAgents);
const loading = computed(() => subject.bindings.value.loading);
let pending: ReturnType<typeof setTimeout> | undefined;
let pendingInput: LabFixtureProps["input"];

function cancelPending(): void {
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
    pendingInput = undefined;
}

watch([() => props.scene, () => props.input], ([scene], [previousScene, previousInput]) => {
    if (scene !== previousScene || (props.input !== previousInput && props.input !== pendingInput)) cancelPending();
});
onBeforeUnmount(cancelPending);
watch([() => props.scene, sessionId, ownedAgents, linkedByAgents, loading], () => {
    syncLabData({
        scene: props.scene, sessionId: sessionId.value, loading: loading.value,
        ownedCount: ownedAgents.value.length, linkedByCount: linkedByAgents.value.length,
        ownedAgents: ownedAgents.value, linkedByAgents: linkedByAgents.value,
    });
}, {immediate: true});

function handleSelect(targetSessionId: number): void {
    subject.write("props", "sessionId", targetSessionId);
}
function handleControlRefresh(): void {
    emitLabEvent("refresh");
    handleRefresh();
}

function toggleLinkedAgents(): void {
    const restore = ownedAgents.value.length === 0 && linkedByAgents.value.length === 0;
    subject.write("props", "ownedAgents", restore ? defaultOwnedAgents : []);
    subject.write("props", "linkedByAgents", restore ? defaultLinkedByAgents : []);
}

function handleRefresh(): void {
    subject.write("props", "loading", true);
    cancelPending();
    pending = setTimeout(() => {
        subject.write("props", "loading", false);
        pending = undefined;
        pendingInput = undefined;
    }, 500);
    pendingInput = props.input;
}
</script>

<template>
    <div class="w-full p-4">
        <AgentLinkedAgentPanel
            data-lab-subject
            class="w-full"
            v-bind="subject.bindings.value"
            @select="handleSelect"
            @refresh="handleRefresh"
        />
    </div>

        <!-- 调试控制条：下放至 Lab 底部抽屉栏 -->
        <LabFixtureControls>
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
                <span class="text-[var(--text-secondary)]">AgentLinkedAgentPanel 调试</span>
                <div class="flex flex-wrap items-center gap-1.5">
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="handleControlRefresh"
                    >
                        模拟刷新
                    </button>
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="subject.write('props', 'loading', !loading)"
                    >
                        {{ loading ? "停止加载" : "切换加载中" }}
                    </button>
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="toggleLinkedAgents"
                    >
                        {{ ownedAgents.length > 0 ? "清空关联列表" : "恢复关联列表" }}
                    </button>
                </div>
            </div>
        </LabFixtureControls>
</template>
