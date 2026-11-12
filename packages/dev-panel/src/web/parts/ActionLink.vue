<script setup lang="ts">
import {isPlainClick} from "../host/routes.js";

/** 去别的页的次要操作：一个看起来像 ghost 按钮的真实链接（图标加文字）。契约见同名 .md。 */
const props = withDefaults(defineProps<{href: string; icon?: string; external?: boolean; primary?: boolean}>(), {icon: "", external: false, primary: false});
const emit = defineEmits<{navigate: [href: string]}>();
function follow(event: MouseEvent): void {
    if (props.external || !isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", props.href);
}
</script>

<template>
    <a :href="href" class="nbdev-action-link" :class="{'nbdev-action-primary': primary}" :target="external ? '_blank' : undefined" :rel="external ? 'noopener noreferrer' : undefined" @click="follow">
        <span v-if="icon" :class="icon" class="size-3.5 shrink-0" aria-hidden="true" />
        <slot />
    </a>
</template>

<style scoped>
.nbdev-action-link {
    display: inline-flex;
    min-height: 1.75rem;
    align-items: center;
    gap: 0.375rem;
    border-radius: var(--radius-control);
    padding: 0.125rem 0.5rem;
    color: var(--text-main);
    font-size: var(--text-xs);
    font-weight: 500;
    /* 文字是动态的（首页的会话统计），放不下就换行：390 宽时整句不换行会把页面撑出横向滚动。 */
    max-width: 100%;
    overflow-wrap: anywhere;
}
.nbdev-action-link:hover {
    background: var(--bg-hover);
}
/* 页头的主要操作（t22）：实心。底色比强调色深一档，白字在亮暗两态都到 4.5:1（强调色本身配白字只有 3.9）。 */
.nbdev-action-link.nbdev-action-primary {
    background: color-mix(in srgb, var(--accent-main) 82%, black);
    color: #fff;
}
.nbdev-action-link.nbdev-action-primary:hover {
    background: color-mix(in srgb, var(--accent-main) 70%, black);
}
</style>
