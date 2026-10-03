<script setup lang="ts">
import {computed} from "vue";
import type {AgentConversationContext, ToolCallView} from "./agent-view.types";
import {diffTaskLists, findPreviousTaskList, parseTaskList} from "./task-list";
import AgentCard from "./AgentCard.vue";
import AgentTaskList from "./AgentTaskList.vue";

const props = defineProps<{
    call: ToolCallView;
    ctx: AgentConversationContext;
}>();

const {t} = useI18n();

const list = computed(() => parseTaskList(props.call));
const changes = computed(() => {
    if (list.value === null || props.call.name === "task_create") {
        return null;
    }
    return diffTaskLists(findPreviousTaskList(props.ctx.messages, props.call.id), list.value);
});

const fallbackStatus = computed(() => {
    switch (props.call.status) {
        case "streaming":
        case "running": return "running";
        case "error":
        case "invalid": return "error";
        case "success": return "success";
    }
});
</script>

<template>
    <AgentTaskList v-if="list" :title="list.title" :items="list.items" :changes="changes" />
    <AgentCard v-else icon="i-lucide-list-checks" :title="t('agentView.tool.task')" :status="fallbackStatus" />
</template>
