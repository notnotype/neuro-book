<script setup lang="ts">
import {useId} from "vue";
import {FormInput, Switch} from "@notnotype/nb-ui/components";

const props = withDefaults(defineProps<{
    /** Pi 请求记录总开关 */
    enabled: boolean;
    /** 每会话保留条数；0 表示不裁剪 */
    maxRecords: number;
    disabled?: boolean;
    /** 就地保存进行中 */
    saving?: boolean;
    /** 保存失败原文；草稿仍保留在 props 里 */
    saveError?: string;
}>(), {
    disabled: false,
    saving: false,
    saveError: "",
});

const emit = defineEmits<{
    (event: "update:enabled", value: boolean): void;
    (event: "update:maxRecords", value: number): void;
}>();

const {t} = useI18n();
const enabledId = `observability-enabled-${useId()}`;
const maxRecordsId = `observability-max-records-${useId()}`;

/**
 * 就地保存：合法输入立刻写回，夹到 0..10000 的整数。
 * 空串与非数字不写回——清空输入框的过程不该把 0 落进配置。
 */
function updateMaxRecords(value: string): void {
    if (value.trim() === "") {
        return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return;
    }
    emit("update:maxRecords", Math.min(Math.max(Math.floor(parsed), 0), 10_000));
}
</script>

<template>
    <div class="flex min-w-0 flex-col" data-lab-subject>
        <header class="shrink-0">
            <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.observability.title") }}</h2>
            <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.observability.description") }}</p>
        </header>

        <!-- 就地保存的状态只在保存中或失败时出现，常态不占位 -->
        <p v-if="props.saveError" class="mt-[var(--space-3)] truncate text-[var(--text-xs)] text-[var(--status-danger)]">
            {{ t("settings.panels.observability.saveFailed") + "：" + props.saveError }}
        </p>
        <p v-else-if="props.saving" class="mt-[var(--space-3)] flex items-center gap-[var(--space-1)] text-[var(--text-xs)] text-[var(--status-info)]">
            <span class="i-lucide-loader-2 h-3 w-3 animate-spin" aria-hidden="true"></span>
            {{ t("common.saving") }}
        </p>

        <!-- 开关：整行可点，标题与说明都在标签里 -->
        <div class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <label :for="enabledId" class="flex cursor-pointer items-start gap-[var(--space-3)]">
                <span class="min-w-0 flex-1">
                    <span class="block text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.observability.enabledTitle") }}</span>
                    <span class="mt-[var(--space-1)] block text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.observability.enabledDescription") }}</span>
                </span>
                <Switch
                    :id="enabledId"
                    :model-value="props.enabled"
                    :disabled="props.disabled"
                    :aria-label="t('settings.panels.observability.enabledTitle')"
                    class="mt-[var(--space-1)] shrink-0"
                    @update:model-value="emit('update:enabled', $event)"
                />
            </label>
        </div>

        <div class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <label :for="maxRecordsId" class="block">
                <span class="block text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.observability.maxRecordsTitle") }}</span>
                <span class="mt-[var(--space-1)] block text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.observability.maxRecordsDescription") }}</span>
            </label>
            <FormInput
                :id="maxRecordsId"
                class="mt-[var(--space-3)] max-w-[220px]"
                type="number"
                inputmode="numeric"
                :model-value="String(props.maxRecords)"
                :disabled="props.disabled"
                min="0"
                max="10000"
                step="10"
                @update:model-value="updateMaxRecords"
            />
        </div>

        <p class="mt-[var(--space-4)] flex items-start gap-[var(--space-2)] border-t border-[var(--divider)] pt-[var(--space-3)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">
            <span class="i-lucide-shield-alert mt-[1px] h-3.5 w-3.5 shrink-0" aria-hidden="true"></span>
            <span class="min-w-0">{{ t("settings.panels.observability.privacyNote") }}</span>
        </p>
    </div>
</template>
