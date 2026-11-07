<script setup lang="ts">
/**
 * 布局的一项（docs/specs/ui/forms.md“布局”）：字段、竖排、横排或分组。布局只排根上的字段；布局指向的字段不存在时
 * 什么也不画（`checkDescription` 另报）。分组可以折叠：折叠时内容不挂载，标题旁标出里面的问题数（输出 14、21）。
 */
import {computed, onBeforeUnmount, ref, useId} from "vue";

import {findNode} from "../model";
import type {FormLayout} from "../model";
import {fromPointer, toPointer} from "../path";
import NodeField from "./NodeField.vue";
import {issuesUnder, useFormScope} from "./scope";
import {useFormText} from "./text";

const props = defineProps<{layout: FormLayout}>();

const scope = useFormScope();
const text = useFormText();
const node = computed(() => (props.layout.type === "field" ? findNode(scope.model.value.root, props.layout.path) : undefined));
const contentId = `nb-form-group-${useId()}`;
const expanded = ref(props.layout.type === "group" ? props.layout.collapsed !== true : true);

function fieldPaths(layout: FormLayout): string[] {
    return layout.type === "field" ? [layout.path] : layout.items.flatMap(fieldPaths);
}
const inside = computed(() => fieldPaths(props.layout).flatMap((pointer) => issuesUnder(scope.shownIssues.value, fromPointer(pointer))));
const issueCount = computed(() => inside.value.length);
const hasError = computed(() => inside.value.some((issue) => issue.severity === "error"));

// 聚焦一条问题时，它在折叠的分组里就先展开（审查 S3 Sonnet 3、omp 8）。
if (props.layout.type === "group") {
    const pointers = new Set(fieldPaths(props.layout));
    const removeRevealer = scope.addRevealer((path) => {
        if (expanded.value || path.length === 0 || !pointers.has(toPointer(path.slice(0, 1)))) return false;
        expanded.value = true;
        return true;
    });
    onBeforeUnmount(removeRevealer);
}
</script>

<template>
    <NodeField v-if="props.layout.type === 'field' && node !== undefined" :node="node" />
    <section v-else-if="props.layout.type === 'group'" class="nb-form-group">
        <button type="button" class="nb-form-group__title" :aria-expanded="expanded" :aria-controls="expanded ? contentId : undefined" @click="expanded = !expanded">
            <svg class="nb-form-group__chevron" :class="{'nb-form-group__chevron--open': expanded}" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
            {{ text.text(props.layout.label) }}
            <span v-if="!expanded && issueCount > 0" class="nb-form-group__issues" :class="{'nb-form-group__issues--error': hasError}">{{ text.t('containsIssues', {count: issueCount}) }}</span>
        </button>
        <div v-if="expanded" :id="contentId" class="nb-form-column nb-form-group__content">
            <LayoutItem v-for="(item, index) in props.layout.items" :key="index" :layout="item" />
        </div>
    </section>
    <div v-else-if="props.layout.type === 'column' || props.layout.type === 'row'" :class="props.layout.type === 'row' ? 'nb-form-row' : 'nb-form-column'">
        <LayoutItem v-for="(item, index) in props.layout.items" :key="index" :layout="item" />
    </div>
</template>

<style scoped>
.nb-form-column {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-6);
}

.nb-form-row {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-6);
}

.nb-form-row > * {
    min-width: 160px;
    flex: 1 1 0;
}

.nb-form-group {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-5);
}

/* 分组的内容与对象的成员同一种层级线索：左侧一条细线（审查 S3 Sonnet 19）。 */
.nb-form-group__content {
    border-left: var(--border-w) solid var(--divider);
    padding-left: var(--space-6);
}

.nb-form-group__title {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: var(--space-3);
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    padding: 0;
    font: inherit;
    font-size: var(--text-md);
    font-weight: var(--weight-medium);
    color: var(--text-main);
    cursor: pointer;
}

.nb-form-group__title:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.nb-form-group__chevron {
    transition: transform var(--motion-move) var(--ease-layout);
}

.nb-form-group__chevron--open {
    transform: rotate(90deg);
}

.nb-form-group__issues {
    font-size: var(--text-xs);
    font-weight: normal;
    color: var(--status-warning);
}

.nb-form-group__issues--error {
    color: var(--status-danger);
}
</style>
