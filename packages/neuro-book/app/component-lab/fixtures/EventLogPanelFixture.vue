<script setup lang="ts">
import {computed, ref, watch} from "vue";
import EventLogPanel from "../EventLogPanel.vue";
import type {LabEventEntry} from "../event-log.types";

const props = defineProps<{scene: string; data?: unknown}>();

const entries = ref<LabEventEntry[]>([]);
let counter = 0;

const emptyText = computed(() => {
    const data = (props.data ?? {}) as Record<string, unknown>;
    return typeof data.emptyText === "string" ? data.emptyText : "还没有事件";
});

// 时间是造出来的固定值，不用 new Date()：同一场景重复打开要看到同样的列表。
const base = new Date(2026, 7, 31, 14, 30, 0);

function seed(): LabEventEntry[] {
    return [
        {id: "e4", name: "update:value", at: new Date(base.getTime() + 9000), payload: {tags: ["草稿"], pinned: true}},
        {id: "e3", name: "focus", at: new Date(base.getTime() + 6000)},
        {id: "e2", name: "update:collapsed", at: new Date(base.getTime() + 3000), payload: true},
        {id: "e1", name: "mounted", at: base},
    ];
}

watch(() => props.scene, (scene) => {
    counter = 0;
    entries.value = scene === "empty" ? [] : seed();
}, {immediate: true});

function pushEntry(payload?: unknown): void {
    counter += 1;
    entries.value = [
        {id: `manual-${counter}`, name: "click", at: new Date(base.getTime() + 10_000 + counter * 1000), payload},
        ...entries.value,
    ];
}
</script>

<template>
    <div class="flex h-full flex-col">
        <div class="flex shrink-0 gap-2 border-b border-[var(--border-color)] p-2">
            <button
                type="button"
                class="rounded border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                @click="pushEntry({index: counter + 1})"
            >
                加一条带负载的
            </button>
            <button
                type="button"
                class="rounded border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                @click="pushEntry()"
            >
                加一条无负载的
            </button>
            <button
                type="button"
                class="rounded border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                @click="entries = []"
            >
                清空
            </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
            <EventLogPanel :entries="entries" :empty-text="emptyText" />
        </div>
    </div>
</template>
