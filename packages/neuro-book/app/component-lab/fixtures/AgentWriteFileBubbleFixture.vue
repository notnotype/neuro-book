<script setup lang="ts">
import AgentWriteFileBubble from "../../components/novel-ide/agent/bubbles/tools/AgentWriteFileBubble.vue";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const toolCall: AgentToolCall = {
    id: "tc-write",
    index: 0,
    name: "write_file",
    argsText: JSON.stringify({
        path: "characters/protagonist.md",
        content: "# 主角设定：林岚\n\n- 身份：原巡夜人骑士团副团长\n- 性格：内敛、冷静、对约定执着\n- 核心矛盾：效忠阵营与家族秘密的冲突",
    }),
    status: props.scene === "running" ? "running" : "success",
    result: "成功写入文件 characters/protagonist.md (185 字节)。",
};
</script>

<template>
    <div class="w-full p-4">
        <AgentWriteFileBubble
            data-lab-subject
            class="w-full"
            :tool-call="toolCall"
        />
    </div>
</template>
