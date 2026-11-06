<script setup lang="ts">
/**
 * 思维链里一次以“一行”呈现的工具调用：图标、动作名、摘要、状态，改文件的单文件调用带增删行数；点开是 `AgentToolDetail`。
 * 工具组里的一项、组收起时单独露出的出错项、顶层的一行共用它。展开状态由使用方按步骤 id 记：思维链重新分组时
 * （例如一次读取把夹在中间的思考并进工具组）这一行会换一个实例，状态放在行里就丢了。
 */
import {computed} from "vue";
import {CollapsibleRow} from "@notnotype/nb-ui/components";
import type {AgentConversationContext, AgentConversationServices} from "../../types";
import type {AgentViewRegistry} from "../../registry";
import type {ToolStep} from "../../conversation-turns";
import {toolCallPhase} from "../../tool-status";
import AgentToolDetail from "../tools/AgentToolDetail.vue";
import {useAgentText} from "../host";
import type {ViewAction} from "../view-action";

const props = defineProps<{
    step: ToolStep;
    ctx: AgentConversationContext;
    services: AgentConversationServices;
    registry: AgentViewRegistry;
    expanded: boolean;
}>();

const emit = defineEmits<{
    (e: "action", action: ViewAction): void;
    (e: "update:expanded", expanded: boolean): void;
}>();

const {t, text} = useAgentText();

/** 没有执行、不确定有没有执行完：说明跟在摘要后面。 */
const detail = computed(() => {
    const summary = renderer.value.summary(props.step.call);
    const {note} = props.step.call;
    if (note === undefined) return summary;
    return summary === "" ? text(note) : `${summary} · ${text(note)}`;
});

const renderer = computed(() => props.registry.resolveTool(props.step.call.name));

/** 单文件改动的增删行；多文件的补丁不在行内显示统计。 */
const stat = computed(() => {
    if (renderer.value.category !== "mutate") return null;
    const changed = renderer.value.effects?.(props.step.call).changed ?? [];
    return changed.length === 1 ? {added: changed[0]!.added, removed: changed[0]!.removed} : null;
});
</script>

<template>
    <CollapsibleRow
        :running-label="t('turn.running')"
        :icon="renderer.icon"
        :label="text(renderer.label)"
        :detail="detail"
        :stat="stat"
        :status="toolCallPhase(props.step.call.status)"
        :expanded="props.expanded"
        @update:expanded="emit('update:expanded', $event)"
    >
        <AgentToolDetail :call="props.step.call" :ctx="props.ctx" :services="props.services" :registry="props.registry" @action="emit('action', $event)" />
    </CollapsibleRow>
</template>
