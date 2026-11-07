<script setup lang="ts">
// 文件与目录浏览的纯展示控件：面包屑 + 一层条目。数据来源、进入目录后列什么都由宿主经事件决定，组件只管选中与键盘。
import {computed, ref, watch} from "vue";
import {Breadcrumb, Spinner} from "@notnotype/nb-ui/components";
import type {BreadcrumbItemData} from "@notnotype/nb-ui/components";

export interface FileBrowserSegment {
    /** 面包屑上的文字 */
    label: string;
    /** 点这一段时经 `navigate` 交回的路径 */
    path: string;
}

export interface FileBrowserEntry {
    id: string;
    name: string;
    kind: "directory" | "file";
    /** 右侧的说明文字（“作品 · 北方以北”“已在书架上”） */
    badge?: string;
    /** 说明文字的色调；默认 muted */
    badgeTone?: "muted" | "accent";
    /** 不能选中，也不能进入 */
    disabled?: boolean;
    /** 替换缺省的文件夹或文件图标 */
    iconClass?: string;
    /** 名字旁的小色块（例如作品的主题色）；给了就代替图标 */
    swatch?: string;
}

const props = withDefaults(defineProps<{
    /** 当前位置，从根到当前目录；最后一段是当前目录 */
    segments: FileBrowserSegment[];
    entries: FileBrowserEntry[];
    selectedId?: string | null;
    loading?: boolean;
    /** 读不出当前目录时的原因；非空时代替列表显示 */
    error?: string;
    emptyText?: string;
    /** “上一级”行的文字；当前目录有上一级（`segments` 多于一段）时显示 */
    upLabel?: string;
    /** 列表的可访问名称 */
    label?: string;
}>(), {
    selectedId: null,
    loading: false,
    error: "",
    emptyText: "这里没有子目录",
    upLabel: "上一级",
    label: "目录",
});

const emit = defineEmits<{
    (e: "update:selectedId", id: string | null): void;
    /** 要进入某个目录：面包屑的一段，或双击、回车打开的目录条目 */
    (e: "navigate", path: string): void;
    /** 回到上一级 */
    (e: "up"): void;
    /** 双击或回车一个文件条目 */
    (e: "activate", id: string): void;
}>();

const list = ref<HTMLElement | null>(null);
const canGoUp = computed(() => props.segments.length > 1);
const selectable = computed(() => props.entries.filter((entry) => entry.disabled !== true));
const optionId = (id: string): string => `nb-file-browser-${id.replace(/[^\w-]/gu, "_")}`;

const crumbs = computed<BreadcrumbItemData[]>(() => props.segments.map((segment, index) => ({label: segment.label, href: "#", current: index === props.segments.length - 1})));

function onCrumb(item: BreadcrumbItemData, event: MouseEvent): void {
    event.preventDefault();
    // 按位置找段，不按文字：目录名可以重复（/src/src）。Breadcrumb 交回的就是 crumbs 里的那个对象。
    const segment = props.segments[crumbs.value.indexOf(item)];
    if (segment !== undefined) emit("navigate", segment.path);
}

function select(entry: FileBrowserEntry): void {
    if (entry.disabled === true) return;
    emit("update:selectedId", entry.id);
    document.getElementById(optionId(entry.id))?.scrollIntoView({block: "nearest"});
}

function open(entry: FileBrowserEntry): void {
    if (entry.disabled === true) return;
    if (entry.kind === "directory") emit("navigate", entry.id);
    else emit("activate", entry.id);
}

function onKeydown(event: KeyboardEvent): void {
    const options = selectable.value;
    const index = options.findIndex((entry) => entry.id === props.selectedId);
    const moves: Record<string, number> = {ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: options.length - 1};
    if (event.key in moves) {
        event.preventDefault();
        const target = options[Math.min(options.length - 1, Math.max(0, moves[event.key] as number))];
        if (target !== undefined) select(target);
        return;
    }
    if (event.key === "Enter") {
        const current = options[index];
        if (current !== undefined) {
            event.preventDefault();
            open(current);
        }
        return;
    }
    if (event.key === "Backspace" && canGoUp.value) {
        event.preventDefault();
        emit("up");
    }
}

// 换了目录后选中项不再在列表里：清掉，键盘从第一项开始。
watch(() => props.entries, (entries) => {
    if (props.selectedId !== null && !entries.some((entry) => entry.id === props.selectedId)) emit("update:selectedId", null);
});
</script>

<template>
    <div class="nb-file-browser flex min-h-0 flex-col overflow-hidden rounded-[calc(var(--radius-control)+2px)] border border-[var(--control-outline)] bg-[var(--bg-input)]" data-file-browser>
        <div class="flex min-h-9 items-center gap-2 border-b border-[var(--divider)] bg-[color-mix(in_srgb,var(--bg-sidebar)_50%,transparent)] px-3 py-1.5">
            <Breadcrumb :items="crumbs" class="min-w-0 flex-1" @click="onCrumb" />
        </div>
        <div v-if="props.loading" class="flex items-center justify-center gap-2 px-4 py-8 text-xs text-[var(--text-muted)]" role="status" data-file-browser-loading>
            <Spinner size="sm" />
        </div>
        <p v-else-if="props.error !== ''" class="m-0 px-4 py-6 text-sm text-[var(--status-danger)]" role="alert" data-file-browser-error>{{ props.error }}</p>
        <ul
            v-else
            ref="list"
            role="listbox"
            tabindex="0"
            class="m-0 max-h-[var(--nb-file-browser-max-height,232px)] list-none overflow-y-auto p-1.5 outline-hidden"
            :aria-label="props.label"
            :aria-activedescendant="props.selectedId === null ? undefined : optionId(props.selectedId)"
            @keydown="onKeydown"
        >
            <li v-if="canGoUp" class="flex cursor-pointer items-center gap-2.5 rounded-[var(--nb-popover-inner-radius,6px)] px-2.5 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" data-file-browser-up @click="emit('up')" @dblclick.stop>
                <span class="i-lucide-corner-left-up h-4 w-4 shrink-0" aria-hidden="true"></span>
                <span class="min-w-0 flex-1 truncate">..</span>
                <span class="text-xs">{{ props.upLabel }}</span>
            </li>
            <li v-if="props.entries.length === 0" class="px-2.5 py-6 text-center text-xs text-[var(--text-muted)]" data-file-browser-empty>{{ props.emptyText }}</li>
            <li
                v-for="entry in props.entries"
                :id="optionId(entry.id)"
                :key="entry.id"
                role="option"
                :aria-selected="entry.id === props.selectedId"
                :aria-disabled="entry.disabled === true ? 'true' : undefined"
                class="flex items-center gap-2.5 rounded-[var(--nb-popover-inner-radius,6px)] px-2.5 py-1.5 text-sm text-[var(--text-main)]"
                :class="entry.disabled === true ? 'cursor-default text-[var(--text-muted)]' : entry.id === props.selectedId ? 'cursor-pointer bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)]' : 'cursor-pointer hover:bg-[var(--bg-hover)]'"
                :data-file-browser-entry="entry.id"
                @click="select(entry)"
                @dblclick="open(entry)"
            >
                <span v-if="entry.swatch !== undefined" class="h-4 w-3.5 shrink-0 rounded-[2px]" :style="{background: entry.swatch}" aria-hidden="true"></span>
                <span v-else class="h-4 w-4 shrink-0 text-[var(--text-muted)]" :class="entry.iconClass ?? (entry.kind === 'directory' ? 'i-lucide-folder' : 'i-lucide-file')" aria-hidden="true"></span>
                <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
                <span v-if="entry.badge !== undefined && entry.badge !== ''" class="shrink-0 text-xs" :class="entry.badgeTone === 'accent' ? 'text-[var(--accent-text)]' : 'text-[var(--text-muted)]'">{{ entry.badge }}</span>
            </li>
        </ul>
    </div>
</template>

<style scoped>
/* 焦点环画在外框上：列表自己画的话会被外框的圆角裁掉（外框 overflow hidden 是为了裁面包屑那条底色）。 */
.nb-file-browser:has(> [role="listbox"]:focus-visible) {
    border-color: var(--focus-outline);
    box-shadow: var(--focus-ring);
    transition: border-color var(--motion-base) var(--ease-layout), box-shadow var(--motion-base) var(--ease-layout);
}
</style>
