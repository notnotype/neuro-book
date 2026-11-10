<script setup lang="ts">
/** 页面标签的面包屑：各段由页面给出，带命令的可以点。说明见同名 `.md`。 */
import {computed, ref, watch} from "vue";

import {useEditorText} from "../text";
import type {PageCrumbItem} from "../pages";

const props = withDefaults(defineProps<{items: ReadonlyArray<PageCrumbItem>; focusSeq?: number}>(), {focusSeq: 0});
const emit = defineEmits<{(event: "escape"): void}>();

const t = useEditorText();
const nav = ref<HTMLElement | null>(null);
/** 可点的段的下标（最后一段是当前页，不可点）。 */
const runnable = computed(() => props.items.flatMap((item, index) => (item.run !== undefined && index < props.items.length - 1 ? [index] : [])));
/** roving tabindex：在 Tab 顺序里的那一段；它不再可点时回到第一个可点的。 */
const focused = ref(-1);
const tabStop = computed(() => (runnable.value.includes(focused.value) ? focused.value : runnable.value[0] ?? -1));

function focusAt(index: number): void {
    focused.value = index;
    nav.value?.querySelector<HTMLElement>(`[data-page-crumb="${String(index)}"]`)?.focus();
}

function onKeydown(event: KeyboardEvent, index: number): void {
    const at = runnable.value.indexOf(index);
    const target = event.key === "ArrowLeft" ? runnable.value[at - 1] : event.key === "ArrowRight" ? runnable.value[at + 1] : event.key === "Home" ? runnable.value[0] : event.key === "End" ? runnable.value.at(-1) : undefined;
    if (target !== undefined) {
        event.preventDefault();
        focusAt(target);
    } else if (event.key === "Escape") {
        event.preventDefault();
        emit("escape");
    }
}

// 命令 `focus-breadcrumbs`：焦点放到最后一个可点的段。
watch(() => props.focusSeq, (next, previous) => {
    const last = runnable.value.at(-1);
    if (next !== previous && next > 0 && last !== undefined) focusAt(last);
});
</script>

<template>
    <nav v-if="items.length > 0" ref="nav" class="editor-page-crumbs" :aria-label="t('crumbs.pageLabel')" data-editor-page-breadcrumbs>
        <template v-for="(item, index) in items" :key="index">
            <span v-if="index > 0" class="i-lucide-chevron-right editor-page-crumbs__separator" aria-hidden="true"></span>
            <button
                v-if="runnable.includes(index)"
                type="button"
                class="editor-page-crumbs__segment is-action nb-ui-focus-ring-inset"
                :class="index > 0 ? 'is-shrinkable' : ''"
                :tabindex="tabStop === index ? 0 : -1"
                :title="item.label"
                :data-page-crumb="index"
                @click="item.run?.()"
                @focus="focused = index"
                @keydown="(event: KeyboardEvent) => onKeydown(event, index)"
            >
                <span class="editor-page-crumbs__label">{{ item.label }}</span>
            </button>
            <span v-else class="editor-page-crumbs__segment" :class="index > 0 && index < items.length - 1 ? 'is-shrinkable' : ''" :title="item.label" :aria-current="index === items.length - 1 ? 'page' : undefined" :data-page-crumb="index">
                <span class="editor-page-crumbs__label">{{ item.label }}</span>
            </span>
        </template>
    </nav>
</template>

<style scoped>
/* 尺寸与文件的面包屑（EditorBreadcrumbs）一致：两种标签来回切时这一行不跳。 */
.editor-page-crumbs {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    height: 26px;
    padding-inline: 8px;
    overflow: hidden;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    background: var(--panel-surface);
    white-space: nowrap;
}

.editor-page-crumbs__separator {
    flex: none;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.editor-page-crumbs__segment {
    display: flex;
    flex: none;
    align-items: center;
    min-width: 0;
    height: 20px;
    padding-inline: 4px;
    border-radius: 4px;
}

/* 放不下时中间的段先缩短，第一段与最后一段不收缩。 */
.editor-page-crumbs__segment.is-shrinkable {
    flex: 0 1 auto;
    min-width: 24px;
}

.editor-page-crumbs__segment.is-action:hover {
    color: var(--text-main);
    background: var(--bg-hover);
}

.editor-page-crumbs__segment[aria-current="page"] {
    color: var(--text-main);
}

.editor-page-crumbs__label {
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
