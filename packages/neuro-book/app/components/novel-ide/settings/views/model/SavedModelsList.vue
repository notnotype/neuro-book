<script setup lang="ts">
import type {ModelSettingsModelDraft, ModelSettingsProviderDraft} from "nbook/app/components/novel-ide/settings/views/model/model-settings-draft";
import type {SavedModelGroupView} from "nbook/app/components/novel-ide/settings/views/model/model-settings-view";

const props = defineProps<{
    provider: ModelSettingsProviderDraft;
    groups: SavedModelGroupView[];
    disabledModels: ModelSettingsModelDraft[];
    enabledCount: number;
    checkingCount: number;
    checkingAll: boolean;
    expandedGroups: Record<string, boolean>;
}>();

const emit = defineEmits<{
    (e: "toggle-group", group: string): void;
    (e: "check-all"): void;
    (e: "cancel-checks"): void;
    (e: "check-model", model: ModelSettingsModelDraft): void;
    (e: "cancel-model-check", model: ModelSettingsModelDraft): void;
    (e: "edit-model", model: ModelSettingsModelDraft): void;
    (e: "disable-model", model: ModelSettingsModelDraft): void;
    (e: "delete-model", model: ModelSettingsModelDraft): void;
    (e: "open-discovery"): void;
    (e: "open-library"): void;
}>();

const {t} = useI18n();
</script>

<template>
    <!-- 已保存模型列表：只投影视图数据，所有修改动作回传宿主。 -->
    <div class="overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm transition-all duration-300 hover:shadow-md">
        <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-color)] bg-[var(--bg-panel)] px-5 py-4">
            <div>
                <div class="flex items-center gap-2">
                    <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.panels.models.enabledModels") }}</h3>
                    <div class="flex items-center justify-center rounded-full bg-[var(--bg-input)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">{{ props.enabledCount }}</div>
                </div>
                <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.panels.models.enabledModelsDescription") }}</p>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
                <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] active:scale-95 disabled:pointer-events-none disabled:opacity-50" :disabled="props.checkingAll || props.enabledCount === 0" @click="emit('check-all')">
                    <span class="h-3.5 w-3.5" :class="props.checkingAll ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-list-checks'"></span>
                    {{ props.checkingAll ? t("settings.panels.models.checkingAllModels") : t("settings.panels.models.checkAllModels") }}
                </button>
                <button v-if="props.checkingCount > 0" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 text-xs font-medium text-[var(--status-danger)] shadow-sm transition-all duration-200 hover:bg-[var(--status-danger-bg)] active:scale-95" @click="emit('cancel-checks')">
                    <span class="i-lucide-circle-x h-3.5 w-3.5"></span>
                    {{ t("settings.panels.models.cancelModelChecks") }}
                </button>
            </div>
        </div>

        <div class="max-h-[360px] min-h-[150px] overflow-y-auto bg-[var(--bg-input)]/20 p-3 custom-scrollbar">
            <div v-if="props.groups.length === 0" class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--bg-panel)] py-8 text-center">
                <span class="i-lucide-box h-5 w-5 text-[var(--text-muted)]"></span>
                <div class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.models.noEnabledProviderModels") }}</div>
            </div>

            <div v-else class="space-y-2">
                <div v-for="group in props.groups" :key="group.group" class="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
                    <button class="flex w-full items-center justify-between gap-2 px-4 py-3 transition-colors hover:bg-[var(--bg-hover)]/50" @click="emit('toggle-group', group.group)">
                        <div class="flex items-center gap-2">
                            <span class="h-4 w-4 shrink-0 transition-transform duration-200" :class="props.expandedGroups[group.group] === false ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down text-[var(--text-muted)]'"></span>
                            <span class="text-[12px] font-bold text-[var(--text-main)]">{{ group.group }}</span>
                            <div class="flex items-center justify-center rounded-full bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{{ group.models.length }}</div>
                        </div>
                    </button>

                    <div v-show="props.expandedGroups[group.group] !== false" class="divide-y divide-[var(--border-color)] border-t border-[var(--border-color)] bg-[var(--bg-input)]/10">
                        <div v-for="view in group.models" :key="view.model.localKey" data-saved-model-row class="group/model relative flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-[var(--bg-hover)]/40">
                            <div class="flex min-w-0 items-center gap-3">
                                <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--accent-bg)] text-[var(--accent-text)]"><span class="i-lucide-sparkles h-3.5 w-3.5"></span></div>
                                <div class="flex min-w-0 flex-col">
                                    <div class="flex items-center gap-2">
                                        <div class="truncate text-[13px] font-medium text-[var(--text-main)]">{{ view.model.name }}</div>
                                        <span class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ view.apiLabel }}</span>
                                        <span class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ view.apiSourceLabel }}</span>
                                        <span v-if="view.contextWindowLabel" class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">{{ view.contextWindowLabel }} ctx</span>
                                    </div>
                                    <div class="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{{ view.model.id }}</div>
                                    <div v-if="view.issues.length > 0" class="mt-1 flex max-w-[520px] items-center gap-1.5 text-[11px] text-[var(--status-warning)]" :title="view.issues.map((issue) => issue.message).join('\n')">
                                        <span class="i-lucide-triangle-alert h-3 w-3 shrink-0"></span><span class="truncate">{{ view.issues[0]?.message }}</span><span v-if="view.issues.length > 1" class="shrink-0 opacity-70">+{{ view.issues.length - 1 }}</span>
                                    </div>
                                    <div v-if="view.checkResult" class="mt-1 flex max-w-[520px] items-center gap-1.5 text-[11px]" :class="view.checkResult.cancelled ? 'text-[var(--text-muted)]' : view.checkResult.success ? 'text-[var(--status-success)]' : 'text-[var(--status-danger)]'" :title="view.checkResult.message">
                                        <span class="h-3 w-3 shrink-0" :class="view.checkResult.cancelled ? 'i-lucide-circle-slash' : view.checkResult.success ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"></span><span class="truncate">{{ view.checkResult.message }}</span><span v-if="view.checkResult.latencyMs !== null" class="shrink-0 opacity-70">{{ view.checkResult.latencyMs }}ms</span>
                                    </div>
                                </div>
                            </div>

                            <div class="flex shrink-0 items-center gap-1">
                                <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="view.checking || !view.runnable" :title="t('settings.panels.models.checkModel')" @click="emit('check-model', view.model)"><span class="h-3.5 w-3.5" :class="view.checking ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-play'"></span></button>
                                <button v-if="view.checking" class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger-bg)] hover:opacity-80" :title="t('settings.panels.models.cancelModelCheck')" @click="emit('cancel-model-check', view.model)"><span class="i-lucide-circle-x h-3.5 w-3.5"></span></button>
                                <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-main)]" :title="t('settings.panels.models.editSettings')" @click="emit('edit-model', view.model)"><span class="i-lucide-settings h-3.5 w-3.5"></span></button>
                                <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" :title="t('settings.panels.models.disableModel')" @click="emit('disable-model', view.model)"><span class="i-lucide-minus h-3.5 w-3.5"></span></button>
                                <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" :title="t('settings.panels.models.deleteModel')" @click="emit('delete-model', view.model)"><span class="i-lucide-trash-2 h-3.5 w-3.5"></span></button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div v-if="props.disabledModels.length > 0" class="mt-3 space-y-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2">
                <div class="px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)]">{{ t("settings.panels.models.disabledModels") }}</div>
                <div v-for="model in props.disabledModels" :key="model.localKey" class="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-[var(--bg-hover)]">
                    <div class="min-w-0"><div class="truncate text-xs text-[var(--text-main)]">{{ model.name || model.id }}</div><div class="truncate text-[10px] text-[var(--text-muted)]">{{ model.id }}</div></div>
                    <div class="flex shrink-0 items-center gap-1">
                        <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-input)] hover:text-[var(--text-main)]" :title="t('settings.panels.models.editSettings')" @click="emit('edit-model', model)"><span class="i-lucide-settings h-3.5 w-3.5"></span></button>
                        <button class="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--status-danger-bg)] hover:text-[var(--status-danger)]" :title="t('settings.panels.models.deleteModel')" @click="emit('delete-model', model)"><span class="i-lucide-trash-2 h-3.5 w-3.5"></span></button>
                    </div>
                </div>
            </div>
        </div>

        <div class="flex items-center gap-3 border-t border-[var(--border-color)] bg-[var(--bg-panel)] px-4 py-3">
            <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-4 text-xs font-medium text-[var(--status-success)] shadow-sm transition-all duration-200 hover:bg-[var(--status-success-bg)] active:scale-95" @click="emit('open-discovery')"><span class="i-lucide-list-filter h-3.5 w-3.5"></span>{{ t("settings.panels.models.discoverAndAdd") }}</button>
            <button class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-input)] px-4 text-xs font-medium text-[var(--text-main)] shadow-sm transition-all duration-200 hover:bg-[var(--bg-hover)] active:scale-95" @click="emit('open-library')"><span class="i-lucide-plus h-3.5 w-3.5"></span>{{ t("settings.panels.models.addFromLibrary") }}</button>
        </div>
    </div>
</template>
