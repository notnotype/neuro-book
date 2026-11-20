<script setup lang="ts">
/**
 * 案头（同名 .md）：统计、最近写到与看板娘；空书架时是问候。只发事件。看板娘那一格可以叠一个贡献的组件（`projects.desk`），猫照旧由
 * 这里画：贡献晚到或换掉时不重挂猫（自定义元素重挂会从头播动画）。
 */
import {Button} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, ref} from "vue";
import type {Component} from "vue";

import NeuroBookMood from "nbook/ui/brand/NeuroBookMood.vue";
import type {NeuroBookMoodState} from "nbook/ui/brand/neurobook-mood";

import {projectDisplayName} from "../../shared/shelf";
import type {ShelfItem} from "../../shared/shelf";
import {useProjectsText} from "../text";
import {continueTarget, formatBooks, formatFiles, formatSigned, formatWhen, formatWords, recentPieces, shelfTotals} from "../shelf-format";

defineOptions({name: "ShelfDesk"});

const props = withDefaults(defineProps<{
    items: ReadonlyArray<ShelfItem>;
    now: string;
    /** 叠在看板娘上的贡献组件；没有为 null。 */
    companion?: Component | null;
}>(), {companion: null});

const emit = defineEmits<{
    (event: "continue", id: string): void;
}>();

const port = useText();
const text = useProjectsText();
const totals = computed(() => shelfTotals(props.items));
const target = computed(() => continueTarget(props.items));
const recent = computed(() => recentPieces(props.items, 3));
/** 猫的心情：贡献的组件发 `update:mood` 改它，没有贡献时空闲。 */
const mood = ref<NeuroBookMoodState>("idle");
const companionMood = computed(() => (props.companion === null ? "idle" : mood.value));
const headline = computed(() => (totals.value.today === null
    ? {number: formatWords(totals.value.words, port).replace(/\s*(字|words)$/u, ""), label: text("shelfDesk.totalLabel")}
    : {number: formatSigned(totals.value.today, port.locale.value), label: text("shelfDesk.todayLabel")}));
</script>

<template>
    <section class="shelf-desk" :class="{'shelf-desk--empty': items.length === 0}" :aria-label="text('shelfDesk.label')" data-shelf-desk>
        <!-- 容器查询只对后代生效：section 当容器，网格放在里面这一层，窄时才换得了列模板。 -->
        <div class="shelf-desk__grid">
        <template v-if="items.length === 0">
            <div class="shelf-desk__greeting">
                <h1 class="shelf-desk__title">{{ text('shelfDesk.emptyTitle') }}</h1>
                <p class="shelf-desk__lead">{{ text('shelfDesk.emptyLead') }}</p>
            </div>
        </template>
        <template v-else>
            <div class="shelf-desk__stats" data-shelf-stats>
                <p class="shelf-desk__headline"><span class="shelf-desk__number">{{ headline.number }}</span><span class="shelf-desk__unit">{{ headline.label }}</span></p>
                <p class="shelf-desk__totals">
                    <span v-if="totals.today !== null">{{ text('shelfDesk.total', {words: formatWords(totals.words, port)}) }}</span>
                    <span>{{ formatFiles(totals.files, port) }}</span>
                    <span>{{ formatBooks(totals.books, port) }}</span>
                </p>
                <Button v-if="target !== null" variant="primary" class="shelf-desk__continue" data-continue @click="emit('continue', target.id)">{{ text('shelfDesk.continueBook', {title: projectDisplayName(target)}) }} →</Button>
            </div>
            <div class="shelf-desk__recent" data-shelf-recent>
                <h2 class="shelf-desk__eyebrow">{{ text('shelfDesk.recent') }}</h2>
                <p v-if="recent.length === 0" class="shelf-desk__none">{{ text('shelfDesk.noRecord') }}</p>
                <ul v-else class="shelf-desk__pieces">
                    <li v-for="piece in recent" :key="piece.item.id" class="shelf-desk__piece">
                        <button type="button" class="shelf-desk__piece-button" :data-recent-piece="piece.item.id" @click="emit('continue', piece.item.id)">
                            <span class="shelf-desk__piece-head">
                                <span class="shelf-desk__piece-book">{{ projectDisplayName(piece.item) }}</span>
                                <span class="shelf-desk__piece-label">{{ piece.last.label }}</span>
                                <span class="shelf-desk__piece-when">{{ formatWhen(piece.last.at, now, port) }}</span>
                            </span>
                            <span v-if="piece.last.excerpt !== ''" class="shelf-desk__piece-excerpt">{{ piece.last.excerpt }}</span>
                        </button>
                    </li>
                </ul>
            </div>
        </template>
        <div class="shelf-desk__mascot" data-shelf-mascot>
            <NeuroBookMood :state="companionMood" class="shelf-desk__mood" />
            <component :is="props.companion" v-if="props.companion !== null" class="shelf-desk__companion" @update:mood="(next: NeuroBookMoodState) => (mood = next)" />
        </div>
        </div>
    </section>
</template>

<style scoped>
/* 案头不给面，直接压在窗体底纹上（设计语言“不给面”）。 */
.shelf-desk {
    container-type: inline-size;
}

.shelf-desk__grid {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr) 150px;
    gap: var(--space-7);
    align-items: center;
    padding: var(--space-2) var(--space-2) 0;
}

.shelf-desk--empty .shelf-desk__grid {
    grid-template-columns: minmax(0, 1fr) 150px;
}

.shelf-desk__greeting {
    min-width: 0;
}

.shelf-desk__title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: var(--weight-strong);
    line-height: 1.2;
}

.shelf-desk__lead {
    margin: var(--space-3) 0 0;
    max-width: 36em;
    color: var(--text-secondary);
    font-family: var(--font-display);
    font-size: 16px;
    line-height: 1.8;
}

.shelf-desk__headline {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-3);
    margin: 0;
}

.shelf-desk__number {
    font-family: var(--font-display);
    font-size: 52px;
    font-weight: var(--weight-medium, 500);
    line-height: 1;
    letter-spacing: -0.01em;
    font-variation-settings: "opsz" 72;
}

.shelf-desk__unit {
    color: var(--text-muted);
    font-size: var(--text-sm);
}

.shelf-desk__totals {
    margin: var(--space-3) 0 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

.shelf-desk__totals span + span::before {
    content: " · ";
    color: var(--text-muted);
}

.shelf-desk__continue {
    margin-top: var(--space-5);
}

.shelf-desk__eyebrow {
    margin: 0 0 var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    letter-spacing: 0.18em;
}

.shelf-desk__none {
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-family: var(--font-display);
    font-size: var(--text-sm);
}

.shelf-desk__pieces {
    margin: 0;
    padding: 0;
    list-style: none;
}

.shelf-desk__piece + .shelf-desk__piece {
    border-top: var(--border-w) solid var(--divider);
}

.shelf-desk__piece-button {
    display: flex;
    flex-direction: column;
    gap: 2px;
    /* 悬停底色向两侧各出血一个案头内边距：文字和案头其它内容对齐，底色贴到案头边上，不越出去。 */
    width: calc(100% + 2 * var(--space-2));
    margin: 0 calc(-1 * var(--space-2));
    padding: var(--space-2) var(--space-2);
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.shelf-desk__piece-button:hover {
    background: color-mix(in srgb, var(--page-surface, var(--bg-panel)) 70%, transparent);
}

.shelf-desk__piece-button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.shelf-desk__piece-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    font-family: var(--font-display);
}

.shelf-desk__piece-book {
    font-size: 15px;
    font-weight: var(--weight-strong);
}

.shelf-desk__piece-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.shelf-desk__piece-when {
    flex: 0 0 auto;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
}

.shelf-desk__piece-excerpt {
    overflow: hidden;
    color: var(--text-muted);
    font-family: var(--font-display);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 看板娘那一格：猫与叠在上面的贡献组件同在一格（单格网格，不加定位），格子的宽与圆角在这里，里面的取 inherit。 */
.shelf-desk__mascot {
    display: grid;
    justify-self: end;
    width: 150px;
    border-radius: 34px;
}

.shelf-desk__mood,
.shelf-desk__companion {
    grid-area: 1 / 1;
    width: 100%;
    border-radius: inherit;
}

@container (max-width: 720px) {
    .shelf-desk__grid,
    .shelf-desk--empty .shelf-desk__grid {
        grid-template-columns: minmax(0, 1fr) 96px;
    }

    .shelf-desk__recent {
        grid-column: 1 / -1;
    }

    /* 窄时猫和统计并排在第一行，最近写到独占下一行；不定位的话自动摆放会把猫甩到最后一行。 */
    .shelf-desk__mascot {
        grid-row: 1;
        grid-column: 2;
        width: 96px;
        border-radius: 22px;
    }

    .shelf-desk__number {
        font-size: 40px;
    }
}
</style>
