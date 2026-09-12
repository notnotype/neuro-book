<script setup lang="ts">
import {computed, ref} from "vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import {parseThemeJson} from "nbook/app/utils/theme/theme-io";
import {
    buildLocaleOptions,
    buildViewModeOptions,
    type FrontendSettingsViewEmits,
    type FrontendSettingsViewProps,
    type ImportedThemeDocument,
} from "./FrontendSettingsView.types";

const props = withDefaults(defineProps<FrontendSettingsViewProps>(), {
    disabled: false,
});

const emit = defineEmits<FrontendSettingsViewEmits>();

const {t} = useI18n();

const localeOptions = computed(() => buildLocaleOptions(t));
const viewModeOptions = computed(() => buildViewModeOptions(t));
const reasoningSelectOptions = computed(() => props.reasoningOptions.map((item) => ({value: item, label: item})));

const themeImportInputRef = ref<HTMLInputElement | null>(null);

function triggerThemeImport(): void {
    themeImportInputRef.value?.click();
}

/**
 * 导入主题 JSON：解析放在视图里（纯工具函数），落盘由宿主决定。
 * 解析失败把原因交回宿主，由系统通知呈现——视图不自己弹提示。
 */
async function importThemeFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = "";
    if (!file) {
        return;
    }
    try {
        const parsed = parseThemeJson(await file.text());
        if (!parsed.ok) {
            emit("import-failed", parsed.message);
            return;
        }
        emit("import-theme", parsed.theme as ImportedThemeDocument);
    } catch (error) {
        emit("import-failed", error instanceof Error ? error.message : String(error));
    }
}
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
                <!-- 主题管理入口 -->
                <div class="flex flex-wrap items-start justify-between gap-[var(--space-3)]">
                    <div class="min-w-0 flex-1">
                        <h3 class="flex items-center gap-[var(--space-2)] text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">
                            <span class="i-lucide-palette h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
                            {{ t("settings.frontend.themeTitle") }}
                        </h3>
                        <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.frontend.themeDescription") }}</p>
                        <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ props.activeThemeLabel }} · {{ props.activeThemeIsBuiltIn ? t("settings.frontend.themeBuiltInPreset") : t("settings.frontend.themeCustomPreset") }}</p>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-transparent bg-[var(--accent-main)] px-3 text-xs font-medium text-[var(--text-inverse)] transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50" :disabled="props.disabled" @click="emit('create-theme')">
                            <span class="i-lucide-plus h-3.5 w-3.5"></span>
                            <span>{{ t("settings.frontend.themeCreate") }}</span>
                        </button>
                        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] transition-colors hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-50" :disabled="props.disabled" @click="triggerThemeImport">
                            <span class="i-lucide-upload h-3.5 w-3.5"></span>
                            <span>{{ t("settings.frontend.themeImport") }}</span>
                        </button>
                        <input ref="themeImportInputRef" class="hidden" type="file" accept="application/json,.json" @change="void importThemeFile($event)">
                    </div>
                </div>

                <!-- 内置主题卡片网格 -->
                <div class="mt-4">
                    <div class="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t("settings.frontend.themeBuiltInGroup") }}</div>
                    <div class="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
                        <div v-for="card in props.builtInThemeCards" :key="card.id" class="group relative cursor-pointer overflow-hidden rounded-lg border transition-all" :class="props.activeThemeId === card.id ? 'border-[var(--accent-main)] shadow-[0_0_0_1px_var(--accent-main)]' : 'border-[var(--border-color)] hover:border-[var(--border-strong)] hover:shadow-sm'" @click="emit('select-theme', card.id)">
                            <!-- 迷你预览：使用该主题自己的变量绘制 -->
                            <div class="relative h-16" :style="{background: card.vars['--bg-main']}">
                                <div class="absolute inset-y-1.5 left-1.5 w-6 rounded-sm" :style="{background: card.vars['--bg-sidebar']}"></div>
                                <div class="absolute bottom-1.5 left-9 right-1.5 top-1.5 rounded-sm border px-1.5 py-1" :style="{background: card.vars['--bg-panel'], borderColor: card.vars['--border-color']}">
                                    <div class="text-[11px] font-semibold leading-none" :style="{color: card.vars['--text-main']}">Aa</div>
                                    <div class="mt-1 h-1 w-9 rounded-full" :style="{background: card.vars['--text-muted']}"></div>
                                    <div class="absolute bottom-1 left-1.5 flex items-center gap-1">
                                        <span class="h-1.5 w-3 rounded-full" :style="{background: card.vars['--accent-main']}"></span>
                                        <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-info']}"></span>
                                        <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-success']}"></span>
                                        <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-warning']}"></span>
                                        <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-danger']}"></span>
                                    </div>
                                </div>
                                <!-- 悬停操作：复制为自定义 / 导出 -->
                                <div class="absolute right-1 top-1 flex items-center gap-0.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                                    <button type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('settings.frontend.themeCopy')" @click.stop="emit('copy-theme', card.id)">
                                        <span class="i-lucide-copy h-3.5 w-3.5"></span>
                                    </button>
                                    <button type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('settings.frontend.themeExport')" @click.stop="emit('export-theme', card.id)">
                                        <span class="i-lucide-download h-3.5 w-3.5"></span>
                                    </button>
                                </div>
                            </div>
                            <!-- 名称行：使用当前主题变量，保证列表底盘一致 -->
                            <div class="flex items-center gap-1.5 border-t border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">
                                <span class="h-3 w-3 shrink-0 text-[var(--text-muted)]" :class="card.appearance === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun'"></span>
                                <span class="min-w-0 flex-1 truncate text-xs text-[var(--text-main)]">{{ card.name }}</span>
                                <span v-if="props.activeThemeId === card.id" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 自定义主题卡片网格 -->
                <div class="mt-4">
                    <div class="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{{ t("settings.frontend.themeCustomGroup") }}</div>
                    <div v-if="props.customThemeCards.length" class="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(150px,1fr))]">
                        <div v-for="card in props.customThemeCards" :key="card.id" class="group relative cursor-pointer overflow-hidden rounded-lg border transition-all" :class="props.activeThemeId === card.id ? 'border-[var(--accent-main)] shadow-[0_0_0_1px_var(--accent-main)]' : 'border-[var(--border-color)] hover:border-[var(--border-strong)] hover:shadow-sm'" @click="emit('select-theme', card.id)">
                            <!-- 迷你预览：使用该主题自己的变量绘制 -->
                            <div class="relative h-16" :style="{background: card.vars['--bg-main']}">
                                <div class="absolute inset-y-1.5 left-1.5 w-6 rounded-sm" :style="{background: card.vars['--bg-sidebar']}"></div>
                                <div class="absolute bottom-1.5 left-9 right-1.5 top-1.5 rounded-sm border px-1.5 py-1" :style="{background: card.vars['--bg-panel'], borderColor: card.vars['--border-color']}">
                                    <div class="text-[11px] font-semibold leading-none" :style="{color: card.vars['--text-main']}">Aa</div>
                                    <div class="mt-1 h-1 w-9 rounded-full" :style="{background: card.vars['--text-muted']}"></div>
                                    <div class="absolute bottom-1 left-1.5 flex items-center gap-1">
                                        <span class="h-1.5 w-3 rounded-full" :style="{background: card.vars['--accent-main']}"></span>
                                        <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-info']}"></span>
                                        <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-success']}"></span>
                                        <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-warning']}"></span>
                                        <span class="h-1.5 w-1.5 rounded-full" :style="{background: card.vars['--status-danger']}"></span>
                                    </div>
                                </div>
                                <!-- 悬停操作：编辑 / 复制 / 导出 / 删除 -->
                                <div class="absolute right-1 top-1 flex items-center gap-0.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                                    <button v-if="card.custom" type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('settings.frontend.themeEdit')" @click.stop="emit('edit-theme', card.custom)">
                                        <span class="i-lucide-pencil h-3.5 w-3.5"></span>
                                    </button>
                                    <button type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('settings.frontend.themeCopy')" @click.stop="emit('copy-theme', card.id)">
                                        <span class="i-lucide-copy h-3.5 w-3.5"></span>
                                    </button>
                                    <button type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)]" :title="t('settings.frontend.themeExport')" @click.stop="emit('export-theme', card.id)">
                                        <span class="i-lucide-download h-3.5 w-3.5"></span>
                                    </button>
                                    <button v-if="card.custom" type="button" class="flex h-6 w-6 items-center justify-center rounded text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger-bg)]" :title="t('settings.frontend.themeDelete')" @click.stop="emit('delete-theme', card.custom)">
                                        <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                    </button>
                                </div>
                            </div>
                            <!-- 名称行：使用当前主题变量，保证列表底盘一致 -->
                            <div class="flex items-center gap-1.5 border-t border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5">
                                <span class="h-3 w-3 shrink-0 text-[var(--text-muted)]" :class="card.appearance === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun'"></span>
                                <span class="min-w-0 flex-1 truncate text-xs text-[var(--text-main)]">{{ card.name }}</span>
                                <span v-if="props.activeThemeId === card.id" class="i-lucide-check h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span>
                            </div>
                        </div>
                    </div>
                    <div v-else class="rounded-md bg-[var(--bg-input)] px-3 py-2 text-xs text-[var(--text-muted)]">{{ t("settings.frontend.themeNoCustom") }}</div>
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
