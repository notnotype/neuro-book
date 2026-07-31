<script setup lang="ts">
import {computed, ref, watch} from "vue";
import DialogWindow from "nbook/app/components/common/DialogWindow.vue";
import RpGraphCanvas from "nbook/app/components/novel-ide/rp/RpGraphCanvas.vue";
import type {RpGraph, RpGraphNodeDetail} from "nbook/app/components/novel-ide/rp/rp-graph";

const props = defineProps<{
    modelValue: boolean;
    title: string;
    graph: RpGraph;
    details: RpGraphNodeDetail[];
    initialNodeId: string | null;
    typeColors: Record<string, string>;
    emptyHint: string;
}>();

const emit = defineEmits<{(event: "update:modelValue", value: boolean): void}>();
const selectedId = ref<string | null>(null);
const selected = computed(() => props.details.find((detail) => detail.id === selectedId.value) ?? null);
const nodeName = computed(() => new Map(props.graph.nodes.map((node) => [node.id, node.label])));
const connections = computed(() => props.graph.edges.filter((edge) => edge.source === selectedId.value || edge.target === selectedId.value).map((edge) => ({
    id: edge.id,
    label: edge.label,
    direction: edge.source === selectedId.value ? "指向" : "来自",
    peer: nodeName.value.get(edge.source === selectedId.value ? edge.target : edge.source) ?? (edge.source === selectedId.value ? edge.target : edge.source),
})));

watch(() => props.modelValue, (open) => {
    if (open) selectedId.value = props.initialNodeId ?? props.graph.nodes[0]?.id ?? null;
});
</script>

<template>
    <!-- RP 地图/关系图共用的大尺寸浮动查看器 -->
    <DialogWindow :model-value="modelValue" :title="title" :width="960" height="min(760px, calc(100vh - 48px))" body-class="p-0 overflow-hidden" @update:model-value="emit('update:modelValue', $event)">
        <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
            <div class="min-h-0 border-r border-[var(--border-color)]">
                <RpGraphCanvas :graph="graph" :type-colors="typeColors" :empty-hint="emptyHint" :selected-node-id="selectedId" @select-node="selectedId = $event" />
            </div>
            <aside class="min-h-0 overflow-y-auto p-4 custom-scrollbar">
                <div v-if="!selected" class="flex h-full items-center justify-center text-center text-[12px] text-[var(--text-muted)]">点击图中的节点查看详情</div>
                <template v-else>
                    <div class="text-[15px] font-semibold text-[var(--text-main)]">{{ selected.label }}</div>
                    <div class="mt-1 text-[10px] text-[var(--text-muted)]">{{ selected.category }} · {{ selected.id }}</div>
                    <p class="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-secondary)]">{{ selected.summary }}</p>
                    <dl v-if="selected.fields.length" class="mt-4 space-y-2 border-t border-[var(--border-color)] pt-3">
                        <div v-for="field in selected.fields" :key="field.label" class="grid grid-cols-[72px_minmax(0,1fr)] gap-2 text-[11px]"><dt class="text-[var(--text-muted)]">{{ field.label }}</dt><dd class="break-words text-[var(--text-main)]">{{ field.value }}</dd></div>
                    </dl>
                    <section class="mt-4 border-t border-[var(--border-color)] pt-3">
                        <div class="text-[11px] font-semibold text-[var(--text-main)]">关联节点</div>
                        <div v-if="!connections.length" class="mt-2 text-[11px] text-[var(--text-muted)]">暂无公开关联</div>
                        <button v-for="connection in connections" :key="connection.id" type="button" class="mt-1.5 block w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1.5 text-left text-[11px] hover:bg-[var(--bg-hover)]" @click="selectedId = graph.edges.find((edge) => edge.id === connection.id)?.source === selectedId ? graph.edges.find((edge) => edge.id === connection.id)?.target ?? null : graph.edges.find((edge) => edge.id === connection.id)?.source ?? null">
                            <span class="text-[var(--text-muted)]">{{ connection.direction }}</span> <span class="text-[var(--text-main)]">{{ connection.peer }}</span><span v-if="connection.label" class="ml-1 text-[var(--text-muted)]">· {{ connection.label }}</span>
                        </button>
                    </section>
                </template>
            </aside>
        </div>
    </DialogWindow>
</template>
