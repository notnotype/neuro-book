<script setup lang="ts">
import type {AgentTriggerMenuSection} from "nbook/app/components/novel-ide/agent/trigger-menu";
import ReferenceSelectorPopover from "nbook/app/components/common/form/ReferenceSelectorPopover.vue";

const props = defineProps<{
    title: string;
    prefix: string;
    sections: AgentTriggerMenuSection[];
    activeIndex: number;
}>();

const emit = defineEmits<{
    (e: "select", itemId: string): void;
    (e: "hover", index: number): void;
}>();

</script>

<template>
    <ReferenceSelectorPopover
        :title="props.title"
        :prefix="props.prefix"
        :sections="props.sections"
        :active-index="props.activeIndex"
        @hover="emit('hover', $event)"
        @select="emit('select', $event)"
    />
</template>
