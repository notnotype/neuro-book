<script setup lang="ts">
import CostSettingsView from "../../components/novel-ide/settings/sections/cost/CostSettingsView.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof CostSettingsView>(() => props.input, ["refreshRate"]);
/** 刷新汇率：fixture 只换一个确定值并记录事件，不访问网络。 */
function refreshRate(): void {
    subject.write("props", "exchangeRate", 7.2455);
    subject.write("props", "exchangeRateStale", false);
    subject.write("props", "exchangeRateFetchedAt", "2026-09-10T03:00:00.000Z");
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <CostSettingsView
                v-bind="subject.bindings.value"
                @refresh-rate="refreshRate"
            />
        </div>
    </div>
</template>
