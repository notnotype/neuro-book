<script setup lang="ts">
/** 卡片视图（同名 .md）：书卡网格的列表框语义与键盘；有作品时网格末尾一张“新建作品”占位，空书架时是两张“待写的书”。 */

import {computed, ref, watch} from "vue";

import type {ShelfItem} from "../../shared/shelf";
import {useProjectsText} from "../text";
import BookCard from "./BookCard.vue";

defineOptions({name: "ShelfCards"});

const props = defineProps<{
    items: ReadonlyArray<ShelfItem>;
    activeId: string | null;
    now: string;
    /** 一部作品的封面图地址；没有封面为 null。 */
    coverSrc: (item: ShelfItem) => string | null;
    /** 空书架时写在“新建作品”卡上的作品目录。 */
    library: string;
}>();

const emit = defineEmits<{
    (event: "update:activeId", id: string): void;
    (event: "open", id: string): void;
    (event: "open-new-window", id: string): void;
    (event: "edit", id: string): void;
    (event: "remove", id: string): void;
    (event: "create"): void;
    (event: "add-existing"): void;
}>();

const text = useProjectsText();

const grid = ref<HTMLElement | null>(null);
const optionId = (id: string): string => `book-card-${id}`;
const CREATE_OPTION = "book-card-create";
const activeIndex = computed(() => props.items.findIndex((item) => item.id === props.activeId));
/**
 * 键盘停在“新建作品”占位上。它是列表框的最后一个选项（和书卡在同一个网格流里），但不是一部作品，
 * 不进 `activeId`；选中了别的作品就回到作品上。
 */
const createActive = ref(false);
watch(() => props.activeId, () => {
    createActive.value = false;
});

/** 网格的列数：第一行里 offsetTop 相同的选项数（占位也算，它占一格）；方向键上下按它跳。 */
function columns(): number {
    const options = [...(grid.value?.querySelectorAll<HTMLElement>("[role='option']") ?? [])];
    if (options.length === 0) return 1;
    const top = options[0]?.offsetTop;
    return Math.max(1, options.filter((option) => option.offsetTop === top).length);
}

/** 移到第 index 个选项；index 等于作品数时是“新建作品”占位。 */
function select(index: number): void {
    if (index === props.items.length) {
        createActive.value = true;
        document.getElementById(CREATE_OPTION)?.scrollIntoView({block: "nearest"});
        return;
    }
    const item = props.items[index];
    if (item === undefined) return;
    createActive.value = false;
    emit("update:activeId", item.id);
    document.getElementById(optionId(item.id))?.scrollIntoView({block: "nearest"});
}

function onFocus(): void {
    if (activeIndex.value === -1 && !createActive.value && props.items.length > 0) select(0);
}

function onKeydown(event: KeyboardEvent): void {
    const last = props.items.length;
    if (last === 0) return;
    const current = createActive.value ? last : activeIndex.value === -1 ? 0 : activeIndex.value;
    const step = columns();
    const moves: Record<string, number> = {ArrowLeft: current - 1, ArrowRight: current + 1, ArrowUp: current - step, ArrowDown: current + step, Home: 0, End: last};
    if (event.key in moves) {
        event.preventDefault();
        select(Math.min(last, Math.max(0, moves[event.key] as number)));
        return;
    }
    if (createActive.value) {
        if (event.key === "Enter") {
            event.preventDefault();
            emit("create");
        }
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

function onPick(id: string): void {
    grid.value?.focus({preventScroll: true});
    emit("update:activeId", id);
}
</script>

<template>
    <div
        v-if="items.length > 0"
        ref="grid"
        class="shelf-cards"
        role="listbox"
        tabindex="0"
        :aria-label="text('shelfCards.label')"
        :aria-activedescendant="createActive ? CREATE_OPTION : activeIndex === -1 ? undefined : optionId(items[activeIndex]!.id)"
        data-shelf-cards
        @focus="onFocus"
        @keydown="onKeydown"
    >
        <BookCard
            v-for="item in items"
            :key="item.id"
            :option-id="optionId(item.id)"
            :item="item"
            :now="now"
            :cover-src="coverSrc(item)"
            :active="item.id === activeId"
            :highlighted="item.id === activeId && !createActive"
            @pick="onPick"
            @open="emit('open', $event)"
            @open-new-window="emit('open-new-window', $event)"
            @edit="emit('edit', $event)"
            @remove="emit('remove', $event)"
        />
        <!-- 末尾的“新建作品”是列表框的最后一个选项：和书卡同一个网格流，方向键走得到，回车新建；它不是作品，不会被选中。 -->
        <div :id="CREATE_OPTION" role="option" aria-selected="false" class="shelf-ghost" :class="{'shelf-ghost--active': createActive}" data-shelf-create-card @click="emit('create')">
            <span class="shelf-ghost__slot" aria-hidden="true"><span class="shelf-ghost__plus">+</span></span>
            <span class="shelf-ghost__text">
                <span class="shelf-ghost__title">{{ text('shelfCards.create') }}</span>
                <span class="shelf-ghost__blurb">{{ text('shelfCards.createText') }}</span>
                <span class="shelf-ghost__foot">{{ text('shelfCards.createWhere', {library}) }}</span>
            </span>
        </div>
    </div>
    <div v-else class="shelf-cards shelf-cards--empty" data-shelf-cards data-shelf-empty>
        <!-- 空书架：两张和书卡同样大小的“待写的书”，书架从空到有只是网格里多了几张卡。 -->
        <button type="button" class="shelf-ghost" data-shelf-create @click="emit('create')">
            <span class="shelf-ghost__slot" aria-hidden="true"><span class="shelf-ghost__plus">+</span></span>
            <span class="shelf-ghost__text">
                <span class="shelf-ghost__title">{{ text('shelfCards.create') }}</span>
                <span class="shelf-ghost__blurb">{{ text('shelfCards.createText') }}</span>
                <span class="shelf-ghost__foot">{{ text('shelfCards.createWhere', {library}) }}</span>
            </span>
        </button>
        <button type="button" class="shelf-ghost" data-shelf-add @click="emit('add-existing')">
            <span class="shelf-ghost__slot" aria-hidden="true"><span class="i-lucide-folder shelf-ghost__folder"></span></span>
            <span class="shelf-ghost__text">
                <span class="shelf-ghost__title">{{ text('shelfCards.open') }}</span>
                <span class="shelf-ghost__blurb">{{ text('shelfCards.openText') }}</span>
                <span class="shelf-ghost__foot">{{ text('shelfCards.openWhere') }}</span>
            </span>
        </button>
    </div>
</template>

<style scoped>
.shelf-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: var(--space-4);
    outline: none;
}


.shelf-ghost {
    display: flex;
    gap: var(--space-5);
    padding: var(--space-5) var(--space-5) var(--space-4);
    border: var(--border-w) solid color-mix(in srgb, var(--text-main) 12%, transparent);
    border-radius: 16px;
    background: color-mix(in srgb, var(--page-surface, var(--bg-panel)) 55%, transparent);
    color: var(--text-main);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--motion-fast) var(--ease-layout), box-shadow var(--motion-fast) var(--ease-layout);
}

.shelf-ghost:hover {
    background: var(--page-surface, var(--bg-panel));
    box-shadow: var(--page-lift, var(--elevation-flat));
}

.shelf-ghost:focus-visible,
.shelf-ghost--active {
    outline: none;
    box-shadow: var(--focus-ring);
}

.shelf-ghost__slot {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 84px;
    aspect-ratio: 2 / 3;
    border: 1.5px dashed color-mix(in srgb, var(--text-main) 24%, transparent);
    border-radius: 4px;
    color: var(--text-muted);
}

.shelf-ghost__plus {
    font-size: 26px;
    font-weight: 300;
    line-height: 1;
}

.shelf-ghost__folder {
    width: 26px;
    height: 26px;
    color: color-mix(in srgb, var(--status-warning) 70%, var(--text-muted));
}

.shelf-ghost__text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
}

.shelf-ghost__title {
    margin-top: 2px;
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: var(--weight-strong);
    line-height: 1.25;
}

.shelf-ghost__blurb {
    margin-top: var(--space-2);
    color: var(--text-secondary);
    font-family: var(--font-display);
    font-size: var(--text-sm);
    line-height: 1.65;
}

.shelf-ghost__foot {
    margin-top: auto;
    padding-top: var(--space-3);
    overflow-wrap: anywhere;
    color: var(--text-muted);
    font-size: var(--text-xs);
}
</style>
