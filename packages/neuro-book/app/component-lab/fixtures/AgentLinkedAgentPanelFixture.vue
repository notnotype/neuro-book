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
import {ref, watch} from "vue";
import AgentLinkedAgentPanel from "nbook/app/components/novel-ide/agent/panels/linked-agents/AgentLinkedAgentPanel.vue";
import type {AgentLinkedSessionDto} from "nbook/shared/dto/agent-session.dto";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

const DEFAULT_OWNED_AGENTS: AgentLinkedSessionDto[] = [
    {
        sessionId: 201,
        sessionIdentity: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        title: "第一章初稿撰写",
        profileKey: "writer",
        status: "running",
        updatedAt: Date.now() - 60_000,
        archived: false,
    },
    {
        sessionId: 202,
        sessionIdentity: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        title: "角色资料检索",
        profileKey: "retrieval",
        status: "idle",
        updatedAt: Date.now() - 300_000,
        archived: false,
    },
    {
        sessionId: 203,
        sessionIdentity: "c3d4e5f6-a7b8-9012-cdef-123456789012",
        title: "世界观素材整理",
        profileKey: "leader.assets",
        status: "waiting",
        updatedAt: Date.now() - 180_000,
        archived: false,
        profileAvailability: "unloadable",
        profileIssueMessage: "assets profile 需要更新配置文件",
    },
];

const DEFAULT_LINKED_BY_AGENTS: AgentLinkedSessionDto[] = [
    {
        sessionId: 100,
        sessionIdentity: "d4e5f6a7-b8c9-0123-defa-234567890123",
        title: "主线调度 Session",
        profileKey: "leader.default",
        status: "idle",
        updatedAt: Date.now() - 600_000,
        archived: false,
    },
];

const sessionId = ref<number | null>(101);
const ownedAgents = ref<AgentLinkedSessionDto[]>(DEFAULT_OWNED_AGENTS);
const linkedByAgents = ref<AgentLinkedSessionDto[]>(DEFAULT_LINKED_BY_AGENTS);
const loading = ref(false);

function applyScene(sceneId: string, customData?: unknown): void {
    const rawData = (customData ?? {}) as Record<string, unknown>;

    sessionId.value = typeof rawData.sessionId === "number" ? rawData.sessionId : 101;

    if (sceneId === "empty") {
        ownedAgents.value = Array.isArray(rawData.ownedAgents) ? rawData.ownedAgents as AgentLinkedSessionDto[] : [];
        linkedByAgents.value = Array.isArray(rawData.linkedByAgents) ? rawData.linkedByAgents as AgentLinkedSessionDto[] : [];
        loading.value = typeof rawData.loading === "boolean" ? rawData.loading : false;
    } else if (sceneId === "loading") {
        ownedAgents.value = Array.isArray(rawData.ownedAgents) ? rawData.ownedAgents as AgentLinkedSessionDto[] : DEFAULT_OWNED_AGENTS;
        linkedByAgents.value = Array.isArray(rawData.linkedByAgents) ? rawData.linkedByAgents as AgentLinkedSessionDto[] : DEFAULT_LINKED_BY_AGENTS;
        loading.value = typeof rawData.loading === "boolean" ? rawData.loading : true;
    } else {
        // populated 场景
        ownedAgents.value = Array.isArray(rawData.ownedAgents) ? rawData.ownedAgents as AgentLinkedSessionDto[] : DEFAULT_OWNED_AGENTS;
        linkedByAgents.value = Array.isArray(rawData.linkedByAgents) ? rawData.linkedByAgents as AgentLinkedSessionDto[] : DEFAULT_LINKED_BY_AGENTS;
        loading.value = typeof rawData.loading === "boolean" ? rawData.loading : false;
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
        sessionId: sessionId.value,
        loading: loading.value,
        ownedCount: ownedAgents.value.length,
        linkedByCount: linkedByAgents.value.length,
        ownedAgents: ownedAgents.value,
        linkedByAgents: linkedByAgents.value,
    });
}

function handleSelect(targetSessionId: number): void {
    emitLabEvent("select", {sessionId: targetSessionId});
    sessionId.value = targetSessionId;
    syncSink();
}

function handleRefresh(): void {
    emitLabEvent("refresh");
    loading.value = true;
    syncSink();

    setTimeout(() => {
        loading.value = false;
        syncSink();
    }, 500);
}

function handleClose(): void {
    emitLabEvent("close");
}
</script>

<template>
    <div class="w-full p-4">
        <AgentLinkedAgentPanel
            data-lab-subject
            class="w-full"
            :session-id="sessionId"
            :owned-agents="ownedAgents"
            :linked-by-agents="linkedByAgents"
            :loading="loading"
            @select="handleSelect"
            @refresh="handleRefresh"
            @close="handleClose"
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
                        @click="handleRefresh"
                    >
                        模拟刷新
                    </button>
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="() => {
                            loading = !loading;
                            syncSink();
                        }"
                    >
                        {{ loading ? "停止加载" : "切换加载中" }}
                    </button>
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="() => {
                            if (ownedAgents.length > 0 || linkedByAgents.length > 0) {
                                ownedAgents = [];
                                linkedByAgents = [];
                            } else {
                                ownedAgents = DEFAULT_OWNED_AGENTS;
                                linkedByAgents = DEFAULT_LINKED_BY_AGENTS;
                            }
                            syncSink();
                        }"
                    >
                        {{ ownedAgents.length > 0 ? "清空关联列表" : "恢复关联列表" }}
                    </button>
                </div>
            </div>
        </LabFixtureControls>
</template>
