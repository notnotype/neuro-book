<script setup lang="ts">
import {ref} from "vue";
import AgentToolNode from "../../components/novel-ide/agent/bubbles/tools/AgentToolNode.vue";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const expanded = ref(props.scene === "expanded");

function getToolCall(scene: string): AgentToolCall {
    switch (scene) {
        case "running":
            return {
                id: "tc-run",
                index: 0,
                name: "search_workspace",
                argsText: JSON.stringify({query: "灵脉潮汐", limit: 5}),
                status: "running",
            };
        case "error":
            return {
                id: "tc-err",
                index: 0,
                name: "read_file",
                argsText: JSON.stringify({path: "non-existent-file.md"}),
                status: "error",
                error: "ENOENT: no such file or directory, open 'non-existent-file.md'",
            };
        case "expanded":
        case "success":
        default:
            return {
                id: "tc-ok",
                index: 0,
                name: "read_file",
                argsText: JSON.stringify({path: "chapters/chapter-01.md"}),
                status: "success",
                result: "第一章 暴风雨前夜\n\n海风呼啸着掠过断崖...",
            };
    }
}
</script>

<template>
    <div class="w-full p-4">
        <AgentToolNode
            data-lab-subject
            class="w-full"
            :tool-call="getToolCall(props.scene)"
            :expanded="expanded || props.scene === 'expanded'"
            @toggle="expanded = !expanded"
        />
    </div>
</template>
