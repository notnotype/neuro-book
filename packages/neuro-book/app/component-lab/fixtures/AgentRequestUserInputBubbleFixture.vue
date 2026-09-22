<script setup lang="ts">
import AgentRequestUserInputBubble from "../../components/novel-ide/agent/bubbles/interactive/AgentRequestUserInputBubble.vue";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const toolCall: AgentToolCall = {
    id: "tc-req-input",
    index: 0,
    name: "request_user_input",
    argsText: JSON.stringify({
        questions: [
            {
                id: "q1",
                question: "是否确认将反派角色‘罗恩’的背叛动机从单纯的金钱诱惑改为家族契约逼迫？",
                options: [
                    {label: "确认修改（增加家族契约悲剧色彩）"},
                    {label: "保持原状（维持利益驱使的纯粹恶人设定）"},
                ],
            },
        ],
    }),
    status: "success",
};
</script>

<template>
    <div class="w-full p-4">
        <AgentRequestUserInputBubble
            data-lab-subject
            class="w-full"
            :tool-call="toolCall"
        />
    </div>
</template>
