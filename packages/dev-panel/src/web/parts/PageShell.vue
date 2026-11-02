<script setup lang="ts">
import type {HTMLAttributes} from "vue";
import {Breadcrumb} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {isPlainClick} from "../host/routes.js";

/** 每一页的骨架：页头（面包屑、状态与标题、操作、说明行、写入结果）加正文，内容宽度三档。契约见同名 .md。 */
const props = withDefaults(defineProps<{
    crumbs?: Array<{label: string; href?: string}>;
    title: string;
    width?: "reading" | "list" | "full";
    /** 收起页头、不留内边距（会话页手机上的详情一屏）：根与正文不换，切换时正文里的零件不重建。 */
    bare?: boolean;
    /** 工具页的一行页头（t17，会话页）：面包屑当标题行，内边距与间隙收小，把高度让给正文。`bare` 同时为真时 `bare` 优先。 */
    compact?: boolean;
} & /* @vue-ignore */ HTMLAttributes>(), {crumbs: () => [], width: "list", bare: false, compact: false});
const emit = defineEmits<{navigate: [href: string]}>();
const items = computed(() => props.crumbs.map((crumb, index) => (index === props.crumbs.length - 1 ? {label: crumb.label, current: true} : {label: crumb.label, href: crumb.href})));
/** 一行页头里，面包屑的最后一项（当前页）由紧跟的 h1 代替，不再写两遍。 */
const compactItems = computed(() => items.value.slice(0, -1));
function follow(item: {href?: string}, event: MouseEvent): void {
    if (!item.href || !isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", item.href);
}
</script>

<template>
    <div class="nbdev-page nbdev-stack-page" :class="[`nbdev-page-${width}`, {'nbdev-page-bare': bare, 'nbdev-page-compact': compact && !bare}]">
        <!-- 一行页头：面包屑接着 h1，说明行（meta）在同一行右侧，放不下就折行、不截断（herdr 不可用时那是一整句原因）。 -->
        <header v-if="!bare && compact" class="nbdev-page-header nbdev-stack-tight">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div class="flex min-w-0 items-center gap-1.5">
                    <template v-if="compactItems.length > 0">
                        <Breadcrumb :items="compactItems" @click="follow" />
                        <span class="i-lucide-chevron-right block size-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                    </template>
                    <slot name="status" />
                    <h1 class="min-w-0 break-words font-semibold"><slot name="title">{{ title }}</slot></h1>
                </div>
                <div v-if="$slots.meta" class="nbdev-note flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                    <slot name="meta" />
                </div>
                <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
                    <slot name="actions" />
                </div>
            </div>
            <slot name="feedback" />
        </header>
        <header v-else-if="!bare" class="nbdev-page-header nbdev-stack">
            <Breadcrumb v-if="items.length > 0" :items="items" @click="follow" />
            <!-- 标题行至少 2rem 高：状态徽章、操作按钮有没有都不改变标题的位置，换页时标题停在同一处。 -->
            <div class="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
                <div class="flex min-h-8 min-w-0 flex-1 basis-64 items-center gap-2">
                    <slot name="status" />
                    <h1 class="nbdev-title min-w-0 break-words"><slot name="title">{{ title }}</slot></h1>
                </div>
                <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
                    <slot name="actions" />
                </div>
            </div>
            <div v-if="$slots.meta" class="nbdev-note flex flex-wrap items-center gap-x-3 gap-y-1">
                <slot name="meta" />
            </div>
            <slot name="feedback" />
        </header>
        <slot />
    </div>
</template>

<style scoped>
.nbdev-page {
    padding: 1rem;
}
@media (min-width: 768px) {
    .nbdev-page {
        padding: 1.5rem;
    }
}
.nbdev-page-list {
    width: 100%;
    max-width: 90rem;
    margin-inline: auto;
}
/* 阅读档：按内容收窄并居中；页头不参与撑宽（contain: inline-size），宽度只由正文里定宽的阅读卡片与侧栏决定。 */
.nbdev-page-reading {
    width: fit-content;
    max-width: 100%;
    margin-inline: auto;
}
.nbdev-page-reading > .nbdev-page-header {
    contain: inline-size;
}
.nbdev-page-full {
    width: 100%;
}
.nbdev-page.nbdev-page-compact {
    padding: 0.75rem;
    gap: 0.75rem;
}
.nbdev-page.nbdev-page-bare {
    padding: 0;
}
</style>
