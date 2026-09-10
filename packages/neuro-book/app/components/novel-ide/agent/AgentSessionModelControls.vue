<script setup lang="ts">
import {onClickOutside} from "@vueuse/core";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/sections/model/NovelIdeModelSelect.vue";
import type {AgentSessionModelDraft} from "nbook/app/components/novel-ide/agent/agent-session-model-controls";
import type {EnabledModelOptionDto, ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";

const props = withDefaults(defineProps<{
    sessionModelSelectionValue: string | null;
    sessionThinkingResolvedLabel: string;
    sessionModelDraft: AgentSessionModelDraft;
    selectableModels: EnabledModelOptionDto[];
    sessionModelSaving: boolean;
    sessionModelPopoverOpen: boolean;
    readonly?: boolean;
    running?: boolean;
    loadingSession?: boolean;
    dropdownDirection?: "auto" | "down" | "up";
    rootClass?: string;
    popoverClass?: string;
}>(), {
    readonly: false,
    running: false,
    loadingSession: false,
    dropdownDirection: "up",
    rootClass: "w-[320px]",
    popoverClass: "w-[360px]",
});

const emit = defineEmits<{
    (e: "update:sessionModelPopoverOpen", value: boolean): void;
    (e: "update:sessionModelDraft", value: AgentSessionModelDraft): void;
    (e: "update-session-model-selection", value: string | null): void;
    (e: "toggle-session-model-popover"): void;
    (e: "apply-session-model-settings"): void;
    (e: "reset-session-model-settings"): void;
}>();

const controlsRef = ref<HTMLElement | null>(null);
const {t} = useI18n();

const thinkingLevelOptions = computed<Array<{value: ThinkingLevelDto | null; label: string}>>(() => [
    {value: null, label: t("agent.composer.followProfile")},
    {value: "off", label: t("agent.composer.off")},
    {value: "minimal", label: t("agent.composer.minimal")},
    {value: "low", label: t("agent.composer.low")},
    {value: "medium", label: t("agent.composer.medium")},
    {value: "high", label: t("agent.composer.high")},
    {value: "xhigh", label: t("agent.composer.xhigh")},
    {value: "max", label: t("agent.composer.max")},
]);

const actionDisabled = computed(() => props.readonly || props.running || props.loadingSession || props.sessionModelSaving);

onClickOutside(controlsRef, () => {
    emit("update:sessionModelPopoverOpen", false);
});

/**
 * 更新当前 session 模型参数草稿。
 */
function updateSessionModelDraft(patch: Partial<AgentSessionModelDraft>): void {
    emit("update:sessionModelDraft", {
        ...props.sessionModelDraft,
        ...patch,
    });
}
</script>

<template>
    <!-- Agent Session 模型选择与参数面板 -->
    <div ref="controlsRef" class="relative flex min-w-0 items-center gap-1.5" :class="props.rootClass">
        <div class="min-w-0 flex-1">
            <NovelIdeModelSelect
                :model-value="props.sessionModelSelectionValue"
                :models="props.selectableModels"
                :placeholder="t('agent.composer.selectSessionModel')"
                :disabled="actionDisabled"
                :dropdown-direction="props.dropdownDirection"
                @update:model-value="emit('update-session-model-selection', $event)"
            />
        </div>
        <button
            class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="actionDisabled"
            :title="t('agent.composer.sessionModelParams')"
            @click="emit('toggle-session-model-popover')"
        >
            <span class="i-lucide-sliders-horizontal h-3.5 w-3.5"></span>
        </button>

        <div v-if="props.sessionModelPopoverOpen" class="absolute bottom-full left-0 z-40 mb-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-3 shadow-2xl" :class="props.popoverClass">
            <div class="mb-3 flex items-center justify-between gap-3">
                <div>
                    <div class="text-sm font-medium text-[var(--text-main)]">{{ t("agent.composer.sessionModelParams") }}</div>
                    <div class="mt-1 text-[11px] text-[var(--text-muted)]">{{ t("agent.composer.sessionModelDescription") }}</div>
                </div>
                <button class="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('update:sessionModelPopoverOpen', false)">
                    <span class="i-lucide-x h-3.5 w-3.5"></span>
                </button>
            </div>

            <div class="space-y-3">
                <div class="space-y-1.5">
                    <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("agent.composer.model") }}</label>
                    <NovelIdeModelSelect
                        :model-value="props.sessionModelDraft.modelKey"
                        :models="props.selectableModels"
                        :placeholder="t('agent.composer.selectSessionModel')"
                        :disabled="actionDisabled"
                        :dropdown-direction="props.dropdownDirection"
                        @update:model-value="updateSessionModelDraft({modelKey: $event})"
                    />
                </div>
                <div class="space-y-1.5">
                    <div class="flex items-center justify-between gap-2">
                        <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("agent.composer.thinkingEffort") }}</label>
                        <span class="truncate text-[10px] text-[var(--text-muted)]">{{ t("agent.composer.current", {value: props.sessionThinkingResolvedLabel}) }}</span>
                    </div>
                    <select :value="props.sessionModelDraft.reasoningEffort ?? ''" class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 text-[12px] text-[var(--text-main)] outline-none transition-colors focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20 disabled:cursor-not-allowed disabled:opacity-50" :disabled="actionDisabled" @change="updateSessionModelDraft({reasoningEffort: (($event.target as HTMLSelectElement).value || null) as AgentSessionModelDraft['reasoningEffort']})">
                        <option v-for="option in thinkingLevelOptions" :key="option.label" :value="option.value ?? ''">{{ option.label }}</option>
                    </select>
                </div>
            </div>

            <div class="mt-4 flex items-center justify-between gap-2">
                <button class="inline-flex h-8 items-center justify-center rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="actionDisabled" @click="emit('reset-session-model-settings')">
                    {{ t("agent.composer.resetProfileDefault") }}
                </button>
                <button class="inline-flex h-8 items-center justify-center rounded-md bg-[var(--accent-main)] px-3 text-xs font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" :disabled="actionDisabled" @click="emit('apply-session-model-settings')">
                    <span v-if="props.sessionModelSaving" class="i-lucide-loader-2 mr-1.5 h-3.5 w-3.5 animate-spin"></span>
                    {{ t("agent.composer.applySession") }}
                </button>
            </div>
        </div>
    </div>
</template>
