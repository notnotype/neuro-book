<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type {NbColorwayVars} from "@notnotype/nb-ui/colorway";
import FrontendSettingsView from "../../components/novel-ide/settings/sections/frontend/FrontendSettingsView.vue";
import type {ColorwayDraft} from "../../components/novel-ide/settings/sections/frontend/FrontendSettingsView.types";
import type {ProductThemeOption} from "nbook/app/utils/theme/theme-packs";
import type {UserColorwayOption} from "nbook/app/utils/theme/theme-session";
import type {ProductAppearance, ProductThemeId} from "nbook/shared/theme/theme-axes";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const {t} = useI18n();
const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "disabled";

const sceneKey = computed<SceneKey>(() => props.scene === "disabled" ? "disabled" : "default");

/** 夹具的主题包清单：真实应用里由主题会话给出，名字与一句话简介来自主题包 manifest。 */
const themeOptions: ProductThemeOption[] = [
    {id: "nbook", name: "NeuroBook", tagline: "Liquid Glass · 中文写作版"},
    {id: "macos", name: "macOS", tagline: "Liquid Glass"},
];

const locale = ref("zh-CN");
const viewMode = ref("rich");
const reasoning = ref("off");
const themeId = ref<ProductThemeId>("nbook");
const appearance = ref<ProductAppearance>("light");

/**
 * 配色轴的夹具数据：一套用户配色 + 当前生效配色。
 *
 * 夹具里不复刻真实会话的解析逻辑（那属于 `app/utils/theme/theme-session.ts`），
 * 只保证视图拿到的绑定形状与真实宿主一致：选中、保存、删除都在本地生效并记录事件。
 */
const colorwayId = ref<string | undefined>("nbook-light");
const userColorways = ref<UserColorwayOption[]>([{
    id: "custom-lab",
    label: "Lab 夜色",
    appearance: "dark",
    swatch: "#223044",
    vars: {"--bg-main": "#223044", "--bg-panel": "#2b3a52"},
}]);
const colorwayVars: NbColorwayVars = {"--bg-main": "#e3e4e6", "--bg-panel": "#fffcf5", "--text-main": "#23252b"};

const colorwayLabel = computed(() => userColorways.value.find((colorway) => colorway.id === colorwayId.value)?.label ?? "NeuroBook · 昼");

const reasoningOptions = ["off", "low", "medium", "high"];

watch(sceneKey, applyScene, {immediate: true});

function applyScene(): void {
    locale.value = "zh-CN";
    viewMode.value = "rich";
    reasoning.value = "off";
    themeId.value = "nbook";
    appearance.value = "light";
    colorwayId.value = "nbook-light";
    userColorways.value = [{id: "custom-lab", label: "Lab 夜色", appearance: "dark", swatch: "#223044", vars: {"--bg-main": "#223044", "--bg-panel": "#2b3a52"}}];
}

// 就地保存的模拟：视图每次动作都由夹具立刻应用，并记录事件。
function onSelectTheme(value: ProductThemeId): void {
    themeId.value = value;
    emitLabEvent("select-theme", {themeId: value});
}

function onSelectAppearance(value: ProductAppearance): void {
    appearance.value = value;
    colorwayId.value = value === "dark" ? "nbook-dark" : "nbook-light";
    emitLabEvent("select-appearance", {appearance: value});
}

function onSelectColorway(id: string): void {
    colorwayId.value = id;
    appearance.value = userColorways.value.find((colorway) => colorway.id === id)?.appearance ?? appearance.value;
    emitLabEvent("select-colorway", {colorwayId: id});
}

function onSaveColorway(draft: ColorwayDraft): void {
    const id = draft.id ?? `custom-lab-${userColorways.value.length + 1}`;
    const saved = {id, label: draft.label, appearance: draft.appearance, swatch: draft.vars["--bg-main"] ?? "", vars: {...draft.vars}};
    const index = userColorways.value.findIndex((colorway) => colorway.id === id);
    if (index >= 0) {
        userColorways.value.splice(index, 1, saved);
    } else {
        userColorways.value.push(saved);
    }
    colorwayId.value = id;
    appearance.value = draft.appearance;
    emitLabEvent("save-colorway", {draft});
}

function onDeleteColorway(id: string): void {
    userColorways.value = userColorways.value.filter((colorway) => colorway.id !== id);
    if (colorwayId.value === id) {
        colorwayId.value = appearance.value === "dark" ? "nbook-dark" : "nbook-light";
    }
    emitLabEvent("delete-colorway", {colorwayId: id});
}

function labData() {
    return {
        locale: locale.value,
        viewMode: viewMode.value,
        reasoning: reasoning.value,
        themeId: themeId.value,
        appearance: appearance.value,
        colorwayId: colorwayId.value,
        userColorwayIds: userColorways.value.map((colorway) => colorway.id),
    };
}

watch([locale, viewMode, reasoning, themeId, appearance, colorwayId, userColorways], () => syncLabData(labData()), {immediate: true, deep: true});

const viewBindings = computed(() => ({
    locale: locale.value,
    viewMode: viewMode.value,
    reasoning: reasoning.value,
    reasoningOptions,
    themeOptions,
    themeId: themeId.value,
    appearance: appearance.value,
    colorwayId: colorwayId.value,
    colorwayLabel: colorwayLabel.value,
    colorwayVars,
    colorwayIsUser: userColorways.value.some((colorway) => colorway.id === colorwayId.value),
    userColorways: userColorways.value,
    disabled: sceneKey.value === "disabled",
    "onUpdate:locale": (value: string) => { locale.value = value; },
    "onUpdate:viewMode": (value: string) => { viewMode.value = value; },
    "onUpdate:reasoning": (value: string) => { reasoning.value = value; },
    "onSelect-theme": onSelectTheme,
    "onSelect-appearance": onSelectAppearance,
    "onSelect-colorway": onSelectColorway,
    "onSave-colorway": onSaveColorway,
    "onDelete-colorway": onDeleteColorway,
    "onExport-colorway": () => { emitLabEvent("export-colorway", {colorwayId: colorwayId.value}); },
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
