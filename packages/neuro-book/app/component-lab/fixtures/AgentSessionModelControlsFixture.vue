<script setup lang="ts">
import AgentSessionModelControls from "../../components/novel-ide/agent/panels/header/AgentSessionModelControls.vue";
import type {AgentSessionModelDraft} from "../../components/novel-ide/agent/agent-session-model-controls";
import type {EnabledModelOptionDto} from "nbook/shared/dto/app-settings.dto";
import {useLabEventSink} from "../lab-event-sink";

import {MODEL_DEFAULT_MODEL_OPTIONS} from "./model-settings-fixture-data";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

const popoverOpen = ref(props.scene === "open");
const modelSelection = ref<string | null>("openai/gpt-5.1");

const draft = ref<AgentSessionModelDraft>({
    modelKey: "openai/gpt-5.1",
    reasoningEffort: "medium",
});

const selectableModels = MODEL_DEFAULT_MODEL_OPTIONS;

const readonly = computed(() => props.scene === "readonly");
const saving = computed(() => props.scene === "saving");
</script>

<template>
    <div class="flex h-full w-full items-center justify-center p-4">
        <AgentSessionModelControls
            data-lab-subject
            v-model:session-model-popover-open="popoverOpen"
            v-model:session-model-draft="draft"
            :session-model-selection-value="modelSelection"
            session-thinking-resolved-label="中 (medium)"
            :selectable-models="selectableModels"
            :session-model-saving="saving"
            :readonly="readonly"
            @update-session-model-selection="modelSelection = $event; emitLabEvent('update-selection', $event)"
            @toggle-session-model-popover="popoverOpen = !popoverOpen"
            @apply-session-model-settings="emitLabEvent('apply-settings')"
            @reset-session-model-settings="emitLabEvent('reset-settings')"
        />
    </div>
</template>
