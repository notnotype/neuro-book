<script setup lang="ts">
import Tooltip from "nbook/app/components/common/Tooltip.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof Tooltip>(() => props.input);
const emitLabEvent = useLabEventSink();
</script>

<template>
    <Tooltip
        data-lab-subject
        v-bind="subject.bindings.value"
    >
        <template #default>
            <button
                @mouseenter="emitLabEvent('trigger-hover')"
                @focus="emitLabEvent('trigger-focus')"
                @mouseleave="emitLabEvent('trigger-leave')"
                @blur="emitLabEvent('trigger-blur')"
                @click="emitLabEvent('trigger-click')"
                type="button"
                class="inline-flex h-9 items-center rounded-md border border-[var(--border-color)] bg-[var(--panel-surface)] px-3 text-sm text-[var(--text-main)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-main)]"
            >
                悬停或聚焦以查看提示
            </button>
        </template>
    </Tooltip>
</template>
