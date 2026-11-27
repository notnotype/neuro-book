<script setup lang="ts">
/** 聊天区盖层的 Lab 夹具：给盖层一块定位的聊天区（它铺满父元素），按场景的输入画，事件记进事件栏。 */
import ContactCover from "nbook/plugins/agent/web/components/ContactCover.vue";
import type {ContactCoverState} from "nbook/plugins/agent/web/components/ContactCover.vue";

import {type LabFixtureProps, useLabEventSink} from "nbook/plugins/lab/web/scene-kit";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();
const cover = (props.input?.props as {cover: ContactCoverState} | undefined)?.cover ?? {kind: "pick-bot"};
</script>

<template>
    <div class="relative h-[360px] w-[min(360px,100%)]">
        <ContactCover :cover="cover" @add-provider="record('add-provider')" @retry="(key: string) => record('retry', key)" />
    </div>
</template>
