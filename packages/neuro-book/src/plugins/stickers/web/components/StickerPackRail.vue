<script setup lang="ts">
import {Button, IconButton} from "@notnotype/nb-ui/components";
import {nextTick, ref} from "vue";

import type {RailGroup} from "../pack-view";
import {useStickersPageText} from "../text";

/** 表情包页的左栏（同名 .md）。 */
const props = withDefaults(defineProps<{
    groups: readonly RailGroup[];
    current: string | null;
    disabled?: boolean;
}>(), {disabled: false});

const emit = defineEmits<{
    (e: "select", id: string): void;
    (e: "create"): void;
    (e: "import"): void;
}>();

const text = useStickersPageText();
const root = ref<HTMLElement | null>(null);

function onKeydown(event: KeyboardEvent): void {
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-sticker-rail-item")) return;
    const ids = props.groups.flatMap((group) => group.items.map((item) => item.id));
    const at = ids.indexOf(props.current ?? "");
    let next: number | null = null;
    if (event.key === "ArrowDown") next = Math.min(ids.length - 1, at + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, at - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ids.length - 1;
    if (next === null || ids[next] === undefined) return;
    event.preventDefault();
    emit("select", ids[next]!);
    void nextTick(() => root.value?.querySelector<HTMLElement>("[aria-current='page']")?.focus());
}
</script>

<template>
    <nav ref="root" class="sticker-rail" :aria-label="text('rail.label')" data-sticker-rail @keydown="onKeydown">
        <template v-for="group in groups" :key="group.id">
            <div class="sticker-rail__title">
                <span>{{ group.title ?? text("rail.mine") }}</span>
                <IconButton v-if="group.user" size="sm" icon-class="i-lucide-plus" :title="text('rail.new')" :aria-label="text('rail.new')" :disabled="disabled" data-sticker-create @click="emit('create')" />
            </div>
            <button
                v-for="item in group.items"
                :key="item.id"
                type="button"
                class="sticker-rail__item nb-ui-focus-ring-inset"
                :aria-current="item.id === current ? 'page' : undefined"
                :aria-label="item.status === 'invalid' ? text('rail.itemLabelInvalid', {title: item.title}) : text(item.unrecognized > 0 ? 'rail.itemLabelProblem' : 'rail.itemLabel', {title: item.title, count: String(item.count)})"
                :tabindex="item.id === current || (current === null && item.id === groups.flatMap((one) => one.items)[0]?.id) ? 0 : -1"
                :data-sticker-rail-item="item.id"
                @click="emit('select', item.id)"
            >
                <img v-if="item.thumbnail !== null" class="sticker-rail__thumb" :src="item.thumbnail" alt="" loading="lazy" decoding="async" />
                <span v-else class="i-lucide-smile sticker-rail__thumb sticker-rail__thumb--empty" :title="text('rail.noThumb')" aria-hidden="true" />
                <span class="sticker-rail__name">{{ item.title }}</span>
                <span v-if="item.status === 'invalid'" class="i-lucide-circle-x sticker-rail__flag" aria-hidden="true" :title="text('rail.invalid')" data-sticker-rail-flag="invalid" />
                <span v-else-if="item.unrecognized > 0" class="i-lucide-circle-alert sticker-rail__flag" aria-hidden="true" :title="text('rail.problem')" data-sticker-rail-flag="problem" />
                <span class="sticker-rail__count">{{ item.count }}</span>
            </button>
        </template>
        <div class="sticker-rail__foot">
            <Button size="sm" variant="ghost" icon-class="i-lucide-file-up" block :disabled="disabled" data-sticker-import @click="emit('import')">{{ text("rail.import") }}</Button>
        </div>
    </nav>
</template>

<style scoped>
.sticker-rail {
    display: flex;
    width: 168px;
    flex-shrink: 0;
    flex-direction: column;
    gap: 2px;
    padding: 0 var(--space-3) var(--space-2) var(--space-2);
    overflow-y: auto;
    border-right: var(--border-w) solid var(--divider);
}

.sticker-rail__title {
    display: flex;
    min-height: var(--control-h-sm);
    align-items: center;
    justify-content: space-between;
    margin-top: var(--space-2);
    padding-left: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.sticker-rail__title:first-child {
    margin-top: 0;
}

.sticker-rail__item {
    display: flex;
    width: 100%;
    min-height: 32px;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-2);
    font: inherit;
    color: inherit;
    text-align: left;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    cursor: pointer;
    transition: background-color var(--motion-fast);
}

.sticker-rail__item:hover {
    background: var(--bg-hover);
}

.sticker-rail__item[aria-current="page"] {
    background: color-mix(in srgb, var(--accent-main) 13%, transparent);
}

.sticker-rail__thumb {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    object-fit: contain;
}

.sticker-rail__thumb--empty {
    color: var(--text-muted);
}

.sticker-rail__name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sticker-rail__flag {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    color: var(--status-danger);
}

.sticker-rail__count {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
}

.sticker-rail__foot {
    margin-top: auto;
    padding-top: var(--space-2);
}
</style>
