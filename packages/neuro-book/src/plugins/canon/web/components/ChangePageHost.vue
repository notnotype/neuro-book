<script setup lang="ts">
/**
 * 变更详情页（docs/specs/canon/author-ui.md 输出 18、21、26 到 29）：经读取层读出这条变更（`object`）与章表，再读它涉及与改到的
 * 条目的名字（`entry-heads.ts`），折成 `ChangePage` 的数据（`change.ts`）。改一处的值与“改成生效”在 `change-edit.ts`，填了一半
 * 的输入在标签状态里。“按计划”与位置不影响这一页。
 */
import {computed, nextTick, shallowRef, watch} from "vue";

import type {Placement, StoryChange} from "@notnotype/nb-canon";
import {useText} from "@notnotype/nb-ui/text-port";

import type {CanonClient} from "../../shared/contracts";
import {changeModel} from "../change";
import {useChangeWrite} from "../change-edit";
import type {ChangePageState} from "../change-page";
import {useEntryHeads} from "../entry-heads";
import {usePageNotice} from "../notices";
import type {CanonNotices} from "../notices";
import {defaultPosition, placementLabel} from "../positions";
import type {ChapterRef} from "../positions";
import type {RevertRequests} from "../revert";
import {useCanonText} from "../text";
import {useWorldRead} from "../use-reads";
import {readOnlyBanner, writeBlocked} from "../writable";
import type {CanonWorld} from "../world";
import ChangePage from "./ChangePage.vue";
import type {ChangePageStatus} from "./ChangePage.vue";
import ConfirmBar from "./ConfirmBar.vue";
import PageNotices from "./PageNotices.vue";

const props = defineProps<{
    /** 剧情变更 id。 */
    id: string;
    state: ChangePageState;
    world: CanonWorld;
    /** 世界客户端的读取（预览）。包在对象里传，理由同 `EntryPageHost`。 */
    client: Pick<CanonClient, "call">;
    notices: CanonNotices;
    revert: RevertRequests;
    open: (ref: {readonly kind: "entry" | "change"; readonly id: string}) => void;
    receipt: (revision: string) => void;
    /** 打开一章的正文；没找到这一章的文件时 resolve 为 false。 */
    openChapter: (chapter: string) => Promise<boolean>;
    /** 读到文字与安放时报给页面实现：标签标题与面包屑用它。 */
    onHead: (head: {readonly text: string; readonly place: string}) => void;
}>();

const text = useCanonText();
const port = useText();
const world = props.world;
const state = props.state;
const pageNotice = usePageNotice(props.notices, props.revert);

const read = useWorldRead(world, "object", () => ({ref: {kind: "change", id: props.id}}));
const change = computed(() => (read.value?.data === undefined ? undefined : (read.value.data.object as StoryChange | null)));
const chaptersRead = useWorldRead(world, "chapters", () => ({}));
const chapters = computed<readonly ChapterRef[]>(() => chaptersRead.value?.data?.items ?? []);
const place = (at: Placement): string => placementLabel(at, chapters.value, text);

const status = computed<ChangePageStatus>(() => {
    if (change.value === undefined) return (read.value?.error ?? null) !== null ? "failed" : "loading";
    return change.value === null ? "missing" : "normal";
});

const entryIds = computed(() => (change.value ? [...new Set([...change.value.involves, ...change.value.patches.map((patch) => patch.at.entry)])] : []));
const heads = useEntryHeads(world, () => entryIds.value, () => (chaptersRead.value?.data === undefined ? null : defaultPosition(chapters.value)), text);
const model = computed(() => (change.value ? changeModel(change.value, {address: heads.address, entryName: heads.name, place}, text) : null));

// 章表读到以后才报：安放要写成“第 N 章”。
watch(model, (found) => {
    if (found !== null && chaptersRead.value?.data !== undefined) props.onHead({text: found.text, place: found.place});
}, {immediate: true});

const blocked = computed(() => writeBlocked(world));
const readOnly = computed(() => readOnlyBanner(world));
const write = useChangeWrite({
    world,
    call: props.client.call,
    id: props.id,
    draft: () => state.edit,
    setDraft: (draft) => {
        state.edit = draft;
    },
    read: () => (read.value?.data === undefined ? undefined : {change: change.value ?? null, version: read.value.data.version}),
    address: heads.address,
    blocked: () => blocked.value,
    text,
    resolve: (given) => port.t(given),
    saved: (published, title) => props.notices.show({revision: published.revision, title}),
    refocus: (index) => {
        void nextTick(() => document.querySelector<HTMLElement>(`[data-edit-patch="${String(index)}"]`)?.focus());
    },
});

/** 改一处的确认条（同条目页的确认条，没有意图一项；会写回的就是这条变更）。 */
const bar = computed(() => {
    const draft = state.edit;
    const feedback = write.feedback.value;
    if (draft?.kind !== "patch" || feedback === null || change.value === null || change.value === undefined) return null;
    const patch = change.value.patches[draft.index];
    if (patch === undefined) return null;
    return {
        label: heads.address(patch.at),
        kind: "number" as const,
        value: draft.value,
        intents: ["creative" as const],
        intent: "creative" as const,
        preview: feedback.preview === null ? null : {route: text("change.route"), impact: feedback.preview},
        previewing: feedback.previewing,
        error: feedback.error,
        recheck: feedback.recheck,
        saving: feedback.saving,
        locked: feedback.locked,
    };
});
const activation = computed(() => (state.edit?.kind === "activate" ? write.feedback.value : null));

const chapterMissing = shallowRef<string | null>(null);
const openChapter = async (chapter: string): Promise<void> => {
    chapterMissing.value = null;
    if (!(await props.openChapter(chapter))) chapterMissing.value = chapter;
};
</script>

<template>
    <div class="min-h-full">
        <ChangePage
            :status="status"
            :model="model"
            :blocked="blocked === null ? '' : port.t(blocked)"
            :activation="activation"
            :chapter-missing="chapterMissing"
            :disconnected="world.connection.value === 'ended'"
            :read-only="readOnly === null ? '' : port.t(readOnly)"
            @open-entry="(id: string) => props.open({kind: 'entry', id})"
            @open-chapter="openChapter"
            @edit="write.editPatch"
            @activate="write.activate()"
            @activation-save="write.save()"
            @activation-cancel="write.cancel()"
            @retry="world.retry()"
        >
            <template #bar>
                <ConfirmBar
                    v-if="bar !== null"
                    v-bind="bar"
                    @update:value="(value: unknown) => write.update(String(value))"
                    @save="write.save()"
                    @recheck="write.save()"
                    @cancel="write.cancel()"
                />
            </template>
        </ChangePage>
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
