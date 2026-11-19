<script setup lang="ts">
/**
 * Agent 提示的夹具：注入 canon 的翻译端口（`canon-text.ts`），四个动作记成事件。
 */
import AgentNotice from "nbook/plugins/canon/web/components/AgentNotice.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof AgentNotice>(() => props.input, ["receipt", "undo", "revisions", "close"]);
</script>

<template>
    <AgentNotice data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
