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
import {ref, watch} from "vue";
import AgentSystemPromptPanel from "nbook/app/components/novel-ide/agent/panels/system-prompt/AgentSystemPromptPanel.vue";
import LabFixtureControls from "../LabFixtureControls.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

const DEFAULT_SAMPLE_PROMPT = `## 角色定义

你是一位专业的小说写作助手，擅长长篇小说创作。你将帮助用户进行：

- **情节构思**：根据用户设定的世界观和角色，推进故事发展
- **文风校准**：保持与用户既有章节一致的叙述风格
- **角色刻画**：确保角色行为与性格设定一致

## 约束

1. 不主动改变已确认的角色设定
2. 每次输出控制在 2000 字以内
3. 涉及敏感话题时主动提醒用户

## 引用

- \`workspace://characters/林渊.md\`
- \`workspace://world/青云宗.md\``;

const open = ref(true);
const promptValue = ref<string | null>(DEFAULT_SAMPLE_PROMPT);
const loading = ref(false);
const error = ref<string | undefined>(undefined);
const hasUserTriggeredRetry = ref(false);

function applyScene(sceneId: string, customData?: unknown): void {
    const rawData = (customData ?? {}) as Record<string, unknown>;
    hasUserTriggeredRetry.value = false;

    if (typeof rawData.open === "boolean") {
        open.value = rawData.open;
    } else {
        open.value = true;
    }

    if (sceneId === "loading") {
        loading.value = typeof rawData.loading === "boolean" ? rawData.loading : true;
        promptValue.value = typeof rawData.value === "string" ? rawData.value : null;
        error.value = undefined;
    } else if (sceneId === "error") {
        loading.value = false;
        promptValue.value = null;
        error.value = typeof rawData.error === "string"
            ? rawData.error
            : "加载 System Prompt 失败：网络请求超时，请检查后端服务连接";
    } else if (sceneId === "empty") {
        loading.value = false;
        error.value = undefined;
        promptValue.value = typeof rawData.value === "string" ? rawData.value : "";
    } else {
        // expanded 展开状态
        loading.value = typeof rawData.loading === "boolean" ? rawData.loading : false;
        error.value = typeof rawData.error === "string" ? rawData.error : undefined;
        promptValue.value = typeof rawData.value === "string" ? rawData.value : DEFAULT_SAMPLE_PROMPT;
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
        open: open.value,
        value: promptValue.value,
        loading: loading.value,
        error: error.value,
    });
}

function handleModelValueUpdate(val: boolean): void {
    open.value = val;
    emitLabEvent("update:modelValue", {open: val});
    syncSink();
}

function handleLoad(): void {
    emitLabEvent("load");
    if (props.scene === "error" && error.value && !hasUserTriggeredRetry.value) {
        hasUserTriggeredRetry.value = true;
        return;
    }

    loading.value = true;
    error.value = undefined;
    syncSink();

    setTimeout(() => {
        loading.value = false;
        promptValue.value = DEFAULT_SAMPLE_PROMPT;
        syncSink();
    }, 600);
}

function handleRefresh(): void {
    emitLabEvent("refresh");
    loading.value = true;
    syncSink();

    setTimeout(() => {
        loading.value = false;
        syncSink();
    }, 400);
}

function handleOpenReference(target: string): void {
    emitLabEvent("openReference", {target});
}
</script>

<template>
    <div class="w-full p-4">
        <AgentSystemPromptPanel
            data-lab-subject
            class="w-full"
            :model-value="open"
            :value="promptValue"
            :loading="loading"
            :error="error"
            :open-reference="handleOpenReference"
            @update:model-value="handleModelValueUpdate"
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
                @click="handleModelValueUpdate(true)"
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
                        @click="handleModelValueUpdate(!open)"
                    >
                        {{ open ? "收起面板" : "展开面板" }}
                    </button>
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
                        {{ loading ? "停止加载" : "模拟加载中" }}
                    </button>
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="() => {
                            error = error ? undefined : '加载 System Prompt 失败：网络请求超时';
                            if (error) promptValue = null;
                            syncSink();
                        }"
                    >
                        {{ error ? "清除错误" : "模拟错误" }}
                    </button>
                    <button
                        type="button"
                        class="inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2 text-[11px] hover:bg-[var(--bg-hover)] cursor-pointer text-[var(--text-main)]"
                        @click="() => {
                            promptValue = promptValue ? '' : DEFAULT_SAMPLE_PROMPT;
                            error = undefined;
                            syncSink();
                        }"
                    >
                        {{ promptValue ? "设为空 Prompt" : "恢复 Prompt" }}
                    </button>
                </div>
            </div>
        </LabFixtureControls>
</template>
