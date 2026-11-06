<script setup lang="ts">
/** 书架页（同名 .md）：标题栏、案头、卡片与列表两种视图；只呈现数据、发出用户动作。 */
import {Button, Select, IconButton, SegmentedControl, Skeleton} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {useElementSize} from "@vueuse/core";
import {computed, ref} from "vue";

import NeuroBookLockup from "nbook/ui/brand/NeuroBookLockup.vue";

import type {ShelfItem} from "../../shared/shelf";
import {useProjectsText} from "../text";
import {sortShelf} from "../shelf-format";
import type {ShelfSort} from "../shelf-format";
import ShelfCards from "./ShelfCards.vue";
import ShelfDesk from "./ShelfDesk.vue";
import ShelfList from "./ShelfList.vue";

defineOptions({name: "BookshelfPage"});

type ShelfView = "cards" | "list";

const props = withDefaults(defineProps<{
    status: "loading" | "ready" | "error";
    error?: string;
    items: ReadonlyArray<ShelfItem>;
    now: string;
    view: ShelfView;
    sort: ShelfSort;
    activeId: string | null;
    /** 作品目录（新作品建在这里），空书架的“新建作品”卡上写它。 */
    library: string;
    /** 一部作品的封面图地址；没有封面为 null。 */
    coverSrc: (item: ShelfItem) => string | null;
    /** 本页的设置窗口开着：齿轮画成按下。 */
    settingsOpen?: boolean;
}>(), {error: "", settingsOpen: false});

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
    (event: "retry"): void;
    /** 点了右上角的齿轮：宿主打开设置窗口。 */
    (event: "open-settings"): void;
}>();

/** 不足这个宽度只用列表：卡片一列时信息密度不如列表。 */
const NARROW_WIDTH = 720;

const port = useText();
const text = useProjectsText();

const root = ref<HTMLElement | null>(null);
const {width} = useElementSize(root);
// 首次量出宽度之前按宽屏排，避免桌面上先闪一帧列表。
const narrow = computed(() => width.value > 0 && width.value < NARROW_WIDTH);
const effectiveView = computed<ShelfView>(() => (narrow.value ? "list" : props.view));

const sorted = computed(() => sortShelf(props.items, props.sort, port.locale.value));

const viewOptions = computed(() => [{value: "cards", label: text("bookshelfPage.cards")}, {value: "list", label: text("bookshelfPage.list")}]);
const sortOptions = computed(() => [
    {value: "recent", label: text("bookshelfPage.recent")},
    {value: "title", label: text("bookshelfPage.title")},
    {value: "words", label: text("bookshelfPage.words")},
]);

function onView(value: unknown): void {
    if (value === "cards" || value === "list") emit("update:view", value);
}

function onSort(value: string): void {
    if (value === "recent" || value === "title" || value === "words") emit("update:sort", value);
}

/** 焦点回到书架：卡片视图是列表框，列表视图是第一行；书架空了时是“新建作品”。 */
function focusShelf(): void {
    // 逐个按优先级找：一条选择器列表的 querySelector 取文档顺序的第一个，工具栏的“新建作品”排在书架前面。
    for (const selector of ['[data-shelf-cards][role="listbox"]', "[data-shelf-row] button", "[data-shelf-create]"]) {
        const target = root.value?.querySelector<HTMLElement>(selector);
        if (target !== null && target !== undefined) {
            target.focus();
            return;
        }
    }
}

defineExpose({focusShelf});
</script>

<template>
    <main ref="root" class="bookshelf-page" :class="{'bookshelf-page--narrow': narrow}" data-bookshelf-page>
        <div class="bookshelf-page__column">
            <header class="bookshelf-page__header">
                <p class="bookshelf-page__brand">
                    <NeuroBookLockup class="bookshelf-page__lockup" />
                    <span class="bookshelf-page__room">· {{ text('bookshelfPage.brand') }}</span>
                </p>
                <div class="bookshelf-page__tools-right">
                    <!-- 设置窗口开着时按下：灰底、正文色，同工作台活动栏的齿轮（docs/specs/workbench/bookshelf.md 输出 1）。 -->
                    <IconButton
                        size="sm"
                        icon-class="i-lucide-settings"
                        :aria-label="text('bookshelfPage.settings')"
                        :aria-pressed="settingsOpen"
                        :class="{'bookshelf-page__settings--pressed': settingsOpen}"
                        data-shelf-settings
                        @click="emit('open-settings')"
                    />
                    <!-- 头像只预留位置：没有个人资料之前不是入口，不可点（外壳规范：不以可操作的假入口呈现）。 -->
                    <span class="bookshelf-page__avatar" :title="text('bookshelfPage.profile')" aria-hidden="true"><span class="i-lucide-user-round"></span></span>
                </div>
            </header>

            <!-- 骨架只是装饰（aria-hidden）：读屏听到的是这一句，截图工具按 aria-busy 等书架出来。 -->
            <div v-if="status === 'loading'" class="bookshelf-page__loading" role="status" aria-busy="true" data-shelf-loading>
                <span class="sr-only">{{ text('bookshelfPage.loading') }}</span>
                <Skeleton shape="block" height="150px" />
                <Skeleton shape="block" height="240px" />
            </div>

            <div v-else-if="status === 'error'" class="bookshelf-page__error" role="alert">
                <p>{{ error }}</p>
                <Button size="sm" @click="emit('retry')">{{ text('bookshelfPage.retry') }}</Button>
            </div>

            <template v-else>
                <ShelfDesk :items="items" :now="now" @continue="emit('continue', $event)" />

                <section class="bookshelf-page__shelf" :aria-label="text('bookshelfPage.shelf')">
                    <div class="bookshelf-page__shelf-head">
                        <h2 class="bookshelf-page__shelf-title">
                            {{ text('bookshelfPage.shelf') }}
                            <span class="bookshelf-page__count">{{ text('bookshelfPage.count', {count: items.length}) }}</span>
                        </h2>
                        <div class="bookshelf-page__tools">
                            <SegmentedControl v-if="!narrow" :model-value="view" :options="viewOptions" :aria-label="text('bookshelfPage.view')" @update:model-value="onView" />
                            <!-- Select 是多根组件，scoped 的宽度类落不到它的触发器上；触发器全宽，宽度由这个外框给。 -->
                            <div class="bookshelf-page__sort">
                                <Select id="bookshelf-sort" :model-value="sort" :options="sortOptions" size="sm" :aria-label="text('bookshelfPage.sort')" @update:model-value="onSort" />
                            </div>
                            <span class="bookshelf-page__gap" aria-hidden="true"></span>
                            <Button variant="secondary" size="sm" data-shelf-add @click="emit('add-existing')">{{ text('bookshelfPage.addExisting') }}</Button>
                            <Button variant="primary" size="sm" icon-class="i-lucide-plus" data-shelf-create @click="emit('create')">{{ text('bookshelfPage.create') }}</Button>
                        </div>
                    </div>

                    <ShelfCards
                        v-if="effectiveView === 'cards' || items.length === 0"
                        :items="sorted"
                        :active-id="activeId"
                        :now="now"
                        :cover-src="coverSrc"
                        :library="library"
                        @update:active-id="emit('update:activeId', $event)"
                        @open="emit('open', $event)"
                        @open-new-window="emit('open-new-window', $event)"
                        @edit="emit('edit', $event)"
                        @remove="emit('remove', $event)"
                        @create="emit('create')"
                        @add-existing="emit('add-existing')"
                    />
                    <ShelfList
                        v-else
                        :items="sorted"
                        :now="now"
                        :cover-src="coverSrc"
                        @open="emit('open', $event)"
                        @open-new-window="emit('open-new-window', $event)"
                        @edit="emit('edit', $event)"
                        @remove="emit('remove', $event)"
                        @create="emit('create')"
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
    gap: 40px;
    max-width: 1120px;
    margin: 0 auto;
    padding: var(--space-6) 40px var(--space-8);
}

/* 两块骨架之间沿用内容列的间距（窄屏时也一样），包了这一层仍排成没包时的样子。 */
.bookshelf-page__loading {
    display: flex;
    flex-direction: column;
    gap: inherit;
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
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    color: var(--text-main);
    font-size: var(--text-md);
}

.bookshelf-page__lockup {
    /* 字标的大写高约占成品高的一半：26px 的组合里字标与旁边的“书房”二字差不多高。 */
    height: 26px;
}

.bookshelf-page__room {
    color: var(--text-muted);
    font-family: var(--font-display);
    font-weight: var(--weight-normal);
}

.bookshelf-page__tools-right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.bookshelf-page .bookshelf-page__settings--pressed {
    background: var(--bg-hover);
    color: var(--text-main);
}

.bookshelf-page__avatar {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: var(--border-w) solid var(--control-outline);
    border-radius: 999px;
    background: var(--control-surface);
    color: var(--text-muted);
    font-size: 14px;
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
    font-family: var(--font-display);
    font-size: 20px;
    font-weight: var(--weight-strong);
}

.bookshelf-page__count {
    margin-left: var(--space-2);
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-normal);
}

.bookshelf-page__tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}

.bookshelf-page__gap {
    width: var(--space-2);
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

/*
 * 带场景的主题（docs/specs/theme/skins.md 输出 14）：整页铺场景，上面罩一层页面底色，卡片与文字仍在实底上。
 * 场景钉在视口上，书多了页面变长也不被拉伸。变量名见 src/ui/theme/skin-vars.ts；没有场景的主题不写 data-nb-skin-scene，这一层不存在。
 * 选择器整个写在 `:global()` 里：`:global(a) .b` 在 scoped 样式里会被编译成只剩 `a`，规则落到 `<html>` 上。
 */
:global([data-nb-skin-scene] .bookshelf-page) {
    isolation: isolate;
}

:global([data-nb-skin-scene] .bookshelf-page::before) {
    content: "";
    position: fixed;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background:
        linear-gradient(color-mix(in srgb, var(--bg-main) 62%, transparent), color-mix(in srgb, var(--bg-main) 62%, transparent)),
        var(--skin-scene) var(--skin-empty-position, center) / cover no-repeat;
}

@media (prefers-contrast: more), (forced-colors: active) {
    :global([data-nb-skin-scene] .bookshelf-page::before) {
        display: none;
    }
}
</style>
