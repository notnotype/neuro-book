<script setup lang="ts">
/** 把会话面板接到数据（`session-list.ts`）与这个位置的宿主；下拉和左栏视图放的是它。 */
import {computed, onBeforeUnmount, onMounted} from "vue";

import {AgentSessionPanel} from "@notnotype/nb-agent-ui/vue";
import type {AgentViewAction} from "@notnotype/nb-agent-ui";

import type {SessionListStore} from "./session-list";

const props = defineProps<{
    store: SessionListStore;
    selectedId: string | null;
    now: number;
}>();

const emit = defineEmits<{action: [action: AgentViewAction]}>();

const scope = computed(() => (props.store.canScope ? {value: props.store.scope.value} : null));

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
    void props.store.refresh();
    // 进来之后别处新建、改名的不走这里：看着的时候隔一会儿重取一次。
    timer = setInterval(() => void props.store.refresh(), 15_000);
});
onBeforeUnmount(() => {
    if (timer !== null) clearInterval(timer);
});
</script>

<template>
    <AgentSessionPanel
        :items="props.store.items.value"
        :selected-id="props.selectedId"
        :now="props.now"
        :query="props.store.query.value"
        :scope="scope"
        :profiles="props.store.profiles.value"
        :show-archived="props.store.showArchived.value"
        :loading="props.store.loading.value"
        :error="props.store.error.value"
        @action="emit('action', $event)"
        @update:query="props.store.query.value = $event"
        @update:scope="props.store.setScope($event)"
        @update:show-archived="props.store.setShowArchived($event)"
        @toggle-profile="props.store.toggleProfile($event)"
    />
</template>
