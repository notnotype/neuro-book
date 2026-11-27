<script setup lang="ts">
/**
 * 看板（t10 计划 3.5；`site.telemetry-dashboard`；版式照 t09 定稿 r5 `dashboard-red`）：上面一条今天的四个数，中间活跃与在线
 * 两张 ECharts 折线，下面版本、系统、留存、错误、崩溃、升级六块 HTML。每块面板各自取数、各自有加载、没有数据、出错三种状态，
 * 高度固定（`DashboardPanel.vue`）。
 *
 * 时间范围放在地址的 `?range=`（缺省近 28 天不写），只管活跃图：别的面板是“今天”“近 24 小时”或最近几个安装周，换范围不重取它们。
 * 换范围用 `replace`：来回点几次不在历史里留一串。
 *
 * 数据从 `source.ts` 的 `DashboardSource` 取，页面不认识数据从哪来（D8）。本文件是构建测试认看板块的锚点
 * （`tests/build.test.ts` 的 `DASHBOARD_SOURCE`）：图表模块只经这里的子组件导入，ECharts 跟着看板的块走。
 */

import {Badge, SegmentedControl} from "@notnotype/nb-ui/components";
import type {SegmentedControlValue} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, watch} from "vue";
import {useRoute, useRouter} from "vue-router";

import {useSite} from "../../context";
import {failureText} from "../../http/failure-text";
import {locale} from "../../locale";
import {useSiteText} from "../../text";
import AdminPageHead from "./AdminPageHead.vue";
import {buildActiveOption, buildOnlineOption} from "./dashboard/charts/options";
import type {ChartText} from "./dashboard/charts/options";
import {renderTooltip} from "./dashboard/charts/tooltip";
import DashboardPanel from "./dashboard/DashboardPanel.vue";
import type {PanelState} from "./dashboard/DashboardPanel.vue";
import ErrorsTable from "./dashboard/ErrorsTable.vue";
import {activeChart, CRASH_KEYS, DASHBOARD_RANGES, formatChange, formatCount, formatShare, onlineChart, rangeFromQuery, rangeQuery, UPGRADE_KEYS, withShares} from "./dashboard/model";
import type {Breakdown} from "./dashboard/model";
import RetentionTable from "./dashboard/RetentionTable.vue";
import ShareBars from "./dashboard/ShareBars.vue";
import type {BarTone, ShareBar} from "./dashboard/ShareBars.vue";
import {createDashboardSource} from "./dashboard/source";
import TrendChart from "./dashboard/TrendChart.vue";
import {usePanelData} from "./dashboard/use-panel-data";
import type {PanelData} from "./dashboard/use-panel-data";

const ROUTE_NAME = "admin-dashboard";

const t = useSiteText();
const port = useText();
const {api, clock} = useSite();
const route = useRoute();
const router = useRouter();
const source = createDashboardSource(api);

// ---- 时间范围 ----

const range = computed(() => rangeFromQuery(route.query.range));
const rangeOptions = computed(() => DASHBOARD_RANGES.map((value) => ({value, label: t(`admin.dashboard.ranges.d${value}`)})));

function setRange(value: SegmentedControlValue): void {
    const next = rangeFromQuery(String(value));
    if (next === range.value) return;
    const {range: _previous, ...rest} = route.query;
    void router.replace({query: {...rest, ...rangeQuery(next)}});
}

// ---- 取数 ----

const today = usePanelData(() => source.today(), clock);
const active = usePanelData(() => source.active(range.value), clock);
const online = usePanelData(() => source.online(), clock);
const versions = usePanelData(() => source.breakdown("version"), clock);
const systems = usePanelData(() => source.breakdown("os"), clock);
const retention = usePanelData(() => source.retention(), clock);
const problems = usePanelData(() => source.problems(), clock);

// 离开看板时地址的查询串也变了（`range` 回到缺省），那时不重取：页面正在卸载。
watch(range, () => {
    if (route.name === ROUTE_NAME) active.reload();
});

function stateOf<T>(data: PanelData<T>, isEmpty: (value: T) => boolean): PanelState {
    const value = data.value.value;
    if (value !== undefined) return isEmpty(value) ? "empty" : "ready";
    return data.failure.value === undefined ? "loading" : "failed";
}

function reasonOf<T>(data: PanelData<T>): string {
    const failure = data.failure.value;
    return failure === undefined ? "" : port.t(failureText("telemetry", failure));
}

const count = (value: number): string => formatCount(value, locale.value);
const noValue = computed(() => t("admin.dashboard.noValue"));

// ---- 今天的四个数 ----

const figures = computed(() => {
    const value = today.value.value;
    if (value === undefined) return [];
    const change = (delta: number | null) => (delta === null ? t("admin.dashboard.noYesterday") : t("admin.dashboard.change", {change: formatChange(delta, locale.value)}));
    return [
        {id: "active", label: t("admin.dashboard.figures.active"), value: count(value.active), note: change(value.activeChange)},
        {id: "fresh", label: t("admin.dashboard.figures.fresh"), value: count(value.fresh), note: change(value.freshChange)},
        {id: "online", label: t("admin.dashboard.figures.online"), value: count(value.online), note: t("admin.dashboard.onlineWindow", {minutes: value.onlineWindowMinutes})},
        {id: "usage", label: t("admin.dashboard.figures.usage"), value: value.usageShare === null ? noValue.value : formatShare(value.usageShare, locale.value), note: t("admin.dashboard.usageNote")},
    ];
});

// ---- 两张图 ----

const chartText = computed<ChartText>(() => ({
    active: [t("admin.dashboard.active.daily"), t("admin.dashboard.active.weekly"), t("admin.dashboard.active.monthly")],
    online: t("admin.dashboard.online.series"),
    noReports: t("admin.dashboard.noReports"),
    hour: (hour) => t("admin.dashboard.online.hour", {hour}),
    count,
}));

const activeView = computed(() => (active.value.value === undefined ? undefined : activeChart(active.value.value)));
const activeOption = computed(() => {
    const chart = activeView.value;
    const text = chartText.value;
    return chart === undefined ? undefined : (theme: Parameters<typeof buildActiveOption>[1], motion: Parameters<typeof buildActiveOption>[3]) => buildActiveOption(chart, theme, text, motion, renderTooltip);
});
/** 读屏的概括按画着的那份数据写：换范围、新数据还没到时，图上仍是旧范围。 */
const activeLabel = computed(() => t("admin.dashboard.active.label", {days: activeView.value?.dates.length ?? range.value}));

const onlineOption = computed(() => {
    const value = online.value.value;
    const text = chartText.value;
    if (value === undefined) return undefined;
    const chart = onlineChart(value);
    return (theme: Parameters<typeof buildOnlineOption>[1], motion: Parameters<typeof buildOnlineOption>[3]) => buildOnlineOption(chart, theme, text, motion, renderTooltip);
});

const legend = computed(() => chartText.value.active.map((name, index) => ({name, color: `var(--site-viz-${index + 1})`})));

// ---- 下面六块 ----

const breakdownEmpty = (value: Breakdown): boolean => value.rows.every((row) => row.count === 0);

function breakdownBars(value: Breakdown | undefined): ShareBar[] {
    if (value === undefined) return [];
    return withShares(value.rows).map((row) => ({key: row.rest === true ? "rest" : row.label, label: row.rest === true ? t("admin.dashboard.rest") : row.label, share: row.share, tone: "series"}));
}

const CRASH_TONES: Readonly<Record<(typeof CRASH_KEYS)[number], BarTone>> = {none: "neutral", once: "danger", few: "danger", many: "danger"};
const UPGRADE_TONES: Readonly<Record<(typeof UPGRADE_KEYS)[number], BarTone>> = {none: "neutral", succeeded: "success", failed: "danger"};

const crashBars = computed<ShareBar[]>(() => {
    const value = problems.value.value;
    if (value === undefined) return [];
    return withShares(CRASH_KEYS.map((key) => ({key, count: value.crashes[key]}))).map((row) => ({key: row.key, label: t(`admin.dashboard.crashes.${row.key}`), share: row.share, tone: CRASH_TONES[row.key]}));
});

const upgradeBars = computed<ShareBar[]>(() => {
    const value = problems.value.value;
    if (value === undefined) return [];
    return withShares(UPGRADE_KEYS.map((key) => ({key, count: value.upgrades[key]}))).map((row) => ({key: row.key, label: t(`admin.dashboard.upgrades.${row.key}`), share: row.share, tone: UPGRADE_TONES[row.key]}));
});

const problemsState = computed(() => stateOf(problems, (value) => value.reports === 0));
/** 有上报而没有错误时，错误一块写“今天没有错误”；崩溃、升级两块照常画。 */
const errorsState = computed<PanelState>(() => (problemsState.value === "ready" && problems.value.value?.errors.length === 0 ? "empty" : problemsState.value));
const errorsEmptyText = computed(() => t(problemsState.value === "empty" ? "admin.dashboard.emptyToday" : "admin.dashboard.errors.empty"));
const crashTotal = computed(() => {
    const value = problems.value.value;
    return value === undefined ? 0 : CRASH_KEYS.reduce((sum, key) => sum + value.crashes[key], 0);
});
const upgradeTotal = computed(() => {
    const value = problems.value.value;
    return value === undefined ? 0 : UPGRADE_KEYS.reduce((sum, key) => sum + value.upgrades[key], 0);
});
const crashesState = computed<PanelState>(() => (problemsState.value === "ready" && crashTotal.value === 0 ? "empty" : problemsState.value));
const upgradesState = computed<PanelState>(() => (problemsState.value === "ready" && upgradeTotal.value === 0 ? "empty" : problemsState.value));

/** 一组面板共用的属性：状态、慢不慢、在不在重取、出错的原因。 */
function bind<T>(data: PanelData<T>, state: PanelState) {
    return {state, slow: data.slow.value, pending: data.pending.value, failureText: reasonOf(data)};
}

const PANEL_HEIGHT = {figures: 80, chart: 230, table: 168, errors: 216, crashes: 116, upgrades: 87} as const;
</script>

<template>
    <div class="dashboard" :data-site-page="ROUTE_NAME">
        <AdminPageHead :title="t('admin.dashboard.title')">
            <Badge v-if="today.value.value !== undefined" tone="neutral" variant="soft" size="sm">{{ t("admin.dashboard.manifest", {version: today.value.value.manifestVersion}) }}</Badge>
            <span class="dashboard__fill" />
            <SegmentedControl :model-value="range" :options="rangeOptions" :aria-label="t('admin.dashboard.range')" data-site-dashboard-range @update:model-value="setRange" />
        </AdminPageHead>

        <DashboardPanel
            id="today"
            :label="t('admin.dashboard.today')"
            strip
            :height="PANEL_HEIGHT.figures"
            v-bind="bind(today, stateOf(today, () => false))"
            @retry="today.reload()"
        >
            <div class="dashboard-figures">
                <div v-for="figure in figures" :key="figure.id" class="dashboard-figure" :data-site-figure="figure.id">
                    <div class="dashboard-figure__label">{{ figure.label }}</div>
                    <div class="dashboard-figure__value">{{ figure.value }}</div>
                    <div class="dashboard-figure__note">{{ figure.note }}</div>
                </div>
            </div>
        </DashboardPanel>

        <div class="dashboard-row dashboard-row--charts">
            <DashboardPanel
                id="active"
                :title="t('admin.dashboard.active.title')"
                :height="PANEL_HEIGHT.chart"
                :empty-text="t('admin.dashboard.active.empty')"
                v-bind="bind(active, stateOf(active, (value) => value.days.length === 0))"
                @retry="active.reload()"
            >
                <template #head>
                    <ul class="dashboard-legend" aria-hidden="true">
                        <li v-for="item in legend" :key="item.name"><i class="dashboard-legend__key" :style="{background: item.color}" />{{ item.name }}</li>
                    </ul>
                </template>
                <TrendChart v-if="activeOption !== undefined" id="active" :label="activeLabel" :option="activeOption" />
            </DashboardPanel>

            <DashboardPanel
                id="online"
                :title="t('admin.dashboard.online.title')"
                :height="PANEL_HEIGHT.chart"
                :empty-text="t('admin.dashboard.online.empty')"
                v-bind="bind(online, stateOf(online, (value) => value.segments.length === 0))"
                @retry="online.reload()"
            >
                <template #head><span class="dashboard-meta">{{ t("admin.dashboard.online.meta") }}</span></template>
                <TrendChart v-if="onlineOption !== undefined" id="online" :label="t('admin.dashboard.online.label')" :option="onlineOption" />
            </DashboardPanel>
        </div>

        <div class="dashboard-row dashboard-row--tables">
            <DashboardPanel
                id="versions"
                :title="t('admin.dashboard.versions.title')"
                :height="PANEL_HEIGHT.table"
                :empty-text="t('admin.dashboard.emptyToday')"
                v-bind="bind(versions, stateOf(versions, breakdownEmpty))"
                @retry="versions.reload()"
            >
                <template #head><span class="dashboard-meta">{{ t("admin.dashboard.todayReports") }}</span></template>
                <ShareBars :rows="breakdownBars(versions.value.value)" />
            </DashboardPanel>

            <DashboardPanel
                id="systems"
                :title="t('admin.dashboard.systems.title')"
                :height="PANEL_HEIGHT.table"
                :empty-text="t('admin.dashboard.emptyToday')"
                v-bind="bind(systems, stateOf(systems, breakdownEmpty))"
                @retry="systems.reload()"
            >
                <template #head><span class="dashboard-meta">{{ t("admin.dashboard.todayReports") }}</span></template>
                <ShareBars :rows="breakdownBars(systems.value.value)" />
            </DashboardPanel>

            <DashboardPanel
                id="retention"
                :title="t('admin.dashboard.retention.title')"
                :height="PANEL_HEIGHT.table"
                :empty-text="t('admin.dashboard.retention.empty')"
                v-bind="bind(retention, stateOf(retention, (value) => value.cohorts.length === 0))"
                @retry="retention.reload()"
            >
                <template #head><span class="dashboard-meta">{{ t("admin.dashboard.retention.meta") }}</span></template>
                <RetentionTable v-if="retention.value.value !== undefined" :retention="retention.value.value" />
            </DashboardPanel>
        </div>

        <div class="dashboard-row dashboard-row--errors">
            <DashboardPanel
                id="errors"
                :title="t('admin.dashboard.errors.title')"
                :height="PANEL_HEIGHT.errors"
                :empty-text="errorsEmptyText"
                v-bind="bind(problems, errorsState)"
                @retry="problems.reload()"
            >
                <template #head>
                    <span v-if="problems.value.value !== undefined" class="dashboard-meta">{{ t("admin.dashboard.errors.meta", {count: count(problems.value.value.reports)}) }}</span>
                </template>
                <ErrorsTable v-if="problems.value.value !== undefined" :problems="problems.value.value" />
            </DashboardPanel>

            <div class="dashboard-stack">
                <DashboardPanel
                    id="crashes"
                    :title="t('admin.dashboard.crashes.title')"
                    :height="PANEL_HEIGHT.crashes"
                    :empty-text="t('admin.dashboard.emptyToday')"
                    v-bind="bind(problems, crashesState)"
                    @retry="problems.reload()"
                >
                    <template #head><span class="dashboard-meta">{{ t("admin.dashboard.todayReports") }}</span></template>
                    <ShareBars :rows="crashBars" wide />
                </DashboardPanel>

                <DashboardPanel
                    id="upgrades"
                    :title="t('admin.dashboard.upgrades.title')"
                    :height="PANEL_HEIGHT.upgrades"
                    :empty-text="t('admin.dashboard.emptyToday')"
                    v-bind="bind(problems, upgradesState)"
                    @retry="problems.reload()"
                >
                    <template #head><span class="dashboard-meta">{{ t("admin.dashboard.todayReports") }}</span></template>
                    <ShareBars :rows="upgradeBars" wide />
                </DashboardPanel>
            </div>
        </div>
    </div>
</template>

<style scoped>
/*
 * 版式照 t09 定稿：三排面板，列宽比例取自草稿。管理面板只做桌面宽（t09 定），内容区窄于 880 像素（窗口约 1120 像素以下）时
 * 每排改成一列：宁可变长要往下滚，也不让页面横向滚动或把图挤成几十像素宽。四个数一直是一排，窗口 800 像素时每格仍放得下。
 */
.dashboard {
    display: flex;
    flex-direction: column;
    gap: 12px;
    container-type: inline-size;
}

.dashboard__fill {
    flex: 1;
}

.dashboard-figures {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    height: 100%;
}

.dashboard-figure {
    min-width: 0;
    padding: 0 22px;
}

.dashboard-figure + .dashboard-figure {
    border-left: 1px solid var(--border-color);
}

.dashboard-figure__label {
    color: var(--text-secondary);
}

.dashboard-figure__value {
    margin-top: 2px;
    font-size: 32px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
}

.dashboard-figure__note {
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.dashboard-row {
    display: grid;
    gap: 12px;
}

.dashboard-row--charts {
    grid-template-columns: minmax(0, 2.1fr) minmax(0, 1fr);
}

.dashboard-row--tables {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.5fr);
}

.dashboard-row--errors {
    grid-template-columns: minmax(0, 2.6fr) minmax(0, 1.2fr);
}

.dashboard-stack {
    display: grid;
    gap: 12px;
    min-width: 0;
}

.dashboard-meta {
    color: var(--text-muted);
    font-size: var(--text-xs);
    white-space: nowrap;
}

.dashboard-legend {
    display: flex;
    gap: 16px;
    margin: 0 0 0 auto;
    padding: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    list-style: none;
}

.dashboard-legend li {
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
}

.dashboard-legend__key {
    width: 14px;
    height: 2px;
    border-radius: 1px;
}

@container (width < 880px) {
    .dashboard-row--charts,
    .dashboard-row--tables,
    .dashboard-row--errors {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
