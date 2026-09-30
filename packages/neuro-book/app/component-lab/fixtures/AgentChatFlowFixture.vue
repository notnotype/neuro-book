<script setup lang="ts">
import AgentChatFlow from "../../components/novel-ide/agent/flow/AgentChatFlow.vue";
import type {AgentMessage} from "../../components/novel-ide/agent/agent-message";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {ref} from "vue";
import LabFixtureControls from "../LabFixtureControls.vue";
import {Button} from "@notnotype/nb-ui/components";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentChatFlow>(() => props.input, ["load-previous","copy","copy-tool","start-edit","retry","branch-from-here","cancel-edit","save-edit","cycle-branch","resend-unknown","dismiss-unknown","empty-select-starter","empty-select-session","empty-create-session","empty-open-sessions"]);
const flowRef = ref<InstanceType<typeof AgentChatFlow> | null>(null);
let nextStreamingMessageId = 1;
function handleAppendStreamingChunk(): void {
    const messages = subject.bindings.value.messages;
    const last = messages.at(-1);
    if (last && last.type === "ai") {
        subject.write("props", "messages", [...messages.slice(0, -1), {...last, content: last.content + "\n冷风夹杂着泥土的气息，马蹄深陷在泥泞中，前方的路已彻底辨认不清。"}]);
    } else {
        subject.write("props", "messages", [...messages, {id: `msg-stream-${nextStreamingMessageId++}`, type: "ai", content: "新流式输出段落...", status: "streaming", timestamp: "11:01:00"}]);
    }
}
function handleScrollToBottom(): void { flowRef.value?.scrollToBottom(); }
</script>
<template>
    <AgentChatFlow ref="flowRef" class="h-full w-full" data-lab-subject v-bind="subject.bindings.value" :messages="subject.bindings.value.messages as AgentMessage[]" />
    <!-- 流式仿真控制器：下放至 Lab 底部抽屉栏 -->
    <LabFixtureControls v-if="props.scene === 'streaming-simulation'">
        <div class="flex items-center justify-between gap-2 text-xs select-none">
            <span class="font-medium text-[var(--text-secondary)]">流式仿真控制器</span>
            <div class="flex items-center gap-2">
                <Button size="sm" variant="secondary" @click="handleAppendStreamingChunk">
                    追加流式文本
                </Button>
                <Button size="sm" variant="ghost" @click="handleScrollToBottom">
                    强制滚底
                </Button>
            </div>
        </div>
    </LabFixtureControls>
</template>
