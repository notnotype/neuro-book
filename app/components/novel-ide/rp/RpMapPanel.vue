<script setup lang="ts">
import {computed, ref} from "vue";
import RpGraphCanvas from "nbook/app/components/novel-ide/rp/RpGraphCanvas.vue";
import RpGraphWindow from "nbook/app/components/novel-ide/rp/RpGraphWindow.vue";
import type {RpGraph, RpGraphNodeDetail} from "nbook/app/components/novel-ide/rp/rp-graph";
import type {RpRuntimeOverviewDto} from "nbook/shared/dto/rp-runtime.dto";

const props = defineProps<{map: RpRuntimeOverviewDto["map"] | null; graph: RpGraph}>();
const levelLabels: Record<string, string> = {world: "世界", region: "区域", town: "城镇", district: "分区", building: "建筑", sub_location: "子地点"};
const statusLabels: Record<string, string> = {rumored: "传闻", discovered: "已发现", familiar: "熟悉", unavailable: "不可用", destroyed: "已毁坏"};
const graphWindowOpen = ref(false);
const graphInitialNodeId = ref<string | null>(null);

const flattenedNodes = computed(() => {
    const nodes = props.map?.nodes ?? [];
    const children = new Map<string | null, typeof nodes>();
    for (const node of nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
    const result: Array<{node: typeof nodes[number]; depth: number}> = [];
    const visited = new Set<string>();
    /** 深度优先展开稳定地图目录，同时阻断异常环。 */
    function visit(parentId: string | null, depth: number): void {
        for (const node of children.get(parentId) ?? []) {
            if (visited.has(node.id)) continue;
            visited.add(node.id);
            result.push({node, depth});
            visit(node.id, depth + 1);
        }
    }
    visit(null, 0);
    for (const node of nodes) if (!visited.has(node.id)) result.push({node, depth: 0});
    return result;
});
const details = computed<RpGraphNodeDetail[]>(() => (props.map?.nodes ?? []).map((node) => ({
    id: node.id,
    label: node.label,
    category: levelLabels[node.level] ?? node.level,
    summary: node.summary,
    fields: [
        {label: "状态", value: statusLabels[node.status] ?? node.status},
        ...(node.approximateDirection ? [{label: "方向", value: node.approximateDirection}] : []),
        ...(node.parentId ? [{label: "上级地点", value: props.map?.nodes.find((parent) => parent.id === node.parentId)?.label ?? node.parentId}] : []),
    ],
})));

/** 从缩略图节点进入大图，并保持当前节点选中。 */
function openGraph(nodeId: string | null = null): void {
    graphInitialNodeId.value = nodeId;
    graphWindowOpen.value = true;
}
</script>

<template>
    <!-- 玩家安全的层级地图目录与大图入口 -->
    <div class="flex min-h-0 flex-1 flex-col">
        <div class="min-h-0 flex-[3] overflow-y-auto p-3 custom-scrollbar">
            <div v-if="!flattenedNodes.length" class="py-8 text-center text-[11px] text-[var(--text-muted)]">地图仍是空白。新地点会随着玩家探索自动固化在这里。</div>
            <div v-for="item in flattenedNodes" :key="item.node.id" class="mb-1.5" :style="{paddingLeft: `${Math.min(item.depth, 6) * 14}px`}">
                <button type="button" class="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2 text-left hover:bg-[var(--bg-hover)]" @click="openGraph(item.node.id)">
                    <div class="flex items-center gap-1.5"><span class="i-lucide-map-pin h-3.5 w-3.5 shrink-0 text-[var(--accent-main)]"></span><span class="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-main)]">{{ item.node.label }}</span><span class="shrink-0 rounded bg-[var(--bg-input)] px-1 py-0.5 text-[9px] text-[var(--text-muted)]">{{ levelLabels[item.node.level] ?? item.node.level }}</span><span class="shrink-0 text-[9px]" :class="['unavailable', 'destroyed'].includes(item.node.status) ? 'text-[var(--status-danger)]' : 'text-[var(--text-muted)]'">{{ statusLabels[item.node.status] ?? item.node.status }}</span></div>
                    <div v-if="item.node.summary" class="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[var(--text-secondary)]">{{ item.node.summary }}</div>
                    <div v-if="item.node.approximateDirection" class="mt-1 text-[9px] text-[var(--text-muted)]">方向：{{ item.node.approximateDirection }}</div>
                </button>
            </div>
            <div v-if="map?.routes.length" class="mt-3 rounded-md border border-[var(--border-color)] p-2.5"><div class="mb-1.5 text-[11px] font-semibold text-[var(--text-main)]">已知路线</div><div v-for="route in map.routes" :key="route.id" class="flex items-center gap-1 py-0.5 text-[10px] text-[var(--text-secondary)]"><span class="truncate">{{ route.label || `${route.fromId} → ${route.toId}` }}</span><span v-if="route.distance" class="shrink-0 text-[var(--text-muted)]">· {{ route.distance }}</span><span v-if="route.status !== 'active'" class="shrink-0 text-[var(--status-danger)]">· {{ route.status }}</span></div></div>
        </div>
        <div class="flex min-h-0 flex-[2] flex-col border-t border-[var(--border-color)]">
            <div class="flex h-8 shrink-0 items-center justify-between border-b border-[var(--border-color)] px-2.5"><span class="text-[10px] font-semibold text-[var(--text-muted)]">地点关系图</span><button type="button" class="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="openGraph()"><span class="i-lucide-maximize-2 h-3 w-3"></span>放大查看</button></div>
            <div class="min-h-0 flex-1"><RpGraphCanvas :graph="graph" :type-colors="{location: 'var(--status-success)'}" empty-hint="尚未登记玩家可见地点。" @select-node="openGraph($event)" /></div>
        </div>
        <RpGraphWindow v-model="graphWindowOpen" title="玩家地图" :graph="graph" :details="details" :initial-node-id="graphInitialNodeId" :type-colors="{location: 'var(--status-success)'}" empty-hint="尚未登记玩家可见地点。" />
    </div>
</template>
