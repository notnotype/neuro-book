<script setup lang="ts">
/** 一个工具区域的框（同名 .md）：选中容器的落点与本区域的标题行；落点经 `target` 报给宿主。 */
import {computed, onBeforeUnmount, ref, watch} from "vue";

import {Tabs} from "@notnotype/nb-ui/components";

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale} from "nbook/shared/localized-text";

import type {ContainerPresentation, PartPresentation} from "../views/presentation";

defineOptions({name: "WorkbenchToolPartHost"});

const props = defineProps<{
    part: "sidebar" | "auxiliarybar" | "panel";
    presentation: PartPresentation;
    selected: ContainerPresentation | null;
    locale: DisplayLocale;
    label: string;
    emptyText: string;
}>();

const emit = defineEmits<{
    (event: "select", containerId: string): void;
    (event: "target", element: HTMLElement | null): void;
}>();

defineSlots<{
    actions?(props: {container: ContainerPresentation}): unknown;
}>();

const tabs = computed(() => props.presentation.switcher.map((item) => ({value: item.containerId, label: localize(item.title, props.locale), iconClass: item.icon})));
const showTitleRow = computed(() => props.part === "sidebar" && props.selected?.showContainerTitle === true);

/** 落点只在有选中容器时出现；它换成新元素或卸下时报给宿主。 */
const target = ref<HTMLElement | null>(null);
watch(target, (element) => emit("target", element));
onBeforeUnmount(() => {
    if (target.value !== null) emit("target", null);
});
</script>

<template>
    <section class="workbench-tool-part" :class="`workbench-tool-part--${part}`" :aria-label="label" :data-tool-part="part">
        <header v-if="showTitleRow && selected !== null" class="workbench-tool-part__head">
            <span class="workbench-tool-part__icon" :class="selected.icon" aria-hidden="true"></span>
            <h2 class="workbench-tool-part__title">{{ localize(selected.title, locale) }}</h2>
            <div class="workbench-tool-part__actions">
                <slot name="actions" :container="selected"></slot>
            </div>
        </header>
        <header v-else-if="part === 'auxiliarybar' && presentation.switcher.length > 0" class="workbench-tool-part__head workbench-tool-part__head--tabs">
            <Tabs
                class="workbench-tool-part__tabs"
                size="sm"
                :model-value="presentation.selected ?? ''"
                :items="tabs"
                :aria-label="label"
                @update:model-value="(value: string) => emit('select', value)"
            />
            <div v-if="selected !== null && selected.mode === 'single'" class="workbench-tool-part__actions">
                <slot name="actions" :container="selected"></slot>
            </div>
        </header>
        <div v-if="selected !== null" ref="target" class="workbench-tool-part__body" data-container-target :data-selected-container="selected.id"></div>
        <div v-else class="workbench-tool-part__empty">{{ emptyText }}</div>
    </section>
</template>

<style scoped>
.workbench-tool-part {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.workbench-tool-part--sidebar,
.workbench-tool-part--auxiliarybar {
    background: var(--panel-surface);
    border: var(--border-w) solid var(--panel-outline);
    border-radius: var(--radius-panel);
}

.workbench-tool-part__head {
    display: flex;
    flex: 0 0 32px;
    align-items: center;
    gap: var(--space-1);
    height: 32px;
    min-width: 0;
    padding-inline: var(--space-3) var(--space-1);
    border-bottom: var(--border-w) solid var(--divider);
}

.workbench-tool-part__head--tabs {
    padding-inline-start: var(--space-1);
}

.workbench-tool-part__tabs {
    flex: 1 1 auto;
    min-width: 0;
}

.workbench-tool-part__icon {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    color: var(--text-muted);
}

.workbench-tool-part__title {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.workbench-tool-part__actions {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    gap: var(--space-1);
}

.workbench-tool-part__body {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.workbench-tool-part__empty {
    padding: var(--space-3);
    color: var(--text-muted);
    font-size: var(--text-xs);
}
</style>
