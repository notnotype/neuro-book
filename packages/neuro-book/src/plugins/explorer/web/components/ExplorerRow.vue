<script setup lang="ts">
/** 资源管理器的一行：根、资源或状态行（同名 .md）。 */
import {computed} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import {explorerText} from "../messages";
import type {Row} from "../tree/rows";

const props = defineProps<{
    row: Row;
    locale: DisplayLocale;
    domId: string;
    selected: boolean;
    active: boolean;
    height: number;
}>();

const emit = defineEmits<{
    (event: "press", mouse: MouseEvent, part: "twisty" | "row"): void;
    (event: "activate"): void;
    (event: "context", mouse: MouseEvent): void;
    (event: "retry"): void;
}>();

const INDENT = 12;

const indent = computed(() => `${String(8 + props.row.depth * INDENT)}px`);

const label = computed(() => {
    const row = props.row;
    if (row.kind === "root") return explorerText(props.locale, row.scheme === "project" ? "projectRoot" : "userRoot");
    if (row.kind === "entry") return row.label;
    switch (row.status) {
        case "loading":
            return explorerText(props.locale, "loading");
        case "empty":
            return explorerText(props.locale, "empty");
        case "error":
            return explorerText(props.locale, "readFailed", {reason: row.detail ?? row.code ?? ""});
        case "manifest":
            return explorerText(props.locale, row.code === "unreadable" ? "manifestUnreadable" : "manifestInvalid", {reason: row.detail ?? ""});
    }
    return "";
});

const icon = computed(() => {
    const row = props.row;
    if (row.kind === "root") return row.scheme === "project" ? "i-lucide-book-open" : "i-lucide-user";
    if (row.kind !== "entry") return null;
    if (row.type === "missing") return "i-lucide-file-x";
    if (row.type === "link") return "i-lucide-link";
    if (row.manifest) return "i-lucide-file-code";
    if (row.node) return row.body ? "i-lucide-file-text" : "i-lucide-folder-dot";
    if (row.binder) return "i-lucide-book-marked";
    if (row.folder === "content") return "i-lucide-library";
    if (row.type === "directory") return row.expanded ? "i-lucide-folder-open" : "i-lucide-folder";
    return "i-lucide-file";
});

const expandable = computed(() => {
    const row = props.row;
    if (row.kind === "root") return row.status.kind !== "unbound";
    return row.kind === "entry" && row.expandable;
});

const expanded = computed(() => (props.row.kind === "status" ? false : props.row.expanded));

const marks = computed(() => {
    const row = props.row;
    if (row.kind === "root") return row.status.kind === "unbound" ? [explorerText(props.locale, "noProject")] : [];
    if (row.kind !== "entry") return [];
    const found: string[] = [];
    if (row.type === "missing") found.push(explorerText(props.locale, "missing"));
    if (row.listed === false) found.push(explorerText(props.locale, "unlisted"));
    if (row.node && !row.body) found.push(explorerText(props.locale, "noBody"));
    if (row.binder) found.push(explorerText(props.locale, "needsPlot"));
    return found;
});

const position = computed(() => (props.row.kind === "entry" ? {posinset: props.row.position, setsize: props.row.siblings} : props.row.kind === "root" ? {posinset: props.row.scheme === "project" ? 1 : 2, setsize: 2} : null));

const description = computed(() => (props.row.kind === "entry" ? props.row.address : undefined));
</script>

<template>
    <div
        v-if="row.kind !== 'status'"
        :id="domId"
        role="treeitem"
        class="explorer-row flex w-full min-w-0 cursor-default select-none items-center gap-1 pr-2 text-sm"
        :class="[selected ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]', row.kind === 'entry' && row.type === 'missing' ? 'opacity-60' : '']"
        :style="{height: `${height}px`, paddingLeft: indent}"
        :data-explorer-row="row.id"
        :data-active="active ? 'true' : undefined"
        :aria-level="row.depth + 1"
        :aria-setsize="position?.setsize"
        :aria-posinset="position?.posinset"
        :aria-selected="selected"
        :aria-expanded="expandable ? expanded : undefined"
        :aria-description="description"
        :title="description"
        @click="emit('press', $event, 'row')"
        @dblclick="emit('activate')"
        @contextmenu.prevent="emit('context', $event)"
    >
        <span
            class="flex h-4 w-4 shrink-0 items-center justify-center rounded"
            :class="expandable ? 'hover:bg-[var(--bg-subtle)]' : ''"
            data-explorer-twisty
            @click.stop="expandable ? emit('press', $event, 'twisty') : emit('press', $event, 'row')"
        >
            <span v-if="expandable" class="i-lucide-chevron-right h-3.5 w-3.5 transition-transform" :class="expanded ? 'rotate-90' : ''"></span>
        </span>
        <span v-if="icon" :class="icon" class="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
        <span class="min-w-0 shrink truncate" data-explorer-label>{{ label }}</span>
        <span v-if="row.kind === 'entry' && row.subtitle" class="min-w-0 shrink-[2] truncate text-xs text-[var(--text-muted)]" data-explorer-subtitle>{{ row.subtitle }}</span>
        <span v-for="mark in marks" :key="mark" class="shrink-0 text-xs text-[var(--text-muted)]" data-explorer-mark>{{ mark }}</span>
    </div>
    <div
        v-else
        :id="domId"
        role="none"
        class="flex w-full min-w-0 select-none items-center gap-1.5 pr-2 text-xs text-[var(--text-muted)]"
        :style="{height: `${height}px`, paddingLeft: indent}"
        :data-explorer-status="row.status"
    >
        <span v-if="row.status === 'loading'" class="i-lucide-loader-circle h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true"></span>
        <span v-else-if="row.status === 'error' || row.status === 'manifest'" class="i-lucide-triangle-alert h-3.5 w-3.5 shrink-0 text-[var(--status-warning)]" aria-hidden="true"></span>
        <span class="min-w-0 truncate" :title="label">{{ label }}</span>
        <button v-if="row.status === 'error'" type="button" tabindex="-1" class="shrink-0 rounded px-1 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" data-explorer-retry @click="emit('retry')">{{ explorerText(locale, "retry") }}</button>
    </div>
</template>

<style scoped>
.explorer-row[data-active="true"] {
    box-shadow: inset 0 0 0 1px var(--focus-outline);
}
</style>
