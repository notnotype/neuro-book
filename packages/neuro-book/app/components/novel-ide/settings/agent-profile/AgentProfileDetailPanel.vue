<script setup lang="ts">
import type {AgentProfileModelConfigDto, EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import type {LowCodeJsonObject, LowCodeResourceMutationDto} from "nbook/shared/dto/low-code-form.dto";
import type {AgentProfileDraft, AgentProfileModelDraft} from "./agent-profile-draft";
import type {ProfileRuntimeSettingsDraft} from "./profile-runtime-settings";
import AgentProfileModelFields from "./AgentProfileModelFields.vue";
import ProfileRuntimeSettingsFields from "./ProfileRuntimeSettingsFields.vue";
import LowCodeForm from "nbook/app/components/common/low-code-form/LowCodeForm.vue";

const props = defineProps<{
    profile: AgentProfileDraft;
    /** 该 profile 的模型继承基线，用于生成"默认（xxx）"提示 */
    inheritedModel: AgentProfileModelConfigDto;
    enabledModels: EnabledModelOptionDto[];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
    scope: "global" | "project";
    /** 运行策略显式覆盖字段数，决定该段初始是否展开 */
    runtimeOverrideCount: number;
    /** Profile 设置显式覆盖字段数，决定该段初始是否展开 */
    settingsOverrideCount: number;
    /** 该 profile 正在重置 Home，用于按钮转圈 */
    resettingHome: boolean;
    /** 任意 profile 正在重置 Home 或面板正在保存；此时重置入口必须整体禁用，否则按钮看着能点却被 guard 静默拦掉 */
    resetHomeDisabled: boolean;
    isDefaultProfile: boolean;
}>();

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

/** 只有编译成功且声明了表单的 profile 才能编辑自定义设置。 */
const canEditSettings = computed(() => props.profile.loadStatus === "loaded" && Boolean(props.profile.settings));

/** 编译状态视觉：成功 success，编译中 info，其余 5 种失败态统一 danger。 */
const statusTone = computed(() => {
    if (props.profile.loadStatus === "loaded") {
        return "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]";
    }
    if (props.profile.loadStatus === "compiling") {
        return "border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]";
    }
    return "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]";
});

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

// 折叠状态：组件按 profileKey 重建，因此每次切换 profile 都会按覆盖数重新决定初始展开。
const modelExpanded = ref(true);
const runtimeExpanded = ref(props.runtimeOverrideCount > 0);
const settingsExpanded = ref(props.settingsOverrideCount > 0);
</script>

<template>
    <section class="space-y-4 pb-8">
        <!-- Profile 头部：身份、编译状态与整体操作 -->
        <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                        <h4 class="text-base font-semibold text-[var(--text-main)]">{{ props.profile.name }}</h4>
                        <span class="rounded-full border px-2 py-0.5 text-[10px] font-medium" :class="statusTone">{{ t(`settings.panels.profileModels.status.${props.profile.loadStatus}`) }}</span>
                        <span v-if="props.isDefaultProfile" class="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] bg-[var(--accent-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-text)]">
                            <span class="i-lucide-star h-2.5 w-2.5"></span>
                            {{ t("settings.panels.profileModels.currentDefault") }}
                        </span>
                    </div>
                    <div class="mt-1 font-mono text-[11px] text-[var(--text-muted)]">{{ props.profile.profileKey }}</div>
                    <div v-if="props.profile.sourcePath" class="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]" :title="props.profile.sourcePath">{{ t("settings.panels.profileModels.sourcePath") }}: {{ props.profile.sourcePath }}</div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                    <button v-if="isProjectScope && props.profile.canResetHome" class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 text-[11px] font-medium text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger-bg)] disabled:opacity-50" :disabled="props.resetHomeDisabled" @click="emit('reset-home')">
                        <span :class="props.resettingHome ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-rotate-ccw'" class="h-3 w-3"></span>
                        {{ t("settings.panels.profileModels.resetHome") }}
                    </button>
                    <button class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('reset')">
                        <span class="i-lucide-rotate-ccw h-3 w-3"></span>
                        {{ t("settings.panels.profileModels.resetDefault") }}
                    </button>
                </div>
            </div>

            <!-- 编译中提示 -->
            <div v-if="buildHint" class="mt-3 flex items-center gap-2 rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2 text-[11px] text-[var(--status-info)]">
                <span class="i-lucide-loader-2 h-3.5 w-3.5 shrink-0 animate-spin"></span>
                <span>{{ buildHint }}</span>
            </div>

            <!-- 加载失败原因 -->
            <div v-if="props.profile.issue" class="mt-3 flex items-start gap-2 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">
                <span class="i-lucide-alert-circle mt-0.5 h-3.5 w-3.5 shrink-0"></span>
                <div class="min-w-0">
                    <div>{{ props.profile.issue.message }}</div>
                    <div class="mt-0.5 font-mono text-[10px] opacity-80">{{ props.profile.issue.code }}</div>
                </div>
            </div>
        </div>

        <!-- 模型参数 -->
        <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
            <button type="button" class="flex w-full items-center gap-2 text-left" :aria-expanded="modelExpanded" @click="modelExpanded = !modelExpanded">
                <span class="i-lucide-cpu h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.modelSection") }}</span>
                <span class="h-4 w-4 shrink-0 text-[var(--text-muted)]" :class="modelExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"></span>
            </button>
            <div v-if="modelExpanded" class="mt-4">
                <AgentProfileModelFields
                    :model-value="props.profile.model"
                    :inherited="props.inheritedModel"
                    :enabled-models="props.enabledModels"
                    :validation-issues="props.validationIssues"
                    inherit-mode="profile"
                    @update:model-value="emit('update:model', $event)"
                />
            </div>
        </div>

        <!-- 运行策略覆盖 -->
        <div class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
            <button type="button" class="flex w-full items-center gap-2 text-left" :aria-expanded="runtimeExpanded" @click="runtimeExpanded = !runtimeExpanded">
                <span class="i-lucide-settings-2 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.runtime.profileOverrideTitle") }}</span>
                <span v-if="props.runtimeOverrideCount > 0" class="shrink-0 rounded-full bg-[var(--bg-input)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.overrideCount", {count: props.runtimeOverrideCount}) }}</span>
                <span class="h-4 w-4 shrink-0 text-[var(--text-muted)]" :class="runtimeExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"></span>
            </button>
            <div v-if="runtimeExpanded" class="mt-4">
                <ProfileRuntimeSettingsFields
                    :model-value="props.profile.runtime"
                    :inherited="props.profile.runtimeEffective"
                    :sources="props.profile.runtimeSources"
                    :errors="props.profile.runtimeErrors"
                    @update:model-value="emit('update:runtime', $event)"
                />
            </div>
        </div>

        <!-- Profile 自定义低代码设置 -->
        <div v-if="canEditSettings && props.profile.settings" class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
            <button type="button" class="flex w-full items-center gap-2 text-left" :aria-expanded="settingsExpanded" @click="settingsExpanded = !settingsExpanded">
                <span class="i-lucide-sliders-horizontal h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                <span class="min-w-0 flex-1 text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.profilePresets") }}</span>
                <span v-if="props.settingsOverrideCount > 0" class="shrink-0 rounded-full bg-[var(--bg-input)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.overrideCount", {count: props.settingsOverrideCount}) }}</span>
                <span class="h-4 w-4 shrink-0 text-[var(--text-muted)]" :class="settingsExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"></span>
            </button>
            <div v-if="settingsExpanded" class="mt-4">
                <p class="mb-3 text-[11px] text-[var(--text-secondary)]">{{ t("settings.panels.profileModels.profilePresetsDescription") }}</p>
                <LowCodeForm
                    :model-value="props.profile.settings.values"
                    :override-paths="props.profile.settings.overridePaths"
                    :resource-mutations="props.profile.settings.resourceMutations"
                    :form="props.profile.settings.form"
                    :issues="props.profile.settings.issues"
                    :scope="isProjectScope ? 'project' : 'global'"
                    :inheritance-mode="isProjectScope ? 'manual' : 'always-override'"
                    :inherited-value="props.profile.settings.inheritedValue"
                    @update:model-value="emit('update:settingsValues', $event)"
                    @update:override-paths="emit('update:settingsOverridePaths', $event)"
                    @update:resource-mutations="emit('update:settingsResourceMutations', $event)"
                />
            </div>
        </div>
    </section>
</template>
