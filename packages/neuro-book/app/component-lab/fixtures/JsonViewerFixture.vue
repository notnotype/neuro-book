<script setup lang="ts">
import {ref} from "vue";
import JsonViewer from "../../components/common/JsonViewer.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof JsonViewer>(() => props.input, ["validation-change"]);
const hasErrors = ref(false);

function onValidationChange(next: boolean): void {
    hasErrors.value = next;
}
</script>

<template>
    <div class="flex h-full flex-col gap-2 p-3">
        <!-- update:value 由 model 层统一记录并回写；不保留会覆盖输入的镜像 ref。 -->
        <JsonViewer
            data-lab-subject
            v-bind="subject.bindings.value"
            class="min-h-0 flex-1"
            @validation-change="onValidationChange"
        />
        <p class="shrink-0 text-xs" :class="hasErrors ? 'text-[var(--status-danger)]' : 'text-[var(--text-muted)]'">
            {{ hasErrors ? "当前内容不是合法 JSON" : "当前内容可以解析" }}
        </p>
    </div>
</template>
