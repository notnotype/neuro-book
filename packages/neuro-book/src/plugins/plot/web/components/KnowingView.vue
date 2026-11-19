<script setup lang="ts">
/**
 * 人物页的“知道什么”（docs/specs/plot/author-ui.md 输出 16）：替换 `nbook.plot.knowing` 的通用字段表。两组（保密的事、别的事），每行
 * 程度、秘密的名字、他以为的那句或怎么知道、右边来处；下面一节是这一页的通用字段（可看来历、可改）。数据来自 `person` 外部读取。
 */
import {computed} from "vue";

import type {ComponentViewContext} from "nbook/plugins/canon/web/component-views";
import type {CanonReads} from "nbook/plugins/canon/shared/reads";

import type {PlotAuthorClient} from "../author";
import {chapterIndex, degreeLabel, knowingDetail, lineNameOf, originLabel} from "../labels";
import {usePlotText} from "../text";
import ReadFailure from "./ReadFailure.vue";

const props = defineProps<{
    context: ComponentViewContext;
    reads: CanonReads;
    client: PlotAuthorClient;
}>();

const text = usePlotText();
const read = props.reads.useExternal("person", () => ({person: props.context.entry, position: props.context.position, mode: props.context.mode}), (input) => props.client.call("person", input));
const data = computed(() => read.value?.data);
const chaptersRead = props.reads.useRead("chapters", () => ({}));
const chapters = computed(() => chapterIndex(chaptersRead.value?.data?.items));
const nameOf = (id: string | null): string => (id === null ? "" : (data.value?.names[id]?.name ?? id));
const lineName = (id: string): string => lineNameOf(id, props.reads.lineOptions.value, text);
const groups = computed(() => [
    {key: "secrets", title: text("knowing.secrets"), rows: data.value?.secrets ?? [], secret: true},
    {key: "others", title: text("knowing.others"), rows: data.value?.others ?? [], secret: false},
].filter((group) => group.rows.length > 0));
</script>

<template>
    <div class="flex flex-col gap-5 text-[length:var(--text-sm)]" data-knowing-view>
        <!-- 读到过的留着旧内容，失败的那一条放在上面；没读到过时只有它（canon/author-ui.md 输出 26）。 -->
        <ReadFailure v-if="read?.error" :failure="read.error" @retry="props.reads.retry()" />
        <p v-if="read === null || read.loading" role="status" aria-busy="true" class="text-[var(--text-muted)]">{{ text("page.loading") }}</p>
        <template v-else-if="data !== undefined">
            <p v-if="groups.length === 0" class="text-[var(--text-muted)]">{{ text("knowing.empty") }}</p>
            <section v-for="group in groups" :key="group.key">
                <h3 class="mb-1 font-semibold">{{ group.title }}</h3>
                <ul class="divide-y divide-[var(--divider)]">
                    <!-- 放不下时那句话换到下一行占满（basis-48），不挤成一列字；空的格不画（不占间距）。 -->
                    <li v-for="row in group.rows" :key="row.point" class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5" data-knowing-row>
                        <span class="w-14 shrink-0 text-[var(--text-secondary)]" data-cell="degree">{{ degreeLabel(row.degree, group.secret, text) }}</span>
                        <button type="button" class="min-w-0 text-left text-[var(--accent-main)] hover:underline" data-cell="name" @click="props.context.open({kind: 'entry', id: row.point})">{{ nameOf(row.point) }}</button>
                        <span v-if="knowingDetail(row, nameOf, text) !== ''" class="min-w-0 grow basis-48 text-[var(--text-secondary)]" data-cell="detail">{{ knowingDetail(row, nameOf, text) }}</span>
                        <span v-if="row.origin !== null" class="ml-auto text-[length:var(--text-xs)] text-[var(--text-muted)]" data-cell="origin">{{ originLabel(row.origin, chapters, lineName, text) }}</span>
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
