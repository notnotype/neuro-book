<script setup lang="ts">
import AgentCard from "nbook/app/components/agent/AgentCard.vue";
import {IconButton} from "@notnotype/nb-ui/components";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentCard>(() => props.input, ["toggle"]);
</script>

<template>
    <AgentCard data-lab-subject class="w-full" v-bind="subject.bindings.value" @toggle="subject.write('props', 'expanded', $event)">
        <template v-if="subject.slots.value.default" #default>
            <pre class="m-0 whitespace-pre-wrap font-mono text-[11px] text-[var(--text-secondary)]">4812 chapters/06.md</pre>
        </template>
        <template v-if="subject.slots.value.actions" #actions>
            <IconButton icon-class="i-lucide-copy" size="sm" title="复制" aria-label="复制" />
        </template>
    </AgentCard>
</template>
