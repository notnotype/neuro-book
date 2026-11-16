<script setup lang="ts">
/**
 * 对话位置的组件：右栏的视图和编辑区的页面是同一个。状态都在插件级的宿主里（`session-host.ts`），这里借用它，把视图接上，再放切换会话的面板。
 */
import {onBeforeUnmount, onMounted, provide, ref, watch} from "vue";

import {AgentConversationView} from "@notnotype/nb-agent-ui/vue";
import type {AgentConversationServices, AgentViewAction, AgentViewRegistry, AgentWelcomeView} from "@notnotype/nb-agent-ui";
import type {AgentViewRenderers} from "@notnotype/nb-agent-ui/vue";

import SkillInitDialog from "./components/SkillInitDialog.vue";
import type {SessionHost} from "./session-host";
import type {SkillInit} from "./skill-init";
import type {RecentSessions, SessionListStore} from "./session-list";
import {subagentStoreKey, toolActionKey, toolActionOf} from "./subagent-store";
import SessionPanelHost from "./SessionPanelHost.vue";
import SubagentsEntry from "./components/SubagentsEntry.vue";
import type {ProfileEntry} from "../shared/contracts";
import type {RunResults, SeenErrors} from "./subagents-panel";

const props = defineProps<{
    host: SessionHost;
    list: SessionListStore;
    /** 第一屏的最近对话，第一屏出现时这里刷新它。 */
    recent: RecentSessions;
    welcome: AgentWelcomeView;
    draftProfile: {readonly name: string; readonly icon: string} | null;
    registry: AgentViewRegistry;
    renderers: AgentViewRenderers;
    services: AgentConversationServices;
    pickProfile: () => Promise<string | null | undefined>;
    labels: {readonly renameTitle: string; readonly rename: string; readonly cancel: string};
    /** 选了未初始化的 Skill 时的确认框（skills.md 输出 27）。 */
    skillInit: SkillInit;
    /** 子代理入口要的（conversation.md 输出 43）：Profile 名、插件作用域的出错看过没有与收口结果。 */
    subagents: {readonly profiles: readonly ProfileEntry[]; readonly seen: SeenErrors; readonly results: RunResults};
}>();

const rootRef = ref<InstanceType<typeof AgentConversationView> | null>(null);

// 子代理与后台命令卡片的数据：按宿主（这个对话位置的当前会话）一份，卡片注入，不进 ctx。
provide(subagentStoreKey, props.host.subagents);
provide(toolActionKey, (tool) => toolActionOf(props.registry, tool));

let giveBack: (() => void) | null = null;
onMounted(() => {
    giveBack = props.host.borrow();
    void props.host.restore();
});
onBeforeUnmount(() => giveBack?.());

// 第一屏出现时（切到没有消息的会话、新建、没选会话）重取最近对话：别处新建、改名、归档过，这里不知道（conversation.md 输出 41）。
watch(() => [props.host.ctx.value.session?.id ?? null, props.host.ctx.value.messages.length === 0] as const, ([, empty]) => {
    if (empty) void props.recent.refresh();
}, {immediate: true});

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
        :welcome="props.welcome"
        :draft-profile="props.draftProfile"
        @action="onAction"
    >
        <template #sessions="{close}">
            <SessionPanelHost :store="props.list" :host="props.host" :pick-profile="props.pickProfile" :labels="props.labels" @opened="close()" />
        </template>
        <template #head-trailing>
            <SubagentsEntry
                :profiles="props.subagents.profiles"
                :seen="props.subagents.seen"
                :results="props.subagents.results"
                @select="(sessionId: string) => props.host.act({type: 'session.select', sessionId})"
            />
        </template>
    </AgentConversationView>
    <SkillInitDialog
        :open="props.skillInit.state.value.open"
        :name="props.skillInit.state.value.name"
        :phase="props.skillInit.state.value.phase"
        :plan="props.skillInit.state.value.plan"
        :failure="props.skillInit.state.value.failure"
        @update:open="(open: boolean) => open || props.skillInit.close()"
        @confirm="void props.skillInit.confirm()"
    />
</template>
