<script setup lang="ts">
const props = defineProps<{
    name: string;
}>();
</script>

<template>
    <!-- 通用技能 chip -->
    <span
        class="nb-skill-chip"
        :data-agent-skill-name="props.name"
        contenteditable="false"
    >
        <span class="nb-skill-chip__icon i-lucide-sparkles" aria-hidden="true"></span>
        <span class="nb-skill-chip__label">{{ props.name }}</span>
        <span class="nb-skill-chip__badge">技能</span>
    </span>
</template>

<style>
/* 不加 scoped：编辑器正文里的技能标记按同一组 class 渲染成 HTML，样式要对两者都生效。 */
.nb-skill-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    max-width: min(100%, 24rem);
    padding: 0.04rem 0.38rem;
    border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    border-radius: 0.8rem;
    background: color-mix(in srgb, currentColor 9%, var(--bg-panel));
    vertical-align: baseline;
    line-height: 1.2;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 4%, transparent);
    color: var(--status-warning);
}

.nb-skill-chip__icon {
    flex: none;
    width: 0.8rem;
    height: 0.8rem;
    opacity: 0.88;
}

.nb-skill-chip__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.88em;
    line-height: 1.25;
    font-weight: 600;
}

.nb-skill-chip__badge {
    flex: none;
    padding: 0.02rem 0.26rem;
    border-radius: 0.6rem;
    background: color-mix(in srgb, currentColor 12%, transparent);
    color: color-mix(in srgb, currentColor 78%, var(--text-main));
    font-size: 0.58rem;
    line-height: 1.1;
    letter-spacing: 0.08em;
}
</style>
