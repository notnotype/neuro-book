<script setup lang="ts">
import type {AgentProfileModelConfigDto} from "nbook/shared/dto/app-settings.dto";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import type {AgentProfileModelDraft} from "nbook/app/components/novel-ide/settings/agent-profile-draft";
import type {ProfileRuntimeSettingsDraft, ProfileRuntimeSettingsErrors, ProfileRuntimeSettingsSources} from "nbook/app/components/novel-ide/settings/profile-runtime-settings";
import AgentProfileModelFields from "nbook/app/components/novel-ide/settings/AgentProfileModelFields.vue";
import ProfileRuntimeSettingsFields from "nbook/app/components/novel-ide/settings/ProfileRuntimeSettingsFields.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";

const props = defineProps<{
    scope: "global" | "project";
    /** 空串表示跟随上层默认 Profile */
    defaultProfileKey: string;
    defaultProfileOptions: SelectOption[];
    effectiveDefaultProfileKey: string;
    modelDefaults: AgentProfileModelDraft;
    /** Global 层默认模型参数，作为 Project 默认参数的继承基线 */
    globalModelDefaults: AgentProfileModelConfigDto;
    enabledModels: ConfigAgentProfileSettingsDto["enabledModels"];
    validationIssues: ConfigAgentProfileSettingsDto["validationIssues"];
    runtimeDefaults: ProfileRuntimeSettingsDraft;
    /** 运行策略继承基线；为空表示设定尚未加载完成 */
    runtimeEffective: ConfigAgentProfileSettingsDto["profileRuntimeDefaults"] | null;
    runtimeSources: ProfileRuntimeSettingsSources | null;
    runtimeErrors: ProfileRuntimeSettingsErrors;
}>();

const emit = defineEmits<{
    (event: "update:defaultProfileKey", value: string): void;
    (event: "update:modelDefaults", value: AgentProfileModelDraft): void;
    (event: "update:runtimeDefaults", value: ProfileRuntimeSettingsDraft): void;
    (event: "reset"): void;
}>();

const {t} = useI18n();

const isProjectScope = computed(() => props.scope === "project");
</script>

<template>
    <div class="space-y-4 pb-8">
        <!-- 默认设置页：默认 Profile 选择 + 所有 Profile 共享的参数基线。 -->
        <!-- 注意：注释一律写在根元素内部。写在根元素外面会让 dev 编译出 Fragment 根，父级 <Transition mode="out-in"> 的离场钩子传不进来，切换后永久空白。 -->
        <!-- 默认 Agent Profile -->
        <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
            <div class="mb-4 border-b border-[var(--border-color)] pb-4">
                <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.defaultProfile.title") }}</h4>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.defaultProfile.projectDescription") : t("settings.panels.defaultProfile.globalDescription") }}</p>
            </div>

            <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
                <div class="space-y-1.5">
                    <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.defaultProfile.title") }}</label>
                    <FormSelect :model-value="props.defaultProfileKey" :options="props.defaultProfileOptions" :placeholder="t('settings.panels.defaultProfile.selectPlaceholder')" @update:model-value="emit('update:defaultProfileKey', $event)" />
                </div>
                <div class="space-y-1.5">
                    <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.defaultProfile.currentEffective") }}</label>
                    <div class="flex h-7 w-full items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/30 px-2.5 text-[12px] select-all">
                        <span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--status-success)]"></span>
                        <span class="truncate font-mono text-[11px] font-semibold text-[var(--text-main)]">{{ props.effectiveDefaultProfileKey || "-" }}</span>
                    </div>
                </div>
            </div>
        </section>

        <!-- 默认模型参数 -->
        <section class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-color)] pb-4">
                <div>
                    <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.defaultParameters") }}</h4>
                    <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.profileModels.projectDefaultDescription") : t("settings.panels.profileModels.globalDefaultDescription") }}</p>
                </div>
                <button class="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" @click="emit('reset')">
                    <span class="i-lucide-rotate-ccw h-3 w-3"></span>
                    {{ t("settings.panels.profileModels.resetDefault") }}
                </button>
            </div>

            <AgentProfileModelFields
                :model-value="props.modelDefaults"
                :inherited="props.globalModelDefaults"
                :enabled-models="props.enabledModels"
                :validation-issues="props.validationIssues"
                :inherit-mode="isProjectScope ? 'projectDefaults' : 'globalDefaults'"
                @update:model-value="emit('update:modelDefaults', $event)"
            />
        </section>

        <!-- 通用运行默认值 -->
        <section v-if="props.runtimeEffective && props.runtimeSources" class="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-sm">
            <div class="mb-4 border-b border-[var(--border-color)] pb-4">
                <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.profileModels.runtime.defaultsTitle") }}</h4>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.profileModels.runtime.projectDefaultsDescription") : t("settings.panels.profileModels.runtime.globalDefaultsDescription") }}</p>
            </div>
            <ProfileRuntimeSettingsFields
                :model-value="props.runtimeDefaults"
                :inherited="props.runtimeEffective"
                :sources="props.runtimeSources"
                :errors="props.runtimeErrors"
                @update:model-value="emit('update:runtimeDefaults', $event)"
            />
        </section>
    </div>
</template>
