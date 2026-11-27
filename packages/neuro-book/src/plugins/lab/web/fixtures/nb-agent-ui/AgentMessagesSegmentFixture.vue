<script setup lang="ts">
/**
 * 视图段单独挂（不给 `targets`，画在自己的位置上）：收着的场景给 48 宽、展开的给场景名里的宽（缺省 260），左边一条描边当作挨着聊天区。
 * 送进侧轨的样子在 `AgentMessages` 的 `docked` 场景里。
 */
import {AgentMessagesSegment} from "@notnotype/nb-agent-ui/vue";
import {computed} from "vue";

import {useLabSubject, type LabFixtureProps} from "../../lab-subject";
import {withAgentSceneText} from "./agent-text";

const props = defineProps<LabFixtureProps>();
const Segment = withAgentSceneText(AgentMessagesSegment);
const subject = useLabSubject<typeof AgentMessagesSegment>(() => props.input, ["open-contact", "retry-contacts", "open-session", "new-session", "show-list", "escape-search"]);
const width = computed(() => (props.input?.props?.expanded === true ? Number(/-(200|420)(?:-|$)/u.exec(props.scene)?.[1] ?? 260) : 48));
</script>

<template>
    <div class="flex h-[480px] border-l border-[var(--border-color)]" :style="{width: `${width}px`}">
        <Segment data-lab-subject v-bind="subject.bindings.value">
            <template #sessions>
                <div class="p-2 text-sm text-[var(--text-muted)]">会话面板（AgentSessionPanel）</div>
            </template>
        </Segment>
    </div>
</template>
