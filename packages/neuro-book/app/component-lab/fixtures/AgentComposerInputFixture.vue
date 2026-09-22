<script setup lang="ts">
import AgentComposerInput from "../../components/novel-ide/agent/composer/AgentComposerInput.vue";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "../../components/novel-ide/agent/trigger-menu";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

const text = ref(props.scene === "with-text" ? "请帮我润色第二段中对于暴风雨夜的景物描写，突出压抑感。" : "");
const expanded = computed(() => props.scene === "expanded");
const readonly = computed(() => props.scene === "readonly");

const resolveMenu = (_context: AgentTriggerMenuContext): AgentTriggerMenuState => {
    return {
        title: "可用选项",
        prefix: "/",
        sections: [
            {
                id: "skills",
                title: "可用技能",
                items: [
                    {id: "lint", label: "风格润色", description: "润色文风", iconClass: "i-lucide-sparkles"},
                    {id: "expand", label: "剧情扩写", description: "丰富细节", iconClass: "i-lucide-file-plus"},
                ],
            },
        ],
    };
};
</script>

<template>
    <div class="w-full p-4">
        <AgentComposerInput
            data-lab-subject
            class="w-full"
            v-model="text"
            placeholder="输入正文或使用 / 唤起指令..."
            :expanded="expanded"
            :readonly="readonly"
            :resolve-menu="resolveMenu"
            @submit="emitLabEvent('submit', $event)"
            @cycle-mode="emitLabEvent('cycle-mode')"
        />
    </div>
</template>
