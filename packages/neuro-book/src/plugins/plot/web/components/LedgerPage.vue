<script setup lang="ts">
/**
 * 伏笔账本一页（docs/specs/plot/author-ui.md 输出 2 到 6、11 到 13）：canon 交的页头、分段筛选、一行一个伏笔（到哪一步、上次提到、
 * 接下来、节点带）。数据来自一次 `ledger` 外部列表。窄时（容器不足 640 像素）换成一行一条的列表，节点带在名字下面。
 */
import {computed, shallowRef} from "vue";

import {Button, SegmentedControl} from "@notnotype/nb-ui/components";

import type {CanonReads} from "nbook/plugins/canon/shared/reads";

import type {AuthorLedgerRow, LedgerSegment} from "../../core/author/ledger";
import type {AuthorOutputs, PlotAuthorClient} from "../author";
import {chapterIndex, chapterLabel, stageLabel} from "../labels";
import {NARROW_WIDTH, useContainerWidth} from "../page-shell";
import type {LedgerPageState} from "../pages";
import {usePlotText} from "../text";
import NodeBand from "./NodeBand.vue";
import ReadFailure from "./ReadFailure.vue";

const props = defineProps<{
    reads: CanonReads;
    client: PlotAuthorClient;
    state: LedgerPageState;
    open: (id: string) => void;
}>();

const text = usePlotText();
const state = props.state;
const PageHead = props.reads.PageHead;
const position = props.reads.usePosition(() => state.position);
const chaptersRead = props.reads.useRead("chapters", () => ({}));
const chapters = computed(() => chapterIndex(chaptersRead.value?.data?.items));
const now = computed(() => {
    const at = position.value?.position;
    return at === undefined || at.kind === "initial" ? 0 : (chapters.value.get(at.chapter) ?? 0);
});
type Page = AuthorOutputs["ledger"];
const list = props.reads.useExternalList<{readonly position: NonNullable<typeof position.value>["position"]; readonly mode: "actual" | "planned"; readonly segment: LedgerSegment}, Page>(
    "ledger",
    () => (position.value === null ? null : {position: position.value.position, mode: state.planned ? "planned" : "actual", segment: state.segment}),
    (input, cursor, limit) => props.client.call("ledger", {...input, ...(cursor === undefined ? {} : {cursor}), limit}),
    200,
);
const data = computed(() => list.state.value?.data);
const SEGMENTS = {unpaid: "ledger.segments.unpaid", silent: "ledger.segments.silent", unplanned: "ledger.segments.unplanned", dropped: "ledger.segments.dropped", all: "ledger.segments.all"} as const;
const segments = computed(() => (["unpaid", "silent", "unplanned", "dropped", "all"] as const).map((value) => ({value, label: text(SEGMENTS[value]), count: data.value?.counts[value] ?? 0})));
const IMPORTANCE = {main: "ledger.importance.main", side: "ledger.importance.side", minor: "ledger.importance.minor"} as const;
const ROLES = {plant: "ledger.role.plant", echo: "ledger.role.echo", mislead: "ledger.role.mislead", partial: "ledger.role.partial", payoff: "ledger.role.payoff"} as const;
const stage = (row: AuthorLedgerRow): string => stageLabel(row.stage, row.dropped, text);
const importance = (row: AuthorLedgerRow): string => (row.importance !== null && row.importance in IMPORTANCE ? text(IMPORTANCE[row.importance as keyof typeof IMPORTANCE]) : "");
const last = (row: AuthorLedgerRow): string => (row.lastMentioned === null ? text("fmt.none") : chapterLabel(row.lastMentioned, chapters.value, text));
const next = (row: AuthorLedgerRow): {readonly text: string; readonly warning: boolean} => {
    if (row.next !== null) return {text: text("ledger.next", {chapter: chapterLabel(row.next.chapter, chapters.value, text), role: text(ROLES[row.next.role])}), warning: false};
    return row.stage === "paidOff" || row.dropped ? {text: text("fmt.none"), warning: false} : {text: text("ledger.none"), warning: true};
};
const nameOf = (id: string): string => data.value?.names[id]?.name ?? id;
const failure = computed(() => list.state.value?.error ?? null);
const remaining = computed(() => {
    const total = data.value?.counts[state.segment];
    return total === undefined ? null : Math.max(0, total - (list.state.value?.items.length ?? 0));
});
const root = shallowRef<HTMLElement | null>(null);
const width = useContainerWidth(root);
</script>

<template>
    <div ref="root" class="min-h-full" data-plot-page="ledger">
        <PageHead :title="text('editorPages.ledger.title')" :position="state.position" :planned="state.planned" wide @update:position="(value: string) => (state.position = value)" @update:planned="(value: boolean) => (state.planned = value)" />
        <div class="mx-auto max-w-[1100px] px-8 py-5 max-[480px]:px-4">
            <p v-if="props.reads.connection.value === 'no-project'" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("page.unbound") }}</p>
            <template v-else>
                <!-- 读到过的留着旧内容，失败的那一条放在上面；没读到过时只有它（canon/author-ui.md 输出 26）。 -->
                <ReadFailure v-if="failure !== null" class="mb-4" :failure="failure" @retry="props.reads.retry()" />
                <p v-if="list.state.value === null || list.state.value.loading" role="status" aria-busy="true" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("page.loading") }}</p>
                <template v-else-if="list.state.value.data !== undefined">
                <SegmentedControl class="mb-4" size="sm" wrap :aria-label="text('ledger.segments.label')" :options="segments" :model-value="state.segment" @update:model-value="(value) => (state.segment = value as LedgerSegment)" />
                <p v-if="list.state.value.items.length === 0" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("ledger.empty") }}</p>
                <div v-else-if="width < NARROW_WIDTH" class="flex flex-col gap-3" data-ledger-list>
                    <article v-for="row in list.state.value.items" :key="row.id" class="rounded-[var(--radius-control)] border border-[var(--divider)] px-3 py-2 text-[length:var(--text-sm)]" data-ledger-row>
                        <div class="flex flex-wrap items-baseline gap-2">
                            <button type="button" class="font-medium text-[var(--accent-main)] hover:underline" @click="props.open(row.id)">{{ nameOf(row.id) }}</button>
                            <span class="text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ importance(row) }}</span>
                        </div>
                        <p v-if="row.unplanned && !row.dropped" class="text-[length:var(--text-xs)] text-[var(--text-secondary)]">{{ text("ledger.unplannedNote") }}</p>
                        <p class="text-[var(--text-secondary)]">{{ stage(row) }}{{ text("fmt.dot") }}{{ last(row) }}<span v-if="row.silence?.long" class="text-[var(--status-warning)]">{{ text("fmt.note", {text: text("ledger.silent", {count: row.silence.chapters})}) }}</span>{{ text("fmt.dot") }}<span :class="next(row).warning ? 'text-[var(--status-warning)]' : ''">{{ next(row).text }}</span></p>
                        <NodeBand class="mt-2" :nodes="row.nodes" :chapters="chapters" :now="now" />
                    </article>
                </div>
                <div v-else class="overflow-x-auto" data-ledger-table>
                    <table class="w-full border-collapse text-left text-[length:var(--text-sm)]" :aria-label="text('ledger.tableLabel')">
                        <thead>
                            <tr class="border-b border-[var(--divider)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
                                <th scope="col" class="py-2 pr-4 font-normal">{{ text("ledger.columns.name") }}</th>
                                <th scope="col" class="py-2 pr-4 font-normal">{{ text("ledger.columns.stage") }}</th>
                                <th scope="col" class="py-2 pr-4 font-normal">{{ text("ledger.columns.last") }}</th>
                                <th scope="col" class="py-2 pr-4 font-normal">{{ text("ledger.columns.next") }}</th>
                                <th scope="col" class="py-2 font-normal">{{ text("ledger.columns.band") }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in list.state.value.items" :key="row.id" class="border-b border-[var(--divider)] align-top" data-ledger-row>
                                <th scope="row" class="py-2 pr-4 font-normal">
                                    <button type="button" class="text-[var(--accent-main)] hover:underline" @click="props.open(row.id)">{{ nameOf(row.id) }}</button>
                                    <span class="ml-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ importance(row) }}</span>
                                    <span v-if="row.unplanned && !row.dropped" class="block text-[length:var(--text-xs)] text-[var(--text-secondary)]">{{ text("ledger.unplannedNote") }}</span>
                                </th>
                                <td class="py-2 pr-4">{{ stage(row) }}</td>
                                <td class="py-2 pr-4">{{ last(row) }}<span v-if="row.silence?.long" class="block text-[length:var(--text-xs)] text-[var(--status-warning)]">{{ text("ledger.silent", {count: row.silence.chapters}) }}</span></td>
                                <td class="py-2 pr-4" :class="next(row).warning ? 'text-[var(--status-warning)]' : ''" data-cell="next">{{ next(row).text }}</td>
                                <td class="py-2"><NodeBand :nodes="row.nodes" :chapters="chapters" :now="now" /></td>
                            </tr>
                        </tbody>
                    </table>
                    <p class="mt-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("ledger.legend", {written: text("ledger.legendWritten"), planned: text("ledger.legendPlanned"), roles: text("ledger.legendRoles")}) }}</p>
                </div>
                <Button v-if="list.state.value.more" class="mt-3" size="sm" variant="ghost" @click="list.more()">{{ remaining === null ? text("page.moreUnknown") : text("page.more", {count: remaining}) }}</Button>
                </template>
            </template>
        </div>
    </div>
</template>
