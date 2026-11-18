<script setup lang="ts">
/**
 * eval 调用的详情（见同名 `.md`）：代码在上、默认收起，输出在下。子调用由对话视图画在详情下面（nb-agent-ui 的 `AgentChainBlock`）。
 */
import {computed, ref} from "vue";
import {CodeBlock, CollapsibleRow} from "@notnotype/nb-ui/components";
import type {AgentConversationContext, AgentConversationServices, AgentViewAction, ToolCallView} from "@notnotype/nb-agent-ui";
import {argString} from "@notnotype/nb-agent-ui";

import {useAgentPageText} from "../text";

const props = defineProps<{call: ToolCallView; ctx?: AgentConversationContext; services?: AgentConversationServices; locale?: string}>();
// 宿主组件的事件形状；这个组件不发，声明出来免得 `@action` 落成根元素的原生监听。
defineEmits<{action: [action: AgentViewAction]}>();

const t = useAgentPageText();
const codeOpen = ref(false);

const lines = (text: string) => text.split("\n").map((line) => ({text: line}));
const code = computed(() => argString(props.call, "code"));
const firstLine = computed(() => code.value.split("\n").find((line) => line.trim() !== "")?.trim() ?? "");
/** 代码交出的图片张数（eval 结果的 `details.images`）。 */
const images = computed(() => {
    const details = props.call.result?.details;
    return details !== null && typeof details === "object" && !Array.isArray(details) && typeof details.images === "number" ? details.images : 0;
});
</script>

<template>
    <div class="eval-detail">
        <!-- 只重置内核的调用没有代码 -->
        <CollapsibleRow v-if="code !== ''" icon="i-lucide-code-xml" :label="t('conversation.eval.code')" :detail="codeOpen ? '' : firstLine" :expanded="codeOpen" data-eval-code @update:expanded="codeOpen = $event">
            <CodeBlock :lines="lines(code)" :start-line="1" />
        </CollapsibleRow>
        <CodeBlock v-if="props.call.result" :label="t('conversation.eval.output')" :lines="lines(props.call.result.text)" :truncated="props.call.result.truncated" data-eval-output />
        <!-- 参数还在生成、在等批准时还没开始执行，不写“正在运行” -->
        <p v-else-if="!props.call.error && props.call.startedAt !== undefined" class="eval-detail__muted">{{ t("conversation.eval.pending") }}</p>
        <p v-if="images > 0" class="eval-detail__muted" data-eval-images>{{ t("conversation.eval.images", {count: images}) }}</p>
    </div>
</template>

<style scoped>
.eval-detail {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    --nb-collapsible-row-px: 6px;
}

.eval-detail__muted {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}
</style>
