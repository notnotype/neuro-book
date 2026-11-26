<script setup lang="ts">
/**
 * 回执页（docs/specs/canon/author-ui.md 输出 18、20、26 到 28）：经读取层读这次修订，再按需读写出它要的名字：被改的条目（名字与
 * 字段显示名）、文字没变的剧情变更（现在的文字）、它还原的那几次（标题）。都折成 `ReceiptPage` 的数据。“还原这次修订”放进
 * 窗口里那一个还原对话框。
 */
import {computed, watch} from "vue";

import type {Placement} from "@notnotype/nb-canon";
import {useText} from "@notnotype/nb-ui/text-port";

import {canonText} from "../../shared/text";
import {NAMED_ENTRIES_MAX, useEntryHeads} from "../entry-heads";
import {usePageNotice} from "../notices";
import type {CanonNotices} from "../notices";
import {defaultPosition, placementLabel} from "../positions";
import type {ChapterRef} from "../positions";
import {receiptChangeIds, receiptEntryIds, receiptModel} from "../receipt";
import type {ReceiptLookups} from "../receipt";
import type {RevertRequests} from "../revert";
import {useCanonText} from "../text";
import {useWorldRead, useWorldReads} from "../use-reads";
import {readOnlyBanner, writeBlocked} from "../writable";
import type {CanonWorld} from "../world";
import PageNotices from "./PageNotices.vue";
import ReceiptPage from "./ReceiptPage.vue";
import type {ReceiptPageStatus} from "./ReceiptPage.vue";

const props = defineProps<{
    /** 修订 id。 */
    id: string;
    world: CanonWorld;
    notices: CanonNotices;
    revert: RevertRequests;
    open: (ref: {readonly kind: "entry" | "change"; readonly id: string}) => void;
    receipt: (revision: string) => void;
    /** 读到标题时报给页面实现：标签标题与面包屑用它。 */
    onTitle: (title: string) => void;
}>();

const text = useCanonText();
const port = useText();
const world = props.world;
// 挂着就是在前台：保存后的提示显示在本页顶上（输出 18）。
const pageNotice = usePageNotice(props.notices, props.revert);


const read = useWorldRead(world, "revision", () => ({id: props.id}));
const revision = computed(() => read.value?.data?.revision ?? undefined);
const chaptersRead = useWorldRead(world, "chapters", () => ({}));
const chapters = computed<readonly ChapterRef[]>(() => chaptersRead.value?.data?.items ?? []);

watch(revision, (found) => {
    if (found !== undefined && found !== null) props.onTitle(found.title);
}, {immediate: true});

const status = computed<ReceiptPageStatus>(() => {
    const data = read.value?.data;
    if (data === undefined) return (read.value?.error ?? null) !== null ? "failed" : "loading";
    return data.revision === null ? "missing" : "normal";
});

const heads = useEntryHeads(world, () => (revision.value ? receiptEntryIds(revision.value) : []), () => (chaptersRead.value?.data === undefined ? null : defaultPosition(chapters.value)), text);
const changes = useWorldReads(world, "object", () => new Map((revision.value ? receiptChangeIds(revision.value) : []).slice(0, NAMED_ENTRIES_MAX).map((id) => [id, {ref: {kind: "change" as const, id}}])));
const reverts = computed(() => revision.value?.reverts ?? []);
const revertedReads = useWorldReads(world, "revision", () => new Map(reverts.value.slice(0, NAMED_ENTRIES_MAX).map((id) => [id, {id}])));

const lookups: ReceiptLookups = {
    entryName: (id) => heads.name(id),
    address: (at) => heads.address(at),
    label: (path, entry) => heads.label(path, entry),
    changeText: (id) => {
        const object = changes.value.get(id)?.data?.object as {readonly text?: string} | null | undefined;
        return object?.text;
    },
    place: (at: Placement) => placementLabel(at, chapters.value, text),
    chapter: (id) => {
        const chapter = chapters.value.find((item) => item.id === id);
        if (chapter === undefined) return text("receipt.chapterGone");
        return chapter.title === null || chapter.title === "" ? text("place.chapter", {index: chapter.index}) : text("receipt.chapterTitled", {index: chapter.index, title: chapter.title});
    },
};

const model = computed(() => (revision.value ? receiptModel(revision.value, lookups, text) : null));
const reverted = computed(() => reverts.value.map((id) => ({id, title: revertedReads.value.get(id)?.data?.revision?.title ?? null})));

// “还原这次修订”（输出 20、22）：章序调整不能还原；世界写不了时不可用。有依赖时照样可以点，对话框里列出来。
const revertable = computed(() => read.value?.data?.revertable);
const revertBlocked = computed(() => {
    if (revertable.value !== undefined && !revertable.value.ok && revertable.value.reason === "not-revertable") return port.t(canonText("revert.notRevertable"));
    const blocked = writeBlocked(world);
    return blocked === null ? "" : port.t(blocked);
});
const dependents = computed(() => (revertable.value !== undefined && !revertable.value.ok && revertable.value.reason === "has-dependents" ? revertable.value.dependents.length : 0));
const readOnly = computed(() => readOnlyBanner(world));
</script>

<template>
    <div class="min-h-full">
        <ReceiptPage
            :status="status"
            :model="model"
            :reverted="reverted"
            :revert-blocked="revertBlocked"
            :dependents="dependents"
            :disconnected="world.connection.value === 'ended'"
            :read-only="readOnly === null ? '' : port.t(readOnly)"
            @open="props.open"
            @receipt="props.receipt"
            @revert="props.revert.open(props.id, model?.title)"
            @retry="world.retry()"
        />
        <PageNotices
            :notice="props.notices.current.value"
            :agent="props.notices.agent.value"
            :hold="pageNotice.hold"
            @receipt="props.receipt"
            @undo="pageNotice.undo"
            @revisions="props.notices.openRevisions()"
            @close="pageNotice.close()"
            @close-agent="props.notices.dismissAgent()"
        />
    </div>
</template>
