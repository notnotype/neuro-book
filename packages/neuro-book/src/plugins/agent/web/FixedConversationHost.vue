<script setup lang="ts">
/**
 * 固定会话的对话（docs/specs/agent/conversation.md 的固定会话，ui/agent-conversation-view.md 的 bot 档）：宿主是固定模式的
 * `session-host`，只开调用方给的那个会话。和 `ConversationHost.vue` 的差别：没有会话列表与新建；顶栏的名字与头像由调用方给；
 * 待处理事项在停靠区；`active`（视图可见、窗口有焦点）时把已经画出来的日志 seq 交出去，调用方据此记“看到”。
 */
import {computed, onBeforeUnmount, onMounted, provide, ref, watch} from "vue";

import {AgentConversationView} from "@notnotype/nb-agent-ui/vue";
import type {AgentConversationContext, AgentConversationServices, AgentViewAction, AgentViewRegistry, StatusLineSetting} from "@notnotype/nb-agent-ui";
import type {AgentViewRenderers} from "@notnotype/nb-agent-ui/vue";

import SkillInitDialog from "./components/SkillInitDialog.vue";
import SubagentsEntry from "./components/SubagentsEntry.vue";
import type {SessionHost} from "./session-host";
import type {SkillInit} from "./skill-init";
import {subagentStoreKey, toolActionKey, toolActionOf} from "./subagent-store";
import type {ProfileEntry} from "../shared/contracts";
import type {RunResults, SeenErrors} from "./subagents-panel";

const props = defineProps<{
    host: SessionHost;
    identity: {readonly name: string; readonly avatar?: string};
    active: boolean;
    registry: AgentViewRegistry;
    renderers: AgentViewRenderers;
    services: AgentConversationServices;
    skillInit: SkillInit;
    subagents: {readonly profiles: readonly ProfileEntry[]; readonly seen: SeenErrors; readonly results: RunResults};
    statusLine: {readonly setting: StatusLineSetting; toggle(id: string): void; openSettings(): void};
}>();

const emit = defineEmits<{seen: [seq: number]}>();

const rootRef = ref<InstanceType<typeof AgentConversationView> | null>(null);

provide(subagentStoreKey, props.host.subagents);
provide(toolActionKey, (tool) => toolActionOf(props.registry, tool));

/** 顶栏写调用方给的名字与头像，不写会话标题与 Profile 图标。 */
const ctx = computed<AgentConversationContext>(() => {
    const base = props.host.ctx.value;
    if (base.session === null) return base;
    return {...base, session: {...base.session, title: props.identity.name, ...(props.identity.avatar === undefined ? {} : {avatar: props.identity.avatar})}};
});

// 看到（bots/view.md 输出 4）：只在可见且有焦点时交，交的是已经应用到界面的 seq，不是服务端知道的最新值。
watch([() => props.active, props.host.shownSeq], ([active, seq]) => {
    if (active && seq > 0) emit("seen", seq);
}, {immediate: true});

let giveBack: (() => void) | null = null;
onMounted(() => {
    giveBack = props.host.borrow();
    void props.host.restore();
});
onBeforeUnmount(() => giveBack?.());

function onAction(action: AgentViewAction): void {
    if (action.type === "statusLine.toggle") {
        props.statusLine.toggle(action.id);
        return;
    }
    if (action.type === "statusLine.openSettings") {
        props.statusLine.openSettings();
        return;
    }
    props.host.act(action);
}

defineExpose({focusComposer: () => rootRef.value?.focusComposer()});
</script>

<template>
    <AgentConversationView
        ref="rootRef"
        class="h-full w-full"
        :ctx="ctx"
        :services="props.services"
        :registry="props.registry"
        :renderers="props.renderers"
        status-bar
        pending-placement="dock"
        :status-line="props.statusLine.setting"
        @action="onAction"
    >
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
