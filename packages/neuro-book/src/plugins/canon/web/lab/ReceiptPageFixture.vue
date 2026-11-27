<script setup lang="ts">
/**
 * 回执页骨架的夹具：注入 canon 的翻译端口（`canon-text.ts`）；`open`、`receipt`、`revert`、`retry` 记成事件。
 */
import ReceiptPage from "nbook/plugins/canon/web/components/revisions/ReceiptPage.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof ReceiptPage>(() => props.input, ["open", "receipt", "revert", "retry"]);
</script>

<template>
    <ReceiptPage data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
