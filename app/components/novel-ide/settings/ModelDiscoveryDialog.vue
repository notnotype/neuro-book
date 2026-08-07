<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {DiscoveryListModel, DiscoveryModelGroup, ManualModelDraft, ModelApiOption} from "nbook/app/components/novel-ide/settings/model-settings-view";

const props = defineProps<{
    modelValue: boolean;
    providerName: string;
    groups: DiscoveryModelGroup[];
    searchQuery: string;
    discovering: boolean;
    expandedGroups: Record<string, boolean>;
    manualDraft: ManualModelDraft;
    modelApiOptions: ModelApiOption[];
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "update:searchQuery", value: string): void;
    (e: "update-manual-field", field: keyof ManualModelDraft, value: string): void;
    (e: "discover"): void;
    (e: "toggle-group", group: string): void;
    (e: "toggle-model", model: DiscoveryListModel): void;
    (e: "add-manual"): void;
}>();

const {t} = useI18n();
</script>

<template>
    <Dialog :model-value="props.modelValue" :title="t('settings.panels.models.discoveryTitle', {provider: props.providerName})" width="800px" height="85%" overlay-type="opaque" :show-footer="false" @update:model-value="emit('update:modelValue', $event)">
        <!-- Automatic Model Discovery 本次会话结果。 -->
        <div class="flex h-full flex-col gap-4 px-1 py-2">
            <div class="flex shrink-0 items-center gap-3">
                <div class="relative flex-1">
                    <span class="i-lucide-search absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"></span>
                    <input :value="props.searchQuery" type="text" :placeholder="t('settings.panels.models.searchModels')" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] pl-9 pr-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]" @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)" />
                </div>
                <button class="flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-main)] disabled:opacity-50" :disabled="props.discovering" :title="t('settings.panels.models.refreshModels')" @click="emit('discover')">
                    <span class="h-4 w-4" :class="props.discovering ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-refresh-cw'"></span>{{ t("settings.panels.models.refresh") }}
                </button>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 custom-scrollbar">
                <div v-if="props.groups.length === 0" class="flex h-full flex-col items-center justify-center py-20 text-center"><span class="i-lucide-search-x mb-2 h-8 w-8 text-[var(--text-muted)] opacity-50"></span><span class="text-sm text-[var(--text-muted)]">{{ t("settings.panels.models.noMatchingModels") }}</span></div>
                <div v-else class="space-y-2">
                    <div v-for="group in props.groups" :key="group.group" class="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] shadow-sm">
                        <button class="flex w-full items-center justify-between bg-[var(--bg-input)]/30 px-4 py-2 transition-colors hover:bg-[var(--bg-hover)]/40" @click="emit('toggle-group', group.group)">
                            <div class="flex items-center gap-2"><span class="h-3.5 w-3.5 shrink-0 transition-transform duration-200" :class="props.expandedGroups[group.group] === false ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down text-[var(--text-muted)]'"></span><span class="text-[12px] font-bold text-[var(--text-main)]">{{ group.group }}</span><div class="flex items-center justify-center rounded-full border border-[var(--border-color)] bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">{{ group.models.length }}</div></div>
                        </button>
                        <div v-show="props.expandedGroups[group.group] !== false" class="divide-y divide-[var(--border-color)] border-t border-[var(--border-color)] bg-[var(--bg-panel)]">
                            <div v-for="model in group.models" :key="`${group.group}-${model.id}`" class="flex items-center justify-between px-4 py-3 transition-colors hover:bg-[var(--bg-hover)]/40" :class="{'opacity-60': model.state !== 'enabled'}">
                                <div class="flex min-w-0 flex-1 items-center gap-3 pr-4">
                                    <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[var(--accent-bg)] text-[var(--accent-text)]"><span class="i-lucide-sparkles h-3.5 w-3.5"></span></div>
                                    <div class="flex min-w-0 flex-col"><div class="flex min-w-0 items-center gap-2"><div class="truncate text-[13px] font-medium text-[var(--text-main)]">{{ model.name }}</div><span v-if="model.state === 'remote-complete'" class="shrink-0 rounded border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-1.5 py-0.5 text-[9px] text-[var(--status-success)]">{{ t("settings.panels.models.remoteComplete") }}</span><span v-else-if="model.state === 'remote-incomplete'" class="shrink-0 rounded border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-1.5 py-0.5 text-[9px] text-[var(--status-warning)]">{{ t("settings.panels.models.needsManualCompletion") }}</span><span v-else-if="model.state === 'enabled'" class="shrink-0 rounded border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-1.5 py-0.5 text-[9px] text-[var(--status-success)]">{{ t("settings.panels.models.enabled") }}</span><span v-else class="shrink-0 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1.5 py-0.5 text-[9px] text-[var(--text-muted)]">{{ t("settings.panels.models.disabled") }}</span></div><div class="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{{ model.id }}</div></div>
                                </div>
                                <button class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-main)] active:scale-95" @click="emit('toggle-model', model)"><span class="h-4 w-4" :class="model.state === 'enabled' ? 'i-lucide-minus' : 'i-lucide-plus'"></span></button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="shrink-0 rounded-xl border border-[var(--border-color)] bg-[var(--bg-input)]/30 p-3">
                <div class="flex flex-wrap items-center gap-3">
                    <FormInput :model-value="props.manualDraft.name" :placeholder="t('settings.panels.models.manualName')" class="flex-1 bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" @update:model-value="emit('update-manual-field', 'name', $event)" />
                    <FormInput :model-value="props.manualDraft.id" :placeholder="t('settings.panels.models.manualId')" class="flex-1 bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" @update:model-value="emit('update-manual-field', 'id', $event)" />
                    <div class="w-[190px]"><FormSelect :model-value="props.manualDraft.api" :options="props.modelApiOptions" :placeholder="t('settings.panels.models.apiFormat')" @update:model-value="emit('update-manual-field', 'api', $event)" /></div>
                    <FormInput :model-value="props.manualDraft.contextWindowTokens" :placeholder="t('settings.panels.models.contextWindow')" class="w-[120px] bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" @update:model-value="emit('update-manual-field', 'contextWindowTokens', $event)" />
                    <FormInput :model-value="props.manualDraft.maxTokens" :placeholder="t('settings.panels.models.maxTokens')" class="w-[120px] bg-[var(--bg-panel)] shadow-sm !h-8 !text-xs" @update:model-value="emit('update-manual-field', 'maxTokens', $event)" />
                    <button class="inline-flex h-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent-main)] px-3 text-xs font-medium text-[var(--text-inverse)] shadow-sm transition-all hover:opacity-90 active:scale-95" @click="emit('add-manual')">{{ t("settings.panels.models.add") }}</button>
                </div>
            </div>
        </div>
    </Dialog>
</template>
