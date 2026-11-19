<script setup lang="ts">
/**
 * 人物页的“目标与态度”（docs/specs/plot/author-ui.md 输出 17）：替换 `nbook.plot.attitude` 的通用字段表。他的目标（各状态）画法同
 * 目标表的一组（`GoalGroup`）；态度另成一张表（对象、态度、起因、称呼）；下面一节是这一页的通用字段（态度）。数据来自 `person` 外部读取
 * （与“知道什么”同一个键，合并成一次）。
 */
import {computed} from "vue";

import type {CanonReads} from "nbook/plugins/canon/shared/reads";
import type {ComponentViewContext} from "nbook/plugins/canon/web/component-views";

import type {PlotAuthorClient} from "../author";
import {chapterIndex} from "../labels";
import {usePlotText} from "../text";
import GoalGroup from "./GoalGroup.vue";
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
const open = (id: string): void => props.context.open({kind: "entry", id});
const nameOf = (id: string | null): string => (id === null ? "" : (data.value?.names[id]?.name ?? id));
</script>

<template>
    <div class="flex flex-col gap-5 text-[length:var(--text-sm)]" data-attitude-view>
        <!-- 读到过的留着旧内容，失败的那一条放在上面；没读到过时只有它（canon/author-ui.md 输出 26）。 -->
        <ReadFailure v-if="read?.error" :failure="read.error" @retry="props.reads.retry()" />
        <p v-if="read === null || read.loading" role="status" aria-busy="true" class="text-[var(--text-muted)]">{{ text("page.loading") }}</p>
        <p v-else-if="data !== undefined && data.goals.length === 0 && data.attitudes.length === 0" class="text-[var(--text-muted)]">{{ text("goals.noGoals") }}</p>
        <template v-else-if="data !== undefined">
            <GoalGroup v-if="data.goals.length > 0" :goals="data.goals" :attitudes="[]" :names="data.names" :chapters="chapters" @open="open" />
            <section v-if="data.attitudes.length > 0">
                <h3 class="mb-1 font-semibold">{{ text("attitudes.title") }}</h3>
                <table class="w-full border-collapse text-left" :aria-label="text('attitudes.title')">
                    <thead>
                        <tr class="border-b border-[var(--divider)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
                            <th scope="col" class="py-1.5 pr-4 font-normal">{{ text("attitudes.object") }}</th>
                            <th scope="col" class="py-1.5 pr-4 font-normal">{{ text("attitudes.attitude") }}</th>
                            <th scope="col" class="py-1.5 pr-4 font-normal">{{ text("attitudes.cause") }}</th>
                            <th scope="col" class="py-1.5 font-normal">{{ text("attitudes.address") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="attitude in data.attitudes" :key="attitude.object" class="border-b border-[var(--divider)] align-baseline" data-attitude-row>
                            <td class="py-1.5 pr-4"><button type="button" class="text-[var(--accent-main)] hover:underline" @click="open(attitude.object)">{{ nameOf(attitude.object) }}</button></td>
                            <td class="py-1.5 pr-4 text-[var(--text-secondary)]">{{ attitude.notReduced ? text("goals.notReduced") : (attitude.态度 ?? "") }}</td>
                            <td class="py-1.5 pr-4">
                                <button v-if="attitude.起因 !== null" type="button" class="text-[var(--accent-main)] hover:underline" @click="open(attitude.起因)">{{ nameOf(attitude.起因) }}</button>
                            </td>
                            <td class="py-1.5 text-[var(--text-secondary)]">{{ attitude.称呼 ?? "" }}</td>
                        </tr>
                    </tbody>
                </table>
            </section>
        </template>
        <section>
            <h3 class="mb-1 font-semibold">{{ text("knowing.fields") }}</h3>
            <component :is="props.context.FieldTable" />
        </section>
    </div>
</template>
