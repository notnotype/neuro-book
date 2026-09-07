<script setup lang="ts">
import {Badge, Button, Collapsible, FormField, FormInput, FormSelect, Tooltip} from "@notnotype/nb-ui/components";
import type {AgentProfileModelConfigDto, EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import type {LowCodeJsonObject, LowCodeResourceMutationDto} from "nbook/shared/dto/low-code-form.dto";
import {countModelOverrides, parseStreamSelectValue, streamSelectValue, type AgentProfileDraft, type AgentProfileModelDraft} from "./agent-profile-draft";
import {countProfileRuntimeOverrides, type ProfileRuntimeSettingsDraft, type ProfileRuntimeSettingsSources} from "./profile-runtime-settings";
import LowCodeForm from "nbook/app/components/common/low-code-form/LowCodeForm.vue";
import AgentProfileModelFields from "./AgentProfileModelFields.vue";
import ProfileRuntimeSettingsFields from "./ProfileRuntimeSettingsFields.vue";

const props = withDefaults(defineProps<{
    profile: AgentProfileDraft;
    /** 该 profile 的模型继承基线，用于生成"默认（xxx）"提示 */
    inheritedModel: AgentProfileModelConfigDto;
    enabledModels: EnabledModelOptionDto[];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
    scope: "global" | "project";
    /** 运行策略继承基线（settings + sources） */
    runtimeBaseline: {settings: ConfigAgentProfileSettingsDto["agentProfiles"][number]["runtime"]["effective"]; sources: Record<string, string>} | null;
    /** Profile 用途文案表 */
    descriptions: Record<string, string>;
    /** 禁用编辑（保存中/加载中/维护动作中） */
    disabled?: boolean;
    isDefaultProfile: boolean;
    resetHomeDisabled: boolean;
    resettingHome: boolean;
}>(), {
    disabled: false,
});

const emit = defineEmits<{
    (event: "update:model", value: AgentProfileModelDraft): void;
    (event: "update:runtime", value: ProfileRuntimeSettingsDraft): void;
    (event: "update:settingsValues", value: LowCodeJsonObject): void;
    (event: "update:settingsOverridePaths", value: string[]): void;
    (event: "update:settingsResourceMutations", value: LowCodeResourceMutationDto[]): void;
    (event: "reset"): void;
    (event: "reset-home"): void;
}>();

const {t} = useI18n();

const isProjectScope = computed(() => props.scope === "project");

const description = computed(() => props.descriptions[props.profile.profileKey] ?? "");

/** 只有编译成功且声明了表单的 profile 才能编辑自定义设置。 */
const canEditSettings = computed(() => props.profile.loadStatus === "loaded" && Boolean(props.profile.settings));

const hasPresetsSection = computed(() => props.profile.settings !== null || props.profile.loadStatus !== "loaded");

/** 编译状态视觉：成功 success，编译中 info，其余 5 种失败态统一 danger。 */
const statusTone = computed(() => {
    if (props.profile.loadStatus === "loaded") return "success" as const;
    if (props.profile.loadStatus === "compiling") return "accent" as const;
    return "danger" as const;
});
const runtimeOverrideCount = computed(() => countProfileRuntimeOverrides(props.profile.runtime));
const settingsOverrideCount = computed(() => props.profile.settings ? props.profile.settings.overridePaths.length + props.profile.settings.resourceMutations.length : 0);
const modelOverrideCount = computed(() => countModelOverrides(props.profile.model));

const advancedExpanded = ref(modelOverrideCount.value > 0);
const runtimeExpanded = ref(runtimeOverrideCount.value > 0);
const settingsExpanded = ref(true);

function streamOptionsLocal(): {value: string; label: string}[] {
    return [
        {value: "inherit", label: t("settings.panels.profileModels.defaultValue", {value: props.inheritedModel.stream ?? true ? t("settings.panels.profileModels.enabled") : t("settings.panels.profileModels.disabled")})},
        {value: "true", label: t("settings.panels.profileModels.enabled")},
        {value: "false", label: t("settings.panels.profileModels.disabled")},
    ];
}

/** 编译队列提示；无进行中的构建时为空串。 */
const buildHint = computed(() => {
    if (props.profile.buildState.running) {
        return t("settings.panels.profileModels.buildRunning");
    }
    if (props.profile.buildState.queued) {
        return t("settings.panels.profileModels.buildQueued");
    }
    return "";
});

const runtimeEffective = computed(() => props.runtimeBaseline?.settings ?? null);
const runtimeSources = computed(() => props.runtimeBaseline?.sources ?? null);


</script>

<template>
    <section class="space-y-4">
        <!-- Profile 头部：身份、用途、编译状态 -->
        <div>
            <div class="flex flex-wrap items-center gap-2">
                <h4 class="text-base font-semibold text-[var(--text-main)]" tabindex="-1">{{ props.profile.name }}</h4>
                <Badge :tone="statusTone">{{ t(`settings.panels.profileModels.status.${props.profile.loadStatus}`) }}</Badge>
                <Badge v-if="props.isDefaultProfile" tone="accent">
                    <span class="i-lucide-star h-2.5 w-2.5" aria-hidden="true"></span>
                    {{ t("settings.panels.profileModels.currentDefault") }}
                </Badge>
            </div>
            <p v-if="description" class="mt-1 text-xs text-[var(--text-secondary)]">{{ description }}</p>
            <div class="mt-1 font-mono text-[11px] text-[var(--text-muted)]">{{ props.profile.profileKey }}</div>
            <div v-if="props.profile.sourcePath" class="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">{{ t("settings.panels.profileModels.sourcePath") }}: {{ props.profile.sourcePath }}</div>
        </div>

        <!-- 编译中提示 -->
        <div v-if="buildHint" class="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2 text-[11px] text-[var(--status-info)]">
            <span class="i-lucide-loader-2 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true"></span>
            <span>{{ buildHint }}</span>
        </div>

        <!-- 加载失败原因：头部常驻可读，不只藏在诊断区 -->
        <div v-if="props.profile.issue" class="flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">
            <span class="i-lucide-alert-circle mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
            <div class="min-w-0">
                <div>{{ props.profile.issue.message }}</div>
                <div class="mt-0.5 font-mono text-[10px] opacity-80">{{ props.profile.issue.code }}</div>
            </div>
        </div>

        <!-- 使用模型：常驻 -->
        <div>
            <h5 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-main)]">
                <span class="i-lucide-cpu h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true"></span>
                {{ t("settings.panels.profileModels.settingsView.useModel") }}
            </h5>
            <AgentProfileModelFields
                :model-value="props.profile.model"
                :inherited="props.inheritedModel"
                :enabled-models="props.enabledModels"
                :validation-issues="props.validationIssues"
                inherit-mode="profile"
                :disabled="props.disabled"
                @update:model-value="emit('update:model', $event)"
            />
        </div>

        <!-- 专属设置：LowCodeForm -->
        <div v-if="hasPresetsSection">
            <Collapsible :default-open="settingsExpanded" :disabled="props.disabled">
                <template #trigger>
                    <button type="button" class="flex w-full items-center gap-2 rounded-[var(--radius-control)] py-1 text-left" :aria-expanded="settingsExpanded">
                        <span class="i-lucide-sliders-horizontal h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.settingsView.profilePresets") }}</span>
                        <Badge v-if="settingsOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: settingsOverrideCount}) }}</Badge>
                    </button>
                </template>
                <div class="mt-2">
                    <p v-if="canEditSettings && props.profile.settings" class="mb-3 text-[11px] text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.profilePresetsDescription") }}</p>
                    <LowCodeForm
                        v-if="canEditSettings && props.profile.settings"
                        :model-value="props.profile.settings.values"
                        :override-paths="props.profile.settings.overridePaths"
                        :resource-mutations="props.profile.settings.resourceMutations"
                        :form="props.profile.settings.form"
                        :issues="props.profile.settings.issues"
                        :scope="isProjectScope ? 'project' : 'global'"
                        :inheritance-mode="isProjectScope ? 'manual' : 'always-override'"
                        :inherited-value="props.profile.settings.inheritedValue"
                        :disabled="props.disabled"
                        @update:model-value="emit('update:settingsValues', $event)"
                        @update:override-paths="emit('update:settingsOverridePaths', $event)"
                        @update:resource-mutations="emit('update:settingsResourceMutations', $event)"
                    />
                    <p v-else-if="props.profile.loadStatus !== 'loaded'" class="text-xs text-[var(--text-muted)]">{{ t("settings.panels.profileModels.settingsView.presetsUnavailable") }}</p>
                    <p v-else class="text-xs text-[var(--text-muted)]">{{ t("settings.panels.profileModels.settingsView.noPresets") }}</p>
                </div>
            </Collapsible>
        </div>

        <!-- 高级模型参数：温度 / TopK / 流式 -->
        <div class="border-t border-[var(--divider)] pt-3">
            <Collapsible :default-open="advancedExpanded" :disabled="props.disabled">
                <template #trigger>
                    <button type="button" class="flex w-full items-center gap-2 rounded-[var(--radius-control)] py-1 text-left" :aria-expanded="advancedExpanded">
                        <span class="i-lucide-settings-2 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.settingsView.advancedModel") }}</span>
                        <Badge v-if="modelOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: modelOverrideCount}) }}</Badge>
                    </button>
                </template>
                <div class="mt-2 grid gap-3 md:grid-cols-2">
                    <FormField :label="t('settings.panels.profileModels.temperature')">
                        <FormInput :model-value="props.profile.model.temperature" type="number" step="0.1" min="0" :placeholder="t('settings.panels.profileModels.defaultPlaceholder')" :disabled="props.disabled" @update:model-value="emit('update:model', {...props.profile.model, temperature: $event})" />
                    </FormField>
                    <FormField label="TopK">
                        <FormInput :model-value="props.profile.model.topK" type="number" step="1" min="1" :placeholder="t('settings.panels.profileModels.defaultPlaceholder')" :disabled="props.disabled" @update:model-value="emit('update:model', {...props.profile.model, topK: $event})" />
                    </FormField>
                    <FormField :label="t('settings.panels.profileModels.stream')">
                        <FormSelect :model-value="streamSelectValue(props.profile.model.stream)" :options="streamOptionsLocal()" :disabled="props.disabled" @update:model-value="emit('update:model', {...props.profile.model, stream: parseStreamSelectValue($event)})" />
                    </FormField>
                </div>
            </Collapsible>
        </div>

        <!-- 运行策略覆盖 -->
        <div class="border-t border-[var(--divider)] pt-3">
            <Collapsible :default-open="runtimeExpanded" :disabled="props.disabled">
                <template #trigger>
                    <button type="button" class="flex w-full items-center gap-2 rounded-[var(--radius-control)] py-1 text-left" :aria-expanded="runtimeExpanded">
                        <span class="i-lucide-timer h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.runtime.profileOverrideTitle") }}</span>
                        <Badge v-if="runtimeOverrideCount > 0" tone="neutral">{{ t("settings.panels.profileModels.overrideCount", {count: runtimeOverrideCount}) }}</Badge>
                    </button>
                </template>
                <div v-if="runtimeEffective && runtimeSources" class="mt-2">
                    <ProfileRuntimeSettingsFields
                        :model-value="props.profile.runtime"
                        :inherited="runtimeEffective"
                        :sources="runtimeSources as ProfileRuntimeSettingsSources"
                        :disabled="props.disabled"
                        @update:model-value="emit('update:runtime', $event)"
                    />
                </div>
                <p v-else class="mt-2 text-xs text-[var(--text-muted)]">{{ t("settings.panels.profileModels.settingsView.presetsUnavailable") }}</p>
            </Collapsible>
        </div>

        <!-- 诊断与维护 -->
        <div class="border-t border-[var(--divider)] pt-3">
            <h5 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-main)]">
                <span class="i-lucide-wrench h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true"></span>
                {{ t("settings.panels.profileModels.settingsView.diagnostics") }}
            </h5>
            <div class="flex flex-wrap items-center gap-2">
                <Tooltip :text="t('settings.panels.profileModels.settingsView.resetDefaultsHint')" placement="top">
                    <Button size="sm" variant="ghost" :disabled="props.disabled" @click="emit('reset')">
                        <span class="i-lucide-rotate-ccw h-3 w-3" aria-hidden="true"></span>
                        {{ t("settings.panels.profileModels.settingsView.resetProfileDefaults") }}
                    </Button>
                </Tooltip>
                <Button v-if="isProjectScope && props.profile.canResetHome" size="sm" variant="ghost" :disabled="props.resetHomeDisabled" @click="emit('reset-home')">
                    <span :class="props.resettingHome ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-rotate-ccw'" class="h-3 w-3" aria-hidden="true"></span>
                    {{ t("settings.panels.profileModels.resetHome") }}
                </Button>
            </div>
            <p v-if="props.profile.buildState.reason" class="mt-2 text-[11px] text-[var(--text-muted)]"><span class="font-medium">{{ t("settings.panels.profileModels.settingsView.buildStateReason") }}:</span> {{ props.profile.buildState.reason }}</p>
        </div>
    </section>
</template>
