<script setup lang="ts">
/** 编辑组的面包屑（同名 .md）。 */
import {DropdownMenu} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, ref, shallowRef, watch} from "vue";

import FileIcon from "nbook/ui/file-icons/FileIcon.vue";
import type {CatppuccinIcon} from "nbook/ui/file-icons/catppuccin";

import type {EditorOutline} from "../../shared/contracts";
import {useEditorText} from "../text";

export interface BreadcrumbSegment {
    readonly kind: "root" | "dir" | "file";
    readonly label: string;
    readonly address: string;
    readonly icon?: CatppuccinIcon;
}

export type BreadcrumbListing =
    | {readonly ok: true; readonly entries: ReadonlyArray<{readonly name: string; readonly address: string; readonly kind: "file" | "directory" | "link" | "other" | "missing"}>}
    | {readonly ok: false; readonly reason: string};

const props = withDefaults(defineProps<{
    segments: ReadonlyArray<BreadcrumbSegment>;
    parent: string | null;
    outline: EditorOutline | null;
    list: (address: string, signal: AbortSignal) => Promise<BreadcrumbListing>;
    focusSeq?: number;
}>(), {focusSeq: 0});
const emit = defineEmits<{
    (event: "open", address: string): void;
    (event: "reveal", binding: string, version: number, id: string): void;
    (event: "escape"): void;
}>();

/** 标题段跟在路径段后面：它的下标是 `segments.length`。 */
const HEADING = -1;
const nav = ref<HTMLElement | null>(null);
/** roving tabindex：在 Tab 顺序里的那一段。 */
const focused = ref(0);
/** 打开着的那一段（标题段为 HEADING）；没有为 null。 */
const opened = ref<number | null>(null);
/**
 * 目录下拉此刻列的目录与读取状态。`seq` 是请求序号：关下拉、换段、进下一层、这一行换了文件都加一，晚回来的结果对不上就
 * 丢掉；同时中止在途的读取。
 */
const listing = shallowRef<{readonly address: string; readonly current: string | null; readonly state: "loading" | "failed" | "ready"; readonly reason: string; readonly entries: Extract<BreadcrumbListing, {ok: true}>["entries"]} | null>(null);
let seq = 0;
let controller: AbortController | null = null;
/** 选中目录项会让下拉报一次关闭：这一次不当真（进下一层时下拉留着）。 */
let keepOpen = false;

const t = useEditorText();

const stop = (): void => {
    seq += 1;
    controller?.abort();
    controller = null;
};

const load = (address: string, current: string | null): void => {
    stop();
    const mine = seq;
    const abort = new AbortController();
    controller = abort;
    listing.value = {address, current, state: "loading", reason: "", entries: []};
    void props.list(address, abort.signal).then((result) => {
        if (mine !== seq) return;
        listing.value = result.ok ? {address, current, state: "ready", reason: "", entries: result.entries} : {address, current, state: "failed", reason: result.reason, entries: []};
    }, (error: unknown) => {
        if (mine !== seq) return;
        listing.value = {address, current, state: "failed", reason: error instanceof Error ? error.message : String(error), entries: []};
    });
};

const close = (): void => {
    stop();
    opened.value = null;
    listing.value = null;
};

const openSegment = (index: number, open: boolean): void => {
    if (!open) {
        if (keepOpen) {
            keepOpen = false;
            return;
        }
        if (opened.value === index) close();
        return;
    }
    opened.value = index;
    if (index === HEADING) {
        stop();
        listing.value = null;
        return;
    }
    const segment = props.segments[index];
    if (segment === undefined) return;
    // 文件段列同级（读它所在的目录），当前文件打勾；其余段列自己。
    if (segment.kind === "file") load(props.parent ?? segment.address, segment.address);
    else load(segment.address, null);
};

// 这一行换了文件（或页面标签、没有标签）：下拉关上，在途读取作废。
watch(() => props.segments.map((segment) => segment.address).join("|"), () => {
    close();
    focused.value = Math.max(0, props.segments.length - 1);
});
// 大纲换了绑定或版本：开着的标题下拉关上，旧的选项不能再选。
watch(() => (props.outline === null ? null : `${props.outline.binding}|${String(props.outline.version)}`), () => {
    if (opened.value === HEADING) close();
});

/** 打开标题下拉时的大纲身份：选中时带上，控件按它核对（对不上不跳）。 */
const outlineAtOpen = ref<{binding: string; version: number} | null>(null);
watch(opened, (index) => {
    outlineAtOpen.value = index === HEADING && props.outline !== null ? {binding: props.outline.binding, version: props.outline.version} : null;
});

const directoryItems = computed((): DropdownMenuItemData[] => {
    const current = listing.value;
    if (current === null) return [];
    if (current.state === "loading") return [{label: t("crumbs.loading"), id: "state:loading", disabled: true}];
    if (current.state === "failed") return [{label: current.reason, id: "state:failed", disabled: true, tone: "danger"}, {label: t("crumbs.retry"), id: "state:retry", iconClass: "i-lucide-rotate-cw"}];
    if (current.entries.length === 0) return [{label: t("crumbs.empty"), id: "state:empty", disabled: true}];
    return current.entries.map((entry): DropdownMenuItemData => {
        if (entry.kind === "directory") return {label: entry.name, id: `dir:${entry.address}`, iconClass: "i-lucide-folder", rightIconClass: "i-lucide-chevron-right"};
        if (entry.kind === "file") return {label: entry.name, id: `file:${entry.address}`, iconClass: "i-lucide-file-text", type: "radio", group: "files", checked: entry.address === current.current};
        return {label: entry.name, id: `other:${entry.address}`, iconClass: "i-lucide-file-question", disabled: true};
    });
});

const outlineItems = computed((): DropdownMenuItemData[] => (props.outline?.items ?? []).map((item) => ({
    // 按层级缩进：一级不缩，往下每级一个全角空格。
    label: `${"　".repeat(Math.max(0, item.level - 1))}${item.text}`,
    id: `heading:${item.id}`,
    type: "radio",
    group: "outline",
    checked: item.id === props.outline?.current,
})));

const currentHeading = computed(() => props.outline?.items.find((item) => item.id === props.outline?.current) ?? null);

const select = (value: string): void => {
    const [kind, ...rest] = value.split(":");
    const payload = rest.join(":");
    if (kind === "dir") {
        // 进下一层：下拉留着，列表换成它的子项。
        keepOpen = true;
        load(payload, null);
        return;
    }
    if (kind === "state" && payload === "retry" && listing.value !== null) {
        keepOpen = true;
        load(listing.value.address, listing.value.current);
        return;
    }
    if (kind === "file") {
        close();
        emit("open", payload);
        return;
    }
    if (kind === "heading" && outlineAtOpen.value !== null) {
        const at = outlineAtOpen.value;
        close();
        emit("reveal", at.binding, at.version, payload);
    }
};

/** 段的按钮（含标题段），按呈现顺序。 */
const buttons = (): HTMLElement[] => [...(nav.value?.querySelectorAll<HTMLElement>("[data-breadcrumb-segment]") ?? [])];
const total = computed(() => props.segments.length + (currentHeading.value === null ? 0 : 1));
const focusAt = (index: number): void => {
    focused.value = (index + total.value) % total.value;
    void nextTick(() => buttons()[focused.value]?.focus());
};
const onKeydown = (event: KeyboardEvent, index: number): void => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        focusAt(index + (event.key === "ArrowLeft" ? -1 : 1));
        return;
    }
    if (event.key === "Escape" && opened.value === null) {
        event.preventDefault();
        emit("escape");
    }
};

// 卸下（关掉了面包屑的设置、换成页面标签）：在途读取作废；焦点在面包屑里时交还编辑器（输出 52）。
onBeforeUnmount(() => {
    stop();
    if (nav.value !== null && nav.value.contains(document.activeElement)) emit("escape");
});

// 命令 `focus-breadcrumbs`：焦点放到最后一段（标题段或文件段）。
watch(() => props.focusSeq, (next, previous) => {
    if (next !== previous && next > 0 && total.value > 0) focusAt(total.value - 1);
});
</script>

<template>
    <nav v-if="segments.length > 0" ref="nav" class="editor-crumbs" :aria-label="t('crumbs.label')" data-editor-breadcrumbs>
        <template v-for="(segment, index) in segments" :key="segment.address">
            <span v-if="index > 0" class="i-lucide-chevron-right editor-crumbs__separator" aria-hidden="true"></span>
            <DropdownMenu :items="directoryItems" :open="opened === index" @update:open="(open: boolean) => openSegment(index, open)" @select="select">
                <button
                    type="button"
                    class="editor-crumbs__segment nb-ui-focus-ring-inset"
                    :class="segment.kind === 'dir' ? 'is-shrinkable' : ''"
                    :tabindex="focused === index ? 0 : -1"
                    :title="segment.address"
                    :data-breadcrumb-segment="segment.kind"
                    @keydown="onKeydown($event, index)"
                    @focus="focused = index"
                >
                    <FileIcon v-if="segment.icon !== undefined" :icon="segment.icon" class="editor-crumbs__icon" />
                    <span class="editor-crumbs__label">{{ segment.label }}</span>
                </button>
            </DropdownMenu>
        </template>
        <template v-if="currentHeading !== null">
            <span class="i-lucide-chevron-right editor-crumbs__separator" aria-hidden="true"></span>
            <DropdownMenu :items="outlineItems" :open="opened === HEADING" @update:open="(open: boolean) => openSegment(HEADING, open)" @select="select">
                <button
                    type="button"
                    class="editor-crumbs__segment nb-ui-focus-ring-inset"
                    :tabindex="focused === segments.length ? 0 : -1"
                    :title="currentHeading.text"
                    data-breadcrumb-segment="heading"
                    @keydown="onKeydown($event, segments.length)"
                    @focus="focused = segments.length"
                >
                    <span class="i-lucide-hash editor-crumbs__icon" aria-hidden="true"></span>
                    <span class="editor-crumbs__label">{{ currentHeading.text }}</span>
                </button>
            </DropdownMenu>
        </template>
    </nav>
</template>

<style scoped>
.editor-crumbs {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    height: 26px;
    padding-inline: 8px;
    overflow: hidden;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    background: var(--panel-surface);
    white-space: nowrap;
}

.editor-crumbs__separator {
    flex: none;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.editor-crumbs__segment {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    min-width: 0;
    height: 20px;
    padding-inline: 4px;
    border-radius: 4px;
}

/* 放不下时中间的目录段先缩短（截断），文件段与标题段不收缩。 */
.editor-crumbs__segment.is-shrinkable {
    flex: 0 1 auto;
    min-width: 24px;
}

.editor-crumbs__segment:hover,
.editor-crumbs__segment[data-state="open"] {
    background: var(--bg-hover);
    color: var(--text-main);
}

.editor-crumbs__icon {
    flex: none;
    width: 14px;
    height: 14px;
}

.editor-crumbs__label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
