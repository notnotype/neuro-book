<script setup lang="ts">
import {computed} from "vue";
import type {HighlightRect, HighlightTone} from "./highlight-box.types";

/**
 * 标签的文字色走 --text-inverse 而不是 --accent-text。
 *
 * 两者名字像，角色不同：--accent-text 是**强调底色**（--accent-bg，一层低透明度的强调色）
 * 上的文字色，所以它本身就是强调色系的——nbook-light 里它是 #0060df。把它写在实心的
 * --accent-main（#007aff）上，等于蓝字压蓝底，读不出来。实心强调面上的文字色是 --text-inverse。
 */

const LABEL_HEIGHT = 22;

const props = withDefaults(defineProps<{
    rect: HighlightRect | null;
    label?: string;
    tone?: HighlightTone;
    showBox?: boolean;
}>(), {
    label: "",
    tone: "subject",
    showBox: true,
});

const boxStyle = computed(() => {
    const rect = props.rect;
    if (rect === null) {
        return undefined;
    }
    return {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
    };
});

// 框贴着视口下沿时标签会跑出屏幕，翻到框上方。视口高度只在这里读一次，
// 不额外监听 resize——窗口一变使用方就会重新测量并传新 rect，本计算随之重跑。
const labelBelow = computed(() => {
    const rect = props.rect;
    if (rect === null || typeof window === "undefined") {
        return true;
    }
    return rect.top + rect.height + LABEL_HEIGHT <= window.innerHeight;
});

const labelStyle = computed(() => {
    const rect = props.rect;
    if (rect === null) {
        return undefined;
    }
    return {
        left: `${rect.left}px`,
        top: labelBelow.value ? `${rect.top + rect.height}px` : `${rect.top - LABEL_HEIGHT}px`,
    };
});
</script>

<template>
    <!-- 画在视口坐标系上，不碰被框的元素：改元素自己的 outline 会挤动布局，
         也会被组件内部样式盖掉，那样看到的就不是零件本来的样子了。 -->
    <div v-if="props.rect" class="nb-lab-highlight pointer-events-none" aria-hidden="true">
        <div
            v-if="props.showBox"
            class="nb-lab-highlight-box fixed z-50 border"
            :class="props.tone === 'probe'
                ? 'border-dashed border-[var(--text-main)] bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]'
                : 'border-solid border-[var(--accent-main)] bg-[color-mix(in_srgb,var(--accent-main)_5%,transparent)]'"
            :style="boxStyle"
        ></div>
        <div
            v-if="props.label"
            class="nb-lab-highlight-label fixed z-50 max-w-[min(24rem,90vw)] truncate rounded-[3px] px-1.5 py-0.5 font-mono text-[11px] leading-[14px] tabular-nums"
            :class="props.tone === 'probe'
                ? 'bg-[var(--text-main)] text-[var(--bg-main)]'
                : 'bg-[var(--accent-main)] text-[var(--text-inverse)]'"
            :style="labelStyle"
        >{{ props.label }}</div>
    </div>
</template>

<style scoped>
/* pointer-events 必须传到两个子节点上：框一直跟着鼠标走，吃掉事件的话预览区就点不动了 */
.nb-lab-highlight > * {
    pointer-events: none;
}
</style>
