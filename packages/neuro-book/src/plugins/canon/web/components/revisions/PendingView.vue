<script setup lang="ts">
/**
 * 待处理视图的骨架（同名 .md；docs/specs/canon/author-ui.md 输出 23）。受控：各组的行、展开、选中与详情都由宿主给。
 */
import {computed, nextTick, ref, watch} from "vue";

import {Button, OverlayScrollbar} from "@notnotype/nb-ui/components";

import type {PendingDetailModel, PendingGroup, PendingRow, PendingTarget} from "../../pending";
import {rovingKeydown, tabbableRow} from "../../roving";
import {useCanonText} from "../../text";
import PendingDetail from "./PendingDetail.vue";
import WorldBanners from "../entry-page/WorldBanners.vue";

export interface PendingGroupState {
    readonly rows: readonly PendingRow[];
    readonly count: number | null;
    readonly loading: boolean;
    readonly more: boolean;
}

const GROUPS: readonly PendingGroup[] = ["pending", "hints", "handled"];

const props = withDefaults(defineProps<{
    groups: Readonly<Record<PendingGroup, PendingGroupState>>;
    expanded: readonly PendingGroup[];
    selected?: {readonly group: PendingGroup; readonly key: string} | null;
    detail?: PendingDetailModel | null;
    notes?: readonly string[];
    holder?: string;
    disconnected?: boolean;
    readOnly?: string;
}>(), {selected: null, detail: null, notes: () => [], holder: "", disconnected: false, readOnly: ""});

const emit = defineEmits<{
    (event: "update:expanded", value: PendingGroup[]): void;
    (event: "select", group: PendingGroup, key: string): void;
    (event: "more", group: PendingGroup): void;
    (event: "open", target: PendingTarget): void;
    (event: "open-chapter", chapter: string): void;
    (event: "break-exclusive"): void;
    (event: "retry"): void;
}>();

const text = useCanonText();
const list = ref<HTMLElement | null>(null);
const listScroller = ref<HTMLElement | null>(null);
const detailScroller = ref<HTMLElement | null>(null);

/** 行的键在三组里各自唯一；`data-row` 带上组，焦点移动按它找行（逐个比 `dataset`，键里可能有引号，不拼选择器）。 */
const rowId = (group: PendingGroup, key: string): string => `${group}:${key}`;
const shownRows = computed(() => GROUPS.filter((group) => props.expanded.includes(group)).flatMap((group) => props.groups[group].rows.map((row) => rowId(group, row.key))));
const tabbable = computed(() => tabbableRow(shownRows.value, props.selected === null ? null : rowId(props.selected.group, props.selected.key)));
const isSelected = (group: PendingGroup, key: string): boolean => props.selected?.group === group && props.selected.key === key;

// 焦点在列表里时选中的那一行消失（世界变了、宿主换了选中）：焦点落到了页面上，移到新选中的那一行，键盘还能接着移。
let focusInList = false;
const onListFocusIn = (): void => {
    focusInList = true;
};
const onListFocusOut = (event: FocusEvent): void => {
    focusInList = event.relatedTarget instanceof Node && list.value?.contains(event.relatedTarget) === true;
};
watch(() => props.selected, async (selected) => {
    if (!focusInList || selected === null) return;
    await nextTick();
    const active = document.activeElement;
    if (active !== null && active !== document.body && list.value?.contains(active) === true) return;
    const id = rowId(selected.group, selected.key);
    [...(list.value?.querySelectorAll<HTMLElement>("[data-row]") ?? [])].find((row) => row.dataset.row === id)?.focus();
});

function toggle(group: PendingGroup): void {
    emit("update:expanded", props.expanded.includes(group) ? props.expanded.filter((item) => item !== group) : [...props.expanded, group]);
}
</script>

<template>
    <div class="pending-view" data-pending-view>
        <WorldBanners :disconnected="props.disconnected" :read-only="props.readOnly" @retry="emit('retry')" />
        <div v-if="props.holder !== ''" class="pending-view__note pending-view__busy" data-pending-busy>
            <span role="status">{{ text("pending.busy", {holder: props.holder}) }}</span>
            <Button size="sm" variant="ghost" data-pending-break @click="emit('break-exclusive')">{{ text("pending.breakExclusive.action") }}</Button>
        </div>
        <p v-for="(note, index) in props.notes" :key="index" class="pending-view__note" role="status" data-pending-incomplete>{{ note }}</p>
        <div class="pending-view__body">
            <div class="pending-view__pane pending-view__pane--list">
                <div ref="listScroller" class="pending-view__scroll">
                    <div ref="list" @keydown="rovingKeydown($event, list)" @focusin="onListFocusIn" @focusout="onListFocusOut">
                        <section v-for="group in GROUPS" :key="group" class="pending-view__group" :data-pending-group="group">
                            <button
                                type="button"
                                class="pending-view__toggle nb-ui-focus-ring-inset"
                                :aria-expanded="props.expanded.includes(group)"
                                data-pending-toggle
                                @click="toggle(group)"
                            >
                                <span :class="props.expanded.includes(group) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="pending-view__chevron" aria-hidden="true" />
                                <span>{{ text(`pending.groups.${group}`) }}</span>
                                <span v-if="props.groups[group].count !== null" class="pending-view__count" data-pending-count>{{ props.groups[group].count }}</span>
                            </button>
                            <template v-if="props.expanded.includes(group)">
                                <p v-if="props.groups[group].loading && props.groups[group].rows.length === 0" class="pending-view__state" aria-busy="true">{{ text("pending.loading") }}</p>
                                <p v-else-if="props.groups[group].rows.length === 0" class="pending-view__state" data-pending-empty>{{ text(`pending.empty.${group}`) }}</p>
                                <ul v-else class="pending-view__rows" :aria-label="text(`pending.groups.${group}`)">
                                    <li
                                        v-for="row in props.groups[group].rows"
                                        :key="row.key"
                                        class="pending-view__row nb-ui-focus-ring-inset"
                                        :data-row="rowId(group, row.key)"
                                        :tabindex="tabbable === rowId(group, row.key) ? 0 : -1"
                                        :aria-current="isSelected(group, row.key) ? 'true' : undefined"
                                        data-pending-row
                                        @focusin="emit('select', group, row.key)"
                                    >
                                        <span class="pending-view__row-text" :title="row.text" data-pending-row-text>{{ row.text }}</span>
                                        <span v-if="row.place !== ''" class="pending-view__row-place" data-pending-row-place>{{ row.place }}</span>
                                    </li>
                                </ul>
                                <div v-if="props.groups[group].more" class="pending-view__more">
                                    <Button size="sm" variant="ghost" data-pending-more @click="emit('more', group)">{{ text("pending.more") }}</Button>
                                </div>
                            </template>
                        </section>
                    </div>
                </div>
                <OverlayScrollbar :target="listScroller" />
            </div>
            <div class="pending-view__pane pending-view__pane--detail" :aria-label="text('pending.detail.label')" role="region">
                <div ref="detailScroller" class="pending-view__scroll pending-view__scroll--detail">
                    <PendingDetail v-if="props.detail !== null" :detail="props.detail" @open="emit('open', $event)" @open-chapter="emit('open-chapter', $event)" />
                    <p v-else class="pending-view__state" data-pending-no-selection>{{ text("pending.noSelection") }}</p>
                </div>
                <OverlayScrollbar :target="detailScroller" />
            </div>
        </div>
    </div>
</template>

<style scoped>
.pending-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    container-type: inline-size;
}

.pending-view__note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-1) var(--view-inset-inline, 6px);
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

.pending-view__busy {
    color: var(--status-warning);
}

/* 窄时上下排、各占一半；宽 640 像素以上左右排（输出 23）。 */
.pending-view__body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
}

.pending-view__pane {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
}

.pending-view__pane--detail {
    border-top: var(--border-w) solid var(--divider);
}

@container (min-width: 640px) {
    .pending-view__body {
        flex-direction: row;
    }

    .pending-view__pane--list {
        flex: 0 0 40%;
        min-width: 240px;
    }

    .pending-view__pane--detail {
        border-top: 0;
        border-left: var(--border-w) solid var(--divider);
    }
}

.pending-view__scroll {
    height: 100%;
    overflow-y: auto;
    padding: var(--space-1) var(--view-inset-inline, 6px) var(--space-2);
}

.pending-view__scroll--detail {
    padding-top: var(--space-2);
    padding-inline: var(--space-3);
}

.pending-view__toggle {
    display: flex;
    width: 100%;
    min-height: 28px;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-1);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    text-align: left;
    cursor: pointer;
}

.pending-view__toggle:hover {
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
}

.pending-view__chevron {
    flex-shrink: 0;
}

.pending-view__count {
    color: var(--text-muted);
}

.pending-view__state {
    margin: 0;
    padding: var(--space-1) var(--space-2) var(--space-2) var(--space-5);
    color: var(--text-muted);
    font-size: var(--text-sm);
}

.pending-view__rows {
    margin: 0;
    padding: 0;
    list-style: none;
}

.pending-view__row {
    display: flex;
    min-height: 28px;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2) 0 var(--space-5);
    border-radius: var(--radius-control);
    font-size: var(--text-sm);
    cursor: pointer;
}

.pending-view__row:hover {
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
}

/* 选中的一行同 nb-ui `Tree` 的选中项。 */
.pending-view__row[aria-current="true"] {
    background: color-mix(in srgb, var(--accent-main) 12%, transparent);
    color: var(--accent-main);
}

.pending-view__row-text {
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.pending-view__row-place {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.pending-view__more {
    padding-left: var(--space-4);
}
</style>
