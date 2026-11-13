<script setup lang="ts">
/**
 * 待处理视图的宿主（同名 .md；docs/specs/canon/author-ui.md 输出 23、25、26 到 28）：分页读展开着的组、读各行与选中那一条要的
 * 对象与条目名字，折成 `PendingView` 的 props（`pending.ts`）；选中的规则；强行解除。
 */
import {computed, shallowRef, watch} from "vue";

import type {ChangeOutcome} from "@notnotype/nb-canon/schema";
import {useText} from "@notnotype/nb-ui/text-port";

import {useEntryHeads} from "../entry-heads";
import {failureText} from "../failures";
import {useObjectHeads} from "../object-heads";
import {pendingDetail, pendingDetailNeeds, pendingKey, pendingNeeds, pendingRow} from "../pending";
import type {PendingGroup, PendingItem, PendingLookups, PendingTarget} from "../pending";
import type {PendingViewState} from "../pending-view";
import {defaultPosition, placementLabel} from "../positions";
import type {ChapterRef} from "../positions";
import {useCanonText} from "../text";
import {useKeptRead, useWorldList, useWorldRead} from "../use-reads";
import {readOnlyBanner} from "../writable";
import type {CanonWorld} from "../world";
import BreakExclusiveDialog from "./BreakExclusiveDialog.vue";
import PendingView from "./PendingView.vue";
import type {PendingGroupState} from "./PendingView.vue";

/** 一组一次读多少条。 */
const PAGE = 50;
const GROUPS: readonly PendingGroup[] = ["pending", "hints", "handled"];

const props = defineProps<{
    world: CanonWorld;
    /** 随窗口的展开与选中。 */
    state: PendingViewState;
    open: (target: PendingTarget) => void;
    openChapter: (chapter: string) => void;
    /** 视图可见；不可见时不读（输出 26）。 */
    visible: boolean;
}>();

const text = useCanonText();
const port = useText();
const world = props.world;
const state = props.state;

// 条数、不完整与停用的诊断各页都带：用状态栏那一个读取（“待处理”一组、一页一条，读取层里是同一个），收起所有组时也有。
const summaryList = useWorldList(world, "pending", () => (props.visible ? {group: "pending" as const} : null), 1);
const summary = useKeptRead(() => summaryList.state.value);
const listOf = (group: PendingGroup) => useWorldList(world, "pending", () => (props.visible && state.expanded.value.includes(group) ? {group} : null), PAGE);
const lists = {pending: listOf("pending"), hints: listOf("hints"), handled: listOf("handled")};
const shown = {
    pending: useKeptRead(() => lists.pending.state.value),
    hints: useKeptRead(() => lists.hints.state.value),
    handled: useKeptRead(() => lists.handled.state.value),
};
const itemsOf = (group: PendingGroup): readonly PendingItem[] => (state.expanded.value.includes(group) ? shown[group].value?.items ?? [] : []);

const chaptersRead = useWorldRead(world, "chapters", () => (props.visible ? {} : null));
const chaptersShown = useKeptRead(() => chaptersRead.value);
const chapters = computed<readonly ChapterRef[]>(() => chaptersShown.value?.data?.items ?? []);

// 插件诊断的显示名：各页各带自己提到的；“再显示更多”之后 `data` 只是新的一页，所以累积起来（诊断只有几个）。
const labels = shallowRef<Readonly<Record<string, string>>>({});
watch(() => [summary.value?.data?.labels, ...GROUPS.map((group) => shown[group].value?.data?.labels)], (pages) => {
    const merged = {...labels.value};
    let changed = false;
    for (const page of pages) {
        for (const [id, label] of Object.entries(page ?? {})) {
            if (merged[id] === label) continue;
            merged[id] = label;
            changed = true;
        }
    }
    if (changed) labels.value = merged;
}, {immediate: true});

/* ---------- 选中 ---------- */

const selectedItem = computed<PendingItem | null>(() => {
    const selected = state.selected.value;
    if (selected === null) return null;
    return itemsOf(selected.group).find((item) => pendingKey(item) === selected.key) ?? null;
});

// 第一次打开与 show-pending 之后：读到“待处理”一组时选中它的第一条，没有就不选（输出 23、25）。视图开着时执行 show-pending，
// 读到的没变，所以也看 `pickFirst` 本身。
watch([() => shown.pending.value, () => state.pickFirst.value, () => props.visible], ([read]) => {
    if (!state.pickFirst.value || !props.visible || !state.expanded.value.includes("pending") || read?.data === undefined) return;
    const first = read.items[0];
    state.selected.value = first === undefined ? null : {group: "pending", key: pendingKey(first), index: 0};
    state.pickFirst.value = false;
}, {immediate: true});

// 选中的那一条在世界变了以后消失：选它原来位置上的那一条，没有就不选。只在那一组展开着、读到了时判断（停放、收起时不动它）。
watch(() => {
    const selected = state.selected.value;
    return selected === null ? null : shown[selected.group].value;
}, (read) => {
    const selected = state.selected.value;
    if (selected === null || read === null || read.data === undefined || !props.visible || !state.expanded.value.includes(selected.group)) return;
    if (read.items.some((item) => pendingKey(item) === selected.key)) return;
    const next = read.items[selected.index];
    state.selected.value = next === undefined ? null : {group: selected.group, key: pendingKey(next), index: selected.index};
});

function select(group: PendingGroup, key: string): void {
    const index = itemsOf(group).findIndex((item) => pendingKey(item) === key);
    if (index < 0) return;
    const current = state.selected.value;
    if (current?.group === group && current.key === key && current.index === index) return;
    state.selected.value = {group, key, index};
}

/* ---------- 名字与位置 ---------- */

// 选中那一条的详情要的排在最前，超出上限时少的是后面那些行的名字。
const needs = computed(() => {
    const detail = selectedItem.value === null ? {refs: [], entries: []} : pendingDetailNeeds(selectedItem.value);
    const rows = GROUPS.flatMap((group) => itemsOf(group).map(pendingNeeds));
    return {refs: [...detail.refs, ...rows.flatMap((need) => need.refs)], entries: [...new Set([...detail.entries, ...rows.flatMap((need) => need.entries)])]};
});
const objects = useObjectHeads(world, () => (props.visible ? needs.value.refs : []));
const heads = useEntryHeads(world, () => (props.visible ? needs.value.entries : []), () => (chaptersShown.value?.data === undefined ? null : defaultPosition(chapters.value)), text);

// 套不上的原因：根因那条这次的结局，经 `changes` 取（安放到它为止、从新到旧的第一条就是它）。
const root = computed(() => {
    const item = selectedItem.value;
    return item?.kind === "canon" && item.item.kind === "cannot-apply" ? item.item.root : null;
});
const rootRead = useWorldList(world, "changes", () => (props.visible && root.value !== null ? {filter: {range: {through: root.value}, order: "desc" as const}} : null), 1);

const chapterText = (id: string): string => {
    const chapter = chapters.value.find((item) => item.id === id);
    if (chapter === undefined) return text("receipt.chapterGone");
    return chapter.title === null || chapter.title === "" ? text("place.chapter", {index: chapter.index}) : text("receipt.chapterTitled", {index: chapter.index, title: chapter.title});
};

const lookups: PendingLookups = {
    object: (ref) => objects(ref),
    entryName: (id) => heads.name(id),
    address: (at) => heads.address(at),
    place: (at) => placementLabel(at, chapters.value, text),
    chapter: chapterText,
    label: (id) => labels.value[id],
    outcome: (id) => {
        const found = rootRead.state.value?.items.find((item) => item.change.id === id);
        return (found?.outcome ?? undefined) as ChangeOutcome | undefined;
    },
};

const groups = computed<Record<PendingGroup, PendingGroupState>>(() => {
    const counts = summary.value?.data?.counts;
    const result = {} as Record<PendingGroup, PendingGroupState>;
    for (const group of GROUPS) {
        const read = shown[group].value;
        result[group] = {
            rows: itemsOf(group).map((item) => pendingRow(item, lookups, text)),
            count: counts?.[group] ?? null,
            loading: read === null || read.data === undefined,
            more: read?.more ?? false,
        };
    }
    return result;
});
const detail = computed(() => (selectedItem.value === null ? null : pendingDetail(selectedItem.value, lookups, text)));

/** 结果不完整（输出 23）：哪些检查没算出来、被截断、因插件停用没有算，写显示名。 */
const notes = computed(() => {
    const page = summary.value?.data;
    if (page === undefined) return [];
    const names = (ids: readonly string[]): string => ids.map((id) => labels.value[id] ?? text("pending.pluginCheck")).join(text("value.listSeparator"));
    const result: string[] = [];
    if (page.unavailable.length > 0) result.push(text("pending.incomplete.unavailable", {names: names(page.unavailable.map((item) => item.diagnostic))}));
    if (page.truncated.length > 0) result.push(text("pending.incomplete.truncated", {names: names(page.truncated)}));
    if (page.disabled.length > 0) result.push(text("pending.incomplete.disabled", {names: names(page.disabled)}));
    return result;
});

const readOnly = computed(() => {
    const banner = readOnlyBanner(world);
    return banner === null ? "" : port.t(banner);
});

/* ---------- 强行解除 ---------- */

const holder = computed(() => world.status.value.data?.exclusive?.label ?? "");
const breaking = shallowRef<{readonly holder: string; readonly saving: boolean; readonly error: string} | null>(null);
const breakOpen = shallowRef(false);

function startBreak(): void {
    if (holder.value === "") return;
    breaking.value = {holder: holder.value, saving: false, error: ""};
    breakOpen.value = true;
}

async function confirmBreak(): Promise<void> {
    const current = breaking.value;
    if (current === null || current.saving) return;
    breaking.value = {...current, saving: true, error: ""};
    const result = await world.breakExclusive();
    if (result.ok) {
        breakOpen.value = false;
        breaking.value = {...current, saving: false};
        return;
    }
    breaking.value = {...current, saving: false, error: port.t(failureText(result.failure).text)};
}
</script>

<template>
    <PendingView
        :groups="groups"
        :expanded="state.expanded.value"
        :selected="state.selected.value === null ? null : {group: state.selected.value.group, key: state.selected.value.key}"
        :detail="detail"
        :notes="notes"
        :holder="holder"
        :disconnected="world.connection.value === 'ended'"
        :read-only="readOnly"
        @update:expanded="state.expanded.value = $event"
        @select="select"
        @more="(group: PendingGroup) => void lists[group].more()"
        @open="props.open"
        @open-chapter="props.openChapter"
        @break-exclusive="startBreak()"
        @retry="world.retry()"
    />
    <BreakExclusiveDialog
        v-if="breaking !== null"
        :open="breakOpen"
        :holder="breaking.holder"
        :saving="breaking.saving"
        :error="breaking.error"
        @update:open="(value: boolean) => { if (!value && breaking?.saving !== true) breakOpen = false; }"
        @confirm="void confirmBreak()"
        @closed="breaking = null"
    />
</template>
