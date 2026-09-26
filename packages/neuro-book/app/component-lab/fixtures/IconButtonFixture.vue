<script setup lang="ts">
import IconButton from "nbook/app/components/common/IconButton.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof IconButton>(() => props.input);
const emitLabEvent = useLabEventSink();
</script>

<template>
    <div class="flex h-full min-h-0 w-full items-center justify-center bg-[var(--panel-surface)]">
        <IconButton data-lab-subject v-bind="subject.bindings.value" aria-label="复制示例内容" @click="emitLabEvent('click')">
            <template v-if="subject.slots.value.default">
                <span class="i-lucide-copy h-4 w-4" aria-hidden="true"></span>
            </template>
        </IconButton>
    </div>
</template>
