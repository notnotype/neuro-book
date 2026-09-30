<script setup lang="ts">
/** 单独挂载一轮：消息与 ctx 来自场景输入，服务与注册表由夹具补齐（与 AgentConversationView 夹具一致）。 */
import {onMounted, shallowRef} from "vue";
import AgentConversationTurn from "nbook/app/components/agent/AgentConversationTurn.vue";
import {createAgentViewRegistry} from "nbook/app/components/agent/agent-view-registry";
import {builtinMessageActionsContribution} from "nbook/app/components/agent/builtin-message-actions";
import {builtinRolesContribution} from "nbook/app/components/agent/builtin-roles";
import {builtinToolsContribution} from "nbook/app/components/agent/builtin-tools";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentConversationTurn>(() => props.input, ["action"]);

const registry = createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, builtinMessageActionsContribution]);
const sanitizeHtml = shallowRef<((html: string) => string) | undefined>(undefined);

onMounted(async () => {
    const {default: createDOMPurify} = await import("dompurify");
    const purifier = createDOMPurify(window);
    sanitizeHtml.value = (html) => purifier.sanitize(html);
});
</script>

<template>
    <AgentConversationTurn
        data-lab-subject
        class="w-full"
        v-bind="subject.bindings.value"
        :services="{sanitizeHtml, resolveAttachmentUrl: () => null, resolveTriggerMenu: () => []}"
        :registry="registry"
    />
</template>
