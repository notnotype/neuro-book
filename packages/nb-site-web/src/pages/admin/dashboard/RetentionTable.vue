<script setup lang="ts">
/**
 * 留存（`site.telemetry-dashboard` 输出 3）：每行一个安装周，列是那周的新增与之后第 1、2、4、8 周的留存比例。格子的底色按比例
 * 从浅底往第一格序列色混（照 t09 定稿），还没到的那一周留空格。只画最近几个安装周（`model.ts` 的 `RETENTION_SHOWN_WEEKS`），
 * 行数固定，面板不用在里面滚。
 */

import {computed} from "vue";

import {locale} from "../../../locale";
import {useSiteText} from "../../../text";
import {dayLabel, formatCount, formatShare, RETENTION_WEEKS, retentionShare, shownCohorts} from "./model";
import type {Retention} from "./model";

const props = defineProps<{retention: Retention}>();
const t = useSiteText();

/** 比例为 1 时混进一半的序列色：定稿里的深浅；再深，格子里的字就读不清了。 */
const HEAT_AT_FULL = 50;

const rows = computed(() => shownCohorts(props.retention).map((cohort) => ({
    week: cohort.week,
    label: t("admin.dashboard.retention.cohort", {date: dayLabel(cohort.week)}),
    fresh: formatCount(cohort.fresh, locale.value),
    cells: RETENTION_WEEKS.map((_, index) => {
        const share = retentionShare(cohort, index);
        return share === null ? null : {text: formatShare(share, locale.value), heat: `${Math.round(share * HEAT_AT_FULL)}%`};
    }),
})));
</script>

<template>
    <table class="retention">
        <thead>
            <tr>
                <th scope="col">{{ t("admin.dashboard.retention.install") }}</th>
                <th scope="col">{{ t("admin.dashboard.retention.fresh") }}</th>
                <th v-for="week in RETENTION_WEEKS" :key="week" scope="col">{{ t("admin.dashboard.retention.week", {week}) }}</th>
            </tr>
        </thead>
        <tbody>
            <tr v-for="row in rows" :key="row.week">
                <th scope="row">{{ row.label }}</th>
                <td>{{ row.fresh }}</td>
                <td v-for="(cell, index) in row.cells" :key="index" class="retention__cell" :style="cell === null ? undefined : {'--retention-heat': cell.heat}">{{ cell?.text ?? "" }}</td>
            </tr>
        </tbody>
    </table>
</template>

<style scoped>
.retention {
    width: 100%;
    border-collapse: separate;
    border-spacing: 3px;
    font-variant-numeric: tabular-nums;
}

.retention th {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 400;
    text-align: right;
    white-space: nowrap;
}

.retention th[scope="row"],
.retention thead th:first-child {
    color: var(--text-secondary);
    font-size: var(--text-sm);
    text-align: left;
}

.retention td {
    height: 28px;
    padding: 0 8px;
    border-radius: 4px;
    text-align: right;
}

.retention__cell {
    background: color-mix(in srgb, var(--site-viz-1) var(--retention-heat, 0%), var(--bg-subtle));
}
</style>
