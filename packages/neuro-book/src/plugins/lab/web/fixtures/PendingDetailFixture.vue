<script setup lang="ts">
/**
 * 待处理详情的夹具：注入 canon 的翻译端口（`canon-text.ts`）；点开对象与打开章节记成事件。
 */
import PendingDetail from "nbook/plugins/canon/web/components/revisions/PendingDetail.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof PendingDetail>(() => props.input, ["open", "open-chapter"]);
</script>

<template>
    <PendingDetail data-lab-subject class="w-full max-w-xl" v-bind="subject.bindings.value" />
</template>
