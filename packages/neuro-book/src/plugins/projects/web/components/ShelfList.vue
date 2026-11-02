<script setup lang="ts">
/** 书架的列表视图（同名 .md）：一行一部作品；只发事件。 */
import {DropdownMenu, IconButton} from "@notnotype/nb-ui/components";
import type {DropdownMenuItemData} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";

import {projectDisplayName} from "../../shared/shelf";
import type {ShelfItem} from "../../shared/shelf";
import {useProjectsText} from "../text";
import {formatFiles, formatWhen, formatWords} from "../shelf-format";
import BookCover from "./BookCover.vue";

defineOptions({name: "ShelfList"});

const props = defineProps<{
    items: ReadonlyArray<ShelfItem>;
    now: string;
    /** 一部作品的封面图地址；没有封面为 null。 */
    coverSrc: (item: ShelfItem) => string | null;
}>();

const emit = defineEmits<{
    (event: "open", id: string): void;
    (event: "open-new-window", id: string): void;
    (event: "edit", id: string): void;
    (event: "remove", id: string): void;
    (event: "create"): void;
}>();

const port = useText();
const text = useProjectsText();

/** 字数与篇数；`none` 写“尚未统计”。 */
function counts(item: ShelfItem): string {
    const {stats} = item;
    if (stats.freshness === "none") return text("shelfList.none");
    return `${formatWords(stats.words, port)} · ${formatFiles(stats.files, port)}`;
}

/** 最近编辑时间与新鲜度说明（Spec 输出 8）：`fresh` 不加说明。 */
function when(item: ShelfItem): string {
    const {stats} = item;
    const parts: string[] = [];
    if (stats.last !== null) parts.push(formatWhen(stats.last.at, props.now, port));
    if (stats.freshness === "counting") parts.push(text("shelfList.counting"));
    else if (stats.freshness === "stale" && stats.computedAt !== null) parts.push(text("shelfList.stale", {when: formatWhen(stats.computedAt, props.now, port)}));
    if (item.state !== "stopped") parts.push(text("shelfList.running"));
    return parts.length === 0 ? "—" : parts.join(" · ");
}

function menu(): DropdownMenuItemData[] {
    return [
        {id: "open-new-window", label: text("shelfList.openNewWindow")},
        {id: "edit", label: text("shelfList.edit")},
        {id: "remove", label: text("shelfList.remove"), tone: "danger"},
    ];
}

function onMenu(item: ShelfItem, value: string): void {
    if (value === "open-new-window") emit("open-new-window", item.id);
    else if (value === "edit") emit("edit", item.id);
    else if (value === "remove") emit("remove", item.id);
}
</script>

<template>
    <ul class="shelf-list" :aria-label="text('shelfList.label')" data-shelf-list>
        <li v-for="item in items" :key="item.id" class="shelf-list__row" data-shelf-row>
            <button type="button" class="shelf-list__main" @click="emit('open', item.id)">
                <BookCover :id="item.id" :title="projectDisplayName(item)" :color="item.color" :src="coverSrc(item)" :width="30" class="shelf-list__cover" />
                <span class="shelf-list__text">
                    <span class="shelf-list__title">{{ projectDisplayName(item) }}</span>
                    <span v-if="item.description !== null && item.description !== ''" class="shelf-list__description">{{ item.description }}</span>
                </span>
                <span class="shelf-list__counts">{{ counts(item) }}</span>
                <span class="shelf-list__when" :class="{'shelf-list__when--running': item.state !== 'stopped'}">{{ when(item) }}</span>
            </button>
            <DropdownMenu :items="menu()" align="end" root-class="shelf-list__more" @select="onMenu(item, $event)">
                <IconButton size="sm" icon-class="i-lucide-ellipsis" :aria-label="text('shelfList.more')" />
            </DropdownMenu>
        </li>
        <!-- 末行的“新建作品”：不带 data-shelf-row，按行数数作品与找第一行的地方不把它算进去。 -->
        <li class="shelf-list__row shelf-list__row--create">
            <button type="button" class="shelf-list__main shelf-list__main--create" data-shelf-create-row @click="emit('create')">
                <span class="shelf-list__slot" aria-hidden="true">+</span>
                <span class="shelf-list__create">{{ text('shelfList.create') }}</span>
            </button>
        </li>
    </ul>
</template>

<style scoped>
.shelf-list {
    container-type: inline-size;
    margin: 0;
    padding: 0;
    border-top: var(--border-w) solid var(--divider);
    list-style: none;
}

.shelf-list__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border-bottom: var(--border-w) solid var(--divider);
}

.shelf-list__main {
    display: grid;
    flex: 1;
    grid-template-columns: 30px minmax(0, 1fr) 150px 190px;
    gap: var(--space-4);
    align-items: center;
    min-width: 0;
    padding: var(--space-3) var(--space-3);
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.shelf-list__main:hover {
    background: color-mix(in srgb, var(--page-surface, var(--bg-panel)) 60%, transparent);
}

.shelf-list__main:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.shelf-list__cover {
    border-radius: 2px 3px 3px 2px;
}

.shelf-list__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.shelf-list__title {
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: var(--weight-strong);
    overflow-wrap: anywhere;
}

.shelf-list__description {
    overflow: hidden;
    margin-top: 1px;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.shelf-list__counts {
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
}

.shelf-list__when {
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.shelf-list__when--running {
    color: var(--status-success);
}

.shelf-list__main--create {
    grid-template-columns: 30px minmax(0, 1fr);
    color: var(--text-secondary);
}

.shelf-list__slot {
    display: grid;
    place-items: center;
    width: 30px;
    aspect-ratio: 2 / 3;
    border: 1.5px dashed color-mix(in srgb, var(--text-main) 24%, transparent);
    border-radius: 2px 3px 3px 2px;
    color: var(--text-muted);
    font-size: 16px;
    font-weight: 300;
    line-height: 1;
}

.shelf-list__create {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: var(--weight-strong);
}

.shelf-list__more {
    flex: 0 0 auto;
    margin-right: var(--space-2);
}

@container (max-width: 640px) {
    .shelf-list__main {
        grid-template-columns: 30px minmax(0, 1fr);
        row-gap: 2px;
    }

    .shelf-list__counts,
    .shelf-list__when {
        grid-column: 2;
    }
}
</style>
