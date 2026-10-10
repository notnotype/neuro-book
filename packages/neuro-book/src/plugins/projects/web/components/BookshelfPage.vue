<script setup lang="ts">
/** 书架页（同名 .md）：继续写作与书架两种视图；只呈现数据、发出用户动作。 */
import {Button, FormSelect, SegmentedControl, Skeleton} from "@notnotype/nb-ui/components";
import {useElementSize} from "@vueuse/core";
import {computed, ref} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import type {ShelfItem} from "../../shared/shelf";
import {continueTarget, sortShelf} from "../shelf-format";
import type {ShelfSort} from "../shelf-format";
import ContinueCard from "./ContinueCard.vue";
import ShelfList from "./ShelfList.vue";
import ShelfTitlePage from "./ShelfTitlePage.vue";
import SpineShelf from "./SpineShelf.vue";

defineOptions({name: "BookshelfPage"});

type ShelfView = "spines" | "list";

const props = withDefaults(defineProps<{
    locale: DisplayLocale;
    status: "loading" | "ready" | "error";
    error?: string;
    items: ShelfItem[];
    now: string;
    view: ShelfView;
    sort: ShelfSort;
    activeId: string | null;
}>(), {error: ""});

const emit = defineEmits<{
    (event: "update:view", view: ShelfView): void;
    (event: "update:sort", sort: ShelfSort): void;
    (event: "update:activeId", id: string): void;
    (event: "continue", id: string): void;
    (event: "open", id: string): void;
    (event: "open-new-window", id: string): void;
    (event: "edit", id: string): void;
    (event: "remove", id: string): void;
    (event: "create"): void;
    (event: "add-existing"): void;
    (event: "enter-workbench"): void;
    (event: "retry"): void;
}>();

const TEXT = {
    brand: {"zh-CN": "书房", "en-US": "Study"},
    workbench: {"zh-CN": "进入工作台", "en-US": "Open Workbench"},
    shelf: {"zh-CN": "书架", "en-US": "Bookshelf"},
    count: {"zh-CN": "{count} 部", "en-US": "{count} books"},
    view: {"zh-CN": "视图", "en-US": "View"},
    spines: {"zh-CN": "书脊", "en-US": "Spines"},
    list: {"zh-CN": "列表", "en-US": "List"},
    sort: {"zh-CN": "排序", "en-US": "Sort"},
    recent: {"zh-CN": "最近编辑", "en-US": "Recently Edited"},
    title: {"zh-CN": "书名", "en-US": "Title"},
    words: {"zh-CN": "字数", "en-US": "Word Count"},
    welcome: {"zh-CN": "还没有写作记录。打开一部作品，写下的字会记在这里。", "en-US": "Nothing written yet. Open a book and your progress will show up here."},
    empty: {"zh-CN": "书架还是空的。新建一部作品，或把已有的作品目录加进来。", "en-US": "The shelf is empty. Start a new book, or add a folder you already have."},
    retry: {"zh-CN": "重试", "en-US": "Retry"},
} satisfies Record<string, LocalizedText>;

/** 不足这个宽度只用列表：书脊太细，竖排书名放不下。 */
const NARROW_WIDTH = 720;

const text = (value: LocalizedText): string => localize(value, props.locale);

const root = ref<HTMLElement | null>(null);
const {width} = useElementSize(root);
// 首次量出宽度之前按宽屏排，避免桌面上先闪一帧列表。
const narrow = computed(() => width.value > 0 && width.value < NARROW_WIDTH);
const effectiveView = computed<ShelfView>(() => (narrow.value ? "list" : props.view));

const sorted = computed(() => sortShelf(props.items, props.sort, props.locale));
const target = computed(() => continueTarget(props.items));
const active = computed(() => props.items.find((item) => item.id === props.activeId) ?? null);

const viewOptions = computed(() => [{value: "spines", label: text(TEXT.spines)}, {value: "list", label: text(TEXT.list)}]);
const sortOptions = computed(() => [
    {value: "recent", label: text(TEXT.recent)},
    {value: "title", label: text(TEXT.title)},
    {value: "words", label: text(TEXT.words)},
]);

function onView(value: unknown): void {
    if (value === "spines" || value === "list") emit("update:view", value);
}

function onSort(value: string): void {
    if (value === "recent" || value === "title" || value === "words") emit("update:sort", value);
}
</script>

<template>
    <main ref="root" class="bookshelf-page" :class="{'bookshelf-page--narrow': narrow}" data-bookshelf-page>
        <div class="bookshelf-page__column">
            <header class="bookshelf-page__header">
                <p class="bookshelf-page__brand">NeuroBook <span class="bookshelf-page__room">· {{ text(TEXT.brand) }}</span></p>
                <Button variant="ghost" size="sm" data-enter-workbench @click="emit('enter-workbench')">{{ text(TEXT.workbench) }}</Button>
            </header>

            <template v-if="status === 'loading'">
                <Skeleton shape="block" height="196px" />
                <Skeleton shape="block" height="224px" />
            </template>

            <div v-else-if="status === 'error'" class="bookshelf-page__error" role="alert">
                <p>{{ error }}</p>
                <Button size="sm" @click="emit('retry')">{{ text(TEXT.retry) }}</Button>
            </div>

            <template v-else>
                <ContinueCard v-if="target !== null" :locale="locale" :item="target" :now="now" @continue="emit('continue', $event)" />
                <p v-else class="bookshelf-page__welcome">{{ text(items.length === 0 ? TEXT.empty : TEXT.welcome) }}</p>

                <section class="bookshelf-page__shelf" :aria-label="text(TEXT.shelf)">
                    <div class="bookshelf-page__shelf-head">
                        <h2 class="bookshelf-page__shelf-title">
                            {{ text(TEXT.shelf) }}
                            <span v-if="items.length > 0" class="bookshelf-page__count">· {{ text(formatText(TEXT.count, {count: items.length})) }}</span>
                        </h2>
                        <div class="bookshelf-page__tools">
                            <SegmentedControl v-if="!narrow" :model-value="view" :options="viewOptions" :aria-label="text(TEXT.view)" @update:model-value="onView" />
                            <label class="bookshelf-page__sort-label" for="bookshelf-sort">{{ text(TEXT.sort) }}</label>
                            <FormSelect id="bookshelf-sort" :model-value="sort" :options="sortOptions" size="sm" class="bookshelf-page__sort" @update:model-value="onSort" />
                        </div>
                    </div>

                    <template v-if="effectiveView === 'spines'">
                        <SpineShelf
                            :locale="locale"
                            :items="sorted"
                            :active-id="activeId"
                            @update:active-id="emit('update:activeId', $event)"
                            @open="emit('open', $event)"
                            @remove="emit('remove', $event)"
                            @create="emit('create')"
                            @add-existing="emit('add-existing')"
                        />
                        <ShelfTitlePage
                            v-if="active !== null"
                            :locale="locale"
                            :item="active"
                            :now="now"
                            @open="emit('open', $event)"
                            @open-new-window="emit('open-new-window', $event)"
                            @edit="emit('edit', $event)"
                            @remove="emit('remove', $event)"
                        />
                    </template>
                    <ShelfList
                        v-else
                        :locale="locale"
                        :items="sorted"
                        :now="now"
                        @open="emit('open', $event)"
                        @open-new-window="emit('open-new-window', $event)"
                        @edit="emit('edit', $event)"
                        @remove="emit('remove', $event)"
                        @create="emit('create')"
                        @add-existing="emit('add-existing')"
                    />
                </section>
            </template>
        </div>
    </main>
</template>

<style scoped>
.bookshelf-page {
    min-height: 100%;
    overflow-x: hidden;
    background: var(--window-backdrop, var(--bg-main));
    color: var(--text-main);
    font-family: var(--font-ui);
}

.bookshelf-page__column {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    max-width: 1040px;
    margin: 0 auto;
    padding: var(--space-6) 32px var(--space-8);
}

.bookshelf-page--narrow .bookshelf-page__column {
    gap: var(--space-6);
    padding: var(--space-4) 16px var(--space-7);
}

.bookshelf-page__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
}

.bookshelf-page__brand {
    margin: 0;
    color: var(--text-main);
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
}

.bookshelf-page__room {
    color: var(--text-muted);
    font-weight: var(--weight-normal);
}

.bookshelf-page__welcome {
    margin: 0;
    max-width: 34em;
    color: var(--text-secondary);
    font-family: var(--font-display);
    font-size: 17px;
    line-height: var(--leading-reading);
}

.bookshelf-page__shelf {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.bookshelf-page__shelf-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-4);
}

.bookshelf-page__shelf-title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-strong);
}

.bookshelf-page__count {
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-weight: var(--weight-normal);
}

.bookshelf-page__tools {
    display: flex;
    align-items: center;
    gap: var(--space-3);
}

.bookshelf-page__sort-label {
    margin-right: calc(var(--space-2) - var(--space-3));
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--text-sm);
}

.bookshelf-page__sort {
    width: 128px;
}

.bookshelf-page__error {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    color: var(--text-secondary);
}

.bookshelf-page__error p {
    margin: 0;
}
</style>
