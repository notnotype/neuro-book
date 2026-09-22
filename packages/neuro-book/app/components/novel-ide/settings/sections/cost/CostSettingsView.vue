<script setup lang="ts">
import {computed, useId} from "vue";
import {Button, RadioGroup} from "@notnotype/nb-ui/components";
import type {RadioOption} from "@notnotype/nb-ui/components";

/** 费用显示币种；汇率只影响展示，不写进配置。 */
export type CostDisplayCurrency = "USD" | "CNY";

const props = withDefaults(defineProps<{
    currency: CostDisplayCurrency;
    /** USD→CNY 汇率；null 表示本会话还没拿到 */
    exchangeRate: number | null;
    /** true 表示当前汇率来自本地缓存 */
    exchangeRateStale?: boolean;
    /** 汇率取回时间（ISO 字符串）；空串不显示 */
    exchangeRateFetchedAt?: string;
    /** 正在请求汇率 */
    refreshing?: boolean;
    disabled?: boolean;
}>(), {
    exchangeRateStale: false,
    exchangeRateFetchedAt: "",
    refreshing: false,
    disabled: false,
});

const emit = defineEmits<{
    (event: "update:currency", value: CostDisplayCurrency): void;
    (event: "refreshRate"): void;
}>();

const {t} = useI18n();
const groupId = `cost-currency-${useId()}`;

const currencyOptions = computed<RadioOption[]>(() => [
    {value: "USD", label: "USD", description: t("settings.panels.cost.usdDescription")},
    {value: "CNY", label: "CNY", description: t("settings.panels.cost.cnyDescription")},
]);

const exchangeRateLabel = computed(() => {
    if (!props.exchangeRate) {
        return t("settings.panels.cost.exchangeRateMissing");
    }
    const staleLabel = props.exchangeRateStale ? t("settings.panels.cost.cachedRate") : "";
    return `1 USD = ${props.exchangeRate.toFixed(4)} CNY${staleLabel}`;
});

const exchangeRateFetchedLabel = computed(() => {
    if (props.exchangeRateFetchedAt === "") {
        return "";
    }
    const date = new Date(props.exchangeRateFetchedAt);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    return t("settings.panels.cost.fetchedAt", {time: date.toLocaleString()});
});
</script>

<template>
    <div class="flex min-w-0 flex-col" data-lab-subject>
        <header class="shrink-0">
            <h2 class="text-[var(--text-base)] [font-weight:var(--weight-strong)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.cost.title") }}</h2>
            <p class="mt-[var(--space-1)] text-[var(--text-xs)] leading-[var(--leading-ui)] text-[var(--text-secondary)]">{{ t("settings.panels.cost.description") }}</p>
        </header>



        <div class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <h3 :id="groupId" class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ t("settings.panels.cost.currencyLabel") }}</h3>
            <RadioGroup
                class="mt-[var(--space-3)]"
                :model-value="props.currency"
                :options="currencyOptions"
                :disabled="props.disabled"
                :aria-label="t('settings.panels.cost.currencyLabel')"
                @update:model-value="emit('update:currency', $event as CostDisplayCurrency)"
            />
        </div>

        <div class="mt-[var(--space-4)] border-t border-[var(--divider)] pt-[var(--space-4)]">
            <div class="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
                <div class="min-w-0">
                    <div class="text-[var(--text-sm)] [font-weight:var(--weight-medium)] leading-[var(--leading-ui)] text-[var(--text-main)]">{{ exchangeRateLabel }}</div>
                    <div v-if="exchangeRateFetchedLabel" class="mt-[var(--space-1)] text-[var(--text-2xs)] leading-[var(--leading-ui)] text-[var(--text-muted)]">{{ exchangeRateFetchedLabel }}</div>
                </div>
                <Button
                    size="sm"
                    variant="secondary"
                    class="shrink-0"
                    :disabled="props.disabled || props.refreshing"
                    @click="emit('refreshRate')"
                >
                    <span v-if="props.refreshing" class="i-lucide-loader-2 mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true"></span>
                    <span v-else class="i-lucide-refresh-cw mr-1 h-3.5 w-3.5" aria-hidden="true"></span>
                    {{ t("settings.panels.cost.refreshRate") }}
                </Button>
            </div>
        </div>
    </div>
</template>
