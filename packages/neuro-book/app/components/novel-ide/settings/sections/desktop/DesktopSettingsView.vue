<script setup lang="ts">
import {computed, useId} from "vue";
import {FormSelect, Switch} from "@notnotype/nb-ui/components";
import type {FormSelectOption} from "@notnotype/nb-ui/components";
import type {DesktopSettings, DesktopSettingsPatch, DesktopStatus} from "@notnotype/neuro-book-contracts/desktop";

const props = withDefaults(defineProps<{
    /** 设备本地设置；真值由 Desktop Bridge 持有，视图只消费 */
    settings: DesktopSettings;
    /** 桥返回的设备状态；null 表示当前不是 Desktop Envelope（网页宿主） */
    status?: DesktopStatus | null;
    saving?: boolean;
    /** 更新失败原文；草稿仍保留在 props 里 */
    saveError?: string;
}>(), {
    status: null,
    saving: false,
    saveError: "",
});

const emit = defineEmits<{
    (event: "update:settings", patch: DesktopSettingsPatch): void;
}>();

const {t} = useI18n();
const trayId = `desktop-settings-${useId()}-tray`;

const connectionLabel = computed(() => props.status?.connection === "remote"
    ? t("settings.desktop.remoteStatus")
    : t("settings.desktop.localStatus"));

const closeOptions = computed<FormSelectOption[]>(() => [
    {value: "ask", label: t("settings.desktop.closeAsk")},
    {value: "tray", label: t("settings.desktop.closeTray")},
    {value: "quit", label: t("settings.desktop.closeQuit")},
]);

const zoomPercent = computed(() => `${Math.round(props.settings.zoomFactor * 100)}%`);

function updateZoom(value: string): void {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return;
    }
    emit("update:settings", {zoomFactor: parsed});
}

function updateCloseBehavior(value: string): void {
    if (value === "ask" || value === "tray" || value === "quit") {
        emit("update:settings", {closeBehavior: value});
    }
}
</script>

<template>
    <div class="desktop-view-root flex min-w-0 flex-col" data-lab-subject>
        <div class="flex items-start gap-[var(--space-3)]">
            <span class="i-lucide-panels-top-left mt-0.5 h-5 w-5 shrink-0 text-[var(--status-info)]" aria-hidden="true"></span>
            <div class="min-w-0">
                <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.desktop.title") }}</h2>
                <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.desktop.description") }}</p>
                <p v-if="props.status" class="mt-[var(--space-2)] text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">
                    {{ connectionLabel }} · {{ props.status.version }}
                </p>
            </div>
        </div>

        <p v-if="props.saveError" class="mt-[var(--space-3)] truncate text-[var(--text-xs)] text-[var(--status-danger)]">
            {{ t("settings.desktop.updateFailed") + "：" + props.saveError }}
        </p>
        <p v-else-if="props.saving" class="mt-[var(--space-3)] flex items-center gap-[var(--space-1)] text-[var(--text-xs)] text-[var(--status-info)]">
            <span class="i-lucide-loader-2 h-3 w-3 animate-spin" aria-hidden="true"></span>
            {{ t("common.saving") }}
        </p>

        <div class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
                <div class="min-w-0">
                    <div class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.desktop.zoomTitle") }}</div>
                    <div class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.desktop.zoomDescription") }}</div>
                </div>
                <output class="shrink-0 text-[var(--text-sm)] [font-weight:var(--weight-strong)] text-[var(--accent-main)]">{{ zoomPercent }}</output>
            </div>
            <input
                class="mt-[var(--space-3)] w-full accent-[var(--accent-main)]"
                type="range"
                min="0.75"
                max="2"
                step="0.05"
                :value="props.settings.zoomFactor"
                :disabled="props.saving"
                :aria-label="t('settings.desktop.zoomTitle')"
                @change="updateZoom(($event.target as HTMLInputElement).value)"
            >
        </div>

        <div class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <label :for="trayId" class="flex cursor-pointer items-start gap-[var(--space-3)]">
                <span class="min-w-0 flex-1">
                    <span class="block text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.desktop.trayTitle") }}</span>
                    <span class="mt-[var(--space-1)] block text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.desktop.trayDescription") }}</span>
                </span>
                <Switch
                    :id="trayId"
                    class="mt-[var(--space-1)] shrink-0"
                    :model-value="props.settings.trayEnabled"
                    :disabled="props.saving"
                    :aria-label="t('settings.desktop.trayTitle')"
                    @update:model-value="emit('update:settings', {trayEnabled: $event})"
                />
            </label>
        </div>

        <div class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.desktop.closeTitle") }}</div>
            <div class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.desktop.closeDescription") }}</div>
            <FormSelect
                class="mt-[var(--space-3)] max-w-[280px]"
                :model-value="props.settings.closeBehavior"
                :options="closeOptions"
                :disabled="props.saving"
                :aria-label="t('settings.desktop.closeTitle')"
                @update:model-value="updateCloseBehavior"
            />
        </div>
    </div>
</template>

<style scoped>
.desktop-view-root {
    container-type: inline-size;
}
</style>
