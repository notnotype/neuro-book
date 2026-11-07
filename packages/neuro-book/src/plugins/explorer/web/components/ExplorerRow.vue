<script setup lang="ts">
/** 资源管理器的一行：根或资源，以及新建与改名的内联输入（同名 .md）。 */
import {Input, Tooltip} from "@notnotype/nb-ui/components";
import {computed, nextTick, onMounted, ref, watch} from "vue";

import {fileIconOf} from "../icons/file-icons";
import {useExplorerText} from "../text";
import {displayLabel} from "../tree/rows";
import type {Problem, Row} from "../tree/rows";
import FileIcon from "nbook/ui/file-icons/FileIcon.vue";

const props = defineProps<{
    row: Row;
    domId: string;
    selected: boolean;
    active: boolean;
    height: number;
    /** 项目根显示的作品名（书名，没有时是目录原名）；没有绑定项目时不给，显示“项目”。 */
    projectTitle?: string | null;
    /** 内联输入（新建与改名）：名字、已换成文字的错误、是否在提交。 */
    edit?: {readonly name: string; readonly error: string | null; readonly busy: boolean} | null;
    /** 设置“隐藏 Markdown 扩展名”；默认 false。 */
    hideMarkdownExtension?: boolean;
    /** 要加深的那一层缩进参考线（层号同 `depth`）；默认 null。 */
    guideActive?: number | null;
}>();

const text = useExplorerText();

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

/** 每层缩进；参考线画在上级展开箭头的中线（行的左内边距 8px 加箭头宽度的一半）。 */
const INDENT = 12;
const guideLeft = (level: number): string => `${String(16 + level * INDENT)}px`;

const indent = computed(() => `${String(8 + props.row.depth * INDENT)}px`);

/** 第 0 层是根（分节标题），它的子项不画线；从第 1 层画到本行的上一层。 */
const guides = computed(() => Array.from({length: Math.max(0, props.row.depth - 1)}, (_, at) => at + 1));

const label = computed(() => {
    const row = props.row;
    if (row.kind === "root") return row.scheme === "project" ? (props.projectTitle ?? text("tree.projectRoot")) : text("tree.userRoot");
    if (row.kind === "entry") return displayLabel(row, props.hideMarkdownExtension === true);
    return "";
});

const icon = computed(() => {
    const row = props.row;
    if (row.kind === "edit") return row.entry === "directory" ? "folder" : "file";
    if (row.kind !== "entry") return null;
    return fileIconOf({kind: row.type, name: row.name, folder: row.folder, expanded: row.expanded, node: row.node, body: row.body});
});

const expandable = computed(() => {
    const row = props.row;
    if (row.kind === "root") return row.status.kind !== "unbound";
    return row.kind === "entry" && row.expandable;
});

const expanded = computed(() => (props.row.kind === "root" || props.row.kind === "entry" ? props.row.expanded : false));

const problem = computed((): Problem | null => (props.row.kind === "root" || props.row.kind === "entry" ? props.row.problem : null));

/** 读取失败与清单问题的说明：悬停提示与可访问描述共用。 */
const problemText = computed(() => {
    const found = problem.value;
    if (found === null) return null;
    if (found.kind === "loading") return text("tree.loading");
    if (found.kind === "error") return text("tree.readFailedRetry", {reason: found.detail ?? found.code});
    return text(found.code === "unreadable" ? "tree.manifestUnreadable" : "tree.manifestInvalid", {reason: found.detail ?? ""});
});

/** 行尾的状态图标：图标与它的文字（悬停提示、可访问描述）。 */
const marks = computed((): ReadonlyArray<{readonly icon: string; readonly text: string}> => {
    const row = props.row;
    if (row.kind !== "entry") return [];
    const found: Array<{icon: string; text: string}> = [];
    const add = (icon: string, key: "tree.marks.missing" | "tree.marks.unlisted" | "tree.marks.noBody" | "tree.marks.needsPlot" | "tree.marks.cutMark"): void => {
        found.push({icon, text: text(key)});
    };
    if (row.type === "missing") add("i-lucide-ban", "tree.marks.missing");
    if (row.listed === false) add("i-lucide-circle-dashed", "tree.marks.unlisted");
    if (row.node && !row.body) add("i-lucide-file-minus", "tree.marks.noBody");
    if (row.binder) add("i-lucide-puzzle", "tree.marks.needsPlot");
    if (row.cut) add("i-lucide-scissors", "tree.marks.cutMark");
    return found;
});

/** 根没有绑定项目时的说明仍是文字：它是分节标题的一部分，不是某个资源的状态。 */
const rootNote = computed(() => (props.row.kind === "root" && props.row.status.kind === "unbound" ? text("tree.noProject") : null));

const position = computed(() => (props.row.kind === "entry" ? {posinset: props.row.position, setsize: props.row.siblings} : props.row.kind === "root" ? {posinset: props.row.scheme === "project" ? 1 : 2, setsize: 2} : null));

const address = computed(() => (props.row.kind === "entry" ? props.row.address : undefined));

/** 可访问描述：路径，再加状态与标记的文字。 */
const description = computed(() => {
    const parts = [address.value, problemText.value, ...marks.value.map((mark) => mark.text)].filter((part): part is string => part != null && part !== "");
    return parts.length === 0 ? undefined : parts.join("；");
});

/** 输入框的可访问名称：说明在给什么起名字，当前值另由输入框自己读出。 */
const inputLabel = computed(() => {
    const row = props.row;
    if (row.kind === "edit") return text(row.entry === "directory" ? "tree.newFolderName" : "tree.newFileName");
    return row.kind === "entry" ? text("tree.renameLabel", {name: row.name}) : undefined;
});
</script>

<template>
    <div
        v-if="row.kind === 'edit' || (row.kind === 'entry' && edit != null)"
        :id="domId"
        :role="row.kind === 'edit' ? 'none' : 'treeitem'"
        class="explorer-edit flex w-full min-w-0 items-center gap-1 pr-2 text-sm"
        :style="{height: `${height}px`, paddingLeft: indent}"
        :data-explorer-edit="row.id"
        :aria-level="row.depth + 1"
        :aria-selected="row.kind === 'entry' ? selected : undefined"
        :aria-setsize="row.kind === 'entry' ? position?.setsize : undefined"
        :aria-posinset="row.kind === 'entry' ? position?.posinset : undefined"
        :aria-expanded="row.kind === 'entry' && expandable ? expanded : undefined"
        :aria-description="description"
    >
        <span v-for="level in guides" :key="level" class="explorer-guide" :data-guide-active="level === guideActive ? '' : undefined" :style="{left: guideLeft(level)}" aria-hidden="true"></span>
        <span class="h-4 w-4 shrink-0" aria-hidden="true"></span>
        <FileIcon v-if="icon" :icon="icon" />
        <div ref="inputBox" class="explorer-edit__box relative min-w-0 flex-1" @keydown="onEditKeydown" @focusout="emit('edit-commit')" @click.stop @dblclick.stop>
            <Input
                size="sm"
                :model-value="edit?.name ?? ''"
                :readonly="edit?.busy === true"
                :aria-label="inputLabel"
                :aria-invalid="edit?.error ? 'true' : undefined"
                :aria-describedby="edit?.error ? errorId : undefined"
                data-explorer-input
                @update:model-value="(value: string) => emit('edit-input', value)"
            />
            <span
                v-if="edit?.error"
                :id="errorId"
                role="alert"
                class="explorer-edit__error pointer-events-none absolute inset-x-0 top-full z-10 truncate px-1.5 py-0.5 text-xs"
                data-explorer-input-error
            >{{ edit.error }}</span>
        </div>
    </div>
    <div
        v-else
        :id="domId"
        role="treeitem"
        class="explorer-row flex w-full min-w-0 cursor-default select-none items-center gap-1 rounded-[var(--radius-control)] pr-2 transition-colors [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-layout)]"
        :class="[
            row.kind === 'root' ? 'explorer-row--root' : 'text-sm',
            row.kind === 'entry' && (row.type === 'missing' || row.cut) ? 'opacity-60' : '',
        ]"
        :data-explorer-cut="row.kind === 'entry' && row.cut ? '' : undefined"
        :data-explorer-problem="problem?.kind"
        :style="{height: `${height}px`, paddingLeft: indent}"
        :data-explorer-row="row.id"
        :data-active="active ? 'true' : undefined"
        :aria-level="row.depth + 1"
        :aria-setsize="position?.setsize"
        :aria-posinset="position?.posinset"
        :aria-selected="selected"
        :aria-expanded="expandable ? expanded : undefined"
        :aria-busy="problem?.kind === 'loading' ? 'true' : undefined"
        :aria-description="description"
        :title="address"
        @click="emit('press', $event, 'row')"
        @dblclick="emit('activate')"
        @contextmenu.prevent="emit('context', $event)"
    >
        <span v-for="level in guides" :key="level" class="explorer-guide" :data-guide-active="level === guideActive ? '' : undefined" :style="{left: guideLeft(level)}" aria-hidden="true"></span>
        <span
            class="flex h-4 w-4 shrink-0 items-center justify-center rounded"
            :class="expandable ? 'hover:bg-[var(--bg-subtle)]' : ''"
            data-explorer-twisty
            @click.stop="expandable ? emit('press', $event, 'twisty') : emit('press', $event, 'row')"
        >
            <span v-if="problem?.kind === 'loading'" class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" data-explorer-loading></span>
            <span v-else-if="expandable" class="i-lucide-chevron-right h-3.5 w-3.5 transition-transform [transition-duration:var(--motion-move)] [transition-timing-function:var(--ease-layout)]" :class="expanded ? 'rotate-90' : ''"></span>
        </span>
        <FileIcon v-if="icon" :icon="icon" />
        <span
            class="min-w-0 shrink truncate"
            :class="problem?.kind === 'error' ? 'text-[var(--status-danger)]' : problem?.kind === 'manifest' ? 'text-[var(--status-warning)]' : ''"
            data-explorer-label
        >{{ label }}</span>
        <span v-if="row.kind === 'entry' && row.subtitle" class="min-w-0 shrink-[2] truncate text-xs text-[var(--text-muted)]" data-explorer-subtitle>{{ row.subtitle }}</span>
        <span v-if="rootNote" class="shrink-0 truncate text-xs font-normal" data-explorer-mark>{{ rootNote }}</span>
        <span class="ml-auto flex shrink-0 items-center gap-1 pl-1">
            <Tooltip v-for="mark in marks" :key="mark.icon" :text="mark.text">
                <span :class="mark.icon" class="h-3.5 w-3.5 text-[var(--text-muted)]" :aria-label="mark.text" role="img" :data-explorer-mark="mark.text"></span>
            </Tooltip>
            <Tooltip v-if="problem?.kind === 'error'" :text="problemText ?? ''">
                <button
                    type="button"
                    tabindex="-1"
                    class="flex h-4 w-4 items-center justify-center rounded text-[var(--status-danger)] hover:bg-[var(--bg-subtle)]"
                    :aria-label="problemText ?? undefined"
                    data-explorer-retry
                    @click.stop="emit('retry')"
                    @dblclick.stop
                ><span class="i-lucide-circle-alert h-3.5 w-3.5"></span></button>
            </Tooltip>
            <Tooltip v-else-if="problem?.kind === 'manifest'" :text="problemText ?? ''">
                <span class="i-lucide-triangle-alert h-3.5 w-3.5 text-[var(--status-warning)]" role="img" :aria-label="problemText ?? undefined" data-explorer-manifest-problem></span>
            </Tooltip>
        </span>
    </div>
</template>

<style scoped>
/*
 * 选中不描边，按树有没有焦点分两种（docs/specs/workbench/files-explorer.md 的“行的样子”）：焦点在树里是强调色浅底与强调色
 * 文字，焦点在别处（编辑区、对话框）是比悬停深一档的灰底。看的是 `:focus-within`：内联输入框也在树里，编辑时仍算树有焦点。
 */
.explorer-row {
    color: var(--text-main);
}

.explorer-row:hover {
    background: var(--bg-hover);
}

.explorer-row[aria-selected="true"] {
    background: var(--accent-bg);
    color: var(--accent-text);
}

/* 失焦的选中在悬停色上再混一档文字色：任何主题里都比悬停深一档，亮色更暗、暗色更亮。 */
[data-explorer-tree]:not(:focus-within) .explorer-row[aria-selected="true"] {
    background: color-mix(in srgb, var(--text-main) 8%, var(--bg-hover));
    color: var(--text-main);
}

/* 内联输入：这一行铺选中底色，输入框收在行里，没有表单控件的外扩光环；报错贴在输入框下沿。 */
.explorer-edit {
    border-radius: var(--radius-control);
    background: var(--accent-bg);
}

.explorer-edit__box :deep(input[data-explorer-input]) {
    height: 22px;
    min-height: 0;
    padding-inline: 6px;
    border-radius: 6px;
    border-color: var(--focus-outline);
    font-size: var(--text-sm);
    box-shadow: none;
}

.explorer-edit__box :deep(input[data-explorer-input][aria-invalid="true"]) {
    border-color: var(--status-danger);
}

.explorer-edit__error {
    margin-top: -1px;
    border: 1px solid var(--status-danger);
    border-radius: 0 0 6px 6px;
    background: color-mix(in srgb, var(--status-danger) 12%, var(--bg-panel));
    color: var(--status-danger);
}

/*
 * 键盘焦点所在的行画内嵌焦点线，只在树是键盘带来的焦点时画：用鼠标点了一行，树也拿到焦点，但不该多出一圈线。
 */
[data-explorer-tree]:focus-visible .explorer-row[data-active="true"] {
    box-shadow: inset 0 0 0 1.5px var(--focus-outline);
}

/* 根是分节标题：小一号、加粗，没有图标。 */
.explorer-row--root {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
}

/* 缩进参考线：显示与否由树根上的 `data-guides` 决定（ExplorerTree）。 */
.explorer-guide {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    pointer-events: none;
    background: color-mix(in srgb, var(--text-main) 18%, transparent);
    opacity: var(--explorer-guide-opacity, 0);
    transition: opacity var(--motion-fast) var(--ease-layout);
}

.explorer-guide[data-guide-active] {
    background: color-mix(in srgb, var(--text-main) 45%, transparent);
}
</style>
