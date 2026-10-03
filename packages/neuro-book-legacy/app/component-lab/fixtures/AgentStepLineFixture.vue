<script setup lang="ts">
import AgentStepLine from "nbook/app/components/agent/AgentStepLine.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentStepLine>(() => props.input, ["toggle"]);
</script>

<template>
    <AgentStepLine data-lab-subject class="w-full" v-bind="subject.bindings.value" @toggle="subject.write('props', 'expanded', $event)">
        <template v-if="subject.slots.value.default" #default>
            <AgentStepLine icon="i-lucide-file-text" label="读取" detail="outline.md" />
            <AgentStepLine icon="i-lucide-file-text" label="读取" detail="chapters/03.md" />
            <AgentStepLine icon="i-lucide-search" label="搜索" detail="机械表 擒纵机构 工作原理" />
        </template>
    </AgentStepLine>
</template>
