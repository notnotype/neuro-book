<script setup lang="ts">
/** 状态栏条目的悬停内容（同名 .md）：在跑的任务，每件两行；没有在跑的时是条目的一句说明。 */
import {Progress} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";

import {tasksText} from "../../shared/text";
import {statusSummary} from "../store";
import type {TasksStore} from "../store";

defineOptions({name: "TasksHover"});

defineProps<{
    store: TasksStore;
}>();

const port = useText();
</script>

<template>
    <span v-if="store.running.value.length === 0" data-tasks-hover>{{ port.t(statusSummary(store)) }}</span>
    <span v-else class="tasks-hover" data-tasks-hover>
        <span v-for="item in store.running.value" :key="item.id" class="tasks-hover__row">
            <span class="tasks-hover__title">{{ port.t(item.title) }}</span>
            <span class="tasks-hover__progress">
                <Progress v-if="item.progress !== null" :model-value="item.progress" size="sm" />
                <span v-else class="tasks-hover__indeterminate" role="progressbar" :aria-valuetext="port.t(tasksText('list.running'))"><span class="nb-ui-indeterminate-runner"></span></span>
            </span>
            <span v-if="item.message !== null" class="tasks-hover__message">{{ port.t(item.message) }}</span>
        </span>
    </span>
</template>

<style scoped>
.tasks-hover {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 56px;
    column-gap: var(--space-3);
    row-gap: var(--space-2);
    width: 16rem;
}

.tasks-hover__row {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    row-gap: 2px;
}

.tasks-hover__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tasks-hover__progress {
    display: flex;
    align-items: center;
}

.tasks-hover__message {
    grid-column: 1 / -1;
    overflow: hidden;
    opacity: 0.72;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tasks-hover__indeterminate {
    display: block;
    overflow: hidden;
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 18%, transparent);
}

.tasks-hover__indeterminate > span {
    display: block;
    height: 100%;
    border-radius: 999px;
    background: var(--accent-main);
}
</style>
