<script setup lang="ts">
import {computed} from "vue";
import EventLogPanel from "../EventLogPanel.vue";
import type {LabEventEntry} from "../event-log.types";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof EventLogPanel>(() => props.input);

// Date 属于 fixture 的确定性运行时道具；登记 JSON 只包含 id/name/payload。
const base = new Date(2026, 7, 31, 14, 30, 0);
const entries = computed<LabEventEntry[]>(() => {
    const values = subject.bindings.value.entries;
    return values.map((entry, index) => ({
        ...entry,
        at: new Date(base.getTime() + (values.length - 1 - index) * 3000),
    }));
});

function writeEntries(next: typeof subject.bindings.value.entries): void {
    subject.write("props", "entries", next);
}

function pushEntry(withPayload: boolean): void {
    const next = subject.bindings.value.entries;
    const counter = next.filter((entry) => entry.id.startsWith("manual-")).length + 1;
    writeEntries([
        {id: `manual-${counter}`, name: "click", ...(withPayload ? {payload: {index: counter}} : {})},
        ...next,
    ]);
}
</script>

<template>
    <div class="flex h-full flex-col">
        <div class="flex shrink-0 gap-2 border-b border-[var(--border-color)] p-2">
            <button
                type="button"
                class="rounded border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                @click="pushEntry(true)"
            >
                加一条带负载的
            </button>
            <button
                type="button"
                class="rounded border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                @click="pushEntry(false)"
            >
                加一条无负载的
            </button>
            <button
                type="button"
                class="rounded border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                @click="writeEntries([])"
            >
                清空
            </button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
            <EventLogPanel data-lab-subject v-bind="subject.bindings.value" :entries="entries" />
        </div>
    </div>
</template>
