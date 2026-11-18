<script setup lang="ts">
/**
 * 保存后的提示的夹具：注入 canon 的翻译端口（`canon-text.ts`），`receipt`、`close` 记成事件。
 */
import NoticeBar from "nbook/plugins/canon/web/components/NoticeBar.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof NoticeBar>(() => props.input, ["receipt", "close"]);
</script>

<template>
    <NoticeBar data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
