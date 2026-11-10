<script setup lang="ts">
/**
 * 会话面板（docs/specs/agent/conversation.md 输出 2、3）：同一个组件放在点标题弹出的下拉和左栏视图里。纯受控：搜索、范围、过滤都发给宿主，
 * 宿主把筛好的行给回来。今天、昨天、更早按 `now` 分组：宿主要定期更新它，否则过了午夜分组不会变。
 */
import {computed, ref, watch} from "vue";
import {Badge, DropdownMenu, IconButton, Input} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";

import {formatListTime} from "../format";
import {autoExpanded, nestSessions} from "../session-nesting";
import type {SessionNode} from "../session-nesting";
import type {AgentLocale, AgentSessionListItem, AgentViewAction, SessionPanelFilter} from "../types";
import AgentSessionChildRows from "./AgentSessionChildRows.vue";
import {provideAgentText} from "./text";

const props = withDefaults(defineProps<{
    items: readonly AgentSessionListItem[];
    selectedId: string | null;
    now: number;
    query?: string;
    /** 有作品时能在当前作品与全部之间切；没打开作品时不给，就没有这个按钮。 */
    scope?: {value: "project" | "all"} | null;
    /** 过滤菜单的 Profile 一组。 */
    profiles?: readonly SessionPanelFilter[];
    showArchived?: boolean;
    loading?: boolean;
    error?: string | null;
    locale?: AgentLocale;
    /**
     * 哪些会话的子会话展开着（true）或被收起（false），没有的跟随自动规则。受控：宿主持有，面板关掉再打开还在；不给时面板自己记。
     */
    expanded?: Readonly<Record<string, boolean>>;
    /** 要展开到能看见的会话（例如刚派出的子会话）：它们的祖先自动展开一次。 */
    expandFor?: readonly string[];
}>(), {
    query: "",
    scope: null,
    profiles: () => [],
    showArchived: false,
    loading: false,
    error: null,
    locale: undefined,
    expanded: undefined,
    expandFor: () => [],
});

const emit = defineEmits<{
    action: [action: AgentViewAction];
    "update:query": [query: string];
    "update:scope": [scope: "project" | "all"];
    "toggle-profile": [id: string];
    "update:show-archived": [show: boolean];
    "update:expanded": [expanded: Record<string, boolean>];
}>();

const {t, locale} = provideAgentText(() => props.locale);

const DAY = 86_400_000;
function startOfDay(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

/** 子会话跟父会话在同一个日期组：按顶层的会话分组（宿主让父会话的时间取自身与后代中最新的）。 */
const groups = computed(() => {
    const today = startOfDay(props.now);
    const buckets: {key: "today" | "yesterday" | "earlier"; label: string; rows: SessionNode[]}[] = [
        {key: "today", label: t("panel.today"), rows: []},
        {key: "yesterday", label: t("panel.yesterday"), rows: []},
        {key: "earlier", label: t("panel.earlier"), rows: []},
    ];
    for (const node of nestSessions(props.items)) {
        const bucket = node.item.updatedAt >= today ? 0 : node.item.updatedAt >= today - DAY ? 1 : 2;
        buckets[bucket]!.rows.push(node);
    }
    return buckets.filter((bucket) => bucket.rows.length > 0);
});

// ─── 子会话的展开 ───────────────────────────────────────────────────────

const local = ref<Record<string, boolean>>({});
const record = computed(() => props.expanded ?? local.value);

function setRecord(next: Record<string, boolean>): void {
    local.value = next;
    emit("update:expanded", next);
}

function toggle(id: string): void {
    setRecord({...record.value, [id]: record.value[id] !== true});
}

// 选中会话的祖先、要露出的会话的祖先、有子代理在等你处理的：这些输入变了时展开一次，之后用户手动的优先。
const autoKey = computed(() => [...autoExpanded(props.items, props.selectedId, props.expandFor)].sort().join(" "));
watch(autoKey, (key) => {
    if (key === "") return;
    const next = {...record.value};
    let changed = false;
    for (const id of key.split(" ")) {
        if (next[id] === true) continue;
        next[id] = true;
        changed = true;
    }
    if (changed) setRecord(next);
}, {immediate: true});

const countOf = (node: SessionNode): number => node.item.childCount ?? node.children.length;

const STATE_KEYS = {running: "panel.state.running", waiting: "panel.state.waiting", interrupted: "panel.state.interrupted", error: "panel.state.error"} as const;

const scopeLabel = computed(() => (props.scope?.value === "all" ? t("panel.scopeAll") : t("panel.scopeProject")));
/** 选了的过滤条件。只显示成过滤按钮上的条数：有没有选，面板都不多占一行，下面的列表不动。 */
const activeFilters = computed(() => [
    ...props.profiles.filter((profile) => profile.active).map((profile) => `profile:${profile.id}`),
    ...(props.showArchived ? ["archived"] : []),
]);

const filterItems = computed<DropdownMenuItemData[]>(() => [
    ...props.profiles.map((profile) => ({id: `profile:${profile.id}`, label: profile.label, ...(profile.icon === undefined ? {} : {iconClass: profile.icon}), type: "checkbox" as const, checked: profile.active})),
    ...(props.profiles.length === 0 ? [] : [{id: "separator", label: "", separator: true}]),
    {id: "archived", label: t("panel.showArchived"), type: "checkbox" as const, checked: props.showArchived},
    ...(activeFilters.value.length === 0 ? [] : [{id: "separator-clear", label: "", separator: true}, {id: "clear", label: t("panel.clearFilters")}]),
]);
function onFilter(id: string): void {
    if (id === "clear") {
        for (const filter of activeFilters.value) onFilter(filter);
        return;
    }
    if (id === "archived") emit("update:show-archived", !props.showArchived);
    else if (id.startsWith("profile:")) emit("toggle-profile", id.slice("profile:".length));
}

function rowMenu(item: AgentSessionListItem): DropdownMenuItemData[] {
    return [
        {id: "rename", label: t("panel.rename"), iconClass: "i-lucide-pencil"},
        item.archived === true
            ? {id: "restore", label: t("panel.restore"), iconClass: "i-lucide-archive-restore"}
            : {id: "archive", label: t("panel.archive"), iconClass: "i-lucide-archive"},
    ];
}

function onRowMenu(item: AgentSessionListItem, id: string): void {
    if (id === "rename") emit("action", {type: "session.rename", sessionId: item.id, title: item.title});
    else if (id === "archive") emit("action", {type: "session.archive", sessionId: item.id});
    else if (id === "restore") emit("action", {type: "session.restore", sessionId: item.id});
}
</script>

<template>
    <div class="acv-panel" data-agent-session-panel>
        <div class="acv-panel__search">
            <Input :model-value="props.query" size="sm" class="acv-panel__input" :placeholder="t('panel.search')" :aria-label="t('panel.search')" data-panel-search @update:model-value="emit('update:query', String($event))" />
            <DropdownMenu
                v-if="props.scope !== null"
                :items="[{id: 'project', label: t('panel.scopeProject'), type: 'radio', group: 'scope', checked: props.scope.value === 'project'}, {id: 'all', label: t('panel.scopeAll'), type: 'radio', group: 'scope', checked: props.scope.value === 'all'}]"
                align="end"
                @select="emit('update:scope', $event as 'project' | 'all')"
            >
                <button type="button" class="acv-panel__scope" data-panel-scope>{{ scopeLabel }}<span class="i-lucide-chevron-down" aria-hidden="true" /></button>
            </DropdownMenu>
            <DropdownMenu :items="filterItems" align="end" @select="onFilter">
                <span class="acv-panel__filter">
                    <IconButton icon-class="i-lucide-list-filter" size="sm" :class="{'acv-panel__filter-on': activeFilters.length > 0}" :title="t('panel.filter')" :aria-label="t('panel.filter')" data-panel-filter />
                    <span v-if="activeFilters.length > 0" class="acv-panel__filter-count" data-panel-filter-count>{{ activeFilters.length }}</span>
                </span>
            </DropdownMenu>
            <IconButton icon-class="i-lucide-plus" size="sm" :title="t('panel.create')" :aria-label="t('panel.create')" data-panel-create @click="emit('action', {type: 'session.create'})" />
        </div>
        <div class="acv-panel__list">
            <p v-if="props.error !== null" class="acv-panel__empty" role="alert">{{ props.error }}</p>
            <p v-if="props.error === null && props.items.length === 0" class="acv-panel__empty">{{ props.loading ? t("panel.loading") : t("panel.empty") }}</p>
            <template v-for="group in groups" :key="group.key">
                <div class="acv-panel__group">{{ group.label }}</div>
                <template v-for="{item, children} in group.rows" :key="item.id">
                <div class="acv-panel__row" :class="{'is-current': item.id === props.selectedId, 'is-archived': item.archived === true, 'is-dimmed': item.dimmed === true, 'has-children': children.length > 0}">
                    <button type="button" class="acv-panel__open" :aria-current="item.id === props.selectedId ? 'true' : undefined" data-panel-row @click="emit('action', {type: 'session.select', sessionId: item.id})">
                        <span :class="[item.icon ?? 'i-lucide-bot', 'acv-panel__icon']" :title="item.iconTitle" aria-hidden="true" />
                        <span class="acv-panel__body">
                            <span class="acv-panel__line">
                                <span class="acv-panel__title">{{ item.title || t("header.untitled") }}</span>
                                <span class="acv-panel__time">{{ formatListTime(item.updatedAt, props.now, locale) }}</span>
                            </span>
                            <span class="acv-panel__line acv-panel__line--second">
                                <span class="acv-panel__description">{{ item.description }}</span>
                                <Badge v-if="item.archived === true" size="sm" tone="neutral" variant="soft">{{ t("panel.archivedTag") }}</Badge>
                                <span v-if="item.status !== 'idle'" class="acv-panel__state" :data-state="item.status">{{ t(STATE_KEYS[item.status]) }}</span>
                                <span v-else-if="item.childWaiting === true && children.length > 0 && record[item.id] !== true" class="acv-panel__state" data-state="child-waiting">{{ t("panel.childWaiting") }}</span>
                            </span>
                            <span v-if="item.dimmed === true" class="sr-only">{{ t("panel.ancestor") }}</span>
                        </span>
                    </button>
                    <!-- 与打开会话的按钮并列：折叠子会话不打开会话 -->
                    <button
                        v-if="children.length > 0"
                        type="button"
                        class="acv-panel__kids"
                        :aria-expanded="record[item.id] === true"
                        :aria-controls="`acv-children-${item.id}`"
                        data-panel-children
                        @click="toggle(item.id)"
                    >
                        {{ t("panel.children", {count: countOf({item, children})}) }}<span :class="record[item.id] === true ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" aria-hidden="true" />
                    </button>
                    <span class="acv-panel__more">
                        <DropdownMenu :items="rowMenu(item)" align="end" @select="onRowMenu(item, $event)">
                            <IconButton icon-class="i-lucide-ellipsis" size="xs" :title="t('panel.more')" :aria-label="t('panel.more')" data-panel-more />
                        </DropdownMenu>
                    </span>
                </div>
                <AgentSessionChildRows
                    v-if="children.length > 0 && record[item.id] === true"
                    :list-id="`acv-children-${item.id}`"
                    :nodes="children"
                    :selected-id="props.selectedId"
                    :expanded="record"
                    :label="item.title || t('header.untitled')"
                    @select="emit('action', {type: 'session.select', sessionId: $event})"
                    @toggle="toggle"
                />
                </template>
            </template>
        </div>
    </div>
</template>

<style scoped>
.acv-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-size: var(--text-sm);
}

.acv-panel__search {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    padding: 8px 8px 4px;
}

.acv-panel__input {
    flex: 1;
    min-width: 0;
}

.acv-panel__scope {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
    height: 26px;
    padding: 0 4px 0 8px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
}

.acv-panel__scope:hover {
    background: var(--bg-hover);
}

.acv-panel__filter-on {
    color: var(--accent-text);
}

.acv-panel__filter {
    position: relative;
    display: inline-flex;
}

.acv-panel__filter-count {
    position: absolute;
    top: -3px;
    right: -3px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--accent-main);
    color: var(--text-inverse);
    font-size: var(--text-2xs);
    line-height: 14px;
    text-align: center;
    pointer-events: none;
}

.acv-panel__list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px;
}

.acv-panel__empty {
    margin: 0;
    padding: 16px 8px;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-align: center;
}

.acv-panel__group {
    padding: 6px 8px 2px;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-panel__row {
    position: relative;
    border-radius: 6px;
}

.acv-panel__row:hover {
    background: var(--bg-hover);
}

.acv-panel__row.is-current {
    background: var(--accent-bg);
}

.acv-panel__open {
    display: flex;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.acv-panel__row.is-archived .acv-panel__title,
.acv-panel__row.is-dimmed .acv-panel__title {
    color: var(--text-muted);
}

/* “N 个子代理”在第二行右边：第二行给它让出位置，左边不留空槽。 */
.acv-panel__row.has-children .acv-panel__line--second {
    padding-right: 7em;
}

.acv-panel__kids {
    position: absolute;
    right: 8px;
    bottom: 6px;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 6.5em;
    padding: 0 4px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--text-2xs);
    white-space: nowrap;
    cursor: pointer;
}

.acv-panel__kids:hover {
    background: var(--bg-hover);
}

.acv-panel__state[data-state="child-waiting"] {
    color: var(--status-warning);
}

.acv-panel__icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    margin-top: 2px;
    color: var(--text-secondary);
}

.acv-panel__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
}

.acv-panel__line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}

.acv-panel__line--second {
    min-height: 16px;
    font-size: var(--text-xs);
}

.acv-panel__title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-panel__time {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: var(--text-2xs);
}

.acv-panel__description {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.acv-panel__state {
    flex-shrink: 0;
    color: var(--text-secondary);
    font-size: var(--text-2xs);
}

.acv-panel__state[data-state="running"],
.acv-panel__state[data-state="waiting"] {
    color: var(--accent-text);
}

.acv-panel__state[data-state="error"] {
    color: var(--status-danger);
}

/* 悬停才出现，占时间的位置；键盘走到它时也要看得见。 */
.acv-panel__more {
    position: absolute;
    top: 4px;
    right: 4px;
    opacity: 0;
}

.acv-panel__row:hover .acv-panel__more,
.acv-panel__row:focus-within .acv-panel__more {
    opacity: 1;
}

.acv-panel__row:hover .acv-panel__time,
.acv-panel__row:focus-within .acv-panel__time {
    visibility: hidden;
}
</style>
