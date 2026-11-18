<script setup lang="ts">
/**
 * 条目树的夹具：注入 canon 的翻译端口（`canon-text.ts`）。展开状态是场景的双向绑定，由 Lab 管；`open`、`more`、`retry` 记成
 * 事件。
 */
import EntryTree from "nbook/plugins/canon/web/components/EntryTree.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof EntryTree>(() => props.input, ["open", "more", "retry"]);
</script>

<template>
    <EntryTree data-lab-subject class="w-72" v-bind="subject.bindings.value" />
</template>
