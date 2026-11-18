<script setup lang="ts">
/** 表情图的框（同名 .md）。 */
withDefaults(defineProps<{
    url?: string;
    alt?: string;
    faded?: boolean;
    lazy?: boolean;
}>(), {url: undefined, alt: "", faded: false, lazy: false});
</script>

<template>
    <span class="sticker-slot" :class="{'is-faded': faded}">
        <img v-if="url !== undefined" :src="url" :alt="alt" :loading="lazy ? 'lazy' : undefined" decoding="async" />
        <slot v-else />
    </span>
</template>

<style scoped>
/* 大小固定，图按比例缩进去、居中；底色很淡，让不透明的矩形图与透明底的小表情落在同一个框里。 */
.sticker-slot {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 4%, transparent);
    transition: background-color var(--motion-fast), box-shadow var(--motion-fast);
}

.sticker-slot > img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

.sticker-slot.is-faded > img {
    opacity: 0.5;
}
</style>
