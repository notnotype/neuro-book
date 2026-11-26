<script setup lang="ts">
/** “原始数据”的夹具：注入 canon 的翻译端口（`canon-text.ts`），放在条目页内容列那么宽的一栏里；“再显示”“重试”记成事件。 */
import ComponentRawView from "nbook/plugins/canon/web/components/ComponentRawView.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof ComponentRawView>(() => props.input, ["more", "retry"]);
</script>

<template>
    <div class="h-full w-full overflow-y-auto p-6">
        <ComponentRawView data-lab-subject class="mx-auto max-w-[760px]" v-bind="subject.bindings.value" />
    </div>
</template>
