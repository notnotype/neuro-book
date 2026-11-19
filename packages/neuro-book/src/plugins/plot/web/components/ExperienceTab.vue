<script setup lang="ts">
/**
 * 人物页的“经历”（docs/specs/plot/author-ui.md 输出 18）：canon 的附加分页。他在场的剧情变更从新到旧，按章分段；每条写文字与同时在场
 * 的人，“记得原线上的”另带标记；点一条打开变更详情页。数据来自 `experience` 外部列表（一页 50 条）。
 */
import {computed} from "vue";

import {Button} from "@notnotype/nb-ui/components";

import type {CanonReads} from "nbook/plugins/canon/shared/reads";
import type {EntryTabContext} from "nbook/plugins/canon/web/component-views";

import type {AuthorExperienceItem} from "../../core/author/experience";
import type {AuthorOutputs, PlotAuthorClient} from "../author";
import {chapterIndex, chapterLabel, listOf} from "../labels";
import {usePlotText} from "../text";
import ReadFailure from "./ReadFailure.vue";

const props = defineProps<{
    context: EntryTabContext;
    reads: CanonReads;
    client: PlotAuthorClient;
}>();

const text = usePlotText();
type Page = AuthorOutputs["experience"];
const list = props.reads.useExternalList<{readonly person: string; readonly position: EntryTabContext["position"]; readonly mode: "actual" | "planned"}, Page>(
    "experience",
    () => ({person: props.context.entry, position: props.context.position, mode: props.context.mode}),
    (input, cursor, limit) => props.client.call("experience", {...input, ...(cursor === undefined ? {} : {cursor}), limit}),
    50,
);
const chaptersRead = props.reads.useRead("chapters", () => ({}));
const chapters = computed(() => chapterIndex(chaptersRead.value?.data?.items));
const data = computed(() => list.state.value?.data);
const nameOf = (id: string): string => data.value?.names[id]?.name ?? id;
/** 同一章挨着的几条是一段（服务已经从新到旧排好）。 */
const sections = computed(() => {
    const result: {chapter: string | null; items: AuthorExperienceItem[]}[] = [];
    for (const item of list.state.value?.items ?? []) {
        const last = result.at(-1);
        if (last !== undefined && last.chapter === item.chapter) last.items.push(item);
        else result.push({chapter: item.chapter, items: [item]});
    }
    return result;
});
const cast = (item: AuthorExperienceItem): string => listOf(item.cast.map((member) => ("who" in member ? nameOf(member.who) : member.label)), text);
</script>

<template>
    <div class="flex flex-col gap-4 text-[length:var(--text-sm)]" data-experience>
        <!-- 读到过的留着旧内容，失败的那一条放在上面；没读到过时只有它（canon/author-ui.md 输出 26）。 -->
        <ReadFailure v-if="list.state.value?.error" :failure="list.state.value.error" @retry="props.reads.retry()" />
        <p v-if="list.state.value === null || list.state.value.loading" role="status" aria-busy="true" class="text-[var(--text-muted)]">{{ text("page.loading") }}</p>
        <template v-else-if="list.state.value.data !== undefined">
            <p v-if="sections.length === 0" class="text-[var(--text-muted)]">{{ text("experience.empty") }}</p>
            <section v-for="(section, index) in sections" :key="`${section.chapter ?? 'prehistory'}-${index}`">
                <h3 class="mb-1 text-[length:var(--text-xs)] font-semibold text-[var(--text-muted)]">{{ chapterLabel(section.chapter, chapters, text) }}</h3>
                <ul class="divide-y divide-[var(--divider)]">
                    <li v-for="item in section.items" :key="item.change" class="py-1.5" data-experience-item>
                        <button type="button" class="text-left text-[var(--text-main)] hover:underline" @click="props.context.open({kind: 'change', id: item.change})">{{ item.text }}</button>
                        <span v-if="item.remembered" class="ml-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("experience.remembered") }}</span>
                        <p v-if="item.cast.length > 0" class="text-[length:var(--text-xs)] text-[var(--text-secondary)]">{{ text("experience.with", {names: cast(item)}) }}</p>
                    </li>
                </ul>
            </section>
            <Button v-if="list.state.value.more" size="sm" variant="ghost" @click="list.more()">{{ text("experience.earlier") }}</Button>
            <p v-if="(data?.uncast ?? 0) > 0" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("experience.uncast", {count: data?.uncast ?? 0}) }}</p>
        </template>
    </div>
</template>
