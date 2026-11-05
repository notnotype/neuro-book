<script setup lang="ts">
/**
 * 把会话面板接到数据（`session-list.ts`）与这个位置的宿主；下拉和左栏视图放的都是它，面板动作（选 Profile、改名小窗、刷新）只写在这里。
 */
import {computed, onBeforeUnmount, onMounted, ref} from "vue";

import {AgentSessionPanel} from "@notnotype/nb-agent-ui/vue";
import type {AgentViewAction} from "@notnotype/nb-agent-ui";
import {Button, Dialog, Input} from "@notnotype/nb-ui/components";

import type {SessionHost} from "./session-host";
import type {SessionListStore} from "./session-list";

const props = defineProps<{
    store: SessionListStore;
    host: SessionHost;
    /** 新建：Profile 多于一个时先让用户选；null 是取消，undefined 是用缺省。 */
    pickProfile: () => Promise<string | null | undefined>;
    labels: {readonly renameTitle: string; readonly rename: string; readonly cancel: string};
}>();

/** 切到了一个会话（选中或新建）：下拉要关，左栏视图要把对话带到前面。 */
const emit = defineEmits<{opened: []}>();

const scope = computed(() => (props.store.canScope ? {value: props.store.scope.value} : null));
const renaming = ref<{sessionId: string; title: string} | null>(null);
const renameOpen = ref(false);

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
    void props.store.refresh();
    // 进来之后别处新建、改名的不走这里：看着的时候隔一会儿重取一次。
    timer = setInterval(() => void props.store.refresh(), 15_000);
});
onBeforeUnmount(() => {
    if (timer !== null) clearInterval(timer);
});

async function onAction(action: AgentViewAction): Promise<void> {
    if (action.type === "session.rename") {
        renaming.value = {sessionId: action.sessionId, title: action.title};
        renameOpen.value = true;
        return;
    }
    if (action.type === "session.create" && action.profileKey === undefined) {
        const profile = await props.pickProfile();
        if (profile === null) return;
        props.host.act(profile === undefined ? action : {...action, profileKey: profile});
        emit("opened");
        return;
    }
    props.host.act(action);
    if (action.type === "session.select") emit("opened");
    else if (action.type === "session.archive" || action.type === "session.restore") void props.store.refresh();
}

function confirmRename(): void {
    const current = renaming.value;
    renameOpen.value = false;
    if (current === null || current.title.trim() === "") return;
    props.host.act({type: "session.rename", sessionId: current.sessionId, title: current.title.trim()});
    void props.store.refresh();
}
</script>

<template>
    <AgentSessionPanel
        :items="props.store.items.value"
        :selected-id="props.host.sessionId.value"
        :now="props.store.now.value"
        :query="props.store.query.value"
        :scope="scope"
        :profiles="props.store.profiles.value"
        :show-archived="props.store.showArchived.value"
        :loading="props.store.loading.value"
        :error="props.store.error.value"
        @action="onAction"
        @update:query="props.store.query.value = $event"
        @update:scope="props.store.setScope($event)"
        @update:show-archived="props.store.setShowArchived($event)"
        @toggle-profile="props.store.toggleProfile($event)"
    />
    <Dialog v-model:open="renameOpen" :title="props.labels.renameTitle" size="sm">
        <Input v-if="renaming !== null" v-model="renaming.title" data-session-rename-input @keydown.enter="confirmRename" />
        <template #footer>
            <Button size="sm" variant="subtle" @click="renameOpen = false">{{ props.labels.cancel }}</Button>
            <Button size="sm" variant="primary" data-session-rename-confirm @click="confirmRename">{{ props.labels.rename }}</Button>
        </template>
    </Dialog>
</template>
