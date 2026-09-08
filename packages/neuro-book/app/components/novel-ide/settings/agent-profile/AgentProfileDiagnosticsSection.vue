<script setup lang="ts">
import {computed} from "vue";
import {Button, Tooltip} from "@notnotype/nb-ui/components";
import type {AgentProfileDraft} from "./agent-profile-draft";

const props = withDefaults(defineProps<{
    profile: AgentProfileDraft;
    scope: "global" | "project";
    disabled?: boolean;
    resetHomeDisabled: boolean;
    resettingHome: boolean;
}>(), {
    disabled: false,
});

const emit = defineEmits<{
    (event: "reset"): void;
    (event: "reset-home"): void;
}>();

const {t} = useI18n();
const isProjectScope = computed(() => props.scope === "project");
</script>

<template>
    <section class="border-t border-[var(--divider)] pt-3">
        <h5 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-main)]">
            <span class="i-lucide-wrench h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true"></span>
            {{ t("settings.panels.profileModels.settingsView.diagnostics") }}
        </h5>
        <div class="flex flex-wrap items-center gap-2">
            <Tooltip :text="t('settings.panels.profileModels.settingsView.resetDefaultsHint')" placement="top">
                <Button size="sm" variant="ghost" :disabled="props.disabled" @click="emit('reset')">
                    <span class="i-lucide-rotate-ccw h-3 w-3" aria-hidden="true"></span>
                    {{ t("settings.panels.profileModels.settingsView.resetProfileDefaults") }}
                </Button>
            </Tooltip>
            <Button v-if="isProjectScope && props.profile.canResetHome" size="sm" variant="ghost" :disabled="props.resetHomeDisabled" @click="emit('reset-home')">
                <span :class="props.resettingHome ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-rotate-ccw'" class="h-3 w-3" aria-hidden="true"></span>
                {{ t("settings.panels.profileModels.resetHome") }}
            </Button>
        </div>
        <p v-if="props.profile.buildState.reason" class="mt-2 text-[11px] text-[var(--text-muted)]">
            <span class="font-medium">{{ t("settings.panels.profileModels.settingsView.buildStateReason") }}:</span> {{ props.profile.buildState.reason }}
        </p>
    </section>
</template>
