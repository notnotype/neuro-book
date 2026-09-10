<script setup lang="ts">
import {computed} from "vue";
import {Badge} from "@notnotype/nb-ui/components";
import type {BadgeTone} from "@notnotype/nb-ui/components";

const props = defineProps<{
    /** 启动期 auth.enabled 的运行时状态；null 表示还没读到 session */
    authEnabled: boolean | null;
}>();

const {t} = useI18n();

const statusLabel = computed(() => {
    if (props.authEnabled === null) {
        return t("settings.security.statusUnknown");
    }
    return props.authEnabled ? t("settings.security.statusEnabled") : t("settings.security.statusDisabled");
});

const statusTone = computed<BadgeTone>(() => {
    if (props.authEnabled === null) {
        return "neutral";
    }
    return props.authEnabled ? "success" : "warning";
});

/** 与根目录 config.yaml 的字面对应：状态未知时给出可枚举的占位，不假装知道。 */
const authExample = computed(() => `auth:\n    enabled: ${props.authEnabled === null ? "<true|false>" : String(props.authEnabled)}`);
</script>

<template>
    <div class="security-view-root flex min-w-0 flex-col" data-lab-subject>
        <div class="flex items-start gap-[var(--space-3)]">
            <span class="i-lucide-shield-check mt-0.5 h-5 w-5 shrink-0 text-[var(--status-info)]" aria-hidden="true"></span>
            <div class="min-w-0">
                <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.security.title") }}</h2>
                <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.security.description") }}</p>
            </div>
        </div>

        <div class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
                <div class="min-w-0">
                    <div class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">auth.enabled</div>
                    <div class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.security.runtimeStatusDescription") }}</div>
                </div>
                <Badge class="shrink-0" variant="soft" :tone="statusTone">{{ statusLabel }}</Badge>
            </div>

            <div class="mt-[var(--space-4)] text-[var(--text-xs)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.security.exampleTitle") }}</div>
            <pre class="mt-[var(--space-2)] overflow-x-auto rounded-[var(--radius-control)] border border-[var(--divider)] bg-[var(--bg-input)] p-[var(--space-4)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ authExample }}</pre>

            <p class="mt-[var(--space-3)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--status-warning)]">{{ t("settings.security.warning") }}</p>
        </div>
    </div>
</template>
