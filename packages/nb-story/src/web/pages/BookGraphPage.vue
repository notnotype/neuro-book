<script setup lang="ts">
/**
 * 全书图（docs/specs/story/viewer.md 输出 30、31）：默认按章节（故事线），可切到按关联（对象、主线或逐段情节、秘密、
 * 悬念四类点，悬念默认不显示）。
 */
import {ContextMenu, Checkbox, Input, SegmentedControl} from "@notnotype/nb-ui/components";
import type {ContextMenuItem} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import {useBook} from "../host/book";
import {useStoryQuery} from "../host/query";
import PageState from "../parts/PageState.vue";
import type {ChapterWindow} from "../graph/ChapterRange.vue";
import StoryLine from "../graph/StoryLine.vue";
import SelectionBar from "../graph/SelectionBar.vue";
import StoryNetwork from "../graph/StoryNetwork.vue";

const book = useBook();
const arrange = ref<"storyline" | "force">("storyline");
const grain = ref<"arc" | "episode">("arc");
const TYPES = [{id: "entity", label: "对象"}, {id: "arc", label: "主线"}, {id: "episode", label: "情节"}, {id: "secret", label: "秘密"}, {id: "question", label: "悬念"}] as const;
const hidden = ref<string[]>(["question"]);
// 书关掉了秘密（ingest.md 输出 18）：没有这类点，类型开关与图例里也不出它。
const typeChips = computed(() => TYPES.filter(item => item.id !== (grain.value === "arc" ? "episode" : "arc") && (item.id !== "secret" || book.info.features.secrets)));
const hiddenTypes = computed(() => (book.info.features.secrets ? hidden.value : [...hidden.value, "secret"]));
const search = ref("");

const storyline = useStoryQuery("graph.storyline", () => (arrange.value === "storyline" ? {} : null));
const data = useStoryQuery("graph.book", () => (arrange.value === "force" ? {grain: grain.value, types: ["entity", "arc", "episode", "secret", "question"] as ("entity" | "arc" | "episode" | "secret" | "question")[]} : null), {keepOnForward: true});
const nodes = computed(() => (data.data.value?.nodes ?? []).map(node => ({id: node.id, label: node.label, kind: node.type === "entity" ? "person" : node.type, weight: node.weight, names: node.names ?? []})));
const dataEdges = computed(() => data.data.value?.edges ?? []);
const pinned = computed(() => (data.data.value?.nodes ?? []).filter(node => node.type === "entity").sort((a, b) => b.weight - a.weight).slice(0, 8).map(node => node.id));
function toggle(id: string): void {
    hidden.value = hidden.value.includes(id) ? hidden.value.filter(item => item !== id) : [...hidden.value, id];
}
const neighborhood = ref(false);
/** 按章节看着的章节范围（null 为全部）：放在页面里，换阅读位置重取故事线时不丢（审查 F07）。 */
const storyRange = ref<ChapterWindow | null>(null);
/**
 * 单击只选中（输出 27、31）；双击、Enter 或右键菜单按类型打开：对象打开人物卡，主线、情节、秘密、悬念跳到对应的页并
 * 定位。抽屉开着时，选中的对象跟着换人物卡。
 */
const selected = ref<string | null>(null);
const ACTION = {entity: "打开人物卡", arc: "看这条主线的情节", episode: "到情节页看这段", secret: "到秘密页看这一行", question: "到悬念页看这一条"} as const;
function onSelect(id: string): void {
    selected.value = id;
    if (book.drawer.value !== null && data.data.value?.nodes.find(node => node.id === id)?.type === "entity") book.openCard(id);
}
/** 选中的点；被隐藏的类型、换粒度后不在图里的点不算选中（浮条随之消失，图上也没有它）。 */
const selectedNode = computed(() => {
    const node = selected.value === null ? undefined : data.data.value?.nodes.find(item => item.id === selected.value);
    return node === undefined || hiddenTypes.value.includes(node.type) ? undefined : node;
});
watch(selectedNode, node => {
    if (node === undefined && selected.value !== null) selected.value = null;
});
const menu = ref<{id: string; x: number; y: number} | null>(null);
const menuItems = computed<ContextMenuItem[]>(() => {
    const target = menu.value;
    const node = target === null ? undefined : data.data.value?.nodes.find(item => item.id === target.id);
    if (target === null || node === undefined) return [];
    return [
        {label: ACTION[node.type], shortcut: "双击 / Enter", action: () => openNode(node.id)},
        {label: neighborhood.value ? "看全图" : "只看它的周边", shortcut: "F", action: () => (neighborhood.value = !neighborhood.value)},
        {separator: true},
        {label: "取消选中", shortcut: "Esc", action: () => (selected.value = null)},
    ];
});
function openNode(id: string): void {
    const node = data.data.value?.nodes.find(item => item.id === id);
    if (!node) return;
    if (node.type === "entity") book.openCard(node.id);
    else if (node.type === "arc") book.jump("episodes", {kind: "arc", id: node.id});
    else if (node.type === "episode") book.jump("episodes", {kind: "episode", id: node.id});
    else if (node.type === "secret") book.jump("secrets", {kind: "secret", id: node.id});
    else book.jump("questions", {kind: "question", id: node.id});
}
</script>

<template>
    <div class="story-page flex flex-col" data-testid="page-book-graph">
        <div class="flex flex-wrap items-center gap-2 px-3 py-2 select-none">
            <h1 class="story-page-title mb-0">全书图 <span class="sub">截至{{ book.atLabel.value }}</span></h1>
            <SegmentedControl v-model="arrange" size="xs" :options="[{value: 'storyline', label: '按章节'}, {value: 'force', label: '按关联'}]" aria-label="排布" />
            <template v-if="arrange === 'force'">
                <SegmentedControl v-model="grain" size="xs" :options="[{value: 'arc', label: '按主线'}, {value: 'episode', label: '逐段情节'}]" aria-label="情节的粒度" />
                <button v-for="type in typeChips" :key="type.id" type="button" class="story-chip" :class="hidden.includes(type.id) ? '' : 'is-on'" :aria-pressed="!hidden.includes(type.id)" @click="toggle(type.id)">{{ type.label }}</button>
                <Checkbox v-model="neighborhood" label="只看选中的周边" />
                <span class="text-[length:var(--text-2xs)] text-[var(--text-secondary)]">单击选中 · 双击打开 · 右键更多 · F 只看周边</span>
                <div class="ml-auto w-40"><Input v-model="search" size="sm" icon-class="i-lucide-search" placeholder="在图里找" /></div>
            </template>
        </div>
        <PageState class="px-3" :loading="(storyline.loading.value && !storyline.data.value) || (data.loading.value && !data.data.value)" :error="storyline.error.value?.message ?? data.error.value?.message ?? null" @retry="arrange === 'storyline' ? storyline.reload() : data.reload()" />
        <div class="relative min-h-0 flex-1">
            <StoryLine v-if="arrange === 'storyline' && storyline.data.value" v-model:range="storyRange" :storyline="storyline.data.value" :chapters="book.at.value.chapter" @select="(episode: string) => book.jump('episodes', {kind: 'episode', id: episode})" />
            <StoryNetwork
                v-else-if="arrange === 'force' && data.data.value" mode="data" :nodes="nodes" :data-edges="dataEdges" :hidden-types="hiddenTypes" :query="search" :pinned="pinned" :selected="selected"
                :neighborhood="neighborhood" @select="onSelect" @open="openNode" @menu="(payload: {id: string; x: number; y: number}) => (menu = payload)"
                @neighborhood="(value: boolean) => (neighborhood = value)" @clear="selected = null"
            >
                <template #overlay>
                    <SelectionBar v-if="selectedNode" :label="selectedNode.label" :open-label="ACTION[selectedNode.type]" @open="openNode(selectedNode.id)" @clear="selected = null" />
                </template>
            </StoryNetwork>
            <ContextMenu :visible="menu !== null" :x="menu?.x ?? 0" :y="menu?.y ?? 0" :items="menuItems" @close="menu = null" />
        </div>
        <p class="px-3 pb-2 text-[length:var(--text-2xs)] text-[var(--text-muted)]">
            <template v-if="arrange === 'storyline'">横轴是章，一行一个主要人物或事物，点是他参与的一段情节，竖线把同一段情节里的几个人连起来；悬停一个点显示章号与标题。</template>
            <template v-else>默认按主线聚合（线上写这个人在这条主线里出场的情节数），默认不显示悬念；点多时只显示出场多的名字，放大后逐级出现。</template>
        </p>
    </div>
</template>
