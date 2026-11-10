<script setup lang="ts">
import {Tooltip} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";

/** 单行截断的长文字（路径、id、分支名）：被截断时悬停或聚焦看全文，点一下复制。契约见同名 .md。 */
const props = withDefaults(defineProps<{text: string; mono?: boolean; copyable?: boolean}>(), {mono: false, copyable: true});
const label = ref<HTMLElement | null>(null);
const truncated = ref(false);
/** 复制的结果：null 没复制过；指针或焦点离开时清掉。 */
const copied = ref<"ok" | "failed" | null>(null);
function measure(): void {
    const element = label.value;
    truncated.value = element !== null && element.scrollWidth > element.clientWidth;
}
let observer: ResizeObserver | null = null;
onMounted(() => {
    measure();
    if (label.value) {
        observer = new ResizeObserver(measure);
        observer.observe(label.value);
    }
});
onBeforeUnmount(() => observer?.disconnect());
watch(() => props.text, () => {
    copied.value = null;
    requestAnimationFrame(measure);
});
const tip = computed(() => {
    if (copied.value === "ok") return truncated.value ? `已复制：${props.text}` : "已复制";
    if (copied.value === "failed") return "复制失败：浏览器不让写剪贴板，手动选中复制";
    if (!props.copyable) return props.text;
    return truncated.value ? `${props.text}（点击复制）` : "点击复制";
});
async function copy(): Promise<void> {
    try {
        await navigator.clipboard.writeText(props.text);
        copied.value = "ok";
    } catch (error) {
        console.warn("复制失败", error);
        copied.value = "failed";
    }
}
</script>

<template>
    <Tooltip :text="tip" :disabled="!copyable && !truncated">
        <button v-if="copyable" type="button" class="nbdev-truncated nbdev-hit" :class="{'font-mono': mono}" :aria-label="`${text}（点击复制）`" @click="copy" @pointerleave="copied = null" @blur="copied = null">
            <span ref="label" class="block truncate">{{ text }}</span>
            <!-- 提示框给读屏器的副本在打开时就定了，复制的结果另用一处 live 区念出来。 -->
            <span class="sr-only" aria-live="polite">{{ copied === "ok" ? "已复制" : copied === "failed" ? "复制失败" : "" }}</span>
        </button>
        <span v-else class="nbdev-truncated" :class="{'font-mono': mono}" :tabindex="truncated ? 0 : undefined"><span ref="label" class="block truncate">{{ text }}</span></span>
    </Tooltip>
</template>

<style scoped>
.nbdev-truncated {
    display: inline-block;
    max-width: 100%;
    min-width: 0;
    vertical-align: bottom;
    border-radius: var(--radius-control);
    text-align: left;
}
button.nbdev-truncated {
    cursor: copy;
}
button.nbdev-truncated:hover {
    background: var(--bg-hover);
}
</style>
