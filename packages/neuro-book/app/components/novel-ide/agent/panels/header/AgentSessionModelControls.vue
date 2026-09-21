<script setup lang="ts">
import {Button, IconButton, FormSelect} from "@notnotype/nb-ui/components";
import {onClickOutside} from "@vueuse/core";
import NovelIdeModelSelect from "nbook/app/components/novel-ide/settings/sections/providers/components/NovelIdeModelSelect.vue";
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
    size?: "default" | "sm";
    dropdownDirection?: "auto" | "down" | "up";
    rootClass?: string;
    popoverClass?: string;
}>(), {
    readonly: false,
    running: false,
    loadingSession: false,
    size: "sm",
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

// 传 ignore：模型下拉的选项在 body 下的浮层里，点选项不该算「点到了面板外面」
onClickOutside(controlsRef, () => {
    emit("update:sessionModelPopoverOpen", false);
}, {ignore: [".nb-ui-popover-surface"]});

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
                :size="props.size"
                :dropdown-direction="props.dropdownDirection"
                @update:model-value="emit('update-session-model-selection', $event)"
            />
        </div>
        <IconButton
            size="sm"
            variant="secondary"
            :disabled="actionDisabled"
            :title="t('agent.composer.sessionModelParams')"
            :aria-label="t('agent.composer.sessionModelParams')"
            @click="emit('toggle-session-model-popover')"
        >
            <span class="i-lucide-sliders-horizontal h-3.5 w-3.5" />
        </IconButton>

        <div v-if="props.sessionModelPopoverOpen" class="nb-ui-popover-surface absolute bottom-full left-0 z-40 mb-2 rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-3.5 shadow-[var(--elevation-popover)]" :class="props.popoverClass">
            <div class="mb-3 flex items-center justify-between gap-3">
                <div>
                    <div class="text-sm font-medium text-[var(--text-main)]">{{ t("agent.composer.sessionModelParams") }}</div>
                    <div class="mt-1 text-[11px] text-[var(--text-muted)]">{{ t("agent.composer.sessionModelDescription") }}</div>
                </div>
                <IconButton
                    size="xs"
                    variant="default"
                    :title="t('common.close')"
                    :aria-label="t('common.close')"
                    @click="emit('update:sessionModelPopoverOpen', false)"
                >
                    <span class="i-lucide-x h-3.5 w-3.5" />
                </IconButton>
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
                    <FormSelect
                        :model-value="props.sessionModelDraft.reasoningEffort ?? ''"
                        :options="thinkingLevelOptions.map(opt => ({ label: opt.label, value: opt.value ?? '' }))"
                        size="sm"
                        :disabled="actionDisabled"
                        @update:model-value="updateSessionModelDraft({reasoningEffort: ($event || null) as AgentSessionModelDraft['reasoningEffort']})"
                    />
                </div>
            </div>

            <div class="mt-4 flex items-center justify-between gap-2">
                <Button
                    size="sm"
                    variant="secondary"
                    :disabled="actionDisabled"
                    @click="emit('reset-session-model-settings')"
                >
                    {{ t("agent.composer.resetProfileDefault") }}
                </Button>
                <Button
                    size="sm"
                    variant="primary"
                    :disabled="actionDisabled"
                    :loading="props.sessionModelSaving"
                    @click="emit('apply-session-model-settings')"
                >
                    {{ t("agent.composer.applySession") }}
                </Button>
            </div>
        </div>
    </div>
</template>
