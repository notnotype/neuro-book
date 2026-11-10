<script setup lang="ts">
defineProps<{title: string}>();
</script>

<template>
    <!-- 一页里会有好几个（首页每张卡片一个），做成 group 而不是地标，读屏的地标列表里不出现一串同名的。 -->
    <div role="group" class="ephemeral-frame relative rounded-[var(--radius-control)] border border-dashed px-3 pb-2 pt-3" :aria-label="`${title}（临时）`">
        <span class="ephemeral-label absolute -top-2 left-2 px-1">{{ title }} · 临时</span>
        <slot />
    </div>
</template>

<style scoped>
.ephemeral-frame {
    border-color: var(--status-info, var(--accent-main));
}
/* 标签压在虚线框的上边线上：底色与页面相同，把那一段线盖住。 */
.ephemeral-label {
    background: var(--bg-main);
    font-size: var(--text-xs);
    /* 状态色当 11px 的字色对比度只有 3.8：往正文色混一截，到 4.5 以上（t22）。 */
    color: color-mix(in srgb, var(--status-info, var(--accent-main)) 70%, var(--text-main));
}
</style>
