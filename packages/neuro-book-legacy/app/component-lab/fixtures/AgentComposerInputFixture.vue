<script setup lang="ts">
import AgentComposerInput from "../../components/novel-ide/agent/composer/AgentComposerInput.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import type {AgentTriggerMenuContext, AgentTriggerMenuState} from "../../components/novel-ide/agent/trigger-menu";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentComposerInput>(() => props.input, ["submit","cycle-mode"]);
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
    <div class="w-full p-4"><AgentComposerInput data-lab-subject class="w-full" v-bind="subject.bindings.value" :resolve-menu="resolveMenu" /></div>
</template>
