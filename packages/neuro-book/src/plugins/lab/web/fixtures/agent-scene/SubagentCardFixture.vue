<script setup lang="ts">
/** 子代理卡片与后台命令卡片的 Lab 夹具：按场景注入样本数据（`subagent-store.ts`），卡片照真实的注入取。 */
import {computed, provide} from "vue";

import type {LabSceneInput} from "../../lab-subject";

import BackgroundCommandCard from "nbook/plugins/agent/web/components/BackgroundCommandCard.vue";
import SubagentCard from "nbook/plugins/agent/web/components/SubagentCard.vue";
import {subagentStoreKey} from "nbook/plugins/agent/web/subagent-store";

import {CARD_SAMPLES, COMMAND_SAMPLES, sampleProps, sampleStore} from "./subagent-samples";

/** 场景 id 以 `command-` 开头的是后台命令卡片，以 `-narrow` 结尾的放在 390px 宽里。 */
const props = defineProps<{scene: string; input?: LabSceneInput}>();
const kind = computed(() => (props.scene.startsWith("command-") ? "command" : "card"));
const key = computed(() => props.scene.replace(/^command-/u, "").replace(/-narrow$/u, ""));
const sample = computed(() => (kind.value === "card" ? CARD_SAMPLES : COMMAND_SAMPLES)[key.value] ?? Object.values(kind.value === "card" ? CARD_SAMPLES : COMMAND_SAMPLES)[0]!);
provide(subagentStoreKey, sampleStore(sample.value));
/** 场景的输入就是卡片的属性（Lab 能改）；读不到时用样本自己的。 */
const cardProps = computed(() => ({...sampleProps(sample.value), ...((props.input?.props ?? {}) as object)}) as ReturnType<typeof sampleProps>);
</script>

<template>
    <div :class="props.scene.endsWith('-narrow') ? 'w-[390px]' : 'w-[640px]'" class="flex flex-col gap-1.5">
        <SubagentCard v-if="kind === 'card'" :call="sample.call" :ctx="cardProps.ctx" />
        <BackgroundCommandCard v-else :call="sample.call" :ctx="cardProps.ctx" />
    </div>
</template>
