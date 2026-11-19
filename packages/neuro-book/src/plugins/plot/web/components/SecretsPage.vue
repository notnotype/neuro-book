<script setup lang="ts">
/**
 * “谁知道什么”一页（docs/specs/plot/author-ui.md 输出 2 到 10）：canon 交的页头（位置、按计划、线），分段筛选，选要看的人，表。
 * 数据来自一次 `secrets` 外部列表（同一份读取输入给行、条数、候选、名字表），挂在窗口的读取层里，世界变了与 canon 的读取同一轮换上。
 * 页面状态（位置、按计划、分段、选的人）在标签上，切走再回来不变。
 */
import {computed, shallowRef} from "vue";

import {Button, SegmentedControl} from "@notnotype/nb-ui/components";

import type {CanonReads} from "nbook/plugins/canon/shared/reads";

import type {SecretSegment} from "../../core/author/secrets";
import type {AuthorOutputs, PlotAuthorClient} from "../author";
import {chapterIndex} from "../labels";
import {NARROW_WIDTH, pagedNames, useContainerWidth} from "../page-shell";
import type {SecretsPageState} from "../pages";
import {usePlotText} from "../text";
import PeoplePicker from "./PeoplePicker.vue";
import SecretsMatrix from "./SecretsMatrix.vue";
import ReadFailure from "./ReadFailure.vue";

const props = defineProps<{
    reads: CanonReads;
    client: PlotAuthorClient;
    state: SecretsPageState;
    open: (id: string) => void;
}>();

const text = usePlotText();
const state = props.state;
const PageHead = props.reads.PageHead;
const position = props.reads.usePosition(() => state.position);
const chaptersRead = props.reads.useRead("chapters", () => ({}));
const chapters = computed(() => chapterIndex(chaptersRead.value?.data?.items));
const mode = computed(() => (state.planned ? "planned" as const : "actual" as const));

type Page = AuthorOutputs["secrets"];
const list = props.reads.useExternalList<{readonly position: NonNullable<typeof position.value>["position"]; readonly mode: "actual" | "planned"; readonly segment: SecretSegment; readonly people?: string[]}, Page>(
    "secrets",
    () => (position.value === null ? null : {position: position.value.position, mode: mode.value, segment: state.segment, ...(state.people === null ? {} : {people: state.people})}),
    (input, cursor, limit) => props.client.call("secrets", {...input, ...(cursor === undefined ? {} : {cursor}), limit}),
    200,
);
const data = computed(() => list.state.value?.data);
const people = computed(() => state.people ?? [...(data.value?.people ?? [])]);
const names = computed(() => pagedNames(list.state.value));
const candidates = computed(() => (data.value?.candidates ?? []).map((id) => ({id, name: names.value[id]?.name ?? id})).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
const SEGMENT_LABELS = {all: "secrets.segments.all", readerOnly: "secrets.segments.readerOnly", readerUnaware: "secrets.segments.readerUnaware", noPlan: "secrets.segments.noPlan"} as const;
const segments = computed(() => (["all", "readerOnly", "readerUnaware", "noPlan"] as const).map((value) => ({value, label: text(SEGMENT_LABELS[value]), count: data.value?.counts[value] ?? 0})));
const now = computed(() => {
    const at = position.value?.position;
    return at === undefined || at.kind === "initial" ? 0 : (chapters.value.get(at.chapter) ?? 0);
});
const failure = computed(() => list.state.value?.error ?? null);
const remaining = computed(() => {
    const total = data.value?.counts[state.segment];
    return total === undefined ? null : Math.max(0, total - (list.state.value?.items.length ?? 0));
});

const root = shallowRef<HTMLElement | null>(null);
const width = useContainerWidth(root);
</script>

<template>
    <div ref="root" class="min-h-full" data-plot-page="secrets">
        <PageHead :title="text('editorPages.secrets.title')" :position="state.position" :planned="state.planned" wide @update:position="(value: string) => (state.position = value)" @update:planned="(value: boolean) => (state.planned = value)" />
        <div class="mx-auto max-w-[1100px] px-8 py-5 max-[480px]:px-4">
            <p v-if="props.reads.connection.value === 'no-project'" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("page.unbound") }}</p>
            <template v-else>
                <!-- 读到过的留着旧内容，失败的那一条放在上面；没读到过时只有它（canon/author-ui.md 输出 26）。 -->
                <ReadFailure v-if="failure !== null" class="mb-4" :failure="failure" @retry="props.reads.retry()" />
                <p v-if="list.state.value === null || list.state.value.loading" role="status" aria-busy="true" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("page.loading") }}</p>
                <template v-else-if="list.state.value.data !== undefined">
                <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <SegmentedControl size="sm" wrap :aria-label="text('secrets.segments.label')" :options="segments" :model-value="state.segment" @update:model-value="(value) => (state.segment = value as SecretSegment)" />
                    <PeoplePicker :candidates="candidates" :model-value="people" @update:model-value="(value: string[]) => (state.people = value)" />
                </div>
                <p v-if="list.state.value.items.length === 0" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("secrets.empty") }}</p>
                <SecretsMatrix v-else :rows="list.state.value.items" :people="people" :names="names" :chapters="chapters" :now="now" :compact="width < NARROW_WIDTH" @open="props.open" />
                <Button v-if="list.state.value.more" class="mt-3" size="sm" variant="ghost" @click="list.more()">{{ remaining === null ? text("page.moreUnknown") : text("page.more", {count: remaining}) }}</Button>
                </template>
            </template>
        </div>
    </div>
</template>
