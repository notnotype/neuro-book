<script setup lang="ts">
import {computed} from "vue";
import {Badge} from "@notnotype/nb-ui/components";
import type {AgentProfileDraft} from "../agent-profile-draft";

const props = defineProps<{
    profile: AgentProfileDraft;
    descriptions: Record<string, string>;
    isDefaultProfile: boolean;
    buildHint: string;
}>();

const {t} = useI18n();

const description = computed(() => props.descriptions[props.profile.profileKey] ?? "");
const statusTone = computed(() => {
    if (props.profile.loadStatus === "loaded") return "success" as const;
    if (props.profile.loadStatus === "compiling") return "accent" as const;
    return "danger" as const;
});
</script>

<template>
    <div>
        <div class="flex flex-wrap items-center gap-2">
            <h4 class="text-base font-semibold text-[var(--text-main)]" tabindex="-1">{{ props.profile.name }}</h4>
            <Badge :tone="statusTone">{{ t(`settings.panels.profileModels.status.${props.profile.loadStatus}`) }}</Badge>
            <Badge v-if="props.isDefaultProfile" tone="accent">
                <span class="i-lucide-star h-2.5 w-2.5" aria-hidden="true"></span>
                {{ t("settings.panels.profileModels.currentDefault") }}
            </Badge>
        </div>
        <p v-if="description" class="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">{{ description }}</p>
        <!-- key 与来源合成一行元数据：两行各占一行会把标题区拉成四段小字。 -->
        <div class="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-[var(--text-muted)]">
            <span class="truncate">{{ props.profile.profileKey }}</span>
            <template v-if="props.profile.sourcePath">
                <span aria-hidden="true">·</span>
                <span class="min-w-0 flex-1 truncate" :title="props.profile.sourcePath">{{ props.profile.sourcePath }}</span>
            </template>
        </div>
        <div v-if="props.buildHint" class="mt-3 flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2 text-[11px] text-[var(--status-info)]">
            <span class="i-lucide-loader-2 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true"></span>
            <span>{{ props.buildHint }}</span>
        </div>
        <div v-if="props.profile.issue" class="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">
            <span class="i-lucide-alert-circle mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
            <div class="min-w-0">
                <div>{{ props.profile.issue.message }}</div>
                <div class="mt-0.5 font-mono text-[10px] opacity-80">{{ props.profile.issue.code }}</div>
            </div>
        </div>
    </div>
</template>
