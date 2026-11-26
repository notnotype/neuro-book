<script setup lang="ts">
/**
 * 改动记录视图的宿主（同名 .md；docs/specs/canon/author-ui.md 输出 24、26）：经读取层分页读 `revisions` 与章表，折成
 * `RevisionsView` 的 props；“还原”放进窗口里那一个还原对话框，“查看详情”打开回执页。
 */
import {computed} from "vue";

import {useText} from "@notnotype/nb-ui/text-port";

import type {RevertRequests} from "../revert";
import {ALL, chapterFilterOptions, revisionRow, revisionsFilter, writerFilterOptions} from "../revisions";
import type {RevisionsViewState} from "../revisions-view";
import {useCanonText} from "../text";
import {useKeptRead, useWorldList, useWorldRead} from "../use-reads";
import {readOnlyBanner, writeBlocked} from "../writable";
import type {CanonWorld} from "../world";
import RevisionsView from "./RevisionsView.vue";
import type {RevisionsViewStatus} from "./RevisionsView.vue";

/** 一次读多少条。 */
const PAGE = 50;

const props = defineProps<{
    world: CanonWorld;
    /** 随窗口的筛选与当前行。 */
    state: RevisionsViewState;
    revert: RevertRequests;
    receipt: (revision: string) => void;
    /** 视图可见；不可见时不读（输出 26）。 */
    visible: boolean;
}>();

const text = useCanonText();
const port = useText();
const world = props.world;
const state = props.state;

const chaptersRead = useWorldRead(world, "chapters", () => (props.visible ? {} : null));
// 筛着的那一章被删掉以后回到“全部章”：选项里已经没有它。
const chapter = computed(() => {
    const items = chaptersRead.value?.data?.items;
    return state.chapter.value !== ALL && items !== undefined && !items.some((item) => item.id === state.chapter.value) ? ALL : state.chapter.value;
});
const list = useWorldList(world, "revisions", () => (props.visible ? {filter: revisionsFilter(chapter.value, state.writer.value)} : null), PAGE);

// 停放时释放了读取，屏幕上留着最后读到的。
const shown = useKeptRead(() => list.state.value);

const status = computed<RevisionsViewStatus>(() => {
    const read = shown.value;
    if (read?.data === undefined) return read !== null && read.error !== null ? "failed" : "loading";
    return "normal";
});
const rows = computed(() => (shown.value?.items ?? []).map((item) => revisionRow(item, text)));
const chapters = computed(() => chapterFilterOptions(chaptersRead.value?.data?.items ?? [], text));
const writers = computed(() => writerFilterOptions(text));
const revertBlocked = computed(() => {
    const blocked = writeBlocked(world);
    return blocked === null ? "" : port.t(blocked);
});
const readOnly = computed(() => {
    const banner = readOnlyBanner(world);
    return banner === null ? "" : port.t(banner);
});
</script>

<template>
    <RevisionsView
        :status="status"
        :rows="rows"
        :more="shown?.more ?? false"
        :chapters="chapters"
        :writers="writers"
        :chapter="chapter"
        :writer="state.writer.value"
        :current="state.current.value"
        :revert-blocked="revertBlocked"
        :disconnected="world.connection.value === 'ended'"
        :read-only="readOnly"
        @receipt="props.receipt"
        @revert="(id, title) => props.revert.open(id, title)"
        @more="list.more()"
        @update:chapter="state.chapter.value = $event"
        @update:writer="state.writer.value = $event"
        @update:current="state.current.value = $event"
        @retry="world.retry()"
    />
</template>
