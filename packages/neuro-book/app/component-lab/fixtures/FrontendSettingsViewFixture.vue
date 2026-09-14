<script setup lang="ts">
import {computed, ref, watch} from "vue";
import FrontendSettingsView from "../../components/novel-ide/settings/sections/frontend/FrontendSettingsView.vue";
import type {ProductThemeOption} from "nbook/app/utils/theme/theme-packs";
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

const reasoningOptions = ["off", "low", "medium", "high"];

watch(sceneKey, applyScene, {immediate: true});

function applyScene(): void {
    locale.value = "zh-CN";
    viewMode.value = "rich";
    reasoning.value = "off";
    themeId.value = "nbook";
    appearance.value = "light";
}

// 就地保存的模拟：视图每次动作都由夹具立刻应用，并记录事件。
function onSelectTheme(value: ProductThemeId): void {
    themeId.value = value;
    emitLabEvent("select-theme", {themeId: value});
}

function onSelectAppearance(value: ProductAppearance): void {
    appearance.value = value;
    emitLabEvent("select-appearance", {appearance: value});
}

function labData() {
    return {
        locale: locale.value,
        viewMode: viewMode.value,
        reasoning: reasoning.value,
        themeId: themeId.value,
        appearance: appearance.value,
    };
}

watch([locale, viewMode, reasoning, themeId, appearance], () => syncLabData(labData()), {immediate: true});

const viewBindings = computed(() => ({
    locale: locale.value,
    viewMode: viewMode.value,
    reasoning: reasoning.value,
    reasoningOptions,
    themeOptions,
    themeId: themeId.value,
    appearance: appearance.value,
    disabled: sceneKey.value === "disabled",
    "onUpdate:locale": (value: string) => { locale.value = value; },
    "onUpdate:viewMode": (value: string) => { viewMode.value = value; },
    "onUpdate:reasoning": (value: string) => { reasoning.value = value; },
    "onSelect-theme": onSelectTheme,
    "onSelect-appearance": onSelectAppearance,
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
