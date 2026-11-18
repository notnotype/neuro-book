<script setup lang="ts">
import {Button, Input} from "@notnotype/nb-ui/components";
import {computed, nextTick, onMounted, ref, shallowRef, useId, watch} from "vue";

import type {StickerPicker, StickerPickerItem} from "../../shared/contracts";
import {useStickersPageText} from "../text";

const props = defineProps<{picker: StickerPicker}>();
const emit = defineEmits<{(event: "pick", item: StickerPickerItem, keepOpen: boolean): void; (event: "close", reason: "escape" | "blur"): void}>();

const text = useStickersPageText();
const id = useId();
const COLUMNS = 6;
const RECENT = "recent";

const root = ref<HTMLElement | null>(null);
const body = ref<HTMLElement | null>(null);
const query = ref("");
const pointed = ref<StickerPickerItem | null>(null);
const current = ref<string | null>(null);
/**
 * “最近用过”按打开那一刻定下：按住 Shift 连着插时插一个记一个，活的列表会在手底下重排。目录晚到（打开时还是空的）时等它到了再取
 * 一次。
 */
const recentAtOpen = shallowRef<readonly StickerPickerItem[]>(props.picker.recent());
watch(() => props.picker.groups().length > 0, (ready, wasReady) => {
    if (ready && !wasReady && recentAtOpen.value.length === 0) recentAtOpen.value = props.picker.recent();
});

interface ShownGroup {
    readonly id: string;
    readonly title: string | null;
    readonly plugin: string | null;
    readonly items: readonly StickerPickerItem[];
}

const groups = computed<ShownGroup[]>(() => {
    const trimmed = query.value.trim();
    if (trimmed !== "") return [{id: "result", title: null, plugin: null, items: props.picker.search(trimmed, 60)}];
    const recent = recentAtOpen.value;
    return [...(recent.length === 0 ? [] : [{id: RECENT, title: text("picker.recent"), plugin: null, items: recent}]), ...props.picker.groups()];
});
const items = computed(() => groups.value.flatMap((group) => group.items));
const empty = computed(() => query.value.trim() === "" && items.value.length === 0);
const tabs = computed(() => (query.value.trim() === "" ? groups.value : []));
const footer = computed(() => pointed.value ?? items.value[0] ?? null);
const active = computed(() => current.value ?? groups.value[0]?.id ?? null);

const keyOf = (item: StickerPickerItem): string => `${item.pack}/${item.name}`;
/** 整个网格里在 Tab 序里的那一格：指着的，没有时第一个。 */
const tabStop = computed(() => (pointed.value !== null && items.value.some((item) => keyOf(item) === keyOf(pointed.value as StickerPickerItem)) ? keyOf(pointed.value) : (items.value[0] === undefined ? null : keyOf(items.value[0]))));

onMounted(() => {
    void nextTick(() => root.value?.querySelector<HTMLInputElement>("input")?.focus());
});

function pick(item: StickerPickerItem, keepOpen: boolean): void {
    emit("pick", item, keepOpen);
}

function onSearchKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "ArrowDown") {
        event.preventDefault();
        focusCell(0);
    } else if (event.key === "Enter") {
        const first = items.value[0];
        if (first === undefined) return;
        event.preventDefault();
        pick(first, event.shiftKey);
    }
}

function focusCell(index: number): void {
    const cells = root.value?.querySelectorAll<HTMLElement>("[data-sticker-cell]");
    const target = cells?.[index];
    if (target === undefined) return;
    target.focus();
    target.scrollIntoView({block: "nearest"});
}

/** 网格里一格的位置：第几组、组里第几个。上下按 6 列，跨组到下一组（上一组）的同一列，组不够长取最后一个。 */
function moved(index: number, key: string): number | null {
    const sizes = groups.value.map((group) => group.items.length);
    let group = 0;
    let offset = index;
    while (group < sizes.length && offset >= (sizes[group] ?? 0)) {
        offset -= sizes[group] ?? 0;
        group += 1;
    }
    const start = (at: number): number => sizes.slice(0, at).reduce((sum, size) => sum + size, 0);
    const total = items.value.length;
    switch (key) {
        case "ArrowLeft": return index > 0 ? index - 1 : null;
        case "ArrowRight": return index < total - 1 ? index + 1 : null;
        case "Home": return 0;
        case "End": return total - 1;
        case "ArrowDown": {
            const size = sizes[group] ?? 0;
            if (offset + COLUMNS < size) return index + COLUMNS;
            if (Math.floor(offset / COLUMNS) < Math.floor((size - 1) / COLUMNS)) return start(group) + size - 1;
            const next = sizes.findIndex((value, at) => at > group && value > 0);
            return next < 0 ? null : start(next) + Math.min(offset % COLUMNS, (sizes[next] ?? 1) - 1);
        }
        case "ArrowUp": {
            if (offset >= COLUMNS) return index - COLUMNS;
            for (let previous = group - 1; previous >= 0; previous -= 1) {
                const size = sizes[previous] ?? 0;
                if (size === 0) continue;
                const lastRow = Math.floor((size - 1) / COLUMNS) * COLUMNS;
                return start(previous) + Math.min(lastRow + (offset % COLUMNS), size - 1);
            }
            return null;
        }
        default: return null;
    }
}

function onCellKeydown(event: KeyboardEvent, index: number, item: StickerPickerItem): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "Enter") {
        event.preventDefault();
        pick(item, event.shiftKey);
        return;
    }
    const next = moved(index, event.key);
    if (next === null) return;
    event.preventDefault();
    focusCell(next);
}

function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    emit("close", "escape");
}

function onFocusout(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && root.value?.contains(next) === true) return;
    emit("close", "blur");
}

function showGroup(groupId: string): void {
    current.value = groupId;
    const head = body.value?.querySelector<HTMLElement>(`[data-sticker-group="${CSS.escape(groupId)}"]`);
    if (head !== null && head !== undefined && body.value !== null) body.value.scrollTop = head.offsetTop - body.value.offsetTop;
}

/** 滚动时亮起顶上那一组的标签。 */
function onScroll(): void {
    const container = body.value;
    if (container === null) return;
    const top = container.scrollTop + container.offsetTop + 8;
    let seen: string | null = null;
    for (const head of container.querySelectorAll<HTMLElement>("[data-sticker-group]")) {
        if (head.offsetTop <= top) seen = head.dataset.stickerGroup ?? null;
    }
    current.value = seen;
}

function openPacksPage(): void {
    props.picker.openPacksPage();
    // 焦点去了设置窗口：宿主不把焦点要回来。
    emit("close", "blur");
}

const indexOf = (groupIndex: number, itemIndex: number): number => groups.value.slice(0, groupIndex).reduce((sum, group) => sum + group.items.length, 0) + itemIndex;
</script>

<template>
    <div ref="root" class="sticker-picker" role="dialog" :aria-label="text('picker.label')" data-sticker-picker-panel @keydown="onKeydown" @focusout="onFocusout">
        <div class="sticker-picker__search">
            <Input v-model="query" size="sm" type="search" icon-class="i-lucide-search" :placeholder="text('picker.search')" :aria-controls="`${id}-body`" autocomplete="off" @keydown="onSearchKeydown" />
        </div>
        <nav v-if="tabs.length > 0" class="sticker-picker__tabs" :aria-label="text('picker.packs')">
            <button
                v-for="group in tabs" :key="group.id" type="button" class="sticker-picker__tab" :aria-current="group.id === active ? 'true' : undefined"
                :title="group.title ?? ''" :aria-label="group.title ?? ''" tabindex="-1" data-sticker-picker-tab @mousedown.prevent @click="showGroup(group.id)"
            >
                <span v-if="group.id === 'recent'" class="i-lucide-clock sticker-picker__tab-icon" aria-hidden="true" />
                <img v-else-if="group.items[0]" :src="group.items[0].url" alt="" class="sticker-picker__tab-image" draggable="false">
            </button>
        </nav>
        <div :id="`${id}-body`" ref="body" class="sticker-picker__body" @scroll.passive="onScroll">
            <div v-if="empty" class="sticker-picker__empty">
                <span class="i-lucide-sticker sticker-picker__empty-icon" aria-hidden="true" />
                <p>{{ text("picker.empty") }}</p>
                <Button size="sm" variant="ghost" data-sticker-picker-create @click="openPacksPage">{{ text("picker.create") }}</Button>
            </div>
            <p v-else-if="items.length === 0" class="sticker-picker__empty">{{ text("picker.noResult", {query: query.trim()}) }}</p>
            <section v-for="(group, groupIndex) in groups" :key="group.id" class="sticker-picker__group" :data-sticker-group="group.id">
                <h3 v-if="group.title !== null" class="sticker-picker__head">
                    <span>{{ group.title }}</span>
                    <span v-if="group.plugin !== null" class="sticker-picker__plugin">{{ group.plugin }}</span>
                </h3>
                <div class="sticker-picker__grid" role="listbox" :aria-label="group.title ?? text('picker.results')">
                    <button
                        v-for="(item, itemIndex) in group.items" :key="keyOf(item)" type="button" role="option" class="sticker-picker__cell"
                        :aria-label="item.name" :title="item.raw" :aria-selected="pointed !== null && keyOf(pointed) === keyOf(item)" :tabindex="keyOf(item) === tabStop ? 0 : -1"
                        data-sticker-cell :data-sticker-raw="item.raw"
                        @pointerenter="pointed = item" @focus="pointed = item"
                        @click="pick(item, $event.shiftKey)" @keydown="onCellKeydown($event, indexOf(groupIndex, itemIndex), item)"
                    >
                        <img :src="item.url" alt="" class="sticker-picker__image" loading="lazy" draggable="false">
                    </button>
                </div>
            </section>
        </div>
        <footer v-if="footer !== null" class="sticker-picker__foot" aria-hidden="true">
            <img :src="footer.url" alt="" class="sticker-picker__foot-image" draggable="false">
            <span class="sticker-picker__foot-name">{{ footer.name }}</span>
            <code class="sticker-picker__foot-raw">{{ footer.raw }}</code>
        </footer>
    </div>
</template>

<style scoped>
.sticker-picker {
    display: flex;
    width: 352px;
    max-width: 100%;
    height: 420px;
    max-height: 100%;
    box-sizing: border-box;
    flex-direction: column;
    color: var(--text-main);
    font-size: var(--text-sm);
}

.sticker-picker__search {
    padding: var(--space-2) var(--space-2) 6px;
}

.sticker-picker__tabs {
    display: flex;
    gap: 2px;
    overflow-x: auto;
    padding: 0 var(--space-2) 6px;
    border-bottom: var(--border-w, 1px) solid var(--divider);
    scrollbar-width: none;
}

.sticker-picker__tab {
    display: inline-flex;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    padding: 3px;
    border: 0;
    border-radius: var(--radius-control);
    color: var(--text-muted);
    background: none;
    cursor: pointer;
}

.sticker-picker__tab:hover,
.sticker-picker__tab[aria-current="true"] {
    color: var(--text-main);
    background: var(--overlay-item-active);
}

.sticker-picker__tab-icon {
    width: 16px;
    height: 16px;
}

.sticker-picker__tab-image {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.sticker-picker__body {
    position: relative;
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 6px var(--space-2) var(--space-2);
}

.sticker-picker__group + .sticker-picker__group {
    margin-top: var(--space-2);
}

.sticker-picker__head {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin: 0;
    padding: 4px;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-muted);
}

.sticker-picker__plugin {
    font-weight: 400;
}

.sticker-picker__grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 2px;
}

.sticker-picker__cell {
    display: flex;
    aspect-ratio: 1;
    min-width: 0;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    cursor: pointer;
}

.sticker-picker__cell:hover,
.sticker-picker__cell[aria-selected="true"] {
    background: var(--overlay-item-active);
}

.sticker-picker__cell:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: -2px;
}

.sticker-picker__image {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.sticker-picker__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 48px var(--space-3);
    color: var(--text-muted);
    text-align: center;
}

.sticker-picker__empty p {
    margin: 0;
}

.sticker-picker__empty-icon {
    width: 28px;
    height: 28px;
}

.sticker-picker__foot {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-2);
    padding: 6px var(--space-3);
    border-top: var(--border-w, 1px) solid var(--divider);
}

.sticker-picker__foot-image {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    object-fit: contain;
}

.sticker-picker__foot-name {
    flex-shrink: 0;
    font-weight: 600;
}

.sticker-picker__foot-raw {
    overflow: hidden;
    margin-left: auto;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
