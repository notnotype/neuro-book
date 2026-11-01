<script setup lang="ts">
import {Tooltip} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {useModelsText} from "../text";

/** 模型能力的小图标：看图、推理（悬停写出支持的推理档）。图标是 `role="img"` 带文字说明（推理档也在里面），读屏念得出来。 */
const props = defineProps<{
    vision: boolean;
    reasoning: boolean;
    efforts?: readonly string[];
}>();

const text = useModelsText();
// 推理档写进读屏念的名字：图标不进 Tab 序列（一行一两个、几十行就是上百个停靠点），悬停提示只给指针用户。
const reasoningLabel = computed(() => (props.efforts !== undefined && props.efforts.length > 0 ? text("caps.efforts", {efforts: props.efforts.join(" · ")}) : text("caps.reasoning")));
</script>

<template>
    <span class="capability-icons">
        <Tooltip v-if="vision" :text="text('caps.vision')">
            <span class="i-lucide-eye capability-icons__icon capability-icons__icon--vision" role="img" :aria-label="text('caps.vision')" />
        </Tooltip>
        <Tooltip v-if="reasoning" :text="efforts !== undefined && efforts.length > 0 ? text('caps.efforts', {efforts: efforts.join(' · ')}) : text('caps.reasoning')">
            <span class="i-lucide-brain capability-icons__icon capability-icons__icon--reasoning" role="img" :aria-label="reasoningLabel" />
        </Tooltip>
    </span>
</template>

<style scoped>
.capability-icons {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-2);
}

.capability-icons__icon {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-control);
}

.capability-icons__icon--vision {
    color: var(--status-success);
}

.capability-icons__icon--reasoning {
    color: var(--accent-main);
}
</style>
