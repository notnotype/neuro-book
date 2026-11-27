<script setup lang="ts">
/**
 * 三种页面顶上的世界横幅（docs/specs/canon/author-ui.md 输出 27、28）：世界已断开（带“重试”）、世界只读（写原因）。受控：原因
 * 由宿主按读取层算好（`writable.ts`）。两条都用 `role="status"`（输出 30）。
 */
import {Banner, Button} from "@notnotype/nb-ui/components";

import {useCanonText} from "../../text";

const props = withDefaults(defineProps<{
    disconnected?: boolean;
    /** 世界只读的原因；可以写时为空。 */
    readOnly?: string;
}>(), {disconnected: false, readOnly: ""});

const emit = defineEmits<{(event: "retry"): void}>();

const text = useCanonText();
</script>

<template>
    <Banner v-if="props.disconnected" tone="warning" role="status" :message="text('world.disconnected')">
        <template #actions><Button variant="primary" size="sm" @click="emit('retry')">{{ text("world.retry") }}</Button></template>
    </Banner>
    <Banner v-if="props.readOnly !== ''" tone="warning" role="status" :message="props.readOnly" data-read-only />
</template>
