<script setup lang="ts">
import {Tooltip} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";

/** 单行截断的长文字（路径、id、分支名）：被截断时悬停或聚焦看全文，点一下复制。契约见同名 .md。 */
/** `display` 给了就显示它、复制的仍是 `text`（日志路径只显示“复制日志路径”，t22）；读屏名称以它开头，语音操作说看到的字就能点到。 */
const props = withDefaults(defineProps<{text: string; mono?: boolean; copyable?: boolean; display?: string | null}>(), {mono: false, copyable: true, display: null});
/** 显示的不是全文（截断了，或者显示的是 `display`）时，提示里给全文。 */
const hidesText = computed(() => truncated.value || (props.display !== null && props.display !== props.text));
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
    if (copied.value === "ok") return hidesText.value ? `已复制：${props.text}` : "已复制";
    if (copied.value === "failed") return hidesText.value ? `复制失败：浏览器不让写剪贴板。全文：${props.text}` : "复制失败：浏览器不让写剪贴板，手动选中复制";
    if (!props.copyable) return props.text;
    return hidesText.value ? `${props.text}（点击复制）` : "点击复制";
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
    <Tooltip :text="tip" :disabled="!copyable && !hidesText">
        <button v-if="copyable" type="button" class="nbdev-truncated nbdev-hit" :class="{'font-mono': mono}" :aria-label="display === null ? `${text}（点击复制）` : `${display}：${text}`" @click="copy" @pointerleave="copied = null" @blur="copied = null">
            <span ref="label" class="block truncate">{{ display ?? text }}</span>
            <!-- 提示框给读屏器的副本在打开时就定了，复制的结果另用一处 live 区念出来。 -->
            <span class="sr-only" aria-live="polite">{{ copied === "ok" ? "已复制" : copied === "failed" ? "复制失败" : "" }}</span>
        </button>
        <span v-else class="nbdev-truncated" :class="{'font-mono': mono}" :tabindex="hidesText ? 0 : undefined"><span ref="label" class="block truncate">{{ display ?? text }}</span></span>
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
