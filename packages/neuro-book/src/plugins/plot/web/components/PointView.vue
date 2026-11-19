<script setup lang="ts">
/**
 * 秘密条目页的“谁知道”（docs/specs/plot/author-ui.md 输出 19）：替换 `nbook.plot.point` 的通用字段表。顶上保密档；三节（角色、读者、
 * 和它有关的）；下面一节是这一页的通用字段（保密、规则、表现、揭穿、读者问题）。数据来自 `point` 外部读取。
 */
import {computed} from "vue";

import {Badge} from "@notnotype/nb-ui/components";

import type {CanonReads} from "nbook/plugins/canon/shared/reads";
import type {ComponentViewContext} from "nbook/plugins/canon/web/component-views";

import type {PlotAuthorClient} from "../author";
import {chapterIndex, decisionLabel, degreeLabel, knowingDetail, lineNameOf, originLabel, placeLabel, secrecyLabel, stageLabel} from "../labels";
import {usePlotText} from "../text";
import ReadFailure from "./ReadFailure.vue";

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
/** 名字取读取结果的名字表；删了的条目写“已删除的条目”（knowledge.md 输出 1：引用照常保留）。 */
const nameOf = (id: string | null): string => {
    if (id === null) return "";
    const named = data.value?.names[id];
    return named?.deleted === true ? text("page.deletedEntry") : (named?.name ?? id);
};
const lineName = (id: string): string => lineNameOf(id, props.reads.lineOptions.value, text);
const secret = computed(() => data.value?.secrecy === "secret" || data.value?.secrecy === "topSecret");
const reader = computed(() => {
    const value = data.value?.reader;
    if (value === undefined) return "";
    const degree = degreeLabel(value.degree, true, text);
    const from = value.degree === "knows" ? value.knows : value.degree === "suspects" ? value.suspects : null;
    return from === null ? degree : text("point.readerFrom", {degree, place: placeLabel(from, chapters.value, text), excerpt: from.excerpt});
});
const labeled = (label: string, value: string): string => text("fmt.labeled", {label, value});
/** “和它有关的”截掉的条数（每个列表至多列 50 条，输出 19 的“列表多了写还有 N 项”）。 */
const relatedMore = computed(() => {
    const value = data.value;
    if (value === undefined) return 0;
    const lists = value.related;
    return (Object.keys(lists) as (keyof typeof lists)[]).reduce((sum, key) => sum + Math.max(0, value.relatedTotals[key] - lists[key].length), 0);
});
</script>

<template>
    <div class="flex flex-col gap-5 text-[length:var(--text-sm)]" data-point-view>
        <!-- 读到过的留着旧内容，失败的那一条放在上面；没读到过时只有它（canon/author-ui.md 输出 26）。 -->
        <ReadFailure v-if="read?.error" :failure="read.error" @retry="props.reads.retry()" />
        <p v-if="read === null || read.loading" role="status" aria-busy="true" class="text-[var(--text-muted)]">{{ text("page.loading") }}</p>
        <template v-else-if="data !== undefined">
            <div><Badge size="sm">{{ secrecyLabel(data.secrecy, text) }}</Badge></div>
            <section>
                <h3 class="mb-1 font-semibold">{{ text("point.roles") }}</h3>
                <ul class="divide-y divide-[var(--divider)]">
                    <!-- 同 KnowingView 的行：放不下时那句话换到下一行，空的格不画。 -->
                    <li v-for="row in data.people" :key="row.person" class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5" data-point-row>
                        <button type="button" class="w-24 min-w-0 truncate text-left text-[var(--accent-main)] hover:underline" data-cell="name" @click="props.context.open({kind: 'entry', id: row.person})">{{ nameOf(row.person) }}</button>
                        <span class="w-14 shrink-0 text-[var(--text-secondary)]" data-cell="degree">{{ degreeLabel(row.degree, secret, text) }}</span>
                        <span v-if="knowingDetail(row, nameOf, text) !== ''" class="min-w-0 grow basis-48 text-[var(--text-secondary)]" data-cell="detail">{{ knowingDetail(row, nameOf, text) }}</span>
                        <span v-if="row.origin !== null" class="ml-auto text-[length:var(--text-xs)] text-[var(--text-muted)]" data-cell="origin">{{ originLabel(row.origin, chapters, lineName, text) }}</span>
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
                    <li v-for="item in data.related.decisions" :key="item.id">{{ labeled(text("point.decision"), decisionLabel(item, chapters, text)) }}</li>
                    <li v-for="item in data.related.guards" :key="item.id">{{ labeled(text("point.guard"), decisionLabel(item, chapters, text)) }}</li>
                    <li v-for="item in data.related.foreshadows" :key="item.id">
                        {{ text("fmt.labelPrefix", {label: text("point.foreshadow")}) }}<button type="button" class="text-[var(--accent-main)] hover:underline" @click="props.context.open({kind: 'entry', id: item.id})">{{ nameOf(item.id) }}</button>{{ text("fmt.note", {text: stageLabel(item.stage, item.dropped, text)}) }}
                    </li>
                    <li v-for="item in data.related.attitudes" :key="`${item.holder}-${item.object}`">{{ labeled(text("point.attitude"), text("point.attitudeFrom", {holder: nameOf(item.holder), object: nameOf(item.object)})) }}</li>
                    <li v-for="goal in data.related.goals" :key="goal">
                        {{ text("fmt.labelPrefix", {label: text("point.goal")}) }}<button type="button" class="text-[var(--accent-main)] hover:underline" @click="props.context.open({kind: 'entry', id: goal})">{{ nameOf(goal) }}</button>
                    </li>
                </ul>
                <p v-if="relatedMore > 0" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("point.moreRows", {count: relatedMore}) }}</p>
            </section>
        </template>
        <section>
            <h3 class="mb-1 font-semibold">{{ text("knowing.fields") }}</h3>
            <component :is="props.context.FieldTable" />
        </section>
    </div>
</template>
