<script setup lang="ts">
/** 扉页（同名 .md）：选中作品的信息与操作；只发事件。 */
import {Button} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {projectDisplayName} from "../../shared/shelf";
import type {ShelfItem} from "../../shared/shelf";
import {formatFiles, formatWhen, formatWords, spineStyle} from "../shelf-format";

defineOptions({name: "ShelfTitlePage"});

const props = defineProps<{
    locale: DisplayLocale;
    item: ShelfItem;
    now: string;
}>();

const emit = defineEmits<{
    (event: "open", id: string): void;
    (event: "open-new-window", id: string): void;
    (event: "edit", id: string): void;
    (event: "remove", id: string): void;
}>();

const TEXT = {
    open: {"zh-CN": "打开", "en-US": "Open"},
    openNewWindow: {"zh-CN": "在新窗口打开", "en-US": "Open in New Window"},
    edit: {"zh-CN": "编辑信息", "en-US": "Edit Info"},
    remove: {"zh-CN": "从书架移除", "en-US": "Remove from Shelf"},
    running: {"zh-CN": "已打开", "en-US": "Open"},
    lastEdit: {"zh-CN": "最近编辑于{when}", "en-US": "Last edited {when}"},
    stale: {"zh-CN": "统计于{when}", "en-US": "Counted {when}"},
    none: {"zh-CN": "尚未统计，打开后开始统计", "en-US": "Not counted yet; counting starts when opened"},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);

const facts = computed(() => {
    const {stats} = props.item;
    if (stats.freshness === "none") return [text(TEXT.none)];
    const parts = [formatWords(stats.words, props.locale), formatFiles(stats.files, props.locale)];
    if (stats.last !== null) parts.push(text(formatText(TEXT.lastEdit, {when: formatWhen(stats.last.at, props.now, props.locale)})));
    if (stats.freshness === "stale" && stats.computedAt !== null) parts.push(text(formatText(TEXT.stale, {when: formatWhen(stats.computedAt, props.now, props.locale)})));
    return parts;
});

</script>

<template>
    <section class="shelf-title-page shelf-spine-color" :class="{'shelf-spine-color--custom': item.color !== null}" :style="spineStyle(item)" :aria-label="projectDisplayName(item)" data-shelf-title-page>
        <div class="shelf-title-page__body">
            <h3 class="shelf-title-page__title">{{ projectDisplayName(item) }}</h3>
            <p v-if="item.description !== null && item.description !== ''" class="shelf-title-page__description">{{ item.description }}</p>
            <p class="shelf-title-page__facts">
                <span v-if="item.state !== 'stopped'" class="shelf-title-page__running">{{ text(TEXT.running) }}</span>
                <span v-for="fact in facts" :key="fact" class="shelf-title-page__fact">{{ fact }}</span>
            </p>
            <p class="shelf-title-page__path" :title="item.path">{{ item.path }}</p>
            <div class="shelf-title-page__actions">
                <Button variant="primary" size="sm" data-shelf-open @click="emit('open', item.id)">{{ text(TEXT.open) }}</Button>
                <Button variant="ghost" size="sm" @click="emit('open-new-window', item.id)">{{ text(TEXT.openNewWindow) }}</Button>
                <Button variant="ghost" size="sm" @click="emit('edit', item.id)">{{ text(TEXT.edit) }}</Button>
                <Button variant="ghost" size="sm" class="shelf-title-page__remove" @click="emit('remove', item.id)">{{ text(TEXT.remove) }}</Button>
            </div>
        </div>
    </section>
</template>

<style src="./shelf-colors.css"></style>

<style scoped>
.shelf-title-page {
    display: flex;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-5) var(--space-4) var(--space-4);
}

.shelf-title-page::before {
    content: "";
    flex: 0 0 4px;
    border-radius: 2px;
    background: var(--spine-bg);
}

.shelf-title-page__body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.shelf-title-page__title {
    margin: 0;
    color: var(--text-main);
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
}

.shelf-title-page__description {
    display: -webkit-box;
    overflow: hidden;
    margin: 0;
    max-width: 34em;
    color: var(--text-secondary);
    font-family: var(--font-display);
    font-size: var(--text-md);
    line-height: var(--leading-reading);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
}

.shelf-title-page__facts {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-3);
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
}

.shelf-title-page__running {
    color: var(--status-info);
}

.shelf-title-page__path {
    margin: 0;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
}

.shelf-title-page__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
}

.shelf-title-page__remove {
    color: var(--status-danger);
}
</style>
