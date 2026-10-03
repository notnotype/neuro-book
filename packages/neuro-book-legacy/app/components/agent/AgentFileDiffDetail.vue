<script setup lang="ts">
import {computed} from "vue";
import type {ToolDetailProps} from "./agent-view-registry";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import {argString, parsePatchChanges} from "./tool-args";
import {fileDiffLines} from "./tool-detail-lines";

const props = defineProps<ToolDetailProps>();

const label = computed(() => props.call.name === "apply_patch"
    ? parsePatchChanges(argString(props.call, "patch")).map((change) => change.path).join(", ")
    : argString(props.call, "path"));
const lines = computed(() => fileDiffLines(props.call));
</script>

<template>
    <AgentCodeBlock :label="label" :lines="lines" />
</template>
