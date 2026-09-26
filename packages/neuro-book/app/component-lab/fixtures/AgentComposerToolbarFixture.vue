<script setup lang="ts">
import AgentComposerToolbar from "../../components/novel-ide/agent/composer/AgentComposerToolbar.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentComposerToolbar>(() => props.input, ["toggle-expand","cycle-mode","select-images","submit"]);
function toggleExpand(): void { subject.write("props", "composerExpanded", !subject.bindings.value.composerExpanded); }
</script>
<template>
    <div class="w-full p-4"><AgentComposerToolbar data-lab-subject class="w-full" v-bind="subject.bindings.value" @toggle-expand="toggleExpand"><template v-if="subject.slots.value['model-controls']" #model-controls><div class="flex h-7 items-center rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-xs text-[var(--text-secondary)]">Claude 3.7 Sonnet</div></template></AgentComposerToolbar></div>
</template>
