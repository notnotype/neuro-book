<script setup lang="ts">
/**
 * 秘密条目页的“谁知道”（docs/specs/plot/author-ui.md 输出 19）：替换 `nbook.plot.point` 的通用字段表。顶上保密档；三节（角色、读者、
 * 和它有关的）；下面一节是这一页的通用字段（保密、规则、表现、揭穿、读者问题）。数据来自 `point` 外部读取。
 */
import {computed} from "vue";

import {Badge} from "@notnotype/nb-ui/components";

import type {CanonReads} from "nbook/plugins/canon/shared/reads";
import type {ComponentViewContext} from "nbook/plugins/canon/web/component-views";

import type {AuthorKnowing} from "../../core/author/knowing";
import type {PlotAuthorClient} from "../author";
import {chapterIndex, chapterLabel, degreeLabel, placeLabel} from "../labels";
import {usePlotText} from "../text";

const props = defineProps<{
    context: ComponentViewContext;
    reads: CanonReads;
    client: PlotAuthorClient;
}>();

const text = usePlotText();
const read = props.reads.useExternal("point", () => ({point: props.context.entry, position: props.context.position, mode: props.context.mode}), (input) => props.client.call("point", input));
const data = computed(() => read.value?.data);
const chaptersRead = props.reads.useRead("chapters", () => ({}));
const chapters = computed(() => chapterIndex(chaptersRead.value?.data?.items));
const nameOf = (id: string | null): string => (id === null ? "" : (data.value?.names[id]?.name ?? id));
const lineName = (id: string): string => (id === "main" ? text("knowing.mainLine") : (props.reads.lineOptions.value.find((option) => option.id === id)?.name ?? id));
const secret = computed(() => data.value?.secrecy === "secret" || data.value?.secrecy === "topSecret");
const SECRECY = {common: "secrecy.common", trade: "secrecy.trade", secret: "secrecy.secret", topSecret: "secrecy.topSecret"} as const;
const STAGES = {unplanted: "ledger.stage.unplanted", planted: "ledger.stage.planted", echoing: "ledger.stage.echoing", partial: "ledger.stage.partial", paidOff: "ledger.stage.paidOff"} as const;
const HOW = {witnessed: "knowing.how.witnessed", read: "knowing.how.read", inferred: "knowing.how.inferred", other: "knowing.how.other"} as const;
const detail = (row: AuthorKnowing): string => {
    if (row.degree === "misbelieves" && row.belief !== null) return row.belief;
    if (row.how === "told") return text("knowing.toldBy", {name: nameOf(row.from)});
    return row.how === null ? "" : text(HOW[row.how]);
};
const origin = (row: AuthorKnowing): string => {
    const at = row.origin;
    if (at === null) return "";
    if (at.kind === "initial") return text("knowing.origin.initial");
    if (at.kind === "goal") return text("knowing.origin.goal");
    if (at.kind === "carried") return text("knowing.origin.carried", {line: lineName(at.line)});
    return placeLabel(at, chapters.value, text);
};
const reader = computed(() => {
    const value = data.value?.reader;
    if (value === undefined) return "";
    const degree = degreeLabel(value.degree, true, text);
    const from = value.degree === "knows" ? value.knows : value.degree === "suspects" ? value.suspects : null;
    return from === null ? degree : `${degree}，${text("point.readerFrom", {place: placeLabel(from, chapters.value, text), excerpt: from.excerpt})}`;
});
const decision = (item: {readonly text: string; readonly status: "pending" | "decided"; readonly conclusion: string | null; readonly due: string | null}): string => {
    if (item.status === "decided") return `${item.text}：${item.conclusion ?? ""}`;
    return `${item.text}：${text("secrets.undecided")}${item.due === null ? "" : `，${text("secrets.due", {chapter: chapterLabel(item.due, chapters.value, text)})}`}`;
};
</script>

<template>
    <div class="flex flex-col gap-5 text-[length:var(--text-sm)]" data-point-view>
        <p v-if="read === null || read.loading" role="status" aria-busy="true" class="text-[var(--text-muted)]">{{ text("page.loading") }}</p>
        <template v-else-if="data !== undefined">
            <div><Badge size="sm">{{ text(SECRECY[data.secrecy as keyof typeof SECRECY] ?? "secrecy.secret") }}</Badge></div>
            <section>
                <h3 class="mb-1 font-semibold">{{ text("point.roles") }}</h3>
                <ul class="divide-y divide-[var(--divider)]">
                    <!-- 同 KnowingView 的行：放不下时那句话换到下一行，空的格不画。 -->
                    <li v-for="row in data.people" :key="row.person" class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5" data-point-row>
                        <button type="button" class="w-24 min-w-0 truncate text-left text-[var(--accent-main)] hover:underline" data-cell="name" @click="props.context.open({kind: 'entry', id: row.person})">{{ nameOf(row.person) }}</button>
                        <span class="w-14 shrink-0 text-[var(--text-secondary)]" data-cell="degree">{{ degreeLabel(row.degree, secret, text) }}</span>
                        <span v-if="detail(row) !== ''" class="min-w-0 grow basis-48 text-[var(--text-secondary)]" data-cell="detail">{{ detail(row) }}</span>
                        <span v-if="origin(row) !== ''" class="ml-auto text-[length:var(--text-xs)] text-[var(--text-muted)]" data-cell="origin">{{ origin(row) }}</span>
                    </li>
                </ul>
                <p v-if="data.peopleTotal > data.people.length" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("point.moreRows", {count: data.peopleTotal - data.people.length}) }}</p>
                <p v-if="data.rest.count > 0" class="mt-1 text-[var(--text-secondary)]" data-point-rest>{{ text(data.rest.unaware ? "point.restUnaware" : "point.restNoRecord", {count: data.rest.count}) }}</p>
            </section>
            <section>
                <h3 class="mb-1 font-semibold">{{ text("point.reader") }}</h3>
                <p class="text-[var(--text-secondary)]" data-point-reader>{{ reader }}</p>
            </section>
            <section v-if="data.related.decisions.length + data.related.guards.length + data.related.foreshadows.length + data.related.attitudes.length + data.related.goals.length > 0">
                <h3 class="mb-1 font-semibold">{{ text("point.related") }}</h3>
                <ul class="flex flex-col gap-1 text-[var(--text-secondary)]" data-point-related>
                    <li v-for="item in data.related.decisions" :key="item.id">{{ text("point.decision") }}：{{ decision(item) }}</li>
                    <li v-for="item in data.related.guards" :key="item.id">{{ text("point.guard") }}：{{ decision(item) }}</li>
                    <li v-for="item in data.related.foreshadows" :key="item.id">
                        {{ text("point.foreshadow") }}：<button type="button" class="text-[var(--accent-main)] hover:underline" @click="props.context.open({kind: 'entry', id: item.id})">{{ nameOf(item.id) }}</button>（{{ item.dropped ? text("ledger.stage.dropped") : text(STAGES[item.stage as keyof typeof STAGES] ?? "ledger.stage.planted") }}）
                    </li>
                    <li v-for="item in data.related.attitudes" :key="`${item.holder}-${item.object}`">{{ text("point.attitude") }}：{{ text("point.attitudeFrom", {holder: nameOf(item.holder), object: nameOf(item.object)}) }}</li>
                    <li v-for="goal in data.related.goals" :key="goal">
                        {{ text("point.goal") }}：<button type="button" class="text-[var(--accent-main)] hover:underline" @click="props.context.open({kind: 'entry', id: goal})">{{ nameOf(goal) }}</button>
                    </li>
                </ul>
            </section>
        </template>
        <section>
            <h3 class="mb-1 font-semibold">{{ text("knowing.fields") }}</h3>
            <component :is="props.context.FieldTable" />
        </section>
    </div>
</template>
