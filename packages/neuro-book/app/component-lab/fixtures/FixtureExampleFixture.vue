<script setup lang="ts">
/**
 * FixtureExample 的 Component Lab 典型规范夹具。
 *
 * 核心原则：
 * 1. 纯粹交付：一个 Tab 一个组件，不套多余外壳大卡片与假边框；
 * 2. 居中呈现：通过 flex items-center justify-center 将组件置于画布中央，自适应视口；
 * 3. 零件标定：核心被测组件标记 data-lab-subject，便于 Lab 探针与高亮层准确定位；
 * 4. 控件下放：通过 LabFixtureControls 将测试控制条挂载至 Lab 底部抽屉面板；
 * 5. 契约同步：使用 useLabEventSink 上报交互事件，使用 useLabDataSink 同步可变状态；
 * 6. 视口验证：响应式与窄屏通过 Lab 顶栏视口预设（手机 390px / 平板 768px）验证，不在单个 Tab 内部平铺多个副本。
 */
import {ref, watch} from "vue";
import FixtureExample from "../FixtureExample.vue";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

const cardTitle = ref<string>("章节大纲智能体编排");
const cardDescription = ref<string>("负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。");
const cardStatus = ref<"ready" | "busy" | "warning">("ready");
const cardCount = ref<number>(12);
const cardActive = ref<boolean>(false);
const cardDisabled = ref<boolean>(false);

function applyScene(sceneId: string, customData?: unknown): void {
    const rawData = (customData ?? {}) as Record<string, unknown>;

    cardTitle.value = typeof rawData.title === "string" ? rawData.title : "章节大纲智能体编排";
    cardDescription.value = typeof rawData.description === "string"
        ? rawData.description
        : "负责小说卷级与章级大纲的递归展开，维护伏笔与人物动机一致性。";
    cardCount.value = typeof rawData.count === "number" ? rawData.count : 12;
    cardActive.value = typeof rawData.active === "boolean" ? rawData.active : (sceneId === "active");
    cardDisabled.value = typeof rawData.disabled === "boolean" ? rawData.disabled : (sceneId === "disabled");

    if (sceneId === "busy") {
        cardStatus.value = "busy";
    } else if (sceneId === "warning") {
        cardStatus.value = "warning";
    } else {
        cardStatus.value = typeof rawData.status === "string" ? (rawData.status as any) : "ready";
    }
}

watch(
    () => [props.scene, props.data],
    () => applyScene(props.scene, props.data),
    {immediate: true, deep: true},
);

function syncSink(): void {
    syncLabData({
        title: cardTitle.value,
        description: cardDescription.value,
        status: cardStatus.value,
        count: cardCount.value,
        active: cardActive.value,
        disabled: cardDisabled.value,
    });
}

function handleToggle(active: boolean): void {
    cardActive.value = active;
    emitLabEvent("toggle", {active});
    syncSink();
}

function handleAction(id: string): void {
    emitLabEvent("action", {id});
    if (id === "refresh") {
        cardCount.value += 1;
        syncSink();
    }
}
</script>

<template>
    <div class="w-full p-4">
        <FixtureExample
            data-lab-subject
            class="w-full"
            :title="cardTitle"
            :description="cardDescription"
            :status="cardStatus"
            :count="cardCount"
            :active="cardActive"
            :disabled="cardDisabled"
            @toggle="handleToggle"
            @action="handleAction"
        >
            <template #extra>
                <span class="text-[11px] text-[var(--accent-text)] font-mono">v1.2</span>
            </template>
        </FixtureExample>
    </div>

    <!-- 调试控制条：下放至 Lab 底部抽屉栏 -->
    <LabFixtureControls>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
            <span class="text-[var(--text-secondary)]">示范夹具 · 交互调试</span>
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="() => { cardActive = !cardActive; syncSink(); }"
                >
                    {{ cardActive ? "设为禁用 (Inactive)" : "设为激活 (Active)" }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="() => {
                        cardStatus = cardStatus === 'ready' ? 'busy' : cardStatus === 'busy' ? 'warning' : 'ready';
                        syncSink();
                    }"
                >
                    切状态: {{ cardStatus }}
                </button>
                <button
                    type="button"
                    class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                    @click="() => { cardDisabled = !cardDisabled; syncSink(); }"
                >
                    {{ cardDisabled ? "解除禁用" : "禁用组件" }}
                </button>
            </div>
        </div>
    </LabFixtureControls>
</template>
