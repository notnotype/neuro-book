<script setup lang="ts">
import {computed, ref} from "vue";
import RpGraphCanvas from "nbook/app/components/novel-ide/rp/RpGraphCanvas.vue";
import RpGraphWindow from "nbook/app/components/novel-ide/rp/RpGraphWindow.vue";
import type {RpGraph, RpGraphNodeDetail} from "nbook/app/components/novel-ide/rp/rp-graph";
import type {RpPlayerCharacterCategoryDto, RpRuntimeOverviewDto} from "nbook/shared/dto/rp-runtime.dto";

const props = defineProps<{
    roster: RpRuntimeOverviewDto["roster"] | null;
    characters: RpRuntimeOverviewDto["characters"];
    graph: RpGraph;
}>();

const expandedId = ref<string | null>(null);
const graphWindowOpen = ref(false);
const graphInitialNodeId = ref<string | null>(null);
const categoryOrder: RpPlayerCharacterCategoryDto[] = ["player", "major", "resident", "named", "major_inactive", "other"];
const categoryLabels: Record<RpPlayerCharacterCategoryDto, string> = {
    player: "玩家化身", major: "主要角色", resident: "常驻角色", named: "具名角色", major_inactive: "非活跃主要角色", other: "其他角色",
};
const groups = computed(() => categoryOrder.map((category) => ({
    category,
    label: categoryLabels[category],
    items: props.characters.filter((character) => character.category === category),
})).filter((group) => group.items.length > 0));
const characterNameMap = computed(() => new Map(props.characters.map((character) => [character.id, character.name])));
const details = computed<RpGraphNodeDetail[]>(() => props.characters.map((character) => ({
    id: character.id,
    label: character.name,
    category: categoryLabels[character.category],
    summary: character.playerSummary,
    fields: [
        {label: "叙事身份", value: character.narrativeRole},
        ...(character.currentLocationId ? [{label: "当前位置", value: character.currentLocationId}] : []),
        ...(character.lastSeenTick !== null ? [{label: "最后出现", value: `Tick ${character.lastSeenTick}`}] : []),
    ],
})));

/** 从缩略图节点进入大图，并保持当前节点选中。 */
function openGraph(nodeId: string | null = null): void {
    graphInitialNodeId.value = nodeId;
    graphWindowOpen.value = true;
}
</script>

<template>
    <!-- RP 全类型角色名册与正式关系图 -->
    <div class="flex min-h-0 flex-1 flex-col">
        <div class="min-h-0 flex-[3] overflow-y-auto p-3 custom-scrollbar">
            <div v-if="roster?.suggestions.length" class="mb-3 rounded-md border border-[var(--status-info-border)] bg-[var(--status-info-bg)] p-2.5">
                <div class="text-[11px] font-semibold text-[var(--status-info)]">角色擢升建议</div>
                <div v-for="suggestion in roster.suggestions" :key="suggestion.id" class="mt-1.5 text-[10px] leading-relaxed text-[var(--text-secondary)]">{{ characterNameMap.get(suggestion.npcId) ?? suggestion.npcId }} → {{ categoryLabels[suggestion.targetTier] }}：{{ suggestion.reason }}</div>
            </div>

            <div v-if="!characters.length" class="py-8 text-center text-[11px] text-[var(--text-muted)]">还没有角色登场。</div>
            <section v-for="group in groups" :key="group.category" class="mb-4">
                <div class="mb-1.5 flex items-center gap-2 text-[10px] font-semibold text-[var(--text-muted)]"><span>{{ group.label }}</span><span class="rounded bg-[var(--bg-input)] px-1.5 py-0.5">{{ group.items.length }}</span></div>
                <article v-for="character in group.items" :key="character.id" class="mb-2 overflow-hidden rounded-md border border-[var(--border-color)]">
                    <button type="button" class="flex w-full items-center justify-between gap-2 bg-[var(--bg-input)] px-2.5 py-2 text-left hover:bg-[var(--bg-hover)]" @click="expandedId = expandedId === character.id ? null : character.id">
                        <span class="flex min-w-0 items-center gap-2"><span :class="character.category === 'player' ? 'i-lucide-circle-user-round' : 'i-lucide-user'" class="h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span><span class="truncate text-[12px] font-semibold text-[var(--text-main)]">{{ character.name }}</span></span>
                        <span :class="expandedId === character.id ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"></span>
                    </button>
                    <div v-if="expandedId === character.id" class="px-2.5 py-2 text-[11px]">
                        <p class="leading-relaxed text-[var(--text-secondary)]">{{ character.playerSummary }}</p>
                        <div class="mt-1 text-[var(--text-muted)]">{{ character.narrativeRole }}<span v-if="character.currentLocationId"> · {{ character.currentLocationId }}</span></div>
                    </div>
                </article>
            </section>
        </div>
        <div class="flex min-h-0 flex-[2] flex-col border-t border-[var(--border-color)]">
            <div class="flex h-8 shrink-0 items-center justify-between border-b border-[var(--border-color)] px-2.5"><span class="text-[10px] font-semibold text-[var(--text-muted)]">角色关系图</span><button type="button" class="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="openGraph()"><span class="i-lucide-maximize-2 h-3 w-3"></span>放大查看</button></div>
            <div class="min-h-0 flex-1"><RpGraphCanvas :graph="graph" :type-colors="{character: 'var(--accent-main)'}" empty-hint="角色已显示；当前还没有公开关系。" @select-node="openGraph($event)" /></div>
        </div>
        <RpGraphWindow v-model="graphWindowOpen" title="角色关系图" :graph="graph" :details="details" :initial-node-id="graphInitialNodeId" :type-colors="{character: 'var(--accent-main)'}" empty-hint="当前还没有角色。" />
    </div>
</template>
