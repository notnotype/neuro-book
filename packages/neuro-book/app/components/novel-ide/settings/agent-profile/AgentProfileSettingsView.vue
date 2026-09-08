<script setup lang="ts">
import {computed, nextTick, ref, watch, type ComponentPublicInstance} from "vue";
import {Badge, Button, type FormSelectOption} from "@notnotype/nb-ui/components";
import type {AgentProfileModelConfigDto} from "nbook/shared/dto/app-settings.dto";
import AgentProfileNavList from "./AgentProfileNavList.vue";
import type {AgentProfileNavItem} from "./AgentProfileNavList.types";
import AgentProfileDetailPanel from "./AgentProfileDetailPanel.vue";
import AgentProfileDefaultsPanel from "./AgentProfileDefaultsPanel.vue";
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
const chooseProfileBtnRef = ref<ComponentPublicInstance | HTMLButtonElement | null>(null);
const mobileNavBackBtnRef = ref<ComponentPublicInstance | HTMLButtonElement | null>(null);
const detailTitleRef = ref<HTMLElement | null>(null);

function getBtnElement(btn: ComponentPublicInstance | HTMLButtonElement | null): HTMLElement | null {
    if (!btn) return null;
    return "$el" in btn ? (btn.$el as HTMLElement) : (btn as HTMLElement);
}

function openMobileNav(): void {
    mobileNavOpen.value = true;
    void nextTick(() => {
        getBtnElement(mobileNavBackBtnRef.value)?.focus();
    });
}

function closeMobileNav(): void {
    mobileNavOpen.value = false;
    void nextTick(() => {
        getBtnElement(chooseProfileBtnRef.value)?.focus();
    });
}

function selectNavKey(key: string): void {
    activeNavKey.value = key;
    mobileNavOpen.value = false;
    void nextTick(() => {
        detailTitleRef.value?.focus();
    });
}

const busy = computed(() => props.loading || props.saving);

const sortedProfiles = computed(() => [...props.modelValue.profiles].sort((left, right) => left.profileKey.localeCompare(right.profileKey)));

const activeProfile = computed(() => sortedProfiles.value.find((profile) => profile.profileKey === activeNavKey.value) ?? null);

// 选中 Profile 被移除时回到默认设置页。
watch(() => props.modelValue.profiles, (profiles) => {
    if (activeNavKey.value && !profiles.some((profile) => profile.profileKey === activeNavKey.value)) {
        activeNavKey.value = "";
    }
});
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

const hasDirty = computed(() => defaultsDirty.value || navItems.value.some((item) => item.dirty));

const canSave = computed(() => !busy.value && !validationBlocking.value && hasDirty.value);
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
    <div class="settings-view-root flex h-full min-h-0 min-w-0 flex-col" data-lab-subject>
        <!-- 主体双栏区域：从顶部自然铺展，无冗余全局 Header 干扰 DialogWindow 标题栏 -->
        <div class="flex min-h-0 flex-1 gap-[var(--space-3)] p-[var(--space-3)]">
            <!-- 桌面或移动端展开时展示导航 -->
            <aside
                class="settings-nav-aside shrink-0"
                :class="{'is-mobile-open': mobileNavOpen}"
            >
                <!-- 移动端导航返回条（单列打开导航时可见） -->
                <div class="settings-mobile-bar shrink-0 items-center justify-between border-b border-[var(--divider)] px-4 py-2 mb-2">
                    <span class="text-xs font-semibold text-[var(--text-main)]">
                        {{ t("settings.panels.profileModels.nav.title") || "Agent Profiles" }}
                    </span>
                    <Button
                        ref="mobileNavBackBtnRef"
                        size="sm"
                        variant="secondary"
                        @click="closeMobileNav"
                    >
                        <span class="i-lucide-arrow-left mr-1 h-3.5 w-3.5" aria-hidden="true"></span>
                        {{ t("settings.panels.profileModels.settingsView.backToDetail") }}
                    </Button>
                </div>
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

            <!-- 详情工作区（移动端打开导航时隐藏） -->
            <section
                class="settings-detail-section min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--panel-outline)] bg-[var(--panel-surface)]"
                :class="{'is-mobile-open': mobileNavOpen}"
            >
                <!-- 窄屏移动端导航切换条（桌面容器宽度下隐藏） -->
                <div class="settings-mobile-bar shrink-0 items-center justify-between border-b border-[var(--divider)] px-4 py-2">
                    <span ref="detailTitleRef" tabindex="-1" class="text-xs font-semibold text-[var(--text-main)] truncate outline-none">
                        {{ activeProfile ? activeProfile.name : t("settings.panels.profileModels.settingsView.defaultsPage") }}
                    </span>
                    <Button
                        ref="chooseProfileBtnRef"
                        size="sm"
                        variant="secondary"
                        @click="openMobileNav"
                    >
                        <span class="i-lucide-list mr-1 h-3.5 w-3.5" aria-hidden="true"></span>
                        {{ t("settings.panels.profileModels.settingsView.selectProfile") }}
                    </Button>
                </div>
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
        <!-- 底部固定动作栏：作用域指示、未保存状态、错误提示、操作按钮 -->
        <footer class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--divider)] px-[var(--space-4)] py-[var(--space-2)] bg-[var(--panel-surface)]">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
                <Badge tone="neutral" size="sm" variant="soft">{{ scopeLabel }}</Badge>
                <Badge v-if="hasDirty" tone="warning" size="sm" variant="soft">
                    <span class="i-lucide-circle-alert mr-0.5 h-3 w-3 shrink-0" aria-hidden="true"></span>
                    {{ t("settings.panels.profileModels.unsavedChanges") }}
                </Badge>
                <span v-if="props.saveError" class="truncate text-xs text-[var(--status-danger)]">
                    {{ t("settings.panels.profileModels.settingsView.saveErrorPrefix") + props.saveError }}
                </span>
                <span v-else-if="props.saving" class="flex items-center gap-1 text-xs text-[var(--status-info)]">
                    <span class="i-lucide-loader-2 h-3 w-3 animate-spin" aria-hidden="true"></span>
                    {{ t("settings.panels.profileModels.settingsView.saveHintPreview") }}
                </span>
            </div>

            <div class="flex items-center gap-2">
                <Button size="sm" variant="ghost" :disabled="busy || !hasDirty" @click="requestDiscard">
                    {{ t("settings.panels.profileModels.settingsView.discard") }}
                </Button>
                <Button size="sm" :disabled="!canSave" @click="save">
                    {{ t("settings.panels.profileModels.settingsView.saveChanges") }}
                </Button>
            </div>
        </footer>
    </div>
</template>

<style scoped>
.settings-view-root {
    container-type: inline-size;
}

@container (max-width: 699px) {
    .settings-nav-aside {
        display: none;
    }
    .settings-nav-aside.is-mobile-open {
        display: block;
        width: 100%;
    }
    .settings-detail-section {
        display: flex;
    }
    .settings-detail-section.is-mobile-open {
        display: none;
    }
    .settings-mobile-bar {
        display: flex;
    }
}

@container (min-width: 700px) {
    .settings-nav-aside {
        display: block !important;
        width: 260px !important;
    }
    .settings-detail-section {
        display: flex !important;
    }
    .settings-mobile-bar {
        display: none !important;
    }
}
</style>
