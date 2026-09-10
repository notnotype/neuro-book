<script setup lang="ts">
import {computed, ref, watch} from "vue";
import CostSettingsView from "../../components/novel-ide/settings/views/CostSettingsView.vue";
import type {CostDisplayCurrency} from "../../components/novel-ide/settings/views/CostSettingsView.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "cny" | "stale" | "missing-rate" | "refreshing" | "save-error";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "cny", "stale", "missing-rate", "refreshing", "save-error"];
    return known.find((key) => key === props.scene) ?? "default";
});

const currency = ref<CostDisplayCurrency>("USD");
const exchangeRate = ref<number | null>(7.2413);
const exchangeRateStale = ref(false);
const fetchedAt = ref("2026-09-10T02:15:00.000Z");
const saveError = ref("");

const refreshing = computed(() => sceneKey.value === "refreshing");

watch(sceneKey, (scene) => {
    currency.value = scene === "cny" ? "CNY" : "USD";
    exchangeRate.value = scene === "missing-rate" ? null : scene === "stale" ? 7.1802 : 7.2413;
    exchangeRateStale.value = scene === "stale";
    fetchedAt.value = scene === "missing-rate" ? "" : scene === "stale" ? "2026-09-08T07:40:00.000Z" : "2026-09-10T02:15:00.000Z";
    saveError.value = scene === "save-error" ? "示例后端返回 500" : "";
}, {immediate: true});

watch([currency, exchangeRate, exchangeRateStale, fetchedAt, refreshing, saveError], () => {
    syncLabData({
        currency: currency.value,
        exchangeRate: exchangeRate.value,
        exchangeRateStale: exchangeRateStale.value,
        exchangeRateFetchedAt: fetchedAt.value,
        refreshing: refreshing.value,
        saveError: saveError.value,
    });
}, {immediate: true});

function updateCurrency(value: CostDisplayCurrency): void {
    currency.value = value;
    emitLabEvent("update:currency", {currency: value});
}

/** 刷新汇率：fixture 只换一个确定值并记录事件，不访问网络。 */
function refreshRate(): void {
    exchangeRate.value = 7.2455;
    exchangeRateStale.value = false;
    fetchedAt.value = "2026-09-10T03:00:00.000Z";
    emitLabEvent("refreshRate", {exchangeRate: exchangeRate.value});
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <CostSettingsView
                :currency="currency"
                :exchange-rate="exchangeRate"
                :exchange-rate-stale="exchangeRateStale"
                :exchange-rate-fetched-at="fetchedAt"
                :refreshing="refreshing"
                :save-error="saveError"
                @update:currency="updateCurrency"
                @refresh-rate="refreshRate"
            />
        </div>
    </div>
</template>
