<script setup lang="ts">
/** 消毒函数用 DOMPurify，挂载后装上；场景的“纯文本”对照就是装上之前的缺省行为。 */
import {onMounted, shallowRef} from "vue";
import AgentMarkdown from "nbook/app/components/agent/AgentMarkdown.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentMarkdown>(() => props.input);

const sanitizeHtml = shallowRef<((html: string) => string) | undefined>(undefined);

onMounted(async () => {
    const {default: createDOMPurify} = await import("dompurify");
    const purifier = createDOMPurify(window);
    sanitizeHtml.value = (html) => purifier.sanitize(html);
});
</script>

<template>
    <AgentMarkdown data-lab-subject class="w-full" v-bind="subject.bindings.value" :sanitize-html="sanitizeHtml" />
</template>
