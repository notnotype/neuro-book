<script setup lang="ts">
/**
 * AgentSystemPromptPanel 的 Component Lab 规范夹具。
 *
 * 规范原则：
 * 1. 纯粹交付：一个 Tab 一个组件，不画多余的外壳大卡片与假边框；
 * 2. 居中呈现：通过 flex items-center justify-center 将组件置于画布中央，自适应视口；
 * 3. 零件标定：核心被测组件标记 data-lab-subject，供 Lab 探针直接聚焦；
 * 4. 控件下放：所有交互调试控件包裹在 LabFixtureControls 内部挂载到底部抽屉栏；
 * 5. 契约同步：使用 useLabEventSink 记录事件，使用 useLabDataSink 同步状态。
 */
import {computed, onBeforeUnmount, ref, watch} from "vue";
import AgentSystemPromptPanel from "nbook/app/components/novel-ide/agent/panels/system-prompt/AgentSystemPromptPanel.vue";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {sampleSystemPrompt} from "./AgentExtraPanels.scenes";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentSystemPromptPanel>(() => props.input, ["load", "refresh"]);
const syncLabData = useLabDataSink();
const emitLabEvent = useLabEventSink();
const open = computed(() => subject.bindings.value.modelValue);
const promptValue = computed(() => subject.bindings.value.value);
const loading = computed(() => subject.bindings.value.loading);
const error = computed(() => subject.bindings.value.error);
const hasUserTriggeredRetry = ref(false);
let pending: ReturnType<typeof setTimeout> | undefined;
let pendingInput: LabFixtureProps["input"];

function cancelPending(): void {
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
    pendingInput = undefined;
}

watch([() => props.scene, () => props.input], ([scene], [previousScene, previousInput]) => {
    if (scene !== previousScene) hasUserTriggeredRetry.value = false;
    if (scene !== previousScene || (props.input !== previousInput && props.input !== pendingInput)) cancelPending();
});
onBeforeUnmount(cancelPending);
watch([() => props.scene, open, promptValue, loading, error], () => {
    syncLabData({scene: props.scene, open: open.value, value: promptValue.value, loading: loading.value, error: error.value});
}, {immediate: true});

function handleControlModelValueUpdate(value: boolean): void {
    emitLabEvent("update:modelValue", value);
    subject.write("model", "modelValue", value);
}

function handleControlRefresh(): void {
    emitLabEvent("refresh");
    handleRefresh();
}

function handleLoad(): void {
    if (props.scene === "error" && error.value && !hasUserTriggeredRetry.value) {
        hasUserTriggeredRetry.value = true;
        return;
    }
    subject.write("props", "loading", true);
    subject.write("props", "error", "");
    cancelPending();
    pending = setTimeout(() => {
        subject.write("props", "loading", false);
        subject.write("props", "value", sampleSystemPrompt);
        pending = undefined;
        pendingInput = undefined;
    }, 600);
    pendingInput = props.input;
}

function handleRefresh(): void {
    subject.write("props", "loading", true);
    cancelPending();
    pending = setTimeout(() => {
        subject.write("props", "loading", false);
        pending = undefined;
        pendingInput = undefined;
    }, 400);
    pendingInput = props.input;
}

function handleOpenReference(target: string): void {
    emitLabEvent("openReference", {target});
}
function toggleError(): void {
    const hadError = Boolean(error.value);
    subject.write("props", "error", hadError ? "" : "加载 System Prompt 失败：网络请求超时");
    if (!hadError) subject.write("props", "value", null);
}

function togglePrompt(): void {
    subject.write("props", "value", promptValue.value ? "" : sampleSystemPrompt);
    subject.write("props", "error", "");
}

</script>

<template>
    <div class="w-full p-4">
        <AgentSystemPromptPanel
            data-lab-subject
            class="w-full"
            v-bind="subject.bindings.value"
            :open-reference="handleOpenReference"
            @load="handleLoad"
            @refresh="handleRefresh"
        />

        <!-- 面板收起状态提示 -->
        <div v-if="!open" class="flex flex-col items-center justify-center rounded-md border border-dashed border-[var(--border-color)] py-8 text-xs text-[var(--text-muted)]">
            <span class="i-lucide-terminal-square mb-2 h-6 w-6 opacity-40"></span>
            <span>System Prompt 面板已收起</span>
            <button
                type="button"
                class="mt-2 text-[var(--accent-text)] hover:underline cursor-pointer"
                @click="handleControlModelValueUpdate(true)"
            >
                点击展开面板
            </button>
        </div>
    </div>

        <!-- 调试控制条：下放至 Lab 底部抽屉栏 -->
        <LabFixtureControls>
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs select-none">
                <span class="text-[var(--text-secondary)]">AgentSystemPromptPanel 调试</span>
                <div class="flex flex-wrap items-center gap-1.5">
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="handleControlModelValueUpdate(!open)"
                    >
                        {{ open ? "收起面板" : "展开面板" }}
                    </button>
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
                        {{ loading ? "停止加载" : "模拟加载中" }}
                    </button>
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="toggleError"
                    >
                        {{ error ? "清除错误" : "模拟错误" }}
                    </button>
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="togglePrompt"
                    >
                        {{ promptValue ? "设为空 Prompt" : "恢复 Prompt" }}
                    </button>
                </div>
            </div>
        </LabFixtureControls>
</template>
