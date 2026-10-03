<script setup lang="ts">
import {ref} from "vue";
import JsonViewer from "nbook/app/components/common/JsonViewer.vue";
import type {LabEventEntry} from "./event-log.types";

withDefaults(defineProps<{
    entries: LabEventEntry[];
    emptyText?: string;
}>(), {
    emptyText: "还没有事件",
});

const expanded = ref(new Set<string>());

// 按 id 记而不是按下标：列表在最前面插入新条目时，下标会整体后移。
function toggle(entry: LabEventEntry): void {
    if (entry.payload === undefined) {
        return;
    }
    const next = new Set(expanded.value);
    if (!next.delete(entry.id)) {
        next.add(entry.id);
    }
    expanded.value = next;
}

function formatTime(at: Date): string {
    return at.toTimeString().slice(0, 8);
}

function summarize(payload: unknown): string {
    if (payload === undefined) {
        return "";
    }
    if (typeof payload === "string") {
        return payload;
    }
    try {
        return JSON.stringify(payload) ?? String(payload);
    } catch {
        // 循环引用等 JSON 处理不了的负载：摘要退回类型名，展开后由 JsonViewer 自己报告。
        return Object.prototype.toString.call(payload);
    }
}
</script>

<template>
    <div class="flex flex-col">
        <p v-if="entries.length === 0" class="px-3 py-6 text-center text-xs text-[var(--text-muted)]">
            {{ emptyText }}
        </p>

        <div
            v-for="entry in entries"
            :key="entry.id"
            class="border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)] last:border-b-0"
        >
            <component
                :is="entry.payload === undefined ? 'div' : 'button'"
                :type="entry.payload === undefined ? undefined : 'button'"
                :tabindex="entry.payload === undefined ? undefined : 0"
                :aria-expanded="entry.payload === undefined ? undefined : expanded.has(entry.id)"
                class="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5 text-left"
                :class="entry.payload === undefined
                    ? ''
                    : 'cursor-pointer transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-main)]'"
                @click="toggle(entry)"
            >
                <span class="shrink-0 font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                    {{ formatTime(entry.at) }}
                </span>
                <code class="nb-lab-event-chip shrink-0">
                    {{ entry.name }}
                </code>
                <span
                    v-if="entry.payload !== undefined"
                    class="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-secondary)]"
                >
                    {{ summarize(entry.payload) }}
                </span>
                <span
                    v-if="entry.payload !== undefined"
                    class="i-lucide-chevron-right h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform"
                    :class="expanded.has(entry.id) ? 'rotate-90' : ''"
                ></span>
            </component>

            <div v-if="expanded.has(entry.id)" class="px-3 pb-2">
                <JsonViewer :value="entry.payload" :max-height="200" :main-menu-bar="false" />
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 写成 CSS 而不是原子类：字号是 var(--text-2xs)，原子类的 text-[…] 分辨不出
   传进去的是字号还是颜色，写成任意值会静默不生效。 */
.nb-lab-event-chip {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    color: var(--text-main);
    font-size: var(--text-2xs);
}
</style>
