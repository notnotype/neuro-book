<script setup lang="ts">
/**
 * 对话位置的组件：右栏的视图和编辑区的页面是同一个。状态都在插件级的宿主里（`session-host.ts`），这里借用它，把视图接上，再放切换会话的面板。
 */
import {onBeforeUnmount, onMounted, ref} from "vue";

import {AgentConversationView} from "@notnotype/nb-agent-ui/vue";
import type {AgentConversationServices, AgentViewAction, AgentViewRegistry} from "@notnotype/nb-agent-ui";
import type {AgentViewRenderers} from "@notnotype/nb-agent-ui/vue";

import type {SessionHost} from "./session-host";
import type {SessionListStore} from "./session-list";
import SessionPanelHost from "./SessionPanelHost.vue";

const props = defineProps<{
    host: SessionHost;
    list: SessionListStore;
    registry: AgentViewRegistry;
    renderers: AgentViewRenderers;
    services: AgentConversationServices;
    pickProfile: () => Promise<string | null | undefined>;
    labels: {readonly renameTitle: string; readonly rename: string; readonly cancel: string};
}>();

const rootRef = ref<InstanceType<typeof AgentConversationView> | null>(null);

let giveBack: (() => void) | null = null;
onMounted(() => {
    giveBack = props.host.borrow();
    void props.host.restore();
});
onBeforeUnmount(() => giveBack?.());

/** 顶栏的新建也要先选 Profile。 */
async function onAction(action: AgentViewAction): Promise<void> {
    if (action.type !== "session.create" || action.profileKey !== undefined) {
        props.host.act(action);
        return;
    }
    const profile = await props.pickProfile();
    if (profile !== null) props.host.act(profile === undefined ? action : {...action, profileKey: profile});
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
        <template #sessions="{close}">
            <SessionPanelHost :store="props.list" :host="props.host" :pick-profile="props.pickProfile" :labels="props.labels" @opened="close()" />
        </template>
    </AgentConversationView>
</template>
