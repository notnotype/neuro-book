<script setup lang="ts">
/** “消息”视图的外框要聊天区与会话页两个插槽：这里放占位，真实的聊天与会话面板在各自的场景里。场景名以 wide 开头的给两栏的宽度。 */
import {AgentMessages} from "@notnotype/nb-agent-ui/vue";

import {useLabSubject, type LabFixtureProps} from "../../lab-subject";
import {withAgentSceneText} from "./agent-text";

const props = defineProps<LabFixtureProps>();
const Messages = withAgentSceneText(AgentMessages);
const subject = useLabSubject<typeof AgentMessages>(() => props.input, ["open-contact", "retry-contacts", "open-session"]);
</script>

<template>
    <div class="h-[520px]" :class="props.scene.startsWith('wide') ? 'w-[820px]' : props.scene.startsWith('phone') ? 'w-[390px]' : 'w-[400px]'">
        <Messages data-lab-subject v-bind="subject.bindings.value">
            <div class="grid h-full place-items-center text-sm text-[var(--text-muted)]">聊天区（AgentConversationView）</div>
            <template #sessions>
                <div class="p-3 text-sm text-[var(--text-muted)]">会话面板（AgentSessionPanel）</div>
            </template>
        </Messages>
    </div>
</template>
