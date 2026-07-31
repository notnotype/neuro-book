<script setup lang="ts">
import {computed} from "vue";
import {VueFlow} from "@vue-flow/core";
import {Background} from "@vue-flow/background";
import {Controls} from "@vue-flow/controls";
import type {RpGraph} from "nbook/app/components/novel-ide/rp/rp-graph";
import {circleLayout} from "nbook/app/components/novel-ide/rp/rp-graph";

/** 通用关系图画布：地图（地点连接）与角色关系图共用。环形默认布局，节点可拖动（不持久化）。 */
const props = defineProps<{
    graph: RpGraph;
    /** 每个 type 的强调色（css color）；缺省用 accent。 */
    typeColors?: Record<string, string>;
    emptyHint: string;
    selectedNodeId?: string | null;
}>();

const emit = defineEmits<{
    selectNode: [nodeId: string];
}>();

const nodes = computed(() => {
    const positions = circleLayout(props.graph.nodes);
    return props.graph.nodes.map((node) => ({
        id: node.id,
        position: positions.get(node.id) ?? {x: 0, y: 0},
        data: {label: node.label, type: node.type},
        // 用默认节点渲染,样式经 style 注入
        label: node.label,
        style: {
            background: "var(--we-bg-panel, var(--bg-panel))",
            border: `${props.selectedNodeId === node.id ? "3px" : "1.5px"} solid ${props.typeColors?.[node.type] ?? "var(--accent-main)"}`,
            borderRadius: "8px",
            padding: "6px 10px",
            fontSize: "12px",
            color: "var(--we-text-main, var(--text-main))",
        },
    }));
});

const edges = computed(() => props.graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: false,
    style: {stroke: "var(--we-text-muted, var(--text-muted))", strokeWidth: 1.2},
    labelStyle: {fontSize: "10px", fill: "var(--we-text-secondary, var(--text-secondary))"},
    labelBgStyle: {fill: "var(--we-bg-panel, var(--bg-panel))", fillOpacity: 0.85},
})));
</script>

<template>
    <!-- RP 关系图画布容器 -->
    <div class="relative h-full w-full">
        <div v-if="!props.graph.nodes.length" class="absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-[12px] text-[var(--text-muted)]">{{ props.emptyHint }}</div>
        <VueFlow
            v-else
            :nodes="nodes"
            :edges="edges"
            :fit-view-on-init="true"
            :min-zoom="0.2"
            :max-zoom="2"
            :nodes-connectable="false"
            :edges-updatable="false"
            :delete-key-code="null"
            @node-click="emit('selectNode', $event.node.id)"
        >
            <Background :gap="20" />
            <Controls :show-interactive="false" />
        </VueFlow>
    </div>
</template>
