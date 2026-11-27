<script setup lang="ts">
/** 管理面板一页的标题行（照 t09 定稿 `SiteAdminShellDraft` 的页名一行）：页名加这一页的控件（插槽，靠右的自己用弹性空白推）。 */

defineProps<{title: string}>();
</script>

<template>
    <header class="admin-head">
        <h1>{{ title }}</h1>
        <slot />
    </header>
</template>

<style scoped>
.admin-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding-left: 4px;
}

.admin-head h1 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
}
</style>
