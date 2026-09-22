<script setup lang="ts">
import AgentEditFileBubble from "../../components/novel-ide/agent/bubbles/tools/AgentEditFileBubble.vue";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const toolCall: AgentToolCall = {
    id: "tc-edit",
    index: 0,
    name: "edit_file",
    argsText: JSON.stringify({
        path: "src/story.md",
        edits: [
            {
                oldText: "天空中乌云密布，雷声滚滚。",
                newText: "暴风雨骤然而至，狂怒的雷电撕裂了天幕，将整个荒原照得一片惨白。",
            },
        ],
    }),
    status: props.scene === "running" ? "running" : "success",
    result: "文件修改已应用，共替换 1 处段落，新增 24 字节。",
};
</script>

<template>
    <div class="w-full p-4">
        <AgentEditFileBubble
            data-lab-subject
            class="w-full"
            :tool-call="toolCall"
        />
    </div>
</template>
