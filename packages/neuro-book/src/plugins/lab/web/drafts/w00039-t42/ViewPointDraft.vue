<script setup lang="ts">
/**
 * w00039 t42 第 2 轮静态稿：条目页页头的“看哪一刻”（读哪条线、哪个时间点）。三种做法：
 * - merged：合成一个“在看”控件，按钮写结论，菜单分“故事线”“剧情进度”两段；
 * - labeled：仍是两个控件，同一种样子、各带名字（“时间点”“剧情线”）；
 * - timeline：页头下面一条时间条，章是刻度，左右两个按钮一步一步走，线在左边。
 * 不接世界，样本写死；下面是真实的 `Tabs` 与 `CharacterCard`，看“第 2 章改过”这些标记与控件的关系。
 */
import {computed, onMounted, ref} from "vue";

import {IconButton, InfoTip, Input, Switch, Tabs} from "@notnotype/nb-ui/components";

import CharacterCard from "nbook/plugins/canon/web/components/groups/CharacterCard.vue";

import {FILLED_CARD, FILLED_TABS} from "./sample";

type Variant = "merged" | "labeled" | "timeline";
type State = "default" | "menu" | "line-menu" | "pinned" | "plan" | "main-only";

const props = withDefaults(defineProps<{
    variant?: Variant;
    /** default 缺省；menu 时间点（合成时是整个）菜单打开；line-menu 线的菜单打开（只 labeled）；pinned 固定看分支线；plan 算上计划；main-only 只有主线。 */
    state?: State;
    /** 第 3 轮：作品有 60 章（当前第 37 章末尾），菜单里的章表可搜、滚到当前章。 */
    many?: boolean;
    /** 第 3 轮：章表搜索框里已经填的字。 */
    search?: string;
    /** 第 3 轮：“在看”两边各一个按钮，不开菜单往前、往后走一处。 */
    steppers?: boolean;
}>(), {variant: "merged", state: "default", many: false, search: "", steppers: false});

/** 样例作品的章：第 3 章还没有标题。 */
const CHAPTERS = [
    {n: 1, title: "好哥哥真难当"},
    {n: 2, title: "用钱说话"},
    {n: 3, title: null},
] as const;
const BRANCH = "重来的那个晚上";

const lines = computed(() => props.state !== "main-only");
const pinned = computed(() => props.state === "pinned");
const planned = ref(props.state === "plan");
const lineName = computed(() => (pinned.value ? BRANCH : "主线"));
/** 长篇的样本：60 章，标题轮着用。 */
const TITLES = ["雨夜的来客", "妹妹的布丁", "学院开学", "旧校舍的钟", "第一次变身", "对策委员会", "哥哥的秘密", "失物招领", "夏日祭", "回不去的那天", "星瑕的信", "雨停以后"];
const chapters = computed<ReadonlyArray<{readonly n: number; readonly title: string | null}>>(() => (props.many ? Array.from({length: 60}, (_, index) => ({n: index + 1, title: TITLES[index % TITLES.length]!})) : CHAPTERS));
/** 当前时间点：第 3 章末尾（长篇时第 37 章末尾）。 */
const current = {chapter: props.many ? 37 : 3, edge: "end" as "start" | "end"};
/** 章多了（多于 12 章）才出搜索框：少的时候一眼看得完。 */
const searchable = computed(() => chapters.value.length > 12);
const query = ref(props.search);
const shownChapters = computed(() => {
    const words = query.value.trim();
    if (words === "") return chapters.value;
    return chapters.value.filter((chapter) => String(chapter.n) === words || `第 ${String(chapter.n)} 章`.includes(words) || (chapter.title ?? "").includes(words));
});
/** 章表打开时滚到当前那一章，放在中间。 */
const chapterList = ref<HTMLElement | null>(null);
onMounted(() => {
    const list = chapterList.value;
    const row = list?.querySelector<HTMLElement>("[data-current]");
    if (list !== null && list !== undefined && row !== null && row !== undefined) list.scrollTop = row.offsetTop - list.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
});
const LINE_TIP = "作品里平行发展的几条剧情：主线，以及从主线某一处分出去的另一种发展。同一个人在不同的线上可以不一样。“按章节自动”是哪一章讲哪条线，就看哪条线。";
const PROGRESS_TIP = "设定会随剧情变。这里选看故事进行到哪一刻的样子：“最初”是一切发生之前的起始设定，也可以看某一章的开头或末尾。";
const timeLabel = computed(() => `第 ${String(current.chapter)} 章${current.edge === "start" ? "开头" : "末尾"}`);
const menuOpen = computed(() => props.state === "menu");
const lineMenuOpen = computed(() => props.state === "line-menu");

const tab = ref("person");
const tabItems = FILLED_TABS.map((item) => ({value: item.value, label: item.label, iconClass: item.icon, ...(item.count === undefined ? {} : {count: item.count})}));

/** 时间条：最初一个点，然后每章一段（开头一个小点、末尾一个大点，章名写在这一段下面）。 */
const EDGES = ["start", "end"] as const;
const isCurrent = (chapter: number, edge: "start" | "end"): boolean => chapter === current.chapter && edge === current.edge;
const edgeLabel = (chapter: number, edge: "start" | "end"): string => `第 ${String(chapter)} 章${edge === "start" ? "开头" : "末尾"}`;
</script>

<template>
    <div class="vp-root flex h-full min-h-0 w-full flex-col overflow-auto bg-[var(--panel-surface)]" data-draft-view-point :data-variant="props.variant" :data-state="props.state">
        <div class="vp-column mx-auto w-full px-8 pt-6">
            <!-- 页头：名字、简介、别名；右上角只留条目自己的“更多”。 -->
            <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div class="min-w-[12rem] flex-1">
                    <h1 class="text-[length:var(--text-xl)] font-semibold text-[var(--text-main)]">星瑕</h1>
                    <p class="mt-1 text-[length:var(--text-sm)] text-[var(--text-secondary)]">前蓝星最强的魔法少女，隐退后以哥哥的样子把妹妹接回家住</p>
                </div>
                <!-- B：两个控件同一种样子、各带名字，留在原来的位置。 -->
                <div v-if="props.variant === 'labeled'" class="vp-labeled relative flex flex-wrap items-center justify-end gap-1">
                    <div v-if="lines" class="relative">
                        <button type="button" class="vp-chip" :class="{'vp-chip--pinned': pinned, 'vp-chip--open': lineMenuOpen}" data-vp-line>
                            <span class="i-lucide-git-branch size-3.5 shrink-0" aria-hidden="true" />
                            <span class="vp-chip__name">剧情线</span>
                            <span class="vp-chip__value">{{ lineName }}</span>
                            <span v-if="!pinned" class="vp-chip__hint">按章节</span>
                            <span class="i-lucide-chevron-down size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                        </button>
                        <div v-if="lineMenuOpen" class="vp-menu nb-ui-popover-surface right-0 w-72" role="menu">
                            <button type="button" class="nb-ui-menu-item w-full" data-highlighted><span class="i-lucide-check size-3.5" aria-hidden="true" /><span class="flex-1 text-left">按章节自动</span><span class="vp-menu__aside">当前：主线</span></button>
                            <button type="button" class="nb-ui-menu-item w-full"><span class="size-3.5" aria-hidden="true" /><span class="flex-1 text-left">主线</span></button>
                            <button type="button" class="nb-ui-menu-item w-full"><span class="size-3.5" aria-hidden="true" /><span class="i-lucide-corner-down-right size-3.5 text-[var(--text-muted)]" aria-hidden="true" /><span class="flex-1 text-left">{{ BRANCH }}</span></button>
                        </div>
                    </div>
                    <div class="relative">
                        <button type="button" class="vp-chip" :class="{'vp-chip--open': menuOpen}" data-vp-time>
                            <span class="i-lucide-clock-3 size-3.5 shrink-0" aria-hidden="true" />
                            <span class="vp-chip__name">时间点</span>
                            <span class="vp-chip__value">{{ timeLabel }}</span>
                            <span v-if="planned" class="vp-chip__hint">含计划</span>
                            <span class="i-lucide-chevron-down size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                        </button>
                        <div v-if="menuOpen" class="vp-menu nb-ui-popover-surface right-0 w-80" role="menu">
                            <button type="button" class="nb-ui-menu-item w-full"><span class="size-3.5" aria-hidden="true" /><span class="flex-1 text-left">最初</span><span class="vp-menu__aside">起始设定</span></button>
                            <div v-for="chapter in CHAPTERS" :key="chapter.n" class="vp-chapter" :data-current="chapter.n === current.chapter ? '' : undefined">
                                <span class="vp-chapter__n">第 {{ chapter.n }} 章</span>
                                <span class="vp-chapter__title">{{ chapter.title ?? "" }}</span>
                                <span class="vp-edges"><button type="button" :data-on="chapter.n === current.chapter && current.edge === 'start' ? '' : undefined">开头</button><button type="button" :data-on="chapter.n === current.chapter && current.edge === 'end' ? '' : undefined">末尾</button></span>
                            </div>
                            <div class="vp-menu__sep" />
                            <label class="vp-plan"><span class="flex-1">算上计划中的情节</span><Switch v-model="planned" size="sm" aria-label="算上计划中的情节" /></label>
                        </div>
                    </div>
                </div>
                <IconButton size="sm" icon-class="i-lucide-ellipsis" aria-label="更多" title="更多" />
            </div>

            <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span class="inline-flex items-center gap-1 text-[length:var(--text-xs)] text-[var(--text-secondary)]"><span class="i-lucide-plus size-3.5" aria-hidden="true" />添加别名</span>
                <!-- A：合成一个“在看”，放在紧贴内容的这一行右边。 -->
                <div v-if="props.variant === 'merged'" class="vp-merged relative ml-auto flex items-center gap-0.5">
                    <IconButton v-if="props.steppers" size="sm" icon-class="i-lucide-chevron-left" aria-label="往前一处" :title="`往前一处：第 ${String(current.chapter)} 章开头`" />
                    <button type="button" class="vp-chip" :class="{'vp-chip--pinned': pinned, 'vp-chip--open': menuOpen}" data-vp-merged>
                        <span v-if="pinned" class="i-lucide-git-branch size-3.5 shrink-0" aria-hidden="true" />
                        <span class="vp-chip__name">在看</span>
                        <span class="vp-chip__value">{{ timeLabel }}<template v-if="lines"> · {{ lineName }}</template><template v-if="planned"> · 含计划</template></span>
                        <span class="i-lucide-chevron-down size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                    </button>
                    <IconButton v-if="props.steppers" size="sm" icon-class="i-lucide-chevron-right" aria-label="往后一处" :title="props.many ? `往后一处：第 ${String(current.chapter + 1)} 章开头` : '已经是最后'" :disabled="!props.many" />
                    <div v-if="menuOpen" class="vp-menu nb-ui-popover-surface right-0 w-[22rem]" role="menu">
                        <template v-if="lines">
                            <p class="vp-menu__head">故事线<InfoTip :text="LINE_TIP" side="left" /></p>
                            <button type="button" class="nb-ui-menu-item w-full"><span class="i-lucide-check size-3.5" aria-hidden="true" /><span class="flex-1 text-left">按章节自动</span><span class="vp-menu__aside">当前：主线</span></button>
                            <button type="button" class="nb-ui-menu-item w-full"><span class="size-3.5" aria-hidden="true" /><span class="flex-1 text-left">主线</span></button>
                            <button type="button" class="nb-ui-menu-item w-full"><span class="size-3.5" aria-hidden="true" /><span class="i-lucide-corner-down-right size-3.5 text-[var(--text-muted)]" aria-hidden="true" /><span class="flex-1 text-left">{{ BRANCH }}</span></button>
                            <div class="vp-menu__sep" />
                        </template>
                        <p class="vp-menu__head">剧情进度<InfoTip :text="PROGRESS_TIP" side="left" /></p>
                        <Input v-if="searchable" v-model="query" class="mx-1 mb-1" size="sm" type="search" placeholder="章号或标题" aria-label="找一章" />
                        <button type="button" class="nb-ui-menu-item w-full"><span class="size-3.5" aria-hidden="true" /><span class="flex-1 text-left">最初</span><span class="vp-menu__aside">起始设定</span></button>
                        <div ref="chapterList" class="vp-chapters" :class="{'vp-chapters--scroll': searchable}">
                            <div v-for="chapter in shownChapters" :key="chapter.n" class="vp-chapter" :data-current="chapter.n === current.chapter ? '' : undefined">
                                <span class="vp-chapter__n">第 {{ chapter.n }} 章</span>
                                <span class="vp-chapter__title">{{ chapter.title ?? "" }}</span>
                                <span class="vp-edges"><button type="button" :data-on="chapter.n === current.chapter && current.edge === 'start' ? '' : undefined">开头</button><button type="button" :data-on="chapter.n === current.chapter && current.edge === 'end' ? '' : undefined">末尾</button></span>
                            </div>
                            <p v-if="shownChapters.length === 0" class="vp-menu__empty">没有对得上的章</p>
                        </div>
                        <div class="vp-menu__sep" />
                        <label class="vp-plan"><span class="flex-1">算上计划中的情节</span><Switch v-model="planned" size="sm" aria-label="算上计划中的情节" /></label>
                    </div>
                </div>
            </div>

            <!-- C：页头下面一条时间条。线在左边，往前一步、往后一步跟着它，含计划在最右。 -->
            <div v-if="props.variant === 'timeline'" class="vp-timeline mt-4" data-vp-timeline>
                <button v-if="lines" type="button" class="vp-chip shrink-0" :class="{'vp-chip--pinned': pinned}">
                    <span class="i-lucide-git-branch size-3.5 shrink-0" aria-hidden="true" />
                    <span class="vp-chip__value">{{ lineName }}</span>
                    <span v-if="!pinned" class="vp-chip__hint">按章节</span>
                    <span class="i-lucide-chevron-down size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                </button>
                <div class="flex shrink-0 items-center">
                    <IconButton size="sm" icon-class="i-lucide-chevron-left" aria-label="往前一步" title="往前一步：第 3 章开头" />
                    <IconButton size="sm" icon-class="i-lucide-chevron-right" aria-label="往后一步" title="已经是最后" disabled />
                </div>
                <div class="vp-track" role="radiogroup" aria-label="时间点">
                    <div class="vp-seg vp-seg--initial">
                        <button type="button" role="radio" class="vp-stop vp-stop--major" :aria-checked="false" title="最初"><span class="vp-stop__dot" aria-hidden="true" /></button>
                        <span class="vp-seg__label">最初</span>
                    </div>
                    <div v-for="chapter in CHAPTERS" :key="chapter.n" class="vp-seg">
                        <span class="vp-seg__rail" aria-hidden="true" />
                        <button
                            v-for="edge in EDGES"
                            :key="edge"
                            type="button"
                            role="radio"
                            class="vp-stop"
                            :class="{'vp-stop--major': edge === 'end', 'vp-stop--current': isCurrent(chapter.n, edge)}"
                            :aria-checked="isCurrent(chapter.n, edge)"
                            :title="edgeLabel(chapter.n, edge)"
                        >
                            <span class="vp-stop__dot" aria-hidden="true" />
                            <span v-if="isCurrent(chapter.n, edge)" class="vp-stop__now">{{ timeLabel }}</span>
                        </button>
                        <span class="vp-seg__label" :title="chapter.title ?? undefined">{{ chapter.title === null ? `第 ${String(chapter.n)} 章` : `第 ${String(chapter.n)} 章 ${chapter.title}` }}</span>
                    </div>
                </div>
                <button type="button" class="vp-plan-chip shrink-0" :data-on="planned ? '' : undefined" :aria-pressed="planned">含计划</button>
            </div>

            <Tabs v-model="tab" class="mt-4" size="sm" :baseline="false" :items="tabItems" aria-label="条目的分页" />
        </div>
        <div class="vp-column mx-auto w-full px-8 py-5">
            <CharacterCard v-bind="FILLED_CARD" namespace="character" />
        </div>
    </div>
</template>

<style scoped>
/* 窄屏按画布宽算（Lab 的手机尺寸只改画布，不改视口）。 */
.vp-root {
    container-type: inline-size;
}
.vp-column {
    max-width: calc(760px + 64px);
}
/* 控件：浅底的小块，名字弱一档、值是正文色；固定看分支线时带强调色的底，提醒此刻不是缺省。 */
.vp-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: var(--control-h-sm);
    padding: 0 8px;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    transition: background-color var(--motion-fast) var(--ease-layout);
}
.vp-chip:hover,
.vp-chip--open {
    background: color-mix(in srgb, var(--text-main) 9%, transparent);
}
.vp-chip__name {
    flex-shrink: 0;
    color: var(--text-muted);
}
.vp-chip__value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-main);
}
.vp-chip__hint {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
}
.vp-chip--pinned {
    background: color-mix(in srgb, var(--accent-main) 12%, transparent);
    color: var(--accent-text);
}
.vp-chip--pinned .vp-chip__name {
    color: var(--accent-text);
    opacity: 0.75;
}
/* 菜单（静态画出来的样子）。 */
.vp-menu {
    position: absolute;
    top: calc(100% + 6px);
    z-index: 5;
    display: flex;
    flex-direction: column;
    padding: 6px;
}
.vp-menu__head {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px 2px;
    font-size: var(--text-xs);
    color: var(--text-muted);
}
/* 长篇的章表：约 8 行高，在里面滚；滚动条用宿主根上的细滚动条。 */
.vp-chapters--scroll {
    max-height: 16.5rem;
    overflow-y: auto;
    overscroll-behavior: contain;
}
.vp-menu__empty {
    padding: 8px 34px;
    font-size: var(--text-sm);
    color: var(--text-muted);
}
.vp-menu__aside {
    font-size: var(--text-xs);
    color: var(--text-muted);
}
.vp-menu__sep {
    height: 1px;
    margin: 6px 4px;
    background: var(--divider);
}
.vp-chapter {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 2rem;
    padding: 0 6px 0 34px;
    border-radius: var(--radius-control);
    font-size: var(--text-sm);
}
.vp-chapter[data-current] {
    background: var(--overlay-item-active);
}
.vp-chapter__n {
    flex-shrink: 0;
    color: var(--text-main);
}
.vp-chapter__title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
}
.vp-edges {
    display: inline-flex;
    flex-shrink: 0;
    gap: 2px;
}
.vp-edges button {
    padding: 1px 8px;
    border-radius: var(--radius-control);
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
.vp-edges button:hover {
    background: var(--overlay-item-active);
}
.vp-edges button[data-on] {
    background: var(--accent-main);
    color: var(--text-inverse);
}
.vp-plan {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 4px 34px;
    font-size: var(--text-sm);
    color: var(--text-main);
}
/* 时间条：一条细轨，章末尾是大点并写章号，章开头是小点；当前那一点是强调色，上面写全名。 */
.vp-timeline {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
}
.vp-track {
    display: flex;
    flex: 1 1 auto;
    align-items: flex-start;
    gap: 6px;
    min-width: 0;
    height: 52px;
    padding-top: 20px;
}
/* 一章一段：两个点之间一条轨，章名在这一段下面居中，窄了截断。最初只有一个点。 */
.vp-seg {
    position: relative;
    display: flex;
    flex: 1 1 0;
    justify-content: space-between;
    min-width: 0;
}
.vp-seg--initial {
    flex: 0 0 auto;
    justify-content: center;
    width: 2.5rem;
}
.vp-seg__rail {
    position: absolute;
    top: 5px;
    right: 6px;
    left: 6px;
    height: 2px;
    border-radius: 1px;
    background: color-mix(in srgb, var(--text-main) 14%, transparent);
}
.vp-seg__label {
    position: absolute;
    top: 16px;
    right: 0;
    left: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    font-size: var(--text-xs);
    color: var(--text-muted);
}
.vp-stop {
    position: relative;
    z-index: 1;
    display: flex;
    justify-content: center;
    width: 12px;
    height: 12px;
}
.vp-stop__dot {
    width: 6px;
    height: 6px;
    margin-top: 3px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--text-main) 30%, var(--panel-surface));
}
.vp-stop--major .vp-stop__dot {
    width: 10px;
    height: 10px;
    margin-top: 1px;
}
.vp-stop--current .vp-stop__dot {
    background: var(--accent-main);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-main) 25%, transparent);
}
/* 当前那一点上面写全名；最后一章的末尾靠右，不越出轨道。 */
.vp-stop__now {
    position: absolute;
    bottom: calc(100% + 4px);
    right: -4px;
    padding: 0 6px;
    border-radius: var(--radius-control);
    background: var(--accent-main);
    color: var(--text-inverse);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: nowrap;
}
.vp-plan-chip {
    height: var(--control-h-sm);
    padding: 0 8px;
    margin-left: 4px;
    border-radius: var(--radius-control);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
}
.vp-plan-chip[data-on] {
    background: color-mix(in srgb, var(--status-warning) 18%, transparent);
    color: var(--text-main);
}
/* 窄屏的覆盖放在最后：同样特异性的基本规则写在后面会盖掉它们。 */
@container (max-width: 480px) {
    .vp-column {
        padding-inline: 16px;
    }
    .vp-merged {
        width: 100%;
        margin-left: 0;
    }
    .vp-merged .vp-chip {
        width: 100%;
    }
    /* 窄了两个控件换到名字与简介下面一行。 */
    .vp-labeled {
        order: 3;
        flex-basis: 100%;
        justify-content: flex-start;
    }
    /* 窄了时间条自己占一行，线、前后两步与含计划在上面一行。 */
    .vp-timeline {
        flex-wrap: wrap;
    }
    .vp-track {
        order: 3;
        flex-basis: 100%;
    }
    .vp-plan-chip {
        margin-left: auto;
    }
}
</style>
