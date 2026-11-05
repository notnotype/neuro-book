<script setup lang="ts">
/**
 * 对话位置的组件：右栏的视图和编辑区的页面是同一个。状态都在插件级的宿主里（`session-host.ts`），这里借用它，把视图接上，再放切换会话的面板与改名的小窗。
 */
import {onBeforeUnmount, onMounted, ref} from "vue";

import {AgentConversationView} from "@notnotype/nb-agent-ui/vue";
import type {AgentConversationServices, AgentViewAction, AgentViewRegistry} from "@notnotype/nb-agent-ui";
import type {AgentViewRenderers} from "@notnotype/nb-agent-ui/vue";
import {Button, Dialog, Input} from "@notnotype/nb-ui/components";

import type {SessionHost} from "./session-host";
import type {SessionListStore} from "./session-list";
import SessionPanelHost from "./SessionPanelHost.vue";

const props = defineProps<{
    host: SessionHost;
    list: SessionListStore;
    registry: AgentViewRegistry;
    renderers: AgentViewRenderers;
    services: AgentConversationServices;
    /** 新建：Profile 多于一个时由宿主先让用户选。 */
    pickProfile: () => Promise<string | null | undefined>;
    labels: {readonly renameTitle: string; readonly rename: string; readonly cancel: string};
}>();

const rootRef = ref<InstanceType<typeof AgentConversationView> | null>(null);
const renaming = ref<{sessionId: string; title: string} | null>(null);
const renameOpen = ref(false);

let giveBack: (() => void) | null = null;
onMounted(() => {
    giveBack = props.host.borrow();
    void props.host.restore();
});
onBeforeUnmount(() => giveBack?.());

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
        void props.list.refresh();
        return;
    }
    props.host.act(action);
    if (action.type === "session.archive" || action.type === "session.restore") void props.list.refresh();
}

function confirmRename(): void {
    const current = renaming.value;
    renameOpen.value = false;
    if (current === null || current.title.trim() === "") return;
    props.host.act({type: "session.rename", sessionId: current.sessionId, title: current.title.trim()});
    void props.list.refresh();
}

defineExpose({focusComposer: () => rootRef.value?.focusComposer()});
</script>

<template>
    <AgentConversationView
        ref="rootRef"
        class="h-full w-full"
        :ctx="props.host.ctx.value"
        :services="props.services"
        :registry="props.registry"
        :renderers="props.renderers"
        status-bar
        new-session
        @action="onAction"
    >
        <template #sessions>
            <SessionPanelHost :store="props.list" :selected-id="props.host.sessionId.value" :now="props.host.ctx.value.now" @action="onAction" />
        </template>
    </AgentConversationView>
    <Dialog v-model:open="renameOpen" :title="props.labels.renameTitle" size="sm">
        <Input v-if="renaming !== null" v-model="renaming.title" data-session-rename-input @keydown.enter="confirmRename" />
        <template #footer>
            <Button size="sm" variant="subtle" @click="renameOpen = false">{{ props.labels.cancel }}</Button>
            <Button size="sm" variant="primary" data-session-rename-confirm @click="confirmRename">{{ props.labels.rename }}</Button>
        </template>
    </Dialog>
</template>
