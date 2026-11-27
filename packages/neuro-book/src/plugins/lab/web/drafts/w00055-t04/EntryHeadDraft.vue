<script setup lang="ts">
/**
 * w00055 t04 第 1 轮静态稿：条目页的页头三种排法（现在、两栏、压成两行），下面接真实的分页条（或宽时的竖排导航）与分页内容，
 * 上面画一条编辑区的面包屑（真实页面里分组与上级已经写在那里，页头不再重复）。只摆样子：点名字、简介、别名不改东西。
 */
import {computed, ref} from "vue";

import {Button, DropdownMenu, IconButton, Tabs} from "@notnotype/nb-ui/components";
import type {TabsItem} from "@notnotype/nb-ui/components";

import CharacterCard from "nbook/plugins/canon/web/components/groups/CharacterCard.vue";
import EntryPageNav from "nbook/plugins/canon/web/components/entry-page/EntryPageNav.vue";
import ViewPointPicker from "nbook/plugins/canon/web/components/entry-page/ViewPointPicker.vue";
import type {EntryTab} from "nbook/plugins/canon/web/components/entry-page/entry-tabs";
import {characterEmpty, characterFilled, CHAPTERS, PORTRAIT_URL} from "./samples";

const props = withDefaults(defineProps<{
    /** 页头的排法：`current` 照现在的条目页；`columns` 左身份右事实；`compact` 一栏、事实写在名字后面。 */
    layout: "current" | "columns" | "compact";
    /** 条目：刚新建的普通条目、刚新建的人物、填好的人物（马甲、第 2 章出场、有章节）。 */
    entry: "plain" | "person" | "filled";
    /** 填好的人物用立绘做头像（立绘属于“形象”这组设定，跨了对象，单独问）。默认 false。 */
    avatar?: boolean;
    /** 宽编辑区：分页换成内容左边的竖排（同真实条目页 1040 像素以上）。默认 false。 */
    rail?: boolean;
    /** 文字分页没有主文字时：`button` 照现在（一句话加“开始写”），`line` 一行淡的占位、点了进编辑。默认 `button`。 */
    textEmpty?: "button" | "line";
    /** 一开始选中的分页。默认第一个。 */
    tab?: string;
}>(), {avatar: false, rail: false, textEmpty: "button", tab: ""});

const filled = computed(() => props.entry === "filled");
const person = computed(() => props.entry !== "plain");
const name = computed(() => (props.entry === "plain" ? "新条目甲" : props.entry === "person" ? "新人物乙" : "星瑕"));
const summary = computed(() => (filled.value ? "前蓝星最强的魔法少女，隐退后以哥哥的样子把妹妹接回家住" : ""));
const aliases = computed(() => (filled.value ? ["小瑕", "夜王"] : []));
const kind = computed(() => (props.entry === "plain" ? "" : "人物"));
/** 出场：没写时是“一开始就在”。 */
const appears = computed(() => (filled.value ? "第 2 章开头" : "一开始就在"));
const sameAs = computed(() => (filled.value ? "星瑾" : ""));
/** 有章节才有“在看”（真实页面只有一个位置、没有计划又只有主线时不出）。 */
const hasChapters = computed(() => filled.value);
const crumbs = computed(() => (props.entry === "plain" ? ["设定", name.value] : ["设定", "人物", name.value]));

const tabs = computed<EntryTab[]>(() => [
    ...(person.value ? [{value: "character", label: "人物", iconClass: "i-lucide-user-round", segment: "own" as const, removable: true}, {value: "look", label: "形象", iconClass: "i-lucide-shirt", segment: "own" as const, removable: true}] : []),
    {value: "text", label: "文字", iconClass: "i-lucide-file-text", segment: "own"},
    ...(filled.value ? [{value: "plot", label: "情节", iconClass: "i-lucide-git-commit-horizontal", segment: "view" as const, count: 4}] : []),
]);
const tab = ref(props.tab !== "" ? props.tab : (tabs.value[0]?.value ?? "text"));
const tabItems = computed<TabsItem[]>(() => tabs.value.map((item) => ({value: item.value, label: item.label, iconClass: item.iconClass, ...(item.count === undefined ? {} : {count: item.count})})));
const position = ref("2:end");
const menu = [{id: "move", label: "移动…", iconClass: "i-lucide-folder-input"}, {id: "delete", label: "删除条目", iconClass: "i-lucide-trash-2"}];
const tabId = (value: string) => `draft-tab-${value}`;
</script>

<template>
    <div class="entry-head-draft h-full w-full overflow-y-auto bg-[var(--panel-surface)]">
        <!-- 编辑区的面包屑：属于工作台，不属于页头；画出来是为了看页头与它重复了什么。 -->
        <nav class="flex h-8 items-center gap-1 px-3 text-[length:var(--text-xs)] text-[var(--text-secondary)]" aria-label="面包屑">
            <template v-for="(crumb, index) in crumbs" :key="crumb">
                <span v-if="index > 0" class="i-lucide-chevron-right size-3 text-[var(--text-muted)]" aria-hidden="true" />
                <span :class="index === crumbs.length - 1 ? 'text-[var(--text-main)]' : ''">{{ crumb }}</span>
            </template>
        </nav>
        <header class="border-b border-[var(--divider)] pt-5">
            <div class="draft-column draft-head mx-auto" :class="props.rail ? 'draft-column--rail' : ''">
                <!-- 现在：左边三行，右边只有“…”；“在看”在别名那一行的右端。 -->
                <div v-if="props.layout === 'current'" class="flex items-start gap-4">
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-baseline gap-x-2">
                            <h1 class="m-0 text-[length:var(--text-xl)] font-semibold">{{ name }}</h1>
                            <span v-if="sameAs !== ''" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">是谁：<span class="text-[var(--accent-main)]">{{ sameAs }}</span></span>
                        </div>
                        <p class="mt-1 text-[length:var(--text-sm)]" :class="summary === '' ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'">{{ summary === "" ? "一句话简介" : summary }}</p>
                        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                            <ul class="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
                                <li v-for="alias in aliases" :key="alias" class="draft-alias">{{ alias }}<span class="i-lucide-x size-3 text-[var(--text-muted)]" aria-hidden="true" /></li>
                                <li><Button size="sm" variant="ghost"><span class="i-lucide-plus size-3.5" aria-hidden="true" />添加别名</Button></li>
                            </ul>
                            <ViewPointPicker v-if="hasChapters" class="ml-auto" :chapters="CHAPTERS" :position="position" @update:position="(value: string) => (position = value)" />
                        </div>
                    </div>
                    <DropdownMenu align="end" :items="menu"><IconButton size="sm" icon-class="i-lucide-ellipsis" aria-label="更多" /></DropdownMenu>
                </div>

                <!--
                    两栏：左边是条目是谁（头像、名字、简介、别名），右边是它在故事里的坐标（种类、出场、在看），右栏定宽、上下与左栏对齐；
                    “在看”仍在贴着内容的那一行（t42 定的）。分组与上级在面包屑里，不在这里再写。窄时右栏折到下面成一行。
                -->
                <div v-else-if="props.layout === 'columns'" class="draft-columns">
                    <div class="draft-columns__who">
                        <img v-if="props.avatar && filled" class="draft-avatar" :src="PORTRAIT_URL" alt="" />
                        <div class="min-w-0 flex-1">
                            <div class="flex flex-wrap items-baseline gap-x-2">
                                <h1 class="m-0 text-[length:var(--text-xl)] font-semibold">{{ name }}</h1>
                                <span v-if="sameAs !== ''" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">是谁：<span class="text-[var(--accent-main)]">{{ sameAs }}</span></span>
                            </div>
                            <p class="mt-1 text-[length:var(--text-sm)]" :class="[summary === '' ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]', props.avatar && filled ? 'truncate' : '']" :title="summary">{{ summary === "" ? "一句话简介" : summary }}</p>
                            <ul class="m-0 mt-2 flex list-none flex-wrap items-center gap-1.5 p-0">
                                <li v-for="alias in aliases" :key="alias" class="draft-alias">{{ alias }}<span class="i-lucide-x size-3 text-[var(--text-muted)]" aria-hidden="true" /></li>
                                <li><Button class="-ml-2" size="sm" variant="ghost"><span class="i-lucide-plus size-3.5" aria-hidden="true" />添加别名</Button></li>
                            </ul>
                        </div>
                    </div>
                    <div class="draft-columns__where">
                        <div class="flex items-start justify-between gap-2">
                            <dl class="draft-facts">
                                <dt>种类</dt>
                                <dd><button type="button" class="draft-fact-button" :class="kind === '' ? 'text-[var(--text-muted)]' : ''">{{ kind === "" ? "未定" : kind }}</button></dd>
                                <dt>出场</dt>
                                <dd><button type="button" class="draft-fact-button">{{ appears }}</button></dd>
                            </dl>
                            <DropdownMenu align="end" :items="menu"><IconButton size="sm" icon-class="i-lucide-ellipsis" aria-label="更多" /></DropdownMenu>
                        </div>
                        <ViewPointPicker v-if="hasChapters" class="mt-2 self-start" :chapters="CHAPTERS" :position="position" @update:position="(value: string) => (position = value)" />
                    </div>
                </div>

                <!-- 压成两行：名字后面跟种类与出场的小字，简介接在下面；别名并进简介那一行的末尾，“在看”在右端。 -->
                <div v-else class="flex items-start gap-4">
                    <img v-if="props.avatar && filled" class="draft-avatar" :src="PORTRAIT_URL" alt="" />
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-baseline gap-x-3">
                            <h1 class="m-0 text-[length:var(--text-xl)] font-semibold">{{ name }}</h1>
                            <span class="flex flex-wrap items-baseline gap-x-2 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                                <button type="button" class="draft-fact-button" :class="kind === '' ? 'text-[var(--text-muted)]' : ''">{{ kind === "" ? "种类未定" : kind }}</button>
                                <span class="text-[var(--text-muted)]" aria-hidden="true">·</span>
                                <button type="button" class="draft-fact-button">{{ filled ? "第 2 章出场" : "一开始就在" }}</button>
                                <template v-if="sameAs !== ''"><span class="text-[var(--text-muted)]" aria-hidden="true">·</span><span>是谁：<span class="text-[var(--accent-main)]">{{ sameAs }}</span></span></template>
                            </span>
                        </div>
                        <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                            <p class="m-0 min-w-0 text-[length:var(--text-sm)]" :class="summary === '' ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'">{{ summary === "" ? "一句话简介" : summary }}</p>
                            <ul class="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
                                <li v-for="alias in aliases" :key="alias" class="draft-alias">{{ alias }}<span class="i-lucide-x size-3 text-[var(--text-muted)]" aria-hidden="true" /></li>
                                <li><Button size="sm" variant="ghost"><span class="i-lucide-plus size-3.5" aria-hidden="true" />别名</Button></li>
                            </ul>
                            <ViewPointPicker v-if="hasChapters" class="ml-auto" :chapters="CHAPTERS" :position="position" @update:position="(value: string) => (position = value)" />
                        </div>
                    </div>
                    <DropdownMenu align="end" :items="menu"><IconButton size="sm" icon-class="i-lucide-ellipsis" aria-label="更多" /></DropdownMenu>
                </div>
            </div>
            <div v-if="!props.rail" class="draft-column mx-auto mt-3 flex items-end gap-1">
                <Tabs class="min-w-0" size="sm" :baseline="false" aria-label="分页" :items="tabItems" :model-value="tab" @update:model-value="(value: string) => (tab = value)" />
                <IconButton class="mb-1 shrink-0" size="sm" icon-class="i-lucide-plus" aria-label="添加一组设定" />
            </div>
            <div v-else class="h-4" />
        </header>
        <div class="draft-column mx-auto py-5" :class="props.rail ? 'draft-column--rail draft-body--rail' : ''">
            <EntryPageNav v-if="props.rail" :items="tabs" :model-value="tab" can-add :tab-id="tabId" panel-id="draft-panel" @update:model-value="(value: string) => (tab = value)" />
            <div class="min-w-0">
                <CharacterCard v-if="tab === 'character'" v-bind="filled ? characterFilled : characterEmpty" />
                <div v-else-if="tab === 'text'">
                    <div v-if="filled" class="text-[length:var(--text-md)] leading-relaxed">星瑕是前蓝星最强的魔法少女。六岁那年的大灾难之后被对策委员会带走，几年里成了最强；灾难平息后被安上罪名，顺势隐退。</div>
                    <div v-else-if="props.textEmpty === 'button'" class="my-2 flex flex-col items-start gap-3">
                        <p class="m-0 text-[var(--text-muted)]">还没有主文字</p>
                        <Button variant="primary">开始写</Button>
                    </div>
                    <!-- 一行淡的占位，整行可点、指着时浮出浅底，点了进编辑（阅读与编辑仍然分开）。 -->
                    <button v-else type="button" class="draft-text-empty"><span class="i-lucide-pencil-line size-4" aria-hidden="true" />写点什么…</button>
                </div>
                <p v-else class="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">（这一页的内容不在本轮范围）</p>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 与真实条目页同一个内容列：净宽 760，竖排时加导航 200。 */
.draft-column {
    max-width: calc(760px + 64px);
    padding-inline: 32px;
}
.draft-column--rail {
    max-width: calc(760px + 64px + 200px);
}
.draft-body--rail {
    display: grid;
    grid-template-columns: 168px minmax(0, 1fr);
    column-gap: 32px;
}
.draft-alias {
    display: flex;
    height: 24px;
    align-items: center;
    gap: 4px;
    border-radius: var(--radius-pill);
    background: var(--bg-subtle);
    padding-inline: 10px 6px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
/*
 * 头像从名字那一行的顶到别名那一行的底（开发者 2026-11-27）。三行的高度是定的（名字一行、简介单行截断、别名一行），
 * 所以头像取定高 88 的方形；简介放头像时单行截断，不让它变成两行把别名推到头像下面。
 */
.draft-avatar {
    width: 88px;
    height: 88px;
    flex-shrink: 0;
    border-radius: var(--radius-panel);
    object-fit: cover;
    object-position: top;
}
/* 两栏：右栏定宽，窄时折到左栏下面成一行。 */
.draft-columns {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 8px 32px;
}
.draft-columns__who {
    display: flex;
    min-width: 0;
    flex: 1 1 320px;
    align-items: flex-start;
    gap: 16px;
}
.draft-columns__where {
    display: flex;
    flex: 0 0 240px;
    flex-direction: column;
    justify-content: space-between;
    border-left: var(--border-w) solid var(--divider);
    padding-left: 20px;
}
.draft-head {
    container-type: inline-size;
}
/* 编辑区窄到放不下两栏时，右栏折到下面：事实与“在看”排成一行，不要竖线。 */
@container (max-width: 600px) {
    .draft-columns__where {
        flex: 1 1 100%;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 16px;
        border-left: 0;
        padding-left: 0;
    }
    .draft-facts {
        grid-auto-flow: column;
        grid-template-columns: none;
        grid-template-rows: auto;
    }
}
.draft-facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 16px;
    margin: 0;
    font-size: var(--text-sm);
}
.draft-facts dt {
    color: var(--text-muted);
}
.draft-facts dd {
    margin: 0;
    color: var(--text-main);
}
.draft-fact-button {
    margin-inline: -4px;
    border-radius: var(--radius-control);
    padding-inline: 4px;
    text-align: left;
    transition: background-color var(--motion-fast) var(--ease-layout);
}
.draft-fact-button:hover,
.draft-fact-button:focus-visible {
    background: var(--bg-hover);
}
.draft-text-empty {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    margin-block: 4px;
    border-radius: var(--radius-control);
    padding: 8px;
    margin-inline: -8px;
    color: var(--text-muted);
    text-align: left;
    transition: background-color var(--motion-fast) var(--ease-layout);
}
.draft-text-empty:hover,
.draft-text-empty:focus-visible {
    background: var(--bg-hover);
}
@media (max-width: 480px) {
    .draft-column {
        padding-inline: 16px;
    }
}
</style>
