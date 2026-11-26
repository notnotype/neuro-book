<script setup lang="ts">
import {computed} from "vue";

import {providerIcon} from "./index";

/**
 * 服务商的 logo（同名 .md）：按 id 取应用的服务商图标表，单色的用文字色着色、多色的原样显示；表里没有、或地址表还没到时画首字母块。
 * 模型页的 `ProviderIcon`（多了用户上传的图标）与网页工具的设置页共用它。
 */
const props = withDefaults(defineProps<{
    /** 图标表的键：模型目录或模板的 id、网页工具的搜索服务 id；`null` 直接画首字母。 */
    id: string | null;
    /** 首字母块用。 */
    name: string;
    size?: number;
}>(), {size: 18});

/** 在 computed 里取：图标表晚到时（它是响应式的）这里重算，首字母换成图标。 */
const resolved = computed(() => (props.id === null ? null : providerIcon(props.id)));
const initial = computed(() => Array.from(props.name.trim())[0]?.toUpperCase() ?? "?");
const box = computed(() => ({width: `${String(props.size)}px`, height: `${String(props.size)}px`}));
const maskUrl = (src: string): string => `url("${src.replace(/"/gu, "%22")}")`;
</script>

<template>
    <span v-if="resolved?.kind === 'mask'" class="provider-logo provider-logo__mask" :style="{...box, '--provider-logo-src': maskUrl(resolved.src)}" aria-hidden="true" />
    <img v-else-if="resolved?.kind === 'image'" :src="resolved.src" class="provider-logo provider-logo__image" :style="box" alt="" aria-hidden="true">
    <span v-else class="provider-logo provider-logo__initial" :style="{...box, fontSize: `${String(Math.round(size * 0.62))}px`}" aria-hidden="true">{{ initial }}</span>
</template>

<style scoped>
.provider-logo {
    display: inline-flex;
    flex: none;
}

.provider-logo__image {
    object-fit: contain;
}

.provider-logo__mask {
    background: currentColor;
    mask: var(--provider-logo-src) center / contain no-repeat;
}

.provider-logo__initial {
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: color-mix(in srgb, var(--text-main) 12%, transparent);
    color: var(--text-secondary);
    font-weight: var(--weight-strong);
    line-height: 1;
}
</style>
