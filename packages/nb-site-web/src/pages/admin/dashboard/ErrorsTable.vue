<script setup lang="ts">
/**
 * 错误（`site.telemetry-dashboard` 接口表的 `errors`）：每行一对拥有者与错误码、带它的上报份数与占比，和一条按当天出错次数分成
 * 五段的横条。五段是同一种红由浅到深（`--site-seq-1` 到 `--site-seq-5`，t09 第 15 条），表头写图例；横条另有 `aria-label`
 * 逐档写出份数，不单靠颜色。
 */

import {computed} from "vue";

import {locale} from "../../../locale";
import {useSiteText} from "../../../text";
import type {SiteTextKey} from "../../../text";
import {errorShare, formatCount, formatShare} from "./model";
import type {Problems} from "./model";

const props = defineProps<{problems: Problems}>();
const t = useSiteText();

const BIN_KEYS = [
    "admin.dashboard.errors.bin1",
    "admin.dashboard.errors.bin2",
    "admin.dashboard.errors.bin3",
    "admin.dashboard.errors.bin4",
    "admin.dashboard.errors.bin5",
] as const satisfies readonly SiteTextKey[];

const bins = computed(() => BIN_KEYS.map((key) => t(key)));

const rows = computed(() => props.problems.errors.map((row) => ({
    key: `${row.owner}.${row.code}`,
    owner: row.owner,
    code: row.code,
    reports: formatCount(row.reports, locale.value),
    share: formatShare(errorShare(props.problems, row), locale.value),
    segments: row.bins.map((count, index) => ({index, count})).filter((segment) => segment.count > 0),
    label: row.bins.map((count, index) => t("admin.dashboard.errors.binCount", {bin: bins.value[index] ?? "", count: formatCount(count, locale.value)})).join(t("admin.dashboard.errors.binSeparator")),
})));
</script>

<template>
    <table class="errors">
        <thead>
            <tr>
                <th scope="col">{{ t("admin.dashboard.errors.code") }}</th>
                <th scope="col" class="is-num">{{ t("admin.dashboard.errors.reports") }}</th>
                <th scope="col" class="is-num">{{ t("admin.dashboard.errors.share") }}</th>
                <th scope="col">
                    <span class="errors__bins">
                        {{ t("admin.dashboard.errors.bins") }}
                        <span v-for="(bin, index) in bins" :key="bin"><i class="errors__swatch" :style="{background: `var(--site-seq-${index + 1})`}" data-site-error-swatch />{{ bin }}</span>
                    </span>
                </th>
            </tr>
        </thead>
        <tbody>
            <tr v-for="row in rows" :key="row.key">
                <th scope="row">
                    <!-- 两段之间的空格留在文字里：读屏读成“nbook store_locked”，不连成一个词。 -->
                    <span class="errors__id"><span class="errors__owner" :title="row.owner">{{ row.owner }}</span> <span class="errors__code" :title="row.code">{{ row.code }}</span></span>
                </th>
                <td class="is-num">{{ row.reports }}</td>
                <td class="is-num">{{ row.share }}</td>
                <td>
                    <span class="errors__split" role="img" :aria-label="row.label">
                        <i v-for="segment in row.segments" :key="segment.index" :style="{flexGrow: segment.count, background: `var(--site-seq-${segment.index + 1})`}" />
                    </span>
                </td>
            </tr>
        </tbody>
    </table>
</template>

<style scoped>
.errors {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
}

.errors th,
.errors td {
    height: 30px;
    padding: 0 12px 0 0;
    overflow: hidden;
    font-weight: 400;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.errors thead th {
    height: 24px;
    color: var(--text-secondary);
    font-size: var(--text-xs);
}

.errors th[scope="row"] {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
}

.errors__bins,
.errors__bins span {
    display: flex;
    align-items: center;
    gap: 5px;
}

.errors__bins {
    gap: 12px;
}

/* 拥有者定宽一列、码占其余：两段各自截断，名字长的拥有者不会盖到码上；截断的全文在 `title` 里。 */
.errors__id {
    display: flex;
    min-width: 0;
}

.errors__owner,
.errors__code {
    overflow: hidden;
    text-overflow: ellipsis;
}

.errors__owner {
    flex: none;
    width: 56px;
    padding-right: 8px;
    box-sizing: border-box;
    color: var(--text-secondary);
}

.errors__code {
    min-width: 0;
}

.errors .is-num {
    width: 52px;
    font-variant-numeric: tabular-nums;
    text-align: right;
}

.errors td:last-child,
.errors th:last-child {
    width: 54%;
    padding-right: 0;
    padding-left: 12px;
}

.errors__swatch {
    width: 8px;
    height: 8px;
    border-radius: 2px;
}

/* 一条分成几段：每段的宽度按份数，段与段之间留 2px 的底色。 */
.errors__split {
    display: flex;
    gap: 2px;
    height: 8px;
}

.errors__split i {
    flex-basis: 0;
    min-width: 2px;
    border-radius: 2px;
}
</style>
