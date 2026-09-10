<script setup lang="ts">
import {computed, nextTick, ref, watch, type ComponentPublicInstance} from "vue";
import {Button, type FormSelectOption} from "@notnotype/nb-ui/components";
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
    type AgentProfileModelFieldErrors,
} from "./agent-profile-draft";
import {
    countProfileRuntimeOverrides,
    createProfileRuntimeSettingsDraft,
    parseProfileRuntimeSettingsDraft,
    resolveAgentProfileRuntimeBaseline,
    resolveAgentRuntimeDefaultsBaseline,
    type ProfileRuntimeSettingsErrors,
} from "./profile-runtime-settings";
import type {AgentProfileSettingsPageDraft, AgentProfileSettingsViewEmits, AgentProfileSettingsViewProps} from "./AgentProfileSettingsView.types";

const props = withDefaults(defineProps<AgentProfileSettingsViewProps>(), {
    showNavHeading: true,
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
const activeNavInitialized = ref(false);
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
    const wasMobileOpen = mobileNavOpen.value;
    activeNavKey.value = key;
    activeNavInitialized.value = true;
    mobileNavOpen.value = false;
    if (wasMobileOpen) {
        void nextTick(() => {
            detailTitleRef.value?.focus();
        });
    }
}

const busy = computed(() => props.loading || props.saving);

const sortedProfiles = computed(() => [...props.modelValue.profiles].sort((left, right) => left.profileKey.localeCompare(right.profileKey)));

const activeProfile = computed(() => sortedProfiles.value.find((profile) => profile.profileKey === activeNavKey.value) ?? null);
// 首次有 Profile 时直接进入第一个 Profile；用户显式选择默认页后保留空 key。
watch(sortedProfiles, (profiles, previousProfiles) => {
    if (profiles.length === 0) {
        if (previousProfiles?.length) activeNavKey.value = "";
        activeNavInitialized.value = false;
        return;
    }
    if (!activeNavInitialized.value) {
        activeNavInitialized.value = true;
        activeNavKey.value = profiles[0]!.profileKey;
        return;
    }
    if (activeNavKey.value && !profiles.some((profile) => profile.profileKey === activeNavKey.value)) {
        activeNavKey.value = "";
    }
}, {immediate: true});
const navItems = computed<AgentProfileNavItem[]>(() => sortedProfiles.value.map((profile) => ({
    profileKey: profile.profileKey,
    name: profile.name,
    status: profile.loadStatus,
    overrideCount: countModelOverrides(profile.model) + countProfileRuntimeOverrides(profile.runtime) + countSettingsOverrides(profile),
    isDefault: profile.profileKey === effectiveDefaultProfileKey.value,
})));

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

const runtimeDefaultsParse = computed(() => parseProfileRuntimeSettingsDraft(props.modelValue.runtimeDefaults));
const runtimeDefaultsErrors = computed<ProfileRuntimeSettingsErrors>(() => runtimeDefaultsParse.value.errors);
const profileRuntimeParses = computed<Record<string, ReturnType<typeof parseProfileRuntimeSettingsDraft>>>(() => Object.fromEntries(props.modelValue.profiles.map((profile) => [
    profile.profileKey,
    parseProfileRuntimeSettingsDraft(profile.runtime),
])));
const profileRuntimeErrors = computed<Record<string, ProfileRuntimeSettingsErrors>>(() => Object.fromEntries(Object.entries(profileRuntimeParses.value).map(([profileKey, result]) => [profileKey, result.errors])));

const runtimeDefaultsBaseline = computed(() => resolveAgentRuntimeDefaultsBaseline(
    props.context.settings.harnessRuntimeDefaults,
    props.context.scope,
    props.context.settings.globalRuntimeDefaultsPatch,
));

function resolveProfileRuntimeBaseline(profile: AgentProfileDraftOf) {
    const metadata = props.context.settings.agentProfiles.find((item) => item.profileKey === profile.profileKey);
    return resolveAgentProfileRuntimeBaseline(
        props.context.settings.harnessRuntimeDefaults,
        props.context.scope,
        {
            profileDefaults: metadata?.runtime.profileDefaults,
            globalDefaultsPatch: props.context.settings.globalRuntimeDefaultsPatch,
            globalProfilePatch: metadata?.runtime.globalProfilePatch,
            defaultsDraftPatch: runtimeDefaultsParse.value.patch,
        },
    );
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
    for (const profile of props.modelValue.profiles) check(profile.model, "profile", profile.profileKey);
    return issues;
});

function modelErrorsFor(scope: "defaults" | "profile", profileKey?: string): AgentProfileModelFieldErrors {
    return Object.fromEntries(modelValidation.value
        .filter((issue) => issue.scope === scope && issue.profileKey === profileKey)
        .map((issue) => [issue.field, issue.message])) as AgentProfileModelFieldErrors;
}

const defaultsModelErrors = computed(() => modelErrorsFor("defaults"));
const profileModelErrors = computed<Record<string, AgentProfileModelFieldErrors>>(() => Object.fromEntries(
    props.modelValue.profiles.map((profile) => [profile.profileKey, modelErrorsFor("profile", profile.profileKey)]),
));

function resetDefaults(): void {
    if (busy.value) return;
    updatePage({
        modelDefaults: props.context.scope === "project"
            ? cloneModelDraft(undefined)
            : {...cloneModelDraft(undefined), reasoningEffort: "off", stream: true},
        runtimeDefaults: createProfileRuntimeSettingsDraft(undefined),
    });
}

</script>

<template>
    <div class="settings-view-root flex h-full min-h-0 min-w-0 flex-col" data-lab-subject>
        <!-- 主体双栏区域：从顶部自然铺展，无冗余全局 Header 干扰宿主窗口标题栏 -->
        <div class="flex min-h-0 flex-1">
            <!-- 桌面或移动端展开时展示导航；导航轨自带右分割线，不画卡片面 -->
            <aside
                class="settings-nav-aside flex shrink-0 flex-col gap-[var(--space-4)] p-[var(--space-6)]"
                :class="{'is-mobile-open': mobileNavOpen}"
            >
                <!-- 移动端导航返回条（单列打开导航时可见） -->
                <div class="settings-mobile-bar shrink-0 items-center justify-between border-b border-[var(--divider)] px-4 py-2 mb-2">
                    <span v-if="props.showNavHeading" class="text-xs font-semibold text-[var(--text-main)]">
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
                    class="min-h-0 flex-1"
                    :items="navItems"
                    :active-key="activeNavKey"
                    :search="navSearch"
                    :show-heading="props.showNavHeading"
                    surface="plain"
                    @update:active-key="selectNavKey"
                    @update:search="navSearch = $event"
                />
            </aside>

            <div class="flex min-h-0 min-w-0 flex-1 flex-col">
                <!-- 详情工作区（移动端打开导航时隐藏） -->
                <section
                    class="settings-detail-section min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
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
                    <!-- 就地保存的状态只在保存中或失败时出现，常态不占位 -->
                    <div v-if="props.saveError || props.saving" class="shrink-0 px-[var(--space-6)] pt-[var(--space-3)]">
                        <div class="max-w-3xl">
                            <span v-if="props.saveError" class="truncate text-xs text-[var(--status-danger)]">
                                {{ t("settings.panels.profileModels.settingsView.saveErrorPrefix") + props.saveError }}
                            </span>
                            <span v-else class="flex items-center gap-1 text-xs text-[var(--status-info)]">
                                <span class="i-lucide-loader-2 h-3 w-3 animate-spin" aria-hidden="true"></span>
                                {{ t("settings.panels.profileModels.settingsView.savingHint") }}
                            </span>
                        </div>
                    </div>
                <div class="min-h-0 flex-1 overflow-y-auto p-[var(--space-6)]">
                    <!-- 宽窗口下内容列封顶：控件与分隔线都不随窗口宽度无上限拉伸 -->
                    <div class="max-w-3xl">
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
                                :key="activeProfile.profileKey"
                                :profile="activeProfile"
                                :inherited-model="resolveProfileInheritedModel(activeProfile)"
                                :enabled-models="props.context.settings.enabledModels"
                                :validation-issues="props.context.settings.validationIssues"
                                :model-errors="profileModelErrors[activeProfile.profileKey] ?? {}"
                                :scope="props.context.scope"
                                :runtime-baseline="resolveProfileRuntimeBaseline(activeProfile)"
                                :runtime-errors="profileRuntimeErrors[activeProfile.profileKey] ?? {}"
                                :descriptions="props.context.descriptions"
                                :disabled="busy"
                                :is-default-profile="activeProfile.profileKey === effectiveDefaultProfileKey"
                                @update:model="updateProfile(activeProfile.profileKey, {model: $event})"
                                @update:runtime="updateProfile(activeProfile.profileKey, {runtime: $event})"
                                @update:settings-values="updateProfile(activeProfile.profileKey, {settings: {...activeProfile.settings!, values: $event}})"
                                @update:settings-override-paths="updateProfile(activeProfile.profileKey, {settings: {...activeProfile.settings!, overridePaths: $event}})"
                                @update:settings-resource-mutations="updateProfile(activeProfile.profileKey, {settings: {...activeProfile.settings!, resourceMutations: $event}})"
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
                            :model-errors="defaultsModelErrors"
                            :runtime-defaults="props.modelValue.runtimeDefaults"
                            :runtime-effective="runtimeDefaultsBaseline.settings"
                            :runtime-sources="runtimeDefaultsBaseline.sources"
                            :runtime-errors="runtimeDefaultsErrors"
                            :disabled="busy"
                            @update:default-profile-key="updateDefaultProfileKey"
                            @update:model-defaults="updateModelDefaults"
                            @update:runtime-defaults="updateRuntimeDefaults"
                            @reset="resetDefaults"
                        />
                    </div>
                </div>
            </section>
            </div>
        </div>
    </div>
</template>

<style scoped>
.settings-view-root {
    container-type: inline-size;
}

/* 栏间竖线与区段横线同款：1px --divider，并且和横线一样在两端留出内边距，
   不与标题栏、窗口下沿的横线相接。竖线划分区域，横线在它右侧收住。 */
.settings-nav-aside {
    position: relative;
}

.settings-nav-aside::after {
    content: "";
    position: absolute;
    top: var(--space-6);
    right: 0;
    bottom: var(--space-6);
    width: var(--border-w);
    background: var(--divider);
}

@container (max-width: 699px) {
    .settings-nav-aside {
        display: none;
    }
    /* 单列时导航占满整行，右边不再有分栏，竖线一并去掉。 */
    .settings-nav-aside::after {
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
    /* 导航轨自带 16px 内边距，宽度在此之上补足，保持内容宽度与历史版本一致。 */
    .settings-nav-aside {
        display: block !important;
        width: 276px !important;
    }
    .settings-detail-section {
        display: flex !important;
    }
    .settings-mobile-bar {
        display: none !important;
    }
}
</style>
