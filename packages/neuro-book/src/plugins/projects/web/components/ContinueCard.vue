<script setup lang="ts">
/** 继续写作（同名 .md）：最近编辑的作品与片段；只发事件。 */
import {Button} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {projectDisplayName} from "../../shared/shelf";
import type {ShelfItem} from "../../shared/shelf";
import {formatToday, formatWhen, formatWords} from "../shelf-format";

defineOptions({name: "ContinueCard"});

const props = defineProps<{
    locale: DisplayLocale;
    item: ShelfItem;
    now: string;
}>();

const emit = defineEmits<{
    (event: "continue", id: string): void;
}>();

const TEXT = {
    eyebrow: {"zh-CN": "继续写作", "en-US": "Continue Writing"},
    action: {"zh-CN": "继续写作", "en-US": "Continue"},
    total: {"zh-CN": "共 {words}", "en-US": "{words} in total"},
    stale: {"zh-CN": "统计于{when}", "en-US": "Counted {when}"},
    edited: {"zh-CN": "{when}编辑", "en-US": "Edited {when}"},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);
const last = computed(() => props.item.stats.last);
const stale = computed(() => (props.item.stats.freshness === "stale" && props.item.stats.computedAt !== null ? text(formatText(TEXT.stale, {when: formatWhen(props.item.stats.computedAt, props.now, props.locale)})) : null));
</script>

<template>
    <section class="continue-card" :aria-label="text(TEXT.eyebrow)" data-continue-card>
        <div class="continue-card__grid">
            <div class="continue-card__manuscript">
                <p class="continue-card__eyebrow">{{ text(TEXT.eyebrow) }}</p>
                <h2 class="continue-card__title">
                    <span class="continue-card__book">{{ projectDisplayName(item) }}</span>
                    <span v-if="last !== null" class="continue-card__piece">{{ last.label }}</span>
                </h2>
                <blockquote v-if="last !== null && last.excerpt !== ''" class="continue-card__excerpt">{{ last.excerpt }}</blockquote>
                <p v-if="last !== null" class="continue-card__when">{{ text(formatText(TEXT.edited, {when: formatWhen(last.at, now, locale)})) }}</p>
            </div>
            <div class="continue-card__ledger">
                <p v-if="item.stats.today !== null" class="continue-card__today">{{ formatToday(item.stats.today, locale) }}</p>
                <p class="continue-card__total">{{ text(formatText(TEXT.total, {words: formatWords(item.stats.words, locale)})) }}</p>
                <p v-if="stale !== null" class="continue-card__stale">{{ stale }}</p>
                <Button variant="primary" class="continue-card__action" data-continue @click="emit('continue', item.id)">{{ text(TEXT.action) }}</Button>
            </div>
        </div>
    </section>
</template>

<style scoped>
.continue-card {
    container-type: inline-size;
    padding: var(--space-6) var(--space-7);
    border-radius: var(--radius-panel);
    background: var(--page-surface, var(--bg-panel));
    box-shadow: var(--page-lift, var(--elevation-flat));
}

.continue-card__grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-6);
}

.continue-card__manuscript {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.continue-card__eyebrow {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
}

.continue-card__title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--space-3);
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
}

.continue-card__book {
    color: var(--text-main);
    font-size: var(--text-xl);
}

.continue-card__book::before {
    content: "《";
}

.continue-card__book::after {
    content: "》";
}

.continue-card__piece {
    color: var(--text-secondary);
    font-size: var(--text-lg);
    font-weight: var(--weight-normal);
}

.continue-card__excerpt {
    display: -webkit-box;
    overflow: hidden;
    margin: var(--space-2) 0 0;
    max-width: 34em;
    padding-left: var(--space-4);
    border-left: 2px solid var(--divider);
    color: var(--text-main);
    font-family: var(--font-display);
    font-size: 17px;
    line-height: var(--leading-reading);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
}

.continue-card__when {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.continue-card__ledger {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: flex-end;
    gap: var(--space-1);
    min-width: 160px;
    font-variant-numeric: tabular-nums;
}

.continue-card__today {
    margin: 0;
    color: var(--text-main);
    font-size: var(--text-xl);
    font-weight: var(--weight-strong);
}

.continue-card__total,
.continue-card__stale {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}

.continue-card__stale {
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.continue-card__action {
    margin-top: var(--space-3);
}

@container (max-width: 560px) {
    .continue-card__grid {
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-4);
    }

    .continue-card__ledger {
        align-items: flex-start;
    }
}
</style>
