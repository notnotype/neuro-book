<script setup lang="ts">
/**
 * 一列横条：名字、按比例的条、百分数（版本、系统、崩溃、升级四块，照 t09 定稿 r5 的画法）。条的颜色：版本与系统用第一格序列色；
 * 崩溃与升级按含义用状态色，旁边都有文字，不单靠颜色（t09 第 15 条）：出了问题的用 `--status-danger`，升级成功用
 * `--status-success`，没出事的那一行用不起眼的灰。
 */

import {locale} from "../../../locale";
import {formatShare} from "./model";

export type BarTone = "series" | "neutral" | "danger" | "success";

export interface ShareBar {
    readonly key: string;
    readonly label: string;
    /** 0 到 1。 */
    readonly share: number;
    readonly tone: BarTone;
}

const props = withDefaults(defineProps<{rows: readonly ShareBar[]; wide?: boolean}>(), {wide: false});
</script>

<template>
    <ul class="share-bars" :class="{'share-bars--wide': props.wide}">
        <li v-for="row in props.rows" :key="row.key" :data-site-share-bar="row.key">
            <span class="share-bars__name" :title="row.label">{{ row.label }}</span>
            <span class="share-bars__track" :class="`is-${row.tone}`" aria-hidden="true"><i :class="{'is-some': row.share > 0}" :style="{width: `${row.share * 100}%`}" /></span>
            <span class="share-bars__share">{{ formatShare(row.share, locale) }}</span>
        </li>
    </ul>
</template>

<style scoped>
.share-bars {
    display: grid;
    gap: 9px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.share-bars li {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) 44px;
    align-items: center;
    gap: 10px;
}

.share-bars--wide li {
    grid-template-columns: 76px minmax(0, 1fr) 48px;
}

.share-bars__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.share-bars__track {
    height: 8px;
    border-radius: var(--radius-pill);
    background: var(--bg-subtle);
}

.share-bars__track i {
    display: block;
    height: 100%;
    border-radius: inherit;
    transition: width var(--motion-move) var(--ease-layout);
}

/* 不为 0 的比例再小也留一点颜色：0.04% 的崩溃按比例画不出来，看起来像没有。 */
.share-bars__track i.is-some {
    min-width: 2px;
}

.share-bars__track.is-series i {
    background: var(--site-viz-1);
}

.share-bars__track.is-neutral i {
    background: var(--text-muted);
}

.share-bars__track.is-danger i {
    background: var(--status-danger);
}

.share-bars__track.is-success i {
    background: var(--status-success);
}

.share-bars__share {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    text-align: right;
}
</style>
