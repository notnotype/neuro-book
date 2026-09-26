<script setup lang="ts">
import {ref, watch} from "vue";
import SettingsLoadState from "../../components/novel-ide/settings/sections/components/SettingsLoadState.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof SettingsLoadState>(() => props.input, ["retry"]);
const retryCount = ref(0);
watch(() => props.scene, () => { retryCount.value = 0; });

/** 组件只发 retry，不伪造「重试成功」。 */
function onRetry(): void {
    retryCount.value += 1;
}
</script>

<template>
    <div class="flex h-full min-h-0 min-w-0 flex-col gap-[var(--space-3)] overflow-y-auto p-[var(--space-4)]">
        <p class="flex shrink-0 flex-wrap items-center justify-between gap-x-[var(--space-3)] gap-y-1 text-[var(--text-xs)] text-[var(--text-secondary)]">
            <span>夹具只记录组件发出的 retry，不接真实读取：这里没有「重试成功」这回事。</span>
            <span class="shrink-0 tabular-nums text-[var(--text-main)]">retry 次数：{{ retryCount }}</span>
        </p>

        <!-- 组件根是 h-full：不给确定高度就看不出它占满整块、也看不出两种形态都在里面居中。 -->
        <div class="h-[320px] w-full shrink-0 overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-panel)]">
            <SettingsLoadState
                data-lab-subject
                v-bind="subject.bindings.value"
                @retry="onRetry"
            />
        </div>
    </div>
</template>
