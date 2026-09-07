<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {Button, type FormSelectOption} from "@notnotype/nb-ui/components";
import type {AgentProfileModelConfigDto} from "nbook/shared/dto/app-settings.dto";
import AgentProfileNavList from "./AgentProfileNavList.vue";
import type {AgentProfileNavItem} from "./AgentProfileNavList.types";
import AgentProfileDefaultsPanel from "./AgentProfileDefaultsPanel.vue";
import AgentProfileDetailPanel from "./AgentProfileDetailPanel.vue";
import {
    buildCompleteModelConfig,
    cloneModelDraft,
    countModelOverrides,
    mergeModelConfig,
    type AgentProfileModelDraft,
} from "./agent-profile-draft";
import {
    countProfileRuntimeOverrides,
    createProfileRuntimeSettingsDraft,
    resolveProfileRuntimeInheritance,
} from "./profile-runtime-settings";
import type {AgentProfileSettingsContext, AgentProfileSettingsPageDraft, AgentProfileSettingsViewEmits, AgentProfileSettingsViewProps} from "./AgentProfileSettingsView.types";

const props = withDefaults(defineProps<AgentProfileSettingsViewProps>(), {
    loading: false,
    saving: false,
    loadError: "",
    saveError: "",
    resettingHomeKey: "",
});
const emit = defineEmits<AgentProfileSettingsViewEmits>();

const {t} = useI18n();

// 本地状态：选中项（空串=默认设置页）、搜索、单列视图开关。
const activeNavKey = ref("");
const navSearch = ref("");
const mobileNavOpen = ref(false);

const busy = computed(() => props.loading || props.saving);

const sortedProfiles = computed(() => [...props.modelValue.profiles].sort((left, right) => left.profileKey.localeCompare(right.profileKey)));

const activeProfile = computed(() => sortedProfiles.value.find((profile) => profile.profileKey === activeNavKey.value) ?? null);

// 选中 Profile 被移除时回到默认设置页。
watch(() => props.modelValue.profiles, (profiles) => {
    if (activeNavKey.value && !profiles.some((profile) => profile.profileKey === activeNavKey.value)) {
        activeNavKey.value = "";
    }
});

function selectNavKey(key: string): void {
    activeNavKey.value = key;
    mobileNavOpen.value = false;
}

const navItems = computed<AgentProfileNavItem[]>(() => sortedProfiles.value.map((profile) => ({
    profileKey: profile.profileKey,
    name: profile.name,
    status: profile.loadStatus,
    overrideCount: countModelOverrides(profile.model) + countProfileRuntimeOverrides(profile.runtime) + countSettingsOverrides(profile),
    dirty: isProfileDirty(profile.profileKey),
    isDefault: profile.profileKey === effectiveDefaultProfileKey.value,
})));

const defaultsDirty = computed(() => isDefaultsDirty());

const scopeLabel = computed(() => props.context.scope === "project"
    ? t("settings.panels.profileModels.settingsView.scopeProject", {target: props.context.targetLabel})
    : t("settings.panels.profileModels.settingsView.scopeGlobal"));

// Reka Select 的空串 value 是清空语义，继承哨兵必须用非空 __inherit__。
const defaultProfileInheritSentinel = "__inherit__";

const defaultProfileOptions = computed<FormSelectOption[]>(() => {
    const options = sortedProfiles.value.map((profile) => ({
        value: profile.profileKey,
        label: profile.profileKey,
        description: profile.name,
    }));
    return [
        {
            value: defaultProfileInheritSentinel,
            label: t("settings.panels.defaultProfile.followDefault", {profile: props.context.inheritedDefaultProfileKey}),
            description: t("settings.panels.defaultProfile.followDefaultDescription"),
        },
        ...options,
    ];
});

const effectiveDefaultProfileKey = computed(() => props.modelValue.defaultProfileKey || props.context.inheritedDefaultProfileKey);

// ---------- 继承基线推导（沿用旧宿主语义） ----------

const resolvedModelDefaults = computed<AgentProfileModelConfigDto>(() => {
    if (props.context.scope === "project") {
        return mergeModelConfig(props.context.globalModelDefaults, props.modelValue.modelDefaults);
    }
    return buildCompleteModelConfig(props.modelValue.modelDefaults);
});

function resolveProfileInheritedModel(profile: AgentProfileDraftOf): AgentProfileModelConfigDto {
    if (props.context.scope === "project") {
        return mergeModelConfig(resolvedModelDefaults.value, cloneModelDraft(props.context.globalProfileModels[profile.profileKey]));
    }
    return resolvedModelDefaults.value;
}

type AgentProfileDraftOf = AgentProfileSettingsPageDraft["profiles"][number];

const runtimeDefaultsBaseline = computed(() => resolveProfileRuntimeInheritance(
    props.context.settings.harnessRuntimeDefaults,
    props.context.scope === "project"
        ? [{source: "globalDefault", patch: props.context.settings.globalRuntimeDefaultsPatch}]
        : [],
));

function resolveProfileRuntimeBaseline(profile: AgentProfileDraftOf) {
    const layers = [
        {source: "profileDefault" as const, patch: profile.runtimeEffective ? undefined : undefined},
    ];
    void layers;
    return runtimeDefaultsBaseline.value;
}

// ---------- 未保存比较 ----------

function isDefaultsDirty(): boolean {
    return JSON.stringify(defaultsDraftSnapshot()) !== JSON.stringify(baselineDefaultsSnapshot());
}

function defaultsDraftSnapshot() {
    return {
        defaultProfileKey: props.modelValue.defaultProfileKey,
        modelDefaults: props.modelValue.modelDefaults,
        runtimeDefaults: props.modelValue.runtimeDefaults,
    };
}

function baselineDefaultsSnapshot() {
    return {
        defaultProfileKey: props.baseline.defaultProfileKey,
        modelDefaults: props.baseline.modelDefaults,
        runtimeDefaults: props.baseline.runtimeDefaults,
    };
}

function isProfileDirty(profileKey: string): boolean {
    const draft = props.modelValue.profiles.find((profile) => profile.profileKey === profileKey);
    const base = props.baseline.profiles.find((profile) => profile.profileKey === profileKey);
    if (!draft) return false;
    if (!base) return true;
    return JSON.stringify(profileSnapshot(draft)) !== JSON.stringify(profileSnapshot(base));
}

function profileSnapshot(profile: AgentProfileDraftOf) {
    return {
        model: profile.model,
        runtime: profile.runtime,
        settings: profile.settings ? {
            values: profile.settings.values,
            overridePaths: profile.settings.overridePaths,
            resourceMutations: profile.settings.resourceMutations,
        } : null,
    };
}

function countSettingsOverrides(profile: AgentProfileDraftOf): number {
    if (!profile.settings) return 0;
    return profile.settings.overridePaths.length + profile.settings.resourceMutations.length;
}

// ---------- 草稿更新 ----------

function updatePage(patch: Partial<AgentProfileSettingsPageDraft>): void {
    emit("update:modelValue", {...props.modelValue, ...patch});
}


function updateProfile(profileKey: string, patch: Partial<AgentProfileDraftOf>): void {
    updatePage({
        profiles: props.modelValue.profiles.map((profile) => profile.profileKey === profileKey ? {...profile, ...patch} : profile),
    });
}

function updateModelDefaults(value: AgentProfileModelDraft): void {
    updatePage({modelDefaults: value});
}

function updateRuntimeDefaults(value: AgentProfileSettingsPageDraft["runtimeDefaults"]): void {
    updatePage({runtimeDefaults: value});
}

function updateDefaultProfileKey(value: string): void {
    updatePage({defaultProfileKey: value === defaultProfileInheritSentinel ? "" : value});
}

// ---------- 校验与保存 ----------

const modelValidation = computed(() => {
    const issues: {scope: "defaults" | "profile"; profileKey?: string; field: "temperature" | "topK"; message: string}[] = [];
    const check = (model: AgentProfileModelDraft, scope: "defaults" | "profile", profileKey?: string): void => {
        const temperature = model.temperature.trim();
        if (temperature && (!Number.isFinite(Number(temperature)) || Number(temperature) < 0)) {
            issues.push({scope, profileKey, field: "temperature", message: t("settings.panels.profileModels.settingsView.temperatureInvalid")});
        }
        const topK = model.topK.trim();
        if (topK && (!Number.isInteger(Number(topK)) || Number(topK) <= 0)) {
            issues.push({scope, profileKey, field: "topK", message: t("settings.panels.profileModels.settingsView.topkInvalid")});
        }
    };
    check(props.modelValue.modelDefaults, "defaults");
    for (const profile of props.modelValue.profiles) {
        check(profile.model, "profile", profile.profileKey);
    }
    return issues;
});

const validationBlocking = computed(() => modelValidation.value.length > 0);

const canSave = computed(() => !busy.value && !validationBlocking.value && (defaultsDirty.value || navItems.value.some((item) => item.dirty)));

function save(): void {
    if (!canSave.value) return;
    emit("save", props.modelValue);
}

const discardDialogOpen = ref(false);

function requestDiscard(): void {
    if (!busy.value) discardDialogOpen.value = true;
}

function confirmDiscard(): void {
    discardDialogOpen.value = false;
    // baseline 经 props 传入后是 Vue reactive 代理，structuredClone 无法克隆代理，用 JSON 深拷贝。
    emit("update:modelValue", JSON.parse(JSON.stringify(props.baseline)));
}

function resetActiveDefaults(): void {
    const profile = activeProfile.value;
    if (!profile || busy.value) return;
    updateProfile(profile.profileKey, {
        model: cloneModelDraft(undefined),
        runtime: createProfileRuntimeSettingsDraft(undefined),
    });
}

function confirmResetHome(): void {
    const profile = activeProfile.value;
    if (profile) emit("reset-home", profile.profileKey);
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col" data-lab-subject>
        <!-- 标题区：作用域与目标 -->
        <header class="flex shrink-0 flex-wrap items-center justify-between gap-2 px-[var(--space-4)] pb-[var(--space-3)] pt-[var(--space-4)]">
            <div class="min-w-0">
                <h3 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] text-[var(--text-main)]">{{ t("settings.panels.profileModels.settingsView.title") }}</h3>
                <p class="mt-0.5 text-xs text-[var(--text-secondary)]">{{ scopeLabel }}</p>
            </div>
            <div class="flex items-center gap-2">
                <Button size="sm" variant="ghost" :disabled="busy" @click="requestDiscard">{{ t("settings.panels.profileModels.settingsView.discard") }}</Button>
                <Button size="sm" :disabled="!canSave" @click="save">{{ t("settings.panels.profileModels.settingsView.saveChanges") }}</Button>
            </div>
        </header>

        <p v-if="props.saveError" class="mx-[var(--space-4)] mb-2 shrink-0 rounded-[var(--radius-control)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger)]">{{ t("settings.panels.profileModels.settingsView.saveErrorPrefix") + props.saveError }}</p>
        <p v-if="!props.saveError && props.saving" class="mx-[var(--space-4)] mb-2 shrink-0 rounded-[var(--radius-control)] border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2 text-xs text-[var(--status-info)]">{{ t("settings.panels.profileModels.settingsView.saveHintPreview") }}</p>

        <div class="flex min-h-0 flex-1 gap-[var(--space-4)] px-[var(--space-4)] pb-[var(--space-4)]">
            <!-- 桌面：双栏导航 -->
            <aside class="hidden w-[260px] shrink-0 lg:block">
                <AgentProfileNavList
                    class="h-full"
                    :items="navItems"
                    :active-key="activeNavKey"
                    :search="navSearch"
                    :defaults-dirty="defaultsDirty"
                    @update:active-key="selectNavKey"
                    @update:search="navSearch = $event"
                />
            </aside>

            <!-- 详情 -->
            <section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--panel-outline)] bg-[var(--panel-surface)]">
                <div class="min-h-0 flex-1 overflow-y-auto p-[var(--space-4)]">
                    <div v-if="props.loading" class="space-y-3" aria-busy="true">
                        <div class="h-6 w-40 animate-pulse rounded bg-[var(--bg-input)]"></div>
                        <div class="h-24 animate-pulse rounded bg-[var(--bg-input)]"></div>
                        <div class="h-40 animate-pulse rounded bg-[var(--bg-input)]"></div>
                    </div>
                    <div v-else-if="props.loadError" class="rounded-[var(--radius-control)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-4 py-3 text-sm text-[var(--status-danger)]">
                        <p>{{ props.loadError }}</p>
                        <Button class="mt-2" size="sm" variant="ghost" @click="emit('reload')">{{ t("settings.panels.profileModels.settingsView.reload") }}</Button>
                    </div>
                    <template v-else-if="activeProfile">
                        <AgentProfileDetailPanel
                            :profile="activeProfile"
                            :inherited-model="resolveProfileInheritedModel(activeProfile)"
                            :enabled-models="props.context.settings.enabledModels"
                            :validation-issues="props.context.settings.validationIssues"
                            :scope="props.context.scope"
                            :runtime-baseline="resolveProfileRuntimeBaseline(activeProfile)"
                            :descriptions="props.context.descriptions"
                            :disabled="busy"
                            :is-default-profile="activeProfile.profileKey === effectiveDefaultProfileKey"
                            :reset-home-disabled="busy || props.resettingHomeKey !== ''"
                            :resetting-home="props.resettingHomeKey === activeProfile.profileKey"
                            @update:model="updateProfile(activeProfile.profileKey, {model: $event})"
                            @update:runtime="updateProfile(activeProfile.profileKey, {runtime: $event})"
                            @update:settings-values="updateProfile(activeProfile.profileKey, {settings: {...activeProfile.settings!, values: $event}})"
                            @update:settings-override-paths="updateProfile(activeProfile.profileKey, {settings: {...activeProfile.settings!, overridePaths: $event}})"
                            @update:settings-resource-mutations="updateProfile(activeProfile.profileKey, {settings: {...activeProfile.settings!, resourceMutations: $event}})"
                            @reset="resetActiveDefaults"
                            @reset-home="confirmResetHome"
                        />
                    </template>
                    <AgentProfileDefaultsPanel
                        v-else
                        :scope="props.context.scope"
                        :default-profile-key="props.modelValue.defaultProfileKey || defaultProfileInheritSentinel"
                        :default-profile-options="defaultProfileOptions"
                        :effective-default-profile-key="effectiveDefaultProfileKey"
                        :model-defaults="props.modelValue.modelDefaults"
                        :global-model-defaults="props.context.globalModelDefaults"
                        :enabled-models="props.context.settings.enabledModels"
                        :validation-issues="props.context.settings.validationIssues"
                        :runtime-defaults="props.modelValue.runtimeDefaults"
                        :runtime-effective="runtimeDefaultsBaseline.settings"
                        :runtime-sources="runtimeDefaultsBaseline.sources"
                        :runtime-errors="{}"
                        :disabled="busy"
                        @update:default-profile-key="updateDefaultProfileKey"
                        @update:model-defaults="updateModelDefaults"
                        @update:runtime-defaults="updateRuntimeDefaults"
                    />
                </div>
            </section>
        </div>
    </div>
</template>
