<script setup lang="ts">
/**
 * 页头的“在看”（docs/specs/canon/author-ui.md 输出 7、34；同名 .md）：这一页的值是哪条故事线、哪个时间点上的。一个按钮写结论，
 * 两边往前、往后一处，点开是“故事线”“剧情进度”两段与“算上计划中的情节”。受控：选了什么发出什么；线是窗口的，位置与按计划是这一页的。
 *
 * 菜单要放搜索框、一章一行的两个位置按钮与开关，`DropdownMenu` 放不下，用 `Popover` 自己排；按钮是我们自己的，Popover 锚在它上面
 * （按 Escape 关上时焦点回到它）。
 */
import {computed, nextTick, ref, watch} from "vue";

import {IconButton, InfoTip, Input, Popover, Switch} from "@notnotype/nb-ui/components";

import type {LineOption} from "../../shared/reads";
import type {PositionChapter} from "../positions";
import {INITIAL_POSITION} from "../positions";
import {useCanonText} from "../text";

const props = withDefaults(defineProps<{
    /** 作品的章（按章序）；没有章时剧情进度只有“最初”。 */
    chapters: readonly PositionChapter[];
    /** 这一页的位置（`positionValue` 的写法）。 */
    position: string;
    planned?: boolean;
    /** 作品里有计划中的情节：才出“算上计划中的情节”。默认 false。 */
    canPlan?: boolean;
    /** 位置、线与按计划现在都不能换的原因（有没提交的主文字，输出 46）；默认空（能换）。 */
    locked?: string;
    /** 在所选位置上还没出场（输出 8）；默认 false。 */
    notAppeared?: boolean;
    /** 选过的那一章被删掉了，位置已经回到缺省（输出 7）。 */
    positionGone?: boolean;
    /** 可选的线，主线在最前；少于两条时不提线。默认空。 */
    lineOptions?: readonly LineOption[];
    /** 窗口在看的线；空串是按章节自动。 */
    line?: string;
    /** 这一页按自己的位置实际读的线。 */
    resolvedLine?: string;
}>(), {planned: false, canPlan: false, locked: "", notAppeared: false, positionGone: false, lineOptions: () => [], line: "", resolvedLine: ""});

const emit = defineEmits<{
    (event: "update:position", value: string): void;
    (event: "update:planned", value: boolean): void;
    (event: "update:line", value: string): void;
}>();

const text = useCanonText();
const open = ref(false);
const trigger = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const locked = computed(() => props.locked !== "");

/* ---------- 结论 ---------- */

const hasLines = computed(() => props.lineOptions.length > 1);
const lineName = (id: string): string => {
    const option = props.lineOptions.find((candidate) => candidate.id === id);
    return option === undefined || option.name === null ? text("line.main") : option.name;
};
/** 固定看着一条线（不是按章节自动）：按钮换强调色，提醒此刻不是缺省。 */
const pinned = computed(() => hasLines.value && props.line !== "");
const labelOf = (value: string): string => {
    if (value === INITIAL_POSITION) return text("position.initial");
    for (const chapter of props.chapters) {
        if (chapter.start === value) return text("position.start", {index: chapter.index});
        if (chapter.end === value) return text("position.end", {index: chapter.index});
    }
    return value;
};
const summary = computed(() => [
    labelOf(props.position),
    ...(hasLines.value ? [lineName(pinned.value ? props.line : props.resolvedLine)] : []),
    ...(props.planned ? [text("viewPoint.withPlans")] : []),
].join(" · "));

/* ---------- 往前、往后一处 ---------- */

/** 所有位置排成一列：最初，然后每章的开头、末尾。一处就是这一列里的一项。 */
const order = computed(() => [INITIAL_POSITION, ...props.chapters.flatMap((chapter) => [chapter.start, chapter.end])]);
const at = computed(() => order.value.indexOf(props.position));
const previous = computed(() => (at.value > 0 ? order.value[at.value - 1]! : null));
const following = computed(() => (at.value >= 0 && at.value < order.value.length - 1 ? order.value[at.value + 1]! : null));
const step = (value: string | null): void => {
    if (value !== null && !locked.value) emit("update:position", value);
};

/* ---------- 标记 ---------- */

/** 标记一格：那一章不在了优先，其次是还没出场。算上计划写在按钮的结论里，不另放标记。 */
const mark = computed<"gone" | "absent" | null>(() => (props.positionGone ? "gone" : props.notAppeared ? "absent" : null));

/* ---------- 菜单 ---------- */

/** 章多了（多于 12 章）才出搜索框、章表在里面滚：少的时候一眼看得完。 */
const SEARCH_FROM = 12;
const searchable = computed(() => props.chapters.length > SEARCH_FROM);
const query = ref("");
const shown = computed(() => {
    const words = query.value.trim();
    if (words === "") return props.chapters;
    return props.chapters.filter((chapter) => String(chapter.index) === words || text("place.chapter", {index: chapter.index}).includes(words) || (chapter.title ?? "").includes(words));
});
/** 键盘在位置按钮之间走：一行是最初或一章，行里是开头、末尾（最初只有一个）。 */
const rows = computed(() => [[INITIAL_POSITION], ...shown.value.map((chapter) => [chapter.start, chapter.end])]);
const radio = (value: string): HTMLElement | null => menu.value?.querySelector<HTMLElement>(`[data-position-value="${CSS.escape(value)}"]`) ?? null;
const onRadioKey = (event: KeyboardEvent, value: string): void => {
    const row = rows.value.findIndex((candidate) => candidate.includes(value));
    if (row < 0) return;
    const column = rows.value[row]!.indexOf(value);
    let target: string | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const next = rows.value[row + (event.key === "ArrowDown" ? 1 : -1)];
        target = next === undefined ? undefined : next[Math.min(column, next.length - 1)];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        target = rows.value[row]![column + (event.key === "ArrowRight" ? 1 : -1)];
    } else if (event.key === "Home") target = rows.value[0]![0];
    else if (event.key === "End") target = rows.value.at(-1)!.at(-1);
    else return;
    event.preventDefault();
    if (target !== undefined) radio(target)?.focus();
};
const onSearchKey = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    const first = rows.value[1]?.[0] ?? rows.value[0]![0]!;
    radio(first)?.focus();
};
/** 当前位置这一列可聚焦（tabindex 0），别的 -1；当前位置被搜索筛掉时，第一项可聚焦。 */
const focusable = computed(() => (rows.value.some((row) => row.includes(props.position)) ? props.position : rows.value[0]![0]!));
const edgesOf = (chapter: PositionChapter): ReadonlyArray<readonly ["start" | "end", string]> => [["start", chapter.start], ["end", chapter.end]];
const choose = (value: string): void => {
    emit("update:position", value);
    open.value = false;
};
const chooseLine = (value: string): void => {
    emit("update:line", value);
    open.value = false;
};

/**
 * 打开时：清掉上一次的搜索，章表把当前章滚到中间，焦点进搜索框（章多时）或当前位置。等挂上以后再做：Popover 的内容在打开的这一拍
 * 才渲染，原语自己的自动聚焦落在第一个可聚焦的元素上，这里随后改到想要的地方。
 */
watch(open, async (now) => {
    if (!now) return;
    query.value = "";
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const list = menu.value?.querySelector<HTMLElement>("[data-view-point-chapters]");
    const row = list?.querySelector<HTMLElement>("[data-current]");
    if (list != null && row != null && searchable.value) list.scrollTop = row.offsetTop - list.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
    (searchable.value ? menu.value?.querySelector<HTMLElement>("[data-view-point-search] input") : radio(props.position))?.focus({preventScroll: true});
});
</script>

<template>
    <div class="view-point flex min-w-0 max-w-full items-center gap-1" :data-view-point-locked="locked ? '' : undefined">
        <Transition name="view-point-mark" mode="out-in">
            <span v-if="mark === 'gone'" key="gone" class="view-point__mark" role="status" :title="text('entry.positionGone')"><span class="truncate">{{ text("entry.positionGone") }}</span></span>
            <span v-else-if="mark === 'absent'" key="absent" class="view-point__mark" :title="text('entry.notAppeared')" data-not-appeared><span class="truncate">{{ text("entry.notAppeared") }}</span></span>
        </Transition>
        <div class="view-point__group flex min-w-0 items-center gap-0.5">
            <IconButton
                v-if="order.length > 1"
                size="sm"
                icon-class="i-lucide-chevron-left"
                :disabled="locked || previous === null"
                :aria-label="text('viewPoint.prevLabel')"
                :title="locked ? props.locked : previous === null ? text('viewPoint.atStart') : text('viewPoint.prev', {position: labelOf(previous)})"
                data-view-point-prev
                @click="step(previous)"
            />
            <button
                ref="trigger"
                type="button"
                class="view-point__trigger nb-ui-focus-ring"
                :class="{'view-point__trigger--pinned': pinned}"
                :disabled="locked"
                :title="locked ? props.locked : undefined"
                :aria-label="text('viewPoint.aria', {summary})"
                aria-haspopup="dialog"
                :aria-expanded="open"
                :data-pinned="pinned ? '' : undefined"
                data-view-point
                @click="open = !open"
            >
                <span v-if="pinned" class="i-lucide-git-branch size-3.5 shrink-0" aria-hidden="true" />
                <span class="view-point__name">{{ text("viewPoint.label") }}</span>
                <Transition name="nb-ui-switch" mode="out-in"><span :key="summary" class="view-point__value">{{ summary }}</span></Transition>
                <span class="i-lucide-chevron-down size-3.5 shrink-0 opacity-60" aria-hidden="true" />
            </button>
            <IconButton
                v-if="order.length > 1"
                size="sm"
                icon-class="i-lucide-chevron-right"
                :disabled="locked || following === null"
                :aria-label="text('viewPoint.nextLabel')"
                :title="locked ? props.locked : following === null ? text('viewPoint.atEnd') : text('viewPoint.next', {position: labelOf(following)})"
                data-view-point-next
                @click="step(following)"
            />
        </div>
        <Popover :open="open" :anchor="trigger" side="bottom" align="end" content-class="w-[22rem] !p-1.5" @update:open="(value: boolean) => (open = value)">
            <div ref="menu" class="flex flex-col" data-view-point-menu>
                <template v-if="hasLines">
                    <p class="view-point__head">{{ text("viewPoint.lines") }}<InfoTip :text="text('viewPoint.linesTip')" side="left" /></p>
                    <div role="radiogroup" :aria-label="text('viewPoint.lines')">
                        <button type="button" role="radio" class="nb-ui-menu-item w-full" :aria-checked="props.line === ''" data-line-option="" @click="chooseLine('')">
                            <span class="size-3.5 shrink-0" :class="props.line === '' ? 'i-lucide-check' : ''" aria-hidden="true" />
                            <span class="min-w-0 flex-1 truncate text-left">{{ text("viewPoint.follow") }}</span>
                            <span class="view-point__aside">{{ text("viewPoint.followNow", {line: lineName(props.resolvedLine)}) }}</span>
                        </button>
                        <button v-for="option in props.lineOptions" :key="option.id" type="button" role="radio" class="nb-ui-menu-item w-full" :aria-checked="props.line === option.id" :data-line-option="option.id" @click="chooseLine(option.id)">
                            <span class="size-3.5 shrink-0" :class="props.line === option.id ? 'i-lucide-check' : ''" aria-hidden="true" />
                            <span v-if="option.depth > 0" class="i-lucide-corner-down-right size-3.5 shrink-0 text-[var(--text-muted)]" :style="{marginLeft: `${String((option.depth - 1) * 14)}px`}" aria-hidden="true" />
                            <span class="min-w-0 flex-1 truncate text-left">{{ lineName(option.id) }}</span>
                        </button>
                    </div>
                    <div class="view-point__sep" />
                </template>
                <p class="view-point__head">{{ text("viewPoint.progress") }}<InfoTip :text="text('viewPoint.progressTip')" side="left" /></p>
                <!-- 包一层：Input 的根有时是输入框、有时是带清除按钮的外框，定位与按键都挂在这一层上。 -->
                <div v-if="searchable" class="mx-1 mb-1" data-view-point-search @keydown="onSearchKey">
                    <Input v-model="query" size="sm" type="search" :placeholder="text('viewPoint.search')" :aria-label="text('viewPoint.searchLabel')" />
                </div>
                <div role="radiogroup" :aria-label="text('viewPoint.progress')">
                    <div class="view-point__row" :data-current="props.position === INITIAL_POSITION ? '' : undefined">
                        <button
                            type="button"
                            role="radio"
                            class="view-point__initial"
                            :aria-checked="props.position === INITIAL_POSITION"
                            :tabindex="focusable === INITIAL_POSITION ? 0 : -1"
                            :data-position-value="INITIAL_POSITION"
                            @click="choose(INITIAL_POSITION)"
                            @keydown="(event: KeyboardEvent) => onRadioKey(event, INITIAL_POSITION)"
                        >
                            <span class="size-3.5 shrink-0" :class="props.position === INITIAL_POSITION ? 'i-lucide-check' : ''" aria-hidden="true" />
                            <span class="flex-1 text-left">{{ text("position.initial") }}</span>
                            <span class="view-point__aside">{{ text("viewPoint.initialHint") }}</span>
                        </button>
                    </div>
                    <div class="view-point__chapters" :class="{'view-point__chapters--scroll': searchable}" data-view-point-chapters>
                        <div v-for="chapter in shown" :key="chapter.chapter" class="view-point__row view-point__chapter" :data-current="props.position === chapter.start || props.position === chapter.end ? '' : undefined" :data-chapter-row="chapter.chapter">
                            <span class="view-point__index">{{ text("place.chapter", {index: chapter.index}) }}</span>
                            <span class="view-point__title" :title="chapter.title ?? undefined">{{ chapter.title ?? "" }}</span>
                            <span class="view-point__edges">
                                <button
                                    v-for="edge in edgesOf(chapter)"
                                    :key="edge[0]"
                                    type="button"
                                    role="radio"
                                    class="view-point__edge nb-ui-focus-ring-inset"
                                    :aria-checked="props.position === edge[1]"
                                    :aria-label="labelOf(edge[1])"
                                    :tabindex="focusable === edge[1] ? 0 : -1"
                                    :data-position-value="edge[1]"
                                    @click="choose(edge[1])"
                                    @keydown="(event: KeyboardEvent) => onRadioKey(event, edge[1])"
                                >{{ text(edge[0] === "start" ? "viewPoint.start" : "viewPoint.end") }}</button>
                            </span>
                        </div>
                        <p v-if="shown.length === 0" class="view-point__empty">{{ text("viewPoint.noMatch") }}</p>
                    </div>
                </div>
                <template v-if="props.canPlan">
                    <div class="view-point__sep" />
                    <label class="view-point__plan" data-view-point-plan>
                        <span class="flex-1">{{ text("entry.planned") }}</span>
                        <Switch size="sm" :aria-label="text('entry.planned')" :model-value="props.planned" @update:model-value="(value: boolean) => emit('update:planned', value)" />
                    </label>
                </template>
            </div>
        </Popover>
    </div>
</template>

<style scoped>
/* 按钮：浅底的一小块，“在看”弱一档、结论是正文色；固定看一条线时强调色的底。 */
.view-point__trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    height: var(--control-h-sm);
    padding: 0 8px;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
    color: var(--text-secondary);
    font-size: var(--text-sm);
    transition: background-color var(--motion-fast) var(--ease-layout);
}
.view-point__trigger:hover:not(:disabled),
.view-point__trigger[aria-expanded="true"] {
    background: color-mix(in srgb, var(--text-main) 9%, transparent);
}
.view-point__trigger:disabled {
    opacity: 0.55;
}
.view-point__name {
    flex-shrink: 0;
    color: var(--text-muted);
}
.view-point__value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-main);
}
.view-point__trigger--pinned,
.view-point__trigger--pinned:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-main) 12%, transparent);
    color: var(--accent-text);
}
.view-point__trigger--pinned .view-point__name {
    color: var(--accent-text);
    opacity: 0.75;
}
/* 按内容定宽；页头窄到占满一行时（宿主给根 w-full），按钮跟着撑满、下拉箭头靠右。 */
.view-point__group {
    flex: 1 1 auto;
    justify-content: flex-end;
}
.view-point__trigger {
    flex: 1 1 auto;
}
.view-point__trigger > .i-lucide-chevron-down {
    margin-left: auto;
}
/* 标记可以收窄、文字截断（整句在悬停提示里）。 */
.view-point__mark {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    height: 1.75rem;
    padding: 0 10px;
    border-radius: var(--radius-pill);
    background: var(--bg-subtle);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    white-space: nowrap;
}
.view-point-mark-enter-active,
.view-point-mark-leave-active {
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.view-point-mark-enter-from,
.view-point-mark-leave-to {
    opacity: 0;
}
/* 菜单。 */
.view-point__head {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 0;
    padding: 6px 8px 2px;
    font-size: var(--text-xs);
    color: var(--text-muted);
}
.view-point__aside {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
}
.view-point__sep {
    height: 1px;
    margin: 6px 4px;
    background: var(--divider);
}
.view-point__row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 2rem;
    border-radius: var(--radius-control);
    font-size: var(--text-sm);
}
.view-point__row[data-current] {
    background: var(--overlay-item-active);
}
.view-point__initial {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 8px;
    min-height: 2rem;
    padding: 0 8px;
    border-radius: var(--radius-control);
    color: var(--text-main);
}
.view-point__initial:hover,
.view-point__initial:focus-visible {
    background: var(--overlay-item-active);
    outline: none;
}
.view-point__chapter {
    padding: 0 6px 0 30px;
}
.view-point__index {
    flex-shrink: 0;
    color: var(--text-main);
}
.view-point__title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-secondary);
}
.view-point__edges {
    display: inline-flex;
    flex-shrink: 0;
    gap: 2px;
}
.view-point__edge {
    padding: 1px 8px;
    border-radius: var(--radius-control);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    transition: background-color var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}
.view-point__edge:hover {
    background: var(--overlay-item-active);
}
.view-point__edge[aria-checked="true"] {
    background: var(--accent-main);
    color: var(--text-inverse);
}
/* 长篇的章表：约 8 行高，在里面滚。 */
.view-point__chapters--scroll {
    max-height: 16.5rem;
    overflow-y: auto;
    overscroll-behavior: contain;
}
.view-point__empty {
    margin: 0;
    padding: 8px 30px;
    font-size: var(--text-sm);
    color: var(--text-muted);
}
.view-point__plan {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 4px 30px;
    font-size: var(--text-sm);
    color: var(--text-main);
}
@media (prefers-reduced-motion: reduce) {
    .view-point__trigger,
    .view-point__edge,
    .view-point-mark-enter-active,
    .view-point-mark-leave-active {
        transition: none;
    }
}
</style>
