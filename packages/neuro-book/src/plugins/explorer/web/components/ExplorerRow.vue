<script setup lang="ts">
/** 资源管理器的一行：根、资源或状态行（同名 .md）。 */
import {FormInput} from "@notnotype/nb-ui/components";
import {computed, nextTick, onMounted, ref, watch} from "vue";

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
    /** 内联输入（新建与改名）：名字、已换成文字的错误、是否在提交。 */
    edit?: {readonly name: string; readonly error: string | null; readonly busy: boolean} | null;
}>();

const emit = defineEmits<{
    (event: "press", mouse: MouseEvent, part: "twisty" | "row"): void;
    (event: "activate"): void;
    (event: "context", mouse: MouseEvent): void;
    (event: "retry"): void;
    (event: "edit-input", name: string): void;
    (event: "edit-commit"): void;
    (event: "edit-cancel"): void;
}>();

const inputBox = ref<HTMLElement | null>(null);
const errorId = computed(() => `${props.domId}-error`);

/** 输入行挂上时把焦点放进输入框；改名时选中扩展名之前的部分。 */
const focusInput = async (): Promise<void> => {
    await nextTick();
    const input = inputBox.value?.querySelector("input");
    if (input === null || input === undefined) return;
    input.focus();
    const dot = input.value.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
};
onMounted(() => {
    if (props.edit != null) void focusInput();
});
// 改名时同一行从资源行换成输入框：组件不重建，按 `edit` 出现再放焦点。
watch(() => props.edit != null, (editing, before) => {
    if (editing && before === false) void focusInput();
});

const onEditKeydown = (event: KeyboardEvent): void => {
    // 输入法组字中的 Enter 是确认候选，不是提交。
    if (event.isComposing) return;
    if (event.key === "Enter") {
        event.preventDefault();
        emit("edit-commit");
    } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        emit("edit-cancel");
    }
};

const INDENT = 12;

const indent = computed(() => `${String(8 + props.row.depth * INDENT)}px`);

const label = computed(() => {
    const row = props.row;
    if (row.kind === "root") return explorerText(props.locale, row.scheme === "project" ? "projectRoot" : "userRoot");
    if (row.kind === "entry") return row.label;
    if (row.kind === "edit") return "";
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
    if (row.kind === "edit") return row.entry === "directory" ? "i-lucide-folder" : "i-lucide-file";
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

const expanded = computed(() => (props.row.kind === "root" || props.row.kind === "entry" ? props.row.expanded : false));

const marks = computed(() => {
    const row = props.row;
    if (row.kind === "root") return row.status.kind === "unbound" ? [explorerText(props.locale, "noProject")] : [];
    if (row.kind !== "entry") return [];
    const found: string[] = [];
    if (row.type === "missing") found.push(explorerText(props.locale, "missing"));
    if (row.listed === false) found.push(explorerText(props.locale, "unlisted"));
    if (row.node && !row.body) found.push(explorerText(props.locale, "noBody"));
    if (row.binder) found.push(explorerText(props.locale, "needsPlot"));
    if (row.cut) found.push(explorerText(props.locale, "cutMark"));
    return found;
});

const position = computed(() => (props.row.kind === "entry" ? {posinset: props.row.position, setsize: props.row.siblings} : props.row.kind === "root" ? {posinset: props.row.scheme === "project" ? 1 : 2, setsize: 2} : null));

const description = computed(() => (props.row.kind === "entry" ? props.row.address : undefined));

/** 输入框的可访问名称：说明在给什么起名字，当前值另由输入框自己读出。 */
const inputLabel = computed(() => {
    const row = props.row;
    if (row.kind === "edit") return explorerText(props.locale, row.entry === "directory" ? "newFolderName" : "newFileName");
    return row.kind === "entry" ? explorerText(props.locale, "renameLabel", {name: row.name}) : undefined;
});
</script>

<template>
    <div
        v-if="row.kind === 'edit' || (row.kind === 'entry' && edit != null)"
        :id="domId"
        :role="row.kind === 'edit' ? 'none' : 'treeitem'"
        class="relative flex w-full min-w-0 items-center gap-1 pr-2 text-sm"
        :style="{height: `${height}px`, paddingLeft: indent}"
        :data-explorer-edit="row.id"
        :aria-level="row.depth + 1"
        :aria-selected="row.kind === 'entry' ? selected : undefined"
        :aria-setsize="row.kind === 'entry' ? position?.setsize : undefined"
        :aria-posinset="row.kind === 'entry' ? position?.posinset : undefined"
        :aria-expanded="row.kind === 'entry' && expandable ? expanded : undefined"
        :aria-description="description"
    >
        <span class="h-4 w-4 shrink-0" aria-hidden="true"></span>
        <span v-if="icon" :class="icon" class="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true"></span>
        <div ref="inputBox" class="min-w-0 flex-1" @keydown="onEditKeydown" @focusout="emit('edit-commit')" @click.stop @dblclick.stop>
            <FormInput
                size="sm"
                :model-value="edit?.name ?? ''"
                :readonly="edit?.busy === true"
                :aria-label="inputLabel"
                :aria-invalid="edit?.error ? 'true' : undefined"
                :aria-describedby="edit?.error ? errorId : undefined"
                data-explorer-input
                @update:model-value="(value: string) => emit('edit-input', value)"
            />
        </div>
        <span
            v-if="edit?.error"
            :id="errorId"
            role="alert"
            class="pointer-events-none absolute left-8 right-2 top-full z-10 truncate rounded bg-[var(--status-danger)] px-1.5 py-0.5 text-xs text-white"
            data-explorer-input-error
        >{{ edit.error }}</span>
    </div>
    <div
        v-else-if="row.kind !== 'status'"
        :id="domId"
        role="treeitem"
        class="explorer-row flex w-full min-w-0 cursor-default select-none items-center gap-1 pr-2 text-sm"
        :class="[selected ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-main)] hover:bg-[var(--bg-hover)]', row.kind === 'entry' && (row.type === 'missing' || row.cut) ? 'opacity-60' : '']"
        :data-explorer-cut="row.kind === 'entry' && row.cut ? '' : undefined"
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
