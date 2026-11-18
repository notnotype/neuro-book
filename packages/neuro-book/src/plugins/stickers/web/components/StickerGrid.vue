<script setup lang="ts">
import {Button, InfoTip, Spinner} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref} from "vue";

import type {StickerPackDetail} from "../../shared/contracts";
import {addCellGroup, afterRemoval, gridGroups, moveSelection} from "../pack-view";
import type {GridGroupId, NavigationKey} from "../pack-view";
import {useStickersPageText} from "../text";
import type {UploadItem} from "../upload-queue";
import StickerSlot from "./StickerSlot.vue";

/** 表情包页的表情网格（同名 .md）。 */
const props = withDefaults(defineProps<{
    detail: StickerPackDetail;
    selected: string | null;
    uploads?: readonly UploadItem[];
    readonly?: boolean;
    dragging?: boolean;
    dragCount?: number;
}>(), {uploads: () => [], readonly: false, dragging: false, dragCount: 0});

const emit = defineEmits<{
    (e: "select", key: string | null): void;
    (e: "delete", key: string): void;
    (e: "add-images", files: File[]): void;
    (e: "list-files", files: "all"): void;
}>();

const text = useStickersPageText();
const root = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const groups = computed(() => gridGroups(props.detail));
const addGroup = computed<GridGroupId | null>(() => addCellGroup(groups.value));
const flat = computed(() => groups.value.flatMap((group) => group.items));
/** Tab 序里的那一格：选中的，没有选中（或选中的不在这个包里）时第一个。 */
const tabbable = computed(() => (flat.value.some((item) => item.key === props.selected) ? props.selected : flat.value[0]?.key ?? null));
const empty = computed(() => flat.value.length === 0 && props.uploads.length === 0);
const GROUP_TEXT = {problem: "group.problem", common: "group.common", other: "group.other", unlisted: "group.unlisted"} as const;

/** 列表被截掉的张数（总数照实，详情只带了前面一部分）。 */
function hidden(id: GridGroupId): number {
    const listed = props.detail.extras.filter((extra) => extra.reason === (id === "problem" ? "name" : "unlisted")).length;
    if (id === "problem") return Math.max(0, props.detail.summary.unrecognized - listed);
    if (id === "unlisted") return Math.max(0, props.detail.summary.unlisted - listed);
    return 0;
}

function columns(): number {
    const grid = root.value?.querySelector<HTMLElement>("[data-sticker-grid]");
    if (grid === null || grid === undefined) return 1;
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter((track) => track !== "").length);
}

function focusKey(key: string | null): void {
    if (key === null) return;
    void nextTick(() => {
        for (const element of root.value?.querySelectorAll<HTMLElement>("[data-grid-key]") ?? []) {
            if (element.dataset.gridKey === key) {
                element.focus();
                element.scrollIntoView?.({block: "nearest"});
                return;
            }
        }
    });
}

function onKeydown(event: KeyboardEvent): void {
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-grid-key")) return;
    const key = event.target.dataset.gridKey ?? null;
    // 带修饰键的是浏览器与系统的快捷键（Ctrl+Home、Alt+方向键……），不是网格的。
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "Escape") {
        // 有选中时 Esc 只是回到表情包，设置窗口不跟着关（窗口按 `defaultPrevented` 判断内层控件已处理）；没有选中时放行。
        if (props.selected === null) return;
        event.preventDefault();
        emit("select", null);
        return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
        if (props.readonly || key === null) return;
        event.preventDefault();
        emit("delete", key);
        return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = moveSelection(groups.value, key, event.key as NavigationKey, columns());
    if (next === null) return;
    emit("select", next);
    focusKey(next);
}

function chosen(event: Event): void {
    const element = event.target as HTMLInputElement;
    const files = [...(element.files ?? [])];
    element.value = "";
    if (files.length > 0) emit("add-images", files);
}

defineExpose({afterRemoval: (key: string): string | null => afterRemoval(groups.value, key), focusKey});
</script>

<template>
    <div ref="root" class="sticker-sheet" data-sticker-dropzone :data-readonly="readonly || undefined" :class="{'is-dragging': dragging && !readonly}" @keydown="onKeydown">
        <input ref="input" class="sticker-sheet__file" type="file" multiple accept="image/png,image/gif,image/webp,image/jpeg" tabindex="-1" aria-hidden="true" data-sticker-file @change="chosen" />
        <button v-if="empty && !readonly" type="button" class="sticker-sheet__empty nb-ui-focus-ring" data-sticker-empty @click="input?.click()">
            <span class="i-lucide-image-plus sticker-sheet__empty-icon" aria-hidden="true" />
            <span>{{ text("grid.dropEmpty") }}</span>
        </button>
        <section v-for="group in groups" :key="group.id" class="sticker-group" :class="`sticker-group--${group.id}`" :data-sticker-group="group.id">
            <div class="sticker-group__head">
                <h3 :id="`sticker-group-${group.id}`" class="sticker-group__title">{{ text(GROUP_TEXT[group.id]) }}</h3>
                <span class="sticker-group__count">{{ group.items.length }}</span>
                <InfoTip v-if="group.id === 'common'" :text="text('group.commonTip')" />
                <span v-if="hidden(group.id) > 0" class="sticker-group__more">{{ text("group.more", {count: String(hidden(group.id))}) }}</span>
                <Button v-if="group.id === 'unlisted' && !readonly" class="sticker-group__action" size="sm" variant="secondary" data-sticker-list-all @click="emit('list-files', 'all')">{{ text("group.addAll") }}</Button>
            </div>
            <div class="sticker-grid" data-sticker-grid>
                <div role="listbox" class="sticker-grid__list" :aria-labelledby="`sticker-group-${group.id}`">
                    <div
                        v-for="item in group.items"
                        :key="item.key"
                        role="option"
                        class="sticker-tile nb-ui-focus-ring"
                        :aria-selected="item.key === selected"
                        :tabindex="item.key === tabbable ? 0 : -1"
                        :data-grid-key="item.key"
                        :title="item.label"
                        @click="emit('select', item.key)"
                    >
                        <StickerSlot class="sticker-tile__slot" :url="item.url" :faded="item.reason !== null" lazy />
                        <span class="sticker-tile__name">{{ item.label }}</span>
                    </div>
                </div>
                <template v-if="group.id === addGroup">
                    <div v-for="upload in uploads" :key="upload.id" class="sticker-tile sticker-tile--uploading" :title="text('grid.uploading', {name: upload.name})" data-sticker-uploading>
                        <StickerSlot class="sticker-tile__slot"><Spinner /></StickerSlot>
                        <span class="sticker-tile__name">{{ upload.name }}</span>
                    </div>
                    <button v-if="!readonly" type="button" class="sticker-tile sticker-tile--add nb-ui-focus-ring" data-sticker-add @click="input?.click()">
                        <span class="sticker-tile__add"><span class="i-lucide-plus" /></span>
                        <span class="sticker-tile__name">{{ text("grid.add") }}</span>
                    </button>
                </template>
            </div>
        </section>
        <div v-if="addGroup === null && !empty" class="sticker-grid sticker-grid--solo" data-sticker-grid>
            <div v-for="upload in uploads" :key="upload.id" class="sticker-tile sticker-tile--uploading" :title="text('grid.uploading', {name: upload.name})" data-sticker-uploading>
                <StickerSlot class="sticker-tile__slot"><Spinner /></StickerSlot>
                <span class="sticker-tile__name">{{ upload.name }}</span>
            </div>
            <button v-if="!readonly" type="button" class="sticker-tile sticker-tile--add nb-ui-focus-ring" data-sticker-add @click="input?.click()">
                <span class="sticker-tile__add"><span class="i-lucide-plus" /></span>
                <span class="sticker-tile__name">{{ text("grid.add") }}</span>
            </button>
        </div>
        <div v-if="empty && readonly" class="sticker-sheet__empty-readonly">{{ text("rail.noThumb") }}</div>
        <div v-if="dragging && !readonly" class="sticker-sheet__drop" data-sticker-drop>
            <span class="i-lucide-image-down sticker-sheet__drop-icon" aria-hidden="true" />
            <span>{{ text("grid.drop", {count: String(dragCount)}) }}</span>
        </div>
    </div>
</template>

<style scoped>
.sticker-sheet {
    position: relative;
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: var(--space-4);
}

.sticker-sheet__file {
    display: none;
}

.sticker-sheet.is-dragging > .sticker-group,
.sticker-sheet.is-dragging > .sticker-grid {
    opacity: 0.35;
}

.sticker-sheet__empty {
    display: flex;
    min-height: 160px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    font: inherit;
    color: var(--text-muted);
    border: 1.5px dashed var(--divider);
    border-radius: var(--radius-panel);
    background: none;
    cursor: pointer;
}

.sticker-sheet__empty:hover {
    color: var(--text-main);
}

.sticker-sheet__empty-icon {
    width: 28px;
    height: 28px;
}

.sticker-sheet__empty-readonly {
    color: var(--text-muted);
}

.sticker-sheet__drop {
    position: absolute;
    inset: calc(var(--space-2) * -1);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border: 1.5px dashed var(--accent-main);
    border-radius: var(--radius-panel);
    background: color-mix(in srgb, var(--accent-main) 6%, transparent);
    color: var(--accent-main);
    pointer-events: none;
}

.sticker-sheet__drop-icon {
    width: 28px;
    height: 28px;
}

.sticker-group__head {
    display: flex;
    min-height: var(--control-h-sm);
    align-items: center;
    gap: var(--space-1);
    margin-bottom: var(--space-1);
    font-size: var(--text-xs);
    line-height: 18px;
    color: var(--text-muted);
}

.sticker-group__title {
    margin: 0;
    font-size: inherit;
    font-weight: 600;
    color: var(--text-main);
}

.sticker-group--problem .sticker-group__title {
    color: var(--status-danger);
}

.sticker-group__count {
    font-variant-numeric: tabular-nums;
}

.sticker-group__more {
    margin-left: var(--space-2);
}

.sticker-group__action {
    margin-left: auto;
}

.sticker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, 84px);
    gap: var(--space-1) var(--space-2);
}

.sticker-grid__list {
    display: contents;
}

.sticker-tile {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: var(--space-2) 2px var(--space-1);
    font: inherit;
    color: var(--text-muted);
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    cursor: pointer;
    transition: color var(--motion-fast);
}

.sticker-tile:hover {
    color: var(--text-main);
}

.sticker-tile--uploading {
    cursor: progress;
}

.sticker-tile__slot {
    width: 72px;
    height: 72px;
    padding: 6px;
}

.sticker-tile:hover .sticker-tile__slot {
    background: color-mix(in srgb, var(--text-main) 8%, transparent);
}

.sticker-tile[aria-selected="true"] {
    color: var(--text-main);
}

.sticker-tile[aria-selected="true"] .sticker-tile__slot {
    background: color-mix(in srgb, var(--accent-main) 12%, transparent);
    box-shadow: inset 0 0 0 2px var(--accent-main);
}

.sticker-group--problem .sticker-tile__name {
    color: var(--status-danger);
}

.sticker-tile__name {
    max-width: 100%;
    overflow: hidden;
    font-size: var(--text-xs);
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sticker-tile__add {
    display: flex;
    width: 72px;
    height: 72px;
    align-items: center;
    justify-content: center;
    border: 1.5px dashed var(--divider);
    border-radius: var(--radius-control);
    transition: border-color var(--motion-fast);
}

.sticker-tile--add:hover .sticker-tile__add {
    border-color: var(--text-muted);
}

.sticker-tile__add > span {
    width: 20px;
    height: 20px;
}
</style>
