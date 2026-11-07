<script setup lang="ts">
/** 字段旁的说明图标（同名 .md）：问号圆圈加 Tooltip。 */
import {computed} from "vue";

import {useUiText} from "../../text-port";
import Tooltip from "./Tooltip.vue";
import type {Align, Side} from "../shared-types";

// 根是 Tooltip（没有自己的元素），attrs 要显式交给按钮。
defineOptions({inheritAttrs: false});

const props = withDefaults(defineProps<{
    text: string;
    label?: string;
    side?: Side;
    align?: Align;
}>(), {
    side: "top",
    align: "center",
});

const text = useUiText();
const labelText = computed(() => props.label ?? text("infoTip.label"));
</script>

<template>
    <Tooltip :text="props.text" :side="props.side" :align="props.align">
        <button
            v-bind="$attrs"
            type="button"
            class="nb-info-tip nb-ui-focus-ring inline-flex h-[18px] w-[18px] shrink-0 cursor-default items-center justify-center rounded-full p-0 align-middle text-[var(--text-muted)] transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-layout)] hover:text-[var(--text-main)]"
            :aria-label="labelText"
        >
            <span class="i-lucide-circle-help h-3.5 w-3.5" aria-hidden="true" />
        </button>
    </Tooltip>
</template>

<style scoped>
/* 和标签文字同一行时不把行撑高：按钮比字高一点，上下各让出一些。 */
.nb-info-tip {
    margin-block: -3px;
}
</style>
