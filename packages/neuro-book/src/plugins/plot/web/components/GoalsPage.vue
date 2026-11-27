<script setup lang="ts">
/**
 * 目标表一页（docs/specs/plot/author-ui.md 输出 2 到 6、14、15）：canon 交的页头、按人筛、“也列达成与放弃的”、主要角色一组一组（可以
 * 收起）。数据来自一次 `goals` 外部列表（全部主要角色；按人筛在页面里做，筛选的候选就是这些组）。
 */
import {computed} from "vue";

import {Button, Select, Switch} from "@notnotype/nb-ui/components";

import type {CanonReads} from "nbook/plugins/canon/shared/reads";

import type {AuthorOutputs, PlotAuthorClient} from "../author";
import {chapterIndex} from "../labels";
import type {GoalsPageState} from "../pages";
import {pagedNames} from "../page-shell";
import {usePlotText} from "../text";
import GoalGroup from "./GoalGroup.vue";
import ReadFailure from "./ReadFailure.vue";

const props = defineProps<{
    reads: CanonReads;
    client: PlotAuthorClient;
    state: GoalsPageState;
    open: (id: string) => void;
}>();

const text = usePlotText();
const state = props.state;
const PageHead = props.reads.PageHead;
const position = props.reads.usePosition(() => state.position);
const chaptersRead = props.reads.useRead("chapters", () => ({}));
const chapters = computed(() => chapterIndex(chaptersRead.value?.data?.items));
type Page = AuthorOutputs["goals"];
const list = props.reads.useExternalList<{readonly position: NonNullable<typeof position.value>["position"]; readonly mode: "actual" | "planned"; readonly finished: boolean}, Page>(
    "goals",
    () => (position.value === null ? null : {position: position.value.position, mode: state.planned ? "planned" : "actual", finished: state.finished}),
    (input, cursor, limit) => props.client.call("goals", {...input, ...(cursor === undefined ? {} : {cursor}), limit}),
    50,
);
const data = computed(() => list.state.value?.data);
const names = computed(() => pagedNames(list.state.value));
const nameOf = (id: string): string => names.value[id]?.name ?? id;
const ALL = "all";
const holders = computed(() => [{value: ALL, label: text("goals.all")}, ...(list.state.value?.items ?? []).map((group) => ({value: group.holder, label: nameOf(group.holder)}))]);
/**
 * 选的人在这次读到的组里才筛：换位置或换线以后他可能不再是主要角色，这时按“所有主要角色”画（不说“还没有主要角色”）；标签状态
 * 不改，换回来还按他筛。
 */
const holder = computed(() => (state.holder !== null && (list.state.value?.items ?? []).some((group) => group.holder === state.holder) ? state.holder : null));
const groups = computed(() => (list.state.value?.items ?? []).filter((group) => holder.value === null || group.holder === holder.value));
const collapsed = (holder: string): boolean => state.collapsed.includes(holder);
const toggle = (holder: string): void => {
    state.collapsed = collapsed(holder) ? state.collapsed.filter((id) => id !== holder) : [...state.collapsed, holder];
};
const failure = computed(() => list.state.value?.error ?? null);
</script>

<template>
    <div class="min-h-full" data-plot-page="goals">
        <PageHead :title="text('editorPages.goals.title')" :position="state.position" :planned="state.planned" @update:position="(value: string) => (state.position = value)" @update:planned="(value: boolean) => (state.planned = value)" />
        <div class="mx-auto max-w-[760px] px-8 py-5 max-[480px]:px-4">
            <p v-if="props.reads.connection.value === 'no-project'" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("page.unbound") }}</p>
            <template v-else>
                <!-- 读到过的留着旧内容，失败的那一条放在上面；没读到过时只有它（canon/author-ui.md 输出 26）。 -->
                <ReadFailure v-if="failure !== null" class="mb-4" :failure="failure" @retry="props.reads.retry()" />
                <p v-if="list.state.value === null || list.state.value.loading" role="status" aria-busy="true" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("page.loading") }}</p>
                <template v-else-if="list.state.value.data !== undefined">
                <div class="mb-4 flex flex-wrap items-center gap-3">
                    <Select class="w-48" size="sm" :aria-label="text('goals.holderLabel')" :options="holders" :model-value="holder ?? ALL" @update:model-value="(value: string) => (state.holder = value === ALL ? null : value)" />
                    <label class="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                        <Switch size="sm" :model-value="state.finished" :aria-label="text('goals.finished')" @update:model-value="(value: boolean) => (state.finished = value)" />{{ text("goals.finished") }}
                    </label>
                </div>
                <p v-if="groups.length === 0" class="text-[length:var(--text-sm)] text-[var(--text-muted)]">{{ text("goals.empty") }}</p>
                <section v-for="group in groups" :key="group.holder" class="mb-6" data-goal-group>
                    <h2 class="flex items-center gap-2 text-[length:var(--text-base)] font-semibold">
                        <button type="button" class="i-lucide-chevron-down size-4 text-[var(--text-muted)] transition-transform motion-reduce:transition-none" :class="collapsed(group.holder) ? '-rotate-90' : ''" :aria-expanded="!collapsed(group.holder)" :aria-label="text(collapsed(group.holder) ? 'goals.expand' : 'goals.collapse', {name: nameOf(group.holder)})" @click="toggle(group.holder)" />
                        <button type="button" class="text-[var(--accent-main)] hover:underline" @click="props.open(group.holder)">{{ nameOf(group.holder) }}</button>
                    </h2>
                    <GoalGroup v-if="!collapsed(group.holder)" class="mt-2" :goals="group.goals" :attitudes="group.attitudes" :names="names" :chapters="chapters" @open="props.open" />
                </section>
                <Button v-if="list.state.value.more" size="sm" variant="ghost" @click="list.more()">{{ text("page.moreUnknown") }}</Button>
                </template>
            </template>
        </div>
    </div>
</template>
