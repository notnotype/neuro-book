<script setup lang="ts">
/**
 * 关系图（docs/specs/story/viewer.md 输出 22 到 28）：类别开关、连线的三层与同场门槛、视角、三种排版、“只看选中的周边”、
 * 图里搜名字。单击一个点只选中它；双击、Enter 或右键菜单打开人物卡（人物，停在关系页签）或连线说明；F 或右键菜单
 * 切换“只看周边”。右侧抽屉已经开着时，跟着选中的点换内容。
 */
import {ContextMenu, Checkbox, Input, Select, IconButton, Popover, SegmentedControl, Slider} from "@notnotype/nb-ui/components";
import type {ContextMenuItem} from "@notnotype/nb-ui/components";
import {computed, ref, watch} from "vue";

import type {EntityKind} from "../../core/dataset";
import {useBook} from "../host/book";
import {readRelationsView, strongestEdges, writeRelationsView} from "../host/relations-view";
import {useStoryQuery} from "../host/query";
import PageState from "../parts/PageState.vue";
import SelectionBar from "../graph/SelectionBar.vue";
import StoryNetwork, {type GraphLayout} from "../graph/StoryNetwork.vue";

const book = useBook();
const KIND_GROUPS: ReadonlyArray<{id: string; label: string; kinds: EntityKind[]}> = [
    {id: "person", label: "人物", kinds: ["person", "persona"]},
    {id: "group", label: "组织", kinds: ["group"]},
    {id: "item", label: "物品", kinds: ["item"]},
    {id: "place", label: "地点", kinds: ["place"]},
    {id: "concept", label: "概念", kinds: ["concept", "other"]},
    {id: "task", label: "任务", kinds: ["task"]},
];
const LAYERS = [{id: "relation", label: "关系说法"}, {id: "co", label: "同场"}, {id: "know", label: "认知"}] as const;

// 控件的选择（类别、连线层、门槛、排版、只看周边、无名角色）存在浏览器偏好里，刷新、换书后仍是这样（反馈 4）。
const saved = readRelationsView();
const kindIds = ref<string[]>(saved.kindIds);
const layers = ref<string[]>(saved.layers);
const minTogether = ref(saved.minTogether);
const layout = ref<GraphLayout>(saved.layout);
const relayoutKey = ref(0);
const neighborhood = ref(saved.neighborhood);
const showAnonymous = ref(saved.showAnonymous);
const strongOnly = ref(saved.strongOnly);
watch([kindIds, layers, minTogether, layout, neighborhood, showAnonymous, strongOnly], () => writeRelationsView({kindIds: kindIds.value, layers: layers.value, minTogether: minTogether.value, layout: layout.value, neighborhood: neighborhood.value, showAnonymous: showAnonymous.value, strongOnly: strongOnly.value}), {deep: true});
const search = ref("");
const kinds = computed(() => KIND_GROUPS.filter(group => kindIds.value.includes(group.id)).flatMap(group => group.kinds));

// 阅读位置往后挪时新数据回来之前留着旧图，图从上一章“长”到这一章（issue 268）；往前挪、换视角或类别仍先清空。
const graph = useStoryQuery("graph.relations", () => ({kinds: kinds.value, perspective: book.perspective.value, ...(showAnonymous.value ? {includeAnonymous: true} : {})}), {keepOnForward: true});
const character = computed(() => book.perspective.value !== "reader");
const shownLayers = computed(() => (character.value ? layers.value.filter(layer => layer !== "know") : layers.value));
const perspectiveOptions = computed(() => [{value: "reader", label: "读者"}, ...(graph.data.value?.perspectives ?? []).map(item => ({value: item.id, label: item.label}))]);
const nodes = computed(() => (graph.data.value?.nodes ?? []).map(node => ({id: node.id, label: node.label, kind: node.kind, weight: node.mentions, names: node.names ?? []})));
const allEdges = computed(() => (graph.data.value?.edges ?? []).map(edge => ({a: edge.a, b: edge.b, word: edge.relation?.word ?? null, statements: edge.relation?.statements ?? 0, together: edge.together, ab: edge.knows?.ab ?? 0, ba: edge.knows?.ba ?? 0, identity: edge.identity})));
const edges = computed(() => (strongOnly.value ? strongestEdges(allEdges.value, {layers: shownLayers.value, minCo: minTogether.value, knowsAllowed: true}) : allEdges.value));
/** 主要人物：出场最多的几个人物，名字加粗、点一下打开人物卡。 */
const pinned = computed(() => (graph.data.value?.nodes ?? []).filter(node => node.kind === "person" || node.kind === "persona").slice(0, 8).map(node => node.id));
// 选中的点：打开页面时沿用抽屉里正开着的对象。
const selected = ref<string | null>(book.drawer.value?.kind === "card" ? book.drawer.value.entity : book.drawer.value?.kind === "node" ? book.drawer.value.id : null);
const isPerson = (kind: string) => kind === "person" || kind === "persona";
const selectedNode = computed(() => (selected.value === null ? undefined : graph.data.value?.nodes.find(node => node.id === selected.value)));

/** 右键菜单（输出 27）：打开、只看周边或看全图、取消选中；快捷键写在条目右边。 */
const menu = ref<{id: string; x: number; y: number} | null>(null);
const menuItems = computed<ContextMenuItem[]>(() => {
    const target = menu.value;
    const node = target === null ? undefined : graph.data.value?.nodes.find(item => item.id === target.id);
    if (target === null || node === undefined) return [];
    return [
        {label: isPerson(node.kind) ? `打开${node.label}的人物卡` : `${node.label}的连线说明`, iconClass: isPerson(node.kind) ? "i-lucide-id-card" : "i-lucide-share-2", shortcut: "双击 / Enter", action: () => open(node.id)},
        {label: neighborhood.value ? "看全图" : "只看它的周边", iconClass: neighborhood.value ? "i-lucide-maximize-2" : "i-lucide-focus", shortcut: "F", action: () => (neighborhood.value = !neighborhood.value)},
        {separator: true},
        {label: "取消选中", shortcut: "Esc", action: () => (selected.value = null)},
    ];
});

/** 角色视角的说明（输出 28）：平时只是视角选择旁的一个小标记，点开看完整的不合并列表。 */
const perspectiveNote = computed(() => {
    const data = graph.data.value;
    if (!data || data.view.perspective === "reader") return null;
    const label = new Map(data.nodes.map(node => [node.id, node.label]));
    const who = perspectiveOptions.value.find(option => option.value === book.perspective.value)?.label ?? book.perspective.value;
    return {
        who,
        statements: data.view.statements,
        unmerged: data.view.unmerged.map(pair => `${label.get(pair.a) ?? pair.a}与${label.get(pair.b) ?? pair.b}`),
    };
});

function toggleIn(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter(item => item !== id) : [...list, id];
}
function open(id: string): void {
    const node = graph.data.value?.nodes.find(item => item.id === id);
    if (node && isPerson(node.kind)) book.openCard(id, "relations");
    else book.openNode(id, node?.label ?? id);
}
function onSelect(id: string): void {
    selected.value = id;
    // 抽屉开着时跟着换；关着时只选中，等用户在小卡片上点打开。
    if (book.drawer.value !== null) open(id);
}
</script>

<template>
    <div class="story-page flex flex-col" data-testid="page-relations">
        <div class="flex flex-wrap items-center gap-2 px-3 pt-2 select-none">
            <h1 class="story-page-title mb-0">关系图 <span class="sub">截至{{ book.atLabel.value }}</span></h1>
            <button v-for="group in KIND_GROUPS" :key="group.id" type="button" class="story-chip" :class="kindIds.includes(group.id) ? 'is-on' : ''" :aria-pressed="kindIds.includes(group.id)" @click="kindIds = toggleIn(kindIds, group.id)">{{ group.label }}</button>
            <span class="mx-1 h-4 w-px bg-[var(--divider)]" />
            <template v-for="layer in LAYERS" :key="layer.id">
                <button v-if="layer.id !== 'know' || !character" type="button" class="story-chip" :class="layers.includes(layer.id) ? 'is-on' : ''" :aria-pressed="layers.includes(layer.id)" :data-layer="layer.id" @click="layers = toggleIn(layers, layer.id)">{{ layer.label }}</button>
            </template>
            <template v-if="layers.includes('co')">
                <span class="whitespace-nowrap text-[length:var(--text-xs)]">同场至少 {{ minTogether }} 次</span>
                <div class="w-20"><Slider v-model="minTogether" :min="1" :max="8" size="sm" aria-label="同场至少几次" /></div>
            </template>
        </div>
        <div class="flex flex-wrap items-center gap-2 px-3 py-2 text-[length:var(--text-xs)] select-none">
            <span class="text-[var(--text-secondary)]">视角</span>
            <div class="w-36"><Select :model-value="book.perspective.value" size="sm" :options="perspectiveOptions" data-testid="perspective" @update:model-value="(value: string) => (book.perspective.value = value)" /></div>
            <Popover v-if="perspectiveNote" side="bottom" align="start">
                <template #trigger>
                    <button type="button" class="story-chip is-on" data-testid="perspective-banner">{{ perspectiveNote.statements }} 条说法<template v-if="perspectiveNote.unmerged.length"> · {{ perspectiveNote.unmerged.length }} 处不合并</template></button>
                </template>
                <div class="max-w-[360px] text-[length:var(--text-xs)]" data-testid="perspective-detail">
                    <p>以{{ perspectiveNote.who }}的视角：用了 {{ perspectiveNote.statements }} 条他知道、读到、听说或认为的说法。</p>
                    <template v-if="perspectiveNote.unmerged.length">
                        <p class="mt-1">他不把这些看作同一人：</p>
                        <ul class="mt-0.5 list-disc pl-4"><li v-for="pair in perspectiveNote.unmerged" :key="pair">{{ pair }}</li></ul>
                    </template>
                </div>
            </Popover>
            <span class="text-[var(--text-secondary)]">排版</span>
            <SegmentedControl v-model="layout" size="xs" :options="[{value: 'force', label: '力导向'}, {value: 'concentric', label: '同心'}, {value: 'circle', label: '环形'}, {value: 'stress', label: '应力'}]" aria-label="排版方式" />
            <IconButton size="xs" icon-class="i-lucide-refresh-cw" aria-label="重新排版" title="重新排版" @click="relayoutKey += 1" />
            <Checkbox v-model="neighborhood" label="只看选中的周边" />
            <Checkbox v-model="strongOnly" label="只画最强的线" title="每个点只留它最强的三条线，图上的线少一些" data-testid="strong-only" />
            <Checkbox v-model="showAnonymous" label="显示无名角色" title="只有“学姐”“新生”这类泛称的人物，默认不画" data-testid="show-anonymous" />
            <span class="text-[length:var(--text-2xs)] text-[var(--text-secondary)]" data-testid="graph-hint">单击选中 · 双击打开 · 右键更多 · F 只看周边 · Esc 取消</span>
            <div class="ml-auto w-40"><Input v-model="search" size="sm" icon-class="i-lucide-search" placeholder="在图里找" /></div>
        </div>
        <PageState class="px-3" :loading="graph.loading.value && !graph.data.value" :error="graph.error.value?.message ?? null" @retry="graph.reload()" />
        <div class="relative min-h-0 flex-1" data-testid="relation-graph">
            <StoryNetwork
                v-if="graph.data.value" mode="relation" :nodes="nodes" :edges="edges" :layers="shownLayers" :min-co="minTogether" :layout="layout" :relayout-key="relayoutKey"
                :neighborhood="neighborhood" :query="search" :pinned="pinned" :selected="selected"
                @select="onSelect" @open="open" @menu="(payload: {id: string; x: number; y: number}) => (menu = payload)" @neighborhood="(value: boolean) => (neighborhood = value)" @clear="selected = null"
            >
                <template #overlay>
                    <SelectionBar v-if="selectedNode" :label="selectedNode.label" :open-label="isPerson(selectedNode.kind) ? '打开人物卡' : '看连线说明'" @open="open(selectedNode.id)" @clear="selected = null" />
                </template>
            </StoryNetwork>
            <ContextMenu :visible="menu !== null" :x="menu?.x ?? 0" :y="menu?.y ?? 0" :items="menuItems" @close="menu = null" />
        </div>
    </div>
</template>
