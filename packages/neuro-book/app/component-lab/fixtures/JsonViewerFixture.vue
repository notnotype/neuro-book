<script setup lang="ts">
import {ref, watch} from "vue";
import JsonViewer from "../../components/common/JsonViewer.vue";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
// 假数据 tab 改的是 props.data，编辑器里改的是这份本地副本，两条路都要能改到值。
const value = ref<unknown>(props.data);
const hasErrors = ref(false);

watch(() => props.data, (next) => {
    value.value = next;
    hasErrors.value = false;
}, {immediate: true});

function onValue(next: unknown): void {
    value.value = next;
    emitLabEvent("update:value", next);
}

function onValidationChange(next: boolean): void {
    hasErrors.value = next;
    emitLabEvent("validation-change", next);
}
</script>

<template>
    <div class="flex h-full flex-col gap-2 p-3">
        <!-- 事件名是 update:value，写 v-model 会静默失效 -->
        <JsonViewer
            data-lab-subject
            :value="value"
            :read-only="false"
            :max-height="0"
            class="min-h-0 flex-1"
            @update:value="onValue"
            @validation-change="onValidationChange"
        />
        <p class="shrink-0 text-xs" :class="hasErrors ? 'text-[var(--status-danger)]' : 'text-[var(--text-muted)]'">
            {{ hasErrors ? "当前内容不是合法 JSON" : "当前内容可以解析" }}
        </p>
    </div>
</template>
