<script setup lang="ts">
/** 单独挂载一个轮次块：块与 ctx 来自场景输入，服务与注册表由夹具补齐（与 AgentConversationView 夹具一致）。 */
import {onMounted, shallowRef} from "vue";
import AgentTurnBlock from "nbook/app/components/agent/AgentTurnBlock.vue";
import {createAgentViewRegistry} from "nbook/app/components/agent/agent-view-registry";
import {builtinMessageActionsContribution} from "nbook/app/components/agent/builtin-message-actions";
import {builtinRolesContribution} from "nbook/app/components/agent/builtin-roles";
import {builtinToolsContribution} from "nbook/app/components/agent/builtin-tools";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentTurnBlock>(() => props.input);

const registry = createAgentViewRegistry([builtinRolesContribution, builtinToolsContribution, builtinMessageActionsContribution]);
const sanitizeHtml = shallowRef<((html: string) => string) | undefined>(undefined);

onMounted(async () => {
    const {default: createDOMPurify} = await import("dompurify");
    const purifier = createDOMPurify(window);
    sanitizeHtml.value = (html) => purifier.sanitize(html);
});
</script>

<template>
    <!-- 不加 w-full：块自带 24px 左缩进，再占满宽度就会横向溢出。 -->
    <AgentTurnBlock
        data-lab-subject
        v-bind="subject.bindings.value"
        :services="{sanitizeHtml, resolveAttachmentUrl: () => null, resolveTriggerMenu: () => []}"
        :registry="registry"
    />
</template>
