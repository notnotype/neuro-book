<script setup lang="ts">
import {computed, ref, watch} from "vue";
import FrontendSettingsView from "../../components/novel-ide/settings/sections/frontend/FrontendSettingsView.vue";
import type {FrontendThemeCard, ImportedThemeDocument} from "../../components/novel-ide/settings/sections/frontend/FrontendSettingsView.types";
import {ideThemeIds, themeMeta, themeTokens, type ThemeVars} from "nbook/app/utils/theme/theme-tokens";
import type {CustomThemeDto} from "nbook/shared/theme/theme-vars";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const {t} = useI18n();
const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "no-custom" | "disabled";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "no-custom", "disabled"];
    return known.find((key) => key === props.scene) ?? "default";
});

/** 主题表的键就是 token 表的键；`ideThemeIds` 只声明成 string[]，这里按真实键收紧。 */
type ThemeKey = keyof typeof themeTokens;

/** 视图只认 props，所以 fixture 直接给出解析后的变量表：键带 `--` 前缀，与卡片预览一致。 */
function previewVars(themeId: ThemeKey): ThemeVars {
    return Object.fromEntries(
        Object.entries(themeTokens[themeId]).map(([key, value]) => [`--${key}`, value ?? ""]),
    ) as unknown as ThemeVars;
}

function builtInCards(): FrontendThemeCard[] {
    return ideThemeIds.map((rawThemeId) => {
        const themeId = rawThemeId as ThemeKey;
        return {
            id: themeId,
            name: themeMeta[themeId].label,
            appearance: themeMeta[themeId].appearance,
            vars: previewVars(themeId),
            custom: null,
        };
    });
}

/** 自定义主题文档用短键（与 CustomThemeDto 一致），所以把 token 的 `--` 前缀去掉。 */
function customTheme(id: string, name: string, base: ThemeKey): CustomThemeDto {
    const vars = Object.fromEntries(
        Object.entries(themeTokens[base]).map(([key, value]) => [key.replace(/^--/u, ""), value ?? ""]),
    );
    return {id, name, appearance: themeMeta.sepia.appearance, vars};
}

const customThemes = ref<CustomThemeDto[]>([
    customTheme("custom-dusk", "暮色", "tokyo-night"),
    customTheme("custom-paper", "纸感", "sepia"),
]);

const customCards = computed<FrontendThemeCard[]>(() => sceneKey.value === "no-custom" ? [] : customThemes.value.map((theme) => ({
    id: theme.id,
    name: theme.name,
    appearance: theme.appearance,
    vars: previewVars(theme.id === "custom-dusk" ? "tokyo-night" : "sepia"),
    custom: theme,
})));

const locale = ref("zh-CN");
const viewMode = ref("rich");
const reasoning = ref("off");
const activeThemeId = ref("sepia");

const reasoningOptions = ["off", "low", "medium", "high"];
const activeCard = computed(() => [...builtInCards(), ...customCards.value].find((card) => card.id === activeThemeId.value) ?? null);

watch(sceneKey, applyScene, {immediate: true});

function applyScene(): void {
    locale.value = "zh-CN";
    viewMode.value = "rich";
    reasoning.value = "off";
    activeThemeId.value = sceneKey.value === "no-custom" ? "tokyo-night" : "sepia";
    customThemes.value = sceneKey.value === "no-custom"
        ? []
        : [customTheme("custom-dusk", "暮色", "tokyo-night"), customTheme("custom-paper", "纸感", "sepia")];
}

// 就地保存的模拟：视图每次动作都由 fixture 立刻应用，并记录事件。
function onSelectTheme(themeId: string): void {
    activeThemeId.value = themeId;
    emitLabEvent("select-theme", {themeId});
}

function onCopyTheme(themeId: string): void {
    const source = [...builtInCards(), ...customCards.value].find((card) => card.id === themeId);
    // 复制出来的主题沿用来源主题的变量；来源不是内置主题时退回落日（夹具数据，不必精确）。
    const sourceKey: ThemeKey = themeId in themeTokens ? themeId as ThemeKey : "sepia";
    customThemes.value = [...customThemes.value, customTheme(`${themeId}-copy`, `${source?.name ?? themeId} 副本`, sourceKey)];
    emitLabEvent("copy-theme", {themeId});
}

function onEditTheme(theme: CustomThemeDto): void {
    emitLabEvent("edit-theme", {id: theme.id, name: theme.name});
}

function onDeleteTheme(theme: CustomThemeDto): void {
    customThemes.value = customThemes.value.filter((item) => item.id !== theme.id);
    emitLabEvent("delete-theme", {id: theme.id});
}

function onImportFailed(message: string): void {
    emitLabEvent("import-failed", {message});
}

function labData() {
    return {
        locale: locale.value,
        viewMode: viewMode.value,
        reasoning: reasoning.value,
        activeThemeId: activeThemeId.value,
        customThemeCount: customThemes.value.length,
    };
}

watch([locale, viewMode, reasoning, activeThemeId, customThemes], () => syncLabData(labData()), {deep: true, immediate: true});

const viewBindings = computed(() => ({
    locale: locale.value,
    viewMode: viewMode.value,
    reasoning: reasoning.value,
    reasoningOptions,
    builtInThemeCards: builtInCards(),
    customThemeCards: customCards.value,
    activeThemeId: activeThemeId.value,
    activeThemeLabel: activeCard.value?.name ?? activeThemeId.value,
    activeThemeIsBuiltIn: activeCard.value?.custom === null,
    disabled: sceneKey.value === "disabled",
    "onUpdate:locale": (value: string) => { locale.value = value; },
    "onUpdate:viewMode": (value: string) => { viewMode.value = value; },
    "onUpdate:reasoning": (value: string) => { reasoning.value = value; },
    "onSelect-theme": onSelectTheme,
    "onCreate-theme": () => emitLabEvent("create-theme", undefined),
    "onCopy-theme": onCopyTheme,
    "onEdit-theme": onEditTheme,
    "onExport-theme": (themeId: string) => emitLabEvent("export-theme", {themeId}),
    "onDelete-theme": onDeleteTheme,
    "onImport-theme": (theme: ImportedThemeDocument) => emitLabEvent("import-theme", {name: theme.name}),
    "onImport-failed": onImportFailed,
}));
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <p class="mb-4 text-xs text-[var(--text-muted)]">{{ t("settings.frontend.themeDescription") }}</p>
            <FrontendSettingsView v-bind="viewBindings" />
        </div>
    </div>
</template>
