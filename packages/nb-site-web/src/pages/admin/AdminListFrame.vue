<script setup lang="ts">
/**
 * 管理面板列表页的骨架（t10 计划 3.13；t09 第 12 条）：上面一行页名（`AdminPageHead`，插槽 `head` 放页名旁边的控件），下面的数据表格
 * 占满内容区剩下的高度，表格区在自己里面滚，页面不滚。
 *
 * 高度怎么来的：外壳的 `.admin-main__page` 是纵向弹性盒、至少与内容区一样高（`AdminShell.vue`）。这里的根 `flex: 1 1 0` 按 0 起算再
 * 长满，行再多也不把页面撑高（`flex: 1` 的 `0%` 在父元素高度不确定时按内容起算，行一多整页跟着变高，分页条被推到内容区外面）。
 * 表格那一格是定位的容器，`DataTable` 放在绝对定位、四边贴住它的一层里：这样它的 `height: 100%` 一定有确定的高度可占，
 * 不靠浏览器把弹性项长出来的高度当不当作“确定”。
 *
 * 窗口矮到表格那一格不到 `DataTable` 的最小高度（出错的内容要整块放得下，见它的 `.md`）时，那一格按最小高度画，内容区自己滚。
 */

import AdminPageHead from "./AdminPageHead.vue";

defineProps<{title: string; page: string}>();
</script>

<template>
    <div class="admin-list" :data-site-page="page">
        <AdminPageHead :title="title">
            <slot name="head" />
        </AdminPageHead>
        <div class="admin-list__table">
            <div class="admin-list__fill">
                <slot />
            </div>
        </div>
    </div>
</template>

<style scoped>
.admin-list {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    min-height: 0;
}

.admin-list__table {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    min-height: 330px;
}

.admin-list__fill {
    position: absolute;
    inset: 0;
}
</style>
