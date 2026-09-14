<script setup lang="ts">
import {computed} from "vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import {productAppearances, type ProductAppearance} from "nbook/shared/theme/theme-axes";
import {
    buildLocaleOptions,
    buildViewModeOptions,
    type FrontendSettingsViewEmits,
    type FrontendSettingsViewProps,
} from "./FrontendSettingsView.types";

const props = withDefaults(defineProps<FrontendSettingsViewProps>(), {
    disabled: false,
});

const emit = defineEmits<FrontendSettingsViewEmits>();

const {t} = useI18n();

const localeOptions = computed(() => buildLocaleOptions(t));
const viewModeOptions = computed(() => buildViewModeOptions(t));
const reasoningSelectOptions = computed(() => props.reasoningOptions.map((item) => ({value: item, label: item})));

/** 两档配色的展示：文案走 i18n，图标只是明暗提示；顺序取 `productAppearances`（亮在前）。 */
const appearanceDisplay: Record<ProductAppearance, {labelKey: string; iconClass: string}> = {
    light: {labelKey: "settings.frontend.appearanceLight", iconClass: "i-lucide-sun"},
    dark: {labelKey: "settings.frontend.appearanceDark", iconClass: "i-lucide-moon"},
};
const appearanceOptions = computed(() => productAppearances.map((value) => ({
    value,
    label: t(appearanceDisplay[value].labelKey),
    iconClass: appearanceDisplay[value].iconClass,
})));
</script>

<template>
    <div class="flex min-w-0 flex-col" data-lab-subject>
        <div class="grid gap-3">
            <section class="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
                <div class="min-w-0">
                    <h3 class="flex items-center gap-[var(--space-2)] text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                        <span class="i-lucide-languages h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        {{ t("settings.frontend.languageTitle") }}
                    </h3>
                    <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.frontend.languageDescription") }}</p>
                </div>
                <div class="w-48 shrink-0">
                    <FormSelect :model-value="props.locale" :options="localeOptions" :disabled="props.disabled" @update:model-value="emit('update:locale', $event)" />
                </div>
            </section>

            <section class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
                <!-- 主题两轴：主题包定材质、排版与控件密度，配色定明暗；两轴各自独立生效 -->
                <div class="min-w-0">
                    <h3 class="flex items-center gap-[var(--space-2)] text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                        <span class="i-lucide-palette h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        {{ t("settings.frontend.themeTitle") }}
                    </h3>
                    <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.frontend.themeDescription") }}</p>
                </div>

                <!-- 主题包 -->
                <div class="mt-[var(--space-3)]">
                    <div class="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t("settings.frontend.themePackLabel") }}</div>
                    <div class="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
                        <button
                            v-for="option in props.themeOptions"
                            :key="option.id"
                            type="button"
                            class="flex min-w-0 flex-col items-start gap-0.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-50"
                            :class="props.themeId === option.id
                                ? 'border-[var(--accent-main)] bg-[var(--bg-hover)]'
                                : 'border-[var(--border-color)] bg-[var(--bg-input)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'"
                            :disabled="props.disabled"
                            :aria-pressed="props.themeId === option.id"
                            @click="emit('select-theme', option.id)"
                        >
                            <span class="flex w-full min-w-0 items-center gap-1.5">
                                <span class="min-w-0 flex-1 truncate text-xs text-[var(--text-main)]">{{ option.name }}</span>
                                <span v-if="props.themeId === option.id" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]" aria-hidden="true"></span>
                            </span>
                            <span class="min-w-0 truncate text-[11px] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ option.tagline }}</span>
                        </button>
                    </div>
                </div>

                <!-- 配色明暗 -->
                <div class="mt-[var(--space-3)]">
                    <div class="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t("settings.frontend.appearanceLabel") }}</div>
                    <div class="flex flex-wrap gap-2.5">
                        <button
                            v-for="option in appearanceOptions"
                            :key="option.value"
                            type="button"
                            class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs text-[var(--text-main)] transition-colors disabled:pointer-events-none disabled:opacity-50"
                            :class="props.appearance === option.value
                                ? 'border-[var(--accent-main)] bg-[var(--bg-hover)]'
                                : 'border-[var(--border-color)] bg-[var(--bg-input)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'"
                            :disabled="props.disabled"
                            :aria-pressed="props.appearance === option.value"
                            @click="emit('select-appearance', option.value)"
                        >
                            <span class="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" :class="option.iconClass" aria-hidden="true"></span>
                            <span>{{ option.label }}</span>
                            <span v-if="props.appearance === option.value" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]" aria-hidden="true"></span>
                        </button>
                    </div>
                </div>
            </section>

            <section class="mt-[var(--space-4)] flex flex-wrap items-center justify-between gap-[var(--space-3)] border-t border-[var(--divider)] pt-[var(--space-4)]">
                <div class="min-w-0">
                    <h3 class="flex items-center gap-[var(--space-2)] text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                        <span class="i-lucide-brain-circuit h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        {{ t("settings.frontend.reasoningTitle") }}
                    </h3>
                    <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.frontend.reasoningDescription") }}</p>
                </div>
                <div class="w-40 shrink-0">
                    <FormSelect :model-value="props.reasoning" :options="reasoningSelectOptions" :disabled="props.disabled" @update:model-value="emit('update:reasoning', $event)" />
                </div>
            </section>

            <section class="mt-[var(--space-4)] flex flex-wrap items-center justify-between gap-[var(--space-3)] border-t border-[var(--divider)] pt-[var(--space-4)]">
                <div class="min-w-0">
                    <h3 class="flex items-center gap-[var(--space-2)] text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                        <span class="i-lucide-layout h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                        {{ t("settings.frontend.viewModeTitle") }}
                    </h3>
                    <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.frontend.viewModeDescription") }}</p>
                </div>
                <div class="w-40 shrink-0">
                    <FormSelect :model-value="props.viewMode" :options="viewModeOptions" :disabled="props.disabled" @update:model-value="emit('update:viewMode', $event)" />
                </div>
            </section>
        </div>
    </div>
</template>
