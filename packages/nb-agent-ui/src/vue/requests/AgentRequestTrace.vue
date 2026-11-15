<script setup lang="ts">
/**
 * 模型请求查看器（docs/specs/agent/request-trace.md 的“查看器”）：常驻的筛选条，左边请求列表，右边选中那次请求的详情。
 * 数据都由宿主给（列表、详情、内容与原始请求体），筛选受控、改了发 `update:query`，其余操作经 `action` 交回；查看器不取数。
 * 宽到放不下两栏时列表与详情来回切换（Spec 输出 23），切换状态是组件自己的。
 */
import {computed, onBeforeUnmount, ref, watch} from "vue";
import {AlertDialog, Button, DropdownMenu, IconButton, Input} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";

import {formatBytes} from "../../request-trace";
import type {RequestTraceAction, RequestTraceCompareView, RequestTraceHit, RequestTraceSearchState, RequestTraceSort, RequestTraceContentState, RequestTraceDetailState, RequestTraceFacets, RequestTraceListState, RequestTracePayloadView, RequestTracePurpose, RequestTraceQuery, RequestTraceRow, RequestTraceStatusFilter, RequestTraceTotals} from "../../request-trace";
import type {AgentLocale} from "../../types";
import {provideAgentText} from "../text";
import AgentRequestDetail from "./AgentRequestDetail.vue";
import AgentRequestList from "./AgentRequestList.vue";

const props = withDefaults(defineProps<{
    rows: readonly RequestTraceRow[];
    list: RequestTraceListState;
    totals: RequestTraceTotals;
    facets: RequestTraceFacets;
    /** 筛选与排序，受控。 */
    query: RequestTraceQuery;
    /** 来了、但没有插进列表的新请求数（Spec 输出 15）；为 0 时不显示提示。 */
    pending?: number;
    selected: string | null;
    detail: RequestTraceDetailState;
    /** 按内容哈希取回的全文。 */
    contents: Readonly<Record<string, RequestTraceContentState>>;
    /** 选中那条的原始请求体。 */
    payload: RequestTracePayloadView;
    /** 比较页：拿来比的那次与它的详情；缺省还没定。 */
    compare?: RequestTraceCompareView;
    /** 查找词，受控；改了（输入法组字结束、停顿 300 毫秒之后）发 `update:search`。为空时不在查找。 */
    search?: string;
    /** 查找的状态。查找时 `rows` 是查找交回的行（带 `match`）。 */
    searchState?: RequestTraceSearchState;
    /** 选中那条全部的命中（查找条用）；还没取到时为 null。 */
    hits?: readonly RequestTraceHit[] | null;
    /** 记录目录的占用（“更多”菜单里写）；还没取到时为 null。 */
    usage?: {readonly bytes: number; readonly payloadBytes: number} | null;
    /** 记录开着；关着且没有记录时空状态写“没有在记录”与“打开记录”。 */
    enabled: boolean;
    /** 宿主给的当前时间：进行中的请求写已经等了多久。 */
    now: number;
    /** 没有宿主注入翻译端口时的界面语言，缺省 zh-CN。 */
    locale?: AgentLocale;
}>(), {pending: 0, locale: undefined, compare: () => ({base: null, detail: {state: "idle"}}), search: "", searchState: () => ({state: "idle", truncated: false}), hits: null, usage: null});

const emit = defineEmits<{"update:query": [query: RequestTraceQuery]; "update:search": [search: string]; action: [action: RequestTraceAction]}>();

const {t} = provideAgentText(() => props.locale);

// ─── 查找框：输入法组字时不发，停顿 300 毫秒才发（每发一次宿主就作废上一次查找、重扫一遍）───

const SEARCH_DELAY_MS = 300;
const draft = ref(props.search);
let composing = false;
let timer: ReturnType<typeof setTimeout> | null = null;
watch(() => props.search, (search) => {
    if (search !== draft.value.trim()) draft.value = search;
});
function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
        timer = null;
        const text = draft.value.trim();
        if (text !== props.search) emit("update:search", text);
    }, SEARCH_DELAY_MS);
}
function onDraft(value: string): void {
    draft.value = value;
    if (!composing) schedule();
}
function onCompositionStart(): void {
    composing = true;
}
function onCompositionEnd(): void {
    composing = false;
    schedule();
}
onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer);
});

/** 窄时显示哪一栏；宽时两栏都在，这个值不起作用。 */
const view = ref<"list" | "detail">(props.selected === null ? "list" : "detail");

function onAction(action: RequestTraceAction): void {
    if (action.type === "request.select") view.value = "detail";
    emit("action", action);
}

// 宿主带着选中打开页面（“查看这次请求”、打开时选中最新的一条）时窄态显示详情；选中被清掉（清空了记录）时回到列表。
watch(() => props.selected, (selected, previous) => {
    if (selected === null) view.value = "list";
    else if (previous === null) view.value = "detail";
});

const index = computed(() => props.rows.findIndex((row) => row.id === props.selected));
const newer = computed(() => (index.value > 0 ? props.rows[index.value - 1]!.id : null));
const older = computed(() => (index.value >= 0 && index.value < props.rows.length - 1 ? props.rows[index.value + 1]!.id : null));

/** 比较页可以换着比的：已加载的行里同一会话、更早开始的那几次（新的在前）。 */
const compareCandidates = computed(() => {
    const detail = props.detail.state === "ready" ? props.detail.value : null;
    if (detail === null) return [];
    return props.rows.filter((row) => row.session === detail.session && row.startedAt < detail.startedAt);
});

const singleSession = computed(() => (props.query.sessions?.length ?? 0) === 1);
const filtered = computed(() => (props.query.sessions?.length ?? 0) + (props.query.purposes?.length ?? 0) + (props.query.statuses?.length ?? 0) + (props.query.models?.length ?? 0) > 0 || props.query.since !== undefined);
const excluded = computed(() => props.selected !== null && index.value < 0 && props.detail.state === "ready");

const PURPOSES: readonly RequestTracePurpose[] = ["turn", "compaction", "approval", "background"];
const SORTS: readonly RequestTraceSort[] = ["time", "duration", "input", "cost"];
type TimePreset = "hour" | "today" | "all";

/**
 * 时间筛选的选项是相对的（最近一小时、今天），`query.since` 存的是选的那一刻算出的时刻，从它反推不出选的是哪一项：
 * 选项记在组件里，筛选被清掉（`since` 没了）时回到“全部”。
 */
const timePreset = ref<TimePreset>(props.query.since === undefined ? "all" : "today");
watch(() => props.query.since, (since) => {
    if (since === undefined) timePreset.value = "all";
});
function sinceOf(preset: TimePreset): number | undefined {
    if (preset === "hour") return props.now - 3_600_000;
    if (preset === "today") {
        const day = new Date(props.now);
        return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    }
    return undefined;
}
/** Spec 输出 16 的顺序。 */
const STATUSES: readonly {readonly value: RequestTraceStatusFilter; readonly key: "ok" | "error" | "resend" | "aborted" | "interrupted" | "cacheMiss"}[] = [
    {value: "ok", key: "ok"},
    {value: "error", key: "error"},
    {value: "resend", key: "resend"},
    {value: "aborted", key: "aborted"},
    {value: "interrupted", key: "interrupted"},
    {value: "cache-miss", key: "cacheMiss"},
];

const separator = computed(() => t("stream.phraseSeparator"));

function sessionLabel(id: string): string {
    const facet = props.facets.sessions.find((item) => item.id === id);
    const title = facet?.title ?? t("requests.filter.untitled");
    return facet?.background === true ? `${title} · ${t("requests.group.background")}` : title;
}

const sessionItems = computed<DropdownMenuItemData[]>(() => [
    {id: "session:", label: t("requests.filter.allSessions"), type: "radio", group: "session", checked: !singleSession.value},
    ...props.facets.sessions.map((facet) => ({id: `session:${facet.id}`, label: `${sessionLabel(facet.id)} (${String(facet.count)})`, type: "radio" as const, group: "session", checked: props.query.sessions?.[0] === facet.id && singleSession.value})),
]);
const purposeItems = computed<DropdownMenuItemData[]>(() => PURPOSES.map((purpose) => ({id: `purpose:${purpose}`, label: t(`requests.purpose.${purpose}`), type: "checkbox", checked: props.query.purposes?.includes(purpose) === true})));
const statusItems = computed<DropdownMenuItemData[]>(() => STATUSES.map((status) => ({id: `status:${status.value}`, label: t(`requests.status.${status.key}`), type: "checkbox", checked: props.query.statuses?.includes(status.value) === true})));
const modelItems = computed<DropdownMenuItemData[]>(() => props.facets.models.map((facet) => ({id: `model:${facet.id}`, label: `${facet.id} (${String(facet.count)})`, type: "checkbox" as const, checked: props.query.models?.includes(facet.id) === true})));
const timeItems = computed<DropdownMenuItemData[]>(() => (["hour", "today", "all"] as const).map((preset) => ({id: `time:${preset}`, label: t(`requests.time.${preset}`), type: "radio" as const, group: "time", checked: timePreset.value === preset})));
const sortItems = computed<DropdownMenuItemData[]>(() => SORTS.map((sort) => ({id: `sort:${sort}`, label: t(`requests.sort.${sort}`), type: "radio" as const, group: "sort", checked: (props.query.sort ?? "time") === sort})));

/** 清空前的确认（Spec 输出 25）。 */
const confirming = ref<"session" | "all" | null>(null);
const moreItems = computed<DropdownMenuItemData[]>(() => [
    ...(props.usage === null ? [] : [{id: "more:usage", label: t("requests.more.usage", {size: formatBytes(props.usage.bytes), payload: formatBytes(props.usage.payloadBytes)}), iconClass: "i-lucide-hard-drive", disabled: true}]),
    {id: "more:settings", label: t("requests.more.settings"), iconClass: "i-lucide-settings"},
    ...(singleSession.value ? [{id: "more:clear-session", label: t("requests.more.clearSession"), iconClass: "i-lucide-trash-2", tone: "danger" as const}] : []),
    {id: "more:clear-all", label: t("requests.more.clearAll"), iconClass: "i-lucide-trash-2", tone: "danger" as const},
]);

const chips = computed(() => [
    {id: "session", label: t("requests.filter.session"), items: sessionItems.value, active: (props.query.sessions?.length ?? 0) > 0, value: singleSession.value ? sessionLabel(props.query.sessions![0]!) : (props.query.sessions?.length ?? 0) > 1 ? String(props.query.sessions!.length) : t("requests.filter.all")},
    {id: "purpose", label: t("requests.filter.purpose"), items: purposeItems.value, active: (props.query.purposes?.length ?? 0) > 0, value: (props.query.purposes ?? []).map((purpose) => t(`requests.purpose.${purpose}`)).join(separator.value) || t("requests.filter.all")},
    {id: "status", label: t("requests.filter.status"), items: statusItems.value, active: (props.query.statuses?.length ?? 0) > 0, value: STATUSES.filter((status) => props.query.statuses?.includes(status.value) === true).map((status) => t(`requests.status.${status.key}`)).join(separator.value) || t("requests.filter.all")},
    {id: "model", label: t("requests.filter.model"), items: modelItems.value, active: (props.query.models?.length ?? 0) > 0, value: (props.query.models ?? []).map((model) => model.slice(model.indexOf("/") + 1)).join(separator.value) || t("requests.filter.all")},
    {id: "time", label: t("requests.time.label"), items: timeItems.value, active: timePreset.value !== "all", value: t(`requests.time.${timePreset.value}`)},
]);

function toggle<T>(values: readonly T[] | undefined, value: T): T[] {
    const current = values ?? [];
    return current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
}

function onSelect(id: string): void {
    const [kind, value = ""] = id.split(/:(.*)/su);
    if (kind === "session") emit("update:query", {...props.query, sessions: value === "" ? [] : [value]});
    else if (kind === "purpose") emit("update:query", {...props.query, purposes: toggle(props.query.purposes, value as RequestTracePurpose)});
    else if (kind === "status") emit("update:query", {...props.query, statuses: toggle(props.query.statuses, value as RequestTraceStatusFilter)});
    else if (kind === "model") emit("update:query", {...props.query, models: toggle(props.query.models, value)});
    else if (kind === "time") {
        timePreset.value = value as TimePreset;
        const since = sinceOf(timePreset.value);
        const {since: _since, ...rest} = props.query;
        emit("update:query", since === undefined ? rest : {...rest, since});
    }
    else if (kind === "sort") emit("update:query", {...props.query, sort: value as RequestTraceSort});
    else if (kind === "more") {
        if (value === "settings") emit("action", {type: "request.open-settings"});
        else if (value === "clear-session") confirming.value = "session";
        else if (value === "clear-all") confirming.value = "all";
    }
}

function confirmClear(): void {
    if (confirming.value !== null) emit("action", {type: "request.clear", scope: confirming.value});
    confirming.value = null;
}

const rootRef = ref<HTMLElement | null>(null);

/**
 * 页面里的键：焦点在本页时 Ctrl/⌘+F 聚焦查找框（不抢浏览器在别处的查找）；Alt+上下选新一次、旧一次；查找框里 Esc 清掉查找词。
 * 监听挂在组件根上，焦点不在本页时不响应。
 */
function onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        rootRef.value?.querySelector<HTMLInputElement>("[data-request-search] input")?.focus();
        return;
    }
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const target = event.key === "ArrowUp" ? newer.value : older.value;
        if (target !== null) {
            event.preventDefault();
            onAction({type: "request.select", id: target});
        }
        return;
    }
    if (event.key === "Escape" && (event.target as HTMLElement | null)?.closest("[data-request-search]") !== null && draft.value !== "") {
        event.preventDefault();
        draft.value = "";
        if (timer !== null) clearTimeout(timer);
        timer = null;
        emit("update:search", "");
    }
}

function clearFilters(): void {
    timePreset.value = "all";
    emit("update:query", {...(props.query.sort === undefined ? {} : {sort: props.query.sort})});
}
</script>

<template>
    <div ref="rootRef" class="art" :data-view="view" @keydown="onKeydown">
        <header class="art__toolbar">
            <div class="art__row">
                <Input class="art__search" size="sm" type="search" icon-class="i-lucide-search" clearable :model-value="draft" :placeholder="t('requests.search.placeholder')" :aria-label="t('requests.search.placeholder')" data-request-search @update:model-value="onDraft" @compositionstart="onCompositionStart" @compositionend="onCompositionEnd" />
                <DropdownMenu :items="sortItems" align="end" @select="onSelect">
                    <IconButton size="sm" icon-class="i-lucide-arrow-down-wide-narrow" :aria-label="`${t('requests.sort.label')}: ${t(`requests.sort.${query.sort ?? 'time'}`)}`" :title="`${t('requests.sort.label')}: ${t(`requests.sort.${query.sort ?? 'time'}`)}`" data-request-sort />
                </DropdownMenu>
                <DropdownMenu :items="moreItems" align="end" @select="onSelect">
                    <IconButton size="sm" icon-class="i-lucide-ellipsis" :aria-label="t('requests.more.label')" :title="t('requests.more.label')" data-request-more />
                </DropdownMenu>
            </div>
            <div class="art__chips">
                <DropdownMenu v-for="chip in chips" :key="chip.id" :items="chip.items" @select="onSelect">
                    <button type="button" class="art__chip" :data-active="chip.active || undefined" :data-request-filter="chip.id">
                        <span class="art__chip-label">{{ chip.label }}</span>
                        <span class="art__chip-value" :title="chip.value">{{ chip.value }}</span>
                        <span class="i-lucide-chevron-down art__chip-icon" aria-hidden="true"></span>
                    </button>
                </DropdownMenu>
                <Button v-if="filtered" variant="ghost" size="sm" icon-class="i-lucide-x" data-request-clear-filters @click="clearFilters">{{ t("requests.filter.clear") }}</Button>
            </div>
        </header>

        <AlertDialog :open="confirming !== null" :title="confirming === 'session' ? t('requests.more.confirmSession') : t('requests.more.confirmAll')" :description="t('requests.more.confirmDescription')" :confirm-label="t('requests.more.confirm')" tone="danger" @update:open="(open: boolean) => { if (!open) confirming = null; }" @confirm="confirmClear" />

        <div class="art__split">
            <AgentRequestList
                class="art__list"
                :rows="rows"
                :list="list"
                :totals="totals"
                :selected="selected"
                :single-session="singleSession"
                :grouped="(query.sort ?? 'time') === 'time'"
                :filtered="filtered"
                :excluded="excluded"
                :pending="pending"
                :search="search"
                :search-state="searchState"
                :enabled="enabled"
                :now="now"
                @action="onAction"
            />
            <AgentRequestDetail
                class="art__detail"
                :detail="detail"
                :contents="contents"
                :payload="payload"
                :compare="compare"
                :compare-candidates="compareCandidates"
                :search="search"
                :hits="hits"
                :newer="newer"
                :older="older"
                :narrow="view === 'detail'"
                :now="now"
                @action="onAction"
                @back="view = 'list'"
            />
        </div>
    </div>
</template>

<style scoped>
.art {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    container-type: inline-size;
    color: var(--text-main);
    font-family: var(--font-ui);
}
.art__toolbar {
    flex: none;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--divider);
}
/* 只有一行控件高的条：放不下时换行，不做横向滚动（滚动容器会裁掉按钮的焦点环）。 */
.art__row {
    display: flex;
    gap: var(--space-1);
    align-items: center;
    margin-bottom: var(--space-2);
}
.art__search {
    flex: 1 1 auto;
    min-width: 0;
}
.art__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
}
.art__chip {
    display: inline-flex;
    flex: none;
    gap: 4px;
    align-items: center;
    max-width: 240px;
    height: 24px;
    padding-inline: 8px 6px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
}
.art__chip[data-active] {
    border-color: var(--border-accent);
    background: var(--accent-bg);
    color: var(--accent-text);
}
.art__chip-label {
    color: var(--text-muted);
}
.art__chip[data-active] .art__chip-label {
    color: inherit;
}
.art__chip-value {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.art__chip-icon {
    flex: none;
    width: 12px;
    height: 12px;
}
.art__split {
    display: grid;
    flex: 1 1 auto;
    grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
    min-height: 0;
}
.art__list {
    border-right: 1px solid var(--divider);
}
.art__detail :deep(.ard__back) {
    display: none;
}
/* 放不下两栏（列表 300 加详情 460）时只显示一栏：选中进详情，详情顶上回到列表。 */
@container (max-width: 759px) {
    .art__split {
        grid-template-columns: minmax(0, 1fr);
    }
    .art__list {
        border-right: 0;
    }
    .art[data-view="detail"] .art__list,
    .art[data-view="list"] .art__detail {
        display: none;
    }
    .art__detail :deep(.ard__back) {
        display: block;
    }
}
</style>
