<script setup lang="ts">
/**
 * 来历列表的夹具：注入 canon 的翻译端口（`canon-text.ts`），`more`、`retry`、`change` 记成事件。
 */
import OriginList from "nbook/plugins/canon/web/components/groups/OriginList.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof OriginList>(() => props.input, ["more", "retry", "change"]);
</script>

<template>
    <OriginList data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
