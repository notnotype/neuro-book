<script setup lang="ts">
/**
 * w00039 t42 第 1 轮静态稿：条目页的页头、分页与保存后的提示。不接世界，样本写死；人物分页的内容是真实的 `CharacterCard`。
 * 上面一条编辑器标签栏只是示意（标签带图标的样子），不是真实的 `EditorTabBar`。
 */
import {computed, ref} from "vue";

import {Button, IconButton, Popover, Switch, Tabs} from "@notnotype/nb-ui/components";

import CharacterCard from "nbook/plugins/canon/web/components/CharacterCard.vue";

import {BLANK_CARD, BLANK_TABS, CHAPTERS, FILLED_CARD, FILLED_TABS} from "./sample";
import type {DraftTab} from "./sample";

const props = withDefaults(defineProps<{
    /** 分页的排法：tabs 横排两段（设定组与文字、末尾“＋” │ 经历与情节）；rail 在内容左边竖排（窄了换回横排）。 */
    variant?: "tabs" | "rail";
    /** filled 填好的；new 空作品里刚新建、加上了形象；notice 保存后的提示；position 时间点展开；plan 算上计划；name-hover 指着名字。 */
    scene?: "filled" | "new" | "notice" | "position" | "plan" | "name-hover";
    /** 横排分页的尺寸；默认 "md"。 */
    tabSize?: "sm" | "md";
}>(), {variant: "tabs", scene: "filled", tabSize: "md"});

const blank = computed(() => props.scene === "new");
const tabs = computed<readonly DraftTab[]>(() => (blank.value ? BLANK_TABS : FILLED_TABS));
const tab = ref("person");
const tabSize = computed(() => props.tabSize);
const card = computed(() => (blank.value ? BLANK_CARD : FILLED_CARD));
const name = computed(() => (blank.value ? "新人物" : "星瑕"));
const summary = computed(() => (blank.value ? "" : "前蓝星最强的魔法少女，隐退后以哥哥的样子把妹妹接回家住"));
const aliases = computed(() => (blank.value ? [] : ["哥哥", "小瑕"]));
const planned = ref(props.scene === "plan");
/** 空作品没有章：时间点只有“开篇前”一个，按钮不出。 */
const hasChapters = computed(() => !blank.value);
const positionLabel = computed(() => "第 3 章末尾");
const positionOpen = ref(props.scene === "position");

/** 一条分页：设定组与文字在前，不对应设定组的看法（经历、情节）在后，第一个看法前画一条分隔线。 */
const tabItems = computed(() => {
    const own = tabs.value.filter((item) => item.kind !== "view");
    const views = tabs.value.filter((item) => item.kind === "view");
    return [...own, ...views].map((item, index) => ({
        value: item.value,
        label: item.label,
        iconClass: item.icon,
        ...(item.count === undefined ? {} : {count: item.count}),
        ...(index === own.length && own.length > 0 ? {attrs: {"data-segment-start": ""}} : {}),
    }));
});
/** 竖排时分三段：设定组（末尾“添加一组设定”）、文字、从剧情算出来的。 */
const railGroups = computed(() => [
    tabs.value.filter((item) => item.kind === "group" || item.kind === "text"),
    tabs.value.filter((item) => item.kind === "view"),
]);
const editorTabs = computed(() => [
    {icon: "i-lucide-user-round", label: name.value, active: true},
    {icon: "i-lucide-file-text", label: "第 3 章 学院开学.md", active: false},
    {icon: "i-lucide-map-pin", label: "星家老宅", active: false},
]);
</script>

<template>
    <div class="draft-root flex h-full min-h-0 w-full flex-col bg-[var(--panel-surface)]" data-draft-entry-page :data-variant="props.variant">
        <!-- 编辑器标签栏（示意）：条目页的标签按条目的种类带图标，与文件标签同一个位置。 -->
        <div class="flex h-9 shrink-0 items-end bg-[var(--editor-tabs-surface,var(--strip-surface))] pl-1">
            <div
                v-for="item in editorTabs"
                :key="item.label"
                class="flex h-[calc(100%-4px)] max-w-52 items-center gap-1.5 rounded-t-[var(--radius-control)] px-3 text-[length:var(--text-sm)]"
                :class="item.active ? 'bg-[var(--panel-surface)] text-[var(--text-main)]' : 'text-[var(--text-secondary)]'"
            >
                <span :class="item.icon" class="size-4 shrink-0 opacity-80" aria-hidden="true" />
                <span class="truncate">{{ item.label }}</span>
                <span v-if="item.active" class="i-lucide-x ml-1 size-3.5 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            </div>
        </div>
        <nav class="flex h-7 shrink-0 items-center gap-1 px-4 text-[length:var(--text-xs)] text-[var(--text-secondary)]" aria-label="面包屑">
            <span>设定</span><span class="i-lucide-chevron-right size-3 opacity-60" aria-hidden="true" /><span>人物</span><span class="i-lucide-chevron-right size-3 opacity-60" aria-hidden="true" /><span class="text-[var(--text-main)]">{{ name }}</span>
        </nav>

        <div class="relative min-h-0 flex-1">
            <div class="absolute inset-0 overflow-y-auto">
                <header class="draft-column draft-pad mx-auto pt-6" :class="props.variant === 'rail' ? 'draft-column--rail' : ''">
                    <div class="draft-headrow flex items-start gap-4">
                        <div class="min-w-0 flex-1">
                            <!-- 名字、简介本身就是按钮：悬停时浅底，点了在原处出浮层改（同人物分页的短项）。浅底用负外边距，悬停不挪字。 -->
                            <button type="button" class="draft-editable group -mx-1.5 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 text-left text-[length:var(--text-2xl,1.5rem)] font-semibold leading-snug text-[var(--text-main)]" :data-hover="props.scene === 'name-hover' ? '' : undefined" aria-label="改名字">{{ name }}<span class="draft-pencil i-lucide-pencil size-3.5 text-[var(--text-muted)]" aria-hidden="true" /></button>
                            <button v-if="summary !== ''" type="button" class="draft-editable -mx-1.5 mt-1 block rounded-[var(--radius-control)] px-1.5 text-left text-[length:var(--text-sm)] text-[var(--text-secondary)]">{{ summary }}</button>
                            <button v-else type="button" class="draft-editable -mx-1.5 mt-1 block rounded-[var(--radius-control)] px-1.5 text-left text-[length:var(--text-sm)] text-[var(--text-muted)]">一句话简介</button>
                            <ul class="mt-2 flex flex-wrap items-center gap-1.5" :class="aliases.length === 0 ? '-ml-2' : ''" aria-label="别名">
                                <li v-for="alias in aliases" :key="alias" class="flex h-6 items-center rounded-[var(--radius-pill)] bg-[var(--bg-subtle)] px-2.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]">{{ alias }}</li>
                                <li>
                                    <button type="button" class="flex h-6 items-center gap-1 rounded-[var(--radius-pill)] px-2 text-[length:var(--text-xs)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"><span class="i-lucide-plus size-3" aria-hidden="true" />添加别名</button>
                                </li>
                            </ul>
                        </div>
                        <div class="flex shrink-0 items-center gap-1">
                            <Popover v-if="hasChapters" :open="positionOpen" align="end" content-class="w-72 !p-1.5" @update:open="(value: boolean) => (positionOpen = value)">
                                <template #trigger>
                                    <Button size="sm" variant="ghost">
                                        <span class="i-lucide-clock-3 size-4" aria-hidden="true" />{{ positionLabel }}<span class="i-lucide-chevron-down size-3.5 opacity-60" aria-hidden="true" />
                                    </Button>
                                </template>
                                <div class="flex flex-col text-[length:var(--text-sm)]" role="listbox" aria-label="看哪个时间点">
                                    <button type="button" class="draft-option">开篇前</button>
                                    <template v-for="chapter in CHAPTERS" :key="chapter.n">
                                        <div class="flex items-center gap-1 rounded-[var(--radius-control)] px-2 pt-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">第 {{ chapter.n }} 章 {{ chapter.title }}</div>
                                        <div class="flex gap-1 px-1">
                                            <button type="button" class="draft-option flex-1">开头</button>
                                            <button type="button" class="draft-option flex-1" :data-selected="chapter.n === 3 ? '' : undefined">末尾<span v-if="chapter.n === 3" class="i-lucide-check ml-auto size-3.5" aria-hidden="true" /></button>
                                        </div>
                                    </template>
                                    <div class="my-1.5 h-px bg-[var(--divider)]" />
                                    <label class="flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 py-1.5">
                                        算上计划中的情节
                                        <Switch size="sm" :model-value="planned" aria-label="算上计划中的情节" @update:model-value="(value: boolean) => (planned = value)" />
                                    </label>
                                </div>
                            </Popover>
                            <!-- 算上计划时多一枚标记，点 × 回到实际：这时值都不能改，一步就能退出。 -->
                            <button v-if="planned" type="button" class="flex h-7 items-center gap-1 rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--status-info)_14%,transparent)] pl-2.5 pr-1.5 text-[length:var(--text-xs)] text-[var(--text-main)]" title="不算计划">算上计划<span class="i-lucide-x size-3.5 opacity-70" aria-hidden="true" /></button>
                            <IconButton size="sm" icon-class="i-lucide-ellipsis" aria-label="更多" title="更多" />
                        </div>
                    </div>
                    <div class="mt-4 flex items-end gap-1 border-b border-[var(--divider)]" :class="props.variant === 'rail' ? 'draft-rail-fallback' : ''">
                        <Tabs class="draft-tabs min-w-0 flex-[1_1_auto]" :size="tabSize" overflow="adapt" :baseline="false" aria-label="分页" :items="tabItems" :model-value="tab" @update:model-value="(value: string) => (tab = value)" />
                        <IconButton class="mb-1 shrink-0" size="sm" icon-class="i-lucide-plus" aria-label="添加一组设定" title="添加一组设定" />
                    </div>
                </header>

                <div v-if="props.variant !== 'rail'" class="draft-column draft-pad mx-auto py-6">
                    <CharacterCard v-bind="card" />
                </div>
                <div v-else class="draft-column draft-column--rail draft-pad draft-rail-grid mx-auto py-6">
                    <nav class="draft-rail sticky top-4 self-start" aria-label="分页">
                        <ul v-for="(group, index) in railGroups" :key="index" class="flex flex-col gap-0.5" :class="index > 0 && group.length > 0 ? 'mt-3 border-t border-[var(--divider)] pt-3' : ''">
                            <li v-for="item in group" :key="item.value">
                                <button
                                    type="button"
                                    class="flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2.5 text-left text-[length:var(--text-sm)]"
                                    :class="item.value === tab ? 'bg-[var(--overlay-item-active)] font-medium text-[var(--text-main)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                                    @click="tab = item.value"
                                >
                                    <span :class="[item.icon, item.value === tab ? 'text-[var(--accent-main)]' : '']" class="size-4 shrink-0" aria-hidden="true" />
                                    <span class="truncate">{{ item.label }}</span>
                                    <span v-if="item.count !== undefined" class="ml-auto text-[length:var(--text-xs)] tabular-nums text-[var(--text-muted)]">{{ item.count }}</span>
                                </button>
                            </li>
                            <li v-if="index === 0">
                                <button type="button" class="flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2.5 text-left text-[length:var(--text-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]">
                                    <span class="i-lucide-plus size-4 shrink-0" aria-hidden="true" />添加一组设定
                                </button>
                            </li>
                        </ul>
                    </nav>
                    <div class="min-w-0">
                        <CharacterCard v-bind="card" />
                    </div>
                </div>
            </div>

            <!-- 保存后的提示：浮在页面下方，盖在内容上，不推开任何东西；从下面滑上来。 -->
            <div v-if="props.scene === 'notice'" class="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4">
                <div class="draft-snackbar pointer-events-auto flex h-10 items-center gap-1 rounded-[var(--radius-control-lg)] pl-3 pr-1 text-[length:var(--text-sm)] text-[var(--text-main)]" role="status">
                    <span class="i-lucide-circle-check size-4 shrink-0 text-[var(--status-success)]" aria-hidden="true" />
                    <span class="mr-2 truncate">加上“形象”这组设定</span>
                    <Button size="sm" variant="ghost">查看详情</Button>
                    <Button size="sm" variant="ghost">撤销</Button>
                    <IconButton size="sm" icon-class="i-lucide-x" aria-label="关闭" />
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 页头与内容同一个上限、同一个内边距，左边对齐（现状页头比内容少缩进 32 像素）。 */
.draft-root {
    container-type: inline-size;
}
.draft-column {
    max-width: calc(760px + 64px);
}
.draft-pad {
    padding-inline: 32px;
}
.draft-rail-grid {
    display: grid;
    grid-template-columns: 168px minmax(0, 1fr);
    gap: 32px;
}
/* 竖排导航只在放得下两栏时出；窄了换回页头下面的横排分页。 */
.draft-rail-fallback {
    display: none;
}
@container (max-width: 960px) {
    .draft-rail-grid {
        grid-template-columns: minmax(0, 1fr);
    }
    .draft-rail {
        display: none;
    }
    .draft-rail-fallback {
        display: flex;
    }
}
@container (max-width: 480px) {
    .draft-pad {
        padding-inline: 16px;
    }
    .draft-headrow {
        flex-direction: column;
        gap: 8px;
    }
}
.draft-column--rail {
    max-width: calc(760px + 168px + 32px + 64px);
}
.draft-editable {
    transition: background-color var(--motion-fast) var(--ease-layout);
}
.draft-editable:hover,
.draft-editable[data-hover] {
    background: var(--bg-hover);
}
/* 两段之间的分隔：画在第一个看法分页的左边。 */
.draft-tabs :deep([data-segment-start]) {
    margin-left: 17px;
    position: relative;
}
.draft-tabs :deep([data-segment-start])::before {
    content: "";
    position: absolute;
    left: -9px;
    top: 30%;
    bottom: 30%;
    width: 1px;
    background: var(--divider);
}
/* 铅笔一直占位、只换透明度：悬停时不挪字。 */
.draft-pencil {
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.draft-editable:hover .draft-pencil,
.draft-editable:focus-visible .draft-pencil,
.draft-editable[data-hover] .draft-pencil {
    opacity: 1;
}
.draft-option {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    height: 1.875rem;
    padding: 0 0.5rem;
    border-radius: var(--radius-control);
    text-align: left;
}
.draft-option:hover,
.draft-option[data-selected] {
    background: var(--overlay-item-active);
}
.draft-option[data-selected] {
    color: var(--accent-main);
}
.draft-snackbar {
    background: var(--overlay-surface);
    backdrop-filter: blur(var(--overlay-blur));
    box-shadow: var(--elevation-popover);
}
</style>
