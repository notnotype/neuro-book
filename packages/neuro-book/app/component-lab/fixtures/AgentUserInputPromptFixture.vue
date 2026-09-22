<script setup lang="ts">
import AgentUserInputPrompt from "../../components/novel-ide/agent/bubbles/interactive/AgentUserInputPrompt.vue";
import type {AgentPendingUserInputSession} from "../../components/novel-ide/agent/agent-message";
import {
    createAgentPendingResolutionDraft,
    type AgentPendingResolutionDraft,
} from "../../components/novel-ide/agent/agent-pending-resolution";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "../../components/novel-ide/agent/trigger-menu";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

const sessions = computed<AgentPendingUserInputSession[]>(() => {
    switch (props.scene) {
        case "open-ended":
            return [
                {
                    assistantMessageId: "assistant-open",
                    status: "pending",
                    questions: [
                        {
                            toolNodeId: "node-open",
                            toolCallId: "call-open",
                            toolName: "request_user_input",
                            questionIndex: 0,
                            kind: "question",
                            question: "请简述这一章你想表达的核心主题：",
                            options: [],
                        },
                    ],
                },
            ];
        case "multi-question":
            return [
                {
                    assistantMessageId: "assistant-multi",
                    status: "pending",
                    questions: [
                        {
                            toolNodeId: "node-multi-1",
                            toolCallId: "call-multi-1",
                            toolName: "request_user_input",
                            questionIndex: 0,
                            kind: "question",
                            question: "你希望反派在何时被主角揭穿？",
                            options: [
                                {label: "本章结尾直接揭穿"},
                                {label: "下一卷再揭晓"},
                                {label: "始终不揭穿，留作暗线"},
                            ],
                        },
                        {
                            toolNodeId: "node-multi-2",
                            toolCallId: "call-multi-2",
                            toolName: "request_user_input",
                            questionIndex: 1,
                            kind: "question",
                            question: "主角此时的心理状态偏向哪种？",
                            options: [
                                {label: "愤怒与复仇"},
                                {label: "困惑与失望"},
                                {label: "平静与释怀"},
                            ],
                        },
                    ],
                },
            ];
        case "single-choice":
        default:
            return [
                {
                    assistantMessageId: "assistant-single",
                    status: "pending",
                    questions: [
                        {
                            toolNodeId: "node-single",
                            toolCallId: "call-single",
                            toolName: "request_user_input",
                            questionIndex: 0,
                            kind: "question",
                            question: "接下来这一幕你希望以谁的视角展开叙述？",
                            options: [
                                {label: "主角（第一人称感知）"},
                                {label: "观察者（第三人称全知）"},
                                {label: "对手（限知视角）"},
                            ],
                        },
                    ],
                },
            ];
    }
});

const draft = ref<AgentPendingResolutionDraft>(createAgentPendingResolutionDraft(sessions.value));

watch(sessions, (next) => {
    draft.value = createAgentPendingResolutionDraft(next);
});

const resolveMenu = (_context: AgentTriggerMenuContext): AgentTriggerMenuState => ({
    title: "快捷指令",
    prefix: "/",
    sections: [],
});
const submitting = computed(() => props.scene === "submitting");
</script>

<template>
    <div class="w-full p-4">
        <AgentUserInputPrompt
            data-lab-subject
            class="w-full"
            :sessions="sessions"
            v-model:draft="draft"
            :can-resolve="true"
            :can-abort="true"
            :submitting="submitting"
            menu-refresh-key="fixture"
            :resolve-menu="resolveMenu"
            @submit="emitLabEvent('submit')"
            @cancel="emitLabEvent('cancel')"
            @resync="emitLabEvent('resync')"
        />
    </div>
</template>
