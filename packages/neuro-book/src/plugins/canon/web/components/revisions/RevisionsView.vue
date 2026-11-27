<script setup lang="ts">
/**
 * 改动记录视图的骨架（同名 .md；docs/specs/canon/author-ui.md 输出 24）。受控：行、筛选的值与当前行都由宿主给，点了什么发出什么。
 */
import {computed, ref, useId} from "vue";

import {Button, OverlayScrollbar, Select} from "@notnotype/nb-ui/components";

import {ALL} from "../../revisions";
import type {FilterOption, RevisionRow} from "../../revisions";
import {rovingKeydown, tabbableRow} from "../../roving";
import {useCanonText} from "../../text";
import WorldBanners from "../entry-page/WorldBanners.vue";

export type RevisionsViewStatus = "loading" | "failed" | "normal";

const props = withDefaults(defineProps<{
    status: RevisionsViewStatus;
    rows: readonly RevisionRow[];
    more?: boolean;
    chapters: readonly FilterOption[];
    writers: readonly FilterOption[];
    chapter: string;
    writer: string;
    current?: string | null;
    revertBlocked?: string;
    disconnected?: boolean;
    readOnly?: string;
}>(), {more: false, current: null, revertBlocked: "", disconnected: false, readOnly: ""});

const emit = defineEmits<{
    (event: "receipt", id: string): void;
    (event: "revert", id: string, title: string): void;
    (event: "more"): void;
    (event: "update:chapter", value: string): void;
    (event: "update:writer", value: string): void;
    (event: "update:current", id: string): void;
    (event: "retry"): void;
}>();

const text = useCanonText();
const scroller = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const idBase = useId();

const tabbable = computed(() => tabbableRow(props.rows.map((row) => row.id), props.current));
const filtered = computed(() => props.chapter !== ALL || props.writer !== ALL);
// 断开与只读已有横幅；别人在独占写时只有这一句说明为什么不能还原。
const blockedNote = computed(() => (props.revertBlocked !== "" && !props.disconnected && props.readOnly === "" ? props.revertBlocked : ""));
const titleId = (row: RevisionRow): string => `${idBase}-${row.id}`;
const tabIndex = (row: RevisionRow): number => (row.id === tabbable.value ? 0 : -1);
</script>

<template>
    <div class="revisions-view" data-revisions-view>
        <WorldBanners :disconnected="props.disconnected" :read-only="props.readOnly" @retry="emit('retry')" />
        <div class="revisions-view__filters">
            <Select
                size="sm"
                class="w-48 max-w-full"
                :model-value="props.chapter"
                :options="[...props.chapters]"
                :aria-label="text('revisions.chapterFilter')"
                data-revisions-chapter
                @update:model-value="emit('update:chapter', $event)"
            />
            <Select
                size="sm"
                class="w-48 max-w-full"
                :model-value="props.writer"
                :options="[...props.writers]"
                :aria-label="text('revisions.writerFilter')"
                data-revisions-writer
                @update:model-value="emit('update:writer', $event)"
            />
        </div>
        <p v-if="blockedNote !== ''" class="revisions-view__blocked" role="status" data-revisions-blocked>{{ blockedNote }}</p>
        <div class="revisions-view__body">
            <div ref="scroller" class="revisions-view__scroll">
                <p v-if="props.status === 'loading'" class="revisions-view__state" aria-busy="true">{{ text("revisions.loading") }}</p>
                <p v-else-if="props.status === 'failed'" class="revisions-view__state" role="alert">{{ text("world.failed") }}</p>
                <p v-else-if="props.rows.length === 0" class="revisions-view__state" data-revisions-empty>{{ text(filtered ? "revisions.emptyFiltered" : "revisions.empty") }}</p>
                <template v-else>
                    <ul ref="list" class="revisions-view__list" :aria-label="text('revisions.label')" @keydown="rovingKeydown($event, list)">
                        <li
                            v-for="row in props.rows"
                            :key="row.id"
                            class="revisions-view__row nb-ui-focus-ring-inset"
                            :data-row="row.id"
                            :tabindex="tabIndex(row)"
                            data-revision-row
                            @focusin="emit('update:current', row.id)"
                        >
                            <div class="revisions-view__text">
                                <span :id="titleId(row)" class="revisions-view__title" :title="row.title" data-revision-title>{{ row.title }}</span>
                                <span class="revisions-view__meta" data-revision-meta>{{ row.meta }} · {{ row.summary }}</span>
                            </div>
                            <div class="revisions-view__actions">
                                <span v-if="row.note !== ''" class="revisions-view__note" data-revision-note>{{ row.note }}</span>
                                <Button size="sm" variant="ghost" focus-ring="inset" :tabindex="tabIndex(row)" :aria-describedby="titleId(row)" data-revision-receipt @click="emit('receipt', row.id)">{{ text("revisions.receipt") }}</Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    focus-ring="inset"
                                    :tabindex="tabIndex(row)"
                                    :disabled="row.notRevertable || props.revertBlocked !== ''"
                                    :aria-describedby="titleId(row)"
                                    data-revision-revert
                                    @click="emit('revert', row.id, row.title)"
                                >{{ text("revisions.revert") }}</Button>
                            </div>
                        </li>
                    </ul>
                    <div v-if="props.more" class="revisions-view__more">
                        <Button size="sm" variant="ghost" data-revisions-more @click="emit('more')">{{ text("revisions.more") }}</Button>
                    </div>
                </template>
            </div>
            <OverlayScrollbar :target="scroller" />
        </div>
    </div>
</template>

<style scoped>
.revisions-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    container-type: inline-size;
}

.revisions-view__filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-2) var(--view-inset-inline, 6px);
}

.revisions-view__blocked {
    margin: 0;
    padding: 0 var(--view-inset-inline, 6px) var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
}

/* 叠加滚动条贴着滚动元素的右缘：它与滚动元素同一个父元素，父元素要定位。 */
.revisions-view__body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
}

.revisions-view__scroll {
    height: 100%;
    overflow-y: auto;
    padding: 0 var(--view-inset-inline, 6px) var(--space-2);
}

.revisions-view__state {
    margin: 0;
    padding: var(--space-2) 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
}

.revisions-view__list {
    margin: 0;
    padding: 0;
    list-style: none;
}

.revisions-view__row {
    display: flex;
    min-height: 40px;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-2);
    border-bottom: var(--border-w) solid var(--divider);
    border-radius: var(--radius-control);
}

.revisions-view__text {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    flex-direction: column;
}

.revisions-view__title {
    overflow: hidden;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.revisions-view__meta {
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.revisions-view__actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-1);
}

.revisions-view__note {
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.revisions-view__more {
    padding-top: var(--space-1);
}

/* 视图窄时一行里上下排（量的是视图自己的宽度）。 */
@container (max-width: 479px) {
    .revisions-view__row {
        flex-direction: column;
        align-items: stretch;
        gap: var(--space-1);
        padding-block: var(--space-2);
    }

    .revisions-view__actions {
        flex-wrap: wrap;
    }
}
</style>
