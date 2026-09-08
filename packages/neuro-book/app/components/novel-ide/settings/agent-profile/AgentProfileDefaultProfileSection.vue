<script setup lang="ts">
import {computed} from "vue";
import {FormSelect, type FormSelectOption} from "@notnotype/nb-ui/components";
const props = defineProps<{
    scope: "global" | "project";
    defaultProfileKey: string;
    defaultProfileOptions: FormSelectOption[];
    effectiveDefaultProfileKey: string;
    disabled: boolean;
}>();

const emit = defineEmits<{
    (event: "update:defaultProfileKey", value: string): void;
}>();

const {t} = useI18n();
const isProjectScope = computed(() => props.scope === "project");
</script>

<template>
    <section class="space-y-3">
        <div class="border-b border-[var(--divider)] pb-3">
            <h4 class="text-sm font-semibold text-[var(--text-main)]">{{ t("settings.panels.defaultProfile.title") }}</h4>
            <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ isProjectScope ? t("settings.panels.defaultProfile.projectDescription") : t("settings.panels.defaultProfile.globalDescription") }}</p>
        </div>
        <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)]">
            <div class="space-y-1.5">
                <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.defaultProfile.title") }}</label>
                <FormSelect :model-value="props.defaultProfileKey" :options="props.defaultProfileOptions" :placeholder="t('settings.panels.defaultProfile.selectPlaceholder')" :disabled="props.disabled" @update:model-value="emit('update:defaultProfileKey', $event)" />
            </div>
            <div class="space-y-1.5">
                <label class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.defaultProfile.currentEffective") }}</label>
                <div class="flex h-7 w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--panel-outline)] bg-[var(--bg-input)] px-2.5 text-[12px]">
                    <span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--status-success)]"></span>
                    <span class="truncate font-mono text-[11px] font-semibold text-[var(--text-main)]">{{ props.effectiveDefaultProfileKey || "-" }}</span>
                </div>
            </div>
        </div>
    </section>
</template>
