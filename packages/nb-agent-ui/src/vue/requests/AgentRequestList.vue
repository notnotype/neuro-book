<script setup lang="ts">
/**
 * 模型请求的列表（docs/specs/agent/request-trace.md 输出 14 到 16）：列表头的合计、按会话的轮分组的两行条目、滚到底接着取。
 * 数据都由宿主给，选中受控；行的版式见同名 `.md`。
 */
import {computed, nextTick, ref, watch} from "vue";
import {Badge, Button, EmptyState, Spinner} from "@notnotype/nb-ui/components";

import {formatClock} from "../../format";
import {cacheHitRate, formatCost, formatDuration, formatTokens, groupRequests, promptTokens} from "../../request-trace";
import type {RequestGroup, RequestTraceAction, RequestTraceListState, RequestTracePurpose, RequestTraceRow, RequestTraceSearchState, RequestTraceStatus, RequestTraceTotals} from "../../request-trace";
import {useAgentText} from "../text";

const props = defineProps<{
    rows: readonly RequestTraceRow[];
    list: RequestTraceListState;
    totals: RequestTraceTotals;
    selected: string | null;
    /** 只看一个会话时组头不写会话标题。 */
    singleSession: boolean;
    /** 按时间排时分组，按别的排时一条一行、不分组（Spec 输出 16）。 */
    grouped: boolean;
    /** 有筛选条件：空列表写“没有符合筛选的请求”。 */
    filtered: boolean;
    /** 选中的那条被筛掉了，详情照样显示，列表头写明（Spec 输出 15）。 */
    excluded: boolean;
    pending: number;
    /** 查找词；不为空时列表是查找交回的行，第二行换写第一处命中。 */
    search: string;
    searchState: RequestTraceSearchState;
    enabled: boolean;
    now: number;
}>();

const emit = defineEmits<{action: [action: RequestTraceAction]}>();

const {t, locale} = useAgentText();

const PURPOSE_TONE: Readonly<Record<RequestTracePurpose, "neutral" | "accent" | "warning" | "success">> = {turn: "neutral", compaction: "accent", approval: "warning", background: "success"};
const STATUS_ICON: Readonly<Record<Exclude<RequestTraceStatus, "running">, string>> = {ok: "i-lucide-circle-check", error: "i-lucide-circle-x", aborted: "i-lucide-circle-slash", interrupted: "i-lucide-circle-dashed"};

const groups = computed<RequestGroup[]>(() => (props.grouped
    ? groupRequests(props.rows)
    : props.rows.map((row) => ({key: row.id, session: row.session, background: false, turn: null, startedAt: row.startedAt, rows: [row]}))));

const percent = (rate: number | null): string => (rate === null ? "—" : `${String(Math.round(rate * 100))}%`);

const totalsText = computed(() => {
    const {input, cacheRead, cost} = props.totals;
    return t("requests.list.totals", {input: formatTokens(input), cache: percent(input === 0 ? null : cacheRead / input), cost: formatCost(cost) ?? "—"});
});

/** 第一处命中在哪：第几条消息、系统提示词、工具或错误。 */
function hitWhere(row: RequestTraceRow): string {
    const first = row.match?.first;
    if (first === undefined) return "";
    return first.page === "messages" ? t("requests.hit.message", {index: first.item + 1}) : t(`requests.hit.${first.page}`);
}

function groupLabel(group: RequestGroup): string {
    if (group.background) return t("requests.group.background");
    return group.turn === null ? t("requests.group.outside") : t("requests.group.turn", {index: group.turn.index});
}

function shortModel(model: string): string {
    return model.slice(model.indexOf("/") + 1);
}

function duration(row: RequestTraceRow): string {
    return formatDuration((row.endedAt ?? props.now) - row.startedAt);
}

function onKeydown(event: KeyboardEvent): void {
    // 带修饰键的上下（Alt+上下选新一次、旧一次）归查看器根上处理。
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = props.rows.findIndex((row) => row.id === props.selected);
    const next = props.rows[index < 0 ? 0 : event.key === "ArrowDown" ? Math.min(props.rows.length - 1, index + 1) : Math.max(0, index - 1)];
    if (next !== undefined && next.id !== props.selected) emit("action", {type: "request.select", id: next.id});
}

/** 离底部不到这么多像素就接着取：一页 100 条，提前取，滚动不必停下来等。 */
const LOAD_AHEAD = 240;

/** 列表在不在顶上：变了才发，宿主据此决定新请求插不插进来（决定 14）。列表重建时（行清空再来）新的滚动区在顶上。 */
let atTop = true;
watch(() => props.rows.length === 0, (empty) => {
    if (empty) atTop = true;
});

// 选中换了（键盘上下、宿主选中）时把那一行滚进视野：列表用 `aria-activedescendant`，浏览器不会自己滚。
const scrollRef = ref<HTMLElement | null>(null);
watch(() => props.selected, (selected) => {
    if (selected !== null) void nextTick(() => scrollRef.value?.querySelector(`[data-request-row="${selected}"]`)?.scrollIntoView({block: "nearest"}));
});

function onScroll(event: Event): void {
    const element = event.currentTarget as HTMLElement;
    const top = element.scrollTop <= 4;
    if (top !== atTop) {
        atTop = top;
        emit("action", {type: "request.list-at-top", atTop: top});
    }
    if (props.list.more && props.list.state === "ready" && element.scrollTop + element.clientHeight >= element.scrollHeight - LOAD_AHEAD) emit("action", {type: "request.more"});
}
</script>

<template>
    <section class="arl" :aria-label="t('requests.list.label')">
        <div v-if="search !== ''" class="arl__head" data-request-search-head>
            <!-- 从头查的时候还没有结果，不写“找到 0 次”。 -->
            <span v-if="rows.length > 0 || searchState.state !== 'searching'" class="arl__count">{{ t("requests.search.found", {count: rows.length}) }}</span>
            <span v-if="searchState.state === 'searching'" class="arl__totals" role="status">{{ t("requests.search.searching") }}</span>
            <span v-else-if="searchState.state === 'error' && rows.length > 0" class="arl__partial" role="alert">{{ t("requests.search.error") }}<button v-if="searchState.truncated" type="button" class="arl__link" data-request-search-more @click="emit('action', {type: 'request.search-more'})">{{ t("requests.search.more") }}</button></span>
            <span v-else-if="searchState.truncated" class="arl__partial">{{ t("requests.search.partial") }}<button type="button" class="arl__link" data-request-search-more @click="emit('action', {type: 'request.search-more'})">{{ t("requests.search.more") }}</button></span>
        </div>
        <div v-else class="arl__head">
            <span class="arl__count">{{ t("requests.list.count", {count: totals.count}) }}</span>
            <span class="arl__totals" :title="totalsText">{{ totalsText }}</span>
        </div>
        <div v-if="excluded" class="arl__note">{{ t("requests.list.excluded") }}</div>
        <button v-if="pending > 0" type="button" class="arl__pending" data-request-pending @click="emit('action', {type: 'request.refresh'})">
            <span class="i-lucide-arrow-up" aria-hidden="true"></span>{{ t("requests.list.pending", {count: pending}) }}
        </button>

        <div v-if="rows.length === 0" class="arl__state" :role="list.state === 'loading' ? 'status' : list.state === 'error' ? 'alert' : undefined" :aria-busy="list.state === 'loading' || undefined">
            <EmptyState v-if="list.state === 'loading'" :title="t('requests.list.loading')">
                <template #icon><Spinner size="md" /></template>
            </EmptyState>
            <EmptyState v-else-if="list.state === 'error'" icon-class="i-lucide-circle-alert" :title="t('requests.list.error')">
                <template #action><Button size="sm" variant="secondary" @click="emit('action', {type: 'request.refresh'})">{{ t("requests.list.retry") }}</Button></template>
            </EmptyState>
            <EmptyState v-else-if="filtered" icon-class="i-lucide-list-filter" :title="t('requests.list.noMatch')" />
            <EmptyState v-else-if="enabled" icon-class="i-lucide-activity" :title="t('requests.list.empty')" />
            <EmptyState v-else icon-class="i-lucide-circle-pause" :title="t('requests.list.disabled')">
                <template #action><Button variant="primary" size="sm" @click="emit('action', {type: 'request.open-settings'})">{{ t("requests.list.enable") }}</Button></template>
            </EmptyState>
        </div>

        <div v-else ref="scrollRef" class="arl__scroll nb-ui-scrollbar-thin nb-ui-scrollbar-stable" role="listbox" tabindex="0" :aria-label="t('requests.list.label')" :aria-activedescendant="selected === null ? undefined : `arl-${selected}`" @keydown="onKeydown" @scroll.passive="onScroll">
            <div v-for="group in groups" :key="group.key" class="arl__group" role="group" :aria-label="grouped ? groupLabel(group) : undefined">
                <div v-if="grouped" class="arl__group-head">
                    <span v-if="!singleSession" class="arl__group-session" :title="group.title ?? t('requests.filter.untitled')">{{ group.title ?? t("requests.filter.untitled") }}</span>
                    <span class="arl__group-turn">{{ groupLabel(group) }}</span>
                    <span v-if="group.turn?.input" class="arl__group-input" :title="group.turn.input">“{{ group.turn.input }}”</span>
                    <span class="arl__group-time">{{ formatClock(group.startedAt, locale) }}</span>
                </div>
                <div
                    v-for="row in group.rows"
                    :id="`arl-${row.id}`"
                    :key="row.id"
                    class="arl__row"
                    role="option"
                    :aria-selected="row.id === selected"
                    :data-status="row.status"
                    :data-request-row="row.id"
                    @click="emit('action', {type: 'request.select', id: row.id})"
                >
                    <!-- 状态读一遍：转圈对辅助技术隐藏，外层写状态名。 -->
                    <span class="arl__status" role="img" :aria-label="t(`requests.status.${row.status}`)">
                        <Spinner v-if="row.status === 'running'" size="sm" aria-hidden="true" />
                        <span v-else :class="STATUS_ICON[row.status]" aria-hidden="true"></span>
                    </span>
                    <span class="arl__line1">
                        <Badge size="sm" variant="soft" :tone="PURPOSE_TONE[row.purpose]" class="arl__purpose">{{ t(`requests.purpose.${row.purpose}`) }}</Badge>
                        <span class="arl__model" :title="row.model">{{ shortModel(row.model) }}</span>
                        <span class="arl__flags">
                            <Badge v-if="row.resend !== undefined" size="sm" variant="outline" :title="t('requests.row.resend', {count: row.resend})">×{{ row.resend }}</Badge>
                            <span v-if="row.toolsChanged" class="i-lucide-wrench arl__flag" :title="t('requests.row.toolsChanged')" :aria-label="t('requests.row.toolsChanged')"></span>
                        </span>
                        <span class="arl__number">#{{ row.request }}</span>
                        <span class="arl__time">{{ formatClock(row.startedAt, locale) }}</span>
                    </span>
                    <span v-if="row.match !== undefined" class="arl__line2 arl__snippet" :title="`${row.match.first.before}${row.match.first.text}${row.match.first.after}`">
                        <span class="arl__where">{{ hitWhere(row) }}</span>
                        <span class="arl__snippet-text">{{ row.match.first.before }}<mark>{{ row.match.first.text }}</mark>{{ row.match.first.after }}</span>
                        <span v-if="row.match.count > 1" class="arl__more-hits">{{ t("requests.hit.more", {rest: row.match.count - 1}) }}</span>
                    </span>
                    <span v-else-if="row.status === 'running'" class="arl__line2">
                        <span>{{ t("requests.row.waited", {duration: duration(row)}) }}</span>
                    </span>
                    <span v-else-if="row.status === 'error'" class="arl__line2 arl__line2--error">
                        <span>{{ [row.http === undefined ? null : t("requests.row.http", {status: row.http}), row.error?.kind].filter(Boolean).join(" · ") }}</span>
                        <span>{{ duration(row) }}</span>
                    </span>
                    <span v-else class="arl__line2">
                        <span>{{ t("requests.row.input", {value: row.usage === undefined ? "—" : formatTokens(promptTokens(row.usage))}) }}</span>
                        <span>{{ t("requests.row.output", {value: row.usage === undefined ? "—" : formatTokens(row.usage.output)}) }}</span>
                        <span :data-miss="row.status === 'ok' && row.usage?.cacheRead === 0 || undefined" :title="row.status === 'ok' && row.usage?.cacheRead === 0 ? t('requests.row.cacheMiss') : undefined">{{ t("requests.row.cache", {value: percent(cacheHitRate(row.usage))}) }}</span>
                        <span>{{ duration(row) }}</span>
                        <span>{{ formatCost(row.usage?.cost) ?? "—" }}</span>
                    </span>
                </div>
            </div>
            <div v-if="list.more" class="arl__more">
                <Spinner v-if="list.state === 'loading'" size="sm" />
                <Button v-else size="sm" variant="ghost" @click="emit('action', {type: 'request.more'})">{{ t("requests.list.more") }}</Button>
            </div>
        </div>
    </section>
</template>

<style scoped>
.arl {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
}
.arl__head {
    display: flex;
    flex: none;
    gap: var(--space-2);
    justify-content: space-between;
    min-width: 0;
    padding: 6px var(--space-3);
    color: var(--text-secondary);
    font-size: var(--text-xs);
}
.arl__count {
    flex: none;
}
.arl__totals {
    overflow: hidden;
    min-width: 0;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.arl__note {
    flex: none;
    padding: 0 var(--space-3) 6px;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.arl__pending {
    display: inline-flex;
    flex: none;
    gap: 4px;
    align-items: center;
    justify-content: center;
    margin: 0 var(--space-2) var(--space-2);
    padding: 4px var(--space-2);
    border: 0;
    border-radius: var(--radius-control);
    background: var(--accent-bg);
    color: var(--accent-text);
    font-size: var(--text-xs);
    cursor: pointer;
}
.arl__state {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: var(--space-4);
}
.arl__scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 0 var(--space-2) var(--space-2);
    outline: none;
}
/* 列表填满它那一栏、四周没有余地：用内嵌的焦点线，外扩的光环会被栏边裁掉。 */
.arl__scroll:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent-main);
}
.arl__group + .arl__group {
    margin-top: var(--space-2);
}
.arl__group-head {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding-inline: 4px;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.arl__group-session {
    overflow: hidden;
    flex: 0 1 auto;
    max-width: 9em;
    color: var(--text-secondary);
    font-weight: var(--weight-medium);
    text-overflow: ellipsis;
    white-space: nowrap;
}
.arl__group-turn {
    flex: none;
    color: var(--text-secondary);
}
.arl__group-input {
    overflow: hidden;
    flex: 1 1 0;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.arl__group-time {
    flex: none;
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
}
.arl__row {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr);
    grid-template-rows: 20px 18px;
    column-gap: 8px;
    align-items: center;
    padding: 5px 8px;
    border-radius: var(--radius-control);
    cursor: pointer;
}
.arl__row:hover {
    background: color-mix(in srgb, var(--text-main) 5%, transparent);
}
.arl__row[aria-selected="true"] {
    background: var(--accent-bg);
}
.arl__status {
    display: inline-flex;
    grid-row: 1;
    align-items: center;
    justify-content: center;
    color: var(--status-success);
}
.arl__row[data-status="error"] .arl__status { color: var(--status-danger); }
.arl__row[data-status="aborted"] .arl__status { color: var(--status-warning); }
.arl__row[data-status="interrupted"] .arl__status,
.arl__row[data-status="running"] .arl__status { color: var(--text-muted); }
.arl__line1 {
    display: grid;
    grid-column: 2;
    grid-template-columns: auto minmax(0, 1fr) auto 3.4em 4em;
    gap: 6px;
    align-items: center;
    min-width: 0;
    font-size: var(--text-sm);
}
.arl__model {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.arl__flags {
    display: inline-flex;
    gap: 4px;
    align-items: center;
}
.arl__flag {
    width: 12px;
    height: 12px;
    color: var(--text-muted);
}
.arl__number,
.arl__time {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    text-align: right;
    white-space: nowrap;
}
.arl__line2 {
    display: flex;
    grid-column: 2;
    gap: 10px;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    white-space: nowrap;
}
.arl__partial {
    display: inline-flex;
    flex: none;
    gap: 6px;
    color: var(--text-muted);
}
.arl__link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-text);
    font-size: inherit;
    cursor: pointer;
}
.arl__snippet {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
}
.arl__where {
    flex: none;
    color: var(--text-secondary);
}
.arl__snippet-text {
    overflow: hidden;
    flex: 1 1 0;
    min-width: 0;
    text-overflow: ellipsis;
}
.arl__snippet-text mark {
    border-radius: 2px;
    background: color-mix(in srgb, var(--status-warning) 30%, transparent);
    color: var(--text-main);
}
.arl__more-hits {
    flex: none;
}
.arl__line2--error {
    color: var(--status-danger);
}
.arl__line2 [data-miss] {
    color: var(--status-warning);
}
.arl__more {
    display: flex;
    justify-content: center;
    padding: var(--space-2);
}
</style>
