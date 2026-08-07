<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import type {ModelLibraryEntryDto} from "nbook/shared/dto/app-settings.dto";
import type {ModelLibraryGroup} from "nbook/app/components/novel-ide/settings/model-settings-view";

const props = defineProps<{
    modelValue: boolean;
    groups: ModelLibraryGroup[];
    searchQuery: string;
    expandedGroups: Record<string, boolean>;
    enabledModelIds: Set<string>;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
    (e: "update:searchQuery", value: string): void;
    (e: "toggle-group", group: string): void;
    (e: "toggle-model", model: ModelLibraryEntryDto): void;
}>();

const {t} = useI18n();
</script>

<template>
    <Dialog :model-value="props.modelValue" :title="t('settings.panels.models.modelLibrary')" width="800px" height="85%" overlay-type="opaque" :show-footer="false" @update:model-value="emit('update:modelValue', $event)">
        <!-- Model Library 与当前 Provider 可用性明确分离。 -->
        <div class="flex h-full flex-col gap-4 px-1 py-2">
            <div class="relative shrink-0"><span class="i-lucide-search absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"></span><input :value="props.searchQuery" type="text" :placeholder="t('settings.panels.models.searchModels')" class="h-9 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] pl-9 pr-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-main)]" @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)" /></div>
            <p class="shrink-0 rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2 text-xs text-[var(--status-info)]">{{ t("settings.panels.models.libraryNotDiscovered") }}</p>
            <div class="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 custom-scrollbar">
                <div v-if="props.groups.length === 0" class="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">{{ t("settings.panels.models.noMatchingModels") }}</div>
                <div v-else class="space-y-2">
                    <div v-for="group in props.groups" :key="group.group" class="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)]">
                        <button class="flex w-full items-center justify-between bg-[var(--bg-input)]/30 px-4 py-2 hover:bg-[var(--bg-hover)]/40" @click="emit('toggle-group', group.group)"><div class="flex items-center gap-2"><span class="h-3.5 w-3.5" :class="props.expandedGroups[group.group] === false ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'"></span><span class="text-[12px] font-bold text-[var(--text-main)]">{{ group.group }}</span><span class="rounded-full border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">{{ group.models.length }}</span></div></button>
                        <div v-show="props.expandedGroups[group.group] !== false" class="divide-y divide-[var(--border-color)] border-t border-[var(--border-color)]">
                            <div v-for="model in group.models" :key="model.id" class="flex items-center justify-between gap-4 px-4 py-3 hover:bg-[var(--bg-hover)]/40"><div class="min-w-0"><div class="truncate text-[13px] font-medium text-[var(--text-main)]">{{ model.name }}</div><div class="truncate text-[11px] text-[var(--text-muted)]">{{ model.id }}</div></div><button class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-input)]" @click="emit('toggle-model', model)"><span class="h-4 w-4" :class="props.enabledModelIds.has(model.id) ? 'i-lucide-minus' : 'i-lucide-plus'"></span></button></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </Dialog>
</template>
