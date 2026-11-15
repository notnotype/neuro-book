<script setup lang="ts">
/**
 * 模型请求查看器（docs/specs/agent/request-trace.md 的“查看器”）：常驻的筛选条，左边请求列表，右边选中那次请求的详情。
 * 数据都由宿主给（列表、详情、内容与原始请求体），筛选受控、改了发 `update:query`，其余操作经 `action` 交回；查看器不取数。
 * 宽到放不下两栏时列表与详情来回切换（Spec 输出 23），切换状态是组件自己的。
 */
import {computed, ref, watch} from "vue";
import {Button, DropdownMenu} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";

import type {RequestTraceAction, RequestTraceContentState, RequestTraceDetailState, RequestTraceFacets, RequestTraceListState, RequestTracePayloadView, RequestTracePurpose, RequestTraceQuery, RequestTraceRow, RequestTraceStatusFilter, RequestTraceTotals} from "../../request-trace";
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
    /** 记录开着；关着且没有记录时空状态写“没有在记录”与“打开记录”。 */
    enabled: boolean;
    /** 宿主给的当前时间：进行中的请求写已经等了多久。 */
    now: number;
    /** 没有宿主注入翻译端口时的界面语言，缺省 zh-CN。 */
    locale?: AgentLocale;
}>(), {pending: 0, locale: undefined});

const emit = defineEmits<{"update:query": [query: RequestTraceQuery]; action: [action: RequestTraceAction]}>();

const {t} = provideAgentText(() => props.locale);

/** 窄时显示哪一栏；宽时两栏都在，这个值不起作用。 */
const view = ref<"list" | "detail">(props.selected === null ? "list" : "detail");

function onAction(action: RequestTraceAction): void {
    if (action.type === "request.select") view.value = "detail";
    emit("action", action);
}

// 选中被宿主清掉（例如清空了记录）时回到列表。
watch(() => props.selected, (selected) => {
    if (selected === null) view.value = "list";
});

const index = computed(() => props.rows.findIndex((row) => row.id === props.selected));
const newer = computed(() => (index.value > 0 ? props.rows[index.value - 1]!.id : null));
const older = computed(() => (index.value >= 0 && index.value < props.rows.length - 1 ? props.rows[index.value + 1]!.id : null));

const singleSession = computed(() => (props.query.sessions?.length ?? 0) === 1);
const filtered = computed(() => (props.query.sessions?.length ?? 0) + (props.query.purposes?.length ?? 0) + (props.query.statuses?.length ?? 0) + (props.query.models?.length ?? 0) > 0 || props.query.since !== undefined);
const excluded = computed(() => props.selected !== null && index.value < 0 && props.detail.state === "ready");

const PURPOSES: readonly RequestTracePurpose[] = ["turn", "compaction", "approval", "background"];
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

const chips = computed(() => [
    {id: "session", label: t("requests.filter.session"), items: sessionItems.value, active: (props.query.sessions?.length ?? 0) > 0, value: singleSession.value ? sessionLabel(props.query.sessions![0]!) : (props.query.sessions?.length ?? 0) > 1 ? String(props.query.sessions!.length) : t("requests.filter.all")},
    {id: "purpose", label: t("requests.filter.purpose"), items: purposeItems.value, active: (props.query.purposes?.length ?? 0) > 0, value: (props.query.purposes ?? []).map((purpose) => t(`requests.purpose.${purpose}`)).join(separator.value) || t("requests.filter.all")},
    {id: "status", label: t("requests.filter.status"), items: statusItems.value, active: (props.query.statuses?.length ?? 0) > 0, value: STATUSES.filter((status) => props.query.statuses?.includes(status.value) === true).map((status) => t(`requests.status.${status.key}`)).join(separator.value) || t("requests.filter.all")},
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
}

function clearFilters(): void {
    emit("update:query", {...(props.query.sort === undefined ? {} : {sort: props.query.sort})});
}
</script>

<template>
    <div class="art" :data-view="view">
        <header class="art__toolbar">
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
                :enabled="enabled"
                :now="now"
                @action="onAction"
            />
            <AgentRequestDetail
                class="art__detail"
                :detail="detail"
                :contents="contents"
                :payload="payload"
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
