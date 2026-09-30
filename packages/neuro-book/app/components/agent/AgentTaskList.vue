<script setup lang="ts">
import {computed, ref} from "vue";
import type {TaskChange, TaskItemView, TaskStatus} from "./task-list";
import AgentCard from "./AgentCard.vue";

const props = defineProps<{
    title: string | null;
    items: TaskItemView[];
    changes: TaskChange[] | null;
}>();

const {t} = useI18n();

const showAll = ref(false);
const completed = computed(() => props.items.filter((item) => item.status === "completed").length);
const listVisible = computed(() => props.changes === null || showAll.value);

function statusIcon(status: TaskStatus): string {
    switch (status) {
        case "pending": return "i-lucide-circle-dashed";
        case "in_progress": return "i-lucide-circle-dot";
        case "completed": return "i-lucide-circle-check";
    }
}

function statusLabel(status: TaskStatus): string {
    return t(`agentView.task.status.${status}`);
}
</script>

<template>
    <AgentCard
        class="agent-task-list"
        icon="i-lucide-list-checks"
        :title="props.changes === null ? t('agentView.task.created') : t('agentView.task.updated')"
        :subtitle="props.title ?? ''"
    >
        <template #actions>
            <span class="agent-task-list__progress" :title="t('agentView.task.progress', {done: completed, total: props.items.length})">
                {{ completed }}/{{ props.items.length }}
            </span>
        </template>

        <ul v-if="props.changes !== null && props.changes.length > 0" class="agent-task-list__items">
            <li v-for="change in props.changes" :key="change.id" class="agent-task-list__item" :data-status="change.to">
                <span :class="[statusIcon(change.to), 'agent-task-list__icon']" aria-hidden="true" />
                <span class="agent-task-list__text">{{ change.text }}</span>
                <span class="agent-task-list__change">{{ statusLabel(change.to) }}</span>
            </li>
        </ul>

        <ul v-if="listVisible" class="agent-task-list__items" :data-full="props.changes !== null || undefined">
            <li v-for="item in props.items" :key="item.id" class="agent-task-list__item" :data-status="item.status">
                <span :class="[statusIcon(item.status), 'agent-task-list__icon']" :title="statusLabel(item.status)" aria-hidden="true" />
                <span class="agent-task-list__text">
                    {{ item.text }}<span v-if="item.note" class="agent-task-list__note">{{ item.note }}</span>
                </span>
            </li>
        </ul>

        <button
            v-if="props.changes !== null"
            type="button"
            class="agent-task-list__toggle"
            :aria-expanded="showAll"
            @click="showAll = !showAll"
        >
            {{ showAll ? t("agentView.task.hideAll") : t("agentView.task.showAll") }}
        </button>
    </AgentCard>
</template>

<style scoped>
.agent-task-list__progress {
    padding-right: 8px;
    color: var(--text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
}

.agent-task-list__items {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
}

/* 更新卡片展开的完整清单与上面的变化之间隔一条细线。 */
.agent-task-list__items[data-full] {
    margin-top: 6px;
    padding-top: 6px;
    border-top: var(--border-w, 1px) solid var(--divider);
}

.agent-task-list__item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    min-width: 0;
    font-size: 12px;
    line-height: 20px;
}

.agent-task-list__icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    margin-top: 3px;
    color: var(--text-muted);
}

.agent-task-list__item[data-status="in_progress"] .agent-task-list__icon {
    color: var(--accent-text);
}

.agent-task-list__item[data-status="completed"] .agent-task-list__icon {
    color: var(--status-success);
}

.agent-task-list__text {
    flex: 1;
    min-width: 0;
    color: var(--text-main);
    overflow-wrap: anywhere;
}

.agent-task-list__item[data-status="completed"] .agent-task-list__text {
    color: var(--text-secondary);
}

.agent-task-list__note {
    margin-left: 6px;
    color: var(--text-muted);
}

.agent-task-list__change {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 11px;
}

.agent-task-list__toggle {
    margin-top: 4px;
    color: var(--text-muted);
    font-size: 12px;
    transition: color var(--motion-fast) var(--ease-standard);
}

.agent-task-list__toggle:hover {
    color: var(--text-main);
    text-decoration: underline;
}
</style>
