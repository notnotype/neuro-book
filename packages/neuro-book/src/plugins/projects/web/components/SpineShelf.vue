<script setup lang="ts">
/** 书脊书架（同名 .md）：列表框、键盘与选中；扉页由父组件显示。 */
import {computed, ref} from "vue";

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {projectDisplayName} from "../../shared/shelf";
import type {ShelfItem} from "../../shared/shelf";
import {SPINE_HEIGHTS, spineHeight, spineHue, spineWidth} from "../shelf-format";
import BookSpine from "./BookSpine.vue";

defineOptions({name: "SpineShelf"});

const props = defineProps<{
    locale: DisplayLocale;
    items: ShelfItem[];
    activeId: string | null;
}>();

const emit = defineEmits<{
    (event: "update:activeId", id: string): void;
    (event: "open", id: string): void;
    (event: "remove", id: string): void;
    (event: "create"): void;
    (event: "add-existing"): void;
}>();

const TEXT = {
    label: {"zh-CN": "书架", "en-US": "Bookshelf"},
    create: {"zh-CN": "新建作品", "en-US": "New Book"},
    addExisting: {"zh-CN": "加入已有目录", "en-US": "Add Folder"},
    running: {"zh-CN": "已在一个窗口里打开", "en-US": "Open in a window"},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);

const TALLEST = `${String(Math.max(...SPINE_HEIGHTS))}px`;

const listbox = ref<HTMLElement | null>(null);
const optionId = (id: string): string => `book-spine-${id}`;
const activeIndex = computed(() => props.items.findIndex((item) => item.id === props.activeId));

function select(index: number): void {
    const item = props.items[index];
    if (item === undefined) return;
    emit("update:activeId", item.id);
    document.getElementById(optionId(item.id))?.scrollIntoView({block: "nearest", inline: "nearest"});
}

function onFocus(): void {
    if (activeIndex.value === -1) select(0);
}

function onKeydown(event: KeyboardEvent): void {
    const last = props.items.length - 1;
    if (last < 0) return;
    const current = activeIndex.value === -1 ? 0 : activeIndex.value;
    const moves: Record<string, number> = {ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: last};
    if (event.key in moves) {
        event.preventDefault();
        select(Math.min(last, Math.max(0, moves[event.key] as number)));
        return;
    }
    const active = props.items[current];
    if (active === undefined) return;
    if (event.key === "Enter") {
        event.preventDefault();
        emit("open", active.id);
    } else if (event.key === "Delete") {
        event.preventDefault();
        emit("remove", active.id);
    }
}

function onPick(index: number): void {
    listbox.value?.focus({preventScroll: true});
    select(index);
}
</script>

<template>
    <div class="spine-shelf" data-spine-shelf>
        <div
            v-if="items.length > 0"
            ref="listbox"
            class="spine-shelf__books"
            role="listbox"
            tabindex="0"
            aria-orientation="horizontal"
            :aria-label="text(TEXT.label)"
            :aria-activedescendant="activeIndex === -1 ? undefined : optionId(items[activeIndex]!.id)"
            @focus="onFocus"
            @keydown="onKeydown"
        >
            <BookSpine
                v-for="(item, index) in items"
                :id="optionId(item.id)"
                :key="item.id"
                :title="projectDisplayName(item)"
                :width="spineWidth(item.stats.words)"
                :height="spineHeight(item.id)"
                :hue="spineHue(item.id)"
                :color="item.color"
                :active="item.id === activeId"
                :running="item.state !== 'stopped'"
                :running-label="text(TEXT.running)"
                @click="onPick(index)"
                @dblclick="emit('open', item.id)"
            />
        </div>
        <div class="spine-shelf__blanks">
            <button type="button" class="spine-shelf__blank" data-shelf-create @click="emit('create')">
                <span class="spine-shelf__plus" aria-hidden="true">+</span>
                <span class="spine-shelf__blank-label">{{ text(TEXT.create) }}</span>
            </button>
            <button type="button" class="spine-shelf__blank" data-shelf-add @click="emit('add-existing')">
                <span class="spine-shelf__plus" aria-hidden="true">+</span>
                <span class="spine-shelf__blank-label">{{ text(TEXT.addExisting) }}</span>
            </button>
        </div>
    </div>
</template>

<style scoped>
.spine-shelf {
    /*
     * 一层的高度：最高的书脊 + 上移留白 14 + 搁板 2。每根书脊（与虚线书脊）的上边距补足到这个高度，一层里没有最高
     * 那档时搁板也不会错位；搁板线按这个间距重复，换行后每层都有一块板。
     */
    --shelf-tallest: v-bind(TALLEST);
    --shelf-row: calc(var(--shelf-tallest) + 16px);
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0 6px;
    background-image: repeating-linear-gradient(to bottom, transparent 0 calc(var(--shelf-row) - 2px), var(--divider) calc(var(--shelf-row) - 2px) var(--shelf-row));
}

.spine-shelf__books,
.spine-shelf__blanks {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0 6px;
}

.spine-shelf__books {
    flex: 0 1 auto;
    min-width: 0;
    border-radius: var(--radius-control);
    outline: none;
}

.spine-shelf__books > :deep(*),
.spine-shelf__blank {
    margin-top: calc(var(--shelf-tallest) + 14px - var(--spine-h));
    margin-bottom: 2px;
}

.spine-shelf__books:focus-visible :deep([aria-selected="true"]) {
    outline: var(--focus-outline);
    outline-offset: 2px;
}

.spine-shelf__blank {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    --spine-h: 208px;
    width: 44px;
    height: var(--spine-h);
    padding: 18px 0;
    border: 1px dashed var(--divider);
    border-radius: 3px 3px 2px 2px;
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: color var(--motion-fast) var(--ease-standard), border-color var(--motion-fast) var(--ease-standard);
}

.spine-shelf__blank:hover,
.spine-shelf__blank:focus-visible {
    border-color: var(--text-muted);
    color: var(--text-main);
}

.spine-shelf__blank:focus-visible {
    outline: var(--focus-outline);
    outline-offset: 2px;
}

.spine-shelf__plus {
    font-size: 18px;
    line-height: 1;
}

.spine-shelf__blank-label {
    letter-spacing: 0.1em;
    writing-mode: vertical-rl;
}
</style>
