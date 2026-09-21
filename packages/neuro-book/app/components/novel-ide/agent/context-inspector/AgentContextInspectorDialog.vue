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
import {computed, ref, watch} from "vue";
import {Button, DialogWindow, SegmentedControl} from "@notnotype/nb-ui/components";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import AgentContextCacheTimeline from "nbook/app/components/novel-ide/agent/context-inspector/AgentContextCacheTimeline.vue";
import AgentContextComposition from "nbook/app/components/novel-ide/agent/context-inspector/AgentContextComposition.vue";
import {groupDiagnostics} from "nbook/app/components/novel-ide/agent/context-inspector/context-inspector-view-model";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {AgentContextInspectionDto} from "nbook/shared/dto/agent-context-inspection.dto";

const props = withDefaults(defineProps<{
    modelValue: boolean;
    /** 当前会话；为空时面板不取数。 */
    sessionId: number | null;
    /** 外部受控检查数据；如果提供则跳过内部 fetch。 */
    inspection?: AgentContextInspectionDto | null;
    loading?: boolean;
    error?: string;
    selectedTraceId?: string | null;
    teleportTarget?: string | boolean;
}>(), {
    inspection: undefined,
    loading: false,
    error: "",
    selectedTraceId: null,
    teleportTarget: ".novel-ide-theme",
});

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "select-trace", traceId: string): void;
    (e: "refresh"): void;
}>();

const {t} = useI18n();

const internalInspection = ref<AgentContextInspectionDto | null>(null);
const internalLoading = ref(false);
const internalError = ref("");
const internalSelectedTraceId = ref<string | null>(null);
const activeTab = ref<"composition" | "cache">("composition");

const isControlled = computed(() => props.inspection !== undefined);
const activeInspection = computed(() => isControlled.value ? props.inspection : internalInspection.value);
const activeLoading = computed(() => isControlled.value ? props.loading : internalLoading.value);
const activeError = computed(() => isControlled.value ? props.error : internalError.value);
const currentSelectedTraceId = computed(() => isControlled.value ? props.selectedTraceId : internalSelectedTraceId.value);

const grouped = computed(() => groupDiagnostics(activeInspection.value?.diagnostics ?? []));

const requestOptions = computed<SelectOption[]>(() => (activeInspection.value?.requests ?? [])
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

/** 拉取面板数据（仅在非受控模式下调用）。 */
async function load(traceId?: string): Promise<void> {
    if (isControlled.value) {
        if (traceId) {
            emit("select-trace", traceId);
        } else {
            emit("refresh");
        }
        return;
    }
    if (props.sessionId === null) {
        return;
    }
    internalLoading.value = true;
    internalError.value = "";
    try {
        internalInspection.value = await $fetch<AgentContextInspectionDto>(
            `/api/agent/sessions/${String(props.sessionId)}/context-inspection`,
            traceId ? {query: {traceId}} : undefined,
        );
        internalSelectedTraceId.value = internalInspection.value.selected?.traceId ?? null;
    } catch (cause) {
        internalError.value = resolveApiErrorMessage(cause, t("agent.contextInspector.loadFailed"));
    } finally {
        internalLoading.value = false;
    }
}

watch(() => [props.modelValue, props.sessionId] as const, ([open]) => {
    if (open && !isControlled.value) {
        void load();
    }
}, {immediate: true});

function onSelectRequest(value: string): void {
    if (value && value !== currentSelectedTraceId.value) {
        if (isControlled.value) {
            emit("select-trace", value);
        } else {
            void load(value);
        }
    }
}

function handleRefresh(): void {
    if (isControlled.value) {
        emit("refresh");
    } else {
        void load(currentSelectedTraceId.value ?? undefined);
    }
}
</script>

<template>
    <DialogWindow
        :model-value="props.modelValue"
        :title="t('agent.contextInspector.title')"
        :width="900"
        :teleport-target="props.teleportTarget"
        max-height="calc(100vh - 96px)"
        body-class="overflow-y-auto px-4 py-3"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <!-- 工具行：Tab 切换 + 请求选择器 + 刷新 -->
        <div class="mb-3 flex flex-wrap items-center gap-2">
            <SegmentedControl
                :model-value="activeTab"
                :options="[
                    { value: 'composition', label: t('agent.contextInspector.tabComposition') },
                    { value: 'cache', label: t('agent.contextInspector.tabCache') },
                ]"
                size="xs"
                @update:model-value="activeTab = ($event as 'composition' | 'cache')"
            />
            <div v-if="requestOptions.length > 1" class="min-w-56">
                <FormSelect
                    :model-value="currentSelectedTraceId ?? ''"
                    :options="requestOptions"
                    size="sm"
                    @update:model-value="onSelectRequest($event)"
                />
            </div>
            <Button
                size="sm"
                variant="subtle"
                class="ml-auto"
                :disabled="activeLoading"
                :loading="activeLoading"
                icon-class="i-lucide-refresh-cw"
                @click="handleRefresh"
            >
                {{ t("agent.contextInspector.refresh") }}
            </Button>
        </div>

        <p v-if="activeError" class="rounded border border-[var(--status-danger)] px-2 py-1.5 text-xs text-[var(--status-danger)]">{{ activeError }}</p>

        <!-- 降级态：trace 关闭 / 尚无请求。都给明确说明而不是空白 -->
        <p v-else-if="activeInspection?.state === 'disabled'" class="text-xs text-[var(--text-secondary)]">
            {{ t("agent.contextInspector.disabled") }}
        </p>
        <p v-else-if="activeInspection?.state === 'empty'" class="text-xs text-[var(--text-secondary)]">
            {{ t("agent.contextInspector.empty") }}
        </p>

        <template v-else-if="activeInspection">
            <AgentContextComposition
                v-if="activeTab === 'composition' && activeInspection.selected"
                :selected="activeInspection.selected"
                :facts="activeInspection.facts"
                :diagnostics="grouped.composition"
            />
            <AgentContextCacheTimeline
                v-else-if="activeTab === 'cache'"
                :timeline="activeInspection.timeline"
                :facts="activeInspection.facts"
                :diagnostics="activeInspection.diagnostics"
                :provider="activeInspection.selected?.provider ?? ''"
            />
        </template>
    </DialogWindow>
</template>
