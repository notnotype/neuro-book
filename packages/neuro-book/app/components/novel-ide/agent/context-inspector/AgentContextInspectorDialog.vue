<script setup lang="ts">
/**
 * 上下文检查面板（Task 126）。
 *
 * 粘合层：取数、请求选择器、Tab 切换、错误与降级状态。两个 Tab 组件保持纯展示。
 *
 * 用 DialogWindow（非模态、可拖动）而不是 Dialog：使用者会一边看组成一边继续发消息，
 * 遮罩会挡住这个用法。
 *
 * 隐私边界：面板刻意不提供导出 / 复制全部 / 分享——traces 保留完整 prompt 正文且
 * 被排除在可分享日志包之外，加导出等于开一个绕过该边界的口子。
 */
import {DialogWindow} from "@notnotype/nb-ui/components";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import AgentContextCacheTimeline from "nbook/app/components/novel-ide/agent/context-inspector/AgentContextCacheTimeline.vue";
import AgentContextComposition from "nbook/app/components/novel-ide/agent/context-inspector/AgentContextComposition.vue";
import {groupDiagnostics} from "nbook/app/components/novel-ide/agent/context-inspector/context-inspector-view-model";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {AgentContextInspectionDto} from "nbook/shared/dto/agent-context-inspection.dto";

const props = defineProps<{
    modelValue: boolean;
    /** 当前会话；为空时面板不取数。 */
    sessionId: number | null;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();

const {t} = useI18n();

const inspection = ref<AgentContextInspectionDto | null>(null);
const loading = ref(false);
const error = ref("");
const activeTab = ref<"composition" | "cache">("composition");
/** 用户显式选择的请求；null 表示跟随「最近一次」。 */
const selectedTraceId = ref<string | null>(null);

const grouped = computed(() => groupDiagnostics(inspection.value?.diagnostics ?? []));

const requestOptions = computed<SelectOption[]>(() => (inspection.value?.requests ?? [])
    .slice()
    .reverse()
    .map((request) => ({
        value: request.id,
        label: t("agent.contextInspector.requestOption", {id: request.id, time: formatTime(request.ts)}),
    })));

function formatTime(ts: string): string {
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? ts : date.toLocaleTimeString();
}

/** 拉取面板数据。traceId 为空时后端取最近一次 turn。 */
async function load(traceId?: string): Promise<void> {
    if (props.sessionId === null) {
        return;
    }
    loading.value = true;
    error.value = "";
    try {
        inspection.value = await $fetch<AgentContextInspectionDto>(
            `/api/agent/sessions/${String(props.sessionId)}/context-inspection`,
            traceId ? {query: {traceId}} : undefined,
        );
        selectedTraceId.value = inspection.value.selected?.traceId ?? null;
    } catch (cause) {
        // 面板自身的加载错误留在面板内，不打扰其他入口。
        error.value = resolveApiErrorMessage(cause, t("agent.contextInspector.loadFailed"));
    } finally {
        loading.value = false;
    }
}

watch(() => [props.modelValue, props.sessionId] as const, ([open]) => {
    if (open) {
        void load();
    }
}, {immediate: true});

function onSelectRequest(value: string): void {
    if (value && value !== selectedTraceId.value) {
        void load(value);
    }
}
</script>

<template>
    <DialogWindow
        :model-value="props.modelValue"
        title-align="left"
        :title="t('agent.contextInspector.title')"
        :width="900"
        teleport-target=".novel-ide-theme"
        max-height="calc(100vh - 96px)"
        body-class="overflow-y-auto px-4 py-3"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <!-- 工具行：Tab 切换 + 请求选择器 + 刷新 -->
        <div class="mb-3 flex flex-wrap items-center gap-2">
            <div class="inline-flex overflow-hidden rounded border border-[var(--border-color)]">
                <button
                    v-for="tab in (['composition', 'cache'] as const)"
                    :key="tab"
                    class="px-2.5 py-1 text-xs transition-colors"
                    :class="activeTab === tab
                        ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                    @click="activeTab = tab"
                >
                    {{ tab === "composition" ? t("agent.contextInspector.tabComposition") : t("agent.contextInspector.tabCache") }}
                </button>
            </div>
            <div v-if="requestOptions.length > 1" class="min-w-56">
                <FormSelect
                    :model-value="selectedTraceId ?? ''"
                    :options="requestOptions"
                    @update:model-value="onSelectRequest($event)"
                />
            </div>
            <button
                class="ml-auto inline-flex items-center gap-1 rounded border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
                :disabled="loading"
                @click="load(selectedTraceId ?? undefined)"
            >
                <span class="i-lucide-refresh-cw h-3 w-3"></span>
                <span>{{ t("agent.contextInspector.refresh") }}</span>
            </button>
        </div>

        <p v-if="error" class="rounded border border-[var(--status-danger)] px-2 py-1.5 text-xs text-[var(--status-danger)]">{{ error }}</p>

        <!-- 降级态：trace 关闭 / 尚无请求。都给明确说明而不是空白 -->
        <p v-else-if="inspection?.state === 'disabled'" class="text-xs text-[var(--text-secondary)]">
            {{ t("agent.contextInspector.disabled") }}
        </p>
        <p v-else-if="inspection?.state === 'empty'" class="text-xs text-[var(--text-secondary)]">
            {{ t("agent.contextInspector.empty") }}
        </p>

        <template v-else-if="inspection">
            <AgentContextComposition
                v-if="activeTab === 'composition' && inspection.selected"
                :selected="inspection.selected"
                :facts="inspection.facts"
                :diagnostics="grouped.composition"
            />
            <AgentContextCacheTimeline
                v-else-if="activeTab === 'cache'"
                :timeline="inspection.timeline"
                :facts="inspection.facts"
                :diagnostics="inspection.diagnostics"
                :provider="inspection.selected?.provider ?? ''"
            />
        </template>
    </DialogWindow>
</template>
