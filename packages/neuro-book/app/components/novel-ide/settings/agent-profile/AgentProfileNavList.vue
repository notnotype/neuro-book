<script setup lang="ts">
import {computed, useId} from "vue";
import {Badge, FormInput, Tooltip} from "@notnotype/nb-ui/components";
import type {BadgeTone} from "@notnotype/nb-ui/components";
import type {AgentProfileNavItem, ProfileLoadStatus} from "./AgentProfileNavList.types";

const props = defineProps<{
    items: AgentProfileNavItem[];
    activeKey: string;
    search: string;
    defaultsDirty: boolean;
}>();

const emit = defineEmits<{
    (event: "update:activeKey", value: string): void;
    (event: "update:search", value: string): void;
}>();

const {t} = useI18n();
const headingId = `agent-profile-nav-${useId()}`;
const searchId = `agent-profile-search-${useId()}`;
const isDefaultsActive = computed(() => props.activeKey === "");

const filteredItems = computed(() => {
    const keyword = props.search.trim().toLowerCase();
    if (keyword === "") return props.items;
    return props.items.filter((item) => item.profileKey.toLowerCase().includes(keyword) || item.name.toLowerCase().includes(keyword));
});

type StatusBadge = {tone: BadgeTone; label: string};

const statusTones: Record<ProfileLoadStatus, BadgeTone> = {
    loaded: "success",
    compiling: "accent",
    compile_failed: "danger",
    not_compiled: "warning",
    compile_stale: "warning",
    compiled_load_failed: "danger",
    source_error: "danger",
};

const statusIcons: Record<ProfileLoadStatus, string> = {
    loaded: "i-lucide-circle-check",
    compiling: "i-lucide-loader-circle",
    compile_failed: "i-lucide-circle-alert",
    not_compiled: "i-lucide-refresh-cw",
    compile_stale: "i-lucide-refresh-cw",
    compiled_load_failed: "i-lucide-circle-alert",
    source_error: "i-lucide-circle-alert",
};

function getStatusBadge(status: ProfileLoadStatus): StatusBadge {
    return {tone: statusTones[status], label: t(`settings.panels.profileModels.status.${status}`)};
}

function statusIconToneClass(status: ProfileLoadStatus): string {
    if (status === "loaded") return "text-[var(--status-success)]";
    if (status === "compiling") return "text-[var(--accent-main)]";
    if (status === "not_compiled" || status === "compile_stale") return "text-[var(--status-warning)]";
    return "text-[var(--status-danger)]";
}
</script>

<template>
    <nav
        :aria-labelledby="headingId"
        class="flex h-full min-h-0 min-w-0 flex-col gap-[var(--space-4)] overflow-hidden rounded-[var(--radius-panel)] border border-[var(--panel-outline)] bg-[var(--panel-surface)] p-[var(--space-3)] text-[var(--text-main)]"
    >
        <header class="flex shrink-0 items-center gap-[var(--space-2)] border-b border-[var(--divider)] pb-[var(--space-3)]">
            <span class="i-lucide-bot h-4 w-4 shrink-0 text-[var(--accent-main)]" aria-hidden="true"></span>
            <h2 :id="headingId" class="min-w-0 truncate text-[var(--text-sm)] [font-weight:var(--weight-strong)]">Agent Profiles</h2>
            <span class="i-lucide-command ml-auto h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
        </header>

        <div class="flex shrink-0 items-center gap-[var(--space-1)]">
            <label class="block min-w-0 flex-1" :for="searchId">
                <span class="sr-only">{{ t("settings.panels.profileModels.nav.searchPlaceholder") }}</span>
                <FormInput
                    :id="searchId"
                    :model-value="props.search"
                    type="search"
                    size="sm"
                    icon-class="i-lucide-search"
                    :placeholder="t('settings.panels.profileModels.nav.searchPlaceholder')"
                    class="w-full"
                    @update:model-value="emit('update:search', $event)"
                />
            </label>
            <Tooltip :text="t('settings.panels.profileModels.nav.profilesHint')" placement="right">
                <button type="button" class="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-main)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]" aria-label="Profile 说明">
                    <span class="i-lucide-info h-3.5 w-3.5" aria-hidden="true"></span>
                </button>
            </Tooltip>
        </div>
        <div class="shrink-0 border-b border-[var(--divider)] pb-[var(--space-4)]">
            <button
                type="button"
                class="agent-profile-nav__button group relative flex w-full cursor-pointer min-w-0 items-start gap-[var(--space-2)] overflow-hidden rounded-[var(--radius-control)] px-[var(--space-3)] py-[var(--space-3)] text-left transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                :class="isDefaultsActive ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'"
                :aria-current="isDefaultsActive ? 'page' : undefined"
                @click="emit('update:activeKey', '')"
            >
                <span class="absolute inset-y-[var(--space-3)] left-0 w-0.5 rounded-full bg-[var(--accent-main)] transition-opacity [transition-duration:var(--motion-fast)]" :class="isDefaultsActive ? 'opacity-100' : 'opacity-0'" aria-hidden="true"></span>
                <span
                    class="i-lucide-sliders-horizontal mt-[var(--space-1)] h-4 w-4 shrink-0"
                    :class="isDefaultsActive ? 'text-[var(--accent-main)]' : 'text-[var(--text-secondary)]'"
                    aria-hidden="true"
                ></span>
                <span class="min-w-0 flex-1">
                    <span class="flex min-w-0 flex-1 items-center gap-[var(--space-1)]">
                        <span class="min-w-0 truncate text-[var(--text-sm)] leading-[var(--leading-ui)] [font-weight:var(--weight-medium)]" :class="isDefaultsActive ? 'text-[var(--accent-text)]' : 'text-[var(--text-main)]'">{{ t("settings.panels.profileModels.nav.defaults") }}</span>
                        <Tooltip :text="t('settings.panels.profileModels.nav.defaultsDescription')" placement="right">
                            <button type="button" class="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-main)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]" :aria-label="t('settings.panels.profileModels.nav.defaultsDescription')">
                                <span class="i-lucide-info h-3.5 w-3.5" aria-hidden="true"></span>
                            </button>
                        </Tooltip>
                        <span class="i-lucide-chevron-right ml-auto h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] transition-transform [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] group-hover:translate-x-0.5 group-hover:text-[var(--text-main)]" aria-hidden="true"></span>
                    </span>
                    <span v-if="props.defaultsDirty" class="mt-[var(--space-1)] flex h-5 items-center gap-[var(--space-1)] pl-[var(--space-5)]">
                        <span class="i-lucide-triangle-alert h-3 w-3 shrink-0 text-[var(--status-warning)]" aria-hidden="true"></span>
                        <Badge tone="warning" variant="soft" size="sm">{{ t("settings.panels.profileModels.unsavedChanges") }}</Badge>
                    </span>
                </span>
            </button>
        </div>

        <ul class="custom-scrollbar flex min-h-0 flex-1 flex-col gap-[var(--space-2)] overflow-y-auto pr-[var(--space-1)]" aria-label="Profile 列表">
            <li v-for="item in filteredItems" :key="item.profileKey" class="min-w-0">
                <button
                    type="button"
                    class="agent-profile-nav__button group relative flex w-full cursor-pointer min-w-0 items-start gap-[var(--space-2)] overflow-hidden rounded-[var(--radius-control)] px-[var(--space-3)] py-[var(--space-3)] text-left transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                    :class="props.activeKey === item.profileKey ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'"
                    :aria-current="props.activeKey === item.profileKey ? 'page' : undefined"
                    :title="`${item.name} · ${item.profileKey}`"
                    @click="emit('update:activeKey', item.profileKey)"
                >
                    <span class="absolute inset-y-[var(--space-3)] left-0 w-0.5 rounded-full bg-[var(--accent-main)] transition-opacity [transition-duration:var(--motion-fast)]" :class="props.activeKey === item.profileKey ? 'opacity-100' : 'opacity-0'" aria-hidden="true"></span>
                    <span class="min-w-0 flex-1">
                        <span class="flex min-w-0 items-center gap-[var(--space-2)]">
                            <span v-if="item.iconClass" class="h-4 w-4 shrink-0" :class="item.iconClass" aria-hidden="true"></span>
                            <span class="truncate text-[var(--text-sm)] leading-[var(--leading-ui)] [font-weight:var(--weight-medium)]" :class="props.activeKey === item.profileKey ? 'text-[var(--accent-text)]' : 'text-[var(--text-main)]'">{{ item.name }}</span>
                            <span class="min-w-0 flex-1 truncate font-mono text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ item.profileKey }}</span>
                            <span class="h-4 w-4 shrink-0" :class="[statusIcons[item.status], statusIconToneClass(item.status), item.status === 'compiling' ? 'animate-spin' : undefined]" aria-hidden="true"></span>
                        </span>
                        <span class="mt-[var(--space-2)] flex h-5 min-w-0 flex-wrap items-center gap-[var(--space-1)] overflow-hidden">
                            <Badge :tone="getStatusBadge(item.status).tone" variant="soft" size="sm">{{ getStatusBadge(item.status).label }}</Badge>
                            <Badge v-if="item.isDefault" tone="accent" variant="soft" size="sm">{{ t("settings.panels.profileModels.currentDefault") }}</Badge>
                            <Badge v-if="item.dirty" tone="warning" variant="soft" size="sm">{{ t("settings.panels.profileModels.unsavedChanges") }}</Badge>
                            <Badge v-if="item.overrideCount > 0" tone="neutral" variant="soft" size="sm">{{ t("settings.panels.profileModels.overrideCount", {count: item.overrideCount}) }}</Badge>
                        </span>
                    </span>
                </button>
            </li>
            <li v-if="filteredItems.length === 0" class="rounded-[var(--radius-control)] border border-dashed border-[var(--divider)] bg-[var(--bg-subtle)] px-[var(--space-4)] py-[var(--space-8)] text-center text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">
                {{ props.items.length === 0 ? t("settings.panels.profileModels.nav.empty") : t("settings.panels.profileModels.nav.noMatch") }}
            </li>
        </ul>
    </nav>
</template>

<style scoped>
.agent-profile-nav__button {
    border: 0;
}
</style>
