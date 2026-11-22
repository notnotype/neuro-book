<script setup lang="ts">
import {computed, ref, watch} from "vue";

import type {ComposerIcon} from "../../types";
import {useAgentIcons} from "../host";

const props = withDefaults(defineProps<{icon?: ComposerIcon | null; size?: number}>(), {icon: null, size: 14});

const resolveIcon = useAgentIcons();
/** 在 computed 里调端口：端口读的响应式表被追踪，表晚到时这里重算。 */
const resolved = computed(() => (props.icon === null || props.icon.kind === "url" ? null : resolveIcon(props.icon)));
/** 图片地址类的引用直接画；加载失败后换成首字母块（上传的文件被删、读取被拒时）。 */
const broken = ref(false);
const url = computed(() => (props.icon?.kind === "url" && !broken.value ? props.icon.src : null));
const initial = computed(() => {
    if (props.icon === null) return null;
    if (resolved.value?.kind === "initial") return resolved.value.text;
    if (resolved.value !== null) return null;
    if (props.icon.kind === "url") return broken.value ? Array.from((props.icon.fallback ?? "?").trim())[0]?.toUpperCase() ?? "?" : null;
    return props.icon.kind === "key" ? Array.from((props.icon.fallback ?? props.icon.key).trim())[0]?.toUpperCase() ?? "?" : null;
});
watch(() => (props.icon?.kind === "url" ? props.icon.src : null), () => {
    broken.value = false;
});
/** 地址写进 CSS 变量：data 地址里可能有空格、括号与引号，不加引号的 `url()` 会在那里断开，mask 失效、整块填成实色。 */
function maskUrl(src: string): string {
    return `url("${src.replace(/"/gu, "%22")}")`;
}
const box = computed(() => ({width: `${String(props.size)}px`, height: `${String(props.size)}px`}));
</script>

<template>
    <!-- 单根：调用方传来的 class（颜色）落在这一层，图标继承它的文字色。 -->
    <span v-if="props.icon !== null" class="acv-icon-slot" :style="box" aria-hidden="true">
        <span v-if="resolved?.kind === 'class'" :class="resolved.name" class="acv-icon" :style="box" />
        <span v-else-if="resolved?.kind === 'mask'" class="acv-icon acv-icon--mask" :style="{...box, '--acv-icon-src': maskUrl(resolved.src)}" />
        <img v-else-if="resolved?.kind === 'image'" :src="resolved.src" class="acv-icon" :style="box" alt="">
        <img v-else-if="url !== null" :src="url" class="acv-icon" :style="box" alt="" data-acv-icon-url @error="broken = true">
        <span v-else-if="initial !== null" class="acv-icon acv-icon--initial" :style="{...box, fontSize: `${String(Math.round(props.size * 0.62))}px`}">{{ initial }}</span>
    </span>
</template>

<style scoped>
.acv-icon-slot {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
}

.acv-icon {
    display: inline-block;
    flex: none;
    object-fit: contain;
    vertical-align: middle;
}

.acv-icon--mask {
    background: currentColor;
    mask: var(--acv-icon-src) center / contain no-repeat;
}

.acv-icon--initial {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: color-mix(in srgb, var(--text-main) 12%, transparent);
    color: var(--text-secondary);
    font-weight: var(--weight-strong);
    line-height: 1;
}
</style>
