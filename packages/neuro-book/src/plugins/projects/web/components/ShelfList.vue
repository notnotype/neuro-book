<script setup lang="ts">
/** 书架的列表视图（同名 .md）：一行一部作品；只发事件。 */
import {Dropdown, IconButton} from "@notnotype/nb-ui/components";
import type {DropdownItem} from "@notnotype/nb-ui/components";

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {projectDisplayName} from "../../shared/shelf";
import type {ShelfItem} from "../../shared/shelf";
import {formatFiles, formatWhen, formatWords, spineStyle} from "../shelf-format";

defineOptions({name: "ShelfList"});

const props = defineProps<{
    locale: DisplayLocale;
    items: ReadonlyArray<ShelfItem>;
    now: string;
}>();

const emit = defineEmits<{
    (event: "open", id: string): void;
    (event: "open-new-window", id: string): void;
    (event: "edit", id: string): void;
    (event: "remove", id: string): void;
    (event: "create"): void;
    (event: "add-existing"): void;
}>();

const TEXT = {
    label: {"zh-CN": "作品列表", "en-US": "Books"},
    more: {"zh-CN": "更多操作", "en-US": "More Actions"},
    openNewWindow: {"zh-CN": "在新窗口打开", "en-US": "Open in New Window"},
    edit: {"zh-CN": "编辑信息", "en-US": "Edit Info"},
    remove: {"zh-CN": "从书架移除", "en-US": "Remove from Shelf"},
    running: {"zh-CN": "已打开", "en-US": "Open"},
    none: {"zh-CN": "尚未统计", "en-US": "Not counted yet"},
    create: {"zh-CN": "新建作品", "en-US": "New Book"},
    addExisting: {"zh-CN": "加入已有目录", "en-US": "Add Folder"},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);

function facts(item: ShelfItem): string[] {
    if (item.stats.freshness === "none") return [text(TEXT.none)];
    const parts = [formatWords(item.stats.words, props.locale), formatFiles(item.stats.files, props.locale)];
    if (item.stats.last !== null) parts.push(formatWhen(item.stats.last.at, props.now, props.locale));
    return parts;
}

function menu(): DropdownItem[] {
    return [
        {value: "open-new-window", label: text(TEXT.openNewWindow)},
        {value: "edit", label: text(TEXT.edit)},
        {value: "remove", label: text(TEXT.remove), tone: "danger"},
    ];
}

function onMenu(item: ShelfItem, value: string): void {
    if (value === "open-new-window") emit("open-new-window", item.id);
    else if (value === "edit") emit("edit", item.id);
    else if (value === "remove") emit("remove", item.id);
}
</script>

<template>
    <div class="shelf-list" data-shelf-list>
        <ul class="shelf-list__rows" :aria-label="text(TEXT.label)">
            <li v-for="item in items" :key="item.id" class="shelf-list__row shelf-spine-color" :class="{'shelf-spine-color--custom': item.color !== null}" :style="spineStyle(item)" data-shelf-row>
                <button type="button" class="shelf-list__main" @click="emit('open', item.id)">
                    <span class="shelf-list__heading">
                        <span class="shelf-list__title">{{ projectDisplayName(item) }}</span>
                        <span v-if="item.state !== 'stopped'" class="shelf-list__running">{{ text(TEXT.running) }}</span>
                    </span>
                    <span v-if="item.description !== null && item.description !== ''" class="shelf-list__description">{{ item.description }}</span>
                    <span class="shelf-list__facts">
                        <span v-for="fact in facts(item)" :key="fact">{{ fact }}</span>
                    </span>
                </button>
                <Dropdown :items="menu()" align="end" root-class="shelf-list__more" @select="onMenu(item, $event)">
                    <IconButton size="sm" icon-class="i-lucide-ellipsis" :aria-label="text(TEXT.more)" />
                </Dropdown>
            </li>
        </ul>
        <div class="shelf-list__blanks">
            <button type="button" class="shelf-list__blank" data-shelf-create @click="emit('create')">+ {{ text(TEXT.create) }}</button>
            <button type="button" class="shelf-list__blank" data-shelf-add @click="emit('add-existing')">+ {{ text(TEXT.addExisting) }}</button>
        </div>
    </div>
</template>

<style src="./shelf-colors.css"></style>

<style scoped>
.shelf-list {
    container-type: inline-size;
}

.shelf-list__rows {
    margin: 0;
    padding: 0;
    list-style: none;
}

.shelf-list__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border-bottom: var(--border-w) solid var(--divider);
}

.shelf-list__row::before {
    content: "";
    align-self: stretch;
    flex: 0 0 4px;
    margin: var(--space-3) 0;
    border-radius: 2px;
    background: var(--spine-bg);
}

.shelf-list__main {
    display: grid;
    flex: 1 1 auto;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: "heading facts" "description facts";
    gap: 2px var(--space-4);
    align-items: baseline;
    min-width: 0;
    padding: var(--space-3) var(--space-2);
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--text-main);
    text-align: left;
    cursor: pointer;
}

.shelf-list__main:hover {
    background: var(--bg-hover);
}

.shelf-list__main:focus-visible {
    outline: var(--focus-outline);
    outline-offset: -2px;
}

.shelf-list__heading {
    display: flex;
    grid-area: heading;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
}

.shelf-list__title {
    overflow: hidden;
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-strong);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.shelf-list__running {
    flex: 0 0 auto;
    color: var(--status-info);
    font-size: var(--text-xs);
}

.shelf-list__description {
    grid-area: description;
    overflow: hidden;
    color: var(--text-secondary);
    font-family: var(--font-display);
    font-size: var(--text-sm);
    white-space: nowrap;
    text-overflow: ellipsis;
}

.shelf-list__facts {
    display: flex;
    grid-area: facts;
    gap: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.shelf-list__more {
    flex: 0 0 auto;
}

.shelf-list__blanks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    padding: var(--space-3) var(--space-2);
}

.shelf-list__blank {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
}

.shelf-list__blank:hover {
    color: var(--text-main);
}

.shelf-list__blank:focus-visible {
    border-radius: 2px;
    outline: var(--focus-outline);
    outline-offset: 2px;
}

@container (max-width: 560px) {
    .shelf-list__main {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas: "heading" "description" "facts";
    }
}
</style>
