<script setup lang="ts">
/** 背景的画法（同名 .md）：一层图，一层面色遮罩。设置页的预览和真实显示都用它。 */
const props = defineProps<{
    url: string | null;
    fit?: "cover" | "contain" | "repeat";
    blur?: boolean;
    /** 遮罩的不透明度，0–1；纯色时没有图，遮罩就是整块颜色。 */
    alpha?: number;
    /** 遮罩的颜色；缺省是主题的面板色。 */
    color?: string | null;
}>();
</script>

<template>
    <div class="background-layer" aria-hidden="true" data-background-layer>
        <div
            v-if="props.url !== null"
            class="background-layer__image"
            :class="{'is-blurred': props.blur === true}"
            :style="{
                backgroundImage: `url(&quot;${props.url}&quot;)`,
                backgroundSize: props.fit === 'repeat' ? 'auto' : props.fit ?? 'cover',
                backgroundRepeat: props.fit === 'repeat' ? 'repeat' : 'no-repeat',
            }"
            data-background-image
        ></div>
        <div class="background-layer__scrim" :style="{background: props.color ?? 'var(--bg-panel)', opacity: props.alpha ?? 1}" data-background-scrim></div>
    </div>
</template>

<style scoped>
.background-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
}

.background-layer__image {
    position: absolute;
    inset: 0;
    background-position: center;
}

/* 模糊的边缘是透明的：往外多铺一圈，裁掉。 */
.background-layer__image.is-blurred {
    inset: -28px;
    filter: blur(14px);
}

.background-layer__scrim {
    position: absolute;
    inset: 0;
}
</style>
