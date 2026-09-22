<script setup lang="ts">
import AgentApplyPatchBubble from "../../components/novel-ide/agent/bubbles/tools/AgentApplyPatchBubble.vue";
import type {AgentToolCall} from "../../components/novel-ide/agent/agent-message";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const toolCall: AgentToolCall = {
    id: "tc-patch",
    index: 0,
    name: "apply_patch",
    argsText: JSON.stringify({
        patch: "*** Begin Patch ***\n--- chapters/ch-02.md\n+++ chapters/ch-02.md\n@@ -10,3 +10,3 @@\n-他转身离开了房间。\n+他凝视着壁炉中的余烬，良久才转身离开。\n*** End Patch ***",
    }),
    status: props.scene === "error" ? "error" : "success",
    result: props.scene === "error" ? "Patch conflict in chunk 1" : "补丁已成功打入 1 个文件。",
};
</script>

<template>
    <div class="w-full p-4">
        <AgentApplyPatchBubble
            data-lab-subject
            class="w-full"
            :tool-call="toolCall"
        />
    </div>
</template>
